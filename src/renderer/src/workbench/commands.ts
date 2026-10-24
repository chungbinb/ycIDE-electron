// 渲染进程的插件内核入口：加载内置插件、持有命令注册表、分发全局快捷键。
// 阶段 0 里命令处理函数仍写在 App.tsx，通过 useCommandHandlers 注册；
// 菜单（TitleBar、macOS 原生菜单）和快捷键都从插件清单的贡献点生成。

import { useEffect, useLayoutEffect, useRef } from 'react'
import { loadPlugins, type LoadedPlugins } from '../../../shared/plugin/builtinPlugins'
import { CommandRegistry, type CommandHandler } from '../../../shared/plugin/commandRegistry'
import { matchKeybinding } from '../../../shared/plugin/contributions'
import type { PluginHostPlatform } from '../../../shared/plugin/manifest'
import type { RuntimePlatform } from '../../../shared/platform'

export const commandRegistry = new CommandRegistry()

export function toPluginHostPlatform(platform: RuntimePlatform): PluginHostPlatform {
  return platform === 'windows' || platform === 'macos' ? platform : 'linux'
}

const hostPlatform = toPluginHostPlatform(window.api?.system?.getRuntimePlatform?.() ?? 'windows')

let loaded: LoadedPlugins | null = null

export function getLoadedPlugins(): LoadedPlugins {
  if (!loaded) loaded = loadPlugins({ platform: hostPlatform, host: 'electron' })
  return loaded
}

export function executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
  return commandRegistry.execute(id, ...args)
}

/**
 * 兼容改造前的 action 字符串：`theme:<主题名>`、`file:openRecent:<编码后的 JSON>`，其余原样作为命令 ID。
 * 项目树右键菜单、工具栏等处仍按 action 字符串调用，后续阶段逐步改为直接执行命令。
 */
export function executeLegacyAction(action: string): Promise<unknown> {
  if (action.startsWith('file:openRecent:')) {
    try {
      return executeCommand('file:openRecent', JSON.parse(decodeURIComponent(action.slice('file:openRecent:'.length))))
    } catch {
      return Promise.resolve(undefined) // 忽略无效最近打开项
    }
  }
  if (action.startsWith('theme:') && action !== 'theme:apply') {
    return executeCommand('theme:apply', action.slice('theme:'.length))
  }
  return executeCommand(action)
}

/**
 * 注册一组命令处理函数。处理函数可以每次渲染都是新的闭包：注册只在命令 ID 集合变化时进行，
 * 执行时总是调用最近一次渲染的版本，避免闭包里拿到过期的 state。
 */
export function useCommandHandlers(handlers: Record<string, CommandHandler>): void {
  const handlersRef = useRef(handlers)
  useLayoutEffect(() => {
    handlersRef.current = handlers
  })
  const idsKey = Object.keys(handlers).sort().join('\n')
  useEffect(() => {
    const disposables = idsKey.split('\n').filter(Boolean).map(id =>
      commandRegistry.register(id, (...args: unknown[]) => handlersRef.current[id]?.(...args)),
    )
    return () => disposables.forEach(d => d.dispose())
  }, [idsKey])
}

function isEditableElement(el: HTMLElement | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT'
    || tag === 'TEXTAREA'
    || tag === 'SELECT'
    || el.isContentEditable
    || !!el.closest('[contenteditable="true"]')
    || !!el.closest('.monaco-editor')
}

/**
 * 按插件贡献的快捷键分发键盘事件；命中时阻止默认行为并执行命令，返回 true。
 * 上下文键：
 *   editableFocus        焦点在可编辑控件里（输入框、Monaco 等），编辑类快捷键交给控件自己处理
 *   nativeTextSelection  页面上有浏览器原生的文本选区，复制 / 剪切交给浏览器处理
 */
export function dispatchKeybinding(event: KeyboardEvent): boolean {
  const context = {
    get editableFocus() { return isEditableElement(document.activeElement as HTMLElement | null) },
    get nativeTextSelection() { return !!window.getSelection()?.toString() },
  }
  const match = matchKeybinding(getLoadedPlugins().model, event, hostPlatform, context)
  if (!match) return false
  event.preventDefault()
  void executeCommand(match.command, ...(match.args ?? []))
  return true
}
