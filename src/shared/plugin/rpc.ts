// JSON-RPC 2.0 对等端：宿主与插件进程之间的通信（设计稿 §4）。
// 与传输方式无关：Electron utilityProcess 的 MessagePort、stdio、测试里的内存管道都只需要
// 提供「发送一条消息」和「收到一条消息」两个动作。双方地位对等，都可以发请求、发通知。

export interface RpcTransport {
  send(message: unknown): void
  onMessage(listener: (message: unknown) => void): () => void
}

export interface RpcErrorObject {
  code: number
  message: string
  data?: unknown
}

/** 标准错误码 + 设计稿 §4.3 的自定义错误码 */
export const RpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  PermissionDenied: -33001,
  DocumentVersionStale: -33002,
  PluginNotActive: -33003,
  Cancelled: -33004,
  Timeout: -33005,
} as const

export class RpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message)
    this.name = 'RpcError'
  }
}

type RequestHandler = (params: unknown) => unknown
type NotificationHandler = (params: unknown) => void

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout> | null
}

interface RpcMessage {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: unknown
  result?: unknown
  error?: RpcErrorObject
}

export interface RpcPeerOptions {
  /** 请求超时（毫秒），0 表示不超时；默认 30 秒（设计稿 §4.3） */
  requestTimeoutMs?: number
}

export class RpcPeer {
  private seq = 0
  private readonly pending = new Map<number, PendingRequest>()
  private readonly requestHandlers = new Map<string, RequestHandler>()
  private readonly notificationHandlers = new Map<string, NotificationHandler>()
  private readonly unsubscribe: () => void
  private closed = false
  private readonly requestTimeoutMs: number

  constructor(private readonly transport: RpcTransport, options: RpcPeerOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
    this.unsubscribe = transport.onMessage(message => { void this.handleMessage(message) })
  }

  onRequest(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler)
  }

  onNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler)
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs = this.requestTimeoutMs): Promise<T> {
    if (this.closed) return Promise.reject(new RpcError(RpcErrorCode.InternalError, '连接已关闭'))
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
          this.pending.delete(id)
          reject(new RpcError(RpcErrorCode.Timeout, `请求 ${method} 超时（${timeoutMs}ms）`))
        }, timeoutMs)
        : null
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      this.transport.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return
    this.transport.send({ jsonrpc: '2.0', method, params })
  }

  /** 关闭连接：所有未完成的请求以错误结束 */
  dispose(reason = '连接已关闭'): void {
    if (this.closed) return
    this.closed = true
    this.unsubscribe()
    for (const [id, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(new RpcError(RpcErrorCode.InternalError, reason))
      this.pending.delete(id)
    }
  }

  private async handleMessage(raw: unknown): Promise<void> {
    if (this.closed || typeof raw !== 'object' || raw === null) return
    const msg = raw as RpcMessage

    // 响应
    if (msg.method === undefined && (msg.result !== undefined || msg.error !== undefined || 'result' in msg)) {
      const pending = typeof msg.id === 'number' ? this.pending.get(msg.id) : undefined
      if (!pending) return
      this.pending.delete(msg.id as number)
      if (pending.timer) clearTimeout(pending.timer)
      if (msg.error) pending.reject(new RpcError(msg.error.code, msg.error.message, msg.error.data))
      else pending.resolve(msg.result)
      return
    }
    if (typeof msg.method !== 'string') return

    // 通知
    if (msg.id === undefined || msg.id === null) {
      const handler = this.notificationHandlers.get(msg.method)
      try {
        handler?.(msg.params)
      } catch (err) {
        console.error(`[rpc] 处理通知 ${msg.method} 出错`, err)
      }
      return
    }

    // 请求
    const handler = this.requestHandlers.get(msg.method)
    if (!handler) {
      this.transport.send({ jsonrpc: '2.0', id: msg.id, error: { code: RpcErrorCode.MethodNotFound, message: `未知方法 ${msg.method}` } })
      return
    }
    try {
      const result = await handler(msg.params)
      if (!this.closed) this.transport.send({ jsonrpc: '2.0', id: msg.id, result: result === undefined ? null : result })
    } catch (err) {
      if (this.closed) return
      const error: RpcErrorObject = err instanceof RpcError
        ? { code: err.code, message: err.message, data: err.data }
        : { code: RpcErrorCode.InternalError, message: err instanceof Error ? err.message : String(err) }
      this.transport.send({ jsonrpc: '2.0', id: msg.id, error })
    }
  }
}

/** 一对相连的内存传输（测试与同进程场景使用），消息异步投递以模拟进程边界 */
export function createInMemoryTransportPair(): [RpcTransport, RpcTransport] {
  const listeners: [Set<(m: unknown) => void>, Set<(m: unknown) => void>] = [new Set(), new Set()]
  const make = (self: 0 | 1): RpcTransport => ({
    send(message) {
      const copy = JSON.parse(JSON.stringify(message))
      queueMicrotask(() => listeners[1 - self].forEach(l => l(copy)))
    },
    onMessage(listener) {
      listeners[self].add(listener)
      return () => listeners[self].delete(listener)
    },
  })
  return [make(0), make(1)]
}
