import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const themesDir = path.join(root, 'themes')
const globalCssPath = path.join(root, 'src', 'renderer', 'src', 'styles', 'global.css')

const themeFiles = {
  dark: '默认深色.json',
  light: '默认浅色.json',
}

const checks = [
  { id: 'body-text', fg: '--text-primary', bg: '--bg-primary', threshold: 4.5, appliesTo: ['dark', 'light'] },
  { id: 'secondary-text', fg: '--text-secondary', bg: '--bg-primary', threshold: 4.5, appliesTo: ['dark', 'light'] },
  { id: 'titlebar-text', fg: '--text-primary', bg: '--titlebar-bg', threshold: 4.5, appliesTo: ['dark', 'light'] },
  { id: 'statusbar-text', fg: '--statusbar-text', bg: '--statusbar-bg', threshold: 4.5, appliesTo: ['dark', 'light'] },
  { id: 'button-secondary-text', fg: '--text-primary', bg: '--button-secondary-bg', threshold: 4.5, appliesTo: ['light'] },
  { id: 'warning-surface-text', fg: '--warning-surface-text', bg: '--warning-surface-bg', threshold: 4.5, appliesTo: ['light'] },
  { id: 'hover-readable', fg: '--text-primary', bg: '--bg-hover', threshold: 4.5, appliesTo: ['light'] },
  { id: 'active-readable', fg: '--text-primary', bg: '--bg-active', threshold: 4.5, appliesTo: ['light'] },
  { id: 'focus-indicator', fg: '--border-focus', bg: '--bg-primary', threshold: 3, appliesTo: ['dark', 'light'] },
]

function loadTheme(themeFile) {
  const fullPath = path.join(themesDir, themeFile)
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
}

function loadGlobalFallbacks() {
  const css = fs.readFileSync(globalCssPath, 'utf-8')
  const vars = {}
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi
  let match = re.exec(css)
  while (match) {
    vars[match[1]] = match[2].trim()
    match = re.exec(css)
  }
  return vars
}

function parseHexColor(input) {
  const value = (input || '').trim()
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (!m) return null
  const raw = m[1]
  const normalized = raw.length === 3
    ? raw.split('').map(c => c + c).join('')
    : raw
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

function relativeLuminance({ r, g, b }) {
  const convert = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return (0.2126 * convert(r)) + (0.7152 * convert(g)) + (0.0722 * convert(b))
}

function contrastRatio(colorA, colorB) {
  const l1 = relativeLuminance(colorA)
  const l2 = relativeLuminance(colorB)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

const themes = {
  dark: loadTheme(themeFiles.dark),
  light: loadTheme(themeFiles.light),
}
const globalFallbacks = loadGlobalFallbacks()

let failed = false
const rows = []

for (const check of checks) {
  for (const themeKey of check.appliesTo) {
    const theme = themes[themeKey]
    const fgRaw = theme.colors?.[check.fg] ?? globalFallbacks[check.fg]
    const bgRaw = theme.colors?.[check.bg] ?? globalFallbacks[check.bg]
    const fg = parseHexColor(fgRaw)
    const bg = parseHexColor(bgRaw)
    if (!fg || !bg) {
      failed = true
      rows.push(`${themeKey}\t${check.id}\tINVALID_COLOR\t${fgRaw ?? 'missing'}\t${bgRaw ?? 'missing'}`)
      continue
    }
    const ratio = contrastRatio(fg, bg)
    const ok = ratio >= check.threshold
    if (!ok) failed = true
    rows.push(`${themeKey}\t${check.id}\t${ratio.toFixed(2)}\t>= ${check.threshold}:1\t${ok ? 'PASS' : 'FAIL'}`)
  }
}

console.log('theme\tcheck\tratio\tthreshold\tresult')
for (const row of rows) {
  console.log(row)
}

if (failed) {
  console.error('\nContrast check failed.')
  process.exit(1)
}

console.log('\nContrast check passed.')
