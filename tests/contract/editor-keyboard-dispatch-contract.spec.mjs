import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const tableEditorTsxPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/EycTableEditor.tsx')

function sliceOnKeySection(source) {
  const start = source.indexOf('const onKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {')
  if (start < 0) return ''
  const depStart = source.indexOf('  }, [', start)
  if (depStart < 0) return source.slice(start)
  return source.slice(start, depStart)
}

test('keyboard dispatcher contract: onKey keeps pre-guards and main dispatcher layering', () => {
  const source = fs.readFileSync(tableEditorTsxPath, 'utf-8')

  assert.match(source, /const\s+applyPreKeyGuards\s*=\s*useCallback\(/)
  assert.match(source, /const\s+applyMainEditingKey\s*=\s*useCallback\(/)

  const onKeySection = sliceOnKeySection(source)
  assert.match(onKeySection, /const\s+preAction\s*=\s*applyPreKeyGuards\(/)
  assert.match(onKeySection, /const\s+mainAction\s*=\s*applyMainEditingKey\(/)
  assert.match(onKeySection, /if\s*\(preAction\.handled\)/)
  assert.match(onKeySection, /if\s*\(mainAction\.handled\)/)

  // onKey should stay as router and avoid reintroducing key-specific inline branches.
  assert.doesNotMatch(onKeySection, /if\s*\(e\.key\s*===\s*'Enter'\)/)
  assert.doesNotMatch(onKeySection, /else\s+if\s*\(e\.key\s*===\s*'Backspace'\s*\|\|\s*e\.key\s*===\s*'Delete'\)/)
  assert.doesNotMatch(onKeySection, /else\s+if\s*\(e\.key\s*===\s*'Escape'\)/)
  assert.doesNotMatch(onKeySection, /else\s+if\s*\(e\.key\s*===\s*'ArrowUp'\s*\|\|\s*e\.key\s*===\s*'ArrowDown'/)
})

test('keyboard dispatcher contract: onKey dependencies reference high-level dispatchers', () => {
  const source = fs.readFileSync(tableEditorTsxPath, 'utf-8')

  const depBlockMatch = source.match(/const\s+onKey\s*=\s*useCallback\([\s\S]*?\n\s*\},\s*\[([\s\S]*?)\]\)/)
  assert.ok(depBlockMatch, 'onKey dependency block should exist')
  const deps = depBlockMatch[1]

  assert.match(deps, /applyPreKeyGuards/)
  assert.match(deps, /applyMainEditingKey/)
})

test('keyboard dispatcher contract: Ctrl+V preserves native fallback semantics', () => {
  const source = fs.readFileSync(tableEditorTsxPath, 'utf-8')

  // Custom paste shortcut should explicitly opt out for native-paste scenarios.
  assert.match(source, /const\s+applyCustomPasteShortcut\s*=\s*useCallback\(\(\):\s*boolean\s*=>\s*\{[\s\S]*?return\s+false[\s\S]*?shouldUseNativeInputPaste\(editCell\)[\s\S]*?return\s+false/)

  // Ctrl dispatcher should map Ctrl+V preventDefault behavior to interception result.
  assert.match(source, /if\s*\(key\s*===\s*'v'\)\s*\{[\s\S]*?const\s+intercepted\s*=\s*applyCustomPasteShortcut\(\)[\s\S]*?preventDefault:\s*intercepted/)

  // onKey should only call preventDefault based on pre-guard result (including Ctrl+V path).
  const onKeySection = sliceOnKeySection(source)
  assert.match(onKeySection, /if\s*\(preAction\.handled\)\s*\{[\s\S]*?if\s*\(preAction\.preventDefault\)\s*e\.preventDefault\(\)/)
})
