// 颜色的单一真源：主进程(编译器)与渲染进程(编辑器 / Sidebar / 设计器)共用。
// 颜色统一存 Win32 COLORREF 整数（0x00BBGGRR，低字节 = 红）。
// 主进程不能 import renderer 代码，故名色表与转换必须放在 src/shared。

// 名色 → COLORREF。值与 Sidebar 的 COMMON_COLOR_NAMES 一致（0xBBGGRR）。
export const NAMED_COLORS: Record<string, number> = {
  黑色: 0x000000,
  白色: 0xffffff,
  红色: 0x0000ff, // BB=00 GG=00 RR=FF = 纯红
  绿色: 0x00ff00,
  蓝色: 0xff0000, // BB=FF GG=00 RR=00 = 纯蓝
  黄色: 0x00ffff,
  青色: 0xffff00,
  紫红色: 0xff00ff,
  灰色: 0x808080,
}

// COLORREF(0x00BBGGRR) → CSS #RRGGBB
export function colorrefToHex(c: number): string {
  const n = (c >>> 0) & 0xffffff
  const r = n & 0xff, g = (n >> 8) & 0xff, b = (n >> 16) & 0xff
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

// CSS #RRGGBB（可带 #，须 6 位）→ COLORREF(0x00BBGGRR)。非法返回 0（=黑，合法 COLORREF）。
export function hexToColorref(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0
  const v = Number.parseInt(m[1], 16)
  const r = (v >> 16) & 0xff, g = (v >> 8) & 0xff, b = v & 0xff
  return r | (g << 8) | (b << 16)
}

// 解析单个颜色字面量 token → COLORREF | null（非颜色返回 null）。
// 支持：#RGB（三位缩写，逐位加倍）/ #RRGGBB / #RRGGBBAA（丢弃 alpha）/ #名色。
export function parseColorLiteralToColorref(token: string): number | null {
  if (!token || token[0] !== '#') return null
  const body = token.slice(1)
  if (/^[0-9a-fA-F]+$/.test(body)) {
    let six: string | null = null
    if (body.length === 3) six = body[0] + body[0] + body[1] + body[1] + body[2] + body[2]
    else if (body.length === 6) six = body
    else if (body.length === 8) six = body.slice(0, 6) // #RRGGBBAA：文本颜色无 alpha，丢弃 AA
    return six ? hexToColorref(six) : null
  }
  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, body)) return NAMED_COLORS[body]
  return null
}
