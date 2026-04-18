import { parseLines } from './eycBlocks'

export function findInsertAtForPastedSubs(lines: string[], cursorLine: number): number {
  if (cursorLine < 0 || cursorLine >= lines.length) return lines.length

  const parsed = parseLines(lines.join('\n'))
  let ownerSubLine = -1
  for (let i = Math.min(cursorLine, parsed.length - 1); i >= 0; i--) {
    if (parsed[i].type === 'sub') {
      ownerSubLine = i
      break
    }
  }

  if (ownerSubLine < 0) return lines.length

  for (let i = ownerSubLine + 1; i < parsed.length; i++) {
    if (parsed[i].type === 'sub') return i
  }

  return lines.length
}

export interface MultiLinePasteResult {
  nextText: string
  insertAt: number
  pastedLineCount: number
}

export function buildMultiLinePasteResult(params: {
  currentText: string
  clipText: string
  cursorLine: number
  sanitizePastedText: (clipText: string, currentText: string) => string
}): MultiLinePasteResult | null {
  const { currentText, clipText, cursorLine, sanitizePastedText } = params
  if (!clipText) return null

  const pastedLines = sanitizePastedText(clipText, currentText)
    .split('\n')
    .map(l => l.replace(/\r$/, ''))
  if (pastedLines.length === 0) return null

  const lines = currentText.split('\n')
  const pastedHasSub = parseLines(pastedLines.join('\n')).some(ln => ln.type === 'sub')

  let insertAt = lines.length
  if (pastedHasSub) {
    insertAt = findInsertAtForPastedSubs(lines, cursorLine)
  } else if (cursorLine >= 0) {
    insertAt = Math.min(cursorLine + 1, lines.length)
  }

  const nextLines = [...lines]
  nextLines.splice(insertAt, 0, ...pastedLines)

  return {
    nextText: nextLines.join('\n'),
    insertAt,
    pastedLineCount: pastedLines.length,
  }
}
