import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const editorPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/Editor.tsx')
const monacoTokenPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/monacoThemeTokens.ts')
const appPath = path.resolve(process.cwd(), 'src/renderer/src/App.tsx')

test('Editor consumes editable token payload to build Monaco rules/colors', () => {
  const source = fs.readFileSync(editorPath, 'utf-8')
  assert.match(source, /import \{ buildMonacoThemeTokens \} from '\.\/monacoThemeTokens'/)
  assert.match(source, /buildMonacoThemeTokens\(/)
  assert.match(source, /themeTokenValues\?: Record<string, string>/)
})

test('Editor re-defines active Monaco theme at runtime when token payload changes', () => {
  const source = fs.readFileSync(editorPath, 'utf-8')
  assert.match(source, /useEffect\(\(\) => \{[\s\S]*registerEditorThemes\(/)
  assert.match(source, /theme=\{monacoThemeId\}/)
  assert.match(source, /defineTheme\('ycide-dark'/)
  assert.match(source, /theme=\{monacoThemeId\}/)
})

test('Monaco mapping helper exposes independently configurable major syntax classes', () => {
  const source = fs.readFileSync(monacoTokenPath, 'utf-8')
  assert.match(source, /keyword/i)
  assert.match(source, /comment/i)
  assert.match(source, /string/i)
  assert.match(source, /type/i)
  assert.match(source, /predefined/i)
  assert.match(source, /constant/i)
  assert.match(source, /identifier/i)
  assert.match(source, /operator/i)
  assert.match(source, /delimiter/i)
})

test('App passes active theme and token payload into Editor for runtime Monaco switching', () => {
  const source = fs.readFileSync(appPath, 'utf-8')
  assert.match(source, /debugVariables=\{debugPause\?\.variables \|\| \[\]\}\s*currentTheme=\{currentTheme\}\s*themeTokenValues=\{themeTokenValues\}/)
})
