import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const appPath = path.resolve(process.cwd(), 'src/renderer/src/App.tsx')
const draftPath = path.resolve(process.cwd(), 'src/shared/theme-draft.ts')
const dialogPath = path.resolve(process.cwd(), 'src/renderer/src/components/ThemeSettingsDialog/ThemeSettingsDialog.tsx')

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
  assert.match(appSource, /const handleThemeSettingsClose = useCallback\(\(\) => \{\s*setThemeDraftSession\(null\)\s*setShowThemeSettings\(false\)/)
  assert.match(appSource, /onClose=\{handleThemeSettingsClose\}/)
  assert.match(dialogSource, /onMouseDown=\{onClose\}/)
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

