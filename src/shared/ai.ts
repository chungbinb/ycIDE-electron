export type AIBuiltinModel = 'deepseek' | 'glm'
export type AISupportedModel = string

export interface AICustomModelConfig {
  id: string
  label: string
  endpoint: string
  modelName: string
  apiKey: string
}

export interface AIChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AIChatRequest {
  model: AISupportedModel
  messages: AIChatMessage[]
}

export interface AIChatResult {
  ok: boolean
  message: string
  error?: string
}

export interface AIEditRequest {
  model: AISupportedModel
  instruction: string
  filePath: string
  fileContent: string
  problems?: { line: number; column: number; message: string; severity: string; file?: string }[]
  ideContext?: string
}

export interface AIEditResult {
  ok: boolean
  filePath: string
  summary: string
  diff: string
  originalContent: string
  proposedContent: string
  error?: string
}
