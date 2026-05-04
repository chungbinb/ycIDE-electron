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
