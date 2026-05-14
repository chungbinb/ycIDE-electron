import { Fragment, useState, useCallback, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react'
import { eycToYiFormat, sanitizePastedTextForCurrent, extractAssemblyVarLinesFromPasted, extractRoutedDeclarationLinesFromPasted } from './eycFormat'
import {
  buildBlocks,
  inferResourceTypeByFileName,
  parseLines,
  splitCSV,
  unquote,
} from './eycBlocks'
import {
  FLOW_AUTO_COMPLETE,
  FLOW_AUTO_TAG,
  FLOW_KW,
  FLOW_LOOP_KW,
  FLOW_START,
  computeFlowLines,
  extractFlowKw,
  getFlowStructureAround,
} from './eycFlow'
import type { FlowSegment } from './eycFlow'
import type { RenderBlock } from './eycTableModel'
import type { LibWindowUnit } from './VisualDesigner'
import Icon from '../Icon/Icon'
import '../Icon/Icon.css'
import './EycTableEditor.css'
import EycResourcePreview from './EycResourcePreview'
import { resolveFlowLineColors } from './flowLineTheme'
import { useCodeLineEditor, type CodeLineNavigationAction, type EmptyCodeLineDeleteAction, type ParenScopedKeyAction } from './useCodeLineEditor'
import {
  isQuotedTextLiteral,
  parseAssignmentDetail,
  parseAssignmentLineParts,
  parseCallArgs,
  replaceCallArg,
} from './editorTextUtils'
import {
  dispatchCtrlShortcutWithHistory,
  handleCompletionPopupKey,
  handleTypeCellSpaceGuard,
  dispatchMainEditingKey,
  dispatchPreKeyGuards,
} from './editorKeyboardDispatch'
import {
  applyScopedVariableRename,
  getTableRowInsertTemplate,
} from './editorTableRowUtils'
import {
  applyFlowMarkerSection,
  applyMainAndExtraLines,
  buildLoopFlowBodyLines,
  collectRemainingLinesInCurrentScope,
  getAutoExpandCursorBaseLine,
  removeDuplicateFlowAutoEndings,
  trimTrailingEmptyFormattedLine,
} from './editorFlowAutoExpandUtils'
import {
  renderFlowContinuationLine,
  renderFlowSegsLine,
} from './editorFlowRenderUtils'
import { buildMultiLinePasteResult } from './editorPasteUtils'
import { useEditorInteractionHandlers } from './useEditorInteractionHandlers'
import {
  getCmdIconClass,
  getCmdIconLabel,
  getOuterParenRange,
} from './editorCommandDisplayUtils'
import { readFlowLineConfigFromCss } from './editorFlowLineConfig'
import {
  AC_PAGE_SIZE,
  BUILTIN_LITERAL_COMPLETION_ITEMS,
  BUILTIN_TYPE_ITEMS,
  MEMBER_DELIMITER_REGEX,
  clampNumber,
  colorize,
  formatOps,
  getMissingAssignmentRhsTarget,
  isKnownAssignmentTarget,
  isValidVariableLikeName,
  normalizeMemberTypeName,
  rebuildLineField,
  rebuildLineFlagField,
  splitDebugRenderableText,
} from './editorCoreUtils'
import type { CompletionItem, CompletionParam } from './editorCoreUtils'
import { buildCompletionCatalog } from './editorCompletionCatalogUtils'
import {
  buildCompletionMatches,
  computeCompletionPopupPosition,
  paginateCompletionDisplayItems,
  type AcDisplayItem,
} from './editorCompletionDisplayUtils'
import {
  selectCompletionSourceList,
} from './editorCompletionSourceUtils'
import {
  isCursorInsideQuotedText,
  resolveCompletionWordContext,
} from './editorCompletionInputUtils'
import { useEditorDiagnosticsProblems } from './editorDiagnostics'
import { useEditorBlocksModel } from './editorBlocksModel'

// ========== 组件 ==========

export interface EycTableEditorHandle {
  insertSubroutine: () => void
  insertLocalVariable: () => void
  insertConstant: () => void
  navigateOrCreateSub: (subName: string, params: Array<{ name: string; dataType: string; isByRef: boolean }>) => void
  navigateToLine: (line: number) => void
  navigateToSubprogram: (subName: string, fallbackLine?: number) => void
  getVisibleLineForSourceLine: (line: number) => number
  editorAction: (action: string) => void
}

interface EycTableEditorProps {
  value: string
  docLanguage?: string
  editorFontFamily?: string
  editorFontSize?: number
  editorLineHeight?: number
  freezeSubTableHeader?: boolean
  showMinimapPreview?: boolean
  projectDir?: string
  targetPlatform?: string
  isClassModule?: boolean
  projectGlobalVars?: Array<{ name: string; type: string }>
  windowControlNames?: string[]
  windowControlTypes?: Array<{ name: string; type: string }>
  windowUnits?: LibWindowUnit[]
  projectConstants?: Array<{ name: string; value: string; kind?: 'constant' | 'resource' }>
  projectDllCommands?: Array<{ name: string; returnType: string; description: string; params: CompletionParam[] }>
  projectDataTypes?: Array<{ name: string; fields: Array<{ name: string; type: string }> }>
  projectClassNames?: Array<{ name: string }>
  onClassNameRename?: (oldName: string, newName: string) => void
  onChange: (value: string) => void
  onCommandClick?: (commandName: string, paramIndex?: number) => void
  onCommandClear?: () => void
  onProblemsChange?: (problems: FileProblem[]) => void
  onCursorChange?: (line: number, column: number, sourceLine?: number) => void
  onRouteDeclarationPaste?: (routes: Array<{ language: 'ell' | 'egv' | 'ecs' | 'edt'; lines: string[] }>) => void
  breakpointLines?: number[]
  debugSourceLine?: number
  debugVariables?: Array<{ name: string; type: string; value: string }>
  diffHighlightLines?: Set<number>
  diffAddedLines?: Set<number>
  diffEditedLines?: Set<number>
  diffDeletedAfterLines?: Set<number>
}

export interface FileProblem {
  line: number
  column: number
  message: string
  severity: 'error' | 'warning'
}

interface EditState {
  lineIndex: number
  cellIndex: number
  fieldIdx: number    // -1 表示无字段映射（代码行编辑整行）
  sliceField: boolean
  isVirtual?: boolean // 虚拟代码行（编辑时插入而非替换）
  paramIdx?: number   // 展开参数编辑：第几个参数 (0-based)
}

const setCssVars = (element: HTMLElement | null, vars: Record<string, string>): void => {
  if (!element) return
  for (const [name, value] of Object.entries(vars)) {
    element.style.setProperty(name, value)
  }
}

const TABLE_MODE_HIDDEN_FLOW_COMMANDS = new Set(['否则', '如果结束', '默认', '判断结束', '如果真结束'])

const EycTableEditor = forwardRef<EycTableEditorHandle, EycTableEditorProps>(function EycTableEditor({ value, docLanguage = '', editorFontFamily = '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace', editorFontSize = 14, editorLineHeight = 20, freezeSubTableHeader = false, showMinimapPreview = true, projectDir, targetPlatform = 'windows', isClassModule = false, projectGlobalVars = [], windowControlNames = [], windowControlTypes = [], windowUnits = [], projectConstants = [], projectDllCommands = [], projectDataTypes = [], projectClassNames = [], onClassNameRename, onChange, onCommandClick, onCommandClear, onProblemsChange, onCursorChange, onRouteDeclarationPaste, breakpointLines = [], debugSourceLine, debugVariables = [], diffHighlightLines, diffAddedLines = new Set<number>(), diffEditedLines = new Set<number>(), diffDeletedAfterLines = new Set<number>() }, ref) {
  const eycScale = useMemo(() => clampNumber(editorFontSize / 13, 0.75, 2), [editorFontSize])
  const [editCell, setEditCell] = useState<EditState | null>(null)
  const [editVal, setEditVal] = useState('')
  const editorRootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const paramInputRef = useRef<HTMLInputElement>(null)
  const prevRef = useRef(value)
  const [currentText, setCurrentText] = useState(value)
  const lastFocusedLine = useRef<number>(-1)
  const subNavSeqRef = useRef(0) // 子程序跳转序列号：仅允许最后一次跳转生效，避免多重定时导致抖动
  const flowMarkRef = useRef<string>('')
  const flowIndentRef = useRef<string>('')
  const userVarNamesRef = useRef<Set<string>>(new Set())
  const userSubNamesRef = useRef<Set<string>>(new Set())
  const wasFlowStartRef = useRef(false) // 编辑行是否为流程起始行（用于防止流程命令缩进翻倍）
  const wasFlowKwRef = useRef<string>('') // 编辑行原始流程关键字（如果/如果真/判断/循环...），用于在删除流程命令时溶解流程块
  const wasFlowOrigIndentRef = useRef<string>('') // 编辑流程起始行的"真实"前导空格（flowIndent 在回退路径下可能虚撑，需要真值用于熔解）
  const commitGuardRef = useRef(false) // 防止 commit 被重复调用（mousedown + blur-on-unmount）
  const suppressBlurCommitUntilRef = useRef(0) // 键盘切行时临时屏蔽 blur->commit，避免编辑态被抢占清空
  const preserveEditOnScrollbarRef = useRef(false) // 拖动滚动条时保留编辑态，避免 blur 提交
  const editCellOrigValRef = useRef<string>('') // 表格单元格编辑前的原始值（liveUpdate 会实时更新 lines，需保存原始值用于重命名比较）
  const codeLineEditOrigValRef = useRef<string>('') // 代码行编辑初始值，用于无改动时跳过重排
  const liveUpdateTimerRef = useRef<number | null>(null)
  const pendingLiveUpdateValRef = useRef<string | null>(null)
  const [expandedLines, setExpandedLines] = useState<Set<number>>(new Set())
  const [expandedAssignRhsParamLines, setExpandedAssignRhsParamLines] = useState<Set<number>>(new Set())
  const isResourceTableDoc = docLanguage === 'erc'
  const shouldAliasJudgeStartInTableMode = docLanguage === 'eyc' && !isClassModule
  const shouldFreezeTableHeader = freezeSubTableHeader
    && docLanguage === 'eyc'
    && !isClassModule
    && currentText.split('\n').length <= 1200
  const [resourcePreview, setResourcePreview] = useState<{
    visible: boolean
    lineIndex: number
    resourceName: string
    resourceFile: string
    resourceType: string
    version: number
  }>({ visible: false, lineIndex: -1, resourceName: '', resourceFile: '', resourceType: '', version: 0 })
  const [resourcePreviewBusy, setResourcePreviewBusy] = useState(false)
  const [resourcePreviewSrc, setResourcePreviewSrc] = useState('')
  const [resourcePreviewMsg, setResourcePreviewMsg] = useState('')
  const [resourcePreviewMeta, setResourcePreviewMeta] = useState<{ mime: string; ext: string; filePath: string; sizeBytes: number; modifiedAtMs: number } | null>(null)
  const [resourcePreviewMediaMeta, setResourcePreviewMediaMeta] = useState<{ width?: number; height?: number; durationSec?: number }>({})
  const [debugHover, setDebugHover] = useState<{ x: number; y: number; variable: { name: string; type: string; value: string } } | null>(null)
  const [themeRevision, setThemeRevision] = useState(0)
  const [diagnosticsText, setDiagnosticsText] = useState(value)
  const [diagnosticsErrorLines, setDiagnosticsErrorLines] = useState<number[]>([])
  const breakpointLineSet = useMemo(() => new Set(breakpointLines), [breakpointLines])
  const flowLineModeConfig = useMemo(() => readFlowLineConfigFromCss(), [themeRevision])
  const debugVariableMap = useMemo(() => {
    const map = new Map<string, { name: string; type: string; value: string }>()
    for (const variable of debugVariables) map.set(variable.name, variable)
    return map
  }, [debugVariables])

  const renderDebugAwareSpan = useCallback((text: string, className: string, keyPrefix: string) => {
    const parts = splitDebugRenderableText(text)
    return parts.map((part, index) => {
      const variable = part.token ? debugVariableMap.get(part.token) : undefined
      if (!variable) {
        return <span key={`${keyPrefix}-${index}`} className={className}>{part.text}</span>
      }
      return (
        <span
          key={`${keyPrefix}-${index}`}
          className={`${className} eyc-debug-hoverable`}
          onMouseEnter={(e) => setDebugHover({ x: e.clientX + 12, y: e.clientY + 12, variable })}
          onMouseMove={(e) => setDebugHover({ x: e.clientX + 12, y: e.clientY + 12, variable })}
          onMouseLeave={() => setDebugHover(current => (current?.variable.name === variable.name ? null : current))}
        >{part.text}</span>
      )
    })
  }, [debugVariableMap])

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setThemeRevision(prev => prev + 1)
    })
    observer.observe(root, { attributes: true, attributeFilter: ['style'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!editCell) {
      setDiagnosticsText(currentText)
      return
    }
    const timer = window.setTimeout(() => {
      setDiagnosticsText(currentText)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [currentText, editCell])

  // ===== 行选择状态 =====
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set())
  const [editorContextMenu, setEditorContextMenu] = useState<{ x: number; y: number; lineIndex: number | null } | null>(null)
  const [contextMenuCanPaste, setContextMenuCanPaste] = useState(false)
  const dragAnchor = useRef<number | null>(null)  // 拖选起点行号
  const isDragging = useRef(false)
  const dragStartPos = useRef<{ x: number; y: number } | null>(null)
  const wasDragSelect = useRef(false)
  const pendingInputDragRef = useRef<{ lineIndex: number; x: number; y: number; allowRowDrag: boolean } | null>(null)

  useEffect(() => {
    if (!editorContextMenu) return
    const close = (): void => setEditorContextMenu(null)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [editorContextMenu])

  useEffect(() => {
    if (!editorContextMenu) {
      setContextMenuCanPaste(false)
      return
    }
    let cancelled = false
    setContextMenuCanPaste(false)
    void navigator.clipboard.readText()
      .then((text) => {
        if (cancelled) return
        setContextMenuCanPaste((text || '').length > 0)
      })
      .catch(() => {
        if (cancelled) return
        setContextMenuCanPaste(false)
      })
    return () => {
      cancelled = true
    }
  }, [editorContextMenu])

  // ===== 撤销/重做栈 =====
  const undoStack = useRef<string[]>([])
  const redoStack = useRef<string[]>([])
  const pushUndo = useCallback((oldText: string) => {
    undoStack.current.push(oldText)
    if (undoStack.current.length > 200) undoStack.current.shift()
    redoStack.current = []
  }, [])

  const applySingleLineUpdate = useCallback((lineIndex: number, updater: (rawLine: string) => string | null): boolean => {
    const ls = currentText.split('\n')
    if (lineIndex < 0 || lineIndex >= ls.length) return false
    const nextLine = updater(ls[lineIndex])
    if (nextLine == null || nextLine === ls[lineIndex]) return false
    pushUndo(currentText)
    ls[lineIndex] = nextLine
    const nextText = ls.join('\n')
    setCurrentText(nextText)
    prevRef.current = nextText
    onChange(nextText)
    return true
  }, [currentText, onChange, pushUndo])

  const tryToggleTableBooleanCell = useCallback((tableType: string | undefined, lineIndex: number, cellIndex: number): boolean => {
    return applySingleLineUpdate(lineIndex, (rawLine) => {
      const parsed = parseLines(rawLine)[0]
      if (!parsed) return null

      if (parsed.type === 'dll' && cellIndex === 2) {
        return rebuildLineField(rawLine, 4, (parsed.fields[4] || '').trim() === '公开' ? '' : '公开', false)
      }
      if (parsed.type === 'sub' && cellIndex === 2) {
        return rebuildLineField(rawLine, 2, (parsed.fields[2] || '').trim() === '公开' ? '' : '公开', false)
      }
      if (parsed.type === 'localVar' && cellIndex === 2) {
        return rebuildLineField(rawLine, 2, (parsed.fields[2] || '').trim() === '静态' ? '' : '静态', false)
      }
      if (parsed.type === 'globalVar' && cellIndex === 3) {
        return rebuildLineField(rawLine, 2, (parsed.fields[2] || '').includes('公开') ? '' : '公开', false)
      }
      if (parsed.type === 'dataTypeMember' && cellIndex === 2) {
        return rebuildLineField(rawLine, 2, (parsed.fields[2] || '').trim() === '传址' ? '' : '传址', false)
      }
      if (parsed.type === 'subParam') {
        if (tableType === 'dll') {
          if (cellIndex === 2) return rebuildLineFlagField(rawLine, 2, '传址')
          if (cellIndex === 3) return rebuildLineFlagField(rawLine, 2, '数组')
          return null
        }
        if (cellIndex === 2) return rebuildLineFlagField(rawLine, 2, '参考')
        if (cellIndex === 3) return rebuildLineFlagField(rawLine, 2, '可空')
        if (cellIndex === 4) return rebuildLineFlagField(rawLine, 2, '数组')
      }

      return null
    })
  }, [applySingleLineUpdate])

  // ===== 行选择：拖选逻辑 =====
  // 从行号到实际元素的映射（用于鼠标位置判定）
  const wrapperRef = useRef<HTMLDivElement>(null)
  const tableShellRef = useRef<HTMLDivElement>(null)
  const minimapTrackRef = useRef<HTMLDivElement>(null)
  const minimapContentRef = useRef<HTMLDivElement>(null)
  const minimapViewportRef = useRef<HTMLDivElement>(null)
  const minimapViewportRafRef = useRef<number | null>(null)
  const visibleLineWindowRafRef = useRef<number | null>(null)
  const stickyScopeRafRef = useRef<number | null>(null)
  const stickyScopeRowRef = useRef<HTMLDivElement>(null)
  const stickyStartTopByLineRef = useRef<Map<number, number>>(new Map())
  const blocksRef = useRef<RenderBlock[]>([])
  const subTableMetaRef = useRef<Array<{
    startLine: number
    nextStartLine: number | null
    colCount: number
    rows: Array<{
      lineIndex: number
      isHeader: boolean
      cells: Array<{ text: string; cls: string; colSpan?: number; align?: string; fieldIdx?: number; sliceField?: boolean }>
    }>
  }>>([])
  const [stickySubTable, setStickySubTable] = useState<{
    lineIndex: number
    nextStartLine: number | null
    colCount: number
    rows: Array<{
      lineIndex: number
      isHeader: boolean
      cells: Array<{ text: string; cls: string; colSpan?: number; align?: string; fieldIdx?: number; sliceField?: boolean }>
    }>
  } | null>(null)
  const [stickyPushOffsetPx, setStickyPushOffsetPx] = useState(0)
  const [scrollbarLaneHeightPx, setScrollbarLaneHeightPx] = useState(0)
  const minimapMetricsRef = useRef({
    topRatio: -1,
    heightRatio: -1,
    scrollbarWidth: -1,
    scrollbarHeight: -1,
    laneHeight: -1,
    contentOffsetPx: -1,
  })
  const minimapWidthPx = useMemo(() => {
    const base = (editorFontSize / 14) * 75
    return Math.max(52, Math.round(base))
  }, [editorFontSize])
  const logicalLineCount = useMemo(() => currentText.split('\n').length, [currentText])
  const shouldShowMinimapPreview = showMinimapPreview && logicalLineCount <= 600
  const [visibleLineWindow, setVisibleLineWindow] = useState<{ startLine: number; endLine: number }>({
    startLine: 0,
    endLine: Math.max(logicalLineCount - 1, 0),
  })

  useEffect(() => {
    const root = editorRootRef.current
    if (!root) return
    root.style.setProperty('--editor-font-family', editorFontFamily)
    root.style.setProperty('--editor-font-size', `${editorFontSize}px`)
    root.style.setProperty('--editor-line-height', `${editorLineHeight}px`)
    root.style.setProperty('--eyc-scale', `${eycScale}`)
    root.style.setProperty('zoom', `${eycScale}`)
  }, [editorFontFamily, editorFontSize, editorLineHeight, eycScale])

  useEffect(() => {
    tableShellRef.current?.style.setProperty('--eyc-minimap-width', `${shouldShowMinimapPreview ? minimapWidthPx : 0}px`)
  }, [minimapWidthPx, shouldShowMinimapPreview])

  const scrollToLineIndex = useCallback((lineIndex: number, behavior: ScrollBehavior = 'smooth') => {
    if (!Number.isFinite(lineIndex) || lineIndex < 0) return
    const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${lineIndex}"]`)
    if (el) {
      el.scrollIntoView({ behavior, block: 'center' })
      return
    }
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const maxLineIndex = Math.max(currentText.split('\n').length - 1, 0)
    const targetRatio = maxLineIndex > 0 ? Math.min(Math.max(lineIndex / maxLineIndex, 0), 1) : 0
    const targetTop = targetRatio * Math.max(wrapper.scrollHeight - wrapper.clientHeight, 0)
    wrapper.scrollTo({ top: targetTop, behavior })
  }, [currentText])

  const updateMinimapViewport = useCallback(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const minimapScale = 0.24
    const scrollHeight = Math.max(wrapper.scrollHeight, 1)
    const clientHeight = Math.max(wrapper.clientHeight, 1)
    const topRatio = Math.min(Math.max(wrapper.scrollTop / scrollHeight, 0), 1)
    const heightRatio = Math.min(Math.max(clientHeight / scrollHeight, 0.08), 1)

    const viewportEl = minimapViewportRef.current
    if (viewportEl) {
      const { topRatio: prevTop, heightRatio: prevHeight } = minimapMetricsRef.current
      if (Math.abs(prevTop - topRatio) > 0.0005) {
        viewportEl.style.top = `${topRatio * 100}%`
      }
      if (Math.abs(prevHeight - heightRatio) > 0.0005) {
        viewportEl.style.height = `${heightRatio * 100}%`
      }
    }

    const scrollbarWidth = Math.max(wrapper.offsetWidth - wrapper.clientWidth, 0)
    const scrollbarHeight = Math.max(wrapper.offsetHeight - wrapper.clientHeight, 0)
    const laneHeight = Math.max(wrapper.clientHeight, 1)
    let contentOffsetPx = minimapMetricsRef.current.contentOffsetPx

    const shellEl = tableShellRef.current
    if (shellEl) {
      const { scrollbarWidth: prevWidth, scrollbarHeight: prevHeight } = minimapMetricsRef.current
      if (prevWidth !== scrollbarWidth) {
        shellEl.style.setProperty('--eyc-scrollbar-width', `${scrollbarWidth}px`)
      }
      if (prevHeight !== scrollbarHeight) {
        shellEl.style.setProperty('--eyc-scrollbar-height', `${scrollbarHeight}px`)
      }
    }

    if (Math.abs(minimapMetricsRef.current.laneHeight - laneHeight) > 0.5) {
      setScrollbarLaneHeightPx(laneHeight)
    }

    const contentEl = minimapContentRef.current
    if (contentEl) {
      const maxScrollTop = Math.max(scrollHeight - clientHeight, 0)
      const scrollRatio = maxScrollTop > 0 ? Math.min(Math.max(wrapper.scrollTop / maxScrollTop, 0), 1) : 0
      const renderedContentHeight = contentEl.scrollHeight * minimapScale
      const maxContentOffsetPx = Math.max(renderedContentHeight - wrapper.clientHeight, 0)
      const nextOffsetPx = scrollRatio * maxContentOffsetPx
      if (Math.abs(minimapMetricsRef.current.contentOffsetPx - nextOffsetPx) > 0.5) {
        contentEl.style.transform = `translate3d(0, ${-nextOffsetPx}px, 0) scale(${minimapScale})`
      }
      contentOffsetPx = nextOffsetPx
    }

    minimapMetricsRef.current = {
      topRatio,
      heightRatio,
      scrollbarWidth,
      scrollbarHeight,
      laneHeight,
      contentOffsetPx,
    }
  }, [])

  const scheduleMinimapViewportUpdate = useCallback(() => {
    if (minimapViewportRafRef.current != null) return
    minimapViewportRafRef.current = window.requestAnimationFrame(() => {
      minimapViewportRafRef.current = null
      updateMinimapViewport()
    })
  }, [updateMinimapViewport])

  const updateVisibleLineWindow = useCallback(() => {
    const wrapper = wrapperRef.current
    const maxLineIndex = Math.max(logicalLineCount - 1, 0)
    if (!wrapper || maxLineIndex <= 0) {
      setVisibleLineWindow({ startLine: 0, endLine: maxLineIndex })
      return
    }

    const scrollHeight = Math.max(wrapper.scrollHeight, 1)
    const maxScrollTop = Math.max(scrollHeight - wrapper.clientHeight, 1)
    const topRatio = Math.min(Math.max(wrapper.scrollTop / maxScrollTop, 0), 1)
    const bottomRatio = Math.min(Math.max((wrapper.scrollTop + wrapper.clientHeight) / scrollHeight, 0), 1)
    const overscanLines = 220
    const quantizeStep = 32
    const rawStart = Math.max(0, Math.floor(topRatio * maxLineIndex) - overscanLines)
    const rawEnd = Math.min(maxLineIndex, Math.ceil(bottomRatio * maxLineIndex) + overscanLines)
    const startLine = Math.max(0, Math.floor(rawStart / quantizeStep) * quantizeStep)
    const endLine = Math.min(maxLineIndex, Math.ceil(rawEnd / quantizeStep) * quantizeStep)

    setVisibleLineWindow(prev => {
      if (prev.startLine === startLine && prev.endLine === endLine) return prev
      return { startLine, endLine }
    })
  }, [logicalLineCount])

  const scheduleVisibleLineWindowUpdate = useCallback(() => {
    if (visibleLineWindowRafRef.current != null) return
    visibleLineWindowRafRef.current = window.requestAnimationFrame(() => {
      visibleLineWindowRafRef.current = null
      updateVisibleLineWindow()
    })
  }, [updateVisibleLineWindow])

  const jumpByMinimapClientY = useCallback((clientY: number, behavior: ScrollBehavior = 'smooth') => {
    const wrapper = wrapperRef.current
    const track = minimapTrackRef.current
    if (!wrapper || !track) return
    const rect = track.getBoundingClientRect()
    const ratio = Math.min(Math.max((clientY - rect.top) / Math.max(rect.height, 1), 0), 1)
    const targetTop = ratio * Math.max(wrapper.scrollHeight - wrapper.clientHeight, 0)
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    wrapper.scrollTo({ top: targetTop, behavior: prefersReducedMotion ? 'auto' : behavior })
    const maxLineIndex = Math.max(currentText.split('\n').length - 1, 0)
    lastFocusedLine.current = Math.round(ratio * maxLineIndex)
  }, [currentText])

  const handleMinimapMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    jumpByMinimapClientY(e.clientY, 'smooth')
    const wrapper = wrapperRef.current
    if (!wrapper) return
    try {
      wrapper.focus({ preventScroll: true })
    } catch {
      wrapper.focus()
    }
  }, [jumpByMinimapClientY])

  const handleMinimapWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    if (e.deltaY === 0 && e.deltaX === 0) return
    e.preventDefault()
    wrapper.scrollBy({ top: e.deltaY, left: e.deltaX, behavior: 'auto' })
  }, [])

  const handleMinimapKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const lineStep = Math.max(editorLineHeight, 16)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      wrapper.scrollBy({ top: lineStep, behavior: 'auto' })
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      wrapper.scrollBy({ top: -lineStep, behavior: 'auto' })
      return
    }
    if (e.key === 'PageDown') {
      e.preventDefault()
      wrapper.scrollBy({ top: wrapper.clientHeight * 0.9, behavior: 'auto' })
      return
    }
    if (e.key === 'PageUp') {
      e.preventDefault()
      wrapper.scrollBy({ top: -wrapper.clientHeight * 0.9, behavior: 'auto' })
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      scrollToLineIndex(0, 'auto')
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      scrollToLineIndex(Math.max(currentText.split('\n').length - 1, 0), 'auto')
    }
  }, [currentText, editorLineHeight, scrollToLineIndex])

  useEffect(() => {
    scheduleMinimapViewportUpdate()
    scheduleVisibleLineWindowUpdate()
  }, [scheduleMinimapViewportUpdate, scheduleVisibleLineWindowUpdate, currentText])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const onScroll = (): void => {
      scheduleMinimapViewportUpdate()
      scheduleVisibleLineWindowUpdate()
    }
    wrapper.addEventListener('scroll', onScroll, { passive: true })
    const onResize = (): void => {
      scheduleMinimapViewportUpdate()
      scheduleVisibleLineWindowUpdate()
    }
    window.addEventListener('resize', onResize)
    let resizeObserver: ResizeObserver | null = null
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(() => {
        scheduleMinimapViewportUpdate()
        scheduleVisibleLineWindowUpdate()
      })
      resizeObserver.observe(wrapper)
    }
    return () => {
      if (minimapViewportRafRef.current != null) {
        window.cancelAnimationFrame(minimapViewportRafRef.current)
        minimapViewportRafRef.current = null
      }
      if (visibleLineWindowRafRef.current != null) {
        window.cancelAnimationFrame(visibleLineWindowRafRef.current)
        visibleLineWindowRafRef.current = null
      }
      wrapper.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      resizeObserver?.disconnect()
    }
  }, [scheduleMinimapViewportUpdate, scheduleVisibleLineWindowUpdate])

  const focusWrapper = useCallback(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    try {
      wrapper.focus({ preventScroll: true })
    } catch {
      wrapper.focus()
    }
  }, [])

  /** 根据鼠标 Y 坐标找到对应的行号 */
  const findLineAtY = useCallback((clientY: number): number => {
    if (!wrapperRef.current) return -1
    const rows = wrapperRef.current.querySelectorAll<HTMLElement>('[data-line-index]')
    let closest = -1
    for (const el of rows) {
      const li = parseInt(el.dataset.lineIndex!, 10)
      const rect = el.getBoundingClientRect()
      if (clientY >= rect.top && clientY < rect.bottom) return li
      if (clientY >= rect.top) closest = li
    }
    return closest
  }, [])

  /** 计算 anchor 到 end 之间的行集合 */
  const rangeSet = useCallback((a: number, b: number): Set<number> => {
    const lo = Math.min(a, b), hi = Math.max(a, b)
    const s = new Set<number>()
    for (let i = lo; i <= hi; i++) s.add(i)
    return s
  }, [])

  const handleLineMouseDown = useCallback((e: React.MouseEvent, lineIndex: number) => {
    // 正在编辑的输入框中不处理
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    // 命令点击不触发选择
    if ((e.target as HTMLElement).classList.contains('eyc-cmd-clickable')) return

    e.preventDefault()
    // 如果有活跃编辑，先提交当前编辑（含自动补全上屏）
    if (editCellRef.current) {
      commitRef.current()
    }
    dragStartPos.current = { x: e.clientX, y: e.clientY }
    wasDragSelect.current = false
    if (e.shiftKey && dragAnchor.current !== null) {
      // Shift+点击: 扩展选择到当前行
      setSelectedLines(rangeSet(dragAnchor.current, lineIndex))
    } else {
      dragAnchor.current = lineIndex
      // 普通单击不立即标记行选中，避免蓝色闪烁；只有实际拖动时才设置
    }
    isDragging.current = true
    // 聚焦 wrapper 以便接收键盘事件（Delete等）
    focusWrapper()
  }, [focusWrapper, rangeSet])

  // mousemove 和 mouseup 全局监听
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!isDragging.current && pendingInputDragRef.current) {
        const p = pendingInputDragRef.current
        if (!p.allowRowDrag) return
        // 判断鼠标是否已离开 input 元素边界
        const inputEl = inputRef.current
        if (inputEl) {
          const rect = inputEl.getBoundingClientRect()
          const outside = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom
          if (outside) {
            if (editCellRef.current) commitRef.current()
            dragStartPos.current = { x: p.x, y: p.y }
            dragAnchor.current = p.lineIndex
            setSelectedLines(new Set([p.lineIndex]))
            isDragging.current = true
            wasDragSelect.current = true
            focusWrapper()
          }
        }
      }
      if (!isDragging.current || dragAnchor.current === null) return
      if (dragStartPos.current) {
        const dx = e.clientX - dragStartPos.current.x
        const dy = e.clientY - dragStartPos.current.y
        if (dx * dx + dy * dy > 25) wasDragSelect.current = true
      }
      // 只有确认是拖动后才更新行选中，避免普通点击时也出现蓝色高亮
      if (!wasDragSelect.current) return
      const li = findLineAtY(e.clientY)
      if (li >= 0) {
        // 确保锚点行也被选中（首次拖入超过阈值时）
        setSelectedLines(rangeSet(dragAnchor.current, li))
      }
    }
    const onUp = (): void => {
      isDragging.current = false
      pendingInputDragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [findLineAtY, focusWrapper, rangeSet])

  // 全局键盘处理（选择状态下 Ctrl+C 复制、Delete 删除；Ctrl+A 全选）
  useEffect(() => {
    const getSubAnchorInfoForLine = (ls: string[], lineIndex: number): { anchorLine: number; ordinaryLines: number[] } | null => {
      if (lineIndex < 0 || lineIndex >= ls.length) return null
      let subStart = -1
      for (let i = lineIndex; i >= 0; i--) {
        const t = (ls[i] || '').replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ')) { subStart = i; break }
        if (t.startsWith('.程序集 ')) break
      }
      if (subStart < 0) return null

      let subEnd = ls.length
      for (let i = subStart + 1; i < ls.length; i++) {
        const t = (ls[i] || '').replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ') || t.startsWith('.程序集 ')) {
          subEnd = i
          break
        }
      }

      const ordinaryLines: number[] = []
      for (let i = subStart + 1; i < subEnd; i++) {
        const t = (ls[i] || '').replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.')) continue
        ordinaryLines.push(i)
      }
      if (ordinaryLines.length === 0) return null
      return { anchorLine: ordinaryLines[0], ordinaryLines }
    }

    const applySubAnchorDeleteRule = (ls: string[], deletableInput: Set<number>): { deletable: Set<number>; forceBlank: Set<number> } => {
      const deletable = new Set<number>(deletableInput)
      const forceBlank = new Set<number>()
      const touchedAnchors = new Set<number>()

      for (const i of Array.from(deletable)) {
        const info = getSubAnchorInfoForLine(ls, i)
        if (!info) continue
        const anchor = info.anchorLine
        if (touchedAnchors.has(anchor)) continue
        if (!deletable.has(anchor)) continue
        touchedAnchors.add(anchor)

        // 子程序首条普通行必须保留：
        // 1) 有命令时改为空行保留；
        // 2) 本来就是空行时，改删其下方普通行（若存在）。
        deletable.delete(anchor)
        if (((ls[anchor] || '').trim()) !== '') {
          forceBlank.add(anchor)
          continue
        }

        const hasOtherSelected = info.ordinaryLines.some(line => line > anchor && deletable.has(line))
        if (!hasOtherSelected) {
          const nextOrdinary = info.ordinaryLines.find(line => line > anchor)
          if (nextOrdinary !== undefined) deletable.add(nextOrdinary)
        }
      }

      return { deletable, forceBlank }
    }

    const getProtectedDeclarationLine = (ls: string[]): number => {
      const parsed = parseLines(ls.join('\n'))
      for (let i = 0; i < parsed.length; i++) {
        if (parsed[i].type === 'assembly') return i
      }
      return -1
    }

    const getDeletableSelection = (ls: string[], selection: Set<number>): { protectedLine: number; deletable: Set<number>; sorted: number[] } => {
      const protectedLine = getProtectedDeclarationLine(ls)
      const deletable = new Set<number>()
      for (const i of selection) {
        if (i < 0 || i >= ls.length) continue
        if (i === protectedLine) continue
        deletable.add(i)
      }
      return { protectedLine, deletable, sorted: Array.from(deletable).sort((a, b) => a - b) }
    }

    const preserveTrailingBlankLine = (before: string[], after: string[]): string[] => {
      const hadTrailingBlank = before.length > 0 && (before[before.length - 1] || '').trim() === ''
      if (!hadTrailingBlank) return after
      const hasTrailingBlank = after.length > 0 && (after[after.length - 1] || '').trim() === ''
      if (hasTrailingBlank) return after
      return [...after, '']
    }

    const handler = (e: KeyboardEvent): void => {
      // 正在编辑输入框时不处理（交给 onKey）
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      // 检查焦点是否在本编辑器区域内
      const inEditor = wrapperRef.current?.contains(document.activeElement as Node)
        || document.activeElement === wrapperRef.current
        || document.activeElement === document.body
        || wrapperRef.current?.closest('.eyc-table-editor')?.contains(document.activeElement as Node)

      const ctrl = e.ctrlKey || e.metaKey

      // Ctrl+A：全选所有行（只要焦点在编辑器区域）
      if (ctrl && e.key === 'a' && inEditor) {
        e.preventDefault()
        const ls = prevRef.current.split('\n')
        const all = new Set<number>()
        for (let i = 0; i < ls.length; i++) all.add(i)
        setSelectedLines(all)
        dragAnchor.current = 0
        return
      }

      // Ctrl+Z / Ctrl+Y：撤销/重做（编辑器区域内）
      const key = e.key.toLowerCase()
      if (ctrl && key === 'z' && !e.shiftKey && inEditor) {
        e.preventDefault()
        if (undoStack.current.length > 0) {
          const prev = undoStack.current.pop()!
          redoStack.current.push(prevRef.current)
          setCurrentText(prev); prevRef.current = prev; onChange(prev)
        }
        return
      }
      if (ctrl && (key === 'y' || (e.shiftKey && key === 'z')) && inEditor) {
        e.preventDefault()
        if (redoStack.current.length > 0) {
          const next = redoStack.current.pop()!
          undoStack.current.push(prevRef.current)
          setCurrentText(next); prevRef.current = next; onChange(next)
        }
        return
      }

      // Ctrl+V：粘贴多行内容
      if (ctrl && e.key === 'v' && inEditor) {
        const state = editCellRef.current
        if (state && state.cellIndex === -1 && state.paramIdx === undefined) return
        if (shouldUseNativeInputPaste(editCellRef.current)) return
        e.preventDefault()
        navigator.clipboard.readText().then(clipText => {
          const latestText = prevRef.current
          const cursorLine = editCellRef.current?.lineIndex ?? lastFocusedLine.current
          const pasteResult = buildMultiLinePasteResult({
            currentText: latestText,
            clipText,
            cursorLine,
            sanitizePastedText: sanitizePastedTextForCurrent,
            extractAssemblyVarLines: extractAssemblyVarLinesFromPasted,
            extractRoutedDeclarationLines: extractRoutedDeclarationLinesFromPasted,
          })
          if (!pasteResult) return
          if (pasteResult.routedDeclarations.length > 0) {
            onRouteDeclarationPaste?.(pasteResult.routedDeclarations)
          }
          pushUndo(latestText)
          const nt = pasteResult.nextText
          setCurrentText(nt); prevRef.current = nt; onChange(nt)
          const newSel = new Set<number>()
          for (let i = 0; i < pasteResult.pastedLineCount; i++) newSel.add(pasteResult.insertAt + i)
          setSelectedLines(newSel)
          lastFocusedLine.current = pasteResult.insertAt + pasteResult.pastedLineCount - 1
        })
        return
      }

      // 以下操作需要有选中行且焦点在编辑器内
      if (selectedLines.size === 0 || !inEditor) return

      if (ctrl && e.key === 'c') {
        e.preventDefault()
        const sorted = [...selectedLines].sort((a, b) => a - b)
        const ls = currentText.split('\n')
        const selectedText = eycToYiFormat(sorted.filter(i => i < ls.length).map(i => ls[i]).join('\n'))
        navigator.clipboard.writeText(selectedText)
        return
      }
      if (ctrl && e.key === 'x') {
        e.preventDefault()
        const ls = currentText.split('\n')
        const { deletable: rawDeletable, sorted } = getDeletableSelection(ls, selectedLines)
        if (sorted.length === 0) return
        const selectedText = eycToYiFormat(sorted.map(i => ls[i]).join('\n'))
        navigator.clipboard.writeText(selectedText)
        // 删除选中行
        const { deletable, forceBlank } = applySubAnchorDeleteRule(ls, rawDeletable)
        pushUndo(currentText)
        const nl = preserveTrailingBlankLine(ls, ls.reduce<string[]>((acc, line, i) => {
          if (deletable.has(i)) return acc
          acc.push(forceBlank.has(i) ? '' : line)
          return acc
        }, []))
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt)
        setSelectedLines(new Set())
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        const ls = currentText.split('\n')
        const { deletable: rawDeletable, sorted: sortedSel } = getDeletableSelection(ls, selectedLines)
        if (sortedSel.length === 0) return
        const { deletable, forceBlank } = applySubAnchorDeleteRule(ls, rawDeletable)
        pushUndo(currentText)
        const nl = preserveTrailingBlankLine(ls, ls.reduce<string[]>((acc, line, i) => {
          if (deletable.has(i)) return acc
          acc.push(forceBlank.has(i) ? '' : line)
          return acc
        }, []))
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt)
        setSelectedLines(new Set())
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedLines, onChange, pushUndo])

  // ===== 自动补全状态 =====
  const [acItems, setAcItems] = useState<AcDisplayItem[]>([])
  const [acIndex, setAcIndex] = useState(0)
  const [acVisible, setAcVisible] = useState(false)
  const [acPos, setAcPos] = useState({ left: 0, top: 0 })
  const [libraryDataTypeNames, setLibraryDataTypeNames] = useState<string[]>([])
  const [libraryConstants, setLibraryConstants] = useState<Array<{ name: string; englishName: string; description: string; value: string; libraryName: string }>>([])
  const allCommandsRef = useRef<CompletionItem[]>([])
  const memberCommandsRef = useRef<CompletionItem[]>([])
  const [cmdLoadId, setCmdLoadId] = useState(0) // 触发重新验证
  const acWordStartRef = useRef(0) // 当前补全词在 editVal 中的起始位置
  const acPrefixRef = useRef('')
  const acListRef = useRef<HTMLDivElement>(null)
  // 用 ref 跟踪最新值，以便在 useCallback 闭包中访问（避免依赖项膨胀）
  const editCellRef = useRef(editCell)
  editCellRef.current = editCell
  const shouldUseNativeInputPaste = useCallback((state: EditState | null): boolean => {
    if (!state) return false
    return state.cellIndex >= 0 || state.paramIdx !== undefined
  }, [])
  const acVisibleRef = useRef(false)
  acVisibleRef.current = acVisible
  const acItemsRef = useRef<AcDisplayItem[]>([])
  acItemsRef.current = acItems
  const userVarCompletionItemsRef = useRef<CompletionItem[]>([])
  const userSubCompletionItemsRef = useRef<CompletionItem[]>([])
  const constantCompletionItemsRef = useRef<CompletionItem[]>([])
  const libraryConstantCompletionItemsRef = useRef<CompletionItem[]>([])
  const dllCompletionItemsRef = useRef<CompletionItem[]>([])
  const typeCompletionItemsRef = useRef<CompletionItem[]>([])
  const classNameCompletionItemsRef = useRef<CompletionItem[]>([])

  const canUseTypeCompletion = useCallback((lineIndex: number, fieldIdx: number): boolean => {
    if (fieldIdx !== 1) return false
    const srcLines = currentText.split('\n')
    const raw = (srcLines[lineIndex] || '').replace(/[\r\t]/g, '').trimStart()
    return raw.startsWith('.局部变量 ')
      || raw.startsWith('.参数 ')
      || raw.startsWith('.程序集变量 ')
      || raw.startsWith('.程序集 ')
      || raw.startsWith('.全局变量 ')
      || raw.startsWith('.成员 ')
      || raw.startsWith('.子程序 ')
      || raw.startsWith('.DLL命令 ')
  }, [currentText])

  const canUseClassNameCompletion = useCallback((lineIndex: number, fieldIdx: number): boolean => {
    if (fieldIdx !== 1) return false
    const srcLines = currentText.split('\n')
    const raw = (srcLines[lineIndex] || '').replace(/[\r\t]/g, '').trimStart()
    return raw.startsWith('.程序集 ')
  }, [currentText])

  const windowControlTypeMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of windowControlTypes) {
      const name = (item?.name || '').trim()
      const type = (item?.type || '').trim()
      if (!name || !type) continue
      map.set(name, type)
    }
    return map
  }, [windowControlTypes])

  const parsedLinesForCurrentText = useMemo(() => parseLines(currentText), [currentText])

  const userVarTypeMap = useMemo(() => {
    const parsed = parsedLinesForCurrentText
    const cursorLine = editCell?.lineIndex ?? -1
    let subStart = -1
    let subEnd = parsed.length

    if (cursorLine >= 0 && cursorLine < parsed.length) {
      for (let i = cursorLine; i >= 0; i--) {
        const t = parsed[i].type
        if (t === 'sub') { subStart = i; break }
        if (t === 'assembly') break
      }
      if (subStart >= 0) {
        for (let i = subStart + 1; i < parsed.length; i++) {
          const t = parsed[i].type
          if (t === 'sub' || t === 'assembly') { subEnd = i; break }
        }
      }
    }

    const map = new Map<string, string>()
    const addVar = (name: string, varType: string): void => {
      const nm = (name || '').trim()
      const tp = (varType || '').trim()
      if (!nm || !tp) return
      map.set(nm, tp)
    }

    if (subStart >= 0) {
      for (let i = subStart + 1; i < subEnd; i++) {
        const ln = parsed[i]
        if ((ln.type === 'subParam' || ln.type === 'localVar') && ln.fields[0]) {
          addVar(ln.fields[0], ln.fields[1] || '')
        }
      }
    }

    for (const ln of parsed) {
      if ((ln.type === 'assemblyVar' || ln.type === 'globalVar') && ln.fields[0]) {
        addVar(ln.fields[0], ln.fields[1] || '')
      }
    }

    for (const v of projectGlobalVars) addVar(v.name, v.type || '')
    for (const item of windowControlTypes) addVar(item?.name || '', item?.type || '')
    return map
  }, [parsedLinesForCurrentText, editCell?.lineIndex, projectGlobalVars, windowControlTypes])

  const customDataTypeFieldMap = useMemo(() => {
    const map = new Map<string, Array<{ name: string; type: string }>>()
    const addField = (typeName: string, fieldName: string, fieldType: string): void => {
      const tn = normalizeMemberTypeName(typeName)
      const fn = (fieldName || '').trim()
      if (!tn || !fn) return
      if (!map.has(tn)) map.set(tn, [])
      const fields = map.get(tn)!
      if (!fields.some(field => field.name === fn)) {
        fields.push({ name: fn, type: (fieldType || '').trim() })
      }
    }

    for (const dt of projectDataTypes) {
      for (const field of dt.fields || []) {
        addField(dt.name, field.name, field.type)
      }
    }

    const parsed = parsedLinesForCurrentText
    let currentTypeName = ''
    for (const ln of parsed) {
      if (ln.type === 'dataType') {
        currentTypeName = (ln.fields[0] || '').trim()
        continue
      }
      if (ln.type === 'dataTypeMember') {
        addField(currentTypeName, ln.fields[0] || '', ln.fields[1] || '')
        continue
      }
      if (ln.type !== 'blank' && ln.type !== 'comment') {
        currentTypeName = ''
      }
    }

    return map
  }, [parsedLinesForCurrentText, projectDataTypes])

  // 加载所有命令（用于补全），含流程关键字
  const reloadCommands = useCallback(() => {
    window.api.library.getAllCommands(targetPlatform).then((cmds: CompletionItem[]) => {
      const { independentItems, memberItems, libraryConstantItems } = buildCompletionCatalog(cmds)
      allCommandsRef.current = independentItems
      memberCommandsRef.current = memberItems
      libraryConstantCompletionItemsRef.current = libraryConstantItems

      setCmdLoadId(n => n + 1)
    }).catch(() => {})
  }, [targetPlatform])

  // 初始加载 + 支持库变更时重新加载命令
  useEffect(() => {
    reloadCommands()
    window.api.on('library:loaded', reloadCommands)
    return () => { window.api.off('library:loaded') }
  }, [reloadCommands])

  // 从已加载支持库收集数据类型
  useEffect(() => {
    let cancelled = false
    const loadLibraryMeta = async () => {
      try {
        const list = await window.api.library.getList() as Array<{ name: string; loaded?: boolean }>
        const loadedLibs = (list || []).filter(lib => lib?.loaded !== false)
        const detailList = await Promise.all(loadedLibs.map(lib => window.api.library.getInfo(lib.name))) as Array<{ name?: string; dataTypes?: Array<{ name?: string }>; constants?: Array<{ name?: string; englishName?: string; description?: string; value?: string }> } | null>
        const names = new Set<string>()
        const constants: Array<{ name: string; englishName: string; description: string; value: string; libraryName: string }> = []
        const constSeen = new Set<string>()
        for (let i = 0; i < detailList.length; i++) {
          const detail = detailList[i]
          const libName = (detail?.name || loadedLibs[i]?.name || '支持库').trim()
          for (const dt of (detail?.dataTypes || [])) {
            const name = (dt?.name || '').trim()
            if (name) names.add(name)
          }

          for (const c of (detail?.constants || [])) {
            const name = (c?.name || '').trim()
            if (!name) continue
            const key = name
            if (constSeen.has(key)) continue
            constSeen.add(key)
            constants.push({
              name,
              englishName: (c?.englishName || '').trim(),
              description: (c?.description || '').trim(),
              value: (c?.value || '').trim(),
              libraryName: libName,
            })
          }
        }
        if (!cancelled) {
          setLibraryDataTypeNames([...names])
          setLibraryConstants(constants)
        }
      } catch {
        if (!cancelled) {
          setLibraryDataTypeNames([])
          setLibraryConstants([])
        }
      }
    }
    void loadLibraryMeta()
    window.api.on('library:loaded', loadLibraryMeta)
    return () => {
      cancelled = true
      window.api.off('library:loaded')
    }
  }, [])

  // 确保选中项始终可见
  useEffect(() => {
    if (acVisible && acListRef.current) {
      const selected = acListRef.current.children[acIndex] as HTMLElement | undefined
      selected?.scrollIntoView({ block: 'nearest' })
    }
  }, [acIndex, acVisible])

  /** 根据光标位置的"词"更新补全列表 */
  const updateCompletion = useCallback((val: string, cursorPos: number) => {
    if (!editCell) { setAcVisible(false); return }
    const isCodeEdit = editCell.cellIndex < 0
    const isClassNameCellEdit = editCell.cellIndex >= 0 && canUseClassNameCompletion(editCell.lineIndex, editCell.fieldIdx)
    const isTypeCellEdit = editCell.cellIndex >= 0 && canUseTypeCompletion(editCell.lineIndex, editCell.fieldIdx)
    if (!isCodeEdit && !isTypeCellEdit) { setAcVisible(false); return }

    // 引号内是自由文本输入，不弹补全窗（支持英文/中文引号）
    if (isCursorInsideQuotedText(val, cursorPos)) { setAcVisible(false); return }

    const {
      wordStart,
      word,
      hashMode,
      isMemberAccess,
    } = resolveCompletionWordContext(val, cursorPos)
    // 普通代码输入下，空词且不在成员访问上下文时不弹补全，避免无意义打扰。
    if (!isTypeCellEdit && !isClassNameCellEdit && !hashMode && word.length === 0 && !isMemberAccess) { setAcVisible(false); return }

    acWordStartRef.current = wordStart
    acPrefixRef.current = hashMode ? '#' : ''

    const defaultSourceList: CompletionItem[] = [
      ...BUILTIN_LITERAL_COMPLETION_ITEMS,
      ...userVarCompletionItemsRef.current,
      ...userSubCompletionItemsRef.current,
      ...dllCompletionItemsRef.current,
      ...allCommandsRef.current,
    ]

    const sourceList = selectCompletionSourceList({
      defaultSourceList,
      isClassNameCellEdit,
      isTypeCellEdit,
      hashMode,
      isMemberAccess,
      classNameItems: classNameCompletionItemsRef.current,
      typeItems: typeCompletionItemsRef.current,
      constantItems: constantCompletionItemsRef.current,
      libraryConstantItems: libraryConstantCompletionItemsRef.current,
      memberParams: {
        val,
        wordStart,
        userVarCompletionItems: userVarCompletionItemsRef.current,
        userVarTypeMap,
        windowControlTypeMap,
        windowUnits,
        customDataTypeFieldMap,
        memberCommands: memberCommandsRef.current,
        allCommands: allCommandsRef.current,
      },
    })

    const allowEmptyWord = isMemberAccess


    // 统一在工具层处理打分和排序，主流程只保留输入上下文编排。
    const fullMatches = buildCompletionMatches({
      sourceList,
      word,
      isClassNameCellEdit,
      isTypeCellEdit,
      hashMode,
      allowEmptyWord,
    })

    if (fullMatches.length === 0) { setAcVisible(false); return }

    const matches = paginateCompletionDisplayItems(fullMatches, AC_PAGE_SIZE)

    // 计算弹窗位置
    if (inputRef.current) {
      setAcPos(computeCompletionPopupPosition(inputRef.current, val, wordStart))
    }

    setAcItems(matches)
    setAcIndex(0)
    setAcVisible(true)
  }, [editCell, canUseTypeCompletion, canUseClassNameCompletion, userVarTypeMap, windowControlTypeMap, windowUnits, customDataTypeFieldMap])

  /** 应用补全项：替换当前输入词为命令名 */
  const applyCompletion = useCallback((displayItem: AcDisplayItem) => {
    if (displayItem.isMore) return
    const item = displayItem.cmd
    const wordStart = acWordStartRef.current
    const prefix = acPrefixRef.current
    const cursorPos = inputRef.current?.selectionStart ?? editVal.length
    const before = editVal.slice(0, prefix ? Math.max(0, wordStart - 1) : wordStart)
    const after = editVal.slice(cursorPos)

    const commandPool = [
      ...allCommandsRef.current,
      ...dllCompletionItemsRef.current,
      ...memberCommandsRef.current,
    ]
    const isCodeLineEdit = !!editCell && editCell.cellIndex === -1 && editCell.paramIdx === undefined
    const isCallable = isCodeLineEdit && (
      commandPool.some(c => c.name === item.name)
      || userSubNamesRef.current.has(item.name)
    )
    const leadingAfter = after.match(/^\s*/) ? (after.match(/^\s*/)?.[0] || '') : ''
    const afterNext = after.slice(leadingAfter.length, leadingAfter.length + 1)
    const hasCallAlready = afterNext === '(' || afterNext === '（'
    const canInsertCall = !hasCallAlready && !/^[\u4e00-\u9fa5A-Za-z0-9_.]$/.test(afterNext)

    let callSuffix = ''
    let caretExtra = 0
    if (isCallable && canInsertCall) {
      // 可调用项自动补全括号，减少手动输入成本。
      if (item.params.length > 0) {
        callSuffix = `（${item.params.map(p => p.optional ? '' : '').join(',')}）`
      } else {
        callSuffix = '（）'
      }
      caretExtra = 2
    }

    const normalizedAfter = isCodeLineEdit
      ? after.replace(/^[\s\u00A0]+(?=[,，\)\）])/, '')
      : after

    const newVal = before + prefix + item.name + callSuffix + normalizedAfter
    setEditVal(newVal)
    setAcVisible(false)
    setTimeout(() => {
      if (inputRef.current) {
        const newPos = before.length + prefix.length + item.name.length + caretExtra
        inputRef.current.selectionStart = newPos
        inputRef.current.selectionEnd = newPos
        inputRef.current.focus()
      }
    }, 0)
  }, [editVal, editCell])

  const expandMoreCompletion = useCallback((index: number) => {
    setAcItems(prev => {
      const item = prev[index]
      if (!item || !item.isMore || !item.hiddenItems || item.hiddenItems.length === 0) return prev
      return [...prev.slice(0, index), ...item.hiddenItems]
    })
    setAcIndex(index)
  }, [])

  const isFlowPasteDebugEnabled = useCallback((): boolean => {
    const g = globalThis as {
      __EYC_ACTION_DEBUG__?: boolean
      __EYC_FLOW_PASTE_DEBUG__?: boolean
      localStorage?: { getItem: (key: string) => string | null }
    }
    if (g.__EYC_ACTION_DEBUG__ === true) return true
    if (g.__EYC_FLOW_PASTE_DEBUG__ === true) return true
    try {
      if (g.localStorage?.getItem('__EYC_ACTION_DEBUG__') === '1') return true
      return g.localStorage?.getItem('__EYC_FLOW_PASTE_DEBUG__') === '1'
    } catch {
      return false
    }
  }, [])

  const debugFlowPaste = useCallback((stage: string, payload: Record<string, unknown>) => {
    if (!isFlowPasteDebugEnabled()) return
    console.debug('[EYC_FLOW_DEBUG]', stage, payload)
    const g = globalThis as {
      api?: {
        debug?: {
          logRendererEvent?: (payload: { source?: string; message: string; extra?: unknown }) => Promise<{ success: boolean }>
          logRendererError?: (payload: { source?: string; message: string; extra?: unknown }) => Promise<{ success: boolean }>
        }
      }
    }
    const evt = g.api?.debug?.logRendererEvent
    if (evt) {
      void evt({ source: 'flow-paste', message: stage, extra: payload }).catch(() => {
        const err = g.api?.debug?.logRendererError
        if (err) {
          void err({ source: 'flow-paste-fallback', message: stage, extra: payload })
        }
      })
      return
    }
    const err = g.api?.debug?.logRendererError
    if (err) {
      void err({ source: 'flow-paste-fallback', message: stage, extra: payload })
    }
  }, [isFlowPasteDebugEnabled])

  const normalizeFlowCommandName = useCallback((raw: string): string => {
    const trimmed = (raw || '').trim()
    if (!trimmed) return ''
    const token = trimmed
      .replace(/^[\u200B\u200C\u200D\u2060]+/, '')
      .split(/[\s(（]/)[0]
    if (token.startsWith('.')) return token.slice(1)
    return token
  }, [])

  const normalizeCodeLineInput = useCallback((raw: string): string => {
    if (!raw) return raw

    let next = raw
      .replace(/，/g, ',')
      .replace(/。/g, '.')
      .replace(/；/g, ';')
      .replace(/：/g, ':')
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      .replace(/【/g, '[')
      .replace(/】/g, ']')
      .replace(/｛/g, '{')
      .replace(/｝/g, '}')
      .replace(/＝/g, '=')
      .replace(/＋/g, '+')
      .replace(/－/g, '-')
      .replace(/＊/g, '*')
      .replace(/／/g, '/')
      .replace(/％/g, '%')
      .replace(/！/g, '!')
      .replace(/？/g, '?')
      .replace(/[“”]/g, '"')
      .replace(/、/g, ',')

    // 中文输入法里的单引号起始（‘/’）按注释前缀处理。
    next = next.replace(/^(\s*)[‘’]/, "$1'")

    // 统一为 `'<space>注释内容`，便于后续自动排版。
    next = next.replace(/^(\s*)'(?!\s|$)/, "$1' ")

    return next
  }, [])

  /** 代码行编辑结束时自动补全括号（格式化命令），返回 [主行, ...需要插入的后续行] */
  const formatCommandLine = useCallback((val: string, options?: { preferJudgeBranch?: boolean }): string[] => {
    const trimmed = val.trimStart()
    if (!trimmed || trimmed.startsWith("'")) return [val]

    // 赋值表达式：identifier = expr → 格式化运算符
    const assignM = trimmed.match(/^([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*)\s*(?:=(?!=)|＝)/)
    if (assignM && isKnownAssignmentTarget(assignM[1], userVarNamesRef.current)) {
      const indentLen = val.length - trimmed.length
      return [val.slice(0, indentLen) + formatOps(trimmed)]
    }

    const indent = val.length - trimmed.length
    const prefix = val.slice(0, indent)

    const allCmdPool = [
      ...allCommandsRef.current,
      ...dllCompletionItemsRef.current,
      ...memberCommandsRef.current,
    ]

    const resolveCmdToken = (token: string): { normalizedToken: string; lookupName: string; command: CompletionItem | null } => {
      const normalizedToken = token.replace(MEMBER_DELIMITER_REGEX, '.')
      const dotIndex = normalizedToken.lastIndexOf('.')
      if (dotIndex >= 0) {
        const objPrefix = normalizedToken.slice(0, dotIndex + 1)
        const memberName = normalizedToken.slice(dotIndex + 1)
        const cmd = allCmdPool.find(c => c.name === memberName || ((c.englishName || '').trim() === memberName)) || null
        return { normalizedToken, lookupName: cmd?.name || memberName, command: cmd }
      }

      const cmd = allCmdPool.find(c => c.name === normalizedToken || ((c.englishName || '').trim() === normalizedToken)) || null
      return { normalizedToken, lookupName: cmd?.name || normalizedToken, command: cmd }
    }

    // 提取命令名（支持“命令名”或“命令名 (...)”两种输入）
    const rawCmdToken = normalizeFlowCommandName(trimmed)
    const resolved = resolveCmdToken(rawCmdToken)
    const cmdName = resolved.normalizedToken
    const lookupCmdName = resolved.lookupName
    if (!/^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*$/.test(cmdName)) return [val]

    if (options?.preferJudgeBranch && cmdName === '判断') {
      const parenRange = getOuterParenRange(trimmed)
      if (parenRange) {
        const argText = trimmed.slice(parenRange.start + 1, parenRange.end).trim()
        return [prefix + '判断（' + argText + '）']
      }
      const cmd = resolved.command || allCmdPool.find(c => c.name === lookupCmdName)
      if (!cmd || cmd.params.length === 0) return [prefix + '判断（）']
      const paramSlots = cmd.params.map(p => p.optional ? '' : '').join(',')
      return [prefix + '判断（' + paramSlots + '）']
    }

    // 流程控制命令自动补齐后续行
    const autoLines = FLOW_AUTO_COMPLETE[cmdName]
    if (autoLines) {
      const flowStartCmdName = cmdName === '判断' ? '判断开始' : cmdName
      const cmd = resolved.command || allCmdPool.find(c => c.name === lookupCmdName)
      // 命令本身和内部代码行都缩进4空格（两个汉字宽度）给流程线留空间
      const innerPrefix = prefix + '    '
      let mainLine: string
      const parenRange = getOuterParenRange(trimmed)
      if (parenRange) {
        // 已输入括号时尽量保留用户输入参数内容，再做流程补齐
        const argText = trimmed.slice(parenRange.start + 1, parenRange.end).trim()
        mainLine = innerPrefix + flowStartCmdName + '（' + argText + '）'
      } else if (cmd && cmd.params.length > 0) {
        const paramSlots = cmd.params.map(p => p.optional ? '' : '').join(',')
        mainLine = innerPrefix + flowStartCmdName + '（' + paramSlots + '）'
      } else {
        mainLine = innerPrefix + flowStartCmdName + '（）'
      }
      // 自动插入的分支/结束行
      const extra = autoLines.map(kw => {
        if (kw === null) return ''
        if (FLOW_KW.has(kw)) return innerPrefix + kw
        // 流程尾命令也需要括号（如 计次循环尾）
        const tailCmd = allCommandsRef.current.find(c => c.name === kw)
        if (tailCmd && tailCmd.params.length > 0) {
          const tailSlots = tailCmd.params.map(p => p.optional ? '' : '').join(',')
          return innerPrefix + kw + '（' + tailSlots + '）'
        }
        return innerPrefix + kw + '（）'
      })
      return [mainLine, ...extra]
    }

    // 普通命令：仅对“裸命令名”自动补括号
    const m = trimmed.match(/^([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*)\s*$/)
    if (!m) return [val]

    // 流程关键字（非自动展开起始命令）不做普通命令式补括号，
    // 否则嵌套场景里 `如果结束` 会被误格式化成 `如果结束（）`。
    if (FLOW_KW.has(cmdName) && !FLOW_AUTO_COMPLETE[cmdName]) {
      return [prefix + cmdName]
    }

    if (trimmed.startsWith('.')) return [val]
    const cmd = resolved.command || allCmdPool.find(c => c.name === lookupCmdName)
    if (!cmd) {
      if (userSubNamesRef.current.has(cmdName)) {
        return [prefix + cmdName + '（）']
      }
      return [val]
    }

    if (cmd.params.length === 0) {
      return [prefix + cmdName + '（）']
    }
    const paramSlots = cmd.params.map(p => p.optional ? '' : '').join(',')
    return [prefix + cmdName + '（' + paramSlots + '）']
  }, [])

  const shouldPreferJudgeBranchAtLine = useCallback((lineIndex: number): boolean => {
    try {
      const latestLines = prevRef.current.split('\n')
      const safeLine = (index: number): string | null => {
        if (index < 0 || index >= latestLines.length) return null
        return latestLines[index]
      }
      const indentLenOf = (line: string | null): number => {
        if (!line) return 0
        return line.length - line.trimStart().length
      }
      const nearestFlowUp = (() => {
        for (let i = lineIndex; i >= 0; i--) {
          const kw = extractFlowKw(latestLines[i] || '')
          if (kw) return { line: i, kw }
        }
        return null
      })()
      const nearestFlowDown = (() => {
        for (let i = lineIndex; i < latestLines.length; i++) {
          const kw = extractFlowKw(latestLines[i] || '')
          if (kw) return { line: i, kw }
        }
        return null
      })()
      const currentLineKw = normalizeFlowCommandName((latestLines[lineIndex] || '').trim())
      const prevLineText = safeLine(lineIndex - 1)
      const nextLineText = safeLine(lineIndex + 1)
      const prevKw = prevLineText ? extractFlowKw(prevLineText) : null
      const nextKw = nextLineText ? extractFlowKw(nextLineText) : null
      const currentIndentLen = indentLenOf(safeLine(lineIndex))
      const prevIndentLen = indentLenOf(prevLineText)
      const nextIndentLen = indentLenOf(nextLineText)
      const prevNonEmpty = (() => {
        for (let i = lineIndex - 1; i >= 0; i--) {
          const line = latestLines[i] || ''
          if (!line.trim()) continue
          return { lineIndex: i, text: line, kw: extractFlowKw(line), indentLen: indentLenOf(line) }
        }
        return null
      })()
      const nextNonEmpty = (() => {
        for (let i = lineIndex + 1; i < latestLines.length; i++) {
          const line = latestLines[i] || ''
          if (!line.trim()) continue
          return { lineIndex: i, text: line, kw: extractFlowKw(line), indentLen: indentLenOf(line) }
        }
        return null
      })()

      // 兜底：用户在“默认 与 判断结束”之间直接键入“判断”时，
      // 当前行会先被当成新起始行，导致 around 判空。此处按相邻结构强制命中。
      if (
        currentLineKw === '判断'
        && prevNonEmpty?.kw === '默认'
        && nextNonEmpty?.kw === '判断结束'
        && prevNonEmpty.indentLen === nextNonEmpty.indentLen
        && currentIndentLen >= prevNonEmpty.indentLen
      ) {
        debugFlowPaste('judge-branch:check', {
          lineIndex,
          result: true,
          reason: 'adjacent-default-end-heuristic',
          source: 'adjacent-heuristic',
          currentLine: safeLine(lineIndex),
          prevLine: prevLineText,
          nextLine: nextLineText,
          currentLineKw,
          prevKw,
          nextKw,
          prevNonEmptyLine: prevNonEmpty.lineIndex,
          prevNonEmptyKw: prevNonEmpty.kw,
          nextNonEmptyLine: nextNonEmpty.lineIndex,
          nextNonEmptyKw: nextNonEmpty.kw,
        })
        return true
      }

      const evaluateAround = (aroundInfo: { cmdLine: number; sections: Array<{ char: string | null; startLine: number; endLine: number; count: number }>; sectionIdx: number } | null, source: 'direct' | 'fallback-prev'): boolean => {
        if (!aroundInfo) return false
        const cmdKw = extractFlowKw(latestLines[aroundInfo.cmdLine] || '')
        const sectionsSummary = aroundInfo.sections.map((section, index) => ({
          idx: index,
          char: section?.char ?? null,
          startLine: section?.startLine ?? null,
        }))

        if (cmdKw !== '判断开始' && cmdKw !== '判断') {
          debugFlowPaste('judge-branch:check', {
            lineIndex,
            result: false,
            reason: 'not-judge-structure',
            source,
            cmdLine: aroundInfo.cmdLine,
            cmdKw,
            sectionsSummary,
          })
          return false
        }

        const targetSectionIdx = aroundInfo.sections.findIndex(section => lineIndex >= section.startLine && lineIndex <= section.endLine)
        if (targetSectionIdx < 0) {
          debugFlowPaste('judge-branch:check', {
            lineIndex,
            result: false,
            reason: 'target-line-not-in-section',
            source,
            cmdLine: aroundInfo.cmdLine,
            cmdKw,
            sectionsSummary,
          })
          return false
        }

        const section = aroundInfo.sections[targetSectionIdx]
        const prevSection = aroundInfo.sections[targetSectionIdx - 1]
        const isDefaultBodyFirstLine = section.char === null && prevSection?.char === '默认' && section.startLine === lineIndex
        debugFlowPaste('judge-branch:check', {
          lineIndex,
          result: isDefaultBodyFirstLine,
          reason: isDefaultBodyFirstLine ? 'default-body-first-line' : 'section-mismatch',
          source,
          cmdLine: aroundInfo.cmdLine,
          cmdKw,
          sectionIdx: targetSectionIdx,
          sectionChar: section.char,
          sectionStartLine: section.startLine,
          prevSectionChar: prevSection?.char ?? null,
          sectionsSummary,
        })
        return isDefaultBodyFirstLine
      }

      const around = getFlowStructureAround(latestLines, lineIndex)
      if (!around) {
        // 当前行正在输入“判断”时，可能被结构搜索误当作新的 cmdLine，导致 around 为空。
        // 回退到上一行重新找外层结构，以判定“默认后首行”特例。
        if (currentLineKw === '判断' && lineIndex > 0) {
          const fallbackAround = getFlowStructureAround(latestLines, lineIndex - 1)
          if (evaluateAround(fallbackAround, 'fallback-prev')) {
            return true
          }
        }
        debugFlowPaste('judge-branch:check', {
          lineIndex,
          result: false,
          reason: 'no-structure-around',
          currentLine: safeLine(lineIndex),
          prevLine: prevLineText,
          nextLine: nextLineText,
          nearestFlowUpLine: nearestFlowUp?.line ?? null,
          nearestFlowUpKw: nearestFlowUp?.kw ?? null,
          nearestFlowDownLine: nearestFlowDown?.line ?? null,
          nearestFlowDownKw: nearestFlowDown?.kw ?? null,
          currentLineKw,
        })
        return false
      }
      return evaluateAround(around, 'direct')
    } catch {
      debugFlowPaste('judge-branch:check', {
        lineIndex,
        result: false,
        reason: 'exception',
      })
      return false
    }
  }, [debugFlowPaste])

  const normalizeNonFlowCommandIndent = useCallback((text: string): string => {
    if (isResourceTableDoc) return text
    const linesForNormalize = text.split('\n')
    if (linesForNormalize.length === 0) return text
    if (linesForNormalize.length > 1200) return text

    let flowMap = new Map<number, FlowSegment[]>()
    try {
      const normalizeBlocks = buildBlocks(text, isClassModule, isResourceTableDoc)
      flowMap = computeFlowLines(normalizeBlocks).map
    } catch {
      // ignore parse/flow errors and fallback to conservative line-based normalization
    }

    let changed = false
    for (let i = 0; i < linesForNormalize.length; i++) {
      const line = linesForNormalize[i]
      if (!/^[ \t]+/.test(line)) continue

      const trimmed = line.replace(/[\r\t]/g, '').trim()
      if (!trimmed) continue
      if (trimmed.startsWith('.')) continue
      if (trimmed.startsWith("'")) continue
      if ((flowMap.get(i)?.length || 0) > 0) continue

      const deindented = line.replace(/^[ \t]+/, '')
      if (deindented !== line) {
        linesForNormalize[i] = deindented
        changed = true
      }
    }

    return changed ? linesForNormalize.join('\n') : text
  }, [isClassModule, isResourceTableDoc])

  useEffect(() => {
    const normalizedValue = normalizeNonFlowCommandIndent(value)
    if (normalizedValue !== prevRef.current) {
      setCurrentText(normalizedValue)
      prevRef.current = normalizedValue
    }
    if (normalizedValue !== value) {
      onChange(normalizedValue)
    }
  }, [value, normalizeNonFlowCommandIndent, onChange])

  const lines = useMemo(() => currentText.split('\n'), [currentText])
  const parsedLines = parsedLinesForCurrentText

  const resolveStickyTableHeader = useCallback((): {
    lineIndex: number
    nextStartLine: number | null
    colCount: number
    rows: Array<{
      lineIndex: number
      isHeader: boolean
      cells: Array<{ text: string; cls: string; colSpan?: number; align?: string; fieldIdx?: number; sliceField?: boolean }>
    }>
  } | null => {
    if (!shouldFreezeTableHeader) return null
    const wrapper = wrapperRef.current
    if (!wrapper) return null

    const metas = subTableMetaRef.current
    if (metas.length === 0) return null

    // 缓存每个子程序起始行在滚动容器内的绝对 top，滚动时仅做数字比较，
    // 避免每帧 querySelector + getBoundingClientRect 带来的切换卡顿。
    const topCache = stickyStartTopByLineRef.current
    if (topCache.size !== metas.length) {
      topCache.clear()
      const wrapperRect = wrapper.getBoundingClientRect()
      const scrollTop = wrapper.scrollTop
      for (const meta of metas) {
        const el = wrapper.querySelector<HTMLElement>(`[data-line-index="${meta.startLine}"]`)
        if (!el) continue
        const startTop = el.getBoundingClientRect().top - wrapperRect.top + scrollTop
        topCache.set(meta.startLine, startTop)
      }
    }

    const currentTop = wrapper.scrollTop + 0.5
    type MetaItem = typeof metas[number]
    let activeMeta: MetaItem | null = null
    for (const meta of metas) {
      const startTop = topCache.get(meta.startLine)
      if (startTop == null) continue
      if (startTop <= currentTop) {
        activeMeta = meta
      } else {
        // metas 按文件顺序排列，后续子程序一定位于更下方
        break
      }
    }

    if (!activeMeta) return null
    return {
      lineIndex: activeMeta.startLine,
      nextStartLine: activeMeta.nextStartLine,
      colCount: activeMeta.colCount,
      rows: activeMeta.rows,
    }
  }, [shouldFreezeTableHeader])

  const computeStickyPushOffset = useCallback((state: {
    nextStartLine: number | null
  } | null): number => {
    if (!state || state.nextStartLine == null) return 0
    const wrapper = wrapperRef.current
    const frozenRow = stickyScopeRowRef.current
    if (!wrapper || !frozenRow) return 0
    const nextEl = wrapper.querySelector<HTMLElement>(`[data-line-index="${state.nextStartLine}"]`)
    if (!nextEl) return 0
    const frozenHeight = Math.max(frozenRow.offsetHeight, 0)
    if (frozenHeight <= 0) return 0
    // 用 getBoundingClientRect 相对 wrapper 视口顶计算，避免 <tr>.offsetTop 的 offsetParent 不稳定问题。
    const nextTopInViewport = nextEl.getBoundingClientRect().top - wrapper.getBoundingClientRect().top
    return Math.min(0, nextTopInViewport - frozenHeight)
  }, [])

  const scheduleStickyScopeUpdate = useCallback(() => {
    if (stickyScopeRafRef.current != null) return
    stickyScopeRafRef.current = window.requestAnimationFrame(() => {
      stickyScopeRafRef.current = null
      const next = resolveStickyTableHeader()
      setStickySubTable(prev => {
        if (!prev && !next) return prev
        if (!prev || !next) return next
        if (prev.lineIndex === next.lineIndex && prev.nextStartLine === next.nextStartLine && prev.colCount === next.colCount) {
          return prev
        }
        return next
      })
      setStickyPushOffsetPx(computeStickyPushOffset(next))
    })
  }, [computeStickyPushOffset, resolveStickyTableHeader])

  useEffect(() => {
    if (!shouldFreezeTableHeader) {
      stickyStartTopByLineRef.current.clear()
      setStickySubTable(null)
      setStickyPushOffsetPx(0)
      return
    }
    stickyStartTopByLineRef.current.clear()
    scheduleStickyScopeUpdate()
  }, [scheduleStickyScopeUpdate, currentText, shouldFreezeTableHeader])

  useEffect(() => {
    if (!shouldFreezeTableHeader || !stickySubTable) {
      setStickyPushOffsetPx(0)
      return
    }
    const raf = window.requestAnimationFrame(() => {
      setStickyPushOffsetPx(computeStickyPushOffset(stickySubTable))
    })
    return () => window.cancelAnimationFrame(raf)
  }, [computeStickyPushOffset, shouldFreezeTableHeader, stickySubTable])

  useEffect(() => {
    if (!shouldFreezeTableHeader) return
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const onScroll = (): void => scheduleStickyScopeUpdate()
    const onResize = (): void => {
      stickyStartTopByLineRef.current.clear()
      scheduleStickyScopeUpdate()
    }

    wrapper.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)

    let resizeObserver: ResizeObserver | null = null
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(() => {
        stickyStartTopByLineRef.current.clear()
        scheduleStickyScopeUpdate()
      })
      resizeObserver.observe(wrapper)
    }

    return () => {
      if (stickyScopeRafRef.current != null) {
        window.cancelAnimationFrame(stickyScopeRafRef.current)
        stickyScopeRafRef.current = null
      }
      wrapper.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      resizeObserver?.disconnect()
    }
  }, [scheduleStickyScopeUpdate, shouldFreezeTableHeader])

  const findOwnerSubName = useCallback((lineIndex: number): string => {
    for (let i = lineIndex; i >= 0; i--) {
      const ln = parsedLines[i]
      if (ln?.type === 'sub') return (ln.fields[0] || '').trim()
    }
    return ''
  }, [parsedLines])

  const findOwnerAssemblyName = useCallback((lineIndex: number): string => {
    for (let i = lineIndex; i >= 0; i--) {
      const ln = parsedLines[i]
      if (ln?.type === 'assembly') return (ln.fields[0] || '').trim()
    }
    return ''
  }, [parsedLines])

  const handleTableCellHint = useCallback((lineIndex: number, fieldIdx: number, cellText: string): void => {
    if (!onCommandClick || fieldIdx < 0) return
    const ln = parsedLines[lineIndex]
    if (!ln) return
    const val = (cellText || '').replace(/\u00A0/g, '').trim()
    if (!val) return

    if (fieldIdx === 1 && (ln.type === 'subParam' || ln.type === 'localVar' || ln.type === 'globalVar' || ln.type === 'assemblyVar' || ln.type === 'dataTypeMember' || ln.type === 'dll' || ln.type === 'sub' || ln.type === 'assembly')) {
      onCommandClick(`__TYPE__:${val}`)
      return
    }

    if (fieldIdx === 0 && ln.type === 'subParam') {
      const paramName = val
      const paramType = (ln.fields[1] || '').trim()
      const ownerSub = findOwnerSubName(lineIndex)
      onCommandClick(`__PARAM__:${paramName}:${paramType}:${ownerSub}`)
      return
    }

    if (fieldIdx === 0 && ln.type === 'sub') {
      const ownerAssembly = findOwnerAssemblyName(lineIndex)
      onCommandClick(`__SUBDECL__:${val}:${ownerAssembly}`)
    }
  }, [findOwnerAssemblyName, findOwnerSubName, onCommandClick, parsedLines])

  const { blocks, flowLines } = useEditorBlocksModel({
    text: currentText,
    isClassModule,
    isResourceTableDoc,
    suppressHeadPreview: !!editCell,
  })

  const visibleBlocks = useMemo(() => {
    return blocks.filter((blk) => {
      if (blk.kind !== 'codeline' || !blk.codeLine) return true
      const kw = extractFlowKw(blk.codeLine)
      return !(kw && TABLE_MODE_HIDDEN_FLOW_COMMANDS.has(kw))
    })
  }, [blocks])

  const displayFlowLines = useMemo(() => {
    const map = new Map<number, FlowSegment[]>()
    for (const [lineIndex, segs] of flowLines.map.entries()) {
      map.set(lineIndex, segs.map(seg => ({ ...seg })))
    }

    const visibleCodeLineSet = new Set<number>()
    for (const blk of visibleBlocks) {
      if (blk.kind === 'codeline') visibleCodeLineSet.add(blk.lineIndex)
    }

    const maxLineIndex = Math.max(lines.length - 1, 0)

    const findPrevVisibleCodeLine = (from: number): number | null => {
      for (let li = from; li >= 0; li--) {
        if (visibleCodeLineSet.has(li)) return li
      }
      return null
    }

    const findNextVisibleCodeLine = (from: number): number | null => {
      for (let li = from; li <= maxLineIndex; li++) {
        if (visibleCodeLineSet.has(li)) return li
      }
      return null
    }

    const hasDepthSegAtLine = (lineIndex: number, depth: number): boolean => {
      const segs = map.get(lineIndex) || []
      return segs.some(seg => seg.depth === depth)
    }

    const findPrevVisibleCodeLineAtDepth = (from: number, depth: number): number | null => {
      for (let li = from; li >= 0; li--) {
        if (!visibleCodeLineSet.has(li)) continue
        if (hasDepthSegAtLine(li, depth)) return li
      }
      return null
    }

    const findNextVisibleCodeLineAtDepth = (from: number, depth: number, endExclusive?: number): number | null => {
      const limit = endExclusive == null ? maxLineIndex + 1 : Math.min(endExclusive, maxLineIndex + 1)
      for (let li = from; li < limit; li++) {
        if (!visibleCodeLineSet.has(li)) continue
        if (hasDepthSegAtLine(li, depth)) return li
      }
      return null
    }

    for (const blk of blocks) {
      if (blk.kind !== 'codeline' || !blk.codeLine) continue
      const kw = extractFlowKw(blk.codeLine)
      if (kw !== '否则' && kw !== '默认') continue
      if (visibleCodeLineSet.has(blk.lineIndex)) continue

      const hiddenLineSegs = map.get(blk.lineIndex) || []
      const branchSegs = hiddenLineSegs.filter(seg => seg.type === 'branch')
      if (branchSegs.length === 0) continue

      const prevVisibleFallback = findPrevVisibleCodeLine(blk.lineIndex - 1)
      const nextVisibleFallback = findNextVisibleCodeLine(blk.lineIndex + 1)

      for (const branchSeg of branchSegs) {
        let flowEndLine: number | null = null
        for (let li = blk.lineIndex + 1; li <= maxLineIndex; li++) {
          const segsAtLine = map.get(li) || []
          if (segsAtLine.some(seg => seg.depth === branchSeg.depth && seg.type === 'end')) {
            flowEndLine = li
            break
          }
        }

        const prevVisibleLine = findPrevVisibleCodeLineAtDepth(blk.lineIndex - 1, branchSeg.depth) ?? prevVisibleFallback
        const nextVisibleLine = findNextVisibleCodeLineAtDepth(blk.lineIndex + 1, branchSeg.depth, flowEndLine ?? undefined) ?? nextVisibleFallback

        let lastVisibleFlowLine: number | null = null
        if (flowEndLine != null) {
          for (let li = flowEndLine - 1; li >= blk.lineIndex + 1; li--) {
            if (visibleCodeLineSet.has(li) && hasDepthSegAtLine(li, branchSeg.depth)) {
              lastVisibleFlowLine = li
              break
            }
          }
        }

        // 隐藏分支命令后：把内侧起始横线锚到“否则/默认”的上一条可见命令行。
        if (prevVisibleLine != null) {
          const prevSegs = map.get(prevVisibleLine) || []
          const sameDepth = prevSegs.find(seg => seg.depth === branchSeg.depth)
          if (sameDepth) {
            sameDepth.hasInnerLink = true
          } else {
            prevSegs.push({
              depth: branchSeg.depth,
              type: 'through',
              isLoop: branchSeg.isLoop,
              flowKind: branchSeg.flowKind,
              hasInnerLink: true,
            })
          }
          map.set(prevVisibleLine, prevSegs)
        }

        // 内侧线延续：从“否则/默认”上一条可见命令向下到该流程块最后一条可见命令，并在末端加下箭头。
        // 若该流程末端紧接同深度新流程（end.hasNextFlow），则末端的下箭头改为“连通”而不绘制三角箭头。
        let endConnected = false
        if (flowEndLine != null) {
          const endSegsAtFlowEnd = map.get(flowEndLine) || []
          endConnected = endSegsAtFlowEnd.some(seg => seg.depth === branchSeg.depth && seg.type === 'end' && !!seg.hasNextFlow)
        }
        if (prevVisibleLine != null && lastVisibleFlowLine != null && lastVisibleFlowLine >= prevVisibleLine) {
          for (let li = prevVisibleLine; li <= lastVisibleFlowLine; li++) {
            if (!visibleCodeLineSet.has(li)) continue
            const segsAtLine = map.get(li) || []
            const sameDepthSegs = segsAtLine.filter(seg => seg.depth === branchSeg.depth)
            if (sameDepthSegs.length > 0) {
              for (const sameDepth of sameDepthSegs) {
                sameDepth.hasInnerVert = true
                if (li > prevVisibleLine) sameDepth.hasInnerVertFromAbove = true
                if (li === lastVisibleFlowLine) {
                  sameDepth.hasInnerVertEnd = true
                  if (endConnected) sameDepth.hasInnerVertEndConnected = true
                }
              }
            } else {
              segsAtLine.push({
                depth: branchSeg.depth,
                type: 'through',
                isLoop: branchSeg.isLoop,
                flowKind: branchSeg.flowKind,
                hasInnerVert: true,
                hasInnerVertFromAbove: li > prevVisibleLine ? true : undefined,
                hasInnerVertEnd: li === lastVisibleFlowLine,
                hasInnerVertEndConnected: li === lastVisibleFlowLine && endConnected ? true : undefined,
              })
            }
            map.set(li, segsAtLine)
          }
        }

        // 隐藏分支命令后：把外侧结束横线锚到“否则/默认”的下一条可见命令行。
        if (nextVisibleLine != null) {
          const nextSegs = map.get(nextVisibleLine) || []
          nextSegs.push({
            depth: branchSeg.depth,
            type: 'branch',
            isLoop: branchSeg.isLoop,
            flowKind: branchSeg.flowKind,
          })
          map.set(nextVisibleLine, nextSegs)
        }

        // 外侧线只到结束横线：否则/默认区后续可见行不再绘制该深度的外侧竖线。
        if (nextVisibleLine != null && lastVisibleFlowLine != null && lastVisibleFlowLine > nextVisibleLine) {
          // 若同深度在结束横线处（或其后）开启了新流程，则 suppress 只应作用到新流程开始之前。
          let suppressEndLine = lastVisibleFlowLine
          for (let li = nextVisibleLine; li <= lastVisibleFlowLine; li++) {
            if (!visibleCodeLineSet.has(li)) continue
            const segsAtLine = map.get(li) || []
            if (segsAtLine.some(seg => seg.depth === branchSeg.depth && seg.type === 'start')) {
              suppressEndLine = li - 1
              break
            }
          }

          for (let li = nextVisibleLine + 1; li <= suppressEndLine; li++) {
            if (!visibleCodeLineSet.has(li)) continue
            const segsAtLine = map.get(li) || []
            const sameDepth = segsAtLine.find(seg => seg.depth === branchSeg.depth)
            if (sameDepth) {
              if (sameDepth.type === 'through') {
                sameDepth.suppressOuter = true
              }
            } else {
              segsAtLine.push({
                depth: branchSeg.depth,
                type: 'through',
                isLoop: branchSeg.isLoop,
                flowKind: branchSeg.flowKind,
                suppressOuter: true,
              })
            }
            map.set(li, segsAtLine)
          }
        }
      }
    }

    // suppressOuter 仅对 through 生效，清理其他类型上的残留标记，避免 start/branch 外侧线被误隐藏。
    for (const [lineIndex, segsAtLine] of map.entries()) {
      let changed = false
      const normalized = segsAtLine.map(seg => {
        if (seg.type !== 'through' && seg.suppressOuter) {
          changed = true
          const { suppressOuter: _drop, ...rest } = seg
          return rest
        }
        return seg
      })
      if (changed) map.set(lineIndex, normalized)
    }

    const hasEndBetweenLinesAtDepth = (fromExclusive: number, toExclusive: number, depth: number): boolean => {
      const start = Math.max(0, fromExclusive + 1)
      const end = Math.min(maxLineIndex, toExclusive - 1)
      if (end < start) return false
      for (let li = start; li <= end; li++) {
        const segs = map.get(li) || []
        if (segs.some(seg => seg.depth === depth && seg.type === 'end')) return true
      }
      return false
    }

    // hasPrevFlowEnd 在隐藏命令后的重映射中可能失效：
    // 若前一可见行不是 end，但两行之间存在被隐藏的同深度 end（如“判断结束”），也应保留。
    for (const [lineIndex, segsAtLine] of map.entries()) {
      let changed = false
      const prevVisibleLine = findPrevVisibleCodeLine(lineIndex - 1)
      const prevSegs = prevVisibleLine != null ? (map.get(prevVisibleLine) || []) : []
      const normalized = segsAtLine.map(seg => {
        if (seg.type !== 'start' || !seg.hasPrevFlowEnd) return seg
        const hasRealPrevEnd = prevSegs.some(prev => prev.depth === seg.depth && prev.type === 'end')
        if (hasRealPrevEnd) return seg
        const hasHiddenPrevEnd = hasEndBetweenLinesAtDepth(prevVisibleLine ?? -1, lineIndex, seg.depth)
        if (hasHiddenPrevEnd) return seg
        changed = true
        const { hasPrevFlowEnd: _drop, ...rest } = seg
        return rest
      })
      if (changed) map.set(lineIndex, normalized)
    }

    // 判断命令同一行若同时出现 branch+start，视为同流程区衔接：
    // 保证下一可见行存在同深度 through，且不抑制外侧线。
    for (const [lineIndex, segsAtLine] of map.entries()) {
      const judgeStarts = segsAtLine.filter(seg => seg.type === 'start' && seg.flowKind === 'judge')
      if (judgeStarts.length === 0) continue

      for (const startSeg of judgeStarts) {
        const hasJudgeBranchSameDepth = segsAtLine.some(seg => (
          seg.type === 'branch' &&
          seg.depth === startSeg.depth &&
          seg.flowKind === 'judge'
        ))
        if (!hasJudgeBranchSameDepth) continue

        // “判断”行同时承担 branch+start 时：
        // 内侧起始横线应锚到“判断”上一可见行，并让内侧竖线从该行向下贯穿“判断”行。
        const prevVisibleLineAtDepth = findPrevVisibleCodeLineAtDepth(lineIndex - 1, startSeg.depth)
          ?? findPrevVisibleCodeLine(lineIndex - 1)
        if (prevVisibleLineAtDepth != null && prevVisibleLineAtDepth <= lineIndex) {
          const prevSegs = map.get(prevVisibleLineAtDepth) || []
          const prevSameDepthSegs = prevSegs.filter(seg => seg.depth === startSeg.depth)
          if (prevSameDepthSegs.length > 0) {
            for (const seg of prevSameDepthSegs) seg.hasInnerLink = true
          } else {
            prevSegs.push({
              depth: startSeg.depth,
              type: 'through',
              isLoop: startSeg.isLoop,
              flowKind: startSeg.flowKind,
              hasInnerLink: true,
            })
          }
          map.set(prevVisibleLineAtDepth, prevSegs)

          for (let li = prevVisibleLineAtDepth; li <= lineIndex; li++) {
            if (!visibleCodeLineSet.has(li)) continue
            const segsAtLi = map.get(li) || []
            const sameDepthSegs = segsAtLi.filter(seg => seg.depth === startSeg.depth)
            if (sameDepthSegs.length > 0) {
              for (const seg of sameDepthSegs) {
                seg.hasInnerVert = true
                if (li > prevVisibleLineAtDepth) seg.hasInnerVertFromAbove = true
              }
            } else {
              segsAtLi.push({
                depth: startSeg.depth,
                type: 'through',
                isLoop: startSeg.isLoop,
                flowKind: startSeg.flowKind,
                hasInnerVert: true,
                hasInnerVertFromAbove: li > prevVisibleLineAtDepth ? true : undefined,
              })
            }
            map.set(li, segsAtLi)
          }
        }

        const nextVisibleLine = findNextVisibleCodeLine(lineIndex + 1)
        if (nextVisibleLine == null) continue

        const nextSegs = map.get(nextVisibleLine) || []
        const sameDepth = nextSegs.find(seg => seg.depth === startSeg.depth)
        if (!sameDepth) {
          nextSegs.push({
            depth: startSeg.depth,
            type: 'through',
            isLoop: startSeg.isLoop,
            flowKind: startSeg.flowKind,
          })
          map.set(nextVisibleLine, nextSegs)
          continue
        }

        if (sameDepth.type === 'through' && sameDepth.suppressOuter) {
          const { suppressOuter: _drop, ...rest } = sameDepth
          const nextNormalized = nextSegs.map(seg => seg === sameDepth ? rest : seg)
          map.set(nextVisibleLine, nextNormalized)
        }
      }
    }

    // 隐藏“如果真结束”后：将结束锚到上一条可见同深度命令行，保留结束向下三角箭头。
    for (const blk of blocks) {
      if (blk.kind !== 'codeline' || !blk.codeLine) continue
      const kw = extractFlowKw(blk.codeLine)
      if (kw !== '如果真结束') continue
      if (visibleCodeLineSet.has(blk.lineIndex)) continue

      const hiddenEndSegs = (map.get(blk.lineIndex) || []).filter(seg => seg.type === 'end' && seg.flowKind === 'ifTrue')
      if (hiddenEndSegs.length === 0) continue

      for (const endSeg of hiddenEndSegs) {
        const prevVisibleLine = findPrevVisibleCodeLineAtDepth(blk.lineIndex - 1, endSeg.depth)
        if (prevVisibleLine == null) continue

        const prevSegs = map.get(prevVisibleLine) || []
        const sameDepthSeg = prevSegs.find(seg => seg.depth === endSeg.depth)
        if (sameDepthSeg) {
          sameDepthSeg.endArrowOnly = true
        } else {
          prevSegs.push({
            depth: endSeg.depth,
            type: 'through',
            isLoop: endSeg.isLoop,
            flowKind: endSeg.flowKind,
            endArrowOnly: true,
          })
        }
        map.set(prevVisibleLine, prevSegs)
      }
    }

    // 自动推导“从上方连下来的内侧竖线”：
    // 若同深度上一可见行已存在且仍延续内侧竖线，则当前行应显示内侧竖线的上半段。
    for (const [lineIndex, segsAtLine] of map.entries()) {
      let changed = false
      const normalized = segsAtLine.map(seg => {
        if (!seg.hasInnerVert) return seg
        const prevVisibleAtDepth = findPrevVisibleCodeLineAtDepth(lineIndex - 1, seg.depth)
        if (prevVisibleAtDepth == null) return seg
        const prevSegs = map.get(prevVisibleAtDepth) || []
        const hasPrevInnerContinuation = prevSegs.some(prev => (
          prev.depth === seg.depth &&
          !!prev.hasInnerVert &&
          !prev.hasInnerVertEnd
        ))
        if (!hasPrevInnerContinuation || seg.hasInnerVertFromAbove) return seg
        changed = true
        return { ...seg, hasInnerVertFromAbove: true }
      })
      if (changed) map.set(lineIndex, normalized)
    }

    return {
      map,
      maxDepth: flowLines.maxDepth,
    }
  }, [blocks, flowLines, lines.length, visibleBlocks])

  blocksRef.current = visibleBlocks

  const stickySubTableMeta = useMemo(() => {
    type StickyMeta = typeof subTableMetaRef.current[number]
    const subTables = visibleBlocks.filter((blk): blk is RenderBlock & { kind: 'table'; tableType: 'sub' } => blk.kind === 'table' && blk.tableType === 'sub')
    const starts = subTables.map(blk => {
      const dataLines = Array.from(new Set(
        blk.rows
          .filter(row => !row.isHeader)
          .map(row => row.lineIndex)
          .filter(li => Number.isFinite(li) && li >= 0)
      ))
      return dataLines.length > 0 ? Math.min(...dataLines) : -1
    })

    const list: StickyMeta[] = []
    for (let idx = 0; idx < subTables.length; idx++) {
      const blk = subTables[idx]
      const startLine = starts[idx]
      if (startLine < 0) continue

      const nextStartLine = starts.slice(idx + 1).find(li => li >= 0) ?? null
      const rows: StickyMeta['rows'] = blk.rows.map(row => ({
        lineIndex: row.lineIndex,
        isHeader: !!row.isHeader,
        cells: row.cells.map(cell => ({
          text: cell.text,
          cls: cell.cls,
          colSpan: cell.colSpan,
          align: cell.align,
          fieldIdx: cell.fieldIdx,
          sliceField: cell.sliceField,
        })),
      }))
      if (rows.length === 0) continue

      const colCount = Math.max(
        ...rows.map(row => row.cells.reduce((sum, cell) => sum + (cell.colSpan || 1), 0)),
        1,
      )

      list.push({
        startLine,
        nextStartLine,
        colCount,
        rows,
      })
    }
    return list
  }, [visibleBlocks])

  subTableMetaRef.current = stickySubTableMeta

  const tableRenderMetaByBlockIndex = useMemo(() => {
    type TableRenderRow = {
      row: RenderBlock['rows'][number]
      ri: number
      isDeletedPlaceholder: boolean
    }

    const map = new Map<number, {
      tableLineIndices: number[]
      tableColCount: number
      tableRenderRowsAll: TableRenderRow[]
    }>()

    for (let bi = 0; bi < visibleBlocks.length; bi++) {
      const blk = visibleBlocks[bi]
      if (blk.kind !== 'table') continue

      const tableLineIndices = blk.rows.filter(r => !r.isHeader).map(r => r.lineIndex)
      const tableColCount = Math.max(1, blk.rows[0]?.cells.reduce((sum, cell) => sum + (cell.colSpan || 1), 0) || 1)
      const tableRenderRowsAll = blk.rows.flatMap((row, ri) => {
        const rows: TableRenderRow[] = [{ row, ri, isDeletedPlaceholder: false }]
        if (!row.isHeader && diffDeletedAfterLines.has(row.lineIndex)) {
          rows.push({ row, ri, isDeletedPlaceholder: true })
        }
        return rows
      })

      map.set(bi, { tableLineIndices, tableColCount, tableRenderRowsAll })
    }

    return map
  }, [visibleBlocks, diffDeletedAfterLines])

  const codeRenderMetaCacheRef = useRef(new Map<number, {
    signature: string
    codeLineRaw: string
    spans: Array<{ text: string; cls: string }>
    lineCmd: CompletionItem | null
    assignDetail: ReturnType<typeof parseAssignmentDetail>
    hasExpandableDetail: boolean
  }>())

  useEffect(() => {
    codeRenderMetaCacheRef.current.clear()
  }, [visibleBlocks])

  const getCodeRenderMeta = useCallback((blockIndex: number, blk: RenderBlock) => {
    const codeLineRaw = blk.codeLine || ''
    const signature = `${blk.isVirtual ? 1 : 0}|${codeLineRaw}`
    const cached = codeRenderMetaCacheRef.current.get(blockIndex)
    if (cached && cached.signature === signature) return cached

    const normalizedCodeLine = codeLineRaw.replace(FLOW_AUTO_TAG, '')
    const spans = colorize(normalizedCodeLine)
    let lineCmd: CompletionItem | null = null
    if (!blk.isVirtual) {
      for (const span of spans) {
        if (span.cls !== 'funccolor' && span.cls !== 'comecolor') continue
        const candidate = allCommandsRef.current.find(c => c.name === span.text)
          || dllCompletionItemsRef.current.find(c => c.name === span.text)
        if (candidate && candidate.params.length > 0) {
          lineCmd = candidate
          break
        }
      }
    }
    const assignDetail = blk.isVirtual ? null : parseAssignmentDetail(normalizedCodeLine)
    const nextMeta = {
      signature,
      codeLineRaw,
      spans,
      lineCmd,
      assignDetail,
      hasExpandableDetail: !!lineCmd || !!assignDetail,
    }
    codeRenderMetaCacheRef.current.set(blockIndex, nextMeta)
    return nextMeta
  }, [])

  const lineMarkerTypeMap = useMemo(() => {
    type MarkerType = 'none' | 'error' | 'added' | 'edited'
    const map = new Map<number, MarkerType>()

    for (const lineIndex of diagnosticsErrorLines) {
      if (lineIndex >= 0) map.set(lineIndex, 'error')
    }

    const applyIfNotError = (lineIndex: number, marker: MarkerType): void => {
      if (lineIndex < 0) return
      if (map.get(lineIndex) === 'error') return
      map.set(lineIndex, marker)
    }

    for (const lineIndex of diffAddedLines) applyIfNotError(lineIndex, 'added')
    for (const lineIndex of diffEditedLines) applyIfNotError(lineIndex, 'edited')
    if (diffHighlightLines) {
      for (const lineIndex of diffHighlightLines) {
        if (!map.has(lineIndex)) applyIfNotError(lineIndex, 'edited')
      }
    }

    return map
  }, [diagnosticsErrorLines, diffAddedLines, diffEditedLines, diffHighlightLines])

  // 为指定行生成 diff 相关的 CSS 类后缀（含前导空格）。
  // - added: 绿色；edited: 蓝色
  // 删除行通过独立占位行渲染，不再依赖 deleted-anchor 细线。
  // added/edited 互斥，diffHighlightLines 视为 added 的后备（保留旧行为）。
  const diffClassSuffixFor = useCallback((lineIndex: number): string => {
    if (lineIndex < 0) return ''
    const isEdited = diffEditedLines.has(lineIndex)
    const isAdded = !isEdited && (diffAddedLines.has(lineIndex) || (diffHighlightLines?.has(lineIndex) ?? false))
    const parts: string[] = []
    if (isAdded || isEdited) parts.push('eyc-diff-highlight')
    if (isEdited) parts.push('eyc-diff-edited')
    else if (isAdded) parts.push('eyc-diff-added')
    return parts.length > 0 ? ' ' + parts.join(' ') : ''
  }, [diffAddedLines, diffEditedLines, diffHighlightLines])

  const minimapPreviewRows = useMemo(() => {
    type MiniTableCell = { text: string; cls: string }
    type MiniMarker = 'none' | 'error' | 'added' | 'edited' | 'deleted'
    type MiniRow =
      | { kind: 'table'; cells: MiniTableCell[]; lineIndex: number; marker: MiniMarker }
      | { kind: 'code'; spans: Array<{ text: string; cls: string }>; lineIndex: number; marker: MiniMarker }
      | { kind: 'deleted'; marker: 'deleted' }

    if (!shouldShowMinimapPreview) return []

    const resolveMarker = (lineIndex: number): MiniMarker => {
      if (lineIndex < 0) return 'none'
      const marker = lineMarkerTypeMap.get(lineIndex)
      if (marker && marker !== 'none') return marker
      return 'none'
    }

    const sourceRows: MiniRow[] = []
    for (const blk of visibleBlocks) {
      if (blk.kind === 'table') {
        for (const row of blk.rows) {
          if (row.isHeader) continue
          const cells = row.cells
            .map(cell => ({
              text: (cell.text || '').replace(/\u00A0/g, ' ').trim() || ' ',
              cls: cell.cls || '',
            }))
          sourceRows.push({
            kind: 'table',
            lineIndex: row.lineIndex,
            marker: resolveMarker(row.lineIndex),
            cells: cells.length > 0 ? cells : [{ text: ' ', cls: '' }],
          })
          if (diffDeletedAfterLines.has(row.lineIndex)) {
            sourceRows.push({ kind: 'deleted', marker: 'deleted' })
          }
        }
        continue
      }
      const codeText = (blk.codeLine || '')
        .replace(FLOW_AUTO_TAG, '')
        .replace(/\u200B/g, '')
      const spans = colorize(codeText)
      const displaySpans = spans.map(s => {
        if (shouldAliasJudgeStartInTableMode && s.cls === 'comecolor' && s.text === '判断开始') {
          return { ...s, text: '判断' }
        }
        return s
      })
      sourceRows.push({
        kind: 'code',
        lineIndex: blk.lineIndex,
        marker: resolveMarker(blk.lineIndex),
        spans: displaySpans.length > 0 ? displaySpans.map(s => ({ text: s.text || ' ', cls: s.cls || '' })) : [{ text: ' ', cls: '' }],
      })
      if (diffDeletedAfterLines.has(blk.lineIndex)) {
        sourceRows.push({ kind: 'deleted', marker: 'deleted' })
      }
    }

    const total = Math.max(sourceRows.length, 1)
    const count = Math.max(1, Math.min(total, 260))
    return Array.from({ length: count }, (_, i) => {
      const start = Math.floor((i * total) / count)
      const end = Math.max(start + 1, Math.floor(((i + 1) * total) / count))
      const bucket = sourceRows.slice(start, end)
      const mid = Math.min(Math.max(Math.floor((start + end) / 2), 0), total - 1)
      return sourceRows[mid] || { kind: 'code' as const, lineIndex: -1, marker: 'none' as const, spans: [{ text: ' ', cls: '' }] }
    })
  }, [visibleBlocks, diffDeletedAfterLines, lineMarkerTypeMap, shouldShowMinimapPreview])

  // 对实际渲染的可见行按顺序分配连续行号（跳过 isHeader / isVirtual）
  // 注意：表格内可能存在多个可见行映射到同一源码 lineIndex（如 DLL 命令块），
  // 行号显示应按“可见行”递增，而不是按源码行号去重。
  const lineNumMaps = useMemo(() => {
    const tableRowNumMap = new Map<string, number>()
    const codeLineNumMap = new Map<number, number>()
    const sourceLineNumMap = new Map<number, number>()
    let display = 0
    for (let bi = 0; bi < visibleBlocks.length; bi++) {
      const blk = visibleBlocks[bi]
      if (blk.kind === 'table') {
        for (let ri = 0; ri < blk.rows.length; ri++) {
          const row = blk.rows[ri]
          if (row.isHeader) continue
          display++
          tableRowNumMap.set(`${bi}:${ri}`, display)
          sourceLineNumMap.set(row.lineIndex, display)
        }
      } else {
        if (!blk.isVirtual) {
          display++
          codeLineNumMap.set(blk.lineIndex, display)
          sourceLineNumMap.set(blk.lineIndex, display)
        }
      }
    }
    return { tableRowNumMap, codeLineNumMap, sourceLineNumMap }
  }, [visibleBlocks])

  const blockLineSpans = useMemo(() => {
    if (visibleBlocks.length === 0) {
      return [] as Array<{ startLine: number; endLine: number; visualRows: number }>
    }
    return visibleBlocks.map((blk) => {
      if (blk.kind === 'table') {
        const dataRows = blk.rows.filter(row => !row.isHeader)
        const lineIndices = dataRows.map(row => row.lineIndex).filter(li => Number.isFinite(li) && li >= 0)
        const startLine = lineIndices.length > 0 ? Math.min(...lineIndices) : 0
        const endLine = lineIndices.length > 0 ? Math.max(...lineIndices) : startLine
        const deletedPlaceholderCount = dataRows.reduce((count, row) => count + (diffDeletedAfterLines.has(row.lineIndex) ? 1 : 0), 0)
        const visualRows = Math.max(dataRows.length + deletedPlaceholderCount, 1)
        return { startLine, endLine, visualRows }
      }

      const lineIndex = Number.isFinite(blk.lineIndex) && blk.lineIndex >= 0 ? blk.lineIndex : 0
      const visualRows = 1 + (diffDeletedAfterLines.has(blk.lineIndex) ? 1 : 0)
      return { startLine: lineIndex, endLine: lineIndex, visualRows }
    })
  }, [visibleBlocks, diffDeletedAfterLines])

  const blockVirtualWindow = useMemo(() => {
    const approxRowPx = Math.max(editorLineHeight + 6, 22)
    if (blockLineSpans.length === 0) {
      return {
        startBlockIndex: 0,
        endBlockIndex: -1,
        leadingSpacerPx: 0,
        trailingSpacerPx: 0,
      }
    }

    const startBlockIndex = Math.max(0, blockLineSpans.findIndex(span => span.endLine >= visibleLineWindow.startLine))
    let endBlockIndex = blockLineSpans.length - 1
    for (let i = startBlockIndex; i < blockLineSpans.length; i++) {
      if (blockLineSpans[i].startLine > visibleLineWindow.endLine) {
        endBlockIndex = Math.max(startBlockIndex, i - 1)
        break
      }
    }

    const leadingRows = blockLineSpans.slice(0, startBlockIndex).reduce((sum, span) => sum + span.visualRows, 0)
    const trailingRows = blockLineSpans.slice(endBlockIndex + 1).reduce((sum, span) => sum + span.visualRows, 0)

    return {
      startBlockIndex,
      endBlockIndex,
      leadingSpacerPx: leadingRows * approxRowPx,
      trailingSpacerPx: trailingRows * approxRowPx,
    }
  }, [blockLineSpans, editorLineHeight, visibleLineWindow])

  const scrollbarStatusMarkers = useMemo(() => {
    type MarkerType = 'error' | 'added' | 'edited' | 'deleted'
    type MarkerSeg = { topRatio: number; heightRatio: number; type: MarkerType }
    const sourceMap = lineNumMaps.sourceLineNumMap
    let maxDisplay = 0
    for (const val of sourceMap.values()) {
      if (val > maxDisplay) maxDisplay = val
    }
    const total = Math.max(maxDisplay, 1)
    const sourceLinesByType = new Map<MarkerType, Set<number>>([
      ['error', new Set<number>()],
      ['added', new Set<number>()],
      ['edited', new Set<number>()],
      ['deleted', new Set<number>()],
    ])

    const toSegment = (startLine: number, endLine: number, type: MarkerType): MarkerSeg => {
      if (total <= 1) return { topRatio: 0, heightRatio: 1, type }
      const topRatio = Math.min(Math.max((startLine - 1) / total, 0), 1)
      const bottomRatio = Math.min(Math.max(endLine / total, 0), 1)
      const minRatio = 1 / Math.max(total, 240)
      const heightRatio = Math.max(bottomRatio - topRatio, minRatio)
      return { topRatio, heightRatio: Math.min(heightRatio, 1 - topRatio), type }
    }

    const buildTypeSegments = (type: MarkerType): MarkerSeg[] => {
      const set = sourceLinesByType.get(type)
      if (!set || set.size === 0) return []
      const lines = [...set].sort((a, b) => a - b)
      const segs: MarkerSeg[] = []
      let start = lines[0]
      let prev = lines[0]
      const pushSourceSegment = (startLine: number, endLine: number): void => {
        let startDisplay = Number.POSITIVE_INFINITY
        let endDisplay = Number.NEGATIVE_INFINITY
        for (let sourceLine = startLine; sourceLine <= endLine; sourceLine++) {
          const displayLine = sourceMap.get(sourceLine)
          if (!displayLine) continue
          if (displayLine < startDisplay) startDisplay = displayLine
          if (displayLine > endDisplay) endDisplay = displayLine
        }
        if (!Number.isFinite(startDisplay) || !Number.isFinite(endDisplay)) return
        segs.push(toSegment(startDisplay, endDisplay, type))
      }
      for (let i = 1; i < lines.length; i++) {
        const curr = lines[i]
        if (curr === prev + 1) {
          prev = curr
          continue
        }
        pushSourceSegment(start, prev)
        start = curr
        prev = curr
      }
      pushSourceSegment(start, prev)
      return segs
    }

    for (const [lineIndex, marker] of lineMarkerTypeMap.entries()) {
      if (marker === 'none') continue
      sourceLinesByType.get(marker)?.add(lineIndex)
    }

    for (const lineIndex of diffDeletedAfterLines) {
      // 若同一显示行已标为 edited（变更行同时也是删除锚点），跳过 deleted 段，
      // 避免 deleted（绘制顺序靠后）覆盖 edited 蓝色段导致看不到蓝色标记。
      if (sourceLinesByType.get('edited')?.has(lineIndex)) continue
      sourceLinesByType.get('deleted')?.add(lineIndex)
    }

    return [
      ...buildTypeSegments('error'),
      ...buildTypeSegments('added'),
      ...buildTypeSegments('edited'),
      ...buildTypeSegments('deleted'),
    ]
  }, [diffDeletedAfterLines, lineMarkerTypeMap, lineNumMaps])

  const laidOutScrollbarStatusMarkers = useMemo(() => {
    type MarkerType = 'error' | 'added' | 'edited' | 'deleted'
    type LayoutMarker = { type: MarkerType; topPx: number; heightPx: number }

    const laneHeight = Math.max(scrollbarLaneHeightPx, 1)
    const minDiffHeightPx = 6
    const minErrorHeightPx = 3

    const raw: LayoutMarker[] = scrollbarStatusMarkers.map(marker => {
      const baseTop = Math.min(Math.max(marker.topRatio * laneHeight, 0), laneHeight)
      const baseHeight = marker.heightRatio * laneHeight
      const minHeight = marker.type === 'error' ? minErrorHeightPx : minDiffHeightPx
      const heightPx = Math.min(Math.max(baseHeight, minHeight), laneHeight)
      return { type: marker.type, topPx: baseTop, heightPx }
    })

    const errorMarkers = raw
      .filter(marker => marker.type === 'error')
      .map(marker => {
        let topPx = marker.topPx
        if (topPx + marker.heightPx > laneHeight) topPx = Math.max(0, laneHeight - marker.heightPx)
        return { ...marker, topPx }
      })

    const diffMarkers = raw
      .filter(marker => marker.type !== 'error')
      .sort((a, b) => a.topPx - b.topPx)

    const laidOutDiffMarkers: LayoutMarker[] = []
    let cursor = 0
    for (const marker of diffMarkers) {
      let topPx = marker.topPx
      if (topPx < cursor) topPx = cursor
      laidOutDiffMarkers.push({ ...marker, topPx })
      cursor = topPx + marker.heightPx
    }

    const overflow = cursor - laneHeight
    if (overflow > 0 && laidOutDiffMarkers.length > 0) {
      let remaining = overflow
      const shift = Math.min(remaining, laidOutDiffMarkers[0].topPx)
      if (shift > 0) {
        for (const marker of laidOutDiffMarkers) marker.topPx -= shift
        remaining -= shift
      }

      if (remaining > 0) {
        let packedTop = 0
        for (const marker of laidOutDiffMarkers) {
          marker.topPx = packedTop
          packedTop += marker.heightPx
        }
      }
    }

    return [...errorMarkers, ...laidOutDiffMarkers].sort((a, b) => a.topPx - b.topPx)
  }, [scrollbarLaneHeightPx, scrollbarStatusMarkers])

  const getSelectedSourceText = useCallback((): string => {
    const sorted = [...selectedLines].sort((a, b) => a - b)
    const ls = currentText.split('\n')
    const raw = sorted.filter(i => i >= 0 && i < ls.length).map(i => ls[i]).join('\n')
    return eycToYiFormat(raw)
  }, [selectedLines, currentText])

  const getMouseRangeSelectedSourceText = useCallback((): string | null => {
    if (!wrapperRef.current) return null
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
    const range = selection.getRangeAt(0)
    if (!wrapperRef.current.contains(range.commonAncestorContainer)) return null

    const nativeText = selection.toString()
    const lineElements = Array.from(wrapperRef.current.querySelectorAll<HTMLElement>('[data-line-index]'))
    const lineIndices = Array.from(new Set(
      lineElements
        .filter(el => range.intersectsNode(el))
        .map(el => Number.parseInt(el.dataset.lineIndex || '', 10))
        .filter(idx => Number.isInteger(idx) && idx >= 0),
    )).sort((a, b) => a - b)

    if (lineIndices.length < 2 || nativeText.includes('\n')) return null

    const ls = currentText.split('\n')
    const raw = lineIndices.filter(i => i < ls.length).map(i => ls[i]).join('\n')
    return raw ? eycToYiFormat(raw) : null
  }, [currentText])

  // 收集用户定义的子程序名和变量名
  const { userSubNames, userVarNames } = useMemo(() => {
    const subs = new Set<string>()
    const vars = new Set<string>()
    const parsed = parsedLinesForCurrentText
    for (const ln of parsed) {
      if (ln.type === 'sub' && ln.fields[0]) subs.add(ln.fields[0])
      if ((ln.type === 'localVar' || ln.type === 'subParam' || ln.type === 'assemblyVar' || ln.type === 'globalVar') && ln.fields[0]) vars.add(ln.fields[0])
    }
    return { userSubNames: subs, userVarNames: vars }
  }, [parsedLinesForCurrentText])
  const projectGlobalVarNameSet = useMemo(() => new Set(projectGlobalVars.map(v => v.name).filter(Boolean)), [projectGlobalVars])
  const windowControlNameSet = useMemo(() => new Set(windowControlNames.map(n => (n || '').trim()).filter(Boolean)), [windowControlNames])
  const allKnownVarNames = useMemo(() => {
    const set = new Set<string>(userVarNames)
    for (const n of projectGlobalVarNameSet) set.add(n)
    for (const n of windowControlNameSet) set.add(n)
    return set
  }, [userVarNames, projectGlobalVarNameSet, windowControlNameSet])
  useEffect(() => { userVarNamesRef.current = allKnownVarNames }, [allKnownVarNames])
  useEffect(() => { userSubNamesRef.current = userSubNames }, [userSubNames])

  // 生成用于补全的用户变量项（局部/参数按当前子程序作用域）
  const userVarCompletionItems = useMemo<CompletionItem[]>(() => {
    const parsed = parsedLinesForCurrentText
    const cursorLine = editCell?.lineIndex ?? -1

    let subStart = -1
    let subEnd = parsed.length
    if (cursorLine >= 0 && cursorLine < parsed.length) {
      for (let i = cursorLine; i >= 0; i--) {
        const t = parsed[i].type
        if (t === 'sub') { subStart = i; break }
        if (t === 'assembly') break
      }
      if (subStart >= 0) {
        for (let i = subStart + 1; i < parsed.length; i++) {
          const t = parsed[i].type
          if (t === 'sub' || t === 'assembly') { subEnd = i; break }
        }
      }
    }

    const items: CompletionItem[] = []
    const seen = new Set<string>()
    const addVar = (name: string, varType: string, category: string): void => {
      const nm = (name || '').trim()
      if (!nm || seen.has(nm)) return
      seen.add(nm)
      items.push({
        name: nm,
        englishName: '',
        description: varType ? `${category}（${varType}）` : category,
        returnType: varType || '',
        category,
        libraryName: '用户定义',
        isMember: false,
        ownerTypeName: '',
        params: [],
      })
    }

    // 当前子程序的参数/局部变量优先（更贴近当前输入上下文）
    if (subStart >= 0) {
      for (let i = subStart + 1; i < subEnd; i++) {
        const ln = parsed[i]
        if ((ln.type === 'subParam' || ln.type === 'localVar') && ln.fields[0]) {
          addVar(ln.fields[0], (ln.fields[1] || '').trim(), ln.type === 'subParam' ? '参数' : '局部变量')
        }
      }
    }

    // 程序集变量
    for (const ln of parsed) {
      if (ln.type === 'assemblyVar' && ln.fields[0]) {
        addVar(ln.fields[0], (ln.fields[1] || '').trim(), '程序集变量')
      }
    }

    // 全局变量
    for (const ln of parsed) {
      if (ln.type === 'globalVar' && ln.fields[0]) {
        addVar(ln.fields[0], (ln.fields[1] || '').trim(), '全局变量')
      }
    }

    // 项目级全局变量（来自 .egv 文件与其他已打开标签页）
    for (const v of projectGlobalVars) {
      addVar(v.name, v.type || '', '全局变量')
    }

    // 当前窗口设计器中的控件实例名（如 按钮1）
    for (const controlName of windowControlNames) {
      addVar(controlName, '', '窗口组件')
    }

    return items
  }, [parsedLinesForCurrentText, editCell?.lineIndex, projectGlobalVars, windowControlNames])
  useEffect(() => {
    userVarCompletionItemsRef.current = userVarCompletionItems
  }, [userVarCompletionItems])

  const userSubCompletionItems = useMemo<CompletionItem[]>(() => {
    const items: CompletionItem[] = []
    for (const subName of userSubNames) {
      const name = (subName || '').trim()
      if (!name) continue
      items.push({
        name,
        englishName: '',
        description: '用户子程序',
        returnType: '',
        category: '子程序',
        libraryName: '用户定义',
        isMember: false,
        ownerTypeName: '',
        params: [],
      })
    }
    return items
  }, [userSubNames])
  useEffect(() => {
    userSubCompletionItemsRef.current = userSubCompletionItems
  }, [userSubCompletionItems])

  const constantCompletionItems = useMemo<CompletionItem[]>(() => {
    const parsed = parsedLinesForCurrentText
    const items: CompletionItem[] = []
    const seen = new Set<string>()

    const addConstant = (
      name: string,
      constantValue: string,
      englishName = '',
      description = '',
      libraryName = '用户定义',
      category: '常量' | '资源' = '常量',
    ): void => {
      const nm = (name || '').trim()
      if (!nm || seen.has(nm)) return
      seen.add(nm)
      const val = (constantValue || '').trim()
      const desc = description.trim()
      const typeLabel = category === '资源' ? '资源' : '常量'
      items.push({
        name: nm,
        englishName: (englishName || '').trim(),
        description: desc || (val ? `${typeLabel}（值：${val}）` : typeLabel),
        returnType: '',
        category,
        libraryName,
        isMember: false,
        ownerTypeName: '',
        params: [],
      })
    }

    for (const item of BUILTIN_LITERAL_COMPLETION_ITEMS) {
      addConstant(
        item.name,
        '',
        item.englishName,
        item.description,
        item.libraryName,
        '常量',
      )
    }

    for (const ln of parsed) {
      if (ln.type === 'constant' && ln.fields[0]) {
        addConstant(ln.fields[0], ln.fields[1] || '')
      }
    }

    for (const c of projectConstants) {
      addConstant(c.name, c.value || '', '', '', '用户定义', c.kind === 'resource' ? '资源' : '常量')
    }

    for (const c of libraryConstants) {
      addConstant(c.name, c.value || '', c.englishName || '', c.description || '', c.libraryName || '支持库')
    }

    return items
  }, [parsedLinesForCurrentText, projectConstants, libraryConstants])

  useEffect(() => {
    constantCompletionItemsRef.current = constantCompletionItems
  }, [constantCompletionItems])

  const dllCompletionItems = useMemo<CompletionItem[]>(() => {
    const parsed = parsedLinesForCurrentText
    const items: CompletionItem[] = []
    const seen = new Set<string>()

    const addDll = (name: string, returnType: string, description: string, params: CompletionParam[]) => {
      const nm = (name || '').trim()
      if (!nm || seen.has(nm)) return
      seen.add(nm)
      items.push({
        name: nm,
        englishName: '',
        description: description || (returnType ? `DLL命令（返回：${returnType}）` : 'DLL命令'),
        returnType: returnType || '',
        category: 'DLL命令',
        libraryName: '用户定义',
        isMember: false,
        ownerTypeName: '',
        params: (params || []).map(p => ({
          name: p.name,
          type: p.type,
          description: p.description || '',
          optional: !!p.optional,
          isVariable: !!p.isVariable,
          isArray: !!p.isArray,
        })),
      })
    }

    // 当前文档内的 DLL 命令
    const currentDocDllMap = new Map<string, { returnType: string; description: string; params: CompletionParam[] }>()
    let currentDllName = ''
    for (const ln of parsed) {
      if (ln.type === 'dll') {
        const name = (ln.fields[0] || '').trim()
        if (!name) {
          currentDllName = ''
          continue
        }
        currentDllName = name
        if (!currentDocDllMap.has(name)) {
          currentDocDllMap.set(name, {
            returnType: (ln.fields[1] || '').trim(),
            description: ln.fields.length > 5 ? ln.fields.slice(5).join(', ').trim() : '',
            params: [],
          })
        }
        continue
      }

      if (ln.type === 'sub') {
        currentDllName = ''
        continue
      }

      if (ln.type === 'subParam' && currentDllName) {
        const target = currentDocDllMap.get(currentDllName)
        if (!target) continue
        const flags = (ln.fields[2] || '').trim()
        target.params.push({
          name: (ln.fields[0] || '').trim(),
          type: (ln.fields[1] || '').trim(),
          description: ln.fields.length > 3 ? ln.fields.slice(3).join(', ').trim() : '',
          optional: flags.includes('可空'),
          isVariable: flags.includes('传址'),
          isArray: flags.includes('数组'),
        })
      }
    }

    for (const [name, meta] of currentDocDllMap.entries()) {
      addDll(name, meta.returnType, meta.description, meta.params)
    }

    // 项目级 DLL 命令（来自 .ell 与其他已打开标签页）
    for (const c of projectDllCommands) {
      addDll(c.name, c.returnType || '', c.description || '', c.params || [])
    }

    return items
  }, [parsedLinesForCurrentText, projectDllCommands])

  useEffect(() => {
    dllCompletionItemsRef.current = dllCompletionItems
  }, [dllCompletionItems])

  const typeCompletionItems = useMemo<CompletionItem[]>(() => {
    const items: CompletionItem[] = []
    const seen = new Set<string>()

    const addType = (name: string, category: string, englishName = '', description?: string) => {
      const nm = (name || '').trim()
      if (!nm || seen.has(nm)) return
      seen.add(nm)
      items.push({
        name: nm,
        englishName,
        description: description || category,
        returnType: '',
        category,
        libraryName: '用户定义',
        isMember: false,
        ownerTypeName: '',
        params: [],
      })
    }

    // 基础数据类型始终可用，不依赖支持库数据类型列表
    for (const t of BUILTIN_TYPE_ITEMS) addType(t.name, '基础数据类型', t.englishName, t.description)

    for (const t of libraryDataTypeNames) addType(t, '支持库数据类型')

    const parsed = parsedLinesForCurrentText
    for (const ln of parsed) {
      if (ln.type === 'dataType' && ln.fields[0]) {
        addType(ln.fields[0], '自定义数据类型')
      }
    }

    for (const dt of projectDataTypes) {
      addType(dt.name, '自定义数据类型')
    }

    // 项目类模块中的类名也可作为返回值类型/数据类型使用
    for (const c of projectClassNames) {
      addType(c.name, '项目类名')
    }

    return items
  }, [parsedLinesForCurrentText, libraryDataTypeNames, projectDataTypes, projectClassNames])

  useEffect(() => {
    typeCompletionItemsRef.current = typeCompletionItems
  }, [typeCompletionItems])

  const classNameCompletionItems = useMemo<CompletionItem[]>(() => {
    const items: CompletionItem[] = []
    const seen = new Set<string>()

    const addClass = (name: string) => {
      const nm = (name || '').trim()
      if (!nm || seen.has(nm)) return
      seen.add(nm)
      items.push({
        name: nm,
        englishName: '',
        description: '项目类模块',
        returnType: '',
        category: '类名',
        libraryName: '用户定义',
        isMember: false,
        ownerTypeName: '',
        params: [],
      })
    }

    const parsed = parsedLinesForCurrentText
    for (const ln of parsed) {
      if (ln.type === 'assembly' && ln.fields[0]) {
        addClass(ln.fields[0])
      }
    }

    for (const c of projectClassNames) addClass(c.name)

    return items
  }, [parsedLinesForCurrentText, projectClassNames])

  useEffect(() => {
    classNameCompletionItemsRef.current = classNameCompletionItems
  }, [classNameCompletionItems])

  // 有效命令名集合（支持库命令 + 用户子程序 + 流程关键字 + 变量名）
  const validCommandNames = useMemo(() => {
    const s = new Set<string>()
    for (const c of allCommandsRef.current) s.add(c.name)
    for (const c of dllCompletionItemsRef.current) s.add(c.name)
    for (const n of userSubNames) s.add(n)
    for (const n of allKnownVarNames) s.add(n)
    for (const k of FLOW_KW) s.add(k)
    return s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSubNames, allKnownVarNames, cmdLoadId, dllCompletionItems])
  const hasCommandCatalog = useMemo(() => allCommandsRef.current.length > 0, [cmdLoadId])

  const missingRhsLineSet = useMemo(() => {
    const set = new Set<number>()
    for (const blk of visibleBlocks) {
      if (blk.kind !== 'codeline' || !blk.codeLine) continue
      const rawLine = blk.codeLine.replace(FLOW_AUTO_TAG, '')
      if (getMissingAssignmentRhsTarget(rawLine)) set.add(blk.lineIndex)
    }
    return set
  }, [visibleBlocks])

  // 保留名集合（流程关键字 + 支持库命令 + DLL 命令），变量名/参数名不得与之重名
  const reservedNameSet = useMemo(() => {
    const s = new Set<string>()
    for (const k of FLOW_KW) s.add(k)
    for (const c of allCommandsRef.current) s.add(c.name)
    for (const c of dllCompletionItemsRef.current) s.add(c.name)
    return s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmdLoadId, dllCompletionItems])

  const invalidVarNameLineSet = useMemo(() => {
    const set = new Set<number>()
    const parsed = parsedLinesForCurrentText
    for (let i = 0; i < parsed.length; i++) {
      const ln = parsed[i]
      if (ln.type === 'localVar' || ln.type === 'assemblyVar' || ln.type === 'globalVar' || ln.type === 'subParam') {
        const name = (ln.fields[0] || '').trim()
        if (name && (!isValidVariableLikeName(name) || reservedNameSet.has(name))) set.add(i)
      }
    }
    return set
  }, [parsedLinesForCurrentText, reservedNameSet])

  const diagnosticsProblems = useEditorDiagnosticsProblems({
    text: diagnosticsText,
    hasCommandCatalog: allCommandsRef.current.length > 0,
    validCommandNames,
    allKnownVarNames,
    reservedNameSet,
  })

  // 问题列表由 worker 异步计算，主线程仅分发结果。
  useEffect(() => {
    const errorLines = Array.from(new Set(
      diagnosticsProblems
        .filter(problem => problem.severity === 'error' && Number.isFinite(problem.line) && problem.line > 0)
        .map(problem => problem.line - 1),
    )).sort((a, b) => a - b)

    setDiagnosticsErrorLines(prev => {
      if (prev.length === errorLines.length && prev.every((line, index) => line === errorLines[index])) {
        return prev
      }
      return errorLines
    })

    if (!onProblemsChange) return
    onProblemsChange(diagnosticsProblems as FileProblem[])
  }, [onProblemsChange, diagnosticsProblems])

  const commit = useCallback((overrideVal?: string) => {
    if (!editCell || commitGuardRef.current) return
    commitGuardRef.current = true
    setAcVisible(false)

    // 如果补全弹窗可见且输入词完全匹配命令名，自动上屏
    let effectiveVal = overrideVal !== undefined ? overrideVal : editVal
    if (overrideVal === undefined && acVisibleRef.current && acItemsRef.current.length > 0) {
      const firstItem = acItemsRef.current[0]
      if (!firstItem.isMore) {
        const item = firstItem.cmd
        const wordStart = acWordStartRef.current
        const cursorPos = inputRef.current?.selectionStart ?? effectiveVal.length
        const typedWord = effectiveVal.slice(wordStart, cursorPos)
        if (typedWord === item.name) {
          const before = effectiveVal.slice(0, wordStart)
          const after = effectiveVal.slice(cursorPos)
          effectiveVal = before + item.name + after
        }
      }
    }

    // 参数值编辑 / 赋值语句右值编辑
    if (editCell.paramIdx !== undefined) {
      if (editCell.paramIdx >= 0) {
        const codeLine = lines[editCell.lineIndex]
        const formattedVal = formatParamOperators(effectiveVal)
        const newLine = replaceCallArg(codeLine, editCell.paramIdx, formattedVal)
        const nl = [...lines]; nl[editCell.lineIndex] = newLine
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
        return
      }
      if (editCell.paramIdx === -100) {
        const codeLine = lines[editCell.lineIndex] || ''
        const parsed = parseAssignmentLineParts(codeLine)
        if (!parsed) {
          setEditCell(null)
          return
        }
        const formattedVal = formatParamOperators(effectiveVal)
        const newLine = `${parsed.indent}${parsed.lhs} ＝ ${formattedVal}`
        const nl = [...lines]; nl[editCell.lineIndex] = newLine
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
        return
      }
      if (editCell.paramIdx <= -200) {
        const codeLine = lines[editCell.lineIndex] || ''
        const parsed = parseAssignmentLineParts(codeLine)
        if (!parsed) {
          setEditCell(null)
          return
        }
        const rhsParamIdx = -editCell.paramIdx - 200
        const formattedVal = formatParamOperators(effectiveVal)
        const newRhs = replaceCallArg(parsed.rhs, rhsParamIdx, formattedVal)
        const newLine = `${parsed.indent}${parsed.lhs} ＝ ${newRhs}`
        const nl = [...lines]; nl[editCell.lineIndex] = newLine
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
        return
      }
    }

    if (editCell.cellIndex < 0) {
      effectiveVal = normalizeCodeLineInput(effectiveVal)
      // 流程上下文中，若文本未改动则直接退出编辑，避免仅点击/失焦触发格式化导致流程结构漂移。
      const unchanged = overrideVal === undefined && effectiveVal === codeLineEditOrigValRef.current
      const flowContext = wasFlowStartRef.current || flowIndentRef.current.length > 0
      if (unchanged && flowContext) {
        flowIndentRef.current = ''
        wasFlowStartRef.current = false
        wasFlowKwRef.current = ''
        wasFlowOrigIndentRef.current = ''
        setEditCell(null)
        return
      }
      // formatCommandLine 会为流程命令额外加4空格，若 flowIndent 已包含流程缩进则需减去以避免翻倍
      let baseIndent = flowIndentRef.current
      const trimmedCmd = effectiveVal.trim()
      const cmdCheckName = normalizeFlowCommandName(trimmedCmd)
      const isBareCmd = /^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*\s*$/.test(trimmedCmd)
      const isParenCmd = /^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*\s*[\(（].*[\)）]\s*$/.test(trimmedCmd)
      if ((isBareCmd || isParenCmd) && trimmedCmd && FLOW_AUTO_COMPLETE[cmdCheckName] && baseIndent.length >= 4) {
        baseIndent = baseIndent.slice(0, baseIndent.length - 4)
      }
      // 原流程起始命令被改为普通命令：沿用原始行的真实缩进作为 baseIndent，避免嵌套层级下过度反缩进
      if (wasFlowStartRef.current && trimmedCmd && !FLOW_AUTO_COMPLETE[cmdCheckName]) {
        baseIndent = wasFlowOrigIndentRef.current
      }
      const preferJudgeBranch = cmdCheckName === '判断' && shouldPreferJudgeBranchAtLine(editCell.lineIndex)
      debugFlowPaste('commit:main-line-input', {
        lineIndex: editCell.lineIndex,
        effectiveVal,
        trimmedCmd,
        cmdCheckName,
        isBareCmd,
        isParenCmd,
        baseIndentLength: baseIndent.length,
        preferJudgeBranch,
        wasFlowStart: wasFlowStartRef.current,
        wasFlowKw: wasFlowKwRef.current,
      })
      const formattedLines = formatCommandLine(baseIndent + effectiveVal, { preferJudgeBranch })
      flowIndentRef.current = ''
      const mainLine = formattedLines[0]
      // 检查是否需要插入自动补齐的后续行（只在新输入时插入，已有匹配结束标记时不重复插入）
      let extraLines = formattedLines.slice(1)
      const rawExtraLineCount = extraLines.length
      if (extraLines.length > 0) {
        const afterIdx = editCell.isVirtual ? editCell.lineIndex + 2 : editCell.lineIndex + 1
        const currentIndentLen = mainLine.length - mainLine.trimStart().length
        const remainingLines = collectRemainingLinesInCurrentScope(lines, afterIdx, currentIndentLen)
        extraLines = removeDuplicateFlowAutoEndings(extraLines, remainingLines)
      }
      debugFlowPaste('commit:main-line-result', {
        lineIndex: editCell.lineIndex,
        mainLine,
        rawExtraLineCount,
        dedupedExtraLineCount: extraLines.length,
        isVirtual: !!editCell.isVirtual,
        preferJudgeBranch,
      })
      if (editCell.isVirtual) {
        // 虚拟代码行：插入新行而非替换
        const nl = [...lines]
        nl.splice(editCell.lineIndex + 1, 0, mainLine, ...extraLines)
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
        return
      }
      // 代码行编辑：替换当前行并插入后续自动补齐行
      const nl = [...lines]
      // 流程命令被删除 → 溶解整个流程块：移除分支/结束标记行，将块内正文缩进还原
      const oldKw = wasFlowKwRef.current
      const newIsFlow = !!(trimmedCmd && FLOW_AUTO_COMPLETE[cmdCheckName] && !preferJudgeBranch)
      if (!editCell.isVirtual && oldKw && !newIsFlow && FLOW_START[oldKw]) {
        const deleteSet = new Set<number>()
        const unindentSet = new Set<number>()
        const baseIndentLen = wasFlowOrigIndentRef.current.length
        const endKw = FLOW_START[oldKw]
        const endKwSet = (() => {
          if (oldKw === '如果' || oldKw === '如果真') return new Set<string>([endKw])
          if (oldKw === '判断') return new Set<string>([endKw])
          return new Set<string>([endKw])
        })()
        const branchKwSet = (() => {
          if (oldKw === '判断') return new Set<string>(['默认'])
          if (oldKw === '如果') return new Set<string>(['否则'])
          if (oldKw === '如果真') return new Set<string>()
          return new Set<string>()
        })()
        const dissolvedMainLine = (() => {
          const lead = mainLine.match(/^ */)?.[0] || ''
          const drop = Math.min(4, lead.length)
          return mainLine.slice(drop)
        })()
        for (let i = editCell.lineIndex + 1; i < nl.length; i++) {
          const lineText = nl[i]
          const trimmed = lineText.replace(/[\r\t]/g, '').trim()
          const lineIndentLen = lineText.length - lineText.replace(/^ +/, '').length

          if (trimmed.startsWith('.子程序 ') || trimmed.startsWith('.程序集 ')) break
          if (lineIndentLen < baseIndentLen) break

          if (lineIndentLen === baseIndentLen) {
            const kw = extractFlowKw(lineText)
            if (kw && endKwSet.has(kw)) {
              deleteSet.add(i)
              break
            }
            if (kw && branchKwSet.has(kw)) {
              deleteSet.add(i)
              continue
            }
            if (trimmed === '') {
              unindentSet.add(i)
              continue
            }
            break
          }

          // 缩进更深的行都属于被溶解流程块内容，需要整体左移一层。
          unindentSet.add(i)
        }
        if (deleteSet.size > 0 || unindentSet.size > 0) {
          const result: string[] = []
          for (let i = 0; i < nl.length; i++) {
            if (i === editCell.lineIndex) { result.push(dissolvedMainLine); continue }
            if (deleteSet.has(i)) continue
            if (unindentSet.has(i)) {
              let ln = nl[i]
              const lead = ln.match(/^ */)?.[0] || ''
              const drop = Math.min(4, lead.length)
              result.push(ln.slice(drop))
              continue
            }
            result.push(nl[i])
          }
          const nt = result.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
          wasFlowKwRef.current = ''
          return
        }
      }
      // preferJudgeBranch：用户在 .默认 之后的空 body 行键入“判断”
      // → 在 .默认 行之前插入 .判断 () 分支，并清空当前行（保留为空 body）。
      if (preferJudgeBranch && !editCell.isVirtual) {
        const around = getFlowStructureAround(nl, editCell.lineIndex)
        const prevSection = around?.sections[(around?.sectionIdx ?? 0) - 1]
        if (around && prevSection && prevSection.char === '默认') {
          const defaultLineIdx = prevSection.startLine
          if (defaultLineIdx >= 0 && defaultLineIdx <= nl.length) {
            const findIndentLen = (lineText: string): number => lineText.length - lineText.replace(/^ +/, '').length
            const findJudgeControlIndentLen = (): number => {
              for (let i = defaultLineIdx - 1; i >= 0; i--) {
                const line = nl[i] || ''
                const kw = extractFlowKw(line)
                if (kw === '判断开始' || kw === '判断') return findIndentLen(line)
              }
              const defaultLine = nl[defaultLineIdx] || ''
              return findIndentLen(defaultLine)
            }
            const controlIndentLen = findJudgeControlIndentLen()
            const judgeLine = ' '.repeat(controlIndentLen) + mainLine.trimStart()
            const normalizeControlLineIndent = (targetLineIndex: number): void => {
              if (targetLineIndex < 0 || targetLineIndex >= nl.length) return
              const raw = nl[targetLineIndex] || ''
              if (!raw.trim()) return
              nl[targetLineIndex] = ' '.repeat(controlIndentLen) + raw.trimStart()
            }

            normalizeControlLineIndent(defaultLineIdx)
            for (let i = defaultLineIdx + 1; i < nl.length; i++) {
              const line = nl[i] || ''
              if (!line.trim()) continue
              if (extractFlowKw(line) === '判断结束') normalizeControlLineIndent(i)
              break
            }

            nl[editCell.lineIndex] = ''
            nl.splice(defaultLineIdx, 0, judgeLine)
            const nt = nl.join('\n')
            setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
            return
          }
        }
      }
      nl.splice(editCell.lineIndex, 1, mainLine, ...extraLines)
      const nt = nl.join('\n')
      setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
      return
    }
    if (editCell.fieldIdx < 0) {
      // 无字段映射（如 tick 单元格），不修改
      setEditCell(null)
      return
    }
    // 表格单元格编辑：重建字段
    const rawLine = lines[editCell.lineIndex]
    let fieldValue = effectiveVal
    const parsedRaw = parseLines(rawLine)[0]
    if (isResourceTableDoc && editCell.fieldIdx === 1 && parsedRaw && (parsedRaw.type === 'resource' || parsedRaw.type === 'constant')) {
      const trimmed = effectiveVal.trim()
      if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\u201c') && trimmed.endsWith('\u201d'))) {
        fieldValue = trimmed
      } else {
        fieldValue = `"${trimmed.replace(/"/g, '\\"')}"`
      }
    }
    const newLine = rebuildLineField(rawLine, editCell.fieldIdx, fieldValue, editCell.sliceField)
    const nl = [...lines]; nl[editCell.lineIndex] = newLine

    // 变量名重命名同步：fieldIdx === 0 且为变量声明行时，替换代码中的引用
    if (editCell.fieldIdx === 0) {
      const trimmedRaw = rawLine.replace(/[\r\t]/g, '').trim()
      const varPrefixes = ['.局部变量 ', '.参数 ', '.程序集变量 ', '.全局变量 ']
      const matchedPrefix = varPrefixes.find(pf => trimmedRaw.startsWith(pf))
      if (matchedPrefix) {
        // 使用编辑前保存的原始值作为旧名（liveUpdate 会实时更新 lines，导致 rawLine 已是新值）
        const oldName = editCellOrigValRef.current.trim()
        const newName = effectiveVal.trim()
        if (oldName && newName && oldName !== newName) {
          // 确定作用域范围
          const li = editCell.lineIndex
          let scopeStart = 0
          let scopeEnd = nl.length
          const isLocal = matchedPrefix === '.局部变量 ' || matchedPrefix === '.参数 '
          const isAssembly = matchedPrefix === '.程序集变量 '
          // 全局变量：整个文件
          if (isLocal) {
            // 局部变量/参数：从上方最近的 .子程序 到下方最近的 .子程序/.程序集
            for (let i = li - 1; i >= 0; i--) {
              const t = nl[i].replace(/[\r\t]/g, '').trim()
              if (t.startsWith('.子程序 ')) { scopeStart = i; break }
              if (t.startsWith('.程序集 ')) { scopeStart = i; break }
            }
            for (let i = li + 1; i < nl.length; i++) {
              const t = nl[i].replace(/[\r\t]/g, '').trim()
              if (t.startsWith('.子程序 ') || t.startsWith('.程序集 ')) { scopeEnd = i; break }
            }
          } else if (isAssembly) {
            // 程序集变量：从上方最近的 .程序集 到下方最近的 .程序集
            for (let i = li - 1; i >= 0; i--) {
              const t = nl[i].replace(/[\r\t]/g, '').trim()
              if (t.startsWith('.程序集 ')) { scopeStart = i; break }
            }
            for (let i = li + 1; i < nl.length; i++) {
              const t = nl[i].replace(/[\r\t]/g, '').trim()
              if (t.startsWith('.程序集 ')) { scopeEnd = i; break }
            }
          }
          // 在作用域内的代码行中替换变量名（不替换声明行和注释行）
          const nameRegex = new RegExp(
            '(?<=[^\\u4e00-\\u9fa5A-Za-z0-9_.]|^)' + oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[^\\u4e00-\\u9fa5A-Za-z0-9_.]|$)',
            'g'
          )
          for (let i = scopeStart; i < scopeEnd; i++) {
            if (i === editCell.lineIndex) continue // 跳过声明行本身
            const t = nl[i].replace(/[\r\t]/g, '').trim()
            if (!t || t.startsWith("'") || t.startsWith('.')) continue // 跳过空行、注释、声明
            nl[i] = nl[i].replace(nameRegex, newName)
          }
        }
      }

      // 类模块程序集名重命名：提交后回调给上层执行文件/项目同步
      if (isClassModule && trimmedRaw.startsWith('.程序集 ')) {
        const oldClassName = editCellOrigValRef.current.trim()
        const newClassName = effectiveVal.trim()
        if (oldClassName && newClassName && oldClassName !== newClassName) {
          onClassNameRename?.(oldClassName, newClassName)
        }
      }
    }

    const nt = nl.join('\n')
    setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
  }, [editCell, editVal, isClassModule, isResourceTableDoc, lines, normalizeCodeLineInput, normalizeFlowCommandName, onChange, onClassNameRename])

  // 每次渲染后重置 commitGuard，允许下一次合法的 commit 调用
  useEffect(() => { commitGuardRef.current = false })

  // 光标位置变化通知
  useEffect(() => {
    if (editCell && editCell.lineIndex >= 0) {
      const col = inputRef.current?.selectionStart ?? 1
      const displayLine = lineNumMaps.sourceLineNumMap.get(editCell.lineIndex) ?? (editCell.lineIndex + 1)
      onCursorChange?.(displayLine, col + 1, editCell.lineIndex + 1)
    }
  }, [editCell, onCursorChange, lineNumMaps])

  // commitRef: 始终指向最新的 commit 函数，供 mouseDown 等闭包调用
  const commitRef = useRef<(overrideVal?: string) => void>(commit)
  commitRef.current = commit

  // 窗口失焦兜底提交：处理 Win 键/Alt+Tab 打断编辑导致的未格式化状态
  useEffect(() => {
    const flushEditing = (): void => {
      if (editCellRef.current) {
        commitRef.current()
      }
    }

    const onWindowBlur = (): void => {
      flushEditing()
    }

    const onVisibilityChange = (): void => {
      if (document.hidden) flushEditing()
    }

    window.addEventListener('blur', onWindowBlur)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('blur', onWindowBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const startEditCell = useCallback((li: number, ci: number, cellText: string, fieldIdx?: number, sliceField?: boolean) => {
    if (fieldIdx === undefined) return // 无字段映射（tick 单元格等），不可编辑
    setSelectedLines(new Set())
    pushUndo(prevRef.current)
    lastFocusedLine.current = li
    setEditCell({ lineIndex: li, cellIndex: ci, fieldIdx, sliceField: sliceField || false })
    // 将占位符 \u00A0 视为空值
    const initVal = cellText === '\u00A0' ? '' : (cellText || '')
    editCellOrigValRef.current = initVal
    setEditVal(initVal)
    setTimeout(() => {
      inputRef.current?.focus()
      if (canUseTypeCompletion(li, fieldIdx)) {
        const pos = inputRef.current?.selectionStart ?? initVal.length
        updateCompletion(initVal, pos)
      }
    }, 0)
  }, [pushUndo, canUseTypeCompletion, updateCompletion])

  const attachResourceFileToLine = useCallback(async (lineIndex: number): Promise<string | null> => {
    if (!isResourceTableDoc || !projectDir) return null
    const ln = parsedLines[lineIndex]
    if (!ln || (ln.type !== 'resource' && ln.type !== 'constant')) return null

    try {
      const result = await window.api.project.importResourceFile(projectDir)
      if (!result.success) {
        if (!result.canceled) {
          window.alert('添加资源文件失败：' + result.message)
        }
        return null
      }

      const fileName = result.fileName
      const rawLine = lines[lineIndex] || ''
      const safeName = `"${fileName.replace(/"/g, '\\"')}"`
      const withFile = rebuildLineField(rawLine, 1, safeName, false)
      const withType = rebuildLineField(withFile, 2, inferResourceTypeByFileName(fileName), false)

      pushUndo(currentText)
      const nl = [...lines]
      nl[lineIndex] = withType
      const nt = nl.join('\n')
      setCurrentText(nt)
      prevRef.current = nt
      onChange(nt)

      return fileName
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      window.alert('添加资源文件失败：' + msg)
      return null
    }
  }, [isResourceTableDoc, projectDir, parsedLines, lines, pushUndo, currentText, onChange])

  const openResourcePreview = useCallback(async (lineIndex: number) => {
    if (!isResourceTableDoc) return
    const ln = parsedLines[lineIndex]
    if (!ln || (ln.type !== 'resource' && ln.type !== 'constant')) return
    const resourceName = (ln.fields[0] || '').trim()
    let resourceFile = unquote((ln.fields[1] || '').trim())
    if (!resourceFile) {
      const imported = await attachResourceFileToLine(lineIndex)
      if (!imported) return
      // 空内容单元格双击仅用于快速绑定文件，不自动弹预览窗口。
      return
    }
    const resourceType = (ln.fields[2] || '').trim() || inferResourceTypeByFileName(resourceFile)
    setResourcePreview({
      visible: true,
      lineIndex,
      resourceName,
      resourceFile,
      resourceType,
      version: Date.now(),
    })
  }, [isResourceTableDoc, parsedLines, attachResourceFileToLine])

  const handleReplaceResourceFile = useCallback(async () => {
    if (!resourcePreview.visible || !projectDir || !resourcePreview.resourceFile || resourcePreviewBusy) return
    setResourcePreviewBusy(true)
    try {
      const result = await window.api.project.replaceResourceFile(projectDir, resourcePreview.resourceFile)
      if (result.success) {
        setResourcePreview(prev => ({ ...prev, version: Date.now() }))
      } else if (!result.canceled) {
        window.alert('更换资源文件失败：' + result.message)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      window.alert('更换资源文件失败：' + msg)
    } finally {
      setResourcePreviewBusy(false)
    }
  }, [projectDir, resourcePreview.visible, resourcePreview.resourceFile, resourcePreviewBusy])

  useEffect(() => {
    if (!resourcePreview.visible || !projectDir || !resourcePreview.resourceFile) {
      setResourcePreviewSrc('')
      setResourcePreviewMsg('')
      setResourcePreviewMeta(null)
      setResourcePreviewMediaMeta({})
      return
    }

    const viewType = resourcePreview.resourceType || inferResourceTypeByFileName(resourcePreview.resourceFile)
    const shouldLoad = viewType === '图片' || viewType === '声音' || viewType === '视频'

    let canceled = false
    setResourcePreviewMsg(shouldLoad ? '正在加载预览...' : '当前资源类型暂不支持内嵌预览，可使用“更换文件”来替换资源。')
    setResourcePreviewSrc('')
    setResourcePreviewMediaMeta({})
    ;(async () => {
      try {
        const result = await window.api.project.getResourcePreviewData(projectDir, resourcePreview.resourceFile, shouldLoad)
        if (canceled) return
        if (!result.success) {
          setResourcePreviewMeta(null)
          setResourcePreviewMsg('预览加载失败：' + result.message)
          return
        }
        setResourcePreviewMeta({
          mime: result.mime,
          ext: result.ext,
          filePath: result.filePath,
          sizeBytes: result.sizeBytes,
          modifiedAtMs: result.modifiedAtMs,
        })

        if (shouldLoad && result.base64) {
          setResourcePreviewSrc(`data:${result.mime};base64,${result.base64}`)
          setResourcePreviewMsg('')
        } else {
          setResourcePreviewSrc('')
        }
      } catch (error) {
        if (canceled) return
        setResourcePreviewMeta(null)
        const msg = error instanceof Error ? error.message : String(error)
        setResourcePreviewMsg('预览加载失败：' + msg)
      }
    })()

    return () => { canceled = true }
  }, [projectDir, resourcePreview.visible, resourcePreview.resourceFile, resourcePreview.resourceType, resourcePreview.version])

  const startEditLine = useCallback((li: number, clientX?: number, containerLeft?: number, isVirtual?: boolean, skipPushUndo = false) => {
    // 使用 prevRef 获取最新行数据，防止 commit 修改文本后 React 尚未重渲染导致闭包中 lines 过时
    const latestText = prevRef.current
    const latestLines = latestText.split('\n')
    let text = isVirtual ? '' : (latestLines[li] || '')
    // 对于有流程线的普通行，剥离被流程线覆盖的前导空格
    let flowIndent = ''
    if (!isVirtual) {
      // 若 commit 刚修改了文本但尚未重渲染，flowLines 可能过时，需重新计算
      const currentFlowLines = (latestText === currentText) ? flowLines : computeFlowLines(buildBlocks(latestText, isClassModule, isResourceTableDoc))
      const segs = currentFlowLines.map.get(li) || []
      if (segs.length > 0) {
        const lineMaxDepth = Math.max(...segs.map(s => s.depth)) + 1
        const stripCount = lineMaxDepth * 4
        const leadingSpaces = text.match(/^ */)?.[0] || ''
        const actualStrip = Math.min(stripCount, leadingSpaces.length)
        const hasEditableContent = text.trim().length > 0
        // 仅空行采用流程深度占位缩进；
        // 对已有内容行，若没有可剥离的真实前导空格，则不注入虚拟缩进，避免失焦格式化时凭空 +4/+8。
        flowIndent = actualStrip > 0
          ? ' '.repeat(actualStrip)
          : (hasEditableContent ? '' : ' '.repeat(stripCount))
        if (actualStrip > 0) {
          text = text.slice(actualStrip)
        }
        wasFlowStartRef.current = segs.some(s => s.type === 'start')
        if (wasFlowStartRef.current) {
          const origLineText = latestLines[li] || ''
          const kwOfLine = extractFlowKw(origLineText)
          wasFlowKwRef.current = (kwOfLine && FLOW_START[kwOfLine]) ? kwOfLine : ''
          wasFlowOrigIndentRef.current = origLineText.match(/^ */)?.[0] || ''
        } else {
          wasFlowKwRef.current = ''
          wasFlowOrigIndentRef.current = ''
        }
      } else {
        wasFlowStartRef.current = false
        wasFlowKwRef.current = ''
        wasFlowOrigIndentRef.current = ''
      }
    }
    if (!skipPushUndo) pushUndo(latestText)
    setSelectedLines(new Set())
    lastFocusedLine.current = li
    flowIndentRef.current = flowIndent
    codeLineEditOrigValRef.current = text
    setEditCell({ lineIndex: li, cellIndex: -1, fieldIdx: -1, sliceField: false, isVirtual }); setEditVal(text)
    setTimeout(() => {
      if (!inputRef.current) return
      const wrapper = wrapperRef.current
      const prevScrollLeft = wrapper?.scrollLeft ?? 0
      const prevScrollTop = wrapper?.scrollTop ?? 0
      try {
        inputRef.current.focus({ preventScroll: true })
      } catch {
        inputRef.current.focus()
      }
      if (clientX !== undefined && containerLeft !== undefined) {
        let relX = clientX - containerLeft // 相对于代码行内容区域
        // 减去流程线段占用的宽度，使光标定位到输入框内正确位置
        const currentFlowLines2 = (latestText === currentText) ? flowLines : computeFlowLines(buildBlocks(latestText, isClassModule, isResourceTableDoc))
        const segs2 = currentFlowLines2.map.get(li) || []
        if (segs2.length > 0) {
          const lineMaxDepth2 = Math.max(...segs2.map(s => s.depth)) + 1
          // 每个流程段宽度为 4ch，用 canvas 测量实际像素宽度
          const canvas2 = document.createElement('canvas')
          const ctx2 = canvas2.getContext('2d')
          if (ctx2) {
            ctx2.font = '13px Consolas, "Microsoft YaHei", monospace'
            const segWidth = ctx2.measureText('    '.repeat(lineMaxDepth2)).width
            relX -= segWidth
            if (relX < 0) relX = 0
          }
        }
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.font = '13px "Consolas", "Cascadia Mono", "MS Gothic", "NSimSun", "Microsoft YaHei UI", monospace'
          const fullWidth = ctx.measureText(text).width
          let pos = text.length
          if (relX < fullWidth) {
            for (let i = 1; i <= text.length; i++) {
              const w = ctx.measureText(text.slice(0, i)).width
              if (w > relX) {
                const wPrev = ctx.measureText(text.slice(0, i - 1)).width
                pos = (relX - wPrev < w - relX) ? i - 1 : i
                break
              }
            }
          }
          inputRef.current.selectionStart = pos
          inputRef.current.selectionEnd = pos
        }
      }
      if (wrapper) {
        wrapper.scrollLeft = prevScrollLeft
        wrapper.scrollTop = prevScrollTop
      }
    }, 0)
  }, [currentText, pushUndo, flowLines])

  const suppressInlineBlurCommit = (durationMs = 250): void => {
    suppressBlurCommitUntilRef.current = Date.now() + durationMs
  }

  const shouldSuppressBlurCommit = useCallback((): boolean => {
    if (preserveEditOnScrollbarRef.current) return true
    if (Date.now() < suppressBlurCommitUntilRef.current) {
      suppressBlurCommitUntilRef.current = 0
      return true
    }
    return false
  }, [])

  const isEditingSameCell = useCallback((target: {
    lineIndex: number
    cellIndex: number
    fieldIdx: number
    paramIdx?: number
    isVirtual?: boolean
  }): boolean => {
    const state = editCellRef.current
    if (!state) return false
    return state.lineIndex === target.lineIndex
      && state.cellIndex === target.cellIndex
      && state.fieldIdx === target.fieldIdx
      && state.paramIdx === target.paramIdx
      && state.isVirtual === target.isVirtual
  }, [])

  const refocusActiveEditorInput = useCallback(() => {
    const state = editCellRef.current
    if (!state) return
    const target = state.paramIdx !== undefined ? (paramInputRef.current || inputRef.current) : inputRef.current
    if (!target) return
    try {
      target.focus({ preventScroll: true })
    } catch {
      target.focus()
    }
  }, [])

  useEffect(() => {
    const handleMouseUp = (): void => {
      if (!preserveEditOnScrollbarRef.current) return
      preserveEditOnScrollbarRef.current = false
      setTimeout(() => {
        refocusActiveEditorInput()
      }, 0)
    }
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [refocusActiveEditorInput])

  useEffect(() => {
    if (!editCell) return
    const timer = window.setTimeout(() => {
      const active = document.activeElement as HTMLElement | null
      if (active === inputRef.current || active === paramInputRef.current) return
      refocusActiveEditorInput()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [editCell, visibleBlocks, refocusActiveEditorInput])

  const {
    getFlowAutoExpandCandidate,
    getCodeLineNavigationAction,
    getEmptyCodeLineDeleteAction,
    getParenScopedKeyAction,
  } = useCodeLineEditor()

  const applyTextChange = useCallback((nextText: string) => {
    setCurrentText(nextText)
    prevRef.current = nextText
    onChange(nextText)
  }, [onChange])

  const beginCodeLineEdit = useCallback((lineIndex: number, value: string) => {
    setEditCell({ lineIndex, cellIndex: -1, fieldIdx: -1, sliceField: false })
    codeLineEditOrigValRef.current = value
    setEditVal(value)
  }, [])

  const focusCodeInputAt = useCallback((position = 0) => {
    setTimeout(() => {
      if (!inputRef.current) return
      inputRef.current.focus()
      inputRef.current.selectionStart = position
      inputRef.current.selectionEnd = position
    }, 0)
  }, [])

  const beginCodeLineEditByTargetLine = useCallback((lineIndex: number, sourceLines: string[]) => {
    const targetLine = sourceLines[lineIndex] || ''
    beginCodeLineEdit(lineIndex, targetLine)
  }, [beginCodeLineEdit])

  const applyCodeLineNavigation = useCallback((navAction: CodeLineNavigationAction) => {
    if (!navAction) return
    commit()
    setTimeout(() => {
      const latestLines = prevRef.current.split('\n')
      if (navAction.type === 'upOrDown') {
        if (navAction.targetLine >= 0 && navAction.targetLine < latestLines.length) {
          startEditLine(navAction.targetLine)
          setTimeout(() => {
            if (!inputRef.current) return
            const maxPos = inputRef.current.value.length
            const pos = Math.min(navAction.keepHorizontalPos, maxPos)
            inputRef.current.selectionStart = pos
            inputRef.current.selectionEnd = pos
          }, 0)
        }
        return
      }

      if (navAction.type === 'leftToPrevLineEnd') {
        if (navAction.targetLine >= 0 && navAction.targetLine < latestLines.length) {
          startEditLine(navAction.targetLine)
          setTimeout(() => {
            if (!inputRef.current) return
            const end = inputRef.current.value.length
            inputRef.current.selectionStart = end
            inputRef.current.selectionEnd = end
          }, 0)
        }
        return
      }

      if (navAction.type === 'rightToNextLineStart') {
        if (navAction.targetLine < latestLines.length) {
          startEditLine(navAction.targetLine)
          setTimeout(() => {
            if (!inputRef.current) return
            inputRef.current.selectionStart = 0
            inputRef.current.selectionEnd = 0
          }, 0)
        }
      }
    }, 0)
  }, [commit, startEditLine])

  const applyEmptyCodeLineDelete = useCallback((params: {
    action: EmptyCodeLineDeleteAction
    lineIndex: number
    isVirtual: boolean | undefined
  }) => {
    const { action, lineIndex, isVirtual } = params
    if (action.type === 'forbidden') return

    const getSubAnchorInfoForLine = (ls: string[], targetLine: number): { anchorLine: number; ordinaryLines: number[] } | null => {
      if (targetLine < 0 || targetLine >= ls.length) return null
      let subStart = -1
      for (let i = targetLine; i >= 0; i--) {
        const t = (ls[i] || '').replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ')) { subStart = i; break }
        if (t.startsWith('.程序集 ')) break
      }
      if (subStart < 0) return null

      let subEnd = ls.length
      for (let i = subStart + 1; i < ls.length; i++) {
        const t = (ls[i] || '').replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ') || t.startsWith('.程序集 ')) { subEnd = i; break }
      }

      const ordinaryLines: number[] = []
      for (let i = subStart + 1; i < subEnd; i++) {
        const t = (ls[i] || '').replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.')) continue
        ordinaryLines.push(i)
      }
      if (ordinaryLines.length === 0) return null
      return { anchorLine: ordinaryLines[0], ordinaryLines }
    }

    let deleteIndex = lineIndex
    let focusLineAfter = action.targetLine
    const anchorInfo = getSubAnchorInfoForLine(lines, lineIndex)
    if (anchorInfo && anchorInfo.anchorLine === lineIndex) {
      const nextOrdinary = anchorInfo.ordinaryLines.find(i => i > lineIndex)
      if (nextOrdinary === undefined) {
        // 子程序仅剩保底空行时，不允许再删掉它。
        return
      }
      deleteIndex = nextOrdinary
      focusLineAfter = lineIndex
    }

    suppressInlineBlurCommit()
    pushUndo(currentText)
    const nl = [...lines]
    nl.splice(deleteIndex, 1)
    const nt = nl.join('\n')
    applyTextChange(nt)
    flowIndentRef.current = ''
    flowMarkRef.current = ''
    setTimeout(() => {
      const latestLines = prevRef.current.split('\n')
      if (latestLines.length === 0) {
        setEditCell(null)
        focusWrapper()
        return
      }
      const clampedLi = Math.max(0, Math.min(focusLineAfter, latestLines.length - 1))
      startEditLine(clampedLi, undefined, undefined, isVirtual, true)
      setTimeout(() => {
        if (!inputRef.current) return
        const pos = action.preferPrevLine ? inputRef.current.value.length : 0
        inputRef.current.selectionStart = pos
        inputRef.current.selectionEnd = pos
      }, 0)
    }, 0)
  }, [applyTextChange, currentText, focusWrapper, lines, pushUndo, startEditLine])

  const applyParenScopedAction = useCallback((params: {
    action: ParenScopedKeyAction
    lineIndex: number
  }) => {
    const { action, lineIndex } = params
    if (!action) return

    suppressInlineBlurCommit()
    setAcVisible(false)

    if (action.type === 'insertBlankLine') {
      if (expandedLines.has(lineIndex)) {
        setExpandedLines(prev => {
          const next = new Set(prev)
          next.delete(lineIndex)
          return next
        })
      }
      const savedFlowMark = flowMarkRef.current
      commit()
      setTimeout(() => {
        const latestText = prevRef.current
        const latestLines = latestText.split('\n')
        const fi = savedFlowMark
          ? savedFlowMark.slice(0, savedFlowMark.length - 1)
          : (flowIndentRef.current || '')
        const newLineContent = savedFlowMark || fi
        const insertAt = action.insertAbove ? lineIndex : lineIndex + 1
        latestLines.splice(insertAt, 0, newLineContent)
        const nt = latestLines.join('\n')
        pushUndo(latestText)
        applyTextChange(nt)
        flowMarkRef.current = savedFlowMark
        flowIndentRef.current = savedFlowMark ? '' : fi
        wasFlowStartRef.current = false
        beginCodeLineEdit(insertAt, '')
        focusCodeInputAt(0)
      }, 0)
      return
    }

    if (action.type === 'jumpToNextLine') {
      commit()
      setTimeout(() => {
        const latestText = prevRef.current
        const latestLines = latestText.split('\n')
        const nextLi = lineIndex + 1
        if (nextLi < latestLines.length) {
          startEditLine(nextLi)
        }
      }, 0)
    }
  }, [applyTextChange, beginCodeLineEdit, commit, expandedLines, focusCodeInputAt, pushUndo, startEditLine])

  const applyFlowAutoExpandOnEnter = useCallback((params: {
    editCellState: EditState
    commandName: string
  }): boolean => {
    const { editCellState, commandName } = params
    debugFlowPaste('enter:auto-expand-input', {
      lineIndex: editCellState.lineIndex,
      commandName,
      isVirtual: !!editCellState.isVirtual,
      hasFlowMarker: !!flowMarkRef.current,
      editVal,
    })
    const needsExitLine = commandName === '如果' || commandName === '如果真' || commandName === '判断'
    const nl = [...lines]

    const ensureExitLine = (target: string[], exitIndent: string): string[] => {
      if (!needsExitLine) return target
      if (target.length === 0) return [exitIndent]
      const last = target[target.length - 1]
      if (last === exitIndent) return target
      return [...target, exitIndent]
    }

    if (flowMarkRef.current) {
      const markerChar = flowMarkRef.current.trimStart().charAt(0)
      const markerIndent = flowMarkRef.current.slice(0, flowMarkRef.current.length - 1)
      const preferJudgeBranchHere = commandName === '判断'
      if (preferJudgeBranchHere) {
        const trimmedInput = editVal.trim()
        const parenRange = getOuterParenRange(trimmedInput)
        const argText = parenRange ? trimmedInput.slice(parenRange.start + 1, parenRange.end).trim() : ''
        const judgeBranchLine = markerIndent + '判断（' + argText + '）'
        nl.splice(editCellState.lineIndex, 1, judgeBranchLine)
        const nt = nl.join('\n')
        applyTextChange(nt)
        const cursorLi = Math.min(editCellState.lineIndex + 1, nl.length - 1)
        beginCodeLineEditByTargetLine(cursorLi, nl)
        focusCodeInputAt(0)
        commitGuardRef.current = true
        return true
      }
      if (markerChar === '\u2060' && commandName === '判断') {
        const trimmedInput = editVal.trim()
        const parenRange = getOuterParenRange(trimmedInput)
        const argText = parenRange ? trimmedInput.slice(parenRange.start + 1, parenRange.end).trim() : ''
        const judgeBranchLine = markerIndent + '判断（' + argText + '）'
        nl.splice(editCellState.lineIndex, 1, judgeBranchLine)
        const nt = nl.join('\n')
        applyTextChange(nt)
        const cursorLi = Math.min(editCellState.lineIndex + 1, nl.length - 1)
        beginCodeLineEditByTargetLine(cursorLi, nl)
        focusCodeInputAt(0)
        commitGuardRef.current = true
        return true
      } else {
        let formattedLines = trimTrailingEmptyFormattedLine(formatCommandLine(markerIndent + editVal))
        if (formattedLines.length > 1) {
          const markerParentIndent = markerIndent.length >= 4 ? markerIndent.slice(0, -4) : ''
          formattedLines = ensureExitLine(formattedLines, markerParentIndent)
          const isLoopFlow = FLOW_LOOP_KW.has(commandName)
          if (isLoopFlow) {
            const mainLine = formattedLines[0]
            const loopBody = buildLoopFlowBodyLines(mainLine, formattedLines.slice(1))
            const bodyIndent = loopBody.bodyIndent
            const withBody = loopBody.lines
            nl.splice(editCellState.lineIndex, 1, ...withBody)
            const insertPos = editCellState.lineIndex + withBody.length
            nl.splice(insertPos, 0, flowMarkRef.current)
            const nt = nl.join('\n')
            applyTextChange(nt)
            const cursorLi = editCellState.lineIndex + 1
            flowMarkRef.current = ''
            flowIndentRef.current = bodyIndent
            wasFlowStartRef.current = false
            beginCodeLineEdit(cursorLi, '')
          } else {
            const cursorLi = applyFlowMarkerSection({
              lines: nl,
              lineIndex: editCellState.lineIndex,
              formattedLines,
              flowMark: flowMarkRef.current,
            })
            const nt = nl.join('\n')
            applyTextChange(nt)
            beginCodeLineEditByTargetLine(cursorLi, nl)
          }
          focusCodeInputAt(0)
          commitGuardRef.current = true
          return true
        }
      }
    } else {
      let enterIndent = flowIndentRef.current
      const isBareEnterCmd = /^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*\s*$/.test(editVal.trim())
      if (isBareEnterCmd && enterIndent.length >= 4) {
        enterIndent = enterIndent.slice(0, enterIndent.length - 4)
      }
      const preferJudgeBranch = commandName === '判断' && shouldPreferJudgeBranchAtLine(editCellState.lineIndex)
      debugFlowPaste('enter:auto-expand-judge-check', {
        lineIndex: editCellState.lineIndex,
        commandName,
        preferJudgeBranch,
      })
      // preferJudgeBranch：用户在 .默认 之后的空 body 行键入“判断”+回车，
      // 在 .默认 之前插入 .判断 () 分支与一个空 body 行，原编辑行保持为 .默认 的空 body。
      if (preferJudgeBranch && !editCellState.isVirtual) {
        const resolveDefaultLineIdx = (): number | null => {
          const around = getFlowStructureAround(lines, editCellState.lineIndex)
          const prevSection = around?.sections[(around?.sectionIdx ?? 0) - 1]
          if (around && prevSection && prevSection.char === '默认') return prevSection.startLine

          // 与判定一致的兜底：当前行位于“默认 与 判断结束”之间。
          const findPrevNonEmpty = (): { index: number; kw: string | null } | null => {
            for (let i = editCellState.lineIndex - 1; i >= 0; i--) {
              const line = lines[i] || ''
              if (!line.trim()) continue
              return { index: i, kw: extractFlowKw(line) }
            }
            return null
          }
          const findNextNonEmpty = (): { index: number; kw: string | null } | null => {
            for (let i = editCellState.lineIndex + 1; i < lines.length; i++) {
              const line = lines[i] || ''
              if (!line.trim()) continue
              return { index: i, kw: extractFlowKw(line) }
            }
            return null
          }
          const prevNonEmpty = findPrevNonEmpty()
          const nextNonEmpty = findNextNonEmpty()
          if (prevNonEmpty?.kw === '默认' && nextNonEmpty?.kw === '判断结束') {
            return prevNonEmpty.index
          }
          return null
        }

        const defaultLineIdx = resolveDefaultLineIdx()
        if (defaultLineIdx != null) {
          const findIndentLen = (lineText: string): number => lineText.length - lineText.replace(/^ +/, '').length
          const findJudgeControlIndentLen = (): number => {
            for (let i = defaultLineIdx - 1; i >= 0; i--) {
              const line = lines[i] || ''
              const kw = extractFlowKw(line)
              if (kw === '判断开始' || kw === '判断') return findIndentLen(line)
            }
            const defaultLine = lines[defaultLineIdx] || ''
            return findIndentLen(defaultLine)
          }

          const controlIndentLen = findJudgeControlIndentLen()
          const judgeIndentLen = controlIndentLen
          const judgeRawLine = formatCommandLine(enterIndent + editVal, { preferJudgeBranch: true })[0]
          const judgeLine = ' '.repeat(judgeIndentLen) + judgeRawLine.trimStart()
          const normalizeControlLineIndent = (targetLineIndex: number): void => {
            if (targetLineIndex < 0 || targetLineIndex >= nl.length) return
            const raw = nl[targetLineIndex] || ''
            if (!raw.trim()) return
            nl[targetLineIndex] = ' '.repeat(controlIndentLen) + raw.trimStart()
          }

          // 保持判断结构缩进一致：.判断/.默认/.判断结束 与 .判断开始 控制行对齐。
          normalizeControlLineIndent(defaultLineIdx)
          for (let i = defaultLineIdx + 1; i < nl.length; i++) {
            const line = nl[i] || ''
            if (!line.trim()) continue
            if (extractFlowKw(line) === '判断结束') normalizeControlLineIndent(i)
            break
          }

          // 还原原编辑行为空 body（清掉用户输入的“判断”文本，仅保留缩进或空串）
          nl[editCellState.lineIndex] = ''
          // 在 .默认 行之前插入 ".判断 ()" 与一个空 body 行
          nl.splice(defaultLineIdx, 0, judgeLine, '')
          const nt = nl.join('\n')
          applyTextChange(nt)
          // 光标移到新插入 .判断 () 行下方的空 body 行
          const cursorLi = defaultLineIdx + 1
          flowMarkRef.current = ''
          flowIndentRef.current = ''
          wasFlowStartRef.current = false
          beginCodeLineEdit(cursorLi, '')
          focusCodeInputAt(0)
          commitGuardRef.current = true
          debugFlowPaste('enter:auto-expand-judge-branch-inserted', {
            lineIndex: editCellState.lineIndex,
            defaultLineIdx,
            judgeLine,
            cursorLi,
          })
          return true
        }
        debugFlowPaste('enter:auto-expand-judge-branch-skipped', {
          lineIndex: editCellState.lineIndex,
          reason: 'default-line-not-found',
        })
      }
      const formattedLines = formatCommandLine(enterIndent + editVal, { preferJudgeBranch })
      if (formattedLines.length > 1) {
        const mainLine = formattedLines[0]
        let extraLines = formattedLines.slice(1)
        const afterIdx = editCellState.isVirtual ? editCellState.lineIndex + 2 : editCellState.lineIndex + 1
        const currentIndentLen = mainLine.length - mainLine.trimStart().length
        const remainingLines = collectRemainingLinesInCurrentScope(lines, afterIdx, currentIndentLen)
        extraLines = removeDuplicateFlowAutoEndings(extraLines, remainingLines)
        const exitIndent = ' '.repeat(Math.max(0, currentIndentLen - 4))
        extraLines = ensureExitLine(extraLines, exitIndent)

        const isLoopFlow = FLOW_LOOP_KW.has(commandName)
        if (isLoopFlow) {
          const loopBody = buildLoopFlowBodyLines(mainLine, extraLines)
          const bodyIndent = loopBody.bodyIndent
          if (editCellState.isVirtual) {
            nl.splice(editCellState.lineIndex + 1, 0, ...loopBody.lines)
          } else {
            nl.splice(editCellState.lineIndex, 1, ...loopBody.lines)
          }
          const nt = nl.join('\n')
          applyTextChange(nt)
          const baseLi = getAutoExpandCursorBaseLine(editCellState.lineIndex, !!editCellState.isVirtual)
          const cursorLi = baseLi + 1
          flowIndentRef.current = bodyIndent
          wasFlowStartRef.current = false
          beginCodeLineEdit(cursorLi, '')
        } else {
          applyMainAndExtraLines({
            lines: nl,
            lineIndex: editCellState.lineIndex,
            isVirtual: !!editCellState.isVirtual,
            mainLine,
            extraLines,
          })
          const nt = nl.join('\n')
          applyTextChange(nt)
          const baseLi = getAutoExpandCursorBaseLine(editCellState.lineIndex, !!editCellState.isVirtual)
          const cursorLi = baseLi + 1
          beginCodeLineEditByTargetLine(cursorLi, nl)
        }
        focusCodeInputAt(0)
        commitGuardRef.current = true
        debugFlowPaste('enter:auto-expand-flow-inserted', {
          lineIndex: editCellState.lineIndex,
          commandName,
          insertedLines: formattedLines.length,
          isVirtual: !!editCellState.isVirtual,
          preferJudgeBranch,
        })
        return true
      }
    }

    return false
  }, [applyTextChange, beginCodeLineEdit, beginCodeLineEditByTargetLine, debugFlowPaste, editVal, focusCodeInputAt, formatCommandLine, lines, shouldPreferJudgeBranchAtLine])

  const applyCodeLineSplitOnEnter = useCallback((params: {
    editCellState: EditState
    beforeText: string
    afterText: string
  }) => {
    const { editCellState, beforeText, afterText } = params
    const nl = [...lines]

    if (editCellState.isVirtual) {
      nl.splice(editCellState.lineIndex + 1, 0, beforeText, afterText)
      const nt = nl.join('\n')
      applyTextChange(nt)
      const newLi = editCellState.lineIndex + 2
      beginCodeLineEdit(newLi, afterText)
    } else {
      const fi = flowIndentRef.current
      const curSegs = flowLines.map.get(editCellState.lineIndex) || []
      const hasFlowEnd = curSegs.some(s => s.type === 'end')
      const newFi = hasFlowEnd && fi.length >= 4 ? fi.slice(0, fi.length - 4) : fi
      const fmtBefore = afterText.trim() === '' ? formatCommandLine(fi + beforeText)[0].slice(fi.length) : beforeText
      nl[editCellState.lineIndex] = fi + fmtBefore
      nl.splice(editCellState.lineIndex + 1, 0, newFi + afterText)
      const nt = nl.join('\n')
      applyTextChange(nt)
      const newLi = editCellState.lineIndex + 1
      beginCodeLineEdit(newLi, afterText)
      flowIndentRef.current = newFi
      wasFlowStartRef.current = false
    }

    focusCodeInputAt(0)
  }, [applyTextChange, beginCodeLineEdit, flowLines, focusCodeInputAt, formatCommandLine, lines])

  const applyTableRowEnterInsert = useCallback((editCellState: EditState): boolean => {
    if (editCellState.cellIndex < 0 || editCellState.fieldIdx === undefined || editCellState.fieldIdx < 0) {
      return false
    }

    const li = editCellState.lineIndex
    let rawLine = lines[li]
    rawLine = rebuildLineField(rawLine, editCellState.fieldIdx, editVal, editCellState.sliceField)

    const newLine = getTableRowInsertTemplate(rawLine)
    if (!newLine) return false

    let nl = [...lines]
    nl[li] = rawLine

    if (editCellState.fieldIdx === 0) {
      const origRaw = lines[li]
      const trimmedOrig = origRaw.replace(/[\r\t]/g, '').trim()
      nl = applyScopedVariableRename({
        lines: nl,
        lineIndex: li,
        declarationLine: origRaw,
        oldName: editCellOrigValRef.current,
        newName: editVal,
      })

      if (isClassModule && trimmedOrig.startsWith('.程序集 ')) {
        const oName = editCellOrigValRef.current.trim()
        const nName = editVal.trim()
        if (oName && nName && oName !== nName) {
          onClassNameRename?.(oName, nName)
        }
      }
    }

    nl.splice(li + 1, 0, newLine)
    const nt = nl.join('\n')
    applyTextChange(nt)
    const newLi = li + 1
    editCellOrigValRef.current = ''
    setEditCell({ lineIndex: newLi, cellIndex: 0, fieldIdx: 0, sliceField: false })
    setEditVal('')
    setTimeout(() => { inputRef.current?.focus() }, 0)
    return true
  }, [applyTextChange, editVal, isClassModule, lines, onClassNameRename])

  const applyCustomPasteShortcut = useCallback((): boolean => {
    if (editCell && editCell.cellIndex === -1 && editCell.paramIdx === undefined) return false
    if (shouldUseNativeInputPaste(editCell)) return false

    setAcVisible(false)
    navigator.clipboard.readText().then(clipText => {
      const cursorLine = editCell?.lineIndex ?? lastFocusedLine.current
      debugFlowPaste('paste-shortcut:input', {
        cursorLine,
        clipPreview: String(clipText || '').replace(/\r\n?/g, '\n').split('\n').slice(0, 8),
        clipLength: (clipText || '').length,
      })
      const pasteResult = buildMultiLinePasteResult({
        currentText,
        clipText,
        cursorLine,
        sanitizePastedText: sanitizePastedTextForCurrent,
        extractAssemblyVarLines: extractAssemblyVarLinesFromPasted,
        extractRoutedDeclarationLines: extractRoutedDeclarationLinesFromPasted,
      })
      if (!pasteResult) return
      if (pasteResult.routedDeclarations.length > 0) {
        onRouteDeclarationPaste?.(pasteResult.routedDeclarations)
      }
      debugFlowPaste('paste-shortcut:result', {
        insertAt: pasteResult.insertAt,
        pastedLineCount: pasteResult.pastedLineCount,
        resultPreview: pasteResult.nextText.split('\n').slice(Math.max(0, pasteResult.insertAt - 2), pasteResult.insertAt + pasteResult.pastedLineCount + 3),
      })
      pushUndo(currentText)
      const nt = pasteResult.nextText
      applyTextChange(nt)
      const newSel = new Set<number>()
      for (let i = 0; i < pasteResult.pastedLineCount; i++) newSel.add(pasteResult.insertAt + i)
      setSelectedLines(newSel)
      lastFocusedLine.current = pasteResult.insertAt + pasteResult.pastedLineCount - 1
    })

    return true
  }, [applyTextChange, currentText, debugFlowPaste, editCell, pushUndo, shouldUseNativeInputPaste])

  const applyTypeCellSpaceGuard = useCallback((): boolean => {
    return handleTypeCellSpaceGuard({
      isTypeCellEdit: !!(editCell && editCell.cellIndex >= 0 && canUseTypeCompletion(editCell.lineIndex, editCell.fieldIdx)),
      acVisible,
      acItems,
      acIndex,
      onExpandMore: expandMoreCompletion,
      onApplyCompletion: applyCompletion,
    })
  }, [acIndex, acItems, acVisible, applyCompletion, editCell])

  const applyCompletionPopupKey = useCallback((key: string): boolean => {
    return handleCompletionPopupKey({
      key,
      acVisible,
      acItems,
      acIndex,
      onSetAcIndex: setAcIndex,
      onExpandMore: expandMoreCompletion,
      onApplyCompletion: applyCompletion,
      onHidePopup: () => setAcVisible(false),
    })
  }, [acIndex, acItems, acVisible, applyCompletion])

  const applyEnterKey = useCallback((cursorPos: number): void => {
    suppressInlineBlurCommit()
    setAcVisible(false)
    if (editCell && editCell.cellIndex < 0 && expandedLines.has(editCell.lineIndex)) {
      setExpandedLines(prev => {
        const next = new Set(prev)
        next.delete(editCell.lineIndex)
        return next
      })
    }

    if (editCell && editCell.cellIndex < 0) {
      const before = editVal.slice(0, cursorPos)
      const after = editVal.slice(cursorPos)

      // ===== 流程命令自动格式化：输入流程命令后按回车自动展开结构 =====
      const autoExpand = getFlowAutoExpandCandidate({ editValue: editVal, trailingText: after })
      if (autoExpand) {
        const cmdCheckName = autoExpand?.commandName || ''
        if (FLOW_AUTO_COMPLETE[cmdCheckName]) {
          if (applyFlowAutoExpandOnEnter({ editCellState: editCell, commandName: cmdCheckName })) return
        }
      }

      applyCodeLineSplitOnEnter({ editCellState: editCell, beforeText: before, afterText: after })
      return
    }

    if (editCell && editCell.cellIndex >= 0 && editCell.fieldIdx >= 0) {
      if (!applyTableRowEnterInsert(editCell)) commit()
      return
    }

    commit()
  }, [
    commit,
    editCell,
    editVal,
    expandedLines,
    applyCodeLineSplitOnEnter,
    applyFlowAutoExpandOnEnter,
    applyTableRowEnterInsert,
    getFlowAutoExpandCandidate,
  ])

  const applyEmptyDeleteKey = useCallback((key: 'Backspace' | 'Delete'): { handled: boolean; preventDefault: boolean } => {
    if (!(editCell && editCell.cellIndex < 0 && editVal.trim() === '' && lines.length > 1)) {
      return { handled: false, preventDefault: false }
    }

    const li = editCell.lineIndex
    const deleteAction = getEmptyCodeLineDeleteAction({
      lines,
      lineIndex: li,
      key,
    })
    if (deleteAction.type === 'forbidden') {
      return { handled: true, preventDefault: true }
    }

    applyEmptyCodeLineDelete({ action: deleteAction, lineIndex: li, isVirtual: editCell.isVirtual })
    return { handled: true, preventDefault: true }
  }, [applyEmptyCodeLineDelete, editCell, editVal, getEmptyCodeLineDeleteAction, lines])

  const applyArrowNavigationKey = useCallback((params: {
    key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
    cursorPos: number
  }): { handled: boolean; preventDefault: boolean } => {
    const { key, cursorPos } = params
    if (!(editCell && editCell.cellIndex < 0)) {
      return { handled: false, preventDefault: false }
    }

    const navAction = getCodeLineNavigationAction({
      key,
      lineIndex: editCell.lineIndex,
      cursorPos,
      currentValueLength: editVal.length,
    })
    if (!navAction) return { handled: false, preventDefault: false }

    applyCodeLineNavigation(navAction)
    return { handled: true, preventDefault: true }
  }, [applyCodeLineNavigation, editCell, editVal, getCodeLineNavigationAction])

  const applyParenScopedKey = useCallback((params: {
    key: string
    cursorPos: number
  }): { handled: boolean; preventDefault: boolean } => {
    const { key, cursorPos } = params
    if (!(editCell && editCell.cellIndex < 0 && editCell.paramIdx === undefined)) {
      return { handled: false, preventDefault: false }
    }

    const parenScopedAction = getParenScopedKeyAction({
      key,
      editValue: editVal,
      cursorPos,
    })
    if (!parenScopedAction) return { handled: false, preventDefault: false }

    applyParenScopedAction({ action: parenScopedAction, lineIndex: editCell.lineIndex })
    return { handled: true, preventDefault: true }
  }, [applyParenScopedAction, editCell, editVal, getParenScopedKeyAction])

  const applyEscapeKey = useCallback((): { handled: boolean; preventDefault: boolean } => {
    setAcVisible(false)
    setEditCell(null)
    return { handled: true, preventDefault: false }
  }, [])

  // 参数展开小输入框专用 Ctrl+Z/Y 路由：原先这些输入框只处理 Enter/Escape，
  // Ctrl+Z 落入浏览器原生输入撤销（只撤输入内的打字历史），与文档级 undoStack 无关；
  // 而全局 keydown 监听器遇到 INPUT 焦点会直接跳过。结果就是"按 Ctrl+Z 毫无反应"。
  // 这里显式把 Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z 路由到文档撤销栈，并关闭当前未提交的编辑，
  // 避免撤销后 blur 再把旧 editVal 提交回去覆盖已恢复的文本。
  const handleParamInputCtrlKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>): boolean => {
    if (!(e.ctrlKey || e.metaKey)) return false
    const key = e.key.toLowerCase()
    if (key !== 'z' && key !== 'y') return false
    const action = dispatchCtrlShortcutWithHistory({
      key,
      shiftKey: e.shiftKey,
      undoStack: undoStack.current,
      redoStack: redoStack.current,
      currentText: prevRef.current,
      applyTextChange: (next) => {
        // 先关编辑再应用文本，保证撤销后 onBlur 的 commit 不会写回旧值。
        setEditCell(null)
        applyTextChange(next)
      },
      onSelectAll: () => { /* 参数输入框内 Ctrl+A 交给浏览器原生 */ },
      onPaste: () => false,
    })
    if (action.handled) {
      if (action.preventDefault) e.preventDefault()
      return true
    }
    return false
  }, [applyTextChange])

  const onKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    const cursorPos = e.currentTarget.selectionStart ?? 0
    // 先过守卫层：补全弹窗、Ctrl 组合键、括号上下文等高优先行为。
    const preAction = dispatchPreKeyGuards({
      key: e.key,
      cursorPos,
      ctrl: e.ctrlKey || e.metaKey,
      shiftKey: e.shiftKey,
      onTypeCellSpaceGuard: applyTypeCellSpaceGuard,
      onCompletionPopupKey: applyCompletionPopupKey,
      onCtrlShortcut: ({ key, shiftKey }) => dispatchCtrlShortcutWithHistory({
        key,
        shiftKey,
        undoStack: undoStack.current,
        redoStack: redoStack.current,
        currentText: prevRef.current,
        applyTextChange: (next) => {
          // Ctrl+Z/Y 命中文档栈时先结束当前输入态，避免 blur 后旧 editVal 被再次提交。
          setEditCell(null)
          applyTextChange(next)
        },
        onSelectAll: () => {
          // 全选基于最新文本快照，避免使用过期闭包内容。
          const ls = prevRef.current.split('\n')
          const all = new Set<number>()
          for (let i = 0; i < ls.length; i++) all.add(i)
          setSelectedLines(all)
          dragAnchor.current = 0
          setAcVisible(false)
          setEditCell(null)
          focusWrapper()
        },
        onPaste: () => applyCustomPasteShortcut(),
      }),
      onParenScopedKey: applyParenScopedKey,
    })
    if (preAction.handled) {
      if (preAction.preventDefault) e.preventDefault()
      return
    }

    // ===== 主键分派 =====
    const mainAction = dispatchMainEditingKey({
      key: e.key,
      cursorPos,
      onEnter: applyEnterKey,
      onDeleteKey: applyEmptyDeleteKey,
      onEscape: applyEscapeKey,
      onArrow: applyArrowNavigationKey,
    })
    if (mainAction.handled) {
      if (mainAction.preventDefault) e.preventDefault()
      return
    }
  }, [
    applyArrowNavigationKey,
    applyCompletionPopupKey,
    applyEmptyDeleteKey,
    applyEnterKey,
    applyEscapeKey,
    applyParenScopedKey,
    applyTypeCellSpaceGuard,
    applyTextChange,
    applyCustomPasteShortcut,
    focusWrapper,
  ])

  // 插入子程序：在当前光标所处子程序后方插入，无光标时插入到末尾
  const deleteLineSelection = useCallback((selection: Set<number>): boolean => {
    const ls = currentText.split('\n')
    const protectedLine = (() => {
      const parsed = parseLines(ls.join('\n'))
      for (let i = 0; i < parsed.length; i++) {
        if (parsed[i].type === 'assembly') return i
      }
      return -1
    })()

    const deletable = new Set<number>()
    for (const i of selection) {
      if (i < 0 || i >= ls.length) continue
      if (i === protectedLine) continue
      deletable.add(i)
    }
    const sorted = Array.from(deletable).sort((a, b) => a - b)
    if (sorted.length === 0) return false

    const checkedCmds = new Set<number>()
    const wouldBreak = sorted.some(i => {
      const st = getFlowStructureAround(ls, i)
      if (!st || checkedCmds.has(st.cmdLine)) return false
      checkedCmds.add(st.cmdLine)
      if (deletable.has(st.cmdLine)) return false
      // 仅保护结构性结束标记行（最后一段的最后一行）
      const lastSec = [...st.sections].reverse().find(s => s.char !== null)
      return !!lastSec && deletable.has(lastSec.endLine)
    })
    if (wouldBreak) return false

    pushUndo(currentText)
    const nt = ls.filter((_, i) => !deletable.has(i)).join('\n')
    setCurrentText(nt)
    prevRef.current = nt
    onChange(nt)
    setSelectedLines(new Set())
    return true
  }, [currentText, onChange, pushUndo])

  const handleWrapperContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const host = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-line-index]')
    const lineRaw = host?.dataset.lineIndex
    const lineIndex = lineRaw == null ? NaN : Number.parseInt(lineRaw, 10)
    if (Number.isFinite(lineIndex) && lineIndex >= 0) {
      if (!selectedLines.has(lineIndex)) {
        setSelectedLines(new Set([lineIndex]))
      }
      dragAnchor.current = lineIndex
      lastFocusedLine.current = lineIndex
    }
    focusWrapper()
    const menuScale = Math.max(eycScale, 0.01)
    setEditorContextMenu({
      // 编辑器根节点使用 zoom 缩放；菜单坐标需做反向缩放补偿，保证贴合鼠标点。
      x: Math.round(e.clientX / menuScale),
      y: Math.round(e.clientY / menuScale),
      lineIndex: Number.isFinite(lineIndex) && lineIndex >= 0 ? lineIndex : null,
    })
  }, [eycScale, focusWrapper, selectedLines])

  const copySelectionToClipboard = useCallback((): boolean => {
    if (selectedLines.size > 0) {
      void navigator.clipboard.writeText(getSelectedSourceText())
      return true
    }
    const selectedText = getMouseRangeSelectedSourceText()
    if (!selectedText) return false
    void navigator.clipboard.writeText(selectedText)
    return true
  }, [getMouseRangeSelectedSourceText, getSelectedSourceText, selectedLines])

  const resolveContextLineIndex = useCallback((): number => {
    if (editorContextMenu?.lineIndex !== null && editorContextMenu?.lineIndex !== undefined) {
      return editorContextMenu.lineIndex
    }
    if (selectedLines.size > 0) {
      return Math.min(...selectedLines)
    }
    return Math.max(lastFocusedLine.current, 0)
  }, [editorContextMenu?.lineIndex, selectedLines])

  const applyLineCommentState = useCallback((mode: 'block' | 'unblock') => {
    const ls = prevRef.current.split('\n')
    const targetLines = selectedLines.size > 0
      ? [...selectedLines].sort((a, b) => a - b)
      : [resolveContextLineIndex()]

    let changed = false
    for (const idx of targetLines) {
      if (idx < 0 || idx >= ls.length) continue
      const line = ls[idx] || ''
      const indent = line.match(/^\s*/)?.[0] || ''
      const body = line.slice(indent.length)

      if (mode === 'block') {
        if (!body || body.startsWith("'")) continue
        ls[idx] = `${indent}' ${body}`
        changed = true
        continue
      }

      if (body.startsWith("' ")) {
        ls[idx] = indent + body.slice(2)
        changed = true
      } else if (body.startsWith("'")) {
        ls[idx] = indent + body.slice(1)
        changed = true
      }
    }

    if (!changed) {
      setEditorContextMenu(null)
      return
    }
    const nextText = ls.join('\n')
    pushUndo(prevRef.current)
    setCurrentText(nextText)
    prevRef.current = nextText
    onChange(nextText)
    setEditorContextMenu(null)
  }, [onChange, pushUndo, resolveContextLineIndex, selectedLines])

  const pasteFromClipboardAtContext = useCallback(() => {
    if (shouldUseNativeInputPaste(editCellRef.current)) return
    void navigator.clipboard.readText().then(clipText => {
      if (!clipText) return
      const latestText = prevRef.current
      const cursorLine = editCellRef.current?.lineIndex
        ?? editorContextMenu?.lineIndex
        ?? lastFocusedLine.current
      const pasteResult = buildMultiLinePasteResult({
        currentText: latestText,
        clipText,
        cursorLine,
        sanitizePastedText: sanitizePastedTextForCurrent,
        extractAssemblyVarLines: extractAssemblyVarLinesFromPasted,
        extractRoutedDeclarationLines: extractRoutedDeclarationLinesFromPasted,
      })
      if (!pasteResult) return
      if (pasteResult.routedDeclarations.length > 0) {
        onRouteDeclarationPaste?.(pasteResult.routedDeclarations)
      }
      pushUndo(latestText)
      const nt = pasteResult.nextText
      setCurrentText(nt)
      prevRef.current = nt
      onChange(nt)
      const newSel = new Set<number>()
      for (let i = 0; i < pasteResult.pastedLineCount; i++) newSel.add(pasteResult.insertAt + i)
      setSelectedLines(newSel)
      lastFocusedLine.current = pasteResult.insertAt + pasteResult.pastedLineCount - 1
    })
  }, [editorContextMenu?.lineIndex, extractAssemblyVarLinesFromPasted, extractRoutedDeclarationLinesFromPasted, onChange, onRouteDeclarationPaste, pushUndo, sanitizePastedTextForCurrent, shouldUseNativeInputPaste])

  const applyEditorContextAction = useCallback((action: 'newSubprogram' | 'undo' | 'redo' | 'copy' | 'cut' | 'paste' | 'delete' | 'insertLine' | 'compileLine' | 'block' | 'unblock' | 'selectAll') => {
    if (action === 'newSubprogram') {
      setEditorContextMenu(null)
      ref && typeof ref !== 'function' && ref.current?.insertSubroutine?.()
      return
    }
    if (action === 'undo') {
      if (undoStack.current.length > 0) {
        const prev = undoStack.current.pop()!
        redoStack.current.push(prevRef.current)
        setCurrentText(prev)
        prevRef.current = prev
        onChange(prev)
      }
      setEditorContextMenu(null)
      return
    }
    if (action === 'redo') {
      if (redoStack.current.length > 0) {
        const next = redoStack.current.pop()!
        undoStack.current.push(prevRef.current)
        setCurrentText(next)
        prevRef.current = next
        onChange(next)
      }
      setEditorContextMenu(null)
      return
    }
    if (action === 'copy') {
      copySelectionToClipboard()
      setEditorContextMenu(null)
      return
    }
    if (action === 'cut') {
      if (selectedLines.size > 0) {
        void navigator.clipboard.writeText(getSelectedSourceText())
        deleteLineSelection(selectedLines)
      }
      setEditorContextMenu(null)
      return
    }
    if (action === 'paste') {
      pasteFromClipboardAtContext()
      setEditorContextMenu(null)
      return
    }
    if (action === 'delete') {
      if (selectedLines.size > 0) {
        deleteLineSelection(selectedLines)
      } else {
        const line = resolveContextLineIndex()
        deleteLineSelection(new Set([line]))
      }
      setEditorContextMenu(null)
      return
    }
    if (action === 'insertLine') {
      const line = resolveContextLineIndex()
      const latestLines = prevRef.current.split('\n')
      const insertAt = Math.min(Math.max(line + 1, 0), latestLines.length)
      latestLines.splice(insertAt, 0, '')
      const nextText = latestLines.join('\n')
      pushUndo(prevRef.current)
      setCurrentText(nextText)
      prevRef.current = nextText
      onChange(nextText)
      lastFocusedLine.current = insertAt
      setEditorContextMenu(null)
      window.setTimeout(() => startEditLine(insertAt, undefined, undefined, undefined, true), 0)
      return
    }
    if (action === 'compileLine') {
      // 触发与快捷键一致的按键事件；如上层已绑定 Shift+Enter，将自动复用。
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', shiftKey: true, bubbles: true }))
      setEditorContextMenu(null)
      return
    }
    if (action === 'block') {
      applyLineCommentState('block')
      return
    }
    if (action === 'unblock') {
      applyLineCommentState('unblock')
      return
    }
    const ls = prevRef.current.split('\n')
    const all = new Set<number>()
    for (let i = 0; i < ls.length; i++) all.add(i)
    setSelectedLines(all)
    dragAnchor.current = 0
    setEditorContextMenu(null)
  }, [applyLineCommentState, copySelectionToClipboard, deleteLineSelection, getSelectedSourceText, onChange, pasteFromClipboardAtContext, pushUndo, ref, resolveContextLineIndex, selectedLines, startEditLine])

  const canUndoContextAction = undoStack.current.length > 0
  const canRedoContextAction = redoStack.current.length > 0
  const hasLineSelection = selectedLines.size > 0
  const hasCopySelection = hasLineSelection || (getMouseRangeSelectedSourceText() || '').length > 0
  const canCutContextAction = hasLineSelection

  useEffect(() => {
    if (!editorContextMenu) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const key = (event.key || '').toLowerCase()
      if (key === 'n') {
        event.preventDefault()
        applyEditorContextAction('newSubprogram')
        return
      }
      if (key === 'u') {
        if (!canUndoContextAction) return
        event.preventDefault()
        applyEditorContextAction('undo')
        return
      }
      if (key === 'y') {
        if (!canRedoContextAction) return
        event.preventDefault()
        applyEditorContextAction('redo')
        return
      }
      if (key === 'c') {
        if (!hasCopySelection) return
        event.preventDefault()
        applyEditorContextAction('copy')
        return
      }
      if (key === 't') {
        if (!canCutContextAction) return
        event.preventDefault()
        applyEditorContextAction('cut')
        return
      }
      if (key === 'p') {
        if (!contextMenuCanPaste) return
        event.preventDefault()
        applyEditorContextAction('paste')
        return
      }
      if (key === 'f') {
        event.preventDefault()
        applyEditorContextAction('selectAll')
        return
      }
      if (key === 'e') {
        event.preventDefault()
        applyEditorContextAction('delete')
        return
      }
      if (key === 'i') {
        event.preventDefault()
        applyEditorContextAction('insertLine')
        return
      }
      if (key === 'k') {
        event.preventDefault()
        applyEditorContextAction('compileLine')
        return
      }
      if (key === 'g') {
        event.preventDefault()
        applyEditorContextAction('block')
        return
      }
      if (key === 'b') {
        event.preventDefault()
        applyEditorContextAction('unblock')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [applyEditorContextAction, canCutContextAction, canRedoContextAction, canUndoContextAction, contextMenuCanPaste, editorContextMenu, hasCopySelection])

  const navigateToSubprogramInternal = useCallback((subName: string, fallbackLine?: number, preferredHeaderIndex?: number) => {
    const navSeq = ++subNavSeqRef.current
    const normalizedName = (subName || '').trim()
    let flashLineIndex = -1
    let cursorLineIndex = -1
    let subHeaderLineIndex = -1
    let ls = currentText.split('\n')

    if (normalizedName) {
      const matches: number[] = []
      for (let i = 0; i < ls.length; i++) {
        const t = ls[i].replace(/[\r\t]/g, '').trim()
        if (!t.startsWith('.子程序 ')) continue
        const name = (splitCSV(t.slice('.子程序 '.length))[0] || '').trim()
        if (name === normalizedName) {
          matches.push(i)
        }
      }

      if (matches.length > 0) {
        if (Number.isFinite(preferredHeaderIndex) && matches.includes(preferredHeaderIndex as number)) {
          subHeaderLineIndex = preferredHeaderIndex as number
        } else if (Number.isFinite(fallbackLine) && (fallbackLine || 0) > 0) {
          const target = (fallbackLine as number) - 1
          subHeaderLineIndex = matches.reduce((best, cur) => (
            Math.abs(cur - target) < Math.abs(best - target) ? cur : best
          ), matches[0])
        } else {
          subHeaderLineIndex = matches[0]
        }
      }
    }

    if (subHeaderLineIndex >= 0) {
      flashLineIndex = subHeaderLineIndex
      let nextSubHeader = ls.length
      for (let i = subHeaderLineIndex + 1; i < ls.length; i++) {
        const t = ls[i].replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ')) {
          nextSubHeader = i
          break
        }
      }

      for (let i = subHeaderLineIndex + 1; i < nextSubHeader; i++) {
        const t = ls[i].replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.')) continue
        cursorLineIndex = i
        break
      }

      if (cursorLineIndex < 0) {
        const insertAt = nextSubHeader
        const materializedLines = [...ls]
        materializedLines.splice(insertAt, 0, '')
        const nextText = materializedLines.join('\n')
        pushUndo(currentText)
        applyTextChange(nextText)
        ls = materializedLines
        cursorLineIndex = insertAt
      }

      if (cursorLineIndex < 0) {
        cursorLineIndex = Math.min(subHeaderLineIndex + 1, Math.max(ls.length - 1, 0))
      }
    }

    if (flashLineIndex < 0 && Number.isFinite(fallbackLine) && (fallbackLine || 0) > 0) {
      flashLineIndex = Math.min((fallbackLine as number) - 1, Math.max(ls.length - 1, 0))
    }
    if (cursorLineIndex < 0 && flashLineIndex >= 0) cursorLineIndex = flashLineIndex
    if (flashLineIndex < 0 || cursorLineIndex < 0) return

    const shouldFlashOnSubTable = subHeaderLineIndex >= 0
    lastFocusedLine.current = flashLineIndex
    scrollToLineIndex(flashLineIndex, 'auto')

    const flashAfterScrollSettled = (attempt = 0): void => {
      if (navSeq !== subNavSeqRef.current) return
      const wrapper = wrapperRef.current
      if (!wrapper) return

      // 子程序跳转仅允许闪烁在表格数据行；在“文本裁切过渡帧”中未就绪时短暂重试。
      const tableFlashEl = wrapper.querySelector<HTMLElement>(`tr.eyc-data-row[data-line-index="${flashLineIndex}"]`)
      const flashEl = shouldFlashOnSubTable
        ? tableFlashEl
        : (tableFlashEl ?? wrapper.querySelector<HTMLElement>(`[data-line-index="${flashLineIndex}"]`))

      if (!flashEl) {
        if (shouldFlashOnSubTable && attempt < 24) {
          window.setTimeout(() => flashAfterScrollSettled(attempt + 1), 34)
          return
        }
        // 目标行未稳定出现时宁可不闪，也不命中过渡态错误节点。
        window.setTimeout(() => focusCursorAtLineStart(), 90)
        return
      }

      // 清理上一跳残留闪烁，避免视觉上出现“闪错行”。
      wrapper.querySelectorAll('.highlight-flash').forEach((node) => {
        node.classList.remove('highlight-flash')
      })
      flashEl.classList.add('highlight-flash')
      setTimeout(() => {
        if (navSeq !== subNavSeqRef.current) return
        flashEl.classList.remove('highlight-flash')
      }, 1500)
      // 先建立视觉定位，再进入输入编辑态，避免渲染重排把闪烁误投到光标行。
      window.setTimeout(() => focusCursorAtLineStart(), 90)
    }

    // 等待滚动与布局收敛后再闪烁，避免“先在下方后瞬间居中”时闪烁错位。
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(() => flashAfterScrollSettled(), 30)
      })
    })

    const focusCursorAtLineStart = (): void => {
      if (navSeq !== subNavSeqRef.current) return
      startEditLine(cursorLineIndex, undefined, undefined, undefined, true)
      window.setTimeout(() => {
        if (navSeq !== subNavSeqRef.current) return
        if (!inputRef.current) startEditLine(cursorLineIndex, undefined, undefined, undefined, true)
        if (!inputRef.current) return
        inputRef.current.focus()
        inputRef.current.selectionStart = 0
        inputRef.current.selectionEnd = 0
      }, 0)
    }

    // 聚焦编辑动作由 flashAfterScrollSettled 触发，确保闪烁先落在目标表格行。
  }, [applyTextChange, currentText, pushUndo, scrollToLineIndex, startEditLine])

  useImperativeHandle(ref, () => ({
    insertSubroutine: () => {
      pushUndo(currentText)
      const curLines = currentText.split('\n')
      const focusLi = lastFocusedLine.current

      // 收集已有子程序名，生成唯一名称
      const existingNames = new Set<string>()
      for (const ln of curLines) {
        const t = ln.replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ')) {
          const name = splitCSV(t.slice('.子程序 '.length))[0]
          if (name) existingNames.add(name)
        }
      }
      let num = 1
      while (existingNames.has('子程序' + num)) num++
      const newName = '子程序' + num

      // 收集已有局部变量名，生成不重复的默认名称：局_变量N
      const existingLocalVarNames = new Set<string>()
      for (const ln of curLines) {
        const t = ln.replace(/[\r\t]/g, '').trim()
        if (!t.startsWith('.局部变量 ')) continue
        const localName = (splitCSV(t.slice('.局部变量 '.length))[0] || '').trim()
        if (localName) existingLocalVarNames.add(localName)
      }
      let localNum = 1
      while (existingLocalVarNames.has('局_变量' + localNum)) localNum++
      const newLocalVarName = '局_变量' + localNum

      let insertAt: number

      if (focusLi < 0) {
        // 无光标焦点：插入到文件末尾
        insertAt = curLines.length
      } else {
        // 先找光标所在或上方最近的 .子程序 声明行
        let curSubStart = -1
        for (let i = Math.min(focusLi, curLines.length - 1); i >= 0; i--) {
          const t = curLines[i].replace(/[\r\t]/g, '').trim()
          if (t.startsWith('.子程序 ')) { curSubStart = i; break }
          // 碰到程序集声明就停止（程序集表格始终在最上方）
          if (t.startsWith('.程序集 ')) break
        }

        // 找下一个子程序/程序集的起始行（即当前子程序的结束后）
        insertAt = curLines.length
        const searchStart = curSubStart >= 0 ? curSubStart + 1 : Math.max(focusLi + 1, 0)
        for (let i = searchStart; i < curLines.length; i++) {
          const t = curLines[i].replace(/[\r\t]/g, '').trim()
          if (t.startsWith('.子程序 ') || t.startsWith('.程序集 ')) {
            insertAt = i
            break
          }
        }
      }

      const nl = [...curLines]
      // 统一为“真实空行 + 子程序声明 + 默认局部变量 + 真实空普通行”。
      nl.splice(insertAt, 0, '', '.子程序 ' + newName + ', , , ', '.局部变量 ' + newLocalVarName + ', 整数型', '')
      const nt = nl.join('\n')
      applyTextChange(nt)

      const newSubLineIndex = insertAt + 1
      const firstCodeLineIndex = insertAt + 3
      lastFocusedLine.current = newSubLineIndex
      const focusFirstCodeLine = (): void => {
        startEditLine(firstCodeLineIndex, undefined, undefined, undefined, true)
        window.setTimeout(() => {
          if (!inputRef.current) return
          inputRef.current.focus()
          inputRef.current.selectionStart = 0
          inputRef.current.selectionEnd = 0
        }, 0)
      }

      const flashNewSubAfterTableReady = (attempt = 0): void => {
        const wrapper = wrapperRef.current
        if (!wrapper) return
        // 仅允许闪烁在表格数据行，避免文本过渡态节点误命中。
        const tableFlashEl = wrapper.querySelector<HTMLElement>(`tr.eyc-data-row[data-line-index="${newSubLineIndex}"]`)
        if (!tableFlashEl) {
          if (attempt < 24) {
            window.setTimeout(() => flashNewSubAfterTableReady(attempt + 1), 34)
            return
          }
          window.setTimeout(() => focusFirstCodeLine(), 90)
          return
        }

        wrapper.querySelectorAll('.highlight-flash').forEach((node) => {
          node.classList.remove('highlight-flash')
        })
        tableFlashEl.classList.add('highlight-flash')
        window.setTimeout(() => {
          tableFlashEl.classList.remove('highlight-flash')
        }, 1200)
        window.setTimeout(() => focusFirstCodeLine(), 90)
      }

      scrollToLineIndex(newSubLineIndex, 'auto')
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.setTimeout(() => flashNewSubAfterTableReady(), 30)
        })
      })
    },

    insertLocalVariable: () => {
      const curLines = currentText.split('\n')
      const focusLi = lastFocusedLine.current

      // 向上查找当前所在的 .子程序 或 .程序集
      let contextStart = -1
      let isAssembly = false
      for (let i = Math.min(focusLi, curLines.length - 1); i >= 0; i--) {
        const t = curLines[i].replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ')) { contextStart = i; break }
        if (t.startsWith('.程序集 ')) { contextStart = i; isAssembly = true; break }
      }
      if (contextStart < 0) return

      // 在程序集上下文插入程序集变量，在子程序上下文插入局部变量
      const declPrefix = isAssembly ? '.程序集变量 ' : '.局部变量 '
      const searchPrefixes = isAssembly
        ? ['.程序集变量 ']
        : ['.参数 ', '.局部变量 ']

      // 找到当前范围内最后一个相关声明行
      let insertAt = contextStart
      for (let i = contextStart + 1; i < curLines.length; i++) {
        const t = curLines[i].replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ') || t.startsWith('.程序集 ')) break
        if (searchPrefixes.some(p => t.startsWith(p))) insertAt = i
      }

      pushUndo(currentText)
      const nl = [...curLines]
      nl.splice(insertAt + 1, 0, declPrefix + ', 整数型')
      const nt = nl.join('\n')
      applyTextChange(nt)

      // 开始编辑新行的名称单元格
      const newLi = insertAt + 1
      lastFocusedLine.current = newLi
      setEditCell({ lineIndex: newLi, cellIndex: 0, fieldIdx: 0, sliceField: false })
      setEditVal('')
      setTimeout(() => {
        const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${newLi}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        inputRef.current?.focus()
      }, 50)
    },

    insertConstant: () => {
      const curLines = currentText.split('\n')
      const constPrefix = isResourceTableDoc ? '.资源 ' : '.常量 '
      const defaultType = '其它'

      // 生成不重复的常量名
      const existingNames = new Set<string>()
      for (const ln of curLines) {
        const t = ln.replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.常量 ') || t.startsWith('.资源 ')) {
          const raw = t.startsWith('.资源 ') ? t.slice('.资源 '.length) : t.slice('.常量 '.length)
          const name = splitCSV(raw)[0]
          if (name) existingNames.add(name)
        }
      }
      let num = 1
      while (existingNames.has((isResourceTableDoc ? '资源' : '常量') + num)) num++
      const newName = (isResourceTableDoc ? '资源' : '常量') + num

      // 默认插入到首个子程序前；若已有常量/全局变量则追加到其后
      let firstSub = curLines.findIndex(ln => ln.replace(/[\r\t]/g, '').trim().startsWith('.子程序 '))
      if (firstSub < 0) firstSub = curLines.length

      let insertAt = firstSub
      let lastConstant = -1
      let lastGlobal = -1
      for (let i = 0; i < firstSub; i++) {
        const t = curLines[i].replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.常量 ') || t.startsWith('.资源 ')) lastConstant = i
        if (t.startsWith('.全局变量 ')) lastGlobal = i
      }
      if (lastConstant >= 0) insertAt = lastConstant + 1
      else if (lastGlobal >= 0) insertAt = lastGlobal + 1

      pushUndo(currentText)
      const nl = [...curLines]
      if (isResourceTableDoc) {
        nl.splice(insertAt, 0, constPrefix + newName + ', "", ' + defaultType)
      } else {
        nl.splice(insertAt, 0, constPrefix + newName + ', 0')
      }
      const nt = nl.join('\n')
      applyTextChange(nt)

      // 自动进入名称编辑
      lastFocusedLine.current = insertAt
      setEditCell({ lineIndex: insertAt, cellIndex: 0, fieldIdx: 0, sliceField: false })
      setEditVal(newName)
      setTimeout(() => {
        const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${insertAt}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 50)
    },

    navigateOrCreateSub: (subName: string, params: Array<{ name: string; dataType: string; isByRef: boolean }>) => {
      const curLines = currentText.split('\n')
      const normalizedSubName = (subName || '').trim()

      // 查找同名子程序是否已存在
      let subLineIndex = -1
      for (let i = 0; i < curLines.length; i++) {
        const t = curLines[i].replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ')) {
          const name = (splitCSV(t.slice('.子程序 '.length))[0] || '').trim()
          if (name === normalizedSubName) { subLineIndex = i; break }
        }
      }

      if (subLineIndex >= 0) {
        // 已存在子程序直接复用统一跳转逻辑，保证与项目树双击一致。
        navigateToSubprogramInternal(normalizedSubName, subLineIndex + 1, subLineIndex)
        return
      }

      // 不存在：在文件末尾插入新子程序
      pushUndo(currentText)
      const existingLocalVarNames = new Set<string>()
      for (const ln of curLines) {
        const t = ln.replace(/[\r\t]/g, '').trim()
        if (!t.startsWith('.局部变量 ')) continue
        const localName = (splitCSV(t.slice('.局部变量 '.length))[0] || '').trim()
        if (localName) existingLocalVarNames.add(localName)
      }
      for (const p of params) {
        if (p.name) existingLocalVarNames.add(p.name.trim())
      }
      let localNum = 1
      while (existingLocalVarNames.has('局_变量' + localNum)) localNum++
      const newLocalVarName = '局_变量' + localNum

      const insertLines: string[] = ['', '.子程序 ' + subName + ', , , ']
      for (const p of params) {
        insertLines.push('    .参数 ' + p.name + ', ' + (p.dataType || '整数型') + (p.isByRef ? ', 传址' : ''))
      }
      insertLines.push('.局部变量 ' + newLocalVarName + ', 整数型')
      // 为新建子程序补一条真实空普通行，避免仅显示无行号的虚拟占位行。
      insertLines.push('')
      const nl = [...curLines, ...insertLines]
      const nt = nl.join('\n')
      applyTextChange(nt)

      // 新子程序行位置：前置空行后为子程序声明。
      const newSubLineIndex = curLines.length + 1
      const firstCodeLineIndex = curLines.length + 3 + params.length
      lastFocusedLine.current = newSubLineIndex
      setTimeout(() => {
        const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${newSubLineIndex}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        startEditLine(firstCodeLineIndex, undefined, undefined, undefined, true)
        setTimeout(() => {
          if (!inputRef.current) return
          inputRef.current.focus()
          inputRef.current.selectionStart = 0
          inputRef.current.selectionEnd = 0
        }, 0)
      }, 150)
    },
    navigateToLine: (line: number) => {
      const lineIndex = line - 1
      lastFocusedLine.current = lineIndex
      const focusTargetLine = (): void => {
        // 先走统一跳转逻辑：找得到目标行时精准定位，找不到时按比例跳转。
        scrollToLineIndex(lineIndex, 'auto')
        const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${lineIndex}"]`)
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'center' })
          el.classList.add('highlight-flash')
          setTimeout(() => el.classList.remove('highlight-flash'), 1500)
        }
      }

      // 立即执行一次，再在布局稳定后补两次对齐，避免跨文档长文件首跳未到位。
      focusTargetLine()
      window.requestAnimationFrame(() => {
        focusTargetLine()
        window.requestAnimationFrame(() => focusTargetLine())
      })
      window.setTimeout(() => focusTargetLine(), 180)
    },
    navigateToSubprogram: (subName: string, fallbackLine?: number) => {
      navigateToSubprogramInternal(subName, fallbackLine)
    },
    getVisibleLineForSourceLine: (line: number) => {
      if (!Number.isFinite(line) || line <= 0) return line
      return lineNumMaps.sourceLineNumMap.get(line - 1) ?? line
    },
    editorAction: (action: string) => {
      if (action === 'copy') {
        if (selectedLines.size > 0) {
          void navigator.clipboard.writeText(getSelectedSourceText())
        } else {
          const selectedText = getMouseRangeSelectedSourceText()
          if (selectedText) void navigator.clipboard.writeText(selectedText)
        }
        return
      }
      if (action === 'selectAll') {
        const ls = currentText.split('\n')
        const all = new Set<number>()
        for (let i = 0; i < ls.length; i++) all.add(i)
        setSelectedLines(all)
        dragAnchor.current = 0
        return
      }
    },
  }), [applyTextChange, currentText, pushUndo, selectedLines, getSelectedSourceText, getMouseRangeSelectedSourceText, isResourceTableDoc, shouldUseNativeInputPaste, lineNumMaps, startEditLine, navigateToSubprogramInternal])

  // 查找代码行中第一个有参数的有效命令
  const findCmdWithParams = useCallback((codeLine: string): CompletionItem | null => {
    if (!codeLine) return null
    const spans = colorize(codeLine)
    for (const s of spans) {
      if ((s.cls === 'funccolor' || s.cls === 'comecolor') && validCommandNames.has(s.text)) {
        const cmd = allCommandsRef.current.find(c => c.name === s.text) || dllCompletionItemsRef.current.find(c => c.name === s.text)
        if (cmd && cmd.params.length > 0) return cmd
      }
    }
    return null
  }, [validCommandNames])

  // 查找代码行中第一个命令名（不要求有参数）
  const findFirstCommandName = useCallback((codeLine: string): string | null => {
    if (!codeLine) return null
    const spans = colorize(codeLine)
    for (const s of spans) {
      if ((s.cls === 'funccolor' || s.cls === 'comecolor' || s.cls === 'cometwolr') && s.text.trim()) {
        return s.text
      }
    }
    return null
  }, [])

  // 代码行点击时，优先取“当前点击到的命令 token”；否则回退到首个命令
  const findCommandNameFromClickTarget = useCallback((target: EventTarget | null, codeLine: string): string | null => {
    const el = target instanceof HTMLElement ? target : null
    if (el) {
      const tokenEl = el.closest('.funccolor, .comecolor, .cometwolr, .eyc-subrefcolor')
      const tokenText = (tokenEl?.textContent || '').replace(/\u00A0/g, '').trim()
      if (tokenText) return tokenText
    }
    return findFirstCommandName(codeLine)
  }, [findFirstCommandName])

  /** 格式化参数中的运算符：半角→全角 + 前后加空格 */
  const formatParamOperators = useCallback((val: string): string => {
    return formatOps(val)
  }, [])

  /** 实时同步编辑内容到底层数据（不关闭编辑状态） */
  const liveUpdate = useCallback((val: string) => {
    if (!editCell) return

    // 参数值编辑
    if (editCell.paramIdx !== undefined) {
      if (editCell.paramIdx >= 0) {
        const codeLine = lines[editCell.lineIndex]
        const newLine = replaceCallArg(codeLine, editCell.paramIdx, val)
        const nl = [...lines]; nl[editCell.lineIndex] = newLine
        const nt = nl.join('\n')
        applyTextChange(nt)
        return
      }
      if (editCell.paramIdx <= -200) {
        const codeLine = lines[editCell.lineIndex] || ''
        const parsed = parseAssignmentLineParts(codeLine)
        if (!parsed) return
        const rhsParamIdx = -editCell.paramIdx - 200
        const newRhs = replaceCallArg(parsed.rhs, rhsParamIdx, val)
        const newLine = `${parsed.indent}${parsed.lhs} ＝ ${newRhs}`
        const nl = [...lines]; nl[editCell.lineIndex] = newLine
        const nt = nl.join('\n')
        applyTextChange(nt)
        return
      }
    }

    if (editCell.cellIndex < 0) {
      if (editCell.isVirtual) return
      const nl = [...lines]; nl[editCell.lineIndex] = flowIndentRef.current + flowMarkRef.current + val
      const nt = nl.join('\n')
      applyTextChange(nt)
      return
    }

    if (editCell.fieldIdx < 0) return

    // 表格单元格
    const rawLine = lines[editCell.lineIndex]
    const newLine = rebuildLineField(rawLine, editCell.fieldIdx, val, editCell.sliceField)
    const nl = [...lines]; nl[editCell.lineIndex] = newLine
    const nt = nl.join('\n')
    applyTextChange(nt)
  }, [applyTextChange, editCell, lines, replaceCallArg, parseAssignmentLineParts])

  // 输入高频（尤其长按退格）时将文档同步节流到固定频率，降低全量重算导致的卡顿。
  const scheduleLiveUpdate = useCallback((val: string) => {
    pendingLiveUpdateValRef.current = val
    if (liveUpdateTimerRef.current != null) return
    liveUpdateTimerRef.current = window.setTimeout(() => {
      liveUpdateTimerRef.current = null
      const nextVal = pendingLiveUpdateValRef.current
      pendingLiveUpdateValRef.current = null
      if (nextVal == null) return
      liveUpdate(nextVal)
    }, 24)
  }, [liveUpdate])

  useEffect(() => {
    return () => {
      if (liveUpdateTimerRef.current != null) {
        window.clearTimeout(liveUpdateTimerRef.current)
        liveUpdateTimerRef.current = null
      }
      pendingLiveUpdateValRef.current = null
    }
  }, [])

  /** 渲染某行的流程线段 */
  const renderFlowSegs = (lineIndex: number, isExpanded?: boolean): { node: React.ReactNode; skipTreeLines: number } => {
    return renderFlowSegsLine({
      flowLines: displayFlowLines,
      lineIndex,
      isExpanded,
      resolveColors: (depth) => resolveFlowLineColors(flowLineModeConfig, depth),
    })
  }

  /** 渲染参数展开区域的流程线延续（只绘制纵向穿越线） */
  const renderFlowContinuation = (lineIndex: number): React.ReactNode => {
    return renderFlowContinuationLine({
      flowLines: displayFlowLines,
      lineIndex,
      resolveColors: (depth) => resolveFlowLineColors(flowLineModeConfig, depth),
    })
  }

  const {
    handleWrapperMouseDown,
    handleWrapperCopy,
    handleWrapperPaste,
    handleTableBlockMouseDown,
    handleCodeBlockMouseDown,
    handleCodeLineFoldMouseDown,
    handleCodeLineFoldClick,
    handleCodeLineClick,
    handleTableRowMouseDown,
    handleTableCellMouseDown,
    handleTableCellClick,
    handleTableCellDoubleClick,
  } = useEditorInteractionHandlers({
    flowAutoTag: FLOW_AUTO_TAG,
    wasDragSelectRef: wasDragSelect,
    userSubNamesRef,
    wrapperRef,
    editCellRef,
    preserveEditOnScrollbarRef,
    dragStartPosRef: dragStartPos,
    dragAnchorRef: dragAnchor,
    isDraggingRef: isDragging,
    lastFocusedLineRef: lastFocusedLine,
    setEditCell,
    setAcVisible,
    findLineAtY,
    handleLineMouseDown,
    setExpandedLines,
    setSelectedLines,
    getMouseRangeSelectedSourceText,
    getSelectedSourceText,
    selectedLines,
    currentText,
    applyTextChange,
    pushUndo,
    sanitizePastedTextForCurrent,
    extractAssemblyVarLinesFromPasted,
    extractRoutedDeclarationLinesFromPasted,
    onRouteDeclarationPaste,
    shouldUseNativeInputPaste,
    suppressInlineBlurCommit,
    commitActiveEditor: () => commitRef.current(),
    focusWrapper,
    findCommandNameFromClickTarget,
    findOwnerAssemblyName,
    onCommandClick,
    startEditLine,
    tryToggleTableBooleanCell,
    isResourceTableDoc,
    handleTableCellHint,
    startEditCell,
    openResourcePreview,
  })

  const stickyRenderView = useMemo(() => {
    if (!stickySubTable) return null

    const base = {
      rows: stickySubTable.rows,
      colCount: stickySubTable.colCount,
      translateY: stickyPushOffsetPx,
    }

    if (stickyPushOffsetPx >= 0 || stickySubTable.nextStartLine == null) return base
    const nextMeta = subTableMetaRef.current.find(meta => meta.startLine === stickySubTable.nextStartLine)
    if (!nextMeta || nextMeta.rows.length === 0) return base

    const overlapPx = Math.max(0, -stickyPushOffsetPx)
    const rowStepPx = Math.max(editorLineHeight, 1)
    const replaceRows = Math.min(
      Math.floor(overlapPx / rowStepPx),
      stickySubTable.rows.length,
      nextMeta.rows.length,
    )

    if (replaceRows <= 0) return base

    // 逐行裁切：旧冻结表顶部每上移一行，就从底部补入下一子程序一行。
    const rows = [
      ...stickySubTable.rows.slice(replaceRows),
      ...nextMeta.rows.slice(0, replaceRows),
    ]
    const residualPx = overlapPx - replaceRows * rowStepPx

    return {
      rows,
      colCount: Math.max(stickySubTable.colCount, nextMeta.colCount),
      translateY: -residualPx,
    }
  }, [editorLineHeight, stickyPushOffsetPx, stickySubTable])

  useEffect(() => {
    stickyScopeRowRef.current?.style.setProperty('--eyc-sticky-translate-y', `${stickyRenderView?.translateY ?? 0}px`)
  }, [stickyRenderView?.translateY])

  const handleStickySubTableCellClick = useCallback((
    e: React.MouseEvent<HTMLTableCellElement>,
    action: {
      rowIsHeader: boolean
      lineIndex: number
      cellIndex: number
      fieldIdx?: number
      text: string
      sliceField?: boolean
    },
  ) => {
    e.stopPropagation()
    if (action.rowIsHeader) return

    // 点击冻结区后立即跳回对应主表格行，确保编辑输入框在主表格中定位。
    scrollToLineIndex(action.lineIndex, 'auto')

    if (tryToggleTableBooleanCell('sub', action.lineIndex, action.cellIndex)) return
    handleTableCellHint(action.lineIndex, action.fieldIdx ?? -1, action.text)
    startEditCell(action.lineIndex, action.cellIndex, action.text, action.fieldIdx, action.sliceField)
  }, [handleTableCellHint, scrollToLineIndex, startEditCell, tryToggleTableBooleanCell])

  return (
    <div
      className="eyc-table-editor ebackcolor1"
      ref={editorRootRef}
      onClick={() => onCommandClear?.()}
    >
      <div className="eyc-editor-main">
      <div
        className="eyc-table-shell"
        ref={tableShellRef}
      >
      <div
        className="eyc-table-wrapper"
        ref={wrapperRef}
        onMouseDown={handleWrapperMouseDown}
        onContextMenu={handleWrapperContextMenu}
        onCopy={handleWrapperCopy}
        onPaste={handleWrapperPaste}
        tabIndex={0}
      >
        {shouldFreezeTableHeader && stickyRenderView && stickyRenderView.rows.length > 0 && (
          <div className="eyc-sticky-scope" aria-hidden="true">
            <div
              className="eyc-sticky-scope-row"
              ref={stickyScopeRowRef}
            >
              <div className="eyc-line-gutter eyc-sticky-scope-gutter">
                {stickyRenderView.rows.map((row, idx) => (
                  <div key={`sticky-gutter-${row.lineIndex}-${idx}`} className="eyc-gutter-cell">
                    <span className="eyc-breakpoint-dot">●</span>
                    <span className="eyc-gutter-linenum">{row.isHeader ? '\u00A0' : (lineNumMaps.sourceLineNumMap.get(row.lineIndex) ?? (row.lineIndex + 1))}</span>
                    <span className="eyc-gutter-fold-area" />
                  </div>
                ))}
              </div>
              <div className="eyc-sticky-scope-table-wrap">
                <table className="eyc-decl-table eyc-sticky-scope-table" cellSpacing={0}>
                  <tbody>
                    {stickyRenderView.rows.map((row, rowIdx) => (
                      <tr key={`sticky-row-${row.lineIndex}-${rowIdx}`}>
                        {row.cells.map((cell, idx) => (
                          <td
                            key={`sticky-cell-${row.lineIndex}-${rowIdx}-${idx}`}
                            className={`${cell.cls} Rowheight${cell.align ? ' eyc-cell-align-center' : ''}`}
                            colSpan={cell.colSpan}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => handleStickySubTableCellClick(e, {
                              rowIsHeader: !!row.isHeader,
                              lineIndex: row.lineIndex,
                              cellIndex: idx,
                              fieldIdx: cell.fieldIdx,
                              text: cell.text,
                              sliceField: cell.sliceField,
                            })}
                          >
                            {cell.text}
                          </td>
                        ))}
                        {row.cells.reduce((sum, cell) => sum + (cell.colSpan || 1), 0) < stickyRenderView.colCount && (
                          <td className="Rowheight" colSpan={stickyRenderView.colCount - row.cells.reduce((sum, cell) => sum + (cell.colSpan || 1), 0)}>&nbsp;</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {blockVirtualWindow.leadingSpacerPx > 0 && (
          <div
            aria-hidden="true"
            className="eyc-virtual-spacer"
            ref={(element) => setCssVars(element, { '--eyc-virtual-spacer-height': `${blockVirtualWindow.leadingSpacerPx}px` })}
          />
        )}
        {visibleBlocks.slice(blockVirtualWindow.startBlockIndex, blockVirtualWindow.endBlockIndex + 1).map((blk, localBlockIndex) => {
          const bi = blockVirtualWindow.startBlockIndex + localBlockIndex
          if (blk.kind === 'table') {
            const tableMeta = tableRenderMetaByBlockIndex.get(bi)
            if (!tableMeta) return null
            const { tableLineIndices, tableColCount, tableRenderRowsAll } = tableMeta
            const tableRowOverscanLines = 120
            const minVisibleLine = Math.max(0, visibleLineWindow.startLine - tableRowOverscanLines)
            const maxVisibleLine = visibleLineWindow.endLine + tableRowOverscanLines
            const isRowVisible = (tableRow: typeof tableRenderRowsAll[number]): boolean => {
              if (tableRow.row.isHeader) return true
              const lineIndex = tableRow.row.lineIndex
              return lineIndex >= minVisibleLine && lineIndex <= maxVisibleLine
            }
            let startRenderIndex = tableRenderRowsAll.findIndex(isRowVisible)
            if (startRenderIndex < 0) startRenderIndex = 0
            let endRenderIndex = startRenderIndex
            for (let i = tableRenderRowsAll.length - 1; i >= startRenderIndex; i--) {
              if (isRowVisible(tableRenderRowsAll[i])) {
                endRenderIndex = i
                break
              }
            }
            const leadingSpacerRowCount = Math.max(0, startRenderIndex)
            const trailingSpacerRowCount = Math.max(0, tableRenderRowsAll.length - endRenderIndex - 1)
            const tableRenderRows = tableRenderRowsAll.slice(startRenderIndex, endRenderIndex + 1)
            return (
              <div
                key={bi}
                className="eyc-block-row"
                onMouseDown={(e) => handleTableBlockMouseDown(e, tableLineIndices)}
              >
                <div className="eyc-line-gutter">
                  {leadingSpacerRowCount > 0 && (
                    <div
                      className="eyc-gutter-cell eyc-virtual-gutter-spacer"
                      aria-hidden="true"
                      ref={(element) => setCssVars(element, { '--eyc-virtual-table-spacer-height': `${leadingSpacerRowCount * 22}px` })}
                    />
                  )}
                  {tableRenderRows.map(({ row, ri, isDeletedPlaceholder }, renderIndex) => (
                    isDeletedPlaceholder
                      ? (
                          <div key={`gutter-del-${ri}-${renderIndex}`} className="eyc-gutter-cell eyc-diff-deleted-placeholder-gutter" aria-hidden="true">
                            <span className="eyc-breakpoint-dot">●</span>
                            <span className="eyc-gutter-linenum">&nbsp;</span>
                            <span className="eyc-gutter-fold-area" />
                          </div>
                        )
                      : (
                          <div
                            key={`gutter-row-${ri}-${renderIndex}`}
                            className={row.isHeader
                              ? 'eyc-gutter-cell'
                              : `eyc-gutter-cell${selectedLines.has(row.lineIndex) ? ' eyc-line-selected' : ''}${diffClassSuffixFor(row.lineIndex)}`}
                          >
                            {(() => {
                              const actualLine = row.isHeader ? 0 : (lineNumMaps.tableRowNumMap.get(`${bi}:${ri}`) ?? row.lineIndex + 1)
                              const sourceLine = row.isHeader ? 0 : (row.lineIndex + 1)
                              const hasBreakpoint = sourceLine > 0 && breakpointLineSet.has(sourceLine)
                              return (
                                <>
                                  <span className={`eyc-breakpoint-dot${hasBreakpoint ? ' active' : ''}`}>●</span>
                                  <span className="eyc-gutter-linenum">{row.isHeader ? '' : actualLine}</span>
                                </>
                              )
                            })()}
                            <span className="eyc-gutter-fold-area" />
                          </div>
                        )
                  ))}
                  {trailingSpacerRowCount > 0 && (
                    <div
                      className="eyc-gutter-cell eyc-virtual-gutter-spacer"
                      aria-hidden="true"
                      ref={(element) => setCssVars(element, { '--eyc-virtual-table-spacer-height': `${trailingSpacerRowCount * 22}px` })}
                    />
                  )}
                </div>
                <div className="eyc-block-content">
                  <table className="eyc-decl-table" cellSpacing={0}>
                    <tbody>
                      {leadingSpacerRowCount > 0 && (
                        <tr className="eyc-virtual-table-spacer" aria-hidden="true">
                          <td
                            colSpan={tableColCount}
                            className="eyc-virtual-table-spacer-cell"
                            ref={(element) => setCssVars(element, { '--eyc-virtual-table-spacer-height': `${leadingSpacerRowCount * 22}px` })}
                          >
                            &nbsp;
                          </td>
                        </tr>
                      )}
                      {tableRenderRows.map(({ row, ri, isDeletedPlaceholder }, renderIndex) => (
                        isDeletedPlaceholder
                          ? (
                              <tr key={`tbl-del-${ri}-${renderIndex}`} className="eyc-data-row eyc-diff-deleted-placeholder-row" aria-hidden="true">
                                <td className="eyc-diff-deleted-placeholder-cell" colSpan={tableColCount}>&nbsp;</td>
                              </tr>
                            )
                          : (
                              <tr
                                key={`tbl-row-${ri}-${renderIndex}`}
                                className={row.isHeader ? 'eyc-hdr-row' : `eyc-data-row${selectedLines.has(row.lineIndex) ? ' eyc-line-selected' : ''}${diffClassSuffixFor(row.lineIndex)}`}
                                {...(!row.isHeader ? { 'data-line-index': row.lineIndex } : {})}
                                onMouseDown={row.isHeader ? undefined : (e) => handleTableRowMouseDown(e, row.lineIndex)}
                              >
                            {row.cells.map((cell, ci) => (
                              (() => {
                                const isInvalidVarNameCell = !row.isHeader && cell.fieldIdx === 0 && invalidVarNameLineSet.has(row.lineIndex)
                                return (
                              <td
                                key={ci}
                                className={`${cell.cls} Rowheight${cell.align ? ' eyc-cell-align-center' : ''}${isInvalidVarNameCell ? ' eyc-cell-invalid' : ''}`}
                                colSpan={cell.colSpan}
                                onMouseDown={handleTableCellMouseDown}
                                onClick={(e) => handleTableCellClick(e, {
                                  rowIsHeader: !!row.isHeader,
                                  tableType: blk.tableType,
                                  lineIndex: row.lineIndex,
                                  cellIndex: ci,
                                  fieldIdx: cell.fieldIdx,
                                  text: cell.text,
                                  sliceField: cell.sliceField,
                                })}
                                onDoubleClick={(e) => handleTableCellDoubleClick(e, {
                                  rowIsHeader: !!row.isHeader,
                                  tableType: blk.tableType,
                                  lineIndex: row.lineIndex,
                                  cellIndex: ci,
                                  fieldIdx: cell.fieldIdx,
                                  text: cell.text,
                                  sliceField: cell.sliceField,
                                })}
                              >
                                {editCell && editCell.lineIndex === row.lineIndex && editCell.cellIndex === ci && editCell.fieldIdx === cell.fieldIdx && !row.isHeader ? (
                                  <div className="eyc-inline-edit-sizing eyc-cell-inline-edit-sizing">
                                    <span className="eyc-inline-edit-measure">
                                      {(editVal.length > (cell.text || '\u00A0').length ? editVal : (cell.text || '\u00A0')) + '\u00A0'}
                                    </span>
                                    <input
                                      ref={inputRef}
                                      className={`eyc-cell-input${isInvalidVarNameCell ? ' eyc-input-invalid' : ''}`}
                                      aria-label="编辑表格单元格"
                                      value={editVal}
                                      onPaste={(e) => e.stopPropagation()}
                                      onMouseDown={(e) => {
                                        if (e.button !== 0) return
                                        // 单元格输入框内拖选仅限单元格，不切换到行拖选
                                        pendingInputDragRef.current = { lineIndex: row.lineIndex, x: e.clientX, y: e.clientY, allowRowDrag: false }
                                      }}
                                      onChange={e => {
                                        let v = e.target.value
                                        // 数据类型单元格禁止空格（类型名不含空格，防止粘贴/IME 串入多个类型）
                                        if (editCell && editCell.cellIndex >= 0
                                          && canUseTypeCompletion(editCell.lineIndex, editCell.fieldIdx)
                                          && /\s/.test(v)) {
                                          v = v.replace(/\s+/g, '')
                                        }
                                        setEditVal(v)
                                        scheduleLiveUpdate(v)
                                        const pos = e.target.selectionStart ?? v.length
                                        updateCompletion(v, pos)
                                      }}
                                      onBlur={() => {
                                        // Enter 切换到下一单元时，旧 input 的 blur 不能再提交。
                                        if (!isEditingSameCell({
                                          lineIndex: row.lineIndex,
                                          cellIndex: ci,
                                          fieldIdx: cell.fieldIdx ?? -1,
                                        })) return
                                        if (shouldSuppressBlurCommit()) return
                                        commit()
                                      }}
                                      onKeyDown={onKey}
                                      spellCheck={false}
                                    />
                                  </div>
                                ) : (
                                  cell.text || '\u00A0'
                                )}
                              </td>
                                )
                              })()
                            ))}
                            </tr>
                          )
                      ))}
                      {trailingSpacerRowCount > 0 && (
                        <tr className="eyc-virtual-table-spacer" aria-hidden="true">
                          <td
                            colSpan={tableColCount}
                            className="eyc-virtual-table-spacer-cell"
                            ref={(element) => setCssVars(element, { '--eyc-virtual-table-spacer-height': `${trailingSpacerRowCount * 22}px` })}
                          >
                            &nbsp;
                          </td>
                        </tr>
                      )}
                  </tbody>
                </table>
              </div>
            </div>
            )
          }

          // 代码行
          const codeMeta = getCodeRenderMeta(bi, blk)
          const codeLineRaw = codeMeta.codeLineRaw
          const spans = codeMeta.spans
          const lineCmd = codeMeta.lineCmd
          const assignDetail = codeMeta.assignDetail
          const hasExpandableDetail = codeMeta.hasExpandableDetail
          const isExpanded = expandedLines.has(blk.lineIndex)
          const isLineSelected = selectedLines.has(blk.lineIndex)
          const actualLine = blk.isVirtual ? 0 : (lineNumMaps.codeLineNumMap.get(blk.lineIndex) ?? blk.lineIndex + 1)
          const sourceLine = blk.isVirtual ? 0 : (blk.lineIndex + 1)
          const hasBreakpoint = sourceLine > 0 && breakpointLineSet.has(sourceLine)
          const isDebugLine = !!debugSourceLine && sourceLine === debugSourceLine
          return (
            <Fragment key={bi}>
            <div
              className={`eyc-block-row eyc-block-row-wrap${isLineSelected ? ' eyc-line-selected' : ''}${isDebugLine ? ' eyc-debug-line' : ''}${diffClassSuffixFor(blk.lineIndex)}`}
              data-line-index={blk.lineIndex}
              onMouseDown={(e) => handleCodeBlockMouseDown(e, blk.lineIndex)}
            >
              <div className="eyc-line-gutter">
                <div className="eyc-gutter-cell">
                  <span className={`eyc-breakpoint-dot${hasBreakpoint ? ' active' : ''}`}>●</span>
                  <span className="eyc-gutter-linenum">{blk.isVirtual ? '' : actualLine}</span>
                  <span className="eyc-gutter-fold-area">
                    {hasExpandableDetail && (isLineSelected || (editCell && editCell.lineIndex === blk.lineIndex && editCell.paramIdx === undefined)) && (
                      <span
                        className="eyc-gutter-fold"
                        onMouseDown={handleCodeLineFoldMouseDown}
                        onClick={(e) => handleCodeLineFoldClick(e, blk.lineIndex)}
                      >{isExpanded ? '−' : '+'}</span>
                    )}
                  </span>
                </div>
              </div>
              <div
                className={`eyc-code-line${editCell && editCell.lineIndex === blk.lineIndex && editCell.isVirtual === blk.isVirtual && editCell.paramIdx === undefined ? ' eyc-code-line-editing' : ''}`}
                onClick={(e) => handleCodeLineClick(e, {
                  lineIndex: blk.lineIndex,
                  codeLineRaw,
                  isVirtual: blk.isVirtual,
                })}
              >
              {editCell && editCell.lineIndex === blk.lineIndex && editCell.isVirtual === blk.isVirtual && editCell.paramIdx === undefined ? (
                <>
                  {renderFlowSegs(blk.lineIndex, isExpanded).node}
                  <div className="eyc-inline-edit-sizing eyc-code-inline-edit-sizing">
                    <span
                      className="eyc-inline-edit-measure eyc-code-inline-edit-measure"
                    >
                      {(editVal || '') + '\u00A0'}
                    </span>
                    <input
                      ref={inputRef}
                      className="eyc-inline-input"
                      aria-label="编辑代码行"
                      value={editVal}
                      onPaste={(e) => {
                        const clipText = e.clipboardData.getData('text/plain')
                        if (!/[\r\n]/.test(clipText)) e.stopPropagation()
                      }}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return
                        // 记录起始位置；如果鼠标拖出 input 边界则切换为跳行拖选
                        pendingInputDragRef.current = { lineIndex: blk.lineIndex, x: e.clientX, y: e.clientY, allowRowDrag: true }
                      }}
                      onChange={e => {
                        const v = normalizeCodeLineInput(e.target.value)
                        // 命令行括号保护已移除：允许自由编辑命令名与括号外内容
                        setEditVal(v)
                        scheduleLiveUpdate(v)
                        const pos = e.target.selectionStart ?? v.length
                        updateCompletion(v, pos)
                      }}
                      onBlur={() => {
                        // Enter 切行后旧输入框 blur 会晚到，需忽略以免打断新焦点。
                        if (!isEditingSameCell({
                          lineIndex: blk.lineIndex,
                          cellIndex: -1,
                          fieldIdx: -1,
                          isVirtual: blk.isVirtual,
                        })) return
                        if (shouldSuppressBlurCommit()) return
                        setTimeout(() => setAcVisible(false), 150)
                        commit()
                      }}
                      onKeyDown={onKey}
                      spellCheck={false}
                    />
                  </div>
                </>
              ) : (
                <span className="eyc-code-spans">
                  {(() => {
                    const flow = renderFlowSegs(blk.lineIndex, isExpanded)
                    let treeSkipped = 0
                            const lineHasMissingRhs = missingRhsLineSet.has(blk.lineIndex)
                    return (
                      <>
                        {flow.node}
                        {spans.map((s, si) => {
                          // 跳过被流程线替代的树线缩进
                          if (s.cls === 'eTreeLine' && treeSkipped < flow.skipTreeLines) {
                            treeSkipped++
                            return null
                          }
                          const isFunc = s.cls === 'funccolor'
                          const isObjMethod = s.cls === 'cometwolr'
                          const isFlowKw = s.cls === 'comecolor'
                          const isUserSubRef = isFunc && userSubNamesRef.current.has(s.text)
                          const isAssignTarget = s.cls === 'assignTarget'
                          const isInvalid = (isFunc && hasCommandCatalog && !validCommandNames.has(s.text)) || (isAssignTarget && !isKnownAssignmentTarget(s.text, allKnownVarNames))
                          const isLineSyntaxInvalid = lineHasMissingRhs && (isAssignTarget || (!isFunc && !isObjMethod && !isFlowKw && s.text.trim() !== ''))
                          const displayText = (shouldAliasJudgeStartInTableMode && isFlowKw && s.text === '判断开始') ? '判断' : s.text
                          if (isFunc || isObjMethod || isFlowKw || isAssignTarget) {
                            const className = `${isAssignTarget ? 'Variablescolor' : (isUserSubRef ? 'eyc-subrefcolor' : s.cls)}${(isInvalid || isLineSyntaxInvalid) ? ' eyc-cmd-invalid' : ''}`
                            return (
                              <span
                                key={si}
                                className={className}
                              >{renderDebugAwareSpan(displayText, className, `code-${blk.lineIndex}-${si}`)}</span>
                            )
                          }
                          const className = `${s.cls}${isLineSyntaxInvalid ? ' eyc-cmd-invalid' : ''}`
                          return <span key={si} className={className}>{renderDebugAwareSpan(displayText, className, `code-${blk.lineIndex}-${si}`)}</span>
                        })}
                      </>
                    )
                  })()}
                </span>
              )}
              </div>
              {/* 展开的参数详情 */}
              {lineCmd && isExpanded && (() => {
                const argVals = parseCallArgs(blk.codeLine || '')
                // 计算代码行前导空格数，用于参数面板缩进
                const codeLine = (blk.codeLine || '').replace(FLOW_AUTO_TAG, '')
                const leadingSpaces = codeLine.length - codeLine.replace(/^ +/, '').length
                // 基础左边距 = gutter(80px) + 缩进空格(ch) + 命令名约1.5个字符居中位置
                const baseLeft = 80 + 8  // gutter + padding
                const indentCh = leadingSpaces + 1.5  // 缩进 + 命令名中间约1.5字符
                const arrowLeftStyle = `calc(${baseLeft}px + ${indentCh}ch)`
                const expandPadding = `calc(${baseLeft + 20}px + ${leadingSpaces}ch)`
                return (
                  <div
                    className="eyc-param-expand"
                    ref={(element) => setCssVars(element, { '--eyc-param-expand-padding-left': expandPadding })}
                  >
                    {renderFlowContinuation(blk.lineIndex)}
                    <span
                      className="eyc-param-expand-arrow"
                      ref={(element) => setCssVars(element, { '--eyc-param-expand-arrow-left': arrowLeftStyle })}
                    />
                    <div className="eyc-param-expand-inner">
                      {lineCmd.params.map((p, pi) => {
                        const isEditingParam = editCell && editCell.lineIndex === blk.lineIndex && editCell.paramIdx === pi
                        const startParamEdit = (e: React.MouseEvent) => {
                          e.stopPropagation()
                          // 点击参数行时提示该参数的信息
                          const rawCode = (blk.codeLine || '').replace(FLOW_AUTO_TAG, '')
                          const cmdName = findFirstCommandName(rawCode)
                          if (cmdName) {
                            const ownerAssembly = findOwnerAssemblyName(blk.lineIndex)
                            const hintName = userSubNamesRef.current.has(cmdName) ? `__SUB__:${cmdName}:${ownerAssembly}` : cmdName
                            onCommandClick?.(hintName, pi)
                          }
                          setEditCell({ lineIndex: blk.lineIndex, cellIndex: -2, fieldIdx: -1, sliceField: false, paramIdx: pi })
                          setEditVal(argVals[pi] !== undefined ? argVals[pi] : '')
                          setTimeout(() => paramInputRef.current?.focus(), 0)
                        }
                        return (
                          <div key={pi} className={`eyc-param-expand-row${isEditingParam ? '' : ' eyc-param-expand-row-clickable'}`} onClick={isEditingParam ? undefined : startParamEdit}>
                            <span className="eyc-param-expand-mark">※</span>
                            <span className="eyc-param-expand-name">{p.name}</span>
                            <span className="eyc-param-expand-colon">：</span>
                            {isEditingParam ? (
                              <input
                                ref={paramInputRef}
                                className="eyc-param-val-input"
                                aria-label={`编辑参数 ${p.name}`}
                                value={editVal}
                                onChange={e => { setEditVal(e.target.value); scheduleLiveUpdate(e.target.value) }}
                                onBlur={() => {
                                  if (shouldSuppressBlurCommit()) return
                                  commit()
                                }}
                                onKeyDown={e => {
                                  if (handleParamInputCtrlKey(e)) return
                                  if (e.key === 'Enter') { e.preventDefault(); commit() }
                                  else if (e.key === 'Escape') setEditCell(null)
                                }}
                                spellCheck={false}
                              />
                            ) : (
                              <span className="eyc-param-expand-val">{argVals[pi] !== undefined ? argVals[pi] : '\u00A0'}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
              {!lineCmd && assignDetail && isExpanded && (() => {
                const codeLine = (blk.codeLine || '').replace(FLOW_AUTO_TAG, '')
                const leadingSpaces = codeLine.length - codeLine.replace(/^ +/, '').length
                const baseLeft = 80 + 8
                const indentCh = leadingSpaces + 1.5
                const arrowLeftStyle = `calc(${baseLeft}px + ${indentCh}ch)`
                const expandPadding = `calc(${baseLeft + 20}px + ${leadingSpaces}ch)`
                const isEditingAssignValue = editCell && editCell.lineIndex === blk.lineIndex && editCell.paramIdx === -100
                const assignValueCmd = findCmdWithParams(assignDetail.value || '')
                const assignValueArgVals = assignValueCmd ? parseCallArgs(assignDetail.value || '') : []
                const isAssignValueCmdExpanded = expandedAssignRhsParamLines.has(blk.lineIndex)
                const showAssignValueFold = !!assignValueCmd && assignValueCmd.params.length > 0 && (isLineSelected || !!(editCell && editCell.lineIndex === blk.lineIndex))
                return (
                  <div
                    className="eyc-param-expand"
                    ref={(element) => setCssVars(element, { '--eyc-param-expand-padding-left': expandPadding })}
                  >
                    {showAssignValueFold && (
                      <span className="eyc-param-expand-gutter-fold-area">
                        <span
                          className="eyc-gutter-fold"
                          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setExpandedAssignRhsParamLines(prev => {
                              const next = new Set(prev)
                              if (next.has(blk.lineIndex)) next.delete(blk.lineIndex)
                              else next.add(blk.lineIndex)
                              return next
                            })
                          }}
                        >{isAssignValueCmdExpanded ? '−' : '+'}</span>
                      </span>
                    )}
                    {renderFlowContinuation(blk.lineIndex)}
                    <span
                      className="eyc-param-expand-arrow"
                      ref={(element) => setCssVars(element, { '--eyc-param-expand-arrow-left': arrowLeftStyle })}
                    />
                    <div className="eyc-param-expand-inner">
                      <div className="eyc-param-expand-row">
                        <span className="eyc-param-expand-mark">※</span>
                        <span className="eyc-param-expand-name">被赋值的变量或变量数组</span>
                        <span className="eyc-param-expand-colon">：</span>
                        <span className="eyc-param-expand-val">{assignDetail.target || '\u00A0'}</span>
                      </div>
                      <div className={`eyc-param-expand-row eyc-param-expand-row-assign-value${isEditingAssignValue ? '' : ' eyc-param-expand-row-clickable'}`} onClick={isEditingAssignValue ? undefined : (e) => {
                        e.stopPropagation()
                        setEditCell({ lineIndex: blk.lineIndex, cellIndex: -2, fieldIdx: -1, sliceField: false, paramIdx: -100 })
                        setEditVal(assignDetail.value || '')
                        setTimeout(() => paramInputRef.current?.focus(), 0)
                      }}>
                        <span className="eyc-param-expand-mark">※</span>
                        <span className="eyc-param-expand-name">用作赋予的值或资源</span>
                        <span className="eyc-param-expand-colon">：</span>
                        {isEditingAssignValue ? (
                          <input
                            ref={paramInputRef}
                            className="eyc-param-val-input"
                            aria-label="编辑赋值内容"
                            value={editVal}
                            onChange={e => { setEditVal(e.target.value); scheduleLiveUpdate(e.target.value) }}
                            onBlur={() => {
                              if (shouldSuppressBlurCommit()) return
                              commit()
                            }}
                            onKeyDown={e => {
                              if (handleParamInputCtrlKey(e)) return
                              if (e.key === 'Enter') { e.preventDefault(); commit() }
                              else if (e.key === 'Escape') setEditCell(null)
                            }}
                            spellCheck={false}
                          />
                        ) : (
                          <span className={`eyc-param-expand-val${isQuotedTextLiteral(assignDetail.value) ? ' eTxtcolor' : ''}`}>{assignDetail.value || '\u00A0'}</span>
                        )}
                      </div>
                      {assignValueCmd && isAssignValueCmdExpanded && (
                        <div className="eyc-param-expand-secondary">
                          <span className="eyc-param-expand-arrow eyc-param-expand-arrow-secondary" />
                          {assignValueCmd.params.map((p, pi) => {
                            const assignParamEditIdx = -200 - pi
                            const isEditingAssignCmdParam = editCell && editCell.lineIndex === blk.lineIndex && editCell.paramIdx === assignParamEditIdx
                            return (
                              <div
                                key={`assign-param-${pi}`}
                                onClick={isEditingAssignCmdParam ? undefined : (e) => {
                                  e.stopPropagation()
                                  const cmdName = findFirstCommandName(assignDetail.value || '')
                                  if (cmdName) {
                                    const ownerAssembly = findOwnerAssemblyName(blk.lineIndex)
                                    const hintName = userSubNamesRef.current.has(cmdName) ? `__SUB__:${cmdName}:${ownerAssembly}` : cmdName
                                    onCommandClick?.(hintName, pi)
                                  }
                                  setEditCell({ lineIndex: blk.lineIndex, cellIndex: -2, fieldIdx: -1, sliceField: false, paramIdx: assignParamEditIdx })
                                  setEditVal(assignValueArgVals[pi] !== undefined ? assignValueArgVals[pi] : '')
                                  setTimeout(() => paramInputRef.current?.focus(), 0)
                                }}
                                className={`eyc-param-expand-row eyc-param-expand-row-secondary${isEditingAssignCmdParam ? '' : ' eyc-param-expand-row-clickable'}`}
                              >
                                <span className="eyc-param-expand-mark">※</span>
                                <span className="eyc-param-expand-name">{p.name}</span>
                                <span className="eyc-param-expand-colon">：</span>
                                {isEditingAssignCmdParam ? (
                                  <input
                                    ref={paramInputRef}
                                    className="eyc-param-val-input"
                                    aria-label={`编辑赋值命令参数 ${p.name}`}
                                    value={editVal}
                                    onChange={e => { setEditVal(e.target.value); scheduleLiveUpdate(e.target.value) }}
                                    onBlur={() => {
                                      if (shouldSuppressBlurCommit()) return
                                      commit()
                                    }}
                                    onKeyDown={e => {
                                      if (handleParamInputCtrlKey(e)) return
                                      if (e.key === 'Enter') { e.preventDefault(); commit() }
                                      else if (e.key === 'Escape') setEditCell(null)
                                    }}
                                    spellCheck={false}
                                  />
                                ) : (
                                  <span className="eyc-param-expand-val">{assignValueArgVals[pi] !== undefined ? assignValueArgVals[pi] : '\u00A0'}</span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })()}
            </div>
            {diffDeletedAfterLines.has(blk.lineIndex) && (
              <div className="eyc-block-row eyc-block-row-wrap eyc-diff-deleted-placeholder" aria-hidden="true">
                <div className="eyc-line-gutter">
                  <div className="eyc-gutter-cell eyc-diff-deleted-placeholder-gutter">
                    <span className="eyc-breakpoint-dot">●</span>
                    <span className="eyc-gutter-linenum">&nbsp;</span>
                    <span className="eyc-gutter-fold-area" />
                  </div>
                </div>
                <div className="eyc-code-line eyc-diff-deleted-placeholder-line">
                  <span className="eyc-code-spans">&nbsp;</span>
                </div>
              </div>
            )}
            </Fragment>
          )
        })}
        {blockVirtualWindow.trailingSpacerPx > 0 && (
          <div
            aria-hidden="true"
            className="eyc-virtual-spacer"
            ref={(element) => setCssVars(element, { '--eyc-virtual-spacer-height': `${blockVirtualWindow.trailingSpacerPx}px` })}
          />
        )}
      </div>

      {shouldShowMinimapPreview && (
        <div
          className="eyc-minimap"
          role="region"
          aria-label="代码预览缩略图"
          tabIndex={0}
          onKeyDown={handleMinimapKeyDown}
          onWheel={handleMinimapWheel}
        >
          <div
            className="eyc-minimap-track"
            ref={minimapTrackRef}
            onMouseDown={handleMinimapMouseDown}
            aria-hidden="true"
          >
            <div className="eyc-minimap-content" ref={minimapContentRef} aria-hidden="true">
              {minimapPreviewRows.map((row, rowIndex) => (
                row.kind === 'deleted'
                  ? (
                      <div key={`mini-row-${rowIndex}`} className="eyc-minimap-row eyc-minimap-row-deleted">
                        <span className="eyc-minimap-marker eyc-minimap-marker-deleted" />
                        <span className="eyc-minimap-deleted-line" />
                      </div>
                    )
                  : row.kind === 'table'
                  ? (
                      <div key={`mini-row-${rowIndex}`} className={`eyc-minimap-row eyc-minimap-row-table${row.marker === 'error' ? ' eyc-minimap-row-error' : ''}`}>
                        <span className={`eyc-minimap-marker eyc-minimap-marker-${row.marker}`} />
                        {row.cells.map((cell, cellIndex) => (
                          <span key={`mini-cell-${rowIndex}-${cellIndex}`} className={`eyc-minimap-cell ${cell.cls}`}>{cell.text}</span>
                        ))}
                      </div>
                    )
                  : (
                      <div key={`mini-row-${rowIndex}`} className={`eyc-minimap-row eyc-minimap-row-code${row.marker === 'error' ? ' eyc-minimap-row-error' : ''}`}>
                        <span className={`eyc-minimap-marker eyc-minimap-marker-${row.marker}`} />
                        {row.spans.map((span, spanIndex) => (
                          <span key={`mini-span-${rowIndex}-${spanIndex}`} className={span.cls}>{span.text}</span>
                        ))}
                      </div>
                    )
              ))}
            </div>
            <div
              className="eyc-minimap-viewport"
              ref={minimapViewportRef}
            />
          </div>
        </div>
      )}
      <div className="eyc-scrollbar-status-lane eyc-scrollbar-status-lane-vertical" aria-hidden="true">
        {laidOutScrollbarStatusMarkers.map((marker, idx) => (
          <span
            key={`v-marker-${idx}`}
            className={`eyc-scrollbar-status-marker eyc-scrollbar-status-marker-${marker.type} ${marker.type === 'error' ? 'eyc-scrollbar-status-marker-errorlane' : 'eyc-scrollbar-status-marker-difflane'}`}
            ref={(element) => setCssVars(element, {
              '--eyc-scrollbar-marker-top': `${marker.topPx}px`,
              '--eyc-scrollbar-marker-height': `${marker.heightPx}px`,
            })}
          />
        ))}
      </div>
      <div className="eyc-scrollbar-mask eyc-scrollbar-mask-left" aria-hidden="true" />
      <div className="eyc-scrollbar-mask eyc-scrollbar-mask-right" aria-hidden="true" />
      </div>
      </div>

      <EycResourcePreview
        preview={resourcePreview}
        previewBusy={resourcePreviewBusy}
        previewSrc={resourcePreviewSrc}
        previewMsg={resourcePreviewMsg}
        previewMeta={resourcePreviewMeta}
        previewMediaMeta={resourcePreviewMediaMeta}
        projectDir={projectDir}
        onClose={() => setResourcePreview(prev => ({ ...prev, visible: false }))}
        onReplace={() => { void handleReplaceResourceFile() }}
        onImageLoaded={(width, height) => setResourcePreviewMediaMeta(prev => ({ ...prev, width, height }))}
        onAudioLoaded={(durationSec) => setResourcePreviewMediaMeta(prev => ({ ...prev, durationSec }))}
        onVideoLoaded={(width, height, durationSec) => setResourcePreviewMediaMeta(prev => ({ ...prev, width, height, durationSec }))}
        inferResourceTypeByFileName={inferResourceTypeByFileName}
      />

      {/* 自动补全弹窗 */}
      {acVisible && acItems.length > 0 && (
        <div
          className="eyc-ac-container"
          ref={(element) => setCssVars(element, {
            '--eyc-ac-left': `${acPos.left}px`,
            '--eyc-ac-top': `${acPos.top}px`,
          })}
          onMouseDown={e => e.preventDefault()}
        >
          <div className="eyc-ac-popup" ref={acListRef}>
            {acItems.map((item, i) => (
              <div
                key={`${item.cmd.name}_${i}`}
                className={`eyc-ac-item ${i === acIndex ? 'eyc-ac-item-active' : ''}${item.isMore ? ' eyc-ac-item-more' : ''}`}
                onMouseEnter={() => setAcIndex(i)}
                onClick={() => {
                  if (item.isMore) return
                  applyCompletion(item)
                }}
                onDoubleClick={() => {
                  if (item.isMore) expandMoreCompletion(i)
                }}
              >
                <span className={`eyc-ac-icon ${item.isMore ? 'eyc-ac-icon-flow' : getCmdIconClass(item.cmd.category)}`}>
                  {item.isMore
                    ? '…'
                    : item.cmd.category.includes('资源')
                      ? <Icon name="resource-view" size={14} />
                    : item.cmd.category.includes('子程序')
                      ? <Icon name="method" size={14} />
                    : item.cmd.category.includes('常量')
                      ? <Icon name="constant" size={14} />
                    : item.cmd.category.includes('全局变量')
                      ? <Icon name="field" size={14} />
                      : item.cmd.category.toLowerCase().includes('dll')
                        ? <Icon name="dll-command" size={14} />
                      : getCmdIconLabel(item.cmd.category)}
                </span>
                <span className="eyc-ac-name">
                  {item.isMore
                    ? `...（双击显示剩余 ${item.remainCount || 0} 项）`
                    : `${item.cmd.name}${item.engMatch && item.cmd.englishName ? `（${item.cmd.englishName}）` : ''}`}
                </span>
                {!item.isMore && (item.cmd.category.includes('常量') || item.cmd.category.includes('资源')) && item.cmd.libraryName && (
                  <span className="eyc-ac-source">{item.cmd.libraryName}</span>
                )}
                {!item.isMore && item.cmd.returnType && <span className="eyc-ac-return">{item.cmd.returnType}</span>}
              </div>
            ))}
          </div>
          {acItems[acIndex] && (() => {
            const selectedItem = acItems[acIndex]
            if (selectedItem.isMore) {
              return (
                <div className="eyc-ac-detail">
                  <div className="eyc-ac-detail-desc">双击列表最后一项“...”可展开显示剩余匹配项。</div>
                </div>
              )
            }
            const ci = selectedItem.cmd
            const paramSig = ci.params.length > 0
              ? ci.params.map(p => {
                  let s = ''
                  if (p.optional) s += '［'
                  s += p.type
                  if (p.isArray) s += '数组'
                  s += ' ' + p.name
                  if (p.optional) s += '］'
                  return s
                }).join('，')
              : ''
            const retLabel = ci.returnType ? `〈${ci.returnType}〉` : '〈无返回值〉'
            const source = [ci.libraryName, ci.category].filter(Boolean).join('->')
            return (
              <div className="eyc-ac-detail">
                <div className="eyc-ac-detail-call">
                  <span className="eyc-ac-detail-label">调用格式：</span>
                  {retLabel} {ci.name} （{paramSig}）{source && <> - {source}</>}
                </div>
                {ci.englishName && (
                  <div className="eyc-ac-detail-eng">
                    <span className="eyc-ac-detail-label">英文名称：</span>{ci.englishName}
                  </div>
                )}
                {ci.description && (
                  <div className="eyc-ac-detail-desc">{ci.description}</div>
                )}
                {ci.params.length > 0 && (
                  <div className="eyc-ac-detail-params">
                    {ci.params.map((p, pi) => (
                      <div key={pi} className="eyc-ac-detail-param">
                        <span className="eyc-ac-detail-param-head">
                          参数&lt;{pi + 1}&gt;的名称为"{p.name}"，类型为"{p.type}{p.isArray ? '(数组)' : ''}{p.isVariable ? '(参考)' : ''}"{p.optional ? '，可以被省略' : ''}。
                        </span>
                        {p.description && <span className="eyc-ac-detail-param-desc">{p.description}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}
      {editorContextMenu && (
        <div
          className="eyc-editor-context-menu"
          ref={(element) => setCssVars(element, {
            '--eyc-context-menu-left': `${editorContextMenu.x}px`,
            '--eyc-context-menu-top': `${editorContextMenu.y}px`,
          })}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('newSubprogram')}>
            <span className="eyc-editor-context-menu-item-label">N.新子程序</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ctrl+N</span>
          </button>
          <div className="eyc-editor-context-menu-sep" />
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('undo')} disabled={!canUndoContextAction}>
            <span className="eyc-editor-context-menu-item-label">U.撤销</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ctrl+Z</span>
          </button>
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('redo')} disabled={!canRedoContextAction}>
            <span className="eyc-editor-context-menu-item-label">Y.重做</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ctrl+Y</span>
          </button>
          <div className="eyc-editor-context-menu-sep" />
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('copy')} disabled={!hasCopySelection}>
            <span className="eyc-editor-context-menu-item-label">C.复制</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ctrl+C</span>
          </button>
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('cut')} disabled={!canCutContextAction}>
            <span className="eyc-editor-context-menu-item-label">T.剪切</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ctrl+X</span>
          </button>
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('paste')} disabled={!contextMenuCanPaste}>
            <span className="eyc-editor-context-menu-item-label">P.粘贴</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ctrl+V</span>
          </button>
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('selectAll')}>
            <span className="eyc-editor-context-menu-item-label">F.全选</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ctrl+A</span>
          </button>
          <div className="eyc-editor-context-menu-sep" />
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('delete')}>
            <span className="eyc-editor-context-menu-item-label">E.删除行</span>
            <span className="eyc-editor-context-menu-item-shortcut">F10</span>
          </button>
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('insertLine')}>
            <span className="eyc-editor-context-menu-item-label">I.插入新行</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ins</span>
          </button>
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('compileLine')}>
            <span className="eyc-editor-context-menu-item-label">K.编译当前行</span>
            <span className="eyc-editor-context-menu-item-shortcut">Shift+Enter</span>
          </button>
          <div className="eyc-editor-context-menu-sep" />
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('block')}>
            <span className="eyc-editor-context-menu-item-label">G.屏蔽</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ctrl+K</span>
          </button>
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('unblock')}>
            <span className="eyc-editor-context-menu-item-label">B.解除屏蔽</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ctrl+M</span>
          </button>
        </div>
      )}
      {debugHover && (
        <div
          className="eyc-debug-hover-tooltip"
          ref={(element) => setCssVars(element, {
            '--eyc-debug-tooltip-left': `${debugHover.x}px`,
            '--eyc-debug-tooltip-top': `${debugHover.y}px`,
          })}
        >
          <div className="eyc-debug-hover-name">{debugHover.variable.name}</div>
          <div className="eyc-debug-hover-type">{debugHover.variable.type}</div>
          <div className="eyc-debug-hover-value">{debugHover.variable.value || '（空）'}</div>
        </div>
      )}
    </div>
  )
})

export default EycTableEditor
