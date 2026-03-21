import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyArchitectureState } from './classify-arch.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..')

const BASELINE_PATH = '.planning/baselines/inventory-baseline.json'
const PHASE2_REPORTS_ROOT = '.planning/phases/02-deterministic-encoding-conversion/reports/libraries'
const REPORTS_ROOT = '.planning/phases/03-x64-adaptation-dual-arch-gates/reports'

const THIRD_PARTY_ROOTS = {
  易语言的功能库: '第三方相关文件/易语言的功能库',
  易语言的界面库: '第三方相关文件/易语言的界面库'
}

const BLOCKED_ENUMS = {
  MISSING_X64_ARTIFACT: 'missing_x64_artifact',
  MISSING_X86_ARTIFACT: 'missing_x86_artifact',
  X64_LANE_FAILED: 'x64_lane_failed',
  X86_LANE_FAILED: 'x86_lane_failed',
  ABI_POINTER_MISMATCH: 'abi_pointer_mismatch',
  ABI_LAYOUT_MISMATCH: 'abi_layout_mismatch',
  ABI_CALLBACK_SIGNATURE_MISMATCH: 'abi_callback_signature_mismatch',
  ABI_EVIDENCE_INCOMPLETE: 'abi_evidence_incomplete',
  REPORT_INVARIANT_MISMATCH: 'report_invariant_mismatch'
}

const ABI_GROUPS = ['pointer-width', 'layout-alignment', 'callback-signature']

export async function runX64Adaptation({
  repoRoot = DEFAULT_REPO_ROOT,
  write = false,
  strictGate = false
} = {}) {
  const baseline = await readBaseline(repoRoot)
  const queue = baseline.libraries.filter((row) => !row.isMigrated)
  const reports = []

  for (let i = 0; i < queue.length; i += 1) {
    const row = queue[i]
    const report = await processLibrary(row, i, { repoRoot, write })
    reports.push(report)
  }

  const summary = buildPhaseSummary(queue, reports)
  validateSummary(summary, baseline, reports)
  await writeReports({ repoRoot, reports, summary })

  if (strictGate && !summary.phaseGatePassed) {
    throw new Error('Phase 3 strict gate failed: blocked libraries exist')
  }

  return { reports, summary }
}

export async function checkX64Adaptation({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const reportsRoot = path.join(repoRoot, REPORTS_ROOT)
  const summaryPath = path.join(reportsRoot, 'phase-summary.json')
  let summary
  try {
    const raw = await fs.readFile(summaryPath, 'utf8')
    summary = JSON.parse(raw)
  } catch {
    throw new Error('phase-summary.json missing; run x64:adapt first')
  }
  if (!summary.phaseGatePassed) {
    throw new Error('Phase 3 strict gate failed: blocked libraries exist')
  }
  return summary
}

async function processLibrary(row, index, { repoRoot, write }) {
  const libraryRoot = resolveLibraryRoot(row, repoRoot)
  const phase2ReportExists = await hasPhase2Report(row.name, repoRoot)
  const archState = await classifyArchitectureState(libraryRoot).catch(() => 'mixed')
  const blockedReasonCode = []

  const hasX64Artifact = await hasArchArtifact(libraryRoot, 'x64')
  const hasX86Artifact = await hasArchArtifact(libraryRoot, 'x86')

  const x64Result = hasX64Artifact ? 'pass' : 'fail'
  const x86Result = hasX86Artifact ? 'pass' : 'fail'

  if (!phase2ReportExists) blockedReasonCode.push(BLOCKED_ENUMS.REPORT_INVARIANT_MISMATCH)
  if (!hasX64Artifact) {
    blockedReasonCode.push(BLOCKED_ENUMS.MISSING_X64_ARTIFACT)
    blockedReasonCode.push(BLOCKED_ENUMS.X64_LANE_FAILED)
  }
  if (!hasX86Artifact) {
    blockedReasonCode.push(BLOCKED_ENUMS.MISSING_X86_ARTIFACT)
    blockedReasonCode.push(BLOCKED_ENUMS.X86_LANE_FAILED)
  }

  const abi = evaluateAbi(archState, hasX64Artifact, hasX86Artifact)
  if (abi.pointerWidth === 'fail') blockedReasonCode.push(BLOCKED_ENUMS.ABI_POINTER_MISMATCH)
  if (abi.structLayoutAlignment === 'fail') blockedReasonCode.push(BLOCKED_ENUMS.ABI_LAYOUT_MISMATCH)
  if (abi.callbackSignature === 'fail') blockedReasonCode.push(BLOCKED_ENUMS.ABI_CALLBACK_SIGNATURE_MISMATCH)
  if (!abi.evidenceComplete) blockedReasonCode.push(BLOCKED_ENUMS.ABI_EVIDENCE_INCOMPLETE)

  const uniqueReasons = [...new Set(blockedReasonCode)]
  const status = uniqueReasons.length > 0 ? 'blocked' : 'completed'
  const batchId = `B${String(index + 1).padStart(2, '0')}-A-${ABI_GROUPS[0]}`

  const report = {
    library: row.name,
    sourceRoot: row.sourceRoot,
    batchId,
    x64Result,
    x86Result,
    abi: {
      pointerWidth: abi.pointerWidth,
      structLayoutAlignment: abi.structLayoutAlignment,
      callbackSignature: abi.callbackSignature
    },
    blockedReasonCode: uniqueReasons,
    diffSummary: {
      passed: computePassedCount(x64Result, x86Result, abi),
      failed: uniqueReasons.length,
      diff: uniqueReasons
    },
    nextAction: status === 'blocked' ? 'Fix blocked ABI/arch items and retry this library.' : 'No action required.',
    status
  }

  if (write) {
    // No file mutations in phase 3 script; write mode intentionally writes reports only.
  }

  return report
}

function evaluateAbi(archState, hasX64Artifact, hasX86Artifact) {
  const evidenceComplete = hasX64Artifact && hasX86Artifact
  const pointerWidth = hasX64Artifact ? 'pass' : 'fail'
  const structLayoutAlignment = archState === 'x86-only' ? 'fail' : evidenceComplete ? 'pass' : 'fail'
  const callbackSignature = evidenceComplete ? 'pass' : 'fail'
  return {
    pointerWidth,
    structLayoutAlignment,
    callbackSignature,
    evidenceComplete
  }
}

function computePassedCount(x64Result, x86Result, abi) {
  let passed = 0
  if (x64Result === 'pass') passed += 1
  if (x86Result === 'pass') passed += 1
  if (abi.pointerWidth === 'pass') passed += 1
  if (abi.structLayoutAlignment === 'pass') passed += 1
  if (abi.callbackSignature === 'pass') passed += 1
  return passed
}

function buildPhaseSummary(queue, reports) {
  const completedLibraries = reports.filter((r) => r.status === 'completed').length
  const blockedLibraries = reports.filter((r) => r.status === 'blocked').length
  const remainingLibraries = Math.max(0, queue.length - completedLibraries - blockedLibraries)

  const blockedReasonStats = {}
  for (const report of reports) {
    for (const code of report.blockedReasonCode) {
      blockedReasonStats[code] = (blockedReasonStats[code] ?? 0) + 1
    }
  }

  const summary = {
    totalLibraries: queue.length,
    completedLibraries,
    blockedLibraries,
    remainingLibraries,
    progressThermometer: `${completedLibraries}/${queue.length} completed, ${blockedLibraries} blocked, ${remainingLibraries} remaining`,
    blockedReasonStats,
    phaseGatePassed: blockedLibraries === 0 && remainingLibraries === 0
  }
  return summary
}

function validateSummary(summary, baseline, reports) {
  if (summary.totalLibraries !== baseline.totals.remainingCount) {
    throw new Error('report_invariant_mismatch: totalLibraries mismatch baseline remainingCount')
  }
  if (summary.totalLibraries !== reports.length) {
    throw new Error('report_invariant_mismatch: totalLibraries mismatch report count')
  }
}

async function writeReports({ repoRoot, reports, summary }) {
  const reportsRoot = path.join(repoRoot, REPORTS_ROOT)
  const librariesDir = path.join(reportsRoot, 'libraries')
  await fs.mkdir(librariesDir, { recursive: true })

  const sorted = [...reports].sort((a, b) => a.library.localeCompare(b.library, 'en'))
  for (const report of sorted) {
    const slug = slugify(report.library)
    const target = path.join(librariesDir, `${slug}.json`)
    await fs.writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  await fs.writeFile(path.join(reportsRoot, 'phase-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
}

async function readBaseline(repoRoot) {
  const raw = await fs.readFile(path.join(repoRoot, BASELINE_PATH), 'utf8')
  return JSON.parse(raw)
}

function resolveLibraryRoot(row, repoRoot) {
  const relRoot = THIRD_PARTY_ROOTS[row.sourceRoot]
  if (!relRoot) throw new Error(`Unknown sourceRoot: ${row.sourceRoot}`)
  return path.join(repoRoot, relRoot, row.name)
}

async function hasPhase2Report(libraryName, repoRoot) {
  const reportPath = path.join(repoRoot, PHASE2_REPORTS_ROOT, `${slugify(libraryName)}.json`)
  try {
    await fs.access(reportPath)
    return true
  } catch {
    return false
  }
}

async function hasArchArtifact(libraryRoot, arch) {
  const archDir = path.join(libraryRoot, 'lib', arch)
  try {
    const entries = await fs.readdir(archDir, { withFileTypes: true })
    return entries.some((e) => e.isFile() && e.name.toLowerCase().endsWith('.lib'))
  } catch {
    return false
  }
}

function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '')
}

async function runCli(argv) {
  const args = new Set(argv.slice(2))
  const repoRootArg = argv.find((v) => v.startsWith('--repo-root='))
  const repoRoot = repoRootArg ? path.resolve(repoRootArg.split('=')[1]) : DEFAULT_REPO_ROOT
  const write = args.has('--write')
  const check = args.has('--check')
  if (check && !write) {
    const summary = await checkX64Adaptation({ repoRoot })
    console.log(JSON.stringify(summary, null, 2))
    return
  }
  const result = await runX64Adaptation({ repoRoot, write, strictGate: false })
  console.log(JSON.stringify(result.summary, null, 2))
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
