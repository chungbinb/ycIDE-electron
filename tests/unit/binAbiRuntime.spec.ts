// 【字节集 ABI v2 · 运行时】真编译控制台 exe、真跑、读 stdout。
//
// 旧 ABI：字节集跨 krnln 边界一律 const char*，长度靠 NUL 结尾（yc_bin_to_cstr 返回 c_str()、
// yc_cstr_to_bin/krnln_BinLen 按 strlen 算）——可字节集本就是任意二进制，含 0x00 即整条截断。
// 于是「取空白字节集」返回空、「文本到UTF16」把 4 字节截成 1、「读入/写到文件」处理不了二进制文件。
// 新 ABI：入参 const YC_BIN*、返回堆上 new YC_BIN（yc_bin_take 接管），长度完整。
//
// 这些断言全是**旧实现必错、新实现才对**的：不真跑就证明不了（C 链接不校验签名，
// 声明/实现错位既不报编译错也不报链接错，只在运行时静默出错）。
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

describe('字节集 ABI v2 · 运行时', () => {
  it.skipIf(!zigAvailable)('0 字节不再截断：取空白字节集/文本到UTF16/文件往返/分割字节集(默认字节0)/置字节集内整数', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-binabi-'))
    const binFile = join(dir, 'probe.bin').replace(/\\/g, '\\\\')
    const say = (label: string, expr: string[]) =>
      `标准输出 (0, “${label}=” ${expr.map(e => `＋ ${e}`).join(' ')} ＋ #换行符)`
    writeFileSync(join(dir, 'p.epp'), ['ProjectName=字节集ABI', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '程序.eyc'), [
      '.版本 2', '.程序集 程序集1', '',
      '.子程序 _启动子程序',
      '.局部变量 b, 字节集',
      '.局部变量 d, 字节集, , "0"',
      '',
      // ① 取空白字节集：n 个 0 字节。旧 ABI 下 strlen 立刻得 0 → 永远是空字节集
      'b ＝ 取空白字节集 (5)',
      say('取空白字节集', ['到文本 (取字节集长度 (b))']),
      // ② 字节集连接（YC_BIN 此前连 operator+ 都没有，这行直接编不过）
      'b ＝ 到字节集 (“A”) ＋ 取空白字节集 (3) ＋ 到字节集 (“B”)',
      say('连接含0字节', ['到文本 (取字节集长度 (b))']),
      // ③ 文本到UTF16：帮助说含结束零字符。“A”→ 41 00 00 00 共 4 字节；
      //    旧 ABI 下 UTF-16 的高位 0 字节让 strlen 只数出 1
      say('文本到UTF16', ['到文本 (取字节集长度 (文本到UTF16 (“A”)))']),
      'b ＝ 文本到UTF16 (“甲乙”)',
      say('UTF16往返', ['UTF16到文本 (b)', '“/”', '到文本 (取字节集长度 (b))']),
      // ④ 文件往返：写 5 字节(含 3 个 0)再读回。旧 ABI 写出时 strlen 截成 1 字节
      '写到文件 (“' + binFile + '”, 到字节集 (“A”) ＋ 取空白字节集 (3) ＋ 到字节集 (“B”))',
      'b ＝ 读入文件 (“' + binFile + '”)',
      say('文件往返', ['到文本 (取字节集长度 (b))']),
      // ⑤ 分割字节集 省略分隔符 → 默认按字节 0 分。上一轮实现了却喂不进料，现在能测了
      'd ＝ 分割字节集 (到字节集 (“甲”) ＋ 取空白字节集 (1) ＋ 到字节集 (“乙”))',
      say('默认分隔字节0', ['到文本 (取数组成员数 (d))']),
      // ⑥ 置字节集内整数：就地改写（binref 绑到变量本身）。旧法写进 yc_bin_to_cstr 的临时槽 → 空操作
      'b ＝ 取空白字节集 (8)',
      '置字节集内整数 (b, 0, 305419896, 假)',
      say('置字节集内整数', ['到文本 (取字节集内整数 (b, 0, 假))']),
      // ⑦ 字节集操作族在含 0 字节的数据上也要对
      'b ＝ 到字节集 (“A”) ＋ 取空白字节集 (2) ＋ 到字节集 (“BC”)',
      say('取字节集右边', ['到文本 (取字节集长度 (取字节集右边 (b, 3)))']),
      say('寻找字节集', ['到文本 (寻找字节集 (b, 到字节集 (“BC”), 1))']),
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)

    const out = execFileSync(r.outputFile, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
    const val = (label: string) => (out.split('\n').find(l => l.startsWith(`${label}=`)) || '').trim().slice(label.length + 1)

    expect(val('取空白字节集'), '5 个 0 字节（旧 ABI 下 strlen 立刻得 0）').toBe('5')
    expect(val('连接含0字节'), '"A"+3个0+"B" = 5 字节（YC_BIN 此前没有 operator+，编都编不过）').toBe('5')
    expect(val('文本到UTF16'), '“A” → 41 00 00 00（含结束零字符）= 4 字节，旧 ABI 只数出 1').toBe('4')
    expect(val('UTF16往返'), 'UTF16 往返不丢字；“甲乙”+结束零 = 3 个 wchar = 6 字节').toBe('甲乙/6')
    expect(val('文件往返'), '写 5 字节(含 3 个 0)再读回仍是 5（旧 ABI 写出时截成 1）').toBe('5')
    expect(val('默认分隔字节0'), '省略分隔符按字节 0 分 → 2 段（上一轮实现了但造不出 0 字节数据）').toBe('2')
    expect(val('置字节集内整数'), '就地改写生效（旧法写进临时副本 → 恒为 0）').toBe('305419896')
    expect(val('取字节集右边'), '含 0 字节的数据上取右边 3 字节').toBe('3')
    expect(val('寻找字节集'), '“BC” 在第 4 字节起（一基）').toBe('4')

    rmSync(dir, { recursive: true, force: true })
  }, 180000)

  // 【到字节集(数值) + 取字节集数据 · 用户字节集测试程序暴露的三处】
  // ① 到字节集(数值) 此前经通用编组先转文本再取字节——到字节集(到整数(123)) 给 "123" 的
  //    3 个 ASCII 字节而非 {123,0,0,0}。现按类型给二进制原始字节（yc_to_bin 重载分诊）。
  // ② 取字节集数据 的起始索引帮助明说从 1 开始（省略默认 1），实现此前按 0 基偏移。
  // ③ 到文本(小数型) 借道 double 的 %.15g 印出噪声位（3.14159 → 3.14159011840820）。
  it.skipIf(!zigAvailable)('到字节集(数值)按二进制原始字节；取字节集数据一基索引；小数型印字不带噪声位', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-tobin-'))
    const say = (label: string, expr: string[]) =>
      `标准输出 (0, “${label}=” ${expr.map(e => `＋ ${e}`).join(' ')} ＋ #换行符)`
    writeFileSync(join(dir, 'p.epp'), ['ProjectName=到字节集类型', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '程序.eyc'), [
      '.版本 2', '.程序集 程序集1', '',
      '.子程序 _启动子程序',
      '.局部变量 b, 字节集',
      '.局部变量 长整数变量, 长整数型',
      '.局部变量 小数变量, 小数型',
      '',
      // —— 各类型的二进制字节数（此前全是文本 ASCII 字节数）
      say('整数字节数', ['到文本 (取字节集长度 (到字节集 (到整数 (123))))']),
      say('短整数字节数', ['到文本 (取字节集长度 (到字节集 (到短整数 (456))))']),
      say('字节字节数', ['到文本 (取字节集长度 (到字节集 (到字节 (78))))']),
      say('字面量字节数', ['到文本 (取字节集长度 (到字节集 (123)))']),          // 整数字面量按整数型 4 字节（生成侧 LL 后缀要拨回）
      say('文本字节数', ['到文本 (取字节集长度 (到字节集 (“甲A”)))']),          // 文本仍 UTF-8：3+1
      // —— 取字节集数据：一基索引读回拼接数据（4+2+1 字节布局）
      'b ＝ 到字节集 (到整数 (123)) ＋ 到字节集 (到短整数 (456)) ＋ 到字节集 (到字节 (78))',
      say('组合长度', ['到文本 (取字节集长度 (b))']),
      say('取整数', ['到文本 (取字节集数据 (b, #整数型, 1))']),
      say('取短整数', ['到文本 (取字节集数据 (b, #短整数型, 5))']),
      say('取字节', ['到文本 (取字节集数据 (b, #字节型, 7))']),
      say('省略位置', ['到文本 (取字节集数据 (b, #整数型))']),                  // 帮助：省略默认 1
      // —— 8 字节整数经 取变量地址→指针到字节集→取字节集数据 完整往返（用户测试 14 场景）
      '长整数变量 ＝ 9876543210',
      say('长整数读回', ['到文本 (取字节集数据 (指针到字节集 (取变量地址 (长整数变量), 8), #长整数型, 1))']),
      // —— 小数型印字：float 只有 ~7 位有效数字
      '小数变量 ＝ 3.14159',
      say('小数印字', ['到文本 (小数变量)']),
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)

    const out = execFileSync(r.outputFile, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
    const val = (label: string) => (out.split('\n').find(l => l.startsWith(`${label}=`)) || '').trim().slice(label.length + 1)

    expect(val('整数字节数'), '整数型 → 4 字节（此前 "123" 文本给 3）').toBe('4')
    expect(val('短整数字节数'), '短整数型 → 2 字节').toBe('2')
    expect(val('字节字节数'), '字节型 → 1 字节').toBe('1')
    expect(val('字面量字节数'), '整数字面量按整数型 4 字节').toBe('4')
    expect(val('文本字节数'), '文本仍 UTF-8（甲=3 + A=1）').toBe('4')
    expect(val('组合长度'), '4+2+1').toBe('7')
    expect(val('取整数'), '一基位置 1 读 int').toBe('123')
    expect(val('取短整数'), '一基位置 5 读 short').toBe('456')
    expect(val('取字节'), '一基位置 7 读 byte').toBe('78')
    expect(val('省略位置'), '省略默认位置 1').toBe('123')
    expect(val('长整数读回'), '取变量地址→指针到字节集→取字节集数据 完整往返').toBe('9876543210')
    expect(val('小数印字'), 'float 按 ~7 位有效数字印，不带 double 噪声位').toBe('3.14159')

    rmSync(dir, { recursive: true, force: true })
  }, 180000)
})
