import { buildBlocks } from './eycBlocks'
import { computeFlowLines, type FlowSegment } from './eycFlow'
import type { RenderBlock } from './eycTableModel'

export interface EditorBlocksModelRequest {
  id: number
  text: string
  isClassModule: boolean
  isResourceTableDoc: boolean
}

export interface EditorBlocksModelResponse {
  id: number
  blocks: RenderBlock[]
  flowMaxDepth: number
  flowMapEntries: Array<[number, FlowSegment[]]>
}

export interface EditorBlocksModelPayload {
  blocks: RenderBlock[]
  flowMaxDepth: number
  flowMapEntries: Array<[number, FlowSegment[]]>
}

export function buildLineBlocks(text: string): RenderBlock[] {
  return text.split('\n').map((line, idx): RenderBlock => ({
    kind: 'codeline' as const,
    rows: [],
    codeLine: line,
    lineIndex: idx,
    isVirtual: false,
  }))
}

export function buildHeadLineBlocks(text: string, maxLines = 220): RenderBlock[] {
  const limit = Math.max(1, maxLines)
  const lines: string[] = []

  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 10) continue
    lines.push(text.slice(start, i))
    if (lines.length >= limit) break
    start = i + 1
  }

  if (lines.length < limit) {
    lines.push(text.slice(start))
  }

  return lines.map((line, idx): RenderBlock => ({
    kind: 'codeline' as const,
    rows: [],
    codeLine: line,
    lineIndex: idx,
    isVirtual: false,
  }))
}

export function buildEditorBlocksModel(
  text: string,
  isClassModule: boolean,
  isResourceTableDoc: boolean,
): EditorBlocksModelPayload {
  const blocks = buildBlocks(text, isClassModule, isResourceTableDoc)
  const flowLines = computeFlowLines(blocks)
  return {
    blocks,
    flowMaxDepth: flowLines.maxDepth,
    flowMapEntries: Array.from(flowLines.map.entries()),
  }
}

export interface BlocksFlowModel {
  blocks: RenderBlock[]
  flowMap: Map<number, FlowSegment[]>
  flowMaxDepth: number
}

const BLOCKS_FLOW_CACHE_MAX = 4
const blocksFlowCache: Array<{
  text: string
  isClassModule: boolean
  isResourceTableDoc: boolean
  model: BlocksFlowModel
}> = []

// 返回值在多个调用方间共享，blocks/flowMap 必须只读；需要改动时先拷贝。
export function getBlocksFlowModelCached(
  text: string,
  isClassModule: boolean,
  isResourceTableDoc: boolean,
): BlocksFlowModel {
  for (let i = 0; i < blocksFlowCache.length; i++) {
    const entry = blocksFlowCache[i]
    if (entry.text === text && entry.isClassModule === isClassModule && entry.isResourceTableDoc === isResourceTableDoc) {
      if (i > 0) {
        blocksFlowCache.splice(i, 1)
        blocksFlowCache.unshift(entry)
      }
      return entry.model
    }
  }
  const blocks = buildBlocks(text, isClassModule, isResourceTableDoc)
  const flowLines = computeFlowLines(blocks)
  const model: BlocksFlowModel = { blocks, flowMap: flowLines.map, flowMaxDepth: flowLines.maxDepth }
  blocksFlowCache.unshift({ text, isClassModule, isResourceTableDoc, model })
  if (blocksFlowCache.length > BLOCKS_FLOW_CACHE_MAX) blocksFlowCache.pop()
  return model
}
