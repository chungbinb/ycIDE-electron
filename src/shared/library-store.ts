export type Platform = 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'harmony'

export type LibraryInstallSource = 'bundled' | 'installed' | 'manual'

export type LibraryInstallStatus = 'missing' | 'downloaded' | 'installed' | 'loaded' | 'error'

export const DEFAULT_LIBRARY_STORE_INDEX_URL = 'https://ycide.dev/libraries/index.json'

/**
 * 商店条目类型：支持库、插件、主题共用同一个索引（设计稿 §13.1 第 4 条）。
 * 支持库管理窗口只列 library；插件、主题由插件管理界面处理。
 */
export type StorePackageKind = 'library' | 'plugin' | 'theme'

export interface LibraryPackageEntry {
  id: string
  /** 缺省为 library，兼容只有支持库的旧索引 */
  kind?: StorePackageKind
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

export const STORE_PLATFORM_ORDER: Platform[] = ['windows', 'macos', 'linux', 'android', 'ios', 'harmony']
