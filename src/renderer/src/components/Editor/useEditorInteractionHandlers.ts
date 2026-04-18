import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { buildMultiLinePasteResult } from './editorPasteUtils'

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
  handleLineMouseDown: (e: React.MouseEvent, lineIndex: number) => void
  setExpandedLines: Dispatch<SetStateAction<Set<number>>>
  setSelectedLines: Dispatch<SetStateAction<Set<number>>>
  getMouseRangeSelectedSourceText: () => string | null
  getSelectedSourceText: () => string
  selectedLines: Set<number>
  currentText: string
  applyTextChange: (nextText: string) => void
  pushUndo: (text: string) => void
  sanitizePastedTextForCurrent: (clipText: string, currentText: string) => string
  shouldUseNativeInputPaste: (editCell: EditCellLike | null) => boolean
  suppressInlineBlurCommit: (durationMs?: number) => void
  commitActiveEditor: () => void
  focusWrapper: () => void
  findCommandNameFromClickTarget: (target: EventTarget | null, rawCode: string) => string | null
  findOwnerAssemblyName: (lineIndex: number) => string
  onCommandClick?: (commandName: string) => void
  startEditLine: (li: number, clientX?: number, containerLeft?: number, isVirtual?: boolean, skipPushUndo?: boolean) => void
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
    shouldUseNativeInputPaste,
    suppressInlineBlurCommit,
    commitActiveEditor,
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
  } = params

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

  const handleWrapperPaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const clipText = e.clipboardData.getData('text/plain')
    if (!clipText) return
    const target = e.target as HTMLElement
    const state = editCellRef.current
    const isCodeLineInput = !!state && state.cellIndex === -1 && state.paramIdx === undefined
    const isMultiLinePaste = /[\r\n]/.test(clipText)
    if (target.closest('input')) {
      if (shouldUseNativeInputPaste(state)) return
      if (!isCodeLineInput || !isMultiLinePaste) return
    }
    e.preventDefault()
    const cursorLine = editCellRef.current?.lineIndex ?? lastFocusedLineRef.current
    const pasteResult = buildMultiLinePasteResult({
      currentText,
      clipText,
      cursorLine,
      sanitizePastedText: sanitizePastedTextForCurrent,
    })
    if (!pasteResult) return
    pushUndo(currentText)
    applyTextChange(pasteResult.nextText)
    const newSel = new Set<number>()
    for (let i = 0; i < pasteResult.pastedLineCount; i++) newSel.add(pasteResult.insertAt + i)
    setSelectedLines(newSel)
    lastFocusedLineRef.current = pasteResult.insertAt + pasteResult.pastedLineCount - 1
  }, [
    applyTextChange,
    currentText,
    editCellRef,
    lastFocusedLineRef,
    pushUndo,
    sanitizePastedTextForCurrent,
    setSelectedLines,
    shouldUseNativeInputPaste,
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
  ) => {
    handleLineMouseDown(e, lineIndex)
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
    setSelectedLines(new Set())

    const rawCode = clickParams.codeLineRaw.replace(flowAutoTag, '')
    const cmdName = findCommandNameFromClickTarget(e.target, rawCode)
    if (cmdName) {
      e.stopPropagation()
      const ownerAssembly = findOwnerAssemblyName(clickParams.lineIndex)
      const hintName = userSubNamesRef.current.has(cmdName) ? `__SUB__:${cmdName}:${ownerAssembly}` : cmdName
      onCommandClick?.(hintName)
    }

    startEditLine(
      clickParams.lineIndex,
      e.clientX,
      e.currentTarget.getBoundingClientRect().left,
      clickParams.isVirtual,
    )
  }, [
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
