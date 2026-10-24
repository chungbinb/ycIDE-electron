// 流程线渲染后端（设计稿 §11 阶段 3/4）：表格编辑器只调用 renderLine / renderContinuation，
// 具体由哪个后端画由渲染后端插件（contributes.renderers）和设置 tableRendererId 决定。
// 插件清单里的 implementation 对应这里注册的实现名。

import { createContext, useContext, type ReactNode } from 'react'
import type { FlowSegment } from './eycFlow'
import { renderFlowContinuationLine, renderFlowSegsLine, type FlowLineColors } from './editorFlowRenderUtils'
import { renderFlowLineImage, type FlowLineMetrics } from './flowLineImageRenderer'

export type { FlowLineMetrics }

export interface FlowLinesState {
  map: Map<number, FlowSegment[]>
  maxDepth: number
}

export interface FlowLineRenderParams {
  flowLines: FlowLinesState
  lineIndex: number
  isExpanded?: boolean
  resolveColors: (depth: number) => FlowLineColors
  /** 字符宽度等度量（needsMetrics 的后端才用；由表格编辑器按当前字体测量） */
  metrics?: FlowLineMetrics
}

export interface FlowLineRenderer {
  /** 是否需要编辑器测量字符宽度（图像后端按像素几何生成图像） */
  needsMetrics?: boolean
  /** 代码行左侧的流程线；skipTreeLines 为占用的缩进格数（这些格不再画树形缩进线） */
  renderLine(params: FlowLineRenderParams): { node: ReactNode; skipTreeLines: number }
  /** 参数展开区里流程线的纵向延续 */
  renderContinuation(params: Omit<FlowLineRenderParams, 'isExpanded'>): ReactNode
}

export const domFlowLineRenderer: FlowLineRenderer = {
  renderLine: renderFlowSegsLine,
  renderContinuation: renderFlowContinuationLine,
}

export const imageFlowLineRenderer: FlowLineRenderer = {
  needsMetrics: true,
  renderLine: (params) => renderFlowLineImage({ ...params, fallback: () => renderFlowSegsLine(params) }),
  renderContinuation: renderFlowContinuationLine,
}

const FLOW_LINE_RENDERER_IMPLEMENTATIONS: Record<string, FlowLineRenderer> = {
  dom: domFlowLineRenderer,
  image: imageFlowLineRenderer,
}

/** 按插件清单里的 implementation 取渲染实现；未知实现回到 DOM */
export function getFlowLineRenderer(implementation: string | null | undefined): FlowLineRenderer {
  return (implementation && FLOW_LINE_RENDERER_IMPLEMENTATIONS[implementation]) || domFlowLineRenderer
}

export function hasFlowLineRendererImplementation(implementation: string): boolean {
  return implementation in FLOW_LINE_RENDERER_IMPLEMENTATIONS
}

export const FlowLineRendererContext = createContext<FlowLineRenderer>(domFlowLineRenderer)

export function useFlowLineRenderer(): FlowLineRenderer {
  return useContext(FlowLineRendererContext)
}
