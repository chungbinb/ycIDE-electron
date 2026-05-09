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

export function buildEditorDiagnosticsProblems(
  request: Omit<EditorDiagnosticsRequest, 'id'>,
): EditorDiagnosticsProblem[] {
  const problems: EditorDiagnosticsProblem[] = []
  const parsedForDiagnostics = parseLines(request.text)
  const validCommandNames = new Set(request.validCommandNames)
  const allKnownVarNames = new Set(request.allKnownVarNames)
  const reservedNameSet = new Set(request.reservedNames)

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
