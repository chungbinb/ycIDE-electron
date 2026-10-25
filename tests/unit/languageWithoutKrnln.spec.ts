// 设计稿 §6.11 / §13.1 第 8 条（方案 A）：流程控制、基本数据类型、声明结构、运算符与字面量属于语言本身，
// 停用核心支持库 krnln 后照样能编译运行。只用这些特性写一个控制台程序（经 DLL 命令——声明结构也属于语言——
// 调用 ExitProcess 把计算结果作为退出码带出来），停用 krnln 后编译并核对结果。
// 窗口程序与核心库命令（信息框、标准输出……）属于 krnln，停用后不可用，编译给出明确提示。
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync } from 'fs'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'
import { libraryManager } from '../../src/main/libraryManager'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []
beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-lang-ud-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})

function writeProject(dir: string, outputType: string, programLines: string[]): void {
  writeFileSync(join(dir, 'p.epp'), ['ProjectName=语言', `OutputType=${outputType}`, 'Platform=x64', 'File=EYC|程序.eyc|0', 'File=ELL|DLL命令.ell|0', 'File=EDT|数据类型.edt|0', ''].join('\n'), 'utf-8')
  writeFileSync(join(dir, 'DLL命令.ell'), ['.版本 2', '', '.DLL命令 退出进程, , "kernel32.dll", "ExitProcess"', '    .参数 退出码, 整数型', ''].join('\r\n'), 'utf-8')
  writeFileSync(join(dir, '数据类型.edt'), ['.版本 2', '', '.数据类型 坐标', '    .成员 横, 整数型', '    .成员 纵, 整数型', ''].join('\r\n'), 'utf-8')
  writeFileSync(join(dir, '程序.eyc'), ['.版本 2', '.程序集 程序集1', '', ...programLines, ''].join('\r\n'), 'utf-8')
}

async function compileWithoutKrnln(dir: string): Promise<{ success: boolean; outputFile: string; errors: string }> {
  libraryManager.setDisabledLibraries(['krnln'])
  try {
    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'compile' })
    return { success: r.success, outputFile: r.outputFile, errors: messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n') }
  } finally {
    libraryManager.setDisabledLibraries([])
  }
}

describe('停用核心支持库后的语言本身（方案 A）', () => {
  it.skipIf(!zigAvailable)('流程控制、基本类型、数组、字节集、日期时间、自定义数据类型、子程序与 DLL 命令照常编译运行', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-lang-'))
    writeProject(dir, 'Console', [
      '.子程序 _启动子程序, 整数型',
      '.局部变量 i, 整数型', '.局部变量 总数, 整数型', '.局部变量 字串, 文本型', '.局部变量 序列, 整数型, , "3"', '.局部变量 小数值, 双精度小数型',
      '.局部变量 真假, 逻辑型', '.局部变量 数据, 字节集', '.局部变量 某日, 日期时间型', '.局部变量 坐标点, 坐标',
      '字串 ＝ “甲” ＋ “乙”',
      '.计次循环首 (3, i)', '    序列 [i] ＝ i × 2', '    总数 ＝ 总数 ＋ 序列 [i]', '.计次循环尾 ()',
      '小数值 ＝ 7 ÷ 2',
      '真假 ＝ 字串 ＝ “甲乙”',
      '.如果 (真假 且 小数值 ＞ 3)', '    总数 ＝ 总数 ＋ 100', '.否则', '    总数 ＝ 总数 ＋ 1000', '.如果结束',
      '.判断循环首 (总数 ＜ 200)', '    总数 ＝ 总数 ＋ 50', '.判断循环尾 ()',
      '数据 ＝ { 1, 2, 3 } ＋ { 4 }',
      '.如果真 (数据 [4] ＝ 4 且 数据 [1] ＝ 1)', '    总数 ＝ 总数 ＋ 1', '.如果真结束',
      '某日 ＝ [2024年1月2日]',
      '.如果真 (某日 ＞ [2023年12月31日])', '    总数 ＝ 总数 ＋ 2', '.如果真结束',
      '坐标点.横 ＝ 3', '坐标点.纵 ＝ 4',
      '总数 ＝ 总数 ＋ 求总数 (坐标点.横, 坐标点.纵)',
      '退出进程 (总数)',
      '返回 (总数)',
      '',
      '.子程序 求总数, 整数型', '.参数 甲, 整数型', '.参数 乙, 整数型', '返回 (甲 ＋ 乙)',
    ])
    const r = await compileWithoutKrnln(dir)
    expect(r.success, `编译失败：\n${r.errors}`).toBe(true)
    // 2+4+6 → 12；真假且 3.5>3 → +100；循环到 ≥200 → 212；字节集 +1；日期 +2；3+4 → 222
    expect(spawnSync(r.outputFile, [], { timeout: 20000 }).status).toBe(222)
  }, 240000)

  it.skipIf(!zigAvailable)('用到核心库命令时编译失败并指出原因', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-lang-'))
    writeProject(dir, 'Console', ['.子程序 _启动子程序, 整数型', '标准输出 (0, “你好”)', '返回 (0)'])
    const r = await compileWithoutKrnln(dir)
    expect(r.success).toBe(false)
    expect(r.errors).toMatch(/标准输出/)
  }, 240000)
})
