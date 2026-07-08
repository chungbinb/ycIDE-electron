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
const codeLineEditorPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/useCodeLineEditor.ts')

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
    './eycFlow': loadTsModule(flowPath),
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
    './eycFlow': loadTsModule(flowPath),
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
    './eycFlow': loadTsModule(flowPath),
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

test('paste utils: duplicate pasted sub names get _1/_2 suffix instead of merging', () => {
  const { parseLines } = loadTsModule(blocksPath)
  const { buildMultiLinePasteResult } = loadTsModule(pasteUtilsPath, {
    './eycBlocks': { parseLines },
    './eycFlow': loadTsModule(flowPath),
  })

  const currentText = [
    '.程序集 Demo',
    '',
    '.子程序 子程序1, , , ',
    '    调试输出 (1)',
    '',
    '.子程序 子程序1_1, , , ',
    '',
  ].join('\n')

  // 用户场景①：只复制了声明行的子程序，旧合并语义会整块剔除、粘贴毫无反应；
  // 现在应改名插入。_1 已被占用 → 升 _2。
  const headOnly = buildMultiLinePasteResult({
    currentText,
    clipText: '.子程序 子程序1, , , ',
    cursorLine: 3,
    sanitizePastedText: (t) => t,
  })
  assert.ok(headOnly)
  assert.match(headOnly.nextText, /\.子程序 子程序1_2, , , /)
  // 原有两个子程序原样保留
  assert.match(headOnly.nextText, /\.子程序 子程序1, , , /)
  assert.match(headOnly.nextText, /\.子程序 子程序1_1, , , /)

  // 用户场景②：带正文的重名子程序 → 整块改名插入，正文不再并入旧子程序
  const withBody = buildMultiLinePasteResult({
    currentText,
    clipText: ['.子程序 子程序1, , , ', '    调试输出 (2)'].join('\n'),
    cursorLine: 3,
    sanitizePastedText: (t) => t,
  })
  assert.ok(withBody)
  const bodyIdx = withBody.nextText.split('\n').findIndex(l => l === '.子程序 子程序1_2, , , ')
  assert.ok(bodyIdx >= 0)
  assert.equal(withBody.nextText.split('\n')[bodyIdx + 1], '    调试输出 (2)')

  // 不重名的子程序原名插入
  const fresh = buildMultiLinePasteResult({
    currentText,
    clipText: '.子程序 新子程序, , , ',
    cursorLine: 3,
    sanitizePastedText: (t) => t,
  })
  assert.ok(fresh)
  assert.match(fresh.nextText, /\.子程序 新子程序, , , /)
})

test('paste utils: pasted local variable lines relocate to the target sub declaration area', () => {
  const { parseLines } = loadTsModule(blocksPath)
  const { buildMultiLinePasteResult } = loadTsModule(pasteUtilsPath, {
    './eycBlocks': { parseLines },
    './eycFlow': loadTsModule(flowPath),
  })

  const currentText = [
    '.程序集 Demo',
    '',
    '.子程序 A, , , ',
    '.局部变量 a, 整数型',
    '    调试输出 (1)',
    '',
  ].join('\n')

  // 光标在子程序正文处粘贴纯局部变量 → 并入声明区（现有局部变量块末尾），不在光标处形成第二张变量表
  const pureVars = buildMultiLinePasteResult({
    currentText,
    clipText: ['.局部变量 b, 整数型', '.局部变量 c, 整数型'].join('\n'),
    cursorLine: 4,
    sanitizePastedText: (t) => t,
  })
  assert.ok(pureVars)
  const pv = pureVars.nextText.split('\n')
  assert.equal(pv[3], '.局部变量 a, 整数型')
  assert.equal(pv[4], '.局部变量 b, 整数型')
  assert.equal(pv[5], '.局部变量 c, 整数型')
  assert.equal(pv[6], '    调试输出 (1)')
  assert.equal(pureVars.insertAt, 4)
  assert.equal(pureVars.pastedLineCount, 2)

  // 混合粘贴：局部变量归位声明区、普通代码仍在光标处内联（变量在代码上方）
  const mixed = buildMultiLinePasteResult({
    currentText,
    clipText: ['.局部变量 d, 整数型', '调试输出 (2)'].join('\n'),
    cursorLine: 4,
    sanitizePastedText: (t) => t,
  })
  assert.ok(mixed)
  const ml = mixed.nextText.split('\n')
  assert.equal(ml[4], '.局部变量 d, 整数型')
  // 普通代码按光标行缩进整体平移（既有行为）
  assert.equal(ml[5], '    调试输出 (2)')
  assert.equal(ml[6], '    调试输出 (1)')

  // 片段自带子程序时，其局部变量随子程序保留、不被抽走
  const withSub = buildMultiLinePasteResult({
    currentText,
    clipText: ['.子程序 B, , , ', '.局部变量 x, 整数型'].join('\n'),
    cursorLine: 4,
    sanitizePastedText: (t) => t,
  })
  assert.ok(withSub)
  const ws = withSub.nextText.split('\n')
  const subIdx = ws.findIndex(l => l.startsWith('.子程序 B'))
  assert.ok(subIdx >= 0)
  assert.equal(ws[subIdx + 1], '.局部变量 x, 整数型')
})

test('paste utils: misplaced local variable lines relocate to their sub declaration area', () => {
  const { parseLines } = loadTsModule(blocksPath)
  const { relocateMisplacedLocalVarLines } = loadTsModule(pasteUtilsPath, {
    './eycBlocks': { parseLines },
    './eycFlow': loadTsModule(flowPath),
  })

  // 用户场景：子程序正文（空行后）出现三条局部变量 → 全部归位到声明区末尾（保持相对顺序）
  const text = [
    '.程序集 窗口程序集_启动窗口',
    '',
    '.子程序 __启动窗口_创建完毕, , , ',
    '.局部变量 a, 整数型',
    '    调试输出 (1)',
    '',
    '.局部变量 b, 整数型',
    '.局部变量 c, 整数型',
  ].join('\n')
  const out = relocateMisplacedLocalVarLines(text)
  const ol = out.split('\n')
  assert.equal(ol[3], '.局部变量 a, 整数型')
  assert.equal(ol[4], '.局部变量 b, 整数型')
  assert.equal(ol[5], '.局部变量 c, 整数型')
  assert.equal(ol[6], '    调试输出 (1)')

  // 无错位 → 返回 null（不写回）
  const clean = [
    '.子程序 A, , , ',
    '.局部变量 a, 整数型',
    '    调试输出 (1)',
  ].join('\n')
  assert.equal(relocateMisplacedLocalVarLines(clean), null)

  // 多子程序各归各：第二个子程序的错位行只进第二个的声明区
  const multi = [
    '.子程序 A, , , ',
    '    调试输出 (1)',
    '.局部变量 x, 整数型',
    '.子程序 B, , , ',
    '    调试输出 (2)',
    '.局部变量 y, 整数型',
  ].join('\n')
  const mo = relocateMisplacedLocalVarLines(multi).split('\n')
  assert.equal(mo[1], '.局部变量 x, 整数型')
  assert.equal(mo[2], '    调试输出 (1)')
  assert.equal(mo[4], '.局部变量 y, 整数型')
  assert.equal(mo[5], '    调试输出 (2)')
})

test('paste utils: mixed paste routes declarations and keeps normal code inline', () => {
  const { parseLines } = loadTsModule(blocksPath)
  const { buildMultiLinePasteResult } = loadTsModule(pasteUtilsPath, {
    './eycBlocks': { parseLines },
    './eycFlow': loadTsModule(flowPath),
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
  // 兼容旧数据契约：编辑态剥离 marker，但不再进入 marker 路径（hasMarker 恒为 false）。
  assert.equal(marker.hasMarker, false)
  assert.equal(marker.flowMark, '')
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
  // \u65B0\u5951\u7EA6\uFF1AflowMark \u88AB\u5FFD\u7565\uFF0C\u4E0D\u518D\u56DE\u63D2 marker \u884C\u3002
  assert.equal(cursorLine, 2)
  assert.deepEqual(toPlain(markerLines), ['X', 'N1', 'N2', 'Z'])
})

test('flow command normalize: dotted visible command matches auto expand key', () => {
  const { normalizeFlowCommandName } = loadTsModule(codeLineEditorPath, {
    react: { useCallback: (fn) => fn },
    './eycBlocks': { parseLines: () => [] },
    './eycFlow': {
      extractFlowKw: () => null,
      FLOW_BRANCH_KW: new Set(['否则', '默认']),
      FLOW_END_KW: new Set(['如果结束', '如果真结束', '判断结束']),
      getFlowStructureAround: () => null,
    },
  })

  assert.equal(normalizeFlowCommandName('如果'), '如果')
  assert.equal(normalizeFlowCommandName('.如果'), '如果')
  assert.equal(normalizeFlowCommandName('.如果 (调试模式)'), '如果')
  assert.equal(normalizeFlowCommandName('\u200B.判断'), '判断')
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

test('flow lines: visible else followed by nested flow keeps parent lane', () => {
  const { computeFlowLines } = loadTsModule(flowPath)
  const lines = [
    '.子程序 A, , , ',
    '    .如果 (x)',
    '        .如果 (y)',
    '            执行()',
    '        .否则',
    '            执行2()',
    '        .如果结束',
    '    .否则',
    '        执行3()',
    '    .如果结束',
    '',
  ]
  const blocks = lines.map((codeLine, lineIndex) => ({ kind: 'codeline', lineIndex, codeLine, rows: [] }))

  const result = computeFlowLines(blocks)
  const nestedStartSegs = result.map.get(2) || []
  const outerThroughOnNestedStart = nestedStartSegs.find(seg => seg.depth === 0 && seg.type === 'through')
  const innerStart = nestedStartSegs.find(seg => seg.depth === 1 && seg.type === 'start')
  const outerElseSegs = result.map.get(7) || []
  const outerElseBranch = outerElseSegs.find(seg => seg.depth === 0 && seg.type === 'branch')

  assert.ok(outerThroughOnNestedStart)
  assert.ok(innerStart)
  assert.ok(outerElseBranch)
  assert.equal(Object.prototype.hasOwnProperty.call(outerElseBranch, 'isMarker'), false)
})

test('flow lines: visible nested branches keep outer through continuity', () => {
  const { computeFlowLines } = loadTsModule(flowPath)
  const lines = [
    '.子程序 A, , , ',
    '    .如果 (A)',
    '        .如果 (B)',
    '            .如果 (C)',
    '                执行1()',
    '                执行2()',
    '            .否则',
    '                执行3()',
    '            .如果结束',
    '        .否则',
    '            执行4()',
    '        .如果结束',
    '    .否则',
    '        执行5()',
    '    .如果结束',
  ]
  const blocks = lines.map((codeLine, lineIndex) => ({ kind: 'codeline', lineIndex, codeLine, rows: [] }))

  const result = computeFlowLines(blocks)
  const line5Segs = result.map.get(4) || []
  const line6Segs = result.map.get(5) || []
  const outerThroughAt5 = line5Segs.find(seg => seg.depth === 0 && seg.type === 'through')
  const outerThroughAt6 = line6Segs.find(seg => seg.depth === 0 && seg.type === 'through')
  const innerThroughAt6 = line6Segs.find(seg => seg.depth === 1 && seg.type === 'through')

  assert.ok(outerThroughAt5)
  assert.ok(outerThroughAt6)
  assert.ok(innerThroughAt6)
  assert.equal(Object.prototype.hasOwnProperty.call(outerThroughAt6, 'outerHidden'), false)
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

test('paste sanitize: legacy internal flow markers normalize to visible text', () => {
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
  const expected = [
    '.子程序 A, , , ',
    '    如果（）',
    '',
    '        如果（）',
    '            333',
    '        如果结束',
    '    如果结束',
  ].join('\n')
  assert.equal(out, normalizeEycText(expected))
  assert.equal(out.includes('\u200C') || out.includes('\u200D') || out.includes('\u2060'), false)
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

test('format load: Yi flow source keeps explicit visible branch lines', () => {
  const { eycToInternalFormat } = loadFormatModule()
  const yi = [
    '.如果 (a)',
    '    333',
    '.否则',
    '    444',
    '.如果结束',
  ].join('\n')

  const out = eycToInternalFormat(yi)
  assert.equal(out.includes('\u200C') || out.includes('\u200D') || out.includes('\u2060'), false)
  assert.equal(out.includes('如果 (a)'), true)
  assert.equal(out.includes('否则'), true)
  assert.equal(out.includes('如果结束'), true)
})

test('paste sanitize: Yi flow source keeps explicit visible branch lines', () => {
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
  assert.equal(out.includes('\u200C') || out.includes('\u200D') || out.includes('\u2060'), false)
  assert.equal(out.includes('如果 (a)'), true)
  assert.equal(out.includes('否则'), true)
  assert.equal(out.includes('如果结束'), true)
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
  assert.equal(out.includes('\u200C') || out.includes('\u200D') || out.includes('\u2060'), false)
  assert.equal(out.includes('如果 (a)'), true)
  assert.equal(out.includes('如果结束'), true)
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
  assert.equal(out.includes('\u200D'), false)
  assert.equal(out.includes('否则'), true)
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
  assert.equal(out.includes('\u200C') || out.includes('\u200D') || out.includes('\u2060'), false)
})

test('paste sanitize: nested flow in true branch remains visible text', () => {
  const { sanitizePastedTextForCurrent } = loadFormatModule()
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
  assert.equal(out.includes('\u200C') || out.includes('\u200D') || out.includes('\u2060'), false)
  assert.equal(out.includes('    如果 ()'), true)
  assert.equal(out.includes('否则'), true)
})
