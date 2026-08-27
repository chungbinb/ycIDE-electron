// 易语言表达式 AST 解析器 + toC emitter —— Phase 2 完整实现
//
// 本文件包含：
// 1. parseExpr(): 字符串 → AST
// 2. exprToC(): AST → C 字符串（自描述 emitter）
//
// 字节等价性保证：parseExpr 返回的 AST 经 exprToC(ctx) 必须生成与原始
// translateExpressionToC 完全相同的字符串。

import {
  type TranspileContext,
  type Expr,
  numberLiteral,
  textLiteral,
  boolLiteral,
  colorLiteral,
  varRef,
  constRef,
  ctrlPropRead,
  arrayIdx,
  arrayLit,
  commandCall,
  binaryOp,
  unaryOp,
  castExpr,
  placeholder,
} from './ast'

// 重新导出（供 compiler.ts 使用）
export type { TranspileContext, Expr } from './ast'

// -- 工具函数（从 compiler.ts 移植，保持兼容）--

const REAL_DIV_MARK = ''
const APPROX_EQ_OP = '≈'

/** 全角运算符转 C 运算符（字符串字面量内不改写） */
function convertFullWidthOps(expr: string): string {
  const conv = (seg: string): string => seg
    .replace(/<>/g, '!=')
    .replace(/\?=/g, APPROX_EQ_OP)
    .replace(/≠/g, '!=')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/＝/g, '==')
    .replace(/＜/g, '<')
    .replace(/＞/g, '>')
    .replace(/＋/g, '+')
    .replace(/－/g, '-')
    .replace(/×/g, '*')
    .replace(/÷/g, REAL_DIV_MARK)
    .replace(/％/g, '%')
    .replace(/＼/g, '/')
  let out = ''
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if (ch === '"' || ch === '“') {
      const close = ch === '“' ? '”' : '"'
      const end = expr.indexOf(close, i + 1)
      if (end < 0) { out += expr.slice(i); break }
      out += expr.slice(i, end + 1)
      i = end + 1
      continue
    }
    let j = i
    while (j < expr.length && expr[j] !== '"' && expr[j] !== '“') j++
    out += conv(expr.slice(i, j))
    i = j
  }
  return out
}

/** 匹配被一对括号包围的表达式（剥外层括号） */
function matchEnclosingParens(expr: string): string | null {
  const trimmed = expr.trim()
  if (trimmed.length < 2) return null
  if ((trimmed[0] === '(' && trimmed[trimmed.length - 1] === ')') ||
      (trimmed[0] === '（' && trimmed[trimmed.length - 1] === '）')) {
    let depth = 0
    let inString = false
    let stringChar = ''
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i]
      if (inString) {
        if ((stringChar === '"' && ch === '"') || (stringChar === '“' && ch === '”')) inString = false
        continue
      }
      if (ch === '"' || ch === '“') {
        inString = true
        stringChar = ch
        continue
      }
      if (ch === '(' || ch === '（') depth++
      else if (ch === ')' || ch === '）') {
        depth--
        if (depth === 0) {
          if (i === trimmed.length - 1) {
            return trimmed.slice(1, -1)
          }
          return null
        }
      }
    }
  }
  return null
}

/** 查找顶层逻辑运算符（||/&&），优先级最低 */
function findTopLevelLogical(expr: string): { left: string; operator: '&&' | '||'; right: string } | null {
  for (const op of ['||', '&&'] as const) {
    let depth = 0
    let inString = false
    let stringChar = ''
    let found = -1
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i]
      if (inString) {
        if ((stringChar === '"' && ch === '"') || (stringChar === '“' && ch === '”')) inString = false
        continue
      }
      if (ch === '"' || ch === '“') {
        inString = true
        stringChar = ch
        continue
      }
      if (ch === '(' || ch === '（') { depth++; continue }
      if (ch === ')' || ch === '）') { depth = Math.max(0, depth - 1); continue }
      if (depth !== 0) continue
      if (expr.slice(i, i + 2) === op) {
        found = i
        i++
      }
    }
    if (found > 0) {
      const left = expr.slice(0, found).trim()
      const right = expr.slice(found + 2).trim()
      if (left && right) return { left, operator: op, right }
    }
  }
  return null
}

/** 查找顶层比较运算符 */
function findTopLevelComparison(expr: string): { left: string; operator: string; right: string } | null {
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (inString) {
      if ((stringChar === '"' && ch === '"') || (stringChar === '“' && ch === '”')) inString = false
      continue
    }
    if (ch === '"' || ch === '“') {
      inString = true
      stringChar = ch
      continue
    }
    if (ch === '(' || ch === '（') {
      depth++
      continue
    }
    if (ch === ')' || ch === '）') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth !== 0) continue

    const twoChars = expr.slice(i, i + 2)
    if (twoChars === '==' || twoChars === '!=' || twoChars === '<=' || twoChars === '>=') {
      return {
        left: expr.slice(0, i).trim(),
        operator: twoChars,
        right: expr.slice(i + 2).trim(),
      }
    }

    if (ch === '=' || ch === '<' || ch === '>' || ch === APPROX_EQ_OP) {
      return {
        left: expr.slice(0, i).trim(),
        operator: ch,
        right: expr.slice(i + 1).trim(),
      }
    }
  }

  return null
}

/** 查找顶层加减运算符（从右向左扫描，处理一元符号） */
function findTopLevelAdditive(expr: string): { left: string; operator: string; right: string } | null {
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = expr.length - 1; i >= 0; i--) {
    const ch = expr[i]
    if (inString) {
      if ((stringChar === '"' && ch === '"') || (stringChar === '“' && ch === '”')) inString = false
      continue
    }
    if (ch === '"' || ch === '”') {
      inString = true
      stringChar = ch === '”' ? '“' : ch
      continue
    }
    if (ch === ')' || ch === '）') {
      depth++
      continue
    }
    if (ch === '(' || ch === '（') {
      depth--
      continue
    }
    if (depth !== 0) continue
    if (ch !== '+' && ch !== '-') continue

    let j = i - 1
    while (j >= 0 && /\s/.test(expr[j])) j--
    const prev = j >= 0 ? expr[j] : ''
    if (!prev || prev === REAL_DIV_MARK || /[+\-*/%(<>=!&|,]/.test(prev)) continue

    return {
      left: expr.slice(0, i).trim(),
      operator: ch,
      right: expr.slice(i + 1).trim(),
    }
  }

  return null
}

/** 查找顶层乘除运算符 */
function findTopLevelMultiplicative(expr: string): { left: string; operator: string; right: string } | null {
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = expr.length - 1; i >= 0; i--) {
    const ch = expr[i]
    if (inString) {
      if ((stringChar === '"' && ch === '"') || (stringChar === '“' && ch === '”')) inString = false
      continue
    }
    if (ch === '"' || ch === '”') {
      inString = true
      stringChar = ch === '”' ? '“' : ch
      continue
    }
    if (ch === ')' || ch === '）') {
      depth++
      continue
    }
    if (ch === '(' || ch === '（') {
      depth--
      continue
    }
    if (depth !== 0) continue
    if (ch !== '*' && ch !== '/' && ch !== '%' && ch !== REAL_DIV_MARK) continue

    let j = i - 1
    while (j >= 0 && /\s/.test(expr[j])) j--
    const prev = j >= 0 ? expr[j] : ''
    if (!prev || /[+\-*/%(<>=!&|,]/.test(prev)) continue

    const op = ch === REAL_DIV_MARK ? '÷' : ch
    return {
      left: expr.slice(0, i).trim(),
      operator: op,
      right: expr.slice(i + 1).trim(),
    }
  }

  return null
}

// -- 解析器入口 --

/**
 * 解析易语言表达式为 AST。
 * 返回 Expr | string（string 表示"未处理，委托给上层"）。
 */
export function parseExpr(
  raw: string,
  ctx: TranspileContext,
): Expr | string {
  const { commandMap, directCallables, variableTypeResolver, preferBigIntLiteral = false } = ctx
  // 全角运算符 → C 运算符（字符串字面量内不改写，与 fallback 逻辑一致）
  let expr = convertFullWidthOps(raw || '').trim()
  // 空表达式返回字面量 0（string 形式，保持与原始逻辑一致）
  if (!expr) return '0'

  // 剥外层括号
  const enclosed = matchEnclosingParens(expr)
  if (enclosed !== null) {
    const inner = enclosed.trim()
    if (!inner) return numberLiteral(0n, false, '0')
    const innerAst = parseExpr(inner, ctx)
    return innerAst
  }

  // 中文引号文本
  const chineseStrMatch = expr.match(/^“([^\”]*)”$/)
  if (chineseStrMatch) {
    return textLiteral(chineseStrMatch[1])
  }

  // 英文引号文本
  const englishStrMatch = expr.match(/^"([^"]*)"$/)
  if (englishStrMatch) {
    return textLiteral(englishStrMatch[1])
  }

  // 布尔字面量
  if (expr === '真') return boolLiteral(true)
  if (expr === '假') return boolLiteral(false)

  // 数字字面量（整数）
  if (/^-?\d+$/.test(expr)) {
    try {
      const value = BigInt(expr)
      return numberLiteral(value, false, expr)
    } catch {
      return numberLiteral(0n, false, '0')
    }
  }

  // 浮点数字面量
  if (/^-?\d+\.\d+$/.test(expr)) {
    // 直接返回字符串，不经过 AST（保留原始格式）
    return expr
  }

  // 颜色字面量（rgb/rgba 调用）
  if (/^rgba?\s*[（(]/i.test(expr)) {
    const colorCall = parseCommandCall(expr)
    const colorBuiltin = colorCall && colorCall.name ? normalizeBuiltinCallName(colorCall.name) : ''
    if (colorCall && (colorBuiltin === 'rgb' || colorBuiltin === 'rgba')) {
      const args = (colorCall.args || []).map(a => parseExpr(a, ctx)).filter((a): a is Expr => typeof a !== 'string')
      return colorLiteral(
        args[0] || numberLiteral(0n, false, '0'),
        args[1] || numberLiteral(0n, false, '0'),
        args[2] || numberLiteral(0n, false, '0')
      )
    }
  }

  // 命令调用
  const call = parseCommandCall(expr)
  if (call && call.name) {
    const builtinName = normalizeBuiltinCallName(call.name)

    // 到文本
    if (builtinName === '到文本') {
      const src = parseExpr(call.args?.[0] || '0', ctx)
      const srcExpr = typeof src === 'string' ? parseExpr(src, ctx) : src
      if (typeof srcExpr !== 'string') {
        return commandCall('yc_value_to_text', [srcExpr])
      }
    }

    // 到数值
    if (builtinName === '到数值') {
      const src = parseExpr(call.args?.[0] || '0', ctx)
      const srcExpr = typeof src === 'string' ? parseExpr(src, ctx) : src
      if (typeof srcExpr !== 'string') {
        return commandCall('yc_value_to_big', [srcExpr])
      }
    }

    // 其他命令调用
    if (commandMap) {
      const resolved = commandMap.get(call.name)
      if (resolved) {
        const args = (call.args || []).map(a => parseExpr(a, ctx)).filter((a): a is Expr => typeof a !== 'string')
        return commandCall(call.name, args)
      }
    }
    if (directCallables?.has(call.name)) {
      const args = (call.args || []).map(a => parseExpr(a, ctx)).filter((a): a is Expr => typeof a !== 'string')
      return commandCall(call.name, args)
    }
  }

  // 常量引用
  if (expr.startsWith('#')) {
    const name = expr.slice(1)
    return constRef(name)
  }

  // 控件属性读取
  const dotAt = expr.indexOf('.')
  if (dotAt > 0) {
    const objName = expr.slice(0, dotAt).trim()
    const rest = expr.slice(dotAt + 1).trim()
    if (/^[一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*$/.test(objName) &&
        /^[一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*$/.test(rest)) {
      return ctrlPropRead(objName, rest)
    }
  }

  // 数组下标引用
  const arrayIdxMatch = expr.match(/^([一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*)\[(.+)\]$/)
  if (arrayIdxMatch) {
    const name = arrayIdxMatch[1]
    const indexExpr = arrayIdxMatch[2]
    const idxAst = parseExpr(indexExpr, ctx)
    if (typeof idxAst === 'string') {
      return arrayIdx(name, [parseExpr(idxAst, ctx)].filter((a): a is Expr => typeof a !== 'string'))
    }
    return arrayIdx(name, [idxAst])
  }

  // 二进制操作（逻辑/比较/算术）
  const logical = findTopLevelLogical(expr)
  if (logical) {
    const left = parseExpr(logical.left, ctx)
    const right = parseExpr(logical.right, ctx)
    if (typeof left !== 'string' && typeof right !== 'string') {
      return binaryOp(logical.operator, left, right)
    }
  }

  const comparison = findTopLevelComparison(expr)
  if (comparison && comparison.left && comparison.right) {
    const left = parseExpr(comparison.left, ctx)
    const right = parseExpr(comparison.right, ctx)
    if (typeof left !== 'string' && typeof right !== 'string') {
      return binaryOp(comparison.operator, left, right)
    }
  }

  const additive = findTopLevelAdditive(expr)
  if (additive && additive.left && additive.right) {
    const left = parseExpr(additive.left, ctx)
    const right = parseExpr(additive.right, ctx)
    if (typeof left !== 'string' && typeof right !== 'string') {
      return binaryOp(additive.operator, left, right)
    }
  }

  const multiplicative = findTopLevelMultiplicative(expr)
  if (multiplicative && multiplicative.left && multiplicative.right) {
    const left = parseExpr(multiplicative.left, ctx)
    const right = parseExpr(multiplicative.right, ctx)
    if (typeof left !== 'string' && typeof right !== 'string') {
      return binaryOp(multiplicative.operator, left, right)
    }
  }

  // 单目运算符
  if (expr.startsWith('-') && expr.length > 1) {
    const operand = parseExpr(expr.slice(1).trim(), ctx)
    if (typeof operand !== 'string') {
      return unaryOp('-', operand)
    }
    // 如果操作数是字符串，直接返回 "-原字符串"
    return `-${operand}`
  }

  // 变量/标识符引用
  if (/^[\p{L}_][\p{L}0-9_]*$/u.test(expr) && expr !== '真' && expr !== '假' && expr !== '空') {
    return varRef(expr)
  }

  // 未识别，返回原字符串（委托给上层）
  return expr
}

// -- exprToC: AST → C 字符串 --

/**
 * 将 AST 转换为 C 字符串。
 * 当传入 string 时原样返回（向后兼容）。
 */
export function exprToC(
  expr: Expr | string,
  ctx: TranspileContext,
): string {
  if (typeof expr === 'string') {
    return expr
  }
  return emitExpr(expr, ctx)
}

// -- emitter 实现 --

function emitExpr(expr: Expr, ctx: TranspileContext): string {
  const { commandMap, directCallables, variableTypeResolver, preferBigIntLiteral = false } = ctx

  switch (expr.kind) {
    case 'number': {
      const { value, isFloat, rawText } = expr
      if (isFloat) {
        return String(value)
      }
      try {
        const max = BigInt('9223372036854775807')
        const min = BigInt('-9223372036854775808')
        if (value > max || value < min) {
          if (preferBigIntLiteral) {
            return `YC_BIG(L"${rawText}")`
          }
          if (value > max) return '9223372036854775807LL'
          return '-9223372036854775807LL - 1'
        }
        return `${rawText}LL`
      } catch {
        return '0'
      }
    }

    case 'text':
      return `L"${expr.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

    case 'bool':
      return expr.value ? '1' : '0'

    case 'color': {
      const r = emitExpr(expr.r, ctx)
      const g = emitExpr(expr.g, ctx)
      const b = emitExpr(expr.b, ctx)
      return `RGB(${r}, ${g}, ${b})`
    }

    case 'var':
      return expr.name

    case 'const':
      return `#${expr.name}`

    case 'ctrlProp':
      return `${expr.objectName}.${expr.propertyName}`

    case 'arrayIdx':
      const idxExprs = expr.indexExprs.map(e => emitExpr(e, ctx))
      return `yc_ary_at(${expr.arrayName}, ${idxExprs.join(', ')})`

    case 'arrayLit': {
      const elements = expr.elementExprs.map(e => emitExpr(e, ctx))
      if (expr.isText) {
        return `yc_ary_lit_text({ ${elements.join(', ')} })`
      }
      if (expr.isBinary) {
        return `yc_ary_lit_bin({ ${elements.join(', ')} })`
      }
      if (expr.isFloat) {
        return `yc_ary_lit_f64({ ${elements.join(', ')} })`
      }
      return `yc_ary_lit({ ${elements.join(', ')} })`
    }

    case 'call': {
      // 命令调用：递归发射参数
      const args = expr.args.map(a => emitExpr(a, ctx)).join(', ')
      return `${expr.name}(${args})`
    }

    case 'binop': {
      const left = emitExpr(expr.left, ctx)
      const right = emitExpr(expr.right, ctx)

      // 逻辑运算符
      if (expr.operator === '&&' || expr.operator === '||') {
        return `(${left} ${expr.operator} ${right})`
      }

      // 近似等于 → 命令调用
      if (expr.operator === '≈') {
        const likeCmd = commandMap?.get('近似等于')
        if (!likeCmd) {
          throw new Error('运算符"≈"（近似等于）来自系统核心支持库，请先在项目中引用该支持库')
        }
        return `approx_equal(${left}, ${right})`
      }

      // 比较运算符
      if (['==', '!=', '<', '>', '<=', '>='].includes(expr.operator)) {
        const normalizedOperator = expr.operator === '=' ? '==' : expr.operator
        // 文本比较特殊处理
        const leftIsText = isTextExpression(left) || isTextRawOperand(expr.left, variableTypeResolver)
        const rightIsText = isTextExpression(right) || isTextRawOperand(expr.right, variableTypeResolver)
        if (leftIsText || rightIsText) {
          return `(yc_text_compare(${left}, ${right}) ${normalizedOperator} 0)`
        }
        return `(${left} ${normalizedOperator} ${right})`
      }

      // 赋值运算符
      if (expr.operator === '=' || expr.operator === '+=') {
        return `${left} ${expr.operator} ${right}`
      }

      // 算术运算符
      const leftIsBig = isBigExpression(left) || isBigRawOperand(expr.left, variableTypeResolver)
      const rightIsBig = isBigExpression(right) || isBigRawOperand(expr.right, variableTypeResolver)

      if (leftIsBig || rightIsBig) {
        if (expr.operator === '%') {
          return `yc_big_mod(yc_value_to_big(${left}), yc_value_to_big(${right}))`
        }
        const bigOp = expr.operator === '÷' ? '/' : expr.operator
        return `(yc_value_to_big(${left}) ${bigOp} yc_value_to_big(${right}))`
      }

      // 文本拼接（+）
      if (expr.operator === '+' && (isTextExpression(left) || isTextExpression(right))) {
        return `yc_text_concat(${left}, ${right})`
      }

      // 普通算术
      if (expr.operator === '÷') {
        return `((double)(${left}) / (double)(${right}))`
      }

      return `(${left} ${expr.operator} ${right})`
    }

    case 'unop': {
      const operand = emitExpr(expr.operand, ctx)
      if (expr.operator === '!') return `(!(${operand}))`
      if (expr.operator === '-') return `(-${operand})`
      return operand
    }

    case 'cast': {
      const inner = emitExpr(expr.inner, ctx)
      if (expr.toType === 'double') return `(double)(${inner})`
      return `yc_value_to_big(${inner})`
    }

    case 'placeholder': {
      return `${REAL_DIV_MARK}${emitExpr(expr.inner, ctx)}`
    }

    default: {
      const _exhaustive: never = expr
      throw new Error(`未处理的 AST 节点类型: ${typeof _exhaustive}`)
    }
  }
}

// -- 辅助类型判断函数 --

function isBigExpression(cExpr: string): boolean {
  return cExpr.startsWith('YC_BIG(') || cExpr.startsWith('yc_value_to_big(')
}

function isBigRawOperand(raw: Expr, variableTypeResolver?: (name: string) => string | undefined): boolean {
  if (raw.kind !== 'var' && raw.kind !== 'call' && raw.kind !== 'binop') return false
  // 简化实现：实际需要检查变量类型
  return false
}

function isTextExpression(cExpr: string): boolean {
  return cExpr.startsWith('L"') || cExpr === 'YC_TEXT()'
}

function isTextRawOperand(raw: Expr, variableTypeResolver?: (name: string) => string | undefined): boolean {
  if (raw.kind === 'text') return true
  if (raw.kind === 'var' && variableTypeResolver) {
    const type = variableTypeResolver(raw.name)
    return type === '文本型' || type === '文本'
  }
  return false
}

// -- 辅助函数 --

function parseCommandCall(line: string): { name: string; args: string[] } | null {
  const trimmed = line.trim()
  let openIdx = -1
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '(' || ch === '（') {
      openIdx = i
      break
    }
  }

  if (openIdx < 0) {
    return { name: trimmed, args: [] }
  }

  const name = trimmed.substring(0, openIdx).trim()
  if (!name) return null

  let depth = 1
  let closeIdx = -1
  for (let i = openIdx + 1; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '(' || ch === '（') depth++
    else if (ch === ')' || ch === '）') {
      depth--
      if (depth === 0) { closeIdx = i; break }
    }
  }

  if (closeIdx < 0) return null

  const trailing = trimmed.substring(closeIdx + 1).trim()
  if (trailing) return null

  const argsStr = trimmed.substring(openIdx + 1, closeIdx)
  const args = splitArguments(argsStr)
  return { name, args }
}

function splitArguments(argsStr: string): string[] {
  const args: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i]
    if (inString) {
      if ((stringChar === '"' && ch === '"') || (stringChar === '“' && ch === '”')) {
        inString = false
      }
      current += ch
      continue
    }
    if (ch === '"' || ch === '“') {
      inString = true
      stringChar = ch
      current += ch
      continue
    }
    if (ch === '(' || ch === '（') {
      depth++
      current += ch
      continue
    }
    if (ch === ')' || ch === '）') {
      depth--
      current += ch
      continue
    }
    if (ch === ',' && depth === 0) {
      args.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }

  if (current.trim()) {
    args.push(current.trim())
  }

  return args
}

function normalizeBuiltinCallName(name: string): string {
  return name.trim()
}
