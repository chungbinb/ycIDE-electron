import iconv from 'iconv-lite'
import type { NativeProjectSnapshot, NativeSectionSnapshot } from './sections'
import { parseMethodBodyText, type MethodCodeData } from './methodCode'

const SECTION_CODE = 0x03007319
const SECTION_RESOURCE = 0x04007319
const TYPE_METHOD = 0x04000000
const TYPE_GLOBAL = 0x05000000
const TYPE_STATIC_CLASS = 0x09000000
const TYPE_DLL = 0x0A000000
const TYPE_CLASS_MEMBER = 0x15000000
const TYPE_CONSTANT = 0x18000000
const TYPE_FORM_CLASS = 0x19000000
const TYPE_LOCAL = 0x25000000
const TYPE_IMAGE_RESOURCE = 0x28000000
const TYPE_STRUCT_MEMBER = 0x35000000
const TYPE_SOUND_RESOURCE = 0x38000000
const TYPE_STRUCT = 0x41000000
const TYPE_DLL_PARAMETER = 0x45000000
const TYPE_CLASS = 0x49000000
const TYPE_FORM = 0x52000000
const TYPE_FORM_SELF = 0x06000000
const TYPE_FORM_CONTROL = 0x16000000
const TYPE_FORM_MENU = 0x26000000
const MASK_TYPE = 0xff000000

export type NativeVariableInfo = {
  id: number
  dataType: number
  flags: number
  uBound: number[]
  name: string
  comment: string
}

export type NativeMethodInfo = {
  id: number
  classId: number
  flags: number
  returnDataType: number
  name: string
  comment: string
  variables: NativeVariableInfo[]
  parameters: NativeVariableInfo[]
  hasCode: boolean
  codeData: MethodCodeData
}

export type NativeClassInfo = {
  id: number
  formId: number
  baseClass: number
  name: string
  comment: string
  methods: number[]
  variables: NativeVariableInfo[]
}

export type NativeStructInfo = {
  id: number
  flags: number
  name: string
  comment: string
  members: NativeVariableInfo[]
}

export type NativeDllDeclareInfo = {
  id: number
  flags: number
  returnDataType: number
  name: string
  comment: string
  libraryName: string
  entryPoint: string
  parameters: NativeVariableInfo[]
}

export type NativeConstantInfo = {
  id: number
  flags: number
  name: string
  comment: string
  valueCode: string
  resourceKind?: 'image' | 'sound'
  resourceBytes?: Uint8Array
}

export type NativeParsedProject = {
  classes: NativeClassInfo[]
  methods: NativeMethodInfo[]
  globalVariables: NativeVariableInfo[]
  structs: NativeStructInfo[]
  dllDeclares: NativeDllDeclareInfo[]
  supportLibraries: string[]
  constants: NativeConstantInfo[]
  warnings: string[]
}

class BinaryReader {
  private offset = 0

  constructor(private readonly bytes: Uint8Array) {}

  get position(): number { return this.offset }
  set position(value: number) {
    if (value < 0 || value > this.bytes.length) throw new Error('读取位置越界。')
    this.offset = value
  }
  get length(): number { return this.bytes.length }

  remaining(): number { return this.bytes.length - this.offset }

  readU8(): number {
    this.ensure(1)
    return this.bytes[this.offset++]
  }

  readI16(): number {
    this.ensure(2)
    const value = this.bytes[this.offset] | (this.bytes[this.offset + 1] << 8)
    this.offset += 2
    return value & 0x8000 ? value - 0x10000 : value
  }

  readU16(): number {
    this.ensure(2)
    const value = this.bytes[this.offset] | (this.bytes[this.offset + 1] << 8)
    this.offset += 2
    return value
  }

  readI32(): number {
    this.ensure(4)
    const value = (this.bytes[this.offset] | (this.bytes[this.offset + 1] << 8) | (this.bytes[this.offset + 2] << 16) | (this.bytes[this.offset + 3] << 24)) | 0
    this.offset += 4
    return value
  }

  readU32(): number {
    return this.readI32() >>> 0
  }

  readF64(): number {
    this.ensure(8)
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 8)
    const value = view.getFloat64(0, true)
    this.offset += 8
    return value
  }

  readBytes(length: number): Uint8Array {
    if (length < 0) throw new Error('读取长度无效。')
    this.ensure(length)
    const value = this.bytes.slice(this.offset, this.offset + length)
    this.offset += length
    return value
  }

  skip(length: number): void {
    this.readBytes(length)
  }

  readStringWithLengthPrefix(): string {
    const length = this.readI32()
    if (length <= 0) return ''
    return decodeText(this.readBytes(length))
  }

  readBStr(): string {
    const length = this.readI32()
    if (length <= 0) return ''
    const textBytes = this.readBytes(Math.max(0, length - 1))
    this.skip(1)
    return decodeText(textBytes)
  }

  readCString(): string {
    const start = this.offset
    while (this.offset < this.bytes.length && this.bytes[this.offset] !== 0) this.offset += 1
    const value = decodeText(this.bytes.slice(start, this.offset))
    if (this.offset < this.bytes.length) this.offset += 1
    return value
  }

  readI32Array(count: number): number[] {
    const result: number[] = []
    for (let index = 0; index < count; index += 1) result.push(this.readI32())
    return result
  }

  readI32ArrayWithByteSizePrefix(): number[] {
    return this.readI32Array(Math.floor(this.readI32() / 4))
  }

  readI16ArrayWithByteSizePrefix(): number[] {
    const count = Math.floor(this.readI32() / 2)
    const result: number[] = []
    for (let index = 0; index < count; index += 1) result.push(this.readI16())
    return result
  }

  readBytesWithLengthPrefix(): Uint8Array {
    return this.readBytes(this.readI32())
  }

  private ensure(length: number): void {
    if (this.offset + length > this.bytes.length) throw new Error('工程段数据读取越界。')
  }
}

function decodeText(bytes: Uint8Array): string {
  return iconv.decode(Buffer.from(bytes), 'gbk')
}

function idType(id: number): number {
  return id & MASK_TYPE
}

function sanitizeName(name: string | undefined, fallback: string): string {
  const value = (name || fallback).trim()
  return (value || fallback).replace(/[<>:"/\\|?*]/g, '_')
}

function arraySuffix(uBound: number[]): string {
  if (!uBound || uBound.length === 0) return ''
  if (uBound.length === 1 && uBound[0] === 0) return '"0"'
  return `"${uBound.map(item => item === 0 ? '' : String(item)).join(',')}"`
}

function formatDefinition(type: string, items: Array<string | undefined>): string {
  let count = items.length
  while (count > 0 && !items[count - 1]) count -= 1
  return count > 0 ? `.${type} ${items.slice(0, count).join(', ')}` : `.${type}`
}

function readMfcStringArray(reader: BinaryReader): string[] {
  let count = reader.readU16()
  if (count === 0xffff) count = reader.readI32()
  const result: string[] = []
  for (let index = 0; index < count; index += 1) result.push(reader.readStringWithLengthPrefix())
  return result
}

function readBlocksWithIdAndOffset<T>(reader: BinaryReader, readItem: (itemReader: BinaryReader, id: number, length: number) => T): T[] {
  const count = reader.readI32()
  const size = reader.readI32()
  const endPosition = reader.position + size
  const ids = reader.readI32Array(count)
  const offsets = reader.readI32Array(count)
  const startPosition = reader.position
  const result: T[] = []
  for (let index = 0; index < count; index += 1) {
    reader.position = startPosition + offsets[index]
    const length = reader.readI32()
    result.push(readItem(reader, ids[index], length))
  }
  reader.position = endPosition
  return result
}

function readBlocksWithIdAndMemoryAddress<T>(reader: BinaryReader, readItem: (itemReader: BinaryReader, id: number, memoryAddress: number) => T): T[] {
  const headerSize = reader.readI32()
  const count = Math.floor(headerSize / 8)
  const ids = reader.readI32Array(count)
  const memoryAddresses = reader.readI32Array(count)
  const result: T[] = []
  for (let index = 0; index < count; index += 1) {
    result.push(readItem(reader, ids[index], memoryAddresses[index]))
  }
  return result
}

function readVariables(reader: BinaryReader): NativeVariableInfo[] {
  return readBlocksWithIdAndOffset(reader, (itemReader, id) => {
    const dataType = itemReader.readI32()
    const flags = itemReader.readI16()
    const uBoundCount = itemReader.readU8()
    const uBound = itemReader.readI32Array(uBoundCount)
    const name = itemReader.readCString()
    const comment = itemReader.readCString()
    return { id, dataType, flags, uBound, name, comment }
  })
}

function readClasses(reader: BinaryReader): NativeClassInfo[] {
  return readBlocksWithIdAndMemoryAddress(reader, (itemReader, id) => {
    const formId = itemReader.readI32()
    const baseClass = itemReader.readI32()
    const name = itemReader.readStringWithLengthPrefix()
    const comment = itemReader.readStringWithLengthPrefix()
    const methods = itemReader.readI32Array(Math.floor(itemReader.readI32() / 4))
    const variables = readVariables(itemReader)
    return { id, formId, baseClass, name, comment, methods, variables }
  })
}

function readMethods(reader: BinaryReader): NativeMethodInfo[] {
  return readBlocksWithIdAndMemoryAddress(reader, (itemReader, id) => {
    const classId = itemReader.readI32()
    const flags = itemReader.readI32()
    const returnDataType = itemReader.readI32()
    const name = itemReader.readStringWithLengthPrefix()
    const comment = itemReader.readStringWithLengthPrefix()
    const variables = readVariables(itemReader)
    const parameters = readVariables(itemReader)
    const codeData: MethodCodeData = {
      lineOffset: itemReader.readBytesWithLengthPrefix(),
      blockOffset: itemReader.readBytesWithLengthPrefix(),
      methodReference: itemReader.readBytesWithLengthPrefix(),
      variableReference: itemReader.readBytesWithLengthPrefix(),
      constantReference: itemReader.readBytesWithLengthPrefix(),
      expressionData: itemReader.readBytesWithLengthPrefix(),
    }
    const hasCode = Object.values(codeData).some(chunk => chunk.length > 0)
    return { id, classId, flags, returnDataType, name, comment, variables, parameters, hasCode, codeData }
  })
}

function readStructs(reader: BinaryReader): NativeStructInfo[] {
  return readBlocksWithIdAndMemoryAddress(reader, (itemReader, id) => {
    const flags = itemReader.readI32()
    const name = itemReader.readStringWithLengthPrefix()
    const comment = itemReader.readStringWithLengthPrefix()
    const members = readVariables(itemReader)
    return { id, flags, name, comment, members }
  })
}

function readDllDeclares(reader: BinaryReader): NativeDllDeclareInfo[] {
  return readBlocksWithIdAndMemoryAddress(reader, (itemReader, id) => {
    const flags = itemReader.readI32()
    const returnDataType = itemReader.readI32()
    const name = itemReader.readStringWithLengthPrefix()
    const comment = itemReader.readStringWithLengthPrefix()
    const libraryName = itemReader.readStringWithLengthPrefix()
    const entryPoint = itemReader.readStringWithLengthPrefix()
    const parameters = readVariables(itemReader)
    return { id, flags, returnDataType, name, comment, libraryName, entryPoint, parameters }
  })
}

function readCodeSection(data: Uint8Array, cryptEc: boolean, warnings: string[]): Omit<NativeParsedProject, 'constants' | 'warnings'> {
  const reader = new BinaryReader(data)
  let supportLibraries: string[] = []
  reader.readI32()
  reader.readI32()
  reader.readI32ArrayWithByteSizePrefix()
  if (cryptEc) {
    reader.readI32()
    reader.readI32()
    reader.readI16ArrayWithByteSizePrefix()
    const flag = reader.readI32()
    reader.readI32()
    supportLibraries = readMfcStringArray(reader)
    reader.readI16ArrayWithByteSizePrefix()
    if ((flag & 1) !== 0) reader.skip(16)
  } else {
    reader.readI16ArrayWithByteSizePrefix()
    reader.readI16ArrayWithByteSizePrefix()
    supportLibraries = readMfcStringArray(reader)
    const flag = reader.readI32()
    reader.readI32()
    if ((flag & 1) !== 0) reader.skip(16)
  }
  reader.readBytesWithLengthPrefix()
  reader.readStringWithLengthPrefix()

  try {
    if (cryptEc) {
      reader.skip(12)
      const methods = readMethods(reader)
      const dllDeclares = readDllDeclares(reader)
      const globalVariables = readVariables(reader)
      const classes = readClasses(reader)
      const structs = readStructs(reader)
      return { classes, methods, globalVariables, structs, dllDeclares, supportLibraries }
    }
    const classes = readClasses(reader)
    const methods = readMethods(reader)
    const globalVariables = readVariables(reader)
    const structs = readStructs(reader)
    const dllDeclares = readDllDeclares(reader)
    return { classes, methods, globalVariables, structs, dllDeclares, supportLibraries }
  } catch (error) {
    warnings.push(`程序段语义解析不完整：${error instanceof Error ? error.message : String(error)}`)
    return { classes: [], methods: [], globalVariables: [], structs: [], dllDeclares: [], supportLibraries }
  }
}

function toOleDateString(value: number): string {
  const epoch = Date.UTC(1899, 11, 30)
  const date = new Date(epoch + value * 86400000)
  const pad = (input: number) => String(input).padStart(2, '0')
  const hasTime = date.getUTCHours() || date.getUTCMinutes() || date.getUTCSeconds()
  const ymd = `${date.getUTCFullYear()}年${pad(date.getUTCMonth() + 1)}月${pad(date.getUTCDate())}日`
  return hasTime ? `[${ymd}${pad(date.getUTCHours())}时${pad(date.getUTCMinutes())}分${pad(date.getUTCSeconds())}秒]` : `[${ymd}]`
}

function readConstants(reader: BinaryReader): NativeConstantInfo[] {
  const constants = readBlocksWithIdAndOffset(reader, (itemReader, id) => {
    const flags = itemReader.readI16()
    const name = itemReader.readCString()
    const comment = itemReader.readCString()
    const type = idType(id)
    if (type === TYPE_CONSTANT) {
      const valueType = itemReader.readU8()
      let valueCode = ''
      if (valueType === 23) valueCode = String(itemReader.readF64())
      else if (valueType === 24) valueCode = itemReader.readI32() !== 0 ? '真' : '假'
      else if (valueType === 25) valueCode = toOleDateString(itemReader.readF64())
      else if (valueType === 26) valueCode = `“${itemReader.readBStr()}”`
      return { id, flags, name, comment, valueCode }
    }
    if (type === TYPE_IMAGE_RESOURCE || type === TYPE_SOUND_RESOURCE) {
      const resourceBytes = itemReader.readBytesWithLengthPrefix()
      const resourceKind: 'image' | 'sound' = type === TYPE_IMAGE_RESOURCE ? 'image' : 'sound'
      return { id, flags, name, comment, valueCode: `<资源: ${resourceBytes.length} 字节>`, resourceKind, resourceBytes }
    }
    return { id, flags, name, comment, valueCode: '' }
  })
  return constants.filter(item => {
    const type = idType(item.id)
    if (type !== TYPE_CONSTANT && type !== TYPE_IMAGE_RESOURCE && type !== TYPE_SOUND_RESOURCE) return false
    return Boolean(item.name || item.comment || item.valueCode || item.resourceBytes?.length)
  })
}

function readResourceSection(data: Uint8Array, warnings: string[]): NativeConstantInfo[] {
  const reader = new BinaryReader(data)
  try {
    // Forms use memory-address records. We only need to skip them for this import pass.
    readBlocksWithIdAndMemoryAddress(reader, itemReader => {
      itemReader.readI32()
      itemReader.readI32()
      itemReader.readStringWithLengthPrefix()
      itemReader.readStringWithLengthPrefix()
      return null
    })
    return readConstants(reader)
  } catch (error) {
    warnings.push(`资源段常量解析不完整：${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

export function parseNativeProject(snapshot: NativeProjectSnapshot, cryptEc = false): NativeParsedProject {
  const warnings: string[] = []
  const codeSection = snapshot.sections.find(section => section.key === SECTION_CODE)
  const resourceSection = snapshot.sections.find(section => section.key === SECTION_RESOURCE)
  const code = codeSection?.data
    ? readCodeSection(codeSection.data, cryptEc, warnings)
    : { classes: [], methods: [], globalVariables: [], structs: [], dllDeclares: [], supportLibraries: [] }
  const constants = resourceSection?.data ? readResourceSection(resourceSection.data, warnings) : []
  return { ...code, constants, warnings }
}

function createLibraryNameResolver(supportLibraries: string[]): (libraryId: number) => string | undefined {
  const libraries = supportLibraries.map(item => item.trim()).filter(Boolean)
  const normalize = (name: string) => name.replace(/.*[\\/]/, '').replace(/\.(fne|fnr|dll)$/i, '').toLowerCase()
  const hasCoreAtFirst = libraries.length > 0 && normalize(libraries[0]) === 'krnln'
  return (libraryId: number) => {
    if (libraryId <= 0 || libraries.length === 0) return undefined
    const primaryIndex = hasCoreAtFirst ? libraryId : libraryId - 1
    return libraries[primaryIndex] || libraries[libraryId - 1] || libraries[libraryId] || undefined
  }
}

export function createNameResolver(model: NativeParsedProject): (id: number) => string {
  const names = new Map<number, string>()
  for (const item of model.methods) names.set(item.id, item.name)
  for (const item of model.classes) names.set(item.id, item.name)
  for (const item of model.globalVariables) names.set(item.id, item.name)
  for (const item of model.structs) names.set(item.id, item.name)
  for (const item of model.dllDeclares) names.set(item.id, item.name)
  for (const item of model.constants) names.set(item.id, item.name)
  for (const item of model.classes) for (const variable of item.variables) names.set(variable.id, variable.name)
  for (const item of model.methods) {
    for (const variable of item.variables) names.set(variable.id, variable.name)
    for (const parameter of item.parameters) names.set(parameter.id, parameter.name)
  }
  for (const item of model.structs) for (const member of item.members) names.set(member.id, member.name)
  for (const item of model.dllDeclares) for (const parameter of item.parameters) names.set(parameter.id, parameter.name)

  return (id: number) => {
    const name = names.get(id)
    if (name) return name
    const type = idType(id)
    if (type === TYPE_FORM_SELF) return ''
    const typeName = TYPE_FALLBACK_NAMES.get(type) || 'User'
    return `_${typeName}_0x${(id & 0x00ffffff).toString(16).toUpperCase().padStart(6, '0')}`
  }
}

const SYSTEM_DATA_TYPES = new Map<number, string>([
  [0x00000000, ''],
  [0x80000000 | 0, '通用型'],
  [0x80000101 | 0, '字节型'],
  [0x80000201 | 0, '短整数型'],
  [0x80000301 | 0, '整数型'],
  [0x80000401 | 0, '长整数型'],
  [0x80000501 | 0, '小数型'],
  [0x80000601 | 0, '双精度小数型'],
  [0x80000002 | 0, '逻辑型'],
  [0x80000003 | 0, '日期时间型'],
  [0x80000004 | 0, '文本型'],
  [0x80000005 | 0, '字节集'],
  [0x80000006 | 0, '子程序指针'],
  [0x80000008 | 0, '条件语句型'],
])

const TYPE_FALLBACK_NAMES = new Map<number, string>([
  [TYPE_METHOD, 'Sub'],
  [TYPE_GLOBAL, 'Global'],
  [TYPE_STATIC_CLASS, 'Mod'],
  [TYPE_DLL, 'Dll'],
  [TYPE_CLASS_MEMBER, 'Mem'],
  [TYPE_CONSTANT, 'Const'],
  [TYPE_FORM_CLASS, 'FormCls'],
  [TYPE_LOCAL, 'Local'],
  [TYPE_IMAGE_RESOURCE, 'Img'],
  [TYPE_STRUCT_MEMBER, 'StructMem'],
  [TYPE_SOUND_RESOURCE, 'Sound'],
  [TYPE_STRUCT, 'Struct'],
  [TYPE_DLL_PARAMETER, 'DllParam'],
  [TYPE_CLASS, 'Cls'],
  [TYPE_FORM, 'Form'],
  [TYPE_FORM_CONTROL, 'Control'],
  [TYPE_FORM_MENU, 'Menu'],
])

export function dataTypeName(id: number, resolveName: (id: number) => string): string {
  if (SYSTEM_DATA_TYPES.has(id)) return SYSTEM_DATA_TYPES.get(id) || ''
  if ((id & MASK_TYPE) === 0 && id !== 0) {
    const lib = (id >>> 16) - 1
    const type = (id & 0xffff) - 1
    return `_Lib${lib}Type${type}`
  }
  return resolveName(id)
}

export function variableToLine(variable: NativeVariableInfo, kind: '全局变量' | '程序集变量' | '局部变量' | '参数' | '成员', resolveName: (id: number) => string): string {
  const publicFlag = kind === '全局变量' && (variable.flags & 0x100) !== 0 ? '公开' : ''
  const staticFlag = kind === '局部变量' && (variable.flags & 0x1) !== 0 ? '静态' : ''
  const byRefFlag = kind === '参数' && (variable.flags & 0x2) !== 0 ? '参考' : kind === '成员' && (variable.flags & 0x2) !== 0 ? '传址' : ''
  const optionalFlag = kind === '参数' && (variable.flags & 0x4) !== 0 ? '可空' : ''
  const arrayParamFlag = kind === '参数' && (variable.flags & 0x8) !== 0 ? '数组' : ''
  const flags = [publicFlag, staticFlag, byRefFlag, optionalFlag, arrayParamFlag].filter(Boolean).join(' ')
  return formatDefinition(kind, [resolveName(variable.id), dataTypeName(variable.dataType, resolveName), flags, arraySuffix(variable.uBound), variable.comment])
}

export function classToText(klass: NativeClassInfo, methods: NativeMethodInfo[], resolveName: (id: number) => string, supportLibraries: string[] = []): string {
  const lines = ['.版本 2']
  lines.push(formatDefinition('程序集', [resolveName(klass.id), klass.baseClass === 0 || klass.baseClass === -1 ? '' : resolveName(klass.baseClass), '', klass.comment]))
  for (const variable of klass.variables) lines.push(variableToLine(variable, '程序集变量', resolveName))
  const methodMap = new Map(methods.map(method => [method.id, method]))
  for (const methodId of klass.methods) {
    const method = methodMap.get(methodId)
    if (!method) continue
    lines.push('', methodToText(method, resolveName, supportLibraries))
  }
  return `${lines.join('\n')}\n`
}

export function methodToText(method: NativeMethodInfo, resolveName: (id: number) => string, supportLibraries: string[] = []): string {
  const lines: string[] = []
  lines.push(formatDefinition('子程序', [resolveName(method.id), dataTypeName(method.returnDataType, resolveName), (method.flags & 0x8) !== 0 ? '公开' : '', method.comment]))
  for (const parameter of method.parameters) lines.push(variableToLine(parameter, '参数', resolveName))
  for (const variable of method.variables) lines.push(variableToLine(variable, '局部变量', resolveName))
  lines.push(...parseMethodBodyText(method.codeData, resolveName, createLibraryNameResolver(supportLibraries)))
  return lines.join('\n')
}

export function globalsToText(variables: NativeVariableInfo[], resolveName: (id: number) => string): string {
  return `${['.版本 2', ...variables.map(variable => variableToLine(variable, '全局变量', resolveName))].join('\n')}\n`
}

export function structsToText(structs: NativeStructInfo[], resolveName: (id: number) => string): string {
  const lines = ['.版本 2']
  for (const item of structs) {
    lines.push(formatDefinition('数据类型', [resolveName(item.id), (item.flags & 0x1) !== 0 ? '公开' : '', item.comment]))
    for (const member of item.members) lines.push(variableToLine(member, '成员', resolveName))
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

export function dllDeclaresToText(dllDeclares: NativeDllDeclareInfo[], resolveName: (id: number) => string): string {
  const lines = ['.版本 2']
  for (const item of dllDeclares) {
    lines.push(formatDefinition('DLL命令', [resolveName(item.id), dataTypeName(item.returnDataType, resolveName), item.libraryName, item.entryPoint, (item.flags & 0x2) !== 0 ? '公开' : '', item.comment]))
    for (const parameter of item.parameters) lines.push(variableToLine(parameter, '参数', resolveName))
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

export function constantsToText(constants: NativeConstantInfo[], resolveName: (id: number) => string): string {
  const lines = ['.版本 2']
  for (const item of constants.filter(constant => !constant.resourceKind)) {
    lines.push(formatDefinition('常量', [resolveName(item.id), item.valueCode ? `"${item.valueCode}"` : '', (item.flags & 0x2) !== 0 ? '公开' : '', item.comment]))
  }
  return `${lines.join('\n')}\n`
}

export function safeFileName(name: string, fallback: string): string {
  return `${sanitizeName(name, fallback)}`
}
