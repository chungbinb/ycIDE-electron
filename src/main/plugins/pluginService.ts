// 宿主侧插件管理（设计稿 §2.2、§3、§11 阶段 0）：
//   扫描插件目录 → 解析（平台过滤、依赖排序、停用状态）→ 汇总贡献点 →
//   按激活事件把 node 插件加载进插件宿主进程 → 路由命令执行 → 停用时回收。
// 不直接依赖 Electron：进程创建、渲染进程通信、持久化都由调用方注入，便于测试。

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { resolvePlugins, type PluginCandidate, type PluginResolution, type ResolvedPluginStatus } from '../../shared/plugin/pluginResolver'
import { buildContributionModel, type ContributionModel } from '../../shared/plugin/contributions'
import type { PluginHostKind, PluginHostPlatform, PluginManifest } from '../../shared/plugin/manifest'
import { RpcError, RpcErrorCode, RpcPeer, type RpcTransport } from '../../shared/plugin/rpc'
import {
  PLUGIN_PROTOCOL_VERSION,
  type ActivatePluginParams,
  type CommandRegistrationParams,
  type ExecuteCommandParams,
  type ShowMessageParams,
} from './pluginProtocol'

/** 不允许停用的内置插件（设计稿 §13.1 卸载规则：工作台外壳、项目管理） */
export const NON_DISABLEABLE_PLUGINS: ReadonlySet<string> = new Set(['ycide.workbench', 'ycide.project'])

export interface PluginHostConnection {
  transport: RpcTransport
  /** 进程退出时回调（含崩溃） */
  onExit(listener: (code: number | null) => void): void
  kill(): void
}

export interface PluginServiceOptions {
  builtinCandidates: PluginCandidate[]
  /** 用户插件目录，按顺序扫描；目录下每个子目录一个插件 */
  pluginDirs: string[]
  /** 停用列表的持久化文件 */
  statePath: string
  platform: PluginHostPlatform
  arch?: string
  host: PluginHostKind
  /** 启动插件宿主进程 */
  spawnHost(): PluginHostConnection
  /** 执行宿主侧（渲染进程内置）命令：插件调用 executeCommand 时使用 */
  executeHostCommand(command: string, args: unknown[]): Promise<unknown>
  /** 插件请求在输出面板显示消息 */
  showMessage(params: ShowMessageParams): void
  /** 插件列表、贡献点或命令注册发生变化 */
  onDidChange(): void
  log?: (message: string) => void
}

export interface PluginInfo {
  id: string
  displayName: string
  version: string
  status: ResolvedPluginStatus
  reason?: string
  source: string
  builtin: boolean
  active: boolean
  canDisable: boolean
}

export interface PluginServiceState {
  plugins: PluginInfo[]
  /** 已启用插件的清单，按依赖拓扑序；渲染进程据此生成菜单与快捷键 */
  manifests: PluginManifest[]
}

interface HostProcess {
  connection: PluginHostConnection
  rpc: RpcPeer
  ready: Promise<void>
}

export class PluginService {
  private resolution: PluginResolution = { plugins: [], enabled: [] }
  private model: ContributionModel = buildContributionModel([])
  private disabled = new Set<string>()
  private host: HostProcess | null = null
  /** 插件 ID → 激活中的 Promise（激活完成后保留，表示已激活） */
  private readonly activations = new Map<string, Promise<void>>()
  /** 插件进程里注册的命令 → 所属插件 */
  private readonly hostCommands = new Map<string, string>()

  constructor(private readonly options: PluginServiceOptions) {}

  // ───────────── 扫描与解析 ─────────────

  /** 扫描插件目录，返回候选清单；入口文件缺失等问题记在 candidate.error 上 */
  scanPluginDirs(): PluginCandidate[] {
    const candidates: PluginCandidate[] = []
    for (const dir of this.options.pluginDirs) {
      if (!dir || !existsSync(dir)) continue
      let entries: string[]
      try {
        entries = readdirSync(dir)
      } catch {
        continue
      }
      for (const name of entries.sort()) {
        const pluginDir = join(dir, name)
        const manifestPath = join(pluginDir, 'plugin.json')
        try {
          if (!statSync(pluginDir).isDirectory() || !existsSync(manifestPath)) continue
        } catch {
          continue
        }
        let manifest: unknown
        try {
          manifest = JSON.parse(readFileSync(manifestPath, 'utf-8').replace(/^﻿/, ''))
        } catch (err) {
          candidates.push({ manifest: { id: name }, source: pluginDir, error: `plugin.json 不是合法 JSON：${(err as Error).message}` })
          continue
        }
        candidates.push({ manifest, source: pluginDir, error: this.checkEntry(manifest, pluginDir) })
      }
    }
    return candidates
  }

  private checkEntry(manifest: unknown, pluginDir: string): string | undefined {
    const runtime = (manifest as { runtime?: { type?: unknown; main?: unknown } } | null)?.runtime
    if (!runtime || runtime.type !== 'node') return undefined
    if (typeof runtime.main !== 'string' || !runtime.main) return 'runtime.type 为 node 时必须提供 runtime.main'
    const mainPath = this.resolveMain(pluginDir, runtime.main)
    if (!mainPath) return `runtime.main「${runtime.main}」必须位于插件目录内`
    if (!existsSync(mainPath)) return `入口文件不存在：${runtime.main}`
    return undefined
  }

  private resolveMain(pluginDir: string, main: string): string | null {
    const full = resolve(pluginDir, main)
    const rel = relative(pluginDir, full)
    if (rel.startsWith('..') || isAbsolute(rel)) return null
    return full
  }

  private loadDisabledState(): void {
    try {
      const raw = JSON.parse(readFileSync(this.options.statePath, 'utf-8')) as { disabled?: unknown }
      this.disabled = new Set(Array.isArray(raw.disabled) ? raw.disabled.filter((v): v is string => typeof v === 'string') : [])
    } catch {
      this.disabled = new Set()
    }
    for (const id of NON_DISABLEABLE_PLUGINS) this.disabled.delete(id)
  }

  private saveDisabledState(): void {
    mkdirSync(dirname(this.options.statePath), { recursive: true })
    writeFileSync(this.options.statePath, JSON.stringify({ disabled: [...this.disabled].sort() }, null, 2), 'utf-8')
  }

  private resolveAll(): void {
    const candidates = [...this.options.builtinCandidates, ...this.scanPluginDirs()]
    this.resolution = resolvePlugins(candidates, {
      platform: this.options.platform,
      arch: this.options.arch,
      host: this.options.host,
      disabled: this.disabled,
    })
    this.model = buildContributionModel(this.resolution.enabled)
    for (const p of this.resolution.plugins) {
      if (p.status === 'error' || p.status === 'unavailable') this.log(`${p.id}（${p.source}）未启用：${p.reason}`)
    }
    for (const w of this.model.warnings) this.log(w)
  }

  /** 启动：解析插件并激活声明了 onStartup / * 的插件 */
  async start(): Promise<void> {
    this.loadDisabledState()
    this.resolveAll()
    this.options.onDidChange()
    await this.activateByEvent('onStartup')
  }

  getModel(): ContributionModel {
    return this.model
  }

  getState(): PluginServiceState {
    const builtinSources = new Set(this.options.builtinCandidates.map(c => c.source))
    return {
      plugins: this.resolution.plugins.map(p => ({
        id: p.id,
        displayName: p.manifest?.displayName ?? p.id,
        version: p.manifest?.version ?? '',
        status: p.status,
        reason: p.reason,
        source: p.source,
        builtin: builtinSources.has(p.source),
        active: this.isActivated(p.id),
        canDisable: !NON_DISABLEABLE_PLUGINS.has(p.id),
      })),
      manifests: this.resolution.enabled,
    }
  }

  // ───────────── 激活与停用 ─────────────

  private isActivated(id: string): boolean {
    return this.activations.has(id)
  }

  private findEnabled(id: string): PluginManifest | undefined {
    return this.resolution.enabled.find(m => m.id === id)
  }

  private sourceOf(id: string): string | undefined {
    return this.resolution.plugins.find(p => p.id === id && p.status === 'enabled')?.source
  }

  private ensureHost(): HostProcess {
    if (this.host) return this.host
    const connection = this.options.spawnHost()
    const rpc = new RpcPeer(connection.transport)
    rpc.onNotification('commands/registered', params => {
      const { pluginId, command } = params as CommandRegistrationParams
      this.hostCommands.set(command, pluginId)
      this.options.onDidChange()
    })
    rpc.onNotification('commands/unregistered', params => {
      const { command } = params as CommandRegistrationParams
      this.hostCommands.delete(command)
      this.options.onDidChange()
    })
    rpc.onNotification('window/showMessage', params => this.options.showMessage(params as ShowMessageParams))
    rpc.onRequest('commands/executeHost', params => {
      const { command, args } = params as ExecuteCommandParams
      return this.executeCommand(command, args ?? [])
    })
    const host: HostProcess = {
      connection,
      rpc,
      ready: rpc.request<{ protocolVersion: string }>('initialize', { protocolVersion: PLUGIN_PROTOCOL_VERSION }).then(res => {
        if (res?.protocolVersion?.split('.')[0] !== PLUGIN_PROTOCOL_VERSION.split('.')[0]) {
          throw new Error(`插件宿主进程协议版本不兼容：${res?.protocolVersion}`)
        }
      }),
    }
    connection.onExit(code => {
      if (this.host !== host) return
      this.log(`插件宿主进程已退出（退出码 ${code ?? '未知'}），下次需要时会重新启动`)
      rpc.dispose('插件宿主进程已退出')
      this.host = null
      this.activations.clear()
      this.hostCommands.clear()
      this.options.onDidChange()
    })
    this.host = host
    return host
  }

  /** 激活插件（先激活它依赖的插件）；没有代码的插件视为直接激活成功 */
  activatePlugin(id: string): Promise<void> {
    const existing = this.activations.get(id)
    if (existing) return existing
    const manifest = this.findEnabled(id)
    if (!manifest) return Promise.reject(new RpcError(RpcErrorCode.PluginNotActive, `插件 ${id} 未启用`))
    const promise = (async () => {
      for (const depId of Object.keys(manifest.dependencies ?? {})) await this.activatePlugin(depId)
      if (manifest.runtime?.type !== 'node') return
      const pluginDir = this.sourceOf(id)!
      const mainPath = this.resolveMain(pluginDir, String(manifest.runtime.main))!
      const host = this.ensureHost()
      await host.ready
      const params: ActivatePluginParams = {
        id,
        mainPath,
        extensionPath: pluginDir,
        declaredCommands: (manifest.contributes?.commands ?? []).map(c => c.id),
      }
      await host.rpc.request('plugin/activate', params, 0)
      this.log(`插件 ${id} 已激活`)
    })()
    this.activations.set(id, promise)
    promise.catch(err => {
      if (this.activations.get(id) === promise) this.activations.delete(id)
      this.log(`插件 ${id} 激活失败：${err instanceof Error ? err.message : String(err)}`)
    })
    return promise
  }

  async activateByEvent(event: string): Promise<void> {
    const targets = this.resolution.enabled.filter(m =>
      (m.activationEvents ?? []).some(e => e === event || e === '*'),
    )
    await Promise.allSettled(targets.map(m => this.activatePlugin(m.id)))
  }

  private async deactivatePlugin(id: string): Promise<void> {
    if (!this.activations.has(id)) return
    this.activations.delete(id)
    if (this.host) {
      try {
        await this.host.rpc.request('plugin/deactivate', { id })
      } catch (err) {
        this.log(`插件 ${id} 停用出错：${err instanceof Error ? err.message : String(err)}`)
      }
    }
    for (const [command, owner] of this.hostCommands) {
      if (owner === id) this.hostCommands.delete(command)
    }
  }

  /** 启用 / 停用插件，立即生效并持久化 */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (!enabled && NON_DISABLEABLE_PLUGINS.has(id)) {
      throw new Error(`插件 ${id} 是核心插件，不能停用`)
    }
    if (enabled) this.disabled.delete(id)
    else this.disabled.add(id)
    this.saveDisabledState()
    this.resolveAll()
    // 停用的插件、以及因依赖被停用而不可用的插件，都要从插件进程里卸下
    const enabledIds = new Set(this.resolution.enabled.map(m => m.id))
    for (const activeId of [...this.activations.keys()].reverse()) {
      if (!enabledIds.has(activeId)) await this.deactivatePlugin(activeId)
    }
    this.options.onDidChange()
    if (enabled) await this.activateByEvent('onStartup')
  }

  /** 重新扫描插件目录并重启插件进程（开发插件时使用） */
  async reload(): Promise<void> {
    await this.shutdown()
    this.loadDisabledState()
    this.resolveAll()
    this.options.onDidChange()
    await this.activateByEvent('onStartup')
  }

  // ───────────── 命令路由 ─────────────

  /** 命令是否由插件进程处理（渲染进程本地没有处理函数时会转到这里） */
  isPluginCommand(command: string): boolean {
    if (this.hostCommands.has(command)) return true
    const owner = this.model.commands.get(command)?.pluginId
    return !!owner && this.findEnabled(owner)?.runtime?.type === 'node'
  }

  /**
   * 执行命令：插件进程已注册的直接转发；声明了该命令但尚未激活的插件先激活再执行
   * （声明了命令即视为 onCommand 激活事件）；其余交给宿主侧（渲染进程内置命令）。
   */
  async executeCommand(command: string, args: unknown[] = []): Promise<unknown> {
    if (!this.hostCommands.has(command)) {
      const owner = this.model.commands.get(command)?.pluginId
      const ownerManifest = owner ? this.findEnabled(owner) : undefined
      if (ownerManifest?.runtime?.type === 'node') {
        await this.activatePlugin(ownerManifest.id)
        if (!this.hostCommands.has(command)) {
          throw new RpcError(RpcErrorCode.PluginNotActive, `插件 ${ownerManifest.id} 已激活，但没有注册命令 ${command}`)
        }
      } else {
        return this.options.executeHostCommand(command, args)
      }
    }
    const host = this.host
    if (!host) throw new RpcError(RpcErrorCode.PluginNotActive, `命令 ${command} 所在的插件进程未运行`)
    return host.rpc.request('commands/execute', { command, args } satisfies ExecuteCommandParams, 0)
  }

  // ───────────── 关闭 ─────────────

  async shutdown(): Promise<void> {
    const host = this.host
    if (!host) return
    this.host = null
    try {
      await host.rpc.request('shutdown', undefined, 5000)
    } catch {
      // 插件进程已经不响应，直接结束
    }
    host.rpc.dispose()
    host.connection.kill()
    this.activations.clear()
    this.hostCommands.clear()
  }

  private log(message: string): void {
    (this.options.log ?? (m => console.log(`[plugins] ${m}`)))(message)
  }
}
