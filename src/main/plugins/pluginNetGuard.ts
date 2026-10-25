// 第三方插件进程的联网限制（设计稿 §8.2 第二道防线）。
// Electron 自带的 Node 24 权限模型管住了文件读写、子进程、原生模块，但还不能限制网络，
// 所以在加载插件代码之前拦截所有出网的入口，只放行清单里声明并经用户同意的 net:<域名>：
//   - TCP / TLS 连接（http、https、fetch、WebSocket 最终都走 net.Socket.prototype.connect）；
//   - UDP（dgram 的 send / connect）；
//   - DNS 查询（dns 与 dns/promises 的 lookup、resolve*：域名本身也能把数据带出去）。
// 权限模型已禁止 process.binding / 原生模块，插件绕不过这一层直接开套接字。

import dgram from 'node:dgram'
import dns from 'node:dns'
import net from 'node:net'
import { isHostAllowed } from '../../shared/plugin/permissions'

function denied(host: string): Error {
  return Object.assign(new Error(`插件没有访问 ${host} 的权限（需要在清单 permissions 里声明 net:${host}）`), { code: 'ERR_ACCESS_DENIED' })
}

function bare(host: string): string {
  return host.replace(/^\[|\]$/g, '')
}

function tcpTarget(args: unknown[]): string | null {
  const first = args[0]
  if (Array.isArray(first)) return tcpTarget(first)
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

/** dgram 的 send(msg, [offset, length,] port, [address], [cb]) / connect(port, [address], [cb])：地址是端口之后的字符串参数 */
function udpTarget(args: unknown[], portIndexFrom: number): string | null {
  for (let i = portIndexFrom; i < args.length; i++) {
    if (typeof args[i] === 'number' && typeof args[i + 1] === 'string') return args[i + 1] as string
    if (typeof args[i] === 'number' && (args[i + 1] === undefined || typeof args[i + 1] === 'function')) return 'localhost'
  }
  return null // 已 connect 过的套接字 send 时不带地址，连接时已检查过
}

export function installNetGuard(permissions: readonly string[]): void {
  const check = (host: string): void => {
    const target = bare(host)
    if (!isHostAllowed(target, permissions)) throw denied(target)
  }

  const originalConnect = net.Socket.prototype.connect
  net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
    const host = tcpTarget(args)
    if (host === null) throw Object.assign(new Error('插件不允许连接本机管道'), { code: 'ERR_ACCESS_DENIED' })
    check(host)
    return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args)
  } as typeof net.Socket.prototype.connect

  const originalSend = dgram.Socket.prototype.send
  dgram.Socket.prototype.send = function guardedSend(this: dgram.Socket, ...args: unknown[]) {
    // send(msg, port, address) 或 send(msg, offset, length, port, address)
    const host = udpTarget(args, 1)
    if (host !== null) check(host)
    return (originalSend as (...a: unknown[]) => void).apply(this, args)
  } as typeof dgram.Socket.prototype.send

  const originalUdpConnect = dgram.Socket.prototype.connect
  dgram.Socket.prototype.connect = function guardedUdpConnect(this: dgram.Socket, ...args: unknown[]) {
    check(udpTarget(args, 0) ?? 'localhost')
    return (originalUdpConnect as (...a: unknown[]) => void).apply(this, args)
  } as typeof dgram.Socket.prototype.connect

  // DNS：lookup 也被 TCP 连接内部使用，连接允许的域名时这里同样放行
  const guardHostArg = <T extends (...a: never[]) => unknown>(target: Record<string, unknown>, name: string): void => {
    const original = target[name] as T | undefined
    if (typeof original !== 'function') return
    target[name] = function guardedDns(this: unknown, ...args: unknown[]) {
      // lookup 一个 IP 字面量不产生网络查询（dgram 绑定 0.0.0.0、连接 IP 时内部都会调用），连接与发送时另有检查；
      // reverse / lookupService 对 IP 会发反向解析查询，仍要检查
      if (typeof args[0] === 'string' && !(name === 'lookup' && net.isIP(bare(args[0])) !== 0)) check(args[0])
      return (original as unknown as (...a: unknown[]) => unknown).apply(this, args)
    }
  }
  const dnsNames = ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNs', 'resolveTxt', 'resolveSrv', 'resolvePtr', 'resolveNaptr', 'resolveSoa', 'reverse']
  for (const name of dnsNames) {
    guardHostArg(dns as unknown as Record<string, unknown>, name)
    guardHostArg(dns.promises as unknown as Record<string, unknown>, name)
  }
  // dns.Resolver 实例方法
  for (const name of dnsNames) {
    guardHostArg(dns.Resolver.prototype as unknown as Record<string, unknown>, name)
    guardHostArg(dns.promises.Resolver.prototype as unknown as Record<string, unknown>, name)
  }
}
