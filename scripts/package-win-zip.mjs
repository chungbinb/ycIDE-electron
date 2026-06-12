// 测试包打包脚本：将 dist/win-unpacked 压缩为 dist/ycIDE-win-unpacked-v<版本>.zip
// 始终排除 compiler/ 目录（编译工具链 3GB+ 单独分发，测试包与历史版本保持 ~130MB 构成）。
// 用法：npm run package:win:zip（先 electron-builder 再压缩）或单独 node scripts/package-win-zip.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const unpackedDir = join(root, 'dist', 'win-unpacked')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')).version
const zipPath = join(root, 'dist', `ycIDE-win-unpacked-v${version}.zip`)

if (!existsSync(unpackedDir)) {
  console.error(`未找到 ${unpackedDir}，请先运行 npm run package:win`)
  process.exit(1)
}

const EXCLUDED_TOP_LEVEL = new Set(['compiler'])
const includedItems = readdirSync(unpackedDir).filter(name => !EXCLUDED_TOP_LEVEL.has(name))
const excludedPresent = readdirSync(unpackedDir).filter(name => EXCLUDED_TOP_LEVEL.has(name))
if (excludedPresent.length > 0) {
  console.log(`已排除目录: ${excludedPresent.join(', ')}`)
}

if (existsSync(zipPath)) rmSync(zipPath)

// Windows 打包用 PowerShell Compress-Archive（无额外依赖）
const itemList = includedItems.map(name => join(unpackedDir, name)).join("', '")
execFileSync('powershell', [
  '-NoProfile',
  '-Command',
  `Compress-Archive -Path '${itemList}' -DestinationPath '${zipPath}' -CompressionLevel Optimal`,
], { stdio: 'inherit' })

const sizeMb = (statSync(zipPath).size / 1024 / 1024).toFixed(1)
console.log(`打包完成: ${zipPath} (${sizeMb} MB)`)
