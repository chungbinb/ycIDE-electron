import { useState, useRef, useEffect, useCallback, memo } from 'react'
import './TitleBar.css'
import { isMacOSPlatform, type RuntimePlatform } from '../../utils/shortcuts'
import ycideLogo from '../../assets/icons/YcideLogo.png'
import { getLoadedPlugins, toPluginHostPlatform } from '../../workbench/commands'
import { resolveMenubar, type ResolvedMenu, type ResolvedMenuItem } from '../../../../shared/plugin/contributions'
import { buildRecentOpenedEntries, buildThemeEntries, RECENT_OPENED_SUBMENU, THEMES_SUBMENU, type RecentOpenedEntry } from '../../../../shared/plugin/workbenchMenus'

const BUILTIN_THEME_IDS = ['默认深色', '默认浅色']

// 菜单结构来自插件清单的 menubarMenus / menus / keybindings 贡献点（src/plugins/*/plugin.json）
function buildMenus(runtimePlatform: RuntimePlatform, hasProject: boolean, hasWorkspace: boolean, hasOpenFile: boolean, themes: string[], currentTheme: string, recentOpened: RecentOpenedEntry[]): ResolvedMenu[] {
  return resolveMenubar(getLoadedPlugins().model, {
    platform: toPluginHostPlatform(runtimePlatform),
    showMnemonics: true,
    context: { projectOpen: hasProject, workspaceOpen: hasWorkspace, fileOpen: hasOpenFile },
    dynamicSubmenus: {
      [RECENT_OPENED_SUBMENU]: buildRecentOpenedEntries(recentOpened),
      [THEMES_SUBMENU]: buildThemeEntries(themes, currentTheme, BUILTIN_THEME_IDS),
    },
  })
}

interface TitleBarProps {
  onCommand?: (command: string, ...args: unknown[]) => unknown
  onWindowClose?: () => void
  runtimePlatform?: RuntimePlatform
  hasProject?: boolean
  hasWorkspace?: boolean
  hasOpenFile?: boolean
  themes?: string[]
  currentTheme?: string
  recentOpened?: RecentOpenedEntry[]
}

function TitleBar({ onCommand, onWindowClose, runtimePlatform = 'windows', hasProject = false, hasWorkspace = false, hasOpenFile = false, themes = [], currentTheme = '', recentOpened = [] }: TitleBarProps): React.JSX.Element {
  const menus = buildMenus(runtimePlatform, hasProject, hasWorkspace, hasOpenFile, themes, currentTheme, recentOpened)
  const isMacOS = isMacOSPlatform(runtimePlatform)
  const [openMenu, setOpenMenu] = useState<number | null>(null)
  const menuBarRef = useRef<HTMLDivElement>(null)
  const dragRegionRef = useRef<HTMLDivElement>(null)
  const titlebarIconRef = useRef<HTMLDivElement>(null)
  const titlebarControlsRef = useRef<HTMLDivElement>(null)

  const handleMinimize = () => window.api?.window.minimize()
  const handleMaximize = () => window.api?.window.maximize()
  const handleClose = () => {
    if (onWindowClose) onWindowClose()
    else window.api?.window.close()
  }

  const closeMenu = useCallback(() => setOpenMenu(null), [])

  const runItem = (item: ResolvedMenuItem): void => {
    if (item.kind !== 'command' || !item.enabled) return
    closeMenu()
    void onCommand?.(item.command, ...(item.args ?? []))
  }

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

  // Electron 标题栏拖拽区域通过运行时属性设置，避免 CSS 兼容性检查误报。
  useEffect(() => {
    dragRegionRef.current?.style.setProperty('-webkit-app-region', openMenu === null ? 'drag' : 'no-drag')
    titlebarIconRef.current?.style.setProperty('-webkit-app-region', 'no-drag')
    menuBarRef.current?.style.setProperty('-webkit-app-region', 'no-drag')
    titlebarControlsRef.current?.style.setProperty('-webkit-app-region', 'no-drag')
  }, [openMenu])

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
      <div className="titlebar-drag" ref={dragRegionRef}>
        {!isMacOS && (
          <div className="titlebar-icon" aria-hidden="true" ref={titlebarIconRef}>
            <img src={ycideLogo} className="titlebar-icon-image" alt="" draggable={false} />
          </div>
        )}
        {!isMacOS && (
          <nav className="titlebar-menu" role="menubar" aria-label="主菜单" ref={menuBarRef}>
          {menus.map((menu, idx) => (
            <div key={menu.id} className="titlebar-menu-item">
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
                    item.kind === 'separator' ? (
                      <div key={i} className="titlebar-dropdown-divider" />
                    ) : item.kind === 'submenu' ? (
                      <div key={i} className="titlebar-dropdown-submenu-wrapper">
                        <button
                          role="menuitem"
                          className="titlebar-dropdown-item titlebar-has-submenu"
                        >
                          <span>{item.label}</span>
                          <span className="titlebar-submenu-arrow">▶</span>
                        </button>
                        <div className="titlebar-submenu" role="menu">
                          {item.items.map((sub, si) =>
                            sub.kind === 'separator' ? (
                              <div key={si} className="titlebar-dropdown-divider" />
                            ) : sub.kind === 'command' ? (
                              <button
                                key={si}
                                role="menuitem"
                                className={`titlebar-dropdown-item${sub.enabled ? '' : ' disabled'}`}
                                disabled={!sub.enabled}
                                onClick={() => runItem(sub)}
                              >
                                <span>{sub.checked ? '✓ ' : '    '}{sub.label}</span>
                                {sub.shortcut && <span className="titlebar-dropdown-shortcut">{sub.shortcut}</span>}
                              </button>
                            ) : null
                          )}
                        </div>
                      </div>
                    ) : (
                      <button
                        key={i}
                        role="menuitem"
                        className={`titlebar-dropdown-item${item.enabled ? '' : ' disabled'}`}
                        disabled={!item.enabled}
                        onClick={() => runItem(item)}
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
        <div className="titlebar-controls" aria-label="窗口控制" ref={titlebarControlsRef}>
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

// memo: App 重渲染时若 props 未变则跳过本组件渲染
export default memo(TitleBar)
