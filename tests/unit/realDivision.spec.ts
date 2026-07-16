// 【相除 ÷ 恒双精度 · 运行时】用户对拍易语言时发现 `局_整数1 ÷ 局_整数2`（20 ÷ 7）得 2 而非
// 2.857142857143——÷(相除) 与 ＼(整除) 此前都被 convertFullWidthOps 映射成 C 的 /，两个整数
// 操作数下 C 的 / 就是截断除法，小数部分整个丢掉。易语言里 ÷ 恒返回双精度小数，＼ 才是整数商。
//
// 这里真编译一个控制台程序、真跑、读 stdout：codegen 断言只能证明「生成成了双精度形态」，
// 证明不了优先级/结合性/一元负号这些拆分器上的坑，那些只有跑起来才现形。
// ＼ 与 ％ 的断言是**反向钉子**：修 ÷ 不许把整除和求余一起带偏。
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
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-div-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})
// 刚跑完的 exe 可能还占着目录，删不掉不该让测试失败
afterAll(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 占用中，交给系统清理 */ } } })

const say = (label: string, expr: string[]) =>
  `标准输出 (0, “${label}=” ${expr.map(e => `＋ ${e}`).join(' ')} ＋ #换行符)`

describe('相除 ÷ 恒双精度', () => {
  it.skipIf(!zigAvailable)('÷ 得小数、＼ 与 ％ 不受影响，优先级/结合性/一元负号都对', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-div-')); tmpDirs.push(dir)
    writeFileSync(join(dir, 'p.epp'), ['ProjectName=相除', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '程序.eyc'), [
      '.版本 2', '.程序集 程序集1', '',
      '.子程序 _启动子程序',
      '.局部变量 i1, 整数型',
      '.局部变量 i2, 整数型',
      '.局部变量 d, 双精度小数型',
      '',
      'i1 ＝ 20',
      'i2 ＝ 7',
      'd ＝ i1 ÷ i2',
      say('整数变量相除', ['到文本 (d)']),
      'd ＝ 20 ÷ 7',
      say('整数字面量相除', ['到文本 (d)']),
      'd ＝ (i1 ÷ i2)',                       // 整体括号：括号内此前**原样**落进 C++，不剥就漏哨兵
      say('括号相除', ['到文本 (d)']),
      'd ＝ 100 ÷ i1 ÷ 2',                    // 左结合：(100÷20)÷2，不是 100÷(20÷2)
      say('连除', ['到文本 (d)']),
      'd ＝ 1 ＋ 20 ÷ 8',                     // ÷ 优先于 ＋
      say('加与除', ['到文本 (d)']),
      'd ＝ 20 ÷ (2 ＋ 3)',
      say('除以括号', ['到文本 (d)']),
      'd ＝ 20 ÷ －8',                        // 右操作数一元负号：不许被加减拆分器切成 (20÷) - 8
      say('除以负数', ['到文本 (d)']),
      'd ＝ 30 × 3.14159265358979 ÷ 180',     // × 与 ÷ 混排
      say('角度转弧度', ['到文本 (d)']),
      'd ＝ 20 ÷ 4',                          // 除得尽 → 到文本 仍印整数形态
      say('除尽', ['到文本 (d)']),
      // —— 反向钉子：÷ 改双精度不许动了整除与求余
      'd ＝ i1 ＼ i2',
      say('整除', ['到文本 (d)']),
      'd ＝ i1 ％ i2',
      say('求余', ['到文本 (d)']),
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)

    const gen = readFileSync(join(dir, 'temp', '程序.cpp'), 'utf-8')
    // ÷ 与 ＼ 必须生成得不一样——此前两者都是 (i1 / i2)，是这个 bug 的根
    expect(gen, '÷ 应生成双精度除法').toContain('((double)(i1) / (double)(i2))')
    expect(gen, '＼ 整除应保持 C 的截断除法').toContain('d = (i1 / i2);')
    // 哨兵是私用区字符，绝不许漏进 C++
    expect(gen, 'REAL_DIV_MARK 哨兵漏进生成代码了').not.toContain('\uE000')

    const out = execFileSync(r.outputFile, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
    const val = (label: string) => (out.split('\n').find(l => l.startsWith(`${label}=`)) || '').trim().slice(label.length + 1)

    expect(val('整数变量相除'), '20 ÷ 7 恒双精度（此前截断成 2）').toBe('2.85714285714286')
    expect(val('整数字面量相除'), '字面量同理').toBe('2.85714285714286')
    expect(val('括号相除'), '(20 ÷ 7) 整体带括号也要走双精度').toBe('2.85714285714286')
    expect(val('连除'), '左结合：(100÷20)÷2 = 2.5，右结合会得 10').toBe('2.5')
    expect(val('加与除'), '1 ＋ 20÷8 = 1+2.5；此前 20÷8 截断成 2 得 3').toBe('3.5')
    expect(val('除以括号'), '20 ÷ (2＋3)').toBe('4')
    expect(val('除以负数'), '20 ÷ －8 = -2.5').toBe('-2.5')
    expect(val('角度转弧度'), '30 × pi ÷ 180 = pi/6；此前 ÷180 截断成 0').toBe('0.523598775598298')
    expect(val('除尽'), '除得尽时 到文本 印整数形态').toBe('5')
    expect(val('整除'), '＼ 是截断整数商——不许被 ÷ 的修改带偏').toBe('2')
    expect(val('求余'), '％ 求余数——不许被 ÷ 的修改带偏').toBe('6')
  }, 180000)

  // 整体括号剥离的副产品。此前「整体被一层括号包住」的表达式会绕过所有翻译原样落进 C++：
  // 全角引号漏出去编不过、字面量拿不到 LL 后缀、文本拼接不走 yc_text_concat。
  it.skipIf(!zigAvailable)('整体被括号包住的表达式也会被递归翻译', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-paren-')); tmpDirs.push(dir)
    writeFileSync(join(dir, 'p.epp'), ['ProjectName=括号', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '程序.eyc'), [
      '.版本 2', '.程序集 程序集1', '',
      '.子程序 _启动子程序',
      '.局部变量 t, 文本型',
      '.局部变量 d, 双精度小数型',
      '',
      't ＝ (“甲” ＋ “乙”)',                   // 此前：全角引号原样漏进 C++ → 编译失败
      say('括号文本拼接', ['t']),
      'd ＝ (20 ＋ 7) × 2',                    // 此前：(20 + 7) 原样，字面量没 LL 后缀
      say('括号加法', ['到文本 (d)']),
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)

    const gen = readFileSync(join(dir, 'temp', '程序.cpp'), 'utf-8')
    // 只看赋值那一行：整文件还含运行时前导里合法的全角引号（中文提示串），不能整篇扫
    const assignLine = gen.split('\n').find(l => /^\/\*@\d+\*\/\s+t = /.test(l)) || ''
    expect(assignLine, '括号里的全角引号必须已被翻译成 L"…"，不能原样漏进 C++').not.toMatch(/[“”]/)
    expect(assignLine, '括号里的文本拼接要走 yc_text_concat').toContain('yc_text_concat(L"甲", L"乙")')

    const out = execFileSync(r.outputFile, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
    const val = (label: string) => (out.split('\n').find(l => l.startsWith(`${label}=`)) || '').trim().slice(label.length + 1)

    expect(val('括号文本拼接'), '(“甲” ＋ “乙”) 此前根本编不过').toBe('甲乙')
    expect(val('括号加法'), '(20 ＋ 7) × 2').toBe('54')
  }, 180000)

  // convertFullWidthOps 此前对整串无脑 replace，连字符串字面量里的全角运算符一起改：
  // 用户打印 `“20 ＋ 7 ＝ 27”` 会得到 `20 + 7 == 27`（对拍易语言时一眼可见）。
  // ÷ 改走哨兵后这条更致命——`“ ÷ ”` 会被打成 REAL_DIV_MARK 那个看不见的私用区字符。
  it.skipIf(!zigAvailable)('字符串字面量里的全角运算符原样打印，不当运算符改写', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-litop-')); tmpDirs.push(dir)
    writeFileSync(join(dir, 'p.epp'), ['ProjectName=字面量', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '程序.eyc'), [
      '.版本 2', '.程序集 程序集1', '',
      '.子程序 _启动子程序',
      '.局部变量 n, 整数型',
      '',
      'n ＝ 27',
      // 拼接式：字面量在左、真运算在右——两者的全角符号必须分别对待
      say('对拍行', ['“20 ＋ 7 ＝ ” ＋ 到文本 (n)']),
      say('除号', ['“10 ÷ 2 与 20 ＼ 7”']),
      say('比较符', ['“a ＝ b、c ＜ d、e ≥ f、g ≠ h”']),
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)

    const out = execFileSync(r.outputFile, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
    const val = (label: string) => (out.split('\n').find(l => l.startsWith(`${label}=`)) || '').trim().slice(label.length + 1)

    expect(val('对拍行'), '引号里的 ＋ 与 ＝ 是文本，此前被打成 `20 + 7 == 27`').toBe('20 ＋ 7 ＝ 27')
    expect(val('除号'), '引号里的 ÷ 不许变成哨兵字符或 /').toBe('10 ÷ 2 与 20 ＼ 7')
    expect(val('比较符'), '引号里的比较符同样原样').toBe('a ＝ b、c ＜ d、e ≥ f、g ≠ h')
  }, 180000)
})
