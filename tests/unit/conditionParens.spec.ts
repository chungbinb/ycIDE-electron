// 条件表达式括号包裹回归。
// wrapConditionForC 曾用「首字符是 ( 且尾字符是 )」判断条件已被括号包住，但这俩括号未必配对：
// 命令表达式的通用生成形态是 IIFE `([&]() -> int { … })()`，首尾都是括号却不配对，
// 于是生成出 `if ([&]() -> int { … })() {`——条件在 lambda 处提前闭合，clang 报
// 「lambda is not contextually convertible to 'bool'」。凡是「拿命令返回值直接当条件」的写法
// （.如果 / .判断开始 / .当循环首 / .循环判断尾）都中招。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []
const tmpDirs: string[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-cond-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })

function writeProject(dir: string, eycBody: string[]): void {
  writeFileSync(join(dir, 'p.epp'), ['# YiCode Project File', 'Version=1', 'ProjectName=条件括号', 'OutputType=WindowsApp', 'Platform=windows', '', 'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', ''].join('\n'), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
    name: '_启动窗口', title: '窗口', width: 400, height: 300, sourceFile: '_启动窗口.eyc',
    controls: [{ id: 'c1', type: '标签', name: '标签1', left: 10, top: 10, width: 120, height: 24, text: '', visible: true, enabled: true, properties: {} }],
  }), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 _按钮1_被单击', ...eycBody, ''].join('\n'), 'utf-8')
}

describe('条件表达式括号包裹', () => {
  it.skipIf(!zigAvailable)('命令返回值直接当条件（IIFE 形态）→ 条件被完整包住并编译通过', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-cond-iife-')); tmpDirs.push(dir)
    writeProject(dir, [
      '.局部变量 局_小数, 双精度小数型',
      '.局部变量 局_次数, 整数型',
      '局_小数 ＝ 10 ÷ 2',
      '.如果 (是否运算正确 (局_小数))',
      '    标签1.标题 ＝ “对”',
      '.否则',
      '    标签1.标题 ＝ “错”',
      '.如果结束',
      '.判断开始 (是否运算正确 (局_小数))',
      '    标签1.标题 ＝ “分支”',
      '.判断结束',
      '.判断循环首 (是否运算正确 (局_次数))',   // 只验证编译，不运行
      '    局_次数 ＝ 局_次数 ＋ 1',
      '.判断循环尾 ()',
    ])
    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, `编译失败：\n${errs}`).toBe(true)

    const gen = readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8')
    // 坏形态：if/while 后面直接跟 lambda（条件在 lambda 收尾处提前闭合）
    expect(gen).not.toMatch(/\b(?:if|while)\s*\(\s*\[&\]/)
    // 好形态：lambda 外面还有一层属于 if/while 的括号
    expect(gen).toMatch(/\bif\s*\(\(\[&\]/)
    expect(gen).toMatch(/\bwhile\s*\(\(\[&\]/)
  }, 120000)

  it.skipIf(!zigAvailable)('普通比较条件不被多包一层（否则触发 -Wparentheses-equality 刷屏）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-cond-cmp-')); tmpDirs.push(dir)
    writeProject(dir, [
      '.局部变量 局_数, 整数型',
      '局_数 ＝ 5',
      '.如果 (局_数 ＝ 5)',
      '    标签1.标题 ＝ “等”',
      '.如果结束',
    ])
    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, `编译失败：\n${errs}`).toBe(true)

    const gen = readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8')
    expect(gen).toContain('if (局_数 == 5LL) {')
    expect(gen).not.toContain('if ((局_数 == 5LL)) {')
    const warns = messages.slice(before).filter(m => m.type === 'warning').map(m => m.text).join('\n')
    expect(warns).not.toContain('parentheses-equality')
  }, 120000)
})
