import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginManifest } from '../shared/plugin/manifest'
import { collectWindowUiProviders, EUI_WINDOW_UI_PROVIDER, LEGACY_WINDOW_UI_PROVIDER, readWindowUiProject, requireWindowUiProvider } from '../shared/plugin/windowUiProviders'
import type { LibraryWindowUnit } from './libraryManager'
import { getEuiBuildTools } from './euiBuildTools'
import { collectCompilers } from '../shared/plugin/compilerContributions'
import { supportsWindowTarget } from '../shared/plugin/windowUiProviders'
import { normalizeRuntimePlatform } from '../shared/platform'
import { euiControlEvents, euiControlType, windowUnitSupportsTarget } from '../shared/plugin/windowControls'
import type { WindowControlAdapter } from '../shared/plugin/windowUiProviders'

export function projectWindowUi(projectDir: string) {
  const file = readdirSync(projectDir).find(name => name.toLowerCase().endsWith('.epp'))
  if (!file) throw new Error('项目目录缺少 .epp 文件')
  return readWindowUiProject(readFileSync(join(projectDir, file), 'utf8'))
}

export function resolveWindowProviders(manifests: PluginManifest[], units: LibraryWindowUnit[], target: string, appDir: string) {
  if (/^(x64|x86|arm64)$/.test(target)) target = `${normalizeRuntimePlatform(process.platform)}-${target}`
  return collectWindowUiProviders(manifests, target).map(provider => {
    if (!provider.available) return provider
    let reason: string | undefined
    if (![LEGACY_WINDOW_UI_PROVIDER, EUI_WINDOW_UI_PROVIDER].includes(provider.id)) {
      reason = '该提供者尚未注册可执行的窗口适配器；v1 仅开放官方 Win32 和 EUI'
    } else if (!units.some(unit => unit.libraryName === provider.library && unit.englishName === provider.rootWindowType && unit.topLevel)) {
      reason = '支持库未加载或缺少顶层窗口单元'
    } else if (!collectCompilers(manifests).some(compiler =>
      (provider.runtimeAdapter === 'win32' || compiler.id === provider.compilerId) &&
      (!compiler.targets || supportsWindowTarget(compiler.targets, target)))) {
      reason = '所需编译器插件未启用'
    } else if (provider.runtimeAdapter === 'eui') {
      if (provider.designerAdapter !== 'eui') reason = 'EUI 设计器适配器未注册'
      else if (!units.find(unit => unit.libraryName === provider.library && unit.englishName === provider.rootWindowType)?.previewTheme) reason = 'EUI 共享主题元数据未加载'
      else try { getEuiBuildTools(appDir) } catch (error) { reason = error instanceof Error ? error.message : String(error) }
    } else if (provider.runtimeAdapter !== 'win32' || provider.designerAdapter !== 'win32') {
      reason = '窗口适配器尚未注册'
    }
    return { ...provider, available: !reason, reason }
  })
}

export function filterWindowUnits(
  units: LibraryWindowUnit[],
  providerId = LEGACY_WINDOW_UI_PROVIDER,
  target = 'windows',
  providerAdapters: WindowControlAdapter[] = providerId === EUI_WINDOW_UI_PROVIDER ? ['eui', 'win32'] : ['win32'],
) {
  const euiProperties: Partial<Record<NonNullable<LibraryWindowUnit['runtimeType']>, string[]>> = {
    EuiButton: ['标题'],
    EuiInput: ['内容', '是否允许多行'],
    EuiLabel: ['标题'],
    EuiImage: ['图片'],
    EuiCheckbox: ['标题', '选中'],
    EuiRadio: ['标题', '选中'],
    EuiSlider: ['最小位置', '最大位置', '位置'],
    EuiProgress: ['最小位置', '最大位置', '位置'],
    EuiGroup: ['标题'],
    EuiWebView: ['地址'],
    EuiWebButton: ['标题'],
    EuiWebEdit: ['内容'],
    EuiScript: ['语言', '超时', '错误信息'],
  }
  const common = ['左边', '顶边', '宽度', '高度', '可视', '禁止']
  const nativeProperties: Record<string, string[]> = {
    Button: ['标题'],
    Static: ['标题'],
    Edit: ['内容', '是否允许多行'],
    CheckBox: ['标题', '选中'],
    RadioButton: ['标题', '选中'],
    SliderBar: ['最小位置', '最大位置', '位置'],
    ProgressBar: ['最小位置', '最大位置', '位置'],
    GroupBox: ['标题'],
    PictureBox: ['图片'],
  }
  const controlAdaptersForUnit = (unit: LibraryWindowUnit): WindowControlAdapter[] =>
    unit.controlAdapters ?? (providerId === LEGACY_WINDOW_UI_PROVIDER && !unit.topLevel ? ['win32'] : [])
  return units.filter(unit => unit.topLevel
    ? unit.uiProviders?.includes(providerId)
    : controlAdaptersForUnit(unit).some(adapter => providerAdapters.includes(adapter)) &&
      !(controlAdaptersForUnit(unit).includes('eui') && !controlAdaptersForUnit(unit).includes('win32') && !euiControlType(unit))).map(unit => {
    const targetSupported = windowUnitSupportsTarget(unit, target)
    const targetSupportReason = targetSupported ? undefined : `控件「${unit.name}」尚未声明对目标平台 ${target} 的支持`
    if (unit.topLevel) return { ...unit, targetSupported, targetSupportReason }
    const runtimeType = euiControlType(unit)
    const propertyNames = providerId === EUI_WINDOW_UI_PROVIDER && runtimeType
      ? new Set([...(runtimeType === 'EuiScript' ? [] : common), ...(euiProperties[runtimeType] ?? [])])
      : providerId === EUI_WINDOW_UI_PROVIDER && controlAdaptersForUnit(unit).includes('win32')
        ? new Set([...common, ...(nativeProperties[unit.englishName] ?? [])])
        : undefined
    return {
      ...unit,
      targetSupported,
      targetSupportReason,
      ...(propertyNames ? {
        properties: unit.properties.filter(property => propertyNames.has(property.name)),
        events: euiControlEvents(unit),
      } : {}),
    }
  })
}

export function validateProjectWindowUi(manifests: PluginManifest[], units: LibraryWindowUnit[], target: string, appDir: string, projectDir: string) {
  return requireWindowUiProvider(resolveWindowProviders(manifests, units, target, appDir), projectWindowUi(projectDir))
}
