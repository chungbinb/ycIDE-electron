// 代码中设置控件「文本颜色」+ 颜色字面量（#hex / #名色 / rgb() / rgba()）回归。
// 真实 compileProject 编译一个含 标签/编辑框/月历 的窗口项目，验证：
//  - 控件.文本颜色 ＝ 颜色 译成声明式 yc_ctrl_set_text_color（{v} 原始数值，非 {vtext}）；
//  - #ff0000 与 #红色 均折成十进制 COLORREF 255、#00ff00 折成 65280、rgb() 发 RGB 宏；
//  - 颜色字面量是通用整数（可存变量再赋值）；
//  - main.cpp 有覆盖表 g_ycTextColorOverride / helper / 月历 MCM_SETCOLOR 派发 / WM_CTLCOLOR 注入；
//  - 整体编译通过（无 undeclared identifier，证明 #→整数、RGB、helper 链接均成立）。
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
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-tc-userdata-')), appVersion: 'test' })
  setCompilerHost({
    emitOutput: (msg) => { messages.push(msg) },
    requestFocusIdeWindow: () => {},
    notifyProcessExit: () => {},
    openPathExternally: async () => '',
  })
})

afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
})

function writeProject(dir: string, controls: unknown[], eycBody: string[]): void {
  writeFileSync(join(dir, 'p.epp'), [
    '# YiCode Project File', 'Version=1', 'ProjectName=文本颜色验证',
    'OutputType=WindowsApp', 'Platform=windows', '',
    'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', '',
  ].join('\n'), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
    name: '_启动窗口', title: '窗口', width: 400, height: 320, sourceFile: '_启动窗口.eyc', controls,
  }), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.eyc'), [
    '.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 __启动窗口_创建完毕', ...eycBody, '',
  ].join('\n'), 'utf-8')
}

describe('代码中设置文本颜色 + 颜色字面量', () => {
  it.skipIf(!zigAvailable)('#hex / rgb() / #名色 / rgba 通用整数 → yc_ctrl_set_text_color 并可编译', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-textcolor-'))
    tmpDirs.push(dir)
    writeProject(dir, [
      { id: 'c1', type: '标签', name: '标签1', left: 10, top: 10, width: 120, height: 24, text: '文本', visible: true, enabled: true, properties: {} },
      { id: 'c2', type: '编辑框', name: '编辑框1', left: 10, top: 40, width: 160, height: 24, text: '', visible: true, enabled: true, properties: {} },
      { id: 'c3', type: '月历', name: '月历1', left: 10, top: 80, width: 220, height: 180, text: '', visible: true, enabled: true, properties: {} },
    ], [
      '.局部变量 c, 整数型',
      '标签1.文本颜色 ＝ #ff0000',
      '标签1.文本颜色 ＝ rgb (0, 255, 0)',
      '标签1.文本颜色 ＝ #红色',
      'c ＝ rgba (1, 2, 3, 128)',   // 通用整数用法 + rgba 丢 alpha
      '编辑框1.文本颜色 ＝ c',
      '月历1.文本颜色 ＝ #00ff00',
    ])

    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    const errors = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, `编译失败：\n${errors}`).toBe(true)

    const gen = readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8')
    expect(gen).toContain('yc_ctrl_set_text_color(')       // 声明式 set 派发
    expect(gen).toContain('(COLORREF)(255LL)')             // #ff0000 与 #红色 同折成 255
    expect(gen).toContain('RGB(')                          // rgb() → RGB 宏
    expect(gen).toContain('(COLORREF)(65280LL)')           // #00ff00 → 65280（月历也走此 setter）
    expect(gen).toContain('yc_get_control_handle_by_name(L"标签1")')

    const mainGen = readFileSync(join(dir, 'temp', 'main.cpp'), 'utf-8')
    expect(mainGen).toContain('g_ycTextColorOverride')     // 运行时覆盖表
    expect(mainGen).toContain('void yc_ctrl_set_text_color(HWND')  // helper 定义
    expect(mainGen).toContain('MCM_SETCOLOR,MCSC_TEXT')    // 月历派发
    expect(mainGen).toContain('_hasOv')                    // WM_CTLCOLOR 注入
  }, 180000)

  it.skipIf(!zigAvailable)('无文本颜色属性的控件（进度条）代码赋值仍友好报错', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-textcolor-neg-'))
    tmpDirs.push(dir)
    writeProject(dir, [
      { id: 'c1', type: '进度条', name: '进度条1', left: 10, top: 10, width: 200, height: 24, text: '', visible: true, enabled: true, properties: {} },
    ], ['进度条1.文本颜色 ＝ #红色'])

    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    expect(result.success).toBe(false)
    const err = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(err).toContain('暂不支持在代码中赋值')
  }, 120000)
})
