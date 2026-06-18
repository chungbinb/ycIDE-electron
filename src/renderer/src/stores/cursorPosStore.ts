import { useSyncExternalStore } from 'react'

// 光标位置独立订阅源。
// 此前光标行/列存在 App 顶层 useState，编辑器每次点击/按键都会上报光标变化 →
// setCursorLine/Column 触发**整个 IDE 重渲染**，在复杂界面下单次重渲染高达 1~2 秒，
// 表现为"点一行要等 1~2 秒光标才下去""输入很卡"。
// 改为独立 store 后，光标变化只通知订阅它的状态栏 Ln/Col 小组件，App 不再重渲染。

export interface CursorPos {
  line?: number
  column?: number
}

let state: CursorPos = {}
const listeners = new Set<() => void>()

export function setCursorPos(line?: number, column?: number): void {
  if (state.line === line && state.column === column) return
  // 返回新对象，确保 useSyncExternalStore 的快照按引用判定为已变化。
  state = { line, column }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): CursorPos {
  return state
}

export function useCursorPos(): CursorPos {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
