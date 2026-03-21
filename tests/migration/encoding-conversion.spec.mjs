import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import iconv from 'iconv-lite'
import { runConversion } from '../../scripts/migration/convert-encoding.mjs'

const gbkSourceText = '测试库说明\nTOKEN_ALPHA\nLine-3'
const utf8BomText = 'UTF8 BOM 示例\nTOKEN_BETA\nLine-2'
const extlessText = 'NoExt 文本\nTOKEN_GAMMA'
const mojibakeText = '这是故意的锟斤拷标记\nTOKEN_MOJI'

test('ENCD-01 deterministic rerun keeps byte-identical outputs and reports', async () => {
  const fixture = await createFixtureRepo()
  await runConversion({ repoRoot: fixture.repoRoot, write: true, strictGate: false })
  const first = await snapshotArtifacts(fixture)

  await runConversion({ repoRoot: fixture.repoRoot, write: true, strictGate: false })
  const second = await snapshotArtifacts(fixture)

  assert.equal(first.reportHash, second.reportHash, 'library report hash must be deterministic')
  assert.equal(first.summaryHash, second.summaryHash, 'phase summary hash must be deterministic')
  assert.equal(first.convertedHash, second.convertedHash, 'converted file bytes must be deterministic')
  await cleanupFixtureRepo(fixture.repoRoot)
})

test('ENCD-02 blocks mixed/high-risk files and never rewrites them', async () => {
  const fixture = await createFixtureRepo()
  const beforeMixed = await fs.readFile(fixture.mixedPath)
  const beforeMojibake = await fs.readFile(fixture.mojibakePath)

  const { reports } = await runConversion({ repoRoot: fixture.repoRoot, write: true, strictGate: false })
  const report = reports.find((r) => r.library === fixture.libraryName)
  assert.ok(report, 'library report must exist')

  const reasons = new Set(report.blockedReasons.map((item) => item.reason))
  assert.ok(reasons.has('mixed_or_uncertain'), 'mixed file should be blocked')
  assert.ok(reasons.has('high_risk_mojibake'), 'high-risk file should be blocked')

  const afterMixed = await fs.readFile(fixture.mixedPath)
  const afterMojibake = await fs.readFile(fixture.mojibakePath)
  assert.deepEqual(afterMixed, beforeMixed, 'mixed file must remain unchanged')
  assert.deepEqual(afterMojibake, beforeMojibake, 'high-risk file must remain unchanged')
  await cleanupFixtureRepo(fixture.repoRoot)
})

test('ENCD-03 emits required report fields and deterministic sample size N=5', async () => {
  const fixture = await createFixtureRepo()
  const { reports, summary } = await runConversion({ repoRoot: fixture.repoRoot, write: true, strictGate: false })
  const report = reports.find((r) => r.library === fixture.libraryName)
  assert.ok(report, 'library report must exist')

  assert.equal(typeof report.total, 'number')
  assert.equal(typeof report.scanned, 'number')
  assert.equal(typeof report.converted, 'number')
  assert.equal(typeof report.skipped, 'number')
  assert.equal(typeof report.blocked, 'number')
  assert.ok(Array.isArray(report.blockedReasons), 'blockedReasons must be list')
  assert.ok(Array.isArray(report.sampleFiles), 'sampleFiles must be list')
  assert.equal(report.sampleFiles.length, 5, 'sample size must be fixed at N=5')
  assert.equal(report.scanned, report.converted + report.skipped + report.blocked)
  assert.equal(summary.totals.scanned, summary.totals.converted + summary.totals.skipped + summary.totals.blocked)
  await cleanupFixtureRepo(fixture.repoRoot)
})

test('ENCD-04 preserves text semantics for converted outputs', async () => {
  const fixture = await createFixtureRepo()
  await runConversion({ repoRoot: fixture.repoRoot, write: true, strictGate: false })

  const converted = await fs.readFile(fixture.gbkPath, 'utf8')
  assert.equal(lineCount(converted), lineCount(gbkSourceText), 'line count must be preserved')
  assert.equal(tokenChecksum(converted), tokenChecksum(gbkSourceText), 'token checksum must be preserved')
  assert.equal(converted.includes('�'), false, 'converted text must not contain replacement char')
  await cleanupFixtureRepo(fixture.repoRoot)
})

async function createFixtureRepo() {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'encoding-conv-'))
  const libraryName = 'lib-alpha'
  const libraryRoot = path.join(repoRoot, '第三方相关文件', '易语言的功能库', libraryName)
  const baselineDir = path.join(repoRoot, '.planning', 'baselines')
  await fs.mkdir(libraryRoot, { recursive: true })
  await fs.mkdir(path.join(repoRoot, '第三方相关文件', '易语言的界面库'), { recursive: true })
  await fs.mkdir(baselineDir, { recursive: true })

  const gbkPath = path.join(libraryRoot, 'gbk-source.txt')
  const utf8BomPath = path.join(libraryRoot, 'utf8-bom.txt')
  const extlessPath = path.join(libraryRoot, 'notes-noext')
  const mixedPath = path.join(libraryRoot, 'mixed-risk.txt')
  const mojibakePath = path.join(libraryRoot, 'mojibake.txt')
  const binaryPath = path.join(libraryRoot, 'binary.dat')

  await fs.writeFile(gbkPath, iconv.encode(gbkSourceText, 'gbk'))
  await fs.writeFile(utf8BomPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(utf8BomText, 'utf8')]))
  await fs.writeFile(extlessPath, extlessText, 'utf8')
  await fs.writeFile(mixedPath, Buffer.from([0x80, 0x80, 0xff, 0x61, 0x62]))
  await fs.writeFile(mojibakePath, mojibakeText, 'utf8')
  await fs.writeFile(binaryPath, crypto.randomBytes(64))

  const baseline = {
    generatedAt: new Date().toISOString(),
    roots: {
      thirdParty: ['第三方相关文件/易语言的功能库', '第三方相关文件/易语言的界面库'],
      migrated: '支持库源码'
    },
    totals: {
      candidateCount: 1,
      migratedCount: 0,
      remainingCount: 1,
      coveragePct: 0
    },
    libraries: [
      {
        name: libraryName,
        sourceRoot: '易语言的功能库',
        isMigrated: false,
        archState: 'x86-only',
        encodingState: 'gbk'
      }
    ]
  }
  await fs.writeFile(path.join(baselineDir, 'inventory-baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`, 'utf8')

  return {
    repoRoot,
    libraryName,
    gbkPath,
    mixedPath,
    mojibakePath
  }
}

async function snapshotArtifacts(fixture) {
  const libReportPath = path.join(
    fixture.repoRoot,
    '.planning',
    'phases',
    '02-deterministic-encoding-conversion',
    'reports',
    'libraries',
    'lib-alpha.json'
  )
  const summaryPath = path.join(
    fixture.repoRoot,
    '.planning',
    'phases',
    '02-deterministic-encoding-conversion',
    'reports',
    'phase-summary.json'
  )
  return {
    reportHash: await sha256(libReportPath),
    summaryHash: await sha256(summaryPath),
    convertedHash: await sha256(fixture.gbkPath)
  }
}

async function sha256(filePath) {
  const data = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(data).digest('hex')
}

function lineCount(text) {
  return text.split('\n').length
}

function tokenChecksum(text) {
  const tokens = text.match(/[A-Za-z0-9_]+/g) ?? []
  return crypto.createHash('sha256').update(tokens.join('|')).digest('hex')
}

async function cleanupFixtureRepo(repoRoot) {
  await fs.rm(repoRoot, { recursive: true, force: true })
}
