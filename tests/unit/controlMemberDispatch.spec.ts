// 一期回归：控件成员访问的声明式派发（window-units.json 的 controlMemberBindings 驱动）。
// 真实调用 compileProject（zig 工具链）编译一个含进度条 + 编辑框的窗口项目，
// 验证 控件.属性 读写译成 krnln_ctrl_*/yc_ctrl_get_text，且整体编译通过（无 undeclared identifier）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []
let projectDir = ''

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-cm-userdata-')), appVersion: 'test' })
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

describe('控件成员声明式派发', () => {
  it.skipIf(!zigAvailable)('进度条数值属性 + 编辑框文本属性经声明式绑定读写并可编译', async () => {
    projectDir = mkdtempSync(join(tmpdir(), 'ycide-ctrlmember-'))

    writeFileSync(join(projectDir, 'p.epp'), [
      '# YiCode Project File',
      'Version=1',
      'ProjectName=控件成员声明式验证',
      'OutputType=WindowsApp',
      'Platform=windows',
      '',
      'File=EFW|_启动窗口.efw|1',
      'File=EYC|_启动窗口.eyc|0',
      '',
    ].join('\n'), 'utf-8')

    writeFileSync(join(projectDir, '_启动窗口.efw'), JSON.stringify({
      name: '_启动窗口', title: '窗口', width: 400, height: 300, sourceFile: '_启动窗口.eyc',
      controls: [
        { id: 'ctrl_1', type: '进度条', name: '进度条1', left: 20, top: 20, width: 300, height: 24, text: '', visible: true, enabled: true, properties: {} },
        { id: 'ctrl_2', type: '编辑框', name: '编辑框1', left: 20, top: 60, width: 300, height: 24, text: '', visible: true, enabled: true, properties: {} },
      ],
    }), 'utf-8')

    writeFileSync(join(projectDir, '_启动窗口.eyc'), [
      '.版本 2',
      '.程序集 窗口程序集_启动窗口',
      '',
      '.子程序 __启动窗口_创建完毕',
      '.局部变量 t, 文本型',
      '进度条1.最小位置 ＝ 0',
      '进度条1.最大位置 ＝ 1000',
      '进度条1.位置 ＝ 进度条1.位置 ＋ 1',
      '编辑框1.内容 ＝ “你好”',
      't ＝ 编辑框1.内容',
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const result = await compileProject({ projectDir, mode: 'run' })
    const errors = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, `编译失败：\n${errors}`).toBe(true)
    expect(existsSync(result.outputFile)).toBe(true)

    // 转译产物断言：控件成员走声明式 helper，而非原样发成 C++ 左值/标识符。
    const gen = readFileSync(join(projectDir, 'temp', '_启动窗口.cpp'), 'utf-8')
    expect(gen).toContain('krnln_ctrl_set_number(')  // 进度条.最小/最大/位置 写
    expect(gen).toContain('krnln_ctrl_get_number(')  // 进度条.位置 读（含循环/加法内）
    expect(gen).toContain('krnln_ctrl_set_text(')    // 编辑框.内容 写
    expect(gen).toContain('yc_ctrl_get_text(')       // 编辑框.内容 读
    expect(gen).toContain('yc_get_control_handle_by_name(L"进度条1")')
    // 旧 bug 特征：控件.属性 被原样当 C++ 左值（undeclared identifier）
    expect(gen).not.toMatch(/进度条1\.\s*位置\s*=/)
  }, 120000)

  it.skipIf(!zigAvailable)('组合框/列表框/选择夹 成员方法经声明式绑定派发并可编译', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-ctrlmethod-'))
    writeFileSync(join(dir, 'p.epp'), [
      '# YiCode Project File', 'Version=1', 'ProjectName=控件方法声明式验证',
      'OutputType=WindowsApp', 'Platform=windows', '',
      'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', '',
    ].join('\n'), 'utf-8')

    writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
      name: '_启动窗口', title: '窗口', width: 400, height: 300, sourceFile: '_启动窗口.eyc',
      controls: [
        { id: 'ctrl_1', type: '组合框', name: '组合框1', left: 20, top: 20, width: 200, height: 200, text: '', visible: true, enabled: true, properties: {} },
        { id: 'ctrl_2', type: '列表框', name: '列表框1', left: 20, top: 60, width: 200, height: 200, text: '', visible: true, enabled: true, properties: {} },
      ],
    }), 'utf-8')

    writeFileSync(join(dir, '_启动窗口.eyc'), [
      '.版本 2',
      '.程序集 窗口程序集_启动窗口',
      '',
      '.子程序 __启动窗口_创建完毕',
      '.局部变量 n, 整数型',
      '.局部变量 s, 文本型',
      '组合框1.加入项目 (“甲”, 1)',
      '组合框1.加入项目 (“乙”)',
      '列表框1.加入项目 (“丙”)',
      'n ＝ 组合框1.取项目数 ()',
      's ＝ 组合框1.取项目文本 (0)',
      '组合框1.删除项目 (0)',
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    const errors = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, `编译失败：\n${errors}`).toBe(true)

    const gen = readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8')
    expect(gen).toContain('krnln_ll_add_item(')   // 加入项目（语句上下文；已搬 krnln 库，HWND 版）
    expect(gen).toContain('krnln_ll_count(')       // 取项目数（表达式上下文，赋给 n）
    expect(gen).toContain('yc_ll_get_text(')       // 取项目文本（文本表达式，赋给 s；YC_TEXT 薄封装留 main.cpp）
    expect(gen).toContain('krnln_ll_delete_item(')
    expect(gen).toContain('yc_get_control_handle_by_name(L"组合框1")')  // {h} 占位展开
    rmSync(dir, { recursive: true, force: true })
  }, 120000)

  it.skipIf(!zigAvailable)('通用属性(可视/尺寸/标记) + 选中 + 现行选中项 + 日期 声明式读写并可编译', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-gapfix-'))
    writeFileSync(join(dir, 'p.epp'), [
      '# YiCode Project File', 'Version=1', 'ProjectName=通用属性验证',
      'OutputType=WindowsApp', 'Platform=windows', '',
      'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', '',
    ].join('\n'), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
      name: '_启动窗口', title: '窗口', width: 400, height: 300, sourceFile: '_启动窗口.eyc',
      controls: [
        { id: 'c1', type: '按钮', name: '按钮1', left: 10, top: 10, width: 80, height: 24, text: '', visible: true, enabled: true, properties: {} },
        { id: 'c2', type: '选择框', name: '选择框1', left: 10, top: 40, width: 80, height: 24, text: '', visible: true, enabled: true, properties: {} },
        { id: 'c3', type: '组合框', name: '组合框1', left: 10, top: 70, width: 120, height: 120, text: '', visible: true, enabled: true, properties: {} },
        { id: 'c4', type: '日期框', name: '日期框1', left: 10, top: 200, width: 120, height: 24, text: '', visible: true, enabled: true, properties: {} },
      ],
    }), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.eyc'), [
      '.版本 2', '.程序集 窗口程序集_启动窗口', '',
      '.子程序 __启动窗口_创建完毕',
      '.局部变量 n, 整数型', '.局部变量 t, 文本型',
      '按钮1.可视 ＝ 假',
      '按钮1.宽度 ＝ 200',
      '按钮1.左边 ＝ 按钮1.左边 ＋ 10',
      '按钮1.标记 ＝ “ok”',
      't ＝ 按钮1.标记',
      '选择框1.选中 ＝ 真',
      '组合框1.现行选中项 ＝ 0',
      'n ＝ 组合框1.现行选中项',
      '日期框1.今天 ＝ “2026/07/11”',
      't ＝ 日期框1.今天',
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    const errors = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, `编译失败：\n${errors}`).toBe(true)

    const gen = readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8')
    expect(gen).toContain('krnln_ctrl_set_number(yc_get_control_handle_by_name(L"按钮1"), L"可视"')     // 可视写
    expect(gen).toContain('krnln_ctrl_get_number(yc_get_control_handle_by_name(L"按钮1"), L"左边")')     // 左边读
    expect(gen).toContain('krnln_ctrl_set_tag(')      // 标记写
    expect(gen).toContain('yc_ctrl_get_tag(')          // 标记读
    expect(gen).toContain('L"选中"')                    // 选中
    expect(gen).toContain('L"现行选中项"')              // 现行选中项
    expect(gen).toContain('krnln_ctrl_set_date(')      // 日期写
    expect(gen).toContain('yc_ctrl_get_date(')         // 日期读
    rmSync(dir, { recursive: true, force: true })
  }, 120000)
})
