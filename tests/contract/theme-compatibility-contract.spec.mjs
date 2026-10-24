import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const appPath = path.resolve(process.cwd(), 'src/renderer/src/App.tsx')
const editorPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/Editor.tsx')
const tableEditorPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/EycTableEditor.tsx')
const interactionHandlersPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/useEditorInteractionHandlers.ts')
const tableEditorCssPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/EycTableEditor.css')
const titleBarPath = path.resolve(process.cwd(), 'src/renderer/src/components/TitleBar/TitleBar.tsx')
const workbenchPluginPath = path.resolve(process.cwd(), 'src/plugins/ycide.workbench/plugin.json')
const workbenchMenusPath = path.resolve(process.cwd(), 'src/shared/plugin/workbenchMenus.ts')

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
  assert.match(editorSource, /function isEycSourceLanguage\(language\?: string\): boolean \{\s*return language === 'eyc'/)
  assert.match(editorSource, /<EycTableEditor/)
  assert.match(editorSource, /theme=\{monacoThemeId\}/)
})

test('QUAL-01 contract: table editor still exposes edit/selection hooks through line and cell handlers', () => {
  const source = fs.readFileSync(tableEditorPath, 'utf-8')
  const interactionSource = fs.readFileSync(interactionHandlersPath, 'utf-8')
  assert.match(source, /const handleLineMouseDown = useCallback\(\(e: React\.MouseEvent, lineIndex: number\)/)
  // 行选择/单元格编辑交互已下沉到 useEditorInteractionHandlers，确认仍由表格编辑器接线。
  assert.match(source, /handleLineMouseDown,/)
  assert.match(interactionSource, /handleLineMouseDown\(e, lineIndex\)/)
  assert.match(source, /startEditCell\(action\.lineIndex, action\.cellIndex, action\.text, action\.fieldIdx, action\.sliceField\)/)
  assert.match(source, /className=\{`eyc-cell-input/)
})

test('QUAL-01 contract: EycTableEditor theme surface remains token-driven for table/focus/selection rendering', () => {
  const source = fs.readFileSync(tableEditorCssPath, 'utf-8')
  assert.match(source, /background: var\(--table-bg, var\(--bg-primary/)
  assert.match(source, /color: var\(--table-text, var\(--text-primary/)
  assert.match(source, /--flow-main-color: var\(--flow-line-main/)
  assert.match(source, /\.eyc-line-selected[\s\S]*var\(--table-selection-bg/)
})

test('QUAL-01 contract: menu bar keeps explicit theme switching entry point (查看 -> 主题 submenu)', () => {
  // 菜单由插件清单生成（阶段 0 插件化）：查看菜单里挂主题动态子菜单，子菜单项执行 theme:apply，App 把它落到 applyTheme
  const workbench = JSON.parse(fs.readFileSync(workbenchPluginPath, 'utf-8'))
  const viewMenu = workbench.contributes.menus['menubar/view']
  assert.ok(viewMenu.some(item => item.submenu === 'ycide.themes' && item.title === '主题'))
  const titleBarSource = fs.readFileSync(titleBarPath, 'utf-8')
  assert.match(titleBarSource, /\[THEMES_SUBMENU\]: buildThemeEntries\(themes, currentTheme, BUILTIN_THEME_IDS\)/)
  const workbenchMenusSource = fs.readFileSync(workbenchMenusPath, 'utf-8')
  assert.match(workbenchMenusSource, /command: 'theme:apply',\s*args: \[themeId\]/)
  const appSource = fs.readFileSync(appPath, 'utf-8')
  assert.match(appSource, /'theme:apply': \(themeName: unknown\) => \{\s*applyTheme\(String\(themeName\)\)/)
})
