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
    // loop 专用
    endKw?: string
  }
  const stack: Frame[] = []

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
      const { outIndent, marker } = mapLine(indent)
      if (marker) {
        // 找到最近的 branch baseIndent
        let branchBase = 0
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].kind === 'branch') { branchBase = stack[i].baseIndent; break }
        }
        result.push(' '.repeat(branchBase) + marker)
      } else {
        result.push(raw)
      }
      continue
    }

    // 非点前缀行 → 普通代码
    if (!trimmed.startsWith('.')) {
      const { outIndent, marker } = mapLine(indent)
      result.push(' '.repeat(outIndent) + marker + trimmed)
      continue
    }

    // 点前缀行
    const kw = trimmed.slice(1).split(/[\s(（]/)[0]

    // 非流程关键词→ 保留原样（加标记和缩进调整）
    if (!flowDotKeywords.has(kw)) {
      const { outIndent, marker } = mapLine(indent)
      result.push(' '.repeat(outIndent) + marker + trimmed)
      continue
    }

    // ========== 流程关键词处理 ==========

    // .如果 / .如果真 / .判断 → 开启分支结构
    if (kw === '如果' || kw === '如果真' || kw === '判断') {
      const outIndent = mapFlowCommandIndent(indent)
      result.push(' '.repeat(outIndent) + trimmed.slice(1))
      const branchType = kw as '如果' | '如果真' | '判断'
      const marker = kw === '判断' ? FLOW_TRUE_MARK : FLOW_TRUE_MARK
      stack.push({
        kind: 'branch',
        type: branchType,
        marker,
        baseIndent: outIndent,
        outBodyIndent: outIndent,
        srcBodyIndent: indent + 4,
      })
      continue
    }

    // .否则 → 如果结构从真分支切换到否则分支
    if (kw === '否则') {
      // 弹出中间帧直到找到最近的如果
      while (stack.length > 0) {
        const top = stack[stack.length - 1]
        if (top.kind === 'branch' && top.type === '如果') {
          top.marker = FLOW_ELSE_MARK
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
          top.marker = FLOW_JUDGE_END_MARK
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
  const out: string[] = []
  const branchStack: Array<'如果' | '如果真' | '判断'> = []

  for (let i = 0; i < srcLines.length; i++) {
    const raw = srcLines[i]
    const line = raw.replace(new RegExp(FLOW_AUTO_TAG, 'g'), '')
    const trimmed = line.trimStart()
    const indent = line.slice(0, line.length - trimmed.length)
    if (!trimmed) {
      out.push(line)
      continue
    }

    const nextTrimmed = i + 1 < srcLines.length
      ? srcLines[i + 1].replace(new RegExp(FLOW_AUTO_TAG, 'g'), '').trimStart()
      : ''
    const prevTrimmed = i > 0
      ? srcLines[i - 1].replace(new RegExp(FLOW_AUTO_TAG, 'g'), '').trimStart()
      : ''

    if (trimmed.startsWith(FLOW_TRUE_MARK)) {
      const rest = trimmed.slice(1)
      out.push(rest.trim() ? indent + rest : '')
      continue
    }
    if (trimmed.startsWith(FLOW_ELSE_MARK)) {
      const rest = trimmed.slice(1)
      if (rest.trim()) {
        if (!prevTrimmed.startsWith(FLOW_ELSE_MARK)) out.push(indent + '.否则')
        out.push(indent + rest)
        if (!nextTrimmed.startsWith(FLOW_ELSE_MARK)) out.push(indent + '.如果结束')
      } else {
        const currentBranch = branchStack[branchStack.length - 1]
        out.push(indent + (currentBranch === '如果真' ? '.如果真结束' : '.如果结束'))
        if (currentBranch === '如果' || currentBranch === '如果真') branchStack.pop()
      }
      continue
    }
    if (trimmed.startsWith(FLOW_JUDGE_END_MARK)) {
      const rest = trimmed.slice(1)
      if (rest.trim()) {
        if (!prevTrimmed.startsWith(FLOW_JUDGE_END_MARK)) out.push(indent + '.默认')
        out.push(indent + rest)
        if (!nextTrimmed.startsWith(FLOW_JUDGE_END_MARK)) out.push(indent + '.判断结束')
      } else {
        out.push(indent + '.判断结束')
        if (branchStack[branchStack.length - 1] === '判断') branchStack.pop()
      }
      continue
    }

    const kw = trimmed.split(/[\s(（]/)[0]
    if (kw === '如果' || kw === '如果真' || kw === '判断') {
      branchStack.push(kw)
    } else if (kw === '如果结束' || kw === '如果真结束') {
      if (branchStack[branchStack.length - 1] === '如果' || branchStack[branchStack.length - 1] === '如果真') branchStack.pop()
    } else if (kw === '判断结束') {
      if (branchStack[branchStack.length - 1] === '判断') branchStack.pop()
    }
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

function sanitizePastedTextForCurrent(text: string, currentSource: string): string {
  const normalized = eycToInternalFormat(text)
  if (!hasAssemblyDeclaration(currentSource)) return normalized

  return normalizeEycText(normalized)
    .split('\n')
    .filter(line => !line.trimStart().startsWith('.程序集 '))
    .join('\n')
}

export {
  normalizeEycText,
  eycToInternalFormat,
  eycToYiFormat,
  sanitizePastedTextForCurrent,
}
