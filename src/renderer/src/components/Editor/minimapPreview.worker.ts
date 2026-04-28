/// <reference lib="webworker" />

import {
  buildMinimapPreviewText,
  type MinimapPreviewRequest,
  type MinimapPreviewResponse,
} from './minimapPreviewShared'

self.onmessage = (event: MessageEvent<MinimapPreviewRequest>): void => {
  const payload = event.data
  if (!payload || typeof payload.id !== 'number') return

  const previewText = buildMinimapPreviewText(
    payload.text || '',
    payload.maxRows,
    payload.maxCharsPerLine,
  )

  const response: MinimapPreviewResponse = {
    id: payload.id,
    previewText,
  }
  self.postMessage(response)
}
