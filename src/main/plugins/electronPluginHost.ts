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

import { app, BrowserWindow, ipcMain, utilityProcess } from 'electron'
import { delimiter, dirname, join } from 'node:path'
import { BUILTIN_PLUGIN_CANDIDATES } from '../../shared/plugin/builtinPlugins'
import type { PluginHostPlatform } from '../../shared/plugin/manifest'
import { PluginService, type PluginHostConnection } from './pluginService'

const RENDERER_COMMAND_TIMEOUT_MS = 10 * 60 * 1000

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

/** 插件目录：用户数据目录下的 plugins，加上环境变量 YCIDE_EXTRA_PLUGIN_DIRS 指定的开发目录 */
function resolvePluginDirs(): string[] {
  const extra = (process.env.YCIDE_EXTRA_PLUGIN_DIRS ?? '').split(delimiter).map(s => s.trim()).filter(Boolean)
  return [join(app.getPath('userData'), 'plugins'), ...extra]
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
    statePath: join(app.getPath('userData'), 'plugin-state.json'),
    platform,
    arch: process.arch === 'ia32' ? 'x86' : process.arch,
    host: 'electron',
    spawnHost: spawnPluginHost,
    executeHostCommand: executeInRenderer,
    showMessage: params => broadcast('plugins:message', params),
    onDidChange: () => {
      broadcast('plugins:changed')
      onDidChange()
    },
  })
  service = created

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
