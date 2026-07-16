// 【逻辑比较 · 运行时】用户拿逻辑比较测试对拍易语言，暴露两个 bug（断言值全部取自易语言实测输出）：
//
// ① 到文本(逻辑型) 印「1」/「0」，易语言印「真」/「假」。
//    根因：逻辑型 与 整数型 在 C++ 里同为 int，yc_value_to_text 的重载分不开，只能一律印数字。
//    修法：拆出 mapTypeToVarCType（用户代码侧：逻辑型 → C++ bool），配 yc_value_to_text(bool) 重载
//    → 变量／子程序返回／命令返回／比较表达式全部由**重载解析**自动分诊，不必逐处特判。
//    mapTypeToCType 保持 int 不动——那是原生 ABI 侧（krnln_and(int,int)），换 bool 会字节错位。
//
// ② 文本型的 ＜＞≤≥ 是**指针比较**。比较分支此前只放行 == 与 !=，其余四个落到裸 C 的
//    `(left op right)`——YC_TEXT 有 operator const wchar_t*()，于是比的是两个**地址**。
//    症状不是「按数值比了」，而是随栈布局变的垃圾：曾出现 `“10” ≤ “10”` 为假、同时
//    `“10” ≥ “10”` 为真这种自相矛盾。易语言的文本比较是字典序（yc_text_compare = lstrcmpW）。
//
// 顺带修：yc_text_compare / yc_text_starts_with 的定义原本被关在 isWindowsApp 分支里，而声明是
// 无条件发的——控制台工程只要写文本比较就链接失败「未定义符号: yc_text_compare」。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
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
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-lg-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})
afterAll(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 占用中，交给系统清理 */ } } })

describe('逻辑比较', () => {
  it.skipIf(!zigAvailable)('文本比较按字典序、逻辑型到文本印真假——逐行对齐易语言实测', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-lg-')); tmpDirs.push(dir)
    // 照用户写法：先算进 局_结果（逻辑型）再 到文本(局_结果)
    const via = (label: string, expr: string) => [
      `局_结果 ＝ ${expr}`,
      `标准输出 (0, “${label}=” ＋ 到文本 (局_结果) ＋ #换行符)`,
    ]
    const direct = (label: string, expr: string) => `标准输出 (0, “${label}=” ＋ 到文本 (${expr}) ＋ #换行符)`
    writeFileSync(join(dir, 'p.epp'), ['ProjectName=逻辑比较', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '程序.eyc'), [
      '.版本 2', '.程序集 程序集1', '',
      '.子程序 _启动子程序',
      '.局部变量 局_文本1, 文本型', '.局部变量 局_文本2, 文本型', '.局部变量 局_文本3, 文本型',
      '.局部变量 局_数值1, 整数型', '.局部变量 局_数值2, 整数型',
      '.局部变量 局_逻辑1, 逻辑型', '.局部变量 局_逻辑2, 逻辑型', '.局部变量 局_结果, 逻辑型',
      '',
      '局_文本1 ＝ “10”', '局_文本2 ＝ “5”', '局_文本3 ＝ “10”',
      '局_数值1 ＝ 10', '局_数值2 ＝ 5',
      // —— 文本比较：字典序。“5” 的首字符 '5'(0x35) > “10” 的 '1'(0x31)，故 “5” > “10”，
      //    与数值大小**相反**——这正是这组用例的价值：数值比较会得反的结果，指针比较会得垃圾。
      ...via('等于_10_5', '局_文本1 ＝ 局_文本2'),
      ...via('等于_10_10', '局_文本1 ＝ 局_文本3'),
      ...via('不等于_10_5', '局_文本1 ≠ 局_文本2'),
      ...via('不等于_10_10', '局_文本1 ≠ 局_文本3'),
      ...via('小于_5_10', '局_文本2 ＜ 局_文本1'),
      ...via('小于_10_5', '局_文本1 ＜ 局_文本2'),
      ...via('大于_10_5', '局_文本1 ＞ 局_文本2'),
      ...via('大于_5_10', '局_文本2 ＞ 局_文本1'),
      ...via('小于等于_5_10', '局_文本2 ≤ 局_文本1'),
      ...via('小于等于_10_10', '局_文本1 ≤ 局_文本3'),
      ...via('大于等于_10_5', '局_文本1 ≥ 局_文本2'),
      ...via('大于等于_10_10', '局_文本1 ≥ 局_文本3'),
      // —— 逻辑运算
      '局_逻辑1 ＝ 真', '局_逻辑2 ＝ 真',
      ...via('且_真真', '局_逻辑1 且 局_逻辑2'),
      '局_逻辑2 ＝ 假',
      ...via('且_真假', '局_逻辑1 且 局_逻辑2'),
      ...via('或_真假', '局_逻辑1 或 局_逻辑2'),
      ...via('取反_真', '取反 (局_逻辑1)'),
      // —— 到文本 的两条路：逻辑型变量 / 比较表达式（后者 C++ 的 == 本就产出 bool）
      direct('到文本_逻辑变量真', '局_逻辑1'),
      direct('到文本_逻辑变量假', '局_逻辑2'),
      direct('到文本_数值比较', '局_数值1 ＝ 局_数值2'),
      direct('到文本_数值大于', '局_数值1 ＞ 局_数值2'),
      // —— 反向钉子：整数型绝不能被 逻辑型→bool 的改动带跑
      direct('整数型仍印数字', '局_数值1'),
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败（yc_text_compare 曾只在窗口工程里有定义）：\n${errs}`).toBe(true)

    const gen = readFileSync(join(dir, 'temp', '程序.cpp'), 'utf-8')
    expect(gen, '逻辑型变量应声明为 C++ bool（不是 int，否则重载分不开印不出真假）').toMatch(/bool 局_逻辑1 = false;/)
    expect(gen, '整数型仍是 int').toMatch(/int 局_数值1 = 0;/)
    expect(gen, '文本比较必须走 yc_text_compare，不能是裸的指针比较').not.toMatch(/\(局_文本1 [<>]=? 局_文本[23]\)/)

    const out = execFileSync(r.outputFile!, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
    const val = (l: string) => (out.split('\n').find(x => x.startsWith(`${l}=`)) || '').trim().slice(l.length + 1)

    // —— 全部取自易语言实测输出
    expect(val('等于_10_5'), '“10” ≠ “5”').toBe('假')
    expect(val('等于_10_10'), '“10” = “10”').toBe('真')
    expect(val('不等于_10_5')).toBe('真')
    expect(val('不等于_10_10')).toBe('假')
    // 这四条是核心：字典序下 “5” > “10”，与数值大小相反
    expect(val('小于_5_10'), '字典序：“5” 不小于 “10”（首字符 5>1）——按数值比会得「真」').toBe('假')
    expect(val('小于_10_5'), '字典序：“10” < “5”').toBe('真')
    expect(val('大于_10_5'), '字典序：“10” 不大于 “5”').toBe('假')
    expect(val('大于_5_10'), '字典序：“5” > “10”').toBe('真')
    expect(val('小于等于_5_10'), '字典序：“5” 不 ≤ “10”').toBe('假')
    expect(val('小于等于_10_10'), '相等则 ≤ 为真——指针比较时这条曾是「假」，且与下面的 ≥ 自相矛盾').toBe('真')
    expect(val('大于等于_10_5'), '字典序：“10” 不 ≥ “5”').toBe('假')
    expect(val('大于等于_10_10'), '相等则 ≥ 为真').toBe('真')

    expect(val('且_真真')).toBe('真')
    expect(val('且_真假')).toBe('假')
    expect(val('或_真假')).toBe('真')
    expect(val('取反_真')).toBe('假')

    expect(val('到文本_逻辑变量真'), '到文本(逻辑型) 印「真」不是「1」').toBe('真')
    expect(val('到文本_逻辑变量假')).toBe('假')
    expect(val('到文本_数值比较'), '比较表达式本身是逻辑型').toBe('假')
    expect(val('到文本_数值大于')).toBe('真')
    expect(val('整数型仍印数字'), '整数型 到文本 仍印数字——逻辑型改 bool 不许把它带跑').toBe('10')
  }, 240000)

  // 同一个文本比较，写在命令实参里也必须与写成赋值一样。
  // 此前 formatArgForC（23 个调用点）不传 variableTypeResolver → isTextRawOperand 认不出文本型 →
  // `到文本 (甲 ＝ 乙)` 退化成 YC_TEXT 的指针比较，而 `结果 ＝ 甲 ＝ 乙` 却是对的：
  // 同一份代码换个书写位置结论就变。现由 currentVariableTypeResolver 文件级兜底补上。
  it.skipIf(!zigAvailable)('命令实参里的文本比较与赋值形态结论一致', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-argcmp-')); tmpDirs.push(dir)
    writeFileSync(join(dir, 'p.epp'), ['# YiCode Project File', 'ProjectName=实参比较', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '程序.eyc'), [
      '.版本 2', '.程序集 程序集1', '',
      '.子程序 _启动子程序',
      '.局部变量 甲, 文本型', '.局部变量 乙, 文本型', '.局部变量 结果, 逻辑型',
      '',
      '甲 ＝ “10”', '乙 ＝ “10”',
      '结果 ＝ 甲 ＝ 乙',
      '标准输出 (0, “经变量=” ＋ 到文本 (结果) ＋ #换行符)',
      '标准输出 (0, “实参内相等=” ＋ 到文本 (甲 ＝ 乙) ＋ #换行符)',
      '标准输出 (0, “实参内小于=” ＋ 到文本 (甲 ＜ 乙) ＋ #换行符)',
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)

    const gen = readFileSync(join(dir, 'temp', '程序.cpp'), 'utf-8')
    expect(gen, '命令实参里的文本比较也必须走 yc_text_compare，不能留裸的 (甲 == 乙) 指针比较')
      .not.toMatch(/yc_value_to_text\(\(甲 [<>=]=? 乙\)\)/)

    const out = execFileSync(r.outputFile!, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
    const val = (l: string) => (out.split('\n').find(x => x.startsWith(`${l}=`)) || '').trim().slice(l.length + 1)

    expect(val('经变量'), '“10” = “10”').toBe('真')
    expect(val('实参内相等'), '同一个比较写在命令实参里也得是真——此前是指针比较得「假」').toBe(val('经变量'))
    expect(val('实参内小于'), '“10” 不小于 “10”').toBe('假')
  }, 240000)
})
