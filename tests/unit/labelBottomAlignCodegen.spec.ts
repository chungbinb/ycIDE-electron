// 【标签「纵向对齐方式=底」代码生成】Win32 STATIC 没有底对齐样式位（SS_CENTERIMAGE 只能垂直居中，
// 且会强制水平居中），设计器预览（flex-end）能底对齐、编译后却回到顶部。修复：底对齐标签挂
// YcLblAlignProc 子类接管 WM_PAINT，用 DrawTextW(DT_BOTTOM) 自绘文字；背景（底图/渐变/底色/透明）
// 与现有 YcLblBgProc/WM_CTLCOLORSTATIC 行为保持一致。
//
// 本用例只校验生成的 main.cpp（表条目/自绘过程/挂子类位置），不依赖 zig 真实编译：
// readCompilerSettings 给一个假编译器路径即可让流程走到代码生成（真正的资源编译阶段会失败，
// 但 main.cpp 已落盘）。项目里其余编译器用例按 zigAvailable 门控跳过，本用例无需工具链。
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')

describe('标签底对齐代码生成', () => {
  it('纵向对齐=底 的标签生成 YcLblAlignProc 自绘代码，普通标签不受影响', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'ycide-lblalign-'))
    try {
      setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: projectDir, appVersion: 'test' })
      setCompilerHost({
        emitOutput: () => {},
        requestFocusIdeWindow: () => {},
        notifyProcessExit: () => {},
        openPathExternally: async () => '',
        readCompilerSettings: () => ({ zigPath: 'C:\\Windows\\System32\\cmd.exe', optimizeLevel: 'O0' }),
      })
      writeFileSync(join(projectDir, 'p.epp'), [
        'ProjectName=LabelAlignTest',
        'OutputType=WindowsApp',
        'Platform=windows',
        '',
        'File=EFW|_启动窗口.efw|1',
        'File=EFW|_子窗口.efw|0',
        'File=EYC|_启动窗口.eyc|0',
        '',
      ].join('\n'), 'utf-8')
      writeFileSync(join(projectDir, '_启动窗口.efw'), JSON.stringify({
        name: '_启动窗口',
        formWidth: 400,
        formHeight: 300,
        formTitle: '测试',
        properties: {},
        controls: [
          { type: '标签', name: '标签1', x: 10, y: 10, width: 200, height: 100, text: '底对齐', properties: { '纵向对齐方式': 2, '横向对齐方式': 1 } },
          { type: '标签', name: '标签2', x: 10, y: 120, width: 200, height: 50, text: '普通', properties: {} },
          {
            type: '标签', name: '标签3', x: 10, y: 180, width: 200, height: 60, text: '底图底对齐',
            properties: { '纵向对齐方式': 2, '底图': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' },
          },
        ],
      }), 'utf-8')
      writeFileSync(join(projectDir, '_子窗口.efw'), JSON.stringify({
        name: '_子窗口',
        formWidth: 300,
        formHeight: 200,
        formTitle: '子窗',
        properties: {},
        controls: [
          { type: '标签', name: '子标签1', x: 5, y: 5, width: 150, height: 60, text: '子窗底对齐', properties: { '纵向对齐方式': 2 } },
        ],
      }), 'utf-8')
      writeFileSync(join(projectDir, '_启动窗口.eyc'), ['.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 __启动窗口_创建完毕', ''].join('\n'), 'utf-8')

      await compileProject({ projectDir, mode: 'run' })

      const mainC = join(projectDir, 'temp', 'main.cpp')
      expect(existsSync(mainC)).toBe(true)
      const src = readFileSync(mainC, 'utf-8')

      // 自绘表与过程
      expect(src).toContain('typedef struct { int id; COLORREF textColor; LONG backColor; int transparent; int hasBg; int hAlign; int vAlign; int wrap; } YcLblAlignEntry;')
      expect(src).toContain('static YcLblAlignEntry g_ycLblAligns[]')
      expect(src).toContain('YcLblAlignProc')
      expect(src).toContain('DT_BOTTOM')
      // 折行时 DT_BOTTOM 无效（只对 DT_SINGLELINE 生效），必须走「DT_CALCRECT 量文本块 → 整体贴底」分支
      expect(src).toContain('if (e->wrap && e->vAlign != 0) {')
      expect(src).toContain('DrawTextW(hdc, ltxt, -1, &tr, DT_CALCRECT | baseFmt | hFmt);')
      expect(src).toContain('int ty = (e->vAlign == 2) ? (rc.bottom - th) : (rc.top + (ch - th) / 2);')

      // 表内容：只收录纵向对齐=底的标签（标签1/标签3/子窗标签），普通标签2 不进表
      const tblStart = src.indexOf('static YcLblAlignEntry g_ycLblAligns[]')
      const tblEnd = src.indexOf('};', tblStart)
      const tbl = src.slice(tblStart, tblEnd)
      expect(tbl).toContain('IDC_标签1')
      expect(tbl).toContain('IDC_标签3')
      expect(tbl).not.toContain('IDC_标签2')
      // 标签1：文本色0 底白 不透明 无底图 横中(1) 纵底(2) 居中恒折行(1)
      expect(tbl).toContain('{ IDC_标签1, (COLORREF)0, 16777215, 0, 0, 1, 2, 1 },')
      // 标签3：有底图 → hasBg=1；左对齐(0) 不自动折行 → wrap=0
      expect(tbl).toContain('{ IDC_标签3, (COLORREF)0, 16777215, 0, 1, 0, 2, 0 },')
      // 子窗标签：数字 ID 入同一张表（主窗 3 个控件后从 1004 起）
      expect(tbl).toContain('{ 1004, (COLORREF)0, 16777215, 0, 0, 0, 2, 0 },')

      // 主窗创建：标签3（底图）同时挂底图子类与底对齐子类，且底对齐子类在底图子类之后安装
      const mainCreate = src.slice(src.indexOf('void CreateControls('), src.indexOf('static void CreateControls_W1'))
      expect(mainCreate).toContain('SetWindowSubclass(hCtrl, YcLblBgProc, 1,')
      expect(mainCreate).toContain('SetWindowSubclass(hCtrl, YcLblAlignProc, 2, (DWORD_PTR)&g_ycLblAligns[0]);')
      const lbl3 = mainCreate.slice(mainCreate.indexOf('L"底图底对齐"'))
      expect(lbl3.indexOf('YcLblBgProc, 1')).toBeLessThan(lbl3.indexOf('YcLblAlignProc, 2'))
      // 普通标签2 不挂子类
      const lbl2 = mainCreate.slice(mainCreate.indexOf('L"普通"'), mainCreate.indexOf('L"底图底对齐"'))
      expect(lbl2).not.toContain('YcLblAlignProc')
      // 子窗创建：底对齐子类挂在数字 ID 对应的控件上
      expect(src).toContain('static void CreateControls_W1(HWND hWndParent)')
      expect(src).toContain('SetWindowSubclass(hCtrl, YcLblAlignProc, 2, (DWORD_PTR)&g_ycLblAligns[2]);')
    } finally {
      try { rmSync(projectDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
    }
  })
})
