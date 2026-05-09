export type Platform = 'windows' | 'macos' | 'linux'

export type LibraryInstallSource = 'bundled' | 'installed' | 'manual'

export type LibraryInstallStatus = 'missing' | 'downloaded' | 'installed' | 'loaded' | 'error'

export const DEFAULT_LIBRARY_STORE_INDEX_URL = 'https://ycide.dev/libraries/index.json'

export interface LibraryPackageEntry {
  id: string
  displayName: string
  version: string
  packageFileName: string
  packageUrl: string
  packageSha256: string
  size?: number
  supportedPlatforms: Platform[]
  minYcideVersion?: string
  publishedAt?: string
  summary?: string
}

export interface LibraryRemoteIndex {
  schemaVersion: string
  updatedAt?: string
  libraries: LibraryPackageEntry[]
}

export interface InstalledLibraryState {
  id: string
  downloaded: boolean
  installed: boolean
  loaded: boolean
  version: string
  packageSha256: string
  sourceUrl: string
  installedAt: string
  files: string[]
  updateAvailable: boolean
  lastError: string
  disabledReason: string
  source: LibraryInstallSource
}

export interface LibraryInstallStateFile {
  schemaVersion: string
  libraries: Record<string, InstalledLibraryState>
}

export type LibraryRemoteIndexResult =
  | { ok: true; index: LibraryRemoteIndex }
  | { ok: false; error: string }

export type LibraryInstallResult =
  | { ok: true; library: InstalledLibraryState }
  | { ok: false; error: string }

export type LibraryRemoveResult =
  | { ok: true }
  | { ok: false; error: string }

export interface StoreLibraryCard {
  id: string
  displayName: string
  version: string
  supportedPlatforms: Platform[]
  isDownloaded: boolean
  isInstalled?: boolean
  isLoaded: boolean
  isCore: boolean
  source?: LibraryInstallSource
  updateAvailable?: boolean
  lastError?: string
  packageFileName?: string
  packageUrl?: string
  packageSha256?: string
  remoteVersion?: string
}

export const STORE_PLATFORM_ORDER: Platform[] = ['windows', 'macos', 'linux']
