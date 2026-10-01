// AutoBuild —— ycIDE 的「命令行自动编译」能力（独立模块，零侵入）。
//
// 目标：让 ycIDE 能当作 CLI 程序启动，接收参数；识别到「自动编译命令」后，对**已存在的项目目录**
// 执行编译并输出结果；编译成功后若命令里带了「自动运行」，则继续运行产物并把程序输出回显到终端。
//
// 设计约束（刻意为之）：
//   1. 本文件**不 import electron**，因此既能被 Electron 主进程调用，也能被独立 Node CLI 直接跑。
//   2. 编译内核完全复用 src/main/compiler.ts 的 compileProject —— 不复制、不重写任何编译逻辑，
//      编译器/支持库/转译器全部沿用 IDE 的那一套，行为与 IDE 内编译一致。
//   3. 项目里只多出一个「入口 + 最小钩子」，不往既有模块里塞 CLI 分支。
//
// 用法：
//   ycide-cli build <项目目录> [--run] [--debug] [--arch x64] [--run-timeout 10000]
//                                [--encoding utf8] [--json] [--log <文件>] [--user-data <目录>]
//   ycide-cli autobuild <项目目录> --run          # 等价写法
//   ycide --autobuild <项目目录> --run            # Electron 主进程内的写法（见 index.ts 钩子）
//
// 退出码：0 成功；1 编译/运行失败；2 参数用法错误。
import { spawn } from 'child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs'
import { dirname, isAbsolute, join, resolve } from 'path'
import { homedir, tmpdir } from 'os'
import iconv from 'iconv-lite'
import { setRuntimeEnv } from './runtimeEnv'
import type { CompileMessage, CompileResult } from './compiler'

/** 自动编译请求（由命令行参数解析得到） */
export interface AutoBuildRequest {
  /** 项目目录（必须是已存在的、含 .epp 的 ycIDE 项目） */
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

const VALUE_FLAGS = new Set(['--arch', '--run-timeout', '--encoding', '--log', '--user-data', '--project', '-p', '--app-path'])
const ACTION_TOKENS = new Set(['compile', 'build', 'run', 'debug'])

const EXIT_OK = 0
const EXIT_FAIL = 1
const EXIT_USAGE = 2

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

/** 读取 .epp 里的 OutputType（Console / WindowsApp / DynamicLibrary），失败返回空串 */
function readProjectOutputType(projectDir: string): string {
  try {
    const epp = readdirSync(projectDir).find(f => f.toLowerCase().endsWith('.epp'))
    if (!epp) return ''
    const text = readFileSync(join(projectDir, epp), 'utf-8')
    const matched = text.match(/^\s*OutputType\s*=\s*(.+?)\s*$/m)
    return matched ? matched[1].trim() : ''
  } catch {
    return ''
  }
}

/**
 * AutoBuild：把「命令行 → 编译 → 可选运行」这条链路封装成一个类。
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

  constructor(request: AutoBuildRequest, options: AutoBuildOptions) {
    this.request = request
    this.options = options
    this.print = options.print ?? ((line: string) => { process.stdout.write(line + '\n') })
    this.writeRaw = options.writeRaw ?? ((text: string) => { process.stdout.write(text) })
    this.logFile = request.logFile ? resolve(request.logFile) : null
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
   *   <命令> <项目目录> [动作] [开关...]
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
    let arch: string | undefined
    let runTimeoutMs: number | undefined
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
        case '--arch': {
          const value = rest[++i]
          if (!value || value.startsWith('-')) return { request: null, error: '参数 --arch 缺少取值（x86 / x64 / arm64）', help: false }
          arch = value
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
          if (!value || value.startsWith('-')) return { request: null, error: '参数 --project 缺少项目目录', help: false }
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
      // 动作词（compile/run/debug）优先于项目路径
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
      return { request: null, error: '缺少项目路径。用法: ycide-cli build <项目目录> [--run]', help: false }
    }
    if (positionals.length > 1) {
      return { request: null, error: `只能指定一个项目路径，收到: ${positionals.join(' ')}`, help: false }
    }

    return {
      request: {
        projectDir: isAbsolute(projectDir) ? projectDir : resolve(projectDir),
        run,
        debug,
        arch,
        runTimeoutMs,
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
      'ycIDE 自动编译（AutoBuild）',
      '',
      '用法:',
      '  ycide-cli build <项目目录> [选项]',
      '  ycide-cli autobuild <项目目录> --run',
      '  ycide --autobuild <项目目录> [选项]        （打包后的 IDE 本体）',
      '',
      '选项:',
      '  --run, -r                编译成功后自动运行产物并回显输出',
      '  --debug                  带调试运行时编译（等价 IDE 的调试编译）',
      '  --arch <x86|x64|arm64>   覆盖目标架构（默认按 .epp）',
      '  --run-timeout <毫秒>     运行超时；0=不超时（默认控制台程序不超时，GUI 程序 15000）',
      '  --encoding <名称>        运行输出编码，默认 utf8（可选 gbk / gb18030 / big5 ...）',
      '  --json                   以 JSON 输出最终摘要',
      '  --log <文件>             额外把完整输出写入该文件',
      '  --user-data <目录>       覆盖用户数据目录（支持库加载状态所在处）',
      '  -h, --help               显示本帮助',
      '',
      '退出码: 0 成功 / 1 编译或运行失败 / 2 参数用法错误',
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

  /** 执行一次完整的「编译（+可选运行）」，返回进程退出码。 */
  async execute(): Promise<number> {
    try {
      return await this.run()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emit({ type: 'error', text: `[autobuild] 未捕获异常: ${message}` })
      return EXIT_FAIL
    } finally {
      this.flushLogSummary()
    }
  }

  private async run(): Promise<number> {
    const { projectDir, run: shouldRun, arch, debug } = this.request

    this.printBanner()

    // 1) 校验项目：必须是「已存在的项目目录」
    if (!existsSync(projectDir)) {
      this.emit({ type: 'error', text: `项目目录不存在: ${projectDir}` })
      return EXIT_USAGE
    }
    let isDir = false
    try {
      isDir = statSync(projectDir).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) {
      this.emit({ type: 'error', text: `项目路径不是目录: ${projectDir}` })
      return EXIT_USAGE
    }
    const eppFiles = readdirSync(projectDir).filter(f => f.toLowerCase().endsWith('.epp'))
    if (eppFiles.length === 0) {
      this.emit({ type: 'error', text: `不是有效的 ycIDE 项目（目录中找不到 .epp 项目文件）: ${projectDir}` })
      return EXIT_USAGE
    }

    // 2) 注入运行环境：必须在任何 libraryManager / compiler 调用之前
    const userDataPath = this.request.userDataPath || this.options.userDataPath || defaultUserDataPath()
    setRuntimeEnv({
      appPath: this.options.appPath,
      isPackaged: !!this.options.isPackaged,
      userDataPath,
      appVersion: this.options.appVersion || '0.0.0-cli',
    })
    this.print(`项目目录 : ${projectDir}`)
    this.print(`项目文件 : ${eppFiles[0]}`)
    this.print(`IDE 根目录: ${this.options.appPath}`)
    this.print(`用户数据 : ${userDataPath}`)
    this.print(`构建模式 : ${shouldRun ? '编译并运行' : '仅编译'}${debug ? '（调试运行时）' : ''}`)
    this.print('')

    // 3) 注入编译宿主：编译输出打到终端（并同步落日志）
    const { setCompilerHost, compileProject } = await import('./compiler')
    setCompilerHost({
      readCompilerSettings: () => ({ zigPath: '', optimizeLevel: 'O2' }),
      emitOutput: (msg: CompileMessage) => this.emit(msg),
      requestFocusIdeWindow: () => { /* CLI 无窗口，忽略 */ },
      notifyProcessExit: () => { /* 运行由本类自行接管 */ },
      openPathExternally: async () => '',
    })

    // 4) 编译（复用 IDE 的编译内核）
    const result: CompileResult = await compileProject({
      projectDir,
      mode: shouldRun ? 'run' : 'compile',
      debug: !!debug,
      ...(arch ? { arch } : {}),
    })

    this.printResultSummary(result)

    if (!result.success) {
      this.emit({ type: 'error', text: `编译失败：错误 ${result.errorCount} 个，警告 ${result.warningCount} 个` })
      return EXIT_FAIL
    }

    // 5) 可选：自动运行并回显输出
    if (!shouldRun) return EXIT_OK
    if (!result.outputFile || !existsSync(result.outputFile)) {
      this.emit({ type: 'error', text: `编译成功但找不到产物，无法运行: ${result.outputFile || '(空)'}` })
      return EXIT_FAIL
    }

    return this.runProgram(result.outputFile)
  }

  /** 运行编译产物，把 stdout/stderr 实时回显到终端，返回退出码。 */
  private async runProgram(exePath: string): Promise<number> {
    const cwd = dirname(exePath)
    const outputType = readProjectOutputType(this.request.projectDir)
    const isConsole = !outputType || /console/i.test(outputType)
    const timeoutMs = this.request.runTimeoutMs ?? (isConsole ? 0 : 15000)

    this.print('')
    this.print('==========================================')
    this.print('正在运行程序...')
    if (!isConsole) {
      this.print(`提示: 该项目输出类型为 ${outputType}（非控制台程序），${timeoutMs > 0 ? `${timeoutMs}ms 后自动结束` : '将等待其退出'}。`)
    }
    this.print('==========================================')

    return await new Promise<number>((resolvePromise) => {
      let settled = false
      let timer: NodeJS.Timeout | null = null

      const child = spawn(exePath, [], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: false,
      })

      const finish = (code: number, note?: string): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
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

  // ────────────────────────────── 输出 ──────────────────────────────

  private printBanner(): void {
    this.print('==========================================')
    this.print('ycIDE AutoBuild — 命令行自动编译')
    this.print(`开始时间: ${new Date().toLocaleString()}`)
    this.print('==========================================')
  }

  private printResultSummary(result: CompileResult): void {
    this.print('')
    this.print('------------------------------------------')
    this.print(`编译结果: ${result.success ? '成功' : '失败'}`)
    this.print(`输出文件: ${result.outputFile || '(无)'}`)
    this.print(`错误 ${result.errorCount} 个 / 警告 ${result.warningCount} 个 / 耗时 ${result.elapsedMs}ms`)
    if (this.request.json) {
      this.print(JSON.stringify({
        ok: result.success,
        outputFile: result.outputFile,
        errorCount: result.errorCount,
        warningCount: result.warningCount,
        elapsedMs: result.elapsedMs,
        projectDir: this.request.projectDir,
        run: this.request.run,
      }))
    }
    this.print('------------------------------------------')
  }

  /** 编译消息 → 终端（带类型前缀） */
  private emit(msg: CompileMessage): void {
    this.messages.push(msg)
    const prefix = msg.type === 'error' ? '[错误] ' : msg.type === 'warning' ? '[警告] ' : msg.type === 'success' ? '[成功] ' : ''
    // 统一走 stdout，保证与运行输出的时序不错乱；失败语义由退出码承载（见 cli.ts）。
    const line = prefix + msg.text
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
