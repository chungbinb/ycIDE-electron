import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'

const runtimeRequire = createRequire(import.meta.url)

function toPlain(value) {
  return JSON.parse(JSON.stringify(value))
}

function loadTsModule(tsPath, mockRequire = {}) {
  const source = fs.readFileSync(tsPath, 'utf-8')
  const compiledRaw = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: tsPath,
  }).outputText
  // vm + CommonJS 测试桩不支持 import.meta，统一降级为非 DEV 分支。
  const compiled = compiledRaw.replace(/import\.meta\.env\.DEV/g, 'false')

  const module = { exports: {} }
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(mockRequire, request)) {
      return mockRequire[request]
    }
    return runtimeRequire(request)
  }

  const context = vm.createContext({
    module,
    exports: module.exports,
    require: localRequire,
    console,
  })

  const script = new vm.Script(compiled, { filename: tsPath })
  script.runInContext(context)
  return module.exports
}

const tableUtilsPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/editorTableRowUtils.ts')
const flowUtilsPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/editorFlowAutoExpandUtils.ts')
const flowPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/eycFlow.ts')
const coreUtilsPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/editorCoreUtils.ts')
const formatPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/eycFormat.ts')
const blocksPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/eycBlocks.ts')
const pasteUtilsPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/editorPasteUtils.ts')

function loadFormatModule() {
  const { parseLines } = loadTsModule(blocksPath)
  return loadTsModule(formatPath, {
    './eycBlocks': { parseLines },
  })
}

test('table utils: template lookup returns expected insert line', () => {
  const { getTableRowInsertTemplate } = loadTsModule(tableUtilsPath)
  assert.equal(getTableRowInsertTemplate('.子程序 测试, , , '), '    .参数 , 整数型')
  assert.equal(getTableRowInsertTemplate('.常量 名称, 1'), '.常量 , ')
  assert.equal(getTableRowInsertTemplate('普通代码行'), null)
})

test('table utils: scoped variable rename stays in current declaration scope', () => {
  const { applyScopedVariableRename } = loadTsModule(tableUtilsPath)

  const lines = [
    '.程序集 Demo',
    '.子程序 A, , , ',
    '    .局部变量 变量A, 整数型',
    '    变量A = 1',
    '.子程序 B, , , ',
    '    变量A = 2',
  ]

  const renamed = applyScopedVariableRename({
    lines,
    lineIndex: 2,
    declarationLine: lines[2],
    oldName: '变量A',
    newName: '变量B',
  })

  assert.equal(renamed[3].includes('变量B'), true)
  assert.equal(renamed[5].includes('变量B'), false)
})

test('paste utils: dll declarations paste into dll section instead of current sub', () => {
  const { parseLines } = loadTsModule(blocksPath)
  const { buildMultiLinePasteResult } = loadTsModule(pasteUtilsPath, {
    './eycBlocks': { parseLines },
  })

  const currentText = [
    '.版本 2',
    '.DLL命令 旧命令, 整数型, , ""',
    '    .参数 p, 整数型',
    '.程序集 窗口程序集_启动窗口',
    '.子程序 A, 整数型',
    '    如果真 (1)',
    '        返回 (0)',
    '    如果真结束',
  ].join('\n')

  const clipText = [
    '.DLL命令 新命令, 整数型, , ""',
    '    .参数 x, 整数型',
  ].join('\n')

  const result = buildMultiLinePasteResult({
    currentText,
    clipText,
    cursorLine: 6,
    sanitizePastedText: (t) => t,
  })

  assert.ok(result)
  assert.equal(result.insertAt, 3)
  const lines = result.nextText.split('\n')
  assert.equal(lines[3], '.DLL命令 新命令, 整数型, , ""')
  assert.equal(lines[4], '    .参数 x, 整数型')
})

test('paste utils: dll declarations without existing dll section insert before first assembly/sub', () => {
  const { parseLines } = loadTsModule(blocksPath)
  const { buildMultiLinePasteResult } = loadTsModule(pasteUtilsPath, {
    './eycBlocks': { parseLines },
  })

  const currentText = [
    '.版本 2',
    '.支持库 spec',
    '.程序集 窗口程序集_启动窗口',
    '.子程序 A, 整数型',
    '    返回 (0)',
  ].join('\n')

  const clipText = '.DLL命令 新命令, 整数型, , ""'

  const result = buildMultiLinePasteResult({
    currentText,
    clipText,
    cursorLine: 4,
    sanitizePastedText: (t) => t,
  })

  assert.ok(result)
  assert.equal(result.insertAt, 2)
  assert.equal(result.nextText.split('\n')[2], '.DLL命令 新命令, 整数型, , ""')
})

test('paste utils: routed declarations can skip inline insertion when only special declarations exist', () => {
  const { parseLines } = loadTsModule(blocksPath)
  const { buildMultiLinePasteResult } = loadTsModule(pasteUtilsPath, {
    './eycBlocks': { parseLines },
  })

  const currentText = ['.程序集 Demo', '.子程序 A, 整数型', '    返回 (0)'].join('\n')
  const clipText = '.DLL命令 新命令, 整数型, , ""\n    .参数 x, 整数型'

  const result = buildMultiLinePasteResult({
    currentText,
    clipText,
    cursorLine: 2,
    sanitizePastedText: (t) => t,
    extractRoutedDeclarationLines: () => [{ language: 'ell', lines: clipText.split('\n') }],
  })

  assert.ok(result)
  assert.equal(result.nextText, currentText)
  assert.equal(result.pastedLineCount, 0)
  assert.deepEqual(toPlain(result.routedDeclarations), [{ language: 'ell', lines: clipText.split('\n') }])
})

test('paste utils: mixed paste routes declarations and keeps normal code inline', () => {
  const { parseLines } = loadTsModule(blocksPath)
  const { buildMultiLinePasteResult } = loadTsModule(pasteUtilsPath, {
    './eycBlocks': { parseLines },
  })

  const currentText = ['.程序集 Demo', '.子程序 A, 整数型', '    返回 (0)'].join('\n')
  const clipText = ['.常量 版本号, "1.0"', '输出调试文本 ("ok")'].join('\n')

  const result = buildMultiLinePasteResult({
    currentText,
    clipText,
    cursorLine: 2,
    sanitizePastedText: (t) => t,
    extractRoutedDeclarationLines: () => [{ language: 'ecs', lines: ['.常量 版本号, "1.0"'] }],
  })

  assert.ok(result)
  const lines = result.nextText.split('\n')
  assert.equal(lines[2], '    输出调试文本 ("ok")')
  assert.equal(result.pastedLineCount, 1)
  assert.deepEqual(toPlain(result.routedDeclarations), [{ language: 'ecs', lines: ['.常量 版本号, "1.0"'] }])
})

test('flow auto-expand utils: marker parsing and loop body building are deterministic', () => {
  const mockFlowModule = {
    FLOW_AUTO_TAG: '[AUTO]',
    FLOW_ELSE_MARK: '否则',
    FLOW_JUDGE_END_MARK: '判断尾',
    FLOW_TRUE_MARK: '如果真',
    extractFlowKw: (line) => (line || '').trim().split(/[\s(（]/)[0] || null,
  }

  const {
    parseFlowMarkerTargetLine,
    buildLoopFlowBodyLines,
    getAutoExpandCursorBaseLine,
    applyMainAndExtraLines,
    applyFlowMarkerSection,
  } = loadTsModule(flowUtilsPath, {
    './eycFlow': mockFlowModule,
  })

  const marker = parseFlowMarkerTargetLine('    \u200C判断 条件')
  assert.equal(marker.hasMarker, true)
  assert.equal(marker.flowMark, '    \u200C')
  assert.equal(marker.editValue, '判断 条件')

  const loopBody = buildLoopFlowBodyLines('    判断循环首(1)', ['        处理()'])
  assert.equal(loopBody.bodyIndent, '        ')
  assert.deepEqual(toPlain(loopBody.lines), ['    判断循环首(1)', '        ', '        处理()'])

  assert.equal(getAutoExpandCursorBaseLine(10, false), 10)
  assert.equal(getAutoExpandCursorBaseLine(10, true), 11)

  const targetLines = ['A', 'B', 'C']
  applyMainAndExtraLines({ lines: targetLines, lineIndex: 1, isVirtual: false, mainLine: 'M', extraLines: ['E1', 'E2'] })
  assert.deepEqual(toPlain(targetLines), ['A', 'M', 'E1', 'E2', 'C'])

  const markerLines = ['X', 'Y', 'Z']
  const cursorLine = applyFlowMarkerSection({
    lines: markerLines,
    lineIndex: 1,
    formattedLines: ['N1', 'N2'],
    flowMark: '    \u200D',
  })
  assert.equal(cursorLine, 2)
  assert.deepEqual(toPlain(markerLines), ['X', 'N1', 'N2', '    \u200D', 'Z'])
})

test('flow auto-expand utils: duplicate endings are removed only when scope already contains all endings', () => {
  const mockFlowModule = {
    FLOW_AUTO_TAG: '[AUTO]',
    FLOW_ELSE_MARK: '否则',
    FLOW_JUDGE_END_MARK: '判断尾',
    FLOW_TRUE_MARK: '如果真',
    extractFlowKw: (line) => (line || '').trim().split(/[\s(（]/)[0] || null,
  }

  const {
    removeDuplicateFlowAutoEndings,
    collectRemainingLinesInCurrentScope,
    trimTrailingEmptyFormattedLine,
  } = loadTsModule(flowUtilsPath, {
    './eycFlow': mockFlowModule,
  })

  const kept = removeDuplicateFlowAutoEndings(['[AUTO]收尾'], ['下一行'])
  assert.deepEqual(toPlain(kept), ['[AUTO]收尾'])

  const removed = removeDuplicateFlowAutoEndings(['[AUTO]收尾'], ['收尾'])
  assert.deepEqual(toPlain(removed), [])

  const scope = collectRemainingLinesInCurrentScope(
    ['    处理()', '.子程序 Next, , , ', '    不应进入'],
    0,
  )
  assert.deepEqual(toPlain(scope), ['    处理()'])

  assert.deepEqual(toPlain(trimTrailingEmptyFormattedLine(['A', ''])), ['A'])
  assert.deepEqual(toPlain(trimTrailingEmptyFormattedLine(['A', 'B'])), ['A', 'B'])
})

test('flow lines: keep inner vertical line when else marker is followed by nested flow', () => {
  const { computeFlowLines } = loadTsModule(flowPath)
  const FLOW_TRUE_MARK = '\u200C'
  const FLOW_ELSE_MARK = '\u200D'
  const lines = [
    '.子程序 A, , , ',
    '    .如果 (x)',
    `    ${FLOW_TRUE_MARK}`,
    '        .如果 (y)',
    '            执行()',
    `        ${FLOW_ELSE_MARK}`,
    `    ${FLOW_ELSE_MARK}`,
    '',
  ]
  const blocks = lines.map((codeLine, lineIndex) => ({ kind: 'codeline', lineIndex, codeLine, rows: [] }))

  const result = computeFlowLines(blocks)
  const linkLineSegs = result.map.get(3) || []
  const outerThroughOnLinkLine = linkLineSegs.find(seg => seg.depth === 0 && seg.type === 'through')
  const segs = result.map.get(4) || []
  const outerThroughSeg = segs.find(seg => seg.depth === 0 && seg.type === 'through')

  assert.ok(outerThroughOnLinkLine)
  assert.equal(outerThroughOnLinkLine.hasInnerLink, true)
  assert.equal(outerThroughOnLinkLine.hasInnerVert, true)
  assert.ok(outerThroughSeg)
  assert.equal(outerThroughSeg.outerHidden, true)
  assert.equal(outerThroughSeg.hasInnerVert, true)
})

test('flow lines: preserve inner vertical continuity across multi-line nested branch under 200D', () => {
  const { computeFlowLines } = loadTsModule(flowPath)
  const FLOW_TRUE_MARK = '\u200C'
  const FLOW_ELSE_MARK = '\u200D'
  const lines = [
    '.子程序 A, , , ',
    '    .如果 (A)',
    `        ${FLOW_TRUE_MARK}`,
    '        .如果 (B)',
    '            .如果 (C)',
    '                执行1()',
    '                执行2()',
    `            ${FLOW_ELSE_MARK}`,
    `        ${FLOW_ELSE_MARK}`,
    `    ${FLOW_ELSE_MARK}`,
  ]
  const blocks = lines.map((codeLine, lineIndex) => ({ kind: 'codeline', lineIndex, codeLine, rows: [] }))

  const result = computeFlowLines(blocks)
  const line6Segs = result.map.get(5) || []
  const line7Segs = result.map.get(6) || []
  const outerThroughAt6 = line6Segs.find(seg => seg.depth === 0 && seg.type === 'through')
  const outerThroughAt7 = line7Segs.find(seg => seg.depth === 0 && seg.type === 'through')

  assert.ok(outerThroughAt6)
  assert.equal(outerThroughAt6.outerHidden, true)
  assert.equal(outerThroughAt6.hasInnerVert, true)
  assert.ok(outerThroughAt7)
  assert.equal(outerThroughAt7.outerHidden, true)
  assert.equal(outerThroughAt7.hasInnerVert, true)
})

test('flow lines: ignore unmatched 200C marker indentation instead of binding to top stack flow', () => {
  const { computeFlowLines } = loadTsModule(flowPath)
  const FLOW_TRUE_MARK = '\u200C'
  const FLOW_ELSE_MARK = '\u200D'
  const lines = [
    '.子程序 A, , , ',
    '    .如果 (A)',
    `    ${FLOW_TRUE_MARK}`,
    '        .如果 (B)',
    '            执行()',
    `                ${FLOW_TRUE_MARK}`,
    `        ${FLOW_ELSE_MARK}`,
    `    ${FLOW_ELSE_MARK}`,
  ]
  const blocks = lines.map((codeLine, lineIndex) => ({ kind: 'codeline', lineIndex, codeLine, rows: [] }))

  const result = computeFlowLines(blocks)
  const unmatchedSegs = result.map.get(5) || []
  const innerBranchOnUnmatchedLine = unmatchedSegs.find(seg => seg.depth === 1 && seg.type === 'branch')

  assert.equal(innerBranchOnUnmatchedLine, undefined)
})

test('colorize: parentheses and operators use eyc-punct (non-bold) class', () => {
  const { colorize } = loadTsModule(coreUtilsPath, {
    './eycBlocks': {
      splitCSV: (text) => String(text || '').split(','),
    },
    './eycFlow': {
      FLOW_KW: new Set(),
    },
  })
  const spans = colorize('    求和(1, 2)')
  const punctTexts = spans.filter(s => s.cls === 'eyc-punct').map(s => s.text)

  assert.equal(punctTexts.includes('('), true)
  assert.equal(punctTexts.includes(','), true)
  assert.equal(punctTexts.includes(')'), true)
})

test('paste sanitize: internal flow text stays idempotent and does not drift into judge marker', () => {
  const { sanitizePastedTextForCurrent, normalizeEycText } = loadFormatModule()
  const C = '\u200C'
  const D = '\u200D'
  const internal = [
    '.子程序 A, , , ',
    '    如果（）',
    `    ${C}`,
    '        如果（）',
    `        ${C}333`,
    `        ${D}`,
    `    ${D}`,
  ].join('\n')

  const out = sanitizePastedTextForCurrent(internal, '.程序集 Demo')
  assert.equal(out, normalizeEycText(internal))
  assert.equal(out.includes('\u2060'), false)
})

test('format save: keep .否则 when previous 200D belongs to nested inner branch', () => {
  const { eycToYiFormat } = loadFormatModule()
  const C = '\u200C'
  const D = '\u200D'
  const internal = [
    '.子程序 A, , , ',
    '    如果 (A)',
    `    ${C}`,
    '        如果 (X)',
    `        ${C}111`,
    `        ${D}`,
    `    ${D}如果 (B)`,
    `    ${D}222`,
    `    ${D}`,
  ].join('\n')

  const out = eycToYiFormat(internal)
  assert.equal(out.includes('    .否则'), true)
})

test('format save: still emits .否则 when previous same-indent 200D is an empty end marker', () => {
  const { eycToYiFormat } = loadFormatModule()
  const C = '\u200C'
  const D = '\u200D'
  const internal = [
    '.子程序 A, , , ',
    '    如果 (A)',
    `    ${C}111`,
    `    ${D}222`,
    `    ${D}`,
  ].join('\n')

  const out = eycToYiFormat(internal)
  assert.equal(out.includes('    .否则'), true)
})

test('format save: never generate .否则 for 如果真 branch', () => {
  const { eycToYiFormat } = loadFormatModule()
  const D = '\u200D'
  const internal = [
    '.子程序 A, , , ',
    '    如果真 ()',
    `    ${D}22222`,
    `    ${D}`,
  ].join('\n')

  const out = eycToYiFormat(internal)
  assert.equal(out.includes('.否则'), false)
  assert.equal(out.includes('.如果真结束'), true)
  assert.equal(out.includes('22222'), true)
})

test('roundtrip: complex yi flow keeps else branches and if-true has no else', () => {
  const { eycToInternalFormat, eycToYiFormat } = loadFormatModule()
  const yi = [
    '.版本 2',
    '',
    '.如果 ()',
    '    .如果 ()',
    '        .如果真 ()',
    '            .如果 ()',
    '                22222',
    '            .否则',
    '',
    '            .如果结束',
    '',
    '        .如果真结束',
    '',
    '    .否则',
    '        .如果 ()',
    '',
    '        .否则',
    '            .如果 ()',
    '',
    '            .否则',
    '                .如果 ()',
    '',
    '                .否则',
    '',
    '                .如果结束',
    '',
    '            .如果结束',
    '',
    '        .如果结束',
    '',
    '    .如果结束',
    '',
    '.否则',
    '',
    '.如果结束',
    '',
    '.如果 ()',
    '',
    '.否则',
    '    .如果 ()',
    '',
    '    .否则',
    '',
    '    .如果结束',
    '',
    '.如果结束',
    '',
    '.如果真 ()',
    '',
    '.如果真结束',
  ].join('\n')

  const roundtrip = eycToYiFormat(eycToInternalFormat(yi))
  assert.equal(roundtrip.includes('.否则'), true)
  assert.equal(roundtrip.includes('.如果真 ()\n.否则'), false)
})

test('roundtrip: if inside else branch stays inside else branch', () => {
  const { eycToInternalFormat, eycToYiFormat } = loadFormatModule()
  const yi = [
    '.版本 2',
    '',
    '.如果 ()',
    '',
    '.否则',
    '    .如果 ()',
    '',
    '    .否则',
    '',
    '    .如果结束',
    '',
    '.如果结束',
  ].join('\n')

  const roundtrip = eycToYiFormat(eycToInternalFormat(yi))
  // 显式 else-open 标记保证内层 .如果 恢复时位于 .否则 之后。
  assert.equal(roundtrip.includes('.如果 ()'), true)
  assert.equal(roundtrip.includes('.如果结束'), true)
  const idxOuterElse = roundtrip.indexOf('\n.否则')
  const idxInnerIf = roundtrip.indexOf('\n    .如果 ()')
  assert.ok(idxOuterElse >= 0, 'outer .否则 should be emitted')
  assert.ok(idxInnerIf >= 0, 'inner .如果 should be emitted with indent')
  assert.ok(idxOuterElse < idxInnerIf, 'inner .如果 should appear inside outer .否则 branch')
})

test('paste sanitize: Yi flow source still converts into internal markers', () => {
  const { sanitizePastedTextForCurrent } = loadFormatModule()
  const yi = [
    '.子程序 A, , , ',
    '    .如果 (a)',
    '        333',
    '    .否则',
    '        444',
    '    .如果结束',
  ].join('\n')

  const out = sanitizePastedTextForCurrent(yi, '.程序集 Demo')
  assert.equal(out.includes('\u200C'), true)
  assert.equal(out.includes('\u200D'), true)
})

test('paste sanitize: strips assembly/file directives from pasted Yi snippet', () => {
  const { sanitizePastedTextForCurrent } = loadFormatModule()
  const yi = [
    '.版本 2',
    '.支持库 spec',
    '.如果 (a)',
    '    333',
    '.如果结束',
  ].join('\n')

  const out = sanitizePastedTextForCurrent(yi, '.程序集 Demo')
  assert.equal(out.includes('.版本 '), false)
  assert.equal(out.includes('.支持库 '), false)
  assert.equal(out.includes('\u200C') || out.includes('\u200D') || out.includes('\u2060'), true)
})

test('paste sanitize: removes standalone true-marker ghost lines from Yi flow source', () => {
  const { sanitizePastedTextForCurrent } = loadFormatModule()
  const yi = [
    '.如果 (a)',
    '    111',
    '',
    '.否则',
    '    222',
    '.如果结束',
  ].join('\n')

  const out = sanitizePastedTextForCurrent(yi, '.程序集 Demo')
  const hasStandaloneTrueMarker = out
    .split('\n')
    .some(line => line.trimStart() === '\u200C')
  assert.equal(hasStandaloneTrueMarker, false)
  assert.equal(out.includes('\u200D'), true)
})

test('paste sanitize: trims edge blanks and skips blank rows inside flow blocks', () => {
  const { sanitizePastedTextForCurrent } = loadFormatModule()
  const yi = [
    '.版本 2',
    '',
    '.如果 (a)',
    '    111',
    '',
    '.否则',
    '',
    '    222',
    '.如果结束',
    '',
  ].join('\n')

  const out = sanitizePastedTextForCurrent(yi, '.程序集 Demo')
  const outLines = out.split('\n')
  assert.equal(outLines[0] === '', false)
  assert.equal(outLines[outLines.length - 1] === '', false)
  assert.equal(out.includes('\n\n'), false)
})

test('paste sanitize: inserts minimal true-marker when true branch only contains nested flow', () => {
  const { sanitizePastedTextForCurrent } = loadFormatModule()
  const C = '\u200C'
  const yi = [
    '.如果 ()',
    '    .如果 ()',
    '        111',
    '    .如果结束',
    '.否则',
    '    222',
    '.如果结束',
  ].join('\n')

  const out = sanitizePastedTextForCurrent(yi, '.程序集 Demo')
  // 真分支的 [C] 标记既可独立成行（原行为），也可与 [D] 合并为 `[C][D]` 占同一行
  // （新行为，减少表格模式空行）。两种形式都保留了 [C] 的渲染语义。
  const hasTrueMarker = out.split('\n').some(line => {
    const t = line.trimStart()
    return t === C || t.startsWith(C)
  })
  assert.equal(hasTrueMarker, true)
  assert.equal(out.includes('\u200D'), true)
})
