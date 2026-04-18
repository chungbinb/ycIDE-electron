import {
  FLOW_AUTO_TAG,
  FLOW_ELSE_MARK,
  FLOW_JUDGE_END_MARK,
  FLOW_TRUE_MARK,
  extractFlowKw,
} from './eycFlow'

const FLOW_MARKER_CHARS = ['\u200C', '\u200D', '\u2060']

export function trimTrailingEmptyFormattedLine(lines: string[]): string[] {
  if (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    return lines.slice(0, -1)
  }
  return lines
}

export function collectRemainingLinesInCurrentScope(lines: string[], startIndex: number): string[] {
  const remainingLines: string[] = []
  for (let ri = startIndex; ri < lines.length; ri++) {
    const rl = lines[ri].replace(/[\r\t]/g, '').trim()
    if (rl.startsWith('.子程序 ') || rl.startsWith('.程序集 ')) break
    remainingLines.push(lines[ri])
  }
  return remainingLines
}

export function buildLoopFlowBodyLines(mainLine: string, extraLines: string[]): {
  bodyIndent: string
  lines: string[]
} {
  const mainIndent = mainLine.length - mainLine.trimStart().length
  const bodyIndent = ' '.repeat(mainIndent + 4)
  return {
    bodyIndent,
    lines: [mainLine, bodyIndent, ...extraLines],
  }
}

export function applyMainAndExtraLines(params: {
  lines: string[]
  lineIndex: number
  isVirtual: boolean
  mainLine: string
  extraLines: string[]
}): void {
  const { lines, lineIndex, isVirtual, mainLine, extraLines } = params
  if (isVirtual) {
    lines.splice(lineIndex + 1, 0, mainLine, ...extraLines)
  } else {
    lines.splice(lineIndex, 1, mainLine, ...extraLines)
  }
}

export function getAutoExpandCursorBaseLine(lineIndex: number, isVirtual: boolean): number {
  return isVirtual ? lineIndex + 1 : lineIndex
}

export function applyFlowMarkerSection(params: {
  lines: string[]
  lineIndex: number
  formattedLines: string[]
  flowMark: string
}): number {
  const { lines, lineIndex, formattedLines, flowMark } = params
  lines.splice(lineIndex, 1, ...formattedLines)
  const insertPos = lineIndex + formattedLines.length
  lines.splice(insertPos, 0, flowMark)
  return lineIndex + 1
}

export function parseFlowMarkerTargetLine(targetLine: string): {
  hasMarker: boolean
  flowMark: string
  editValue: string
} {
  const strippedTarget = targetLine.replace(/^ +/, '')
  const markerChar = strippedTarget.charAt(0)
  if (FLOW_MARKER_CHARS.includes(markerChar)) {
    return {
      hasMarker: true,
      flowMark: targetLine.slice(0, targetLine.length - strippedTarget.length + 1),
      editValue: strippedTarget.slice(1),
    }
  }
  return {
    hasMarker: false,
    flowMark: '',
    editValue: targetLine,
  }
}

export function removeDuplicateFlowAutoEndings(extraLines: string[], remainingLines: string[]): string[] {
  const kwLines = extraLines.filter(el => {
    const t = el.trim()
    return el.includes(FLOW_AUTO_TAG) || t === FLOW_TRUE_MARK || t === FLOW_ELSE_MARK || t === FLOW_JUDGE_END_MARK
  })
  if (kwLines.length === 0) return extraLines

  const firstRemainingKw = remainingLines.length > 0 ? extractFlowKw(remainingLines[0]) : null
  const firstKwT = kwLines[0].trim()
  const firstExpectedKw = (firstKwT === FLOW_TRUE_MARK || firstKwT === FLOW_ELSE_MARK || firstKwT === FLOW_JUDGE_END_MARK)
    ? firstKwT
    : kwLines[0].replace(FLOW_AUTO_TAG, '').trim().split(/[\s(（]/)[0]

  if (firstRemainingKw !== firstExpectedKw) return extraLines

  const hasAllEndings = kwLines.every(el => {
    const t = el.trim()
    const kw = (t === FLOW_TRUE_MARK || t === FLOW_ELSE_MARK || t === FLOW_JUDGE_END_MARK)
      ? t
      : el.replace(FLOW_AUTO_TAG, '').trim().split(/[\s(（]/)[0]
    return remainingLines.some(rl => extractFlowKw(rl) === kw)
  })

  return hasAllEndings ? [] : extraLines
}
