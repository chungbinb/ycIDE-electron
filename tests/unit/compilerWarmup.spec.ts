/**
 * 编译器缓存预热（src/main/compilerWarmup.ts）行为测试。
 *
 * 这块逻辑一旦出错的后果是「运行按钮永久灰着」——比编译慢更糟，所以把关键分支都钉死：
 * 未配置编译器 / zig 不可用 / 标记命中直接放行 / 无标记跑空编译 / 并发共享同一次执行。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// execFile 走 mock：真调 zig 会把单测拖到几十秒，且依赖机器上装没装编译器
const execFileMock = vi.fn()
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, execFile: (...args: unknown[]) => execFileMock(...args) }
})

/** 让 execFile 的回调按脚本返回：zig version 给版本号，zig c++ 按 opts 决定成败 */
function stubZig(opts: { version?: string; buildOk?: boolean } = {}): void {
  const { version = '0.15.1', buildOk = true } = opts
  execFileMock.mockImplementation((_exe: string, args: string[], _o: unknown, cb: (e: Error | null, so: string) => void) => {
    if (args[0] === 'version') {
      if (!version) { cb(new Error('not found'), ''); return }
      cb(null, `${version}\n`)
      return
    }
    // zig c++ -o out src
    if (!buildOk) { cb(new Error('build failed'), ''); return }
    cb(null, '')
  })
}

let userData: string
let mod: typeof import('../../src/main/compilerWarmup')

beforeEach(async () => {
  execFileMock.mockReset()
  userData = mkdtempSync(join(tmpdir(), 'ycide-warmup-test-'))
  // 模块级持有 currentState / inflight，每个用例要拿全新实例。
  // runtimeEnv 必须在 resetModules **之后**注入——否则注进的是旧实例，
  // 新 compilerWarmup 拿到的 env 仍是 null，标记读写会被 try/catch 静默吞掉。
  vi.resetModules()
  const runtimeEnv = await import('../../src/main/runtimeEnv')
  runtimeEnv.setRuntimeEnv({ appPath: userData, isPackaged: false, userDataPath: userData, appVersion: '0.0.0' })
  mod = await import('../../src/main/compilerWarmup')
})

afterEach(() => {
  try { rmSync(userData, { recursive: true, force: true }) } catch { /* 清理失败无害 */ }
})

const markFile = (): string => join(userData, 'compiler-warmup.json')

describe('ensureCompilerWarm', () => {
  it('未配置编译器时报 no-compiler，且不去执行任何命令', async () => {
    stubZig()
    const s = await mod.ensureCompilerWarm(null)
    expect(s.phase).toBe('no-compiler')
    expect(s.message).toContain('编译器')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('zig version 执行失败时报 failed，不去跑空编译', async () => {
    stubZig({ version: '' })
    const s = await mod.ensureCompilerWarm('C:/fake/zig.exe')
    expect(s.phase).toBe('failed')
    // 只调过 version，没进到 c++ 那一步
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('无标记时跑一次空编译，成功后 ready 并写下标记', async () => {
    stubZig()
    const s = await mod.ensureCompilerWarm('C:/zig/zig.exe')
    expect(s.phase).toBe('ready')
    expect(existsSync(markFile())).toBe(true)
    const mark = JSON.parse(readFileSync(markFile(), 'utf-8'))
    expect(mark.zigPath).toBe('C:/zig/zig.exe')
    expect(mark.zigVersion).toBe('0.15.1')
    // version + c++ 各一次
    expect(execFileMock).toHaveBeenCalledTimes(2)
  })

  it('标记命中（同路径同版本）时直接 ready，跳过空编译', async () => {
    writeFileSync(markFile(), JSON.stringify({
      version: 1, zigPath: 'C:/zig/zig.exe', zigVersion: '0.15.1', warmedAt: 1,
    }), 'utf-8')
    stubZig()
    const s = await mod.ensureCompilerWarm('C:/zig/zig.exe')
    expect(s.phase).toBe('ready')
    // 只跑了 version 去比对指纹，没有空编译
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('换了编译器路径（标记不匹配）时重新预热', async () => {
    writeFileSync(markFile(), JSON.stringify({
      version: 1, zigPath: 'C:/old/zig.exe', zigVersion: '0.15.1', warmedAt: 1,
    }), 'utf-8')
    stubZig()
    const s = await mod.ensureCompilerWarm('C:/new/zig.exe')
    expect(s.phase).toBe('ready')
    expect(execFileMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(readFileSync(markFile(), 'utf-8')).zigPath).toBe('C:/new/zig.exe')
  })

  it('zig 版本升级后（路径同版本不同）重新预热', async () => {
    writeFileSync(markFile(), JSON.stringify({
      version: 1, zigPath: 'C:/zig/zig.exe', zigVersion: '0.14.0', warmedAt: 1,
    }), 'utf-8')
    stubZig({ version: '0.15.1' })
    const s = await mod.ensureCompilerWarm('C:/zig/zig.exe')
    expect(s.phase).toBe('ready')
    expect(execFileMock).toHaveBeenCalledTimes(2)
  })

  it('空编译失败时报 failed 且不写标记（否则下次会误以为已热）', async () => {
    stubZig({ buildOk: false })
    const s = await mod.ensureCompilerWarm('C:/zig/zig.exe')
    expect(s.phase).toBe('failed')
    expect(existsSync(markFile())).toBe(false)
  })

  it('并发调用共享同一次执行，不会重复空编译', async () => {
    stubZig()
    const [a, b, c] = await Promise.all([
      mod.ensureCompilerWarm('C:/zig/zig.exe'),
      mod.ensureCompilerWarm('C:/zig/zig.exe'),
      mod.ensureCompilerWarm('C:/zig/zig.exe'),
    ])
    expect([a.phase, b.phase, c.phase]).toEqual(['ready', 'ready', 'ready'])
    expect(execFileMock).toHaveBeenCalledTimes(2)
  })

  it('已 ready 后再次调用直接返回，不再执行命令', async () => {
    stubZig()
    await mod.ensureCompilerWarm('C:/zig/zig.exe')
    execFileMock.mockClear()
    const s = await mod.ensureCompilerWarm('C:/zig/zig.exe')
    expect(s.phase).toBe('ready')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('invalidateWarmup 后会重新检测（设置里换编译器的路径）', async () => {
    stubZig()
    await mod.ensureCompilerWarm('C:/zig/zig.exe')
    mod.invalidateWarmup()
    expect(mod.getWarmupState().phase).toBe('idle')
    execFileMock.mockClear()
    const s = await mod.ensureCompilerWarm('C:/zig/zig.exe')
    expect(s.phase).toBe('ready')
    // 标记还在且匹配 → 只比对指纹，不再空编译
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('损坏的标记文件按「无标记」处理，不抛异常', async () => {
    writeFileSync(markFile(), '{ 这不是 JSON', 'utf-8')
    stubZig()
    const s = await mod.ensureCompilerWarm('C:/zig/zig.exe')
    expect(s.phase).toBe('ready')
    expect(execFileMock).toHaveBeenCalledTimes(2)
  })

  it('状态变化会通知订阅者，且能取消订阅', async () => {
    stubZig()
    const seen: string[] = []
    const off = mod.onWarmupStateChange(s => seen.push(s.phase))
    await mod.ensureCompilerWarm('C:/zig/zig.exe')
    expect(seen).toContain('checking')
    expect(seen).toContain('warming')
    expect(seen[seen.length - 1]).toBe('ready')

    off()
    const before = seen.length
    mod.invalidateWarmup()
    expect(seen.length).toBe(before)
  })
})
