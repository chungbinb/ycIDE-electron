import { parseLines } from './eycBlocks'
import { appendMissingFlowEnds } from './eycFlow'

type SubBlock = {
  name: string
  start: number
  end: number
}

function getSubNameByParsedLine(parsedLine: { type: string; fields: string[] }): string {
  if (parsedLine.type !== 'sub') return ''
  return (parsedLine.fields[0] || '').trim()
}

function collectSubBlocksByLines(lines: string[]): SubBlock[] {
  const parsed = parseLines(lines.join('\n'))
  const subHeaderIndices: number[] = []
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i].type === 'sub') subHeaderIndices.push(i)
  }
  if (subHeaderIndices.length === 0) return []

  const blocks: SubBlock[] = []
  for (let i = 0; i < subHeaderIndices.length; i++) {
    const start = subHeaderIndices[i]
    const name = getSubNameByParsedLine(parsed[start])
    if (!name) continue

    let end = lines.length
    for (let j = start + 1; j < parsed.length; j++) {
      if (parsed[j].type === 'sub' || parsed[j].type === 'assembly') {
        end = j
        break
      }
    }
    blocks.push({ name, start, end })
  }
  return blocks
}

/**
 * 粘贴的子程序与现有子程序重名 → 自动改名：原名_1，_1 也占用则 _2 依次类推。
 * 只改 `.子程序` 声明行的名称字段，片段其余内容原样保留（不再走"并入同名子程序"的旧合并语义——
 * 旧语义下复制一个只有声明行的子程序粘贴会被整块剔除、看起来毫无反应）。
 */
function renameDuplicatePastedSubs(currentLines: string[], pastedLines: string[]): string[] {
  const usedNames = new Set(collectSubBlocksByLines(currentLines).map(block => block.name))
  if (usedNames.size === 0) return pastedLines
  const pastedBlocks = collectSubBlocksByLines(pastedLines)
  if (pastedBlocks.length === 0) return pastedLines

  const out = [...pastedLines]
  for (const block of pastedBlocks) {
    if (!usedNames.has(block.name)) {
      usedNames.add(block.name)
      continue
    }
    let n = 1
    while (usedNames.has(`${block.name}_${n}`)) n++
    const newName = `${block.name}_${n}`
    const line = out[block.start]
    const m = line.match(/^(\s*\.子程序\s+)([^,，\r\n]*)(.*)$/)
    if (!m) continue
    out[block.start] = `${m[1]}${newName}${m[3]}`
    usedNames.add(newName)
  }
  return out
}

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

/**
 * 把错位的 `.局部变量` 行归位到所属子程序头部声明区（参数/局部变量块）末尾。
 * 处理手工在子程序正文中敲出的局部变量声明（会在子程序中部形成第二张局部变量表）；
 * 逐子程序收集错位行、按原有相对顺序并入声明区。无错位时返回 null（调用方免写回）。
 */
export function relocateMisplacedLocalVarLines(text: string): string | null {
  const ls = text.split('\n')
  const parsed = parseLines(text)

  const removeSet = new Set<number>()
  const insertByDeclEnd = new Map<number, string[]>()
  let subLine = -1
  let declEnd = -1
  for (let i = 0; i < parsed.length; i++) {
    const t = parsed[i]?.type
    if (t === 'sub') {
      subLine = i
      declEnd = i + 1
      while (declEnd < parsed.length && (parsed[declEnd].type === 'subParam' || parsed[declEnd].type === 'localVar')) declEnd++
      continue
    }
    if (t === 'assembly') {
      subLine = -1
      continue
    }
    if (t === 'localVar' && subLine >= 0 && i >= declEnd) {
      removeSet.add(i)
      const list = insertByDeclEnd.get(declEnd)
      if (list) list.push(ls[i])
      else insertByDeclEnd.set(declEnd, [ls[i]])
    }
  }
  if (removeSet.size === 0) return null

  const out: string[] = []
  for (let i = 0; i < ls.length; i++) {
    const pending = insertByDeclEnd.get(i)
    if (pending) out.push(...pending)
    if (removeSet.has(i)) continue
    out.push(ls[i])
  }
  return out.join('\n')
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

  // 粘贴护栏：片段含流程头但缺配对结束（含外部来源的半截结构）→ 自动补齐结束行，避免破坏流程线
  pastedLines = appendMissingFlowEnds(pastedLines)

  const lines = currentText.split('\n')

  // `.局部变量` 行归位：粘贴目标在某个子程序内时，片段中"不属于片段内子程序"的 .局部变量 行
  // （片段首个 .子程序 头之前的那些）不在光标处内联——那会在子程序中部形成第二张局部变量表，
  // 改为并入目标子程序头部的声明区（参数/局部变量块末尾）。片段内自带子程序的局部变量原样保留。
  const relocatedLocalVars: string[] = []
  let localVarDeclPos = -1
  if (pastedLines.some(l => l.trimStart().startsWith('.局部变量'))) {
    const currentParsed = parseLines(currentText)
    let targetSubLine = -1
    for (let i = Math.min(cursorLine, currentParsed.length - 1); i >= 0; i--) {
      const t = currentParsed[i]?.type
      if (t === 'sub') { targetSubLine = i; break }
      if (t === 'assembly') break
    }
    if (targetSubLine >= 0) {
      let declPos = targetSubLine + 1
      while (declPos < currentParsed.length && (currentParsed[declPos].type === 'subParam' || currentParsed[declPos].type === 'localVar')) declPos++
      localVarDeclPos = declPos

      const pastedParsedForVars = parseLines(pastedLines.join('\n'))
      const keep: string[] = []
      let seenSub = false
      for (let i = 0; i < pastedLines.length; i++) {
        const t = pastedParsedForVars[i]?.type
        if (t === 'sub') seenSub = true
        if (!seenSub && t === 'localVar') {
          relocatedLocalVars.push(pastedLines[i])
          continue
        }
        keep.push(pastedLines[i])
      }
      // 只剩空行的余量不再内联（纯局部变量粘贴不留空洞）
      if (relocatedLocalVars.length > 0 && keep.every(l => l.trim() === '')) {
        pastedLines = []
      } else if (relocatedLocalVars.length > 0) {
        pastedLines = keep
      }
    }
  }

  const hasInlineContent = pastedLines.join('\n').length > 0
  const extractedAsmVars = extractAssemblyVarLines
    ? extractAssemblyVarLines(clipText, currentText)
    : []

  if (!hasInlineContent && extractedAsmVars.length === 0 && routedDeclarations.length === 0 && relocatedLocalVars.length === 0) return null
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

  // 粘贴的子程序与现有重名 → 自动改名（原名_1/_2…），整块原样插入
  if (pastedHasSub) {
    adjustedLines = renameDuplicatePastedSubs(lines, adjustedLines)
  }

  const nextLines = [...lines]
  if (hasInlineContent) {
    nextLines.splice(insertAt, 0, ...adjustedLines)
  }

  // 归位的 `.局部变量` 插入目标子程序声明区末尾（声明区在光标上方：内联插入若在其前需平移声明位，
  // 插入后再平移内联选中范围）
  let relocatedLocalVarInsertAt = -1
  if (relocatedLocalVars.length > 0 && localVarDeclPos >= 0) {
    let declPos = localVarDeclPos
    // 内联插入点严格位于声明区上方（光标在声明块内）才需要平移声明位；
    // 恰在声明区末尾（insertAt === declPos）时变量仍应插在内联代码之前。
    if (hasInlineContent && insertAt < declPos) declPos += adjustedLines.length
    nextLines.splice(declPos, 0, ...relocatedLocalVars)
    relocatedLocalVarInsertAt = declPos
    if (hasInlineContent && declPos <= insertAt) {
      insertAt += relocatedLocalVars.length
    }
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
      if (relocatedLocalVarInsertAt >= 0 && asmInsertPos <= relocatedLocalVarInsertAt) {
        relocatedLocalVarInsertAt += extractedAsmVars.length
      }
    }
  }

  const insertedInlineCount = hasInlineContent ? adjustedLines.length : 0
  const resultInsertAt = insertedInlineCount > 0
    ? insertAt
    : relocatedLocalVarInsertAt >= 0
      ? relocatedLocalVarInsertAt
      : nextLines.length
  const resultLineCount = insertedInlineCount > 0 ? insertedInlineCount : relocatedLocalVars.length

  return {
    nextText: nextLines.join('\n'),
    insertAt: resultInsertAt,
    pastedLineCount: resultLineCount,
    routedDeclarations,
  }
}
