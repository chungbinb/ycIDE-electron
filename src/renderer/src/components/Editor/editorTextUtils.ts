export interface AssignmentDetail {
  target: string
  value: string
}

export interface AssignmentLineParts {
  indent: string
  lhs: string
  rhs: string
}

export function parseAssignmentDetail(codeLine: string): AssignmentDetail | null {
  if (!codeLine) return null
  const trimmed = codeLine.trim()
  if (!trimmed || trimmed.startsWith('.')) return null
  const m = /^([\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.。．]*)\s*(?:=|＝)\s*(.+)$/.exec(trimmed)
  if (!m) return null
  const target = (m[1] || '').trim()
  const value = (m[2] || '').trim()
  if (!target || !value) return null
  return { target, value }
}

export function parseAssignmentLineParts(codeLine: string): AssignmentLineParts | null {
  if (!codeLine) return null
  const m = /^(\s*[\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.。．]*)\s*(?:=|＝)\s*(.*)$/.exec(codeLine)
  if (!m) return null
  const lhsRaw = m[1] || ''
  const rhs = (m[2] || '').trim()
  const indentLen = lhsRaw.length - lhsRaw.trimStart().length
  return {
    indent: lhsRaw.slice(0, indentLen),
    lhs: lhsRaw.trim(),
    rhs,
  }
}

export function isQuotedTextLiteral(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return false
  const isAsciiQuoted = t.length >= 2 && t.startsWith('"') && t.endsWith('"')
  const isCnQuoted = t.length >= 2 && t.startsWith('“') && t.endsWith('”')
  return isAsciiQuoted || isCnQuoted
}

export function parseCallArgs(codeLine: string): string[] {
  const openIdx = codeLine.search(/[(（]/)
  if (openIdx < 0) return []
  const open = codeLine[openIdx]
  const close = open === '(' ? ')' : '）'
  let depth = 0
  let start = openIdx + 1
  const args: string[] = []
  let inStr = false
  for (let i = openIdx; i < codeLine.length; i++) {
    const ch = codeLine[i]
    if (inStr) {
      if (ch === '"' || ch === '\u201d') inStr = false
      continue
    }
    if (ch === '"' || ch === '\u201c') {
      inStr = true
      continue
    }
    if (ch === open || ch === '(' || ch === '（' || ch === '{' || ch === '｛') {
      if (depth === 0) start = i + 1
      depth++
    } else if (ch === close || ch === ')' || ch === '）' || ch === '}' || ch === '｝') {
      depth--
      if (depth === 0) {
        args.push(codeLine.slice(start, i).trim())
        break
      }
    } else if ((ch === ',' || ch === '，') && depth === 1) {
      args.push(codeLine.slice(start, i).trim())
      start = i + 1
    }
  }
  return args
}

/**
 * 参数值的括号/引号是否配平（字符串字面量内不计）。
 * 用于展开参数编辑的实时写回守卫：值处于「到字节集(」这类中间态时若写回主命令行，
 * 未配平的开括号会吞掉外层调用自身的右括号，随后 replaceCallArg 在破行上找不到
 * 参数边界、走"追加"分支，每敲一键在行尾多出一组重复参数（级联损坏）。
 */
export function isArgParensBalanced(val: string): boolean {
  let depth = 0
  let inStr = false
  for (let i = 0; i < val.length; i++) {
    const ch = val[i]
    if (inStr) {
      if (ch === '"' || ch === '”') inStr = false
      continue
    }
    if (ch === '"' || ch === '“') { inStr = true; continue }
    if (ch === '(' || ch === '（' || ch === '{' || ch === '｛') depth++
    else if (ch === ')' || ch === '）' || ch === '}' || ch === '｝') {
      depth--
      if (depth < 0) return false
    }
  }
  return !inStr && depth === 0
}

/**
 * 为参数值补齐缺失的右括号/右引号（提交时兜底）：按开括号的半/全角逐个补相应的闭括号；
 * 引号未闭合先补引号。深度为负（多余的右括号）无法可靠修复，原样返回交给诊断标红。
 */
export function balanceArgParens(val: string): string {
  const stack: string[] = []
  let inStr = false
  let strClose = ''
  for (let i = 0; i < val.length; i++) {
    const ch = val[i]
    if (inStr) {
      if (ch === '"' || ch === '”') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; strClose = '"'; continue }
    if (ch === '“') { inStr = true; strClose = '”'; continue }
    if (ch === '(') stack.push(')')
    else if (ch === '（') stack.push('）')
    else if (ch === '{') stack.push('}')
    else if (ch === '｛') stack.push('｝')
    else if (ch === ')' || ch === '）' || ch === '}' || ch === '｝') {
      if (stack.length === 0) return val // 深度为负：不修，交给诊断
      stack.pop()
    }
  }
  let out = val
  if (inStr) out += strClose
  while (stack.length > 0) out += stack.pop()
  return out
}

export function replaceCallArg(codeLine: string, argIdx: number, newVal: string): string {
  const openIdx = codeLine.search(/[(（]/)
  if (openIdx < 0) return codeLine

  const parseRanges = (skipStr: boolean) => {
    const ranges: Array<{ start: number; end: number }> = []
    let depth = 0
    let start = openIdx + 1
    let inStr = false
    let closeIdx = codeLine.length
    let found = false
    for (let i = openIdx; i < codeLine.length; i++) {
      const ch = codeLine[i]
      if (skipStr) {
        if (inStr) {
          if (ch === '"' || ch === '\u201d') inStr = false
          continue
        }
        if (ch === '"' || ch === '\u201c') {
          inStr = true
          continue
        }
      }
      if (ch === '(' || ch === '（' || ch === '{' || ch === '｛') {
        if (depth === 0) start = i + 1
        depth++
      } else if (ch === ')' || ch === '）' || ch === '}' || ch === '｝') {
        depth--
        if (depth === 0) {
          ranges.push({ start, end: i })
          closeIdx = i
          found = true
          break
        }
      } else if ((ch === ',' || ch === '，') && depth === 1) {
        ranges.push({ start, end: i })
        start = i + 1
      }
    }
    return { ranges, closeIdx, found }
  }

  let { ranges, closeIdx, found } = parseRanges(true)
  if (!found) {
    ({ ranges, closeIdx, found } = parseRanges(false))
  }
  if (argIdx < ranges.length) {
    return codeLine.slice(0, ranges[argIdx].start) + newVal + codeLine.slice(ranges[argIdx].end)
  }

  // 空值写入尚不存在的尾参：视为「保持缺省」，原样返回——否则会凭空追加一个空实参尾逗号
  // （如 信息框 ("提示",0,"标题") 提交空的可选「父窗口」→ 误变成 …,"标题",)）。
  if (newVal === '') return codeLine

  let result = codeLine.slice(0, closeIdx)
  const sep = codeLine[openIdx] === '（' ? '，' : ','
  for (let i = ranges.length; i <= argIdx; i++) {
    if (i > 0 || ranges.length > 0) result += sep
    result += i === argIdx ? newVal : ''
  }
  result += codeLine.slice(closeIdx)
  return result
}

/**
 * 在第 argIdx 个参数之后插入一个新参数槽（值为 newVal，通常为空串）。用于展开参数行的
 * 「回车/逗号新增当前层级参数行」（照易语言）：可重复参数逐值一行，杜绝把多个值挤进单槽
 * 后 replaceCallArg 反复写回导致的尾部残留级联重复。分隔符按调用括号的半/全角取。
 */
export function insertCallArgAfter(codeLine: string, argIdx: number, newVal: string): string {
  const openIdx = codeLine.search(/[(（]/)
  if (openIdx < 0) return codeLine
  const sep = codeLine[openIdx] === '（' ? '，' : ','

  const parseRanges = (skipStr: boolean) => {
    const ranges: Array<{ start: number; end: number }> = []
    let depth = 0
    let start = openIdx + 1
    let inStr = false
    let closeIdx = codeLine.length
    let found = false
    for (let i = openIdx; i < codeLine.length; i++) {
      const ch = codeLine[i]
      if (skipStr) {
        if (inStr) {
          if (ch === '"' || ch === '”') inStr = false
          continue
        }
        if (ch === '"' || ch === '“') {
          inStr = true
          continue
        }
      }
      if (ch === '(' || ch === '（' || ch === '{' || ch === '｛') {
        if (depth === 0) start = i + 1
        depth++
      } else if (ch === ')' || ch === '）' || ch === '}' || ch === '｝') {
        depth--
        if (depth === 0) {
          ranges.push({ start, end: i })
          closeIdx = i
          found = true
          break
        }
      } else if ((ch === ',' || ch === '，') && depth === 1) {
        ranges.push({ start, end: i })
        start = i + 1
      }
    }
    return { ranges, closeIdx, found }
  }

  let { ranges, closeIdx, found } = parseRanges(true)
  if (!found) {
    ({ ranges, closeIdx, found } = parseRanges(false))
  }
  // 空调用 "()" 解析出一个空区间（长度 1），此时首个「插入」应直接落进括号内、不加分隔符
  if (ranges.length === 1 && ranges[0].start === ranges[0].end && argIdx <= 0) {
    return codeLine.slice(0, ranges[0].start) + newVal + codeLine.slice(ranges[0].end)
  }
  if (argIdx >= 0 && argIdx < ranges.length) {
    const insPos = ranges[argIdx].end  // 该参数结束处（其后的逗号/右括号之前）
    return codeLine.slice(0, insPos) + sep + newVal + codeLine.slice(insPos)
  }
  // argIdx 越界：追加到末参之后（右括号前）
  return codeLine.slice(0, closeIdx) + sep + newVal + codeLine.slice(closeIdx)
}

/**
 * 删除调用中指定下标的若干参数（用于展开参数行多选删除）。保留参数按原分隔符重连，
 * 删空则留空括号 `()`。分隔符按调用括号的半/全角取。下标越界者忽略。
 */
export function removeCallArgs(codeLine: string, argIdxs: number[]): string {
  const openIdx = codeLine.search(/[(（]/)
  if (openIdx < 0) return codeLine
  const sep = codeLine[openIdx] === '（' ? '，' : ','

  const parseRanges = (skipStr: boolean) => {
    const ranges: Array<{ start: number; end: number }> = []
    let depth = 0
    let start = openIdx + 1
    let inStr = false
    let closeIdx = codeLine.length
    let found = false
    for (let i = openIdx; i < codeLine.length; i++) {
      const ch = codeLine[i]
      if (skipStr) {
        if (inStr) {
          if (ch === '"' || ch === '”') inStr = false
          continue
        }
        if (ch === '"' || ch === '“') {
          inStr = true
          continue
        }
      }
      if (ch === '(' || ch === '（' || ch === '{' || ch === '｛') {
        if (depth === 0) start = i + 1
        depth++
      } else if (ch === ')' || ch === '）' || ch === '}' || ch === '｝') {
        depth--
        if (depth === 0) {
          ranges.push({ start, end: i })
          closeIdx = i
          found = true
          break
        }
      } else if ((ch === ',' || ch === '，') && depth === 1) {
        ranges.push({ start, end: i })
        start = i + 1
      }
    }
    return { ranges, closeIdx, found }
  }

  let { ranges, closeIdx, found } = parseRanges(true)
  if (!found) {
    ({ ranges, closeIdx, found } = parseRanges(false))
  }
  if (ranges.length === 0) return codeLine
  const remove = new Set(argIdxs.filter(i => i >= 0 && i < ranges.length))
  if (remove.size === 0) return codeLine
  const kept: string[] = []
  for (let i = 0; i < ranges.length; i++) {
    if (!remove.has(i)) kept.push(codeLine.slice(ranges[i].start, ranges[i].end).trim())
  }
  return codeLine.slice(0, openIdx + 1) + kept.join(sep) + codeLine.slice(closeIdx)
}
