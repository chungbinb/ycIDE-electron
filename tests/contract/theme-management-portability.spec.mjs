import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const themeSchemaPath = path.resolve(process.cwd(), 'src/shared/theme.ts')

function readThemeSchema() {
  return fs.readFileSync(themeSchemaPath, 'utf-8')
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
