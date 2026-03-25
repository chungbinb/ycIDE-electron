export type RuntimePlatform = 'windows' | 'macos' | 'linux' | 'harmony'

export function normalizeRuntimePlatform(platform: string): RuntimePlatform {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  if (platform === 'linux') return 'linux'
  if (platform === 'harmony') return 'harmony'
  return 'linux'
}

export function isDesktopRuntime(platform: RuntimePlatform): boolean {
  return platform === 'windows' || platform === 'macos' || platform === 'linux'
}
