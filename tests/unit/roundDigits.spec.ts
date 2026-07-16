// 【四舍五入 的「被舍入的位置」· 运行时】用户对拍易语言时 四舍五入(3.14159, 2) 得 3 而非 3.14。
// 不是精度问题：krnln_round 此前签名是 (double value, ...)，第二参数被声明成变参后**整个忽略**，
// 实现只有 std::round(value)，于是任何位置参数都等价于舍入到整数。
// （转译侧生成的声明一直是 (double, int)、实参也一直在传，只是被调用方丢了。）
// 断言逐条对齐帮助文件的示例：1056.65→(1)1056.7 /(0)1057 /(-1)1060，以及省略参数默认为 0。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs'
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
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-round-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})
// 刚跑完的 exe 可能还占着目录，删不掉不该让测试失败
afterAll(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 占用中，交给系统清理 */ } } })

describe('四舍五入 的被舍入位置', () => {
  it.skipIf(!zigAvailable)('位置参数真的生效，且省略时默认为 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-round-')); tmpDirs.push(dir)
    const say = (label: string, expr: string) =>
      `标准输出 (0, “${label}=” ＋ 到文本 (${expr}) ＋ #换行符)`
    writeFileSync(join(dir, 'p.epp'), ['ProjectName=四舍五入', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '程序.eyc'), [
      '.版本 2', '.程序集 程序集1', '',
      '.子程序 _启动子程序',
      '',
      say('保留2位', '四舍五入 (3.14159, 2)'),        // 此前恒得 3
      say('保留4位', '四舍五入 (3.14159, 4)'),
      say('舍到整数', '四舍五入 (3.14159, 0)'),
      say('省略位置', '四舍五入 (3.14159)'),          // 帮助：省略则默认为 0
      say('进位', '四舍五入 (2.5, 0)'),
      say('负数', '四舍五入 (-3.567, 1)'),
      say('右边一位', '四舍五入 (1056.65, 1)'),       // 帮助示例 → 1056.7
      say('左边一位', '四舍五入 (1056.65, -1)'),      // 帮助示例：舍到小数点左边第 1 位 → 1060
      say('左边两位', '四舍五入 (1056.65, -2)'),
      say('位数极大', '四舍五入 (3.14159, 400)'),     // 缩放会溢出 inf → 原值
      say('位数极小', '四舍五入 (3.14159, -400)'),    // 缩放会趋 0 → 0
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)

    const out = execFileSync(r.outputFile, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
    const val = (label: string) => (out.split('\n').find(l => l.startsWith(`${label}=`)) || '').trim().slice(label.length + 1)

    expect(val('保留2位'), '位置参数此前被忽略，恒返回 3').toBe('3.14')
    expect(val('保留4位'), '保留小数点右边 4 位').toBe('3.1416')
    expect(val('舍到整数'), '位置 0 = 舍入到整数').toBe('3')
    expect(val('省略位置'), '帮助：省略本参数则默认为 0').toBe('3')
    expect(val('进位'), '.5 远离零方向进位').toBe('3')
    expect(val('负数'), '负数同样按绝对值远离零进位').toBe('-3.6')
    // 1056.65 的 double 实际是 1056.65000000000009…（在 tie 之上），×10 得整 10566.5，
    // std::round 远离零 → 10567 → 1056.7，与帮助示例一致
    expect(val('右边一位'), '帮助示例：四舍五入(1056.65, 1) → 1056.7').toBe('1056.7')
    expect(val('左边一位'), '帮助示例：四舍五入(1056.65, -1) → 1060').toBe('1060')
    expect(val('左边两位'), '舍到小数点左边第 2 位').toBe('1100')
    expect(val('位数极大'), '10^400 溢出成 inf，不该得 nan').toBe('3.14159')
    expect(val('位数极小'), '10^-400 趋 0，不该得 nan').toBe('0')
  }, 180000)
})
