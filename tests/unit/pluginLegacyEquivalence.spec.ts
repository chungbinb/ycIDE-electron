// 阶段 0 回归：菜单与快捷键改由内置插件清单生成后，必须与改造前的硬编码行为一致。
//
// 下面的 legacyBuildMenus / legacyResolveShortcut 是改造前 TitleBar.tsx 的 buildMenus 和
// App.tsx 全局快捷键处理的原样拷贝（只做了类型上的最小调整），作为对照基准，不要「顺手修」。
// 新旧确有差异的地方都是有意的修复，逐条列在 INTENDED_SHORTCUT_CHANGES 里。
import { describe, it, expect } from 'vitest'
import { loadPlugins } from '../../src/shared/plugin/builtinPlugins'
import { matchKeybinding, resolveMenubar, type ResolvedMenuItem } from '../../src/shared/plugin/contributions'
import { buildRecentOpenedEntries, buildThemeEntries, RECENT_OPENED_SUBMENU, THEMES_SUBMENU } from '../../src/shared/plugin/workbenchMenus'
import type { KeyEventLike } from '../../src/shared/plugin/keybinding'

type RuntimePlatform = 'windows' | 'macos' | 'linux'

// ───────────── 改造前的标题栏菜单（TitleBar.tsx buildMenus 原样拷贝） ─────────────

interface LegacyMenuItem {
  label: string
  shortcut?: string
  divider?: boolean
  action?: string
  disabled?: boolean
  submenu?: LegacyMenuItem[]
  checked?: boolean
}
interface LegacyMenuDef { label: string; items: LegacyMenuItem[] }
interface RecentOpenedItem { type: 'project' | 'file'; path: string; label: string }

const BUILTIN_THEME_IDS = ['默认深色', '默认浅色']
const getPrimaryModifierLabel = (p: RuntimePlatform) => (p === 'macos' ? 'Cmd' : 'Ctrl')
const getRedoShortcutLabel = (p: RuntimePlatform) => (p === 'macos' ? 'Cmd+Shift+Z' : 'Ctrl+Y')
const getQuitShortcutLabel = (p: RuntimePlatform) => (p === 'macos' ? 'Cmd+Q' : 'Alt+F4')

function legacyBuildMenus(runtimePlatform: RuntimePlatform, hasProject: boolean, hasWorkspace: boolean, hasOpenFile: boolean, themes: string[], currentTheme: string, recentOpened: RecentOpenedItem[]): LegacyMenuDef[] {
  const np = !hasProject
  const nw = !hasWorkspace
  const nf = !hasOpenFile
  const mod = getPrimaryModifierLabel(runtimePlatform)
  const redoShortcut = getRedoShortcutLabel(runtimePlatform)
  const quitShortcut = getQuitShortcutLabel(runtimePlatform)
  const recentSubmenu: LegacyMenuItem[] = recentOpened.length > 0
    ? recentOpened.slice(0, 10).map(item => ({
      label: `${item.type === 'project' ? '项目' : '文件'}: ${item.label}`,
      action: `file:openRecent:${encodeURIComponent(JSON.stringify({ type: item.type, path: item.path }))}`,
    }))
    : [{ label: '(空)', disabled: true }]
  const builtinThemes = BUILTIN_THEME_IDS.filter(themeId => themes.includes(themeId))
  const customThemes = themes.filter(themeId => !BUILTIN_THEME_IDS.includes(themeId))
  const orderedThemes = [...builtinThemes, ...customThemes]
  const themeSubmenu: LegacyMenuItem[] = orderedThemes.length > 0
    ? orderedThemes.flatMap((themeName, index) => {
      if (index === builtinThemes.length && customThemes.length > 0) {
        return [
          { label: '', divider: true },
          { label: themeName, action: `theme:${themeName}`, checked: themeName === currentTheme },
        ]
      }
      return [{ label: themeName, action: `theme:${themeName}`, checked: themeName === currentTheme }]
    })
    : [{ label: '(空)', disabled: true }]
  return [
    { label: '文件(F)', items: [
      { label: '新建文件(F)', shortcut: `${mod}+Alt+N`, action: 'file:newFile' },
      { label: '新建项目(N)', shortcut: `${mod}+Alt+Shift+N`, action: 'file:newProject' },
      { label: '', divider: true },
      { label: '打开文件(O)', shortcut: `${mod}+O`, action: 'file:openFile' },
      { label: '打开项目(P)', shortcut: `${mod}+Shift+O`, action: 'file:openProject' },
      { label: '打开文件夹工作区(F)', shortcut: `${mod}+Alt+O`, action: 'file:openWorkspaceFolder' },
      { label: '最近打开', submenu: recentSubmenu },
      { label: '', divider: true },
      { label: '保存(S)', shortcut: `${mod}+S`, action: 'file:save', disabled: nf },
      { label: '另存为(A)', shortcut: `${mod}+Alt+S`, action: 'file:saveAs', disabled: nf },
      { label: '保存全部(L)', shortcut: `${mod}+Shift+S`, action: 'file:saveAll', disabled: nf },
      { label: '', divider: true },
      { label: '关闭文件(C)', shortcut: `${mod}+W`, action: 'file:closeFile', disabled: nf },
      { label: '关闭工作区', action: 'file:closeProject', disabled: nw },
      { label: '', divider: true },
      { label: '退出(X)', shortcut: quitShortcut, action: 'file:exit' },
    ]},
    { label: '编辑(E)', items: [
      { label: '撤销(U)', shortcut: `${mod}+Z`, action: 'edit:undo', disabled: nf },
      { label: '重做(R)', shortcut: redoShortcut, action: 'edit:redo', disabled: nf },
      { label: '', divider: true },
      { label: '剪切(T)', shortcut: `${mod}+X`, action: 'edit:cut', disabled: nf },
      { label: '复制(C)', shortcut: `${mod}+C`, action: 'edit:copy', disabled: nf },
      { label: '粘贴(P)', shortcut: `${mod}+V`, action: 'edit:paste', disabled: nf },
      { label: '删除(D)', shortcut: 'Delete', action: 'edit:delete', disabled: nf },
      { label: '', divider: true },
      { label: '全选(A)', shortcut: `${mod}+A`, action: 'edit:selectAll', disabled: nf },
      { label: '查找(F)', shortcut: `${mod}+F`, action: 'edit:find', disabled: nf },
      { label: '替换(H)', shortcut: `${mod}+H`, action: 'edit:replace', disabled: nf },
    ]},
    { label: '查看(V)', items: [
      { label: '属性面板', action: 'view:property' },
      { label: '输出面板', action: 'view:output' },
      { label: '支持库', action: 'view:library' },
      { label: '', divider: true },
      { label: '项目管理器', action: 'view:project' },
      { label: '', divider: true },
      { label: '主题', submenu: themeSubmenu },
    ]},
    { label: '插入(I)', items: [
      { label: '全局变量(G)', action: 'insert:globalVar', disabled: np },
      { label: '常量(C)', action: 'insert:constant', disabled: np },
      { label: '自定义数据类型(T)', action: 'insert:dataType', disabled: np },
      { label: 'DLL命令(D)', action: 'insert:dllCmd', disabled: np },
      { label: '指针命令(P)', action: 'insert:ptrCmd', disabled: np },
      { label: '', divider: true },
      { label: '类模块(L)', action: 'insert:classModule', disabled: np },
      { label: '程序集(M)', action: 'insert:module', disabled: np },
      { label: '子程序(S)', shortcut: `${mod}+N`, action: 'insert:sub', disabled: np },
      { label: '', divider: true },
      { label: '窗口(W)', action: 'insert:window', disabled: np },
      { label: '资源(R)', action: 'insert:resource', disabled: np },
    ]},
    { label: '编译(B)', items: [
      { label: '普通编译(C)', shortcut: `${mod}+F7`, action: 'build:compile', disabled: np },
      { label: '', divider: true },
      { label: '编译运行(R)', shortcut: 'F5', action: 'build:run', disabled: np },
    ]},
    { label: '调试(D)', items: [
      { label: '运行(R)', shortcut: 'F5', action: 'debug:run', disabled: np },
      { label: '停止(S)', shortcut: 'Shift+F5', action: 'debug:stop', disabled: np },
      { label: '', divider: true },
      { label: '逐过程(O)', shortcut: 'F10', action: 'debug:stepOver', disabled: np },
      { label: '逐语句(I)', shortcut: 'F11', action: 'debug:stepInto', disabled: np },
      { label: '跳出(U)', shortcut: 'Shift+F11', action: 'debug:stepOut', disabled: np },
      { label: '运行到光标处(C)', shortcut: `${mod}+F8`, action: 'debug:runToCursor', disabled: np },
      { label: '', divider: true },
      { label: '切换断点(B)', shortcut: 'F9', action: 'debug:toggleBreakpoint', disabled: np },
      { label: '清除所有断点', action: 'debug:clearBreakpoints', disabled: np },
    ]},
    { label: '工具(T)', items: [
      { label: '支持库配置(L)', action: 'tools:library' },
      { label: '主题管理器(M)', action: 'tools:themeManager' },
      { label: '', divider: true },
      { label: '系统设置(S)', action: 'tools:settings' },
    ]},
    { label: '帮助(H)', items: [
      { label: '帮助主题(H)', shortcut: 'F1', action: 'help:topics' },
      { label: '', divider: true },
      { label: '关于(A)', action: 'help:about' },
    ]},
  ]
}

// 统一成可比较的形状：命令 + 参数还原成改造前的 action 字符串
type Normalized = string | { label: string; shortcut?: string; disabled: boolean; checked?: boolean; action?: string } | { label: string; submenu: Normalized[] }

function normalizeLegacy(items: LegacyMenuItem[]): Normalized[] {
  return items.map(item => {
    if (item.divider) return '---'
    if (item.submenu) return { label: item.label, submenu: normalizeLegacy(item.submenu) }
    return { label: item.label, shortcut: item.shortcut, disabled: !!item.disabled, checked: item.checked, action: item.action }
  })
}

function toLegacyAction(command: string, args?: unknown[]): string | undefined {
  if (!command) return undefined
  if (command === 'theme:apply') return `theme:${String(args?.[0])}`
  if (command === 'file:openRecent') return `file:openRecent:${encodeURIComponent(JSON.stringify(args?.[0]))}`
  return command
}

function normalizeNew(items: ResolvedMenuItem[]): Normalized[] {
  return items.map(item => {
    if (item.kind === 'separator') return '---'
    if (item.kind === 'submenu') return { label: item.label, submenu: normalizeNew(item.items) }
    return { label: item.label, shortcut: item.shortcut, disabled: !item.enabled, checked: item.checked, action: toLegacyAction(item.command, item.args) }
  })
}

describe('标题栏菜单：插件清单生成的结果与改造前一致', () => {
  const recent: RecentOpenedItem[] = [
    { type: 'project', path: 'D:\\项目\\测试.epp', label: '测试' },
    { type: 'file', path: 'D:\\a b\\x.txt', label: 'x.txt' },
  ]
  const states = [
    { hasProject: false, hasWorkspace: false, hasOpenFile: false, themes: [] as string[], currentTheme: '', recentOpened: [] as RecentOpenedItem[] },
    { hasProject: true, hasWorkspace: true, hasOpenFile: true, themes: ['默认深色', '默认浅色', '抹茶绿'], currentTheme: '抹茶绿', recentOpened: recent },
    { hasProject: false, hasWorkspace: true, hasOpenFile: true, themes: ['默认浅色'], currentTheme: '默认浅色', recentOpened: recent },
    { hasProject: true, hasWorkspace: false, hasOpenFile: false, themes: ['自定义一', '默认深色'], currentTheme: '默认深色', recentOpened: [] },
  ]

  for (const platform of ['windows', 'linux'] as const) {
    states.forEach((state, index) => {
      it(`${platform} 状态 ${index + 1}`, () => {
        const legacy = legacyBuildMenus(platform, state.hasProject, state.hasWorkspace, state.hasOpenFile, state.themes, state.currentTheme, state.recentOpened)
        const { model } = loadPlugins({ platform, host: 'electron' })
        const resolved = resolveMenubar(model, {
          platform,
          showMnemonics: true,
          context: { projectOpen: state.hasProject, workspaceOpen: state.hasWorkspace, fileOpen: state.hasOpenFile },
          dynamicSubmenus: {
            [RECENT_OPENED_SUBMENU]: buildRecentOpenedEntries(state.recentOpened),
            [THEMES_SUBMENU]: buildThemeEntries(state.themes, state.currentTheme, BUILTIN_THEME_IDS),
          },
        })
        expect(resolved.map(m => ({ label: m.label, items: normalizeNew(m.items) })))
          .toEqual(legacy.map(m => ({ label: m.label, items: normalizeLegacy(m.items) })))
      })
    })
  }
})

// ───────────── 改造前的全局快捷键（App.tsx keydown 处理原样拷贝） ─────────────

interface LegacyKeyEvent extends KeyEventLike {
  editable: boolean
  nativeSelection: boolean
}

function isRedoShortcut(event: KeyEventLike, platform: RuntimePlatform): boolean {
  const ctrl = event.ctrlKey || event.metaKey
  if (!ctrl) return false
  const key = event.code === 'KeyZ' || event.key.toLowerCase() === 'z'
    ? 'z'
    : event.code === 'KeyY' || event.key.toLowerCase() === 'y'
      ? 'y'
      : ''
  if (key === 'y') return true
  return platform === 'macos' && key === 'z' && event.shiftKey
}

function legacyResolveShortcut(e: LegacyKeyEvent, runtimePlatform: RuntimePlatform): string | null {
  const ctrl = e.ctrlKey || e.metaKey
  const shift = e.shiftKey
  const code = e.code
  const key = e.key

  let action: string | null = null

  if (ctrl && !e.altKey && !shift && code === 'KeyN') action = 'insert:sub'
  else if (ctrl && e.altKey && !shift && code === 'KeyN') action = 'file:newFile'
  else if (ctrl && !shift && code === 'KeyO') action = 'file:openFile'
  else if (ctrl && e.altKey && shift && code === 'KeyN') action = 'file:newProject'
  else if (ctrl && shift && code === 'KeyO') action = 'file:openProject'
  else if (ctrl && e.altKey && !shift && code === 'KeyO') action = 'file:openWorkspaceFolder'
  else if (ctrl && shift && code === 'KeyS') action = 'file:saveAll'
  else if (ctrl && e.altKey && !shift && code === 'KeyS') action = 'file:saveAs'
  else if (ctrl && !shift && code === 'KeyS') action = 'file:save'
  else if (ctrl && !shift && code === 'KeyW') action = 'file:closeFile'
  else if (ctrl && !shift && code === 'KeyZ') action = 'edit:undo'
  else if (isRedoShortcut(e, runtimePlatform)) action = 'edit:redo'
  else if (ctrl && !shift && code === 'KeyJ') action = 'nav:back'
  else if (ctrl && !shift && code === 'KeyX') action = 'edit:cut'
  else if (ctrl && !shift && code === 'KeyC') action = 'edit:copy'
  else if (ctrl && !shift && code === 'KeyV') action = 'edit:paste'
  else if (ctrl && !shift && code === 'KeyF') action = 'edit:find'
  else if (ctrl && !shift && code === 'KeyH') action = 'edit:replace'
  else if (ctrl && !shift && key === 'F7') action = 'build:compile'
  else if (!ctrl && !shift && key === 'F7') action = 'build:build'
  else if (!ctrl && !shift && key === 'F5') action = 'build:run'
  else if (!ctrl && shift && key === 'F5') action = 'debug:stop'
  else if (!ctrl && !shift && key === 'F9') action = 'debug:toggleBreakpoint'
  else if (!ctrl && !shift && key === 'F10') action = 'debug:stepOver'
  else if (ctrl && !shift && key === 'F8') action = 'debug:runToCursor'
  else if (!ctrl && !shift && key === 'F11') action = 'debug:stepInto'
  else if (!ctrl && shift && key === 'F11') action = 'debug:stepOut'
  else if (ctrl && !shift && code === 'KeyL') action = 'insert:localVar'
  else if (!ctrl && !shift && key === 'F1') action = 'help:topics'

  if (!action) return null
  if (action.startsWith('edit:') && action !== 'edit:find' && action !== 'edit:replace' && e.editable) return null
  if ((action === 'edit:copy' || action === 'edit:cut' || action === 'edit:selectAll') && e.nativeSelection) return null
  return action
}

/** 有意的修复：改造前的 if-else 链里这些组合判断有误，新实现按清单精确匹配 */
const INTENDED_SHORTCUT_CHANGES: Array<{ when: (e: LegacyKeyEvent) => boolean; legacy: string | null; now: string | null; why: string }> = [
  {
    // 改造前「打开文件」的判断没排除 Alt，先于「打开文件夹工作区」命中，Ctrl+Alt+O 永远打开的是文件
    when: e => e.code === 'KeyO' && e.altKey && !e.shiftKey && (e.ctrlKey || e.metaKey),
    legacy: 'file:openFile',
    now: 'file:openWorkspaceFolder',
    why: 'Ctrl+Alt+O 改为菜单上标注的「打开文件夹工作区」',
  },
  {
    // build:build 在命令分发里没有对应处理，按下只是吞掉按键
    when: e => e.key === 'F7' && !e.ctrlKey && !e.metaKey && !e.shiftKey,
    legacy: 'build:build',
    now: null,
    why: '去掉不存在的命令 build:build',
  },
]

function describeEvent(e: LegacyKeyEvent): string {
  const mods = [e.ctrlKey && 'Ctrl', e.metaKey && 'Meta', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean).join('+')
  return `${mods ? `${mods}+` : ''}${e.code || e.key}${e.editable ? ' [可编辑]' : ''}${e.nativeSelection ? ' [有选区]' : ''}`
}

describe('全局快捷键：插件清单分发的结果与改造前一致', () => {
  const mainKeys: Array<{ key: string; code: string }> = [
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(ch => ({ key: ch.toLowerCase(), code: `Key${ch}` })),
    ...'0123456789'.split('').map(d => ({ key: d, code: `Digit${d}` })),
    ...Array.from({ length: 12 }, (_, i) => ({ key: `F${i + 1}`, code: `F${i + 1}` })),
    { key: 'Delete', code: 'Delete' },
    { key: 'Escape', code: 'Escape' },
    { key: 'Enter', code: 'Enter' },
  ]

  for (const platform of ['windows', 'macos', 'linux'] as const) {
    it(`${platform}：除有意修复外逐项一致`, () => {
      const { model } = loadPlugins({ platform, host: 'electron' })
      const unexpected: string[] = []
      const intendedHits = new Set<string>()
      for (const mk of mainKeys) {
        for (let mask = 0; mask < 64; mask++) {
          const e: LegacyKeyEvent = {
            ...mk,
            ctrlKey: !!(mask & 1),
            metaKey: !!(mask & 2),
            altKey: !!(mask & 4),
            shiftKey: !!(mask & 8),
            editable: !!(mask & 16),
            nativeSelection: !!(mask & 32),
          }
          const legacy = legacyResolveShortcut(e, platform)
          const now = matchKeybinding(model, e, platform, { editableFocus: e.editable, nativeTextSelection: e.nativeSelection })?.command ?? null
          if (legacy === now) continue
          const intended = INTENDED_SHORTCUT_CHANGES.find(c => c.when(e) && c.legacy === legacy && c.now === now)
          if (intended) {
            intendedHits.add(intended.why)
            continue
          }
          // 改造前很多分支不检查 Alt（以及重做不检查 Shift），多按了这些修饰键也会触发；
          // 新实现要求修饰键完全一致。只允许这一类「旧版宽松命中 → 新版不命中」的差异。
          const legacyLoose = legacy !== null && now === null && (e.altKey || (legacy === 'edit:redo' && e.shiftKey))
          if (!legacyLoose) unexpected.push(`${describeEvent(e)}：改造前 ${legacy ?? '无'}，现在 ${now ?? '无'}`)
        }
      }
      expect(unexpected).toEqual([])
      expect([...intendedHits].sort()).toEqual(INTENDED_SHORTCUT_CHANGES.map(c => c.why).sort())
    })
  }
})
