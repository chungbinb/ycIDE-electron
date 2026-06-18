// 主进程侧的编译工作线程客户端。
// 负责：惰性创建/复用编译 worker、把编译请求转发过去、把 worker 回传的编译输出广播到界面、
// 关联请求/结果。worker 一旦加载失败/超时/出错，自动回退到主进程内编译，
// 保证"能编译"永不被破坏（尤其打包后 worker 从 asar 加载存在不确定性）。
import { Worker } from 'worker_threads'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { getRuntimeEnv } from './runtimeEnv'
import type { CompileOptions, CompileResult, CompileMessage } from './compiler'

let workerReadyPromise: Promise<Worker | null> | null = null
let reqSeq = 0
const pending = new Map<number, (result: CompileResult) => void>()

const READY_TIMEOUT_MS = 8000

function broadcastOutput(msg: CompileMessage): void {
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send('compiler:output', msg))
}

function failAllPending(): void {
  for (const [id, resolve] of pending) {
    resolve({ success: false, outputFile: '', errorCount: 1, warningCount: 0, elapsedMs: 0 })
    pending.delete(id)
  }
}

function handleWorkerMessage(m: { kind?: string; msg?: CompileMessage; reqId?: number; result?: CompileResult }): void {
  if (!m || !m.kind) return
  if (m.kind === 'output' && m.msg) {
    broadcastOutput(m.msg)
  } else if (m.kind === 'compileResult' && typeof m.reqId === 'number' && m.result) {
    const resolve = pending.get(m.reqId)
    if (resolve) {
      pending.delete(m.reqId)
      resolve(m.result)
    }
  }
  // compile 阶段不会产生 focus/processExit；运行/调试仍在主进程处理。
}

// 创建 worker 并等待其 'ready' 握手。失败/超时返回 null（调用方回退主进程编译）。
function getReadyWorker(): Promise<Worker | null> {
  if (workerReadyPromise) return workerReadyPromise

  workerReadyPromise = new Promise<Worker | null>((resolve) => {
    let settled = false
    const settleOnce = (value: Worker | null): void => {
      if (settled) return
      settled = true
      resolve(value)
    }

    let created: Worker
    try {
      created = new Worker(join(__dirname, 'compile-worker.js'), { workerData: { env: getRuntimeEnv() } })
    } catch (e) {
      broadcastOutput({ type: 'warning', text: `编译线程创建失败，已回退主进程编译: ${e instanceof Error ? e.message : String(e)}` })
      workerReadyPromise = null
      settleOnce(null)
      return
    }

    const timer = setTimeout(() => {
      if (!settled) {
        broadcastOutput({ type: 'warning', text: '编译线程启动超时，已回退主进程编译。' })
        workerReadyPromise = null
        try { void created.terminate() } catch { /* ignore */ }
        settleOnce(null)
      }
    }, READY_TIMEOUT_MS)

    created.on('message', (m: { kind?: string; msg?: CompileMessage; reqId?: number; result?: CompileResult }) => {
      if (m && m.kind === 'ready') {
        clearTimeout(timer)
        settleOnce(created)
        return
      }
      handleWorkerMessage(m)
    })

    created.on('error', (err) => {
      clearTimeout(timer)
      broadcastOutput({ type: 'error', text: `编译线程错误: ${err.message}` })
      failAllPending()
      workerReadyPromise = null
      settleOnce(null)
    })

    created.on('exit', () => {
      clearTimeout(timer)
      failAllPending()
      workerReadyPromise = null
      settleOnce(null)
    })
  })

  return workerReadyPromise
}

async function compileInMain(options: CompileOptions, editorFiles?: Record<string, string>): Promise<CompileResult> {
  const { compileProject } = await import('./compiler')
  const ef = editorFiles ? new Map(Object.entries(editorFiles)) : undefined
  return compileProject(options, ef)
}

// 经工作线程编译；worker 不可用时回退主进程编译。
export async function compileViaWorker(
  options: CompileOptions,
  editorFiles?: Record<string, string>,
): Promise<CompileResult> {
  const worker = await getReadyWorker()
  if (!worker) {
    return compileInMain(options, editorFiles)
  }

  const reqId = ++reqSeq
  return new Promise<CompileResult>((resolve) => {
    pending.set(reqId, resolve)
    worker.postMessage({ kind: 'compile', reqId, options, editorFiles })
  })
}
