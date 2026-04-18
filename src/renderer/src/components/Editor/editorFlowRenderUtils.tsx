import type { CSSProperties, ReactNode } from 'react'
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

function createFlowStyle(seg: FlowSegment, resolveColors: (depth: number) => FlowLineColors): CSSProperties {
  const colors = resolveColors(seg.depth)
  return {
    '--flow-main-color': colors.main,
    '--flow-branch-color': colors.branch,
    '--flow-loop-color': colors.loop,
    '--flow-arrow-color': colors.arrow,
    '--flow-inner-link-color': colors.innerLink,
  } as CSSProperties
}

export function renderFlowSegsLine(params: RenderFlowSegsParams): { node: ReactNode; skipTreeLines: number } {
  const { flowLines, lineIndex, isExpanded, resolveColors } = params
  if (flowLines.maxDepth === 0) return { node: null, skipTreeLines: 0 }

  const segs = flowLines.map.get(lineIndex) || []
  if (segs.length === 0) return { node: null, skipTreeLines: 0 }

  const lineMaxDepth = Math.max(...segs.map(s => s.depth)) + 1
  const slots: Array<FlowSegment | null> = Array(lineMaxDepth).fill(null)
  for (const s of segs) slots[s.depth] = s

  return {
    node: (
      <>
        {slots.map((seg, d) => (
          <span
            key={d}
            className={`eyc-flow-seg ${seg ? `eyc-flow-${seg.type}` : ''} ${seg?.isLoop ? 'eyc-flow-loop' : ''} ${seg?.isMarker ? 'eyc-flow-marker' : ''}${(seg?.isInnerThrough || seg?.isInnerEnd) ? ' eyc-flow-no-outer' : ''}${seg?.hasPrevFlowEnd ? ' eyc-flow-has-prev-end' : ''}${seg?.hasOuterLink ? ' eyc-flow-has-outer-link' : ''}${seg?.outerHidden ? ' eyc-flow-outer-hidden' : ''}${seg?.hasInnerLink ? ' eyc-flow-has-inner-link' : ''}${seg?.isStraightEnd ? ' eyc-flow-straight-end' : ''}`}
            style={seg ? createFlowStyle(seg, resolveColors) : undefined}
          >
            {seg?.isMarker && seg.type === 'branch' && seg?.markerInnerVert && !seg?.outerHidden && <span className="eyc-flow-inner-vert" />}
            {seg?.type === 'branch' && !seg?.isMarker && seg?.hasInnerVert && <span className="eyc-flow-inner-vert eyc-flow-inner-through" />}
            {seg?.type === 'branch' && !seg?.isMarker && seg?.hasInnerLink && <span className="eyc-flow-outer-resume" />}
            {seg?.type === 'branch' && !seg?.isMarker && seg?.hasInnerLink && <span className="eyc-flow-outer-horz" />}
            {seg?.type === 'branch' && !seg?.isMarker && seg?.hasInnerLink && <span className="eyc-flow-outer-arrow" />}
            {seg?.isMarker && seg.type === 'end' && !seg?.hasExtraEnds && !seg?.hasNextFlow && !seg?.outerHidden && (isExpanded ? <span className="eyc-flow-inner-vert eyc-flow-inner-through" /> : <><span className="eyc-flow-inner-vert" /><span className="eyc-flow-arrow-down eyc-flow-inner-arrow-down" /><span className="eyc-flow-arrow-right" /></>)}
            {seg?.isMarker && seg.type === 'end' && !seg?.hasExtraEnds && !seg?.hasNextFlow && seg?.outerHidden && (isExpanded ? <span className="eyc-flow-inner-vert eyc-flow-inner-through" /> : <><span className="eyc-flow-inner-vert" /><span className="eyc-flow-arrow-down eyc-flow-inner-arrow-down" /></>)}
            {seg?.isMarker && seg.type === 'end' && !seg?.hasExtraEnds && seg?.hasNextFlow && !seg?.outerHidden && <><span className="eyc-flow-inner-vert eyc-flow-inner-through" /><span className="eyc-flow-arrow-right" /></>}
            {seg?.isMarker && seg.type === 'end' && seg?.hasExtraEnds && !seg?.outerHidden && <><span className="eyc-flow-inner-vert eyc-flow-inner-through" /><span className="eyc-flow-arrow-right" /></>}
            {seg?.type === 'start' && seg?.hasPrevFlowEnd && <><span className="eyc-flow-link-vert" /><span className="eyc-flow-link-horz" /><span className="eyc-flow-link-arrow" /></>}
            {seg?.type === 'start' && seg?.isLoop && <span className="eyc-flow-arrow-right" />}
            {seg?.type === 'end' && !seg?.isMarker && !seg?.isStraightEnd && !seg?.isLoop && <span className="eyc-flow-arrow-down" />}
            {seg?.isStraightEnd && <span className="eyc-flow-arrow-down" />}
            {seg?.hasInnerVert && !seg?.hasInnerLink && <span className="eyc-flow-inner-vert eyc-flow-inner-through" />}
            {seg?.hasInnerLink && seg?.type !== 'branch' && <><span className="eyc-flow-inner-link-horz" /><span className="eyc-flow-inner-link-arrow" /></>}
            {seg?.isInnerThrough && <span className="eyc-flow-inner-vert eyc-flow-inner-through" />}
            {seg?.isInnerEnd && <><span className="eyc-flow-inner-vert eyc-flow-inner-end" /><span className="eyc-flow-arrow-down eyc-flow-inner-arrow-down" /></>}
          </span>
        ))}
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
  for (const s of segs) slots[s.depth] = s

  const hasAny = slots.some(seg => seg && (seg.type === 'start' || seg.type === 'through' || seg.type === 'branch' || (seg.type === 'end' && (seg.hasExtraEnds || seg.isMarker))))
  if (!hasAny) return null

  return (
    <div className="eyc-param-flow-cont">
      {slots.map((seg, d) => {
        const hasInnerCont = seg && (
          (seg.isMarker && ((seg.type === 'branch' && seg.markerInnerVert) || seg.type === 'end'))
          || seg.hasInnerVert
          || seg.isInnerThrough
          || seg.isInnerEnd
        )
        const hasCont = seg && (seg.type === 'start' || seg.type === 'through' || seg.type === 'branch' || (seg.type === 'end' && (seg.hasExtraEnds || seg.isMarker))) && !seg.outerHidden
        const isEndMarker = seg && seg.type === 'end' && seg.isMarker && !seg.hasExtraEnds
        const needsBothLines = seg && hasInnerCont && hasCont && (
          (seg.isMarker && seg.type === 'branch' && seg.markerInnerVert)
          || seg.hasInnerVert
        )
        return (
          <span
            key={d}
            className={`eyc-flow-seg eyc-flow-cont-seg ${hasCont ? (hasInnerCont ? (isEndMarker ? '' : (needsBothLines ? 'eyc-flow-through' : 'eyc-flow-through eyc-flow-cont-inner')) : 'eyc-flow-through') : ''} ${seg?.isLoop && hasCont ? 'eyc-flow-loop' : ''}`}
            style={seg ? createFlowStyle(seg, resolveColors) : undefined}
          >
            {hasCont && hasInnerCont && isEndMarker && <><span className="eyc-flow-inner-vert eyc-flow-inner-end" /><span className="eyc-flow-arrow-down eyc-flow-inner-arrow-down" /></>}
            {needsBothLines && <span className="eyc-flow-inner-vert eyc-flow-inner-through" />}
          </span>
        )
      })}
    </div>
  )
}
