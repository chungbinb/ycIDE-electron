import { useCallback, useEffect, useRef, useState, memo } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import './OutputPanel.css'

export interface OutputMessage {
  type: 'info' | 'success' | 'error' | 'warning'
  text: string
  /** 带位置的编译报错：file=相对项目文件名，line=文本行号，raw=text 中代表位置/行号的子串。
   *  输出面板据此把 raw 中的行号就地改写为「表格行(文本行)」（已打开的文件）并可点击跳转。 */
  location?: { file: string; line: number; raw: string }
}

/** 命令详细信息（用于提示面板展示） */
export interface CommandDetail {
  name: string
  englishName: string
  description: string
  returnType: string
  category: string
  libraryName: string
  assemblyName?: string
  isEventSubroutine?: boolean
  eventDescription?: string
  customTitle?: string
  customLines?: string[]
  params: Array<{
    name: string
    type: string
    description: string
    optional: boolean
    repeatable?: boolean
    isVariable: boolean
    isArray: boolean
  }>
}

/** 文件问题项 */
export interface FileProblem {
  /** 文本模式（源码）行号，1 基 */
  line: number
  column: number
  message: string
  severity: 'error' | 'warning'
  /** 来源文件名（如 _启动窗口.efw），设计时诊断时使用 */
  file?: string
  /** 表格模式行号（编辑器行号槽显示的编号），有值时面板双行号显示 */
  displayLine?: number
}

export interface DebugVariable {
  name: string
  type: string
  value: string
}

export interface DebugPauseState {
  file: string
  line: number
  variables: DebugVariable[]
}

type OutputTab = 'compile' | 'hint' | 'problems' | 'terminal' | 'debug'
type OutputTabsPlacement = 'top' | 'bottom'

const OUTPUT_TABS_PLACEMENT_KEY = 'ycide.output.tabs.placement'

interface OutputPanelProps {
  height: number
  onResize: (height: number) => void
  onClose: () => void
  messages?: OutputMessage[]
  commandDetail?: CommandDetail | null
  highlightParamIndex?: number
  problems?: FileProblem[]
  debugPause?: DebugPauseState | null
  debugDisplayLine?: number | null
  isDebugPaused?: boolean
  onDebugContinue?: () => void
  forceTab?: OutputTab | null
  onProblemClick?: (problem: FileProblem) => void
  /** 点击编译输出里带位置的报错时触发：打开并定位跳转到该文件该行 */
  onLocationClick?: (file: string, line: number) => void
  /** 已解析的「文本行→表格行」缓存：basename → { 文本行号: 表格行号 }。有值即就地改写行号显示。 */
  errorTableLines?: Record<string, Record<number, number>>
  terminalRunning?: boolean
  terminalLastCommand?: string
  /** 程序化整行执行（当前 UI 已改为 xterm 直连；保留供"在终端运行"等入口调用） */
  onTerminalSend?: (command: string) => Promise<{ ok: boolean; error?: string }>
  onTerminalInterrupt?: () => Promise<{ ok: boolean; error?: string }>
  onTerminalActivate?: () => Promise<void> | void
}

function baseNameOf(filePath: string): string {
  const parts = (filePath || '').split(/[\\/]/)
  return parts[parts.length - 1] || filePath
}

// 把 raw 里最后一处 line 数字替换成 replacement，兼容「选题窗口.eyc:103」与「第 103 行」两种写法。
// 取“最后一处”是因为行号总在末尾，避免误伤文件名里的数字（如「窗口103.eyc:103」）。
function replaceLastNumber(raw: string, line: number, replacement: string): string {
  const s = String(line)
  const idx = raw.lastIndexOf(s)
  return idx < 0 ? raw : raw.slice(0, idx) + replacement + raw.slice(idx + s.length)
}

function setCssVars(element: HTMLElement | null, vars: Record<string, string>): void {
  if (!element) return
  for (const [name, value] of Object.entries(vars)) {
    element.style.setProperty(name, value)
  }
}

function readCssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || fallback
  } catch {
    return fallback
  }
}

// xterm 主题：背景/前景取自 IDE 主题变量，ANSI 16 色用 VS Code Dark+ 近似值（暗底可读）。
function getXtermTheme(): ITheme {
  return {
    background: readCssVar('--terminal-bg', readCssVar('--bg-primary', '#1e1e1e')),
    foreground: readCssVar('--terminal-fg', readCssVar('--text-primary', '#d4d4d4')),
    cursor: readCssVar('--text-primary', '#d4d4d4'),
    cursorAccent: readCssVar('--bg-primary', '#1e1e1e'),
    selectionBackground: 'rgba(120,150,200,0.35)',
    black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
    blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
    brightBlack: '#767676', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543',
    brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#f5f5f5',
  }
}

function OutputPanel({ height, onResize, onClose, messages = [], commandDetail, highlightParamIndex, problems = [], debugPause = null, debugDisplayLine = null, isDebugPaused = false, onDebugContinue, forceTab, onProblemClick, onLocationClick, errorTableLines, terminalRunning = false, terminalLastCommand = '', onTerminalInterrupt, onTerminalActivate }: OutputPanelProps): React.JSX.Element {
  const OUTPUT_MIN_HEIGHT = 100
  const OUTPUT_MAX_HEIGHT = 500
  const OUTPUT_RESIZE_STEP = 16
  const contentRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const problemRowRefs = useRef<Array<HTMLDivElement | null>>([])
  const [activeTab, setActiveTab] = useState<OutputTab>('compile')
  const [flashProblemIndex, setFlashProblemIndex] = useState<number>(-1)
  const [debugFilter, setDebugFilter] = useState('')
  const [focusedProblemIndex, setFocusedProblemIndex] = useState(0)
  const [tabsPlacement, setTabsPlacement] = useState<OutputTabsPlacement>(() => {
    try {
      const raw = localStorage.getItem(OUTPUT_TABS_PLACEMENT_KEY)
      return raw === 'bottom' ? 'bottom' : 'top'
    } catch {
      return 'top'
    }
  })
  const [tabsContextMenu, setTabsContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [terminalStatus, setTerminalStatus] = useState<string | null>(null)
  const [termMenu, setTermMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)
  // xterm.js：真终端模拟器。PTY 吐出的光标/重绘/颜色控制序列由它解释（<pre> 做不到）。
  const xtermContainerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  // 外部强制切换标签（编译/运行时自动切到编译输出）
  useEffect(() => {
    if (forceTab) setActiveTab(forceTab)
  }, [forceTab])

  // 仅在“运行/编译触发并切到问题面板”时闪烁提示第一项，随后自动取消
  useEffect(() => {
    if (forceTab === 'problems' && problems.length > 0) {
      setFlashProblemIndex(0)
      const timer = window.setTimeout(() => setFlashProblemIndex(-1), 1200)
      return () => window.clearTimeout(timer)
    }
    return
  }, [forceTab, problems.length])

  // 当收到新的命令详情时自动切到提示标签
  useEffect(() => {
    if (commandDetail) setActiveTab('hint')
  }, [commandDetail])

  useEffect(() => {
    if (activeTab !== 'problems') return
    if (problems.length === 0) {
      setFocusedProblemIndex(0)
      return
    }
    setFocusedProblemIndex(prev => Math.min(prev, problems.length - 1))
  }, [activeTab, problems.length])

  useEffect(() => {
    setDebugFilter('')
  }, [debugPause?.file, debugPause?.line])

  // 自动滚动到底部（仅编译输出）
  useEffect(() => {
    if (activeTab === 'compile' && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [messages, activeTab])

  useEffect(() => {
    if (activeTab !== 'terminal') return
    const frame = window.requestAnimationFrame(() => {
      // 焦点仍在标签栏内说明用户在用方向键导航标签，此时抢占焦点会让键盘无法越过“终端”标签
      const focused = document.activeElement
      if (focused instanceof HTMLElement && focused.closest('.output-tabs')) return
      xtermRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'terminal') return
    void onTerminalActivate?.()
  }, [activeTab, onTerminalActivate])

  // xterm 生命周期：终端标签激活且容器就位时创建；离开标签销毁（重进时按主进程缓冲回放）。
  useEffect(() => {
    if (activeTab !== 'terminal') return
    const container = xtermContainerRef.current
    if (!container || xtermRef.current) return

    const term = new Terminal({
      fontFamily: 'Consolas, "Cascadia Mono", "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: getXtermTheme(),
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(container)
    try { fit.fit() } catch { /* 容器尺寸未就绪，ResizeObserver 会稍后再拟合 */ }
    xtermRef.current = term
    fitAddonRef.current = fit
    term.focus()

    // 先订阅实时输出并暂存（带 seq），回放快照后只写 seq 大于快照末尾的块——
    // 主进程 push 时递增 seq，故"快照与实时订阅重叠"的块会被精确丢弃，既不丢也不重。
    let baseSeq = -1
    const pending: Array<{ text: string; seq: number }> = []
    const onOutput = (text: unknown, seq: unknown): void => {
      if (typeof text !== 'string') return
      const s = typeof seq === 'number' ? seq : 0
      if (baseSeq < 0) pending.push({ text, seq: s })
      else if (s > baseSeq) term.write(text)
    }
    const disposeOutput = window.api?.on?.('terminal:output', onOutput)

    let disposed = false
    void (async () => {
      let snap: { output?: string[]; seq?: number } | undefined
      try { snap = await window.api?.terminal?.start() } catch { /* ignore */ }
      if (disposed) return
      if (snap?.output?.length) term.write(snap.output.join(''))
      baseSeq = typeof snap?.seq === 'number' ? snap.seq : 0
      for (const p of pending) if (p.seq > baseSeq) term.write(p.text)
      pending.length = 0
      // 回放后把真实行列同步给 PTY，全屏程序才能按窗口尺寸排版
      try { window.api?.terminal?.resize(term.cols, term.rows) } catch { /* ignore */ }
    })()

    // 用户按键 → PTY 原始输入
    const dataSub = term.onData((data) => { window.api?.terminal?.input(data) })

    // Ctrl+C：有选区=复制、无选区=透传中断给前台程序；Ctrl+V=粘贴
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const mod = (e.ctrlKey || e.metaKey) && !e.altKey
      if (mod && (e.key === 'c' || e.key === 'C')) {
        const sel = term.getSelection()
        if (sel) { void navigator.clipboard?.writeText(sel).catch(() => {}); return false }
        return true
      }
      if (mod && (e.key === 'v' || e.key === 'V')) {
        void navigator.clipboard?.readText().then(t => { if (t) window.api?.terminal?.input(t) }).catch(() => {})
        return false
      }
      return true
    })

    // 容器尺寸变化（面板拉伸/窗口缩放）→ 重新拟合并同步 PTY
    const ro = new ResizeObserver(() => {
      try { fit.fit(); window.api?.terminal?.resize(term.cols, term.rows) } catch { /* ignore */ }
    })
    ro.observe(container)

    return () => {
      disposed = true
      ro.disconnect()
      dataSub.dispose()
      if (typeof disposeOutput === 'function') disposeOutput()
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [activeTab])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = height

    const handleMouseMove = (e: MouseEvent) => {
      const newHeight = Math.max(OUTPUT_MIN_HEIGHT, Math.min(OUTPUT_MAX_HEIGHT, startHeight - (e.clientY - startY)))
      onResize(newHeight)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [height, onResize, OUTPUT_MAX_HEIGHT, OUTPUT_MIN_HEIGHT])

  const handleResizerKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      onResize(Math.min(OUTPUT_MAX_HEIGHT, height + OUTPUT_RESIZE_STEP))
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      onResize(Math.max(OUTPUT_MIN_HEIGHT, height - OUTPUT_RESIZE_STEP))
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      onResize(OUTPUT_MIN_HEIGHT)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      onResize(OUTPUT_MAX_HEIGHT)
    }
  }, [height, onResize, OUTPUT_MAX_HEIGHT, OUTPUT_MIN_HEIGHT, OUTPUT_RESIZE_STEP])

  const filteredDebugVariables = (() => {
    if (!debugPause) return []
    const keyword = debugFilter.trim().toLowerCase()
    if (!keyword) return debugPause.variables
    return debugPause.variables.filter(variable => variable.name.toLowerCase().includes(keyword))
  })()

  // 渲染一条编译输出：无 location 就是纯文本；带 location 时把 raw 子串渲染成可点击链接，
  // 若该文件已解析出表格行号，则把行号就地改写为「表格行(文本行)」（未解析则保持文本行号）。
  const renderCompileLine = (msg: OutputMessage): React.ReactNode => {
    const loc = msg.location
    if (!loc) return msg.text
    const idx = msg.text.indexOf(loc.raw)
    if (idx < 0) return msg.text
    const table = errorTableLines?.[baseNameOf(loc.file)]?.[loc.line]
    const label = (table && table > 0)
      ? replaceLastNumber(loc.raw, loc.line, `${table}(${loc.line})`)
      : loc.raw
    return (
      <>
        {msg.text.slice(0, idx)}
        <button
          type="button"
          className="output-line-loc-link"
          title="点击跳转到该行"
          onClick={() => onLocationClick?.(loc.file, loc.line)}
        >{label}</button>
        {msg.text.slice(idx + loc.raw.length)}
      </>
    )
  }

  const buildProblemAriaLabel = (problem: FileProblem): string => {
    const severityText = problem.severity === 'error' ? '错误' : '警告'
    const fileText = problem.file ? `，文件 ${problem.file}` : ''
    const locationText = (problem.line > 0 || problem.column > 0)
      ? (problem.displayLine != null && problem.displayLine > 0
          ? `，第 ${problem.displayLine} 行，第 ${problem.column} 列，文本模式第 ${problem.line} 行`
          : `，第 ${problem.line} 行，第 ${problem.column} 列`)
      : '，设计时问题'
    return `${severityText}${fileText}${locationText}，${problem.message}`
  }

  const handleProblemRowKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, index: number, problem: FileProblem): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onProblemClick?.(problem)
      return
    }

    if (!problems.length) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = Math.min(index + 1, problems.length - 1)
      setFocusedProblemIndex(next)
      problemRowRefs.current[next]?.focus()
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      const prev = Math.max(index - 1, 0)
      setFocusedProblemIndex(prev)
      problemRowRefs.current[prev]?.focus()
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setFocusedProblemIndex(0)
      problemRowRefs.current[0]?.focus()
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      const last = problems.length - 1
      setFocusedProblemIndex(last)
      problemRowRefs.current[last]?.focus()
    }
  }

  const tabs: Array<{ id: OutputTab; label: string }> = [
    { id: 'compile', label: '输出' },
    { id: 'terminal', label: '终端' },
    { id: 'hint', label: '提示' },
    { id: 'problems', label: `问题${problems.length > 0 ? ` (${problems.length})` : ''}` },
    { id: 'debug', label: `调试${isDebugPaused ? ' (暂停)' : ''}` },
  ]

  useEffect(() => {
    try {
      localStorage.setItem(OUTPUT_TABS_PLACEMENT_KEY, tabsPlacement)
    } catch {
      // ignore
    }
  }, [tabsPlacement])

  useEffect(() => {
    if (!tabsContextMenu) return
    const close = (): void => setTabsContextMenu(null)
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [tabsContextMenu])

  const handleTabsContextMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 240
    const menuX = Math.min(event.clientX, window.innerWidth - menuWidth - 8)
    setTabsContextMenu({ x: Math.max(0, menuX), y: event.clientY })
  }, [])

  const toggleTabsPlacementFromMenu = useCallback(() => {
    setTabsPlacement(prev => (prev === 'top' ? 'bottom' : 'top'))
    setTabsContextMenu(null)
  }, [])

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, tabId: OutputTab): void => {
    const currentIndex = tabs.findIndex(tab => tab.id === tabId)
    if (currentIndex < 0) return

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      const nextIndex = (currentIndex + 1) % tabs.length
      const nextTab = tabs[nextIndex]
      setActiveTab(nextTab.id)
      tabRefs.current[nextIndex]?.focus()
      return
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length
      const prevTab = tabs[prevIndex]
      setActiveTab(prevTab.id)
      tabRefs.current[prevIndex]?.focus()
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setActiveTab(tabs[0].id)
      tabRefs.current[0]?.focus()
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      const lastIndex = tabs.length - 1
      setActiveTab(tabs[lastIndex].id)
      tabRefs.current[lastIndex]?.focus()
    }
  }

  const handleTerminalInterrupt = useCallback(async () => {
    if (!onTerminalInterrupt) return
    const result = await onTerminalInterrupt()
    setTerminalStatus(result.ok ? null : (result.error || '发送中断失败。'))
    xtermRef.current?.focus()
  }, [onTerminalInterrupt])

  const selectElementText = useCallback((element: HTMLElement | null): void => {
    if (!element) return
    const selection = window.getSelection()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(element)
    selection.removeAllRanges()
    selection.addRange(range)
  }, [])

  const handlePanelSelectAllKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>): void => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
    if (event.key.toLowerCase() !== 'a') return
    event.preventDefault()
    event.stopPropagation()
    selectElementText(event.currentTarget)
  }, [selectElementText])

  const handleTerminalContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    setTermMenu({ x: event.clientX, y: event.clientY, hasSelection: !!xtermRef.current?.hasSelection() })
  }, [])

  const handleTermCopy = useCallback(() => {
    const text = xtermRef.current?.getSelection() || ''
    if (text) void navigator.clipboard?.writeText(text).catch(() => {})
    setTermMenu(null)
  }, [])

  const handleTermPaste = useCallback(async () => {
    setTermMenu(null)
    try {
      const text = await navigator.clipboard.readText()
      if (text) window.api?.terminal?.input(text)  // 直接透传给 PTY（保留 \r\n，shell 自行处理）
    } catch { /* 剪贴板不可读（权限/空）忽略 */ }
    xtermRef.current?.focus()
  }, [])

  const handleTermSelectAll = useCallback(() => {
    xtermRef.current?.selectAll()
    setTermMenu(null)
  }, [])

  const handleTermClear = useCallback(() => {
    xtermRef.current?.clear()
    setTermMenu(null)
    xtermRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!termMenu) return
    const close = (): void => setTermMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [termMenu])

  const toolbarNode = (
    <div className={`output-toolbar ${tabsPlacement === 'bottom' ? 'output-toolbar-bottom' : 'output-toolbar-top'}`} onContextMenu={handleTabsContextMenu}>
      <div className="output-tabs" role="tablist" aria-label="输出面板标签">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => { tabRefs.current[index] = element }}
            id={`output-tab-${tab.id}`}
            className={`output-tab ${activeTab === tab.id ? 'active' : ''}`}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={activeTab === tab.id ? `output-panel-${tab.id}` : undefined}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
            onContextMenu={handleTabsContextMenu}
          >{tab.label}</button>
        ))}
      </div>
      <div className="output-header">
      <button className="output-close" onClick={onClose} aria-label="关闭输出面板">×</button>
      </div>
    </div>
  )

  return (
    <div
      className="output-panel"
      ref={(element) => setCssVars(element, { '--output-panel-height': `${height}px` })}
      role="region"
      aria-label="输出面板"
    >
      <div
        className="output-resizer"
        onMouseDown={handleMouseDown}
        onKeyDown={handleResizerKeyDown}
        role="separator"
        aria-label="调整输出面板高度"
        aria-orientation="horizontal"
        aria-valuenow={Math.round(height)}
        aria-valuemin={OUTPUT_MIN_HEIGHT}
        aria-valuemax={OUTPUT_MAX_HEIGHT}
        tabIndex={0}
      />
      {tabsPlacement === 'top' && toolbarNode}

      {/* 编译输出内容 */}
      {activeTab === 'compile' && (
        <div id="output-panel-compile" className="output-content" ref={contentRef} role="tabpanel" aria-labelledby="output-tab-compile" tabIndex={0} onKeyDown={handlePanelSelectAllKeyDown}>
          <div role="log" aria-live="polite" aria-atomic="false">
          {messages.map((msg, i) => (
            <div key={i} className={`output-line ${msg.type}`}>{renderCompileLine(msg)}</div>
          ))}
          </div>
        </div>
      )}

      {/* 终端内容：xterm.js 真终端（后端 node-pty/ConPTY，支持交互式程序） */}
      {activeTab === 'terminal' && (
        <div id="output-panel-terminal" className="output-content output-terminal-content" role="tabpanel" aria-labelledby="output-tab-terminal">
          <div className="output-terminal-meta" role="status" aria-live="polite">
            {terminalRunning && <span>状态：运行中</span>}
            {terminalLastCommand && <span>最近命令：{terminalLastCommand}</span>}
            <button
              type="button"
              className="output-terminal-interrupt"
              onClick={() => void handleTerminalInterrupt()}
              title="发送 Ctrl+C 中断当前命令"
            >中断</button>
          </div>
          <div
            className="output-terminal-xterm"
            ref={xtermContainerRef}
            onContextMenu={handleTerminalContextMenu}
          />
          {terminalStatus && <div className="output-terminal-status" role="alert">{terminalStatus}</div>}
        </div>
      )}

      {/* 提示内容（命令详情） */}
      {activeTab === 'hint' && (
        <div id="output-panel-hint" className="output-content output-hint-content" role="tabpanel" aria-labelledby="output-tab-hint" tabIndex={0} onKeyDown={handlePanelSelectAllKeyDown}>
          {commandDetail ? (() => {
            const cd = commandDetail
            if (Array.isArray(cd.customLines) && cd.customLines.length > 0) {
              return (
                <div className="cmd-detail">
                  <div className="cmd-detail-call">{cd.customTitle || cd.name}</div>
                  {cd.customLines.map((line, index) => (
                    <div key={`custom-hint-${index}`} className="cmd-detail-desc">{line}</div>
                  ))}
                </div>
              )
            }
            const isSourceSubroutine = cd.category === '子程序' && cd.libraryName === '当前源码'
            if (isSourceSubroutine) {
              if (cd.isEventSubroutine && cd.eventDescription) {
                return (
                  <div className="cmd-detail">
                    <div className="cmd-detail-desc">★★ 本子程序为事件处理子程序，请不要修改此子程序的名称、返回值及参数定义，否则将导致对应事件不能传递到此事件处理子程序。</div>
                    <div className="cmd-detail-desc">{cd.eventDescription}</div>
                  </div>
                )
              }
              return (
                <div className="cmd-detail">
                  <div className="cmd-detail-desc">子程序名：{cd.name};  所处程序集: {cd.assemblyName || '（未识别）'}</div>
                </div>
              )
            }
            // 中文类型名对应的英文名映射
            const typeEnglishMap: Record<string, string> = {
              '整数型': 'int', '短整数型': 'short', '长整数型': 'long',
              '小数型': 'float', '双精度小数型': 'double',
              '逻辑型': 'bool', '文本型': 'text', '字节型': 'byte',
              '日期时间型': 'datetime', '字节集': 'bin',
              '子程序指针': 'subptr', '通用型': 'all',
            }
            // 点击参数行时：只显示该参数的详细信息
            if (highlightParamIndex !== undefined && highlightParamIndex >= 0 && highlightParamIndex < cd.params.length) {
              const p = cd.params[highlightParamIndex]
              const eng = typeEnglishMap[p.type]
              const typeLabel = eng ? `${p.type}（${eng}）` : p.type
              const arrayInfo = p.isArray ? ' - 数组/非数组' : ''
              return (
                <div className="cmd-detail">
                  <div className="cmd-detail-param-detail">
                    参数名称为"{p.name}"，数据类型为"{typeLabel}{arrayInfo}"，所处语句为"{cd.name}"。
                  </div>
                  {p.description && (
                    <div className="cmd-detail-param-detail-desc">注明：{p.description}</div>
                  )}
                </div>
              )
            }
            // 点击命令行时：显示完整命令信息
            const paramSig = cd.params.length > 0
              ? cd.params.map(p => {
                  let s = ''
                  if (p.optional) s += '［'
                  s += p.type
                  if (p.isArray) s += '数组'
                  s += ' ' + p.name
                  if (p.repeatable) s += '...'
                  if (p.optional) s += '］'
                  return s
                }).join('，')
              : ''
            const retLabel = cd.returnType ? `〈${cd.returnType}〉` : '〈无返回值〉'
            const source = [cd.libraryName, cd.category].filter(Boolean).join('->')
            return (
              <div className="cmd-detail">
                <div className="cmd-detail-call">
                  <span className="cmd-detail-label">调用格式：</span>
                  {retLabel} {cd.name} （{paramSig}）{source && <> - {source}</>}
                </div>
                {cd.englishName && (
                  <div className="cmd-detail-eng">
                    <span className="cmd-detail-label">英文名称：</span>{cd.englishName}
                  </div>
                )}
                {cd.description && (
                  <div className={`cmd-detail-desc${cd.description.includes('未在已加载的支持库中找到此命令') ? ' cmd-detail-desc-error' : ''}`}>{cd.description}</div>
                )}
                {cd.params.length > 0 && (
                  <div className="cmd-detail-params">
                    {cd.params.map((p, i) => (
                      <div key={i} className={`cmd-detail-param${highlightParamIndex === i ? ' cmd-detail-param-highlight' : ''}`}>
                        <span className="cmd-detail-param-head">
                          参数&lt;{i + 1}&gt;的名称为"{p.name}"，类型为"{p.type}{p.isArray ? '(数组)' : ''}{p.isVariable ? '(参考)' : ''}"{p.optional ? '，可以被省略' : ''}{p.repeatable ? '，可重复追加' : ''}。
                        </span>
                        {p.description && <span className="cmd-detail-param-desc">{p.description}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })() : (
            <div className="cmd-detail-empty">点击代码中的命令查看详细信息</div>
          )}
        </div>
      )}

      {/* 问题列表 */}
      {activeTab === 'problems' && (
        <div id="output-panel-problems" className="output-content output-problems-content" role="tabpanel" aria-labelledby="output-tab-problems" tabIndex={0} onKeyDown={handlePanelSelectAllKeyDown}>
          {problems.length === 0 ? (
            <div className="output-problem-empty">当前文件没有问题</div>
          ) : (
            <>
              <div className="output-problem-summary" role="status" aria-live="polite">共 {problems.length} 个问题</div>
              {problems.map((p, i) => (
                <div
                  key={i}
                  ref={(element) => { problemRowRefs.current[i] = element }}
                  className={`output-problem-row ${i === flashProblemIndex ? 'flash' : ''}`}
                  role="button"
                  tabIndex={i === focusedProblemIndex ? 0 : -1}
                  aria-label={buildProblemAriaLabel(p)}
                  onFocus={() => setFocusedProblemIndex(i)}
                  onClick={() => {
                    onProblemClick?.(p)
                  }}
                  onKeyDown={(event) => handleProblemRowKeyDown(event, i, p)}
                >
                  <span className={`output-problem-icon ${p.severity}`}>{p.severity === 'error' ? '✕' : '⚠'}</span>
                  {p.file && <span className="output-problem-file">{p.file}</span>}
                  <span className="output-problem-msg">{p.message}</span>
                  {(p.line > 0 || p.column > 0)
                    ? (p.displayLine != null && p.displayLine > 0
                        ? <span className="output-problem-loc">第 {p.displayLine} 行, 第 {p.column} 列<span className="output-problem-loc-source">（文本 第 {p.line} 行）</span></span>
                        : <span className="output-problem-loc">第 {p.line} 行, 第 {p.column} 列</span>)
                    : <span className="output-problem-loc output-problem-design">设计时</span>}
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {activeTab === 'debug' && (
        <div id="output-panel-debug" className="output-content output-hint-content" role="tabpanel" aria-labelledby="output-tab-debug" tabIndex={0} onKeyDown={handlePanelSelectAllKeyDown}>
          {debugPause ? (
            <div className="cmd-detail">
              <div className="cmd-detail-call">
                <span className="cmd-detail-label">断点位置：</span>{debugPause.file}:{debugPause.line}
              </div>
              <div className="cmd-detail-desc">{isDebugPaused ? '已暂停，可查看当前可见变量值。' : '程序正在继续运行，下面显示上一次断点快照。'}</div>
              <div className="output-debug-table-wrap">
                {debugPause.variables.length === 0 ? (
                  <div className="cmd-detail-param">当前断点未采集到变量。</div>
                ) : (
                  <>
                    <div className="output-debug-toolbar">
                      <input
                        className="output-debug-filter"
                        type="text"
                        value={debugFilter}
                        onChange={(e) => setDebugFilter(e.target.value)}
                        placeholder="按变量名筛选"
                      />
                      <span className="output-debug-count">{filteredDebugVariables.length}/{debugPause.variables.length}</span>
                    </div>
                    {filteredDebugVariables.length === 0 ? (
                      <div className="cmd-detail-param">没有匹配的变量名。</div>
                    ) : (
                      <table className="output-debug-table">
                        <thead>
                          <tr>
                            <th>名称</th>
                            <th>类型</th>
                            <th>值</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredDebugVariables.map((variable, index) => (
                            <tr key={`${variable.name}:${index}`}>
                              <td className="output-debug-name">{variable.name}</td>
                              <td className="output-debug-type">{variable.type}</td>
                              <td className="output-debug-value">{variable.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                )}
              </div>
              {isDebugPaused && (
                <div className="output-debug-actions">
                  <button className="output-tab active" onClick={onDebugContinue}>继续运行</button>
                </div>
              )}
            </div>
          ) : (
            <div className="cmd-detail-empty">当前未在断点处暂停。</div>
          )}
        </div>
      )}

      {tabsPlacement === 'bottom' && toolbarNode}
      {tabsContextMenu && (
        <div
          className="output-tabs-context-menu"
          ref={(element) => setCssVars(element, {
            '--output-tabs-menu-x': `${tabsContextMenu.x}px`,
            '--output-tabs-menu-y': `${tabsContextMenu.y}px`,
          })}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            className="output-tabs-context-menu-item"
            onClick={toggleTabsPlacementFromMenu}
          >
            {tabsPlacement === 'top' ? '将“输出/终端/提示/问题/调试”按钮移到底部' : '将“输出/终端/提示/问题/调试”按钮移到顶部'}
          </button>
        </div>
      )}
      {termMenu && (
        <div
          className="output-terminal-context-menu"
          ref={(element) => setCssVars(element, {
            '--output-terminal-menu-x': `${termMenu.x}px`,
            '--output-terminal-menu-y': `${termMenu.y}px`,
          })}
          role="menu"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button type="button" role="menuitem" className="output-terminal-context-menu-item" onClick={handleTermCopy} disabled={!termMenu.hasSelection}>复制</button>
          <button type="button" role="menuitem" className="output-terminal-context-menu-item" onClick={() => void handleTermPaste()}>粘贴</button>
          <button type="button" role="menuitem" className="output-terminal-context-menu-item" onClick={handleTermSelectAll}>全选</button>
          <button type="button" role="menuitem" className="output-terminal-context-menu-item" onClick={handleTermClear}>清屏</button>
        </div>
      )}
    </div>
  )
}

// memo: App 重渲染时若 props 未变则跳过本组件渲染
export default memo(OutputPanel)
