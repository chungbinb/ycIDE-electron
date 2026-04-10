import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'

const flowThemePath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/flowLineTheme.ts')
const tableEditorTsxPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/EycTableEditor.tsx')
const tableEditorCssPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/EycTableEditor.css')
const themeSettingsDialogPath = path.resolve(process.cwd(), 'src/renderer/src/components/ThemeSettingsDialog/ThemeSettingsDialog.tsx')
const appPath = path.resolve(process.cwd(), 'src/renderer/src/App.tsx')
const runtimeRequire = createRequire(import.meta.url)

function loadFlowLineThemeModule() {
  const source = fs.readFileSync(flowThemePath, 'utf-8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: flowThemePath,
  }).outputText
  const module = { exports: {} }
  const context = vm.createContext({
    module,
    exports: module.exports,
    require: runtimeRequire,
    console,
  })
  const script = new vm.Script(compiled, { filename: flowThemePath })
  script.runInContext(context)
  return module.exports
}

test('single mode returns one shared color for all flow elements', () => {
  const { resolveFlowLineColors } = loadFlowLineThemeModule()
  const colors = resolveFlowLineColors({
    mode: 'single',
    single: { mainColor: '#4fc1ff' },
    multi: { mainColor: '#4fc1ff', depthHueStep: 16, depthSaturationStep: -4, depthLightnessStep: 5 },
  }, 5)

  assert.equal(colors.main, '#4fc1ff')
  assert.equal(colors.branch, '#4fc1ff')
  assert.equal(colors.loop, '#4fc1ff')
  assert.equal(colors.arrow, '#4fc1ff')
  assert.equal(colors.innerLink, '#4fc1ff')
})

test('multi mode derives depth-based colors from current main color baseline', () => {
  const { resolveFlowLineColors } = loadFlowLineThemeModule()
  const flowConfig = {
    mode: 'multi',
    single: { mainColor: '#4fc1ff' },
    multi: { mainColor: '#4fc1ff', depthHueStep: 20, depthSaturationStep: -3, depthLightnessStep: 4 },
  }
  const depth0 = resolveFlowLineColors(flowConfig, 0)
  const depth1 = resolveFlowLineColors(flowConfig, 1)
  const depth2 = resolveFlowLineColors(flowConfig, 2)

  assert.equal(depth0.main.toLowerCase(), '#4fc1ff')
  assert.notEqual(depth1.main, depth0.main)
  assert.notEqual(depth2.main, depth1.main)
  assert.equal(depth1.main, depth1.branch)
  assert.equal(depth1.main, depth1.loop)
  assert.equal(depth1.main, depth1.arrow)
  assert.equal(depth1.main, depth1.innerLink)
})

test('depth generation is deterministic and unbounded for deep nesting', () => {
  const { resolveFlowLineColors } = loadFlowLineThemeModule()
  const flowConfig = {
    mode: 'multi',
    single: { mainColor: '#4fc1ff' },
    multi: { mainColor: '#4fc1ff', depthHueStep: 16, depthSaturationStep: -4, depthLightnessStep: 5 },
  }

  const depth64 = resolveFlowLineColors(flowConfig, 64)
  const depth65 = resolveFlowLineColors(flowConfig, 65)
  const depth64Again = resolveFlowLineColors(flowConfig, 64)

  assert.match(depth64.main, /^#[0-9a-f]{6}$/i)
  assert.match(depth65.main, /^#[0-9a-f]{6}$/i)
  assert.notEqual(depth65.main, depth64.main)
  assert.deepEqual(depth64Again, depth64)
})

test('table and header surfaces are wired to full token set variables', () => {
  const css = fs.readFileSync(tableEditorCssPath, 'utf-8')
  assert.match(css, /--table-bg/)
  assert.match(css, /--table-text/)
  assert.match(css, /--table-border/)
  assert.match(css, /--table-header-bg/)
  assert.match(css, /--table-header-text/)
  assert.match(css, /--table-row-hover-bg/)
  assert.match(css, /--table-selection-bg/)
  assert.match(css, /\.Rowheight[\s\S]*var\(--table-border/)
  assert.match(css, /\.eHeadercolor[\s\S]*var\(--table-header-bg/)
})

test('table editor applies flow-line mode engine output to render styles', () => {
  const tsx = fs.readFileSync(tableEditorTsxPath, 'utf-8')
  const css = fs.readFileSync(tableEditorCssPath, 'utf-8')
  assert.match(tsx, /import\s+\{\s*resolveFlowLineColors\s*\}\s+from\s+'\.\/flowLineTheme'/)
  assert.match(tsx, /resolveFlowLineColors\(/)
  assert.match(tsx, /--flow-main-color/)
  assert.match(css, /--flow-main-color/)
  assert.doesNotMatch(css, /#569cd6|#4ec9b0/)
})

test('debug transient overlays use theme tokens instead of hardcoded literals', () => {
  const css = fs.readFileSync(tableEditorCssPath, 'utf-8')
  assert.match(css, /\.eyc-breakpoint-dot\.active[\s\S]*var\(--error/)
  assert.match(css, /\.eyc-debug-hover-tooltip[\s\S]*var\(--bg-secondary/)
  assert.match(css, /\.eyc-debug-hover-tooltip[\s\S]*var\(--table-border/)
  assert.match(css, /\.eyc-debug-line\s+\.eyc-code-line[\s\S]*var\(--table-row-hover-bg/)
  assert.match(css, /\.eyc-debug-line\s+\.eyc-gutter-linenum[\s\S]*var\(--table-header-text/)
})

test('flow-line settings controls are wired to App persistence handlers', () => {
  const dialogSource = fs.readFileSync(themeSettingsDialogPath, 'utf-8')
  const appSource = fs.readFileSync(appPath, 'utf-8')
  assert.match(dialogSource, /onFlowLineModeChange/)
  assert.match(dialogSource, /onFlowLineMainColorChange/)
  assert.match(dialogSource, /onFlowLineDepthStepChange/)
  assert.match(appSource, /handleThemeFlowLineModeChange/)
  assert.match(appSource, /handleThemeFlowLineMainColorChange/)
  assert.match(appSource, /handleThemeFlowLineDepthStepChange/)
  assert.match(appSource, /persistCurrentThemePayload\(currentTheme, payload\)/)
})

test('autocomplete source badge avoids fixed keyword literal fallback', () => {
  const css = fs.readFileSync(tableEditorCssPath, 'utf-8')
  assert.match(css, /\.eyc-ac-source[\s\S]*var\(--syntax-keyword/)
  assert.doesNotMatch(css, /\.eyc-ac-source[\s\S]*#569cd6/)
})
