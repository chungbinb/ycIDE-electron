// 【数值到大写 / 数值到金额】中文数字转换。用户对比测试发现原为占位实现（只拼前缀+原数字）。
// 期望值取自**易语言实机输出**（用户提供的对照）；帮助说明：参数二 假=繁体大写、真=简体。
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
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-cn-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})
afterAll(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 占用中 */ } } })

const say = (label: string, expr: string) => `标准输出 (0, “${label}=” ＋ ${expr} ＋ #换行符)`

async function runConsole(lines: string[]): Promise<(label: string) => string> {
  const dir = mkdtempSync(join(tmpdir(), 'ycide-cn-'))
  tmpDirs.push(dir)
  writeFileSync(join(dir, 'p.epp'), ['ProjectName=中文数字', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
  writeFileSync(join(dir, '程序.eyc'), ['.版本 2', '.程序集 程序集1', '', '.子程序 _启动子程序', ...lines, ''].join('\n'), 'utf-8')
  const before = messages.length
  const r = await compileProject({ projectDir: dir, mode: 'build' })
  const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
  expect(r.success, `编译失败：\n${errs}`).toBe(true)
  const out = execFileSync(r.outputFile!, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
  return (label: string) => (out.split('\n').find(l => l.startsWith(`${label}=`)) || '').trim().slice(label.length + 1)
}

describe('数值到大写 / 数值到金额', () => {
  it.skipIf(!zigAvailable)('与易语言实机输出一致（繁体/简体、整数/小数、元角分）', async () => {
    const val = await runConsole([
      say('大写繁体', '数值到大写 (12345.67, 假)'),
      say('大写简体', '数值到大写 (123, 真)'),
      say('金额繁体', '数值到金额 (12345.67, 假)'),
      say('金额整', '数值到金额 (100, 假)'),
      say('金额零角', '数值到金额 (100.05, 假)'),
      say('大写零', '数值到大写 (0, 假)'),
      say('大写含零节', '数值到大写 (10001, 假)'),
      say('简体十几', '数值到大写 (15, 真)'),
    ])
    // 用户提供的易语言对照
    expect(val('大写繁体'), '易语言: 壹万贰仟叁佰肆拾伍点陆柒').toBe('壹万贰仟叁佰肆拾伍点陆柒')
    expect(val('大写简体'), '易语言: 一百二十三').toBe('一百二十三')
    expect(val('金额繁体'), '易语言: 壹万贰仟叁佰肆拾伍元陆角柒分').toBe('壹万贰仟叁佰肆拾伍元陆角柒分')
    // 常规金额规则
    expect(val('金额整')).toBe('壹佰元整')
    expect(val('金额零角')).toBe('壹佰元零伍分')
    expect(val('大写零')).toBe('零')
    expect(val('大写含零节'), '万位后补零').toBe('壹万零壹')
    expect(val('简体十几'), '简体口语「十五」而非「一十五」').toBe('十五')
  }, 180000)
})
