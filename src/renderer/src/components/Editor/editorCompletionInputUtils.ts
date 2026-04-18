import { MEMBER_DELIMITERS } from './editorCoreUtils'

export function isCursorInsideQuotedText(value: string, cursorPos: number): boolean {
  let inAsciiQuote = false
  let inCnQuote = false
  for (let i = 0; i < cursorPos; i++) {
    const ch = value[i]
    if (inAsciiQuote) {
      if (ch === '"' && value[i - 1] !== '\\') inAsciiQuote = false
      continue
    }
    if (inCnQuote) {
      if (ch === '”') inCnQuote = false
      continue
    }
    if (ch === '"') inAsciiQuote = true
    else if (ch === '“') inCnQuote = true
  }
  return inAsciiQuote || inCnQuote
}

export function resolveCompletionWordContext(value: string, cursorPos: number): {
  wordStart: number
  word: string
  hashMode: boolean
  isMemberAccess: boolean
} {
  let wordStart = cursorPos
  while (wordStart > 0 && /[\u4e00-\u9fa5A-Za-z0-9_]/.test(value[wordStart - 1])) wordStart--
  const word = value.slice(wordStart, cursorPos)
  const hashMode = wordStart > 0 && value[wordStart - 1] === '#'
  const isMemberAccess = wordStart > 0 && MEMBER_DELIMITERS.has(value[wordStart - 1])
  return {
    wordStart,
    word,
    hashMode,
    isMemberAccess,
  }
}
