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
