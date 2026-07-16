// 【审计 A 类回归】ycmd 清单标「通用型」但 impl 实收数值的命令：通用映射会把实参转成文本指针，
// 传给收 double/long long 的实现——C 链接不校验签名故能编能链，运行时把指针当数值算（静默出错）。
// 修法：YCMD_NATIVE_PARAM_TYPE_OVERRIDES / RETURN_TYPE_OVERRIDES 按符号对齐；写出数据 则是 ycmd 元数据本身错。
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
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-sig-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})

describe('原生签名对齐（审计 A 类）', () => {
  it.skipIf(!zigAvailable)('相加/比较族/写出数据 的声明与 windows.cpp 实现一致，且可编译', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-sig-proj-'))
    writeFileSync(join(dir, 'p.epp'), ['# YiCode Project File', 'Version=1', 'ProjectName=sig', 'OutputType=WindowsApp', 'Platform=windows', '', 'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({ name: '_启动窗口', title: 'w', width: 300, height: 200, sourceFile: '_启动窗口.eyc', controls: [] }), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.eyc'), [
      '.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 __启动窗口_创建完毕',
      '.局部变量 n, 长整数型', '.局部变量 b, 逻辑型', '.局部变量 f, 整数型',
      'n ＝ 相加 (1, 2)',
      'b ＝ 等于 (1, 1)',
      'b ＝ 大于 (2, 1)',
      '写出数据 (f, “甲”, “乙”)',   // ycmd 补回「文件号」后：前导复用 + 尾参逐值
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'run' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)

    const gen = readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8')
    // 声明必须与 windows.cpp 的实现签名一致（此前是 int(const char*, const char*) → 指针当数值）
    expect(gen).toContain('extern "C" long long krnln_add(long long, long long);')
    expect(gen).toContain('extern "C" int krnln_equal(double, double);')
    expect(gen).toContain('extern "C" int krnln_greater(double, double);')
    expect(gen).toContain('extern "C" int krnln_write(int, const char*);')
    // 不得再把实参文本化后当数值传
    const addLine = gen.split('\n').find(l => l.includes('krnln_add(')) || ''
    expect(addLine, '相加 实参不应再经 yc_value_to_text 转成指针').not.toContain('yc_value_to_text')
    // 写出数据：文件号复用 + 两个值各发一次
    const wLine = gen.split('\n').find(l => l.includes('甲')) || ''
    expect((wLine.match(/krnln_write\(/g) || []).length, '写出数据 两个值应各发一次').toBe(2)
    rmSync(dir, { recursive: true, force: true })
  }, 120000)
})
