import type { RenderBlock } from './eycTableModel'

export interface FlowSegment {
  depth: number
  type: 'start' | 'end' | 'branch' | 'through'
  isLoop: boolean
  isMarker?: boolean
  markerInnerVert?: boolean
  hasInnerVert?: boolean
  hasExtraEnds?: boolean
  isInnerThrough?: boolean
  isInnerEnd?: boolean
  hasNextFlow?: boolean
  hasPrevFlowEnd?: boolean
  hasInnerLink?: boolean
  hasOuterLink?: boolean
  outerHidden?: boolean
  isStraightEnd?: boolean
}

export interface FlowBlock {
  startLine: number
  endLine: number
  branchLines: number[]
  depth: number
  isLoop: boolean
  keyword?: string
  extraEndLines?: number[]
  extraBranchLines?: number[]
}

export interface FlowSection {
  char: string | null
  startLine: number
  endLine: number
  count: number
}

export const FLOW_START: Record<string, string> = {
  '如果': '如果结束', '如果真': '如果真结束',
  '判断': '判断结束',
  '判断循环首': '判断循环尾', '循环判断首': '循环判断尾',
  '计次循环首': '计次循环尾', '变量循环首': '变量循环尾',
}

export const FLOW_LOOP_KW = new Set(['判断循环首', '循环判断首', '计次循环首', '变量循环首'])
export const FLOW_LINK_COMMANDS = new Set(['如果', '如果真', '判断'])
export const FLOW_BRANCH_KW = new Set(['否则', '默认', '\u200C'])
export const FLOW_END_KW = new Set([...Object.values(FLOW_START), '\u200D', '\u2060'])

export const FLOW_AUTO_COMPLETE: Record<string, (string | null)[]> = {
  '如果': ['\u200C', '\u200D', null],
  '如果真': ['\u200D', null],
  '判断': ['\u200C', '\u2060', null],
  '判断循环首': ['判断循环尾'],
  '循环判断首': ['循环判断尾'],
  '计次循环首': ['计次循环尾'],
  '变量循环首': ['变量循环尾'],
}

export const FLOW_AUTO_TAG = '\u200B'
export const FLOW_TRUE_MARK = '\u200C'
export const FLOW_ELSE_MARK = '\u200D'
export const FLOW_JUDGE_END_MARK = '\u2060'

export const FLOW_KW = new Set([
  '如果真', '如果真结束', '判断', '判断结束', '默认', '否则',
  '如果', '返回', '结束', '到循环尾', '跳出循环',
  '循环判断首', '循环判断尾', '判断循环首', '判断循环尾',
  '计次循环首', '计次循环尾', '变量循环首', '变量循环尾', '如果结束',
])

export function extractFlowKw(codeLine: string): string | null {
  const trimmed = codeLine.replace(/^ +/, '')
  if (trimmed.startsWith('\u200C')) return '\u200C'
  if (trimmed.startsWith('\u200D')) return '\u200D'
  if (trimmed.startsWith('\u2060')) return '\u2060'
  let stripped = trimmed.replace(/[\r\t\u200B]/g, '')
  if (stripped.startsWith('.')) stripped = stripped.slice(1)
  const allKw = [
    '如果真结束', '如果结束', '判断结束',
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
      const pattern = FLOW_AUTO_COMPLETE[kw]
      if (pattern.some(p => p === '\u200C' || p === '\u200D' || p === '\u2060')) {
        cmdLine = i
      }
    }
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
      while (pos < allLines.length && allLines[pos].replace(/^ +/, '').startsWith(p)) pos++
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
  const stack: { keyword: string; lineIndex: number; isLoop: boolean; depth: number; branches: number[] }[] = []
  const flowBlocks: FlowBlock[] = []

  const markerLines = new Set<number>()
  const codeBlocks: RenderBlock[] = []
  const boundaryIndices = new Set<number>()
  for (const blk of blocks) {
    if (blk.kind === 'table' && (blk.tableType === 'sub' || blk.tableType === 'assembly')) {
      boundaryIndices.add(codeBlocks.length)
    }
    if (blk.kind === 'codeline' && blk.codeLine) codeBlocks.push(blk)
  }
  const skipIndices = new Set<number>()
  for (let ci = 0; ci < codeBlocks.length; ci++) {
    if (skipIndices.has(ci)) continue
    if (boundaryIndices.has(ci)) stack.length = 0
    const blk = codeBlocks[ci]
    const kw = extractFlowKw(blk.codeLine!)
    if (!kw) continue

    if (kw === FLOW_TRUE_MARK || kw === FLOW_ELSE_MARK || kw === FLOW_JUDGE_END_MARK) {
      markerLines.add(blk.lineIndex)
    }

    if (FLOW_START[kw]) {
      let merged = false
      if (kw === '判断' && stack.length > 0 && stack[stack.length - 1].keyword === '判断') {
        const curIndent = blk.codeLine!.length - blk.codeLine!.replace(/^ +/, '').length
        const topBlk = codeBlocks.find(cb => cb.lineIndex === stack[stack.length - 1].lineIndex)
        const topIndent = topBlk ? topBlk.codeLine!.length - topBlk.codeLine!.replace(/^ +/, '').length : -1
        if (curIndent === topIndent) {
          stack[stack.length - 1].branches.push(blk.lineIndex)
          merged = true
        }
      }
      if (!merged) {
        stack.push({ keyword: kw, lineIndex: blk.lineIndex, isLoop: FLOW_LOOP_KW.has(kw), depth: stack.length, branches: [] })
      }
    } else if (FLOW_BRANCH_KW.has(kw)) {
      if (stack.length > 0) {
        const branchIndent = blk.codeLine!.length - blk.codeLine!.replace(/^ +/, '').length
        let targetIdx = stack.length - 1
        for (let si = stack.length - 1; si >= 0; si--) {
          const entry = stack[si]
          const entryBlk = codeBlocks.find(cb => cb.lineIndex === entry.lineIndex)
          const entryIndent = entryBlk ? entryBlk.codeLine!.length - entryBlk.codeLine!.replace(/^ +/, '').length : -1
          if (entryIndent !== branchIndent) continue
          if (kw === FLOW_TRUE_MARK && (entry.keyword === '如果' || entry.keyword === '如果真' || entry.keyword === '判断')) { targetIdx = si; break }
          if (kw === '否则' && entry.keyword === '如果') { targetIdx = si; break }
          if (kw === '默认' && entry.keyword === '判断') { targetIdx = si; break }
        }
        if (kw === FLOW_TRUE_MARK) {
          const extraLines: number[] = []
          let lastBranchCi = ci
          for (let j = ci + 1; j < codeBlocks.length; j++) {
            const nextKw = extractFlowKw(codeBlocks[j].codeLine!)
            if (nextKw !== FLOW_TRUE_MARK) break
            const nextIndent = codeBlocks[j].codeLine!.length - codeBlocks[j].codeLine!.replace(/^ +/, '').length
            if (nextIndent !== branchIndent) break
            markerLines.add(codeBlocks[j].lineIndex)
            extraLines.push(blk.lineIndex)
            lastBranchCi = j
            skipIndices.add(j)
          }
          if (extraLines.length > 0) {
            const entry = stack[targetIdx] as typeof stack[number] & { _extraBranch?: number[] }
            if (!entry._extraBranch) entry._extraBranch = []
            entry._extraBranch.push(...extraLines)
            stack[targetIdx].branches.push(codeBlocks[lastBranchCi].lineIndex)
          } else {
            stack[targetIdx].branches.push(blk.lineIndex)
          }
        } else {
          stack[targetIdx].branches.push(blk.lineIndex)
        }
      }
    } else if (FLOW_END_KW.has(kw)) {
      const endIndent = blk.codeLine!.length - blk.codeLine!.replace(/^ +/, '').length
      let matchIdx = -1
      for (let si = stack.length - 1; si >= 0; si--) {
        const entry = stack[si]
        const entryBlk = codeBlocks.find(cb => cb.lineIndex === entry.lineIndex)
        const entryIndent = entryBlk ? entryBlk.codeLine!.length - entryBlk.codeLine!.replace(/^ +/, '').length : -1
        if (entryIndent !== endIndent) continue
        if (FLOW_START[entry.keyword] === kw) { matchIdx = si; break }
        if (kw === FLOW_ELSE_MARK && (entry.keyword === '如果' || entry.keyword === '如果真')) { matchIdx = si; break }
        if (kw === FLOW_JUDGE_END_MARK && entry.keyword === '判断') { matchIdx = si; break }
      }
      if (matchIdx >= 0) {
        while (stack.length > matchIdx + 1) stack.pop()
        const extraEndLines: number[] = []
        if (kw === FLOW_ELSE_MARK || kw === FLOW_JUDGE_END_MARK) {
          for (let j = ci + 1; j < codeBlocks.length; j++) {
            const nextKw = extractFlowKw(codeBlocks[j].codeLine!)
            if (nextKw !== kw) break
            const nextIndent = codeBlocks[j].codeLine!.length - codeBlocks[j].codeLine!.replace(/^ +/, '').length
            if (nextIndent !== endIndent) break
            markerLines.add(codeBlocks[j].lineIndex)
            extraEndLines.push(codeBlocks[j].lineIndex)
            skipIndices.add(j)
          }
        }
        const entry = stack.pop()! as typeof stack[number] & { _extraBranch?: number[] }
        const extraBranch: number[] = entry._extraBranch || []
        flowBlocks.push({
          startLine: entry.lineIndex,
          endLine: blk.lineIndex,
          branchLines: entry.branches,
          depth: entry.depth,
          isLoop: entry.isLoop,
          keyword: entry.keyword,
          extraEndLines: extraEndLines.length > 0 ? extraEndLines : undefined,
          extraBranchLines: extraBranch.length > 0 ? extraBranch : undefined,
        })
      }
    }
  }

  for (const fb of flowBlocks) {
    if (fb.keyword !== '如果' && fb.keyword !== '如果真') continue
    const trueBranches = fb.branchLines.filter(bl => markerLines.has(bl))
    if (trueBranches.length <= 1) continue
    trueBranches.sort((a, b) => a - b)
    const lastTrue = trueBranches[trueBranches.length - 1]
    for (const bl of trueBranches) {
      if (bl === lastTrue) continue
      const idx = fb.branchLines.indexOf(bl)
      if (idx >= 0) fb.branchLines.splice(idx, 1)
      if (!fb.extraBranchLines) fb.extraBranchLines = []
      fb.extraBranchLines.push(bl)
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
    addSeg(fb.startLine, { depth: fb.depth, type: 'start', isLoop: fb.isLoop })

    const markerBranches = fb.branchLines.filter(bl => markerLines.has(bl))
    const lastMarkerBranch = markerBranches.length > 0 ? markerBranches[markerBranches.length - 1] : undefined

    const hasExtras = fb.extraEndLines && fb.extraEndLines.length > 0
    const isStraight = markerBranches.length === 0 && markerLines.has(fb.endLine)
    addSeg(fb.endLine, { depth: fb.depth, type: 'end', isLoop: fb.isLoop, isMarker: markerBranches.length > 0 && markerLines.has(fb.endLine), hasExtraEnds: hasExtras || undefined, isStraightEnd: isStraight || undefined })

    for (const bl of fb.branchLines) {
      if (markerLines.has(bl)) {
        addSeg(bl, { depth: fb.depth, type: 'branch', isLoop: fb.isLoop, isMarker: true, markerInnerVert: bl === lastMarkerBranch || undefined })
      } else {
        addSeg(bl, { depth: fb.depth, type: 'branch', isLoop: fb.isLoop })
      }
    }

    if (fb.extraEndLines) {
      for (let k = 0; k < fb.extraEndLines.length; k++) {
        const el = fb.extraEndLines[k]
        const isLast = k === fb.extraEndLines.length - 1
        addSeg(el, { depth: fb.depth, type: 'through', isLoop: fb.isLoop, isInnerThrough: !isLast || undefined, isInnerEnd: isLast || undefined })
      }
    }

    const extraBranchSet = new Set(fb.extraBranchLines || [])
    if (fb.extraBranchLines) {
      for (const el of fb.extraBranchLines) {
        addSeg(el, { depth: fb.depth, type: 'through', isLoop: fb.isLoop })
      }
    }

    const markerEndLine = markerLines.has(fb.endLine) ? fb.endLine : undefined
    const lastExtraEnd = fb.extraEndLines ? fb.extraEndLines[fb.extraEndLines.length - 1] : undefined
    const innerVertEnd = lastExtraEnd ?? markerEndLine
    const firstMarkerBranch = markerBranches.length > 0 ? markerBranches[0] : undefined
    for (let li = fb.startLine + 1; li < fb.endLine; li++) {
      if (renderedLines.has(li) && !fb.branchLines.includes(li) && !extraBranchSet.has(li)) {
        const needInnerVert = firstMarkerBranch !== undefined && innerVertEnd !== undefined && li > firstMarkerBranch && li < innerVertEnd
        addSeg(li, { depth: fb.depth, type: 'through', isLoop: fb.isLoop, hasInnerVert: needInnerVert || undefined })
      }
    }

    if (firstMarkerBranch !== undefined && innerVertEnd !== undefined) {
      for (const bl of fb.branchLines) {
        if (!markerLines.has(bl) && bl > firstMarkerBranch && bl < innerVertEnd) {
          const segs = map.get(bl)
          if (segs) {
            const seg = segs.find(s => s.type === 'branch' && s.depth === fb.depth)
            if (seg) {
              seg.hasInnerVert = true
              seg.hasInnerLink = true
              const nextMarker = fb.branchLines.find(b => b > bl && markerLines.has(b))
              if (nextMarker !== undefined) {
                const nextSegs = map.get(nextMarker)
                if (nextSegs) {
                  const nextSeg = nextSegs.find(s => s.type === 'branch' && s.depth === fb.depth && s.isMarker)
                  if (nextSeg) nextSeg.hasOuterLink = true
                }
              }
            }
          }
        }
      }
    }
  }

  for (const fb of flowBlocks) {
    const markerBranches = fb.branchLines.filter(bl => markerLines.has(bl))
    const lastMB = markerBranches.length > 0 ? markerBranches[markerBranches.length - 1] : undefined
    if (lastMB === undefined) continue
    const nextLine = lastMB + 1
    const nestedFb = flowBlocks.find(b => b.startLine === nextLine && b.depth > fb.depth)
    if (!nestedFb) continue
    const throughSegs = map.get(nextLine)
    if (throughSegs) {
      const seg = throughSegs.find(s => s.type === 'through' && s.depth === fb.depth && s.hasInnerVert)
      if (seg) {
        seg.hasInnerLink = true
      }
    }
    const startSegs = map.get(nextLine)
    if (startSegs) {
      const seg = startSegs.find(s => s.type === 'start' && s.depth === nestedFb.depth)
      if (seg) seg.hasOuterLink = true
    }
    for (let li = nextLine + 1; li <= fb.endLine; li++) {
      const lineSegs = map.get(li)
      if (!lineSegs) continue
      const seg = lineSegs.find(s => s.depth === fb.depth)
      if (seg) {
        seg.outerHidden = true
      }
    }
    if (fb.extraEndLines) {
      for (const el of fb.extraEndLines) {
        const lineSegs = map.get(el)
        if (!lineSegs) continue
        const seg = lineSegs.find(s => s.depth === fb.depth)
        if (seg) {
          seg.outerHidden = true
        }
      }
    }
  }

  for (const fb of flowBlocks) {
    if (!markerLines.has(fb.endLine)) continue
    const lastBlockLine = (fb.extraEndLines && fb.extraEndLines.length > 0)
      ? fb.extraEndLines[fb.extraEndLines.length - 1]
      : fb.endLine
    let nextLineIndex = -1
    let nextCodeLine: string | null = null
    for (const cb of codeBlocks) {
      if (cb.lineIndex > lastBlockLine) {
        nextLineIndex = cb.lineIndex
        nextCodeLine = cb.codeLine!
        break
      }
    }
    if (!nextCodeLine || nextLineIndex < 0) continue
    const nextKw = extractFlowKw(nextCodeLine)
    if (!nextKw || !FLOW_LINK_COMMANDS.has(nextKw)) continue
    if (nextLineIndex !== lastBlockLine + 1) continue
    const nextFb = flowBlocks.find(b => b.startLine === nextLineIndex)
    if (!nextFb || nextFb.depth !== fb.depth) continue

    if (fb.extraEndLines && fb.extraEndLines.length > 0) {
      const lastExtra = fb.extraEndLines[fb.extraEndLines.length - 1]
      const extraSegs = map.get(lastExtra)
      if (extraSegs) {
        const seg = extraSegs.find(s => s.isInnerEnd && s.depth === fb.depth)
        if (seg) { seg.isInnerEnd = undefined; seg.isInnerThrough = true; seg.hasNextFlow = true }
      }
    } else {
      const endSegs = map.get(fb.endLine)
      if (endSegs) {
        const seg = endSegs.find(s => s.type === 'end' && s.depth === fb.depth && s.isMarker)
        if (seg) seg.hasNextFlow = true
      }
    }
    const startSegs = map.get(nextLineIndex)
    if (startSegs) {
      const seg = startSegs.find(s => s.type === 'start' && s.depth === fb.depth)
      if (seg) seg.hasPrevFlowEnd = true
    }
  }

  return { map, maxDepth }
}
