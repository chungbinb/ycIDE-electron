import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'
import iconv from 'iconv-lite'

const runtimeRequire = createRequire(import.meta.url)

function loadTsModule(tsPath, mockRequire = {}) {
  const source = fs.readFileSync(tsPath, 'utf-8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
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
    Buffer,
    Uint8Array,
  })

  const script = new vm.Script(compiled, { filename: tsPath })
  script.runInContext(context)
  return module.exports
}

function writeU32(buffer, offset, value) {
  buffer.writeUInt32LE(value >>> 0, offset)
}

function writeI32(buffer, offset, value) {
  buffer.writeInt32LE(value, offset)
}

function encodeSectionName(key, name) {
  const nameBytes = Buffer.alloc(30)
  iconv.encode(name, 'gbk').copy(nameBytes, 0, 0, 30)
  if (key !== 0x07007319) {
    const keyBytes = [key & 0xff, (key >>> 8) & 0xff, (key >>> 16) & 0xff, (key >>> 24) & 0xff]
    for (let index = 0; index < nameBytes.length; index += 1) {
      nameBytes[index] ^= keyBytes[(index + 1) % 4]
    }
  }
  return nameBytes
}

function buildSection(key, name, data) {
  const buffer = Buffer.alloc(8 + 92 + data.length)
  writeU32(buffer, 0, 353465113)
  writeU32(buffer, 8, key)
  encodeSectionName(key, name).copy(buffer, 12)
  writeI32(buffer, 48, 0)
  writeI32(buffer, 52, 0x12345678)
  writeI32(buffer, 56, data.length)
  data.copy(buffer, 100)
  return buffer
}

function nativeI16(value) {
  const buffer = Buffer.alloc(2)
  buffer.writeInt16LE(value)
  return buffer
}

function nativeI32(value) {
  const buffer = Buffer.alloc(4)
  buffer.writeInt32LE(value)
  return buffer
}

function nativeVariable(id) {
  return Buffer.concat([Buffer.from([0x38]), nativeI32(id)])
}

function nativeBool(value) {
  return Buffer.concat([Buffer.from([0x18]), nativeI16(value ? 1 : 0)])
}

function nativeCall(methodId, libraryId, params = []) {
  return Buffer.concat([
    nativeI32(methodId),
    nativeI16(libraryId),
    nativeI16(0),
    nativeI32(0),
    nativeI32(0),
    Buffer.from([0x36]),
    ...params,
    Buffer.from([0x01]),
  ])
}

function nativeCallExpression(methodId, libraryId, params = []) {
  return Buffer.concat([Buffer.from([0x21]), nativeCall(methodId, libraryId, params)])
}

const cryptoPath = path.resolve(process.cwd(), 'src/main/eproject/crypto.ts')
const sectionsPath = path.resolve(process.cwd(), 'src/main/eproject/sections.ts')
const writerPath = path.resolve(process.cwd(), 'src/main/eproject/ycProjectWriter.ts')
const methodCodePath = path.resolve(process.cwd(), 'src/main/eproject/methodCode.ts')

const lib0CommandMapMock = {
  LIB0_COMMAND_NAME_MAP: new Map([
    [13, '返回'],
    [175, '取文件尺寸'],
    [203, '是否为空'],
  ]),
}

const libCommandMapsMock = {
  LIB_COMMAND_NAME_MAPS: new Map(),
}

test('eproject crypto: encrypted source without password requests password', () => {
  const { decodeEncryptedSourceBytes } = loadTsModule(cryptoPath)
  const encryptedHeader = Buffer.alloc(8)
  writeU32(encryptedHeader, 0, 1162630231)
  writeU32(encryptedHeader, 4, 1)

  assert.throws(
    () => decodeEncryptedSourceBytes(Uint8Array.from(encryptedHeader)),
    (error) => error?.code === 'encrypted_source_password_required'
  )
})

test('eproject sections: parses minimal native project sections', () => {
  const { parseNativeProjectSnapshot } = loadTsModule(sectionsPath)
  const fileHeader = Buffer.alloc(8)
  writeU32(fileHeader, 0, 1415007811)
  writeU32(fileHeader, 4, 1196576837)

  const systemData = Buffer.alloc(40)
  systemData.writeInt16LE(5, 0)
  systemData.writeInt16LE(71, 2)

  const programData = Buffer.from([0, 0, 0, 0])
  const bytes = Buffer.concat([
    fileHeader,
    buildSection(0x02007319, '系统信息段', systemData),
    buildSection(0x03007319, '程序段', programData),
    buildSection(0x07007319, '结束段', Buffer.alloc(0)),
  ])

  const snapshot = parseNativeProjectSnapshot(Uint8Array.from(bytes))
  assert.equal(snapshot.compileVersion, '5.71')
  assert.equal(snapshot.hasProgramSection, true)
  assert.equal(snapshot.sections.length, 2)
  assert.equal(snapshot.sections[0].name, '系统信息段')
  assert.deepEqual(Array.from(snapshot.sections[1].data), Array.from(programData))
})

test('eproject writer: writes parsed structure files instead of import summary only', () => {
  const tempDir = path.resolve(process.cwd(), 'test-results/eproject-writer-contract')
  fs.rmSync(tempDir, { recursive: true, force: true })
  const { writeImportedProject } = loadTsModule(writerPath, {
    './nativeProject': {
      parseNativeProject: () => ({
        classes: [{ id: 0x09000001, name: '程序集1', methods: [0x04000001], variables: [] }],
        methods: [{ id: 0x04000001, name: '测试子程序' }],
        globalVariables: [],
        structs: [],
        dllDeclares: [],
        constants: [],
        warnings: [],
      }),
      createNameResolver: () => (id) => id === 0x09000001 ? '程序集1' : '测试子程序',
      safeFileName: (name) => name,
      classToText: () => '.版本 2\n.程序集 程序集1\n\n.子程序 测试子程序\n',
      globalsToText: () => '',
      constantsToText: () => '',
      structsToText: () => '',
      dllDeclaresToText: () => '',
    },
  })

  const result = writeImportedProject({
    eFilePath: path.join(tempDir, 'sample.e'),
    projectDir: path.join(tempDir, 'sample'),
    projectName: 'sample',
    snapshot: {
      compileVersion: '5.71',
      hasProgramSection: true,
      hasResourceSection: false,
      sections: [],
    },
  })

  const epp = fs.readFileSync(result.eppPath, 'utf-8')
  assert.match(epp, /File=EYC\|程序集1\.eyc\|1/)
  assert.doesNotMatch(epp, /导入说明\.eyc/)
  assert.equal(fs.readFileSync(path.join(result.projectDir, '程序集1.eyc'), 'utf-8').includes('.子程序 测试子程序'), true)
})

test('eproject method code: decompiles basic return statement', () => {
  const { parseMethodBodyText } = loadTsModule(methodCodePath, {
    './lib0CommandMap': lib0CommandMapMock,
    './libCommandMaps': libCommandMapsMock,
  })
  const expressionData = Buffer.alloc(1 + 4 + 2 + 2 + 4 + 4 + 1 + 1 + 4 + 1)
  let offset = 0
  expressionData.writeUInt8(0x6a, offset); offset += 1
  expressionData.writeInt32LE(13, offset); offset += 4
  expressionData.writeInt16LE(0, offset); offset += 2
  expressionData.writeInt16LE(0, offset); offset += 2
  expressionData.writeInt32LE(0, offset); offset += 4
  expressionData.writeInt32LE(0, offset); offset += 4
  expressionData.writeUInt8(0x36, offset); offset += 1
  expressionData.writeUInt8(0x3b, offset); offset += 1
  expressionData.writeInt32LE(1, offset); offset += 4
  expressionData.writeUInt8(0x01, offset)

  const lines = parseMethodBodyText({
    lineOffset: Buffer.alloc(0),
    blockOffset: Buffer.alloc(0),
    methodReference: Buffer.alloc(0),
    variableReference: Buffer.alloc(0),
    constantReference: Buffer.alloc(0),
    expressionData,
  }, () => '')

  assert.deepEqual(Array.from(lines), ['返回 (1)'])
})

test('eproject method code: emits E language logical and equality operators', () => {
  const { parseMethodBodyText } = loadTsModule(methodCodePath, {
    './lib0CommandMap': lib0CommandMapMock,
    './libCommandMaps': libCommandMapsMock,
  })
  const variableId = 0x04000001
  const condition = nativeCallExpression(46, 0, [
    nativeCallExpression(203, 0, [nativeVariable(variableId)]),
    nativeCallExpression(38, 0, [nativeVariable(variableId), nativeBool(false)]),
  ])
  const expressionData = Buffer.concat([Buffer.from([0x6b]), nativeCall(0, 0, [condition])])

  const lines = parseMethodBodyText({
    lineOffset: Buffer.alloc(0),
    blockOffset: Buffer.alloc(0),
    methodReference: Buffer.alloc(0),
    variableReference: Buffer.alloc(0),
    constantReference: Buffer.alloc(0),
    expressionData,
  }, (id) => id === variableId ? '调试模式' : '')

  assert.deepEqual(Array.from(lines), [
    '.如果 (是否为空 (调试模式) 或 调试模式 = 假)',
    '.如果结束',
  ])
})

test('eproject method code: maps legacy core command ids 181/182 to screen size commands', () => {
  const { parseMethodBodyText } = loadTsModule(methodCodePath, {
    './lib0CommandMap': lib0CommandMapMock,
    './libCommandMaps': libCommandMapsMock,
  })

  const expressionData = Buffer.concat([
    Buffer.from([0x6a]),
    nativeCall(181, 0),
    Buffer.from([0x6a]),
    nativeCall(182, 0),
  ])

  const lines = parseMethodBodyText({
    lineOffset: Buffer.alloc(0),
    blockOffset: Buffer.alloc(0),
    methodReference: Buffer.alloc(0),
    variableReference: Buffer.alloc(0),
    constantReference: Buffer.alloc(0),
    expressionData,
  }, () => '')

  assert.deepEqual(Array.from(lines), ['取屏幕宽度 ()', '取屏幕高度 ()'])
})

test('eproject method code: still uses lib0 fallback map for non-overridden ids', () => {
  const { parseMethodBodyText } = loadTsModule(methodCodePath, {
    './lib0CommandMap': lib0CommandMapMock,
    './libCommandMaps': libCommandMapsMock,
  })

  const expressionData = Buffer.concat([
    Buffer.from([0x6a]),
    nativeCall(175, 0),
  ])

  const lines = parseMethodBodyText({
    lineOffset: Buffer.alloc(0),
    blockOffset: Buffer.alloc(0),
    methodReference: Buffer.alloc(0),
    variableReference: Buffer.alloc(0),
    constantReference: Buffer.alloc(0),
    expressionData,
  }, () => '')

  assert.deepEqual(Array.from(lines), ['取文件尺寸 ()'])
})
