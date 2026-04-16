/** 系统设置 */

export interface IDESettings {
  /** 标题栏高度 (px) */
  titlebarHeight: number
  /** 工具栏高度 (px) */
  toolbarHeight: number
  /** 工具栏图标大小 (px) */
  toolbarIconSize: number
  /** 标题栏菜单字体 */
  titlebarMenuFontFamily: string
  /** 标题栏菜单字号 (px) */
  titlebarMenuFontSize: number
  /** 界面字体 */
  fontFamily: string
  /** 界面字号 (px) */
  fontSize: number
  /** 编辑器字体 */
  editorFontFamily: string
  /** 编辑器字号 (px) */
  editorFontSize: number
  /** 编辑器行高 (px) */
  editorLineHeight: number
}

export const DEFAULT_IDE_SETTINGS: IDESettings = {
  titlebarHeight: 32,
  toolbarHeight: 36,
  toolbarIconSize: 16,
  titlebarMenuFontFamily: '"Microsoft YaHei UI", "Segoe UI", system-ui, -apple-system, sans-serif',
  titlebarMenuFontSize: 13,
  fontFamily: '"Microsoft YaHei UI", "Segoe UI", system-ui, -apple-system, sans-serif',
  fontSize: 13,
  editorFontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace',
  editorFontSize: 14,
  editorLineHeight: 20,
}

export function resolveIDESettings(raw?: Partial<IDESettings> | null): IDESettings {
  const d = DEFAULT_IDE_SETTINGS
  if (!raw || typeof raw !== 'object') return { ...d }

  const resolvedFontFamily = typeof raw.fontFamily === 'string' && raw.fontFamily.trim() ? raw.fontFamily.trim() : d.fontFamily
  const resolvedFontSize = clampInt(raw.fontSize, 10, 24, d.fontSize)

  return {
    titlebarHeight: clampInt(raw.titlebarHeight, 24, 60, d.titlebarHeight),
    toolbarHeight: clampInt(raw.toolbarHeight, 24, 60, d.toolbarHeight),
    toolbarIconSize: clampInt(raw.toolbarIconSize, 12, 32, d.toolbarIconSize),
    titlebarMenuFontFamily: typeof raw.titlebarMenuFontFamily === 'string' && raw.titlebarMenuFontFamily.trim()
      ? raw.titlebarMenuFontFamily.trim()
      : resolvedFontFamily,
    titlebarMenuFontSize: clampInt(raw.titlebarMenuFontSize, 10, 24, resolvedFontSize),
    fontFamily: resolvedFontFamily,
    fontSize: resolvedFontSize,
    editorFontFamily: typeof raw.editorFontFamily === 'string' && raw.editorFontFamily.trim()
      ? raw.editorFontFamily.trim()
      : d.editorFontFamily,
    editorFontSize: clampInt(raw.editorFontSize, 10, 30, d.editorFontSize),
    editorLineHeight: clampInt(raw.editorLineHeight, 14, 54, d.editorLineHeight),
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}
