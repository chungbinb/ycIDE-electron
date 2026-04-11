/** 系统设置 */

export interface IDESettings {
  /** 标题栏高度 (px) */
  titlebarHeight: number
  /** 工具栏高度 (px) */
  toolbarHeight: number
  /** 工具栏图标大小 (px) */
  toolbarIconSize: number
  /** 界面字体 */
  fontFamily: string
  /** 界面字号 (px) */
  fontSize: number
}

export const DEFAULT_IDE_SETTINGS: IDESettings = {
  titlebarHeight: 32,
  toolbarHeight: 36,
  toolbarIconSize: 16,
  fontFamily: '"Microsoft YaHei UI", "Segoe UI", system-ui, -apple-system, sans-serif',
  fontSize: 13,
}

export function resolveIDESettings(raw?: Partial<IDESettings> | null): IDESettings {
  const d = DEFAULT_IDE_SETTINGS
  if (!raw || typeof raw !== 'object') return { ...d }
  return {
    titlebarHeight: clampInt(raw.titlebarHeight, 24, 60, d.titlebarHeight),
    toolbarHeight: clampInt(raw.toolbarHeight, 24, 60, d.toolbarHeight),
    toolbarIconSize: clampInt(raw.toolbarIconSize, 12, 32, d.toolbarIconSize),
    fontFamily: typeof raw.fontFamily === 'string' && raw.fontFamily.trim() ? raw.fontFamily.trim() : d.fontFamily,
    fontSize: clampInt(raw.fontSize, 10, 24, d.fontSize),
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}
