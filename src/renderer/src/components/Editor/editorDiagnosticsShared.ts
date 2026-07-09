import { FLOW_AUTO_TAG } from './eycFlow'
import { parseLines } from './eycBlocks'
import {
  colorize,
  getMissingAssignmentRhsTarget,
  isKnownAssignmentTarget,
  isValidVariableLikeName,
  LOGIC_OPERATOR_ALIASES,
} from './editorCoreUtils'

export interface DiagCommandParam {
  name: string
  type: string
  optional?: boolean
  isArray?: boolean
  repeatable?: boolean
}

export interface DiagCommandSignature {
  params: DiagCommandParam[]
  returnType?: string
}

export interface EditorDiagnosticsRequest {
  id: number
  text: string
  hasCommandCatalog: boolean
  validCommandNames: string[]
  allKnownVarNames: string[]
  reservedNames: string[]
  // 命令签名表（命令名 → 参数类型/返回类型），用于参数数据类型匹配检查；缺省不检查
  commandSignatures?: Record<string, DiagCommandSignature>
  // 关联窗口控件的属性类型表（控件名 → 属性名 → 类型名），用于控件属性赋值的类型检查；
  // 编辑框「内容」的实际类型已按「输入方式」折算（buildControlPropTypes）。缺省不检查
  controlPropTypes?: Record<string, Record<string, string>>
}

/** 编辑框「输入方式」→「内容」属性的实际数据类型（照易语言：数值/日期输入方式下 内容 为对应类型） */
const INPUT_MODE_CONTENT_TYPES: Record<string, string> = {
  输入字节: '字节型',
  输入短整数: '短整数型',
  输入整数: '整数型',
  输入长整数: '长整数型',
  输入小数: '小数型',
  输入双精度小数: '双精度小数型',
  输入日期时间: '日期时间型',
}

/**
 * 由窗口控件实例 + 支持库窗口单元定义折算「控件名 → 属性名 → 类型名」表。
 * 单元带「输入方式」属性时（编辑框族），「内容」的类型随实例的输入方式值变化：
 * 数值/日期输入方式 → 对应数值/日期类型，文本类方式保持单元定义的类型。
 */
export function buildControlPropTypes(
  controls: Array<{ name?: string; type?: string; properties?: Record<string, string | number | boolean> }>,
  units: Array<{ name?: string; properties?: Array<{ name?: string; typeName?: string; pickOptions?: string[]; defaultValue?: string | number | boolean }> }>,
): Record<string, Record<string, string>> | undefined {
  if (!controls.length || !units.length) return undefined
  const unitByName = new Map<string, (typeof units)[number]>()
  for (const u of units) {
    const n = (u.name || '').trim()
    if (n && !unitByName.has(n)) unitByName.set(n, u)
  }
  const out: Record<string, Record<string, string>> = {}
  for (const c of controls) {
    const ctrlName = (c.name || '').trim()
    const unit = unitByName.get((c.type || '').trim())
    if (!ctrlName || !unit) continue
    const props: Record<string, string> = {}
    let inputModeProp: { pickOptions?: string[]; defaultValue?: string | number | boolean } | undefined
    for (const p of unit.properties || []) {
      const pn = (p.name || '').trim()
      if (!pn) continue
      props[pn] = (p.typeName || '').trim()
      if (pn === '输入方式') inputModeProp = p
    }
    if (inputModeProp && props['内容']) {
      const mode = Number(c.properties?.['输入方式'] ?? inputModeProp.defaultValue ?? 0)
      const option = inputModeProp.pickOptions?.[mode] || ''
      props['内容'] = INPUT_MODE_CONTENT_TYPES[option] || props['内容']
    }
    out[ctrlName] = props
  }
  return Object.keys(out).length ? out : undefined
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

    const start = i
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

// ===== 命令参数数据类型检查 =====
// 只对"能可靠推断"的实参类型做族级匹配（数值族/文本/逻辑/字节集/日期时间），
// 通用型参数、无法推断的表达式（含运算符/常量/成员访问/未知变量）一律跳过，避免误报。

/** 数据类型 → 匹配族；'' 表示不参与判定（通用型/组件/自定义类型/指针等） */
function classifyTypeFamily(typeName: string): string {
  const t = normalizeDataTypeName(typeName)
  if (!t) return ''
  if (NUMERIC_TYPES.has(t)) return 'numeric'
  if (t === '文本型') return 'text'
  if (t === '逻辑型') return 'logic'
  if (t === '字节集') return 'bin'
  if (t === '日期时间型') return 'datetime'
  return ''
}

/** 按顶层逗号切分实参（引号/括号感知），返回各参数文本与其在源串中的偏移 */
function splitTopLevelArgs(argsText: string): Array<{ text: string; offset: number }> {
  const out: Array<{ text: string; offset: number }> = []
  let depth = 0
  let inStr = false
  let start = 0
  for (let i = 0; i < argsText.length; i++) {
    const ch = argsText[i]
    if (inStr) {
      if (ch === '"' || ch === '”') inStr = false
      continue
    }
    if (ch === '"' || ch === '“') { inStr = true; continue }
    if (ch === '(' || ch === '（') depth++
    else if (ch === ')' || ch === '）') depth--
    else if ((ch === ',' || ch === '，') && depth === 0) {
      out.push({ text: argsText.slice(start, i), offset: start })
      start = i + 1
    }
  }
  out.push({ text: argsText.slice(start), offset: start })
  return out
}

/** 整个实参是否恰为一个字符串字面量（“…” 或 "…"，无拼接） */
function isSingleQuotedLiteral(arg: string): boolean {
  if (arg.length < 2) return false
  const open = arg[0]
  if (open !== '"' && open !== '“') return false
  const close = open === '“' ? '”' : '"'
  const end = arg.indexOf(close, 1)
  return end === arg.length - 1
}

const NUMERIC_LITERAL_RE = /^[+-]?[0-9０-９]+(?:[.．][0-9０-９]+)?$/
const IDENTIFIER_RE = /^[一-龥A-Za-z_][一-龥A-Za-z0-9_]*$/
const CALL_HEAD_RE = /^([一-龥A-Za-z_][一-龥A-Za-z0-9_]*)\s*[（(]/

/**
 * 数字开头但不是合法数值字面量的"单词型"实参（如 1.txt、3x）：
 * 易语言标识符不能以数字开头，这必然是非法表达式（最常见是文本忘加引号）。
 * 含空白/运算符/引号/括号的表达式不在此列（交给类型推断按未知跳过）。
 */
function isInvalidDigitStartToken(arg: string): boolean {
  if (!/^[+-]?[0-9０-９]/.test(arg)) return false
  if (NUMERIC_LITERAL_RE.test(arg)) return false
  return /^[+-]?[0-9０-９][0-9０-９A-Za-z_一-龥.．。]*$/.test(arg)
}

/** 推断实参类型族；'' = 无法可靠推断（跳过检查） */
function inferArgTypeFamily(
  arg: string,
  lineIndex: number,
  scopes: { assemblyVars: Map<string, string>; globalVars: Map<string, string>; subScopes: SubScope[] },
  signatures: Record<string, DiagCommandSignature>,
): { family: string; typeName: string } {
  const t = arg.trim()
  if (!t) return { family: '', typeName: '' }
  if (isSingleQuotedLiteral(t)) return { family: 'text', typeName: '文本型' }
  if (t === '真' || t === '假') return { family: 'logic', typeName: '逻辑型' }
  if (NUMERIC_LITERAL_RE.test(t)) {
    return /[.．]/.test(t)
      ? { family: 'numeric', typeName: '小数型' }
      : { family: 'numeric', typeName: '整数型' }
  }
  if (IDENTIFIER_RE.test(t)) {
    const varType = resolveVarTypeAtLine(t, lineIndex, scopes)
    if (!varType) return { family: '', typeName: '' }
    return { family: classifyTypeFamily(varType), typeName: varType }
  }
  // 嵌套命令调用：取返回类型（要求整个实参就是一次调用，如 到字节集(...)）
  const callHead = t.match(CALL_HEAD_RE)
  if (callHead && (t.endsWith(')') || t.endsWith('）'))) {
    const sig = signatures[callHead[1]]
    const ret = sig?.returnType || ''
    if (!ret) return { family: '', typeName: '' }
    return { family: classifyTypeFamily(ret), typeName: ret }
  }
  // 纯数值表达式（数值变量/字面量 + 四则运算）
  if (isPureNumericExpression(t, lineIndex, scopes)) return { family: 'numeric', typeName: '数值' }
  return { family: '', typeName: '' }
}

/**
 * 扫描一段代码文本里的所有命令调用（含嵌套），对签名表里已知的命令做实参类型检查。
 * textOffset 为该段文本在整行中的起始偏移（列号定位用）。
 */
function checkCommandArgTypes(
  text: string,
  textOffset: number,
  lineIndex: number,
  scopes: { assemblyVars: Map<string, string>; globalVars: Map<string, string>; subScopes: SubScope[] },
  signatures: Record<string, DiagCommandSignature>,
  problems: EditorDiagnosticsProblem[],
): void {
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (ch === '"' || ch === '”') inStr = false
      continue
    }
    if (ch === '"' || ch === '“') { inStr = true; continue }
    if (!/[一-龥A-Za-z_]/.test(ch)) continue

    // 读出标识符
    let j = i
    while (j < text.length && /[一-龥A-Za-z0-9_]/.test(text[j])) j++
    const name = text.slice(i, j)
    // 名后紧跟开括号（允许空格）才是调用
    let k = j
    while (k < text.length && (text[k] === ' ' || text[k] === '　')) k++
    if (text[k] !== '(' && text[k] !== '（') { i = j - 1; continue }
    // 成员方法调用（对象.方法）不做签名匹配（方法名可能与全局命令重名）
    const prev = text.slice(0, i).trimEnd()
    const isMember = /[.。．]$/.test(prev)

    // 提取配平的括号内文本
    const openIdx = k
    let depth = 0
    let closeIdx = text.length
    let strFlag = false
    for (let m = openIdx; m < text.length; m++) {
      const c = text[m]
      if (strFlag) {
        if (c === '"' || c === '”') strFlag = false
        continue
      }
      if (c === '"' || c === '“') { strFlag = true; continue }
      if (c === '(' || c === '（') depth++
      else if (c === ')' || c === '）') {
        depth--
        if (depth === 0) { closeIdx = m; break }
      }
    }
    const inner = text.slice(openIdx + 1, closeIdx)
    const args = splitTopLevelArgs(inner)

    const sig = !isMember ? signatures[name] : undefined
    if (sig && sig.params.length > 0) {
      for (let a = 0; a < args.length; a++) {
        const lastParam = sig.params[sig.params.length - 1]
        const param = a < sig.params.length ? sig.params[a] : (lastParam?.repeatable ? lastParam : undefined)
        if (!param) continue
        const raw = args[a].text
        const trimmed = raw.trim()
        if (!trimmed) continue
        const argCol = textOffset + openIdx + 1 + args[a].offset + (raw.length - raw.trimStart().length) + 1
        // 数字开头的非法单词（如 1.txt）：必错，文本参数给出加引号提示
        if (isInvalidDigitStartToken(trimmed)) {
          const paramFam = classifyTypeFamily(param.type)
          const hint = paramFam === 'text' ? `；文本内容需加引号（如：“${trimmed}”）` : ''
          problems.push({
            line: lineIndex + 1,
            column: argCol,
            message: `参数"${param.name}"的值 ${trimmed} 不是有效表达式${hint}`,
            severity: 'error',
          })
          continue
        }
        if (param.isArray) continue
        const paramFam = classifyTypeFamily(param.type)
        if (!paramFam) continue
        const inferred = inferArgTypeFamily(trimmed, lineIndex, scopes, signatures)
        if (!inferred.family) continue
        if (inferred.family !== paramFam) {
          problems.push({
            line: lineIndex + 1,
            column: argCol,
            message: `参数"${param.name}"类型不匹配：需要 ${param.type}，当前为 ${inferred.typeName}`,
            severity: 'error',
          })
        }
      }
    }

    // 递归进入每个实参检查嵌套调用（无论本调用是否在签名表里）
    for (const argItem of args) {
      checkCommandArgTypes(argItem.text, textOffset + openIdx + 1 + argItem.offset, lineIndex, scopes, signatures, problems)
    }

    i = closeIdx
  }
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
        if (s.cls === 'funccolor' && !validCommandNames.has(s.text) && !LOGIC_OPERATOR_ALIASES.has(s.text)) {
          problems.push({ line: i + 1, column: col, message: `未知命令"${s.text}"`, severity: 'error' })
        }
        if (s.cls === 'assignTarget' && !isKnownAssignmentTarget(s.text, allKnownVarNames)) {
          problems.push({ line: i + 1, column: col, message: `未知变量"${s.text}"`, severity: 'error' })
        }
        // 表达式/流程条件里被引用的干净标识符（如判断条件里的变量）：既非命令/子程序/变量/流程关键字（validCommandNames 已含这些），
        // 也非保留字 → 判为未定义变量。#常量走 conscolor、命令调用走 funccolor、数字不匹配标识符正则，均不会误报。
        if (s.cls === '' && /^[一-龥A-Za-z_][一-龥A-Za-z0-9_]*$/.test(s.text)
          && !validCommandNames.has(s.text) && !allKnownVarNames.has(s.text) && !reservedNameSet.has(s.text)) {
          problems.push({ line: i + 1, column: col, message: `未定义变量"${s.text}"`, severity: 'error' })
        }
        col += s.text.length
      }

      const missingTarget = getMissingAssignmentRhsTarget(rawLine)
      if (missingTarget) {
        const eqPos = rawLine.search(/(?:=|＝)\s*$/)
        const column = eqPos >= 0 ? eqPos + 1 : 1
        problems.push({ line: i + 1, column, message: `赋值语句缺少右值（${missingTarget}）`, severity: 'error' })
      }

      // 成员引用的对象必须真实存在：`对象.成员` 的对象既非关联窗口的组件/窗口自身
      //（控件名已并入 allKnownVarNames）、也非已知变量/参数/命令 → 报未定义
      //（如设计器没放置 编辑框1 时写 编辑框1.内容）。链式 a.b.c 只查首段（后段无类型信息）。
      {
        const masked = maskQuotedText(rawLine)
        const memberHeadRe = /(^|[^一-龥A-Za-z0-9_.．。])([一-龥A-Za-z_][一-龥A-Za-z0-9_]*)[.．。](?=[一-龥A-Za-z_])/g
        let mm: RegExpExecArray | null
        while ((mm = memberHeadRe.exec(masked)) !== null) {
          const head = mm[2]
          if (validCommandNames.has(head) || allKnownVarNames.has(head) || reservedNameSet.has(head)) continue
          problems.push({
            line: i + 1,
            column: mm.index + mm[1].length + 1,
            message: `未定义的窗口组件或对象"${head}"`,
            severity: 'error',
          })
        }
      }

      // 命令实参数据类型匹配检查（含嵌套调用）
      if (request.commandSignatures) {
        checkCommandArgTypes(rawLine, 0, i, typeScopes, request.commandSignatures, problems)
      }
    }
  }

  for (let i = 0; i < parsedForDiagnostics.length; i++) {
    const ln = parsedForDiagnostics[i]
    if (ln.type !== 'code') continue
    const rawLine = (ln.raw || '').replace(FLOW_AUTO_TAG, '')
    const assign = parseAssignment(rawLine)
    const targetType = assign ? resolveVarTypeAtLine(assign.target, i, typeScopes) : ''

    // 行内括号配平：易语言语句单行成立，行内括号必须自洽（字符串内不计、行尾 ' 注释截断）。
    // 如「编辑框1.内容 ＝ 到文本(n)))」应报多余右括号。
    {
      let maskedLine = maskQuotedText(rawLine)
      const commentIdx = maskedLine.indexOf("'")
      if (commentIdx > 0) maskedLine = maskedLine.slice(0, commentIdx)
      const openPos: number[] = []
      let extraCloses = 0
      let firstExtraClose = -1
      for (let k = 0; k < maskedLine.length; k++) {
        const ch = maskedLine[k]
        if (ch === '(' || ch === '（') {
          openPos.push(k)
        } else if (ch === ')' || ch === '）') {
          if (openPos.length > 0) openPos.pop()
          else {
            extraCloses++
            if (firstExtraClose < 0) firstExtraClose = k
          }
        }
      }
      if (extraCloses > 0) {
        problems.push({
          line: i + 1,
          column: firstExtraClose + 1,
          message: `括号不匹配：多余 ${extraCloses} 个右括号`,
          severity: 'error',
        })
      }
      if (openPos.length > 0) {
        problems.push({
          line: i + 1,
          column: openPos[0] + 1,
          message: `括号不匹配：缺少 ${openPos.length} 个右括号`,
          severity: 'error',
        })
      }
    }

    // 控件属性赋值的数据类型检查（照易语言）：属性类型来自窗口单元定义，
    // 编辑框「内容」的实际类型已按「输入方式」折算（如 输入整数 → 整数型，此时
    // `编辑框1.内容 ＝ 到文本(n)` 应报类型不匹配、`＝ n` 才合法）。
    // 右值类型无法可靠推断时保守跳过（与命令参数类型检查同一策略）。
    if (assign && request.controlPropTypes) {
      const pm = assign.target.match(/^([一-龥A-Za-z_][一-龥A-Za-z0-9_]*)[.．。]([一-龥A-Za-z_][一-龥A-Za-z0-9_]*)$/)
      const propType = pm ? request.controlPropTypes[pm[1]]?.[pm[2]] : undefined
      if (pm && propType) {
        const propFam = classifyTypeFamily(propType)
        const rhs = inferArgTypeFamily(assign.rhs, i, typeScopes, request.commandSignatures || {})
        if (propFam && rhs.family && rhs.family !== propFam) {
          problems.push({
            line: i + 1,
            column: assign.targetColumn,
            message: `属性"${pm[1]}.${pm[2]}"类型不匹配：需要 ${propType}，当前为 ${rhs.typeName}`,
            severity: 'error',
          })
        }
      }
    }

    // 裸语句检查（赋值行交给"未知变量"检查，避免同一行重复报两条）：
    // ①以数字开头（如整行只写 123555）——数字不能作为命令，标识符也不能以数字开头；
    // ②以字符串开头（如整行只写 "编辑框1.内容"）——字符串字面量不能单独作为语句。
    if (!assign) {
      const stmt = rawLine.trim()
      const digitHead = stmt.match(/^([+-]?[0-9０-９][^\s(（,，=＝]*)/)
      if (digitHead) {
        problems.push({
          line: i + 1,
          column: rawLine.indexOf(digitHead[1]) + 1,
          message: `无效语句"${digitHead[1]}"：语句不能以数字开头`,
          severity: 'error',
        })
      } else {
        const quoteHead = stmt.match(/^("[^"]*"?|“[^”]*”?)/)
        if (quoteHead) {
          const excerpt = quoteHead[1].length > 24 ? `${quoteHead[1].slice(0, 24)}…` : quoteHead[1]
          problems.push({
            line: i + 1,
            column: rawLine.indexOf(stmt[0]) + 1,
            message: `无效语句${excerpt}：字符串不能单独作为语句`,
            severity: 'error',
          })
        }
      }
    }
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
