export type RuntimePlatform = 'windows' | 'macos' | 'linux' | 'harmony'

export function isMacOSPlatform(platform: RuntimePlatform): boolean {
  return platform === 'macos'
}

export function getPrimaryModifierLabel(platform: RuntimePlatform): string {
  return isMacOSPlatform(platform) ? 'Cmd' : 'Ctrl'
}

export function getRedoShortcutLabel(platform: RuntimePlatform): string {
  return isMacOSPlatform(platform) ? 'Cmd+Shift+Z' : 'Ctrl+Y'
}

export function getQuitShortcutLabel(platform: RuntimePlatform): string {
  return isMacOSPlatform(platform) ? 'Cmd+Q' : 'Alt+F4'
}
