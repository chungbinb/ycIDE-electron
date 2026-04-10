import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const iconTsxPath = path.resolve(process.cwd(), 'src/renderer/src/components/Icon/Icon.tsx')
const iconCssPath = path.resolve(process.cwd(), 'src/renderer/src/components/Icon/Icon.css')

test('Icon rendering removes hardcoded dark-theme replacement mapping', () => {
  const source = fs.readFileSync(iconTsxPath, 'utf-8')
  assert.doesNotMatch(source, /function\s+adaptForDarkTheme/)
  assert.doesNotMatch(source, /fill:\s*#212121|fill:\s*#005dba|fill:\s*#996f00/)
})

test('Icon rendering uses token-driven currentColor strategy', () => {
  const source = fs.readFileSync(iconTsxPath, 'utf-8')
  const css = fs.readFileSync(iconCssPath, 'utf-8')
  assert.match(source, /currentColor/)
  assert.match(css, /color:\s*var\(--/)
})
