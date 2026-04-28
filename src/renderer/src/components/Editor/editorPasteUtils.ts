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

export function findInsertAtForPastedDlls(lines: string[]): number {
  const parsed = parseLines(lines.join('\n'))

  let hasDllSection = false
  let lastDllOwnedLine = -1
  let owner: 'dll' | 'other' | '' = ''
  for (let i = 0; i < parsed.length; i++) {
    const ln = parsed[i]
    if (ln.type === 'dll') {
      hasDllSection = true
      owner = 'dll'
      lastDllOwnedLine = i
      continue
    }

    // 声明头切换所有权；.参数 只有在紧随 .DLL命令 时才算 DLL 区内容。
    if (
      ln.type === 'assembly'
      || ln.type === 'assemblyVar'
      || ln.type === 'sub'
      || ln.type === 'localVar'
      || ln.type === 'globalVar'
      || ln.type === 'constant'
      || ln.type === 'resource'
      || ln.type === 'dataType'
      || ln.type === 'dataTypeMember'
      || ln.type === 'image'
      || ln.type === 'sound'
      || ln.type === 'version'
      || ln.type === 'supportLib'
    ) {
      owner = 'other'
      continue
    }

    if (ln.type === 'subParam' && owner === 'dll') {
      lastDllOwnedLine = i
      continue
    }

    if (ln.type === 'code') owner = 'other'
  }

  if (hasDllSection && lastDllOwnedLine >= 0) {
    return Math.min(lastDllOwnedLine + 1, lines.length)
  }

  // 尚无 DLL 区时，优先插入到声明区（首个 .程序集/.子程序 之前）。
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i].type === 'assembly' || parsed[i].type === 'sub') return i
  }

  return lines.length
}

/**
 * 找到首个 `.程序集 ` 声明所属变量区的尾部插入位置：
 * 以首个 `.程序集 ` 为起点，返回其后首个 `.子程序 ` / 下一个 `.程序集 ` 的行号；
 * 若均无，则返回整个数组末尾。提取自粘贴文本的 `.程序集变量 ` 将插入到该位置之前，
 * 等价于追加到顶部程序集变量区末尾。若未找到 `.程序集 `，返回 -1。
 */
function findTopAssemblyVarInsertPosition(lines: string[]): number {
  let asmIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('.程序集 ')) {
      asmIdx = i
      break
    }
  }
  if (asmIdx < 0) return -1
  for (let i = asmIdx + 1; i < lines.length; i++) {
    const t = lines[i].trimStart()
    if (t.startsWith('.子程序 ') || t.startsWith('.程序集 ')) return i
  }
  return lines.length
}

export interface MultiLinePasteResult {
  nextText: string
  insertAt: number
  pastedLineCount: number
  routedDeclarations: Array<{ language: 'ell' | 'egv' | 'ecs' | 'edt'; lines: string[] }>
}

export function buildMultiLinePasteResult(params: {
  currentText: string
  clipText: string
  cursorLine: number
  sanitizePastedText: (clipText: string, currentText: string) => string
  extractAssemblyVarLines?: (clipText: string, currentText: string) => string[]
  extractRoutedDeclarationLines?: (clipText: string, currentText: string) => Array<{ language: 'ell' | 'egv' | 'ecs' | 'edt'; lines: string[] }>
}): MultiLinePasteResult | null {
  const { currentText, clipText, cursorLine, sanitizePastedText, extractAssemblyVarLines, extractRoutedDeclarationLines } = params
  if (!clipText) return null

  const routedDeclarations = extractRoutedDeclarationLines
    ? extractRoutedDeclarationLines(clipText, currentText)
    : []

  const sanitized = sanitizePastedText(clipText, currentText)
  let pastedLines = sanitized
    .split('\n')
    .map(l => l.replace(/\r$/, ''))

  if (routedDeclarations.length > 0 && pastedLines.length > 0) {
    const parsed = parseLines(pastedLines.join('\n'))
    const keepMask = new Array<boolean>(parsed.length).fill(true)
    let owner: 'dll' | 'dataType' | '' = ''
    for (let i = 0; i < parsed.length; i++) {
      const ln = parsed[i]
      if (ln.type === 'dll') {
        owner = 'dll'
        keepMask[i] = false
        continue
      }
      if (ln.type === 'globalVar' || ln.type === 'constant' || ln.type === 'dataType') {
        owner = ln.type === 'dataType' ? 'dataType' : ''
        keepMask[i] = false
        continue
      }
      if (ln.type === 'subParam' && owner === 'dll') {
        keepMask[i] = false
        continue
      }
      if (ln.type === 'dataTypeMember' && owner === 'dataType') {
        keepMask[i] = false
        continue
      }
      if (
        ln.type === 'assembly'
        || ln.type === 'assemblyVar'
        || ln.type === 'sub'
        || ln.type === 'localVar'
        || ln.type === 'resource'
        || ln.type === 'image'
        || ln.type === 'sound'
        || ln.type === 'version'
        || ln.type === 'supportLib'
        || ln.type === 'code'
        || ln.type === 'comment'
        || ln.type === 'blank'
      ) {
        owner = ''
      }
    }
    pastedLines = pastedLines.filter((_, i) => keepMask[i])
  }

  const hasInlineContent = pastedLines.join('\n').length > 0
  const extractedAsmVars = extractAssemblyVarLines
    ? extractAssemblyVarLines(clipText, currentText)
    : []

  if (!hasInlineContent && extractedAsmVars.length === 0 && routedDeclarations.length === 0) return null

  const lines = currentText.split('\n')
  const pastedParsed = hasInlineContent ? parseLines(pastedLines.join('\n')) : []
  const pastedHasSub = pastedParsed.some(ln => ln.type === 'sub')
  const pastedHasDll = pastedParsed.some(ln => ln.type === 'dll')

  let insertAt = lines.length
  if (hasInlineContent) {
    if (pastedHasSub) {
      insertAt = findInsertAtForPastedSubs(lines, cursorLine)
    } else if (pastedHasDll) {
      insertAt = findInsertAtForPastedDlls(lines)
    } else if (cursorLine >= 0) {
      // 与手工输入保持一致：粘贴在光标所在行生效，原行向下平移
      insertAt = Math.min(cursorLine, lines.length)
    }
  }

  // 若粘贴内容不含子程序头，按光标行缩进整体平移，
  // 使嵌套流程块内粘贴时能够与上下文保持一致的缩进层级。
  let adjustedLines = pastedLines
  if (hasInlineContent && !pastedHasSub && !pastedHasDll && cursorLine >= 0 && cursorLine < lines.length) {
    const baseLine = lines[cursorLine] ?? ''
    const baseIndent = baseLine.length - baseLine.trimStart().length
    if (baseIndent > 0) {
      const pad = ' '.repeat(baseIndent)
      adjustedLines = pastedLines.map(l => (l.length === 0 ? l : pad + l))
    }
  }

  const nextLines = [...lines]
  if (hasInlineContent) {
    nextLines.splice(insertAt, 0, ...adjustedLines)
  }

  // 提取到的 `.程序集变量` 插入到顶部程序集变量区末尾。
  // 由于程序集区位于所有子程序之前，asmInsertPos <= 内联 insertAt，
  // 需要把 insertAt 前移相应行数以保持原有选中范围准确。
  if (extractedAsmVars.length > 0) {
    const asmInsertPos = findTopAssemblyVarInsertPosition(nextLines)
    if (asmInsertPos >= 0) {
      nextLines.splice(asmInsertPos, 0, ...extractedAsmVars)
      if (hasInlineContent && asmInsertPos <= insertAt) {
        insertAt += extractedAsmVars.length
      }
    }
  }

  return {
    nextText: nextLines.join('\n'),
    insertAt: hasInlineContent ? insertAt : nextLines.length,
    pastedLineCount: hasInlineContent ? adjustedLines.length : 0,
    routedDeclarations,
  }
}
