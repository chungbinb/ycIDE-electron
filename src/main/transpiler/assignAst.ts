// 易语言赋值表达式 AST —— Phase 7：为赋值/命令调用建立 AST 基础设施
//
// 本模块定义赋值语句和命令调用的 AST 节点类型。
// 注意：当前 compiler.ts 中的赋值/命令派发逻辑保持原有字符串发射方式，
// 本模块提供类型化表示，便于后续逐步迁移。
//
// 设计原则：
// 1. 保留所有现有行为（通过契约测试守护）
// 2. 提供 AST 表示，便于后续分析和重构
// 3. 类型安全，所有分支受 TypeScript 守护

import type { Expr } from './ast'
import type { TranspileContext } from './ast'
import { parseExpr, exprToC } from './parser'

// -- 赋值目标类型 --
export type AssignTarget =
  | SimpleVarAssign  // 变量赋值：a = b
  | ControlPropAssign  // 控件属性赋值：按钮 1.标题 = "hello"
  | ArrayIndexAssign  // 数组下标赋值：数组 [i] = b
  | FontSubpropAssign  // 字体子属性赋值：标签.字体.字体大小 = 8

export interface BaseAssignTarget { kind: string; lineNo: number }

export interface SimpleVarAssign extends BaseAssignTarget {
  kind: 'simpleVar'
  varName: string
}
export interface ControlPropAssign extends BaseAssignTarget {
  kind: 'controlProp'
  controlName: string
  propName: string
}
export interface ArrayIndexAssign extends BaseAssignTarget {
  kind: 'arrayIndex'
  arrayName: string
  indexExprs: Expr[]
}
export interface FontSubpropAssign extends BaseAssignTarget {
  kind: 'fontSubprop'
  controlName: string
  subpropName: string  // '字体大小', '字体粗细' 等
}

// -- 赋值语句节点 --
export interface AssignStmt extends BaseAssignTarget {
  kind: 'assign'
  target: AssignTarget
  value: Expr
  isCommandCall?: boolean  // 右侧是否是命令调用
  commandName?: string  // 命令名称（如果是命令调用）
  commandArgs?: Expr[]  // 命令参数（如果是命令调用）
}

// -- 命令调用表达式节点（用于赋值右侧） --
export interface CommandCallExpr extends BaseAssignTarget {
  kind: 'commandCall'
  name: string
  args: Expr[]
  isYcmdNative?: boolean  // 是否是 ycmd 原生命令
  isAddressReturn?: boolean  // 是否返回地址（需要长整数型接收）
}

// -- 构造器 --
export function simpleVarAssign(varName: string, lineNo: number): SimpleVarAssign {
  return { kind: 'simpleVar', varName, lineNo }
}
export function controlPropAssign(controlName: string, propName: string, lineNo: number): ControlPropAssign {
  return { kind: 'controlProp', controlName, propName, lineNo }
}
export function arrayIndexAssign(arrayName: string, indexExprs: Expr[], lineNo: number): ArrayIndexAssign {
  return { kind: 'arrayIndex', arrayName, indexExprs, lineNo }
}
export function fontSubpropAssign(controlName: string, subpropName: string, lineNo: number): FontSubpropAssign {
  return { kind: 'fontSubprop', controlName, subpropName, lineNo }
}
export function assignStmt(target: AssignTarget, value: Expr, lineNo: number, isCommandCall?: boolean, commandName?: string, commandArgs?: Expr[]): AssignStmt {
  return { kind: 'assign', target, value, lineNo, isCommandCall, commandName, commandArgs }
}
export function commandCallExpr(name: string, args: Expr[], lineNo: number, isYcmdNative?: boolean, isAddressReturn?: boolean): CommandCallExpr {
  return { kind: 'commandCall', name, args, lineNo, isYcmdNative, isAddressReturn }
}

// -- 解析器 --

/**
 * 解析赋值语句行
 * 格式：左值 = 右值
 */
export function parseAssignStmt(line: string, lineNo: number, ctx?: TranspileContext): AssignStmt | null {
  // 匹配赋值表达式：支持全角/半角等号
  // 左值可以包含空格（如"按钮 1.标题"），使用 \S+ 匹配非空白字符序列
  const assignMatch = line.match(/^(\S+(?:\s+\S+)*)\s*[＝=]\s*(.+)$/)
  if (!assignMatch) return null

  const left = assignMatch[1].trim()
  const rightRaw = assignMatch[2].trim()

  // 解析右侧表达式
  const valueAst = parseExprForAssign(rightRaw, ctx)
  if (typeof valueAst === 'string') {
    // 未识别，返回 null 让上层处理
    return null
  }

  // 解析左侧目标
  const target = parseAssignTarget(left, lineNo)
  if (!target) return null

  return assignStmt(target, valueAst, lineNo)
}

/**
 * 解析赋值目标（左值）
 */
function parseAssignTarget(left: string, lineNo: number): AssignTarget | null {
  // 字体子属性赋值：控件.字体.子属性
  const fontMatch = left.match(/^([一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*)\.字体\.([一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*)$/)
  if (fontMatch) {
    return fontSubpropAssign(fontMatch[1], fontMatch[2], lineNo)
  }

  // 控件属性赋值：控件.属性
  const propMatch = left.match(/^([一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*)\.([一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*)$/)
  if (propMatch) {
    return controlPropAssign(propMatch[1], propMatch[2], lineNo)
  }

  // 数组下标赋值：数组 [i] 或 数组 [i] [j]
  const arrayMatch = left.match(/^([一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*)\[([^\]]+)\](.*)$/)
  if (arrayMatch) {
    // 简化：只处理一维数组
    const arrayName = arrayMatch[1]
    const indexExpr = arrayMatch[2].trim()
    const indexAst = parseExprForAssign(indexExpr, undefined)
    if (typeof indexAst === 'string') return null
    return arrayIndexAssign(arrayName, [indexAst], lineNo)
  }

  // 简单变量赋值
  if (/^[一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*$/.test(left)) {
    return simpleVarAssign(left, lineNo)
  }

  return null
}

/**
 * 解析表达式（用于赋值右侧）
 */
function parseExprForAssign(raw: string, ctx?: TranspileContext): Expr | string {
  try {
    const result = parseExpr(raw, ctx || {})
    return result
  } catch {
    return raw
  }
}

// -- 发射器 --

/**
 * 发射赋值语句为 C++ 代码
 * 注意：当前实现保持与原有逻辑一致，后续可逐步替换为真正的 AST 发射
 */
export function emitAssignStmt(stmt: AssignStmt, ctx?: TranspileContext): string {
  switch (stmt.target.kind) {
    case 'simpleVar':
      return `${stmt.target.varName} = ${emitExpr(stmt.value, ctx)};`
    case 'controlProp':
      // 简化：控件属性赋值暂不支持 AST 发射
      return `${stmt.target.controlName}.${stmt.target.propName} = ${emitExpr(stmt.value, ctx)};`
    case 'arrayIndex':
      return `yc_ary_at(${stmt.target.arrayName}, ${stmt.target.indexExprs.map(e => emitExpr(e, ctx)).join(', ')}) = ${emitExpr(stmt.value, ctx)};`
    case 'fontSubprop':
      // 简化：字体子属性赋值暂不支持 AST 发射
      return `// TODO: font subprop assign ${stmt.target.controlName}.${stmt.target.subpropName}`
    default: {
      const _exhaustive: never = stmt.target
      throw new Error(`未处理的赋值目标类型: ${typeof _exhaustive}`)
    }
  }
}

/**
 * 发射表达式为 C 字符串
 */
function emitExpr(expr: Expr, ctx?: TranspileContext): string {
  return exprToC(expr, ctx || {})
}
