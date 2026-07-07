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
// 连续的同类结构（判断→判断、如果真→如果真）在“结束行 -> 下一起始行”之间做连通桥接：
// 前块结束不画向下三角，改为向下拐到后块起始行、向右将箭头指向该起始命令。仅同类之间生效（见桥接循环的同类校验）。
export const FLOW_LINK_COMMANDS = new Set(['判断开始', '判断', '如果真'])
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

type FlowStackEntry = {
  keyword: string
  lineIndex: number
  indent: number
  isLoop: boolean
  depth: number
  branches: number[]
  caseStartLines: number[]
}

export function computeFlowLines(blocks: RenderBlock[]): { map: Map<number, FlowSegment[]>; maxDepth: number } {
  const stack: FlowStackEntry[] = []
  const flowBlocks: FlowBlock[] = []

  // 未闭合结构的隐式闭合：把结构线画到给定行为止，避免"漏写结束行 → 整块线消失、
  // 正文回退树状字符线"的混排（结束行缺失由编译诊断负责报错，流程线只保证可读）。
  const implicitClose = (entry: FlowStackEntry, endLine: number): void => {
    if (endLine <= entry.lineIndex) return
    flowBlocks.push({
      startLine: entry.lineIndex,
      endLine,
      branchLines: entry.branches,
      caseStartLines: entry.caseStartLines,
      depth: entry.depth,
      isLoop: entry.isLoop,
      keyword: entry.keyword,
    })
  }

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
    if (boundaryIndices.has(ci)) {
      // 子程序边界：仍未闭合的结构隐式闭合到边界前最后一行
      const prevLine = ci > 0 ? codeBlocks[ci - 1].lineIndex : -1
      while (stack.length > 0) implicitClose(stack.pop()!, prevLine)
    }
    const blk = codeBlocks[ci]
    const kw = extractFlowKw(blk.codeLine!)
    if (!kw) continue
    const indent = getIndent(blk.codeLine!)

    if (FLOW_START[kw]) {
      let merged = false
      if (kw === '判断' && stack.length > 0) {
        // 两段式匹配（与 否则/默认 FLOW_BRANCH_KW、结束行 FLOW_END_KW 路径一致）：
        // 先精确同缩进就近归属，仅当失败才退化到“判断开始 外退一层”启发式。
        // 否则外退启发式会抢在精确匹配之前，把与外层对齐的 .判断 分支误吞进未闭合的内层判断块（跨层污染）。
        let targetIdx = -1
        for (let si = stack.length - 1; si >= 0; si--) {
          const entry = stack[si]
          if (entry.keyword !== '判断开始' && entry.keyword !== '判断') continue
          if (entry.indent === indent) { targetIdx = si; break }
        }
        if (targetIdx < 0) {
          // 特殊结构：.判断() 相比 .判断开始/.默认/.判断结束 外退一层（少 4 空格），
          // 仍应视为同一判断块里的“分支开始”。
          for (let si = stack.length - 1; si >= 0; si--) {
            const entry = stack[si]
            if (entry.keyword === '判断开始' && (indent + 4) === entry.indent) { targetIdx = si; break }
          }
        }
        if (targetIdx >= 0) {
          // 归属到非栈顶判断块前，先隐式闭合其上未闭合的内层结构（与 FLOW_BRANCH_KW 路径 line 269-270 一致），
          // 否则内层流程线会跨越本分支行、内层 end 落进新分支体（兄弟结构串扰）。
          const innerEndLine = ci > 0 ? codeBlocks[ci - 1].lineIndex : -1
          while (stack.length > targetIdx + 1) implicitClose(stack.pop()!, innerEndLine)
          stack[targetIdx].branches.push(blk.lineIndex)
          stack[targetIdx].caseStartLines.push(blk.lineIndex)
          merged = true
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
        const matchesBranchOwner = (entry: FlowStackEntry): boolean => {
          if (kw === '否则' && entry.keyword === '如果') return true
          if (kw === '默认' && (entry.keyword === '判断开始' || entry.keyword === '判断')) return true
          return false
        }
        let targetIdx = -1
        for (let si = stack.length - 1; si >= 0; si--) {
          const entry = stack[si]
          if (entry.indent !== indent) continue
          if (matchesBranchOwner(entry)) { targetIdx = si; break }
        }
        // 缩进不匹配时回退：就近归属最内层同类结构，缩进错位的分支不再被静默丢弃
        if (targetIdx < 0) {
          for (let si = stack.length - 1; si >= 0; si--) {
            if (matchesBranchOwner(stack[si])) { targetIdx = si; break }
          }
        }
        if (targetIdx < 0) continue
        // 分支行之上的未闭合内层结构：隐式闭合到分支行上一行（内层块不得跨越外层分支边界）
        const innerEndLine = ci > 0 ? codeBlocks[ci - 1].lineIndex : -1
        while (stack.length > targetIdx + 1) implicitClose(stack.pop()!, innerEndLine)
        stack[targetIdx].branches.push(blk.lineIndex)
      }
    } else if (FLOW_END_KW.has(kw)) {
      let matchIdx = -1
      for (let si = stack.length - 1; si >= 0; si--) {
        const entry = stack[si]
        if (entry.indent !== indent) continue
        if (FLOW_START[entry.keyword] === kw) { matchIdx = si; break }
      }
      // 缩进不匹配时回退：就近闭合最内层同类结构，缩进错位不再导致整块流程线消失
      if (matchIdx < 0) {
        for (let si = stack.length - 1; si >= 0; si--) {
          if (FLOW_START[stack[si].keyword] === kw) { matchIdx = si; break }
        }
      }
      if (matchIdx >= 0) {
        // 被跨越的未闭合内层结构：隐式闭合到本结束行的上一行，保留其流程线
        const innerEndLine = ci > 0 ? codeBlocks[ci - 1].lineIndex : -1
        while (stack.length > matchIdx + 1) implicitClose(stack.pop()!, innerEndLine)
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

  // 文末仍未闭合的结构：隐式闭合到最后一行
  const lastCodeLine = codeBlocks.length > 0 ? codeBlocks[codeBlocks.length - 1].lineIndex : -1
  while (stack.length > 0) implicitClose(stack.pop()!, lastCodeLine)

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
    // 桥接（连通视觉）仅发生在“同类结构的结束行 → 下一同类结构的起始行”之间：判断→判断、如果真→如果真。
    // 前驱块本身必须是可桥接类型，且与后继同类——否则 如果结束/循环尾/跨类型 紧邻时会误画桥接连接件。
    const fbKind = resolveFlowKind(fb.keyword)
    if (fbKind !== 'judge' && fbKind !== 'ifTrue') continue
    const lastBlockLine = fb.endLine
    const codeIndex = codeIndexByLine.get(lastBlockLine)
    if (codeIndex === undefined) continue
    const nextCodeBlock = codeBlocks[codeIndex + 1]
    if (!nextCodeBlock) continue
    const nextLineIndex = nextCodeBlock.lineIndex
    const nextCodeLine = nextCodeBlock.codeLine!
    const nextKw = extractFlowKw(nextCodeLine)
    if (!nextKw || !FLOW_LINK_COMMANDS.has(nextKw)) continue
    if (resolveFlowKind(nextKw) !== fbKind) continue // 仅同类桥接
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
