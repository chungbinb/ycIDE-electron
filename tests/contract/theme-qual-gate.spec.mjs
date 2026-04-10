import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const mainPath = path.resolve(process.cwd(), 'src/main/index.ts')
const themeSchemaPath = path.resolve(process.cwd(), 'src/shared/theme.ts')

function readMainSource() {
  return fs.readFileSync(mainPath, 'utf-8')
}

function readThemeSchema() {
  return fs.readFileSync(themeSchemaPath, 'utf-8')
}

test('QUAL-02 D17-02 contract: roundtrip path preserves portability schema and import-commit handshake', () => {
  const mainSource = readMainSource()
  const schemaSource = readThemeSchema()
  assert.match(mainSource, /ipcMain\.handle\('theme:export'/)
  assert.match(mainSource, /const theme = loadThemeDefinition\(themeId\)/)
  assert.match(mainSource, /schemaVersion:\s*THEME_PORTABILITY_SCHEMA_VERSION/)
  assert.match(mainSource, /theme,\s*[\r\n]+\s*}/)
  assert.match(mainSource, /ipcMain\.handle\('theme:importCommit'/)
  assert.match(mainSource, /validateThemePortabilityImportPayload\(\{\s*schemaVersion:\s*THEME_PORTABILITY_SCHEMA_VERSION/)
  assert.match(schemaSource, /export interface ThemePortabilityExportDto[\s\S]*schemaVersion:\s*typeof THEME_PORTABILITY_SCHEMA_VERSION[\s\S]*theme:\s*ThemeDefinition/)
})

test('QUAL-02 D17-03 contract: invalid import returns diagnostics and commit rollback restores config atomicity', () => {
  const source = readMainSource()
  assert.match(source, /ipcMain\.handle\('theme:import'[\s\S]*if \(!validation\.success\)[\s\S]*status:\s*'invalid'[\s\S]*diagnostics:\s*validation\.diagnostics/)
  assert.match(source, /const rollbackTheme = loadThemeDefinition\(targetThemeId\)/)
  assert.match(source, /const rollbackConfig = readThemeConfigForWrite\(\)/)
  assert.match(source, /catch \(error\)[\s\S]*writeThemeConfig\(rollbackConfig\)/)
  assert.match(source, /导入提交失败，已回滚/)
})
