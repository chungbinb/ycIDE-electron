import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

test('INVT-01: scoped roots produce deterministic candidate and unmigrated set-diff', async () => {
  const inventoryModule = await import(pathToFileUrl(path.join(repoRoot, 'scripts', 'migration', 'inventory-baseline.mjs')))

  assert.equal(typeof inventoryModule.generateInventoryBaseline, 'function', 'Expected generateInventoryBaseline export')
  const baseline = await inventoryModule.generateInventoryBaseline({ repoRoot })

  assert.ok(Array.isArray(baseline.libraries), 'libraries must be an array')
  assert.ok(baseline.libraries.length > 0, 'candidate list must be non-empty')

  const names = baseline.libraries.map((item) => item.name)
  const sortedNames = [...names].sort((a, b) => a.localeCompare(b))
  assert.deepEqual(names, sortedNames, 'library rows must be deterministic and sorted by name')

  const remaining = baseline.libraries.filter((item) => !item.isMigrated)
  assert.equal(remaining.length, baseline.totals.remainingCount, 'remainingCount must match non-migrated rows')
})

test('INVT-02: classifiers only use allowed enums and include all unmigrated rows', async () => {
  const inventoryModule = await import(pathToFileUrl(path.join(repoRoot, 'scripts', 'migration', 'inventory-baseline.mjs')))
  const baseline = await inventoryModule.generateInventoryBaseline({ repoRoot })

  const allowedArch = new Set(['x86-only', 'mixed', 'x64-ready'])
  const allowedEncoding = new Set(['gbk', 'mixed', 'utf-8'])

  const remaining = baseline.libraries.filter((item) => !item.isMigrated)
  assert.ok(remaining.length > 0, 'unmigrated rows must exist for classification checks')

  for (const row of remaining) {
    assert.ok(row.archState, `archState missing for ${row.name}`)
    assert.ok(row.encodingState, `encodingState missing for ${row.name}`)
    assert.ok(allowedArch.has(row.archState), `invalid archState "${row.archState}" for ${row.name}`)
    assert.ok(allowedEncoding.has(row.encodingState), `invalid encodingState "${row.encodingState}" for ${row.name}`)
  }
})

test('INVT-03: manifest totals and coverage metrics are mathematically consistent', async () => {
  const inventoryModule = await import(pathToFileUrl(path.join(repoRoot, 'scripts', 'migration', 'inventory-baseline.mjs')))
  const baseline = await inventoryModule.generateInventoryBaseline({ repoRoot })

  const { candidateCount, migratedCount, remainingCount, coveragePct } = baseline.totals
  assert.equal(candidateCount, baseline.libraries.length, 'candidateCount must match libraries length')
  assert.equal(candidateCount, migratedCount + remainingCount, 'candidateCount must equal migrated + remaining')

  const expectedCoverage = candidateCount === 0
    ? 0
    : Number(((migratedCount / candidateCount) * 100).toFixed(2))
  assert.equal(coveragePct, expectedCoverage, 'coveragePct must be derived from migrated/candidate ratio')
})

function pathToFileUrl(filePath) {
  const normalized = filePath.replace(/\\/g, '/')
  return `file:///${normalized}`
}
