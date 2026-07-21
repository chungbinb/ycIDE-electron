/**
 * 编译器（Zig）缓存预热。
 *
 * 背景：zig 首次运行要现场构建整套 mingw-w64 CRT / compiler-rt 到全局缓存，实测**编译一个空的
 * `int main(){return 0;}` 也要 68 秒**——与项目大小无关。新用户「第一次编译等几分钟」的主因就是它。
 * 缓存热后同样的编译只要 0.5 秒（实测快 137 倍）。
 *
 * 为何不随安装包分发预热好的缓存：zig 的缓存清单把每个条目绑定到文件 **inode**，
 * 复制/解压必然产生新 inode → 缓存失效（实测 `cp` 52.4s、`cp -p` 保留 mtime 仍 53.2s，
 * 与冷编译 68.3s 相差无几）。所以只能在**用户自己机器上**预热一次。
 *
 * 判定方式：**检测与预热是同一个动作**——跑一次空编译并计时。
 *   快（< WARM_THRESHOLD_MS）→ 缓存已热（可能是用户旧版本 IDE 烤热的，zig 全局缓存跨 IDE 目录共享）
 *   慢 → 这一次跑完，预热也就完成了
 * 因此绝不会误判「以为热其实冷」。
 *
 * 标记存 **userData** 而非 IDE 安装目录：用户换新版本 IDE（新目录）时仍能复用判定结果，
 * 且标记里带 zig 路径 + 版本指纹，换编译器会自动重测。
 */
import { execFile } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getRuntimeEnv } from './runtimeEnv'

/** 空编译耗时低于此值即认为缓存已热（热态实测 ~0.5s，冷态 50s+，阈值取中间量级不会误判） */
const WARM_THRESHOLD_MS = 5000
const MARK_FILE = 'compiler-warmup.json'
const MARK_VERSION = 1

export type WarmupPhase = 'idle' | 'checking' | 'warming' | 'ready' | 'failed' | 'no-compiler'

export interface WarmupState {
  phase: WarmupPhase
  /** 面向用户的一句话说明（状态栏/按钮 tooltip 直接用） */
  message: string
  /** 预热已进行的毫秒数（warming 期间用于显示进度感） */
  elapsedMs?: number
}

interface WarmupMark {
  version: number
  zigPath: string
  zigVersion: string
  warmedAt: number
}

let currentState: WarmupState = { phase: 'idle', message: '' }
let inflight: Promise<WarmupState> | null = null
let listeners: Array<(s: WarmupState) => void> = []

export function getWarmupState(): WarmupState {
  return currentState
}

export function onWarmupStateChange(fn: (s: WarmupState) => void): () => void {
  listeners.push(fn)
  return () => { listeners = listeners.filter(l => l !== fn) }
}

function setState(next: WarmupState): void {
  currentState = next
  for (const l of listeners) {
    try { l(next) } catch { /* 监听器异常不影响预热 */ }
  }
}

function markPath(): string {
  return join(getRuntimeEnv().userDataPath, MARK_FILE)
}

function readMark(): WarmupMark | null {
  try {
    const p = markPath()
    if (!existsSync(p)) return null
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as Partial<WarmupMark>
    if (!raw || raw.version !== MARK_VERSION) return null
    if (typeof raw.zigPath !== 'string' || typeof raw.zigVersion !== 'string') return null
    return raw as WarmupMark
  } catch {
    return null
  }
}

function writeMark(mark: WarmupMark): void {
  try {
    writeFileSync(markPath(), JSON.stringify(mark, null, 2), 'utf-8')
  } catch { /* 标记写不进去只是下次多测一次，不影响功能 */ }
}

function runZig(zigPath: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(zigPath, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve({ ok: !err, stdout: String(stdout || '') })
    })
  })
}

async function readZigVersion(zigPath: string): Promise<string> {
  const r = await runZig(zigPath, ['version'], 20000)
  return r.ok ? r.stdout.trim() : ''
}

/**
 * 确保编译器缓存已热。幂等 + 并发安全：同时多次调用共享同一次执行。
 * @param zigPath 已解析出的 zig 可执行文件路径；为空表示尚未配置编译器
 */
export function ensureCompilerWarm(zigPath: string | null): Promise<WarmupState> {
  if (!zigPath) {
    const s: WarmupState = { phase: 'no-compiler', message: '未配置编译器，请在设置中指定 Zig 编译器路径' }
    setState(s)
    return Promise.resolve(s)
  }
  if (currentState.phase === 'ready') return Promise.resolve(currentState)
  if (inflight) return inflight

  inflight = (async (): Promise<WarmupState> => {
    try {
      setState({ phase: 'checking', message: '正在检查编译环境…' })
      const zigVersion = await readZigVersion(zigPath)
      if (!zigVersion) {
        const s: WarmupState = { phase: 'failed', message: '编译器不可用：无法执行 zig version，请检查设置中的编译器路径' }
        setState(s)
        return s
      }

      // 标记命中（同一 zig 路径 + 版本）→ 直接放行，省掉每次启动的空编译
      const mark = readMark()
      if (mark && mark.zigPath === zigPath && mark.zigVersion === zigVersion) {
        const s: WarmupState = { phase: 'ready', message: '编译环境就绪' }
        setState(s)
        return s
      }

      // 无标记/换了编译器：跑一次空编译——快则说明缓存本就是热的（可能旧版本 IDE 烤过），
      // 慢则这一次同时完成了预热。二者都以 ready 收尾。
      const stage = join(tmpdir(), `ycide-warmup-${Date.now()}`)
      mkdirSync(stage, { recursive: true })
      const srcPath = join(stage, 'warmup.cpp')
      const outPath = join(stage, 'warmup.exe')
      writeFileSync(srcPath, 'int main() { return 0; }\n', 'utf-8')

      setState({ phase: 'warming', message: '首次使用需准备编译环境（约 1 分钟，仅此一次）…', elapsedMs: 0 })
      const tick = setInterval(() => {
        if (currentState.phase !== 'warming') return
        setState({ ...currentState, elapsedMs: (currentState.elapsedMs || 0) + 1000 })
      }, 1000)

      const started = Date.now()
      const r = await runZig(zigPath, ['c++', '-o', outPath, srcPath], 15 * 60 * 1000)
      const cost = Date.now() - started
      clearInterval(tick)
      try { rmSync(stage, { recursive: true, force: true }) } catch { /* 临时目录清理失败无害 */ }

      if (!r.ok) {
        const s: WarmupState = { phase: 'failed', message: '编译环境准备失败，请检查编译器路径是否正确' }
        setState(s)
        return s
      }

      writeMark({ version: MARK_VERSION, zigPath, zigVersion, warmedAt: Date.now() })
      const s: WarmupState = {
        phase: 'ready',
        message: cost < WARM_THRESHOLD_MS ? '编译环境就绪' : '编译环境已准备完成',
      }
      setState(s)
      return s
    } finally {
      inflight = null
    }
  })()

  return inflight
}

/** 设置里换了编译器路径后调用：清空就绪态，下次编译前会重新检测/预热 */
export function invalidateWarmup(): void {
  if (currentState.phase !== 'idle') setState({ phase: 'idle', message: '' })
}
