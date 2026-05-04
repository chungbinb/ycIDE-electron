/// <reference lib="webworker" />

import {
  buildEditorBlocksModel,
  type EditorBlocksModelRequest,
  type EditorBlocksModelResponse,
} from './editorBlocksModelShared'

self.onmessage = (event: MessageEvent<EditorBlocksModelRequest>): void => {
  const payload = event.data
  if (!payload || typeof payload.id !== 'number') return

  const model = buildEditorBlocksModel(
    payload.text || '',
    !!payload.isClassModule,
    !!payload.isResourceTableDoc,
  )

  const response: EditorBlocksModelResponse = {
    id: payload.id,
    blocks: model.blocks,
    flowMaxDepth: model.flowMaxDepth,
    flowMapEntries: model.flowMapEntries,
  }
  self.postMessage(response)
}
