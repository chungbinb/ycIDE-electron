// 【数组返回 ABI · 运行时】真编译一个控制台程序、真跑起来、读它的 stdout。
// codegen 断言（arrayReturnCommands.spec.ts）只能证明「生成对了」；这里证明 impl 的语义真对：
// 跨 TU 传 std::vector<long long>*、文本元素的宽串指针位模式、yc_ary_take 的接管，全靠这条兜底。
// 逐条对齐帮助文件：空文本→空数组、分隔符省略→半角空格、显式空文本→整段不分、数目 n→末段含余下全文。
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
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

describe('数组返回 ABI · 运行时', () => {
  it.skipIf(!zigAvailable)('分割文本 的运行结果逐条对齐帮助文件语义', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-aryrt-'))
    // 输出方向 0=stdout（1 是 stderr，见 krnln_fputs）；收尾用支持库常量 #换行符
    //（.eyc 的文本字面量里 \n 是字面的反斜杠+n，不是换行）
    const say = (label: string, expr: string[]) =>
      `标准输出 (0, “${label}=” ${expr.map(e => `＋ ${e}`).join(' ')} ＋ #换行符)`
    writeFileSync(join(dir, 'p.epp'), ['ProjectName=数组返回运行时', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '程序.eyc'), [
      '.版本 2', '.程序集 程序集1', '',
      '.子程序 _启动子程序',
      '.局部变量 a, 文本型, , "0"',
      '',
      'a ＝ 分割文本 (“甲,乙,丙”, “,”)',
      say('普通', ['到文本 (取数组成员数 (a))', '“|”', 'a [1]', '“/”', 'a [2]', '“/”', 'a [3]']),
      'a ＝ 分割文本 (“甲,乙,丙”)',                    // 省略分隔符 → 默认半角逗号
      say('省略分隔符', ['到文本 (取数组成员数 (a))', '“|”', 'a [1]', '“/”', 'a [3]']),
      'a ＝ 分割文本 (“甲乙丙”, “”)',                  // 显式空文本 → 整段作唯一成员
      say('显式空分隔符', ['到文本 (取数组成员数 (a))', '“|”', 'a [1]']),
      'a ＝ 分割文本 (“”, “,”)',                       // 空文本 → 空数组
      say('空文本', ['到文本 (取数组成员数 (a))']),
      'a ＝ 分割文本 (“甲,乙,丙,丁”, “,”, 2)',          // 限 2 段 → 末段是余下全文
      say('限2段', ['到文本 (取数组成员数 (a))', '“|”', 'a [1]', '“/”', 'a [2]']),
      'a ＝ 分割文本 (“甲--乙--丙”, “--”)',             // 多字符分隔符
      say('多字符分隔', ['到文本 (取数组成员数 (a))', '“|”', 'a [2]']),
      '复制数组 (a, 分割文本 (“x,y”, “,”))',            // 帮助里的规范用法：经 yc_ary_tmp 轮转槽
      say('复制数组', ['到文本 (取数组成员数 (a))', '“|”', 'a [1]', '“/”', 'a [2]']),
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)

    const out = execFileSync(r.outputFile, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
    const val = (label: string) => (out.split('\n').find(l => l.startsWith(`${label}=`)) || '').trim().slice(label.length + 1)

    expect(val('普通'), '“甲,乙,丙”按“,”分 → 3 段').toBe('3|甲/乙/丙')
    expect(val('省略分隔符'), '省略 → 默认半角逗号分割（不是整段不分）').toBe('3|甲/丙')
    expect(val('显式空分隔符'), '显式空文本 → 不分割，整段作唯一成员').toBe('1|甲乙丙')
    expect(val('空文本'), '空文本 → 空数组（0 个成员）').toBe('0')
    expect(val('限2段'), '限 2 段 → 末段含余下全文（含其中的分隔符）').toBe('2|甲/乙,丙,丁')
    expect(val('多字符分隔'), '分隔符可多字符').toBe('3|乙')
    expect(val('复制数组'), '复制数组(目标, 分割文本(…)) 走临时槽也要拿到真数据').toBe('2|x/y')

    rmSync(dir, { recursive: true, force: true })
  }, 180000)

  // 字节集数组（元素存储的第 4 类 bin：堆上 YC_BIN 的指针位模式，同文本型的路子）。
  // 顺带钉住两个此前**根本编译不过**的写法：加入成员到文本数组、文本数组[i] ＝ 值
  //（原为 `(intptr_t)yc_value_to_text(...)`，C 风格转换不肯把 YC_TEXT 连着经
  //  operator const wchar_t*() 再转 intptr_t → no matching conversion）。
  it.skipIf(!zigAvailable)('字节集数组可用；文本数组的 加入成员/下标赋值 也终于能编能跑', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-binrt-'))
    const say = (label: string, expr: string[]) =>
      `标准输出 (0, “${label}=” ${expr.map(e => `＋ ${e}`).join(' ')} ＋ #换行符)`
    writeFileSync(join(dir, 'p.epp'), ['ProjectName=字节集数组运行时', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '程序.eyc'), [
      '.版本 2', '.程序集 程序集1', '',
      '.子程序 _启动子程序',
      '.局部变量 b, 字节集, , "0"',
      '.局部变量 t, 文本型, , "0"',
      '',
      // —— 字节集数组变量：加入成员 / 下标读 / 成员数（到文本(字节集) 给的是 字节集:N{…} 形态）
      '加入成员 (b, 到字节集 (“A”))',
      '加入成员 (b, 到字节集 (“BC”))',
      say('字节集数组', ['到文本 (取数组成员数 (b))', '“|”', '到文本 (b [1])', '“/”', '到文本 (b [2])']),
      // —— 分割字节集：显式分隔符（省略分隔符=按字节 0 分那条实现了但喂不进料——见下方注释）
      'b ＝ 分割字节集 (到字节集 (“A,B,C”), 到字节集 (“,”))',
      say('显式分隔', ['到文本 (取数组成员数 (b))', '“|”', '到文本 (b [1])', '“/”', '到文本 (b [3])']),
      // —— 文本数组：加入成员 + 下标赋值（此前两条都编不过）
      '加入成员 (t, “甲”)',
      '加入成员 (t, “乙”)',
      't [2] ＝ “丙”',
      say('文本数组', ['到文本 (取数组成员数 (t))', '“|”', 't [1]', '“/”', 't [2]']),
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)

    const out = execFileSync(r.outputFile, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
    const val = (label: string) => (out.split('\n').find(l => l.startsWith(`${label}=`)) || '').trim().slice(label.length + 1)

    expect(val('字节集数组'), '加入成员到字节集数组 → 元素各自独立、读回原值').toBe('2|字节集:1{65}/字节集:2{66,67}')
    expect(val('显式分隔'), '分割字节集 显式分隔符').toBe('3|字节集:1{65}/字节集:1{67}')
    expect(val('文本数组'), '加入成员 + 下标赋值（此前都编不过）').toBe('2|甲/丙')

    rmSync(dir, { recursive: true, force: true })
  }, 180000)

  // 「拼音处理」五条共用 impl/pinyin-table.inc（6763 个国标汉字，由 pinyin-pro 生成）。
  // 此前五条全是桩：取发音数目 恒返回 1、取拼音/取声母/取韵母 返回写死的 "PY"/"SM"/"YM"。
  it.skipIf(!zigAvailable)('拼音处理五条命令的运行结果对齐帮助语义', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-pyrt-'))
    const say = (label: string, expr: string[]) =>
      `标准输出 (0, “${label}=” ${expr.map(e => `＋ ${e}`).join(' ')} ＋ #换行符)`
    writeFileSync(join(dir, 'p.epp'), ['ProjectName=拼音运行时', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '程序.eyc'), [
      '.版本 2', '.程序集 程序集1', '',
      '.子程序 _启动子程序',
      '.局部变量 a, 文本型, , "0"',
      '',
      'a ＝ 取所有发音 (“行”)',                        // 多音字：xing(常用音在首)/hang/heng
      say('多音字', ['到文本 (取数组成员数 (a))', '“|”', 'a [1]', '“/”', 'a [2]', '“/”', 'a [3]']),
      'a ＝ 取所有发音 (“中”)',                        // 单音字
      say('单音字', ['到文本 (取数组成员数 (a))', '“|”', 'a [1]']),
      'a ＝ 取所有发音 (“A”)',                         // 非汉字 → 空数组
      say('非汉字', ['到文本 (取数组成员数 (a))']),
      'a ＝ 取所有发音 (“行走”)',                      // 帮助：只取首字
      say('只取首字', ['到文本 (取数组成员数 (a))', '“|”', 'a [1]']),
      say('取发音数目', ['到文本 (取发音数目 (“长”))', '“/”', '到文本 (取发音数目 (“中”))', '“/”', '到文本 (取发音数目 (“A”))']),
      say('取拼音', ['取拼音 (“长”, 1)', '“/”', '取拼音 (“长”, 2)', '“/[”', '取拼音 (“长”, 9)', '“]”']),  // 索引越界 → 空文本
      say('取声母', ['取声母 (“重”, 1)', '“/”', '取声母 (“行”, 2)', '“/[”', '取声母 (“一”, 1)', '“]”']),   // 一=yi 零声母 → 空
      say('取韵母', ['取韵母 (“重”, 1)', '“/”', '取韵母 (“行”, 2)', '“/”', '取韵母 (“一”, 1)']),
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)

    const out = execFileSync(r.outputFile, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
    const val = (label: string) => (out.split('\n').find(l => l.startsWith(`${label}=`)) || '').trim().slice(label.length + 1)

    expect(val('多音字'), '行 → 三个音，常用音 xing 在首（帮助：第一个发音为常用音）').toBe('3|xing/hang/heng')
    expect(val('单音字'), '中 → 单音').toBe('1|zhong')
    expect(val('非汉字'), '非国标汉字 → 成员数目为 0 的空数组').toBe('0')
    expect(val('只取首字'), '帮助：只取用文本首部的第一个汉字').toBe('3|xing')
    expect(val('取发音数目'), '长=2 中=1 非汉字=0（此前桩恒返回 1）').toBe('2/1/0')
    expect(val('取拼音'), '一基索引；越界 → 空文本').toBe('chang/zhang/[]')
    expect(val('取声母'), 'zh 要先于 z 匹配；一=yi 是零声母 → 空文本').toBe('zh/h/[]')
    expect(val('取韵母'), '声母之后的部分；零声母则整串').toBe('ong/ang/yi')

    rmSync(dir, { recursive: true, force: true })
  }, 180000)
})
