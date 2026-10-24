// 插件宿主进程里的运行时：加载 runtime.type 为 node 的插件代码，调用 activate / deactivate，
// 把插件注册的命令、发出的消息经 JSON-RPC 转给宿主（设计稿 §2.2、§4、§5）。
// 与进程模型无关，传入任意 RpcTransport 即可运行（测试中使用内存管道）。

import { createRequire } from 'node:module'
import { RpcError, RpcErrorCode, RpcPeer, type RpcTransport } from '../../shared/plugin/rpc'
import {
  PLUGIN_PROTOCOL_VERSION,
  type ActivatePluginParams,
  type ExecuteCommandParams,
  type PluginMessageType,
} from './pluginProtocol'

export interface Disposable {
  dispose(): void
}

/** 插件 activate(context, ycide) 拿到的 API（阶段 0 子集，设计稿 §5） */
export interface YcideApi {
  commands: {
    /** 注册命令处理函数；命令必须在本插件清单的 contributes.commands 里声明过 */
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): Disposable
    /** 执行任意命令：本进程注册的直接调用，其余（内置命令、其他进程的命令）交给宿主 */
    executeCommand(id: string, ...args: unknown[]): Promise<unknown>
  }
  window: {
    /** 在 IDE 输出面板显示一条消息 */
    showMessage(message: string, type?: PluginMessageType): void
  }
  documents: {
    /** 读取文档当前内容：已在编辑器打开的取编辑器里（含未保存修改）的内容，否则读磁盘 */
    getText(path: string): Promise<string>
    /**
     * 把文档改为 text：编辑器里显示差异，用户可撤销；不会自动保存。
     * 传入 baseText 时，若文档已不是 baseText（被别人改过）则拒绝修改。
     */
    applyEdit(path: string, text: string, baseText?: string): Promise<void>
  }
}

export interface PluginContext {
  pluginId: string
  /** 插件所在目录 */
  extensionPath: string
  /** 插件停用时统一 dispose */
  subscriptions: Disposable[]
}

interface PluginModule {
  activate?: (context: PluginContext, ycide: YcideApi) => unknown
  deactivate?: () => unknown
}

interface ActivePlugin {
  module: PluginModule
  context: PluginContext
  commands: Set<string>
}

export class PluginHostRuntime {
  private readonly rpc: RpcPeer
  private readonly active = new Map<string, ActivePlugin>()
  /** 命令 ID → { 所属插件, 处理函数 } */
  private readonly commands = new Map<string, { pluginId: string; handler: (...args: unknown[]) => unknown }>()

  constructor(transport: RpcTransport) {
    this.rpc = new RpcPeer(transport, { requestTimeoutMs: 0 })
    this.rpc.onRequest('initialize', () => ({ protocolVersion: PLUGIN_PROTOCOL_VERSION }))
    this.rpc.onRequest('plugin/activate', params => this.activate(params as ActivatePluginParams))
    this.rpc.onRequest('plugin/deactivate', params => this.deactivate((params as { id: string }).id))
    this.rpc.onRequest('commands/execute', params => this.executeLocal(params as ExecuteCommandParams))
    this.rpc.onRequest('shutdown', async () => {
      for (const id of [...this.active.keys()].reverse()) await this.deactivate(id)
      return null
    })
  }

  dispose(): void {
    this.rpc.dispose()
  }

  private createApi(pluginId: string, declaredCommands: ReadonlySet<string>): YcideApi {
    return {
      commands: {
        registerCommand: (id, handler) => {
          if (!declaredCommands.has(id)) {
            throw new Error(`命令 ${id} 没有在插件 ${pluginId} 的清单 contributes.commands 中声明`)
          }
          if (this.commands.has(id)) throw new Error(`命令 ${id} 已经注册过处理函数`)
          this.commands.set(id, { pluginId, handler })
          this.active.get(pluginId)?.commands.add(id)
          this.rpc.notify('commands/registered', { pluginId, command: id })
          return {
            dispose: () => {
              if (this.commands.get(id)?.handler !== handler) return
              this.commands.delete(id)
              this.active.get(pluginId)?.commands.delete(id)
              this.rpc.notify('commands/unregistered', { pluginId, command: id })
            },
          }
        },
        executeCommand: async (id, ...args) => {
          const local = this.commands.get(id)
          if (local) return local.handler(...args)
          return this.rpc.request('commands/executeHost', { command: id, args }, 0)
        },
      },
      window: {
        showMessage: (message, type = 'info') => {
          this.rpc.notify('window/showMessage', { pluginId, type, message: String(message) })
        },
      },
      documents: {
        getText: async path => String(await this.rpc.request('commands/executeHost', { command: 'documents:getText', args: [path] }, 0)),
        applyEdit: async (path, text, baseText) => {
          await this.rpc.request('commands/executeHost', { command: 'documents:applyEdit', args: [{ path, text, baseText }] }, 0)
        },
      },
    }
  }

  private async activate(params: ActivatePluginParams): Promise<{ commands: string[] }> {
    const existing = this.active.get(params.id)
    if (existing) return { commands: [...existing.commands] }
    let mod: PluginModule
    try {
      const requireFromPlugin = createRequire(params.mainPath)
      mod = requireFromPlugin(params.mainPath) as PluginModule
    } catch (err) {
      throw new RpcError(RpcErrorCode.InternalError, `加载插件 ${params.id} 失败：${err instanceof Error ? err.message : String(err)}`)
    }
    const context: PluginContext = { pluginId: params.id, extensionPath: params.extensionPath, subscriptions: [] }
    const entry: ActivePlugin = { module: mod, context, commands: new Set() }
    this.active.set(params.id, entry)
    try {
      await mod.activate?.(context, this.createApi(params.id, new Set(params.declaredCommands)))
    } catch (err) {
      await this.deactivate(params.id)
      throw new RpcError(RpcErrorCode.InternalError, `插件 ${params.id} 激活失败：${err instanceof Error ? err.message : String(err)}`)
    }
    return { commands: [...entry.commands] }
  }

  private async deactivate(id: string): Promise<null> {
    const entry = this.active.get(id)
    if (!entry) return null
    try {
      await entry.module.deactivate?.()
    } catch (err) {
      console.error(`[plugin-host] 插件 ${id} deactivate 出错`, err)
    }
    for (const d of entry.context.subscriptions.splice(0).reverse()) {
      try { d.dispose() } catch (err) { console.error(`[plugin-host] 插件 ${id} 释放资源出错`, err) }
    }
    // 插件没放进 subscriptions 的命令也一并注销，保证停用后不留残余
    for (const command of [...entry.commands]) {
      this.commands.delete(command)
      this.rpc.notify('commands/unregistered', { pluginId: id, command })
    }
    this.active.delete(id)
    return null
  }

  private async executeLocal(params: ExecuteCommandParams): Promise<unknown> {
    const local = this.commands.get(params.command)
    if (!local) throw new RpcError(RpcErrorCode.PluginNotActive, `命令 ${params.command} 在插件进程中没有处理函数`)
    return local.handler(...(params.args ?? []))
  }
}
