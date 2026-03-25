export type RuntimePlatform = 'windows' | 'macos' | 'linux' | 'harmony'

const ACTION_ACCELERATOR_MAP: Record<string, string> = {
  'file:newProject': 'CmdOrCtrl+Shift+N',
  'file:openProject': 'CmdOrCtrl+Shift+O',
  'file:save': 'CmdOrCtrl+S',
  'file:saveAll': 'CmdOrCtrl+Shift+S',
  'file:closeFile': 'CmdOrCtrl+W',
  'file:exit': 'CmdOrCtrl+Q',
  'edit:find': 'CmdOrCtrl+F',
  'edit:replace': 'CmdOrCtrl+H',
  'build:compile': 'CmdOrCtrl+F7',
  'debug:runToCursor': 'CmdOrCtrl+F10',
}

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

export function getActionAccelerator(action: string): string | undefined {
  return ACTION_ACCELERATOR_MAP[action]
}
