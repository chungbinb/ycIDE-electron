import {
  getPrimaryModifierLabel,
  getQuitShortcutLabel,
  getRedoShortcutLabel,
  isMacOSPlatform,
  type RuntimePlatform,
} from '../../../shared/shortcut-config'

export {
  getPrimaryModifierLabel,
  getQuitShortcutLabel,
  getRedoShortcutLabel,
  isMacOSPlatform,
  type RuntimePlatform,
}

export function isRedoShortcut(event: KeyboardEvent, platform: RuntimePlatform): boolean {
  const ctrl = event.ctrlKey || event.metaKey
  if (!ctrl) return false
  const key = event.code === 'KeyZ' || event.key.toLowerCase() === 'z'
    ? 'z'
    : event.code === 'KeyY' || event.key.toLowerCase() === 'y'
      ? 'y'
      : ''
  if (key === 'y') return true
  return isMacOSPlatform(platform) && key === 'z' && event.shiftKey
}
