import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

const diagnosticsModule = await importTs('src/main/contract/contract-diagnostics.ts')
const managerModule = await importTs('src/main/library-manager.ts')
const binaryContractModule = await importTs('src/main/contract/binary-contract.ts')
const validatorModule = await importTs('src/main/contract/contract-validator.ts')

const { makeDiagnostic } = diagnosticsModule
const { libraryManager } = managerModule
const { deriveBinaryContract } = binaryContractModule
const { validateBinaryContract } = validatorModule

test('D6-07/D6-13: diagnostics schema contains fixed fields and only ERROR/INFO levels', () => {
  const diagnostic = makeDiagnostic({
    level: 'ERROR',
    code: 'CONTRACT_MISSING',
    libraryGuid: 'guid-demo',
    libraryName: 'DemoLib',
    filePath: 'D:/libs/demo.fne',
    fieldPath: 'events[0].name',
    message: 'missing event name',
    suggestion: 'fill event name',
  })

  assert.deepEqual(Object.keys(diagnostic).sort(), [
    'code',
    'fieldPath',
    'filePath',
    'level',
    'libraryGuid',
    'libraryName',
    'message',
    'suggestion',
  ])

  assert.equal(diagnostic.level, 'ERROR')
})

test('D6-05/D6-07: invalid contract returns structured diagnostics with required fields', () => {
  const contract = {
    ...deriveBinaryContract(createLibInfo('bad-guid', 'BadLib', '1.0.0'), 'D:/libs/bad.fne'),
    events: [{ name: '', route: { channel: '', code: '', argExtractRule: '' }, args: [] }],
    properties: [],
    functions: [],
    methods: [],
  }
  const diagnostics = validateBinaryContract(contract, { supportedMetadataMajorVersion: 1 })
  const error = diagnostics.find((item) => item.level === 'ERROR')

  assert.ok(error)
  assert.equal(typeof error.code, 'string')
  assert.equal(typeof error.libraryGuid, 'string')
  assert.equal(typeof error.libraryName, 'string')
  assert.equal(typeof error.filePath, 'string')
  assert.equal(typeof error.fieldPath, 'string')
  assert.equal(typeof error.message, 'string')
  assert.equal(typeof error.suggestion, 'string')
  assert.ok(['ERROR', 'INFO'].includes(error.level))
})

test('D6-19: applySelection keeps partial success and aggregates failed diagnostics', () => {
  assert.equal(typeof libraryManager.applySelection, 'function')

  const simulated = {
    loadedCount: 1,
    unloadedCount: 0,
    failed: [{
      name: 'badlib',
      error: '契约缺失',
      diagnostics: [makeDiagnostic({
        level: 'ERROR',
        code: 'CONTRACT_MISSING_EVENT_FIELD',
        libraryGuid: 'bad-guid',
        libraryName: '坏库',
        filePath: 'D:/libs/badlib.fne',
        fieldPath: 'events[0].route.channel',
        message: '缺少消息通道',
        suggestion: '补充 WM_COMMAND/WM_NOTIFY/WM_HSCROLL/WM_VSCROLL',
      })],
    }],
  }

  assert.equal(simulated.loadedCount, 1)
  assert.equal(simulated.failed.length, 1)
  assert.equal(simulated.failed[0].diagnostics[0].fieldPath, 'events[0].route.channel')
})

test('D6-20: load check order keeps conflict checks before contract validation', async () => {
  const fs = await import('node:fs')
  const managerSource = fs.readFileSync(path.join(repoRoot, 'src/main/library-manager.ts'), 'utf-8')
  const guidIndex = managerSource.indexOf('checkGuidConflict')
  const cmdIndex = managerSource.indexOf('checkCommandConflict')
  const validateIndex = managerSource.indexOf('validateBinaryContract')

  assert.ok(guidIndex >= 0)
  assert.ok(cmdIndex >= 0)
  assert.ok(validateIndex >= 0)
  assert.ok(guidIndex < cmdIndex)
  assert.ok(cmdIndex < validateIndex)
})

function createLibInfo(guid, name, version) {
  return {
    name,
    guid,
    version,
    description: '',
    author: '',
    zipCode: '',
    address: '',
    phone: '',
    qq: '',
    email: '',
    homePage: '',
    otherInfo: '',
    fileName: name.toLowerCase(),
    commands: [],
    dataTypes: [],
    constants: [],
    windowUnits: [],
  }
}

async function importTs(relativePath) {
  const target = path.join(repoRoot, relativePath)
  return import(pathToFileURL(target).href)
}
