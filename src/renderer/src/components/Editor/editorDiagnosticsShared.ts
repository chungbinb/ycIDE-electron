import { FLOW_AUTO_TAG } from './eycFlow'
import { parseLines } from './eycBlocks'
import {
  colorize,
  getMissingAssignmentRhsTarget,
  isKnownAssignmentTarget,
  isValidVariableLikeName,
} from './editorCoreUtils'

export interface EditorDiagnosticsRequest {
  id: number
  text: string
  hasCommandCatalog: boolean
  validCommandNames: string[]
  allKnownVarNames: string[]
  reservedNames: string[]
}

export interface EditorDiagnosticsProblem {
  line: number
  column: number
  message: string
  severity: 'error' | 'warning'
}

export interface EditorDiagnosticsResponse {
  id: number
  problems: EditorDiagnosticsProblem[]
}

const INT64_MAX = BigInt('9223372036854775807')
const INT64_MIN = BigInt('-9223372036854775808')
const NUMERIC_TYPES = new Set(['字节型', '短整数型', '整数型', '长整数型', '小数型', '双精度小数型', '大整数型', '大数'])

interface SubScope {
  startLine: number
  endLine: number
  vars: Map<string, string>
}

function maskQuotedText(line: string): string {
  const chars = line.split('')
  let inQuote = false
  let quoteChar = ''
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (!inQuote) {
      if (ch === '"' || ch === '\u201c') {
        inQuote = true
        quoteChar = ch === '\u201c' ? '\u201d' : '"'
      }
      continue
    }
    chars[i] = ' '
    if (ch === quoteChar) {
      inQuote = false
      quoteChar = ''
    }
  }
  return chars.join('')
}

function findOutOfRangeInt64Literals(line: string): Array<{ literal: string; column: number }> {
  const masked = maskQuotedText(line)
  const hits: Array<{ literal: string; column: number }> = []
  const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9'

  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i]
    if (!isDigit(ch) && ch !== '-') continue

    let start = i
    let j = i
    if (masked[j] === '-') {
      if (j + 1 >= masked.length || !isDigit(masked[j + 1])) continue
      // 仅把一元负号视为数字字面量的一部分。
      if (j > 0) {
        const prev = masked[j - 1]
        if (/[\w\)\]]/.test(prev)) continue
      }
      j++
    }

    if (!isDigit(masked[j])) continue
    while (j < masked.length && isDigit(masked[j])) j++

    // 过滤小数与成员访问等非整数字面量场景。
    const prev = start > 0 ? masked[start - 1] : ''
    const next = j < masked.length ? masked[j] : ''
    if (next === '.' || prev === '.') {
      i = j - 1
      continue
    }

    const literal = masked.slice(start, j)
    try {
      const value = BigInt(literal)
      if (value > INT64_MAX || value < INT64_MIN) {
        hits.push({ literal, column: start + 1 })
      }
    } catch {
      // ignore invalid numeric token
    }

    i = j - 1
  }

  return hits
}

function getAssignTargetName(rawLine: string): string {
  const m = rawLine.match(/^\s*([^=＝\s]+)\s*(?:=|＝)/)
  return (m?.[1] || '').trim()
}

function getOverflowEntityPrefix(lineType: string, rawLine: string, fields: string[]): string {
  if (lineType === 'code') {
    const target = getAssignTargetName(rawLine)
    if (target) return `变量：${target}`
    return '长整数'
  }
  const name = (fields?.[0] || '').trim()
  if (!name) return '长整数'
  if (lineType === 'constant') return `常量：${name}`
  if (lineType === 'subParam') return `参数：${name}`
  if (lineType === 'assemblyVar' || lineType === 'globalVar' || lineType === 'localVar') return `变量：${name}`
  return '长整数'
}

function buildOverflowMessage(lineType: string, rawLine: string, fields: string[]): string {
  const prefix = getOverflowEntityPrefix(lineType, rawLine, fields)
  return `${prefix} 超出范围（-9223372036854775808 到 9223372036854775807）`
}

function normalizeDataTypeName(typeName: string): string {
  return (typeName || '').trim()
}

function isTextType(typeName: string): boolean {
  return normalizeDataTypeName(typeName) === '文本型'
}

function isNumericType(typeName: string): boolean {
  return NUMERIC_TYPES.has(normalizeDataTypeName(typeName))
}

function isBigType(typeName: string): boolean {
  const normalized = normalizeDataTypeName(typeName)
  return normalized === '大整数型' || normalized === '大数'
}

function buildTypeScopes(parsed: ReturnType<typeof parseLines>): {
  assemblyVars: Map<string, string>
  globalVars: Map<string, string>
  subScopes: SubScope[]
} {
  const assemblyVars = new Map<string, string>()
  const globalVars = new Map<string, string>()
  const subScopes: SubScope[] = []
  let currentSub: SubScope | null = null

  const closeCurrentSub = (endLine: number): void => {
    if (!currentSub) return
    currentSub.endLine = Math.max(currentSub.startLine, endLine)
    subScopes.push(currentSub)
    currentSub = null
  }

  for (let i = 0; i < parsed.length; i++) {
    const ln = parsed[i]
    if (ln.type === 'assemblyVar') {
      const name = (ln.fields[0] || '').trim()
      const dataType = normalizeDataTypeName(ln.fields[1] || '')
      if (name && dataType) assemblyVars.set(name, dataType)
      continue
    }
    if (ln.type === 'globalVar') {
      const name = (ln.fields[0] || '').trim()
      const dataType = normalizeDataTypeName(ln.fields[1] || '')
      if (name && dataType) globalVars.set(name, dataType)
      continue
    }
    if (ln.type === 'sub') {
      closeCurrentSub(i - 1)
      currentSub = { startLine: i, endLine: parsed.length - 1, vars: new Map<string, string>() }
      continue
    }
    if (ln.type === 'assembly') {
      closeCurrentSub(i - 1)
      continue
    }
    if (!currentSub) continue
    if (ln.type === 'localVar' || ln.type === 'subParam') {
      const name = (ln.fields[0] || '').trim()
      const dataType = normalizeDataTypeName(ln.fields[1] || '')
      if (name && dataType) currentSub.vars.set(name, dataType)
    }
  }

  closeCurrentSub(parsed.length - 1)
  return { assemblyVars, globalVars, subScopes }
}

function resolveVarTypeAtLine(
  name: string,
  lineIndex: number,
  scopes: { assemblyVars: Map<string, string>; globalVars: Map<string, string>; subScopes: SubScope[] },
): string {
  const target = (name || '').trim().split(/[.。．]/)[0] || ''
  if (!target) return ''

  for (const scope of scopes.subScopes) {
    if (lineIndex < scope.startLine || lineIndex > scope.endLine) continue
    const subType = scope.vars.get(target)
    if (subType) return subType
    break
  }

  return scopes.assemblyVars.get(target) || scopes.globalVars.get(target) || ''
}

function parseAssignment(rawLine: string): { target: string; rhs: string; targetColumn: number } | null {
  const m = rawLine.match(/^(\s*)([^=＝\s]+)\s*(?:=|＝)\s*(.+)$/)
  if (!m) return null
  const indent = m[1] || ''
  const target = (m[2] || '').trim()
  const rhs = (m[3] || '').trim()
  if (!target || !rhs) return null
  return { target, rhs, targetColumn: indent.length + 1 }
}

function isPureNumericExpression(
  expr: string,
  lineIndex: number,
  scopes: { assemblyVars: Map<string, string>; globalVars: Map<string, string>; subScopes: SubScope[] },
): boolean {
  const normalized = (expr || '').trim()
  if (!normalized) return false
  if (/['"\u201c\u201d]/.test(normalized)) return false

  const canonical = normalized
    .replace(/[＋]/g, '+')
    .replace(/[－]/g, '-')
    .replace(/[×]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[％]/g, '%')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')

  const tokenRegex = /[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*|-?\d+(?:\.\d+)?|[+\-*/%()]/g
  const tokens = canonical.match(tokenRegex)
  if (!tokens || tokens.join('') !== canonical.replace(/\s+/g, '')) return false

  let hasNumericValue = false

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (/^[+\-*/%()]$/.test(token)) continue
    if (/^-?\d+(?:\.\d+)?$/.test(token)) {
      hasNumericValue = true
      continue
    }

    const next = tokens[i + 1] || ''
    if (next === '(') {
      if (token === '到数值') continue
      return false
    }

    const varType = resolveVarTypeAtLine(token, lineIndex, scopes)
    if (!varType || !isNumericType(varType)) return false
    hasNumericValue = true
  }

  return hasNumericValue
}

export function buildEditorDiagnosticsProblems(
  request: Omit<EditorDiagnosticsRequest, 'id'>,
): EditorDiagnosticsProblem[] {
  const problems: EditorDiagnosticsProblem[] = []
  const parsedForDiagnostics = parseLines(request.text)
  const validCommandNames = new Set(request.validCommandNames)
  const allKnownVarNames = new Set(request.allKnownVarNames)
  const reservedNameSet = new Set(request.reservedNames)
  const typeScopes = buildTypeScopes(parsedForDiagnostics)

  if (request.hasCommandCatalog) {
    for (let i = 0; i < parsedForDiagnostics.length; i++) {
      const ln = parsedForDiagnostics[i]
      if (ln.type !== 'code') continue
      const rawLine = (ln.raw || '').replace(FLOW_AUTO_TAG, '')
      const spans = colorize(rawLine)
      let col = 1
      for (const s of spans) {
        if (s.cls === 'funccolor' && !validCommandNames.has(s.text)) {
          problems.push({ line: i + 1, column: col, message: `未知命令"${s.text}"`, severity: 'error' })
        }
        if (s.cls === 'assignTarget' && !isKnownAssignmentTarget(s.text, allKnownVarNames)) {
          problems.push({ line: i + 1, column: col, message: `未知变量"${s.text}"`, severity: 'error' })
        }
        col += s.text.length
      }

      const missingTarget = getMissingAssignmentRhsTarget(rawLine)
      if (missingTarget) {
        const eqPos = rawLine.search(/(?:=|＝)\s*$/)
        const column = eqPos >= 0 ? eqPos + 1 : 1
        problems.push({ line: i + 1, column, message: `赋值语句缺少右值（${missingTarget}）`, severity: 'error' })
      }
    }
  }

  for (let i = 0; i < parsedForDiagnostics.length; i++) {
    const ln = parsedForDiagnostics[i]
    if (ln.type !== 'code') continue
    const rawLine = (ln.raw || '').replace(FLOW_AUTO_TAG, '')
    const assign = parseAssignment(rawLine)
    const targetType = assign ? resolveVarTypeAtLine(assign.target, i, typeScopes) : ''
    const skipInt64Overflow = isBigType(targetType)
    if (!skipInt64Overflow) {
      for (const overflow of findOutOfRangeInt64Literals(rawLine)) {
        problems.push({
          line: i + 1,
          column: overflow.column,
          message: buildOverflowMessage(ln.type, rawLine, ln.fields),
          severity: 'error',
        })
      }
    }

    if (assign) {
      if (isTextType(targetType) && isPureNumericExpression(assign.rhs, i, typeScopes)) {
        const targetName = assign.target.split(/[.。．]/)[0] || assign.target
        problems.push({
          line: i + 1,
          column: assign.targetColumn,
          message: `变量：${targetName} 为文本型，不能直接接收数值型值`,
          severity: 'error',
        })
      }
    }
  }

  // 对声明行也做同样的长整数范围检查（如 .常量、.局部变量 默认值等）。
  for (let i = 0; i < parsedForDiagnostics.length; i++) {
    const ln = parsedForDiagnostics[i]
    if (ln.type === 'comment' || ln.type === 'blank' || ln.type === 'code') continue
    const rawLine = (ln.raw || '').replace(FLOW_AUTO_TAG, '')
    for (const overflow of findOutOfRangeInt64Literals(rawLine)) {
      problems.push({
        line: i + 1,
        column: overflow.column,
        message: buildOverflowMessage(ln.type, rawLine, ln.fields),
        severity: 'error',
      })
    }
  }

  const assemblyVars = new Map<string, number>()
  const globalVars = new Map<string, number>()
  const subroutines = new Map<string, number>()
  let localVarsByName = new Map<string, number[]>()
  let inSub = false

  const checkLocalVars = (): void => {
    if (!inSub) return
    for (const [name, lineIndices] of localVarsByName) {
      if (lineIndices.length > 1) {
        for (let k = 1; k < lineIndices.length; k++) {
          problems.push({ line: lineIndices[k] + 1, column: 1, message: `局部变量"${name}"在当前子程序中重复定义`, severity: 'error' })
        }
      }
      if (assemblyVars.has(name)) {
        for (const li of lineIndices) {
          problems.push({ line: li + 1, column: 1, message: `局部变量"${name}"与程序集变量同名`, severity: 'error' })
        }
      }
      if (globalVars.has(name)) {
        for (const li of lineIndices) {
          problems.push({ line: li + 1, column: 1, message: `局部变量"${name}"与全局变量同名`, severity: 'error' })
        }
      }
    }
    localVarsByName = new Map()
  }

  for (let i = 0; i < parsedForDiagnostics.length; i++) {
    const ln = parsedForDiagnostics[i]
    if (ln.type === 'assemblyVar') {
      const name = ln.fields[0]
      if (name) {
        if (!isValidVariableLikeName(name)) {
          problems.push({ line: i + 1, column: 1, message: `变量名"${name}"不能以数字或特殊符号开头`, severity: 'error' })
        } else if (reservedNameSet.has(name)) {
          problems.push({ line: i + 1, column: 1, message: `变量名"${name}"不能与关键字或命令同名`, severity: 'error' })
        }
        if (assemblyVars.has(name)) {
          problems.push({ line: i + 1, column: 1, message: `程序集变量"${name}"重复定义`, severity: 'error' })
        } else {
          assemblyVars.set(name, i)
        }
      }
    } else if (ln.type === 'globalVar') {
      const name = ln.fields[0]
      if (name) {
        if (!isValidVariableLikeName(name)) {
          problems.push({ line: i + 1, column: 1, message: `变量名"${name}"不能以数字或特殊符号开头`, severity: 'error' })
        } else if (reservedNameSet.has(name)) {
          problems.push({ line: i + 1, column: 1, message: `变量名"${name}"不能与关键字或命令同名`, severity: 'error' })
        }
        if (globalVars.has(name)) {
          problems.push({ line: i + 1, column: 1, message: `全局变量"${name}"重复定义`, severity: 'error' })
        } else {
          globalVars.set(name, i)
        }
      }
    } else if (ln.type === 'sub') {
      const subName = (ln.fields[0] || '').trim()
      if (subName) {
        if (subroutines.has(subName)) {
          problems.push({ line: i + 1, column: 1, message: `子程序"${subName}"重复定义`, severity: 'error' })
        } else {
          subroutines.set(subName, i)
        }
      }
      checkLocalVars()
      inSub = true
    } else if (ln.type === 'assembly') {
      checkLocalVars()
      inSub = false
    } else if (ln.type === 'localVar') {
      const name = ln.fields[0]
      if (name) {
        if (!isValidVariableLikeName(name)) {
          problems.push({ line: i + 1, column: 1, message: `变量名"${name}"不能以数字或特殊符号开头`, severity: 'error' })
        } else if (reservedNameSet.has(name)) {
          problems.push({ line: i + 1, column: 1, message: `变量名"${name}"不能与关键字或命令同名`, severity: 'error' })
        }
        const arr = localVarsByName.get(name)
        if (arr) arr.push(i)
        else localVarsByName.set(name, [i])
      }
    } else if (ln.type === 'subParam') {
      const name = ln.fields[0]
      if (name) {
        if (!isValidVariableLikeName(name)) {
          problems.push({ line: i + 1, column: 1, message: `参数名"${name}"不能以数字或特殊符号开头`, severity: 'error' })
        } else if (reservedNameSet.has(name)) {
          problems.push({ line: i + 1, column: 1, message: `参数名"${name}"不能与关键字或命令同名`, severity: 'error' })
        }
      }
    }
  }

  checkLocalVars()
  return problems
}
