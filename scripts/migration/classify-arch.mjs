import fs from 'node:fs/promises'
import path from 'node:path'

const X64_HINTS = ['x64', 'amd64', 'x86_64', 'win64', '64位']
const X86_HINTS = ['x86', 'i386', 'win32', '32位']
const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'dist', 'test-results'])

export async function classifyArchitectureState(libraryDir) {
  const flags = { hasX64: false, hasX86: false }
  await walkLibraryFiles(libraryDir, async (filePath) => {
    const lower = filePath.toLowerCase()
    if (X64_HINTS.some((hint) => lower.includes(hint))) flags.hasX64 = true
    if (X86_HINTS.some((hint) => lower.includes(hint))) flags.hasX86 = true
  })

  if (flags.hasX64 && flags.hasX86) return 'mixed'
  if (flags.hasX64) return 'x64-ready'
  return 'x86-only'
}

async function walkLibraryFiles(rootDir, onFile) {
  const stack = [rootDir]
  while (stack.length > 0) {
    const current = stack.pop()
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        stack.push(path.join(current, entry.name))
        continue
      }
      if (entry.isFile()) {
        await onFile(path.join(current, entry.name))
      }
    }
  }
}
