// 编译工作线程入口（worker_threads）。
// 把编译的重计算（扫描支持库 / 解析源码 / 生成 C++ / 哈希 / 调 zig）放到独立线程，
// 不再阻塞主进程事件循环，消除编译期间 IDE「停止响应」。
// 这里拿不到 electron 的 app/BrowserWindow，运行环境由主进程通过 workerData 注入，
// 一切输出/副作用通过 postMessage 发回主进程再广播。
import { parentPort, workerData } from 'worker_threads'
import { setRuntimeEnv, type RuntimeEnv } from './runtimeEnv'
import { setCompilerHost, compileProject, type CompileOptions, type CompileResult, type CompileMessage } from './compiler'
import { libraryManager } from './libraryManager'

if (!parentPort) {
  throw new Error('compile-worker 必须在 worker_threads 环境中运行')
}
const port = parentPort

// 启动时注入运行环境（appPath / isPackaged / userDataPath / appVersion）。
if (workerData && workerData.env) {
  setRuntimeEnv(workerData.env as RuntimeEnv)
}

// 编译设置（编译器路径/优化级别）：worker 里没有主进程的设置模块，
// 由主进程在每次派发编译时随 workerData/请求注入，缺省则回落内置行为。
let workerCompilerSettings: { zigPath: string; optimizeLevel: 'O0' | 'O1' | 'O2' | 'Os' } | null =
  (workerData && workerData.compilerSettings) || null

// 编译副作用经消息转发：输出广播、聚焦窗口、进程退出（编译阶段一般只用到输出）。
setCompilerHost({
  readCompilerSettings: () => workerCompilerSettings,
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
  /** 主进程随每次请求下发最新编译设置——用户改了设置立即生效，无需重启 worker */
  compilerSettings?: { zigPath: string; optimizeLevel: 'O0' | 'O1' | 'O2' | 'Os' } | null
}

interface ReloadLibrariesMessage {
  kind: 'reloadLibraries'
}

type WorkerMessage = CompileRequestMessage | ReloadLibrariesMessage

const FAILED_RESULT: CompileResult = {
  success: false, outputFile: '', errorCount: 1, warningCount: 0, elapsedMs: 0,
}

// compileProject 内部有多处 await（会交错），且共享模块级状态（诊断日志/项目类型缓存）
// 并读写同一 temp/main.cpp 与输出 exe。因此编译请求必须串行排队，不得并发。
let compileChain: Promise<void> = Promise.resolve()

function runCompile(message: CompileRequestMessage): void {
  compileChain = compileChain.then(async () => {
    const editorFiles = message.editorFiles ? new Map(Object.entries(message.editorFiles)) : undefined
    if (message.compilerSettings !== undefined) workerCompilerSettings = message.compilerSettings
    try {
      const result = await compileProject(message.options, editorFiles)
      port.postMessage({ kind: 'compileResult', reqId: message.reqId, result })
    } catch (err) {
      port.postMessage({ kind: 'output', msg: { type: 'error', text: `编译线程异常: ${err instanceof Error ? err.message : String(err)}` } })
      port.postMessage({ kind: 'compileResult', reqId: message.reqId, result: FAILED_RESULT })
    }
  })
}

port.on('message', (message: WorkerMessage) => {
  if (!message) return
  // 主进程侧支持库变更：重扫，让本 worker 的库快照与主进程一致（重读 userData 里的加载状态）。
  // 排在编译队列尾部执行，避免与正在进行的编译争用库状态。
  if (message.kind === 'reloadLibraries') {
    compileChain = compileChain.then(() => {
      try { libraryManager.scan() } catch { /* 下次编译仍会自行处理 */ }
    })
    return
  }
  if (message.kind !== 'compile') return
  runCompile(message)
})
