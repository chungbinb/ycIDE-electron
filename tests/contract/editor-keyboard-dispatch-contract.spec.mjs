import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const tableEditorTsxPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/EycTableEditor.tsx')
const keyboardDispatchTsPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/editorKeyboardDispatch.ts')

function sliceOnKeySection(source) {
  const start = source.indexOf('const onKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {')
  if (start < 0) return ''
  const depStart = source.indexOf('  }, [', start)
  if (depStart < 0) return source.slice(start)
  return source.slice(start, depStart)
}

test('keyboard dispatcher contract: onKey keeps pre-guards and main dispatcher layering', () => {
  const source = fs.readFileSync(tableEditorTsxPath, 'utf-8')

  assert.match(source, /dispatchPreKeyGuards,/)
  assert.match(source, /dispatchMainEditingKey,/)

  const onKeySection = sliceOnKeySection(source)
  assert.match(onKeySection, /const\s+preAction\s*=\s*dispatchPreKeyGuards\(/)
  assert.match(onKeySection, /const\s+mainAction\s*=\s*dispatchMainEditingKey\(/)
  assert.match(onKeySection, /if\s*\(preAction\.handled\)/)
  assert.match(onKeySection, /if\s*\(mainAction\.handled\)/)

  // onKey should stay as router and avoid reintroducing key-specific inline branches.
  assert.doesNotMatch(onKeySection, /if\s*\(e\.key\s*===\s*'Enter'\)/)
  assert.doesNotMatch(onKeySection, /else\s+if\s*\(e\.key\s*===\s*'Backspace'\s*\|\|\s*e\.key\s*===\s*'Delete'\)/)
  assert.doesNotMatch(onKeySection, /else\s+if\s*\(e\.key\s*===\s*'Escape'\)/)
  assert.doesNotMatch(onKeySection, /else\s+if\s*\(e\.key\s*===\s*'ArrowUp'\s*\|\|\s*e\.key\s*===\s*'ArrowDown'/)
})

test('keyboard dispatcher contract: onKey dependencies reference high-level handlers', () => {
  const source = fs.readFileSync(tableEditorTsxPath, 'utf-8')

  const depBlockMatch = source.match(/const\s+onKey\s*=\s*useCallback\([\s\S]*?\n\s*\},\s*\[([\s\S]*?)\]\)/)
  assert.ok(depBlockMatch, 'onKey dependency block should exist')
  const deps = depBlockMatch[1]

  assert.match(deps, /applyArrowNavigationKey/)
  assert.match(deps, /applyCompletionPopupKey/)
  assert.match(deps, /applyCustomPasteShortcut/)
})

test('keyboard dispatcher contract: Ctrl+V preserves native fallback semantics', () => {
  const source = fs.readFileSync(tableEditorTsxPath, 'utf-8')
  const keyboardSource = fs.readFileSync(keyboardDispatchTsPath, 'utf-8')

  // Custom paste shortcut should explicitly opt out for native-paste scenarios.
  assert.match(source, /const\s+applyCustomPasteShortcut\s*=\s*useCallback\(\(\):\s*boolean\s*=>\s*\{[\s\S]*?return\s+false[\s\S]*?shouldUseNativeInputPaste\(editCell\)[\s\S]*?return\s+false/)

  // Ctrl dispatcher should map Ctrl+V preventDefault behavior to interception result.
  assert.match(keyboardSource, /if\s*\(key\s*===\s*'v'\)\s*\{[\s\S]*?const\s+intercepted\s*=\s*onPaste\(\)[\s\S]*?preventDefault:\s*intercepted/)

  // onKey should only call preventDefault based on pre-guard result (including Ctrl+V path).
  const onKeySection = sliceOnKeySection(source)
  assert.match(onKeySection, /if\s*\(preAction\.handled\)\s*\{[\s\S]*?if\s*\(preAction\.preventDefault\)\s*e\.preventDefault\(\)/)
})

test('keyboard dispatcher contract: cross-line arrow navigation refocuses inline input', () => {
  const source = fs.readFileSync(tableEditorTsxPath, 'utf-8')

  assert.match(source, /const\s+focusInlineInputAt\s*=\s*useCallback\(\(position:\s*number\s*\|\s*'end'\)\s*=>\s*\{[\s\S]*?input\.focus\(\{\s*preventScroll:\s*true\s*\}\)[\s\S]*?input\.setSelectionRange\(pos,\s*pos\)/)

  const navBlockMatch = source.match(/const\s+applyCodeLineNavigation\s*=\s*useCallback\(\(navAction:\s*CodeLineNavigationAction\)\s*=>\s*\{[\s\S]*?\n\s*\},\s*\[commit,\s*focusInlineInputAt,\s*resolveVisibleCodeLineTarget,\s*startEditLine\]\)/)
  assert.ok(navBlockMatch, 'applyCodeLineNavigation should depend on visible target resolution')
  const navBlock = navBlockMatch[0]

  assert.match(source, /const\s+visibleCodeLineIndexes\s*=\s*useMemo\(/)
  assert.match(source, /const\s+resolveVisibleCodeLineTarget\s*=\s*useCallback\(/)
  assert.match(navBlock, /const\s+currentLineIndex\s*=\s*editCellRef\.current\?\.lineIndex\s*\?\?\s*-1[\s\S]*?commit\(\)/)
  assert.match(navBlock, /navAction\.type\s*===\s*'upOrDown'[\s\S]*?resolveVisibleCodeLineTarget\(navAction\.targetLine,\s*direction,\s*latestLines\.length\)[\s\S]*?startEditLine\(targetLine\)[\s\S]*?focusInlineInputAt\(navAction\.keepHorizontalPos\)/)
  assert.match(navBlock, /navAction\.type\s*===\s*'leftToPrevLineEnd'[\s\S]*?resolveVisibleCodeLineTarget\(navAction\.targetLine,\s*-1,\s*latestLines\.length\)[\s\S]*?startEditLine\(targetLine\)[\s\S]*?focusInlineInputAt\('end'\)/)
  assert.match(navBlock, /navAction\.type\s*===\s*'rightToNextLineStart'[\s\S]*?resolveVisibleCodeLineTarget\(navAction\.targetLine,\s*1,\s*latestLines\.length\)[\s\S]*?startEditLine\(targetLine\)[\s\S]*?focusInlineInputAt\(0\)/)
})

test('keyboard dispatcher contract: completion popup arrow navigation keeps input focused', () => {
  const source = fs.readFileSync(tableEditorTsxPath, 'utf-8')

  const completionBlockMatch = source.match(/const\s+applyCompletionPopupKey\s*=\s*useCallback\(\(key:\s*string\):\s*boolean\s*=>\s*\{[\s\S]*?\n\s*\},\s*\[acIndex,\s*acItems,\s*acVisible,\s*applyCompletion,\s*editVal\.length,\s*expandMoreCompletion,\s*focusInlineInputAt\]\)/)
  assert.ok(completionBlockMatch, 'applyCompletionPopupKey should depend on focusInlineInputAt')
  const completionBlock = completionBlockMatch[0]

  assert.match(completionBlock, /const\s+handled\s*=\s*handleCompletionPopupKey\(/)
  assert.match(completionBlock, /handled\s*&&\s*\(key\s*===\s*'ArrowUp'\s*\|\|\s*key\s*===\s*'ArrowDown'\)[\s\S]*?focusInlineInputAt\(pos\)/)
})
