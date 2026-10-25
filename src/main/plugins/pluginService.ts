// 宿主侧插件管理（设计稿 §2.2、§3、§8、§11 阶段 0、5）：
//   扫描插件目录 → 解析（平台过滤、依赖排序、停用状态、权限授权）→ 汇总贡献点 →
//   按激活事件把有代码的插件加载进插件进程 → 路由命令执行 → 停用时回收。
// 插件进程按信任程度分开（§2.2）：
//   - trusted：官方内置的 Node 插件共用一个进程；
//   - sandboxed：第三方 Node 插件每个发布者一个进程，开启 Node 权限模型（只读自己的插件目录、只写自己的存储目录）；
//   - executable：可执行文件插件每个插件一个进程（stdio + JSON-RPC）。
// 插件进程发来的每个请求都核对「这个插件确实在这个进程里」并检查权限，越权返回 -33001。
// 不直接依赖 Electron：进程创建、渲染进程通信、持久化都由调用方注入，便于测试。

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { resolvePlugins, type PluginCandidate, type PluginResolution, type ResolvedPluginStatus } from '../../shared/plugin/pluginResolver'
import { buildContributionModel, type ContributionModel } from '../../shared/plugin/contributions'
import type { PluginHostKind, PluginHostPlatform, PluginManifest } from '../../shared/plugin/manifest'
import { describePermission, hasPermission, requestedPermissions } from '../../shared/plugin/permissions'
import { RpcError, RpcErrorCode, RpcPeer, type RpcTransport } from '../../shared/plugin/rpc'
import {
  PLUGIN_PROTOCOL_VERSION,
  type ActivatePluginParams,
  type CommandRegistrationParams,
  type ExecuteCommandParams,
  type ExecuteHostCommandParams,
  type SecretParams,
  type ShowMessageParams,
  type OutputAppendParams,
} from './pluginProtocol'

/** 去掉不可信清单里的 builtin 声明 */
function untrust(manifest: unknown): unknown {
  if (!manifest || typeof manifest !== 'object' || !('builtin' in manifest)) return manifest
  const { builtin: _ignored, ...rest } = manifest as Record<string, unknown>
  return rest
}

function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** 不允许停用的内置插件（设计稿 §13.1 卸载规则：工作台外壳、项目管理） */
export const NON_DISABLEABLE_PLUGINS: ReadonlySet<string> = new Set([
  'ycide.workbench',
  'ycide.project',
  // 设计稿 §13.1 卸载规则：语言服务、文本编辑器（所有编辑器的兜底）不可停用；
  // 表格编辑器不可卸载但可被替换（第三方编辑器可以在「打开方式」里设为默认）
  'ycide.lang-eyc',
  'ycide.editor-text',
  'ycide.editor-eyc-table',
  // DOM 渲染后端是其它渲染后端不可用时的兜底，同样只能被替换（设置里换后端）不能停用
  'ycide.render-dom',
])

/** 插件进程在 CRASH_WINDOW_MS 内崩溃这么多次后不再自动拉起，直到重新加载插件 */
export const MAX_HOST_CRASHES = 3
const CRASH_WINDOW_MS = 5 * 60 * 1000

export type PluginProcessKind = 'trusted' | 'sandboxed' | 'executable'

/** 要启动的插件进程 */
export interface PluginHostSpec {
  /** trusted / publisher:<发布者> / exe:<插件ID> */
  key: string
  kind: PluginProcessKind
  /** 这个进程里会加载的插件目录（sandboxed：只允许读这些目录） */
  pluginDirs: string[]
  /** 这个进程里插件的存储目录（sandboxed：只允许写这些目录） */
  storageDirs: string[]
  /** 这个进程里插件已获授权的权限并集（sandboxed：决定是否放开任意读写、启动子进程、联网的域名） */
  permissions: string[]
  /** executable：可执行文件的绝对路径、参数与工作目录 */
  command?: string
  args?: string[]
  cwd?: string
}

export interface PluginHostConnection {
  transport: RpcTransport
  /** 进程退出时回调（含崩溃） */
  onExit(listener: (code: number | null) => void): void
  kill(): void
}

export interface PluginSecretStore {
  get(pluginId: string, key: string): Promise<string | undefined> | string | undefined
  store(pluginId: string, key: string, value: string): Promise<void> | void
  delete(pluginId: string, key: string): Promise<void> | void
}

export interface PluginServiceOptions {
  builtinCandidates: PluginCandidate[]
  /** 用户插件目录，按顺序扫描；目录下每个子目录一个插件 */
  pluginDirs: string[]
  /**
   * 随安装包发布、可信的插件目录（如内置支持库目录 lib/）。只有这些目录里的插件清单可以声明 builtin；
   * 其余目录（用户安装、开发目录）的插件一律按非内置处理——否则插件只要在清单里写 builtin: true，
   * 就能借用内置提供方的 API Key、绕过 AI 工具调用确认。
   */
  trustedDirs?: string[]
  /** 开发中插件的目录（YCIDE_EXTRA_PLUGIN_DIRS）：权限视同已授权，仍在受限进程里运行 */
  devDirs?: string[]
  /** 商店安装插件的目录：这里的插件可以在插件管理里卸载 */
  userPluginsDir?: string
  /** 停用列表与权限授权的持久化文件 */
  statePath: string
  /** 插件存储目录的根（每个插件一个子目录） */
  storageRoot?: string
  platform: PluginHostPlatform
  arch?: string
  host: PluginHostKind
  /** 启动插件进程 */
  spawnHost(spec: PluginHostSpec): PluginHostConnection
  /** 执行宿主侧（渲染进程内置）命令：插件调用 executeCommand 时使用 */
  executeHostCommand(command: string, args: unknown[]): Promise<unknown>
  /** 插件请求在输出面板显示消息 */
  showMessage(params: ShowMessageParams): void
  /** 插件往编译输出面板追加一行；未提供时并入 showMessage */
  appendOutput?(params: OutputAppendParams): void
  /** 插件密钥存储（secrets:own）；未提供时插件的密钥请求报错 */
  secrets?: PluginSecretStore
  /** 插件列表、贡献点或命令注册发生变化 */
  onDidChange(): void
  log?: (message: string) => void
}

export interface PluginInfo {
  id: string
  displayName: string
  version: string
  publisher: string
  status: ResolvedPluginStatus
  reason?: string
  source: string
  builtin: boolean
  active: boolean
  canDisable: boolean
  /** 申请的权限（含可执行文件插件的 runtime:executable） */
  permissions: string[]
  /** 等待用户同意权限才能启用 */
  needsConsent: boolean
  /** 运行在哪种插件进程里；没有代码的插件为 undefined */
  processKind?: PluginProcessKind
  /** 商店安装的插件，可以卸载 */
  removable: boolean
  /** 开发目录里的插件（权限视同已授权、改动后自动重新加载） */
  dev: boolean
}

export interface PluginServiceState {
  plugins: PluginInfo[]
  /** 已启用插件的清单，按依赖拓扑序；渲染进程据此生成菜单与快捷键 */
  manifests: PluginManifest[]
}

interface HostProcess {
  spec: PluginHostSpec
  connection: PluginHostConnection
  rpc: RpcPeer
  ready: Promise<void>
  /** 在这个进程里激活过的插件 */
  plugins: Set<string>
}

interface PersistedState {
  disabled: string[]
  granted: Record<string, string[]>
}

export class PluginService {
  private resolution: PluginResolution = { plugins: [], enabled: [] }
  private model: ContributionModel = buildContributionModel([])
  private disabled = new Set<string>()
  /** 插件 ID → 用户同意过的权限 */
  private granted = new Map<string, string[]>()
  /** 等待用户同意权限的插件 */
  private pendingConsent = new Set<string>()
  private readonly hosts = new Map<string, HostProcess>()
  /** 插件进程 key → 最近的崩溃时间 */
  private readonly crashes = new Map<string, number[]>()
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
          candidates.push({ manifest: { id: name }, source: pluginDir, dir: pluginDir, error: `plugin.json 不是合法 JSON：${(err as Error).message}` })
          continue
        }
        candidates.push({ manifest: this.trusted(dir) ? manifest : untrust(manifest), source: pluginDir, dir: pluginDir, error: this.checkEntry(manifest, pluginDir) })
      }
    }
    return candidates
  }

  private trusted(dir: string): boolean {
    const target = resolve(dir).toLowerCase()
    return (this.options.trustedDirs ?? []).some(d => resolve(d).toLowerCase() === target)
  }

  private isDevPlugin(pluginDir: string | undefined): boolean {
    return !!pluginDir && (this.options.devDirs ?? []).some(d => isInside(d, pluginDir))
  }

  private checkEntry(manifest: unknown, pluginDir: string): string | undefined {
    const runtime = (manifest as { runtime?: { type?: unknown; main?: unknown; command?: unknown } } | null)?.runtime
    if (!runtime) return undefined
    const field = runtime.type === 'node' ? 'main' : runtime.type === 'executable' ? 'command' : null
    if (!field) return undefined
    const entry = runtime[field]
    if (typeof entry !== 'string' || !entry) return undefined // 清单校验会报出缺少字段
    const entryPath = this.resolveMain(pluginDir, entry)
    if (!entryPath) return `runtime.${field}「${entry}」必须位于插件目录内`
    if (!existsSync(entryPath)) return `入口文件不存在：${entry}`
    return undefined
  }

  private resolveMain(pluginDir: string, main: string): string | null {
    const full = resolve(pluginDir, main)
    const rel = relative(pluginDir, full)
    if (rel.startsWith('..') || isAbsolute(rel)) return null
    return full
  }

  private loadState(): void {
    let raw: Partial<PersistedState> = {}
    try {
      raw = JSON.parse(readFileSync(this.options.statePath, 'utf-8')) as Partial<PersistedState>
    } catch {
      raw = {}
    }
    this.disabled = new Set(Array.isArray(raw.disabled) ? raw.disabled.filter((v): v is string => typeof v === 'string') : [])
    for (const id of NON_DISABLEABLE_PLUGINS) this.disabled.delete(id)
    this.granted = new Map()
    if (raw.granted && typeof raw.granted === 'object') {
      for (const [id, perms] of Object.entries(raw.granted)) {
        if (Array.isArray(perms)) this.granted.set(id, perms.filter((p): p is string => typeof p === 'string'))
      }
    }
  }

  private saveState(): void {
    mkdirSync(dirname(this.options.statePath), { recursive: true })
    const state: PersistedState = {
      disabled: [...this.disabled].sort(),
      granted: Object.fromEntries([...this.granted].sort(([a], [b]) => a.localeCompare(b))),
    }
    writeFileSync(this.options.statePath, JSON.stringify(state, null, 2), 'utf-8')
  }

  /** 插件实际拥有的权限：内置插件全部；开发目录里的插件视同已授权；其余为用户同意过的 */
  private effectiveGrants(id: string): string[] {
    const plugin = this.resolution.plugins.find(p => p.id === id)
    if (!plugin?.manifest) return []
    if (this.isDevPlugin(plugin.dir)) return requestedPermissions(plugin.manifest)
    const granted = this.granted.get(id) ?? []
    // 只认清单里仍然声明着的权限（插件升级后去掉的权限不再生效）
    return requestedPermissions(plugin.manifest).filter(p => granted.includes(p))
  }

  private needsConsent(manifest: PluginManifest, dir: string | undefined): boolean {
    if (manifest.builtin || this.isDevPlugin(dir)) return false
    const granted = this.granted.get(manifest.id) ?? []
    return requestedPermissions(manifest).some(p => !granted.includes(p))
  }

  private resolveAll(): void {
    const candidates = [...this.options.builtinCandidates, ...this.scanPluginDirs()]
    const env = { platform: this.options.platform, arch: this.options.arch, host: this.options.host }
    // 先解析一遍找出需要用户同意权限的插件，再把它们当作停用重新解析（依赖它们的插件随之不可用）
    const first = resolvePlugins(candidates, { ...env, disabled: this.disabled })
    this.pendingConsent = new Set(first.plugins
      .filter(p => p.status === 'enabled' && p.manifest && this.needsConsent(p.manifest, p.dir))
      .map(p => p.id))
    this.resolution = this.pendingConsent.size === 0
      ? first
      : resolvePlugins(candidates, { ...env, disabled: new Set([...this.disabled, ...this.pendingConsent]) })
    for (const p of this.resolution.plugins) {
      if (this.pendingConsent.has(p.id) && p.status === 'disabled') p.reason = '等待授权：需要你同意它申请的权限后才能启用'
    }
    this.model = buildContributionModel(this.resolution.enabled)
    for (const p of this.resolution.plugins) {
      if (p.status === 'error' || p.status === 'unavailable') this.log(`${p.id}（${p.source}）未启用：${p.reason}`)
    }
    for (const w of this.model.warnings) this.log(w)
  }

  /** 启动：解析插件并激活声明了 onStartup / * 的插件 */
  async start(): Promise<void> {
    this.loadState()
    this.resolveAll()
    this.options.onDidChange()
    await this.activateByEvent('onStartup')
  }

  getModel(): ContributionModel {
    return this.model
  }

  /** 按 ID 取插件清单（含停用、不可用的插件；清单本身无效时没有） */
  getManifest(id: string): PluginManifest | undefined {
    return this.resolution.plugins.find(p => p.id === id)?.manifest
  }

  getState(): PluginServiceState {
    const builtinSources = new Set(this.options.builtinCandidates.map(c => c.source))
    return {
      plugins: this.resolution.plugins.map(p => ({
        id: p.id,
        displayName: p.manifest?.displayName ?? p.id,
        version: p.manifest?.version ?? '',
        publisher: p.manifest?.publisher ?? '',
        status: p.status,
        reason: p.reason,
        source: p.source,
        // 内置：随版本发布的内置插件，以及可信目录（lib/）里声明 builtin 的支持库插件
        builtin: builtinSources.has(p.source) || !!p.manifest?.builtin,
        active: this.isActivated(p.id),
        canDisable: !NON_DISABLEABLE_PLUGINS.has(p.id),
        permissions: p.manifest ? requestedPermissions(p.manifest) : [],
        needsConsent: this.pendingConsent.has(p.id),
        processKind: p.manifest ? this.processKindOf(p.manifest) : undefined,
        removable: !!p.dir && !!this.options.userPluginsDir && isInside(this.options.userPluginsDir, p.dir) && !NON_DISABLEABLE_PLUGINS.has(p.id),
        dev: this.isDevPlugin(p.dir),
      })),
      manifests: this.resolution.enabled,
    }
  }

  // ───────────── 权限授权 ─────────────

  /** 用户同意插件申请的全部权限（插件管理里的「授权并启用」、商店安装确认时调用） */
  async grantPermissions(id: string): Promise<void> {
    const manifest = this.getManifest(id)
    if (!manifest) throw new Error(`插件 ${id} 不存在或清单无效`)
    this.granted.set(id, requestedPermissions(manifest))
    this.disabled.delete(id)
    this.saveState()
    this.resolveAll()
    this.options.onDidChange()
    await this.activateByEvent('onStartup')
  }

  /** 收回授权：插件回到「等待授权」，并从插件进程里卸下 */
  async revokePermissions(id: string): Promise<void> {
    this.granted.delete(id)
    this.saveState()
    await this.applyResolutionChange()
  }

  /** 预先记录授权（安装插件前用户已在商店确认过权限时调用；插件目录尚未扫描到也可以记录） */
  recordGrant(id: string, permissions: string[]): void {
    this.granted.set(id, [...new Set(permissions)].sort())
    this.saveState()
  }

  // ───────────── 激活与停用 ─────────────

  private isActivated(id: string): boolean {
    return this.activations.has(id)
  }

  private findEnabled(id: string): PluginManifest | undefined {
    return this.resolution.enabled.find(m => m.id === id)
  }

  private dirOf(id: string): string | undefined {
    return this.resolution.plugins.find(p => p.id === id && p.status === 'enabled')?.dir
  }

  private storageDirOf(id: string): string | undefined {
    return this.options.storageRoot ? join(this.options.storageRoot, id) : undefined
  }

  private hasCode(manifest: PluginManifest): boolean {
    return manifest.runtime?.type === 'node' || manifest.runtime?.type === 'executable'
  }

  private processKindOf(manifest: PluginManifest): PluginProcessKind | undefined {
    if (manifest.runtime?.type === 'executable') return 'executable'
    if (manifest.runtime?.type !== 'node') return undefined
    return manifest.builtin ? 'trusted' : 'sandboxed'
  }

  private hostKeyOf(manifest: PluginManifest): string {
    const kind = this.processKindOf(manifest)
    if (kind === 'executable') return `exe:${manifest.id}`
    if (kind === 'trusted') return 'trusted'
    return `publisher:${manifest.publisher}`
  }

  /**
   * 已启用插件目录内的文件绝对路径（插件网页 UI 经 ycide-plugin:// 协议加载时使用）；
   * 插件未启用、路径越出插件目录或文件不存在时返回 null
   */
  resolvePluginFile(id: string, relativePath: string): string | null {
    const dir = this.dirOf(id)
    if (!dir) return null
    const file = this.resolveMain(dir, relativePath)
    if (!file || !existsSync(file)) return null
    try {
      return statSync(file).isFile() ? file : null
    } catch {
      return null
    }
  }

  /**
   * 已启用插件贡献的主题：同一 ID 只取第一个（插件按依赖拓扑序，内置插件在前）。
   * 文件路径必须在插件目录内且存在，否则忽略并记录日志。
   */
  getContributedThemes(): Array<{ id: string; file: string; pluginId: string }> {
    const seen = new Set<string>()
    const themes: Array<{ id: string; file: string; pluginId: string }> = []
    for (const manifest of this.resolution.enabled) {
      const dir = this.dirOf(manifest.id)
      for (const theme of manifest.contributes?.themes ?? []) {
        if (seen.has(theme.id)) continue
        const file = dir ? this.resolveMain(dir, theme.path) : null
        if (!file || !existsSync(file)) {
          this.log(`插件 ${manifest.id} 的主题「${theme.id}」文件不存在：${theme.path}`)
          continue
        }
        seen.add(theme.id)
        themes.push({ id: theme.id, file, pluginId: manifest.id })
      }
    }
    return themes
  }

  /** 为某个插件算出它所在进程的启动参数（同一发布者的插件共用进程，目录、权限取并集） */
  private buildHostSpec(manifest: PluginManifest): PluginHostSpec {
    const key = this.hostKeyOf(manifest)
    const kind = this.processKindOf(manifest)!
    const members = kind === 'executable'
      ? [manifest]
      : this.resolution.enabled.filter(m => this.hasCode(m) && this.hostKeyOf(m) === key)
    const spec: PluginHostSpec = {
      key,
      kind,
      pluginDirs: members.map(m => this.dirOf(m.id)).filter((d): d is string => !!d),
      storageDirs: members.map(m => this.storageDirOf(m.id)).filter((d): d is string => !!d),
      permissions: [...new Set(members.flatMap(m => this.effectiveGrants(m.id)))].sort(),
    }
    if (kind === 'executable') {
      const dir = this.dirOf(manifest.id)!
      spec.command = this.resolveMain(dir, String(manifest.runtime!.command))!
      spec.args = Array.isArray(manifest.runtime!.args) ? (manifest.runtime!.args as string[]) : []
      spec.cwd = dir
    }
    return spec
  }

  private ensureHost(manifest: PluginManifest): HostProcess {
    const key = this.hostKeyOf(manifest)
    const existing = this.hosts.get(key)
    if (existing) return existing
    const spec = this.buildHostSpec(manifest)
    const connection = this.options.spawnHost(spec)
    const rpc = new RpcPeer(connection.transport)
    const host: HostProcess = { spec, connection, rpc, ready: Promise.resolve(), plugins: new Set() }

    // 插件进程发来的消息里的 pluginId 只是自称：核对它确实在这个进程里激活过（可执行文件插件一个进程只有一个插件）
    const callerOf = (params: unknown): string => {
      const claimed = (params as { pluginId?: unknown } | null)?.pluginId
      if (spec.kind === 'executable') return manifest.id
      if (typeof claimed !== 'string' || !host.plugins.has(claimed)) {
        throw new RpcError(RpcErrorCode.PermissionDenied, `插件 ${String(claimed)} 不在这个插件进程里`)
      }
      return claimed
    }
    const quietly = (fn: () => void): void => {
      try { fn() } catch (err) { this.log(`忽略插件进程 ${key} 的消息：${err instanceof Error ? err.message : String(err)}`) }
    }

    rpc.onNotification('commands/registered', params => quietly(() => {
      const pluginId = callerOf(params)
      const { command } = params as CommandRegistrationParams
      const declared = (this.findEnabled(pluginId)?.contributes?.commands ?? []).some(c => c.id === command)
      if (!declared) throw new Error(`命令 ${command} 没有在插件 ${pluginId} 的清单里声明`)
      this.hostCommands.set(command, pluginId)
      this.options.onDidChange()
    }))
    rpc.onNotification('commands/unregistered', params => quietly(() => {
      const pluginId = callerOf(params)
      const { command } = params as CommandRegistrationParams
      if (this.hostCommands.get(command) !== pluginId) return
      this.hostCommands.delete(command)
      this.options.onDidChange()
    }))
    rpc.onNotification('window/showMessage', params => quietly(() => {
      const pluginId = callerOf(params)
      const p = params as ShowMessageParams
      this.options.showMessage({ pluginId, type: p.type, message: String(p.message) })
    }))
    rpc.onNotification('output/append', params => quietly(() => {
      const pluginId = callerOf(params)
      const p = params as OutputAppendParams
      if (this.options.appendOutput) this.options.appendOutput({ pluginId, type: p.type, text: String(p.text) })
      else this.options.showMessage({ pluginId, type: p.type, message: String(p.text) })
    }))
    rpc.onRequest('commands/executeHost', params => {
      const pluginId = callerOf(params)
      const { command, args } = params as ExecuteHostCommandParams
      if (typeof command !== 'string') throw new RpcError(RpcErrorCode.InvalidParams, '命令 ID 无效')
      const permission = this.permissionForHostCommand(command)
      if (permission) this.requirePermission(pluginId, permission)
      return this.executeCommand(command, Array.isArray(args) ? args : [])
    })
    rpc.onRequest('secrets/get', params => this.handleSecret('get', callerOf(params), params as SecretParams))
    rpc.onRequest('secrets/store', params => this.handleSecret('store', callerOf(params), params as SecretParams))
    rpc.onRequest('secrets/delete', params => this.handleSecret('delete', callerOf(params), params as SecretParams))

    host.ready = rpc.request<{ protocolVersion: string }>('initialize', { protocolVersion: PLUGIN_PROTOCOL_VERSION }).then(res => {
      if (res?.protocolVersion?.split('.')[0] !== PLUGIN_PROTOCOL_VERSION.split('.')[0]) {
        throw new Error(`插件进程协议版本不兼容：${res?.protocolVersion}`)
      }
    })
    connection.onExit(code => {
      if (this.hosts.get(key) !== host) return
      this.hosts.delete(key)
      rpc.dispose('插件进程已退出')
      const lost = [...host.plugins]
      for (const id of lost) this.activations.delete(id)
      for (const [command, owner] of this.hostCommands) {
        if (lost.includes(owner)) this.hostCommands.delete(command)
      }
      const count = this.recordCrash(key)
      if (count >= MAX_HOST_CRASHES) {
        this.log(`插件进程 ${key} 在 5 分钟内已退出 ${count} 次（退出码 ${code ?? '未知'}），不再自动启动；修复后请重新加载插件`)
      } else {
        // 指数退避后重新激活这个进程里随启动激活的插件（其余插件下次用到时再拉起）
        const delay = 1000 * 2 ** (count - 1)
        this.log(`插件进程 ${key} 已退出（退出码 ${code ?? '未知'}），${delay / 1000} 秒后重新启动`)
        const timer = setTimeout(() => { void this.reactivateStartupPlugins(lost) }, delay)
        timer.unref?.()
      }
      this.options.onDidChange()
    })
    this.hosts.set(key, host)
    return host
  }

  /** 记一次崩溃，返回窗口期内的崩溃次数 */
  private recordCrash(key: string): number {
    const now = Date.now()
    const recent = (this.crashes.get(key) ?? []).filter(t => now - t < CRASH_WINDOW_MS)
    recent.push(now)
    this.crashes.set(key, recent)
    return recent.length
  }

  private recentCrashes(key: string): number {
    const now = Date.now()
    return (this.crashes.get(key) ?? []).filter(t => now - t < CRASH_WINDOW_MS).length
  }

  private async reactivateStartupPlugins(ids: string[]): Promise<void> {
    const targets = ids
      .map(id => this.findEnabled(id))
      .filter((m): m is PluginManifest => !!m && (m.activationEvents ?? []).some(e => e === 'onStartup' || e === '*'))
    await Promise.allSettled(targets.map(m => this.activatePlugin(m.id)))
  }

  /** 插件调用宿主侧命令需要的权限；插件之间互相调用命令不需要权限 */
  private permissionForHostCommand(command: string): string | null {
    if (command === 'documents:getText') return 'workspace:read'
    if (command === 'documents:applyEdit') return 'documents:write'
    if (this.hostCommands.has(command)) return null
    const owner = this.model.commands.get(command)?.pluginId
    const ownerManifest = owner ? this.findEnabled(owner) : undefined
    if (ownerManifest && this.hasCode(ownerManifest)) return null
    return 'workbench:commands'
  }

  private requirePermission(pluginId: string, permission: string): void {
    const manifest = this.findEnabled(pluginId)
    if (!manifest) throw new RpcError(RpcErrorCode.PluginNotActive, `插件 ${pluginId} 未启用`)
    if (!hasPermission(manifest, this.effectiveGrants(pluginId), permission)) {
      throw new RpcError(RpcErrorCode.PermissionDenied, `插件 ${pluginId} 没有权限：${describePermission(permission)}（${permission}）`)
    }
  }

  private async handleSecret(action: 'get' | 'store' | 'delete', pluginId: string, params: SecretParams): Promise<unknown> {
    this.requirePermission(pluginId, 'secrets:own')
    const store = this.options.secrets
    if (!store) throw new RpcError(RpcErrorCode.InternalError, '宿主没有提供密钥存储')
    if (typeof params?.key !== 'string' || !params.key) throw new RpcError(RpcErrorCode.InvalidParams, '密钥名称无效')
    if (action === 'get') return (await store.get(pluginId, params.key)) ?? null
    if (action === 'store') {
      if (typeof params.value !== 'string') throw new RpcError(RpcErrorCode.InvalidParams, '密钥内容必须是字符串')
      await store.store(pluginId, params.key, params.value)
      return null
    }
    await store.delete(pluginId, params.key)
    return null
  }

  /** 激活插件（先激活它依赖的插件）；没有代码的插件视为直接激活成功 */
  activatePlugin(id: string): Promise<void> {
    const existing = this.activations.get(id)
    if (existing) return existing
    const manifest = this.findEnabled(id)
    if (!manifest) return Promise.reject(new RpcError(RpcErrorCode.PluginNotActive, `插件 ${id} 未启用`))
    const promise = (async () => {
      for (const depId of Object.keys(manifest.dependencies ?? {})) await this.activatePlugin(depId)
      if (!this.hasCode(manifest)) return
      const key = this.hostKeyOf(manifest)
      if (this.recentCrashes(key) >= MAX_HOST_CRASHES) {
        throw new RpcError(RpcErrorCode.PluginNotActive, `插件进程 ${key} 反复崩溃，已停止加载；修复后请重新加载插件`)
      }
      const pluginDir = this.dirOf(id)!
      // 同一发布者的进程已经在运行、但启动时没有包含这个插件的目录（新启用的插件）：重启进程以放开它的目录
      const running = this.hosts.get(key)
      if (running && running.spec.kind === 'sandboxed' && !running.spec.pluginDirs.includes(pluginDir)) {
        const siblings = [...running.plugins]
        await this.stopHost(key)
        void Promise.resolve().then(() => this.reactivateStartupPlugins(siblings))
      }
      const storagePath = this.storageDirOf(id)
      if (storagePath) mkdirSync(storagePath, { recursive: true })
      const host = this.ensureHost(manifest)
      await host.ready
      host.plugins.add(id)
      const declaredCommands = (manifest.contributes?.commands ?? []).map(c => c.id)
      const params: ActivatePluginParams = {
        id,
        mainPath: manifest.runtime?.type === 'node' ? this.resolveMain(pluginDir, String(manifest.runtime.main))! : undefined,
        extensionPath: pluginDir,
        storagePath,
        declaredCommands,
      }
      try {
        await host.rpc.request('plugin/activate', params, 0)
      } catch (err) {
        host.plugins.delete(id)
        throw err
      }
      // 可执行文件插件声明的命令由宿主直接登记（它不必发 commands/registered）
      if (host.spec.kind === 'executable') {
        for (const command of declaredCommands) this.hostCommands.set(command, id)
        this.options.onDidChange()
      }
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
    for (const [key, host] of this.hosts) {
      if (!host.plugins.has(id)) continue
      try {
        await host.rpc.request('plugin/deactivate', { id })
      } catch (err) {
        this.log(`插件 ${id} 停用出错：${err instanceof Error ? err.message : String(err)}`)
      }
      host.plugins.delete(id)
      // 可执行文件插件一个进程一个插件，停用后结束进程
      if (host.spec.kind === 'executable' || host.plugins.size === 0) await this.stopHost(key)
    }
    for (const [command, owner] of this.hostCommands) {
      if (owner === id) this.hostCommands.delete(command)
    }
  }

  private async applyResolutionChange(): Promise<void> {
    this.resolveAll()
    // 停用的插件、以及因依赖被停用而不可用的插件，都要从插件进程里卸下
    const enabledIds = new Set(this.resolution.enabled.map(m => m.id))
    for (const activeId of [...this.activations.keys()].reverse()) {
      if (!enabledIds.has(activeId)) await this.deactivatePlugin(activeId)
    }
    this.options.onDidChange()
  }

  /** 启用 / 停用插件，立即生效并持久化 */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (!enabled && NON_DISABLEABLE_PLUGINS.has(id)) {
      throw new Error(`插件 ${id} 是核心插件，不能停用`)
    }
    if (enabled) this.disabled.delete(id)
    else this.disabled.add(id)
    this.saveState()
    await this.applyResolutionChange()
    if (enabled) await this.activateByEvent('onStartup')
  }

  /** 重新扫描插件目录（安装、卸载插件后），不重启无关的插件进程 */
  async rescan(): Promise<void> {
    await this.applyResolutionChange()
    await this.activateByEvent('onStartup')
  }

  /** 卸载前把插件从进程里卸下（进程里没有别的插件时结束进程，释放对插件目录的占用） */
  async releasePlugin(id: string): Promise<void> {
    await this.deactivatePlugin(id)
    const dir = this.resolution.plugins.find(p => p.id === id)?.dir
    if (!dir) return
    for (const [key, host] of [...this.hosts]) {
      if (host.spec.pluginDirs.includes(dir)) await this.stopHost(key)
    }
  }

  /** 卸载后清掉插件的授权记录 */
  forgetPlugin(id: string): void {
    this.granted.delete(id)
    this.disabled.delete(id)
    this.saveState()
  }

  /** 重新扫描插件目录并重启插件进程（开发插件时使用） */
  async reload(): Promise<void> {
    await this.shutdown()
    this.crashes.clear()
    this.loadState()
    this.resolveAll()
    this.options.onDidChange()
    await this.activateByEvent('onStartup')
  }

  // ───────────── 命令路由 ─────────────

  /** 命令是否由插件进程处理（渲染进程本地没有处理函数时会转到这里） */
  isPluginCommand(command: string): boolean {
    if (this.hostCommands.has(command)) return true
    const owner = this.model.commands.get(command)?.pluginId
    const manifest = owner ? this.findEnabled(owner) : undefined
    return !!manifest && this.hasCode(manifest)
  }

  /**
   * 执行命令：插件进程已注册的直接转发；声明了该命令但尚未激活的插件先激活再执行
   * （声明了命令即视为 onCommand 激活事件）；其余交给宿主侧（渲染进程内置命令）。
   */
  async executeCommand(command: string, args: unknown[] = []): Promise<unknown> {
    if (!this.hostCommands.has(command)) {
      const owner = this.model.commands.get(command)?.pluginId
      const ownerManifest = owner ? this.findEnabled(owner) : undefined
      if (ownerManifest && this.hasCode(ownerManifest)) {
        await this.activatePlugin(ownerManifest.id)
        if (!this.hostCommands.has(command)) {
          throw new RpcError(RpcErrorCode.PluginNotActive, `插件 ${ownerManifest.id} 已激活，但没有注册命令 ${command}`)
        }
      } else {
        return this.options.executeHostCommand(command, args)
      }
    }
    const pluginId = this.hostCommands.get(command)!
    const host = [...this.hosts.values()].find(h => h.plugins.has(pluginId))
    if (!host) throw new RpcError(RpcErrorCode.PluginNotActive, `命令 ${command} 所在的插件进程未运行`)
    return host.rpc.request('commands/execute', { command, args } satisfies ExecuteCommandParams, 0)
  }

  // ───────────── 关闭 ─────────────

  private async stopHost(key: string): Promise<void> {
    const host = this.hosts.get(key)
    if (!host) return
    this.hosts.delete(key)
    try {
      await host.rpc.request('shutdown', undefined, 5000)
    } catch {
      // 插件进程已经不响应，直接结束
    }
    host.rpc.dispose()
    host.connection.kill()
    for (const id of host.plugins) this.activations.delete(id)
    for (const [command, owner] of this.hostCommands) {
      if (host.plugins.has(owner)) this.hostCommands.delete(command)
    }
  }

  async shutdown(): Promise<void> {
    for (const key of [...this.hosts.keys()]) await this.stopHost(key)
    this.activations.clear()
    this.hostCommands.clear()
  }

  private log(message: string): void {
    (this.options.log ?? (m => console.log(`[plugins] ${m}`)))(message)
  }
}
