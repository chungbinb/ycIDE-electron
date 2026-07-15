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
})
