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
  output: {
    /** 往编译输出面板追加一行（编译器插件输出编译过程用） */
    appendLine(text: string, type?: PluginMessageType): void
  }
  documents: {
    /** 读取文档当前内容：已在编辑器打开的取编辑器里（含未保存修改）的内容，否则读磁盘 */
    getText(path: string): Promise<string>
    /** 读取文档内容与版本号；修改时带上 version，文档在此期间被改过则失败（错误码 -33002） */
    get(path: string): Promise<{ text: string; version: string }>
    /**
     * 把文档改为 text：编辑器里显示差异，用户可撤销；不会自动保存。
     * 传入 baseText 时，若文档已不是 baseText（被别人改过）则拒绝修改。
     */
    applyEdit(path: string, text: string, base?: string | { version: string }): Promise<void>
  }
  workspace: {
    /** 当前项目目录；没有打开项目时为 null（需要 workspace:read） */
    getRoot(): Promise<string | null>
    /** 项目内的文件（相对路径），pattern 为包含匹配（需要 workspace:read） */
    listFiles(pattern?: string): Promise<string[]>
    /** 读项目内的文件（相对或绝对路径，必须在项目目录内；需要 workspace:read） */
    readFile(path: string): Promise<string>
    /** 写项目内的文件（已在编辑器里打开的文件请用 documents.applyEdit；需要 workspace:write） */
    writeFile(path: string, content: string): Promise<void>
  }
  ai: {
    /** 用用户当前选择的模型对话，返回回复文本（需要 ai:invoke，消耗用户额度） */
    chat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): Promise<string>
  }
  terminal: {
    /** 在内置终端执行一条命令（需要 terminal） */
    send(command: string): Promise<void>
    /** 读取最近 limit 行终端输出（需要 terminal） */
    read(limit?: number): Promise<string>
  }
  secrets: {
    /** 读取本插件自己的密钥（需要权限 secrets:own）；不存在时为 undefined */
    get(key: string): Promise<string | undefined>
    store(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
  }
}

export interface PluginContext {
  pluginId: string
  /** 插件所在目录 */
  extensionPath: string
  /** 插件自己的可写存储目录（第三方插件只能写这里） */
  storagePath?: string
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
    const host = (command: string, ...args: unknown[]): Promise<unknown> =>
      this.rpc.request('commands/executeHost', { pluginId, command, args }, 0)
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
          return this.rpc.request('commands/executeHost', { pluginId, command: id, args }, 0)
        },
      },
      window: {
        showMessage: (message, type = 'info') => {
          this.rpc.notify('window/showMessage', { pluginId, type, message: String(message) })
        },
      },
      output: {
        appendLine: (text, type = 'info') => {
          this.rpc.notify('output/append', { pluginId, type, text: String(text) })
        },
      },
      documents: {
        getText: async path => String(await this.rpc.request('commands/executeHost', { pluginId, command: 'documents:getText', args: [path] }, 0)),
        get: async path => (await host('documents:get', path)) as { text: string; version: string },
        applyEdit: async (path, text, base) => {
          const request = typeof base === 'object' && base ? { path, text, version: base.version } : { path, text, baseText: base }
          await host('documents:applyEdit', request)
        },
      },
      workspace: {
        getRoot: async () => (await host('workspace:getRoot')) as string | null,
        listFiles: async pattern => (await host('workspace:listFiles', pattern ?? '')) as string[],
        readFile: async path => String(await host('workspace:readFile', path)),
        writeFile: async (path, content) => { await host('workspace:writeFile', path, content) },
      },
      ai: {
        chat: async messages => String(await host('ai:chat', messages)),
      },
      terminal: {
        send: async command => { await host('terminal:send', command) },
        read: async limit => String(await host('terminal:read', limit ?? 40)),
      },
      secrets: {
        get: async key => (await this.rpc.request<string | null>('secrets/get', { pluginId, key })) ?? undefined,
        store: async (key, value) => { await this.rpc.request('secrets/store', { pluginId, key, value }) },
        delete: async key => { await this.rpc.request('secrets/delete', { pluginId, key }) },
      },
    }
  }

  private async activate(params: ActivatePluginParams): Promise<{ commands: string[] }> {
    const existing = this.active.get(params.id)
    if (existing) return { commands: [...existing.commands] }
    let mod: PluginModule
    try {
      if (!params.mainPath) throw new Error('缺少入口文件')
      const requireFromPlugin = createRequire(params.mainPath)
      mod = requireFromPlugin(params.mainPath) as PluginModule
    } catch (err) {
      throw new RpcError(RpcErrorCode.InternalError, `加载插件 ${params.id} 失败：${err instanceof Error ? err.message : String(err)}`)
    }
    const context: PluginContext = { pluginId: params.id, extensionPath: params.extensionPath, storagePath: params.storagePath, subscriptions: [] }
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
