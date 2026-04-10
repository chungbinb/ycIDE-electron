import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const appPath = path.resolve(process.cwd(), 'src/renderer/src/App.tsx')
const draftPath = path.resolve(process.cwd(), 'src/shared/theme-draft.ts')
const dialogPath = path.resolve(process.cwd(), 'src/renderer/src/components/ThemeSettingsDialog/ThemeSettingsDialog.tsx')
const themeSharedPath = path.resolve(process.cwd(), 'src/shared/theme.ts')
const mainPath = path.resolve(process.cwd(), 'src/main/index.ts')
const preloadPath = path.resolve(process.cwd(), 'src/preload/index.ts')

test('D15-01/D15-02 contract: theme draft session includes baseline snapshot, working payload and history cursor', () => {
  const source = fs.readFileSync(draftPath, 'utf-8')
  assert.match(source, /export interface ThemeDraftSession/)
  assert.match(source, /originThemeId:\s*ThemeId/)
  assert.match(source, /entrySnapshot:\s*ThemeDraftSnapshot/)
  assert.match(source, /workingPayload:\s*ThemeTokenPayload/)
  assert.match(source, /dirty:\s*boolean/)
  assert.match(source, /historyCursor:\s*number/)
  assert.match(source, /createThemeDraftSession/)
})

test('FLOW-01 + D15-01/D15-02 contract: App starts draft on first edit and uses preview-only updates', () => {
  const source = fs.readFileSync(appPath, 'utf-8')
  assert.match(source, /import \{ createThemeDraftSession, type ThemeDraftSession \} from '\.\.\/\.\.\/shared\/theme-draft'/)
  assert.match(source, /const \[themeDraftSession, setThemeDraftSession\] = useState<ThemeDraftSession \| null>\(null\)/)
  assert.match(source, /if \(!themeDraftSession\)\s*\{\s*setThemeDraftSession\(createThemeDraftSession\(currentTheme, payload\)\)/)
  assert.match(source, /const applyThemeDraftChange = useCallback\(/)
  assert.doesNotMatch(source, /void persistCurrentThemePayload\(currentTheme, payload\)/)
})

test('D15-03 contract: switching base theme discards active draft and rebuilds baseline from selected theme', () => {
  const source = fs.readFileSync(appPath, 'utf-8')
  assert.match(source, /const handleThemeSelect = useCallback\(async \(themeId: string\)/)
  assert.match(source, /setThemeDraftSession\(null\)/)
  assert.match(source, /const nextDraft = createThemeDraftSession\(themeId, payload\)/)
  assert.match(source, /onSelectTheme=\{\(themeId\) => \{ void handleThemeSelect\(themeId\) \}\}/)
})

test('D15-04 contract: closing settings resets draft session and reopen does not recover old draft', () => {
  const appSource = fs.readFileSync(appPath, 'utf-8')
  const dialogSource = fs.readFileSync(dialogPath, 'utf-8')
  assert.match(appSource, /const handleThemeSettingsClose = useCallback\(\(\) => \{\s*setThemeDraftSession\(null\)\s*(setThemeSaveFeedback\(null\)\s*)?setShowThemeSettings\(false\)/)
  assert.match(appSource, /onClose=\{\(intent\) => \{ void handleThemeDraftCloseIntent\(intent\) \}\}/)
  assert.match(dialogSource, /onMouseDown=\{\(\) => onClose\('overlay'\)\}/)
})

test('D15-13/D15-15/D15-16 contract: close intents share one unsaved-draft decision flow', () => {
  const appSource = fs.readFileSync(appPath, 'utf-8')
  const dialogSource = fs.readFileSync(dialogPath, 'utf-8')
  assert.match(appSource, /type ThemeDraftCloseIntent = 'close-button' \| 'overlay' \| 'escape' \| 'app-exit'/)
  assert.match(appSource, /const handleThemeDraftCloseIntent = useCallback\(async \(intent: ThemeDraftCloseIntent\)/)
  assert.match(appSource, /window\.api\?\.dialog\?\.confirmUnsavedThemeDraftClose\(intent\)/)
  assert.match(appSource, /if \(action === 'continue'\) return false/)
  assert.match(appSource, /if \(action === 'discard'\)/)
  assert.match(dialogSource, /onClose:\s*\(intent: 'close-button' \| 'overlay' \| 'escape'\) => void/)
  assert.match(dialogSource, /onMouseDown=\{\(\) => onClose\('overlay'\)\}/)
  assert.match(dialogSource, /onClick=\{\(\) => onClose\('close-button'\)\}/)
  assert.match(dialogSource, /if \(event\.key === 'Escape'\) onClose\('escape'\)/)
})

test('FLOW-02 + D15-05/D15-06/D15-07/D15-08 contract: App defines undo history and baseline restore handlers', () => {
  const source = fs.readFileSync(appPath, 'utf-8')
  assert.match(source, /const canUndoThemeDraft = \(themeDraftSession\?\.historyCursor \?\? 0\) > 0/)
  assert.match(source, /const handleThemeDraftUndo = useCallback\(async \(\) =>/)
  assert.match(source, /const nextCursor = themeDraftSession\.historyCursor - 1/)
  assert.match(source, /historyCursor: nextCursor/)
  assert.match(source, /const handleThemeDraftRestoreBaseline = useCallback\(async \(\) =>/)
  assert.match(source, /const baselineSnapshot = themeDraftSession\.entrySnapshot/)
  assert.match(source, /historyCursor: 0/)
})

test('FLOW-03 + D15-09/D15-10/D15-11/D15-12 contract: save-as-custom validation and IPC wiring stay aligned', () => {
  const sharedSource = fs.readFileSync(themeSharedPath, 'utf-8')
  const mainSource = fs.readFileSync(mainPath, 'utf-8')
  const preloadSource = fs.readFileSync(preloadPath, 'utf-8')
  const appSource = fs.readFileSync(appPath, 'utf-8')
  const dialogSource = fs.readFileSync(dialogPath, 'utf-8')

  assert.match(sharedSource, /export interface SaveAsCustomThemeRequest/)
  assert.match(sharedSource, /export type SaveAsCustomThemeResult/)
  assert.match(sharedSource, /export function validateCustomThemeName\(rawName: string\)/)
  assert.match(sharedSource, /const normalizedName = \(rawName \|\| ''\)\.trim\(\)/)
  assert.match(sharedSource, /if \(normalizedName\.length > CUSTOM_THEME_NAME_MAX_LENGTH\)/)
  assert.match(sharedSource, /CUSTOM_THEME_NAME_RESERVED_CHARS/)
  assert.match(mainSource, /ipcMain\.handle\('theme:saveAsCustom'/)
  assert.match(preloadSource, /saveAsCustom:\s*\(request: SaveAsCustomThemeRequest\)/)
  assert.match(appSource, /const handleSaveAsCustomTheme = useCallback\(async \(name: string\)/)
  assert.match(appSource, /window\.api\?\.theme\?\.saveAsCustom\(/)
  assert.match(dialogSource, /onSaveAsCustom\?: \(name: string\) => Promise<\{ success: boolean; message\?: string \}>/)
  assert.match(dialogSource, /保存为自定义主题/)
})

test('D15-14 contract: unsaved-draft dialog keeps continue-editing as default/cancel action', () => {
  const mainSource = fs.readFileSync(mainPath, 'utf-8')
  assert.match(mainSource, /ipcMain\.handle\('dialog:confirmUnsavedThemeDraftClose'/)
  assert.match(mainSource, /buttons:\s*\['保存为自定义主题', '放弃改动', '继续编辑'\]/)
  assert.match(mainSource, /defaultId:\s*2/)
  assert.match(mainSource, /cancelId:\s*2/)
})

