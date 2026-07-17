// 【到文本(字节集/日期时间型) + 寻找文件 · 运行时】真编译控制台 exe、真跑、读 stdout。
//
// 对照易语言实测输出修的三处（磁盘操作测试程序暴露）：
// ① 到文本(字节集) 此前落在调试形态 字节集:N{232,191,…}，易语言是把字节当文本解
//    （GBK；本 IDE 全程 UTF-8 故按 UTF-8 解，与 到字节集 互为往返）。调试输出 保留调试形态。
// ② 到文本(日期时间型) 此前印裸 OA 数字 46220.41…（日期时间型 与 双精度 在 C++ 里同为
//    double、重载分不开）。现变量侧引入 YC_DATE 强类型，印「2026年7月17日9时56分37秒」，
//    时刻全零只印日期（照易语言）。
// ③ 寻找文件 此前无迭代状态（句柄开完即关，续查恒空）也无属性过滤（0 也吐出「.」目录项）。
//    现支持 首参非空开新一轮/首参空续查，属性按「文件特殊属性 ⊆ 请求掩码」过滤：
//    0=只命中无特殊属性的普通文件（连存档都排除，易语言原版如此）、省略=除子目录外所有文件。
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'fs'
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

describe('到文本(字节集/日期时间) 与 寻找文件 · 运行时', () => {
  it.skipIf(!zigAvailable)('字节集按 UTF-8 解码、日期时间印中文格式、寻找文件可迭代且按属性过滤', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-dtd-'))
    // 寻找文件 的靶目录：两个普通文件（新写出的文件带存档属性）+ 一个子目录
    const fdDir = join(dir, 'fd')
    mkdirSync(join(fdDir, 'sub'), { recursive: true })
    writeFileSync(join(fdDir, 'a.txt'), 'a', 'utf-8')
    writeFileSync(join(fdDir, 'b.txt'), 'b', 'utf-8')

    const say = (label: string, expr: string[]) =>
      `标准输出 (0, “${label}=” ${expr.map(e => `＋ ${e}`).join(' ')} ＋ #换行符)`
    // 一轮完整迭代：首参非空开新一轮，续查首参留空
    const sweep = (label: string, attr: string) => [
      `汇总 ＝ “”`,
      `找到 ＝ 寻找文件 (“${fdDir}\\*.*”${attr})`,
      '.判断循环首 (找到 ≠ “”)',
      '    汇总 ＝ 汇总 ＋ 找到 ＋ “;”',
      `    找到 ＝ 寻找文件 (${attr ? `,${attr.slice(1)}` : ''})`,
      '.判断循环尾 ()',
      say(label, ['汇总']),
    ]
    writeFileSync(join(dir, 'p.epp'), ['ProjectName=磁盘文本日期', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '程序.eyc'), [
      '.版本 2', '.程序集 程序集1', '',
      '.子程序 _启动子程序',
      '.局部变量 t, 日期时间型',
      '.局部变量 b, 字节集',
      '.局部变量 找到, 文本型',
      '.局部变量 汇总, 文本型',
      '',
      // ① 到文本(字节集)：UTF-8 解码（旧行为印 字节集:N{…}）；调试输出 保留调试形态
      'b ＝ 到字节集 (“这是测试。第二行”)',
      say('解码', ['到文本 (b)']),
      say('字节数', ['到文本 (取字节集长度 (b))']),
      '调试输出 (到字节集 (“A”))',
      // ② 到文本(日期时间型)：中文日期格式；时刻全零只印日期；命令表达式直接嵌套也一样
      't ＝ 到时间 (“2026-07-17 09:56:37”)',
      say('日期时间', ['到文本 (t)']),
      't ＝ 到时间 (“2026-07-17”)',
      say('纯日期', ['到文本 (t)']),
      say('嵌套', ['到文本 (到时间 (“1999-12-31 23:59:59”))']),
      // ③ 寻找文件：存档(32)命中两个文件不含目录项；0 连存档都排除；省略=除子目录外所有；
      //    16+32 连目录一起（含 . 与 ..，与易语言一致，靠调用方自行跳过）
      ...sweep('归档', ', 32'),
      ...sweep('普通', ', 0'),
      ...sweep('省略', ''),
      ...sweep('含目录', ', 48'),
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)

    const out = execFileSync(r.outputFile, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
    const val = (label: string) => (out.split('\n').find(l => l.startsWith(`${label}=`)) || '').trim().slice(label.length + 1)

    expect(val('解码'), '到文本(字节集) 按 UTF-8 解码为原文（旧行为是 字节集:N{…} 数字串）').toBe('这是测试。第二行')
    expect(val('字节数'), '8 个汉字标点 × 3 字节').toBe('24')
    expect(out, '调试输出 的字节集仍是调试形态').toContain('字节集:1{65}')
    expect(val('日期时间'), '到文本(日期时间型) 印中文日期格式').toBe('2026年7月17日9时56分37秒')
    expect(val('纯日期'), '时刻全零只印日期部分').toBe('2026年7月17日')
    expect(val('嵌套'), '命令返回值直接嵌套 到文本 也走 YC_DATE 重载').toBe('1999年12月31日23时59分59秒')
    expect(val('归档'), '属性 32：两个新写出的文件（带存档属性），目录项不掺入').toBe('a.txt;b.txt;')
    expect(val('普通'), '属性 0：连存档文件都排除（易语言原版如此）→ 空').toBe('')
    expect(val('省略'), '省略属性：除子目录外的所有文件').toBe('a.txt;b.txt;')
    expect(val('含目录'), '16+32：目录连同 . 与 .. 一起返回（调用方自行跳过）').toBe('.;..;a.txt;b.txt;sub;')

    rmSync(dir, { recursive: true, force: true })
  }, 180000)
})
