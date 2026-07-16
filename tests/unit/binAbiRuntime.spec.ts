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
})
