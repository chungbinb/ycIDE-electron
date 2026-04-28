import { useCallback, useEffect, useRef, useState } from 'react'
import './OutputPanel.css'

export interface OutputMessage {
  type: 'info' | 'success' | 'error' | 'warning'
  text: string
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
  params: Array<{
    name: string
    type: string
    description: string
    optional: boolean
    isVariable: boolean
    isArray: boolean
  }>
}

/** 文件问题项 */
export interface FileProblem {
  line: number
  column: number
  message: string
  severity: 'error' | 'warning'
  /** 来源文件名（如 _启动窗口.efw），设计时诊断时使用 */
  file?: string
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
  terminalOutput?: string[]
  terminalRunning?: boolean
  terminalLastCommand?: string
  onTerminalSend?: (command: string) => Promise<{ ok: boolean; error?: string }>
  onTerminalInterrupt?: () => Promise<{ ok: boolean; error?: string }>
  onTerminalActivate?: () => Promise<void> | void
}

function OutputPanel({ height, onResize, onClose, messages = [], commandDetail, highlightParamIndex, problems = [], debugPause = null, debugDisplayLine = null, isDebugPaused = false, onDebugContinue, forceTab, onProblemClick, terminalOutput = [], terminalRunning = false, terminalLastCommand = '', onTerminalSend, onTerminalInterrupt, onTerminalActivate }: OutputPanelProps): React.JSX.Element {
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
  const [terminalInput, setTerminalInput] = useState('')
  const [terminalBusy, setTerminalBusy] = useState(false)
  const [terminalStatus, setTerminalStatus] = useState<string | null>(null)
  const [terminalFocused, setTerminalFocused] = useState(false)
  const terminalRef = useRef<HTMLDivElement>(null)

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
    if (activeTab === 'terminal' && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [terminalOutput, activeTab, terminalInput])

  useEffect(() => {
    if (activeTab !== 'terminal') return
    const frame = window.requestAnimationFrame(() => {
      terminalRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'terminal') return
    void onTerminalActivate?.()
  }, [activeTab, onTerminalActivate])

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

  const buildProblemAriaLabel = (problem: FileProblem): string => {
    const severityText = problem.severity === 'error' ? '错误' : '警告'
    const fileText = problem.file ? `，文件 ${problem.file}` : ''
    const locationText = (problem.line > 0 || problem.column > 0)
      ? `，第 ${problem.line} 行，第 ${problem.column} 列`
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

  const handleTerminalRun = useCallback(async () => {
    const command = terminalInput
    if (!command.trim() || terminalBusy || !onTerminalSend) return
    setTerminalBusy(true)
    setTerminalStatus(null)
    const result = await onTerminalSend(command)
    if (!result.ok) {
      setTerminalStatus(result.error || '命令执行失败。')
    } else {
      setTerminalInput('')
    }
    setTerminalBusy(false)
  }, [onTerminalSend, terminalBusy, terminalInput])

  const handleTerminalInterrupt = useCallback(async () => {
    if (terminalBusy || !onTerminalInterrupt) return
    setTerminalBusy(true)
    setTerminalStatus(null)
    const result = await onTerminalInterrupt()
    if (!result.ok) {
      setTerminalStatus(result.error || '发送中断失败。')
    }
    setTerminalInput('')
    setTerminalBusy(false)
  }, [onTerminalInterrupt, terminalBusy])

  const handleTerminalKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey && !event.altKey && !event.metaKey && (event.key === 'c' || event.key === 'C')) {
      event.preventDefault()
      void handleTerminalInterrupt()
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      void handleTerminalRun()
      return
    }

    if (event.key === 'Backspace') {
      event.preventDefault()
      setTerminalInput(prev => prev.slice(0, -1))
      return
    }

    if (event.key === 'Tab') {
      event.preventDefault()
      setTerminalInput(prev => prev + '\t')
      return
    }

    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault()
      setTerminalInput(prev => prev + event.key)
    }
  }, [handleTerminalInterrupt, handleTerminalRun])

  const handleTerminalPaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData('text')
    if (!text) return
    event.preventDefault()
    setTerminalInput(prev => prev + text.replace(/\r\n/g, '\n'))
  }, [])

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
            aria-controls={`output-panel-${tab.id}`}
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
    <div className="output-panel" style={{ height: `${height}px` }} role="region" aria-label="输出面板">
      <div
        className="output-resizer"
        onMouseDown={handleMouseDown}
        onKeyDown={handleResizerKeyDown}
        role="separator"
        aria-label="调整输出面板高度"
        aria-orientation="horizontal"
        aria-valuemin={OUTPUT_MIN_HEIGHT}
        aria-valuemax={OUTPUT_MAX_HEIGHT}
        aria-valuenow={height}
        tabIndex={0}
      />
      {tabsPlacement === 'top' && toolbarNode}

      {/* 编译输出内容 */}
      {activeTab === 'compile' && (
        <div id="output-panel-compile" className="output-content" ref={contentRef} role="tabpanel" aria-labelledby="output-tab-compile" tabIndex={0}>
          <div role="log" aria-live="polite" aria-atomic="false">
          {messages.map((msg, i) => (
            <div key={i} className={`output-line ${msg.type}`}>{msg.text}</div>
          ))}
          </div>
        </div>
      )}

      {/* 终端内容（预留） */}
      {activeTab === 'terminal' && (
        <div id="output-panel-terminal" className="output-content output-terminal-content" role="tabpanel" aria-labelledby="output-tab-terminal" tabIndex={0}>
          <div className="output-terminal-meta" role="status" aria-live="polite">
            {terminalRunning && <span>状态：运行中</span>}
            {terminalLastCommand && <span>最近命令：{terminalLastCommand}</span>}
          </div>
          <div className="output-terminal-shell">
            <div
              className="output-terminal-log"
              ref={terminalRef}
              role="textbox"
              aria-label="终端控制台"
              aria-multiline="true"
              tabIndex={0}
              onKeyDown={handleTerminalKeyDown}
              onPaste={handleTerminalPaste}
              onFocus={() => setTerminalFocused(true)}
              onBlur={() => setTerminalFocused(false)}
              onMouseDown={(event) => {
                event.preventDefault()
                terminalRef.current?.focus()
              }}
            >
              {terminalOutput.length === 0
                ? <div className="output-terminal-empty">暂无终端输出</div>
                : terminalOutput.map((line, i) => <pre key={`term-${i}`} className="output-terminal-line">{line}</pre>)}
              <div className="output-terminal-commandline output-terminal-commandline-inline">
                <span className="output-terminal-prompt" aria-hidden="true">&gt;</span>
                <span className="output-terminal-inline-input">{terminalInput}</span>
                <span
                  className={`output-terminal-cursor ${terminalFocused ? 'active' : ''}`}
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>
          {terminalStatus && <div className="output-terminal-status" role="alert">{terminalStatus}</div>}
        </div>
      )}

      {/* 提示内容（命令详情） */}
      {activeTab === 'hint' && (
        <div id="output-panel-hint" className="output-content output-hint-content" role="tabpanel" aria-labelledby="output-tab-hint" tabIndex={0}>
          {commandDetail ? (() => {
            const cd = commandDetail
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
                          参数&lt;{i + 1}&gt;的名称为"{p.name}"，类型为"{p.type}{p.isArray ? '(数组)' : ''}{p.isVariable ? '(参考)' : ''}"{p.optional ? '，可以被省略' : ''}。
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
        <div id="output-panel-problems" className="output-content output-problems-content" role="tabpanel" aria-labelledby="output-tab-problems" tabIndex={0}>
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
                    ? <span className="output-problem-loc">第 {p.line} 行, 第 {p.column} 列</span>
                    : <span className="output-problem-loc output-problem-design">设计时</span>}
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {activeTab === 'debug' && (
        <div id="output-panel-debug" className="output-content output-hint-content" role="tabpanel" aria-labelledby="output-tab-debug" tabIndex={0}>
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
                <div style={{ marginTop: 12 }}>
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
          style={{ left: tabsContextMenu.x, top: tabsContextMenu.y }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="output-tabs-context-menu-item"
            onClick={toggleTabsPlacementFromMenu}
          >
            {tabsPlacement === 'top' ? '将“输出/终端/提示/问题/调试”按钮移到底部' : '将“输出/终端/提示/问题/调试”按钮移到顶部'}
          </button>
        </div>
      )}
    </div>
  )
}

export default OutputPanel
