import { createPatch } from 'diff'
import type {
  AIChatRequest,
  AIChatResult,
  AIChatTool,
  AIChatToolCall,
  AIChatWithToolsRequest,
  AIChatWithToolsResult,
  AIEditRequest,
  AIEditResult,
  AICustomModelConfig,
  AISupportedModel,
} from '../shared/ai'

type ProviderConfig = {
  endpoint: string
  model: string
  envKey?: string
}

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: AIChatToolCall[]
}

type OpenAIResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
      tool_calls?: AIChatToolCall[]
    }
  }>
  error?: {
    message?: string
  }
}

type CompletionResult = {
  ok: true
  content: string
  toolCalls: AIChatToolCall[]
} | {
  ok: false
  error: string
}

type OpenAIStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>
      reasoning_content?: string
    }
    finish_reason?: string | null
  }>
  error?: {
    message?: string
  }
}

function resolveProvider(model: AISupportedModel, customModels: AICustomModelConfig[] = []): ProviderConfig | null {
  if (model === 'glm') {
    return {
      endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      model: 'glm-4-flash',
      envKey: 'GLM_API_KEY',
    }
  }

  if (model === 'deepseek') {
    return {
      endpoint: 'https://api.deepseek.com/chat/completions',
      model: 'deepseek-v4-pro',
      envKey: 'DEEPSEEK_API_KEY',
    }
  }

  if (model === 'deepseek-v4-flash') {
    return {
      endpoint: 'https://api.deepseek.com/chat/completions',
      model: 'deepseek-v4-flash',
      envKey: 'DEEPSEEK_API_KEY',
    }
  }

  if (model === 'deepseek-v3.2') {
    return {
      endpoint: 'https://api.deepseek.com/chat/completions',
      model: 'deepseek-v3.2',
      envKey: 'DEEPSEEK_API_KEY',
    }
  }

  const custom = customModels.find(item => item.id === model)
  if (!custom) return null
  return {
    endpoint: custom.endpoint,
    model: custom.modelName,
  }
}

function readTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts = content
      .map(item => (item && typeof item === 'object' && typeof item.text === 'string') ? item.text : '')
      .filter(Boolean)
    return parts.join('\n').trim()
  }
  return ''
}

function tryParseJsonBlock(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('```')) {
    const firstBreak = trimmed.indexOf('\n')
    const lastFence = trimmed.lastIndexOf('```')
    if (firstBreak >= 0 && lastFence > firstBreak) {
      const body = trimmed.slice(firstBreak + 1, lastFence).trim()
      try {
        return JSON.parse(body)
      } catch {
        return null
      }
    }
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

async function requestCompletion(
  model: AISupportedModel,
  messages: OpenAIMessage[],
  apiKeyOverride?: string,
  customModels: AICustomModelConfig[] = [],
  tools?: AIChatTool[],
  toolChoice?: 'auto' | 'none',
): Promise<CompletionResult> {
  const provider = resolveProvider(model, customModels)
  if (!provider) {
    return {
      ok: false,
      error: `未找到模型配置：${model}`,
    }
  }

  const envKey = provider.envKey
  const apiKey = (apiKeyOverride || '').trim() || (envKey ? process.env[envKey] : '')
  if (!apiKey) {
    return {
      ok: false,
      error: envKey
        ? `未检测到可用 API Key。请在系统设置中填写，或配置环境变量 ${envKey} 后重启应用。`
        : '未检测到可用 API Key。请在模型配置中填写后重试。',
    }
  }

  const fetchFn = (globalThis as { fetch?: (input: string, init?: unknown) => Promise<{ ok: boolean; status: number; json: () => Promise<OpenAIResponse> }> }).fetch
  if (!fetchFn) {
    return {
      ok: false,
      error: '当前运行环境不支持 fetch，无法请求 AI 服务。',
    }
  }

  try {
    const response = await fetchFn(provider.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: 0.2,
        ...(Array.isArray(tools) && tools.length > 0 ? { tools, tool_choice: toolChoice || 'auto' } : {}),
      }),
    })

    const payload = await response.json()
    const message = payload.choices?.[0]?.message
    const messageContent = readTextContent(message?.content)
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : []

    if (!response.ok) {
      return {
        ok: false,
        error: payload.error?.message || `AI 服务请求失败 (${response.status})`,
      }
    }

    if (!messageContent && toolCalls.length === 0) {
      return {
        ok: false,
        error: 'AI 返回为空，请重试。',
      }
    }

    return { ok: true, content: messageContent, toolCalls }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'AI 服务请求异常。',
    }
  }
}

async function requestCompletionStream(
  model: AISupportedModel,
  messages: OpenAIMessage[],
  onDelta: (delta: string) => void,
  apiKeyOverride?: string,
  customModels: AICustomModelConfig[] = [],
  onReasoning?: (delta: string) => void,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const provider = resolveProvider(model, customModels)
  if (!provider) {
    return {
      ok: false,
      error: `未找到模型配置：${model}`,
    }
  }

  const envKey = provider.envKey
  const apiKey = (apiKeyOverride || '').trim() || (envKey ? process.env[envKey] : '')
  if (!apiKey) {
    return {
      ok: false,
      error: envKey
        ? `未检测到可用 API Key。请在系统设置中填写，或配置环境变量 ${envKey} 后重启应用。`
        : '未检测到可用 API Key。请在模型配置中填写后重试。',
    }
  }

  const fetchFn = (globalThis as {
    fetch?: (input: string, init?: unknown) => Promise<{
      ok: boolean
      status: number
      body?: { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> } } | null
      json: () => Promise<OpenAIResponse>
    }>
  }).fetch

  if (!fetchFn) {
    return {
      ok: false,
      error: '当前运行环境不支持 fetch，无法请求 AI 服务。',
    }
  }

  try {
    const response = await fetchFn(provider.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: 0.2,
        stream: true,
      }),
    })

    if (!response.ok) {
      const payload = await response.json()
      return {
        ok: false,
        error: payload.error?.message || `AI 服务请求失败 (${response.status})`,
      }
    }

    const reader = response.body?.getReader()
    if (!reader) {
      return {
        ok: false,
        error: 'AI 服务未返回可读流。',
      }
    }

    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let merged = ''

    const processBufferLine = (line: string): boolean => {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) return false

      const data = trimmed.slice(5).trim()
      if (!data) return false
      if (data === '[DONE]') return true

      try {
        const chunk = JSON.parse(data) as OpenAIStreamChunk
        const delta = readTextContent(chunk.choices?.[0]?.delta?.content)
        if (delta) {
          merged += delta
          onDelta(delta)
        }
        const reasoning = chunk.choices?.[0]?.delta?.reasoning_content
        if (reasoning && onReasoning) {
          onReasoning(reasoning)
        }
      } catch {
        // 忽略非 JSON 数据片段
      }
      return false
    }

    let doneFromStream = false
    while (!doneFromStream) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let sepIndex = buffer.indexOf('\n\n')
      while (sepIndex >= 0) {
        const eventBlock = buffer.slice(0, sepIndex)
        buffer = buffer.slice(sepIndex + 2)
        const lines = eventBlock.replace(/\r/g, '').split('\n')
        for (const line of lines) {
          if (processBufferLine(line)) {
            doneFromStream = true
            break
          }
        }
        if (doneFromStream) break
        sepIndex = buffer.indexOf('\n\n')
      }
    }

    if (!merged.trim()) {
      return {
        ok: false,
        error: 'AI 返回为空，请重试。',
      }
    }

    return { ok: true, content: merged }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'AI 服务请求异常。',
    }
  }
}

export async function runAIChat(request: AIChatRequest, apiKeyOverride?: string, customModels: AICustomModelConfig[] = []): Promise<AIChatResult> {
  const messages = request.messages
    .map(item => ({
      role: item.role,
      content: typeof item.content === 'string' ? item.content : '',
      name: item.name,
      tool_call_id: item.tool_call_id,
      tool_calls: item.tool_calls,
    }))
    .filter(item => item.role === 'assistant' || item.role === 'tool' || item.content.trim().length > 0)

  if (messages.length === 0) {
    return {
      ok: false,
      message: '',
      error: '请输入聊天内容。',
    }
  }

  const result = await requestCompletion(request.model, messages, apiKeyOverride, customModels)
  if (!result.ok) {
    return {
      ok: false,
      message: '',
      error: result.error,
    }
  }

  return {
    ok: true,
    message: result.content,
  }
}

export async function runAIChatWithTools(
  request: AIChatWithToolsRequest,
  apiKeyOverride?: string,
  customModels: AICustomModelConfig[] = [],
): Promise<AIChatWithToolsResult> {
  const messages = request.messages
    .map(item => ({
      role: item.role,
      content: typeof item.content === 'string' ? item.content : '',
      name: item.name,
      tool_call_id: item.tool_call_id,
      tool_calls: item.tool_calls,
    }))
    .filter(item => item.role === 'assistant' || item.role === 'tool' || item.content.trim().length > 0)

  if (messages.length === 0) {
    return {
      ok: false,
      message: '',
      error: '请输入聊天内容。',
    }
  }

  const result = await requestCompletion(
    request.model,
    messages,
    apiKeyOverride,
    customModels,
    request.tools,
    request.tool_choice,
  )
  if (!result.ok) {
    return {
      ok: false,
      message: '',
      error: result.error,
    }
  }

  return {
    ok: true,
    message: result.content,
    toolCalls: result.toolCalls,
  }
}

export async function runAIChatStream(
  request: AIChatRequest,
  onDelta: (delta: string) => void,
  apiKeyOverride?: string,
  customModels: AICustomModelConfig[] = [],
): Promise<AIChatResult> {
  const messages = request.messages
    .map(item => ({ role: item.role, content: (item.content || '').trim() }))
    .filter(item => item.content.length > 0)

  if (messages.length === 0) {
    return {
      ok: false,
      message: '',
      error: '请输入聊天内容。',
    }
  }

  const result = await requestCompletionStream(request.model, messages, onDelta, apiKeyOverride, customModels)
  if (!result.ok) {
    return {
      ok: false,
      message: '',
      error: result.error,
    }
  }

  return {
    ok: true,
    message: result.content,
  }
}

export async function runAIEdit(request: AIEditRequest, apiKeyOverride?: string, customModels: AICustomModelConfig[] = []): Promise<AIEditResult> {
  const instruction = (request.instruction || '').trim()
  if (!instruction) {
    return {
      ok: false,
      filePath: request.filePath,
      summary: '',
      diff: '',
      originalContent: request.fileContent,
      proposedContent: '',
      error: '请输入编辑指令。',
    }
  }

  const problemsSection: string[] = []
  if (request.problems && request.problems.length > 0) {
    problemsSection.push('', '当前问题面板的诊断信息:')
    for (const p of request.problems) {
      const loc = p.file ? `${p.file} 行${p.line}:${p.column}` : `行${p.line}:${p.column}`
      problemsSection.push(`  [${p.severity}] ${loc} - ${p.message}`)
    }
    problemsSection.push('请在修改时一并修复上述诊断问题（如果与用户指令相关）。')
  }

  const prompt = [
    '你是代码编辑助手。',
    '根据用户编辑指令，返回严格 JSON，不要包含 markdown 代码块，不要解释。',
    'JSON 格式: {"summary": string, "updatedContent": string}',
    'updatedContent 必须是完整文件内容。',
    '',
    `文件路径: ${request.filePath}`,
    '用户指令:',
    instruction,
    ...problemsSection,
    '',
    '原始文件内容:',
    request.fileContent,
  ].join('\n')

  const ycideIntro = '\n\n关于 ycIDE：已完成功能包括自定义数据类型/全局变量/常量表/资源/DLL命令编辑器、AI代码助手、自定义主题、自定义字体、无障碍(Accessibility)支持（WAI-ARIA、键盘导航、屏幕阅读器、焦点管理）。开发中：调试器集成、编译输出优化、会员系统、插件系统。'
  const systemContent = request.ideContext
    ? `你是严谨的代码修改助手。只输出 JSON。${ycideIntro}\n\n当前 IDE 环境信息:\n${request.ideContext}`
    : `你是严谨的代码修改助手。只输出 JSON。${ycideIntro}`

  const completion = await requestCompletion(request.model, [
    { role: 'system', content: systemContent },
    { role: 'user', content: prompt },
  ], apiKeyOverride, customModels)

  if (!completion.ok) {
    return {
      ok: false,
      filePath: request.filePath,
      summary: '',
      diff: '',
      originalContent: request.fileContent,
      proposedContent: '',
      error: completion.error,
    }
  }

  const parsed = tryParseJsonBlock(completion.content) as { summary?: unknown; updatedContent?: unknown } | null
  const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : ''
  const updatedContent = typeof parsed?.updatedContent === 'string' ? parsed.updatedContent : ''

  if (!updatedContent) {
    return {
      ok: false,
      filePath: request.filePath,
      summary: '',
      diff: '',
      originalContent: request.fileContent,
      proposedContent: '',
      error: 'AI 未返回有效的 updatedContent。',
    }
  }

  const diff = createPatch(request.filePath, request.fileContent, updatedContent, 'before', 'after', { context: 3 })

  return {
    ok: true,
    filePath: request.filePath,
    summary: summary || '已生成编辑建议。',
    diff,
    originalContent: request.fileContent,
    proposedContent: updatedContent,
  }
}

export async function runAIEditStream(
  request: AIEditRequest,
  onDelta: (delta: string) => void,
  apiKeyOverride?: string,
  customModels: AICustomModelConfig[] = [],
  onReasoning?: (delta: string) => void,
): Promise<AIEditResult> {
  const instruction = (request.instruction || '').trim()
  if (!instruction) {
    return {
      ok: false,
      filePath: request.filePath,
      summary: '',
      diff: '',
      originalContent: request.fileContent,
      proposedContent: '',
      error: '请输入编辑指令。',
    }
  }

  const problemsSection: string[] = []
  if (request.problems && request.problems.length > 0) {
    problemsSection.push('', '当前问题面板的诊断信息:')
    for (const p of request.problems) {
      const loc = p.file ? `${p.file} 行${p.line}:${p.column}` : `行${p.line}:${p.column}`
      problemsSection.push(`  [${p.severity}] ${loc} - ${p.message}`)
    }
    problemsSection.push('请在修改时一并修复上述诊断问题（如果与用户指令相关）。')
  }

  const prompt = [
    '你是代码编辑助手。',
    '根据用户编辑指令，返回严格 JSON，不要包含 markdown 代码块，不要解释。',
    'JSON 格式: {"summary": string, "updatedContent": string}',
    'updatedContent 必须是完整文件内容。',
    '',
    `文件路径: ${request.filePath}`,
    '用户指令:',
    instruction,
    ...problemsSection,
    '',
    '原始文件内容:',
    request.fileContent,
  ].join('\n')

  const streamYcideIntro = '\n\n关于 ycIDE：已完成功能包括自定义数据类型/全局变量/常量表/资源/DLL命令编辑器、AI代码助手、自定义主题、自定义字体、无障碍(Accessibility)支持（WAI-ARIA、键盘导航、屏幕阅读器、焦点管理）。开发中：调试器集成、编译输出优化、会员系统、插件系统。'
  const streamSystemContent = request.ideContext
    ? `你是严谨的代码修改助手。只输出 JSON。${streamYcideIntro}\n\n当前 IDE 环境信息:\n${request.ideContext}`
    : `你是严谨的代码修改助手。只输出 JSON。${streamYcideIntro}`

  const completion = await requestCompletionStream(request.model, [
    { role: 'system', content: streamSystemContent },
    { role: 'user', content: prompt },
  ], onDelta, apiKeyOverride, customModels, onReasoning)

  if (!completion.ok) {
    return {
      ok: false,
      filePath: request.filePath,
      summary: '',
      diff: '',
      originalContent: request.fileContent,
      proposedContent: '',
      error: completion.error,
    }
  }

  const parsed = tryParseJsonBlock(completion.content) as { summary?: unknown; updatedContent?: unknown } | null
  const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : ''
  const updatedContent = typeof parsed?.updatedContent === 'string' ? parsed.updatedContent : ''

  if (!updatedContent) {
    return {
      ok: false,
      filePath: request.filePath,
      summary: '',
      diff: '',
      originalContent: request.fileContent,
      proposedContent: '',
      error: 'AI 未返回有效的 updatedContent。',
    }
  }

  const diff = createPatch(request.filePath, request.fileContent, updatedContent, 'before', 'after', { context: 3 })

  return {
    ok: true,
    filePath: request.filePath,
    summary: summary || '已生成编辑建议。',
    diff,
    originalContent: request.fileContent,
    proposedContent: updatedContent,
  }
}
