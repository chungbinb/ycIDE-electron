import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildMinimapPreviewText,
  type MinimapPreviewRequest,
  type MinimapPreviewResponse,
} from './minimapPreviewShared'

interface MinimapPreviewOptions {
  maxRows?: number
  maxCharsPerLine?: number
}

function createMinimapWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  try {
    return new Worker(new URL('./minimapPreview.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
}

export function useEditorMinimapPreviewText(
  sourceText: string,
  options: MinimapPreviewOptions = {},
): string {
  const normalized = useMemo(() => ({
    maxRows: Math.max(1, options.maxRows ?? 260),
    maxCharsPerLine: Math.max(8, options.maxCharsPerLine ?? 84),
  }), [options.maxRows, options.maxCharsPerLine])

  const [previewText, setPreviewText] = useState(() => buildMinimapPreviewText(
    sourceText,
    normalized.maxRows,
    normalized.maxCharsPerLine,
  ))

  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const worker = createMinimapWorker()
    workerRef.current = worker
    if (!worker) return

    const onMessage = (event: MessageEvent<MinimapPreviewResponse>): void => {
      const message = event.data
      if (!message || message.id !== requestIdRef.current) return
      setPreviewText(message.previewText)
    }

    worker.addEventListener('message', onMessage)
    return () => {
      worker.removeEventListener('message', onMessage)
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    const id = ++requestIdRef.current
    const worker = workerRef.current

    if (!worker) {
      setPreviewText(buildMinimapPreviewText(
        sourceText,
        normalized.maxRows,
        normalized.maxCharsPerLine,
      ))
      return
    }

    const payload: MinimapPreviewRequest = {
      id,
      text: sourceText,
      maxRows: normalized.maxRows,
      maxCharsPerLine: normalized.maxCharsPerLine,
    }
    worker.postMessage(payload)
  }, [sourceText, normalized.maxRows, normalized.maxCharsPerLine])

  return previewText
}
