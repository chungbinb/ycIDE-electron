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
    '如果', '如果真', '判断',
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
    '判断', '默认', '判断结束',
    '判断循环首', '判断循环尾', '循环判断首', '循环判断尾',
    '计次循环首', '计次循环尾', '变量循环首', '变量循环尾',
    '返回', '结束', '到循环尾', '跳出循环',
  ])

  // 循环类命令的首尾配对
  const loopPairs: Record<string, string> = {
    '判断循环首': '判断循环尾', '循环判断首': '循环判断尾',
    '计次循环首': '计次循环尾', '变量循环首': '变量循环尾',
  }
  const loopEndValues = new Set(Object.values(loopPairs))

  const lines = normalizeEycText(src).split('\n')
  const result: string[] = []

  // 帧类型：
  // 'branch': 如果/如果真/判断 分支帧，有标记前缀，body 在输出中与命令同缩进
  // 'loop': 循环结构帧，无标记前缀，body 在输出中为命令缩进+4
  interface Frame {
    kind: 'branch' | 'loop'
    // branch 专用
    type?: '如果' | '如果真' | '判断'
    marker?: string        // \u200C / \u200D / \u2060
    // 通用
    outBodyIndent: number  // body 行在输出中的基础缩进
    srcBodyIndent: number  // body 行在源码中的起始缩进（= 源命令缩进 + 4）
    baseIndent: number     // 此结构命令在输出中的缩进
    trueMarkerEmitted?: boolean // 仅 branch 使用：当前真分支阶段是否已输出过 \u200C 标记
    // loop 专用
    endKw?: string
  }
  const stack: Frame[] = []

  function ensureTrueMarker(frame: Frame | null): void {
    if (!frame || frame.kind !== 'branch') return
    if (frame.marker !== FLOW_TRUE_MARK) return
    if (frame.trueMarkerEmitted) return
    result.push(' '.repeat(frame.baseIndent) + FLOW_TRUE_MARK)
    frame.trueMarkerEmitted = true
  }

  function getIndent(line: string): number {
    return line.length - line.trimStart().length
  }

  // 计算一行在源码中的缩进应该映射到输出中的什么缩进
  // 同时返回活跃的分支标记（如果当前最内层不是 loop）
  function mapLine(srcIndent: number): { outIndent: number; marker: string } {
    if (stack.length === 0) return { outIndent: srcIndent, marker: '' }

    const top = stack[stack.length - 1]
    const relativeIndent = Math.max(0, srcIndent - top.srcBodyIndent)
    const outIndent = top.outBodyIndent + relativeIndent

    // 确定标记：如果最内层帧是 loop，不加标记
    let marker = ''
    if (top.kind === 'branch') {
      marker = top.marker!
    }
    // 如果最内层是 loop，marker 为空（loop 内部不加外层 branch 标记）
    return { outIndent, marker }
  }

  // 内层流程命令在 branch 体内需要额外保留一级缩进，
  // 与编辑器原生输入流程命令后生成的内部格式保持一致。
  function mapFlowCommandIndent(srcIndent: number): number {
    const { outIndent } = mapLine(srcIndent)
    if (stack.length === 0) return outIndent

    const top = stack[stack.length - 1]
    if (top.kind !== 'branch') return outIndent

    const relativeIndent = Math.max(0, srcIndent - top.srcBodyIndent)
    return top.outBodyIndent + 4 + relativeIndent
  }

  for (const raw of lines) {
    const trimmed = raw.trimStart()
    const indent = getIndent(raw)

    // 空行
    if (!trimmed) {
      // 流程结构内部的空白行会制造额外“空白流程行”，在粘贴转换阶段直接跳过。
      if (stack.length > 0) continue
      result.push(raw)
      continue
    }

    // 非点前缀行 → 普通代码
    if (!trimmed.startsWith('.')) {
      const { outIndent, marker } = mapLine(indent)
      result.push(' '.repeat(outIndent) + marker + trimmed)
      if (marker === FLOW_TRUE_MARK && stack.length > 0) {
        const top = stack[stack.length - 1]
        if (top.kind === 'branch') top.trueMarkerEmitted = true
      }
      continue
    }

    // 点前缀行
    const kw = trimmed.slice(1).split(/[\s(（]/)[0]

    // 非流程关键词→ 保留原样（加标记和缩进调整）
    if (!flowDotKeywords.has(kw)) {
      const { outIndent, marker } = mapLine(indent)
      result.push(' '.repeat(outIndent) + marker + trimmed)
      if (marker === FLOW_TRUE_MARK && stack.length > 0) {
        const top = stack[stack.length - 1]
        if (top.kind === 'branch') top.trueMarkerEmitted = true
      }
      continue
    }

    // ========== 流程关键词处理 ==========

    // .如果 / .如果真 / .判断 → 开启分支结构
    if (kw === '如果' || kw === '如果真' || kw === '判断') {
      const outIndent = mapFlowCommandIndent(indent)
      result.push(' '.repeat(outIndent) + trimmed.slice(1))
      const branchType = kw as '如果' | '如果真' | '判断'
      // 与手工输入行为一致：
      // - 如果/判断 的正文使用 \u200C 分支标记
      // - 如果真 的正文不使用 \u200C，仅依赖结束标记 \u200D
      const marker = branchType === '如果真' ? '' : FLOW_TRUE_MARK
      stack.push({
        kind: 'branch',
        type: branchType,
        marker,
        baseIndent: outIndent,
        outBodyIndent: outIndent,
        srcBodyIndent: indent + 4,
        trueMarkerEmitted: false,
      })
      continue
    }

    // .否则 → 如果结构从真分支切换到否则分支
    if (kw === '否则') {
      // 弹出中间帧直到找到最近的如果
      while (stack.length > 0) {
        const top = stack[stack.length - 1]
        if (top.kind === 'branch' && top.type === '如果') {
          // 真分支空时 ensureTrueMarker 会新推一行 `[C]`，
          // 此时直接将 else-open 标记追加到同一行上构成 `[C][D]`，
          // 避免在表格模式则多出一行空行。
          const beforeLen = result.length
          ensureTrueMarker(top)
          if (result.length > beforeLen) {
            const idx = result.length - 1
            result[idx] = result[idx] + FLOW_ELSE_MARK
          } else {
            // 真分支已有直接内容时，回退到单独新行的 `[D]` 标记。后续回写侧通过
            // “同缩进后续还有 [D] ”的前向扫描区分 else-open 和 close。
            result.push(' '.repeat(top.baseIndent) + FLOW_ELSE_MARK)
          }
          top.marker = FLOW_ELSE_MARK
          top.trueMarkerEmitted = true
          top.srcBodyIndent = indent + 4
          break
        }
        stack.pop()
      }
      continue
    }

    // .默认 → 判断结构切换到默认分支
    if (kw === '默认') {
      while (stack.length > 0) {
        const top = stack[stack.length - 1]
        if (top.kind === 'branch' && top.type === '判断') {
          const beforeLen = result.length
          ensureTrueMarker(top)
          if (result.length > beforeLen) {
            const idx = result.length - 1
            result[idx] = result[idx] + FLOW_JUDGE_END_MARK
          } else {
            result.push(' '.repeat(top.baseIndent) + FLOW_JUDGE_END_MARK)
          }
          top.marker = FLOW_JUDGE_END_MARK
          top.trueMarkerEmitted = true
          top.srcBodyIndent = indent + 4
          break
        }
        stack.pop()
      }
      continue
    }

    // .如果结束 → 输出结束标记并弹出帧
    if (kw === '如果结束') {
      // 弹出直到找到匹配的如果帧
      let frame: Frame | null = null
      while (stack.length > 0) {
        const top = stack[stack.length - 1]
        if (top.kind === 'branch' && top.type === '如果') {
          frame = stack.pop()!
          break
        }
        stack.pop()
      }
      ensureTrueMarker(frame)
      // 内层结束行只承载内层结束标记，不与外层分支标记合并
      // 外层标记由后续 body 行通过 mapLine 自然带出
      if (frame) {
        result.push(' '.repeat(frame.baseIndent) + FLOW_ELSE_MARK)
      } else {
        result.push(' '.repeat(indent) + FLOW_ELSE_MARK)
      }
      continue
    }

    // .如果真结束
    if (kw === '如果真结束') {
      let frame: Frame | null = null
      while (stack.length > 0) {
        const top = stack[stack.length - 1]
        if (top.kind === 'branch' && top.type === '如果真') {
          frame = stack.pop()!
          break
        }
        stack.pop()
      }
      ensureTrueMarker(frame)
      if (frame) {
        result.push(' '.repeat(frame.baseIndent) + FLOW_ELSE_MARK)
      } else {
        result.push(' '.repeat(indent) + FLOW_ELSE_MARK)
      }
      continue
    }

    // .判断结束
    if (kw === '判断结束') {
      let frame: Frame | null = null
      while (stack.length > 0) {
        const top = stack[stack.length - 1]
        if (top.kind === 'branch' && top.type === '判断') {
          frame = stack.pop()!
          break
        }
        stack.pop()
      }
      ensureTrueMarker(frame)
      if (frame) {
        result.push(' '.repeat(frame.baseIndent) + FLOW_JUDGE_END_MARK)
      } else {
        result.push(' '.repeat(indent) + FLOW_JUDGE_END_MARK)
      }
      continue
    }

    // 循环开始命令
    if (loopPairs[kw]) {
      const outIndent = mapFlowCommandIndent(indent)
      result.push(' '.repeat(outIndent) + trimmed.slice(1))
      stack.push({
        kind: 'loop',
        endKw: loopPairs[kw],
        baseIndent: outIndent,
        outBodyIndent: outIndent + 4,
        srcBodyIndent: indent + 4,
      })
      continue
    }

    // 循环结束命令
    if (loopEndValues.has(kw)) {
      // 弹出对应的 loop 帧
      if (stack.length > 0 && stack[stack.length - 1].kind === 'loop' && stack[stack.length - 1].endKw === kw) {
        const loopFrame = stack.pop()!
        result.push(' '.repeat(loopFrame.baseIndent) + trimmed.slice(1))
      } else {
        const { outIndent } = mapLine(indent)
        result.push(' '.repeat(outIndent) + trimmed.slice(1))
      }
      continue
    }

    // 其他流程关键词（返回、结束、到循环尾、跳出循环）→ 去点 + 保持标记
    const { outIndent, marker } = mapLine(indent)
    result.push(' '.repeat(outIndent) + marker + trimmed.slice(1))
  }

  return result.join('\n')
}

function eycToYiFormat(text: string): string {
  const flowKeywords = new Set([
    '如果', '如果真', '否则', '如果结束', '如果真结束', '判断', '默认', '判断结束',
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
    type: '如果' | '如果真' | '判断'
    elseEntered: boolean
  }
  const branchStack: Frame[] = []

  const startsWithMarkerAtIndent = (line: string, indent: string, marker: string): boolean => {
    return line.startsWith(indent + marker)
  }

  const updateBranchStackByKw = (kw: string): void => {
    if (kw === '如果' || kw === '如果真' || kw === '判断') {
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
      if (top && top.type === '判断') branchStack.pop()
    }
  }

  const noAutoCloseStartKeywords = new Set([
    '如果', '如果真', '判断',
    '判断循环首', '循环判断首', '计次循环首', '变量循环首',
  ])
  const branchStartKeywords = new Set(['如果', '如果真', '判断'])

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
        if (top && top.type === '判断' && !top.elseEntered) {
          out.push(indent + '.默认')
          top.elseEntered = true
        } else {
          out.push(indent + '.判断结束')
          if (top && top.type === '判断') branchStack.pop()
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
        if (top && top.type === '判断' && !top.elseEntered) {
          out.push(branchIndent + '.默认')
          top.elseEntered = true
        }
        emitMarkerRestLine(rest, indent, bodyIndent)
        if (!noAutoCloseStartKeywords.has(restKw) && !startsWithMarkerAtIndent(nextLine, indent, FLOW_JUDGE_END_MARK)) {
          out.push(branchIndent + '.判断结束')
        }
      } else {
        const top = branchStack[branchStack.length - 1]
        if (top && top.type === '判断' && !top.elseEntered
          && hasLaterEmptyMarkerAtIndent(i, indent.length, FLOW_JUDGE_END_MARK)) {
          out.push(indent + '.默认')
          top.elseEntered = true
        } else {
          out.push(indent + '.判断结束')
          if (top && top.type === '判断') branchStack.pop()
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
  return convertYiFlowToInternal(text)
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
    ? normalizeEycText(clipText)
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
    ? normalizeEycText(text)
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
