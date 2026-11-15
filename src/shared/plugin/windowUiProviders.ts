import type { PluginManifest } from './manifest'

export const LEGACY_WINDOW_UI_PROVIDER = 'ycide.krnln.win32'
export const EUI_WINDOW_UI_PROVIDER = 'ycide.eui.selfdraw'
export const WINDOW_CONTROL_ADAPTERS = ['eui', 'win32'] as const
export type WindowControlAdapter = typeof WINDOW_CONTROL_ADAPTERS[number]

export interface WindowUiPreviewTheme {
  light: Record<string, number[]>
  dark: Record<string, number[]>
  bodyFontSize: number
  buttonRadius: number
  inputRadius: number
  titlebarHeight: number
  captionButtonWidth: number
  titleFontSize: number
  windowBorderWidth: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseWindowUiPreviewTheme(value: unknown): WindowUiPreviewTheme | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('窗口主题 token 必须是对象')
  const source = value
  const palette = (raw: unknown): Record<string, number[]> => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('窗口主题缺少颜色')
    const colors: Record<string, number[]> = {}
    for (const key of ['background', 'primary', 'surface', 'surfaceHover', 'surfaceActive', 'text', 'border', 'buttonText', 'buttonHover', 'buttonPressed']) {
      const value: unknown = Reflect.get(raw, key)
      if (!Array.isArray(value) || value.length !== 4 || value.some(channel => typeof channel !== 'number' || !Number.isFinite(channel) || channel < 0 || channel > 1)) throw new Error(`窗口主题颜色无效：${key}`)
      colors[key] = value.map(Number)
    }
    return colors
  }
  for (const key of ['bodyFontSize', 'buttonRadius', 'inputRadius', 'titlebarHeight', 'captionButtonWidth', 'titleFontSize', 'windowBorderWidth']) {
    if (typeof source[key] !== 'number' || !Number.isFinite(source[key]) || source[key] < 0 || source[key] > 96) throw new Error(`窗口主题尺寸无效：${key}`)
  }
  if (Number(source.titlebarHeight) < 24 || Number(source.captionButtonWidth) < 48 || Number(source.titleFontSize) < 8 || Number(source.windowBorderWidth) > 4) throw new Error('窗口外壳尺寸无效')
  return {
    light: palette(source.light), dark: palette(source.dark),
    bodyFontSize: Number(source.bodyFontSize), buttonRadius: Number(source.buttonRadius), inputRadius: Number(source.inputRadius),
    titlebarHeight: Number(source.titlebarHeight), captionButtonWidth: Number(source.captionButtonWidth),
    titleFontSize: Number(source.titleFontSize), windowBorderWidth: Number(source.windowBorderWidth),
  }
}

export interface WindowUiProvider {
  id: string
  displayName: string
  library: string
  apiVersion: number
  targets: string[]
  rootWindowType: string
  runtimeAdapter: string
  designerAdapter: string
  compilerId: string
  controlAdapters?: WindowControlAdapter[]
  experimental?: boolean
}

export interface WindowUiProviderEntry extends WindowUiProvider {
  pluginId: string
  pluginVersion: string
  available: boolean
  reason?: string
}

export interface WindowUiProject {
  uiProvider: string
  uiProviderApiVersion?: number
  uiProviderPluginVersion?: string
}

export function readWindowUiProject(content: string): WindowUiProject {
  const values = new Map<string, string>()
  for (const line of content.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index > 0) values.set(line.slice(0, index).trim(), line.slice(index + 1).trim())
  }
  const version = values.get('UiProviderApiVersion')
  return {
    uiProvider: values.get('UiProvider') ?? LEGACY_WINDOW_UI_PROVIDER,
    uiProviderApiVersion: version === undefined ? undefined : Number(version),
    uiProviderPluginVersion: values.get('UiProviderPluginVersion'),
  }
}

export function validateWindowUiProviders(value: unknown, pluginId: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) return ['windowUiProviders 必须是数组']
  const errors: string[] = []
  const ids = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push('windowUiProviders 项必须是对象')
      continue
    }
    const entry: Record<string, unknown> = item
    for (const key of ['id', 'displayName', 'library', 'rootWindowType', 'runtimeAdapter', 'designerAdapter', 'compilerId']) {
      if (typeof entry[key] !== 'string' || !entry[key].trim()) errors.push(`窗口提供者缺少 ${key}`)
      else if (key !== 'displayName' && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(entry[key])) errors.push(`窗口提供者 ${key} 不是稳定标识`)
    }
    if (typeof entry.id === 'string') {
      if (!entry.id.startsWith(`${pluginId}.`)) errors.push(`窗口提供者 ${entry.id} 必须属于 ${pluginId} 命名空间`)
      if (ids.has(entry.id)) errors.push(`重复窗口提供者：${entry.id}`)
      ids.add(entry.id)
    }
    if (entry.apiVersion !== 1) errors.push('窗口提供者 apiVersion 必须为 1')
    if (entry.controlAdapters !== undefined &&
      (!Array.isArray(entry.controlAdapters) || entry.controlAdapters.some(adapter =>
        typeof adapter !== 'string' || !WINDOW_CONTROL_ADAPTERS.includes(adapter as WindowControlAdapter)))) {
      errors.push('窗口提供者 controlAdapters 必须是受支持的控件适配器数组')
    }
    if (!Array.isArray(entry.targets) || !entry.targets.length ||
      entry.targets.some(target => typeof target !== 'string' || !/^(windows|linux|macos)(-(x64|x86|arm64))?$/.test(target))) {
      errors.push('窗口提供者 targets 必须明确列出桌面目标平台')
    }
    if (entry.experimental !== undefined && typeof entry.experimental !== 'boolean') errors.push('experimental 必须是逻辑值')
  }
  return errors
}

export function supportsWindowTarget(targets: string[], platform: string): boolean {
  return targets.some(target => target === platform || (!platform.includes('-') && target.startsWith(`${platform}-`)) ||
    (!target.includes('-') && platform.startsWith(`${target}-`)))
}

export function collectWindowUiProviders(manifests: PluginManifest[], target: string): WindowUiProviderEntry[] {
  const ids = new Set<string>()
  const entries: WindowUiProviderEntry[] = []
  for (const manifest of manifests) {
    const providers = manifest.contributes?.windowUiProviders
    const errors = validateWindowUiProviders(providers, manifest.id)
    if (errors.length) throw new Error(errors.join('；'))
    for (const provider of providers ?? []) {
      if (ids.has(provider.id)) throw new Error(`重复窗口提供者：${provider.id}`)
      ids.add(provider.id)
      const available = supportsWindowTarget(provider.targets, target) &&
        (!manifest.targets || supportsWindowTarget(manifest.targets, target))
      entries.push({
        ...provider, pluginId: manifest.id, pluginVersion: manifest.version, available,
        reason: available ? undefined : `不支持目标平台 ${target}`,
      })
    }
  }
  return entries
}

export function requireWindowUiProvider(entries: WindowUiProviderEntry[], project: WindowUiProject): WindowUiProviderEntry {
  const provider = entries.find(entry => entry.id === project.uiProvider)
  if (!provider) throw new Error(`缺少窗口 UI 支持库：${project.uiProvider}。请恢复对应插件，不能自动更换后端。`)
  if (!provider.available) throw new Error(`${provider.displayName}：${provider.reason}`)
  if (project.uiProviderApiVersion !== undefined && project.uiProviderApiVersion !== provider.apiVersion) {
    throw new Error('窗口 UI 协议版本不兼容')
  }
  if (project.uiProviderPluginVersion !== undefined && project.uiProviderPluginVersion !== provider.pluginVersion) {
    throw new Error(`窗口支持库版本不同：项目要求 ${project.uiProviderPluginVersion}，已安装 ${provider.pluginVersion}。请确认升级项目后再构建。`)
  }
  return provider
}
