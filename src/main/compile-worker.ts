// 编译工作线程入口（worker_threads）。
// 把编译的重计算（扫描支持库 / 解析源码 / 生成 C++ / 哈希 / 调 zig）放到独立线程，
// 不再阻塞主进程事件循环，消除编译期间 IDE「停止响应」。
// 这里拿不到 electron 的 app/BrowserWindow，运行环境由主进程通过 workerData 注入，
// 一切输出/副作用通过 postMessage 发回主进程再广播。
import { parentPort, workerData } from 'worker_threads'
import { setRuntimeEnv, type RuntimeEnv } from './runtimeEnv'
import { setCompilerHost, compileProject, type CompileOptions, type CompileResult, type CompileMessage } from './compiler'

if (!parentPort) {
  throw new Error('compile-worker 必须在 worker_threads 环境中运行')
}
const port = parentPort

// 启动时注入运行环境（appPath / isPackaged / userDataPath / appVersion）。
if (workerData && workerData.env) {
  setRuntimeEnv(workerData.env as RuntimeEnv)
}

// 编译副作用经消息转发：输出广播、聚焦窗口、进程退出（编译阶段一般只用到输出）。
setCompilerHost({
  emitOutput: (msg: CompileMessage) => port.postMessage({ kind: 'output', msg }),
  requestFocusIdeWindow: () => port.postMessage({ kind: 'focus' }),
  notifyProcessExit: (code: number | null) => port.postMessage({ kind: 'processExit', code }),
  // 编译阶段不会真正运行 exe，这里仅作兜底。
  openPathExternally: async () => '',
})

// 通知主进程：worker 脚本已成功加载并就绪。主进程据此判定是否可用，
// 否则（加载失败/超时）回退到主进程内编译，保证"能编译"永不被破坏。
port.postMessage({ kind: 'ready' })

interface CompileRequestMessage {
  kind: 'compile'
  reqId: number
  options: CompileOptions
  editorFiles?: Record<string, string>
}

const FAILED_RESULT: CompileResult = {
  success: false, outputFile: '', errorCount: 1, warningCount: 0, elapsedMs: 0,
}

port.on('message', (message: CompileRequestMessage) => {
  if (!message || message.kind !== 'compile') return
  const editorFiles = message.editorFiles ? new Map(Object.entries(message.editorFiles)) : undefined
  compileProject(message.options, editorFiles)
    .then((result) => {
      port.postMessage({ kind: 'compileResult', reqId: message.reqId, result })
    })
    .catch((err) => {
      port.postMessage({ kind: 'output', msg: { type: 'error', text: `编译线程异常: ${err instanceof Error ? err.message : String(err)}` } })
      port.postMessage({ kind: 'compileResult', reqId: message.reqId, result: FAILED_RESULT })
    })
})
