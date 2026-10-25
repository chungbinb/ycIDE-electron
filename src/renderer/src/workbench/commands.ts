// 渲染进程的插件内核入口：持有命令注册表与当前生效的贡献点模型、分发全局快捷键、
// 与主进程的插件服务对接（设计稿 §2、§5）。
//
// - 内置命令的处理函数写在 App.tsx，经 useCommandHandlers 注册到本地命令注册表；
// - 插件命令在插件宿主进程里执行：本地没有处理函数时经 IPC 转给主进程；
// - 插件也可以执行内置命令：主进程发来 plugins:executeRendererCommand，这里执行后回报结果；
// - 菜单（TitleBar）与快捷键使用主进程下发的已启用插件清单，插件增删、启停后自动刷新。

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { BUILTIN_PLUGIN_CANDIDATES } from '../../../shared/plugin/builtinPlugins'
import { CommandRegistry, type CommandHandler } from '../../../shared/plugin/commandRegistry'
import { buildContributionModel, matchKeybinding, type ContributionModel } from '../../../shared/plugin/contributions'
import type { PluginHostPlatform, PluginManifest } from '../../../shared/plugin/manifest'
import { resolvePlugins } from '../../../shared/plugin/pluginResolver'
import type { RuntimePlatform } from '../../../shared/platform'

export const commandRegistry = new CommandRegistry()

export function toPluginHostPlatform(platform: RuntimePlatform): PluginHostPlatform {
  return platform === 'windows' || platform === 'macos' ? platform : 'linux'
}

const hostPlatform = toPluginHostPlatform(window.api?.system?.getRuntimePlatform?.() ?? 'windows')

// ───────────── 贡献点模型（随主进程插件状态更新） ─────────────

/** 主进程状态到达前先用内置插件，保证首屏菜单与快捷键可用 */
function builtinManifests(): PluginManifest[] {
  return resolvePlugins(BUILTIN_PLUGIN_CANDIDATES, { platform: hostPlatform, host: 'electron' }).enabled
}

let currentManifests: PluginManifest[] = builtinManifests()
let currentModel: ContributionModel = buildContributionModel(currentManifests)
const modelListeners = new Set<() => void>()

function setManifests(manifests: PluginManifest[]): void {
  currentManifests = manifests
  currentModel = buildContributionModel(manifests)
  for (const w of currentModel.warnings) console.warn(`[plugins] ${w}`)
  modelListeners.forEach(l => l())
}

export function getPluginModel(): ContributionModel {
  return currentModel
}

function subscribeModel(listener: () => void): () => void {
  modelListeners.add(listener)
  return () => { modelListeners.delete(listener) }
}

/** React 组件订阅贡献点模型：插件启停后菜单自动重绘 */
export function usePluginModel(): ContributionModel {
  return useSyncExternalStore(subscribeModel, getPluginModel)
}

export function getEnabledManifests(): PluginManifest[] {
  return currentManifests
}

/** React 组件订阅已启用插件清单（读取 aiProviders、aiTools 等贡献点） */
export function useEnabledManifests(): PluginManifest[] {
  return useSyncExternalStore(subscribeModel, getEnabledManifests)
}

/** 命令所属插件是否有在插件进程里运行的代码 */
function isPluginProcessCommand(command: string): boolean {
  const owner = currentModel.commands.get(command)?.pluginId
  return !!owner && currentManifests.find(m => m.id === owner)?.runtime?.type === 'node'
}

async function refreshPluginState(): Promise<void> {
  try {
    const state = await window.api.plugins.getState()
    setManifests(state.manifests)
  } catch (err) {
    console.error('[plugins] 获取插件状态失败', err)
  }
}

function connectPluginService(): void {
  const plugins = window.api?.plugins
  if (!plugins) return

  commandRegistry.setFallback((id, args) =>
    isPluginProcessCommand(id) ? plugins.executeCommand(id, args) : undefined,
  )

  window.api.on('plugins:changed', () => { void refreshPluginState() })
  window.api.on('plugins:executeRendererCommand', (payload: unknown) => {
    const { requestId, command, args } = (payload ?? {}) as { requestId: number; command: string; args?: unknown[] }
    commandRegistry.executeLocal(command, ...(Array.isArray(args) ? args : []))
      .then(result => plugins.sendRendererCommandResult({ requestId, ok: true, result: toCloneable(result) }))
      .catch((err: unknown) => {
        // 带数字错误码的错误（如文档版本过期 -33002）原样传回插件
        const code = typeof (err as { code?: unknown } | null)?.code === 'number' ? (err as { code: number }).code : undefined
        plugins.sendRendererCommandResult({ requestId, ok: false, error: err instanceof Error ? err.message : String(err), code })
      })
  })
  void refreshPluginState()
}

/** 命令返回值要经 IPC 结构化克隆，函数、DOM 对象等不可克隆的值丢弃 */
function toCloneable(value: unknown): unknown {
  try {
    structuredClone(value)
    return value
  } catch {
    return undefined
  }
}

connectPluginService()

// ───────────── 命令执行与注册 ─────────────

/** 只执行渲染进程本地注册的命令（不转给插件进程） */
export function executeLocalCommand(id: string, args: unknown[] = []): Promise<unknown> {
  return commandRegistry.executeLocal(id, ...args)
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

// ───────────── 插件消息 ─────────────

export interface PluginMessage {
  pluginId: string
  type: 'info' | 'warning' | 'error' | 'success'
  message: string
}

/** 订阅插件发出的消息（window.showMessage），返回取消订阅函数 */
export function onPluginMessage(listener: (message: PluginMessage) => void): () => void {
  if (!window.api?.on) return () => undefined
  return window.api.on('plugins:message', (payload: unknown) => {
    const msg = payload as PluginMessage | undefined
    if (msg && typeof msg.message === 'string') listener(msg)
  })
}

// ───────────── 快捷键 ─────────────

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
  const match = matchKeybinding(currentModel, event, hostPlatform, context)
  if (!match) return false
  event.preventDefault()
  void executeCommand(match.command, ...(match.args ?? [])).catch(err => console.error(`[commands] 执行 ${match.command} 失败`, err))
  return true
}
