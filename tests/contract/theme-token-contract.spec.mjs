import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const tokenContractPath = path.resolve(process.cwd(), 'src/shared/theme-tokens.ts')

function readTokenContract() {
  return fs.readFileSync(tokenContractPath, 'utf-8')
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
