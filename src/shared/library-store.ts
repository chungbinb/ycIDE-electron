export type Platform = 'windows' | 'macos' | 'linux'

export interface StoreLibraryCard {
  id: string
  displayName: string
  version: string
  supportedPlatforms: Platform[]
  isDownloaded: boolean
  isLoaded: boolean
  isCore: boolean
}

export const STORE_PLATFORM_ORDER: Platform[] = ['windows', 'macos', 'linux']
