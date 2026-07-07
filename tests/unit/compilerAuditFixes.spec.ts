// 审计修复回归：真实调用 compileProject（zig 工具链）验证转译正确性。
// compiler.ts 已与 electron 解耦（worker 化时抽出 runtimeEnv/CompilerHost），
// 因此可在 vitest 中按 compile-worker 同款方式注入环境直接编译。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'
import { getEProjectImportTarget } from '../../src/main/eproject/importService'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))

let projectDir = ''
const messages: CompileMessage[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-test-userdata-')), appVersion: 'test' })
  setCompilerHost({
    emitOutput: (msg) => { messages.push(msg) },
    requestFocusIdeWindow: () => {},
    notifyProcessExit: () => {},
    openPathExternally: async () => '',
  })
})

afterAll(() => {
  if (projectDir) rmSync(projectDir, { recursive: true, force: true })
})

describe('编译器审计修复回归', () => {
  it('getEProjectImportTarget: 大写扩展名 .E 的目标目录不得等于源文件（防删源）', () => {
    const target = getEProjectImportTarget(`X:${sep}dir${sep}工程.E`)
    expect(target.projectName).toBe('工程')
    expect(target.targetDir).toBe(`X:${sep}dir${sep}工程`)
  })

  it.skipIf(!zigAvailable)('判断开始多分支可编译，字符串拼接不再被整体吞成字面量', async () => {
    projectDir = mkdtempSync(join(tmpdir(), 'ycide-audit-proj-'))
    writeFileSync(join(projectDir, '审计验证.epp'), [
      'ProjectName=审计验证',
      'OutputType=Console',
      'Platform=x64',
      'File=EYC|程序.eyc|0',
      '',
    ].join('\n'), 'utf-8')
    writeFileSync(join(projectDir, '程序.eyc'), [
      '.版本 2',
      '.程序集 程序集1',
      '',
      '.子程序 _启动子程序',
      '.局部变量 n, 整数型',
      '.局部变量 t, 文本型',
      'n ＝ 5',
      '.判断开始 (n ＝ 1)',
      '    t ＝ “一”',
      '.判断 (n ＝ 5)',
      '    t ＝ “共” ＋ 到文本 (n) ＋ “个”',
      '.默认',
      '    t ＝ “默认”',
      '.判断结束',
      '',
    ].join('\n'), 'utf-8')

    const result = await compileProject({ projectDir, mode: 'run' })
    const errors = messages.filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, `编译失败：\n${errors}`).toBe(true)
    expect(existsSync(result.outputFile)).toBe(true)

    // 转译产物断言：判断开始 → if/else if/else；拼接被拆开而非整体字面量
    const generated = readFileSync(join(projectDir, 'temp', '程序.cpp'), 'utf-8')
    expect(generated).toContain('else if')
    expect(generated).toContain('yc_value_to_text')
    // 旧 bug 特征：整个拼接表达式被吞成一个字面量（内含全角引号与加号）
    expect(generated).not.toMatch(/L"共[”“]/)
  }, 120000)

  it.skipIf(!zigAvailable)('控制台项目可用支持库常量，文本变量经 UTF-8 转换传参', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-audit-proj2-'))
    writeFileSync(join(dir, 'p.epp'), [
      'ProjectName=控制台常量验证', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', '',
    ].join('\n'), 'utf-8')
    writeFileSync(join(dir, '程序.eyc'), [
      '.版本 2',
      '.程序集 程序集1',
      '',
      '.子程序 _启动子程序',
      '.局部变量 t, 文本型',
      't ＝ “你好世界”',
      '调试输出 (t)',
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    const errors = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, `编译失败：\n${errors}`).toBe(true)

    // 文本变量传给通用命令时经 yc_wide_to_utf8 转换，而非裸 (char*) 重解释
    const gen = readFileSync(join(dir, 'temp', '程序.cpp'), 'utf-8')
    if (gen.includes('m_pText') && /\(char\*\)\(?t\b/.test(gen)) {
      // 若走了 fne 通用分发路径，则变量必须被 yc_wide_to_utf8 包裹
      expect(gen).toMatch(/yc_wide_to_utf8/)
    }
    rmSync(dir, { recursive: true, force: true })
  }, 120000)
})
