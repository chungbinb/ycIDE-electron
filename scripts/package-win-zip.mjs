// 测试包打包脚本：将 dist/win-unpacked 压缩为 dist/ycIDE-win-unpacked-v<版本>.7z（或 .zip）
// 始终排除 compiler/ 目录（编译工具链 3GB+ 单独分发）。
// 优先使用 7-Zip 的 7z 格式极限压缩（LZMA2 -mx=9 solid，约 77MB，比 zip 的 ~123MB 小 37%）；
// 未安装 7-Zip 时回退 PowerShell Compress-Archive 出 .zip。
// 注意：.7z 在 Win10 上需要 7-Zip/WinRAR 解压（Win11 23H2+ 资源管理器原生支持）。
// 用法：npm run package:win:zip（先 electron-builder 再压缩）或单独 node scripts/package-win-zip.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const unpackedDir = join(root, 'dist', 'win-unpacked')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')).version

if (!existsSync(unpackedDir)) {
  console.error(`未找到 ${unpackedDir}，请先运行 npm run package:win`)
  process.exit(1)
}

const EXCLUDED_TOP_LEVEL = ['compiler']
const excludedPresent = readdirSync(unpackedDir).filter(name => EXCLUDED_TOP_LEVEL.includes(name))
if (excludedPresent.length > 0) {
  console.log(`已排除目录: ${excludedPresent.join(', ')}`)
}

function find7z() {
  const candidates = [
    '7z',
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  ]
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['i'], { stdio: 'ignore' })
      return candidate
    } catch {
      // try next
    }
  }
  return null
}

const sevenZip = find7z()
let outputPath
if (sevenZip) {
  outputPath = join(root, 'dist', `ycIDE-win-unpacked-v${version}.7z`)
  if (existsSync(outputPath)) rmSync(outputPath)
  console.log(`使用 7-Zip 极限压缩: ${sevenZip}`)
  execFileSync(sevenZip, [
    'a', '-t7z', outputPath, '*',
    ...EXCLUDED_TOP_LEVEL.map(name => `-x!${name}`),
    '-mx=9', '-ms=on', '-bso0', '-bsp0',
  ], { cwd: unpackedDir, stdio: 'inherit' })
} else {
  outputPath = join(root, 'dist', `ycIDE-win-unpacked-v${version}.zip`)
  if (existsSync(outputPath)) rmSync(outputPath)
  console.log('未检测到 7-Zip，回退 PowerShell Compress-Archive')
  const includedItems = readdirSync(unpackedDir).filter(name => !EXCLUDED_TOP_LEVEL.includes(name))
  const itemList = includedItems.map(name => join(unpackedDir, name)).join("', '")
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${itemList}' -DestinationPath '${outputPath}' -CompressionLevel Optimal`,
  ], { stdio: 'inherit' })
}

const sizeMb = (statSync(outputPath).size / 1024 / 1024).toFixed(1)
console.log(`打包完成: ${outputPath} (${sizeMb} MB)`)
