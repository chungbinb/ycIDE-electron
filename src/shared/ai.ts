export type AIBuiltinModel = 'deepseek' | 'deepseek-v4-flash' | 'deepseek-v3.2' | 'glm'
export type AISupportedModel = string

export interface AICustomModelConfig {
  id: string
  label: string
  endpoint: string
  modelName: string
  apiKey: string
}

export interface AIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: AIChatToolCall[]
}

export interface AIChatToolFunction {
  name: string
  description?: string
  parameters?: unknown
}

export interface AIChatTool {
  type: 'function'
  function: AIChatToolFunction
}

export interface AIChatToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface AIChatRequest {
  model: AISupportedModel
  messages: AIChatMessage[]
}

export interface AIChatWithToolsRequest {
  model: AISupportedModel
  messages: AIChatMessage[]
  tools: AIChatTool[]
  tool_choice?: 'auto' | 'none'
}

export interface AIChatResult {
  ok: boolean
  message: string
  error?: string
}

export interface AIChatWithToolsResult extends AIChatResult {
  toolCalls?: AIChatToolCall[]
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
