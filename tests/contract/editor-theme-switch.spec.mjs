import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const editorPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/Editor.tsx')
const appPath = path.resolve(process.cwd(), 'src/renderer/src/App.tsx')

test('Editor defines ycide-light Monaco palette and uses dynamic Monaco theme prop', () => {
  const source = fs.readFileSync(editorPath, 'utf-8')
  assert.match(source, /defineTheme\('ycide-light'/)
  assert.match(source, /theme=\{monacoThemeId\}/)
})

test('App passes active currentTheme into Editor for runtime Monaco switching', () => {
  const source = fs.readFileSync(appPath, 'utf-8')
  assert.match(source, /<Editor\b(?:(?!>).)*currentTheme=\{currentTheme\}/s)
})
