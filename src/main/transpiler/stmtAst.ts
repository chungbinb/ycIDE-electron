// 易语言语句级 AST —— 流程控制语句的类型化表示 + 发射器
//
// 本模块只覆盖"块结构/语句级流程命令"这一层（if/判断/循环/返回/break/continue 等）。
// 赋值、命令调用、变量声明仍走 compiler.ts 原有的字符串发射路径（后续阶段再 AST 化）。
//
// 价值：把 flowStack 的隐式状态机变成显式的 AST 节点树，后续加入调试符号追踪、
// 控制流分析、AI 辅助重构时可以直接在树上操作而不用靠堆栈猜测。

import type { Expr } from './ast'
import type { TranspileContext } from './ast'
import type { ResolvedCommand, DirectCallableNames, VariableTypeResolver } from '../compiler'
import { exprToC, parseExpr } from './parser'

// -- 语句节点类型 --

export type EycStmt =
  | IfStmt
  | ElseIfStmt
  | ElseStmt
  | EndIfStmt
  | CountLoopStart
  | CountLoopEnd
  | JudgeLoopStart
  | JudgeLoopEnd
  | DoLoopStart
  | DoLoopEnd
  | ForLoopStart
  | ForLoopEnd
  | ContinueStmt
  | BreakStmt
  | ReturnStmt
  | EndStmt
  | CommentStmt
  | RawLineStmt

export interface BaseStmt { kind: string; lineNo: number }

export interface IfStmt extends BaseStmt {
  kind: 'if'
  cond: Expr
}
export interface ElseIfStmt extends BaseStmt {
  kind: 'elseif'
  cond: Expr
}
export interface ElseStmt extends BaseStmt {
  kind: 'else'
}
export interface EndIfStmt extends BaseStmt {
  kind: 'endif'
}
export interface CountLoopStart extends BaseStmt {
  kind: 'countLoopStart'
  countExpr: Expr
  loopVar: string
}
export interface CountLoopEnd extends BaseStmt {
  kind: 'countLoopEnd'
}
export interface JudgeLoopStart extends BaseStmt {
  kind: 'judgeLoopStart'
  cond: Expr
}
export interface JudgeLoopEnd extends BaseStmt {
  kind: 'judgeLoopEnd'
}
export interface DoLoopStart extends BaseStmt {
  kind: 'doLoopStart'
}
export interface DoLoopEnd extends BaseStmt {
  kind: 'doLoopEnd'
  cond: Expr
}
export interface ForLoopStart extends BaseStmt {
  kind: 'forLoopStart'
  startExpr: Expr
  endExpr: Expr
  stepExpr: Expr
  loopVar: string
}
export interface ForLoopEnd extends BaseStmt {
  kind: 'forLoopEnd'
}
export interface ContinueStmt extends BaseStmt {
  kind: 'continue'
}
export interface BreakStmt extends BaseStmt {
  kind: 'break'
}
export interface ReturnStmt extends BaseStmt {
  kind: 'return'
  arg?: Expr
}
export interface EndStmt extends BaseStmt {
  kind: 'end'
}
export interface CommentStmt extends BaseStmt {
  kind: 'comment'
  text: string
}
export interface RawLineStmt extends BaseStmt {
  kind: 'raw'
  line: string
}

// -- 构造器 --

export function ifStmt(cond: Expr, lineNo: number): IfStmt { return { kind: 'if', cond, lineNo } }
export function elseifStmt(cond: Expr, lineNo: number): ElseIfStmt { return { kind: 'elseif', cond, lineNo } }
export function elseStmt(lineNo: number): ElseStmt { return { kind: 'else', lineNo } }
export function endifStmt(lineNo: number): EndIfStmt { return { kind: 'endif', lineNo } }
export function countLoopStart(countExpr: Expr, loopVar: string, lineNo: number): CountLoopStart { return { kind: 'countLoopStart', countExpr, loopVar, lineNo } }
export function countLoopEnd(lineNo: number): CountLoopEnd { return { kind: 'countLoopEnd', lineNo } }
export function judgeLoopStart(cond: Expr, lineNo: number): JudgeLoopStart { return { kind: 'judgeLoopStart', cond, lineNo } }
export function judgeLoopEnd(lineNo: number): JudgeLoopEnd { return { kind: 'judgeLoopEnd', lineNo } }
export function doLoopStart(lineNo: number): DoLoopStart { return { kind: 'doLoopStart', lineNo } }
export function doLoopEnd(cond: Expr, lineNo: number): DoLoopEnd { return { kind: 'doLoopEnd', cond, lineNo } }
export function forLoopStart(startExpr: Expr, endExpr: Expr, stepExpr: Expr, loopVar: string, lineNo: number): ForLoopStart { return { kind: 'forLoopStart', startExpr, endExpr, stepExpr, loopVar, lineNo } }
export function forLoopEnd(lineNo: number): ForLoopEnd { return { kind: 'forLoopEnd', lineNo } }
export function continueStmt(lineNo: number): ContinueStmt { return { kind: 'continue', lineNo } }
export function breakStmt(lineNo: number): BreakStmt { return { kind: 'break', lineNo } }
export function returnStmt(lineNo: number, arg?: Expr): ReturnStmt { return { kind: 'return', arg, lineNo } }
export function endStmt(lineNo: number): EndStmt { return { kind: 'end', lineNo } }
export function commentStmt(text: string, lineNo: number): CommentStmt { return { kind: 'comment', text, lineNo } }
export function rawLineStmt(line: string, lineNo: number): RawLineStmt { return { kind: 'raw', line, lineNo } }

// -- 发射器 --

/**
 * 把一条语句节点发射成 C++ 代码行。
 * 返回 null 表示"此节点不产生代码"（如纯结构标记已在别处处理）。
 */
export function emitStmt(
  stmt: EycStmt,
  ctx: TranspileContext,
  wrapConditionForC: (c: string) => string,
  indent: number,
): string | null {
  const pad = '    '.repeat(Math.max(1, indent))
  switch (stmt.kind) {
    case 'if': {
      const cond = exprToC(stmt.cond, ctx)
      return `${pad}if ${wrapConditionForC(cond)} {`
    }
    case 'elseif': {
      const cond = exprToC(stmt.cond, ctx)
      return `${pad}} else if ${wrapConditionForC(cond)} {`
    }
    case 'else':
      return `${pad}} else {`
    case 'endif':
      return `${pad}}`
    case 'countLoopStart': {
      const count = exprToC(stmt.countExpr, ctx)
      return `${pad}for (int64_t ${stmt.loopVar} = 1; ${stmt.loopVar} <= (${count}); ${stmt.loopVar}++) {`
    }
    case 'countLoopEnd':
      return `${pad}}`
    case 'judgeLoopStart': {
      const cond = exprToC(stmt.cond, ctx)
      return `${pad}while ${wrapConditionForC(cond)} {`
    }
    case 'judgeLoopEnd':
      return `${pad}}`
    case 'doLoopStart':
      return `${pad}do {`
    case 'doLoopEnd': {
      const cond = exprToC(stmt.cond, ctx)
      return `${pad}} while ${wrapConditionForC(cond)};`
    }
    case 'forLoopStart': {
      const start = exprToC(stmt.startExpr, ctx)
      const end = exprToC(stmt.endExpr, ctx)
      const step = exprToC(stmt.stepExpr, ctx)
      const initExpr = stmt.loopVar ? `${stmt.loopVar} = (${start})` : `int64_t ${stmt.loopVar} = (${start})`
      return `${pad}for (${initExpr}; ((${step}) >= 0 ? ${stmt.loopVar} <= (${end}) : ${stmt.loopVar} >= (${end})); ${stmt.loopVar} += (${step})) {`
    }
    case 'forLoopEnd':
      return `${pad}}`
    case 'continue':
      return `${pad}continue;`
    case 'break':
      return `${pad}break;`
    case 'return': {
      if (stmt.arg !== undefined) {
        const arg = exprToC(stmt.arg, ctx)
        return `${pad}return ${arg};`
      }
      return `${pad}return;`
    }
    case 'end':
      return `${pad}ExitProcess(0);`
    case 'comment':
      return `${pad}// ${stmt.text}`
    case 'raw':
      return stmt.line
    default: {
      const _exhaustive: never = stmt
      throw new Error(`未处理的语句节点类型: ${typeof _exhaustive}`)
    }
  }
}

// -- 解析器（从易语言行 → AST） --
// 当前阶段：保留原有字符串路径不变，这里提供 AST 版本作为对照。
// 实际接入由 compiler.ts 的 transpileEycContent 控制。

export function parseStmtFromLine(
  line: string,
  lineNo: number,
  ctx: TranspileContext,
): EycStmt | null {
  // 注释
  if (line.startsWith("'")) {
    return commentStmt(line.slice(1).replace(/\\+\s*$/, '').trim(), lineNo)
  }

  // 流程控制
  const trimmed = line.startsWith('.') ? line.substring(1).trim() : line.trim()
  const call = parseSimpleCall(trimmed)
  if (!call) return null

  const name = call.name
  const args = call.args || []

  switch (name) {
    case '如果':
    case '如果真': {
      const condAst = parseExprForStmt(args[0] || '0', ctx)
      if (condAst && typeof condAst !== 'string') return ifStmt(condAst, lineNo)
      return rawLineStmt(line, lineNo)
    }
    case '判断': {
      const condAst = parseExprForStmt(args[0] || '0', ctx)
      if (condAst && typeof condAst !== 'string') return elseifStmt(condAst, lineNo)
      return rawLineStmt(line, lineNo)
    }
    case '否则':
    case '默认':
      return elseStmt(lineNo)
    case '如果结束':
    case '如果真结束':
    case '判断结束':
      return endifStmt(lineNo)
    case '计次循环首': {
      const countAst = parseExprForStmt(args[0] || '0', ctx)
      const userVar = (args[1] || '').trim()
      if (countAst && typeof countAst !== 'string') return countLoopStart(countAst, userVar || `__loop_${Date.now()}`, lineNo)
      return rawLineStmt(line, lineNo)
    }
    case '计次循环尾':
      return countLoopEnd(lineNo)
    case '判断循环首': {
      const condAst = parseExprForStmt(args[0] || '0', ctx)
      if (condAst && typeof condAst !== 'string') return judgeLoopStart(condAst, lineNo)
      return rawLineStmt(line, lineNo)
    }
    case '判断循环尾':
      return judgeLoopEnd(lineNo)
    case '循环判断首':
      return doLoopStart(lineNo)
    case '循环判断尾': {
      const condAst = parseExprForStmt(args[0] || '0', ctx)
      if (condAst && typeof condAst !== 'string') return doLoopEnd(condAst, lineNo)
      return rawLineStmt(line, lineNo)
    }
    case '变量循环首': {
      const startAst = parseExprForStmt(args[0] || '1', ctx)
      const endAst = parseExprForStmt(args[1] || '0', ctx)
      const stepAst = parseExprForStmt(args[2] || '1', ctx)
      const userVar = (args[3] || '').trim()
      if (startAst && endAst && stepAst &&
          typeof startAst === 'object' && typeof endAst === 'object' && typeof stepAst === 'object') {
        return forLoopStart(startAst as Expr, endAst as Expr, stepAst as Expr, userVar || `__for_${Date.now()}`, lineNo)
      }
      return rawLineStmt(line, lineNo)
    }
    case '变量循环尾':
      return forLoopEnd(lineNo)
    case '到循环尾':
      return continueStmt(lineNo)
    case '跳出循环':
      return breakStmt(lineNo)
    case '返回': {
      const retArg = (args[0] || '').trim()
      if (retArg) {
        const argAst = parseExprForStmt(retArg, ctx)
        if (argAst && typeof argAst !== 'string') return returnStmt(lineNo, argAst)
      }
      return returnStmt(lineNo)
    }
    case '结束':
      return endStmt(lineNo)
    default:
      return null
  }
}

function parseExprForStmt(raw: string, ctx: TranspileContext): Expr | string | null {
  try {
    const result = parseExpr(raw, ctx)
    return result
  } catch {
    return null
  }
}

function parseSimpleCall(line: string): { name: string; args: string[] } | null {
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
  const args = splitArgs(argsStr)
  return { name, args }
}

function splitArgs(s: string): string[] {
  const args: string[] = []
  let cur = ''
  let depth = 0
  let inStr = false
  let strCh = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if ((strCh === '"' && ch === '"') || (strCh === '“' && ch === '”')) inStr = false
      cur += ch
      continue
    }
    if (ch === '"' || ch === '“') { inStr = true; strCh = ch; cur += ch; continue }
    if (ch === '(' || ch === '（') { depth++; cur += ch; continue }
    if (ch === ')' || ch === '）') { depth--; cur += ch; continue }
    if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) args.push(cur.trim())
  return args
}
