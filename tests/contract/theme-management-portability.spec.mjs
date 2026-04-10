import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const themeSchemaPath = path.resolve(process.cwd(), 'src/shared/theme.ts')
const mainPath = path.resolve(process.cwd(), 'src/main/index.ts')
const preloadPath = path.resolve(process.cwd(), 'src/preload/index.ts')
const appPath = path.resolve(process.cwd(), 'src/renderer/src/App.tsx')

function readThemeSchema() {
  return fs.readFileSync(themeSchemaPath, 'utf-8')
}

function readMainSource() {
  return fs.readFileSync(mainPath, 'utf-8')
}

function readPreloadSource() {
  return fs.readFileSync(preloadPath, 'utf-8')
}

function readAppSource() {
  return fs.readFileSync(appPath, 'utf-8')
}

test('contract dto: MGMT-02 D16-10 export dto fixed to schemaVersion + theme', () => {
  const source = readThemeSchema()
  assert.match(source, /export const THEME_PORTABILITY_SCHEMA_VERSION = 1 as const/)
  assert.match(source, /export interface ThemePortabilityExportDto[\s\S]*schemaVersion:\s*typeof THEME_PORTABILITY_SCHEMA_VERSION[\s\S]*theme:\s*ThemeDefinition/)
})

test('contract dto: MGMT-04 D16-13 import failure supports field diagnostics', () => {
  const source = readThemeSchema()
  assert.match(source, /export interface ThemeImportValidationDiagnostic[\s\S]*path:\s*string[\s\S]*message:\s*string/)
  assert.match(source, /export type ThemeImportValidationResult =[\s\S]*success:\s*false[\s\S]*diagnostics:\s*ThemeImportValidationDiagnostic\[\]/)
})

test('contract dto: MGMT-03 D16-14 conflict decision union distinguishes rename-import\/overwrite', () => {
  const source = readThemeSchema()
  assert.match(source, /export type ThemeImportConflictDecision =/)
  assert.match(source, /decision:\s*'rename-import'/)
  assert.match(source, /decision:\s*'overwrite'/)
  assert.match(source, /overwriteConfirmed:\s*true/)
})

test('MGMT-04 D16-13 schemaVersion invalid returns explicit schemaVersion path diagnostic', () => {
  const source = readThemeSchema()
  assert.match(source, /path:\s*'schemaVersion'/)
  assert.match(source, /unsupported_schema_version/)
  assert.match(source, /仅支持 schemaVersion=1/)
})

test('MGMT-04 D16-13 missing theme fields return field-level diagnostics list', () => {
  const source = readThemeSchema()
  assert.match(source, /path:\s*'theme'/)
  assert.match(source, /path:\s*'theme\.name'/)
  assert.match(source, /path:\s*'theme\.colors'/)
  assert.match(source, /success:\s*false,\s*diagnostics/)
})

test('MGMT-03 D16-14 conflict result union branches stay complete and mutually exclusive', () => {
  const source = readThemeSchema()
  assert.match(source, /export type ThemeImportConflictResolutionResult =/)
  assert.match(source, /status:\s*'conflict'/)
  assert.match(source, /status:\s*'ready'/)
  assert.match(source, /rename-import 分支不能携带 overwrite 字段/)
  assert.match(source, /overwrite 分支不能携带 newThemeName/)
})

test('management and export ipc: D16-01 built-in theme rename/delete is rejected', () => {
  const source = readMainSource()
  assert.match(source, /ipcMain\.handle\('theme:rename'/)
  assert.match(source, /ipcMain\.handle\('theme:delete'/)
  assert.match(source, /built-in 主题不可重命名/)
  assert.match(source, /built-in 主题不可删除/)
})

test('management and export ipc: D16-03 createFromCurrent clones current active theme as baseline', () => {
  const source = readMainSource()
  assert.match(source, /ipcMain\.handle\('theme:createFromCurrent'/)
  assert.match(source, /const sourceThemeId = config\.currentThemeId/)
  assert.match(source, /const sourceTheme = loadThemeDefinition\(sourceThemeId\)/)
  assert.match(source, /colors:\s*\{\s*\.\.\.sourceTheme\.colors/)
})

test('management and export ipc: D16-05/06/08 delete active custom requires explicit confirm and falls back to previous built-in notice', () => {
  const source = readMainSource()
  assert.match(source, /confirmThemeName/)
  assert.match(source, /confirmThemeName.*!==.*themeId/)
  assert.match(source, /previousBuiltInThemeId/)
  assert.match(source, /fallback.*previous built-in/)
})

test('management and export ipc: D16-07/09/10/11/12 rename conflict and single-theme export contract', () => {
  const source = readMainSource()
  assert.match(source, /主题名称“\$\{targetThemeId\}”已存在/)
  assert.match(source, /ipcMain\.handle\('theme:export'/)
  assert.match(source, /schemaVersion:\s*THEME_PORTABILITY_SCHEMA_VERSION/)
  assert.match(source, /`\$\{themeId\}\.ycide-theme\.json`/)
  assert.match(source, /built-in 主题也允许导出/)
})

test('MGMT-01 D16-02/D16-08 lifecycle sync: manager handlers return lifecycle payload and renderer applies list/current together', () => {
  const mainSource = readMainSource()
  const appSource = readAppSource()
  assert.match(mainSource, /type ThemeLifecycleState =[\s\S]*config:\s*ThemeConfigV2[\s\S]*themes:\s*ThemeId\[\][\s\S]*currentTheme:\s*ThemeId[\s\S]*menuState:\s*ThemeMenuState/)
  assert.match(mainSource, /ipcMain\.handle\('theme:rename'[\s\S]*\.\.\.buildThemeLifecycleState\(config\)/)
  assert.match(mainSource, /ipcMain\.handle\('theme:delete'[\s\S]*\.\.\.buildThemeLifecycleState\(config\)/)
  assert.match(appSource, /const syncThemeLifecycleState = useCallback\([\s\S]*setThemeList\(payload\.themes \|\| \[\]\)[\s\S]*await applyTheme\(payload\.currentTheme, false, nextPayload\)/)
  assert.match(appSource, /renameThemeInDraftSession\(result\.oldThemeId, result\.newThemeId\)/)
})

test('management and export ipc bridge: preload exposes typed theme lifecycle methods', () => {
  const source = readPreloadSource()
  assert.match(source, /createFromCurrent:\s*\(request: \{ name: string; themePayload\?: ThemeTokenPayload \}\)/)
  assert.match(source, /rename:\s*\(request: \{ themeId: ThemeId; newName: string \}\)/)
  assert.match(source, /delete:\s*\(request: \{ themeId: ThemeId; confirmThemeName: string \}\)/)
  assert.match(source, /export:\s*\(request: \{ themeId: ThemeId \}\)/)
})

test('management and export ipc bridge: preload invoke channels and argument shape align with main handlers', () => {
  const preloadSource = readPreloadSource()
  const mainSource = readMainSource()
  assert.match(preloadSource, /ipcRenderer\.invoke\('theme:createFromCurrent', request\)/)
  assert.match(preloadSource, /ipcRenderer\.invoke\('theme:rename', request\)/)
  assert.match(preloadSource, /ipcRenderer\.invoke\('theme:delete', request\)/)
  assert.match(preloadSource, /ipcRenderer\.invoke\('theme:export', request\)/)
  assert.match(mainSource, /ipcMain\.handle\('theme:createFromCurrent'/)
  assert.match(mainSource, /ipcMain\.handle\('theme:rename'/)
  assert.match(mainSource, /ipcMain\.handle\('theme:delete'/)
  assert.match(mainSource, /ipcMain\.handle\('theme:export'/)
})

test('import atomic and conflict: main ipc exposes validate-first prepare + atomic commit handlers', () => {
  const source = readMainSource()
  assert.match(source, /ipcMain\.handle\('theme:import'/)
  assert.match(source, /ipcMain\.handle\('theme:importCommit'/)
  assert.match(source, /validateThemePortabilityImportPayload/)
  assert.match(source, /validateThemeImportConflictDecision/)
  assert.match(source, /conflict_decision_required/)
  assert.match(source, /overwriteConfirmed=true/)
})

test('MGMT-04 D16-13 invalid import prepare + commit rollback preserve atomic no-write guarantee', () => {
  const source = readMainSource()
  assert.match(source, /ipcMain\.handle\('theme:import'[\s\S]*if \(!validation\.success\)[\s\S]*status:\s*'invalid'[\s\S]*diagnostics:\s*validation\.diagnostics/)
  assert.match(source, /ipcMain\.handle\('theme:importCommit'[\s\S]*const rollbackTheme = loadThemeDefinition\(targetThemeId\)[\s\S]*const rollbackConfig = readThemeConfigForWrite\(\)/)
  assert.match(source, /catch \(error\)[\s\S]*writeThemeConfig\(rollbackConfig\)/)
})

test('import atomic and conflict: preload bridge exposes import and importCommit invoke channels', () => {
  const source = readPreloadSource()
  assert.match(source, /ipcRenderer\.invoke\('theme:import'/)
  assert.match(source, /ipcRenderer\.invoke\('theme:importCommit', request\)/)
})
