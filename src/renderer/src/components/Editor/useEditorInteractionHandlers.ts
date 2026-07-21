import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { buildMultiLinePasteResult } from './editorPasteUtils'

// 易语言长文本常量在文本形态里的占位：`.常量 名, "<文本长度: N>"`（真值在私有剪贴板格式 EClipFormat 里）
const EYC_LONG_TEXT_PLACEHOLDER_RE = /\.常量\s+[^,，\n]+[,，]\s*["“]<文本长度:\s*\d+>["”]/

export interface TableCellActionParams {
  rowIsHeader: boolean
  tableType?: string
  lineIndex: number
  cellIndex: number
  fieldIdx?: number
  text: string
  sliceField?: boolean
}

export interface CodeLineClickParams {
  lineIndex: number
  codeLineRaw: string
  isVirtual?: boolean
}

export interface EditCellLike {
  lineIndex: number
  cellIndex: number
  fieldIdx: number
  sliceField: boolean
  paramIdx?: number
  isVirtual?: boolean
}

interface UseEditorInteractionHandlersParams {
  flowAutoTag: string
  wasDragSelectRef: MutableRefObject<boolean>
  userSubNamesRef: MutableRefObject<Set<string>>
  wrapperRef: MutableRefObject<HTMLDivElement | null>
  editCellRef: MutableRefObject<EditCellLike | null>
  preserveEditOnScrollbarRef: MutableRefObject<boolean>
  dragStartPosRef: MutableRefObject<{ x: number; y: number } | null>
  dragAnchorRef: MutableRefObject<number | null>
  isDraggingRef: MutableRefObject<boolean>
  lastFocusedLineRef: MutableRefObject<number>
  setEditCell: Dispatch<SetStateAction<EditCellLike | null>>
  setAcVisible: Dispatch<SetStateAction<boolean>>
  findLineAtY: (clientY: number) => number
  handleLineMouseDown: (e: React.MouseEvent, lineIndex: number, opts?: { textSelectable?: boolean; isVirtual?: boolean }) => void
  setExpandedLines: Dispatch<SetStateAction<Set<number>>>
  setSelectedLines: Dispatch<SetStateAction<Set<number>>>
  getMouseRangeSelectedSourceText: () => string | null
  getSelectedSourceText: () => string
  selectedLines: Set<number>
  currentText: string
  applyTextChange: (nextText: string) => void
  pushUndo: (text: string) => void
  sanitizePastedTextForCurrent: (clipText: string, currentText: string) => string
  extractAssemblyVarLinesFromPasted: (clipText: string, currentText: string) => string[]
  extractRoutedDeclarationLinesFromPasted: (clipText: string, currentText: string) => Array<{ language: 'ell' | 'egv' | 'ecs' | 'edt'; lines: string[] }>
  onRouteDeclarationPaste?: (routes: Array<{ language: 'ell' | 'egv' | 'ecs' | 'edt'; lines: string[] }>) => void
  /** 当前文档自身是路由目标类型（ecs/egv/ell/edt）时传其语言：该类声明留在本地粘贴、不外送 */
  localRouteLanguage?: string
  suppressInlineBlurCommit: (durationMs?: number) => void
  commitActiveEditor: () => void
  focusWrapper: () => void
  findCommandNameFromClickTarget: (target: EventTarget | null, rawCode: string) => string | null
  findOwnerAssemblyName: (lineIndex: number) => string
  onCommandClick?: (commandName: string) => void
  startEditLine: (li: number, clientX?: number, containerLeft?: number, isVirtual?: boolean, skipPushUndo?: boolean) => void
  consumeOptimisticLineEdit?: (lineIndex: number) => boolean
  tryToggleTableBooleanCell: (tableType: string | undefined, lineIndex: number, cellIndex: number) => boolean
  isResourceTableDoc: boolean
  handleTableCellHint: (lineIndex: number, fieldIdx: number, text: string) => void
  startEditCell: (lineIndex: number, cellIndex: number, text: string, fieldIdx?: number, sliceField?: boolean) => void
  openResourcePreview: (lineIndex: number) => Promise<void>
}

export function useEditorInteractionHandlers(params: UseEditorInteractionHandlersParams) {
  const {
    flowAutoTag,
    wasDragSelectRef,
    userSubNamesRef,
    wrapperRef,
    editCellRef,
    preserveEditOnScrollbarRef,
    dragStartPosRef,
    dragAnchorRef,
    isDraggingRef,
    lastFocusedLineRef,
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
    localRouteLanguage,
    onRouteDeclarationPaste,
    suppressInlineBlurCommit,
    commitActiveEditor,
    focusWrapper,
    findCommandNameFromClickTarget,
    findOwnerAssemblyName,
    onCommandClick,
    startEditLine,
    consumeOptimisticLineEdit,
    tryToggleTableBooleanCell,
    isResourceTableDoc,
    handleTableCellHint,
    startEditCell,
    openResourcePreview,
  } = params

  const isFlowPasteDebugEnabled = (): boolean => {
    if (import.meta.env.DEV) return true
    const g = globalThis as {
      __EYC_FLOW_PASTE_DEBUG__?: boolean
      localStorage?: { getItem: (key: string) => string | null }
    }
    if (g.__EYC_FLOW_PASTE_DEBUG__ === true) return true
    try {
      return g.localStorage?.getItem('__EYC_FLOW_PASTE_DEBUG__') === '1'
    } catch {
      return false
    }
  }

  const debugFlowPaste = (stage: string, payload: Record<string, unknown>): void => {
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
  }

  const isWrapperScrollbarHit = useCallback((e: React.MouseEvent): boolean => {
    const wrapper = wrapperRef.current
    if (!wrapper) return false
    const rect = wrapper.getBoundingClientRect()
    const verticalScrollbarWidth = wrapper.offsetWidth - wrapper.clientWidth
    const horizontalScrollbarHeight = wrapper.offsetHeight - wrapper.clientHeight
    const hitVerticalScrollbar = verticalScrollbarWidth > 0 && e.clientX >= rect.right - verticalScrollbarWidth
    const hitHorizontalScrollbar = horizontalScrollbarHeight > 0 && e.clientY >= rect.bottom - horizontalScrollbarHeight
    return hitVerticalScrollbar || hitHorizontalScrollbar
  }, [wrapperRef])

  const handleWrapperMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== wrapperRef.current) return
    if (isWrapperScrollbarHit(e)) {
      if (editCellRef.current) {
        preserveEditOnScrollbarRef.current = true
        suppressInlineBlurCommit(2000)
      }
      return
    }

    e.preventDefault()
    if (editCellRef.current) {
      commitActiveEditor()
    } else {
      setEditCell(null)
      setAcVisible(false)
    }

    const lastLine = currentText.split('\n').length - 1
    if (lastLine >= 0) {
      dragStartPosRef.current = { x: e.clientX, y: e.clientY }
      wasDragSelectRef.current = false
      dragAnchorRef.current = lastLine
      isDraggingRef.current = true
      focusWrapper()

      const handleMouseUp = (): void => {
        window.removeEventListener('mouseup', handleMouseUp)
        if (!wasDragSelectRef.current) {
          setSelectedLines(new Set())
          startEditLine(lastLine)
        }
      }
      window.addEventListener('mouseup', handleMouseUp)
    } else {
      setSelectedLines(new Set())
    }
  }, [
    commitActiveEditor,
    currentText,
    dragAnchorRef,
    dragStartPosRef,
    editCellRef,
    focusWrapper,
    isDraggingRef,
    isWrapperScrollbarHit,
    preserveEditOnScrollbarRef,
    setAcVisible,
    setEditCell,
    setSelectedLines,
    startEditLine,
    suppressInlineBlurCommit,
    wasDragSelectRef,
    wrapperRef,
  ])

  const handleWrapperCopy = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const mouseRangeText = selectedLines.size === 0 ? getMouseRangeSelectedSourceText() : null
    if (selectedLines.size === 0 && !mouseRangeText) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', selectedLines.size > 0 ? getSelectedSourceText() : (mouseRangeText || ''))
  }, [getMouseRangeSelectedSourceText, getSelectedSourceText, selectedLines])

  /** 文档级整行粘贴的落地（从 handleWrapperPaste 抽出，便于易语言长文本还原后复用） */
  const applyDocumentPaste = useCallback((clipText: string, cursorLine: number, state: EditCellLike | null) => {
    const pasteResult = buildMultiLinePasteResult({
      currentText,
      clipText,
      cursorLine,
      sanitizePastedText: sanitizePastedTextForCurrent,
      extractAssemblyVarLines: extractAssemblyVarLinesFromPasted,
      extractRoutedDeclarationLines: extractRoutedDeclarationLinesFromPasted,
      localRouteLanguage,
    })
    if (!pasteResult) return
    if (pasteResult.routedDeclarations.length > 0) {
      onRouteDeclarationPaste?.(pasteResult.routedDeclarations)
    }
    debugFlowPaste('paste-wrapper:result', {
      insertAt: pasteResult.insertAt,
      pastedLineCount: pasteResult.pastedLineCount,
      resultPreview: pasteResult.nextText.split('\n').slice(Math.max(0, pasteResult.insertAt - 2), pasteResult.insertAt + pasteResult.pastedLineCount + 3),
    })
    pushUndo(currentText)
    applyTextChange(pasteResult.nextText)
    const newSel = new Set<number>()
    for (let i = 0; i < pasteResult.pastedLineCount; i++) newSel.add(pasteResult.insertAt + i)
    setSelectedLines(newSel)
    lastFocusedLineRef.current = pasteResult.insertAt + pasteResult.pastedLineCount - 1
    if (state) {
      // 多行粘贴后原输入框中的 editVal/lineIndex 已不再对应文档内容（行号可能位移），
      // 立即退出编辑态并压掉 blur 回写，避免旧值写回错行。
      suppressInlineBlurCommit(2000)
      setAcVisible(false)
      setEditCell(null)
    }
  }, [
    applyTextChange,
    currentText,
    editCellRef,
    extractAssemblyVarLinesFromPasted,
    extractRoutedDeclarationLinesFromPasted,
    localRouteLanguage,
    lastFocusedLineRef,
    onRouteDeclarationPaste,
    pushUndo,
    sanitizePastedTextForCurrent,
    setSelectedLines,
    setAcVisible,
    setEditCell,
    suppressInlineBlurCommit,
  ])

  const handleWrapperPaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const clipText = e.clipboardData.getData('text/plain')
    if (!clipText) return
    const target = e.target as HTMLElement
    const state = editCellRef.current
    const isMultiLinePaste = /[\r\n]/.test(clipText)
    if (target.closest('input')) {
      // 单行剪贴板：原生粘贴进当前输入框；多行剪贴板：任何编辑态（代码行/表格单元格/参数）
      // 都改走文档级整行粘贴——这些输入框的值都只住在单一源码行里，装不下多行内容
      // （旧行为：单元格无条件原生粘贴，整段代码被压成一行挤进单元格）。
      if (!state || !isMultiLinePaste) return
    }
    e.preventDefault()
    const cursorLine = editCellRef.current?.lineIndex ?? lastFocusedLineRef.current
    debugFlowPaste('paste-wrapper:input', {
      cursorLine,
      clipPreview: String(clipText || '').replace(/\r\n?/g, '\n').split('\n').slice(0, 8),
      clipLength: (clipText || '').length,
    })

    // 从易语言复制的长文本常量，文本形态只有占位 `.常量 名, "<文本长度: N>"`（真值在私有剪贴板
    // 格式 EClipFormat 里）。检测到占位才走主进程异步还原——常规粘贴路径完全不受影响。
    if (EYC_LONG_TEXT_PLACEHOLDER_RE.test(clipText)) {
      void (async () => {
        let effective = clipText
        try {
          const restored = await window.api?.clipboard?.restoreEycLongTexts?.(clipText)
          if (restored?.text) effective = restored.text
        } catch { /* 还原失败按原文粘贴 */ }
        applyDocumentPaste(effective, cursorLine, state)
      })()
      return
    }
    applyDocumentPaste(clipText, cursorLine, state)
  }, [
    applyDocumentPaste,
    editCellRef,
    lastFocusedLineRef,
  ])


  const handleTableBlockMouseDown = useCallback((
    e: React.MouseEvent<HTMLDivElement>,
    tableLineIndices: number[],
  ) => {
    const target = e.target as HTMLElement
    if (target.closest('tr.eyc-data-row') || target.closest('input')) return
    const byY = findLineAtY(e.clientY)
    if (byY >= 0) {
      handleLineMouseDown(e, byY)
      return
    }
    if (tableLineIndices.length > 0) {
      handleLineMouseDown(e, tableLineIndices[0])
    }
  }, [findLineAtY, handleLineMouseDown])

  const handleCodeBlockMouseDown = useCallback((
    e: React.MouseEvent<HTMLDivElement>,
    lineIndex: number,
    isVirtual?: boolean,
  ) => {
    // 按在代码内容区（非 gutter）时，同一行内的拖动按"行内文本选择"处理
    const textSelectable = !!(e.target as HTMLElement).closest?.('.eyc-code-line')
    handleLineMouseDown(e, lineIndex, { textSelectable, isVirtual })
  }, [handleLineMouseDown])

  const handleCodeLineFoldMouseDown = useCallback((e: React.MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation()
    e.preventDefault()
  }, [])

  const handleCodeLineFoldClick = useCallback((
    e: React.MouseEvent<HTMLSpanElement>,
    lineIndex: number,
  ) => {
    e.stopPropagation()
    setExpandedLines(prev => {
      const next = new Set(prev)
      if (next.has(lineIndex)) next.delete(lineIndex)
      else next.add(lineIndex)
      return next
    })
  }, [setExpandedLines])

  const handleCodeLineClick = useCallback((
    e: React.MouseEvent<HTMLDivElement>,
    clickParams: CodeLineClickParams,
  ) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    if (wasDragSelectRef.current) {
      wasDragSelectRef.current = false
      return
    }
    // 已为空时保持原引用，避免空 Set 新身份触发一轮无意义渲染
    setSelectedLines(prev => (prev.size === 0 ? prev : new Set()))

    const rawCode = clickParams.codeLineRaw.replace(flowAutoTag, '')
    const cmdName = findCommandNameFromClickTarget(e.target, rawCode)
    if (cmdName) {
      e.stopPropagation()
      const ownerAssembly = findOwnerAssemblyName(clickParams.lineIndex)
      const hintName = userSubNamesRef.current.has(cmdName) ? `__SUB__:${cmdName}:${ownerAssembly}` : cmdName
      onCommandClick?.(hintName)
    }

    // mousedown 已乐观进入该行编辑态时，click 不再重复进入（重复进入会多一整轮渲染）
    if (consumeOptimisticLineEdit?.(clickParams.lineIndex)) return

    startEditLine(
      clickParams.lineIndex,
      e.clientX,
      e.currentTarget.getBoundingClientRect().left,
      clickParams.isVirtual,
    )
  }, [
    consumeOptimisticLineEdit,
    findCommandNameFromClickTarget,
    findOwnerAssemblyName,
    flowAutoTag,
    onCommandClick,
    setSelectedLines,
    startEditLine,
    userSubNamesRef,
    wasDragSelectRef,
  ])

  const handleTableRowMouseDown = useCallback((
    e: React.MouseEvent<HTMLTableRowElement>,
    lineIndex: number,
  ) => {
    e.stopPropagation()
    handleLineMouseDown(e, lineIndex)
  }, [handleLineMouseDown])

  const handleTableCellMouseDown = useCallback((e: React.MouseEvent<HTMLTableCellElement>) => {
    e.stopPropagation()
  }, [])

  const handleTableCellClick = useCallback((
    e: React.MouseEvent<HTMLTableCellElement>,
    actionParams: TableCellActionParams,
  ) => {
    e.stopPropagation()
    if (actionParams.rowIsHeader) return
    if (tryToggleTableBooleanCell(actionParams.tableType, actionParams.lineIndex, actionParams.cellIndex)) return
    if (isResourceTableDoc && actionParams.tableType === 'constant' && actionParams.fieldIdx === 1) return
    handleTableCellHint(actionParams.lineIndex, actionParams.fieldIdx ?? -1, actionParams.text)
    startEditCell(actionParams.lineIndex, actionParams.cellIndex, actionParams.text, actionParams.fieldIdx, actionParams.sliceField)
  }, [handleTableCellHint, isResourceTableDoc, startEditCell, tryToggleTableBooleanCell])

  const handleTableCellDoubleClick = useCallback((
    e: React.MouseEvent<HTMLTableCellElement>,
    actionParams: TableCellActionParams,
  ) => {
    e.stopPropagation()
    if (actionParams.rowIsHeader) return
    if (isResourceTableDoc && actionParams.tableType === 'constant' && actionParams.fieldIdx === 1) {
      void openResourcePreview(actionParams.lineIndex)
      return
    }
    startEditCell(actionParams.lineIndex, actionParams.cellIndex, actionParams.text, actionParams.fieldIdx, actionParams.sliceField)
  }, [isResourceTableDoc, openResourcePreview, startEditCell])

  return {
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
  }
}
