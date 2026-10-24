// 把 PluginService 接到 Electron：插件宿主进程用 utilityProcess，渲染进程通信用 IPC。
//
// IPC（渲染进程 → 主进程）：
//   plugins:getState          插件列表与已启用清单
//   plugins:executeCommand    执行插件命令（渲染进程本地没有处理函数时转过来）
//   plugins:setEnabled        启用 / 停用插件
//   plugins:reload            重新扫描插件目录并重启插件进程
//   plugins:rendererCommandResult  回报 plugins:executeRendererCommand 的执行结果
// 主进程 → 渲染进程：
//   plugins:changed                  插件状态或贡献点变化，渲染进程应重新获取状态
//   plugins:message                  插件请求显示消息
//   plugins:executeRendererCommand   插件调用了内置命令，请渲染进程执行并回报结果

import { app, BrowserWindow, ipcMain, protocol, utilityProcess } from 'electron'
import { readFile } from 'node:fs/promises'
import { delimiter, dirname, extname, join } from 'node:path'
import { BUILTIN_PLUGIN_CANDIDATES } from '../../shared/plugin/builtinPlugins'
import type { PluginHostPlatform } from '../../shared/plugin/manifest'
import { PluginService, type PluginHostConnection } from './pluginService'
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

/**
 * 插件网页只能加载自己目录里的资源，不能直接联网（联网能力将来按清单权限单独开放，设计稿 §8）。
 * 页面运行在不带 allow-same-origin 的沙箱 iframe 里，只能经 postMessage 与宿主交换数据。
 */
const PLUGIN_UI_CSP = "default-src 'none'; script-src ycide-plugin: 'unsafe-inline'; style-src ycide-plugin: 'unsafe-inline'; img-src ycide-plugin: data: blob:; font-src ycide-plugin: data:"

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
          'Content-Security-Policy': PLUGIN_UI_CSP,
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

function spawnPluginHost(): PluginHostConnection {
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
function resolvePluginDirs(): string[] {
  const extra = (process.env.YCIDE_EXTRA_PLUGIN_DIRS ?? '').split(delimiter).map(s => s.trim()).filter(Boolean)
  return [libraryManager.getLibFolder(), libraryManager.getInstalledLibrariesRoot(), join(app.getPath('userData'), 'plugins'), ...extra]
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
    statePath: join(app.getPath('userData'), 'plugin-state.json'),
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
  ipcMain.on('plugins:rendererCommandResult', (_event, payload: unknown) => {
    const { requestId, ok, result, error } = (payload ?? {}) as { requestId?: number; ok?: boolean; result?: unknown; error?: string }
    const pending = typeof requestId === 'number' ? pendingRendererRequests.get(requestId) : undefined
    if (!pending) return
    pendingRendererRequests.delete(requestId!)
    clearTimeout(pending.timer)
    if (ok) pending.resolve(result)
    else pending.reject(new Error(error || '命令执行失败'))
  })

  app.on('before-quit', () => { void created.shutdown() })
  return created
}
