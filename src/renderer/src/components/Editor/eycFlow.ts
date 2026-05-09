import type { RenderBlock } from './eycTableModel'

export interface FlowSegment {
  depth: number
  type: 'start' | 'end' | 'branch' | 'through'
  isLoop: boolean
  flowKind?: 'if' | 'judge' | 'ifTrue' | 'loop' | 'other'
  hasInnerVert?: boolean
  hasInnerVertFromAbove?: boolean
  hasInnerVertEnd?: boolean
  // 当“内侧线结束位置”紧跟同深度的下一个流程起始（end.hasNextFlow → start.hasPrevFlowEnd），
  // 内侧线视为向下连通到新流程，不再绘制结束位置的向下三角箭头。
  hasInnerVertEndConnected?: boolean
  suppressOuter?: boolean
  hasNextFlow?: boolean
  hasPrevFlowEnd?: boolean
  hasInnerLink?: boolean
  hasOuterLink?: boolean
  endArrowOnly?: boolean
}

export interface FlowBlock {
  startLine: number
  endLine: number
  branchLines: number[]
  caseStartLines: number[]
  depth: number
  isLoop: boolean
  keyword?: string
}

export interface FlowSection {
  char: string | null
  startLine: number
  endLine: number
  count: number
}

export const FLOW_START: Record<string, string> = {
  '如果': '如果结束', '如果真': '如果真结束',
  '判断开始': '判断结束',
  '判断': '判断结束',
  '判断循环首': '判断循环尾', '循环判断首': '循环判断尾',
  '计次循环首': '计次循环尾', '变量循环首': '变量循环尾',
}

export const FLOW_LOOP_KW = new Set(['判断循环首', '循环判断首', '计次循环首', '变量循环首'])
// 仅“判断”结构需要在“结束行 -> 下一起始行”之间做连通桥接（会形成上下两条横线）。
// “如果/如果真”连续出现时不应套用该视觉效果。
export const FLOW_LINK_COMMANDS = new Set(['判断开始', '判断'])
export const FLOW_BRANCH_KW = new Set(['否则', '默认'])
export const FLOW_END_KW = new Set(Object.values(FLOW_START))

export const FLOW_AUTO_COMPLETE: Record<string, (string | null)[]> = {
  '如果': [null, '否则', null, '如果结束'],
  '如果真': [null, '如果真结束'],
  '判断开始': [null, '默认', null, '判断结束'],
  '判断': [null, '默认', null, '判断结束'],
  '判断循环首': ['判断循环尾'],
  '循环判断首': ['循环判断尾'],
  '计次循环首': ['计次循环尾'],
  '变量循环首': ['变量循环尾'],
}

export const FLOW_AUTO_TAG = '\u200B'

function resolveFlowKind(keyword?: string): FlowSegment['flowKind'] {
  if (keyword === '如果') return 'if'
  if (keyword === '如果真') return 'ifTrue'
  if (keyword === '判断' || keyword === '判断开始') return 'judge'
  if (keyword && FLOW_LOOP_KW.has(keyword)) return 'loop'
  return 'other'
}

export const FLOW_KW = new Set([
  '如果真', '如果真结束', '判断开始', '判断', '判断结束', '默认', '否则',
  '如果', '返回', '结束', '到循环尾', '跳出循环',
  '循环判断首', '循环判断尾', '判断循环首', '判断循环尾',
  '计次循环首', '计次循环尾', '变量循环首', '变量循环尾', '如果结束',
])

export function extractFlowKw(codeLine: string): string | null {
  const trimmed = codeLine.replace(/^ +/, '')
  let stripped = trimmed.replace(/[\r\t\u200B]/g, '')
  if (stripped.startsWith('.')) stripped = stripped.slice(1)
  const allKw = [
    '如果真结束', '如果结束', '判断结束',
    '判断开始',
    '判断循环首', '判断循环尾', '循环判断首', '循环判断尾',
    '计次循环首', '计次循环尾', '变量循环首', '变量循环尾',
    '如果真', '如果', '判断', '否则', '默认',
  ]
  for (const kw of allKw) {
    if (stripped === kw || stripped.startsWith(kw + ' ') || stripped.startsWith(kw + '(') || stripped.startsWith(kw + '（')) {
      return kw
    }
  }
  return null
}

export function isFlowMarkerLine(lineText: string): boolean {
  const trimmed = lineText.replace(/^ +/, '')
  return trimmed.startsWith('\u200C') || trimmed.startsWith('\u200D') || trimmed.startsWith('\u2060')
}

export function findFlowStartLine(allLines: string[], markerLineIndex: number): number {
  const markerIndent = allLines[markerLineIndex].length - allLines[markerLineIndex].replace(/^ +/, '').length
  for (let i = markerLineIndex - 1; i >= 0; i--) {
    const line = allLines[i]
    const indent = line.length - line.replace(/^ +/, '').length
    if (indent !== markerIndent) continue
    const kw = extractFlowKw(line)
    if (kw && FLOW_START[kw]) return i
  }
  return -1
}

export function getFlowStructureAround(
  allLines: string[],
  lineIndex: number
): { cmdLine: number; sections: FlowSection[]; sectionIdx: number } | null {
  let cmdLine = -1
  for (let i = lineIndex; i >= 0; i--) {
    const line = allLines[i]
    const trimmed = line.replace(/^ +/, '')
    if (isFlowMarkerLine(line) || trimmed === '') continue
    const kw = extractFlowKw(line)
    if (kw && FLOW_AUTO_COMPLETE[kw]) {
      cmdLine = i
      break
    }
    if (kw && (FLOW_BRANCH_KW.has(kw) || FLOW_END_KW.has(kw))) continue
    break
  }
  if (cmdLine < 0) return null

  const kw = extractFlowKw(allLines[cmdLine])!
  const pattern = FLOW_AUTO_COMPLETE[kw]!
  const sections: FlowSection[] = []
  let pos = cmdLine + 1
  for (const p of pattern) {
    const start = pos
    if (p === null) {
      while (pos < allLines.length && allLines[pos].replace(/^ +/, '') === '') pos++
    } else {
      while (pos < allLines.length && allLines[pos].replace(/^ +/, '').replace(FLOW_AUTO_TAG, '').startsWith(p)) pos++
    }
    if (pos > start) {
      sections.push({ char: p, startLine: start, endLine: pos - 1, count: pos - start })
    }
  }

  const structEnd = sections.length > 0 ? sections[sections.length - 1].endLine : cmdLine
  if (lineIndex <= cmdLine || lineIndex > structEnd) return null

  let sectionIdx = -1
  for (let s = 0; s < sections.length; s++) {
    if (lineIndex >= sections[s].startLine && lineIndex <= sections[s].endLine) {
      sectionIdx = s
      break
    }
  }
  if (sectionIdx < 0) return null

  return { cmdLine, sections, sectionIdx }
}

export function computeFlowLines(blocks: RenderBlock[]): { map: Map<number, FlowSegment[]>; maxDepth: number } {
  const stack: { keyword: string; lineIndex: number; indent: number; isLoop: boolean; depth: number; branches: number[]; caseStartLines: number[] }[] = []
  const flowBlocks: FlowBlock[] = []

  const codeBlocks: RenderBlock[] = []
  const boundaryIndices = new Set<number>()
  for (const blk of blocks) {
    if (blk.kind === 'table' && (blk.tableType === 'sub' || blk.tableType === 'assembly')) {
      boundaryIndices.add(codeBlocks.length)
    }
    if (blk.kind === 'codeline' && blk.codeLine && !isFlowMarkerLine(blk.codeLine)) codeBlocks.push(blk)
  }
  const codeIndexByLine = new Map<number, number>()
  for (let ci = 0; ci < codeBlocks.length; ci++) codeIndexByLine.set(codeBlocks[ci].lineIndex, ci)
  const getIndent = (lineText: string): number => lineText.length - lineText.replace(/^ +/, '').length

  for (let ci = 0; ci < codeBlocks.length; ci++) {
    if (boundaryIndices.has(ci)) stack.length = 0
    const blk = codeBlocks[ci]
    const kw = extractFlowKw(blk.codeLine!)
    if (!kw) continue
    const indent = getIndent(blk.codeLine!)

    if (FLOW_START[kw]) {
      let merged = false
      if (kw === '判断' && stack.length > 0) {
        for (let si = stack.length - 1; si >= 0; si--) {
          const entry = stack[si]
          if (entry.keyword !== '判断开始' && entry.keyword !== '判断') continue
          const sameIndent = indent === entry.indent
          // 特殊结构：.判断() 相比 .判断开始/.默认/.判断结束 外退一层（少 4 空格），
          // 仍应视为同一判断块里的“分支开始”。
          const outdentOneLevelJudgeBranch = entry.keyword === '判断开始' && (indent + 4) === entry.indent
          if (!sameIndent && !outdentOneLevelJudgeBranch) continue
          entry.branches.push(blk.lineIndex)
          entry.caseStartLines.push(blk.lineIndex)
          merged = true
          break
        }
      }
      if (!merged) {
        stack.push({
          keyword: kw,
          lineIndex: blk.lineIndex,
          indent,
          isLoop: FLOW_LOOP_KW.has(kw),
          depth: stack.length,
          branches: [],
          caseStartLines: [],
        })
      }
    } else if (FLOW_BRANCH_KW.has(kw)) {
      if (stack.length > 0) {
        let targetIdx = -1
        for (let si = stack.length - 1; si >= 0; si--) {
          const entry = stack[si]
          if (entry.indent !== indent) continue
          if (kw === '否则' && entry.keyword === '如果') { targetIdx = si; break }
          if (kw === '默认' && (entry.keyword === '判断开始' || entry.keyword === '判断')) { targetIdx = si; break }
        }
        if (targetIdx < 0) continue
        stack[targetIdx].branches.push(blk.lineIndex)
      }
    } else if (FLOW_END_KW.has(kw)) {
      let matchIdx = -1
      for (let si = stack.length - 1; si >= 0; si--) {
        const entry = stack[si]
        if (entry.indent !== indent) continue
        if (FLOW_START[entry.keyword] === kw) { matchIdx = si; break }
      }
      if (matchIdx >= 0) {
        while (stack.length > matchIdx + 1) stack.pop()
        const entry = stack.pop()!
        flowBlocks.push({
          startLine: entry.lineIndex,
          endLine: blk.lineIndex,
          branchLines: entry.branches,
          caseStartLines: entry.caseStartLines,
          depth: entry.depth,
          isLoop: entry.isLoop,
          keyword: entry.keyword,
        })
      }
    }
  }

  const map = new Map<number, FlowSegment[]>()
  let maxDepth = 0
  const addSeg = (li: number, seg: FlowSegment) => {
    if (!map.has(li)) map.set(li, [])
    map.get(li)!.push(seg)
    if (seg.depth + 1 > maxDepth) maxDepth = seg.depth + 1
  }

  const renderedLines = new Set<number>()
  for (const blk of blocks) {
    if (blk.kind === 'codeline') renderedLines.add(blk.lineIndex)
    else for (const row of blk.rows) renderedLines.add(row.lineIndex)
  }

  for (const fb of flowBlocks) {
    const branchLineSet = new Set(fb.branchLines)
    const caseStartLineSet = new Set(fb.caseStartLines)
    const flowKind = resolveFlowKind(fb.keyword)
    addSeg(fb.startLine, { depth: fb.depth, type: 'start', isLoop: fb.isLoop, flowKind })
    addSeg(fb.endLine, { depth: fb.depth, type: 'end', isLoop: fb.isLoop, flowKind })

    for (const bl of fb.branchLines) {
      addSeg(bl, { depth: fb.depth, type: 'branch', isLoop: fb.isLoop, flowKind })
      if (caseStartLineSet.has(bl)) {
        addSeg(bl, { depth: fb.depth, type: 'start', isLoop: fb.isLoop, flowKind })
      }
    }

    for (let li = fb.startLine + 1; li < fb.endLine; li++) {
      if (renderedLines.has(li) && !branchLineSet.has(li)) {
        addSeg(li, { depth: fb.depth, type: 'through', isLoop: fb.isLoop, flowKind })
      }
    }
  }

  const flowBlockByStart = new Map<number, FlowBlock>()
  for (const fb of flowBlocks) flowBlockByStart.set(fb.startLine, fb)

  for (const fb of flowBlocks) {
    const lastBlockLine = fb.endLine
    const codeIndex = codeIndexByLine.get(lastBlockLine)
    if (codeIndex === undefined) continue
    const nextCodeBlock = codeBlocks[codeIndex + 1]
    if (!nextCodeBlock) continue
    const nextLineIndex = nextCodeBlock.lineIndex
    const nextCodeLine = nextCodeBlock.codeLine!
    const nextKw = extractFlowKw(nextCodeLine)
    if (!nextKw || !FLOW_LINK_COMMANDS.has(nextKw)) continue
    if (nextLineIndex !== lastBlockLine + 1) continue
    const nextFb = flowBlockByStart.get(nextLineIndex)
    if (!nextFb || nextFb.depth !== fb.depth) continue
    const endSegs = map.get(fb.endLine)
    if (endSegs) {
      const seg = endSegs.find(s => s.type === 'end' && s.depth === fb.depth)
      if (seg) seg.hasNextFlow = true
    }
    const startSegs = map.get(nextLineIndex)
    if (startSegs) {
      const seg = startSegs.find(s => s.type === 'start' && s.depth === fb.depth)
      if (seg) seg.hasPrevFlowEnd = true
    }
  }

  return { map, maxDepth }
}
