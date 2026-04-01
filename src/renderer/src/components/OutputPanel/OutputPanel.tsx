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
}

function OutputPanel({ height, onResize, onClose, messages = [], commandDetail, highlightParamIndex, problems = [], debugPause = null, debugDisplayLine = null, isDebugPaused = false, onDebugContinue, forceTab, onProblemClick }: OutputPanelProps): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<OutputTab>('compile')
  const [flashProblemIndex, setFlashProblemIndex] = useState<number>(-1)
  const [debugFilter, setDebugFilter] = useState('')

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
    setDebugFilter('')
  }, [debugPause?.file, debugPause?.line])

  // 自动滚动到底部（仅编译输出）
  useEffect(() => {
    if (activeTab === 'compile' && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [messages, activeTab])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = height

    const handleMouseMove = (e: MouseEvent) => {
      const newHeight = Math.max(100, Math.min(500, startHeight - (e.clientY - startY)))
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
  }, [height, onResize])

  const filteredDebugVariables = (() => {
    if (!debugPause) return []
    const keyword = debugFilter.trim().toLowerCase()
    if (!keyword) return debugPause.variables
    return debugPause.variables.filter(variable => variable.name.toLowerCase().includes(keyword))
  })()

  return (
    <div className="output-panel" style={{ height: `${height}px` }} role="region" aria-label="输出面板">
      <div className="output-resizer" onMouseDown={handleMouseDown} role="separator" aria-orientation="horizontal" />
      <div className="output-header">
        <div className="output-tabs" role="tablist">
          <button
            className={`output-tab ${activeTab === 'compile' ? 'active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'compile'}
            onClick={() => setActiveTab('compile')}
          >输出</button>
          <button
            className={`output-tab ${activeTab === 'terminal' ? 'active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'terminal'}
            onClick={() => setActiveTab('terminal')}
          >终端</button>
          <button
            className={`output-tab ${activeTab === 'hint' ? 'active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'hint'}
            onClick={() => setActiveTab('hint')}
          >提示</button>
          <button
            className={`output-tab ${activeTab === 'problems' ? 'active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'problems'}
            onClick={() => setActiveTab('problems')}
          >问题{problems.length > 0 ? ` (${problems.length})` : ''}</button>
          <button
            className={`output-tab ${activeTab === 'debug' ? 'active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'debug'}
            onClick={() => setActiveTab('debug')}
          >调试{isDebugPaused ? ' (暂停)' : ''}</button>
        </div>
        <button className="output-close" onClick={onClose} aria-label="关闭输出面板">×</button>
      </div>

      {/* 编译输出内容 */}
      {activeTab === 'compile' && (
        <div className="output-content" ref={contentRef} role="log" aria-live="polite" tabIndex={0}>
          {messages.map((msg, i) => (
            <div key={i} className={`output-line ${msg.type}`}>{msg.text}</div>
          ))}
        </div>
      )}

      {/* 终端内容（预留） */}
      {activeTab === 'terminal' && (
        <div className="output-content output-terminal-content" tabIndex={0}>
          <div className="output-terminal-empty">终端功能正在开发中</div>
        </div>
      )}

      {/* 提示内容（命令详情） */}
      {activeTab === 'hint' && (
        <div className="output-content output-hint-content" tabIndex={0}>
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
        <div className="output-content output-problems-content" tabIndex={0}>
          {problems.length === 0 ? (
            <div className="output-problem-empty">当前文件没有问题</div>
          ) : (
            <>
              <div className="output-problem-summary">共 {problems.length} 个问题</div>
              {problems.map((p, i) => (
                <div
                  key={i}
                  className={`output-problem-row ${i === flashProblemIndex ? 'flash' : ''}`}
                  onClick={() => {
                    onProblemClick?.(p)
                  }}
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
        <div className="output-content output-hint-content" tabIndex={0}>
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
    </div>
  )
}

export default OutputPanel
