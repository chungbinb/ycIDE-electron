import { useState, useCallback, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react'
import { eycToYiFormat, sanitizePastedTextForCurrent } from './eycFormat'
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
  FLOW_ELSE_MARK,
  FLOW_JUDGE_END_MARK,
  FLOW_KW,
  FLOW_LOOP_KW,
  FLOW_START,
  FLOW_TRUE_MARK,
  computeFlowLines,
  extractFlowKw,
  getFlowStructureAround,
  isFlowMarkerLine,
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
  parseFlowMarkerTargetLine,
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

// ========== 组件 ==========

export interface EycTableEditorHandle {
  insertSubroutine: () => void
  insertLocalVariable: () => void
  insertConstant: () => void
  navigateOrCreateSub: (subName: string, params: Array<{ name: string; dataType: string; isByRef: boolean }>) => void
  navigateToLine: (line: number) => void
  getVisibleLineForSourceLine: (line: number) => number
  editorAction: (action: string) => void
}

interface EycTableEditorProps {
  value: string
  docLanguage?: string
  editorFontFamily?: string
  editorFontSize?: number
  editorLineHeight?: number
  projectDir?: string
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
  breakpointLines?: number[]
  debugSourceLine?: number
  debugVariables?: Array<{ name: string; type: string; value: string }>
  diffHighlightLines?: Set<number>
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

const EycTableEditor = forwardRef<EycTableEditorHandle, EycTableEditorProps>(function EycTableEditor({ value, docLanguage = '', editorFontFamily = '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace', editorFontSize = 14, editorLineHeight = 20, projectDir, isClassModule = false, projectGlobalVars = [], windowControlNames = [], windowControlTypes = [], windowUnits = [], projectConstants = [], projectDllCommands = [], projectDataTypes = [], projectClassNames = [], onClassNameRename, onChange, onCommandClick, onCommandClear, onProblemsChange, onCursorChange, breakpointLines = [], debugSourceLine, debugVariables = [], diffHighlightLines }, ref) {
  const eycScale = useMemo(() => clampNumber(editorFontSize / 13, 0.75, 2), [editorFontSize])
  const [editCell, setEditCell] = useState<EditState | null>(null)
  const [editVal, setEditVal] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const paramInputRef = useRef<HTMLInputElement>(null)
  const prevRef = useRef(value)
  const [currentText, setCurrentText] = useState(value)
  const lastFocusedLine = useRef<number>(-1)
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
  const [expandedLines, setExpandedLines] = useState<Set<number>>(new Set())
  const [expandedAssignRhsParamLines, setExpandedAssignRhsParamLines] = useState<Set<number>>(new Set())
  const isResourceTableDoc = docLanguage === 'erc'
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

  // ===== 行选择状态 =====
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set())
  const dragAnchor = useRef<number | null>(null)  // 拖选起点行号
  const isDragging = useRef(false)
  const dragStartPos = useRef<{ x: number; y: number } | null>(null)
  const wasDragSelect = useRef(false)
  const pendingInputDragRef = useRef<{ lineIndex: number; x: number; y: number; allowRowDrag: boolean } | null>(null)

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
        const ls = currentText.split('\n')
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
          redoStack.current.push(currentText)
          setCurrentText(prev); prevRef.current = prev; onChange(prev)
        }
        return
      }
      if (ctrl && (key === 'y' || (e.shiftKey && key === 'z')) && inEditor) {
        e.preventDefault()
        if (redoStack.current.length > 0) {
          const next = redoStack.current.pop()!
          undoStack.current.push(currentText)
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
          const cursorLine = editCellRef.current?.lineIndex ?? lastFocusedLine.current
          const pasteResult = buildMultiLinePasteResult({
            currentText,
            clipText,
            cursorLine,
            sanitizePastedText: sanitizePastedTextForCurrent,
          })
          if (!pasteResult) return
          pushUndo(currentText)
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
        const { deletable, sorted } = getDeletableSelection(ls, selectedLines)
        if (sorted.length === 0) return
        const selectedText = eycToYiFormat(sorted.map(i => ls[i]).join('\n'))
        navigator.clipboard.writeText(selectedText)
        // 仅保护结构性结束标记行（最后一段的最后一行，如 \u200D / \u2060 / 循环尾）
        const checkedCmds = new Set<number>()
        const wouldBreak = sorted.some(i => {
          if (i >= ls.length) return false
          const st = getFlowStructureAround(ls, i)
          if (!st || checkedCmds.has(st.cmdLine)) return false
          checkedCmds.add(st.cmdLine)
          if (deletable.has(st.cmdLine)) return false // 命令行也选中，允许整体删除
          const lastSec = [...st.sections].reverse().find(s => s.char !== null)
          return !!lastSec && deletable.has(lastSec.endLine)
        })
        if (wouldBreak) return
        // 删除选中行
        pushUndo(currentText)
        const nl = ls.filter((_, i) => !deletable.has(i))
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt)
        setSelectedLines(new Set())
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        const ls = currentText.split('\n')
        // 仅保护结构性结束标记行（最后一段的最后一行）
        const { deletable, sorted: sortedSel } = getDeletableSelection(ls, selectedLines)
        if (sortedSel.length === 0) return
        const checkedCmds2 = new Set<number>()
        const wouldBreak2 = sortedSel.some(i => {
          if (i >= ls.length) return false
          const st = getFlowStructureAround(ls, i)
          if (!st || checkedCmds2.has(st.cmdLine)) return false
          checkedCmds2.add(st.cmdLine)
          if (deletable.has(st.cmdLine)) return false
          const lastSec = [...st.sections].reverse().find(s => s.char !== null)
          return !!lastSec && deletable.has(lastSec.endLine)
        })
        if (wouldBreak2) return
        pushUndo(currentText)
        const nl = ls.filter((_, i) => !deletable.has(i))
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt)
        setSelectedLines(new Set())
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedLines, currentText, onChange, pushUndo])

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

  const userVarTypeMap = useMemo(() => {
    const parsed = parseLines(currentText)
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
  }, [currentText, editCell?.lineIndex, projectGlobalVars, windowControlTypes])

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

    const parsed = parseLines(currentText)
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
  }, [currentText, projectDataTypes])

  // 加载所有命令（用于补全），含流程关键字
  const reloadCommands = useCallback(() => {
    window.api.library.getAllCommands().then((cmds: CompletionItem[]) => {
      const { independentItems, memberItems, libraryConstantItems } = buildCompletionCatalog(cmds)
      allCommandsRef.current = independentItems
      memberCommandsRef.current = memberItems
      libraryConstantCompletionItemsRef.current = libraryConstantItems

      setCmdLoadId(n => n + 1)
    }).catch(() => {})
  }, [])

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

    const allowEmptyWord = isMemberAccess && !isTypeCellEdit && !isClassNameCellEdit && !hashMode && word.length === 0

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
  }, [editCell, canUseTypeCompletion, canUseClassNameCompletion, windowControlTypeMap])

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

  /** 代码行编辑结束时自动补全括号（格式化命令），返回 [主行, ...需要插入的后续行] */
  const formatCommandLine = useCallback((val: string): string[] => {
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
    const rawCmdToken = trimmed.split(/[\s(（]/)[0]
    const resolved = resolveCmdToken(rawCmdToken)
    const cmdName = resolved.normalizedToken
    const lookupCmdName = resolved.lookupName
    if (!/^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*$/.test(cmdName)) return [val]

    // 流程控制命令自动补齐后续行
    const autoLines = FLOW_AUTO_COMPLETE[cmdName]
    if (autoLines) {
      const cmd = resolved.command || allCmdPool.find(c => c.name === lookupCmdName)
      // 命令本身和内部代码行都缩进4空格（两个汉字宽度）给流程线留空间
      const innerPrefix = prefix + '    '
      let mainLine: string
      const parenRange = getOuterParenRange(trimmed)
      if (parenRange) {
        // 已输入括号时尽量保留用户输入参数内容，再做流程补齐
        const argText = trimmed.slice(parenRange.start + 1, parenRange.end).trim()
        mainLine = innerPrefix + cmdName + '（' + argText + '）'
      } else if (cmd && cmd.params.length > 0) {
        const paramSlots = cmd.params.map(p => p.optional ? '' : '').join(',')
        mainLine = innerPrefix + cmdName + '（' + paramSlots + '）'
      } else {
        mainLine = innerPrefix + cmdName + '（）'
      }
      // 自动插入的分支/结束行
      const extra = autoLines.map(kw => {
        if (kw === null) return ''
        if (kw === FLOW_TRUE_MARK || kw === FLOW_ELSE_MARK || kw === FLOW_JUDGE_END_MARK) return innerPrefix + kw
        // 流程尾命令也需要括号（如 计次循环尾）
        const tailCmd = allCommandsRef.current.find(c => c.name === kw)
        if (tailCmd && tailCmd.params.length > 0) {
          const tailSlots = tailCmd.params.map(p => p.optional ? '' : '').join(',')
          return innerPrefix + FLOW_AUTO_TAG + kw + '（' + tailSlots + '）'
        }
        return innerPrefix + FLOW_AUTO_TAG + kw + '（）'
      })
      return [mainLine, ...extra]
    }

    // 普通命令：仅对“裸命令名”自动补括号
    const m = trimmed.match(/^([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*)\s*$/)
    if (!m) return [val]

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

  useEffect(() => {
    if (value !== prevRef.current) { setCurrentText(value); prevRef.current = value }
  }, [value])

  const lines = useMemo(() => currentText.split('\n'), [currentText])
  const parsedLines = useMemo(() => parseLines(currentText), [currentText])

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

  const blocks = useMemo<RenderBlock[]>(() => {
    try {
      return buildBlocks(currentText, isClassModule, isResourceTableDoc)
    } catch (error) {
      console.error('[EycTableEditor] buildBlocks failed, fallback to line blocks', error)
      return currentText.split('\n').map((line, idx): RenderBlock => ({
        kind: 'codeline' as const,
        rows: [],
        codeLine: line,
        lineIndex: idx,
        isVirtual: false,
      }))
    }
  }, [currentText, isClassModule, isResourceTableDoc])
  const flowLines = useMemo(() => {
    try {
      return computeFlowLines(blocks)
    } catch (error) {
      console.error('[EycTableEditor] computeFlowLines failed, disable flow rendering for current content', error)
      return { map: new Map<number, FlowSegment[]>(), maxDepth: 0 }
    }
  }, [blocks])

  // 对实际渲染的可见行按顺序分配连续行号（跳过 isHeader / isVirtual）
  // 注意：表格内可能存在多个可见行映射到同一源码 lineIndex（如 DLL 命令块），
  // 行号显示应按“可见行”递增，而不是按源码行号去重。
  const lineNumMaps = useMemo(() => {
    const tableRowNumMap = new Map<string, number>()
    const codeLineNumMap = new Map<number, number>()
    const sourceLineNumMap = new Map<number, number>()
    let display = 0
    for (let bi = 0; bi < blocks.length; bi++) {
      const blk = blocks[bi]
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
  }, [blocks])

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
    const parsed = parseLines(currentText)
    for (const ln of parsed) {
      if (ln.type === 'sub' && ln.fields[0]) subs.add(ln.fields[0])
      if ((ln.type === 'localVar' || ln.type === 'subParam' || ln.type === 'assemblyVar' || ln.type === 'globalVar') && ln.fields[0]) vars.add(ln.fields[0])
    }
    return { userSubNames: subs, userVarNames: vars }
  }, [currentText])
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
    const parsed = parseLines(currentText)
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
  }, [currentText, editCell?.lineIndex, projectGlobalVars, windowControlNames])
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
    const parsed = parseLines(currentText)
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
  }, [currentText, projectConstants, libraryConstants])

  useEffect(() => {
    constantCompletionItemsRef.current = constantCompletionItems
  }, [constantCompletionItems])

  const dllCompletionItems = useMemo<CompletionItem[]>(() => {
    const parsed = parseLines(currentText)
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
  }, [currentText, projectDllCommands])

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

    const parsed = parseLines(currentText)
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
  }, [currentText, libraryDataTypeNames, projectDataTypes, projectClassNames])

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

    const parsed = parseLines(currentText)
    for (const ln of parsed) {
      if (ln.type === 'assembly' && ln.fields[0]) {
        addClass(ln.fields[0])
      }
    }

    for (const c of projectClassNames) addClass(c.name)

    return items
  }, [currentText, projectClassNames])

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
    for (const blk of blocks) {
      if (blk.kind !== 'codeline' || !blk.codeLine) continue
      const rawLine = blk.codeLine.replace(FLOW_AUTO_TAG, '')
      if (getMissingAssignmentRhsTarget(rawLine)) set.add(blk.lineIndex)
    }
    return set
  }, [blocks])

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
    const parsed = parseLines(currentText)
    for (let i = 0; i < parsed.length; i++) {
      const ln = parsed[i]
      if (ln.type === 'localVar' || ln.type === 'assemblyVar' || ln.type === 'globalVar' || ln.type === 'subParam') {
        const name = (ln.fields[0] || '').trim()
        if (name && (!isValidVariableLikeName(name) || reservedNameSet.has(name))) set.add(i)
      }
    }
    return set
  }, [currentText, reservedNameSet])

  // 计算问题列表（无效命令 + 变量名冲突）
  useEffect(() => {
    if (!onProblemsChange) return
    const problems: FileProblem[] = []

    // 无效命令检查
    if (allCommandsRef.current.length > 0) {
      for (const blk of blocks) {
        if (blk.kind !== 'codeline' || !blk.codeLine) continue
        const rawLine = blk.codeLine.replace(FLOW_AUTO_TAG, '')
        const spans = colorize(rawLine)
        let col = 1
        for (const s of spans) {
          if (s.cls === 'funccolor' && !validCommandNames.has(s.text)) {
            problems.push({ line: blk.lineIndex + 1, column: col, message: `未知命令"${s.text}"`, severity: 'error' })
          }
          if (s.cls === 'assignTarget' && !isKnownAssignmentTarget(s.text, allKnownVarNames)) {
            problems.push({ line: blk.lineIndex + 1, column: col, message: `未知变量"${s.text}"`, severity: 'error' })
          }
          col += s.text.length
        }

        // 赋值语句缺少右值：例如“全局变量1 ＝”
        const missingTarget = getMissingAssignmentRhsTarget(rawLine)
        if (missingTarget) {
          const eqPos = rawLine.search(/(?:=|＝)\s*$/)
          const column = eqPos >= 0 ? eqPos + 1 : 1
          problems.push({ line: blk.lineIndex + 1, column, message: `赋值语句缺少右值（${missingTarget}）`, severity: 'error' })
        }
      }
    }

    // 变量名冲突检查
    const parsedLines = parseLines(currentText)
    const assemblyVars = new Map<string, number>()
    const globalVars = new Map<string, number>()
    let localVarsByName = new Map<string, number[]>()
    let inSub = false

    const checkLocalVars = (): void => {
      if (!inSub) return
      for (const [name, lineIndices] of localVarsByName) {
        if (lineIndices.length > 1) {
          for (let k = 1; k < lineIndices.length; k++) {
            problems.push({ line: lineIndices[k] + 1, column: 1, message: `局部变量"${name}"在当前子程序中重复定义`, severity: 'error' })
          }
        }
        if (assemblyVars.has(name)) {
          for (const li of lineIndices) {
            problems.push({ line: li + 1, column: 1, message: `局部变量"${name}"与程序集变量同名`, severity: 'error' })
          }
        }
        if (globalVars.has(name)) {
          for (const li of lineIndices) {
            problems.push({ line: li + 1, column: 1, message: `局部变量"${name}"与全局变量同名`, severity: 'error' })
          }
        }
      }
      localVarsByName = new Map()
    }

    for (let i = 0; i < parsedLines.length; i++) {
      const ln = parsedLines[i]
      if (ln.type === 'assemblyVar') {
        const name = ln.fields[0]
        if (name) {
          if (!isValidVariableLikeName(name)) {
            problems.push({ line: i + 1, column: 1, message: `变量名"${name}"不能以数字或特殊符号开头`, severity: 'error' })
          } else if (reservedNameSet.has(name)) {
            problems.push({ line: i + 1, column: 1, message: `变量名"${name}"不能与关键字或命令同名`, severity: 'error' })
          }
          if (assemblyVars.has(name)) {
            problems.push({ line: i + 1, column: 1, message: `程序集变量"${name}"重复定义`, severity: 'error' })
          } else {
            assemblyVars.set(name, i)
          }
        }
      } else if (ln.type === 'globalVar') {
        const name = ln.fields[0]
        if (name) {
          if (!isValidVariableLikeName(name)) {
            problems.push({ line: i + 1, column: 1, message: `变量名"${name}"不能以数字或特殊符号开头`, severity: 'error' })
          } else if (reservedNameSet.has(name)) {
            problems.push({ line: i + 1, column: 1, message: `变量名"${name}"不能与关键字或命令同名`, severity: 'error' })
          }
          if (globalVars.has(name)) {
            problems.push({ line: i + 1, column: 1, message: `全局变量"${name}"重复定义`, severity: 'error' })
          } else {
            globalVars.set(name, i)
          }
        }
      } else if (ln.type === 'sub') {
        checkLocalVars()
        inSub = true
      } else if (ln.type === 'assembly') {
        checkLocalVars()
        inSub = false
      } else if (ln.type === 'localVar') {
        const name = ln.fields[0]
        if (name) {
          if (!isValidVariableLikeName(name)) {
            problems.push({ line: i + 1, column: 1, message: `变量名"${name}"不能以数字或特殊符号开头`, severity: 'error' })
          } else if (reservedNameSet.has(name)) {
            problems.push({ line: i + 1, column: 1, message: `变量名"${name}"不能与关键字或命令同名`, severity: 'error' })
          }
          const arr = localVarsByName.get(name)
          if (arr) arr.push(i)
          else localVarsByName.set(name, [i])
        }
      } else if (ln.type === 'subParam') {
        const name = ln.fields[0]
        if (name) {
          if (!isValidVariableLikeName(name)) {
            problems.push({ line: i + 1, column: 1, message: `参数名"${name}"不能以数字或特殊符号开头`, severity: 'error' })
          } else if (reservedNameSet.has(name)) {
            problems.push({ line: i + 1, column: 1, message: `参数名"${name}"不能与关键字或命令同名`, severity: 'error' })
          }
        }
      }
    }
    checkLocalVars()

    onProblemsChange(problems)
  }, [blocks, validCommandNames, allKnownVarNames, onProblemsChange, currentText, reservedNameSet])

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
      // 流程标记行：检查是否输入了流程命令（嵌套流程控制）
      if (flowMarkRef.current) {
        const markerChar = flowMarkRef.current.trimStart().charAt(0) // '\u200C' or '\u200D' or '\u2060'
        const markerIndent = flowMarkRef.current.slice(0, flowMarkRef.current.length - 1) // 缩进（去掉末尾标记字符）
        const trimmedVal = effectiveVal.trim()
        const cmdCheckName = trimmedVal.startsWith('.') ? trimmedVal : trimmedVal.split(/[\s(（]/)[0]
        if (trimmedVal && FLOW_AUTO_COMPLETE[cmdCheckName]) {
          if (markerChar === '\u2060' && cmdCheckName === '判断') {
            const parentPrefix = markerIndent.length >= 4 ? markerIndent.slice(0, -4) : ''
            let formattedLines = formatCommandLine(parentPrefix + effectiveVal)
            if (formattedLines.length > 0 && formattedLines[formattedLines.length - 1].trim() === '') {
              formattedLines = formattedLines.slice(0, -1)
            }
            const nl = [...lines]
            // 替换当前 \u2060 标记行为格式化的命令
            nl.splice(editCell.lineIndex, 1, ...formattedLines)
            const nt = nl.join('\n')
            setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
            flowMarkRef.current = ''
            return
          }
          // 标记行上输入流程命令 → 嵌套流程控制
          // 使用标记行的缩进作为流程命令缩进基础
          let formattedLines = formatCommandLine(markerIndent + effectiveVal)
          // 内层不需要尾部普通空行，去掉
          if (formattedLines.length > 0 && formattedLines[formattedLines.length - 1].trim() === '') {
            formattedLines = formattedLines.slice(0, -1)
          }
          const nl = [...lines]
          // 替换当前标记行为格式化的命令（不保留原标记行）
          nl.splice(editCell.lineIndex, 1, ...formattedLines)
          // 在内层块结束后追加外层标记行
          const insertPos = editCell.lineIndex + formattedLines.length
          nl.splice(insertPos, 0, flowMarkRef.current)
          const nt = nl.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
          flowMarkRef.current = ''
          return
        }
        // 非流程命令：格式化后保存（自动补全括号和参数）
        const fmtLines = formatCommandLine(markerIndent + effectiveVal)
        const nl = [...lines]; nl[editCell.lineIndex] = flowMarkRef.current + fmtLines[0].slice(markerIndent.length)
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
        flowMarkRef.current = ''
        return
      }
      // formatCommandLine 会为流程命令额外加4空格，若 flowIndent 已包含流程缩进则需减去以避免翻倍
      let baseIndent = flowIndentRef.current
      const trimmedCmd = effectiveVal.trim()
      const cmdCheckName = trimmedCmd.startsWith('.') ? trimmedCmd : trimmedCmd.split(/[\s(（]/)[0]
      const isBareCmd = /^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*\s*$/.test(trimmedCmd)
      const isParenCmd = /^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*\s*[\(（].*[\)）]\s*$/.test(trimmedCmd)
      if ((isBareCmd || isParenCmd) && trimmedCmd && FLOW_AUTO_COMPLETE[cmdCheckName] && baseIndent.length >= 4) {
        baseIndent = baseIndent.slice(0, baseIndent.length - 4)
      }
      // 原流程起始命令被改为普通命令：沿用原始行的真实缩进作为 baseIndent，避免嵌套层级下过度反缩进
      if (wasFlowStartRef.current && trimmedCmd && !FLOW_AUTO_COMPLETE[cmdCheckName]) {
        baseIndent = wasFlowOrigIndentRef.current
      }
      const formattedLines = formatCommandLine(baseIndent + effectiveVal)
      flowIndentRef.current = ''
      const mainLine = formattedLines[0]
      // 检查是否需要插入自动补齐的后续行（只在新输入时插入，已有匹配结束标记时不重复插入）
      let extraLines = formattedLines.slice(1)
      if (extraLines.length > 0) {
        // 检查后续行是否已存在对应的结束/分支关键词（只在新输入时插入，已有匹配结束标记时不重复插入）
        // 扫描在当前子程序范围内，且遇到同缩进的普通代码行就停止，避免跨块错误复用远处标记
        const afterIdx = editCell.isVirtual ? editCell.lineIndex + 2 : editCell.lineIndex + 1
        const mainIndentLen = mainLine.length - mainLine.replace(/^ +/, '').length
        const remainingLines: string[] = []
        for (let ri = afterIdx; ri < lines.length; ri++) {
          const rawRl = lines[ri]
          const rlTrim = rawRl.replace(/[\r\t]/g, '').trim()
          if (rlTrim.startsWith('.子程序 ') || rlTrim.startsWith('.程序集 ')) break
          if (rlTrim === '') { remainingLines.push(rawRl); continue }
          const rlIndent = rawRl.length - rawRl.replace(/^ +/, '').length
          if (rlIndent < mainIndentLen) break
          remainingLines.push(rawRl)
          if (rlIndent === mainIndentLen) {
            const rlKw = extractFlowKw(rawRl)
            // 同缩进且不是流程标记/结束/分支：属于块外普通代码，停止扫描
            if (!rlKw) break
          }
        }
        const kwLines = extraLines.filter(el => {
          const t = el.trim()
          return el.includes(FLOW_AUTO_TAG) || t === FLOW_TRUE_MARK || t === FLOW_ELSE_MARK || t === FLOW_JUDGE_END_MARK
        })
        const hasEnding = kwLines.length > 0 && kwLines.every(el => {
          const t = el.trim()
          const rawKw = (t === FLOW_TRUE_MARK || t === FLOW_ELSE_MARK || t === FLOW_JUDGE_END_MARK) ? t : el.replace(FLOW_AUTO_TAG, '').trim()
          // 提取纯关键词名（去掉括号和参数部分）
          const kw = rawKw.split(/[\s(（]/)[0] || rawKw
          return remainingLines.some(rl => extractFlowKw(rl) === kw)
        })
        if (hasEnding) extraLines = []
      }
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
      const newIsFlow = !!(trimmedCmd && FLOW_AUTO_COMPLETE[cmdCheckName])
      if (!editCell.isVirtual && oldKw && !newIsFlow && FLOW_START[oldKw]) {
        const deleteSet = new Set<number>()
        const unindentSet = new Set<number>()
        const baseIndentLen = wasFlowOrigIndentRef.current.length
        const endKw = FLOW_START[oldKw]
        const endKwSet = (() => {
          if (oldKw === '如果' || oldKw === '如果真') return new Set<string>([endKw, FLOW_ELSE_MARK])
          if (oldKw === '判断') return new Set<string>([endKw, FLOW_JUDGE_END_MARK])
          return new Set<string>([endKw])
        })()
        const branchKwSet = (() => {
          if (oldKw === '判断') return new Set<string>([FLOW_TRUE_MARK, '默认'])
          if (oldKw === '如果') return new Set<string>([FLOW_TRUE_MARK, '否则'])
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
            const noIndent = lineText.replace(/^ +/, '')
            const markerWithPayload =
              (kw === FLOW_TRUE_MARK || kw === FLOW_ELSE_MARK || kw === FLOW_JUDGE_END_MARK)
              && noIndent.length > 1
            if (kw && endKwSet.has(kw)) {
              if (markerWithPayload) {
                unindentSet.add(i)
                break
              }
              deleteSet.add(i)
              break
            }
            if (kw && branchKwSet.has(kw)) {
              if (markerWithPayload) {
                unindentSet.add(i)
                continue
              }
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
              const content = ln.slice(lead.length)
              if (
                (content.startsWith(FLOW_TRUE_MARK) || content.startsWith(FLOW_ELSE_MARK) || content.startsWith(FLOW_JUDGE_END_MARK))
                && content.length > 1
              ) {
                ln = lead + content.slice(1)
              }
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
  }, [editCell, editVal, isClassModule, isResourceTableDoc, lines, onChange, onClassNameRename])

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
    // 剥离流程标记零宽字符和对应的缩进前缀，编辑时不显示
    const stripped = text.replace(/^ +/, '')
    let flowMark = ''
    if (stripped.startsWith('\u200C') || stripped.startsWith('\u200D') || stripped.startsWith('\u2060')) {
      flowMark = text.slice(0, text.length - stripped.length + 1) // 保留缩进 + 标记字符
      text = stripped.slice(1) // 实际可编辑内容
    }
    // 对于有流程线的普通行，剥离被流程线覆盖的前导空格
    let flowIndent = ''
    if (!flowMark && !isVirtual) {
      // 若 commit 刚修改了文本但尚未重渲染，flowLines 可能过时，需重新计算
      const currentFlowLines = (latestText === currentText) ? flowLines : computeFlowLines(buildBlocks(latestText, isClassModule, isResourceTableDoc))
      const segs = currentFlowLines.map.get(li) || []
      if (segs.length > 0) {
        const lineMaxDepth = Math.max(...segs.map(s => s.depth)) + 1
        const stripCount = lineMaxDepth * 4
        const leadingSpaces = text.match(/^ */)?.[0] || ''
        const actualStrip = Math.min(stripCount, leadingSpaces.length)
        // 已有内容的行使用真实剥离的缩进，避免嵌套流程起始行在反复点击后重复右移；
        // 只有空行/无足够前导空格时才回退到流程深度占位，保证新输入命令仍能落在正确层级。
        flowIndent = ' '.repeat(actualStrip > 0 ? actualStrip : stripCount)
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
    flowMarkRef.current = flowMark
    flowIndentRef.current = flowIndent
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
          ctx.font = '13px Consolas, "Microsoft YaHei", monospace'
          let pos = text.length
          for (let i = 1; i <= text.length; i++) {
            const w = ctx.measureText(text.slice(0, i)).width
            if (w > relX) {
              const wPrev = ctx.measureText(text.slice(0, i - 1)).width
              pos = (relX - wPrev < w - relX) ? i - 1 : i
              break
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

  const {
    getFlowAutoExpandCandidate,
    getCodeLineNavigationAction,
    getEmptyCodeLineDeleteAction,
    getMarkerEndEnterAction,
    getParenScopedKeyAction,
    isIfTrueMarkerEndContext,
  } = useCodeLineEditor()

  const applyTextChange = useCallback((nextText: string) => {
    setCurrentText(nextText)
    prevRef.current = nextText
    onChange(nextText)
  }, [onChange])

  const beginCodeLineEdit = useCallback((lineIndex: number, value: string) => {
    setEditCell({ lineIndex, cellIndex: -1, fieldIdx: -1, sliceField: false })
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
    const markerState = parseFlowMarkerTargetLine(targetLine)
    if (markerState.hasMarker) {
      flowMarkRef.current = markerState.flowMark
      beginCodeLineEdit(lineIndex, markerState.editValue)
      return
    }
    flowMarkRef.current = ''
    beginCodeLineEdit(lineIndex, markerState.editValue)
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

    suppressInlineBlurCommit()
    pushUndo(currentText)
    const nl = [...lines]
    nl.splice(lineIndex, 1)
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
      const clampedLi = Math.max(0, Math.min(action.targetLine, latestLines.length - 1))
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
    const nl = [...lines]

    if (flowMarkRef.current) {
      const markerChar = flowMarkRef.current.trimStart().charAt(0)
      const markerIndent = flowMarkRef.current.slice(0, flowMarkRef.current.length - 1)
      if (markerChar === '\u2060' && commandName === '判断') {
        const parentPrefix = markerIndent.length >= 4 ? markerIndent.slice(0, -4) : ''
        const formattedLines = trimTrailingEmptyFormattedLine(formatCommandLine(parentPrefix + editVal))
        if (formattedLines.length > 1) {
          nl.splice(editCellState.lineIndex, 1, ...formattedLines)
          const nt = nl.join('\n')
          applyTextChange(nt)
          const cursorLi = editCellState.lineIndex + 1
          beginCodeLineEditByTargetLine(cursorLi, nl)
          focusCodeInputAt(0)
          commitGuardRef.current = true
          return true
        }
      } else {
        const formattedLines = trimTrailingEmptyFormattedLine(formatCommandLine(markerIndent + editVal))
        if (formattedLines.length > 1) {
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
      const formattedLines = formatCommandLine(enterIndent + editVal)
      if (formattedLines.length > 1) {
        const mainLine = formattedLines[0]
        let extraLines = formattedLines.slice(1)
        const afterIdx = editCellState.isVirtual ? editCellState.lineIndex + 2 : editCellState.lineIndex + 1
        const remainingLines = collectRemainingLinesInCurrentScope(lines, afterIdx)
        extraLines = removeDuplicateFlowAutoEndings(extraLines, remainingLines)

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
          flowMarkRef.current = ''
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
        return true
      }
    }

    return false
  }, [applyTextChange, beginCodeLineEdit, beginCodeLineEditByTargetLine, editVal, focusCodeInputAt, formatCommandLine, lines])

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
    } else if (flowMarkRef.current && (flowMarkRef.current.trimStart().startsWith('\u200D') || flowMarkRef.current.trimStart().startsWith('\u2060'))) {
      const markerChar = flowMarkRef.current.trimStart().charAt(0)
      const indent = flowMarkRef.current.slice(0, flowMarkRef.current.length - 1)
      const belongsToRuguoZhen = isIfTrueMarkerEndContext({
        lines,
        lineIndex: editCellState.lineIndex,
        markerChar,
        markerIndent: indent,
      })
      const markerEndAction = getMarkerEndEnterAction({
        belongsToIfTrue: belongsToRuguoZhen,
        beforeText,
        afterText,
      })
      if (markerEndAction === 'insertBodyAbove') {
        const bodyIndent = indent + '    '
        nl.splice(editCellState.lineIndex, 0, bodyIndent)
        const nt = nl.join('\n')
        applyTextChange(nt)
        const newLi = editCellState.lineIndex
        flowMarkRef.current = ''
        flowIndentRef.current = bodyIndent
        wasFlowStartRef.current = false
        beginCodeLineEdit(newLi, '')
      } else {
        const fmtBefore = afterText.trim() === '' ? formatCommandLine(indent + beforeText)[0].slice(indent.length) : beforeText
        nl[editCellState.lineIndex] = flowMarkRef.current + fmtBefore
        nl.splice(editCellState.lineIndex + 1, 0, indent + markerChar + afterText)
        const nt = nl.join('\n')
        applyTextChange(nt)
        const newLi = editCellState.lineIndex + 1
        flowMarkRef.current = indent + markerChar
        beginCodeLineEdit(newLi, afterText)
      }
    } else if (flowMarkRef.current && flowMarkRef.current.trimStart().startsWith('\u200C') && afterText.trim() === '') {
      const markerIndent = flowMarkRef.current.slice(0, flowMarkRef.current.length - 1)
      const fmtLines = formatCommandLine(markerIndent + beforeText)
      const fmtContent = fmtLines[0].slice(markerIndent.length)
      nl[editCellState.lineIndex] = flowMarkRef.current + fmtContent
      nl.splice(editCellState.lineIndex + 1, 0, flowMarkRef.current)
      const nt = nl.join('\n')
      applyTextChange(nt)
      const newLi = editCellState.lineIndex + 1
      beginCodeLineEdit(newLi, '')
    } else {
      const fi = flowIndentRef.current
      const curSegs = flowLines.map.get(editCellState.lineIndex) || []
      const hasFlowEnd = curSegs.some(s => s.type === 'end')
      const newFi = hasFlowEnd && fi.length >= 4 ? fi.slice(0, fi.length - 4) : fi
      const fmtBefore = afterText.trim() === '' ? formatCommandLine(fi + beforeText)[0].slice(fi.length) : beforeText
      if (flowMarkRef.current) {
        nl[editCellState.lineIndex] = flowMarkRef.current + fmtBefore
        nl.splice(editCellState.lineIndex + 1, 0, flowMarkRef.current + afterText)
      } else {
        nl[editCellState.lineIndex] = fi + fmtBefore
        nl.splice(editCellState.lineIndex + 1, 0, newFi + afterText)
      }
      const nt = nl.join('\n')
      applyTextChange(nt)
      const newLi = editCellState.lineIndex + 1
      beginCodeLineEdit(newLi, afterText)
      flowIndentRef.current = flowMarkRef.current ? '' : newFi
      wasFlowStartRef.current = false
    }

    focusCodeInputAt(0)
  }, [applyTextChange, beginCodeLineEdit, flowLines, focusCodeInputAt, formatCommandLine, getMarkerEndEnterAction, isIfTrueMarkerEndContext, lines])

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
      const pasteResult = buildMultiLinePasteResult({
        currentText,
        clipText,
        cursorLine,
        sanitizePastedText: sanitizePastedTextForCurrent,
      })
      if (!pasteResult) return
      pushUndo(currentText)
      const nt = pasteResult.nextText
      applyTextChange(nt)
      const newSel = new Set<number>()
      for (let i = 0; i < pasteResult.pastedLineCount; i++) newSel.add(pasteResult.insertAt + i)
      setSelectedLines(newSel)
      lastFocusedLine.current = pasteResult.insertAt + pasteResult.pastedLineCount - 1
    })

    return true
  }, [applyTextChange, currentText, editCell, pushUndo, shouldUseNativeInputPaste])

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
        currentText,
        applyTextChange,
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
    currentText,
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

      const newSubText = '\n.子程序 ' + newName + ', , , '
      const nl = [...curLines]
      nl.splice(insertAt, 0, newSubText)
      const nt = nl.join('\n')
      applyTextChange(nt)
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

      // 查找同名子程序是否已存在
      let subLineIndex = -1
      for (let i = 0; i < curLines.length; i++) {
        const t = curLines[i].replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ')) {
          const name = splitCSV(t.slice('.子程序 '.length))[0]
          if (name === subName) { subLineIndex = i; break }
        }
      }

      if (subLineIndex >= 0) {
        // 已存在：滚动到该子程序
        lastFocusedLine.current = subLineIndex
        setTimeout(() => {
          const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${subLineIndex}"]`)
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 50)
        return
      }

      // 不存在：在文件末尾插入新子程序
      pushUndo(currentText)
      const insertLines: string[] = ['\n.子程序 ' + subName + ', , , ']
      for (const p of params) {
        insertLines.push('    .参数 ' + p.name + ', ' + (p.dataType || '整数型') + (p.isByRef ? ', 传址' : ''))
      }
      const nl = [...curLines, ...insertLines]
      const nt = nl.join('\n')
      applyTextChange(nt)

      // 新子程序行在 join 后的位置：curLines.length + 1（因 insertLines[0] 以 \n 开头产生空行）
      const newSubLineIndex = curLines.length + 1
      lastFocusedLine.current = newSubLineIndex
      setTimeout(() => {
        const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${newSubLineIndex}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 150)
    },
    navigateToLine: (line: number) => {
      const lineIndex = line - 1
      lastFocusedLine.current = lineIndex
      setTimeout(() => {
        const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${lineIndex}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // 高亮闪烁效果
        if (el) {
          el.classList.add('highlight-flash')
          setTimeout(() => el.classList.remove('highlight-flash'), 1500)
        }
      }, 50)
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
  }), [applyTextChange, currentText, pushUndo, selectedLines, getSelectedSourceText, getMouseRangeSelectedSourceText, isResourceTableDoc, shouldUseNativeInputPaste, lineNumMaps])

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

  /** 渲染某行的流程线段 */
  const renderFlowSegs = (lineIndex: number, isExpanded?: boolean): { node: React.ReactNode; skipTreeLines: number } => {
    return renderFlowSegsLine({
      flowLines,
      lineIndex,
      isExpanded,
      resolveColors: (depth) => resolveFlowLineColors(flowLineModeConfig, depth),
    })
  }

  /** 渲染参数展开区域的流程线延续（只绘制纵向穿越线） */
  const renderFlowContinuation = (lineIndex: number): React.ReactNode => {
    return renderFlowContinuationLine({
      flowLines,
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

  return (
    <div
      className="eyc-table-editor ebackcolor1"
      style={{
        '--editor-font-family': editorFontFamily,
        '--editor-font-size': `${editorFontSize}px`,
        '--editor-line-height': `${editorLineHeight}px`,
        '--eyc-scale': `${eycScale}`,
        zoom: eycScale,
      } as React.CSSProperties}
      onClick={() => onCommandClear?.()}
    >
      <div
        className="eyc-table-wrapper"
        ref={wrapperRef}
        onMouseDown={handleWrapperMouseDown}
        onCopy={handleWrapperCopy}
        onPaste={handleWrapperPaste}
        tabIndex={0}
        style={{ outline: 'none', position: 'relative' }}
      >
        {blocks.map((blk, bi) => {
          if (blk.kind === 'table') {
            const tableLineIndices = blk.rows.filter(r => !r.isHeader).map(r => r.lineIndex)
            return (
              <div
                key={bi}
                className="eyc-block-row"
                onMouseDown={(e) => handleTableBlockMouseDown(e, tableLineIndices)}
              >
                <div className="eyc-line-gutter">
                  {blk.rows.map((row, ri) => (
                    <div
                      key={ri}
                      className={row.isHeader ? 'eyc-gutter-cell' : `eyc-gutter-cell${selectedLines.has(row.lineIndex) ? ' eyc-line-selected' : ''}`}
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
                  ))}
                </div>
                <div className="eyc-block-content">
                  <table className="eyc-decl-table" cellSpacing={0}>
                    <tbody>
                      {blk.rows.map((row, ri) => (
                        <tr
                          key={ri}
                          className={row.isHeader ? 'eyc-hdr-row' : `eyc-data-row${selectedLines.has(row.lineIndex) ? ' eyc-line-selected' : ''}${diffHighlightLines && diffHighlightLines.has(row.lineIndex) ? ' eyc-diff-highlight' : ''}`}
                          {...(!row.isHeader ? { 'data-line-index': row.lineIndex } : {})}
                          onMouseDown={row.isHeader ? undefined : (e) => handleTableRowMouseDown(e, row.lineIndex)}
                        >
                      {row.cells.map((cell, ci) => (
                        (() => {
                          const isInvalidVarNameCell = !row.isHeader && cell.fieldIdx === 0 && invalidVarNameLineSet.has(row.lineIndex)
                          return (
                        <td
                          key={ci}
                          className={`${cell.cls} Rowheight${isInvalidVarNameCell ? ' eyc-cell-invalid' : ''}`}
                          colSpan={cell.colSpan}
                          style={cell.align ? { textAlign: cell.align as 'center' } : undefined}
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
                            <div style={{ position: 'relative', display: 'inline-grid' }}>
                              <span style={{ gridArea: '1/1', visibility: 'hidden', whiteSpace: 'pre', font: 'inherit', padding: 0 }}>
                                {(editVal.length > (cell.text || '\u00A0').length ? editVal : (cell.text || '\u00A0')) + '\u00A0'}
                              </span>
                              <input
                                ref={inputRef}
                                className={`eyc-cell-input${isInvalidVarNameCell ? ' eyc-input-invalid' : ''}`}
                                style={{ gridArea: '1/1' }}
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
                                  liveUpdate(v)
                                  const pos = e.target.selectionStart ?? v.length
                                  updateCompletion(v, pos)
                                }}
                                onBlur={() => {
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
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            )
          }

          // 代码行
          const codeLineRaw = blk.codeLine || ''
          const isLoopEnd = /[\u200B]?(判断循环尾|循环判断尾|计次循环尾|变量循环尾)/.test(codeLineRaw)
          const isAutoFlowLine = !blk.isVirtual && codeLineRaw.includes(FLOW_AUTO_TAG) && !isLoopEnd
          const spans = colorize((blk.codeLine || '').replace(FLOW_AUTO_TAG, ''))
          const lineCmd = blk.isVirtual ? null : findCmdWithParams((blk.codeLine || '').replace(FLOW_AUTO_TAG, ''))
          const assignDetail = blk.isVirtual ? null : parseAssignmentDetail((blk.codeLine || '').replace(FLOW_AUTO_TAG, ''))
          const hasExpandableDetail = !!lineCmd || !!assignDetail
          const isExpanded = expandedLines.has(blk.lineIndex)
          const isLineSelected = selectedLines.has(blk.lineIndex)
          const actualLine = blk.isVirtual ? 0 : (lineNumMaps.codeLineNumMap.get(blk.lineIndex) ?? blk.lineIndex + 1)
          const sourceLine = blk.isVirtual ? 0 : (blk.lineIndex + 1)
          const hasBreakpoint = sourceLine > 0 && breakpointLineSet.has(sourceLine)
          const isDebugLine = !!debugSourceLine && sourceLine === debugSourceLine
          return (
            <div
              key={bi}
              className={`eyc-block-row eyc-block-row-wrap${isAutoFlowLine ? ' eyc-flow-auto-line' : ''}${isLineSelected ? ' eyc-line-selected' : ''}${isDebugLine ? ' eyc-debug-line' : ''}${diffHighlightLines && diffHighlightLines.has(blk.lineIndex) ? ' eyc-diff-highlight' : ''}`}
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
                  <input
                    ref={inputRef}
                    className="eyc-inline-input"
                    size={Math.max(1, editVal.length + 1)}
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
                      const v = e.target.value
                      // 命令行括号保护已移除：允许自由编辑命令名与括号外内容
                      setEditVal(v)
                      liveUpdate(v)
                      const pos = e.target.selectionStart ?? v.length
                      updateCompletion(v, pos)
                    }}
                    onBlur={() => {
                      if (shouldSuppressBlurCommit()) return
                      setTimeout(() => setAcVisible(false), 150)
                      commit()
                    }}
                    onKeyDown={onKey}
                    spellCheck={false}
                  />
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
                          if (isFunc || isObjMethod || isFlowKw || isAssignTarget) {
                            const className = `${isAssignTarget ? 'Variablescolor' : (isUserSubRef ? 'eyc-subrefcolor' : s.cls)}${(isInvalid || isLineSyntaxInvalid) ? ' eyc-cmd-invalid' : ''}`
                            return (
                              <span
                                key={si}
                                className={className}
                              >{renderDebugAwareSpan(s.text, className, `code-${blk.lineIndex}-${si}`)}</span>
                            )
                          }
                          const className = `${s.cls}${isLineSyntaxInvalid ? ' eyc-cmd-invalid' : ''}`
                          return <span key={si} className={className}>{renderDebugAwareSpan(s.text, className, `code-${blk.lineIndex}-${si}`)}</span>
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
                  <div className="eyc-param-expand" style={{ paddingLeft: expandPadding }}>
                    {renderFlowContinuation(blk.lineIndex)}
                    <span className="eyc-param-expand-arrow" style={{ left: arrowLeftStyle }} />
                    <div className="eyc-param-expand-inner" style={{ '--vline-offset': 'calc(-20px + 1.5ch)' } as React.CSSProperties}>
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
                          <div key={pi} className="eyc-param-expand-row" onClick={isEditingParam ? undefined : startParamEdit} style={{ cursor: isEditingParam ? undefined : 'text' }}>
                            <span className="eyc-param-expand-mark">※</span>
                            <span className="eyc-param-expand-name">{p.name}</span>
                            <span className="eyc-param-expand-colon">：</span>
                            {isEditingParam ? (
                              <input
                                ref={paramInputRef}
                                className="eyc-param-val-input"
                                value={editVal}
                                onChange={e => { setEditVal(e.target.value); liveUpdate(e.target.value) }}
                                onBlur={() => {
                                  if (shouldSuppressBlurCommit()) return
                                  commit()
                                }}
                                onKeyDown={e => {
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
                  <div className="eyc-param-expand" style={{ paddingLeft: expandPadding }}>
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
                    <span className="eyc-param-expand-arrow" style={{ left: arrowLeftStyle }} />
                    <div className="eyc-param-expand-inner" style={{ '--vline-offset': 'calc(-20px + 1.5ch)' } as React.CSSProperties}>
                      <div className="eyc-param-expand-row">
                        <span className="eyc-param-expand-mark">※</span>
                        <span className="eyc-param-expand-name">被赋值的变量或变量数组</span>
                        <span className="eyc-param-expand-colon">：</span>
                        <span className="eyc-param-expand-val">{assignDetail.target || '\u00A0'}</span>
                      </div>
                      <div className="eyc-param-expand-row eyc-param-expand-row-assign-value" onClick={isEditingAssignValue ? undefined : (e) => {
                        e.stopPropagation()
                        setEditCell({ lineIndex: blk.lineIndex, cellIndex: -2, fieldIdx: -1, sliceField: false, paramIdx: -100 })
                        setEditVal(assignDetail.value || '')
                        setTimeout(() => paramInputRef.current?.focus(), 0)
                      }} style={{ cursor: isEditingAssignValue ? undefined : 'text' }}>
                        <span className="eyc-param-expand-mark">※</span>
                        <span className="eyc-param-expand-name">用作赋予的值或资源</span>
                        <span className="eyc-param-expand-colon">：</span>
                        {isEditingAssignValue ? (
                          <input
                            ref={paramInputRef}
                            className="eyc-param-val-input"
                            value={editVal}
                            onChange={e => { setEditVal(e.target.value); liveUpdate(e.target.value) }}
                            onBlur={() => {
                              if (shouldSuppressBlurCommit()) return
                              commit()
                            }}
                            onKeyDown={e => {
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
                                className="eyc-param-expand-row eyc-param-expand-row-secondary"
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
                                style={{ cursor: isEditingAssignCmdParam ? undefined : 'text' }}
                              >
                                <span className="eyc-param-expand-mark">※</span>
                                <span className="eyc-param-expand-name">{p.name}</span>
                                <span className="eyc-param-expand-colon">：</span>
                                {isEditingAssignCmdParam ? (
                                  <input
                                    ref={paramInputRef}
                                    className="eyc-param-val-input"
                                    value={editVal}
                                    onChange={e => { setEditVal(e.target.value); liveUpdate(e.target.value) }}
                                    onBlur={() => {
                                      if (shouldSuppressBlurCommit()) return
                                      commit()
                                    }}
                                    onKeyDown={e => {
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
          )
        })}
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
          style={{ left: acPos.left, top: acPos.top }}
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
      {debugHover && (
        <div
          className="eyc-debug-hover-tooltip"
          style={{ left: debugHover.x, top: debugHover.y }}
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
