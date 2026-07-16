// 【审计 C 类回归】日期时间型 = OLE 自动化日期（double）。mapTypeToCType 曾漏收该类型 →
// 掉进默认 'int'，与 krnln impl 的 double 形参/返回错位：传参把 double 当 int、取返回值读错寄存器
// （取现行时间 必拿垃圾）。C 链接不校验签名故一直能编能链、只在运行时静默出错。
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-dt-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})

describe('日期时间型 ABI（审计 C 类）', () => {
  it.skipIf(!zigAvailable)('日期时间型 按 double 收发：变量/声明/调用与 impl 一致，且可编译', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-dt-proj-'))
    writeFileSync(join(dir, 'p.epp'), ['# YiCode Project File', 'Version=1', 'ProjectName=dt', 'OutputType=WindowsApp', 'Platform=windows', '', 'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({ name: '_启动窗口', title: 'w', width: 300, height: 200, sourceFile: '_启动窗口.eyc', controls: [] }), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.eyc'), [
      '.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 __启动窗口_创建完毕',
      '.局部变量 t, 日期时间型', '.局部变量 t2, 日期时间型', '.局部变量 n, 整数型', '.局部变量 d, 双精度小数型',
      't ＝ 取现行时间 ()',
      'n ＝ 取年份 (t)',
      'n ＝ 取月份 (t)',
      't2 ＝ 增减时间 (t, 1, 3)',
      'd ＝ 取时间间隔 (t, t2, 1)',
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'run' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)

    const gen = readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8')
    // 声明必须与 windows.cpp 实现一致（此前全是 int）
    expect(gen).toContain('extern "C" double krnln_now();')
    expect(gen).toContain('extern "C" int krnln_year(double);')
    expect(gen).toContain('extern "C" int krnln_month(double);')
    expect(gen).toContain('extern "C" double krnln_TimeChg(double, int, int);')
    expect(gen).toContain('extern "C" double krnln_TimeDiff(double, double, int);')
    // 日期时间型 变量本身也该是 double（此前 int 连日期都装不下）
    expect(gen).toMatch(/double\s+t\s*=/)
    expect(gen).not.toMatch(/\bint\s+t\s*=/)
    rmSync(dir, { recursive: true, force: true })
  }, 120000)
})
