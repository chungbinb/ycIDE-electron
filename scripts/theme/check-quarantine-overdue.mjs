import fs from 'node:fs'
import path from 'node:path'

const PHASE_MILESTONE = '17-'
const registryPath = path.resolve('.github/quality/quarantine-theme-tests.json')
const testsRoot = path.resolve('tests')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function listTestFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return []
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const nextPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...listTestFiles(nextPath))
      continue
    }
    if (entry.name.endsWith('.spec.js') || entry.name.endsWith('.spec.mjs')) {
      files.push(nextPath)
    }
  }
  return files
}

function collectKnownTestIds() {
  const files = listTestFiles(testsRoot)
  const ids = new Set()
  const testNamePattern = /\btest\s*\(\s*(['"`])([\s\S]*?)\1\s*,/g
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    let match = testNamePattern.exec(source)
    while (match) {
      ids.add(match[2].replace(/\s+/g, ' ').trim())
      match = testNamePattern.exec(source)
    }
  }
  return ids
}

function isValidDate(dateValue) {
  const parsed = new Date(dateValue)
  return Number.isFinite(parsed.getTime())
}

function isOverdue(dateValue) {
  const due = new Date(dateValue)
  const today = new Date()
  due.setHours(23, 59, 59, 999)
  return due.getTime() < today.getTime()
}

function validateEntry(entry, index, knownTestIds) {
  const requiredFields = ['testId', 'owner', 'duePlan', 'dueDate', 'replacementTestId', 'milestone']
  const errors = []
  for (const field of requiredFields) {
    if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
      errors.push(`[${index}] missing required field: ${field}`)
    }
  }
  if (errors.length > 0) return errors

  if (!entry.duePlan.startsWith(PHASE_MILESTONE)) {
    errors.push(`[${index}] duePlan must target current milestone phase (expected prefix "${PHASE_MILESTONE}"): ${entry.duePlan}`)
  }

  if (!isValidDate(entry.dueDate)) {
    errors.push(`[${index}] dueDate is not a valid date: ${entry.dueDate}`)
  } else if (isOverdue(entry.dueDate)) {
    errors.push(`[${index}] quarantine overdue: ${entry.testId} (dueDate=${entry.dueDate})`)
  }

  if (entry.replacementTestId === entry.testId) {
    errors.push(`[${index}] replacementTestId must differ from testId: ${entry.testId}`)
  }

  if (!knownTestIds.has(entry.replacementTestId)) {
    errors.push(`[${index}] replacement test not found (equivalent replacement required): ${entry.replacementTestId}`)
  }

  return errors
}

function main() {
  if (!fs.existsSync(registryPath)) {
    console.error(`[quarantine-check] missing registry: ${registryPath}`)
    process.exit(1)
  }

  const registry = readJson(registryPath)
  if (!Array.isArray(registry.entries)) {
    console.error('[quarantine-check] invalid registry: entries must be an array')
    process.exit(1)
  }

  const knownTestIds = collectKnownTestIds()
  const allErrors = registry.entries.flatMap((entry, index) => validateEntry(entry, index, knownTestIds))

  if (allErrors.length > 0) {
    console.error('[quarantine-check] policy violation(s) detected:')
    for (const error of allErrors) {
      console.error(`- ${error}`)
    }
    process.exit(1)
  }

  console.log(`[quarantine-check] passed (${registry.entries.length} quarantine entries)`)
}

main()
