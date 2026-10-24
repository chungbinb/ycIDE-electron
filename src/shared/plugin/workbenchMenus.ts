// 工作台的动态子菜单内容（最近打开、主题列表）。自绘标题栏菜单与 macOS 原生菜单共用。

import type { DynamicMenuEntry } from './contributions'

export const RECENT_OPENED_SUBMENU = 'ycide.recentOpened'
export const THEMES_SUBMENU = 'ycide.themes'

export interface RecentOpenedEntry {
  type: 'project' | 'file'
  path: string
  label: string
}

export function buildRecentOpenedEntries(items: RecentOpenedEntry[]): DynamicMenuEntry[] {
  return items.slice(0, 10).map(item => ({
    label: `${item.type === 'project' ? '项目' : '文件'}: ${item.label}`,
    command: 'file:openRecent',
    args: [{ type: item.type, path: item.path }],
  }))
}

/** 内置主题在前、自定义主题在后，两组之间加分隔线；当前主题打勾 */
export function buildThemeEntries(themes: string[], currentTheme: string, builtinThemeIds: readonly string[]): DynamicMenuEntry[] {
  const builtin = builtinThemeIds.filter(id => themes.includes(id))
  const custom = themes.filter(id => !builtinThemeIds.includes(id))
  const toEntry = (themeId: string): DynamicMenuEntry => ({
    label: themeId,
    command: 'theme:apply',
    args: [themeId],
    checked: themeId === currentTheme,
  })
  const entries = builtin.map(toEntry)
  if (builtin.length > 0 && custom.length > 0) entries.push({ label: '', separator: true })
  return [...entries, ...custom.map(toEntry)]
}
