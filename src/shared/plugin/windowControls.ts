import { EUI_WINDOW_UI_PROVIDER, supportsWindowTarget, type WindowControlAdapter } from './windowUiProviders'

export interface WindowControlIdentity {
  type: string
  libraryId?: string
  typeId?: string
}

export interface WindowUnitIdentity {
  name: string
  englishName: string
  libraryName: string
}

export interface WindowControlCapability {
  controlAdapters?: WindowControlAdapter[]
  supportedTargets?: string[]
  runtimeType?: EuiControlType
  uiProviders?: string[]
  englishName: string
  className?: string
  topLevel?: boolean
}

export function windowUnitSupportsTarget(unit: WindowControlCapability, target: string): boolean {
  const targets = unit.supportedTargets ?? (unit.controlAdapters?.includes('win32') || unit.className ? ['windows'] : [])
  return supportsWindowTarget(targets, target)
}

export function windowUnitKey(unit: WindowUnitIdentity): string {
  return JSON.stringify([unit.libraryName, unit.englishName || unit.name])
}

export function findWindowControlUnit<T extends WindowUnitIdentity>(units: T[], control: WindowControlIdentity): T | undefined {
  const stable = control.libraryId !== undefined || control.typeId !== undefined
  const matches = units.filter(unit => stable
    ? unit.libraryName === control.libraryId && unit.englishName === control.typeId
    : unit.name === control.type || unit.englishName === control.type)
  return matches.length === 1 ? matches[0] : undefined
}

export const EUI_CONTROL_TYPES = [
  'EuiButton', 'EuiInput', 'EuiLabel', 'EuiImage', 'EuiScript',
  'EuiCheckbox', 'EuiRadio', 'EuiSlider', 'EuiProgress', 'EuiGroup',
  'EuiWebView', 'EuiWebButton', 'EuiWebEdit',
] as const
export type EuiControlType = typeof EUI_CONTROL_TYPES[number]
export const WIN32_EUI_CONTROL_TYPES = {
  Button: 'Win32Button',
  Static: 'Win32Label',
  Edit: 'Win32Edit',
  CheckBox: 'Win32Checkbox',
  RadioButton: 'Win32Radio',
  SliderBar: 'Win32Slider',
  ProgressBar: 'Win32Progress',
  GroupBox: 'Win32Group',
  PictureBox: 'Win32Image',
} as const
export type Win32EuiControlType = typeof WIN32_EUI_CONTROL_TYPES[keyof typeof WIN32_EUI_CONTROL_TYPES]
export type EuiRuntimeControlType = EuiControlType | Win32EuiControlType

export function parseEuiControlType(value: unknown): EuiControlType | undefined {
  if (value === undefined) return undefined
  const type = EUI_CONTROL_TYPES.find(type => type === value)
  if (!type) throw new Error(`无效的 EUI 控件运行类型：${String(value)}`)
  return type
}

export function euiControlType(unit: WindowControlCapability): EuiControlType | undefined {
  if (unit.topLevel || !(unit.controlAdapters?.includes('eui') || unit.uiProviders?.includes(EUI_WINDOW_UI_PROVIDER))) return undefined
  return unit.runtimeType ?? EUI_CONTROL_TYPES.find(type => type === unit.englishName)
}

export function win32EuiControlType(unit: WindowControlCapability): Win32EuiControlType | undefined {
  if (unit.topLevel || !unit.controlAdapters?.includes('win32')) return undefined
  return WIN32_EUI_CONTROL_TYPES[unit.englishName as keyof typeof WIN32_EUI_CONTROL_TYPES]
}

export function euiRuntimeControlType(unit: WindowControlCapability): EuiRuntimeControlType | undefined {
  return euiControlType(unit) ?? win32EuiControlType(unit)
}

const EUI_PRIMARY_EVENTS: Partial<Record<EuiControlType, string>> = {
  EuiButton: '被单击',
  EuiInput: '内容被改变',
  EuiCheckbox: '被单击',
  EuiRadio: '被单击',
  EuiSlider: '位置被改变',
  EuiWebButton: '被单击',
  EuiWebEdit: '内容被改变',
}

export function euiControlEvents<T extends { name: string; args: unknown[]; returnType?: string }>(
  unit: WindowControlCapability & { events: T[] },
): T[] {
  const runtimeType = euiControlType(unit)
  const supported = unit.events.filter(event => !event.args.length && (!event.returnType || event.returnType === '无返回值'))
  if (!runtimeType) {
    const nativeEvents: Record<string, string> = {
      Button: '被单击',
      CheckBox: '被单击',
      RadioButton: '被单击',
      Edit: '内容被改变',
      SliderBar: '位置被改变',
    }
    const preferred = nativeEvents[unit.englishName]
    return unit.controlAdapters?.includes('win32') && preferred
      ? supported.filter(event => event.name === preferred).slice(0, 1)
      : []
  }
  const preferred = EUI_PRIMARY_EVENTS[runtimeType]
  if (preferred) {
    const event = supported.find(candidate => candidate.name === preferred)
    if (event) return [event]
  }
  return supported.length === 1 ? supported : []
}
