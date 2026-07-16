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
      '进度条1.位置 ＝ 进度条1.位置 ＋ 到数值 (“3”)',  // 回归：属性读 ＋ 尾随函数调用（parseCommandCall 吞并形态，不得误报「方法不支持」）
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

  it.skipIf(!zigAvailable)('现行子夹/时钟周期/编辑框选区/画板状态/窗口标题 声明式读写并可编译', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-gapfix2-'))
    writeFileSync(join(dir, 'p.epp'), [
      '# YiCode Project File', 'Version=1', 'ProjectName=剩余属性验证',
      'OutputType=WindowsApp', 'Platform=windows', '',
      'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', '',
    ].join('\n'), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
      name: '_启动窗口', title: '窗口', width: 500, height: 400, sourceFile: '_启动窗口.eyc',
      controls: [
        { id: 'c1', type: '选择夹', name: '选择夹1', left: 10, top: 10, width: 220, height: 150, text: '', visible: true, enabled: true, properties: { '子夹标题': '甲夹\n乙夹' } },
        { id: 'c2', type: '时钟', name: '时钟1', left: 10, top: 170, width: 32, height: 32, text: '', visible: true, enabled: true, properties: { '时钟周期': 0 } },
        { id: 'c3', type: '编辑框', name: '编辑框1', left: 10, top: 210, width: 200, height: 24, text: 'hello', visible: true, enabled: true, properties: {} },
        { id: 'c4', type: '组合框', name: '组合框1', left: 10, top: 240, width: 150, height: 120, text: '', visible: true, enabled: true, properties: {} },
        { id: 'c5', type: '月历', name: '月历1', left: 240, top: 10, width: 220, height: 160, text: '', visible: true, enabled: true, properties: {} },
        { id: 'c6', type: '画板', name: '画板1', left: 240, top: 180, width: 200, height: 150, text: '', visible: true, enabled: true, properties: {} },
      ],
    }), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.eyc'), [
      '.版本 2', '.程序集 窗口程序集_启动窗口', '',
      '.子程序 __启动窗口_创建完毕',
      '.局部变量 n, 整数型', '.局部变量 t, 文本型',
      '选择夹1.现行子夹 ＝ 1',
      'n ＝ 选择夹1.现行子夹',
      '时钟1.时钟周期 ＝ 500',
      'n ＝ 时钟1.时钟周期',
      '编辑框1.起始选择位置 ＝ 1',
      '编辑框1.被选择字符数 ＝ 2',
      't ＝ 编辑框1.被选择文本',
      '编辑框1.被选择文本 ＝ “替换”',
      '编辑框1.最大允许长度 ＝ 100',
      '组合框1.最大文本长度 ＝ 50',
      '月历1.滚动月数 ＝ 3',
      '画板1.画笔粗细 ＝ 5',
      'n ＝ 画板1.画笔粗细',
      '_启动窗口.标题 ＝ “新标题”',
      '',
      '.子程序 _时钟1_周期事件',
      '时钟1.时钟周期 ＝ 0',
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    const errors = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, `编译失败：\n${errors}`).toBe(true)

    const gen = readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8')
    expect(gen).toContain('yc_tab_set_cur(')            // 现行子夹写（自带 yc_tab_sync）
    expect(gen).toContain('yc_tab_get_cur(')            // 现行子夹读
    expect(gen).toContain('yc_timer_set_period(')       // 时钟周期写
    expect(gen).toContain('yc_timer_get_period(')       // 时钟周期读
    expect(gen).toContain('L"起始选择位置"')             // 编辑框选区
    expect(gen).toContain('yc_ctrl_get_seltext(')       // 被选择文本读
    expect(gen).toContain('krnln_ctrl_set_seltext(')    // 被选择文本写（替换选中）
    expect(gen).toContain('yc_dp_set_prop(')            // 画板状态写
    expect(gen).toContain('yc_dp_get_prop(')            // 画板状态读
    expect(gen).toContain('yc_get_control_handle_by_name(L"_启动窗口")')  // 窗口标题经窗体名解析

    const mainCpp = readFileSync(join(dir, 'temp', 'main.cpp'), 'utf-8')
    expect(mainCpp).toContain('case WM_TIMER')          // 周期事件派发
    expect(mainCpp).toContain('_时钟1_周期事件();')      // 定时器 id → 用户处理子程序
    expect(mainCpp).toContain('return g_hMainWnd;')     // 窗体名 → 主窗句柄
    rmSync(dir, { recursive: true, force: true })
  }, 120000)

  it.skipIf(!zigAvailable)('标签/选择框背景颜色进运行时颜色表(白=白/黑=黑)，未设背景默认白色也进表(beta.6)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-whitebg-'))
    writeFileSync(join(dir, 'p.epp'), [
      '# YiCode Project File', 'Version=1', 'ProjectName=白底验证',
      'OutputType=WindowsApp', 'Platform=windows', '',
      'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', '',
    ].join('\n'), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
      name: '_启动窗口', title: '窗口', width: 400, height: 300, sourceFile: '_启动窗口.eyc',
      controls: [
        { id: 'c1', type: '标签', name: '白标', left: 10, top: 10, width: 80, height: 24, text: '白', visible: true, enabled: true, properties: { '背景颜色': 16777215 } },
        { id: 'c2', type: '标签', name: '素标', left: 10, top: 40, width: 80, height: 24, text: '素', visible: true, enabled: true, properties: {} },
        { id: 'c3', type: '选择框', name: '白选', left: 10, top: 70, width: 80, height: 24, text: '选', visible: true, enabled: true, properties: { '背景颜色': 16777215 } },
        { id: 'c4', type: '标签', name: '黑标', left: 10, top: 100, width: 80, height: 24, text: '黑', visible: true, enabled: true, properties: { '背景颜色': 0 } },
      ],
    }), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 __启动窗口_创建完毕', ''].join('\n'), 'utf-8')

    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    const errors = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, `编译失败：\n${errors}`).toBe(true)

    const mainCpp = readFileSync(join(dir, 'temp', 'main.cpp'), 'utf-8')
    expect(mainCpp).toContain('{ IDC_白标, (COLORREF)0, (COLORREF)16777215, NULL, 0 }')  // 显式白 → 进表画白
    expect(mainCpp).toContain('{ IDC_素标, (COLORREF)0, (COLORREF)16777215, NULL, 0 }')   // 未设 → beta.6 默认白 → 进表画白(此前 -1 融入窗口不进表)
    expect(mainCpp).toContain('{ IDC_白选, (COLORREF)0, (COLORREF)16777215, NULL, 0 }')  // 选择框同款
    expect(mainCpp).toContain('{ IDC_黑标, (COLORREF)0, (COLORREF)0, NULL, 0 }')          // 显式纯黑(0)进表画黑(默认哨兵是 -1 不是 0)
    rmSync(dir, { recursive: true, force: true })
  }, 120000)

  it.skipIf(!zigAvailable)('空窗口(无控件/无命令)也能链接：窗口程序无条件依赖 krnln 运行时', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-emptywin-'))
    writeFileSync(join(dir, 'p.epp'), [
      '# YiCode Project File', 'Version=1', 'ProjectName=空窗口链接验证',
      'OutputType=WindowsApp', 'Platform=windows', '',
      'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', '',
    ].join('\n'), 'utf-8')
    // 空窗口：无控件
    writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
      name: '_启动窗口', title: '窗口', width: 400, height: 300, sourceFile: '_启动窗口.eyc', controls: [],
    }), 'utf-8')
    // 空事件：什么都不做（新建项目直接运行的场景）
    writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 __启动窗口_创建完毕', ''].join('\n'), 'utf-8')

    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    const errors = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, `编译失败：\n${errors}`).toBe(true)     // 曾因 krnln 未链接而 undefined symbol
    expect(existsSync(result.outputFile)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  }, 120000)

  it.skipIf(!zigAvailable)('未绑定的控件属性/方法在转译期给出带行号的中文错误(不再是 undeclared identifier)', async () => {
    const mkProj = (eycLines: string[]) => {
      const dir = mkdtempSync(join(tmpdir(), 'ycide-gaperr-'))
      writeFileSync(join(dir, 'p.epp'), [
        '# YiCode Project File', 'Version=1', 'ProjectName=err',
        'OutputType=WindowsApp', 'Platform=windows', '',
        'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', '',
      ].join('\n'), 'utf-8')
      writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
        name: '_启动窗口', title: '窗口', width: 400, height: 300, sourceFile: '_启动窗口.eyc',
        controls: [
          { id: 'c1', type: '标签', name: '标签1', left: 10, top: 10, width: 80, height: 24, text: '', visible: true, enabled: true, properties: {} },
          { id: 'c2', type: '编辑框', name: '编辑框1', left: 10, top: 40, width: 120, height: 24, text: '', visible: true, enabled: true, properties: {} },
        ],
      }), 'utf-8')
      writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 __启动窗口_创建完毕', ...eycLines, ''].join('\n'), 'utf-8')
      return dir
    }

    // 属性写：标签.边框 无 set 绑定（设计期样式）
    const dir1 = mkProj(['标签1.边框 ＝ 1'])
    let before = messages.length
    const r1 = await compileProject({ projectDir: dir1, mode: 'run' })
    expect(r1.success).toBe(false)
    const err1 = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(err1).toContain('暂不支持在代码中赋值')
    expect(err1).toContain('_启动窗口.eyc:')   // 带 文件:行号 定位
    rmSync(dir1, { recursive: true, force: true })

    // 方法调用：标签.加入文本 无绑定（加入文本 只绑定到编辑框；标签上调用 → 友好报错）
    const dir2 = mkProj(['标签1.加入文本 (“x”)'])
    before = messages.length
    const r2 = await compileProject({ projectDir: dir2, mode: 'run' })
    expect(r2.success).toBe(false)
    const err2 = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(err2).toContain('暂不支持在代码中调用')
    rmSync(dir2, { recursive: true, force: true })
  }, 180000)

  it.skipIf(!zigAvailable)('编辑框.加入文本 方法经声明式绑定派发并可编译(beta.7)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-append-'))
    writeFileSync(join(dir, 'p.epp'), [
      '# YiCode Project File', 'Version=1', 'ProjectName=加入文本验证',
      'OutputType=WindowsApp', 'Platform=windows', '',
      'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', '',
    ].join('\n'), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
      name: '_启动窗口', title: '窗口', width: 400, height: 300, sourceFile: '_启动窗口.eyc',
      controls: [
        { id: 'c1', type: '编辑框', name: '编辑框1', left: 10, top: 10, width: 200, height: 120, text: '', visible: true, enabled: true, properties: {} },
      ],
    }), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.eyc'), [
      '.版本 2', '.程序集 窗口程序集_启动窗口', '',
      '.子程序 __启动窗口_创建完毕',
      '.局部变量 a, 文本型',
      'a ＝ “日志”',
      '编辑框1.加入文本 (a)',
      '编辑框1.加入文本 (“ 直接量”)',
      '编辑框1.加入文本 (“甲”, “乙”, a)',   // 尾参可重复：一次加入多个，全部都要追加（不得静默丢弃）
      '编辑框1.加入文本 (“丙”, )',          // 展开参数行回车会在源码留尾部空实参，空值不得发调用
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    const errors = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, `编译失败：\n${errors}`).toBe(true)
    expect(existsSync(result.outputFile)).toBe(true)

    const gen = readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8')
    expect(gen).toContain('krnln_ctrl_append_text(')                       // 加入文本 → 声明式 helper
    expect(gen).toContain('yc_get_control_handle_by_name(L"编辑框1")')      // {h} 占位展开
    // 尾参可重复：三个值各发一次调用、逗号表达式串起来（旧的 {0} 模板会把「乙」「a」静默丢掉）
    const multi = gen.split('\n').find(l => l.includes('甲'))
    expect(multi, '未找到多值加入文本的调用').toBeTruthy()
    expect(multi).toContain('乙')
    expect((multi!.match(/krnln_ctrl_append_text\(/g) || []).length, '三个值应各发一次调用').toBe(3)
    // 尾部空实参（回车追加待填行）只发一次调用，不为空值发调用
    const trailing = gen.split('\n').find(l => l.includes('丙'))
    expect(trailing, '未找到尾部空实参的调用').toBeTruthy()
    expect((trailing!.match(/krnln_ctrl_append_text\(/g) || []).length, '空实参不该发调用').toBe(1)
    rmSync(dir, { recursive: true, force: true })
  }, 120000)
})
