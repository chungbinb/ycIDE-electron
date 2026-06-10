import { useEffect, useMemo, useRef, useState } from 'react'
import type { FlowSegment } from './eycFlow'
import type { RenderBlock } from './eycTableModel'
import {
  buildEditorBlocksModel,
  buildHeadLineBlocks,
  buildLineBlocks,
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
    const model = buildEditorBlocksModel(text, isClassModule, isResourceTableDoc)
    return {
      blocks: model.blocks,
      flowLines: {
        map: new Map<number, FlowSegment[]>(model.flowMapEntries),
        maxDepth: model.flowMaxDepth,
      },
    }
  }
  const [state, setState] = useState<BlocksModelState>(() => ({
    ...(canBuildSynchronously(input.text)
      ? buildFullState(input.text, input.isClassModule, input.isResourceTableDoc)
      : {
          blocks: buildHeadLineBlocks(input.text, OPEN_PREVIEW_MAX_LINES),
          flowLines: { map: new Map<number, FlowSegment[]>(), maxDepth: 0 },
        }),
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
      setState({
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

    if (canBuildSynchronously(normalized.text)) {
      setState(buildFullState(
        normalized.text,
        normalized.isClassModule,
        normalized.isResourceTableDoc,
      ))
      return
    }

    if (shouldUseHeadPreview && !normalized.suppressHeadPreview) {
      const quickBlocks = buildHeadLineBlocks(normalized.text, OPEN_PREVIEW_MAX_LINES)
      setState(prev => ({
        blocks: quickBlocks,
        flowLines: prev.flowLines,
      }))
    }

    const worker = workerRef.current

    if (!worker) {
      setState(buildFullState(
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

  return state
}
