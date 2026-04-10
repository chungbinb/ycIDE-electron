import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const tokenContractPath = path.resolve(process.cwd(), 'src/shared/theme-tokens.ts')
const themeSchemaPath = path.resolve(process.cwd(), 'src/shared/theme.ts')
const mainThemePath = path.resolve(process.cwd(), 'src/main/index.ts')
const preloadThemePath = path.resolve(process.cwd(), 'src/preload/index.ts')
const darkThemePath = path.resolve(process.cwd(), 'themes/默认深色.json')
const lightThemePath = path.resolve(process.cwd(), 'themes/默认浅色.json')

function readTokenContract() {
  return fs.readFileSync(tokenContractPath, 'utf-8')
}

function readThemeSchema() {
  return fs.readFileSync(themeSchemaPath, 'utf-8')
}

test('token groups match business grouping and Chinese labels', () => {
  const source = readTokenContract()
  assert.match(source, /id:\s*'base'[\s\S]*label:\s*'基础文本\/背景'/)
  assert.match(source, /id:\s*'syntax'[\s\S]*label:\s*'语法高亮'/)
  assert.match(source, /id:\s*'table-header'[\s\S]*label:\s*'表格与表头'/)
  assert.match(source, /id:\s*'flow-line'[\s\S]*label:\s*'流程线'/)
  assert.match(source, /export const THEME_TOKEN_UI_GROUPS/)
  assert.doesNotMatch(source, /tokenKey:\s*item\.tokenKey/)
})

test('syntax and table/header groups expose full configurable categories', () => {
  const source = readTokenContract()
  assert.match(source, /--syntax-keyword/)
  assert.match(source, /--syntax-string/)
  assert.match(source, /--syntax-number/)
  assert.match(source, /--syntax-comment/)
  assert.match(source, /--syntax-function/)
  assert.match(source, /--syntax-type/)
  assert.match(source, /--table-bg/)
  assert.match(source, /--table-text/)
  assert.match(source, /--table-border/)
  assert.match(source, /--table-header-bg/)
  assert.match(source, /--table-header-text/)
  assert.match(source, /--table-row-hover-bg/)
  assert.match(source, /--table-selection-bg/)
})

test('flow-line mode contract supports single/multi and active-mode-targeted reset semantics', () => {
  const source = readTokenContract()
  assert.match(source, /export type FlowLineMode = 'single' \| 'multi'/)
  assert.match(source, /export type FlowLineResetScope = 'active-mode'/)
  assert.match(source, /export interface FlowLineModeConfig/)
  assert.match(source, /mode:\s*FlowLineMode/)
  assert.match(source, /single:\s*FlowLineSingleConfig/)
  assert.match(source, /multi:\s*FlowLineMultiConfig/)
})

test('theme schema migration includes token payload defaults for legacy configs', () => {
  const source = readThemeSchema()
  assert.match(source, /export interface ThemeTokenPayload/)
  assert.match(source, /flowLine:\s*FlowLineModeConfig/)
  assert.match(source, /createDefaultThemeTokenPayload/)
  assert.match(source, /createDefaultThemeConfig[\s\S]*themePayloads/)
  assert.match(source, /isThemeConfigV2[\s\S]*themePayloads/)
})

test('theme IPC round-trips grouped token payload and flow-line mode data', () => {
  const mainSource = fs.readFileSync(mainThemePath, 'utf-8')
  const preloadSource = fs.readFileSync(preloadThemePath, 'utf-8')
  assert.match(mainSource, /ipcMain\.handle\('theme:saveCurrent'/)
  assert.match(mainSource, /themePayloads/)
  assert.match(mainSource, /theme:getCurrent[\s\S]*themePayload/)
  assert.match(preloadSource, /saveCurrent:\s*\(/)
  assert.match(preloadSource, /ipcRenderer\.invoke\('theme:saveCurrent'/)
})

test('invalid or missing token payload safely falls back to defaults without warning regressions', () => {
  const source = readThemeSchema()
  const mainSource = fs.readFileSync(mainThemePath, 'utf-8')
  assert.match(source, /resolveThemeTokenPayload/)
  assert.match(source, /sanitizeThemeTokenValues/)
  assert.match(mainSource, /createThemeWarning\('legacy_migrated'/)
  assert.match(mainSource, /createDefaultThemeTokenPayload/)
})

test('built-in dark and light themes seed full phase-14 token defaults', () => {
  const darkTheme = JSON.parse(fs.readFileSync(darkThemePath, 'utf-8'))
  const lightTheme = JSON.parse(fs.readFileSync(lightThemePath, 'utf-8'))
  const requiredKeys = [
    '--text-primary',
    '--bg-primary',
    '--syntax-keyword',
    '--syntax-string',
    '--syntax-number',
    '--syntax-comment',
    '--syntax-function',
    '--syntax-type',
    '--syntax-variable',
    '--syntax-operator',
    '--table-bg',
    '--table-text',
    '--table-border',
    '--table-header-bg',
    '--table-header-text',
    '--table-row-hover-bg',
    '--table-selection-bg',
    '--flow-line-main',
    '--flow-line-branch',
    '--flow-line-loop',
    '--flow-line-arrow',
    '--flow-line-inner-link',
  ]
  for (const key of requiredKeys) {
    assert.equal(typeof darkTheme.colors?.[key], 'string')
    assert.equal(typeof lightTheme.colors?.[key], 'string')
  }
})
