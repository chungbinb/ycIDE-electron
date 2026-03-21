import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyArchitectureState } from './classify-arch.mjs'
import { classifyEncodingState } from './classify-encoding.mjs'

const THIRD_PARTY_ROOTS = [
  '第三方相关文件/易语言的功能库',
  '第三方相关文件/易语言的界面库'
]
const MIGRATED_ROOT = '支持库源码'
const BASELINE_PATH = '.planning/baselines/inventory-baseline.json'
const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'dist', 'test-results'])

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..')

export async function generateInventoryBaseline({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const thirdPartyEntries = await collectThirdPartyLibraries(repoRoot)
  const migratedNames = await collectMigratedLibraryNames(repoRoot)

  const libraries = []
  for (const entry of thirdPartyEntries) {
    const isMigrated = migratedNames.has(normalizeName(entry.name))
    const row = {
      name: entry.name,
      sourceRoot: entry.sourceRoot,
      isMigrated
    }
    if (!isMigrated) {
      row.archState = await classifyArchitectureState(entry.fullPath)
      row.encodingState = await classifyEncodingState(entry.fullPath)
    }
    libraries.push(row)
  }

  libraries.sort((a, b) => {
    const cmp = a.name.localeCompare(b.name, 'zh-Hans-CN')
    if (cmp !== 0) return cmp
    return a.sourceRoot.localeCompare(b.sourceRoot, 'zh-Hans-CN')
  })

  const candidateCount = libraries.length
  const migratedCount = libraries.filter((item) => item.isMigrated).length
  const remainingCount = candidateCount - migratedCount
  const coveragePct = candidateCount === 0
    ? 0
    : Number(((migratedCount / candidateCount) * 100).toFixed(2))

  return {
    generatedAt: new Date().toISOString(),
    roots: {
      thirdParty: THIRD_PARTY_ROOTS,
      migrated: MIGRATED_ROOT
    },
    totals: {
      candidateCount,
      migratedCount,
      remainingCount,
      coveragePct
    },
    libraries
  }
}

async function collectThirdPartyLibraries(repoRoot) {
  const rows = []
  for (const relRoot of THIRD_PARTY_ROOTS) {
    const absRoot = path.join(repoRoot, relRoot)
    const entries = await safeReadDir(absRoot)
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (SKIP_DIRS.has(entry.name)) continue
      rows.push({
        name: entry.name,
        sourceRoot: relRoot.split('/').pop(),
        fullPath: path.join(absRoot, entry.name)
      })
    }
  }
  return rows
}

async function collectMigratedLibraryNames(repoRoot) {
  const migratedRoot = path.join(repoRoot, MIGRATED_ROOT)
  const entries = await safeReadDir(migratedRoot)
  const names = new Set()
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (SKIP_DIRS.has(entry.name)) continue
    names.add(normalizeName(entry.name))
  }
  return names
}

function normalizeName(name) {
  return name.trim().toLowerCase()
}

async function safeReadDir(dirPath) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
}

export async function writeBaselineManifest(baseline, { repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const outputPath = path.join(repoRoot, BASELINE_PATH)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8')
  return outputPath
}

export async function validateBaselineManifest(baseline) {
  if (!baseline || typeof baseline !== 'object') {
    throw new Error('Baseline manifest is missing or invalid')
  }

  const totals = baseline.totals
  if (!totals) {
    throw new Error('totals is required')
  }

  const requiredTotalKeys = ['candidateCount', 'migratedCount', 'remainingCount', 'coveragePct']
  for (const key of requiredTotalKeys) {
    if (!(key in totals)) {
      throw new Error(`totals.${key} is required`)
    }
  }

  if (!Array.isArray(baseline.libraries)) {
    throw new Error('libraries must be an array')
  }

  if (totals.candidateCount !== baseline.libraries.length) {
    throw new Error('candidateCount mismatch')
  }
  if (totals.candidateCount !== totals.migratedCount + totals.remainingCount) {
    throw new Error('totals math mismatch')
  }
  const expectedCoverage = totals.candidateCount === 0
    ? 0
    : Number(((totals.migratedCount / totals.candidateCount) * 100).toFixed(2))
  if (totals.coveragePct !== expectedCoverage) {
    throw new Error('coveragePct mismatch')
  }

  const allowedArch = new Set(['x86-only', 'mixed', 'x64-ready'])
  const allowedEncoding = new Set(['gbk', 'mixed', 'utf-8'])
  for (const row of baseline.libraries) {
    if (typeof row.name !== 'string' || row.name.length === 0) {
      throw new Error('library row name is required')
    }
    if (typeof row.isMigrated !== 'boolean') {
      throw new Error(`library row ${row.name} is missing isMigrated`)
    }
    if (!row.isMigrated) {
      if (!allowedArch.has(row.archState)) {
        throw new Error(`library row ${row.name} has invalid archState`)
      }
      if (!allowedEncoding.has(row.encodingState)) {
        throw new Error(`library row ${row.name} has invalid encodingState`)
      }
    }
  }
}

async function runCli(argv, { repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const args = new Set(argv.slice(2))
  const baseline = await generateInventoryBaseline({ repoRoot })

  if (args.has('--regenerate')) {
    const outputPath = await writeBaselineManifest(baseline, { repoRoot })
    await validateBaselineManifest(baseline)
    console.log(`Regenerated baseline: ${path.relative(repoRoot, outputPath)}`)
    return
  }

  if (args.has('--check-manifest')) {
    await validateBaselineManifest(baseline)
    console.log('Inventory baseline check passed')
    return
  }

  console.log(JSON.stringify(baseline, null, 2))
}

if (isDirectExecution()) {
  runCli(process.argv).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}

function isDirectExecution() {
  if (!process.argv[1]) return false
  return path.resolve(process.argv[1]) === __filename
}
