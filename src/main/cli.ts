// ycIDE 独立命令行入口（Node CLI）。
//
// 直接跑编译好的 JS：
//   node out/main/cli.js build "<项目目录>" --run
//   node out/main/cli.js autobuild "<项目目录>" --run --json
//
// 为什么单独一个入口：这是纯 Node 进程，stdout/stderr 与终端完全直连，
// 不像 Electron GUI 子系统在 Windows 上可能吞掉控制台输出。因此「脚本化 / CI」场景推荐走这里。
// 打包后的 IDE 本体也支持 CLI（见 src/main/index.ts 的钩子），但输出以日志文件兜底。
//
// 注意：本入口不创建窗口、不加载渲染层，只做「解析参数 → 编译 → 可选运行」。
import { existsSync } from 'fs'
import { isAbsolute, resolve } from 'path'
import { AutoBuild, defaultUserDataPath } from './autoBuild'

/** 解析 IDE 根目录（lib/ 与 compiler/ 所在处）：优先 --app-path / YCIDE_APP_PATH，其次按 out/main/cli.js 上溯两级 */
function resolveAppPath(argv: string[]): string {
  const flagIndex = argv.findIndex(token => token === '--app-path')
  const flagValue = flagIndex >= 0 ? argv[flagIndex + 1] : undefined
  if (flagValue && !flagValue.startsWith('-')) {
    return isAbsolute(flagValue) ? flagValue : resolve(flagValue)
  }
  if (process.env.YCIDE_APP_PATH) {
    return resolve(process.env.YCIDE_APP_PATH)
  }
  // __dirname = <root>/out/main → 上溯两级得到仓库根
  return resolve(__dirname, '..', '..')
}

function printLine(line: string): void {
  process.stdout.write(line + '\n')
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const appPath = resolveAppPath(argv)
  const parsed = AutoBuild.parse(argv)

  if (parsed.help) {
    printLine(AutoBuild.helpText())
    process.exitCode = 0
    return
  }
  if (parsed.error) {
    printLine(`[autobuild] 参数错误: ${parsed.error}`)
    printLine('')
    printLine(AutoBuild.helpText())
    process.exitCode = 2
    return
  }
  if (!parsed.request) {
    printLine('[autobuild] 未识别到自动编译命令（缺少 build / autobuild 命令）。')
    printLine('')
    printLine(AutoBuild.helpText())
    process.exitCode = 2
    return
  }

  // IDE 根目录必须真实存在，否则编译器 / 支持库找不到，会得到一堆看不懂的错误。
  if (!existsSync(appPath)) {
    printLine(`[autobuild] IDE 根目录不存在: ${appPath}（可用 --app-path 或 YCIDE_APP_PATH 指定）`)
    process.exitCode = 2
    return
  }

  const autoBuild = new AutoBuild(parsed.request, {
    appPath,
    isPackaged: false,
    userDataPath: parsed.request.userDataPath || defaultUserDataPath(),
    appVersion: process.env.YCIDE_APP_VERSION || '0.0.0-cli',
    print: printLine,
  })

  const code = await autoBuild.execute()
  if (parsed.request.logFile) {
    printLine(`完整日志: ${resolve(parsed.request.logFile)}`)
  }
  process.exitCode = code
}

main().catch((error) => {
  process.stderr.write(`[autobuild] 致命错误: ${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
