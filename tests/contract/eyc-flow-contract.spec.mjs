import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'

const runtimeRequire = createRequire(import.meta.url)
const moduleCache = new Map()

function loadTsModule(tsPath) {
  const resolved = path.resolve(tsPath)
  if (moduleCache.has(resolved)) return moduleCache.get(resolved).exports

  const source = fs.readFileSync(resolved, 'utf-8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: resolved,
  }).outputText

  const module = { exports: {} }
  moduleCache.set(resolved, module)
  const localRequire = (request) => {
    if (request.startsWith('.')) {
      const base = path.resolve(path.dirname(resolved), request)
      for (const candidate of [`${base}.ts`, `${base}.tsx`, base]) {
        if (fs.existsSync(candidate)) return loadTsModule(candidate)
      }
    }
    return runtimeRequire(request)
  }

  const context = vm.createContext({
    module,
    exports: module.exports,
    require: localRequire,
    console,
    Buffer,
    Uint8Array,
  })

  new vm.Script(compiled, { filename: resolved }).runInContext(context)
  return module.exports
}

const blocksPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/eycBlocks.ts')
const flowPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/eycFlow.ts')

test('eyc flow: explicit else body renders on else branch lane', () => {
  const { buildBlocks } = loadTsModule(blocksPath)
  const { computeFlowLines } = loadTsModule(flowPath)
  const text = [
    '.如果 (是否为空 (调试模式) 或 调试模式 = 假)',
    '    debugMode = 0',
    '.否则',
    '    debugMode = 1',
    '.如果结束',
  ].join('\n')

  const flow = computeFlowLines(buildBlocks(text))
  const elseLine = flow.map.get(2) || []
  const elseBodyLine = flow.map.get(3) || []
  const endLine = flow.map.get(4) || []

  assert.equal(elseLine.some(segment => segment.type === 'branch' && !segment.isMarker), true)
  assert.equal(elseBodyLine.some(segment => segment.type === 'through' && !segment.hasInnerVert && !segment.outerHidden), true)
  assert.equal(endLine.some(segment => segment.type === 'end' && !segment.isMarker && !segment.outerHidden), true)
})

test('eyc flow: auto completed visible lines render as normal table rows', () => {
  const { buildBlocks } = loadTsModule(blocksPath)
  const { computeFlowLines, getFlowStructureAround, FLOW_AUTO_TAG } = loadTsModule(flowPath)
  const text = [
    '    如果（）',
    '',
    `    ${FLOW_AUTO_TAG}否则`,
    '',
    `    ${FLOW_AUTO_TAG}如果结束`,
  ].join('\n')

  const blocks = buildBlocks(text)
  assert.equal(blocks.filter(block => block.kind === 'codeline').length, 5)

  const flow = computeFlowLines(blocks)
  const elseLine = flow.map.get(2) || []
  const endLine = flow.map.get(4) || []
  assert.equal(elseLine.some(segment => segment.type === 'branch'), true)
  assert.equal(endLine.some(segment => segment.type === 'end'), true)

  const structure = getFlowStructureAround(text.split('\n'), 2)
  assert.ok(structure)
  assert.equal(structure.cmdLine, 0)
  assert.equal(structure.sections.some(section => section.char === '否则' && section.startLine === 2), true)
})
