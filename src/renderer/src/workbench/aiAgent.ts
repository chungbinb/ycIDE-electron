// AI Agent 循环（设计稿 §6.7 aiAgents）：与具体工具无关，工具来自插件的 aiTools 贡献点，
// 每个工具对应一条命令，用 executeCommand(工具命令, 参数对象, 运行上下文) 执行。
// 内置工具（读写项目文件、终端）的实现见 App.tsx 中注册的 aiTool:* 命令。

import type { AIChatMessage, AIChatTool, AIChatWithToolsResult } from '../../../shared/ai'
import type { AIToolEntry } from '../../../shared/plugin/aiContributions'

/** 传给工具命令的第二个参数 */
export interface AgentToolContext {
  projectDir: string
  /** 同一次 Agent 任务内不变，工具可据此缓存（如项目文件清单） */
  runId: number
}

/** 工具命令的返回值；插件工具也可以直接返回任意可序列化的值，视为成功 */
export interface AgentToolResult {
  ok: boolean
  /** 交给模型的结果（序列化为 JSON） */
  data: unknown
  /** 显示在 Agent 日志里，每项一行 */
  logs?: string[]
  /** 工具轨迹面板里显示的结果，缺省用 data */
  trace?: unknown
  /** 修改了文件时的统计，面板据此显示「主要改动」 */
  edit?: { filePath: string; addedLines: number; deletedLines: number }
}

export interface AgentToolTrace {
  id: string
  tool: string
  ok: boolean
  args: string
  result: string
}

export interface AgentTaskResult {
  ok: boolean
  logs: string[]
  finalMessage?: string
  error?: string
  primaryEdit?: { filePath: string; addedLines: number; deletedLines: number }
}

export interface AgentRunOptions {
  projectDir: string
  runId: number
  runtimePlatform: string
  tools: AIToolEntry[]
  chatWithTools: (messages: AIChatMessage[], tools: AIChatTool[]) => Promise<AIChatWithToolsResult>
  executeCommand: (command: string, ...args: unknown[]) => Promise<unknown>
  /** 第三方插件的 write / exec 工具调用前询问用户，返回 false 表示拒绝 */
  confirmTool: (tool: AIToolEntry, args: Record<string, unknown>) => Promise<boolean>
  onLog?: (line: string) => void
  onToolTrace?: (trace: AgentToolTrace) => void
  maxRounds?: number
}

const NETWORK_GOAL_PATTERN = /网络|联网|连通|连接|ping|internet|connectivity|dns|丢包/

function toPrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function toTraceText(value: unknown): string {
  const raw = typeof value === 'string' ? value : toPrettyJson(value)
  if (raw.length <= 4000) return raw
  return `${raw.slice(0, 4000)}\n...(已截断)`
}

export function normalizeToolResult(raw: unknown): AgentToolResult {
  if (raw && typeof raw === 'object' && 'ok' in raw && 'data' in raw) return raw as AgentToolResult
  return { ok: true, data: raw === undefined ? { ok: true } : raw }
}

/** 第三方插件的写入 / 执行类工具需要用户确认；内置工具保持原有行为 */
export function toolNeedsConfirmation(tool: AIToolEntry): boolean {
  return !tool.builtin && (tool.risk === 'write' || tool.risk === 'exec')
}

export function toModelTools(tools: AIToolEntry[]): AIChatTool[] {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? { type: 'object', properties: {}, additionalProperties: false },
    },
  }))
}

export async function runAgentTask(goal: string, options: AgentRunOptions): Promise<AgentTaskResult> {
  const { projectDir, runId, tools, chatWithTools, executeCommand, confirmTool, onLog, onToolTrace } = options
  const context: AgentToolContext = { projectDir, runId }
  const logs: string[] = []
  const reportLog = (line: string): void => {
    if (!line) return
    logs.push(line)
    onLog?.(line)
  }
  const toolByName = new Map(tools.map(t => [t.name, t]))

  const callTool = async (tool: AIToolEntry, args: Record<string, unknown>): Promise<AgentToolResult> => {
    try {
      return normalizeToolResult(await executeCommand(tool.command, args, context))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, data: { ok: false, error: message }, logs: [`工具 ${tool.name} 失败：${message}`] }
    }
  }

  // 网络连通性诊断：直接用终端工具执行 ping，不走模型
  const terminalSend = toolByName.get('terminal_send')
  if (terminalSend && NETWORK_GOAL_PATTERN.test((goal || '').toLowerCase())) {
    reportLog('检测到网络连通性意图，优先使用终端命令进行诊断。')
    const command = options.runtimePlatform === 'windows' ? 'ping -n 4 8.8.8.8' : 'ping -c 4 8.8.8.8'
    const result = await callTool(terminalSend, { command, pollAttempts: 8, pollIntervalMs: 300, outputLimit: 1800 })
    result.logs?.forEach(reportLog)
    if (!result.ok) {
      const error = (result.data as { error?: string } | null)?.error
      return { ok: false, logs, error: error || '网络诊断命令执行失败。' }
    }
    return { ok: true, logs, finalMessage: '网络连通性检查已完成，结果见上方终端输出。' }
  }

  // 项目文件清单写进系统提示，帮助模型选对路径
  let relFiles: string[] = []
  const listFiles = toolByName.get('list_files')
  if (listFiles) {
    const listed = await callTool(listFiles, { forPrompt: true })
    const files = (listed.data as { files?: unknown } | null)?.files
    relFiles = Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : []
  }
  if (relFiles.length === 0) reportLog('未索引到可编辑源码文件。')

  const modelTools = toModelTools(tools)
  const messages: AIChatMessage[] = [
    {
      role: 'system',
      content: [
        '你是 ycIDE 的项目级 Agent。',
        '你必须优先通过 function calling 使用工具完成任务，只有在任务完成时再给简短最终结论。',
        '当目标涉及网络检查（网络、联网、连通、ping、dns）时，优先使用 terminal_send 执行 ping。',
        '文件路径必须使用项目根目录下的相对路径。',
        `项目根目录：${projectDir}`,
        `可用文件清单（相对路径）:\n${relFiles.join('\n')}`,
      ].join('\n'),
    },
    { role: 'user', content: goal },
  ]

  let primaryEdit: AgentTaskResult['primaryEdit']
  const maxRounds = options.maxRounds ?? 8
  for (let round = 0; round < maxRounds; round++) {
    const response = await chatWithTools(messages, modelTools)
    if (!response.ok) {
      return { ok: false, logs, error: response.error || 'Agent 执行失败。' }
    }
    messages.push({ role: 'assistant', content: response.message || '', tool_calls: response.toolCalls })

    const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : []
    if (toolCalls.length === 0) {
      return { ok: true, logs, finalMessage: response.message || 'Agent 执行完成。', primaryEdit }
    }

    for (const toolCall of toolCalls) {
      const name = toolCall?.function?.name || 'unknown'
      let args: Record<string, unknown> = {}
      try {
        const parsed = JSON.parse(toolCall?.function?.arguments || '{}') as unknown
        if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>
      } catch {
        args = {}
      }
      const emitTrace = (ok: boolean, result: unknown): void => {
        onToolTrace?.({ id: toolCall.id, tool: name, ok, args: toTraceText(args), result: toTraceText(result) })
      }

      const tool = toolByName.get(name)
      if (!tool) {
        reportLog(`工具调用失败：不支持的工具 ${name}`)
        const data = { ok: false, error: `不支持的工具: ${name}` }
        messages.push({ role: 'tool', tool_call_id: toolCall.id, name, content: JSON.stringify(data) })
        emitTrace(false, data)
        continue
      }

      if (toolNeedsConfirmation(tool) && !(await confirmTool(tool, args))) {
        reportLog(`工具 ${name}：用户拒绝执行。`)
        const data = { ok: false, error: '用户拒绝执行该工具。' }
        messages.push({ role: 'tool', tool_call_id: toolCall.id, name, content: JSON.stringify(data) })
        emitTrace(false, data)
        continue
      }

      const result = await callTool(tool, args)
      result.logs?.forEach(reportLog)
      if (result.ok && result.edit && !primaryEdit) primaryEdit = result.edit
      messages.push({ role: 'tool', tool_call_id: toolCall.id, name, content: JSON.stringify(result.data) })
      emitTrace(result.ok, result.trace ?? result.data)
    }
  }

  return { ok: true, logs, finalMessage: 'Agent 达到调用轮次上限，已停止。', primaryEdit }
}

// ───────────── 内置工具用到的项目路径工具函数 ─────────────

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'test-results'])

export interface ProjectPathHelpers {
  toRelative(absolutePath: string): string
  /** 把模型给出的路径解析为项目内的绝对路径；越出项目目录返回 null */
  resolveProjectPath(rawPath?: string): string | null
}

export function createProjectPathHelpers(projectDir: string, joinPath: (a: string, b: string) => string, pathSeparator: string): ProjectPathHelpers {
  const normalizedProjectDir = projectDir.replace(/\//g, '\\').replace(/[\\]+$/, '')
  const projectDirLower = normalizedProjectDir.toLowerCase()
  return {
    toRelative(absolutePath) {
      const normalized = (absolutePath || '').replace(/\//g, '\\')
      if (normalized.toLowerCase().startsWith(projectDirLower)) {
        return normalized.slice(normalizedProjectDir.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
      }
      return normalized.replace(/\\/g, '/')
    },
    resolveProjectPath(rawPath) {
      const candidate = (rawPath || '').trim()
      if (!candidate) return null
      const isAbsolute = /^[a-zA-Z]:[\\/]/.test(candidate) || candidate.startsWith('\\\\') || candidate.startsWith('/')
      const absolute = isAbsolute
        ? candidate.replace(/\//g, '\\')
        : joinPath(projectDir, candidate.replace(/\//g, pathSeparator))
      const normalized = absolute.replace(/\//g, '\\')
      const lower = normalized.toLowerCase()
      if (lower === projectDirLower) return normalized
      if (!lower.startsWith(`${projectDirLower}\\`)) return null
      return normalized
    },
  }
}

/** 递归收集项目内可由 AI 编辑的源码文件（最多 500 个、8 层） */
export async function collectEditableFiles(
  projectDir: string,
  readDir: (dir: string) => Promise<string[] | undefined>,
  joinPath: (a: string, b: string) => string,
  isEditable: (fileName: string) => boolean,
): Promise<string[]> {
  const files: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8 || files.length >= 500) return
    let entries: string[] | undefined
    try {
      entries = await readDir(dir)
    } catch {
      return
    }
    if (!entries || entries.length === 0) return
    for (const name of entries) {
      if (!name || files.length >= 500) break
      const full = joinPath(dir, name)
      if (isEditable(name)) {
        files.push(full)
        continue
      }
      if (SKIP_DIRS.has(name.toLowerCase())) continue
      let child: string[] | undefined
      try {
        child = await readDir(full)
      } catch {
        child = undefined
      }
      if (Array.isArray(child)) await walk(full, depth + 1)
    }
  }
  await walk(projectDir, 0)
  return files
}
