// 只跑「快速单元测试」：跳过所有需要真实 Zig 工具链的集成测试。
//
// 背景：tests/unit 下有 33 个文件用 `it.skipIf(!zigAvailable)` 门控，
// zigAvailable = 存在 compiler/zig/zig.exe。仓库不含该二进制（.gitignore 排除），
// 所以：
//   - CI / 全新 clone：这些用例整体 skip，套件约 10 秒跑完；
//   - 本机放了 Zig：它们会真的编译 + 运行产物，86 条用例要跑几分钟。
//
// 想在本地快速回归时用本脚本，它按「文件里有没有 skipIf(!zigAvailable)」自动分流，
// 不需要记一长串文件名，也不用依赖 bash 的 grep。
//
// 用法：npm run test:unit:fast         （只跑快测）
//       npm run test:unit:fast -- --reporter=verbose
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const unitDir = join(root, 'tests', 'unit')

/** 需要真实 Zig 工具链的用例特征 */
const ZIG_GATE = 'skipIf(!zigAvailable)'

const allFiles = readdirSync(unitDir).filter(name => name.endsWith('.spec.ts')).sort()
const fastFiles = []
const slowFiles = []

for (const name of allFiles) {
  const source = readFileSync(join(unitDir, name), 'utf-8')
  ;(source.includes(ZIG_GATE) ? slowFiles : fastFiles).push(`tests/unit/${name}`)
}

if (fastFiles.length === 0) {
  console.error('没有找到快速测试文件，请检查 tests/unit 目录。')
  process.exit(1)
}

// 注意用 existsSync：zig.exe 近 190MB，绝不能用 readFileSync 去探测。
const zigPresent = existsSync(join(root, 'compiler', 'zig', 'zig.exe'))

console.log(`[test:unit:fast] 快速文件 ${fastFiles.length} 个 / 跳过需 Zig 的文件 ${slowFiles.length} 个`)
console.log(`[test:unit:fast] 本机 compiler/zig/zig.exe 存在: ${zigPresent ? '是' : '否'}`)
console.log('[test:unit:fast] 完整套件请用: npm run test:unit')
console.log('')

// 直接用 node 跑 vitest 入口，而不是走 npx：
// Windows 上 npx 是 .cmd，Node 22 起禁止无 shell 直接 spawn .cmd/.bat（会静默失败）。
const vitestEntry = join(root, 'node_modules', 'vitest', 'vitest.mjs')
const extraArgs = process.argv.slice(2)
const result = spawnSync(
  process.execPath,
  [vitestEntry, 'run', ...fastFiles, ...extraArgs],
  { cwd: root, stdio: 'inherit' },
)

if (result.error) {
  console.error(`[test:unit:fast] 启动 vitest 失败: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
