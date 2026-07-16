// 【近似等于 ≈ 运算符 · 运行时】用户写 `局_结果 ＝ 局_文本A ≈ 局_文本B` 编译失败：
// `unexpected character <U+2248>`——≈ 压根没接线，原样漏进了 C++。
//
// 命令形态 `近似等于 (a, b)` 一直是好的、实现(krnln_like)也在，缺的只是运算符。
// ≈ 不是 C 运算符（它落成命令调用），故 convertFullWidthOps 不能碰它，得原样带过表达式拆分，
// 由 findTopLevelComparison 认出、translateExpressionToC 的比较分支落成 近似等于 调用。
//
// 注：断言值是「真」/「假」不是 1/0——近似等于 返回逻辑型，而 逻辑型 在用户代码侧映射为 C++ bool，
// 到文本 由重载解析落到 yc_value_to_text(bool) 上（易语言正是印「真」/「假」）。
//
// 语义按帮助文件（lib/krnln/系统核心支持库帮助说明文件.txt）原文钉死：
//   〈逻辑型〉近似等于（文本型 被比较文本，文本型 比较文本）  英文名称：like
//   「当比较文本在被比较文本的首部被包容时返回真，否则返回假，运算符号为『?=』或『≈』」
// 即 `A ≈ B` = 「B 是 A 的前缀」。帮助**没说**忽略大小写，实现也确实大小写敏感、
// 且不做全角半角归一——下面 3 条断言就是钉这个的，别想当然改成「近似=模糊匹配」。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'
import { formatOps } from '../../src/renderer/src/components/Editor/editorCoreUtils'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []
const tmpDirs: string[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-like-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})
afterAll(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 占用中，交给系统清理 */ } } })

describe('近似等于 ≈ 运算符', () => {
  it.skipIf(!zigAvailable)('运算符与命令形态同义，语义逐条对齐帮助（前缀包容、大小写敏感）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-like-')); tmpDirs.push(dir)
    const say = (label: string, e: string) => `标准输出 (0, “${label}=” ＋ 到文本 (${e}) ＋ #换行符)`
    writeFileSync(join(dir, 'p.epp'), ['ProjectName=近似等于', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '程序.eyc'), [
      '.版本 2', '.程序集 程序集1', '',
      '.子程序 _启动子程序',
      '.局部变量 甲, 文本型',
      '.局部变量 乙, 文本型',
      '',
      // —— 帮助语义：「比较文本」在「被比较文本」首部被包容
      say('前缀命中', '“Hello World” ≈ “Hello”'),
      say('前缀不中', '“Hello” ≈ “World”'),
      say('完全相同', '“abc” ≈ “abc”'),
      say('比较文本更长', '“ab” ≈ “abc”'),
      say('空比较文本', '“abc” ≈ “”'),
      say('中文前缀', '“中华人民” ≈ “中华”'),
      // —— 这三条钉「不是模糊匹配」：帮助没说忽略大小写/全半角，实现也不做
      say('大小写敏感', '“Hello” ≈ “hello”'),
      say('不做全半角归一', '“123” ≈ “１２３”'),
      say('非前缀不算近似', '“abc” ≈ “abd”'),
      // —— 运算符必须与命令形态给出完全相同的结果
      say('命令形态对照', '近似等于 (“Hello World”, “Hello”)'),
      // —— ?= 是帮助里写明的同义写法
      say('问号等号同义', '“Hello World” ?= “Hello”'),
      // —— 变量操作数 + 各种上下文
      '甲 ＝ “abcdef”',
      '乙 ＝ “abc”',
      say('变量操作数', '甲 ≈ 乙'),
      say('整体括号', '(甲 ≈ 乙)'),
      say('与且混排', '(甲 ≈ 乙) 且 (“xyz” ≈ “x”)'),
      say('取反', '取反 (甲 ≈ “z”)'),
      '',
      '.如果 (甲 ≈ 乙)',
      '    标准输出 (0, “当条件=1” ＋ #换行符)',
      '.如果结束',
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败（≈ 曾经原样漏进 C++ 报 unexpected character <U+2248>）：\n${errs}`).toBe(true)

    const out = execFileSync(r.outputFile!, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
    const val = (label: string) => (out.split('\n').find(l => l.startsWith(`${label}=`)) || '').trim().slice(label.length + 1)

    expect(val('前缀命中'), '帮助：比较文本在被比较文本首部被包容 → 真').toBe('真')
    expect(val('前缀不中'), '“World” 不在 “Hello” 首部').toBe('假')
    expect(val('完全相同'), '全等也算「首部被包容」').toBe('真')
    expect(val('比较文本更长'), '比较文本比被比较文本长 → 不可能被包容').toBe('假')
    expect(val('空比较文本'), '空文本是任何文本的前缀').toBe('真')
    expect(val('中文前缀'), '按字符不按字节').toBe('真')

    expect(val('大小写敏感'), '帮助没说忽略大小写，krnln_like 也不忽略——这条钉住「≈ 不是模糊匹配」（已由易语言实测证实）').toBe('假')
    expect(val('不做全半角归一'), '半角 123 与全角 １２３ 不相等（已由易语言实测证实）').toBe('假')
    expect(val('非前缀不算近似'), 'abd 不是 abc 的前缀（差一个字符也不算近似）').toBe('假')

    expect(val('命令形态对照'), '运算符与 近似等于(a,b) 必须完全同义').toBe(val('前缀命中'))
    expect(val('问号等号同义'), '帮助：运算符号为「?=」或「≈」').toBe('真')

    expect(val('变量操作数'), '“abc” 是 “abcdef” 的前缀').toBe('真')
    expect(val('整体括号'), '整体带括号也要认').toBe('真')
    expect(val('与且混排'), '≈ 优先于 且').toBe('真')
    expect(val('取反'), '“z” 不是 “abcdef” 的前缀 → 取反为真').toBe('真')
    expect(out, '≈ 可直接当条件用').toContain('当条件=1')
  }, 240000)

  // 编辑器侧：?= 归一成 ≈ + 空格规范（同 <> → ≠、<= → ≤ 的既有约定）
  it('formatOps：?= 归一为 ≈，且不动字符串字面量里的 ?=', () => {
    expect(formatOps('甲?=乙'), '?= 是 ≈ 的同义写法').toBe('甲 ≈ 乙')
    expect(formatOps('甲≈乙'), '≈ 的空格规范同其它运算符').toBe('甲 ≈ 乙')
    expect(formatOps('甲 ≈ 乙'), '已规范的不该再变').toBe('甲 ≈ 乙')
    // 字面量内不得改写（formatOps 用占位符保护字符串，同 convertFullWidthOps 的教训）
    expect(formatOps('甲 ＝ “a?=b”'), '引号里的 ?= 是文本不是运算符').toBe('甲 ＝ “a?=b”')
  })
})
