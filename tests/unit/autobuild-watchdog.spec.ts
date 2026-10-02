// AutoBuild 看门狗（autobuild 模式 10 分钟强制退出）测试。
//
// 分三层覆盖，都不依赖真实编译 / Zig 工具链：
//   ① AutoBuildWatchdog 计时器本身（毫秒级，直接验证「到点触发一次 / stop 后不触发」）；
//   ② AutoBuild 的接线（开始时打印警告文案、run 里 start、finally 里 stop）；
//   ③ 触发时的收尾行为（打印结束原因、结束残留子进程、以退出码 124 强制退出）。
//
// 之所以把退出抽成注入点（options.exitProcess），就是为了在这里断言「确实被强制退出」，
// 而不至于真的把跑测试的进程杀掉。
import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { AutoBuild, AutoBuildWatchdog, type AutoBuildRequest } from '../../src/main/autoBuild'

/** 一个必然不存在的目录：run() 会在扫描前以「用法错误」收场，从而不会真的去编译。 */
const MISSING_DIR = join(tmpdir(), '__ycide_watchdog_missing_dir__')
const EXIT_WATCHDOG = 124

function makeAutoBuild(
  overrides: Partial<AutoBuildRequest> = {},
  exitProcess?: (code: number) => void,
): { instance: AutoBuild; lines: string[] } {
  const lines: string[] = []
  const request: AutoBuildRequest = {
    projectDir: MISSING_DIR,
    run: false,
    debug: false,
    encoding: 'utf8',
    json: false,
    ...overrides,
  }
  const instance = new AutoBuild(request, {
    appPath: process.cwd(),
    print: (line) => { lines.push(line) },
    writeRaw: (text) => { lines.push(text) },
    exitProcess: exitProcess ?? (() => { /* 默认不真的退出 */ }),
  })
  return { instance, lines }
}

describe('AutoBuildWatchdog 计时器', () => {
  it('totalMs <= 0 视为关闭：不启用，start 也不排定时器', async () => {
    const onFire = vi.fn()
    const watchdog = new AutoBuildWatchdog(0, onFire)
    expect(watchdog.enabled).toBe(false)
    watchdog.start()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(onFire).not.toHaveBeenCalled()
  })

  it('到点触发且只触发一次', async () => {
    const onFire = vi.fn()
    const watchdog = new AutoBuildWatchdog(20, onFire)
    watchdog.start()
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('stop() 之后不再触发', async () => {
    const onFire = vi.fn()
    const watchdog = new AutoBuildWatchdog(30, onFire)
    watchdog.start()
    watchdog.stop()
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(onFire).not.toHaveBeenCalled()
  })

  it('重复 start 只排一个定时器', async () => {
    const onFire = vi.fn()
    const watchdog = new AutoBuildWatchdog(20, onFire)
    watchdog.start()
    watchdog.start()
    watchdog.start()
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(onFire).toHaveBeenCalledTimes(1)
  })
})

describe('AutoBuild 看门狗接线', () => {
  it('默认 10 分钟：autobuild 开始时打印强制退出警告', async () => {
    const { instance, lines } = makeAutoBuild()
    const code = await instance.execute()
    expect(code).toBe(2) // 目录不存在 → 用法错误
    const text = lines.join('\n')
    expect(text).toContain('当前处于 autobuild 模式，程序将在 10 分钟后强制退出，防止卡住！')
  })

  it('--watchdog 0 关闭看门狗：打印已关闭提示', async () => {
    const { instance, lines } = makeAutoBuild({ watchdogMinutes: 0 })
    await instance.execute()
    expect(lines.join('\n')).toContain('看门狗已关闭')
  })

  it('自定义时限时警告文案随之变化', async () => {
    const { instance, lines } = makeAutoBuild({ watchdogMinutes: 3 })
    await instance.execute()
    expect(lines.join('\n')).toContain('程序将在 3 分钟后强制退出')
  })

  it('run() 会 start 看门狗，结束后 finally 里 stop', async () => {
    const { instance } = makeAutoBuild()
    const started: number[] = []
    const stopped: number[] = []
    const holder = instance as unknown as { watchdog: unknown }
    holder.watchdog = {
      enabled: true,
      start: () => { started.push(1) },
      stop: () => { stopped.push(1) },
    }
    await instance.execute()
    expect(started.length).toBe(1)
    expect(stopped.length).toBe(1)
  })
})

describe('AutoBuild 看门狗触发', () => {
  it('打印结束原因并以退出码 124 强制退出', () => {
    const exits: number[] = []
    const { instance, lines } = makeAutoBuild({}, (code) => { exits.push(code) })
    const fire = (instance as unknown as { onWatchdogFire(): void }).onWatchdogFire.bind(instance)
    fire()

    expect(exits).toEqual([EXIT_WATCHDOG])
    const text = lines.join('\n')
    expect(text).toContain('看门狗触发')
    expect(text).toContain('强制结束自身')
    expect(text).toContain('退出码 124')
  })

  it('触发时结束仍在运行的残留子进程', () => {
    const exits: number[] = []
    const { instance, lines } = makeAutoBuild({}, (code) => { exits.push(code) })
    const kill = vi.fn()
    const holder = instance as unknown as { activeChild: unknown }
    holder.activeChild = { pid: 4321, exitCode: null, kill }

    const fire = (instance as unknown as { onWatchdogFire(): void }).onWatchdogFire.bind(instance)
    fire()

    expect(kill).toHaveBeenCalledTimes(1)
    expect(exits).toEqual([EXIT_WATCHDOG])
    expect(lines.join('\n')).toContain('pid=4321')
  })

  it('没有残留子进程时也能正常收尾退出', () => {
    const exits: number[] = []
    const { instance } = makeAutoBuild({}, (code) => { exits.push(code) })
    const fire = (instance as unknown as { onWatchdogFire(): void }).onWatchdogFire.bind(instance)
    fire()
    expect(exits).toEqual([EXIT_WATCHDOG])
  })
})

describe('AutoBuild --watchdog 参数解析', () => {
  it('接受分钟数', () => {
    const parsed = AutoBuild.parse(['build', MISSING_DIR, '--watchdog', '25'])
    expect(parsed.error).toBeNull()
    expect(parsed.request?.watchdogMinutes).toBe(25)
  })

  it('0 表示关闭', () => {
    const parsed = AutoBuild.parse(['build', MISSING_DIR, '--watchdog', '0'])
    expect(parsed.request?.watchdogMinutes).toBe(0)
  })

  it('负数 / 非数字报错', () => {
    expect(AutoBuild.parse(['build', MISSING_DIR, '--watchdog', '-1']).error).toContain('--watchdog')
    expect(AutoBuild.parse(['build', MISSING_DIR, '--watchdog', 'abc']).error).toContain('--watchdog')
  })

  it('未指定时留给默认值（undefined，由类内回落 10 分钟）', () => {
    const parsed = AutoBuild.parse(['build', MISSING_DIR])
    expect(parsed.request?.watchdogMinutes).toBeUndefined()
  })
})
