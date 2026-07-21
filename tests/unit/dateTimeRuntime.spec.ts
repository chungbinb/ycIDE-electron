// 【时间族】用户 ycIDE↔易语言对比测试暴露：impl 用了内部自定义枚举（1年2月3日4周几5时6分7秒），
// 而易语言时间部分常量是 1年份/2季度/3月份/4周/5日/6小时/7分钟/8秒/9星期几/10自年首天数——
// 漏了季度与周，从「日」起整体偏移 2 位，导致 增减时间/取时间间隔/取时间部分 全线错位。
// 另修：取时间间隔符号反了（时间2-时间1）、时间到文本默认应为中文形态、取星期几基准（星期日=1）。
// 期望值取自**易语言实机输出**（用户提供的对照）。
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
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-dt-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})
afterAll(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 占用中 */ } } })

const say = (label: string, expr: string) => `标准输出 (0, “${label}=” ＋ ${expr} ＋ #换行符)`

async function runConsole(lines: string[]): Promise<(label: string) => string> {
  const dir = mkdtempSync(join(tmpdir(), 'ycide-dt-'))
  tmpDirs.push(dir)
  writeFileSync(join(dir, 'p.epp'), ['ProjectName=时间族', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
  writeFileSync(join(dir, '程序.eyc'), ['.版本 2', '.程序集 程序集1', '', '.子程序 _启动子程序', '.局部变量 t, 日期时间型', '.局部变量 t2, 日期时间型', ...lines, ''].join('\n'), 'utf-8')
  const before = messages.length
  const r = await compileProject({ projectDir: dir, mode: 'build' })
  const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
  expect(r.success, `编译失败：\n${errs}`).toBe(true)
  const out = execFileSync(r.outputFile!, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
  return (label: string) => (out.split('\n').find(l => l.startsWith(`${label}=`)) || '').trim().slice(label.length + 1)
}

describe('时间族与易语言一致', () => {
  it.skipIf(!zigAvailable)('增减时间/取时间间隔/取时间部分 按易语言时间常量分派', async () => {
    const val = await runConsole([
      't ＝ 到时间 (“2026-07-20 14:30:45”)',
      // 取时间部分：常量 1年份 3月份 5日 6小时 7分钟 8秒 9星期几（旧实现从「日」起偏移 2）
      say('年份', '到文本 (取时间部分 (t, #年份))'),
      say('月份', '到文本 (取时间部分 (t, #月份))'),
      say('日', '到文本 (取时间部分 (t, #日))'),
      say('小时', '到文本 (取时间部分 (t, #小时))'),
      say('分钟', '到文本 (取时间部分 (t, #分钟))'),
      say('秒', '到文本 (取时间部分 (t, #秒))'),
      say('星期几', '到文本 (取星期几 (t))'),
      say('取秒函数', '到文本 (取秒 (t))'),
      // 时间到文本默认：中文形态
      say('时间到文本', '时间到文本 (t, )'),
      // 增减时间：#日 加天、#小时 加小时
      't2 ＝ 增减时间 (到时间 (“2026-07-20 00:00:00”), #日, 3)',
      say('加3天', '到文本 (t2)'),
      't2 ＝ 增减时间 (到时间 (“2026-07-20 10:00:00”), #小时, 2)',
      say('加2小时', '到文本 (t2)'),
      // 取时间间隔：时间1-时间2（旧实现符号反了）
      say('间隔天', '到文本 (取时间间隔 (到时间 (“2026-07-25 00:00:00”), 到时间 (“2026-07-20 00:00:00”), #日))'),
      say('间隔秒', '到文本 (取时间间隔 (到时间 (“2026-07-20 00:00:10”), 到时间 (“2026-07-20 00:00:00”), #秒))'),
      // 组合：2026 全年天数（用户对照用例）
      say('全年天数', '到文本 (取时间间隔 (指定时间 (2026, 12, 31, 0, 0, 0), 指定时间 (2026, 1, 1, 0, 0, 0), #日) ＋ 1)'),
      say('圣诞星期', '到文本 (取星期几 (指定时间 (2026, 12, 25, 8, 15, 30)))'),
    ])
    // 易语言对照
    expect(val('年份')).toBe('2026')
    expect(val('月份'), '易语言: 7').toBe('7')
    expect(val('日'), '易语言: 20').toBe('20')
    expect(val('小时'), '易语言: 14').toBe('14')
    expect(val('分钟'), '易语言: 30').toBe('30')
    expect(val('秒'), '易语言: 45').toBe('45')
    expect(val('星期几'), '易语言: 2（2026-07-20 星期一，星期日=1）').toBe('2')
    expect(val('取秒函数')).toBe('45')
    expect(val('时间到文本'), '易语言默认中文形态').toBe('2026年7月20日14时30分45秒')
    expect(val('加3天'), '易语言: 2026年7月23日').toContain('2026年7月23日')
    expect(val('加2小时'), '易语言: …12时').toContain('12时')
    expect(val('间隔天'), '易语言: 5（时间1-时间2）').toBe('5')
    expect(val('间隔秒'), '易语言: 10').toBe('10')
    expect(val('全年天数'), '易语言: 365').toBe('365')
    expect(val('圣诞星期'), '易语言: 6（2026-12-25 星期五）').toBe('6')
  }, 180000)
})
