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
  /** 插件 / 主题：发布者（插件 ID 的前缀） */
  publisher?: string
  /** 插件 / 主题：发布者签名，Ed25519 签名（base64），被签的内容是包的 sha256 十六进制字符串（设计稿 §8.2） */
  signature?: string
  /** 插件：申请的权限，安装前展示给用户确认；包里 plugin.json 申请的权限不能超出这里 */
  permissions?: string[]
}

export interface LibraryRemoteIndex {
  schemaVersion: string
  updatedAt?: string
  libraries: LibraryPackageEntry[]
  /** 发布者公钥：发布者 → Ed25519 公钥（SPKI DER 的 base64）。首次见到后固定在本机，之后变化视为被篡改 */
  publishers?: Record<string, string>
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
