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

  const navBlockMatch = source.match(/const\s+applyCodeLineNavigation\s*=\s*useCallback\(\(navAction:\s*CodeLineNavigationAction\)\s*=>\s*\{[\s\S]*?\n\s*\},\s*\[commit,\s*focusInlineInputAt,\s*resolveVisibleCodeLineTarget,\s*startEditCell,\s*startEditLine\]\)/)
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

test('keyboard dispatcher contract: unchanged existing flow commands do not rebuild structure', () => {
  const source = fs.readFileSync(tableEditorTsxPath, 'utf-8')

  assert.match(source, /const\s+inferredFlowStart\s*=\s*\(\(\)\s*=>\s*\{[\s\S]*?for\s*\(const\s+candidateKw\s+of\s+Object\.keys\(FLOW_START\)\)/)
  assert.match(source, /if\s*\(editCell\.isVirtual\s*\|\|\s*originalFlowKw\)\s*return\s+null/)
  // 推断仅允许在渲染层已标记为流程起始的行上进行，普通正文行禁止推断（否则会误溶解所属结构）。
  assert.match(source, /if\s*\(!wasFlowStartRef\.current\)\s*return\s+null/)
  assert.match(source, /const\s+effectiveOriginalFlowKw\s*=\s*originalFlowKw\s*\|\|\s*inferredFlowStart\?\.kw\s*\|\|\s*''/)
  assert.match(source, /const\s+editingExistingFlowStart\s*=\s*!editCell\.isVirtual\s*&&\s*!!effectiveOriginalFlowKw\s*&&\s*!!FLOW_START\[effectiveOriginalFlowKw\]/)
  assert.match(source, /const\s+existingFlowCommandIsComplete\s*=\s*!editingExistingFlowStart\s*\|\|\s*!!getOuterParenRange\(codeLineEditOrigValRef\.current\.trim\(\)\)/)
  assert.match(source, /if\s*\(unchanged\s*&&\s*flowContext\s*&&\s*existingFlowCommandIsComplete\)/)
  // 纯改参数（同关键字编辑 isSameFlowKeywordEdit）即使 body 缩进不规范致 existingFlowStructureIsIntact 误判也保结构
  assert.match(source, /const\s+preservesExistingFlowStructure\s*=\s*editingExistingFlowStart\s*&&\s*\(existingFlowStructureIsIntact\s*\|\|\s*isSameFlowKeywordEdit\)\s*&&\s*\(!cmdCheckName\s*\|\|\s*cmdCheckName\s*===\s*effectiveOriginalFlowKw\)/)
  assert.match(source, /let\s+extraLines\s*=\s*preservesExistingFlowStructure\s*\?\s*\[\]\s*:\s*formattedLines\.slice\(1\)/)
})

test('keyboard dispatcher contract: damaged existing flow structure dissolves before reformatting', () => {
  const source = fs.readFileSync(tableEditorTsxPath, 'utf-8')

  assert.match(source, /const\s+existingFlowStructureIsIntact\s*=\s*\(\(\)\s*=>\s*\{[\s\S]*?const\s+expected\s*=\s*\(FLOW_AUTO_COMPLETE\[effectiveOriginalFlowKw\]\s*\|\|\s*\[\]\)\.filter/)
  // 纯改参数（同关键字编辑 isSameFlowKeywordEdit）即使 body 缩进不规范致 existingFlowStructureIsIntact 误判也保结构
  assert.match(source, /const\s+preservesExistingFlowStructure\s*=\s*editingExistingFlowStart\s*&&\s*\(existingFlowStructureIsIntact\s*\|\|\s*isSameFlowKeywordEdit\)\s*&&\s*\(!cmdCheckName\s*\|\|\s*cmdCheckName\s*===\s*effectiveOriginalFlowKw\)/)
  // 同关键字纯改参数（isSameFlowKeywordEdit）绝不溶解——闸在最前
  assert.match(source, /const\s+shouldDissolveExistingFlow\s*=\s*editingExistingFlowStart\s*&&\s*!isSameFlowKeywordEdit\s*&&\s*\(!newIsFlow\s*\|\|\s*!existingFlowStructureIsIntact\s*\|\|\s*cmdCheckName\s*!==\s*effectiveOriginalFlowKw\)/)
  assert.match(source, /const\s+dissolvedReplacementLines\s*=\s*newIsFlow[\s\S]*?\?\s*\[dropOneFlowIndent\(mainLine\),\s*\.\.\.extraLines\.map\(dropOneFlowIndent\)\][\s\S]*?:\s*\[dropOneFlowIndent\(mainLine\)\]/)
})

test('keyboard dispatcher contract: invalidated flow command removes structural shell', () => {
  const source = fs.readFileSync(tableEditorTsxPath, 'utf-8')

  assert.match(source, /if\s*\(trimmed\s*===\s*''\)\s*\{[\s\S]*?if\s*\(newIsFlow\)\s*unindentSet\.add\(i\)[\s\S]*?else\s*deleteSet\.add\(i\)/)
  assert.match(source, /const\s+patternKws\s*=\s*\(FLOW_AUTO_COMPLETE\[oldKw\]\s*\|\|\s*\[\]\)\.filter\(\(kw\):\s*kw\s+is\s+string\s*=>\s*!!kw\)/)
  assert.match(source, /const\s+branchKwSet\s*=\s*new\s+Set<string>\(patternKws\.filter\(kw\s*=>\s*kw\s*!==\s*endKw\)\)/)
  assert.match(source, /if\s*\(lineIndentLen\s*<\s*baseIndentLen\s*&&\s*newIsFlow\)\s*break/)
  assert.match(source, /if\s*\(!newIsFlow\)\s*\{[\s\S]*?unindentSet\.add\(i\)[\s\S]*?continue[\s\S]*?\}/)
  assert.match(source, /\/\/[\s\S]*?\n\s*unindentSet\.add\(i\)\s*\n\s*\}/)
  assert.match(source, /if\s*\(kw\s*&&\s*branchKwSet\.has\(kw\)\)\s*\{[\s\S]*?deleteSet\.add\(i\)[\s\S]*?continue/)
  assert.match(source, /if\s*\(kw\s*&&\s*endKwSet\.has\(kw\)\)\s*\{[\s\S]*?deleteSet\.add\(i\)[\s\S]*?break/)
})

test('keyboard dispatcher contract: code line input guards paren protection, smart quotes and caret restore', () => {
  const source = fs.readFileSync(tableEditorTsxPath, 'utf-8')

  // 命令调用行右括号之后禁止插入内容
  assert.match(source, /isPureCommandCall\s*&&\s*insertAt\s*>=\s*trimmedOld\.length/)
  // 智能引号：光标右侧已是引号时跳过；成对上屏光标置中
  assert.match(source, /const\s+isQuoteChar\s*=\s*\(c\?:\s*string\):\s*boolean\s*=>/)
  assert.match(source, /if\s*\(isQuoteChar\(old\[insertAt\]\)\)/)
  // 归一化改写值后由 layout effect 同步恢复光标（防止下一个按键落到行尾）
  assert.match(source, /const\s+pendingInputCaretRef\s*=\s*useRef<number\s*\|\s*null>\(null\)/)
  assert.match(source, /useLayoutEffect\(\(\)\s*=>\s*\{[\s\S]{0,400}?pendingInputCaretRef\.current\s*=\s*null[\s\S]{0,200}?setSelectionRange\(pos,\s*pos\)/)
})

test('keyboard dispatcher contract: same-line horizontal drag selects text instead of whole row', () => {
  const source = fs.readFileSync(tableEditorTsxPath, 'utf-8')

  assert.match(source, /const\s+lineTextDragCandidateRef\s*=\s*useRef/)
  assert.match(source, /const\s+lineTextSelectDragRef\s*=\s*useRef/)
  assert.match(source, /const\s+beginLineTextSelectRef\s*=\s*useRef/)
  // 纵向拖动意图或拖到另一行 → 行多选；同行横向 → 文本选择
  assert.match(source, /Math\.abs\(dy\)\s*>=\s*Math\.abs\(dx\)/)
  // 文本拖选中拖出该行 → 退出编辑态转行多选
  assert.match(source, /lineTextSelectDragRef\.current\s*=\s*null[\s\S]{0,200}?setEditCell\(null\)/)
})

test('keyboard dispatcher contract: expanded param rows support nested expression editing with manual fold', () => {
  const source = fs.readFileSync(tableEditorTsxPath, 'utf-8')

  // 嵌套表达式行编辑：exprPath 路径定位 + 按路径替换子表达式
  assert.match(source, /exprPath\?: number\[\]/)
  assert.match(source, /const\s+replaceExprAtPath\s*=\s*useCallback/)
  assert.match(source, /replaceExprAtPath\(parseCallArgs\(codeLine\)\[editCell\.paramIdx\]\s*\?\?\s*'',\s*editCell\.exprPath,\s*formattedVal\)/)
  // 嵌套编辑不做实时同步，提交时一次性替换
  assert.match(source, /if\s*\(editCell\.exprPath\s*&&\s*editCell\.exprPath\.length\s*>\s*0\)\s*return/)
  // 子树展开由 +/- 手动控制（不随焦点自动展开/收缩）
  assert.match(source, /expandedParamExprKeys/)
  assert.match(source, /eyc-param-expr-fold/)
  // 参数行输入采用与代码行一致的内联无缝编辑
  assert.match(source, /eyc-param-inline-edit-sizing/)
})

test('keyboard dispatcher contract: arrow navigation clamps at document boundaries', () => {
  const source = fs.readFileSync(tableEditorTsxPath, 'utf-8')

  // 顶部越界：进入程序集名表格单元格；底部越界：停留在当前行，焦点不消失
  assert.match(source, /if\s*\(direction === -1\)\s*\{[\s\S]{0,500}?startsWith\('\.程序集 '\)/)
  assert.match(source, /startEditCell\(asmLine,\s*0,\s*name,\s*0,\s*false\)/)
  assert.match(source, /const\s+stayLine\s*=\s*resolveVisibleCodeLineTarget\(/)
})

test('keyboard dispatcher contract: param input suppresses global focus ring', () => {
  const cssPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/EycTableEditor.css')
  const css = fs.readFileSync(cssPath, 'utf-8')

  assert.match(css, /\.eyc-param-val-input:focus,\s*\n\.eyc-param-val-input:focus-visible\s*\{[\s\S]{0,200}?outline:\s*none/)
  // +/- 折叠按钮定位到行号右侧 gutter 区域
  assert.match(css, /\.eyc-param-expr-fold\s*\{[\s\S]{0,300}?left:\s*calc\(54px - var\(--eyc-param-expand-padding-left/)
})

test('keyboard dispatcher contract: flow boundary detection uses real subroutine markers', () => {
  const source = fs.readFileSync(tableEditorTsxPath, 'utf-8')

  // 边界判断必须用真实关键字“.子程序 / .程序集”；曾因编码损坏写成乱码，导致结构扫描跨子程序边界。
  const boundaryMatches = source.match(/\.startsWith\('\.子程序 '\)/g) || []
  assert.ok(boundaryMatches.length >= 3, `expected >=3 subroutine boundary checks, got ${boundaryMatches.length}`)
  assert.doesNotMatch(source, /瀛愮▼搴|绋嬪簭闆/)
})

test('keyboard dispatcher contract: deleting/emptying a flow structure line dissolves it', () => {
  const source = fs.readFileSync(tableEditorTsxPath, 'utf-8')

  // 溶解语义：删除或编辑清空流程结构行后，整个结构溶解。
  // 结束行被删 → 起始未闭合，删起始/分支、正文反缩进（仅对本次删除的结束关键字族生效）。
  assert.match(source, /const\s+repairBrokenFlowAfterDelete\s*=\s*useCallback\(\(sourceLines:\s*string\[\],\s*deletedFlowEndKws\?:\s*Set<string>\):\s*string\[\]\s*=>\s*\{/)
  assert.match(source, /if\s*\(!deletedFlowEndKws\s*\|\|\s*deletedFlowEndKws\.size\s*===\s*0\)\s*return\s+sourceLines/)
  // 起始行被删 → 删头+分支+结束、正文反缩进（必须在头还在时定位，否则误吞兄弟语句）。
  assert.match(source, /const\s+dissolveFlowStructureAtHead\s*=\s*useCallback\(/)
  // 删除行三路径经流程感知删除：单个起始行走 dissolveFlowStructureAtHead，其余走结束行溶解。
  assert.match(source, /const\s+applyFlowAwareDeletion\s*=\s*useCallback\(/)
  assert.match(source, /const\s+dissolveSingleFlowHeadIfAny\s*=\s*useCallback\(/)
  // 编辑路径：结束/起始行被逐字符退格清空后失焦或删空行，也要溶解（用 codeLineEditOrigValRef 原值判定）。
  assert.match(source, /const\s+origEndKw\s*=\s*extractFlowKw\(codeLineEditOrigValRef\.current\s*\|\|\s*''\)/)
  assert.match(source, /const\s+editedLineOrigKw\s*=\s*extractFlowKw\(codeLineEditOrigValRef\.current\s*\|\|\s*''\)/)
})
