import type { ReactNode } from 'react'
import type { FlowSegment } from './eycFlow'

export interface FlowLineColors {
  main: string
  branch: string
  loop: string
  arrow: string
  innerLink: string
}

interface FlowLinesState {
  map: Map<number, FlowSegment[]>
  maxDepth: number
}

interface RenderFlowSegsParams {
  flowLines: FlowLinesState
  lineIndex: number
  isExpanded?: boolean
  resolveColors: (depth: number) => FlowLineColors
}

interface RenderFlowContinuationParams {
  flowLines: FlowLinesState
  lineIndex: number
  resolveColors: (depth: number) => FlowLineColors
}

const setCssVars = (element: HTMLElement | null, vars: Record<string, string>): void => {
  if (!element) return
  for (const [name, value] of Object.entries(vars)) {
    element.style.setProperty(name, value)
  }
}

function applyFlowColors(element: HTMLElement | null, seg: FlowSegment, resolveColors: (depth: number) => FlowLineColors): void {
  const colors = resolveColors(seg.depth)
  setCssVars(element, {
    '--flow-main-color': colors.main,
    '--flow-branch-color': colors.branch,
    '--flow-loop-color': colors.loop,
    '--flow-arrow-color': colors.arrow,
    '--flow-inner-link-color': colors.innerLink,
  })
}

function getSegPriority(seg: FlowSegment): number {
  if (seg.type === 'branch') return 300
  if (seg.type === 'start') return 200
  if (seg.type === 'end') return 150
  return 100
}

function mergeSameDepthSeg(base: FlowSegment, incoming: FlowSegment): FlowSegment {
  const dominant = getSegPriority(incoming) >= getSegPriority(base) ? incoming : base
  const secondary = dominant === incoming ? base : incoming
  // suppressOuter 仅用于 through：避免同深度 merge 时把“隐藏外侧竖线”错误传播到 start/branch。
  // 对 through+through 的并存场景，只有双方都要求隐藏时才隐藏；避免误吞其它流程需要显示的外侧线。
  const mergedSuppressOuter = dominant.type === 'through'
    ? ((!!dominant.suppressOuter && !!secondary.suppressOuter) || undefined)
    : undefined
  return {
    ...dominant,
    isLoop: dominant.isLoop || secondary.isLoop,
    hasInnerVert: dominant.hasInnerVert || secondary.hasInnerVert || undefined,
    hasInnerVertFromAbove: dominant.hasInnerVertFromAbove || secondary.hasInnerVertFromAbove || undefined,
    hasInnerVertEnd: dominant.hasInnerVertEnd || secondary.hasInnerVertEnd || undefined,
    hasInnerVertEndConnected: dominant.hasInnerVertEndConnected || secondary.hasInnerVertEndConnected || undefined,
    suppressOuter: mergedSuppressOuter,
    hasNextFlow: dominant.hasNextFlow || secondary.hasNextFlow || undefined,
    hasPrevFlowEnd: dominant.hasPrevFlowEnd || secondary.hasPrevFlowEnd || undefined,
    hasInnerLink: dominant.hasInnerLink || secondary.hasInnerLink || undefined,
    hasOuterLink: dominant.hasOuterLink || secondary.hasOuterLink || undefined,
    endArrowOnly: dominant.endArrowOnly || secondary.endArrowOnly || undefined,
  }
}

export function renderFlowSegsLine(params: RenderFlowSegsParams): { node: ReactNode; skipTreeLines: number } {
  const { flowLines, lineIndex, isExpanded, resolveColors } = params
  if (flowLines.maxDepth === 0) return { node: null, skipTreeLines: 0 }

  const segs = flowLines.map.get(lineIndex) || []
  if (segs.length === 0) return { node: null, skipTreeLines: 0 }

  const lineMaxDepth = Math.max(...segs.map(s => s.depth)) + 1
  const slots: Array<FlowSegment | null> = Array(lineMaxDepth).fill(null)
  const depthSegsMap = new Map<number, FlowSegment[]>()
  for (const s of segs) {
    const depthList = depthSegsMap.get(s.depth)
    if (depthList) depthList.push(s)
    else depthSegsMap.set(s.depth, [s])
    const cur = slots[s.depth]
    slots[s.depth] = cur ? mergeSameDepthSeg(cur, s) : s
  }

  const hasAnyJudgeBranchStartOverlap = Array.from(depthSegsMap.values()).some(depthSegs => {
    const hasStart = depthSegs.some(seg => seg.type === 'start' && seg.flowKind === 'judge')
    const hasBranch = depthSegs.some(seg => seg.type === 'branch' && seg.flowKind === 'judge')
    return hasStart && hasBranch
  })

  return {
    node: (
      <>
        {slots.map((seg, d) => {
          const segsAtDepth = depthSegsMap.get(d) || []
          const startAtDepth = segsAtDepth.find(item => item.type === 'start')
          const branchAtDepth = segsAtDepth.find(item => item.type === 'branch')
          const hasStartPrevEndAtDepth = segsAtDepth.some(item => item.type === 'start' && !!item.hasPrevFlowEnd)
          const hasSameDepthBranchStartOverlap = !!(
            startAtDepth &&
            branchAtDepth &&
            startAtDepth.flowKind === 'judge' &&
            branchAtDepth.flowKind === 'judge'
          )

          if (hasSameDepthBranchStartOverlap && startAtDepth && branchAtDepth) {
            const branchHasInnerStartBelow = slots.slice(d + 1).some(next => next?.type === 'start')
            const startHasOuterBranchAbove = slots.slice(0, d).some(prev => prev?.type === 'branch')
            return (
              <span key={d} className="eyc-flow-overlap-slot">
                <span
                  className={`eyc-flow-seg eyc-flow-branch ${branchAtDepth.isLoop ? 'eyc-flow-loop' : ''}${branchAtDepth.suppressOuter ? ' eyc-flow-no-outer' : ''}${branchAtDepth.hasPrevFlowEnd ? ' eyc-flow-has-prev-end' : ''}${branchAtDepth.hasOuterLink ? ' eyc-flow-has-outer-link' : ''}${branchAtDepth.hasInnerLink ? ' eyc-flow-has-inner-link' : ''}${branchAtDepth.hasInnerVertFromAbove ? ' eyc-flow-inner-from-above' : ''} eyc-flow-stagger-upper${branchHasInnerStartBelow ? ' eyc-flow-stagger-upper' : ''}${hasAnyJudgeBranchStartOverlap ? ' eyc-flow-hide-down-arrows' : ''}`}
                  ref={(element) => {
                    applyFlowColors(element, branchAtDepth, resolveColors)
                  }}
                >
                  {branchAtDepth.hasInnerVert && <span className={`eyc-flow-inner-vert ${branchAtDepth.hasInnerVertEnd ? 'eyc-flow-inner-end' : 'eyc-flow-inner-through'}`} />}
                  {!hasStartPrevEndAtDepth && !hasSameDepthBranchStartOverlap && !hasAnyJudgeBranchStartOverlap && branchAtDepth.hasInnerVertEnd && !branchAtDepth.hasInnerVertEndConnected && <span className="eyc-flow-arrow-down eyc-flow-inner-arrow-down" />}
                  <span className="eyc-flow-arrow-right" />
                  {branchAtDepth.hasInnerLink && <span className="eyc-flow-outer-resume" />}
                  {branchAtDepth.hasInnerLink && <span className="eyc-flow-outer-horz" />}
                  {branchAtDepth.hasInnerLink && <span className="eyc-flow-outer-arrow" />}
                </span>
                <span
                  className={`eyc-flow-seg eyc-flow-start ${startAtDepth.isLoop ? 'eyc-flow-loop' : ''}${startAtDepth.suppressOuter ? ' eyc-flow-no-outer' : ''}${startAtDepth.hasPrevFlowEnd ? ' eyc-flow-has-prev-end' : ''}${startAtDepth.hasOuterLink ? ' eyc-flow-has-outer-link' : ''}${startAtDepth.hasInnerLink ? ' eyc-flow-has-inner-link' : ''}${startAtDepth.hasInnerVertFromAbove ? ' eyc-flow-inner-from-above' : ''} eyc-flow-stagger-lower${startHasOuterBranchAbove ? ' eyc-flow-stagger-lower' : ''}${hasAnyJudgeBranchStartOverlap ? ' eyc-flow-hide-down-arrows' : ''}`}
                  ref={(element) => {
                    applyFlowColors(element, startAtDepth, resolveColors)
                  }}
                >
                  {startAtDepth.hasPrevFlowEnd && <><span className="eyc-flow-link-vert" /><span className="eyc-flow-link-horz" /><span className="eyc-flow-link-arrow" /></>}
                  {startAtDepth.isLoop && <span className="eyc-flow-arrow-right" />}
                  {startAtDepth.hasInnerVert && <span className={`eyc-flow-inner-vert ${startAtDepth.hasInnerVertEnd ? 'eyc-flow-inner-end' : 'eyc-flow-inner-through'}`} />}
                  {!startAtDepth.hasPrevFlowEnd && !hasSameDepthBranchStartOverlap && !hasAnyJudgeBranchStartOverlap && startAtDepth.hasInnerVertEnd && !startAtDepth.hasInnerVertEndConnected && <span className="eyc-flow-arrow-down eyc-flow-inner-arrow-down" />}
                  {startAtDepth.hasInnerLink && <span className="eyc-flow-inner-link-horz" />}
                </span>
              </span>
            )
          }

          const hasInnerStartBelow = seg?.type === 'branch' && slots.slice(d + 1).some(next => next?.type === 'start')
          const hasOuterBranchAbove = seg?.type === 'start' && slots.slice(0, d).some(prev => prev?.type === 'branch')
          const hasStartSameDepth = segsAtDepth.some(item => item.type === 'start')
          const normalEndArrow = !!(seg?.type === 'end' && !seg?.hasNextFlow && !hasStartSameDepth)
          const arrowOnlyEndArrow = !!seg?.endArrowOnly
          const showEndArrow = !!(
            (!seg?.isLoop && !isExpanded && !hasStartPrevEndAtDepth && !hasSameDepthBranchStartOverlap && !hasAnyJudgeBranchStartOverlap)
            && (normalEndArrow || arrowOnlyEndArrow)
          )
          return (
          <span
            key={d}
            className={`eyc-flow-seg ${seg ? `eyc-flow-${seg.type}` : ''} ${seg?.isLoop ? 'eyc-flow-loop' : ''}${seg?.suppressOuter ? ' eyc-flow-no-outer' : ''}${seg?.hasPrevFlowEnd ? ' eyc-flow-has-prev-end' : ''}${seg?.hasOuterLink ? ' eyc-flow-has-outer-link' : ''}${seg?.hasInnerLink ? ' eyc-flow-has-inner-link' : ''}${seg?.hasInnerVertFromAbove ? ' eyc-flow-inner-from-above' : ''}${hasInnerStartBelow ? ' eyc-flow-stagger-upper' : ''}${hasOuterBranchAbove ? ' eyc-flow-stagger-lower' : ''}${hasAnyJudgeBranchStartOverlap ? ' eyc-flow-hide-down-arrows' : ''}`}
            ref={(element) => {
              if (!seg) return
              applyFlowColors(element, seg, resolveColors)
            }}
          >
            {seg?.type === 'branch' && seg?.hasInnerVert && <span className={`eyc-flow-inner-vert ${seg?.hasInnerVertEnd ? 'eyc-flow-inner-end' : 'eyc-flow-inner-through'}`} />}
            {seg?.type === 'branch' && seg?.hasInnerVertEnd && !seg?.hasInnerVertEndConnected && !hasStartPrevEndAtDepth && !hasSameDepthBranchStartOverlap && !hasAnyJudgeBranchStartOverlap && <span className="eyc-flow-arrow-down eyc-flow-inner-arrow-down" />}
            {seg?.type === 'branch' && <span className="eyc-flow-arrow-right" />}
            {seg?.type === 'branch' && seg?.hasInnerLink && <span className="eyc-flow-outer-resume" />}
            {seg?.type === 'branch' && seg?.hasInnerLink && <span className="eyc-flow-outer-horz" />}
            {seg?.type === 'branch' && seg?.hasInnerLink && <span className="eyc-flow-outer-arrow" />}
            {seg?.type === 'start' && seg?.hasPrevFlowEnd && <><span className="eyc-flow-link-vert" /><span className="eyc-flow-link-horz" /><span className="eyc-flow-link-arrow" /></>}
            {seg?.type === 'start' && seg?.isLoop && <span className="eyc-flow-arrow-right" />}
            {showEndArrow && <span className="eyc-flow-arrow-down" />}
            {seg?.hasInnerVert && seg?.type !== 'branch' && <span className={`eyc-flow-inner-vert ${seg?.hasInnerVertEnd ? 'eyc-flow-inner-end' : 'eyc-flow-inner-through'}`} />}
            {seg?.hasInnerVertEnd && !seg?.hasInnerVertEndConnected && seg?.type !== 'branch' && !hasStartPrevEndAtDepth && !hasSameDepthBranchStartOverlap && !hasAnyJudgeBranchStartOverlap && !(seg?.type === 'start' && seg?.hasPrevFlowEnd) && <span className="eyc-flow-arrow-down eyc-flow-inner-arrow-down" />}
            {seg?.hasInnerLink && seg?.type !== 'branch' && <span className="eyc-flow-inner-link-horz" />}
          </span>
          )
        })}
      </>
    ),
    skipTreeLines: lineMaxDepth,
  }
}

export function renderFlowContinuationLine(params: RenderFlowContinuationParams): ReactNode {
  const { flowLines, lineIndex, resolveColors } = params
  if (flowLines.maxDepth === 0) return null

  const segs = flowLines.map.get(lineIndex) || []
  if (segs.length === 0) return null

  const lineMaxDepth = Math.max(...segs.map(s => s.depth)) + 1
  const slots: Array<FlowSegment | null> = Array(lineMaxDepth).fill(null)
  for (const s of segs) {
    const cur = slots[s.depth]
    slots[s.depth] = cur ? mergeSameDepthSeg(cur, s) : s
  }

  const hasAny = slots.some(seg => seg && (seg.type === 'start' || seg.type === 'through' || seg.type === 'branch'))
  if (!hasAny) return null

  return (
    <div className="eyc-param-flow-cont">
      {slots.map((seg, d) => {
        const hasInnerCont = seg && (
          seg.hasInnerVert
        )
        const hasCont = seg && (seg.type === 'start' || seg.type === 'through' || seg.type === 'branch')
        const needsBothLines = seg && hasInnerCont && hasCont && (
          seg.hasInnerVert
        )
        return (
          <span
            key={d}
            className={`eyc-flow-seg eyc-flow-cont-seg ${hasCont ? (hasInnerCont ? (needsBothLines ? 'eyc-flow-through' : 'eyc-flow-through eyc-flow-cont-inner') : 'eyc-flow-through') : ''} ${seg?.isLoop && hasCont ? 'eyc-flow-loop' : ''}`}
            ref={(element) => {
              if (!seg) return
              applyFlowColors(element, seg, resolveColors)
            }}
          >
            {needsBothLines && <span className="eyc-flow-inner-vert eyc-flow-inner-through" />}
          </span>
        )
      })}
    </div>
  )
}
