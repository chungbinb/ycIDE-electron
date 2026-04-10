import type { FlowLineModeConfig } from '../../../../shared/theme-tokens'

export interface FlowLineResolvedColors {
  main: string
  branch: string
  loop: string
  arrow: string
  innerLink: string
}

interface HslColor {
  h: number
  s: number
  l: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function normalizeHexColor(value: string, fallback = '#4fc1ff'): string {
  const input = (value || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(input)) return input.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(input)) {
    const short = input.slice(1).toLowerCase()
    return `#${short[0]}${short[0]}${short[1]}${short[1]}${short[2]}${short[2]}`
  }
  return fallback
}

function hexToHsl(hex: string): HslColor {
  const color = normalizeHexColor(hex)
  const r = parseInt(color.slice(1, 3), 16) / 255
  const g = parseInt(color.slice(3, 5), 16) / 255
  const b = parseInt(color.slice(5, 7), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  const delta = max - min

  if (delta === 0) {
    return { h: 0, s: 0, l: Math.round(lightness * 100) }
  }

  const saturation = lightness > 0.5
    ? delta / (2 - max - min)
    : delta / (max + min)
  let hue = 0
  if (max === r) hue = ((g - b) / delta) + (g < b ? 6 : 0)
  else if (max === g) hue = ((b - r) / delta) + 2
  else hue = ((r - g) / delta) + 4

  return {
    h: Math.round((hue * 60) % 360),
    s: Math.round(saturation * 100),
    l: Math.round(lightness * 100),
  }
}

function hslToHex(hsl: HslColor): string {
  const h = ((hsl.h % 360) + 360) % 360 / 360
  const s = clamp(hsl.s, 0, 100) / 100
  const l = clamp(hsl.l, 0, 100) / 100

  if (s === 0) {
    const grey = Math.round(l * 255).toString(16).padStart(2, '0')
    return `#${grey}${grey}${grey}`
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255).toString(16).padStart(2, '0')
  const g = Math.round(hue2rgb(p, q, h) * 255).toString(16).padStart(2, '0')
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

function resolveDepthColor(config: FlowLineModeConfig, depth: number): string {
  const normalizedDepth = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 0
  const normalizedMain = normalizeHexColor(config.multi.mainColor)
  if (normalizedDepth === 0) return normalizedMain
  const baseline = hexToHsl(config.multi.mainColor)
  const hue = baseline.h + (config.multi.depthHueStep * normalizedDepth)
  const saturation = baseline.s + (config.multi.depthSaturationStep * normalizedDepth)
  const lightness = baseline.l + (config.multi.depthLightnessStep * normalizedDepth)
  return hslToHex({
    h: hue,
    s: clamp(saturation, 5, 95),
    l: clamp(lightness, 8, 92),
  })
}

export function resolveFlowLineColors(config: FlowLineModeConfig, depth: number): FlowLineResolvedColors {
  const singleColor = normalizeHexColor(config.single.mainColor)
  if (config.mode === 'single') {
    return {
      main: singleColor,
      branch: singleColor,
      loop: singleColor,
      arrow: singleColor,
      innerLink: singleColor,
    }
  }

  const multiColor = resolveDepthColor({
    ...config,
    multi: {
      ...config.multi,
      mainColor: normalizeHexColor(config.multi.mainColor, singleColor),
    },
  }, depth)
  return {
    main: multiColor,
    branch: multiColor,
    loop: multiColor,
    arrow: multiColor,
    innerLink: multiColor,
  }
}
