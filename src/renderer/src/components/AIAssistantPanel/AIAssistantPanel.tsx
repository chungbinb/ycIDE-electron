import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AIChatMessage, AICustomModelConfig, AIEditResult, AISupportedModel } from '../../../../shared/ai'
import { resolveIDESettings } from '../../../../shared/settings'
import type { FileProblem } from '../OutputPanel/OutputPanel'
import Icon from '../Icon/Icon'
import './AIAssistantPanel.css'

const AI_PANEL_MIN_WIDTH = 280
const AI_PANEL_MAX_WIDTH = 800
const AI_PANEL_DEFAULT_WIDTH = 420

type ChatEntry = {
  role: 'user' | 'assistant'
  content: string
  toolTrace?: {
    id: string
    tool: string
    ok: boolean
    args: string
    result: string
  }
}

type DiffHunk = {
  id: number
  oldStart: number
  oldCount: number
  lines: string[]
}

type EditChangeSummary = {
  filePath: string
  fileName: string
  addedLines: number
  deletedLines: number
  applied: boolean
}

type PanelMode = 'chat' | 'edit' | 'plan' | 'agent'

type AgentDecision = {
  intent: 'answer' | 'edit'
  message: string
  editInstruction?: string
}

type AgentTaskResult = {
  ok: boolean
  logs: string[]
  finalMessage?: string
  error?: string
  primaryEdit?: {
    filePath: string
    addedLines: number
    deletedLines: number
  }
}

interface AIAssistantPanelProps {
  model: AISupportedModel
  customModels: AICustomModelConfig[]
  activeFilePath: string | null
  activeFileLabel: string | null
  problems?: FileProblem[]
  placement?: 'left' | 'right'
  ideContext?: string
  aiFontFamily?: string
  aiFontSize?: number
  onModelChange: (model: AISupportedModel, persist?: boolean) => void
  onChat: (messages: AIChatMessage[]) => Promise<{ ok: boolean; message: string; error?: string }>
  onChatStream?: (messages: AIChatMessage[], onDelta: (delta: string) => void) => Promise<{ ok: boolean; message: string; error?: string }>
  onRequestEdit: (instruction: string, targetFilePath: string) => Promise<AIEditResult>
  onRequestEditStream?: (instruction: string, targetFilePath: string, onDelta: (delta: string) => void, onReasoning?: (delta: string) => void) => Promise<AIEditResult>
  onApplyEdit: (result: AIEditResult, overrideContent?: string) => Promise<boolean>
  onUndoEdit: (result: AIEditResult) => Promise<boolean>
  onKeepEdit: () => void
  onCancelRunning?: () => void
  onAgentTask?: (
    goal: string,
    onLog?: (line: string) => void,
    onToolTrace?: (trace: { id: string; tool: string; ok: boolean; args: string; result: string }) => void,
  ) => Promise<AgentTaskResult>
}

function parseDiffHunks(diffText: string): DiffHunk[] {
  const lines = (diffText || '').replace(/\r\n/g, '\n').split('\n')
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null

  for (const line of lines) {
    const header = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(line)
    if (header) {
      if (current) hunks.push(current)
      current = {
        id: hunks.length,
        oldStart: Number.parseInt(header[1], 10),
        oldCount: Number.parseInt(header[2] || '1', 10),
        lines: [],
      }
      continue
    }
    if (current) current.lines.push(line)
  }

  if (current) hunks.push(current)
  return hunks
}

function buildContentFromSelectedHunks(original: string, hunks: DiffHunk[], selectedIds: Set<number>): string {
  const normalized = (original || '').replace(/\r\n/g, '\n')
  const hadTrailingNewline = normalized.endsWith('\n')
  const originalLines = normalized.split('\n')
  if (hadTrailingNewline) originalLines.pop()

  const output: string[] = []
  let cursor = 1

  for (const hunk of hunks) {
    while (cursor < hunk.oldStart && cursor <= originalLines.length) {
      output.push(originalLines[cursor - 1] || '')
      cursor++
    }

    const selected = selectedIds.has(hunk.id)
    let localCursor = cursor

    for (const line of hunk.lines) {
      if (line.startsWith('\\')) continue

      if (selected) {
        if (line.startsWith(' ')) {
          output.push(originalLines[localCursor - 1] || '')
          localCursor++
        } else if (line.startsWith('-')) {
          localCursor++
        } else if (line.startsWith('+')) {
          output.push(line.slice(1))
        }
      } else if (line.startsWith(' ') || line.startsWith('-')) {
        output.push(originalLines[localCursor - 1] || '')
        localCursor++
      }
    }

    cursor = localCursor
  }

  while (cursor <= originalLines.length) {
    output.push(originalLines[cursor - 1] || '')
    cursor++
  }

  const rebuilt = output.join('\n')
  return hadTrailingNewline ? `${rebuilt}\n` : rebuilt
}

function getFileName(pathOrLabel: string): string {
  const normalized = (pathOrLabel || '').replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] || pathOrLabel
}

function tryParseJsonBlock(text: string): unknown {
  const trimmed = (text || '').trim()
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

function parseAgentDecision(text: string): AgentDecision {
  const parsed = tryParseJsonBlock(text) as Partial<AgentDecision> | null
  const intent = parsed?.intent === 'edit' ? 'edit' : 'answer'
  const message = typeof parsed?.message === 'string' && parsed.message.trim()
    ? parsed.message.trim()
    : (text || '').trim()
  const editInstruction = typeof parsed?.editInstruction === 'string' && parsed.editInstruction.trim()
    ? parsed.editInstruction.trim()
    : undefined
  return { intent, message, editInstruction }
}

function AIAssistantPanel({
  model,
  customModels,
  activeFilePath,
  activeFileLabel,
  problems,
  placement = 'right',
  ideContext,
  aiFontFamily,
  aiFontSize,
  onModelChange,
  onChat,
  onChatStream,
  onRequestEdit,
  onRequestEditStream,
  onApplyEdit,
  onUndoEdit,
  onKeepEdit,
  onCancelRunning,
  onAgentTask,
}: AIAssistantPanelProps): React.JSX.Element {
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem('ycide.aiPanel.width.v1'))
      return v >= AI_PANEL_MIN_WIDTH && v <= AI_PANEL_MAX_WIDTH ? v : AI_PANEL_DEFAULT_WIDTH
    } catch { return AI_PANEL_DEFAULT_WIDTH }
  })
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = panelWidth
    const onMove = (ev: MouseEvent): void => {
      const delta = placement === 'right' ? startX - ev.clientX : ev.clientX - startX
      const next = Math.max(AI_PANEL_MIN_WIDTH, Math.min(AI_PANEL_MAX_WIDTH, startWidth + delta))
      setPanelWidth(next)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [panelWidth, placement])
  useEffect(() => {
    try { localStorage.setItem('ycide.aiPanel.width.v1', String(panelWidth)) } catch {}
  }, [panelWidth])

  const [mode, setModeState] = useState<PanelMode>(() => {
    try {
      const v = localStorage.getItem('ycide.aiPanel.mode.v1')
      return v === 'edit' || v === 'plan' || v === 'agent' ? v : 'chat'
    } catch {
      return 'chat'
    }
  })
  const setMode = (m: PanelMode): void => {
    setModeState(m)
    try { localStorage.setItem('ycide.aiPanel.mode.v1', m) } catch {}
  }
  const [chatInput, setChatInput] = useState('')
  const [editInput, setEditInput] = useState('')
  const [planInput, setPlanInput] = useState('')
  const [agentInput, setAgentInput] = useState('')
  const [chatHistory, setChatHistory] = useState<ChatEntry[]>([])
  const [planHistory, setPlanHistory] = useState<ChatEntry[]>([])
  const [agentHistory, setAgentHistory] = useState<ChatEntry[]>([])
  const [pendingEdit, setPendingEdit] = useState<AIEditResult | null>(null)
  const [lastEditInstruction, setLastEditInstruction] = useState('')
  const [editMessages, setEditMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [editBusy, setEditBusy] = useState(false)
  const [editApplying, setEditApplying] = useState(false)
  const [agentRunning, setAgentRunning] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedHunks, setSelectedHunks] = useState<number[]>([])
  const [editChangeSummary, setEditChangeSummary] = useState<EditChangeSummary | null>(null)
  const [showModelConfig, setShowModelConfig] = useState(false)
  const [configModel, setConfigModel] = useState<AISupportedModel>(model)
  const [configDeepseekKey, setConfigDeepseekKey] = useState('')
  const [configGlmKey, setConfigGlmKey] = useState('')
  const [configCustomModels, setConfigCustomModels] = useState<AICustomModelConfig[]>([])
  const [configBusy, setConfigBusy] = useState(false)
  const [configStatus, setConfigStatus] = useState<string | null>(null)
  const runIdCounterRef = useRef(0)
  const activeRunIdRef = useRef<number | null>(null)
  const canceledRunIdsRef = useRef<Set<number>>(new Set())

  const modelOptions: Array<{ value: AISupportedModel; label: string }> = useMemo(() => {
    const builtins: Array<{ value: AISupportedModel; label: string }> = [
      { value: 'deepseek', label: 'DeepSeek V4-Pro' },
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4-Flash' },
      { value: 'deepseek-v3.2', label: 'DeepSeek V3.2' },
      { value: 'glm', label: 'GLM' },
    ]
    const customs = (customModels || []).map((item) => ({ value: item.id, label: item.label }))
    return [...builtins, ...customs]
  }, [customModels])

  const resolvedEditTarget = activeFilePath || ''

  const parsedHunks = useMemo(() => {
    if (!pendingEdit?.ok) return [] as DiffHunk[]
    return parseDiffHunks(pendingEdit.diff)
  }, [pendingEdit])

  useEffect(() => {
    setSelectedHunks(parsedHunks.map(item => item.id))
  }, [parsedHunks])

  const composerValue = mode === 'chat'
    ? chatInput
    : mode === 'edit'
      ? editInput
      : mode === 'plan'
        ? planInput
        : agentInput
  const primaryActionLabel = mode === 'chat'
    ? '发送'
    : mode === 'edit'
      ? '生成 DIFF'
      : mode === 'plan'
        ? '生成计划'
        : '执行 Agent'
  const composerPlaceholder = mode === 'chat'
    ? '输入你的问题...'
    : mode === 'edit'
      ? '描述你要对当前文件做的修改...'
      : mode === 'plan'
        ? '输入你的目标，生成结构化执行计划...'
        : '输入你的目标，Agent 将自动拆解并执行可执行步骤...'
  const composerAriaLabel = mode === 'chat'
    ? '聊天输入'
    : mode === 'edit'
      ? '编辑指令'
      : mode === 'plan'
        ? '计划指令'
        : 'Agent 任务指令'

  const composerRef = useRef<HTMLTextAreaElement>(null)
  const autoResizeComposer = useCallback((): void => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  // 切换 mode 或值变化或字号变化时也重新计算高度
  useEffect(() => { autoResizeComposer() }, [composerValue, aiFontSize, autoResizeComposer])

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter' || e.shiftKey) return
    if ((e.nativeEvent as KeyboardEvent).isComposing) return
    e.preventDefault()
    if (mode === 'chat') {
      void handleSendChat()
      return
    }
    if (mode === 'edit') {
      void handleGenerateEdit()
      return
    }
    if (mode === 'plan') {
      void handleGeneratePlan()
      return
    }
    void handleRunAgent()
  }

  const beginRun = (): number => {
    const runId = ++runIdCounterRef.current
    activeRunIdRef.current = runId
    canceledRunIdsRef.current.delete(runId)
    return runId
  }

  const isRunCanceled = (runId: number): boolean => canceledRunIdsRef.current.has(runId)

  const finishRun = (runId: number): void => {
    canceledRunIdsRef.current.delete(runId)
    if (activeRunIdRef.current === runId) activeRunIdRef.current = null
  }

  const handleStopRunning = (): void => {
    const activeRunId = activeRunIdRef.current
    if (activeRunId !== null) {
      canceledRunIdsRef.current.add(activeRunId)
      activeRunIdRef.current = null
    }
    onCancelRunning?.()
    setBusy(false)
    setEditBusy(false)
    setEditApplying(false)
    setAgentRunning(false)
    setStatus('已停止当前 AI 任务。')
  }

  const handleSendChat = async (): Promise<void> => {
    const prompt = chatInput.trim()
    if (!prompt || busy) return
    const runId = beginRun()

    const nextHistory = [...chatHistory, { role: 'user' as const, content: prompt }]
    setChatHistory([...nextHistory, { role: 'assistant', content: '' }])
    setChatInput('')
    setBusy(true)
    setStatus(null)

    const problemsContext = (problems && problems.length > 0)
      ? '\n\n当前问题面板的诊断信息:\n' + problems.map(p => {
        const loc = p.file ? `${p.file} 行${p.line}:${p.column}` : `行${p.line}:${p.column}`
        return `  [${p.severity}] ${loc} - ${p.message}`
      }).join('\n')
      : ''

    const ideInfo = ideContext ? `\n\n当前 IDE 环境信息:\n${ideContext}` : ''

    const ycideIntro = [
      '\n\n关于 ycIDE：',
      'ycIDE 是基于 Electron + React + TypeScript 的易承语言集成开发环境。',
      '已完成功能：自定义数据类型/全局变量/常量表/资源/DLL命令编辑器、AI代码助手、自定义主题、自定义字体、无障碍(Accessibility)支持（WAI-ARIA地标角色、键盘导航、屏幕阅读器支持、焦点管理、axe-core自动化测试）。',
      '开发中功能：调试器集成、编译输出优化、会员系统、插件系统、快捷键自定义。',
    ].join('\n')

    const messages: AIChatMessage[] = [
      { role: 'system', content: `你是 ycIDE 的 AI 助手。请用简洁、可执行的中文回答。当用户询问 ycIDE 自身功能时，请基于以下信息回答，不要猜测。${ycideIntro}${ideInfo}${problemsContext}` },
      ...nextHistory.map(item => ({ role: item.role, content: item.content })),
    ]

    const appendAssistantDelta = (delta: string): void => {
      if (!delta || isRunCanceled(runId)) return
      setChatHistory((prev) => {
        if (prev.length === 0) return prev
        const next = [...prev]
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === 'assistant') {
            next[i] = { ...next[i], content: `${next[i].content}${delta}` }
            return next
          }
        }
        return [...next, { role: 'assistant', content: delta }]
      })
    }

    const result = onChatStream
      ? await onChatStream(messages, appendAssistantDelta)
      : await onChat(messages)

    if (isRunCanceled(runId)) {
      finishRun(runId)
      return
    }

    if (!result.ok) {
      setChatHistory((prev) => {
        if (prev.length === 0) return prev
        const next = [...prev]
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === 'assistant') {
            next[i] = { ...next[i], content: result.error || '聊天请求失败。' }
            return next
          }
        }
        return [...next, { role: 'assistant', content: result.error || '聊天请求失败。' }]
      })
      setStatus(result.error || '聊天请求失败。')
      setBusy(false)
      finishRun(runId)
      return
    }

    if (!onChatStream) {
      setChatHistory((prev) => {
        if (prev.length === 0) return prev
        const next = [...prev]
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === 'assistant') {
            next[i] = { ...next[i], content: result.message }
            return next
          }
        }
        return [...next, { role: 'assistant', content: result.message }]
      })
    }
    setBusy(false)
    finishRun(runId)
  }

  const handleGeneratePlan = async (): Promise<void> => {
    const prompt = planInput.trim()
    if (!prompt || busy) return
    const runId = beginRun()

    const nextHistory = [...planHistory, { role: 'user' as const, content: prompt }]
    setPlanHistory([...nextHistory, { role: 'assistant', content: '' }])
    setPlanInput('')
    setBusy(true)
    setStatus(null)

    const problemsContext = (problems && problems.length > 0)
      ? '\n\n当前问题面板的诊断信息:\n' + problems.map(p => {
        const loc = p.file ? `${p.file} 行${p.line}:${p.column}` : `行${p.line}:${p.column}`
        return `  [${p.severity}] ${loc} - ${p.message}`
      }).join('\n')
      : ''
    const ideInfo = ideContext ? `\n\n当前 IDE 环境信息:\n${ideContext}` : ''
    const fileInfo = resolvedEditTarget
      ? `\n\n当前激活文件: ${resolvedEditTarget}`
      : '\n\n当前没有激活可编辑源码文件。'

    const messages: AIChatMessage[] = [
      {
        role: 'system',
        content: `你是 ycIDE 的 Plan 模式助手。请基于用户目标输出结构化执行计划，要求包含：目标、前置假设、执行步骤（编号）、风险与回退、验证清单。回复使用中文，格式用 Markdown。不要直接修改代码。${ideInfo}${fileInfo}${problemsContext}`,
      },
      ...nextHistory.map(item => ({ role: item.role, content: item.content })),
    ]

    const appendAssistantDelta = (delta: string): void => {
      if (!delta || isRunCanceled(runId)) return
      setPlanHistory((prev) => {
        if (prev.length === 0) return prev
        const next = [...prev]
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === 'assistant') {
            next[i] = { ...next[i], content: `${next[i].content}${delta}` }
            return next
          }
        }
        return [...next, { role: 'assistant', content: delta }]
      })
    }

    const result = onChatStream
      ? await onChatStream(messages, appendAssistantDelta)
      : await onChat(messages)

    if (isRunCanceled(runId)) {
      finishRun(runId)
      return
    }

    if (!result.ok) {
      setPlanHistory((prev) => {
        if (prev.length === 0) return prev
        const next = [...prev]
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === 'assistant') {
            next[i] = { ...next[i], content: result.error || '计划生成失败。' }
            return next
          }
        }
        return [...next, { role: 'assistant', content: result.error || '计划生成失败。' }]
      })
      setStatus(result.error || '计划生成失败。')
      setBusy(false)
      finishRun(runId)
      return
    }

    if (!onChatStream) {
      setPlanHistory((prev) => {
        if (prev.length === 0) return prev
        const next = [...prev]
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === 'assistant') {
            next[i] = { ...next[i], content: result.message }
            return next
          }
        }
        return [...next, { role: 'assistant', content: result.message }]
      })
    }
    setBusy(false)
    finishRun(runId)
  }

  const handleRunAgent = async (): Promise<void> => {
    const goal = agentInput.trim()
    if (!goal || busy) return
    const runId = beginRun()

    if (onAgentTask) {
      setAgentInput('')
      setAgentRunning(true)
      setBusy(true)
      setStatus(null)
      setPendingEdit(null)

      setAgentHistory(prev => [
        ...prev,
        { role: 'user', content: goal },
      ])

      const streamedLogSet = new Set<string>()
      const result = await onAgentTask(goal, (line) => {
        if (!line || isRunCanceled(runId)) return
        streamedLogSet.add(line)
        setAgentHistory(prev => [...prev, { role: 'assistant', content: line }])
      }, (trace) => {
        if (!trace || isRunCanceled(runId)) return
        setAgentHistory(prev => [...prev, {
          role: 'assistant',
          content: `工具 ${trace.tool} (${trace.ok ? '成功' : '失败'})`,
          toolTrace: trace,
        }])
      })
      if (isRunCanceled(runId)) {
        finishRun(runId)
        return
      }
      const logEntries = (result.logs || []).filter(Boolean)
      const remainingLogs = logEntries.filter(line => !streamedLogSet.has(line))
      if (remainingLogs.length > 0) {
        setAgentHistory(prev => [...prev, ...remainingLogs.map(content => ({ role: 'assistant' as const, content }))])
      }
      if (result.finalMessage) {
        const finalMessage = result.finalMessage
        setAgentHistory(prev => [...prev, { role: 'assistant', content: finalMessage }])
      }
      if (result.primaryEdit) {
        setEditChangeSummary({
          filePath: result.primaryEdit.filePath,
          fileName: getFileName(result.primaryEdit.filePath),
          addedLines: result.primaryEdit.addedLines,
          deletedLines: result.primaryEdit.deletedLines,
          applied: true,
        })
      } else {
        setEditChangeSummary(null)
      }
      if (!result.ok) {
        setStatus(result.error || 'Agent 执行失败。')
      }
      setAgentRunning(false)
      setBusy(false)
      finishRun(runId)
      return
    }

    setAgentInput('')
    setAgentRunning(true)
    setBusy(true)
    setStatus(null)
    setPendingEdit(null)

    setAgentHistory(prev => [
      ...prev,
      { role: 'user', content: goal },
      { role: 'assistant', content: '正在制定执行方案...' },
    ])

    const problemsContext = (problems && problems.length > 0)
      ? '\n\n当前问题面板的诊断信息:\n' + problems.map(p => {
        const loc = p.file ? `${p.file} 行${p.line}:${p.column}` : `行${p.line}:${p.column}`
        return `  [${p.severity}] ${loc} - ${p.message}`
      }).join('\n')
      : ''
    const ideInfo = ideContext ? `\n\n当前 IDE 环境信息:\n${ideContext}` : ''
    const fileInfo = resolvedEditTarget
      ? `\n\n当前激活文件: ${resolvedEditTarget}`
      : '\n\n当前没有激活可编辑源码文件。'

    const agentMessages: AIChatMessage[] = [
      {
        role: 'system',
        content: `你是 ycIDE 的 Agent 模式编程助手。请先判断用户目标是否需要修改代码。必须只返回 JSON，格式：{"intent":"answer|edit","message":"给用户的说明","editInstruction":"当 intent=edit 时提供具体编辑指令"}。如果无需改代码，用 answer。若需要改代码，用 edit 并提供可直接执行的单文件编辑指令。${ideInfo}${fileInfo}${problemsContext}`,
      },
      { role: 'user', content: goal },
    ]

    const decisionResult = await onChat(agentMessages)
    if (isRunCanceled(runId)) {
      finishRun(runId)
      return
    }
    if (!decisionResult.ok) {
      setAgentHistory(prev => [...prev, { role: 'assistant', content: decisionResult.error || 'Agent 执行失败。' }])
      setStatus(decisionResult.error || 'Agent 执行失败。')
      setAgentRunning(false)
      setBusy(false)
      finishRun(runId)
      return
    }

    const decision = parseAgentDecision(decisionResult.message)
    setAgentHistory(prev => [...prev, { role: 'assistant', content: decision.message || '已完成分析。' }])

    if (decision.intent !== 'edit' || !decision.editInstruction) {
      setAgentRunning(false)
      setBusy(false)
      finishRun(runId)
      return
    }

    if (!resolvedEditTarget) {
      setAgentHistory(prev => [...prev, { role: 'assistant', content: '当前没有激活可编辑文件，无法执行自动修改。' }])
      setStatus('请先激活一个可编辑源码文件后再运行 Agent。')
      setAgentRunning(false)
      setBusy(false)
      finishRun(runId)
      return
    }

    setAgentHistory(prev => [...prev, { role: 'assistant', content: `开始自动修改 ${getFileName(resolvedEditTarget)} ...` }])
    const editResult = onRequestEditStream
      ? await onRequestEditStream(decision.editInstruction, resolvedEditTarget, () => {}, () => {})
      : await onRequestEdit(decision.editInstruction, resolvedEditTarget)

    if (isRunCanceled(runId)) {
      finishRun(runId)
      return
    }

    setPendingEdit(editResult)
    if (!editResult.ok) {
      setAgentHistory(prev => [...prev, { role: 'assistant', content: editResult.error || '自动修改失败。' }])
      setStatus(editResult.error || '自动修改失败。')
      setEditChangeSummary(null)
      setAgentRunning(false)
      setBusy(false)
      finishRun(runId)
      return
    }

    const applied = await onApplyEdit(editResult)
    if (!applied) {
      setAgentHistory(prev => [...prev, { role: 'assistant', content: '已生成修改方案，但自动应用失败。' }])
      setStatus('自动应用失败，请检查目标文件状态。')
      setEditChangeSummary(null)
      setAgentRunning(false)
      setBusy(false)
      finishRun(runId)
      return
    }

    const hunks = parseDiffHunks(editResult.diff)
    let added = 0
    let deleted = 0
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+')) added++
        else if (line.startsWith('-')) deleted++
      }
    }
    setEditChangeSummary({
      filePath: editResult.filePath,
      fileName: getFileName(editResult.filePath),
      addedLines: added,
      deletedLines: deleted,
      applied: true,
    })
    setAgentHistory(prev => [...prev, { role: 'assistant', content: editResult.summary || 'Agent 已完成自动修改并应用。' }])
    setAgentRunning(false)
    setBusy(false)
    finishRun(runId)
  }

  const handleGenerateEdit = async (): Promise<void> => {
    const instruction = editInput.trim()
    if (!instruction || busy) return
    if (!resolvedEditTarget) {
      setStatus('请先在编辑器中激活一个可编辑文件。')
      return
    }
    const runId = beginRun()

    setEditInput('')
    setLastEditInstruction(instruction)
    setEditMessages(prev => [...prev, { role: 'user', content: instruction }])
    setEditBusy(true)
    setEditApplying(false)
    setBusy(true)
    setStatus(null)
    setPendingEdit(null)

    // 添加一个空的 assistant 消息用于流式追加
    let streamingIdx = -1
    setEditMessages(prev => {
      streamingIdx = prev.length
      return [...prev, { role: 'assistant', content: '' }]
    })

    let hasReasoningContent = false

    const appendReasoningDelta = (delta: string): void => {
      if (!delta || isRunCanceled(runId)) return
      hasReasoningContent = true
      setEditMessages(prev => {
        if (streamingIdx < 0 || streamingIdx >= prev.length) return prev
        const next = [...prev]
        next[streamingIdx] = { ...next[streamingIdx], content: next[streamingIdx].content + delta }
        return next
      })
    }

    const appendContentDelta = (_delta: string): void => {
      if (isRunCanceled(runId)) return
      // content delta 是 JSON 文本，不适合展示
      // 如果没有 reasoning 内容，至少显示在思考
      if (!hasReasoningContent) {
        setEditMessages(prev => {
          if (streamingIdx < 0 || streamingIdx >= prev.length) return prev
          const current = prev[streamingIdx]
          if (current.content === '') {
            const next = [...prev]
            next[streamingIdx] = { ...next[streamingIdx], content: '正在分析代码...' }
            return next
          }
          return prev
        })
      }
    }

    const result = onRequestEditStream
      ? await onRequestEditStream(instruction, resolvedEditTarget, appendContentDelta, appendReasoningDelta)
      : await onRequestEdit(instruction, resolvedEditTarget)

    if (isRunCanceled(runId)) {
      finishRun(runId)
      return
    }

    // AI 返回完成，进入应用阶段
    setEditApplying(true)
    setEditBusy(false)

    setPendingEdit(result)
    if (!result.ok) {
      // 清除流式消息或更新为错误
      setEditMessages(prev => {
        const next = [...prev]
        if (streamingIdx >= 0 && streamingIdx < next.length && !next[streamingIdx].content) {
          next.splice(streamingIdx, 1)
        }
        return [...next, { role: 'assistant', content: result.error || '编辑建议生成失败。' }]
      })
      setEditChangeSummary(null)
    } else {
      const applied = await onApplyEdit(result)
      if (applied) {
        const hunks = parseDiffHunks(result.diff)
        let added = 0
        let deleted = 0
        for (const hunk of hunks) {
          for (const line of hunk.lines) {
            if (line.startsWith('+')) added++
            else if (line.startsWith('-')) deleted++
          }
        }
        setEditChangeSummary({
          filePath: result.filePath,
          fileName: getFileName(result.filePath),
          addedLines: added,
          deletedLines: deleted,
          applied: true,
        })
        // 追加编辑结果摘要
        setEditMessages(prev => [...prev, { role: 'assistant', content: result.summary || '编辑已应用。' }])
        setStatus(null)
      } else {
        setEditMessages(prev => [...prev, { role: 'assistant', content: '编辑建议生成成功，但自动应用失败。' }])
        setEditChangeSummary(null)
      }
    }
    setEditApplying(false)
    setBusy(false)
    finishRun(runId)
  }

  const handleApplyEdit = async (): Promise<void> => {
    if (!pendingEdit || !pendingEdit.ok || busy) return
    setBusy(true)
    const selectedSet = new Set(selectedHunks)
    const mergedContent = buildContentFromSelectedHunks(
      pendingEdit.originalContent || '',
      parsedHunks,
      selectedSet,
    )
    const ok = await onApplyEdit(pendingEdit, mergedContent)
    if (ok) {
      let added = 0
      let deleted = 0
      for (const hunk of parsedHunks) {
        if (!selectedSet.has(hunk.id)) continue
        for (const line of hunk.lines) {
          if (line.startsWith('+')) added++
          else if (line.startsWith('-')) deleted++
        }
      }
      setEditChangeSummary({
        filePath: pendingEdit.filePath,
        fileName: getFileName(pendingEdit.filePath),
        addedLines: added,
        deletedLines: deleted,
        applied: true,
      })
      setStatus(null)
    } else {
      setStatus('应用失败，请检查目标文件状态。')
    }
    setBusy(false)
  }

  const handleUndoEdit = async (): Promise<void> => {
    if (!pendingEdit || !pendingEdit.ok || busy) return
    setBusy(true)
    const ok = await onUndoEdit(pendingEdit)
    if (ok) {
      setEditChangeSummary(null)
      setPendingEdit(null)
      setStatus('已撤销本次 AI 编辑。')
    } else {
      setStatus('撤销失败，请检查文件状态。')
    }
    setBusy(false)
  }

  const toggleHunk = (id: number): void => {
    setSelectedHunks((prev) => (prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]))
  }

  const normalizeCustomModelId = (raw: string, fallback: string): string => {
    const candidate = (raw || fallback)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    return candidate || fallback
  }

  const openModelConfig = async (): Promise<void> => {
    setShowModelConfig(true)
    setConfigBusy(true)
    setConfigStatus(null)
    try {
      const settings = await window.api?.settings?.get()
      const resolved = resolveIDESettings(settings)
      setConfigModel(resolved.aiModel)
      setConfigDeepseekKey(resolved.aiDeepseekApiKey || '')
      setConfigGlmKey(resolved.aiGlmApiKey || '')
      setConfigCustomModels(resolved.aiCustomModels || [])
    } catch {
      setConfigStatus('读取模型配置失败，请稍后重试。')
    } finally {
      setConfigBusy(false)
    }
  }

  const addCustomModel = (): void => {
    setConfigCustomModels((prev) => {
      const index = prev.length + 1
      return [...prev, {
        id: `custom-${index}`,
        label: `自定义模型 ${index}`,
        endpoint: '',
        modelName: '',
        apiKey: '',
      }]
    })
  }

  const removeCustomModel = (id: string): void => {
    setConfigCustomModels((prev) => prev.filter(item => item.id !== id))
    setConfigModel((prev) => (prev === id ? 'deepseek' : prev))
  }

  const updateCustomModel = (id: string, patch: Partial<AICustomModelConfig>): void => {
    setConfigCustomModels((prev) => prev.map((item) => {
      if (item.id !== id) return item
      const next = { ...item, ...patch }
      if (patch.label !== undefined && !patch.id) {
        next.id = normalizeCustomModelId(next.label, item.id)
      }
      return next
    }))
  }

  const handleModelConfigSave = async (): Promise<void> => {
    if (configBusy) return
    setConfigBusy(true)
    setConfigStatus(null)
    try {
      const sanitizedCustomModels = configCustomModels
        .map((item, idx) => ({
          id: normalizeCustomModelId(item.id || item.label, `custom-${idx + 1}`),
          label: (item.label || '').trim(),
          endpoint: (item.endpoint || '').trim(),
          modelName: (item.modelName || '').trim(),
          apiKey: (item.apiKey || '').trim(),
        }))
        .filter(item => item.label && item.endpoint && item.modelName)

      const currentModelIsCustom = !!sanitizedCustomModels.find(item => item.id === configModel)
      const nextModel = configModel === 'deepseek'
        || configModel === 'deepseek-v4-flash'
        || configModel === 'deepseek-v3.2'
        || configModel === 'glm'
        || currentModelIsCustom
        ? configModel
        : 'deepseek'

      const saved = await window.api?.settings?.save({
        aiModel: nextModel,
        aiDeepseekApiKey: configDeepseekKey.trim(),
        aiGlmApiKey: configGlmKey.trim(),
        aiCustomModels: sanitizedCustomModels,
      })
      const resolved = resolveIDESettings(saved)
      onModelChange(resolved.aiModel, false)
      setConfigStatus('模型配置已保存。')
      setShowModelConfig(false)
    } catch {
      setConfigStatus('保存失败，请稍后重试。')
    } finally {
      setConfigBusy(false)
    }
  }

  return (
    <aside className={`ai-panel${placement === 'left' ? ' ai-panel-left' : ''}`} aria-label="AI 助手面板" style={{ width: panelWidth, fontFamily: aiFontFamily, fontSize: aiFontSize ? `${aiFontSize}px` : undefined }}>
      <div
        className={`ai-panel-resizer${placement === 'left' ? ' ai-panel-resizer-right' : ''}`}
        onMouseDown={handleResizeMouseDown}
        role="separator"
        aria-label="调整 AI 面板宽度"
        aria-orientation="vertical"
        tabIndex={0}
      />
      <header className="ai-panel-header">
        <div className="ai-panel-title">AI 助手</div>
      </header>

      {mode === 'chat' && (
        <div className="ai-panel-section">
          <div className="ai-chat-log" role="log" aria-label="聊天记录">
            {chatHistory.length === 0 && <div className="ai-empty">开始提问吧，聊天模式不会修改任何文件。</div>}
            {chatHistory.map((item, idx) => (
              <div key={`${item.role}-${idx}`} className={`ai-chat-item ai-chat-${item.role}`}>
                <pre className="ai-chat-content">{item.content}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'plan' && (
        <div className="ai-panel-section">
          <div className="ai-chat-log" role="log" aria-label="计划记录">
            {planHistory.length === 0 && <div className="ai-empty">描述你的目标，Plan 模式会生成结构化执行计划。</div>}
            {planHistory.map((item, idx) => (
              <div key={`plan-${item.role}-${idx}`} className={`ai-chat-item ai-chat-${item.role}`}>
                <pre className="ai-chat-content">{item.content}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'agent' && (
        <div className="ai-panel-section">
          <div className="ai-chat-log" role="log" aria-label="Agent 执行记录">
            {agentHistory.length === 0 && <div className="ai-empty">输入任务目标，Agent 模式会自动拆解步骤并尽量执行修改。</div>}
            {agentHistory.map((item, idx) => (
              <div key={`agent-${item.role}-${idx}`} className={`ai-chat-item ai-chat-${item.role}`}>
                {item.toolTrace ? (
                  <details className="ai-tool-trace" open={false}>
                    <summary className="ai-tool-trace-summary">
                      {item.content}
                    </summary>
                    <div className="ai-tool-trace-section">
                      <div className="ai-tool-trace-title">参数</div>
                      <pre className="ai-chat-content">{item.toolTrace.args}</pre>
                    </div>
                    <div className="ai-tool-trace-section">
                      <div className="ai-tool-trace-title">返回</div>
                      <pre className="ai-chat-content">{item.toolTrace.result}</pre>
                    </div>
                  </details>
                ) : (
                  <pre className="ai-chat-content">{item.content}</pre>
                )}
              </div>
            ))}
            {agentRunning && (
              <div className="ai-chat-item ai-chat-assistant">
                <pre className="ai-chat-content">Agent 执行中<span className="ai-dots-anim" /></pre>
              </div>
            )}
          </div>
        </div>
      )}

      {mode === 'edit' && (
        <div className="ai-panel-section">
          <div className="ai-chat-log" role="log" aria-label="编辑记录">
            {editMessages.length === 0 && !editBusy && !editApplying && <div className="ai-empty">描述你要对当前文件做的修改。</div>}
            {editMessages.map((item, idx) => (
              <div key={`edit-${item.role}-${idx}`} className={`ai-chat-item ai-chat-${item.role}`}>
                <pre className="ai-chat-content">{item.content}</pre>
              </div>
            ))}
            {editApplying && (
              <div className="ai-chat-item ai-chat-assistant">
                <pre className="ai-chat-content">正在编辑 {activeFileLabel ? getFileName(activeFileLabel) : '文件'} 中<span className="ai-dots-anim" /></pre>
              </div>
            )}
          </div>
        </div>
      )}

      {(mode === 'edit' || mode === 'agent') && editChangeSummary && (
        <div className="ai-change-bar" aria-label="文件变更摘要">
          <div className="ai-change-bar-file">
            <Icon name="module" size={14} />
            <span className="ai-change-bar-name" title={editChangeSummary.filePath}>{editChangeSummary.fileName}</span>
            {editChangeSummary.addedLines > 0 && (
              <span className="ai-change-bar-added">+{editChangeSummary.addedLines}</span>
            )}
            {editChangeSummary.deletedLines > 0 && (
              <span className="ai-change-bar-deleted">-{editChangeSummary.deletedLines}</span>
            )}
          </div>
          <div className="ai-change-bar-actions">
            <button
              type="button"
              className="ai-btn ai-btn-icon"
              title="保留更改"
              onClick={() => {
                onKeepEdit()
                setEditChangeSummary(null)
                setPendingEdit(null)
                setStatus('已保留本次 AI 编辑。')
              }}
              disabled={busy}
            >
              <Icon name="run" size={14} />
            </button>
            <button
              type="button"
              className="ai-btn ai-btn-icon"
              title="撤销更改"
              onClick={() => { void handleUndoEdit() }}
              disabled={busy}
            >
              <Icon name="undo" size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="ai-composer" aria-label="AI 输入框">
        {(mode === 'edit' || mode === 'agent') && (
          <div className="ai-composer-target-row">
            <div
              className="ai-composer-target-name"
              aria-label={mode === 'edit' ? '编辑目标文件' : 'Agent 目标文件'}
              title={activeFileLabel || undefined}
            >
              {activeFileLabel ? getFileName(activeFileLabel) : '未激活可编辑文件'}
            </div>
          </div>
        )}
        <textarea
          ref={composerRef}
          className="ai-textarea ai-textarea-composer"
          rows={1}
          value={composerValue}
          onChange={(e) => {
            if (mode === 'chat') setChatInput(e.target.value)
            else if (mode === 'edit') setEditInput(e.target.value)
            else if (mode === 'plan') setPlanInput(e.target.value)
            else setAgentInput(e.target.value)
            autoResizeComposer()
          }}
          onKeyDown={handleComposerKeyDown}
          placeholder={composerPlaceholder}
          aria-label={composerAriaLabel}
        />
        <div className="ai-composer-footer">
          <div className="ai-inline-select-wrap">
            <select
              className="ai-model-select ai-mode-select ai-inline-select"
              value={mode}
              onChange={(e) => setMode(e.target.value as PanelMode)}
              aria-label="AI 模式"
            >
              <option value="chat">Ask</option>
              <option value="edit">Edit</option>
              <option value="plan">Plan</option>
              <option value="agent">Agent</option>
            </select>
          </div>
          <div className="ai-inline-select-wrap ai-inline-select-wrap-fill">
            <select
              className="ai-model-select ai-model-inline-select ai-inline-select"
              value={model}
              onChange={(e) => {
                const value = e.target.value
                if (value === '__config__') {
                  void openModelConfig()
                  return
                }
                onModelChange(value as AISupportedModel, true)
              }}
              aria-label="AI 模型"
            >
              {modelOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
              <option value="__sep__" disabled>──────────</option>
              <option value="__config__">模型配置...</option>
            </select>
          </div>
          <button
            type="button"
            className="ai-btn ai-btn-icon ai-stop-btn"
            onClick={handleStopRunning}
            disabled={!busy}
            aria-label="停止"
            title="停止"
          >
            <Icon name="close" size={14} />
          </button>
          <button
            type="button"
            className="ai-btn ai-btn-icon ai-send-btn"
            onClick={() => {
              if (mode === 'chat') {
                void handleSendChat()
                return
              }
              if (mode === 'edit') {
                void handleGenerateEdit()
                return
              }
              if (mode === 'plan') {
                void handleGeneratePlan()
                return
              }
              void handleRunAgent()
            }}
            disabled={busy}
            aria-label={primaryActionLabel}
            title={primaryActionLabel}
          >
            <Icon name="go-to-previous" size={14} />
          </button>
        </div>
      </div>

      {status && <div className="ai-status" role="status">{status}</div>}

      {showModelConfig && (
        <div className="ai-modal-backdrop" role="presentation">
          <div className="ai-modal" role="dialog" aria-modal="true" aria-label="模型配置">
            <h4 className="ai-modal-title">模型配置</h4>
            <div className="ai-modal-row">
              <span className="ai-modal-label">默认模型</span>
              <select
                className="ai-model-select ai-file-select"
                value={configModel}
                onChange={(e) => setConfigModel(e.target.value as AISupportedModel)}
                disabled={configBusy}
              >
                {modelOptions.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
            <div className="ai-modal-row">
              <span className="ai-modal-label">DeepSeek API Key</span>
              <input
                type="password"
                className="ai-textarea ai-modal-input"
                value={configDeepseekKey}
                onChange={(e) => setConfigDeepseekKey(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                disabled={configBusy}
              />
            </div>
            <div className="ai-modal-row">
              <span className="ai-modal-label">GLM API Key</span>
              <input
                type="password"
                className="ai-textarea ai-modal-input"
                value={configGlmKey}
                onChange={(e) => setConfigGlmKey(e.target.value)}
                placeholder="glm-..."
                autoComplete="off"
                disabled={configBusy}
              />
            </div>
            <div className="ai-modal-row">
              <div className="ai-modal-custom-header">
                <span className="ai-modal-label">自定义模型</span>
                <button type="button" className="ai-btn" onClick={addCustomModel} disabled={configBusy}>新增</button>
              </div>
              <div className="ai-custom-model-list">
                {configCustomModels.length === 0 && (
                  <div className="ai-modal-status">暂无自定义模型。</div>
                )}
                {configCustomModels.map((item) => (
                  <div key={item.id} className="ai-custom-model-item">
                    <input
                      type="text"
                      className="ai-textarea ai-modal-input"
                      value={item.label}
                      onChange={(e) => updateCustomModel(item.id, { label: e.target.value })}
                      placeholder="显示名称"
                      disabled={configBusy}
                    />
                    <input
                      type="text"
                      className="ai-textarea ai-modal-input"
                      value={item.endpoint}
                      onChange={(e) => updateCustomModel(item.id, { endpoint: e.target.value })}
                      placeholder="接口地址（如 https://api.openai.com/v1/chat/completions）"
                      disabled={configBusy}
                    />
                    <input
                      type="text"
                      className="ai-textarea ai-modal-input"
                      value={item.modelName}
                      onChange={(e) => updateCustomModel(item.id, { modelName: e.target.value })}
                      placeholder="模型名称（如 gpt-4o-mini）"
                      disabled={configBusy}
                    />
                    <input
                      type="password"
                      className="ai-textarea ai-modal-input"
                      value={item.apiKey}
                      onChange={(e) => updateCustomModel(item.id, { apiKey: e.target.value })}
                      placeholder="API Key"
                      autoComplete="off"
                      disabled={configBusy}
                    />
                    <button type="button" className="ai-btn" onClick={() => removeCustomModel(item.id)} disabled={configBusy}>删除</button>
                  </div>
                ))}
              </div>
            </div>
            {configStatus && <div className="ai-modal-status">{configStatus}</div>}
            <div className="ai-modal-actions">
              <button type="button" className="ai-btn" onClick={() => setShowModelConfig(false)} disabled={configBusy}>取消</button>
              <button type="button" className="ai-btn ai-btn-primary" onClick={() => { void handleModelConfigSave() }} disabled={configBusy}>保存</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

export default AIAssistantPanel
