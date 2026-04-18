import { useCallback } from 'react'
import { parseLines } from './eycBlocks'
import { extractFlowKw, FLOW_BRANCH_KW, FLOW_END_KW, getFlowStructureAround } from './eycFlow'

export type CodeLineNavigationAction =
  | { type: 'upOrDown'; targetLine: number; keepHorizontalPos: number }
  | { type: 'leftToPrevLineEnd'; targetLine: number }
  | { type: 'rightToNextLineStart'; targetLine: number }
  | null

export type ParenScopedKeyAction =
  | { type: 'insertBlankLine'; insertAbove: boolean }
  | { type: 'jumpToNextLine' }
  | null

export type EmptyCodeLineDeleteAction =
  | { type: 'forbidden' }
  | { type: 'delete'; preferPrevLine: boolean; targetLine: number }

export type MarkerEndEnterAction = 'insertBodyAbove' | 'shiftMarkerDown'

function normalizeFlowCommandName(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  return trimmed.startsWith('.') ? trimmed : trimmed.split(/[\s(（]/)[0]
}

function hasOuterParenRange(text: string): boolean {
  const openIdx = text.search(/[(（]/)
  if (openIdx < 0) return false
  let depth = 0
  let inStr = false
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (ch === '"' || ch === '\u201d') inStr = false
      continue
    }
    if (ch === '"' || ch === '\u201c') {
      inStr = true
      continue
    }
    if (ch === '(' || ch === '（') depth++
    else if (ch === ')' || ch === '）') {
      depth--
      if (depth === 0) return true
    }
  }
  return false
}

export function useCodeLineEditor() {
  const getFlowAutoExpandCommand = useCallback((input: string): { trimmed: string; commandName: string } | null => {
    const trimmed = input.trim()
    if (!trimmed) return null
    return {
      trimmed,
      commandName: normalizeFlowCommandName(trimmed),
    }
  }, [])

  const getFlowAutoExpandCandidate = useCallback((params: {
    editValue: string
    trailingText: string
  }): { trimmed: string; commandName: string } | null => {
    const { editValue, trailingText } = params
    if (trailingText.trim() !== '') return null
    return getFlowAutoExpandCommand(editValue)
  }, [getFlowAutoExpandCommand])

  const getFirstDeclarationLine = useCallback((lines: string[]): number => {
    const parsed = parseLines(lines.join('\n'))
    for (let i = 0; i < parsed.length; i++) {
      const type = parsed[i].type
      if (type !== 'blank' && type !== 'comment' && type !== 'code' && type !== 'version' && type !== 'supportLib') {
        return i
      }
    }
    return -1
  }, [])

  const isStructuralFlowEndLine = useCallback((lines: string[], lineIndex: number): boolean => {
    const structure = getFlowStructureAround(lines, lineIndex)
    if (!structure) return false
    const lastSection = [...structure.sections].reverse().find(s => s.char !== null)
    return !!lastSection && lastSection.endLine === lineIndex
  }, [])

  const isIfTrueMarkerEndContext = useCallback((params: {
    lines: string[]
    lineIndex: number
    markerChar: string
    markerIndent: string
  }): boolean => {
    const { lines, lineIndex, markerChar, markerIndent } = params
    if (markerChar !== '\u200D') return false
    const markerIndentLen = markerIndent.length
    for (let i = lineIndex - 1; i >= 0; i--) {
      const line = lines[i]
      const lineIndent = line.length - line.replace(/^ +/, '').length
      if (lineIndent !== markerIndentLen) continue
      const kw = extractFlowKw(line)
      if (!kw) continue
      if (kw === '如果真' || kw === '如果') return kw === '如果真'
      if (FLOW_END_KW.has(kw) || FLOW_BRANCH_KW.has(kw)) continue
      break
    }
    return false
  }, [])

  const getCodeLineNavigationAction = useCallback((params: {
    key: string
    lineIndex: number
    cursorPos: number
    currentValueLength: number
  }): CodeLineNavigationAction => {
    const { key, lineIndex, cursorPos, currentValueLength } = params

    if (key === 'ArrowUp' || key === 'ArrowDown') {
      return {
        type: 'upOrDown',
        targetLine: key === 'ArrowUp' ? lineIndex - 1 : lineIndex + 1,
        keepHorizontalPos: cursorPos,
      }
    }

    if (key === 'ArrowLeft' && cursorPos === 0 && lineIndex > 0) {
      return {
        type: 'leftToPrevLineEnd',
        targetLine: lineIndex - 1,
      }
    }

    if (key === 'ArrowRight' && cursorPos >= currentValueLength) {
      return {
        type: 'rightToNextLineStart',
        targetLine: lineIndex + 1,
      }
    }

    return null
  }, [])

  const getParenScopedKeyAction = useCallback((params: {
    key: string
    editValue: string
    cursorPos: number
  }): ParenScopedKeyAction => {
    const { key, editValue, cursorPos } = params
    if (!hasOuterParenRange(editValue)) return null

    if (key === 'Enter') {
      return {
        type: 'insertBlankLine',
        insertAbove: cursorPos === 0,
      }
    }

    if (key === 'Tab') {
      return { type: 'jumpToNextLine' }
    }

    return null
  }, [])

  const getEmptyCodeLineDeleteAction = useCallback((params: {
    lines: string[]
    lineIndex: number
    key: 'Backspace' | 'Delete'
  }): EmptyCodeLineDeleteAction => {
    const { lines, lineIndex, key } = params
    const firstDeclLine = getFirstDeclarationLine(lines)
    if (lineIndex === firstDeclLine) return { type: 'forbidden' }
    if (isStructuralFlowEndLine(lines, lineIndex)) return { type: 'forbidden' }

    const preferPrevLine = key === 'Backspace'
    return {
      type: 'delete',
      preferPrevLine,
      targetLine: preferPrevLine ? lineIndex - 1 : lineIndex,
    }
  }, [getFirstDeclarationLine, isStructuralFlowEndLine])

  const getMarkerEndEnterAction = useCallback((params: {
    belongsToIfTrue: boolean
    beforeText: string
    afterText: string
  }): MarkerEndEnterAction => {
    const { belongsToIfTrue, beforeText, afterText } = params
    if (belongsToIfTrue && beforeText.trim() === '' && afterText.trim() === '') {
      return 'insertBodyAbove'
    }
    return 'shiftMarkerDown'
  }, [])

  return {
    getFlowAutoExpandCandidate,
    getFlowAutoExpandCommand,
    getFirstDeclarationLine,
    getCodeLineNavigationAction,
    getEmptyCodeLineDeleteAction,
    getMarkerEndEnterAction,
    getParenScopedKeyAction,
    isIfTrueMarkerEndContext,
    isStructuralFlowEndLine,
  }
}
