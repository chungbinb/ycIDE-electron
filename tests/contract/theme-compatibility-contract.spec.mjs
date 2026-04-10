import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const appPath = path.resolve(process.cwd(), 'src/renderer/src/App.tsx')
const editorPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/Editor.tsx')
const tableEditorPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/EycTableEditor.tsx')
const tableEditorCssPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/EycTableEditor.css')
const themeDialogPath = path.resolve(process.cwd(), 'src/renderer/src/components/ThemeSettingsDialog/ThemeSettingsDialog.tsx')

test('QUAL-01 contract: App theme switch path still routes through handleThemeSelect -> applyTheme', () => {
  const source = fs.readFileSync(appPath, 'utf-8')
  assert.match(source, /const handleThemeSelect = useCallback\(async \(themeId: string\)/)
  assert.match(source, /const payload = await applyTheme\(themeId\)/)
  assert.match(source, /onSelectTheme=\{\(themeId\) => \{ void handleThemeSelect\(themeId\) \}\}/)
})

test('QUAL-01 contract: Editor receives currentTheme + themeTokenValues from App and keeps table editor mounted for eyc docs', () => {
  const appSource = fs.readFileSync(appPath, 'utf-8')
  const editorSource = fs.readFileSync(editorPath, 'utf-8')
  assert.match(appSource, /currentTheme=\{currentTheme\}\s*themeTokenValues=\{themeTokenValues\}/)
  assert.match(editorSource, /activeTab\.language === 'eyc'[\s\S]*<EycTableEditor/)
  assert.match(editorSource, /theme=\{monacoThemeId\}/)
})

test('QUAL-01 contract: table editor still exposes edit/selection hooks through line and cell handlers', () => {
  const source = fs.readFileSync(tableEditorPath, 'utf-8')
  assert.match(source, /onMouseDown=\{\(e\) => handleLineMouseDown\(e, blk\.lineIndex\)\}/)
  assert.match(source, /startEditCell\(row\.lineIndex, ci, cell\.text, cell\.fieldIdx, cell\.sliceField\)/)
  assert.match(source, /className=\{`eyc-cell-input/)
})

test('QUAL-01 contract: EycTableEditor theme surface remains token-driven for table/focus/selection rendering', () => {
  const source = fs.readFileSync(tableEditorCssPath, 'utf-8')
  assert.match(source, /background: var\(--table-bg, var\(--bg-primary/)
  assert.match(source, /color: var\(--table-text, var\(--text-primary/)
  assert.match(source, /--flow-main-color: var\(--flow-line-main/)
  assert.match(source, /\.eyc-line-selected[\s\S]*var\(--table-selection-bg/)
})

test('QUAL-01 contract: theme settings keep explicit radio-group based theme switching entry point', () => {
  const source = fs.readFileSync(themeDialogPath, 'utf-8')
  assert.match(source, /role=\"radiogroup\" aria-label=\"主题列表\"/)
  assert.match(source, /role=\"radio\"/)
  assert.match(source, /onClick=\{\(\) => onSelectTheme\(themeId\)\}/)
})
