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

test('theme draft contract defines baseline snapshot, working payload and history cursor', () => {
  const source = fs.readFileSync(draftPath, 'utf-8')
  assert.match(source, /export interface ThemeDraftSession/)
  assert.match(source, /originThemeId:\s*ThemeId/)
  assert.match(source, /entrySnapshot:\s*ThemeDraftSnapshot/)
  assert.match(source, /workingPayload:\s*ThemeTokenPayload/)
  assert.match(source, /dirty:\s*boolean/)
  assert.match(source, /historyCursor:\s*number/)
  assert.match(source, /createThemeDraftSession/)
})

test('App starts draft session on first edit and switches handlers to preview-only updates', () => {
  const source = fs.readFileSync(appPath, 'utf-8')
  assert.match(source, /import \{ createThemeDraftSession, type ThemeDraftSession \} from '\.\.\/\.\.\/shared\/theme-draft'/)
  assert.match(source, /const \[themeDraftSession, setThemeDraftSession\] = useState<ThemeDraftSession \| null>\(null\)/)
  assert.match(source, /if \(!themeDraftSession\)\s*\{\s*setThemeDraftSession\(createThemeDraftSession\(currentTheme, payload\)\)/)
  assert.match(source, /const applyThemeDraftChange = useCallback\(/)
  assert.doesNotMatch(source, /void persistCurrentThemePayload\(currentTheme, payload\)/)
})

test('App discards current draft when switching base theme and rebuilds baseline from selected theme', () => {
  const source = fs.readFileSync(appPath, 'utf-8')
  assert.match(source, /const handleThemeSelect = useCallback\(async \(themeId: string\)/)
  assert.match(source, /setThemeDraftSession\(null\)/)
  assert.match(source, /const nextDraft = createThemeDraftSession\(themeId, payload\)/)
  assert.match(source, /onSelectTheme=\{\(themeId\) => \{ void handleThemeSelect\(themeId\) \}\}/)
})

test('closing settings always resets draft session and does not recover old draft on reopen', () => {
  const appSource = fs.readFileSync(appPath, 'utf-8')
  const dialogSource = fs.readFileSync(dialogPath, 'utf-8')
  assert.match(appSource, /const handleThemeSettingsClose = useCallback\(\(\) => \{\s*setThemeDraftSession\(null\)\s*(setThemeSaveFeedback\(null\)\s*)?setShowThemeSettings\(false\)/)
  assert.match(appSource, /onClose=\{\(intent\) => \{ void handleThemeDraftCloseIntent\(intent\) \}\}/)
  assert.match(dialogSource, /onMouseDown=\{\(\) => onClose\('overlay'\)\}/)
})

test('settings close intents share one unsaved-draft decision flow with continue-editing default', () => {
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

test('App defines undo history and baseline restore handlers for draft session', () => {
  const source = fs.readFileSync(appPath, 'utf-8')
  assert.match(source, /const canUndoThemeDraft = \(themeDraftSession\?\.historyCursor \?\? 0\) > 0/)
  assert.match(source, /const handleThemeDraftUndo = useCallback\(async \(\) =>/)
  assert.match(source, /const nextCursor = themeDraftSession\.historyCursor - 1/)
  assert.match(source, /historyCursor: nextCursor/)
  assert.match(source, /const handleThemeDraftRestoreBaseline = useCallback\(async \(\) =>/)
  assert.match(source, /const baselineSnapshot = themeDraftSession\.entrySnapshot/)
  assert.match(source, /historyCursor: 0/)
})

test('save-as-custom flow shares validation contract and wires main/preload/renderer/dialog', () => {
  const sharedSource = fs.readFileSync(themeSharedPath, 'utf-8')
  const mainSource = fs.readFileSync(mainPath, 'utf-8')
  const preloadSource = fs.readFileSync(preloadPath, 'utf-8')
  const appSource = fs.readFileSync(appPath, 'utf-8')
  const dialogSource = fs.readFileSync(dialogPath, 'utf-8')

  assert.match(sharedSource, /export interface SaveAsCustomThemeRequest/)
  assert.match(sharedSource, /export type SaveAsCustomThemeResult/)
  assert.match(sharedSource, /export function validateCustomThemeName\(rawName: string\)/)
  assert.match(mainSource, /ipcMain\.handle\('theme:saveAsCustom'/)
  assert.match(preloadSource, /saveAsCustom:\s*\(request: SaveAsCustomThemeRequest\)/)
  assert.match(appSource, /const handleSaveAsCustomTheme = useCallback\(async \(name: string\)/)
  assert.match(appSource, /window\.api\?\.theme\?\.saveAsCustom\(/)
  assert.match(dialogSource, /onSaveAsCustom\?: \(name: string\) => Promise<\{ success: boolean; message\?: string \}>/)
  assert.match(dialogSource, /保存为自定义主题/)
})

