// 生成网页版的支持库数据快照：src/web/public/snapshot.json
// 用法：node scripts/web/generate-snapshot.mjs
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'ycide-web-snapshot-build-'))
const bundle = join(tmp, 'snapshot.cjs')

try {
  await build({
    entryPoints: [join(root, 'scripts/web/snapshot-entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: bundle,
    external: ['electron', 'adm-zip', 'iconv-lite'],
    logLevel: 'warning',
  })
  execFileSync(process.execPath, [bundle, root, join(root, 'src/web/public/snapshot.json')], {
    stdio: 'inherit',
    env: { ...process.env, NODE_PATH: join(root, 'node_modules') },
  })
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
