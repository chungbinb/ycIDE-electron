// 可执行文件插件的传输层（设计稿 §4.1）：stdin / stdout 上的 JSON-RPC，按 LSP 的方式分帧：
//   Content-Length: <UTF-8 字节数>\r\n
//   \r\n
//   <JSON 正文>
// 其它头（如 Content-Type）忽略。插件的 stderr 不参与协议，宿主当作日志。

import type { RpcTransport } from './rpc'

export interface ByteSink {
  write(chunk: Uint8Array): unknown
}

export interface ByteSource {
  on(event: 'data', listener: (chunk: Uint8Array) => void): unknown
  off(event: 'data', listener: (chunk: Uint8Array) => void): unknown
}

const HEADER_END = Buffer.from('\r\n\r\n')
/** 单条消息上限，防止插件发来畸形长度把宿主内存撑爆 */
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024

export function encodeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf-8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])
}

/** 增量解析分帧数据；格式错误时调用 onError 并丢弃已缓冲的数据 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0)

  constructor(private readonly onMessage: (message: unknown) => void, private readonly onError: (error: Error) => void) {}

  push(chunk: Uint8Array): void {
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk])
    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_END)
      if (headerEnd < 0) {
        if (this.buffer.length > 8192) this.fail('消息头过长或缺少空行')
        return
      }
      const header = this.buffer.subarray(0, headerEnd).toString('ascii')
      const match = /(?:^|\r\n)content-length:\s*(\d+)\s*(?:\r\n|$)/i.exec(header)
      if (!match) return this.fail(`消息头缺少 Content-Length：${header.slice(0, 200)}`)
      const length = Number(match[1])
      if (length > MAX_MESSAGE_BYTES) return this.fail(`消息过大（${length} 字节）`)
      const start = headerEnd + HEADER_END.length
      if (this.buffer.length < start + length) return
      const body = this.buffer.subarray(start, start + length).toString('utf-8')
      this.buffer = this.buffer.subarray(start + length)
      let message: unknown
      try {
        message = JSON.parse(body)
      } catch (err) {
        this.onError(new Error(`消息不是合法 JSON：${(err as Error).message}`))
        continue
      }
      this.onMessage(message)
    }
  }

  private fail(reason: string): void {
    this.buffer = Buffer.alloc(0)
    this.onError(new Error(reason))
  }
}

export function createStdioTransport(input: ByteSource, output: ByteSink, onError: (error: Error) => void = () => undefined): RpcTransport {
  const listeners = new Set<(message: unknown) => void>()
  const decoder = new FrameDecoder(message => { for (const l of listeners) l(message) }, onError)
  const onData = (chunk: Uint8Array): void => decoder.push(chunk)
  input.on('data', onData)
  return {
    send: message => { output.write(encodeFrame(message)) },
    onMessage: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
