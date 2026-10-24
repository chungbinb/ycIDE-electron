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

/** 一段流程线元素：className 与子元素的 class 列表决定画什么（DOM 后端直接输出，Canvas 后端按同样的 class 语义绘制） */
export interface FlowSegElement {
  seg: FlowSegment | null
  className: string
  children: string[]
}

/** 一个流程线格（宽 4ch）：通常一个元素；judge 分支与起始在同一格重叠时两个元素叠放 */
export interface FlowSlot {
  depth: number
  overlap: boolean
  elements: FlowSegElement[]
}

export interface FlowLineSlots {
  slots: FlowSlot[]
  lineMaxDepth: number
}

// 颜色经 style 属性下发（React 只在值变化时才写 DOM）；以前用 ref 回调每次渲染都 setProperty 五次，
// 是滚动时性能剖析里排名靠前的开销
function flowColorStyle(seg: FlowSegment, resolveColors: (depth: number) => FlowLineColors): CSSProperties {
  const colors = resolveColors(seg.depth)
  return {
    '--flow-main-color': colors.main,
    '--flow-branch-color': colors.branch,
    '--flow-loop-color': colors.loop,
    '--flow-arrow-color': colors.arrow,
    '--flow-inner-link-color': colors.innerLink,
  } as CSSProperties
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

function innerVertClass(seg: FlowSegment): string {
  return `eyc-flow-inner-vert ${seg.hasInnerVertEnd ? 'eyc-flow-inner-end' : 'eyc-flow-inner-through'}`
}

/** 计算某行的流程线格与每格要画的元素（渲染后端共用，保证 DOM 与 Canvas 画的是同一套结构） */
export function buildFlowLineSlots(flowLines: FlowLinesState, lineIndex: number, isExpanded?: boolean): FlowLineSlots | null {
  if (flowLines.maxDepth === 0) return null

  const segs = flowLines.map.get(lineIndex) || []
  if (segs.length === 0) return null

  const lineMaxDepth = Math.max(...segs.map(s => s.depth)) + 1
  const merged: Array<FlowSegment | null> = Array(lineMaxDepth).fill(null)
  const depthSegsMap = new Map<number, FlowSegment[]>()
  for (const s of segs) {
    const depthList = depthSegsMap.get(s.depth)
    if (depthList) depthList.push(s)
    else depthSegsMap.set(s.depth, [s])
    const cur = merged[s.depth]
    merged[s.depth] = cur ? mergeSameDepthSeg(cur, s) : s
  }

  const slots = merged.map((seg, d): FlowSlot => {
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
      const branchChildren: string[] = []
      if (branchAtDepth.hasInnerVert) branchChildren.push(innerVertClass(branchAtDepth))
      branchChildren.push('eyc-flow-arrow-right')
      if (branchAtDepth.hasInnerLink) branchChildren.push('eyc-flow-outer-resume', 'eyc-flow-outer-horz', 'eyc-flow-outer-arrow')
      const startChildren: string[] = []
      if (startAtDepth.hasPrevFlowEnd) startChildren.push('eyc-flow-link-vert', 'eyc-flow-link-horz', 'eyc-flow-link-arrow')
      if (startAtDepth.isLoop) startChildren.push('eyc-flow-arrow-right')
      if (startAtDepth.hasInnerVert) startChildren.push(innerVertClass(startAtDepth))
      if (startAtDepth.hasInnerLink) startChildren.push('eyc-flow-inner-link-horz')
      return {
        depth: d,
        overlap: true,
        elements: [
          {
            seg: branchAtDepth,
            className: `eyc-flow-seg eyc-flow-branch ${branchAtDepth.isLoop ? 'eyc-flow-loop' : ''}${branchAtDepth.suppressOuter ? ' eyc-flow-no-outer' : ''}${branchAtDepth.hasPrevFlowEnd ? ' eyc-flow-has-prev-end' : ''}${branchAtDepth.hasOuterLink ? ' eyc-flow-has-outer-link' : ''}${branchAtDepth.hasInnerLink ? ' eyc-flow-has-inner-link' : ''}${branchAtDepth.hasInnerVertFromAbove ? ' eyc-flow-inner-from-above' : ''} eyc-flow-stagger-upper eyc-flow-hide-down-arrows`,
            children: branchChildren,
          },
          {
            seg: startAtDepth,
            className: `eyc-flow-seg eyc-flow-start ${startAtDepth.isLoop ? 'eyc-flow-loop' : ''}${startAtDepth.suppressOuter ? ' eyc-flow-no-outer' : ''}${startAtDepth.hasPrevFlowEnd ? ' eyc-flow-has-prev-end' : ''}${startAtDepth.hasOuterLink ? ' eyc-flow-has-outer-link' : ''}${startAtDepth.hasInnerLink ? ' eyc-flow-has-inner-link' : ''}${startAtDepth.hasInnerVertFromAbove ? ' eyc-flow-inner-from-above' : ''} eyc-flow-stagger-lower eyc-flow-hide-down-arrows`,
            children: startChildren,
          },
        ],
      }
    }

    const hasInnerStartBelow = seg?.type === 'branch' && merged.slice(d + 1).some(next => next?.type === 'start')
    const hasOuterBranchAbove = seg?.type === 'start' && merged.slice(0, d).some(prev => prev?.type === 'branch')
    // 分支的内容行是同一行右侧紧邻的内层结构（如 否则体首行就是嵌套如果）：
    // 分支横线与右箭头需延伸过本格右缘，箭头尖对齐内层结构的外侧竖线，不在中间留缺口。
    const arrowIntoInner = seg?.type === 'branch' && merged[d + 1]?.type === 'start'
    const hasStartSameDepth = segsAtDepth.some(item => item.type === 'start')
    const normalEndArrow = !!(seg?.type === 'end' && !seg?.hasNextFlow && !hasStartSameDepth)
    const arrowOnlyEndArrow = !!seg?.endArrowOnly
    const showEndArrow = !!(
      (!seg?.isLoop && !isExpanded && !hasStartPrevEndAtDepth && !hasSameDepthBranchStartOverlap)
      && (normalEndArrow || arrowOnlyEndArrow)
    )
    const children: string[] = []
    if (seg?.type === 'branch' && seg.hasInnerVert) children.push(innerVertClass(seg))
    if (seg?.type === 'branch' && seg.hasInnerVertEnd && !seg.hasInnerVertEndConnected && !hasStartPrevEndAtDepth && !hasSameDepthBranchStartOverlap) children.push('eyc-flow-arrow-down eyc-flow-inner-arrow-down')
    if (seg?.type === 'branch') children.push('eyc-flow-arrow-right')
    if (seg?.type === 'branch' && seg.hasInnerLink) children.push('eyc-flow-outer-resume', 'eyc-flow-outer-horz', 'eyc-flow-outer-arrow')
    if (seg?.type === 'start' && seg.hasPrevFlowEnd) {
      // 如果真是单分支结构（无内侧分支线），其块间桥接应接在外侧主结构线（left:4px）上而非内侧线（1ch+4px）。
      const linkOuter = seg.flowKind === 'ifTrue' ? ' eyc-flow-link-outer' : ''
      children.push(`eyc-flow-link-vert${linkOuter}`, `eyc-flow-link-horz${linkOuter}`, 'eyc-flow-link-arrow')
    }
    if (seg?.type === 'start' && seg.isLoop) children.push('eyc-flow-arrow-right')
    if (showEndArrow) children.push('eyc-flow-arrow-down')
    if (seg?.hasInnerVert && seg.type !== 'branch') children.push(innerVertClass(seg))
    if (seg?.hasInnerVertEnd && !seg.hasInnerVertEndConnected && seg.type !== 'branch' && !hasStartPrevEndAtDepth && !hasSameDepthBranchStartOverlap && !(seg.type === 'start' && seg.hasPrevFlowEnd)) children.push('eyc-flow-arrow-down eyc-flow-inner-arrow-down')
    if (seg?.hasInnerLink && seg.type !== 'branch') children.push('eyc-flow-inner-link-horz')
    return {
      depth: d,
      overlap: false,
      elements: [{
        seg,
        className: `eyc-flow-seg ${seg ? `eyc-flow-${seg.type}` : ''} ${seg?.isLoop ? 'eyc-flow-loop' : ''}${seg?.suppressOuter ? ' eyc-flow-no-outer' : ''}${seg?.hasPrevFlowEnd ? ' eyc-flow-has-prev-end' : ''}${seg?.hasOuterLink ? ' eyc-flow-has-outer-link' : ''}${seg?.hasInnerLink ? ' eyc-flow-has-inner-link' : ''}${seg?.hasInnerVertFromAbove ? ' eyc-flow-inner-from-above' : ''}${hasInnerStartBelow ? ' eyc-flow-stagger-upper' : ''}${hasOuterBranchAbove ? ' eyc-flow-stagger-lower' : ''}${arrowIntoInner ? ' eyc-flow-arrow-into-inner' : ''}`,
        children,
      }],
    }
  })

  return { slots, lineMaxDepth }
}

function renderSegElement(element: FlowSegElement, key: number | undefined, resolveColors: (depth: number) => FlowLineColors): ReactNode {
  return (
    <span
      key={key}
      className={element.className}
      style={element.seg ? flowColorStyle(element.seg, resolveColors) : undefined}
    >
      {element.children.map((cls, i) => <span key={i} className={cls} />)}
    </span>
  )
}

/** DOM 渲染后端：每格一个带伪元素的 span（样式见 EycTableEditor.css「流程线」一节） */
export function renderFlowSegsLine(params: RenderFlowSegsParams): { node: ReactNode; skipTreeLines: number } {
  const { flowLines, lineIndex, isExpanded, resolveColors } = params
  const model = buildFlowLineSlots(flowLines, lineIndex, isExpanded)
  if (!model) return { node: null, skipTreeLines: 0 }
  return {
    node: (
      <>
        {model.slots.map(slot => slot.overlap
          ? (
            <span key={slot.depth} className="eyc-flow-overlap-slot">
              {slot.elements.map((element, i) => renderSegElement(element, i, resolveColors))}
            </span>
          )
          : renderSegElement(slot.elements[0], slot.depth, resolveColors))}
      </>
    ),
    skipTreeLines: model.lineMaxDepth,
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
            style={seg ? flowColorStyle(seg, resolveColors) : undefined}
          >
            {needsBothLines && <span className="eyc-flow-inner-vert eyc-flow-inner-through" />}
          </span>
        )
      })}
    </div>
  )
}
