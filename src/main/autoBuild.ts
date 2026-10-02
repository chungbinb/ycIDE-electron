// AutoBuild —— ycIDE 的「命令行自动编译 / 批量 CI」能力（独立模块，零侵入）。
//
// 目标：让 ycIDE 能当作 CLI 程序启动，接收一个**目录**参数；该目录可能
//   ① 本身就是一个项目（含 .epp）
//   ② 是若干项目的父目录（一层或多层）
//   ③ 是「总项目目录」里嵌套了多个子项目
// 处理方式：递归扫描出所有 `.epp`（项目主文件），组成待编译清单，然后**依次**对每个项目
// 执行「编译（+可选运行）」，实时回显编译期错误与程序运行期输出，最后给出汇总。
// 于是一个 .bat 就能对整个总目录做一轮 CI。
//
// 设计约束（刻意为之）：
//   1. 本文件**不 import electron**，因此既能被 Electron 主进程调用，也能被独立 Node CLI 直接跑。
//   2. 编译内核完全复用 src/main/compiler.ts 的 compileProject —— 不复制、不重写任何编译逻辑，
//      编译器/支持库/转译器全部沿用 IDE 的那一套，行为与 IDE 内编译一致。
//   3. 项目里只多出一个「入口 + 最小钩子」，不往既有模块里塞 CLI 分支。
//
// 用法：
//   ycide-cli build <目录> [--run] [--list] [--depth 8] [--fail-fast]
//                          [--debug] [--arch x64] [--run-timeout 10000]
//                          [--encoding utf8] [--json] [--log <文件>] [--user-data <目录>]
//   ycide-cli autobuild <目录> --run              # 等价写法
//   ycide --autobuild <目录> --run                # Electron 主进程内的写法（见 index.ts 钩子）
//
// 退出码：0 全部成功；1 有任一项目编译/运行失败；2 参数用法错误或一个项目都没找到。
import { spawn, type ChildProcess } from 'child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, type Dirent } from 'fs'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import { homedir, tmpdir } from 'os'
import iconv from 'iconv-lite'
import { setRuntimeEnv } from './runtimeEnv'
import type { CompileMessage, CompileResult } from './compiler'

/** 扫描到的单个项目（一个含 .epp 的目录） */
export interface AutoBuildProject {
  /** 项目目录（.epp 所在目录） */
  dir: string
  /** 项目主文件绝对路径 */
  eppPath: string
  /** 相对扫描根的展示名，便于在批量日志里区分 */
  label: string
}

/** 单个项目的执行结果 */
export interface AutoBuildProjectResult {
  project: AutoBuildProject
  success: boolean
  outputFile: string
  errorCount: number
  warningCount: number
  elapsedMs: number
  /** 运行产物时的退出码；未运行或编译失败为 null；超时为 124 */
  runExitCode: number | null
  /** 编译成功但找不到产物等「编译后」失败 */
  note?: string
}

/** 自动编译请求（由命令行参数解析得到） */
export interface AutoBuildRequest {
  /** 待处理目录：项目本身，或包含若干项目的父目录/总目录 */
  projectDir: string
  /** 编译成功后是否自动运行产物 */
  run: boolean
  /** 是否带调试运行时（对应 IDE 的调试编译） */
  debug: boolean
  /** 目标架构覆盖（x86 / x64 / arm64）；留空则按 .epp */
  arch?: string
  /** 运行超时（毫秒）。0 = 不超时（控制台程序默认）；GUI 程序未显式指定时默认 15000 */
  runTimeoutMs?: number
  /** 运行产物时按该编码解码子进程输出，默认 utf8（IDE 生成的程序会 SetConsoleOutputCP(65001)） */
  encoding: string
  /** 以 JSON 形式输出最终摘要（便于脚本消费） */
  json: boolean
  /** 额外把完整输出落盘到指定文件 */
  logFile?: string
  /** 覆盖用户数据目录（library-state.json / 已安装支持库所在处） */
  userDataPath?: string
  /** 递归扫描项目的最大深度；0 = 只看传入目录本身。默认 8 */
  maxDepth?: number
  /** 只列出扫描到的项目，不编译 */
  listOnly?: boolean
  /** 遇到第一个失败就停止（默认 false：全部跑完再汇总） */
  failFast?: boolean
  /**
   * 看门狗总时限（分钟）。到点后不管卡在哪，都会杀掉残留产物并强制退出。
   * 0 = 关闭。默认 10 分钟——防止「被调试的窗口程序停在消息循环不退出」把整条流程挂死。
   */
  watchdogMinutes?: number
}

/** AutoBuild 运行所需的宿主环境（Electron 主进程 / Node CLI 各自注入） */
export interface AutoBuildOptions {
  /** IDE 根目录：lib/ 与 compiler/ 所在处（开发态=仓库根，打包态=exe 同级目录） */
  appPath: string
  /** 是否已打包（影响 lib/compiler 查找目录） */
  isPackaged?: boolean
  /** 用户数据目录；缺省按各平台 Electron userData 约定推导 */
  userDataPath?: string
  /** 应用版本号（仅用于支持库版本校验等，缺省 '0.0.0-cli'） */
  appVersion?: string
  /** 输出打印器（整行），缺省写 process.stdout */
  print?: (line: string) => void
  /** 原样输出器（运行产物时的裸输出，不额外补换行），缺省写 process.stdout */
  writeRaw?: (text: string) => void
  /** 强制退出实现；缺省 process.exit。抽成注入点便于单测看门狗而不真的杀掉测试进程。 */
  exitProcess?: (code: number) => void
}

export interface AutoBuildParseResult {
  /** 命中自动编译命令时的请求；未命中为 null（调用方应继续走正常 GUI 启动） */
  request: AutoBuildRequest | null
  /** 命中命令但参数非法时的错误描述 */
  error: string | null
  /** 是否请求打印帮助 */
  help: boolean
}

const CLI_COMMAND_TOKENS = new Set(['autobuild', 'auto-build', 'build'])
const CLI_COMMAND_FLAGS = new Set(['--autobuild', '--auto-build', '--build', '--ycide-build'])
/** 只认这几个显式开关才在 Electron 主进程里进入 CLI 模式，避免误吞 Electron 自身的启动参数 */
const ELECTRON_TRIGGER_FLAGS = new Set(['--autobuild', '--auto-build', '--ycide-build'])

const ACTION_TOKENS = new Set(['compile', 'build', 'run', 'debug'])

/** 扫描时跳过的目录名：都是构建产物或依赖，不可能存放项目主文件 */
const SCAN_SKIP_DIRS = new Set([
  'node_modules', 'output', 'temp', 'dist', 'build', 'out',
  '__pycache__', 'coverage', 'test-results',
])

const DEFAULT_MAX_DEPTH = 8

/** 看门狗总时限（分钟）。0 = 关闭。默认 10 分钟。 */
const DEFAULT_WATCHDOG_MINUTES = 10

const EXIT_OK = 0
const EXIT_FAIL = 1
const EXIT_USAGE = 2
/** 看门狗触发时的退出码：与「超时」语义一致，便于 CI 识别 */
const EXIT_WATCHDOG = 124

/** 把毫秒格式化成人看的分钟文案：整分钟不带小数，否则保留两位 */
function formatMinutes(ms: number): string {
  const minutes = ms / 60_000
  return Number.isInteger(minutes) ? `${minutes} 分钟` : `${minutes.toFixed(2)} 分钟`
}

/**
 * AutoBuild 看门狗：到点就回调，用于「不管卡在哪都强制收尾」。
 *
 * 存在的理由：批量编译并运行一堆窗口程序时，只要有一个被调试程序停在消息循环里不退出，
 * 整条流程就会一直等它，永远跑不完。看门狗保证到点必然结束。
 *
 * 单独抽出来是为了能脱离真实编译做单测（毫秒级）。
 */
export class AutoBuildWatchdog {
  private timer: NodeJS.Timeout | null = null
  private fired = false

  constructor(
    private readonly totalMs: number,
    private readonly onFire: () => void,
  ) {}

  /** totalMs <= 0 表示关闭 */
  get enabled(): boolean {
    return this.totalMs > 0
  }

  /** 启动计时；重复调用只排一个定时器 */
  start(): void {
    if (!this.enabled || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.fired) return
      this.fired = true
      this.onFire()
    }, this.totalMs)
  }

  /** 正常跑完时务必调用，否则定时器会一直吊着进程 */
  stop(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }
}

/**
 * 默认用户数据目录：对齐 Electron 的 app.getPath('userData')（app 名为 ycIDE）。
 * 这样 CLI 编译能读到 IDE 里「已加载的支持库」状态，结果与 IDE 内编译一致。
 */
export function defaultUserDataPath(appName = 'ycIDE'): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    return join(appData, appName)
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', appName)
  }
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(configHome, appName)
}

/**
 * 递归扫描目录，找出所有 `.epp`（项目主文件），每个 .epp 视为一个项目。
 *
 * 规则：
 *   - 先收当前目录的 .epp（一个项目正常只有一个），再下钻子目录；
 *   - 跳过 node_modules / output / temp / dist 等构建产物目录，以及所有以 `.` 开头的隐藏目录；
 *   - 顺序稳定（目录名与文件名都排序），保证批量结果可复现；
 *   - `maxDepth = 0` 表示只看传入目录本身。
 */
export function scanProjects(rootDir: string, maxDepth = DEFAULT_MAX_DEPTH): AutoBuildProject[] {
  const found: AutoBuildProject[] = []

  const walk = (dir: string, depth: number): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return // 无权限或已被删除的目录直接跳过，不中断整轮扫描
    }

    const eppNames = entries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.epp'))
      .map(entry => entry.name)
      .sort()
    for (const eppName of eppNames) {
      found.push({
        dir,
        eppPath: join(dir, eppName),
        label: relative(rootDir, dir) || '.',
      })
    }

    if (depth >= maxDepth) return

    const subDirs = entries
      .filter(entry => entry.isDirectory()
        && !entry.name.startsWith('.')
        && !SCAN_SKIP_DIRS.has(entry.name.toLowerCase()))
      .map(entry => entry.name)
      .sort()
    for (const name of subDirs) walk(join(dir, name), depth + 1)
  }

  walk(rootDir, 0)
  return found
}

/** 读取指定 .epp 里的 OutputType（Console / WindowsApp / DynamicLibrary），失败返回空串 */
function readProjectOutputType(eppPath: string): string {
  try {
    const text = readFileSync(eppPath, 'utf-8')
    const matched = text.match(/^\s*OutputType\s*=\s*(.+?)\s*$/m)
    return matched ? matched[1].trim() : ''
  } catch {
    return ''
  }
}

/**
 * AutoBuild：把「命令行 → 扫描项目 → 逐个编译（+可选运行）→ 汇总」封装成一个类。
 * 使用方式：
 *   const code = await AutoBuild.main(process.argv.slice(2), { appPath })
 * 或自行构造：
 *   const autoBuild = new AutoBuild(request, options); const code = await autoBuild.execute()
 */
export class AutoBuild {
  private readonly request: AutoBuildRequest
  private readonly options: AutoBuildOptions
  private readonly print: (line: string) => void
  private readonly writeRaw: (text: string) => void
  private readonly logFile: string | null
  private readonly messages: CompileMessage[] = []
  /** 批量模式下当前项目的标签，用于给每行输出加前缀 */
  private currentLabel: string | null = null
  /** 看门狗：到点强制收尾（见 AutoBuildWatchdog） */
  private readonly watchdog: AutoBuildWatchdog
  /** 看门狗时限（分钟），仅用于文案 */
  private readonly watchdogMinutes: number
  /** 强制退出实现：CLI 下是 process.exit，Electron 下由外部注入 app.exit */
  private readonly exitProcess: (code: number) => void
  /** 当前正在运行的产品子进程；看门狗触发时先杀它，避免留下孤儿窗口 */
  private activeChild: ChildProcess | null = null
  /** 本轮开始时间戳，用于看门狗触发时报「已运行多久」 */
  private startedAtMs = 0

  constructor(request: AutoBuildRequest, options: AutoBuildOptions) {
    this.request = request
    this.options = options
    this.print = options.print ?? ((line: string) => { process.stdout.write(line + '\n') })
    this.writeRaw = options.writeRaw ?? ((text: string) => { process.stdout.write(text) })
    this.logFile = request.logFile ? resolve(request.logFile) : null
    this.exitProcess = options.exitProcess ?? ((code: number) => { process.exit(code) })
    this.watchdogMinutes = request.watchdogMinutes ?? DEFAULT_WATCHDOG_MINUTES
    this.watchdog = new AutoBuildWatchdog(this.watchdogMinutes * 60_000, () => this.onWatchdogFire())
  }

  // ────────────────────────────── 参数解析 ──────────────────────────────

  /** 是否为「自动编译命令」。独立 CLI 用：`build` / `autobuild` / `--build` 均可 */
  static isInvocation(argv: string[]): boolean {
    return AutoBuild.parse(argv).request !== null
  }

  /**
   * Electron 主进程专用检测：只认 `--autobuild` / `--auto-build` / `--ycide-build` 显式开关，
   * 避免把 Electron / 系统的启动参数（如 `--build` 之类的未知开关）误判成 CLI 调用。
   */
  static detectFromElectronArgv(argv: string[]): AutoBuildParseResult | null {
    const hit = argv.some(token => ELECTRON_TRIGGER_FLAGS.has(token))
    return hit ? AutoBuild.parse(argv) : null
  }

  /**
   * 解析命令行。命令形式：
   *   <命令> <目录> [动作] [开关...]
   * 其中 <命令> ∈ { build, autobuild, auto-build, --build, --autobuild, --auto-build, --ycide-build }
   * 动作可选 compile / run / debug，也等价于 --run / --debug。
   */
  static parse(argv: string[]): AutoBuildParseResult {
    const tokens = argv.filter(token => typeof token === 'string' && token.length > 0)

    if (tokens.some(token => token === '-h' || token === '--help' || token === 'help')) {
      return { request: null, error: null, help: true }
    }

    const commandIndex = tokens.findIndex(token => CLI_COMMAND_TOKENS.has(token) || CLI_COMMAND_FLAGS.has(token))
    if (commandIndex < 0) {
      return { request: null, error: null, help: false }
    }

    const rest = tokens.slice(commandIndex + 1)
    let run = false
    let debug = false
    let json = false
    let listOnly = false
    let failFast = false
    let watchdogMinutes: number | undefined
    let arch: string | undefined
    let runTimeoutMs: number | undefined
    let maxDepth: number | undefined
    let encoding = 'utf8'
    let logFile: string | undefined
    let userDataPath: string | undefined
    let explicitProject: string | undefined
    const positionals: string[] = []
    const unknownFlags: string[] = []

    for (let i = 0; i < rest.length; i++) {
      const token = rest[i]
      switch (token) {
        case '--run':
        case '-r':
          run = true
          continue
        case '--debug':
          debug = true
          continue
        case '--json':
          json = true
          continue
        case '--list':
        case '--dry-run':
          listOnly = true
          continue
        case '--fail-fast':
          failFast = true
          continue
        case '--watchdog': {
          const value = rest[++i]
          const parsed = Number(value)
          if (value === undefined || !Number.isFinite(parsed) || parsed < 0) {
            return { request: null, error: '参数 --watchdog 需要一个非负的分钟数（0 = 关闭看门狗）', help: false }
          }
          watchdogMinutes = parsed
          continue
        }
        case '--arch': {
          const value = rest[++i]
          if (!value || value.startsWith('-')) return { request: null, error: '参数 --arch 缺少取值（x86 / x64 / arm64）', help: false }
          arch = value
          continue
        }
        case '--depth': {
          const value = rest[++i]
          const parsed = Number(value)
          if (!value || !Number.isFinite(parsed) || parsed < 0) return { request: null, error: '参数 --depth 需要一个非负整数', help: false }
          maxDepth = Math.floor(parsed)
          continue
        }
        case '--run-timeout': {
          const value = rest[++i]
          const parsed = Number(value)
          if (!value || !Number.isFinite(parsed) || parsed < 0) return { request: null, error: '参数 --run-timeout 需要一个非负毫秒数', help: false }
          runTimeoutMs = Math.floor(parsed)
          continue
        }
        case '--encoding': {
          const value = rest[++i]
          if (!value || value.startsWith('-')) return { request: null, error: '参数 --encoding 缺少取值（utf8 / gbk / gb18030 ...）', help: false }
          encoding = value
          continue
        }
        case '--log': {
          const value = rest[++i]
          if (!value || value.startsWith('-')) return { request: null, error: '参数 --log 缺少文件路径', help: false }
          logFile = value
          continue
        }
        case '--user-data': {
          const value = rest[++i]
          if (!value || value.startsWith('-')) return { request: null, error: '参数 --user-data 缺少目录路径', help: false }
          userDataPath = value
          continue
        }
        case '--project':
        case '-p': {
          const value = rest[++i]
          if (!value || value.startsWith('-')) return { request: null, error: '参数 --project 缺少目录路径', help: false }
          explicitProject = value
          continue
        }
        case '--app-path': {
          // 仅供内部/高级用法：覆盖 IDE 根目录。此处只消费取值，不参与请求。
          i++
          continue
        }
        default:
          break
      }

      if (token.startsWith('-')) {
        unknownFlags.push(token)
        continue
      }
      // 动作词（compile/run/debug）优先于目录路径
      if (ACTION_TOKENS.has(token) && positionals.length === 0 && !explicitProject) {
        if (token === 'run') run = true
        if (token === 'debug') { debug = true; run = true }
        continue
      }
      positionals.push(token)
    }

    if (unknownFlags.length > 0) {
      return { request: null, error: `未知参数: ${unknownFlags.join(' ')}`, help: false }
    }

    const projectDir = explicitProject || positionals[0]
    if (!projectDir) {
      return { request: null, error: '缺少目录路径。用法: ycide-cli build <目录> [--run]', help: false }
    }
    if (positionals.length > 1) {
      return { request: null, error: `只能指定一个目录，收到: ${positionals.join(' ')}`, help: false }
    }

    return {
      request: {
        projectDir: isAbsolute(projectDir) ? projectDir : resolve(projectDir),
        run,
        debug,
        arch,
        runTimeoutMs,
        maxDepth,
        listOnly,
        failFast,
        watchdogMinutes,
        encoding,
        json,
        logFile,
        userDataPath,
      },
      error: null,
      help: false,
    }
  }

  static helpText(): string {
    return [
      'ycIDE 自动编译（AutoBuild）— 支持单项目 / 批量目录',
      '',
      '用法:',
      '  ycide-cli build <目录> [选项]',
      '  ycide-cli autobuild <目录> --run',
      '  ycide --autobuild <目录> [选项]              （打包后的 IDE 本体）',
      '',
      '<目录> 可以是：项目目录本身，也可以是包含若干项目（含嵌套）的总目录。',
      '程序会递归扫描所有 .epp（项目主文件），组成清单后依次编译（可选运行）。',
      '',
      '选项:',
      '  --run, -r                编译成功后自动运行产物并回显输出',
      '  --list, --dry-run        只列出扫描到的项目，不编译',
      '  --depth <n>              递归扫描深度，0=只看该目录本身（默认 8）',
      '  --fail-fast              任一项目失败即停止（默认全部跑完再汇总）',
      '  --watchdog <分钟>        看门狗时限，到点强制结束自身（默认 10；0=关闭）',
      '                           防止被调试的窗口程序卡在消息循环里把整条流程挂死',
      '  --debug                  带调试运行时编译（等价 IDE 的调试编译）',
      '  --arch <x86|x64|arm64>   覆盖目标架构（默认按 .epp）',
      '  --run-timeout <毫秒>     运行超时；0=不超时（默认控制台程序不超时，GUI 程序 15000）',
      '  --encoding <名称>        运行输出编码，默认 utf8（可选 gbk / gb18030 / big5 ...）',
      '  --json                   以 JSON 输出最终摘要',
      '  --log <文件>             额外把完整输出写入该文件',
      '  --user-data <目录>       覆盖用户数据目录（支持库加载状态所在处）',
      '  -h, --help               显示本帮助',
      '',
      '退出码: 0 全部成功 / 1 有失败 / 2 参数用法错误或未找到项目 / 124 看门狗超时强制退出',
    ].join('\n')
  }

  /** 便捷入口：解析 + 执行，直接返回进程退出码。 */
  static async main(argv: string[], options: AutoBuildOptions): Promise<number> {
    const parsed = AutoBuild.parse(argv)
    const print = options.print ?? ((line: string) => { process.stdout.write(line + '\n') })

    if (parsed.help) {
      print(AutoBuild.helpText())
      return EXIT_OK
    }
    if (parsed.error) {
      print(`[autobuild] 参数错误: ${parsed.error}`)
      print('')
      print(AutoBuild.helpText())
      return EXIT_USAGE
    }
    if (!parsed.request) {
      print('[autobuild] 未识别到自动编译命令。')
      print('')
      print(AutoBuild.helpText())
      return EXIT_USAGE
    }

    return new AutoBuild(parsed.request, options).execute()
  }

  // ────────────────────────────── 执行 ──────────────────────────────

  /** 执行一轮完整的「扫描 → 逐个编译（+可选运行）→ 汇总」，返回进程退出码。 */
  async execute(): Promise<number> {
    try {
      return await this.run()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emit({ type: 'error', text: `[autobuild] 未捕获异常: ${message}` })
      return EXIT_FAIL
    } finally {
      // 正常/异常结束都要撤掉看门狗，否则定时器会一直吊着进程不退出。
      this.watchdog.stop()
      this.flushLogSummary()
    }
  }

  private async run(): Promise<number> {
    const rootDir = this.request.projectDir
    const maxDepth = this.request.maxDepth ?? DEFAULT_MAX_DEPTH

    this.printBanner()

    // 看门狗：CLI 批量模式下「不管卡在哪，到点必收尾」。
    // 场景：批量编译并运行一堆窗口程序，只要有一个被调试程序停在消息循环里不退出，
    // 整条流程就会一直等它。这里在开跑时就亮明规则并起表。
    this.startedAtMs = Date.now()
    if (this.watchdog.enabled) {
      this.print(`[autobuild] ⚠ 当前处于 autobuild 模式，程序将在 ${formatMinutes(this.watchdogMinutes * 60_000)}后强制退出，防止卡住！`)
      this.print('[autobuild] ⚠ 看门狗到点将打印结束原因、结束残留子进程并强制退出自身（退出码 124）。')
      this.watchdog.start()
    } else {
      this.print('[autobuild] 看门狗已关闭（--watchdog 0）：若被调试程序不退出，流程可能一直等待。')
    }
    this.print('')

    // 1) 校验传入目录
    if (!existsSync(rootDir)) {
      this.emit({ type: 'error', text: `目录不存在: ${rootDir}` })
      return EXIT_USAGE
    }
    let isDir = false
    try {
      isDir = statSync(rootDir).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) {
      this.emit({ type: 'error', text: `路径不是目录: ${rootDir}` })
      return EXIT_USAGE
    }

    // 2) 扫描出待编译清单
    const projects = scanProjects(rootDir, maxDepth)
    if (projects.length === 0) {
      this.emit({
        type: 'error',
        text: `目录中（含 ${maxDepth} 层子目录）找不到任何 .epp 项目文件: ${rootDir}`,
      })
      return EXIT_USAGE
    }

    const multi = projects.length > 1
    this.print(`扫描根目录: ${rootDir}`)
    this.print(`扫描深度  : ${maxDepth}`)
    this.print(`发现项目  : ${projects.length} 个`)
    for (let i = 0; i < projects.length; i++) {
      this.print(`  ${String(i + 1).padStart(2)}. ${projects[i].label}`)
    }
    this.print('')

    // 只列清单：到此为止
    if (this.request.listOnly) {
      this.print('（--list：仅列出，未执行编译）')
      return EXIT_OK
    }

    // 3) 注入运行环境：必须在任何 libraryManager / compiler 调用之前
    const userDataPath = this.request.userDataPath || this.options.userDataPath || defaultUserDataPath()
    setRuntimeEnv({
      appPath: this.options.appPath,
      isPackaged: !!this.options.isPackaged,
      userDataPath,
      appVersion: this.options.appVersion || '0.0.0-cli',
    })
    this.print(`IDE 根目录: ${this.options.appPath}`)
    this.print(`用户数据  : ${userDataPath}`)
    this.print(`构建模式  : ${this.request.run ? '编译并运行' : '仅编译'}${this.request.debug ? '（调试运行时）' : ''}`)
    this.print('')

    // 4) 注入编译宿主：编译输出打到终端（并同步落日志）
    const { setCompilerHost, compileProject } = await import('./compiler')
    setCompilerHost({
      readCompilerSettings: () => ({ zigPath: '', optimizeLevel: 'O2' }),
      emitOutput: (msg: CompileMessage) => this.emit(msg),
      requestFocusIdeWindow: () => { /* CLI 无窗口，忽略 */ },
      notifyProcessExit: () => { /* 运行由本类自行接管 */ },
      openPathExternally: async () => '',
    })

    // 5) 依次编译（+可选运行）
    const results: AutoBuildProjectResult[] = []
    for (let i = 0; i < projects.length; i++) {
      const project = projects[i]
      this.currentLabel = multi ? project.label : null
      this.printSection(i + 1, projects.length, project)

      const result = await this.buildOne(project, compileProject)
      results.push(result)

      if (!result.success && this.request.failFast) {
        this.print('')
        this.emit({ type: 'error', text: `--fail-fast：已中止，剩余 ${projects.length - i - 1} 个项目未处理。` })
        break
      }
    }
    this.currentLabel = null

    // 6) 汇总
    return this.printSummary(results, projects.length)
  }

  /** 编译单个项目，并按需运行产物 */
  private async buildOne(
    project: AutoBuildProject,
    compileProject: (options: {
      projectDir: string
      debug?: boolean
      arch?: string
      mode?: 'compile' | 'run'
    }) => Promise<CompileResult>,
  ): Promise<AutoBuildProjectResult> {
    const { run: shouldRun, debug, arch } = this.request

    const result = await compileProject({
      projectDir: project.dir,
      mode: shouldRun ? 'run' : 'compile',
      debug: !!debug,
      ...(arch ? { arch } : {}),
    })

    const summary: AutoBuildProjectResult = {
      project,
      success: result.success,
      outputFile: result.outputFile,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
      elapsedMs: result.elapsedMs,
      runExitCode: null,
    }

    this.print('')
    this.print(`编译结果: ${result.success ? '成功' : '失败'}`)
    this.print(`输出文件: ${result.outputFile || '(无)'}`)
    this.print(`错误 ${result.errorCount} 个 / 警告 ${result.warningCount} 个 / 耗时 ${result.elapsedMs}ms`)

    if (!result.success) {
      this.emit({ type: 'error', text: `编译失败：错误 ${result.errorCount} 个，警告 ${result.warningCount} 个` })
      return summary
    }

    if (!shouldRun) return summary

    if (!result.outputFile || !existsSync(result.outputFile)) {
      summary.success = false
      summary.note = '编译成功但找不到产物'
      this.emit({ type: 'error', text: `编译成功但找不到产物，无法运行: ${result.outputFile || '(空)'}` })
      return summary
    }

    summary.runExitCode = await this.runProgram(result.outputFile, project)
    if (summary.runExitCode !== 0) {
      if (summary.runExitCode === 124) {
        // 124 是本类自己的「超时结束」哨兵：GUI 程序被超时结束属预期，不算失败。
        summary.note = '运行超时（已按超时结束）'
      } else {
        // 其它非零退出码说明程序自己跑挂了，CI 语义上应当判失败。
        summary.success = false
        summary.note = `运行退出码 ${summary.runExitCode}`
      }
    }
    return summary
  }

  /** 运行编译产物，把 stdout/stderr 实时回显到终端，返回退出码。 */
  private async runProgram(exePath: string, project: AutoBuildProject): Promise<number> {
    const cwd = dirname(exePath)
    const outputType = readProjectOutputType(project.eppPath)
    const isConsole = !outputType || /console/i.test(outputType)
    const timeoutMs = this.request.runTimeoutMs ?? (isConsole ? 0 : 15000)

    this.print('')
    this.print('------------------------------------------')
    this.print(`正在运行程序: ${project.label}`)
    if (!isConsole) {
      this.print(`提示: 输出类型为 ${outputType}（非控制台程序），${timeoutMs > 0 ? `${timeoutMs}ms 后自动结束` : '将等待其退出'}。`)
    }
    this.print('------------------------------------------')

    return await new Promise<number>((resolvePromise) => {
      let settled = false
      let timer: NodeJS.Timeout | null = null

      const child = spawn(exePath, [], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: false,
      })
      // 记下当前子进程：看门狗触发时要先把它结束掉，否则会留下卡死的窗口/孤儿进程。
      this.activeChild = child

      const finish = (code: number, note?: string): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (this.activeChild === child) this.activeChild = null
        if (note) this.print(note)
        this.print(`程序已退出，退出码: ${code}`)
        resolvePromise(code)
      }

      const decode = (chunk: Buffer): string => {
        try {
          return this.request.encoding && this.request.encoding.toLowerCase() !== 'utf8'
            ? iconv.decode(chunk, this.request.encoding)
            : chunk.toString('utf-8')
        } catch {
          return chunk.toString('utf-8')
        }
      }

      child.stdout?.on('data', (chunk: Buffer) => this.emitRaw(decode(chunk)))
      child.stderr?.on('data', (chunk: Buffer) => this.emitRaw(decode(chunk)))

      child.on('error', (error) => {
        this.emit({ type: 'error', text: `启动程序失败: ${error.message}` })
        finish(EXIT_FAIL)
      })

      child.on('exit', (code, signal) => {
        const exitCode = code ?? (signal ? 1 : 0)
        finish(exitCode, signal ? `程序被信号终止: ${signal}` : undefined)
      })

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (settled) return
          try { child.kill() } catch { /* ignore */ }
          finish(124, `运行超时（${timeoutMs}ms），已结束程序。`)
        }, timeoutMs)
      }
    })
  }

  // ────────────────────────────── 看门狗 ──────────────────────────────

  /**
   * 看门狗到点：不管理由，一律收尾并强制退出自身。
   *
   * 顺序刻意如此：先打原因（让日志留下「为什么被结束」）→ 结束残留子进程 → 落盘 → 强制退出。
   * 这里不复用 emit()，避免依赖任何可能已经卡住的代码路径；全部走最直接的 print/appendLog。
   */
  private onWatchdogFire(): void {
    const elapsedMs = this.startedAtMs > 0 ? Date.now() - this.startedAtMs : 0
    const banner = `[autobuild] 看门狗触发：autobuild 已连续运行 ${formatMinutes(elapsedMs)}（时限 ${formatMinutes(this.watchdogMinutes * 60_000)}），判定为卡住，强制结束自身。`
    const why = '[autobuild] 结束原因：常见于被调试的窗口程序停在消息循环不退出，导致整条流程挂死。'

    this.print('')
    this.print('==========================================')
    this.print(banner)
    this.print(why)
    this.appendLog(banner)
    this.appendLog(why)

    const child = this.activeChild
    if (child && child.exitCode === null) {
      const killLine = `[autobuild] 正在结束残留子进程 (pid=${child.pid ?? '?'})...`
      this.print(killLine)
      this.appendLog(killLine)
      try {
        child.kill()
      } catch {
        // 结束子进程失败不影响「强制退出自身」这一最终目标
      }
    }

    const codeLine = `[autobuild] 强制退出，退出码 ${EXIT_WATCHDOG}（看门狗超时）。`
    this.print(codeLine)
    this.print('==========================================')
    this.appendLog(codeLine)

    this.flushLogSummary()
    this.exitProcess(EXIT_WATCHDOG)
  }

  // ────────────────────────────── 输出 ──────────────────────────────

  private printBanner(): void {
    this.print('==========================================')
    this.print('ycIDE AutoBuild — 命令行自动编译')
    this.print(`开始时间: ${new Date().toLocaleString()}`)
    this.print('==========================================')
  }

  private printSection(index: number, total: number, project: AutoBuildProject): void {
    this.print('')
    this.print('==========================================')
    this.print(`[${index}/${total}] 编译: ${project.label}`)
    this.print(`目录: ${project.dir}`)
    this.print('==========================================')
  }

  /** 批量汇总表 + JSON 摘要，返回进程退出码 */
  private printSummary(results: AutoBuildProjectResult[], totalFound: number): number {
    const okCount = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success)

    this.print('')
    this.print('==========================================')
    this.print('汇总')
    this.print('==========================================')
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      const status = r.success ? '成功' : '失败'
      const run = r.runExitCode === null ? '' : ` 运行退出码=${r.runExitCode}`
      const note = r.note ? ` (${r.note})` : ''
      this.print(
        `[${String(i + 1).padStart(2)}/${results.length}] ${status}  ${r.project.label}`
        + `  错误${r.errorCount} 警告${r.warningCount} ${r.elapsedMs}ms${run}${note}`,
      )
    }
    this.print('------------------------------------------')
    this.print(`共发现 ${totalFound} 个项目，已处理 ${results.length} 个：成功 ${okCount}，失败 ${failed.length}`)

    if (this.request.json) {
      this.print(JSON.stringify({
        ok: failed.length === 0,
        totalFound,
        processed: results.length,
        succeeded: okCount,
        failed: failed.length,
        projects: results.map(r => ({
          label: r.project.label,
          dir: r.project.dir,
          eppPath: r.project.eppPath,
          ok: r.success,
          outputFile: r.outputFile,
          errorCount: r.errorCount,
          warningCount: r.warningCount,
          elapsedMs: r.elapsedMs,
          runExitCode: r.runExitCode,
          note: r.note ?? null,
        })),
      }))
    }
    this.print('==========================================')

    return failed.length === 0 ? EXIT_OK : EXIT_FAIL
  }

  /** 编译消息 → 终端（批量模式下带项目前缀） */
  private emit(msg: CompileMessage): void {
    this.messages.push(msg)
    const typePrefix = msg.type === 'error' ? '[错误] ' : msg.type === 'warning' ? '[警告] ' : msg.type === 'success' ? '[成功] ' : ''
    const labelPrefix = this.currentLabel ? `[${this.currentLabel}] ` : ''
    // 统一走 stdout，保证与运行输出的时序不错乱；失败语义由退出码承载（见 cli.ts）。
    const line = labelPrefix + typePrefix + msg.text
    this.print(line)
    this.appendLog(line)
  }

  /** 运行产物时的原始输出（不额外加前缀、不补换行） */
  private emitRaw(text: string): void {
    if (!text) return
    this.writeRaw(text)
    this.appendLog(text.replace(/\r?\n$/, ''))
  }

  private appendLog(line: string): void {
    if (!this.logFile) return
    try {
      mkdirSync(dirname(this.logFile), { recursive: true })
      appendFileSync(this.logFile, line + '\n', 'utf-8')
    } catch {
      // 落盘失败不影响主流程
    }
  }

  private flushLogSummary(): void {
    if (!this.logFile) return
    const errors = this.messages.filter(m => m.type === 'error').length
    this.appendLog(`\n[autobuild] 结束于 ${new Date().toISOString()}，错误消息 ${errors} 条。`)
  }
}

/** 供外部（如 Electron 主进程）判断是否需要为 CLI 模式准备日志文件 */
export function defaultAutoBuildLogPath(appPath: string): string {
  const base = (() => {
    try {
      const dir = join(appPath, 'debug_logs')
      mkdirSync(dir, { recursive: true })
      return dir
    } catch {
      return tmpdir()
    }
  })()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return join(base, `autobuild-${stamp}.log`)
}
