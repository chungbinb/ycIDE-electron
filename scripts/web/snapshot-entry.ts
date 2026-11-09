// 网页版（在线编辑器）数据快照：在 Node 里跑真实的支持库管理器，
// 把编辑器需要的命令 / 数据类型 / 窗口组件等元数据导出为 JSON，供浏览器端的模拟 API 使用。
// 由 scripts/web/generate-snapshot.mjs 用 esbuild 打包后执行，不要直接 import。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { libraryManager } from '../../src/main/libraryManager'

const root = resolve(process.argv[2] || '.')
const outFile = resolve(process.argv[3] || 'src/web/public/snapshot.json')
const userDataPath = mkdtempSync(join(tmpdir(), 'ycide-web-snapshot-'))

setRuntimeEnv({ appPath: root, isPackaged: false, userDataPath, appVersion: 'web' })

try {
  libraryManager.scan()
  libraryManager.loadAll()
  const list = libraryManager.getList()
  // 网页版只演示 Windows 项目，其他平台回落到同一份数据
  const platforms = ['windows'] as const
  const byPlatform = Object.fromEntries(platforms.map(p => [p, {
    commands: libraryManager.getAllCommands(p),
    dataTypes: libraryManager.getAllDataTypes(p),
    windowUnits: libraryManager.getAllWindowUnits(p),
  }]))
  const infos = Object.fromEntries(list.map(l => [l.name, libraryManager.getLibInfo(l.name)]))
  const snapshot = { list, infos, byPlatform }
  // 去掉构建机器上的绝对路径（会随网页公开），统一换成虚拟路径
  const escapedRoot = JSON.stringify(root).slice(1, -1)
  const json = JSON.stringify(snapshot)
    .split(escapedRoot).join('C:\\\\ycIDE')
    .split(root.replace(/\\/g, '/')).join('C:/ycIDE')
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, json)
  console.log(`snapshot: ${list.length} 个支持库，windows 命令 ${byPlatform.windows.commands.length} 条 → ${outFile}`)
} finally {
  rmSync(userDataPath, { recursive: true, force: true })
}
