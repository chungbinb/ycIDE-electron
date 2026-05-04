import { parseLines } from './eycBlocks'

function normalizeEycText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
}

function hasAssemblyDeclaration(text: string): boolean {
  return normalizeEycText(text)
    .split('\n')
    .some(line => line.trimStart().startsWith('.程序集 '))
}

const FLOW_AUTO_TAG = '\u200B'
const FLOW_TRUE_MARK = '\u200C'
const FLOW_ELSE_MARK = '\u200D'
const FLOW_JUDGE_END_MARK = '\u2060'

function isFlowPasteDebugEnabled(): boolean {
  if (import.meta.env.DEV) return true
  const g = globalThis as {
    __EYC_FLOW_PASTE_DEBUG__?: boolean
    localStorage?: { getItem: (key: string) => string | null }
  }
  if (g.__EYC_FLOW_PASTE_DEBUG__ === true) return true
  try {
    return g.localStorage?.getItem('__EYC_FLOW_PASTE_DEBUG__') === '1'
  } catch {
    return false
  }
}

function debugFlowPaste(stage: string, payload: Record<string, unknown>): void {
  if (!isFlowPasteDebugEnabled()) return
  console.debug('[EYC_FLOW_DEBUG]', stage, payload)
  const g = globalThis as {
    api?: {
      debug?: {
        logRendererEvent?: (payload: { source?: string; message: string; extra?: unknown }) => Promise<{ success: boolean }>
        logRendererError?: (payload: { source?: string; message: string; extra?: unknown }) => Promise<{ success: boolean }>
      }
    }
  }
  const evt = g.api?.debug?.logRendererEvent
  if (evt) {
    void evt({ source: 'flow-paste', message: stage, extra: payload }).catch(() => {
      const err = g.api?.debug?.logRendererError
      if (err) {
        void err({ source: 'flow-paste-fallback', message: stage, extra: payload })
      }
    })
    return
  }
  const err = g.api?.debug?.logRendererError
  if (err) {
    void err({ source: 'flow-paste-fallback', message: stage, extra: payload })
  }
}

function countFlowMarkers(text: string): { mark200c: number; mark200d: number; mark2060: number } {
  let mark200c = 0
  let mark200d = 0
  let mark2060 = 0
  for (const ch of text) {
    if (ch === FLOW_TRUE_MARK) mark200c++
    else if (ch === FLOW_ELSE_MARK) mark200d++
    else if (ch === FLOW_JUDGE_END_MARK) mark2060++
  }
  return { mark200c, mark200d, mark2060 }
}

function isLikelyInternalFlowText(text: string): boolean {
  const lines = normalizeEycText(text).split('\n')
  const internalFlowCmds = new Set([
    '如果', '如果真', '判断开始', '判断',
    '如果结束', '如果真结束', '判断结束',
    '否则', '默认',
    '判断循环首', '判断循环尾', '循环判断首', '循环判断尾',
    '计次循环首', '计次循环尾', '变量循环首', '变量循环尾',
  ])

  for (const raw of lines) {
    const trimmed = raw.trimStart()
    if (!trimmed) continue
    if (trimmed.startsWith(FLOW_TRUE_MARK) || trimmed.startsWith(FLOW_ELSE_MARK) || trimmed.startsWith(FLOW_JUDGE_END_MARK)) {
      return true
    }
    if (trimmed.startsWith('.')) continue
    const kw = trimmed.split(/[\s(（]/)[0]
    if (internalFlowCmds.has(kw)) return true
  }

  return false
}

function convertYiFlowToInternal(src: string): string {
  const flowDotKeywords = new Set([
    '如果', '如果真', '否则', '如果结束', '如果真结束',
    '判断开始', '判断', '默认', '判断结束',
    '判断循环首', '判断循环尾', '循环判断首', '循环判断尾',
    '计次循环首', '计次循环尾', '变量循环首', '变量循环尾',
    '返回', '结束', '到循环尾', '跳出循环',
  ])

  return normalizeEycText(src)
    .split('\n')
    .map(raw => {
      const trimmed = raw.trimStart()
      if (!trimmed.startsWith('.')) return raw
      const kw = trimmed.slice(1).split(/[\s(（]/)[0]
      if (!flowDotKeywords.has(kw)) return raw
      const indent = raw.slice(0, raw.length - trimmed.length)
      return indent + trimmed.slice(1)
    })
    .join('\n')
}

function eycToYiFormat(text: string): string {
  const flowKeywords = new Set([
    '如果', '如果真', '否则', '如果结束', '如果真结束', '判断开始', '判断', '默认', '判断结束',
    '判断循环首', '判断循环尾', '循环判断首', '循环判断尾', '计次循环首', '计次循环尾', '变量循环首', '变量循环尾',
    '返回', '结束', '到循环尾', '跳出循环',
  ])

  const srcLines = normalizeEycText(text).split('\n')
  const cleanedLines = srcLines.map(raw => raw.replace(new RegExp(FLOW_AUTO_TAG, 'g'), ''))
  const out: string[] = []
  // 针对 `.否则/.默认` 的 else-open 与 `.如果结束/.判断结束` 的 close 都会以同样的
  // 空 200D/2060 行形式出现在内部文本。依靠前向扫描在遇到第一条空标记行时判断：
  // 同缩进范围内后续是否还存在另一条同种空标记行。存在 → 当前是 else-open；
  // 不存在 → 当前就是 close。这样就不用引入额外零宽字符来污染流程渲染。
  interface Frame {
    type: '如果' | '如果真' | '判断开始'
    elseEntered: boolean
  }
  const branchStack: Frame[] = []

  const startsWithMarkerAtIndent = (line: string, indent: string, marker: string): boolean => {
    return line.startsWith(indent + marker)
  }

  const updateBranchStackByKw = (kw: string): void => {
    if (kw === '如果' || kw === '如果真' || kw === '判断开始') {
      branchStack.push({ type: kw, elseEntered: false })
      return
    }
    if (kw === '如果结束' || kw === '如果真结束') {
      const top = branchStack[branchStack.length - 1]
      if (top && (top.type === '如果' || top.type === '如果真')) branchStack.pop()
      return
    }
    if (kw === '判断结束') {
      const top = branchStack[branchStack.length - 1]
      if (top && top.type === '判断开始') branchStack.pop()
    }
  }

  const noAutoCloseStartKeywords = new Set([
    '如果', '如果真', '判断开始',
    '判断循环首', '循环判断首', '计次循环首', '变量循环首',
  ])
  const branchStartKeywords = new Set(['如果', '如果真', '判断开始'])

  const emitMarkerRestLine = (rest: string, lineIndent: string, bodyIndent: string): string => {
    const normalizedRest = rest.trimStart()
    const kw = normalizedRest.split(/[\s(（]/)[0]
    const needsDot = flowKeywords.has(kw) && !normalizedRest.startsWith('.')
    const outRest = needsDot ? ('.' + normalizedRest) : normalizedRest
    const contentIndent = branchStartKeywords.has(kw) ? lineIndent : bodyIndent
    out.push(contentIndent + outRest)
    updateBranchStackByKw(kw)
    return kw
  }

  // 向前扫描：当前行是 baseIndent 缩进的空 marker 行；判断该 baseIndent 作用域内后续
  // 是否还有同种空 marker 行。存在则当前行为 else-open/default-open；否则为 close。
  const hasLaterEmptyMarkerAtIndent = (fromIdx: number, indentLen: number, marker: string): boolean => {
    for (let j = fromIdx + 1; j < cleanedLines.length; j++) {
      const ln = cleanedLines[j]
      const trimmedLn = ln.trimStart()
      if (!trimmedLn) continue
      const lnIndentLen = ln.length - trimmedLn.length
      if (lnIndentLen < indentLen) return false
      if (lnIndentLen === indentLen) {
        // 同缩进的空 marker 行
        if (trimmedLn === marker) return true
        // 同缩进、非标记起始的行：新的兄弟结构开始 → 本块已结束
        if (!trimmedLn.startsWith(FLOW_TRUE_MARK)
          && !trimmedLn.startsWith(FLOW_ELSE_MARK)
          && !trimmedLn.startsWith(FLOW_JUDGE_END_MARK)) {
          return false
        }
      }
      // 更深缩进的行（嵌套结构）继续扫描
    }
    return false
  }

  for (let i = 0; i < srcLines.length; i++) {
    const line = cleanedLines[i]
    const trimmed = line.trimStart()
    const indent = line.slice(0, line.length - trimmed.length)
    if (!trimmed) {
      out.push(line)
      continue
    }

    const nextLine = i + 1 < cleanedLines.length ? cleanedLines[i + 1] : ''

    // 分支体在易语言格式中需要比关键字多缩进一级（4 个空格）
    const bodyIndent = indent + '    '
    if (trimmed.startsWith(FLOW_TRUE_MARK)) {
      const rest = trimmed.slice(1)
      // 合并形式：`[C][D]` 表示“真分支为空且进入 else 分支”。同理 `[C][E]` 对应判断→默认。
      // 这样可以避免表格模式多出一行占位的 `[C]` 或 `[D]`。
      if (rest.startsWith(FLOW_ELSE_MARK) && !rest.slice(1).trim()) {
        const top = branchStack[branchStack.length - 1]
        if (top && top.type === '如果' && !top.elseEntered) {
          out.push(indent + '.否则')
          top.elseEntered = true
        } else {
          // 非预期情形（如 `如果真` 或已进入 else），按普通空 [D] 处理
          out.push(indent + (top && top.type === '如果真' ? '.如果真结束' : '.如果结束'))
          if (top && (top.type === '如果' || top.type === '如果真')) branchStack.pop()
        }
        continue
      }
      if (rest.startsWith(FLOW_JUDGE_END_MARK) && !rest.slice(1).trim()) {
        const top = branchStack[branchStack.length - 1]
        if (top && top.type === '判断开始' && !top.elseEntered) {
          out.push(indent + '.默认')
          top.elseEntered = true
        } else {
          out.push(indent + '.判断结束')
          if (top && top.type === '判断开始') branchStack.pop()
        }
        continue
      }
      if (rest.trim()) void emitMarkerRestLine(rest, indent, bodyIndent)
      else out.push('')
      continue
    }
    if (trimmed.startsWith(FLOW_ELSE_MARK)) {
      const rest = trimmed.slice(1)
      if (rest.trim()) {
        const normalizedRest = rest.trimStart()
        const restKw = normalizedRest.split(/[\s(（]/)[0]
        const branchIndent = branchStartKeywords.has(restKw)
          ? (indent.length >= 4 ? indent.slice(0, indent.length - 4) : '')
          : indent
        const top = branchStack[branchStack.length - 1]
        // 如果真分支没有“否则”语义，遇到 200D+内容时仅还原为正文。
        if (top && top.type === '如果真') {
          void emitMarkerRestLine(rest, indent, bodyIndent)
          continue
        }
        // 200D + 内容表示 else 分支内的正文。若该帧尚未进入 else，则先补 `.否则`。
        if (top && top.type === '如果' && !top.elseEntered) {
          out.push(branchIndent + '.否则')
          top.elseEntered = true
        }
        emitMarkerRestLine(rest, indent, bodyIndent)
        if (!noAutoCloseStartKeywords.has(restKw) && !startsWithMarkerAtIndent(nextLine, indent, FLOW_ELSE_MARK)) {
          out.push(branchIndent + '.如果结束')
        }
      } else {
        // 空 200D：在 `如果` 帧中表示 `.否则`（首次）或 `.如果结束`；在 `如果真` 帧中仅表示 `.如果真结束`。
        const top = branchStack[branchStack.length - 1]
        if (top && top.type === '如果' && !top.elseEntered
          && hasLaterEmptyMarkerAtIndent(i, indent.length, FLOW_ELSE_MARK)) {
          out.push(indent + '.否则')
          top.elseEntered = true
        } else {
          out.push(indent + (top && top.type === '如果真' ? '.如果真结束' : '.如果结束'))
          if (top && (top.type === '如果' || top.type === '如果真')) branchStack.pop()
        }
      }
      continue
    }
    if (trimmed.startsWith(FLOW_JUDGE_END_MARK)) {
      const rest = trimmed.slice(1)
      if (rest.trim()) {
        const normalizedRest = rest.trimStart()
        const restKw = normalizedRest.split(/[\s(（]/)[0]
        const branchIndent = branchStartKeywords.has(restKw)
          ? (indent.length >= 4 ? indent.slice(0, indent.length - 4) : '')
          : indent
        const top = branchStack[branchStack.length - 1]
        if (top && top.type === '判断开始' && !top.elseEntered) {
          out.push(branchIndent + '.默认')
          top.elseEntered = true
        }
        emitMarkerRestLine(rest, indent, bodyIndent)
        if (!noAutoCloseStartKeywords.has(restKw) && !startsWithMarkerAtIndent(nextLine, indent, FLOW_JUDGE_END_MARK)) {
          out.push(branchIndent + '.判断结束')
        }
      } else {
        const top = branchStack[branchStack.length - 1]
        if (top && top.type === '判断开始' && !top.elseEntered
          && hasLaterEmptyMarkerAtIndent(i, indent.length, FLOW_JUDGE_END_MARK)) {
          out.push(indent + '.默认')
          top.elseEntered = true
        } else {
          out.push(indent + '.判断结束')
          if (top && top.type === '判断开始') branchStack.pop()
        }
      }
      continue
    }

    const kw = trimmed.split(/[\s(（]/)[0]
    updateBranchStackByKw(kw)
    if (flowKeywords.has(kw) && !trimmed.startsWith('.')) {
      out.push(indent + '.' + trimmed)
      continue
    }
    out.push(line)
  }

  return out.join('\n')
}

function eycToInternalFormat(text: string): string {
  const normalized = normalizeEycText(text)
  const markerCount = countFlowMarkers(normalized)
  if (markerCount.mark200c > 0 || markerCount.mark200d > 0 || markerCount.mark2060 > 0) {
    return convertYiFlowToInternal(eycToYiFormat(normalized))
  }
  return convertYiFlowToInternal(normalized)
}

/**
 * 从粘贴文本中提取 `.程序集变量 ...` 声明行。
 * 调用方应在目标文档已存在 `.程序集` 声明时使用本函数，
 * 将提取到的变量插入到顶部程序集的变量区，避免与 sanitize 后的内联粘贴同时生效造成重复。
 */
function extractAssemblyVarLinesFromPasted(clipText: string, currentSource: string): string[] {
  if (!hasAssemblyDeclaration(currentSource)) return []
  const internalLike = isLikelyInternalFlowText(clipText)
  const normalized = internalLike
    ? eycToInternalFormat(clipText)
    : eycToInternalFormat(clipText)
  return normalized
    .split('\n')
    .map(line => line.replace(/\r$/, ''))
    .filter(line => line.trimStart().startsWith('.程序集变量 '))
}

function sanitizePastedTextForCurrent(text: string, currentSource: string): string {
  const internalLike = isLikelyInternalFlowText(text)
  debugFlowPaste('sanitize:input', {
    internalLike,
    hasAssembly: hasAssemblyDeclaration(currentSource),
    inputPreview: normalizeEycText(text).split('\n').slice(0, 8),
    inputMarkerCount: countFlowMarkers(text),
  })
  const normalized = internalLike
    ? eycToInternalFormat(text)
    : eycToInternalFormat(text)
  if (!hasAssemblyDeclaration(currentSource)) {
    debugFlowPaste('sanitize:output-no-assembly-filter', {
      outputPreview: normalized.split('\n').slice(0, 8),
      outputMarkerCount: countFlowMarkers(normalized),
    })
    return normalized
  }

  const shouldDropAssemblyLevelDirective = (line: string): boolean => {
    const trimmed = line.trimStart()
    if (!trimmed.startsWith('.')) return false
    // 这些是文件/程序集级声明，粘贴到代码区时应剔除，避免污染流程结构。
    // `.程序集变量` 也在此剔除；调用方（buildMultiLinePasteResult）会单独提取它们
    // 并插入到现有文档最顶部的 `.程序集` 程序集变量区，而不是在光标处内联。
    return trimmed.startsWith('.程序集 ')
      || trimmed.startsWith('.版本 ')
      || trimmed.startsWith('.支持库 ')
      || trimmed.startsWith('.程序集变量 ')
  }

  const filtered = normalizeEycText(normalized)
    .split('\n')
    .filter(line => !shouldDropAssemblyLevelDirective(line))
    .join('\n')
  const trimmedEdgeBlank = filtered.replace(/^\n+/, '').replace(/\n+$/, '')
  debugFlowPaste('sanitize:output-filtered', {
    outputPreview: trimmedEdgeBlank.split('\n').slice(0, 8),
    outputMarkerCount: countFlowMarkers(trimmedEdgeBlank),
  })
  return trimmedEdgeBlank
}

type RoutedDeclLanguage = 'ell' | 'egv' | 'ecs' | 'edt'

function extractRoutedDeclarationLinesFromPasted(clipText: string, currentSource: string): Array<{ language: RoutedDeclLanguage; lines: string[] }> {
  const internalLike = isLikelyInternalFlowText(clipText)
  const normalized = internalLike
    ? normalizeEycText(clipText)
    : eycToInternalFormat(clipText)

  const rawLines = normalized
    .split('\n')
    .map(line => line.replace(/\r$/, ''))
  if (rawLines.length === 0) return []

  const parsed = parseLines(rawLines.join('\n'))
  const buckets = new Map<RoutedDeclLanguage, string[]>([
    ['ell', []],
    ['egv', []],
    ['ecs', []],
    ['edt', []],
  ])

  let owner: 'dll' | 'dataType' | '' = ''
  for (let i = 0; i < parsed.length; i++) {
    const ln = parsed[i]
    const line = rawLines[i]
    if (ln.type === 'dll') {
      owner = 'dll'
      buckets.get('ell')?.push(line)
      continue
    }
    if (ln.type === 'globalVar') {
      owner = ''
      buckets.get('egv')?.push(line)
      continue
    }
    if (ln.type === 'constant') {
      owner = ''
      buckets.get('ecs')?.push(line)
      continue
    }
    if (ln.type === 'dataType') {
      owner = 'dataType'
      buckets.get('edt')?.push(line)
      continue
    }
    if (ln.type === 'subParam' && owner === 'dll') {
      buckets.get('ell')?.push(line)
      continue
    }
    if (ln.type === 'dataTypeMember' && owner === 'dataType') {
      buckets.get('edt')?.push(line)
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

  return (['ell', 'egv', 'ecs', 'edt'] as const)
    .map(language => ({ language, lines: buckets.get(language) || [] }))
    .filter(item => item.lines.length > 0)
}

export {
  normalizeEycText,
  eycToInternalFormat,
  eycToYiFormat,
  sanitizePastedTextForCurrent,
  extractAssemblyVarLinesFromPasted,
  extractRoutedDeclarationLinesFromPasted,
}
