/// <reference lib="webworker" />

import {
  buildEditorDiagnosticsProblems,
  type EditorDiagnosticsRequest,
  type EditorDiagnosticsResponse,
} from './editorDiagnosticsShared'

self.onmessage = (event: MessageEvent<EditorDiagnosticsRequest>): void => {
  const payload = event.data
  if (!payload || typeof payload.id !== 'number') return

  const problems = buildEditorDiagnosticsProblems({
    text: payload.text || '',
    hasCommandCatalog: !!payload.hasCommandCatalog,
    validCommandNames: payload.validCommandNames || [],
    allKnownVarNames: payload.allKnownVarNames || [],
    reservedNames: payload.reservedNames || [],
  })

  const response: EditorDiagnosticsResponse = {
    id: payload.id,
    problems,
  }
  self.postMessage(response)
}
