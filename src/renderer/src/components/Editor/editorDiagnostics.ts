import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildEditorDiagnosticsProblems,
  type EditorDiagnosticsProblem,
  type EditorDiagnosticsRequest,
  type EditorDiagnosticsResponse,
} from './editorDiagnosticsShared'

interface DiagnosticsWorkerInput {
  text: string
  hasCommandCatalog: boolean
  validCommandNames: Set<string>
  allKnownVarNames: Set<string>
  reservedNameSet: Set<string>
}

function createDiagnosticsWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  try {
    return new Worker(new URL('./editorDiagnostics.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
}

export function useEditorDiagnosticsProblems(input: DiagnosticsWorkerInput): EditorDiagnosticsProblem[] {
  const [problems, setProblems] = useState<EditorDiagnosticsProblem[]>([])
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)

  const normalized = useMemo(() => {
    return {
      text: input.text,
      hasCommandCatalog: input.hasCommandCatalog,
      validCommandNames: Array.from(input.validCommandNames),
      allKnownVarNames: Array.from(input.allKnownVarNames),
      reservedNames: Array.from(input.reservedNameSet),
    }
  }, [input.text, input.hasCommandCatalog, input.validCommandNames, input.allKnownVarNames, input.reservedNameSet])

  useEffect(() => {
    const worker = createDiagnosticsWorker()
    workerRef.current = worker
    if (!worker) return

    const onMessage = (event: MessageEvent<EditorDiagnosticsResponse>): void => {
      const message = event.data
      if (!message || message.id !== requestIdRef.current) return
      setProblems(message.problems || [])
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
      setProblems(buildEditorDiagnosticsProblems(normalized))
      return
    }

    const payload: EditorDiagnosticsRequest = {
      id,
      text: normalized.text,
      hasCommandCatalog: normalized.hasCommandCatalog,
      validCommandNames: normalized.validCommandNames,
      allKnownVarNames: normalized.allKnownVarNames,
      reservedNames: normalized.reservedNames,
    }
    worker.postMessage(payload)
  }, [normalized])

  return problems
}
