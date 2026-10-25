// 把 PluginService 接到 Electron：插件宿主进程用 utilityProcess，渲染进程通信用 IPC。
//
// IPC（渲染进程 → 主进程）：
//   plugins:getState          插件列表与已启用清单
//   plugins:executeCommand    执行插件命令（渲染进程本地没有处理函数时转过来）
//   plugins:setEnabled        启用 / 停用插件
//   plugins:reload            重新扫描插件目录并重启插件进程
//   plugins:grantPermissions  用户同意插件申请的权限（授权并启用）
//   plugins:revokePermissions 收回插件的权限
//   plugins:storeList         商店里的插件与主题（与支持库共用索引，kind 为 plugin / theme）
//   plugins:storeInstall      从商店安装插件 / 主题（校验 sha256、发布者签名、权限）
//   plugins:uninstall         卸载商店安装的插件
//   plugins:rendererCommandResult  回报 plugins:executeRendererCommand 的执行结果
// 主进程 → 渲染进程：
//   plugins:changed                  插件状态或贡献点变化，渲染进程应重新获取状态
//   plugins:message                  插件请求显示消息
//   plugins:executeRendererCommand   插件调用了内置命令，请渲染进程执行并回报结果

import { app, BrowserWindow, ipcMain, protocol, safeStorage, utilityProcess } from 'electron'
import { fork, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { delimiter, dirname, extname, join } from 'node:path'
import { BUILTIN_PLUGIN_CANDIDATES } from '../../shared/plugin/builtinPlugins'
import type { PluginHostPlatform } from '../../shared/plugin/manifest'
import { createStdioTransport } from '../../shared/plugin/stdioTransport'
import { RpcError } from '../../shared/plugin/rpc'
import { PluginService, type PluginHostConnection, type PluginHostSpec, type PluginSecretStore } from './pluginService'
import { PluginInstaller, type InstallConsent } from './pluginInstaller'
import { buildPluginUiCsp } from './pluginUiCsp'
import { libraryManager } from '../libraryManager'

const RENDERER_COMMAND_TIMEOUT_MS = 10 * 60 * 1000

// 插件网页 UI（编辑器、视图）经 ycide-plugin://<插件ID>/<路径> 加载（设计稿 §7）。
// 必须在 app ready 之前登记为特权协议；本模块在主进程启动时即被导入。
export const PLUGIN_UI_SCHEME = 'ycide-plugin'
protocol.registerSchemesAsPrivileged([
  { scheme: PLUGIN_UI_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

const UI_MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
}


function registerPluginUiProtocol(service: PluginService): void {
  protocol.handle(PLUGIN_UI_SCHEME, async request => {
    try {
      const url = new URL(request.url)
      const pluginId = url.hostname
      const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      const file = service.resolvePluginFile(pluginId, relativePath)
      if (!file) return new Response('插件文件不存在或插件未启用', { status: 404 })
      const body = await readFile(file)
      return new Response(body, {
        headers: {
          'Content-Type': UI_MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'Content-Security-Policy': buildPluginUiCsp(service.getNetPermissions(pluginId)),
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch {
      return new Response('读取插件文件失败', { status: 500 })
    }
  })
}

let service: PluginService | null = null

export function getPluginService(): PluginService | null {
  return service
}

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** 插件宿主脚本：打包后在 app.asar.unpacked 里（package.json asarUnpack），子进程直接从磁盘读取 */
function pluginHostScript(): string {
  return join(__dirname, 'plugin-host.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

/** 第三方插件进程只拿到最小的环境变量：不继承 IDE 的环境（里面可能有 API Key、NODE_OPTIONS） */
function minimalEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['SystemRoot', 'windir', 'TEMP', 'TMP', 'PATH', 'Path', 'LANG', 'HOME', 'USERPROFILE']) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  return { ...env, ...extra }
}

/** 官方内置插件：共用一个 utilityProcess */
function spawnTrustedHost(): PluginHostConnection {
  const child = utilityProcess.fork(join(__dirname, 'plugin-host.js'), [], {
    serviceName: 'ycide-plugin-host',
    stdio: 'pipe',
  })
  child.stdout?.on('data', chunk => process.stdout.write(`[plugin-host] ${chunk}`))
  child.stderr?.on('data', chunk => process.stderr.write(`[plugin-host] ${chunk}`))
  return {
    transport: {
      send: message => child.postMessage(message),
      onMessage: listener => {
        child.on('message', listener)
        return () => { child.off('message', listener) }
      },
    },
    onExit: listener => { child.on('exit', listener) },
    kill: () => { child.kill() },
  }
}

/**
 * 第三方 Node 插件：每个发布者一个进程，用 Node 权限模型限制（设计稿 §8.2）。
 * utilityProcess 不支持 --permission，所以用 ELECTRON_RUN_AS_NODE 以纯 Node 方式启动 Electron 自身。
 *   - 只能读宿主脚本目录和本进程插件的目录，只能写插件自己的存储目录（fs:any 放开任意读写）；
 *   - 默认不能启动子进程（process:spawn 放开）、不能加载原生模块和 Worker；
 *   - 网络由插件进程内的拦截层按 net:<域名> 放行（pluginNetGuard.ts）。
 */
function spawnSandboxedHost(spec: PluginHostSpec): PluginHostConnection {
  const script = pluginHostScript()
  const execArgv = ['--permission']
  if (spec.permissions.includes('fs:any')) {
    execArgv.push('--allow-fs-read=*', '--allow-fs-write=*')
  } else {
    for (const dir of [dirname(script), ...spec.pluginDirs]) execArgv.push(`--allow-fs-read=${dir}`)
    for (const dir of spec.storageDirs) execArgv.push(`--allow-fs-read=${dir}`, `--allow-fs-write=${dir}`)
  }
  if (spec.permissions.includes('process:spawn')) execArgv.push('--allow-child-process')
  const child = fork(script, [], {
    execPath: process.execPath,
    execArgv,
    env: minimalEnv({
      ELECTRON_RUN_AS_NODE: '1',
      YCIDE_PLUGIN_NET_PERMISSIONS: JSON.stringify(spec.permissions.filter(p => p.startsWith('net:'))),
    }),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  child.stdout?.on('data', chunk => process.stdout.write(`[plugin-host ${spec.key}] ${chunk}`))
  child.stderr?.on('data', chunk => process.stderr.write(`[plugin-host ${spec.key}] ${chunk}`))
  return {
    transport: {
      send: message => { if (child.connected) child.send(message as object) },
      onMessage: listener => {
        child.on('message', listener)
        return () => { child.off('message', listener) }
      },
    },
    onExit: listener => { child.on('exit', code => listener(code)) },
    kill: () => { child.kill() },
  }
}

/** 可执行文件插件：每个插件一个进程，stdin / stdout 上按 Content-Length 分帧收发 JSON-RPC */
function spawnExecutableHost(spec: PluginHostSpec): PluginHostConnection {
  const child = spawn(spec.command!, spec.args ?? [], {
    cwd: spec.cwd,
    env: minimalEnv({ YCIDE_PLUGIN_STORAGE: spec.storageDirs[0] ?? '' }),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const exitListeners: Array<(code: number | null) => void> = []
  let exited = false
  const notifyExit = (code: number | null): void => {
    if (exited) return
    exited = true
    for (const l of exitListeners) l(code)
  }
  child.on('exit', code => notifyExit(code))
  child.on('error', err => {
    process.stderr.write(`[plugin ${spec.key}] 启动失败：${err.message}\n`)
    notifyExit(null)
  })
  child.stderr.on('data', chunk => process.stderr.write(`[plugin ${spec.key}] ${chunk}`))
  child.stdin.on('error', () => undefined)
  const transport = createStdioTransport(child.stdout, child.stdin, err => {
    process.stderr.write(`[plugin ${spec.key}] 协议错误：${err.message}\n`)
  })
  return {
    transport,
    onExit: listener => { exitListeners.push(listener) },
    kill: () => { child.kill() },
  }
}

function spawnPluginHost(spec: PluginHostSpec): PluginHostConnection {
  if (spec.kind === 'executable') return spawnExecutableHost(spec)
  if (spec.kind === 'sandboxed') return spawnSandboxedHost(spec)
  return spawnTrustedHost()
}

/** 插件密钥（secrets:own）：按插件隔离，用系统安全存储加密后存在用户数据目录 */
function createSecretStore(file: string): PluginSecretStore {
  const load = (): Record<string, Record<string, string>> => {
    try {
      return existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) as Record<string, Record<string, string>> : {}
    } catch {
      return {}
    }
  }
  const save = (data: Record<string, Record<string, string>>): void => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
  }
  const encrypt = (value: string): string => (safeStorage.isEncryptionAvailable()
    ? `enc:${safeStorage.encryptString(value).toString('base64')}`
    : `plain:${Buffer.from(value, 'utf-8').toString('base64')}`)
  const decrypt = (stored: string): string | undefined => {
    try {
      if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
      if (stored.startsWith('plain:')) return Buffer.from(stored.slice(6), 'base64').toString('utf-8')
    } catch {
      return undefined
    }
    return undefined
  }
  return {
    get: (pluginId, key) => {
      const stored = load()[pluginId]?.[key]
      return stored === undefined ? undefined : decrypt(stored)
    },
    store: (pluginId, key, value) => {
      const data = load()
      data[pluginId] = { ...(data[pluginId] ?? {}), [key]: encrypt(value) }
      save(data)
    },
    delete: (pluginId, key) => {
      const data = load()
      if (!data[pluginId]) return
      delete data[pluginId][key]
      if (Object.keys(data[pluginId]).length === 0) delete data[pluginId]
      save(data)
    },
  }
}

let rendererRequestSeq = 0
const pendingRendererRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()

function executeInRenderer(command: string, args: unknown[]): Promise<unknown> {
  const target = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
  if (!target) return Promise.reject(new Error('没有可执行命令的窗口'))
  const requestId = ++rendererRequestSeq
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRendererRequests.delete(requestId)
      reject(new Error(`命令 ${command} 执行超时`))
    }, RENDERER_COMMAND_TIMEOUT_MS)
    pendingRendererRequests.set(requestId, { resolve, reject, timer })
    target.webContents.send('plugins:executeRendererCommand', { requestId, command, args })
  })
}

/** 内置插件目录：开发时为仓库根目录的 plugins/，打包后为 <安装目录>/plugins/（与 themes、lib 相同的布局） */
function getBuiltinPluginsDir(): string {
  return app.isPackaged ? join(dirname(process.execPath), 'plugins') : join(app.getAppPath(), 'plugins')
}

/**
 * 插件目录：
 *   - 内置支持库目录 lib/、用户安装的支持库目录（每个支持库目录带 plugin.json，即支持库数据插件，设计稿 §6.6）
 *   - 用户数据目录下的 plugins
 *   - 环境变量 YCIDE_EXTRA_PLUGIN_DIRS 指定的开发目录
 */
function resolveDevPluginDirs(): string[] {
  return (process.env.YCIDE_EXTRA_PLUGIN_DIRS ?? '').split(delimiter).map(s => s.trim()).filter(Boolean)
}

/** 用户安装插件的目录（商店安装的插件、主题解压到这里） */
export function getUserPluginsDir(): string {
  return join(app.getPath('userData'), 'plugins')
}

function resolvePluginDirs(): string[] {
  return [libraryManager.getLibFolder(), libraryManager.getInstalledLibrariesRoot(), getUserPluginsDir(), ...resolveDevPluginDirs()]
}

/**
 * 开发中插件热重载：YCIDE_EXTRA_PLUGIN_DIRS 下的文件变化后（防抖）重新扫描插件并重启插件进程。
 * 返回停止监听的函数。
 */
function watchDevPluginDirs(dirs: string[], onChange: () => void): () => void {
  const watchers: FSWatcher[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    try {
      watchers.push(watch(dir, { recursive: true }, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => { timer = null; onChange() }, 400)
      }))
    } catch (err) {
      console.warn(`[plugins] 无法监听开发插件目录 ${dir}：${(err as Error).message}`)
    }
  }
  return () => {
    if (timer) clearTimeout(timer)
    for (const w of watchers) w.close()
  }
}

/** 创建插件服务并注册 IPC；onDidChange 供主进程刷新 macOS 原生菜单 */
export function initPluginHost(platform: PluginHostPlatform, onDidChange: () => void): PluginService {
  if (service) return service
  const created = new PluginService({
    builtinCandidates: BUILTIN_PLUGIN_CANDIDATES.map(c => ({
      ...c,
      dir: join(getBuiltinPluginsDir(), (c.manifest as { id: string }).id),
    })),
    pluginDirs: resolvePluginDirs(),
    // 只有随安装包发布的内置支持库目录可信（用户安装的支持库、插件、开发目录都不可信）
    trustedDirs: [libraryManager.getLibFolder()],
    devDirs: resolveDevPluginDirs(),
    userPluginsDir: getUserPluginsDir(),
    statePath: join(app.getPath('userData'), 'plugin-state.json'),
    storageRoot: join(app.getPath('userData'), 'plugin-storage'),
    secrets: createSecretStore(join(app.getPath('userData'), 'plugin-secrets.json')),
    platform,
    arch: process.arch === 'ia32' ? 'x86' : process.arch,
    host: 'electron',
    spawnHost: spawnPluginHost,
    executeHostCommand: executeInRenderer,
    showMessage: params => broadcast('plugins:message', params),
    appendOutput: params => broadcast('compiler:output', { type: params.type, text: params.text }),
    onDidChange: () => {
      broadcast('plugins:changed')
      onDidChange()
    },
  })
  service = created
  registerPluginUiProtocol(created)

  ipcMain.handle('plugins:getState', () => created.getState())
  ipcMain.handle('plugins:executeCommand', async (_event, command: unknown, args: unknown) => {
    if (typeof command !== 'string') throw new Error('命令 ID 无效')
    return created.executeCommand(command, Array.isArray(args) ? args : [])
  })
  ipcMain.handle('plugins:setEnabled', async (_event, id: unknown, enabled: unknown) => {
    if (typeof id !== 'string') throw new Error('插件 ID 无效')
    await created.setEnabled(id, enabled === true)
    return created.getState()
  })
  ipcMain.handle('plugins:reload', async () => {
    await created.reload()
    return created.getState()
  })
  ipcMain.handle('plugins:grantPermissions', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('插件 ID 无效')
    await created.grantPermissions(id)
    return created.getState()
  })
  ipcMain.handle('plugins:revokePermissions', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('插件 ID 无效')
    await created.revokePermissions(id)
    return created.getState()
  })

  const installer = new PluginInstaller({
    userPluginsDir: getUserPluginsDir(),
    publishersFile: join(app.getPath('userData'), 'plugin-publishers.json'),
    service: created,
    fetchIndex: url => libraryManager.getRemoteIndex(url),
    download: async url => {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    },
  })
  const checkIndexUrl = (value: unknown): string => {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) throw new Error('商店索引地址无效')
    return value.trim()
  }
  ipcMain.handle('plugins:storeList', async (_event, indexUrl: unknown) => installer.listStore(checkIndexUrl(indexUrl)))
  ipcMain.handle('plugins:storeInstall', async (_event, indexUrl: unknown, id: unknown, consent: unknown) => {
    if (typeof id !== 'string') throw new Error('插件 ID 无效')
    const c = (consent ?? {}) as Partial<InstallConsent>
    return installer.install(checkIndexUrl(indexUrl), id, {
      permissions: Array.isArray(c.permissions) ? c.permissions.filter((p): p is string => typeof p === 'string') : [],
      allowUnsigned: c.allowUnsigned === true,
    })
  })
  ipcMain.handle('plugins:uninstall', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('插件 ID 无效')
    return installer.uninstall(id)
  })

  const devDirs = resolveDevPluginDirs()
  if (devDirs.length > 0 && process.env.YCIDE_PLUGIN_HOT_RELOAD !== '0') {
    const stop = watchDevPluginDirs(devDirs, () => {
      void created.reload().then(() => {
        broadcast('plugins:message', { pluginId: 'ycide.workbench', type: 'info', message: '开发插件有改动，已重新加载' })
      }).catch(err => console.warn('[plugins] 热重载失败', err))
    })
    app.on('before-quit', stop)
  }
  ipcMain.on('plugins:rendererCommandResult', (_event, payload: unknown) => {
    const { requestId, ok, result, error, code } = (payload ?? {}) as { requestId?: number; ok?: boolean; result?: unknown; error?: string; code?: unknown }
    const pending = typeof requestId === 'number' ? pendingRendererRequests.get(requestId) : undefined
    if (!pending) return
    pendingRendererRequests.delete(requestId!)
    clearTimeout(pending.timer)
    if (ok) pending.resolve(result)
    else pending.reject(typeof code === 'number' ? new RpcError(code, error || '命令执行失败') : new Error(error || '命令执行失败'))
  })

  app.on('before-quit', () => { void created.shutdown() })
  return created
}
