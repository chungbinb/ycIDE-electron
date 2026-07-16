// 【流程命令的两种形态 · 运行时】「结束/返回/跳出循环/到循环尾」是语句级流程命令：
// 易语言文本代码里不带点（`结束 ()`），表格编辑器落盘时才统一补点（eycFormat.ts eycToYiFormat）。
// krnln 命令表里有同名变参空桩（krnln_end/krnln_return 等），修复前无点形态会被当普通命令
// 派发到空桩——静默无操作、程序不退出（2026-07-16 在 commonDlg 运行时测试中实测：
// WindowsApp 进程留在消息循环里直到超时）。本测试钉死两种形态运行时完全同义。
//
// 块结构关键字（如果/如果真/循环首尾 等）只有带点形态是合法源码：无点时必须给友好编译错，
// 而不是静默派发空桩让整个块失效（条件不判断、块体无条件执行）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []
const tmpDirs: string[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-flowcmd-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})
afterAll(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 占用中，交给系统清理 */ } } })

// dot='' 为易语言文本代码的无点形态；dot='.' 为表格编辑器落盘的带点形态。两者必须逐行同义。
function flowProgram(dot: '' | '.'): string {
  return [
    '.版本 2', '.程序集 程序集1', '',
    '.子程序 _启动子程序', '',
    '标准输出 (0, “S1” ＋ #换行符)',
    '子程序A ()',
    '标准输出 (0, “V=” ＋ 到文本 (取值 ()) ＋ #换行符)',
    '.计次循环首 (5, )',
    '    标准输出 (0, “L” ＋ #换行符)',
    `    ${dot}跳出循环 ()`,
    '.计次循环尾 ()',
    '.计次循环首 (3, )',
    `    ${dot}到循环尾 ()`,
    '    标准输出 (0, “X” ＋ #换行符)',
    '.计次循环尾 ()',
    '标准输出 (0, “S2” ＋ #换行符)',
    `${dot}结束 ()`,
    '标准输出 (0, “NEVER” ＋ #换行符)', '',
    '.子程序 子程序A', '',
    '标准输出 (0, “A1” ＋ #换行符)',
    `${dot}返回 ()`,
    '标准输出 (0, “A2” ＋ #换行符)', '',
    '.子程序 取值, 整数型', '',
    `${dot}返回 (42)`, '',
  ].join('\n')
}

async function compileAndRun(name: string, eyc: string): Promise<{ success: boolean; errors: string; out: string }> {
  const dir = mkdtempSync(join(tmpdir(), `ycide-flowcmd-${name}-`)); tmpDirs.push(dir)
  writeFileSync(join(dir, 'p.epp'), ['ProjectName=流程命令形态', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
  writeFileSync(join(dir, '程序.eyc'), eyc, 'utf-8')
  const before = messages.length
  const r = await compileProject({ projectDir: dir, mode: 'build' })
  const errors = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
  if (!r.success) return { success: false, errors, out: '' }
  // 结束 () 若落回空桩，Console 程序仍会自然跑到底——靠 NEVER 是否被打印来断言，无需依赖挂起超时
  const out = execFileSync(r.outputFile!, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
  return { success: true, errors, out }
}

function assertFlowSemantics(out: string): void {
  expect(out).toContain('S1')
  expect(out, '返回 () 前的输出要在').toContain('A1')
  expect(out, '返回 () 后的语句不得执行').not.toContain('A2')
  expect(out, '返回 (值) 要把值带回调用方').toContain('V=42')
  expect(out.split('L').length - 1, '跳出循环 () 后循环不得再进第二圈').toBe(1)
  expect(out, '到循环尾 () 后的语句不得执行').not.toContain('X')
  expect(out, '结束 () 前的输出要在').toContain('S2')
  expect(out, '结束 () 必须真正退出进程（修复前落 krnln_end 空桩，NEVER 会被打印）').not.toContain('NEVER')
}

describe('语句级流程命令：无点/带点两种形态同义', () => {
  it.skipIf(!zigAvailable)('无点形态（易语言文本代码写法）：结束/返回/跳出循环/到循环尾', async () => {
    const r = await compileAndRun('bare', flowProgram(''))
    expect(r.success, `编译失败（无点流程命令曾被派发到 krnln 空桩）：\n${r.errors}`).toBe(true)
    assertFlowSemantics(r.out)
  }, 240000)

  it.skipIf(!zigAvailable)('带点形态（表格编辑器落盘写法）：行为与无点完全一致', async () => {
    const r = await compileAndRun('dotted', flowProgram('.'))
    expect(r.success, `编译失败：\n${r.errors}`).toBe(true)
    assertFlowSemantics(r.out)
  }, 240000)

  it.skipIf(!zigAvailable)('块结构关键字无点：友好编译错，而不是静默派发空桩', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-flowcmd-block-')); tmpDirs.push(dir)
    writeFileSync(join(dir, 'p.epp'), ['ProjectName=块关键字无点', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '程序.eyc'), [
      '.版本 2', '.程序集 程序集1', '',
      '.子程序 _启动子程序', '',
      '如果真 (1 ＝ 2)',
      '    标准输出 (0, “块体不该无条件执行” ＋ #换行符)',
      '.如果真结束', '',
    ].join('\n'), 'utf-8')
    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errors = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, '无点「如果真」修复前会静默编译通过、条件失效').toBe(false)
    expect(errors).toContain('须以带点形态书写')
  }, 240000)
})
