// Unicode 标识符（韩/日等做变量名）+ 未定义标识符友好报错回归。
//  - 未定义的裸标识符（如韩文 중국어의）→ 转译期友好中文报错（带 文件:行号），替代难懂的 C++ undeclared identifier；
//  - 声明的韩文变量可正常赋值/引用/传属性并编译通过（标识符正则已放宽到 CJK扩展A/谚文/假名）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []
const tmpDirs: string[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-uid-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })

function writeProject(dir: string, eycBody: string[]): void {
  writeFileSync(join(dir, 'p.epp'), ['# YiCode Project File', 'Version=1', 'ProjectName=Unicode标识符', 'OutputType=WindowsApp', 'Platform=windows', '', 'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', ''].join('\n'), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
    name: '_启动窗口', title: '窗口', width: 400, height: 300, sourceFile: '_启动窗口.eyc',
    controls: [{ id: 'c1', type: '标签', name: '标签1', left: 10, top: 10, width: 120, height: 24, text: '', visible: true, enabled: true, properties: {} }],
  }), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 _按钮1_被单击', ...eycBody, ''].join('\n'), 'utf-8')
}

describe('Unicode 标识符 + 未定义标识符友好报错', () => {
  // 友好报错在转译期抛，但 compileProject 会先校验 Zig 工具链——无 zig 时拿到的是「找不到 Zig 编译器」
  // 而非转译期错误，故与其它真编译用例一样 zig-gate（CI 无 zig 跳过；本机有 zig 验证）。
  it.skipIf(!zigAvailable)('未定义标识符（韩文 중국어의）→ 友好中文报错，非 C++ undeclared identifier', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-uid-neg-')); tmpDirs.push(dir)
    writeProject(dir, ['.局部变量 a, 文本型', 'a ＝ 중국어의', '标签1.标题 ＝ a'])
    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    expect(result.success).toBe(false)
    const err = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(err).toContain('未定义的变量或标识符')
    expect(err).toContain('중국어의')
    expect(err).toContain('_启动窗口.eyc:')          // 带 文件:行号 定位
    expect(err.toLowerCase()).not.toContain('undeclared identifier')
  }, 60000)

  it.skipIf(!zigAvailable)('声明的韩文变量可赋值/运算/传属性并编译通过', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-uid-pos-')); tmpDirs.push(dir)
    writeProject(dir, [
      '.局部变量 변수, 整数型',
      '변수 ＝ 5',
      '변수 ＝ 변수 ＋ 1',   // 韩文变量作赋值目标 + 加法运算数（放宽后的正则须识别）
      '标签1.宽度 ＝ 변수',  // 韩文变量作数值属性值
    ])
    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, `编译失败：\n${errs}`).toBe(true)
    const gen = readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8')
    expect(gen).toContain('변수')  // 韩文标识符原样进 C++（未被丢弃/误判）
    expect(gen).toContain('krnln_ctrl_set_number(')  // 标签1.宽度 ＝ 변수 走数值属性 set
  }, 120000)
})
