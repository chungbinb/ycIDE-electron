import { useEffect, useMemo, useRef, useState } from 'react'
import type { FlowSegment } from './eycFlow'
import type { RenderBlock } from './eycTableModel'
import {
  buildHeadLineBlocks,
  buildLineBlocks,
  getBlocksFlowModelCached,
  type EditorBlocksModelRequest,
  type EditorBlocksModelResponse,
} from './editorBlocksModelShared'

interface BlocksModelInput {
  text: string
  isClassModule: boolean
  isResourceTableDoc: boolean
  suppressHeadPreview?: boolean
}

interface BlocksModelState {
  blocks: RenderBlock[]
  flowLines: {
    map: Map<number, FlowSegment[]>
    maxDepth: number
  }
}

function createBlocksModelWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  try {
    return new Worker(new URL('./editorBlocksModel.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
}

export function useEditorBlocksModel(input: BlocksModelInput): BlocksModelState {
  const OPEN_PREVIEW_MAX_LINES = 220
  const PREVIEW_LENGTH_DELTA_THRESHOLD = 2000
  const SYNC_MODEL_MAX_LINES = 1500
  const SYNC_MODEL_MAX_CHARS = 120000
  const canBuildSynchronously = (text: string): boolean => {
    if (text.length > SYNC_MODEL_MAX_CHARS) return false

    let lineCount = 1
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) !== 10) continue
      lineCount++
      if (lineCount > SYNC_MODEL_MAX_LINES) return false
    }

    return true
  }
  const buildFullState = (text: string, isClassModule: boolean, isResourceTableDoc: boolean): BlocksModelState => {
    // 共享缓存返回的 blocks/flowMap 为只读共享引用，同一文本反复构建时保持引用稳定，
    // 下游依赖 blocks 身份的 useMemo 可以直接跳过重算。
    const model = getBlocksFlowModelCached(text, isClassModule, isResourceTableDoc)
    return {
      blocks: model.blocks,
      flowLines: {
        map: model.flowMap,
        maxDepth: model.flowMaxDepth,
      },
    }
  }
  const canSync = canBuildSynchronously(input.text)

  // 同步路径（≤1500 行 / ≤120KB）：用 useMemo 让 blocks 与 currentText 在同一渲染内更新。
  // 关键：回车拆行/退格删行用 flushSync 强制状态同步落地后，新行的编辑 input 必须能在
  // 同一次提交里挂载，才能同步聚焦——否则连按时旧 input 已卸载、新 input 未挂载的间隙里
  // keydown 落到 body 上丢失（连按5次回车只生效2次）。getBlocksFlowModelCached 对同一文本
  // 返回稳定引用，useMemo 不会破坏下游依赖 blocks 身份的优化。
  const syncState = useMemo<BlocksModelState | null>(
    () => (canSync ? buildFullState(input.text, input.isClassModule, input.isResourceTableDoc) : null),
    [canSync, input.text, input.isClassModule, input.isResourceTableDoc],
  )

  // 异步/Worker 路径（大文件）：保留 useState + 后台计算 + 首屏头部预览。
  const [asyncState, setAsyncState] = useState<BlocksModelState>(() => ({
    blocks: buildHeadLineBlocks(input.text, OPEN_PREVIEW_MAX_LINES),
    flowLines: { map: new Map<number, FlowSegment[]>(), maxDepth: 0 },
  }))

  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  const previousTextRef = useRef<string | null>(null)

  const normalized = useMemo(() => ({
    text: input.text,
    isClassModule: input.isClassModule,
    isResourceTableDoc: input.isResourceTableDoc,
    suppressHeadPreview: !!input.suppressHeadPreview,
  }), [input.text, input.isClassModule, input.isResourceTableDoc, input.suppressHeadPreview])

  useEffect(() => {
    const worker = createBlocksModelWorker()
    workerRef.current = worker
    if (!worker) return

    const onMessage = (event: MessageEvent<EditorBlocksModelResponse>): void => {
      const message = event.data
      if (!message || message.id !== requestIdRef.current) return
      setAsyncState({
        blocks: message.blocks,
        flowLines: {
          map: new Map<number, FlowSegment[]>(message.flowMapEntries || []),
          maxDepth: message.flowMaxDepth || 0,
        },
      })
    }

    worker.addEventListener('message', onMessage)
    return () => {
      worker.removeEventListener('message', onMessage)
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    // 同步路径由 useMemo 负责，无需异步计算
    if (canBuildSynchronously(normalized.text)) return

    const previousText = previousTextRef.current
    previousTextRef.current = normalized.text

    const isFirstLoad = previousText == null
    const lengthDelta = Math.abs((previousText || '').length - normalized.text.length)
    const headChanged = (previousText || '').slice(0, 256) !== normalized.text.slice(0, 256)
    const tailChanged = (previousText || '').slice(-256) !== normalized.text.slice(-256)
    const shouldUseHeadPreview = isFirstLoad
      || lengthDelta >= PREVIEW_LENGTH_DELTA_THRESHOLD
      || (headChanged && tailChanged)

    const id = ++requestIdRef.current

    if (shouldUseHeadPreview && !normalized.suppressHeadPreview) {
      const quickBlocks = buildHeadLineBlocks(normalized.text, OPEN_PREVIEW_MAX_LINES)
      setAsyncState(prev => ({
        blocks: quickBlocks,
        flowLines: prev.flowLines,
      }))
    }

    const worker = workerRef.current

    if (!worker) {
      setAsyncState(buildFullState(
        normalized.text,
        normalized.isClassModule,
        normalized.isResourceTableDoc,
      ))
      return
    }

    const payload: EditorBlocksModelRequest = {
      id,
      text: normalized.text,
      isClassModule: normalized.isClassModule,
      isResourceTableDoc: normalized.isResourceTableDoc,
    }
    worker.postMessage(payload)
  }, [normalized])

  return canSync && syncState ? syncState : asyncState
}
