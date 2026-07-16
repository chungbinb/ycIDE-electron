// C++ 编译诊断 → 易语言源码位置 + 中文说明。
// 用户看到的曾是 `_启动窗口.cpp:2164:9: error: … is not contextually convertible to 'bool'` 外加两行
// C++ 源码回显——指的是 temp/*.cpp 这个用户从没写过的中间产物。现在应还原成
// 「_启动窗口.eyc 第 N 行」+ 回显那行易语言源码 + 中文说明 + 归咎方，C++ 原文只留给诊断日志。
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
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-diag-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })

function writeProject(dir: string, eycBody: string[]): void {
  writeFileSync(join(dir, 'p.epp'), ['# YiCode Project File', 'Version=1', 'ProjectName=友好报错', 'OutputType=WindowsApp', 'Platform=windows', '', 'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', ''].join('\n'), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
    name: '_启动窗口', title: '窗口', width: 400, height: 300, sourceFile: '_启动窗口.eyc',
    controls: [{ id: 'c1', type: '标签', name: '标签1', left: 10, top: 10, width: 120, height: 24, text: '', visible: true, enabled: true, properties: {} }],
  }), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 _按钮1_被单击', ...eycBody, ''].join('\n'), 'utf-8')
}

describe('C++ 编译诊断友好化', () => {
  // 流程语句名写错（当循环首 ≠ 判断循环首）会被当成自由命令调用生成出去——转译期的「未定义裸标识符」
  // 友好报错只 gate 裸标识符、不管调用形态，故这类必定漏到 C++ 层，是最真实的回归载体。
  it.skipIf(!zigAvailable)('漏到 C++ 的报错 → 回溯 .eyc 行号 + 回显源码 + 中文说明', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-diag-')); tmpDirs.push(dir)
    writeProject(dir, [
      '.局部变量 局_数, 整数型',
      '局_数 ＝ 1',
      '.当循环首 (局_数)',          // 第 7 行：正确写法是 .判断循环首
      '.当循环尾 ()',
    ])
    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    expect(result.success).toBe(false)
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')

    expect(errs).toContain('错误: _启动窗口.eyc 第 7 行')
    expect(errs).toContain('.当循环首 (局_数)')                    // 回显用户自己写的那行
    expect(errs).toContain('找不到「当循环首」这个变量或命令')       // 中文说明
    expect(errs).toContain('这一行需要你修改易语言代码')            // 归咎方=用户（中日韩名字）

    // C++ 噪音不再进面板。（clang 的源码回显/插入符行确实会发出来——见 zig c++ 直接编译坏文件的输出——
    // 这里断言它们被挡掉了：回显行会带上生成代码的 /*@行号*/ 标记，插入符行带 ^~。）
    expect(errs).not.toContain('undeclared identifier')
    expect(errs).not.toContain('_启动窗口.cpp:')
    expect(errs).not.toContain('/*@')
    expect(errs).not.toContain('^~')
  }, 120000)

  // 类型对不上多半是用户自己写错了（只是转译期没拦住），不能像语法错那样咬定「不是你的代码写错了」。
  it.skipIf(!zigAvailable)('类型不匹配 → 中文说明 + 不把锅甩给 ycIDE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-diag-type-')); tmpDirs.push(dir)
    writeProject(dir, [
      '.局部变量 局_数, 整数型',
      '.局部变量 局_文本, 文本型',
      '局_文本 ＝ “abc”',
      '局_数 ＝ 局_文本',            // 第 8 行
    ])
    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    expect(result.success).toBe(false)
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')

    expect(errs).toContain('错误: _启动窗口.eyc 第 8 行')
    expect(errs).toContain('赋值两边的类型不兼容')
    expect(errs).toContain('请先检查这一行的类型用得对不对')
    expect(errs).not.toContain('不是你的代码写错了')
    expect(errs).not.toContain('incompatible')
  }, 120000)

  it.skipIf(!zigAvailable)('C++ 原文无删减留在诊断日志里', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-diag-log-')); tmpDirs.push(dir)
    writeProject(dir, ['.当循环首 (1)'])
    const before = messages.length
    await compileProject({ projectDir: dir, mode: 'run' })

    const logHint = messages.slice(before).map(m => m.text).find(t => t.startsWith('编译诊断日志: '))
    expect(logHint, '编译失败应给出诊断日志路径').toBeTruthy()
    const log = readFileSync(logHint!.replace('编译诊断日志: ', '').trim(), 'utf-8')
    expect(log).toContain('undeclared identifier')                // 面板里被换掉的英文原文
    expect(log).toContain('当循环首')
  }, 120000)

  it.skipIf(!zigAvailable)('生成代码带 /*@eyc行号*/ 来源标记（转译缓存命中时靠它恢复映射）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-diag-mark-')); tmpDirs.push(dir)
    writeProject(dir, ['.局部变量 局_数, 整数型', '局_数 ＝ 42'])
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    expect(result.success).toBe(true)

    const gen = readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8')
    expect(gen).toMatch(/^\/\*@6\*\/\s+局_数 = 42LL;$/m)   // 第 6 行的赋值
  }, 120000)
})
