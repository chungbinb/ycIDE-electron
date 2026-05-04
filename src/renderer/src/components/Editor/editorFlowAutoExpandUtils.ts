import {
  FLOW_AUTO_TAG,
  extractFlowKw,
} from './eycFlow'

const FLOW_MARKER_CHARS = ['\u200C', '\u200D', '\u2060']

export function trimTrailingEmptyFormattedLine(lines: string[]): string[] {
  if (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    return lines.slice(0, -1)
  }
  return lines
}

export function collectRemainingLinesInCurrentScope(lines: string[], startIndex: number, minIndentLen?: number): string[] {
  const remainingLines: string[] = []
  for (let ri = startIndex; ri < lines.length; ri++) {
    const line = lines[ri]
    const rl = line.replace(/[\r\t]/g, '').trim()
    if (rl.startsWith('.子程序 ') || rl.startsWith('.程序集 ')) break
    if (minIndentLen !== undefined && rl) {
      const indentLen = line.length - line.trimStart().length
      if (indentLen < minIndentLen) break
    }
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
  void flowMark
  lines.splice(lineIndex, 1, ...formattedLines)
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
      // 兼容旧数据：编辑态剥离 marker，但不再进入 marker 路径。
      hasMarker: false,
      flowMark: '',
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
  // 仅提取自动展开生成的关键流程行，和后续现有代码做结构比对。
  const kwLines = extraLines.filter(el => el.includes(FLOW_AUTO_TAG))
  if (kwLines.length === 0) return extraLines

  const getIndentLen = (line: string): number => line.length - line.trimStart().length
  const getExpectedKw = (line: string): string => line.replace(FLOW_AUTO_TAG, '').trim().split(/[\s(（]/)[0]

  // 关键：去重只能在“同缩进”且“顺序匹配”的情况下成立，
  // 防止嵌套时把外层 `否则/如果结束` 误判为内层已存在结构。
  const expected = kwLines.map(el => ({
    kw: getExpectedKw(el),
    indent: getIndentLen(el),
  }))

  // 对包含分支关键字的展开链（如果/判断）不执行去重。
  // 嵌套场景下外层结构极易被误匹配，宁可保留重复链也不能丢结构。
  if (expected.some(item => item.kw === '否则' || item.kw === '默认')) {
    return extraLines
  }

  let cursor = 0
  let matched = 0
  while (cursor < remainingLines.length && matched < expected.length) {
    const remain = remainingLines[cursor]
    const kw = extractFlowKw(remain)
    if (!kw) {
      cursor++
      continue
    }
    const indent = getIndentLen(remain)
    const target = expected[matched]
    if (kw === target.kw && indent === target.indent) {
      matched++
      cursor++
      continue
    }
    // 顺序去重一旦在首个关键字处不匹配，说明不是同构尾部。
    if (matched === 0) return extraLines
    cursor++
  }

  const hasAllEndings = matched === expected.length

  // 若后续作用域里已完整存在同构结束链，则丢弃自动补出的重复尾部。
  return hasAllEndings ? [] : extraLines
}
