// 易语言表达式 AST 节点类型定义
//
// 这些类型构成了 AST 的结构，每个节点都有明确的 kind 标签用于模式匹配。
// 设计原则：
// 1. 所有节点必须是 Immutable（不可变），确保树遍历安全
// 2. 用联合类型（Union Type）实现结构子类型
// 3. 构造器函数强制类型检查

// 前置类型（从 compiler.ts 导入）
import type { VariableTypeResolver, ResolvedCommand, DirectCallableNames } from '../compiler'

export type TranspileContext = {
  commandMap?: Map<string, ResolvedCommand>
  directCallables?: DirectCallableNames
  variableTypeResolver?: VariableTypeResolver
  preferBigIntLiteral?: boolean
}

export type EycSourceLocation = { fileName: string; lineNo: number }

/** 顶层表达式树节点 */
export type Expr =
  | NumberLiteral
  | TextLiteral
  | BooleanLiteral
  | ColorLiteral
  | VariableRef
  | ConstantRef
  | ControlPropertyRead
  | ArrayIndexRef
  | ArrayLiteral
  | CommandCall
  | BinaryOp
  | UnaryOp
  | CastExpr
  | Placeholder

/** 基础字面量接口 */
export interface LiteralBase { kind: string }

// -- 字面量节点 --
export interface NumberLiteral extends LiteralBase {
  kind: 'number'
  value: bigint
  isFloat: boolean
  rawText: string
}

export interface TextLiteral extends LiteralBase {
  kind: 'text'
  value: string
}

export interface BooleanLiteral extends LiteralBase {
  kind: 'bool'
  value: boolean
}

export interface ColorLiteral extends LiteralBase {
  kind: 'color'
  r: Expr
  g: Expr
  b: Expr
}

// -- 引用节点 --
export interface VariableRef extends LiteralBase {
  kind: 'var'
  name: string
}

export interface ConstantRef extends LiteralBase {
  kind: 'const'
  name: string
}

export interface ControlPropertyRead extends LiteralBase {
  kind: 'ctrlProp'
  objectName: string
  propertyName: string
}

// -- 集合节点 --
export interface ArrayIndexRef extends LiteralBase {
  kind: 'arrayIdx'
  arrayName: string
  indexExprs: Expr[]
}

export interface ArrayLiteral extends LiteralBase {
  kind: 'arrayLit'
  elementExprs: Expr[]
  isFloat: boolean
  isText: boolean
  isBinary: boolean
}

// -- 操作节点 --
export interface CommandCall extends LiteralBase {
  kind: 'call'
  name: string
  args: Expr[]
}

export interface BinaryOp extends LiteralBase {
  kind: 'binop'
  operator: string
  left: Expr
  right: Expr
  isApproxEqual?: boolean // ≈ 特殊处理
}

export interface UnaryOp extends LiteralBase {
  kind: 'unop'
  operator: '+' | '-' | '!'
  operand: Expr
}

export interface CastExpr extends LiteralBase {
  kind: 'cast'
  inner: Expr
  toType: 'double' | 'big'
}

export interface Placeholder extends LiteralBase {
  kind: 'placeholder'
  inner: Expr
  reason: string // 例如 'realDivPending'
}

// -- 类型别名（从 compiler.ts 重新导出，供 parser 使用） --
// 注意：这里已经在上文 import 了，只是导出
export type { VariableTypeResolver, ResolvedCommand, DirectCallableNames } from '../compiler'

// -- 构造器函数 --

export function numberLiteral(value: bigint, isFloat: boolean, rawText: string): NumberLiteral {
  return { kind: 'number', value, isFloat, rawText }
}

export function textLiteral(value: string): TextLiteral {
  return { kind: 'text', value }
}

export function boolLiteral(value: boolean): BooleanLiteral {
  return { kind: 'bool', value }
}

export function colorLiteral(r: Expr, g: Expr, b: Expr): ColorLiteral {
  return { kind: 'color', r, g, b }
}

export function varRef(name: string): VariableRef {
  return { kind: 'var', name }
}

export function constRef(name: string): ConstantRef {
  return { kind: 'const', name }
}

export function ctrlPropRead(objectName: string, propertyName: string): ControlPropertyRead {
  return { kind: 'ctrlProp', objectName, propertyName }
}

export function arrayIdx(arrayName: string, indexExprs: Expr[]): ArrayIndexRef {
  return { kind: 'arrayIdx', arrayName, indexExprs }
}

export function arrayLit(elementExprs: Expr[], isFloat: boolean, isText: boolean, isBinary: boolean): ArrayLiteral {
  return { kind: 'arrayLit', elementExprs, isFloat, isText, isBinary }
}

export function commandCall(name: string, args: Expr[]): CommandCall {
  return { kind: 'call', name, args }
}

export function binaryOp(operator: string, left: Expr, right: Expr): BinaryOp {
  return { kind: 'binop', operator, left, right }
}

export function unaryOp(operator: '+' | '-' | '!', operand: Expr): UnaryOp {
  return { kind: 'unop', operator, operand }
}

export function castExpr(inner: Expr, toType: 'double' | 'big'): CastExpr {
  return { kind: 'cast', inner, toType }
}

export function placeholder(inner: Expr, reason: string): Placeholder {
  return { kind: 'placeholder', inner, reason }
}

// -- 模式匹配工具 --

export function isExpr(node: unknown): node is Expr {
  if (typeof node !== 'object' || node === null) return false
  const e = node as Record<string, unknown>
  return typeof e.kind === 'string'
}

export function isNumber(n: Expr): n is NumberLiteral { return n.kind === 'number' }
export function isText(t: Expr): t is TextLiteral { return t.kind === 'text' }
export function isBool(b: Expr): b is BooleanLiteral { return b.kind === 'bool' }
export function isVar(v: Expr): v is VariableRef { return v.kind === 'var' }
export function isCall(c: Expr): c is CommandCall { return c.kind === 'call' }
export function isBinOp(b: Expr): b is BinaryOp { return b.kind === 'binop' }
export function isUnary(u: Expr): u is UnaryOp { return u.kind === 'unop' }
export function isArrayLit(a: Expr): a is ArrayLiteral { return a.kind === 'arrayLit' }
export function isPlaceholder(p: Expr): p is Placeholder { return p.kind === 'placeholder' }
