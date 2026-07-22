// 优化级别 + 普通编译语义。
//
// 用户实测暴露：设置里选了优化级别，但普通编译日志仍是「O0 (调试优先)」。
// 根因——普通编译入口硬传 debug:true，优化分支第一个 `if (options.debug)` 就把它拦在 O0，
// 用户级别所在的 else 分支从来到不了（beta.24 批3 的疏漏）。
//
// 这里从**真实 zig 命令行**（诊断日志里的「zig 命令行参数」行）坐实优化标志真的传进去了，
// 而不只信 sendMessage 的文案。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage, type CompileOptions } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []
const tmpDirs: string[] = []
let optimizeLevel: 'O0' | 'O1' | 'O2' | 'Os' = 'O2'

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-opt-userdata-')), appVersion: 'test' })
  setCompilerHost({
    emitOutput: (m) => { messages.push(m) },
    requestFocusIdeWindow: () => {},
    notifyProcessExit: () => {},
    openPathExternally: async () => '',
    // zigPath 留空 → 回落 IDE 内置 compiler/zig；optimizeLevel 由每个用例设置
    readCompilerSettings: () => ({ zigPath: '', optimizeLevel }),
  })
})
afterAll(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 占用中 */ } } })

interface CompileProbe {
  success: boolean
  out: string
  optLogText: string        // sendMessage 的「优化级别: …」文案
  zigCmdLine: string        // 诊断日志里真实的 zig 命令行参数
}

async function compileConsole(lines: string[], opts: Partial<CompileOptions> = {}): Promise<CompileProbe> {
  const dir = mkdtempSync(join(tmpdir(), 'ycide-opt-'))
  tmpDirs.push(dir)
  writeFileSync(join(dir, 'p.epp'), ['ProjectName=opt-level', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
  writeFileSync(join(dir, '程序.eyc'), ['.版本 2', '.程序集 程序集1', '', '.子程序 _启动子程序', ...lines, ''].join('\n'), 'utf-8')
  const before = messages.length
  const r = await compileProject({ projectDir: dir, mode: 'compile', ...opts })
  const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
  expect(r.success, `编译失败：\n${errs}`).toBe(true)
  const out = execFileSync(r.outputFile, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
  const optLog = messages.slice(before).find(m => m.text.startsWith('优化级别:'))
  // 诊断日志里的真实命令行——最贴近实际执行
  const diagPath = join(dir, 'temp', '编译诊断日志.log')
  const diag = existsSync(diagPath) ? readFileSync(diagPath, 'utf-8') : ''
  const cmdLine = (diag.split('\n').find(l => l.includes('zig 命令行参数')) || '').trim()
  return { success: r.success, out, optLogText: optLog?.text || '', zigCmdLine: cmdLine }
}

const HELLO = ['标准输出 (0, “hi”)']

describe('优化级别与普通编译', () => {
  it.skipIf(!zigAvailable)('普通编译(debug 未传=false)真实命令行带用户选的 -O1，不带 -g', async () => {
    optimizeLevel = 'O1'
    const p = await compileConsole(HELLO)
    expect(p.optLogText, '面板文案应显示 O1 轻度优化').toContain('O1')
    expect(p.optLogText).not.toContain('调试优先')
    // 真实命令行坐实：带 -O1、不带调试符号 -g
    expect(p.zigCmdLine, '真实 zig 命令行应含 -O1').toMatch(/(^|\s)-O1(\s|$)/)
    expect(p.zigCmdLine, '发布编译不应带调试符号 -g').not.toMatch(/(^|\s)-g(\s|$)/)
    // YC_DEBUG_BUILD=0 下程序照常运行
    expect(p.out).toContain('hi')
  }, 180000)

  it.skipIf(!zigAvailable)('优化级别 Os 时真实命令行带 -Os', async () => {
    optimizeLevel = 'Os'
    const p = await compileConsole(HELLO)
    expect(p.optLogText).toContain('Os')
    expect(p.zigCmdLine).toMatch(/(^|\s)-Os(\s|$)/)
    expect(p.out).toContain('hi')
  }, 180000)

  it.skipIf(!zigAvailable)('运行(debug=true)强制 -O0 -g，忽略用户优化级别', async () => {
    optimizeLevel = 'Os' // 故意设非 O0，验证被忽略
    const p = await compileConsole(HELLO, { debug: true })
    expect(p.optLogText, '调试构建应显示 O0 调试优先').toContain('O0 (调试优先)')
    expect(p.optLogText).not.toContain('Os')
    // 真实命令行：带 -g、带 -O0，不带 -Os
    expect(p.zigCmdLine).toMatch(/(^|\s)-g(\s|$)/)
    expect(p.zigCmdLine).toMatch(/(^|\s)-O0(\s|$)/)
    expect(p.zigCmdLine).not.toMatch(/(^|\s)-Os(\s|$)/)
    expect(p.out).toContain('hi')
  }, 180000)

  it.skipIf(!zigAvailable)('未注入 readCompilerSettings 时回落 O2（发布编译默认）', async () => {
    // 临时把 host 的 readCompilerSettings 摘掉
    setCompilerHost({
      emitOutput: (m) => { messages.push(m) },
      requestFocusIdeWindow: () => {},
      notifyProcessExit: () => {},
      openPathExternally: async () => '',
    })
    try {
      const p = await compileConsole(HELLO)
      expect(p.optLogText).toContain('O2')
      expect(p.zigCmdLine).toMatch(/(^|\s)-O2(\s|$)/)
    } finally {
      // 复原，避免污染后续用例
      setCompilerHost({
        emitOutput: (m) => { messages.push(m) },
        requestFocusIdeWindow: () => {},
        notifyProcessExit: () => {},
        openPathExternally: async () => '',
        readCompilerSettings: () => ({ zigPath: '', optimizeLevel }),
      })
    }
  }, 180000)
})
