// 快捷键：解析 Electron 加速键格式的按键字符串、匹配键盘事件、生成菜单上显示的按键文字。
//
// 修饰键语义（与改造前的全局快捷键处理保持一致）：
//   CmdOrCtrl —— Ctrl 或 Cmd 任一按下即可（所有平台都这样判断）
//   Ctrl / Cmd —— 只认对应的那一个键
//   Alt、Shift —— 必须与绑定完全一致（多按、少按都不匹配）

import type { PluginHostPlatform } from './manifest'

export interface ParsedKeybinding {
  cmdOrCtrl: boolean
  ctrl: boolean
  cmd: boolean
  alt: boolean
  shift: boolean
  /** 规范化后的主键：字母大写（A-Z）、数字、F1-F24 或命名键（Delete、Enter …） */
  key: string
}

/** 键盘事件中匹配所需的字段，兼容 DOM KeyboardEvent */
export interface KeyEventLike {
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  key: string
  code: string
}

const NAMED_KEYS: Record<string, string> = {
  delete: 'Delete',
  del: 'Delete',
  backspace: 'Backspace',
  enter: 'Enter',
  return: 'Enter',
  escape: 'Escape',
  esc: 'Escape',
  tab: 'Tab',
  space: 'Space',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
}

function normalizeMainKey(raw: string): string | null {
  if (/^[a-z]$/i.test(raw)) return raw.toUpperCase()
  if (/^[0-9]$/.test(raw)) return raw
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(raw)) return raw.toUpperCase()
  return NAMED_KEYS[raw.toLowerCase()] ?? null
}

const parseCache = new Map<string, ParsedKeybinding | null>()

/** 解析按键字符串，如 CmdOrCtrl+Shift+S；无法识别时返回 null */
export function parseKeybinding(source: string): ParsedKeybinding | null {
  if (parseCache.has(source)) return parseCache.get(source) ?? null
  const parts = source.split('+').map(p => p.trim()).filter(Boolean)
  const result: ParsedKeybinding = { cmdOrCtrl: false, ctrl: false, cmd: false, alt: false, shift: false, key: '' }
  let ok = parts.length > 0
  parts.forEach((part, index) => {
    const lower = part.toLowerCase()
    const isLast = index === parts.length - 1
    if (lower === 'cmdorctrl' || lower === 'commandorcontrol') result.cmdOrCtrl = true
    else if (lower === 'ctrl' || lower === 'control') result.ctrl = true
    else if (lower === 'cmd' || lower === 'command' || lower === 'meta' || lower === 'super') result.cmd = true
    else if (lower === 'alt' || lower === 'option') result.alt = true
    else if (lower === 'shift') result.shift = true
    else if (isLast) {
      const key = normalizeMainKey(part)
      if (key) result.key = key
      else ok = false
    } else ok = false
  })
  if (!result.key) ok = false
  const parsed = ok ? result : null
  parseCache.set(source, parsed)
  return parsed
}

/** 从键盘事件取出规范化主键：字母和数字看物理键位（code），其余看 key */
function eventMainKey(event: KeyEventLike): string {
  const letter = /^Key([A-Z])$/.exec(event.code)
  if (letter) return letter[1]
  const digit = /^Digit([0-9])$/.exec(event.code)
  if (digit) return digit[1]
  if (event.key === ' ') return 'Space'
  return normalizeMainKey(event.key) ?? event.key
}

export function matchesKeyEvent(binding: ParsedKeybinding, event: KeyEventLike): boolean {
  if (eventMainKey(event) !== binding.key) return false
  if (event.altKey !== binding.alt) return false
  if (event.shiftKey !== binding.shift) return false
  if (binding.cmdOrCtrl) return event.ctrlKey || event.metaKey
  if (event.ctrlKey !== binding.ctrl) return false
  if (event.metaKey !== binding.cmd) return false
  return true
}

/** 菜单上显示的按键文字，如 Ctrl+Shift+S（macOS 上 CmdOrCtrl 显示为 Cmd） */
export function formatKeybindingLabel(source: string, platform: PluginHostPlatform): string {
  const parsed = parseKeybinding(source)
  if (!parsed) return source
  const parts: string[] = []
  const tokens = source.split('+').map(p => p.trim().toLowerCase())
  for (const token of tokens) {
    if (token === 'cmdorctrl' || token === 'commandorcontrol') parts.push(platform === 'macos' ? 'Cmd' : 'Ctrl')
    else if (token === 'ctrl' || token === 'control') parts.push('Ctrl')
    else if (token === 'cmd' || token === 'command' || token === 'meta' || token === 'super') parts.push('Cmd')
    else if (token === 'alt' || token === 'option') parts.push('Alt')
    else if (token === 'shift') parts.push('Shift')
  }
  parts.push(parsed.key)
  return parts.join('+')
}
