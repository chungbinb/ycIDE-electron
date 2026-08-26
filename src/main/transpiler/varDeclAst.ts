// 易语言变量声明 AST —— .局部变量 / .全局变量 / .参数 / .程序集变量
//
// 本模块定义变量声明的 AST 节点类型和解析器。
// 注意：发射（emit）仍由 compiler.ts 的 transpileEycContent 负责，
// 这里只提供类型化表示，便于后续进行作用域分析、类型检查等。

import type { TranspileContext } from './ast'

// -- 数组维度信息 --
export interface ArrayDims {
  dims: number[]
  isArray: boolean
  invalid?: string
}

// -- 变量声明节点类型 --
export type EycVarDecl =
  | LocalVarDecl
  | GlobalVarDecl
  | ParamDecl
  | AssemblyVarDecl

export interface BaseVarDecl {
  kind: string
  lineNo: number
  name: string
  type: string
  isArray: boolean
  dims?: number[]
}

export interface LocalVarDecl extends BaseVarDecl {
  kind: 'localVar'
  isStatic?: boolean
}
export interface GlobalVarDecl extends BaseVarDecl {
  kind: 'globalVar'
}
export interface ParamDecl extends BaseVarDecl {
  kind: 'param'
  isByRef?: boolean
}
export interface AssemblyVarDecl extends BaseVarDecl {
  kind: 'assemblyVar'
  isPublic?: boolean
}

// -- 构造器 --
export function localVarDecl(
  name: string,
  type: string,
  lineNo: number,
  isArray: boolean,
  dims?: number[],
  isStatic?: boolean,
): LocalVarDecl {
  return { kind: 'localVar', name, type, lineNo, isArray, dims, isStatic }
}
export function globalVarDecl(name: string, type: string, lineNo: number, isArray: boolean, dims?: number[]): GlobalVarDecl {
  return { kind: 'globalVar', name, type, lineNo, isArray, dims }
}
export function paramDecl(name: string, type: string, lineNo: number, isArray: boolean, isByRef?: boolean): ParamDecl {
  return { kind: 'param', name, type, lineNo, isArray, isByRef }
}
export function assemblyVarDecl(name: string, type: string, lineNo: number, isArray: boolean, dims?: number[], isPublic?: boolean): AssemblyVarDecl {
  return { kind: 'assemblyVar', name, type, lineNo, isArray, dims, isPublic }
}

// -- 解析器 --

/**
 * 解析 .局部变量 行
 * 格式：.局部变量 名字, 类型, [公开], [数组(尺寸)]
 */
export function parseLocalVarDecl(line: string, lineNo: number, context?: TranspileContext): LocalVarDecl | null {
  if (!line.startsWith('.局部变量 ')) return null
  const rest = line.substring(6).trim()
  const parts = splitDeclPartsQuoted(rest)
  const name = (parts[0] || 'v').trim()
  const type = (parts[1] || '整数型').trim()
  const isStatic = parts.slice(2).includes('静态')
  const dimsField = parts[3] || ''
  const dims = parseArrayDimsField(dimsField)
  return localVarDecl(name, type, lineNo, dims.isArray, dims.dims, isStatic)
}

/**
 * 解析 .全局变量 行
 * 格式：.全局变量 名字, 类型
 */
export function parseGlobalVarDecl(line: string, lineNo: number, context?: TranspileContext): GlobalVarDecl | null {
  if (!line.startsWith('.全局变量 ')) return null
  const rest = line.substring(6).trim()
  const parts = splitDeclParts(rest)
  const name = (parts[0] || 'g').trim()
  const type = (parts[1] || '整数型').trim()
  return globalVarDecl(name, type, lineNo, false)
}

/**
 * 解析 .参数 行
 * 格式：.参数 名字, 类型, [公开], [数组], [传址]
 */
export function parseParamDecl(line: string, lineNo: number, context?: TranspileContext): ParamDecl | null {
  if (!line.startsWith('.参数 ')) return null
  const rest = line.substring(4).trim()
  const parts = splitDeclPartsQuoted(rest)
  const name = (parts[0] || '').trim()
  if (!name) return null
  const type = (parts[1] || '整数型').trim()
  const flags = parts.slice(2)
  const isArray = flags.includes('数组')
  const isByRef = flags.includes('传址')
  return paramDecl(name, type, lineNo, isArray, isByRef)
}

/**
 * 解析 .程序集变量 行
 * 格式：.程序集变量 名字, 类型, [公开], [数组(尺寸)]
 */
export function parseAssemblyVarDecl(line: string, lineNo: number, context?: TranspileContext): AssemblyVarDecl | null {
  if (!line.startsWith('.程序集变量 ')) return null
  const rest = line.substring(7).trim()
  const parts = splitDeclPartsQuoted(rest)
  const name = (parts[0] || 'assemblyVar').trim()
  const type = (parts[1] || '整数型').trim()
  const isPublic = parts.slice(2).includes('公开')
  const dimsField = parts[3] || ''
  const dims = parseArrayDimsField(dimsField)
  return assemblyVarDecl(name, type, lineNo, dims.isArray, dims.dims, isPublic)
}

/**
 * 通用解析入口：根据行首关键字分派到对应解析器
 */
export function parseVarDeclFromLine(line: string, lineNo: number, context?: TranspileContext): EycVarDecl | null {
  if (line.startsWith('.局部变量 ')) return parseLocalVarDecl(line, lineNo, context)
  if (line.startsWith('.全局变量 ')) return parseGlobalVarDecl(line, lineNo, context)
  if (line.startsWith('.参数 ')) return parseParamDecl(line, lineNo, context)
  if (line.startsWith('.程序集变量 ')) return parseAssemblyVarDecl(line, lineNo, context)
  return null
}

// -- 辅助函数（从 compiler.ts 移植）--

/**
 * 解析声明行的字段（处理引号内的逗号）
 */
function splitDeclPartsQuoted(text: string): string[] {
  const parts: string[] = []
  let current = ''
  let inQuote = false
  let quoteChar = ''

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuote) {
      if (ch === quoteChar) inQuote = false
      current += ch
      continue
    }
    if (ch === '"' || ch === '“') {
      inQuote = true
      quoteChar = ch
      current += ch
      continue
    }
    if (ch === ',') {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function splitDeclParts(text: string): string[] {
  return text.split(',').map(s => s.trim())
}

/**
 * 解析数组维度字段
 * 格式："601" 或 "3,4" 或 ""（非数组）
 */
export function parseArrayDimsField(field: string | undefined): ArrayDims {
  if (!field || field.trim() === '') {
    return { dims: [], isArray: false }
  }
  const dims: number[] = []
  for (const dim of field.split(',')) {
    const n = parseInt(dim.trim(), 10)
    if (isNaN(n) || n < 1) {
      return { dims: [], isArray: false, invalid: `无效的数组维度：${dim.trim()}` }
    }
    dims.push(n)
  }
  return { dims, isArray: true }
}
