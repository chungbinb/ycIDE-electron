// 通用对话框（CommonDlg，功能窗口组件/非可视）：「打开」方法 + 属性读写的声明式派发与运行时状态。
// 用户场景：.如果真 (打开文件通用对话框.打开 ()) → 读 打开文件通用对话框.文件名 打开/读入文件。
// 此前编译报「通用对话框“××”的方法“打开”暂不支持在代码中调用」。
// 对话框本体是模态 UI 无法无头驱动，测试覆盖：①编译派发+链接（方法/属性两上下文）；
// ②运行时状态表回读（设计期属性灌入 + 代码 set/get 往返，不弹对话框）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { execFileSync } from 'child_process'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-cdlg-userdata-')), appVersion: 'test' })
  setCompilerHost({
    emitOutput: (msg) => { messages.push(msg) },
    requestFocusIdeWindow: () => {},
    notifyProcessExit: () => {},
    openPathExternally: async () => '',
  })
})

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function mkProj(eycLines: string[], dlgProps: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'ycide-commdlg-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'p.epp'), [
    '# YiCode Project File', 'Version=1', 'ProjectName=通用对话框验证',
    'OutputType=WindowsApp', 'Platform=windows', '',
    'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', '',
  ].join('\n'), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
    name: '_启动窗口', title: '窗口', width: 400, height: 300, sourceFile: '_启动窗口.eyc',
    controls: [
      { id: 'c1', type: '按钮', name: '打开文件按钮', left: 10, top: 10, width: 90, height: 28, text: '打开', visible: true, enabled: true, properties: {} },
      { id: 'c2', type: '编辑框', name: '显示文件编辑框', left: 10, top: 50, width: 300, height: 120, text: '', visible: true, enabled: true, properties: {} },
      { id: 'c3', type: '通用对话框', name: '打开文件通用对话框', left: 10, top: 200, width: 32, height: 32, text: '', visible: true, enabled: true, properties: dlgProps },
    ],
  }), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '.程序集 窗口程序集_启动窗口', '', ...eycLines, ''].join('\n'), 'utf-8')
  return dir
}

describe('通用对话框（打开方法 + 属性声明式派发）', () => {
  it.skipIf(!zigAvailable)('用户场景：打开() 当条件 + 文件名读 + 属性写，编译链接通过', async () => {
    // 与用户报错项目同构：打开() 直接当 .如果真 条件、文件名 作命令实参
    const dir = mkProj([
      '.子程序 _打开文件按钮_被单击, , , ',
      '.局部变量 文件号, 整数型',
      '.局部变量 n, 整数型',
      '',
      '.如果真 (打开文件通用对话框.打开 ())',
      '    文件号 ＝ 打开文件 (打开文件通用对话框.文件名, , )',
      '    信息框 (“文件号为：” ＋ 到文本 (文件号), #信息图标, “文件号”)',
      '    显示文件编辑框.内容 ＝ 读入文本 (文件号, )',
      '    关闭文件 (文件号)',
      '.如果真结束',
      '打开文件通用对话框.类型 ＝ 1',
      '打开文件通用对话框.文件名 ＝ “默认.txt”',
      '打开文件通用对话框.过滤器 ＝ “文本文件（*.txt）|*.txt”',
      'n ＝ 打开文件通用对话框.初始过滤器',
    ], { '类型': 0, '过滤器': '所有文件（*.*）|*.*', '文件必须存在': true, '标题': '请选择文件' })

    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    const errors = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, `编译失败：\n${errors}`).toBe(true)
    expect(existsSync(result.outputFile)).toBe(true)

    const gen = readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8')
    expect(gen).toContain('krnln_commdlg_open(L"打开文件通用对话框")')       // 打开() 方法（条件上下文）
    expect(gen).toContain('yc_commdlg_get_text(L"打开文件通用对话框", 2)')   // 文件名 读（命令实参上下文）
    expect(gen).toContain('krnln_commdlg_set_int(L"打开文件通用对话框", 0')  // 类型 写
    expect(gen).toContain('krnln_commdlg_set_text(L"打开文件通用对话框", 2') // 文件名 写
    expect(gen).toContain('krnln_commdlg_get_int(L"打开文件通用对话框", 4)') // 初始过滤器 读

    // 设计期属性灌入：main.cpp 在窗口创建期把设计器里改过默认值的属性写进库状态表
    const mainCpp = readFileSync(join(dir, 'temp', 'main.cpp'), 'utf-8')
    expect(mainCpp).toContain('krnln_commdlg_set_text(L"打开文件通用对话框", 3, L"所有文件（*.*）|*.*")')  // 过滤器
    expect(mainCpp).toContain('krnln_commdlg_set_text(L"打开文件通用对话框", 1, L"请选择文件")')            // 标题
    expect(mainCpp).toContain('krnln_commdlg_set_int(L"打开文件通用对话框", 8, 1)')                          // 文件必须存在=真（默认假→发）
    // 类型=0 与默认一致 → 不发多余调用
    expect(mainCpp).not.toContain('krnln_commdlg_set_int(L"打开文件通用对话框", 0,')
    // 非可视组件不创建窗口
    expect(mainCpp).not.toMatch(/CreateWindowExW\([^\n]*打开文件通用对话框/)
  }, 120000)

  it.skipIf(!zigAvailable)('运行时状态表：设计期属性灌入 + 代码写后读回往返（不弹对话框）', async () => {
    const dir = mkProj([
      '.子程序 __启动窗口_创建完毕, , , ',
      '调试输出 (打开文件通用对话框.过滤器)',          // 设计期灌入的值
      '调试输出 (到文本 (打开文件通用对话框.文件必须存在))',
      '打开文件通用对话框.文件名 ＝ “abc.txt”',
      '调试输出 (打开文件通用对话框.文件名)',          // 代码写后读回
      '打开文件通用对话框.初始过滤器 ＝ 2',
      '调试输出 (到文本 (打开文件通用对话框.初始过滤器))',
      '.结束 ()',  // 流程语句 ExitProcess(0)（无点/带点已同义，回归见 flowCommandForms.spec.ts）
    ], { '过滤器': '文本文件（*.txt）|*.txt', '文件必须存在': true })

    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    const errors = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, `编译失败：\n${errors}`).toBe(true)

    const out = execFileSync(result.outputFile!, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
    expect(out).toContain('文本文件（*.txt）|*.txt')  // 设计期 → 库状态表 → 读回
    // 逻辑型属性经 krnln_commdlg_get_int 返回整数（与 可视/选中 等既有控件逻辑属性一致），到文本 印 1
    expect(out).toContain('“1”')                       // 文件必须存在=真 → 1
    expect(out).toContain('abc.txt')                   // 代码写 → 读回
    expect(out).toContain('2')                         // 整数属性写 → 读回
  }, 120000)
})
