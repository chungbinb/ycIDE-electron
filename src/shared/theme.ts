import {
  DEFAULT_FLOW_LINE_MODE_CONFIG,
  THEME_TOKEN_GROUPS,
  type FlowLineModeConfig
} from './theme-tokens'

export const THEME_CONFIG_VERSION = 2 as const
export const BUILTIN_DARK_THEME_ID = '默认深色'

export type ThemeId = string
export const CUSTOM_THEME_NAME_MAX_LENGTH = 32
const CUSTOM_THEME_NAME_RESERVED_CHARS = /[\\/:*?"<>|]/

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

export type CustomThemeNameValidationCode =
  | 'empty'
  | 'too_long'
  | 'reserved_character'

export interface CustomThemeNameValidationResult {
  valid: boolean
  normalizedName: ThemeId
  code: CustomThemeNameValidationCode | null
  message: string | null
}

export interface SaveAsCustomThemeRequest {
  name: string
  sourceThemeId: ThemeId
  themePayload: ThemeTokenPayload
}

export type SaveAsCustomThemeResult =
  | {
    success: true
    themeId: ThemeId
    themePayload: ThemeTokenPayload
    config: ThemeConfigV2
  }
  | {
    success: false
    code: 'invalid_name' | 'duplicate_name' | 'source_theme_missing' | 'save_failed'
    message: string
    validation?: CustomThemeNameValidationResult
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

export const THEME_PORTABILITY_SCHEMA_VERSION = 1 as const

export interface ThemePortabilityExportDto {
  schemaVersion: typeof THEME_PORTABILITY_SCHEMA_VERSION
  theme: ThemeDefinition
}

export type ThemeImportValidationDiagnosticCode =
  | 'required'
  | 'invalid_type'
  | 'invalid_value'
  | 'unsupported_schema_version'

export interface ThemeImportValidationDiagnostic {
  path: string
  code: ThemeImportValidationDiagnosticCode
  message: string
}

export type ThemeImportValidationResult =
  | {
    success: true
    value: ThemePortabilityExportDto
  }
  | {
    success: false
    diagnostics: ThemeImportValidationDiagnostic[]
  }

export type ThemeImportConflictDecision =
  | {
    decision: 'rename-import'
    newThemeName: ThemeId
  }
  | {
    decision: 'overwrite'
    overwriteThemeId: ThemeId
    overwriteConfirmed: true
  }

export type ThemeImportConflictDecisionValidationResult =
  | {
    success: true
    value: ThemeImportConflictDecision
  }
  | {
    success: false
    diagnostics: ThemeImportValidationDiagnostic[]
  }

export type ThemeImportConflictResolutionResult =
  | {
    status: 'conflict'
    existingThemeId: ThemeId
    allowedDecisions: ThemeImportConflictDecision['decision'][]
  }
  | {
    status: 'ready'
    decision: ThemeImportConflictDecision
  }

const TOKEN_KEYS = THEME_TOKEN_GROUPS.flatMap(group => group.items.map(item => item.tokenKey))

const DEFAULT_THEME_TOKEN_VALUES: Record<string, string> = {
  '--text-primary': '#cccccc',
  '--text-secondary': '#969696',
  '--bg-primary': '#1e1e1e',
  '--bg-secondary': '#252526',
  '--bg-tertiary': '#2d2d2d',
  '--titlebar-bg': '#323233',
  '--statusbar-bg': '#007acc',
  '--statusbar-text': '#ffffff',
  '--toolbar-icon-color': '#e4e4e4',
  '--toolbar-icon-disabled-color': '#d0d0d0',
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

export function validateCustomThemeName(rawName: string): CustomThemeNameValidationResult {
  const normalizedName = (rawName || '').trim()
  if (!normalizedName) {
    return {
      valid: false,
      normalizedName,
      code: 'empty',
      message: '主题名称不能为空。',
    }
  }
  if (normalizedName.length > CUSTOM_THEME_NAME_MAX_LENGTH) {
    return {
      valid: false,
      normalizedName,
      code: 'too_long',
      message: `主题名称长度不能超过${CUSTOM_THEME_NAME_MAX_LENGTH}个字符。`,
    }
  }
  if (CUSTOM_THEME_NAME_RESERVED_CHARS.test(normalizedName)) {
    return {
      valid: false,
      normalizedName,
      code: 'reserved_character',
      message: '主题名称包含非法字符（\\ / : * ? \" < > |）。',
    }
  }
  return {
    valid: true,
    normalizedName,
    code: null,
    message: null,
  }
}

export function validateThemePortabilityImportPayload(payload: unknown): ThemeImportValidationResult {
  const diagnostics: ThemeImportValidationDiagnostic[] = []
  const data = payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : null

  if (!data) {
    diagnostics.push({
      path: '$',
      code: 'invalid_type',
      message: '导入内容必须是 JSON 对象。',
    })
    return { success: false, diagnostics }
  }

  if (typeof data.schemaVersion !== 'number') {
    diagnostics.push({
      path: 'schemaVersion',
      code: 'invalid_type',
      message: 'schemaVersion 必须是数字。',
    })
  } else if (data.schemaVersion !== THEME_PORTABILITY_SCHEMA_VERSION) {
    diagnostics.push({
      path: 'schemaVersion',
      code: 'unsupported_schema_version',
      message: '仅支持 schemaVersion=1。',
    })
  }

  const theme = data.theme && typeof data.theme === 'object'
    ? data.theme as Record<string, unknown>
    : null
  if (!theme) {
    diagnostics.push({
      path: 'theme',
      code: 'required',
      message: '缺少 theme 对象。',
    })
  }

  const themeName = typeof theme?.name === 'string' ? theme.name.trim() : ''
  if (!themeName) {
    diagnostics.push({
      path: 'theme.name',
      code: 'required',
      message: 'theme.name 不能为空。',
    })
  }

  const colors = theme?.colors && typeof theme.colors === 'object'
    ? theme.colors as Record<string, unknown>
    : null
  if (!colors) {
    diagnostics.push({
      path: 'theme.colors',
      code: 'required',
      message: 'theme.colors 必须是对象。',
    })
  } else {
    for (const [key, value] of Object.entries(colors)) {
      if (typeof value !== 'string') {
        diagnostics.push({
          path: `theme.colors.${key}`,
          code: 'invalid_type',
          message: '主题颜色值必须是字符串。',
        })
      }
    }
  }

  if (diagnostics.length > 0) {
    return { success: false, diagnostics }
  }

  return {
    success: true,
    value: {
      schemaVersion: THEME_PORTABILITY_SCHEMA_VERSION,
      theme: {
        name: themeName,
        colors: colors as Record<string, string>,
      },
    },
  }
}

export function validateThemeImportConflictDecision(value: unknown): ThemeImportConflictDecisionValidationResult {
  const diagnostics: ThemeImportValidationDiagnostic[] = []
  const decision = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : null

  if (!decision) {
    return {
      success: false,
      diagnostics: [{
        path: 'decision',
        code: 'required',
        message: '必须提供冲突处理决策。',
      }],
    }
  }

  if (decision.decision === 'rename-import') {
    if (typeof decision.newThemeName !== 'string' || !decision.newThemeName.trim()) {
      diagnostics.push({
        path: 'newThemeName',
        code: 'required',
        message: 'rename-import 需要提供 newThemeName。',
      })
    }
    if ('overwriteThemeId' in decision || 'overwriteConfirmed' in decision) {
      diagnostics.push({
        path: 'decision',
        code: 'invalid_value',
        message: 'rename-import 分支不能携带 overwrite 字段。',
      })
    }
    if (diagnostics.length > 0) return { success: false, diagnostics }
    return {
      success: true,
      value: {
        decision: 'rename-import',
        newThemeName: decision.newThemeName.trim(),
      },
    }
  }

  if (decision.decision === 'overwrite') {
    if (typeof decision.overwriteThemeId !== 'string' || !decision.overwriteThemeId.trim()) {
      diagnostics.push({
        path: 'overwriteThemeId',
        code: 'required',
        message: 'overwrite 需要提供 overwriteThemeId。',
      })
    }
    if (decision.overwriteConfirmed !== true) {
      diagnostics.push({
        path: 'overwriteConfirmed',
        code: 'invalid_value',
        message: 'overwrite 需要 overwriteConfirmed=true。',
      })
    }
    if ('newThemeName' in decision) {
      diagnostics.push({
        path: 'decision',
        code: 'invalid_value',
        message: 'overwrite 分支不能携带 newThemeName。',
      })
    }
    if (diagnostics.length > 0) return { success: false, diagnostics }
    return {
      success: true,
      value: {
        decision: 'overwrite',
        overwriteThemeId: decision.overwriteThemeId.trim(),
        overwriteConfirmed: true,
      },
    }
  }

  return {
    success: false,
    diagnostics: [{
      path: 'decision',
      code: 'invalid_value',
      message: '冲突决策仅支持 rename-import 或 overwrite。',
    }],
  }
}
