// 控件「字体」属性的共享数据模型与解析（面板选择器、设计器预览、导出均复用）。
// 字体值以 JSON 字符串形式存放在控件 properties['字体'] 里；空串/未设 = 使用默认字体。

export interface FontSpec {
  name: string
  size: number          // 磅（point）
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikeout?: boolean
  color?: number        // 文本颜色 COLORREF(0xBBGGRR)；undefined = 默认文本色
}

// COLORREF(0xBBGGRR) ↔ CSS/hex
export function colorrefToHex(c: number): string {
  const n = (c >>> 0) & 0xffffff
  const r = n & 0xff, g = (n >> 8) & 0xff, b = (n >> 16) & 0xff
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}
export function hexToColorref(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0
  const v = Number.parseInt(m[1], 16)
  const r = (v >> 16) & 0xff, g = (v >> 8) & 0xff, b = v & 0xff
  return r | (g << 8) | (b << 16)
}

export const DEFAULT_FONT_NAME = '宋体'
export const DEFAULT_FONT_SIZE = 9

// 常用中英文字体（自绘字体选择器的候选；系统未装的字体运行时会回退到相近字体）。
export const COMMON_FONT_FAMILIES = [
  '宋体', '新宋体', '微软雅黑', '黑体', '楷体', '仿宋', '等线', '幼圆',
  'Arial', 'Times New Roman', 'Courier New', 'Consolas', 'Tahoma', 'Segoe UI', 'Verdana',
]

export function parseFontSpec(value: unknown): FontSpec | null {
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return null
  try {
    const o = JSON.parse(value) as Partial<FontSpec>
    if (o && typeof o === 'object' && typeof o.name === 'string' && o.name.trim()) {
      return {
        name: o.name.trim(),
        size: Number.isFinite(o.size) && (o.size as number) > 0 ? Math.round(o.size as number) : DEFAULT_FONT_SIZE,
        bold: !!o.bold,
        italic: !!o.italic,
        underline: !!o.underline,
        strikeout: !!o.strikeout,
        color: typeof o.color === 'number' && o.color >= 0 ? Math.floor(o.color) : undefined,
      }
    }
  } catch { /* 非法 JSON → 视为未设 */ }
  return null
}

export function stringifyFontSpec(f: FontSpec): string {
  return JSON.stringify(f)
}

export function formatFontSummary(f: FontSpec | null): string {
  if (!f) return '（默认字体）'
  const parts: string[] = []
  if (f.bold) parts.push('粗')
  if (f.italic) parts.push('斜')
  if (f.underline) parts.push('下划线')
  if (f.strikeout) parts.push('删除线')
  return `${f.name} ${f.size}${parts.length ? ' ' + parts.join('/') : ''}`
}

// 字体 → CSS 声明（设计器预览用）。
export function fontSpecToCss(f: FontSpec | null): {
  fontFamily?: string
  fontSize?: string
  fontWeight?: string
  fontStyle?: string
  textDecoration?: string
  color?: string
} {
  if (!f) return {}
  const deco: string[] = []
  if (f.underline) deco.push('underline')
  if (f.strikeout) deco.push('line-through')
  return {
    fontFamily: `"${f.name}"`,
    // 磅→px 近似（96dpi：1pt ≈ 1.333px）
    fontSize: `${Math.round(f.size * 96 / 72)}px`,
    fontWeight: f.bold ? '700' : '400',
    fontStyle: f.italic ? 'italic' : 'normal',
    textDecoration: deco.length ? deco.join(' ') : 'none',
    ...(typeof f.color === 'number' ? { color: colorrefToHex(f.color) } : {}),
  }
}
