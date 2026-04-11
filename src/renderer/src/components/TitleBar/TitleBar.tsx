import { useState, useRef, useEffect, useCallback } from 'react'
import './TitleBar.css'
import { getPrimaryModifierLabel, getQuitShortcutLabel, getRedoShortcutLabel, isMacOSPlatform, type RuntimePlatform } from '../../utils/shortcuts'

interface MenuItem {
  label: string
  shortcut?: string
  divider?: boolean
  action?: string
  disabled?: boolean
  submenu?: MenuItem[]
  checked?: boolean
}

interface MenuDef {
  label: string
  items: MenuItem[]
}

interface RecentOpenedItem {
  type: 'project' | 'file'
  path: string
  label: string
}

const BUILTIN_THEME_IDS = ['默认深色', '默认浅色']

function buildMenus(runtimePlatform: RuntimePlatform, hasProject: boolean, hasOpenFile: boolean, themes: string[], currentTheme: string, recentOpened: RecentOpenedItem[]): MenuDef[] {
  const np = !hasProject
  const nf = !hasOpenFile
  const mod = getPrimaryModifierLabel(runtimePlatform)
  const redoShortcut = getRedoShortcutLabel(runtimePlatform)
  const quitShortcut = getQuitShortcutLabel(runtimePlatform)
  const recentSubmenu: MenuItem[] = recentOpened.length > 0
    ? recentOpened.slice(0, 10).map(item => ({
      label: `${item.type === 'project' ? '项目' : '文件'}: ${item.label}`,
      action: `file:openRecent:${encodeURIComponent(JSON.stringify({ type: item.type, path: item.path }))}`,
    }))
    : [{ label: '(空)', disabled: true }]
  const builtinThemes = BUILTIN_THEME_IDS.filter(themeId => themes.includes(themeId))
  const customThemes = themes.filter(themeId => !BUILTIN_THEME_IDS.includes(themeId))
  const orderedThemes = [...builtinThemes, ...customThemes]
  const themeSubmenu: MenuItem[] = orderedThemes.length > 0
    ? orderedThemes.flatMap((themeName, index) => {
      if (index === builtinThemes.length && customThemes.length > 0) {
        return [
          { label: '', divider: true },
          {
            label: themeName,
            action: `theme:${themeName}`,
            checked: themeName === currentTheme,
          },
        ]
      }
      return [{
        label: themeName,
        action: `theme:${themeName}`,
        checked: themeName === currentTheme,
      }]
    })
    : [{ label: '(空)', disabled: true }]
  return [
    { label: '文件(F)', items: [
      { label: '新建项目(N)', shortcut: `${mod}+Shift+N`, action: 'file:newProject' },
      { label: '', divider: true },
      { label: '打开项目(P)', shortcut: `${mod}+Shift+O`, action: 'file:openProject' },
      { label: '最近打开', submenu: recentSubmenu },
      { label: '', divider: true },
      { label: '保存(S)', shortcut: `${mod}+S`, action: 'file:save', disabled: nf },
      { label: '保存全部(L)', shortcut: `${mod}+Shift+S`, action: 'file:saveAll', disabled: nf },
      { label: '', divider: true },
      { label: '关闭文件(C)', shortcut: `${mod}+W`, action: 'file:closeFile', disabled: nf },
      { label: '关闭项目', action: 'file:closeProject', disabled: np },
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
      { label: '', divider: true },
      { label: '类模块(L)', action: 'insert:classModule', disabled: np },
      { label: '程序集(M)', action: 'insert:module', disabled: np },
      { label: '子程序(S)', action: 'insert:sub', disabled: np },
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
      { label: '运行到光标处(C)', shortcut: `${mod}+F10`, action: 'debug:runToCursor', disabled: np },
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

interface TitleBarProps {
  onMenuAction?: (action: string) => void
  onWindowClose?: () => void
  runtimePlatform?: RuntimePlatform
  hasProject?: boolean
  hasOpenFile?: boolean
  themes?: string[]
  currentTheme?: string
  recentOpened?: RecentOpenedItem[]
}

function TitleBar({ onMenuAction, onWindowClose, runtimePlatform = 'windows', hasProject = false, hasOpenFile = false, themes = [], currentTheme = '', recentOpened = [] }: TitleBarProps): React.JSX.Element {
  const menus = buildMenus(runtimePlatform, hasProject, hasOpenFile, themes, currentTheme, recentOpened)
  const isMacOS = isMacOSPlatform(runtimePlatform)
  const [openMenu, setOpenMenu] = useState<number | null>(null)
  const menuBarRef = useRef<HTMLDivElement>(null)

  const handleMinimize = () => window.api?.window.minimize()
  const handleMaximize = () => window.api?.window.maximize()
  const handleClose = () => {
    if (onWindowClose) onWindowClose()
    else window.api?.window.close()
  }

  const closeMenu = useCallback(() => setOpenMenu(null), [])

  // 点击外部关闭菜单
  useEffect(() => {
    if (openMenu === null) return
    const handler = (e: MouseEvent): void => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        closeMenu()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openMenu, closeMenu])

  const handleTitlebarMouseDownCapture = (event: React.MouseEvent<HTMLElement>) => {
    if (openMenu === null) return
    const target = event.target as Node
    if (menuBarRef.current?.contains(target)) return
    closeMenu()
  }

  return (
    <header
      className={`titlebar${openMenu !== null ? ' menu-open' : ''}`}
      role="banner"
      onMouseDownCapture={handleTitlebarMouseDownCapture}
    >
      <div className="titlebar-drag">
        {!isMacOS && (
          <div className="titlebar-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <rect x="1" y="1" width="6" height="6" rx="1" />
            <rect x="9" y="1" width="6" height="6" rx="1" />
            <rect x="1" y="9" width="6" height="6" rx="1" />
            <rect x="9" y="9" width="6" height="6" rx="1" />
          </svg>
          </div>
        )}
        {!isMacOS && (
          <nav className="titlebar-menu" role="menubar" aria-label="主菜单" ref={menuBarRef}>
          {menus.map((menu, idx) => (
            <div key={menu.label} className="titlebar-menu-item">
              <button
                role="menuitem"
                tabIndex={idx === 0 ? 0 : -1}
                className={openMenu === idx ? 'active' : ''}
                onClick={() => setOpenMenu(openMenu === idx ? null : idx)}
                onMouseEnter={() => { if (openMenu !== null) setOpenMenu(idx) }}
              >
                {menu.label}
              </button>
              {openMenu === idx && (
                <div className="titlebar-dropdown" role="menu">
                  {menu.items.map((item, i) =>
                    item.divider ? (
                      <div key={i} className="titlebar-dropdown-divider" />
                    ) : item.submenu ? (
                      <div key={i} className="titlebar-dropdown-submenu-wrapper">
                        <button
                          role="menuitem"
                          className="titlebar-dropdown-item titlebar-has-submenu"
                        >
                          <span>{item.label}</span>
                          <span className="titlebar-submenu-arrow">▶</span>
                        </button>
                        <div className="titlebar-submenu" role="menu">
                          {item.submenu.map((sub, si) =>
                            sub.divider ? (
                              <div key={si} className="titlebar-dropdown-divider" />
                            ) : (
                              <button
                                key={si}
                                role="menuitem"
                                className={`titlebar-dropdown-item${sub.disabled ? ' disabled' : ''}`}
                                disabled={sub.disabled}
                                onClick={() => { if (sub.disabled) return; closeMenu(); if (sub.action) onMenuAction?.(sub.action) }}
                              >
                                <span>{sub.checked ? '✓ ' : '    '}{sub.label}</span>
                                {sub.shortcut && <span className="titlebar-dropdown-shortcut">{sub.shortcut}</span>}
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    ) : (
                      <button
                        key={i}
                        role="menuitem"
                        className={`titlebar-dropdown-item${item.disabled ? ' disabled' : ''}`}
                        disabled={item.disabled}
                        onClick={() => { if (item.disabled) return; closeMenu(); if (item.action) onMenuAction?.(item.action) }}
                      >
                        <span>{item.label}</span>
                        {item.shortcut && <span className="titlebar-dropdown-shortcut">{item.shortcut}</span>}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
          </nav>
        )}
        <div className="titlebar-title">ycIDE - 易承语言集成开发环境</div>
      </div>
      {!isMacOS && (
        <div className="titlebar-controls" aria-label="窗口控制">
        <button
          className="titlebar-btn"
          onClick={handleMinimize}
          aria-label="最小化"
          tabIndex={-1}
        >
          <svg width="10" height="1" viewBox="0 0 10 1">
            <line x1="0" y1="0.5" x2="10" y2="0.5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          className="titlebar-btn"
          onClick={handleMaximize}
          aria-label="最大化"
          tabIndex={-1}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" fill="none" />
          </svg>
        </button>
        <button
          className="titlebar-btn titlebar-btn-close"
          onClick={handleClose}
          aria-label="关闭"
          tabIndex={-1}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        </div>
      )}
    </header>
  )
}

export default TitleBar
