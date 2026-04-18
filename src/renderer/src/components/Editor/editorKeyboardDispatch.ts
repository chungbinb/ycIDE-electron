export interface KeyActionResult {
  handled: boolean
  preventDefault: boolean
}

export interface CtrlShortcutDispatchParams {
  key: string
  shiftKey: boolean
  onUndo: () => void
  onRedo: () => void
  onSelectAll: () => void
  onPaste: () => boolean
}

// 纯按键语义分派，不关心编辑器内部状态来源。
export function dispatchCtrlShortcut(params: CtrlShortcutDispatchParams): KeyActionResult {
  const { key, shiftKey, onUndo, onRedo, onSelectAll, onPaste } = params

  if (key === 'z' && !shiftKey) {
    onUndo()
    return { handled: true, preventDefault: true }
  }

  if (key === 'y' || (shiftKey && key === 'z')) {
    onRedo()
    return { handled: true, preventDefault: true }
  }

  if (key === 'a') {
    onSelectAll()
    return { handled: true, preventDefault: true }
  }

  if (key === 'v') {
    const intercepted = onPaste()
    return { handled: true, preventDefault: intercepted }
  }

  return { handled: false, preventDefault: false }
}

export interface CtrlShortcutHistoryDispatchParams {
  key: string
  shiftKey: boolean
  undoStack: string[]
  redoStack: string[]
  currentText: string
  applyTextChange: (value: string) => void
  onSelectAll: () => void
  onPaste: () => boolean
}

// 包装撤销/重做栈，让 Ctrl 分派可直接落到文本状态更新。
export function dispatchCtrlShortcutWithHistory(params: CtrlShortcutHistoryDispatchParams): KeyActionResult {
  const {
    key,
    shiftKey,
    undoStack,
    redoStack,
    currentText,
    applyTextChange,
    onSelectAll,
    onPaste,
  } = params

  return dispatchCtrlShortcut({
    key,
    shiftKey,
    onUndo: () => {
      if (undoStack.length === 0) return
      const prev = undoStack.pop()!
      redoStack.push(currentText)
      applyTextChange(prev)
    },
    onRedo: () => {
      if (redoStack.length === 0) return
      const next = redoStack.pop()!
      undoStack.push(currentText)
      applyTextChange(next)
    },
    onSelectAll,
    onPaste,
  })
}

export interface PreKeyGuardsDispatchParams {
  key: string
  cursorPos: number
  ctrl: boolean
  shiftKey: boolean
  onTypeCellSpaceGuard: () => boolean
  onCompletionPopupKey: (key: string) => boolean
  onCtrlShortcut: (params: { key: string; shiftKey: boolean }) => KeyActionResult
  onParenScopedKey: (params: { key: string; cursorPos: number }) => KeyActionResult
}

// 主编辑逻辑前的守卫层：补全、Ctrl 组合键、括号上下文优先处理。
export function dispatchPreKeyGuards(params: PreKeyGuardsDispatchParams): KeyActionResult {
  const {
    key,
    cursorPos,
    ctrl,
    shiftKey,
    onTypeCellSpaceGuard,
    onCompletionPopupKey,
    onCtrlShortcut,
    onParenScopedKey,
  } = params

  if (key === ' ' && onTypeCellSpaceGuard()) {
    return { handled: true, preventDefault: true }
  }

  if (onCompletionPopupKey(key)) {
    return { handled: true, preventDefault: true }
  }

  if (ctrl) {
    const ctrlAction = onCtrlShortcut({ key: key.toLowerCase(), shiftKey })
    if (ctrlAction.handled) return ctrlAction
  }

  const parenAction = onParenScopedKey({ key, cursorPos })
  if (parenAction.handled) return parenAction

  return { handled: false, preventDefault: false }
}

export interface MainEditingKeyDispatchParams {
  key: string
  cursorPos: number
  onEnter: (cursorPos: number) => void
  onDeleteKey: (key: 'Backspace' | 'Delete') => KeyActionResult
  onEscape: () => KeyActionResult
  onArrow: (params: {
    key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
    cursorPos: number
  }) => KeyActionResult
}

// 主编辑键分派：Enter/Delete/Escape/方向键。
export function dispatchMainEditingKey(params: MainEditingKeyDispatchParams): KeyActionResult {
  const { key, cursorPos, onEnter, onDeleteKey, onEscape, onArrow } = params

  if (key === 'Enter') {
    onEnter(cursorPos)
    return { handled: true, preventDefault: true }
  }

  if (key === 'Backspace' || key === 'Delete') {
    return onDeleteKey(key)
  }

  if (key === 'Escape') {
    return onEscape()
  }

  if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
    return onArrow({ key, cursorPos })
  }

  return { handled: false, preventDefault: false }
}

export function handleTypeCellSpaceGuard<T extends { isMore?: boolean }>(params: {
  isTypeCellEdit: boolean
  acVisible: boolean
  acItems: T[]
  acIndex: number
  onExpandMore: (index: number) => void
  onApplyCompletion: (item: T) => void
}): boolean {
  // 数据类型单元格禁空格，空格用于补全确认而非文本输入。
  const {
    isTypeCellEdit,
    acVisible,
    acItems,
    acIndex,
    onExpandMore,
    onApplyCompletion,
  } = params

  if (!isTypeCellEdit) return false
  if (acVisible && acItems.length > 0) {
    const target = acItems[acIndex]
    if (target?.isMore) onExpandMore(acIndex)
    else if (target) onApplyCompletion(target)
  }
  return true
}

export function handleCompletionPopupKey<T extends { isMore?: boolean }>(params: {
  key: string
  acVisible: boolean
  acItems: T[]
  acIndex: number
  onSetAcIndex: (updater: (index: number) => number) => void
  onExpandMore: (index: number) => void
  onApplyCompletion: (item: T) => void
  onHidePopup: () => void
}): boolean {
  // 补全弹窗内的导航与确认键处理。
  const {
    key,
    acVisible,
    acItems,
    acIndex,
    onSetAcIndex,
    onExpandMore,
    onApplyCompletion,
    onHidePopup,
  } = params

  if (!(acVisible && acItems.length > 0)) return false

  if (key === 'ArrowDown') {
    onSetAcIndex(i => (i + 1) % acItems.length)
    return true
  }
  if (key === 'ArrowUp') {
    onSetAcIndex(i => (i - 1 + acItems.length) % acItems.length)
    return true
  }
  if (key === ' ' || key === 'Tab') {
    const target = acItems[acIndex]
    if (target?.isMore) onExpandMore(acIndex)
    else if (target) onApplyCompletion(target)
    return true
  }
  if (key === 'Escape') {
    onHidePopup()
    return true
  }

  return false
}
