// 第三方插件进程的联网限制（设计稿 §8.2 第二道防线）。
// Electron 自带的 Node 24 权限模型管住了文件读写、子进程、原生模块，但还不能限制网络，
// 所以在加载插件代码之前拦截 TCP / TLS 连接（http、https、fetch 最终都走这里），
// 只放行清单里声明并经用户同意的 net:<域名>。权限模型已禁止 process.binding，插件绕不过这一层去直接开套接字。

import net from 'node:net'
import { isHostAllowed } from '../../shared/plugin/permissions'

function targetHost(args: unknown[]): string | null {
  const first = args[0]
  if (Array.isArray(first)) return targetHost(first)
  if (first && typeof first === 'object') {
    const options = first as { host?: unknown; hostname?: unknown; path?: unknown }
    if (typeof options.path === 'string' && options.host === undefined) return null // 本机命名管道 / Unix 套接字
    const host = options.host ?? options.hostname
    return typeof host === 'string' && host ? host : 'localhost'
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    return typeof args[1] === 'string' && args[1] ? args[1] : 'localhost'
  }
  return null
}

export function installNetGuard(permissions: readonly string[]): void {
  const original = net.Socket.prototype.connect
  net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
    const host = targetHost(args)
    if (host === null) {
      throw Object.assign(new Error('插件不允许连接本机管道'), { code: 'ERR_ACCESS_DENIED' })
    }
    const bare = host.replace(/^\[|\]$/g, '')
    if (!isHostAllowed(bare, permissions)) {
      throw Object.assign(new Error(`插件没有访问 ${bare} 的权限（需要在清单 permissions 里声明 net:${bare}）`), { code: 'ERR_ACCESS_DENIED' })
    }
    return (original as (...a: unknown[]) => net.Socket).apply(this, args)
  } as typeof net.Socket.prototype.connect
}
