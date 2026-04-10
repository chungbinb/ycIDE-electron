import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const appPath = path.resolve(process.cwd(), 'src/renderer/src/App.tsx')

test('App wires tools:settings menu action to theme settings dialog visibility', () => {
  const source = fs.readFileSync(appPath, 'utf-8')
  assert.match(source, /import ThemeSettingsDialog from '\.\/components\/ThemeSettingsDialog\/ThemeSettingsDialog'/)
  assert.match(source, /const \[showThemeSettings,\s*setShowThemeSettings\] = useState\(false\)/)
  assert.match(source, /case 'tools:settings':[\s\S]*setShowThemeSettings\(true\)/)
  assert.match(source, /<ThemeSettingsDialog[\s\S]*open=\{showThemeSettings\}/)
})

test('App provides a shared onSelectTheme callback from settings dialog', () => {
  const source = fs.readFileSync(appPath, 'utf-8')
  assert.match(source, /<ThemeSettingsDialog[\s\S]*onSelectTheme=\{\(themeId\) => \{ void applyTheme\(themeId\) \}\}/)
})
