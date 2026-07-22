import type { AICustomModelConfig, AISupportedModel } from './ai'
import { DEFAULT_LIBRARY_STORE_INDEX_URL } from './library-store'

/** 系统设置 */

export interface IDESettings {
  /** 标题栏高度 (px) */
  titlebarHeight: number
  /** 工具栏高度 (px) */
  toolbarHeight: number
  /** 工具栏图标大小 (px) */
  toolbarIconSize: number
  /** 标题栏菜单字体 */
  titlebarMenuFontFamily: string
  /** 标题栏菜单字号 (px) */
  titlebarMenuFontSize: number
  /** 界面字体 */
  fontFamily: string
  /** 界面字号 (px) */
  fontSize: number
  /** 编辑器字体 */
  editorFontFamily: string
  /** 编辑器字号 (px) */
  editorFontSize: number
  /** 编辑器行高 (px) */
  editorLineHeight: number
  /** 子程序表头冻结 */
  editorFreezeSubTableHeader: boolean
  /** 代码预览区（缩略图） */
  editorShowMinimapPreview: boolean
  /** 编辑器右侧变量汇总面板 */
  editorShowVarSummaryPanel: boolean
  /** AI 助手字体 */
  aiFontFamily: string
  /** AI 助手字号 (px) */
  aiFontSize: number
  /** AI 默认模型 */
  aiModel: AISupportedModel
  /** DeepSeek API Key */
  aiDeepseekApiKey: string
  /** GLM API Key */
  aiGlmApiKey: string
  /** 自定义模型列表 */
  aiCustomModels: AICustomModelConfig[]
  /** 支持库在线索引地址 */
  libraryStoreIndexUrl: string
  /**
   * Zig 编译器可执行文件路径（绿色版解压后手动指定）。
   * 空 = 按内置目录（IDE 目录下 compiler/zig 等）自动查找。
   */
  compilerZigPath: string
  /**
   * 编译（生成可执行文件）时的优化级别。
   * 「运行/调试」始终用 O0 保证响应速度，不受此项影响。
   */
  compilerOptimizeLevel: 'O0' | 'O1' | 'O2' | 'Os'
  androidSdkPath: string
  androidGradlePath: string
  androidAdbPath: string
  androidGradlePluginVersion: string
  androidCompileSdk: number
  androidMinSdk: number
  androidTargetSdk: number
  androidPackagePrefix: string
  androidEmulatorKind: 'ldplayer' | 'android-studio' | 'custom'
  androidEmulatorExePath: string
  androidEmulatorLaunchArgs: string
  androidAdbConnectAddress: string
  androidAdbDeviceId: string
  androidAutoStartEmulator: boolean
}

export const DEFAULT_IDE_SETTINGS: IDESettings = {
  titlebarHeight: 32,
  toolbarHeight: 36,
  toolbarIconSize: 16,
  titlebarMenuFontFamily: '"Microsoft YaHei UI", "Segoe UI", system-ui, -apple-system, sans-serif',
  titlebarMenuFontSize: 13,
  fontFamily: '"Microsoft YaHei UI", "Segoe UI", system-ui, -apple-system, sans-serif',
  fontSize: 13,
  editorFontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace',
  editorFontSize: 14,
  editorLineHeight: 20,
  editorFreezeSubTableHeader: false,
  editorShowMinimapPreview: true,
  editorShowVarSummaryPanel: true,
  aiFontFamily: '"Microsoft YaHei UI", "Segoe UI", system-ui, -apple-system, sans-serif',
  aiFontSize: 13,
  aiModel: 'deepseek',
  aiDeepseekApiKey: '',
  aiGlmApiKey: '',
  aiCustomModels: [],
  libraryStoreIndexUrl: DEFAULT_LIBRARY_STORE_INDEX_URL,
  compilerZigPath: '',
  compilerOptimizeLevel: 'O2',
  androidSdkPath: '',
  androidGradlePath: '',
  androidAdbPath: '',
  androidGradlePluginVersion: '8.5.2',
  androidCompileSdk: 35,
  androidMinSdk: 23,
  androidTargetSdk: 35,
  androidPackagePrefix: 'com.ycide.app',
  androidEmulatorKind: 'ldplayer',
  androidEmulatorExePath: '',
  androidEmulatorLaunchArgs: '',
  androidAdbConnectAddress: '',
  androidAdbDeviceId: '',
  androidAutoStartEmulator: false,
}

export function resolveIDESettings(raw?: Partial<IDESettings> | null): IDESettings {
  const d = DEFAULT_IDE_SETTINGS
  if (!raw || typeof raw !== 'object') return { ...d }

  const resolvedFontFamily = typeof raw.fontFamily === 'string' && raw.fontFamily.trim() ? raw.fontFamily.trim() : d.fontFamily
  const resolvedFontSize = clampInt(raw.fontSize, 10, 24, d.fontSize)

  return {
    titlebarHeight: clampInt(raw.titlebarHeight, 24, 60, d.titlebarHeight),
    toolbarHeight: clampInt(raw.toolbarHeight, 24, 60, d.toolbarHeight),
    toolbarIconSize: clampInt(raw.toolbarIconSize, 12, 32, d.toolbarIconSize),
    titlebarMenuFontFamily: typeof raw.titlebarMenuFontFamily === 'string' && raw.titlebarMenuFontFamily.trim()
      ? raw.titlebarMenuFontFamily.trim()
      : resolvedFontFamily,
    titlebarMenuFontSize: clampInt(raw.titlebarMenuFontSize, 10, 24, resolvedFontSize),
    fontFamily: resolvedFontFamily,
    fontSize: resolvedFontSize,
    editorFontFamily: typeof raw.editorFontFamily === 'string' && raw.editorFontFamily.trim()
      ? raw.editorFontFamily.trim()
      : d.editorFontFamily,
    editorFontSize: clampInt(raw.editorFontSize, 10, 30, d.editorFontSize),
    editorLineHeight: clampInt(raw.editorLineHeight, 14, 54, d.editorLineHeight),
    editorFreezeSubTableHeader: typeof raw.editorFreezeSubTableHeader === 'boolean'
      ? raw.editorFreezeSubTableHeader
      : d.editorFreezeSubTableHeader,
    editorShowMinimapPreview: typeof raw.editorShowMinimapPreview === 'boolean'
      ? raw.editorShowMinimapPreview
      : d.editorShowMinimapPreview,
    editorShowVarSummaryPanel: typeof raw.editorShowVarSummaryPanel === 'boolean'
      ? raw.editorShowVarSummaryPanel
      : d.editorShowVarSummaryPanel,
    aiFontFamily: typeof raw.aiFontFamily === 'string' && raw.aiFontFamily.trim()
      ? raw.aiFontFamily.trim()
      : d.aiFontFamily,
    aiFontSize: clampInt(raw.aiFontSize, 10, 24, d.aiFontSize),
    aiModel: resolveAIModel(raw.aiModel, d.aiModel),
    aiDeepseekApiKey: resolveSecret(raw.aiDeepseekApiKey, d.aiDeepseekApiKey),
    aiGlmApiKey: resolveSecret(raw.aiGlmApiKey, d.aiGlmApiKey),
    aiCustomModels: resolveCustomModels(raw.aiCustomModels),
    libraryStoreIndexUrl: resolveUrl(raw.libraryStoreIndexUrl, d.libraryStoreIndexUrl),
    compilerZigPath: resolvePath(raw.compilerZigPath, d.compilerZigPath),
    compilerOptimizeLevel: resolveOptimizeLevel(raw.compilerOptimizeLevel, d.compilerOptimizeLevel),
    androidSdkPath: resolvePath(raw.androidSdkPath, d.androidSdkPath),
    androidGradlePath: resolvePath(raw.androidGradlePath, d.androidGradlePath),
    androidAdbPath: resolvePath(raw.androidAdbPath, d.androidAdbPath),
    androidGradlePluginVersion: resolveText(raw.androidGradlePluginVersion, d.androidGradlePluginVersion),
    androidCompileSdk: clampInt(raw.androidCompileSdk, 23, 99, d.androidCompileSdk),
    androidMinSdk: clampInt(raw.androidMinSdk, 21, 99, d.androidMinSdk),
    androidTargetSdk: clampInt(raw.androidTargetSdk, 23, 99, d.androidTargetSdk),
    androidPackagePrefix: resolvePackagePrefix(raw.androidPackagePrefix, d.androidPackagePrefix),
    androidEmulatorKind: resolveAndroidEmulatorKind(raw.androidEmulatorKind, d.androidEmulatorKind),
    androidEmulatorExePath: resolvePath(raw.androidEmulatorExePath, d.androidEmulatorExePath),
    androidEmulatorLaunchArgs: resolveText(raw.androidEmulatorLaunchArgs, d.androidEmulatorLaunchArgs),
    androidAdbConnectAddress: resolveText(raw.androidAdbConnectAddress, d.androidAdbConnectAddress),
    androidAdbDeviceId: resolveText(raw.androidAdbDeviceId, d.androidAdbDeviceId),
    androidAutoStartEmulator: typeof raw.androidAutoStartEmulator === 'boolean'
      ? raw.androidAutoStartEmulator
      : d.androidAutoStartEmulator,
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function resolveAIModel(value: unknown, fallback: AISupportedModel): AISupportedModel {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  return normalized || fallback
}

function resolveSecret(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  return value.trim()
}

function resolveText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  return value.trim()
}

function resolvePath(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  return value.trim()
}

function resolvePackagePrefix(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, '')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '')
  return normalized.includes('.') ? normalized : fallback
}

function resolveAndroidEmulatorKind(value: unknown, fallback: IDESettings['androidEmulatorKind']): IDESettings['androidEmulatorKind'] {
  if (value === 'ldplayer' || value === 'android-studio' || value === 'custom') return value
  return fallback
}

function resolveUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

function resolveCustomModels(value: unknown): AICustomModelConfig[] {
  if (!Array.isArray(value)) return []
  const out: AICustomModelConfig[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Partial<AICustomModelConfig>
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    const label = typeof raw.label === 'string' ? raw.label.trim() : ''
    const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint.trim() : ''
    const modelName = typeof raw.modelName === 'string' ? raw.modelName.trim() : ''
    const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : ''
    if (!id || !label || !endpoint || !modelName) continue
    out.push({ id, label, endpoint, modelName, apiKey })
  }
  return out
}

/** 优化级别：只认白名单，非法值回落默认（避免脏配置把非法参数传给编译器） */
function resolveOptimizeLevel(value: unknown, fallback: IDESettings['compilerOptimizeLevel']): IDESettings['compilerOptimizeLevel'] {
  return (value === 'O0' || value === 'O1' || value === 'O2' || value === 'Os') ? value : fallback
}
