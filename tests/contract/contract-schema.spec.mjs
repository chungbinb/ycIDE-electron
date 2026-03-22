import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

test('D6-01/D6-03: deriveBinaryContract only uses binary metadata source (no sidecar JSON truth)', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'src/main/contract/binary-contract.ts'), 'utf-8')
  assert.ok(!src.includes('.events.json'))
  assert.ok(!src.includes('.protocol.json'))
  assert.ok(!src.includes('.compile-protocol.json'))
})

test('D6-02/D6-04: deriveBinaryContract keeps GUID and avoids extra manual config surface', async () => {
  const { deriveBinaryContract } = await importTs('src/main/contract/binary-contract.ts')
  const info = createValidLibInfo()
  const contract = deriveBinaryContract(info, 'D:/libs/demo.fne')

  assert.equal(contract.libraryGuid, info.guid)
  assert.equal(contract.libraryName, info.name, 'D6-02 libraryName must keep binary identity context')
  assert.equal(contract.filePath, 'D:/libs/demo.fne')
  assert.equal(contract.source, 'binary')
  assert.equal(deriveBinaryContract.length, 2, 'D6-04 derive helper should only require parser output + file path')
})

test('D6-14/D6-15/D6-16: validator returns ERROR with precise fieldPath for missing required fields', async () => {
  const { deriveBinaryContract } = await importTs('src/main/contract/binary-contract.ts')
  const { validateBinaryContract } = await importTs('src/main/contract/contract-validator.ts')
  const contract = {
    ...deriveBinaryContract(createValidLibInfo(), 'D:/libs/demo.fne'),
    events: [{
      name: '',
      route: { channel: '', code: '', argExtractRule: '' },
      args: [],
    }],
    properties: [{
      name: '',
      type: '',
      readWrite: '',
      defaultValueSemantics: '',
      cConversionRule: '',
    }],
    functions: [{
      name: 'DoCall',
      callingConvention: '',
      paramDirections: [],
      returnMapping: '',
      bindingSymbol: '',
      sourceCommand: 'DoCall',
    }],
    methods: [{
      name: 'SetText',
      callingConvention: '',
      paramDirections: [],
      returnMapping: '',
      bindingSymbol: '',
      sourceCommand: 'SetText',
      ownerTypeName: '按钮',
    }],
  }

  const diagnostics = validateBinaryContract(contract, { supportedMetadataMajorVersion: 1 })
  const errors = diagnostics.filter((item) => item.level === 'ERROR')
  const fieldPaths = errors.map((item) => item.fieldPath)

  assert.ok(fieldPaths.includes('events[0].name'))
  assert.ok(fieldPaths.includes('events[0].route.channel'))
  assert.ok(fieldPaths.includes('properties[0].name'))
  assert.ok(fieldPaths.includes('properties[0].cConversionRule'))
  assert.ok(fieldPaths.includes('functions[0].callingConvention'))
  assert.ok(fieldPaths.includes('methods[0].bindingSymbol'))
})

test('D6-17/D6-18: metadata major mismatch returns ERROR', async () => {
  const { deriveBinaryContract } = await importTs('src/main/contract/binary-contract.ts')
  const { validateBinaryContract } = await importTs('src/main/contract/contract-validator.ts')
  const info = createValidLibInfo()
  info.version = '2.5.0'
  const contract = deriveBinaryContract(info, 'D:/libs/demo.fne')
  const diagnostics = validateBinaryContract(contract, { supportedMetadataMajorVersion: 1 })

  const mismatchError = diagnostics.find((item) => item.code === 'CONTRACT_METADATA_MAJOR_MISMATCH')
  assert.ok(mismatchError)
  assert.equal(mismatchError.level, 'ERROR')
  assert.equal(mismatchError.fieldPath, 'metadataMajorVersion')
})

function createValidLibInfo() {
  return {
    name: '示例支持库',
    guid: 'guid-demo-001',
    version: '1.0.0',
    description: '',
    author: '',
    zipCode: '',
    address: '',
    phone: '',
    qq: '',
    email: '',
    homePage: '',
    otherInfo: '',
    fileName: 'demo',
    commands: [
      {
        name: 'DoCall',
        englishName: 'DoCall',
        description: '',
        returnType: '整数型',
        category: '测试',
        params: [{ name: 'value', type: '整数型', description: '', optional: false, isVariable: false, isArray: false }],
        isHidden: false,
        isMember: false,
        ownerTypeName: '',
        commandIndex: 0,
      },
      {
        name: 'SetText',
        englishName: 'SetText',
        description: '',
        returnType: '逻辑型',
        category: '',
        params: [{ name: 'text', type: '文本型', description: '', optional: false, isVariable: true, isArray: false }],
        isHidden: false,
        isMember: true,
        ownerTypeName: '按钮',
        commandIndex: 1,
      },
    ],
    dataTypes: [],
    constants: [],
    windowUnits: [
      {
        name: '按钮',
        englishName: 'Button',
        description: '',
        libraryName: '示例支持库',
        properties: [{
          name: '标题',
          englishName: 'Title',
          description: '',
          type: 1005,
          typeName: '文本型',
          isReadOnly: false,
          pickOptions: [],
        }],
        events: [{
          name: '被单击',
          description: '',
          args: [{ name: 'x', description: '', dataType: '整数型', isByRef: false }],
        }],
      },
    ],
  }
}

async function importTs(relativePath) {
  const target = path.join(repoRoot, relativePath)
  return import(pathToFileURL(target).href)
}
