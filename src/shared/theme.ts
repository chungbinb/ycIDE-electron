export const THEME_CONFIG_VERSION = 2 as const
export const BUILTIN_DARK_THEME_ID = '默认深色'

export type ThemeId = string

export interface ThemeDefinition {
  name: ThemeId
  colors: Record<string, string>
}

export interface ThemeConfigV1 {
  currentTheme?: ThemeId
}

export type ThemeConfigErrorCode =
  | 'config_parse_failed'
  | 'persisted_theme_missing'
  | 'theme_load_failed'
  | 'repair_required'

export interface ThemeConfigError {
  code: ThemeConfigErrorCode
  message?: string
  detectedAt: string
}

export interface RetainedInvalidThemeConfig {
  themeId: ThemeId
  reason: string
  detectedAt: string
}

export interface ThemeConfigV2 {
  version: typeof THEME_CONFIG_VERSION
  currentThemeId: ThemeId
  lastError: ThemeConfigError | null
  retainedInvalidTheme: RetainedInvalidThemeConfig | null
}

export type ThemeResolutionWarningCode =
  | 'config_missing'
  | 'config_parse_failed'
  | 'legacy_migrated'
  | 'persisted_theme_missing'
  | 'theme_load_failed'
  | 'repair_required'

export interface ThemeResolutionWarning {
  code: ThemeResolutionWarningCode
  message: string
}

export interface ThemeResolutionResult {
  selectedThemeId: ThemeId
  effectiveThemeId: ThemeId
  warning: ThemeResolutionWarning | null
}
