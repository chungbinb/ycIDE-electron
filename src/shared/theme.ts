import {
  DEFAULT_FLOW_LINE_MODE_CONFIG,
  THEME_TOKEN_GROUPS,
  type FlowLineModeConfig
} from './theme-tokens'

export const THEME_CONFIG_VERSION = 2 as const
export const BUILTIN_DARK_THEME_ID = '默认深色'

export type ThemeId = string

export interface ThemeDefinition {
  name: ThemeId
  colors: Record<string, string>
}

export interface ThemeTokenPayload {
  tokenValues: Record<string, string>
  flowLine: FlowLineModeConfig
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
  themePayloads: Record<ThemeId, ThemeTokenPayload>
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
  themePayload: ThemeTokenPayload
  warning: ThemeResolutionWarning | null
}

const TOKEN_KEYS = THEME_TOKEN_GROUPS.flatMap(group => group.items.map(item => item.tokenKey))

const DEFAULT_THEME_TOKEN_VALUES: Record<string, string> = {
  '--text-primary': '#cccccc',
  '--text-secondary': '#969696',
  '--bg-primary': '#1e1e1e',
  '--bg-secondary': '#252526',
  '--bg-tertiary': '#2d2d2d',
  '--syntax-keyword': '#569cd6',
  '--syntax-string': '#ce9178',
  '--syntax-number': '#b5cea8',
  '--syntax-comment': '#6a9955',
  '--syntax-function': '#dcdcaa',
  '--syntax-type': '#4ec9b0',
  '--syntax-variable': '#9cdcfe',
  '--syntax-operator': '#d4d4d4',
  '--table-bg': '#1e1e1e',
  '--table-text': '#d4d4d4',
  '--table-border': '#3c3c3c',
  '--table-header-bg': '#252526',
  '--table-header-text': '#ffffff',
  '--table-row-hover-bg': '#2a2d2e',
  '--table-selection-bg': '#264f78',
  '--flow-line-main': '#4fc1ff',
  '--flow-line-branch': '#4fc1ff',
  '--flow-line-loop': '#4fc1ff',
  '--flow-line-arrow': '#4fc1ff',
  '--flow-line-inner-link': '#4fc1ff',
}

function isFlowLineModeConfig(value: unknown): value is FlowLineModeConfig {
  if (!value || typeof value !== 'object') return false
  const data = value as FlowLineModeConfig
  return (data.mode === 'single' || data.mode === 'multi')
    && typeof data.single?.mainColor === 'string'
    && typeof data.multi?.mainColor === 'string'
    && typeof data.multi?.depthHueStep === 'number'
    && typeof data.multi?.depthSaturationStep === 'number'
    && typeof data.multi?.depthLightnessStep === 'number'
}

export function sanitizeThemeTokenValues(values: unknown): Record<string, string> {
  const tokenValues = typeof values === 'object' && values !== null
    ? values as Record<string, unknown>
    : {}
  const sanitized: Record<string, string> = {}
  for (const key of TOKEN_KEYS) {
    const value = tokenValues[key]
    sanitized[key] = typeof value === 'string' ? value : DEFAULT_THEME_TOKEN_VALUES[key]
  }
  return sanitized
}

export function createDefaultThemeTokenPayload(defaultValues?: Record<string, string>): ThemeTokenPayload {
  return {
    tokenValues: sanitizeThemeTokenValues(defaultValues || DEFAULT_THEME_TOKEN_VALUES),
    flowLine: {
      mode: DEFAULT_FLOW_LINE_MODE_CONFIG.mode,
      single: { ...DEFAULT_FLOW_LINE_MODE_CONFIG.single },
      multi: { ...DEFAULT_FLOW_LINE_MODE_CONFIG.multi },
    },
  }
}

export function resolveThemeTokenPayload(payload: unknown, fallbackValues?: Record<string, string>): ThemeTokenPayload {
  const data = (payload && typeof payload === 'object') ? payload as Partial<ThemeTokenPayload> : {}
  const defaults = createDefaultThemeTokenPayload(fallbackValues)
  return {
    tokenValues: sanitizeThemeTokenValues(data.tokenValues || defaults.tokenValues),
    flowLine: isFlowLineModeConfig(data.flowLine)
      ? {
        mode: data.flowLine.mode,
        single: { ...data.flowLine.single },
        multi: { ...data.flowLine.multi },
      }
      : defaults.flowLine,
  }
}

export function createDefaultThemeConfig(
  themeId: ThemeId = BUILTIN_DARK_THEME_ID,
  themePayload?: ThemeTokenPayload
): ThemeConfigV2 {
  return {
    version: THEME_CONFIG_VERSION,
    currentThemeId: themeId,
    themePayloads: {
      [themeId]: themePayload ? resolveThemeTokenPayload(themePayload) : createDefaultThemeTokenPayload(),
    },
    lastError: null,
    retainedInvalidTheme: null,
  }
}

export function isThemeConfigV1(value: unknown): value is ThemeConfigV1 {
  if (!value || typeof value !== 'object') return false
  const data = value as ThemeConfigV1
  return data.currentTheme === undefined || typeof data.currentTheme === 'string'
}

export function isThemeConfigV2(value: unknown): value is ThemeConfigV2 {
  if (!value || typeof value !== 'object') return false
  const data = value as ThemeConfigV2
  return data.version === THEME_CONFIG_VERSION
    && typeof data.currentThemeId === 'string'
    && !!data.themePayloads
    && typeof data.themePayloads === 'object'
    && (data.lastError === null || typeof data.lastError === 'object')
    && (data.retainedInvalidTheme === null || typeof data.retainedInvalidTheme === 'object')
}
