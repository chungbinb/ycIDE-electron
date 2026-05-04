import iconv from 'iconv-lite'
import { LIB0_COMMAND_NAME_MAP } from './lib0CommandMap'
import { LIB_COMMAND_NAME_MAPS } from './libCommandMaps'

type MethodCodeData = {
  lineOffset: Uint8Array
  blockOffset: Uint8Array
  methodReference: Uint8Array
  variableReference: Uint8Array
  constantReference: Uint8Array
  expressionData: Uint8Array
}

type ResolveName = (id: number) => string
type ResolveLibraryName = (libraryId: number) => string | undefined

const TYPE_FORM_SELF = 0x06000000
const TYPE_FORM = 0x52000000
const MASK_TYPE = 0xff000000
const ID_NOT_A_VARIABLE = 0x0500fffe

const KNOWN_STATEMENT_TYPES = new Set([0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f, 0x70, 0x71])

const OPERATOR_MAP = new Map<number, { operator: string; precedence: number; type: 'unary' | 'binary' | 'multi' }>([
  [15, { operator: '*', precedence: 2, type: 'multi' }],
  [16, { operator: '/', precedence: 2, type: 'multi' }],
  [17, { operator: '\\', precedence: 3, type: 'multi' }],
  [18, { operator: '%', precedence: 4, type: 'multi' }],
  [19, { operator: '+', precedence: 5, type: 'multi' }],
  [20, { operator: '-', precedence: 5, type: 'multi' }],
  [21, { operator: '-', precedence: 1, type: 'unary' }],
  [38, { operator: '=', precedence: 6, type: 'binary' }],
  [39, { operator: '!=', precedence: 6, type: 'binary' }],
  [40, { operator: '<', precedence: 6, type: 'binary' }],
  [41, { operator: '>', precedence: 6, type: 'binary' }],
  [42, { operator: '<=', precedence: 6, type: 'binary' }],
  [43, { operator: '>=', precedence: 6, type: 'binary' }],
  [44, { operator: '?=', precedence: 6, type: 'binary' }],
  [45, { operator: '且', precedence: 7, type: 'multi' }],
  [46, { operator: '或', precedence: 8, type: 'multi' }],
  [52, { operator: '=', precedence: 9, type: 'binary' }],
])

class MethodCodeReader {
  private offset = 0

  constructor(private readonly bytes: Uint8Array) {}

  get position(): number { return this.offset }
  set position(value: number) { this.offset = Math.max(0, Math.min(value, this.bytes.length)) }
  get length(): number { return this.bytes.length }
  get eof(): boolean { return this.offset >= this.bytes.length }

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

  readI32(): number {
    this.ensure(4)
    const value = (this.bytes[this.offset] | (this.bytes[this.offset + 1] << 8) | (this.bytes[this.offset + 2] << 16) | (this.bytes[this.offset + 3] << 24)) | 0
    this.offset += 4
    return value
  }

  readF64(): number {
    this.ensure(8)
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 8)
    const value = view.getFloat64(0, true)
    this.offset += 8
    return value
  }

  readBStr(): string | null {
    const length = this.readI32()
    if (length <= 0) return null
    const body = this.bytes.slice(this.offset, this.offset + Math.max(0, length - 1))
    this.offset += length
    return iconv.decode(Buffer.from(body), 'gbk')
  }

  rewind(count: number): void {
    this.position = this.offset - count
  }

  private ensure(length: number): void {
    if (this.offset + length > this.bytes.length) throw new Error('子程序代码数据读取越界。')
  }
}

type ExpressionText = {
  text: string
  kind?: 'paramEnd' | 'arrayEnd' | 'variable' | 'call' | 'member' | 'array'
  methodId?: number
  libraryId?: number
  target?: ExpressionText
  params?: ExpressionText[]
  invokeSpecial?: boolean
}

type CallText = ExpressionText & {
  kind: 'call'
  methodId: number
  libraryId: number
  params: ExpressionText[]
  unexaminedCode?: string
  comment?: string
  mask: boolean
}

function idType(id: number): number {
  return id & MASK_TYPE
}

function normalizeNativeText(value: string | null): string | undefined {
  if (value == null) return undefined
  const nullIndex = value.indexOf('\0')
  const normalized = nullIndex >= 0 ? value.slice(0, nullIndex) : value
  return normalized.length > 0 ? normalized : undefined
}

function normalizeLibraryKey(name: string | undefined): string {
  if (!name) return ''
  return name
    .replace(/^[A-Za-z]:[\\/]/, '')
    .replace(/.*[\\/]/, '')
    .replace(/\.(fne|fnr|dll)$/i, '')
    .trim()
    .toLowerCase()
}

function escapeStringLiteral(value: string): string {
  return `“${value.replace(/”/g, '””')}”`
}

function formatOleDate(value: number): string {
  const epoch = Date.UTC(1899, 11, 30)
  const date = new Date(epoch + value * 86400000)
  const pad = (input: number) => String(input).padStart(2, '0')
  const base = `${date.getUTCFullYear()}年${pad(date.getUTCMonth() + 1)}月${pad(date.getUTCDate())}日`
  if (date.getUTCHours() || date.getUTCMinutes() || date.getUTCSeconds()) {
    return `[${base}${pad(date.getUTCHours())}时${pad(date.getUTCMinutes())}分${pad(date.getUTCSeconds())}秒]`
  }
  return `[${base}]`
}

function libCommandName(libraryId: number, methodId: number, resolveName: ResolveName, resolveLibraryName?: ResolveLibraryName): string {
  if (libraryId === -2 || libraryId === -3) return resolveName(methodId)
  if (libraryId === 0) {
    if (methodId === 0) return '如果'
    if (methodId === 1) return '如果真'
    if (methodId === 2) return '判断'
    if (methodId === 3) return '判断循环首'
    if (methodId === 4) return '判断循环尾'
    if (methodId === 5) return '循环判断首'
    if (methodId === 6) return '循环判断尾'
    if (methodId === 7) return '计次循环首'
    if (methodId === 8) return '计次循环尾'
    if (methodId === 9) return '变量循环首'
    if (methodId === 10) return '变量循环尾'
    if (methodId === 13) return '返回'

    // 兼容部分旧工程中常见的核心命令编号差异。
    if (methodId === 181) return '取屏幕宽度'
    if (methodId === 182) return '取屏幕高度'
    if (methodId === 203) return '是否为空'

    const mapped = LIB0_COMMAND_NAME_MAP.get(methodId)
    if (mapped) return mapped
  } else if (libraryId > 0 && resolveLibraryName) {
    const libraryKey = normalizeLibraryKey(resolveLibraryName(libraryId))
    if (libraryKey) {
      const mapped = LIB_COMMAND_NAME_MAPS.get(libraryKey)?.get(methodId)
      if (mapped) return mapped
    }
  }
  return `_Lib${libraryId}Cmd${methodId}`
}

function libConstantName(libraryId: number, constantId: number): string {
  return `_Lib${libraryId}Const${constantId}`
}

function libMemberName(libraryId: number, typeId: number, memberId: number): string {
  return `_Lib${libraryId}Type${typeId}Mem${memberId}`
}

function callToText(call: ExpressionText, resolveName: ResolveName, resolveLibraryName?: ResolveLibraryName, expectedLowestPrecedence = Number.MAX_SAFE_INTEGER): string {
  const operatorInfo = call.target == null && call.libraryId === 0 && call.methodId != null ? OPERATOR_MAP.get(call.methodId) : undefined
  if (operatorInfo) {
    const params = call.params || []
    let text = ''
    if (operatorInfo.type === 'unary') {
      text = `${operatorInfo.operator}${expressionToText(params[0], resolveName, resolveLibraryName, operatorInfo.precedence)}`
    } else {
      text = params.length === 0
        ? ` ${operatorInfo.operator} `
        : params.map((param, index) => expressionToText(param, resolveName, resolveLibraryName, index === 0 ? operatorInfo.precedence : operatorInfo.precedence - 1)).join(` ${operatorInfo.operator} `)
    }
    return operatorInfo.precedence > expectedLowestPrecedence ? `(${text})` : text
  }

  const target = call.target ? `${expressionToText(call.target, resolveName, resolveLibraryName)}.` : ''
  const prefix = call.invokeSpecial && call.libraryId === -2 ? '' : ''
  const params = `(${(call.params || []).map(param => expressionToText(param, resolveName, resolveLibraryName)).join(', ')})`
  return `${target}${prefix}${libCommandName(call.libraryId ?? -1, call.methodId ?? 0, resolveName, resolveLibraryName)} ${params}`
}

function expressionToText(expression: ExpressionText | undefined, resolveName: ResolveName, resolveLibraryName?: ResolveLibraryName, expectedLowestPrecedence = Number.MAX_SAFE_INTEGER): string {
  if (!expression) return ''
  if (expression.kind === 'call') return callToText(expression, resolveName, resolveLibraryName, expectedLowestPrecedence)
  return expression.text
}

function parseExpression(reader: MethodCodeReader, resolveName: ResolveName, resolveLibraryName?: ResolveLibraryName, parseMember = true): ExpressionText {
  let result: ExpressionText | undefined
  while (!reader.eof) {
    const type = reader.readU8()
    switch (type) {
      case 0x01:
        result = { text: '', kind: 'paramEnd' }
        break
      case 0x16:
        result = { text: '' }
        break
      case 0x17:
        result = { text: String(reader.readF64()) }
        break
      case 0x18:
        result = { text: reader.readI16() !== 0 ? '真' : '假' }
        break
      case 0x19:
        result = { text: formatOleDate(reader.readF64()) }
        break
      case 0x1a:
        result = { text: escapeStringLiteral(normalizeNativeText(reader.readBStr()) || '') }
        break
      case 0x1b:
        result = { text: `#${resolveName(reader.readI32())}` }
        break
      case 0x1c: {
        const libraryId = reader.readI16() - 1
        const constantId = reader.readI16() - 1
        result = { text: `#${libConstantName(libraryId, constantId)}` }
        break
      }
      case 0x1d:
      case 0x37:
        continue
      case 0x1e:
        result = { text: `&${resolveName(reader.readI32())}` }
        break
      case 0x21:
        result = parseCallWithoutType(reader, resolveName, resolveLibraryName)
        break
      case 0x23: {
        const typeId = reader.readI16() - 1
        const libraryId = reader.readI16() - 1
        const memberId = reader.readI32() - 1
        result = { text: `#${libMemberName(libraryId, typeId, memberId)}` }
        break
      }
      case 0x1f: {
        const items: ExpressionText[] = []
        while (!reader.eof) {
          const item = parseExpression(reader, resolveName, resolveLibraryName)
          if (item.kind === 'arrayEnd') break
          items.push(item)
        }
        result = { text: `{${items.map(item => expressionToText(item, resolveName, resolveLibraryName)).join(', ')}}` }
        break
      }
      case 0x20:
        result = { text: '', kind: 'arrayEnd' }
        break
      case 0x38: {
        const variableId = reader.readI32()
        if (variableId === ID_NOT_A_VARIABLE) {
          if (!reader.eof) reader.readU8()
          return parseExpression(reader, resolveName, resolveLibraryName, true)
        }
        result = { text: resolveName(variableId), kind: 'variable' }
        parseMember = true
        break
      }
      case 0x3b:
        result = { text: String(reader.readI32()) }
        break
      default:
        result = { text: `/* 未识别表达式 0x${type.toString(16).padStart(2, '0')} */` }
        break
    }
    break
  }

  if (!result) return { text: '' }
  if (parseMember && ['variable', 'call', 'member', 'array'].includes(result.kind || '')) {
    while (!reader.eof) {
      const type = reader.readU8()
      if (type === 0x39) {
        const memberId = reader.readI32()
        const structId = reader.readI32()
        let memberName: string
        if ((structId & MASK_TYPE) === 0 && structId !== 0) {
          const libraryId = (structId >>> 16) - 1
          const typeId = (structId & 0xffff) - 1
          memberName = libMemberName(libraryId, typeId, memberId - 1)
        } else if (idType(structId) === TYPE_FORM && (memberId & MASK_TYPE) === 0) {
          memberName = libMemberName(0, 0, memberId - 1)
        } else {
          memberName = resolveName(memberId)
        }
        result = { text: `${expressionToText(result, resolveName, resolveLibraryName)}.${memberName}`, kind: 'member' }
      } else if (type === 0x3a) {
        const index = parseExpression(reader, resolveName, resolveLibraryName, false)
        result = { text: `${expressionToText(result, resolveName, resolveLibraryName)}[${expressionToText(index, resolveName, resolveLibraryName)}]`, kind: 'array' }
      } else if (type === 0x37) {
        break
      } else {
        reader.rewind(1)
        break
      }
    }
  }
  return result
}

function parseParamList(reader: MethodCodeReader, resolveName: ResolveName, resolveLibraryName?: ResolveLibraryName): ExpressionText[] {
  const params: ExpressionText[] = []
  while (!reader.eof) {
    const expression = parseExpression(reader, resolveName, resolveLibraryName)
    if (expression.kind === 'paramEnd') break
    params.push(expression)
  }
  return params
}

function parseCallWithoutType(reader: MethodCodeReader, resolveName: ResolveName, resolveLibraryName?: ResolveLibraryName): CallText {
  const methodId = reader.readI32()
  const libraryId = reader.readI16()
  const flag = reader.readI16()
  const unexaminedCode = normalizeNativeText(reader.readBStr())
  const comment = normalizeNativeText(reader.readBStr())
  const call: CallText = {
    text: '',
    kind: 'call',
    methodId,
    libraryId,
    params: [],
    unexaminedCode,
    comment,
    mask: (flag & 0x20) !== 0,
    invokeSpecial: (flag & 0x10) !== 0,
  }
  if (!reader.eof) {
    const marker = reader.readU8()
    if (marker === 0x36) {
      call.params = parseParamList(reader, resolveName, resolveLibraryName)
    } else if (marker === 0x38) {
      reader.rewind(1)
      call.target = parseExpression(reader, resolveName, resolveLibraryName)
      call.params = parseParamList(reader, resolveName, resolveLibraryName)
    } else {
      reader.rewind(1)
    }
  }
  call.text = callToText(call, resolveName, resolveLibraryName)
  return call
}

function indentLine(indent: number, text: string): string {
  return `${'    '.repeat(indent)}${text}`
}

function appendComment(text: string, comment?: string): string {
  if (!comment) return text
  return text ? `${text}  ' ${comment}` : `' ${comment}`
}

function statementFromCall(call: CallText, resolveName: ResolveName, resolveLibraryName: ResolveLibraryName | undefined, indent: number): string {
  if (call.unexaminedCode) return indentLine(indent, `${call.mask ? "' " : ''}${call.unexaminedCode}`)
  if (call.libraryId === -1) return indentLine(indent, appendComment('', call.comment))
  return indentLine(indent, appendComment(`${call.mask ? "' " : ''}${callToText(call, resolveName, resolveLibraryName)}`, call.comment))
}

function parseBlock(reader: MethodCodeReader, resolveName: ResolveName, resolveLibraryName: ResolveLibraryName | undefined, indent: number, stopTypes: Set<number>): string[] {
  const lines: string[] = []
  while (!reader.eof) {
    let type = 0
    do {
      if (reader.eof) return lines
      type = reader.readU8()
    } while (!KNOWN_STATEMENT_TYPES.has(type))

    if (stopTypes.has(type)) {
      reader.rewind(1)
      return lines
    }
    if ([0x50, 0x51, 0x52, 0x53, 0x54, 0x6f, 0x71].includes(type)) {
      reader.rewind(1)
      return lines
    }
    if (type === 0x55) continue

    if (type === 0x6d) {
      lines.push(indentLine(indent, '.判断开始'))
      while (!reader.eof) {
        const nextType = reader.readU8()
        if (nextType === 0x6e) {
          const call = parseCallWithoutType(reader, resolveName, resolveLibraryName)
          lines.push(indentLine(indent, `.判断 (${expressionToText(call.params[0], resolveName, resolveLibraryName)})${call.comment ? `  ' ${call.comment}` : ''}`))
          lines.push(...parseBlock(reader, resolveName, resolveLibraryName, indent + 1, new Set([0x53])))
          if (!reader.eof && reader.readU8() !== 0x53) break
          continue
        }
        if (nextType === 0x6f) {
          lines.push(indentLine(indent, '.默认'))
          lines.push(...parseBlock(reader, resolveName, resolveLibraryName, indent + 1, new Set([0x54])))
          if (!reader.eof && reader.readU8() === 0x54 && !reader.eof) reader.readU8()
          break
        }
        reader.rewind(1)
        break
      }
      lines.push(indentLine(indent, '.判断结束'))
      continue
    }

    const call = parseCallWithoutType(reader, resolveName, resolveLibraryName)
    if (type === 0x70) {
      const loopName = libCommandName(0, call.methodId, resolveName, resolveLibraryName)
      const params = call.params.map(param => expressionToText(param, resolveName, resolveLibraryName)).join(', ')
      lines.push(indentLine(indent, appendComment(`${call.mask ? "' " : ''}.${loopName} (${params})`, call.comment)))
      lines.push(...parseBlock(reader, resolveName, resolveLibraryName, indent + 1, new Set([0x55, 0x71])))
      if (!reader.eof && reader.readU8() === 0x55 && !reader.eof) {
        if (reader.readU8() !== 0x71) reader.rewind(1)
      }
      let endCall: CallText | undefined
      if (!reader.eof) endCall = parseCallWithoutType(reader, resolveName, resolveLibraryName)
      const endName = endCall ? libCommandName(0, endCall.methodId, resolveName, resolveLibraryName) : loopName.replace('首', '尾')
      const endParams = endCall?.params.map(param => expressionToText(param, resolveName, resolveLibraryName)).join(', ') || ''
      lines.push(indentLine(indent, appendComment(`${endCall?.mask ? "' " : ''}.${endName} (${endParams})`, endCall?.comment)))
      continue
    }

    if (type === 0x6c) {
      lines.push(indentLine(indent, appendComment(`${call.mask ? "' " : ''}.如果真 (${expressionToText(call.params[0], resolveName, resolveLibraryName)})`, call.comment)))
      lines.push(...parseBlock(reader, resolveName, resolveLibraryName, indent + 1, new Set([0x52])))
      if (!reader.eof && reader.readU8() === 0x52 && !reader.eof) reader.readU8()
      lines.push(indentLine(indent, '.如果真结束'))
      continue
    }

    if (type === 0x6b) {
      lines.push(indentLine(indent, appendComment(`${call.mask ? "' " : ''}.如果 (${expressionToText(call.params[0], resolveName, resolveLibraryName)})`, call.comment)))
      lines.push(...parseBlock(reader, resolveName, resolveLibraryName, indent + 1, new Set([0x50])))
      if (!reader.eof && reader.readU8() === 0x50) {
        lines.push(indentLine(indent, '.否则'))
        lines.push(...parseBlock(reader, resolveName, resolveLibraryName, indent + 1, new Set([0x51])))
        if (!reader.eof && reader.readU8() === 0x51 && !reader.eof) reader.readU8()
      }
      lines.push(indentLine(indent, '.如果结束'))
      continue
    }

    if (type === 0x6a) {
      lines.push(statementFromCall(call, resolveName, resolveLibraryName, indent))
    }
  }
  return lines
}

export function parseMethodBodyText(codeData: MethodCodeData | undefined, resolveName: ResolveName, resolveLibraryName?: ResolveLibraryName): string[] {
  if (!codeData || codeData.expressionData.length === 0) return []
  try {
    return parseBlock(new MethodCodeReader(codeData.expressionData), resolveName, resolveLibraryName, 0, new Set())
  } catch (error) {
    return [`' 原生子程序语句反编译失败：${error instanceof Error ? error.message : String(error)}`]
  }
}

export type { MethodCodeData }
