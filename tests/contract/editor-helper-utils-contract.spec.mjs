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
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: tsPath,
  }).outputText

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
