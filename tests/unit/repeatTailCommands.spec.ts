// 「尾参可重复」的普通命令（写出族）：帮助文件标注「命令参数表中最后一个参数可以被重复添加」。
// 语义=依次执行 → codegen 逐值各发一次调用（前 k-1 实参复用）。此前 ycmd 未标 repeatable，
// 多值会被参数个数校验拦下（且 krnln_AddElement 的多值特例因此成了不可达死代码）。
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-rt-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})

function mkProj(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'ycide-rt-proj-'))
  writeFileSync(join(dir, 'p.epp'), ['# YiCode Project File', 'Version=1', 'ProjectName=rt', 'OutputType=WindowsApp', 'Platform=windows', '', 'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', ''].join('\n'), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({ name: '_启动窗口', title: 'w', width: 300, height: 200, sourceFile: '_启动窗口.eyc', controls: [] }), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 __启动窗口_创建完毕', '.局部变量 f, 整数型', '.局部变量 t, 文本型', ...lines, ''].join('\n'), 'utf-8')
  return dir
}

describe('尾参可重复的写出族命令', () => {
  it.skipIf(!zigAvailable)('写出文本/写文本行/标准输出/输出调试文本 多值 → 逐值各发一次调用，且可编译', async () => {
    const dir = mkProj([
      't ＝ “乙”',
      '写出文本 (f, “甲”, t, “丙”)',      // 3 个值 → 3 次 krnln_WriteText，文件号复用
      '写文本行 (f, “x”, “y”)',           // 2 个值 → 2 次
      '标准输出 (1, “a”, “b”)',           // 前导「输出方向」复用
      '输出调试文本 (“p”, “q”)',          // 单参族：全部实参都重复
      '写出文本 (f, “单值”)',             // 单值仍走普通路径（不多发）
    ])
    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'run' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)

    const gen = readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8')
    const lineWith = (needle: string) => gen.split('\n').find(l => l.includes(needle)) || ''
    const countIn = (l: string, sym: string) => (l.match(new RegExp(sym.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&'), 'g')) || []).length

    const l1 = lineWith('甲')
    expect(countIn(l1, 'krnln_WriteText('), '写出文本 三个值应各发一次').toBe(3)
    expect(l1).toContain('丙')

    expect(countIn(lineWith('“x”') || lineWith('L"x"'), 'krnln_WriteLine('), '写文本行 两个值应各发一次').toBe(2)
    expect(countIn(lineWith('L"a"'), 'krnln_fputs('), '标准输出 两个值应各发一次').toBe(2)
    expect(countIn(lineWith('L"p"'), 'krnln_OutputDebugText('), '输出调试文本 两个值应各发一次').toBe(2)
    // 单值：仍是一次调用
    expect(countIn(lineWith('单值'), 'krnln_WriteText('), '单值应只发一次').toBe(1)
    rmSync(dir, { recursive: true, force: true })
  }, 120000)

  it.skipIf(!zigAvailable)('未标 repeatable 的命令给多实参仍报「参数数量不匹配」（没被误放开）', async () => {
    const dir = mkProj(['写到文件 (“f.txt”, 到字节集 (“a”), 到字节集 (“b”))'])  // 写到文件 语义存疑，本批未标
    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'run' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success).toBe(false)
    expect(errs).toContain('参数数量不匹配')
    rmSync(dir, { recursive: true, force: true })
  }, 120000)
})
