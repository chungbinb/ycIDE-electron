import {
  DEFAULT_FLOW_LINE_MODE_CONFIG,
  type FlowLineMode,
  type FlowLineModeConfig,
} from '../../../../shared/theme-tokens'

const FLOW_LINE_MODE_SET = new Set<FlowLineMode>(['single', 'multi'])

function parseCssNumber(rawValue: string | null | undefined, fallback: number): number {
  const num = Number((rawValue || '').trim())
  return Number.isFinite(num) ? num : fallback
}

export function readFlowLineConfigFromCss(): FlowLineModeConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_FLOW_LINE_MODE_CONFIG }
  const rootStyle = getComputedStyle(document.documentElement)
  const modeCandidate = (rootStyle.getPropertyValue('--flow-line-mode') || '').trim() as FlowLineMode
  const mode: FlowLineMode = FLOW_LINE_MODE_SET.has(modeCandidate) ? modeCandidate : DEFAULT_FLOW_LINE_MODE_CONFIG.mode
  const singleMain = (rootStyle.getPropertyValue('--flow-line-main') || '').trim() || DEFAULT_FLOW_LINE_MODE_CONFIG.single.mainColor
  const multiMain = (rootStyle.getPropertyValue('--flow-line-main') || '').trim() || DEFAULT_FLOW_LINE_MODE_CONFIG.multi.mainColor
  return {
    mode,
    single: {
      mainColor: singleMain,
    },
    multi: {
      mainColor: multiMain,
      depthHueStep: parseCssNumber(rootStyle.getPropertyValue('--flow-line-depth-hue-step'), DEFAULT_FLOW_LINE_MODE_CONFIG.multi.depthHueStep),
      depthSaturationStep: parseCssNumber(rootStyle.getPropertyValue('--flow-line-depth-saturation-step'), DEFAULT_FLOW_LINE_MODE_CONFIG.multi.depthSaturationStep),
      depthLightnessStep: parseCssNumber(rootStyle.getPropertyValue('--flow-line-depth-lightness-step'), DEFAULT_FLOW_LINE_MODE_CONFIG.multi.depthLightnessStep),
    },
  }
}
