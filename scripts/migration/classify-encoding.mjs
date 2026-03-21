import fs from 'node:fs/promises'
import path from 'node:path'

const TEXT_EXTS = new Set([
  '.txt', '.md', '.json', '.xml', '.ini', '.cfg', '.h', '.hpp', '.c', '.cc', '.cpp',
  '.def', '.asm', '.eyc', '.ecs', '.efw', '.edt', '.epp', '.epl', '.eprj'
])
const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'dist', 'test-results'])

export async function classifyEncodingState(libraryDir) {
  let hasUtf8 = false
  let hasGbk = false
  let hasUnknown = false

  await walkLibraryFiles(libraryDir, async (filePath) => {
    if (!TEXT_EXTS.has(path.extname(filePath).toLowerCase())) return
    const buffer = await fs.readFile(filePath)
    if (buffer.length === 0) return

    const classification = classifyFileEncoding(buffer)
    if (classification === 'utf-8') hasUtf8 = true
    else if (classification === 'gbk') hasGbk = true
    else hasUnknown = true
  })

  if (hasUnknown) return 'mixed'
  if (hasUtf8 && hasGbk) return 'mixed'
  if (hasUtf8) return 'utf-8'
  if (hasGbk) return 'gbk'
  return 'mixed'
}

function classifyFileEncoding(buffer) {
  if (hasUtf8Bom(buffer)) return 'utf-8'
  if (isValidUtf8(buffer)) return 'utf-8'
  if (looksLikeGbk(buffer)) return 'gbk'
  return 'mixed'
}

function hasUtf8Bom(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
}

function isValidUtf8(buffer) {
  let i = 0
  while (i < buffer.length) {
    const byte1 = buffer[i]
    if (byte1 <= 0x7f) {
      i += 1
      continue
    }
    if (byte1 >= 0xc2 && byte1 <= 0xdf) {
      if (i + 1 >= buffer.length || !isContinuation(buffer[i + 1])) return false
      i += 2
      continue
    }
    if (byte1 >= 0xe0 && byte1 <= 0xef) {
      if (i + 2 >= buffer.length) return false
      const b2 = buffer[i + 1]
      const b3 = buffer[i + 2]
      if (!isContinuation(b2) || !isContinuation(b3)) return false
      if (byte1 === 0xe0 && b2 < 0xa0) return false
      if (byte1 === 0xed && b2 >= 0xa0) return false
      i += 3
      continue
    }
    if (byte1 >= 0xf0 && byte1 <= 0xf4) {
      if (i + 3 >= buffer.length) return false
      const b2 = buffer[i + 1]
      const b3 = buffer[i + 2]
      const b4 = buffer[i + 3]
      if (!isContinuation(b2) || !isContinuation(b3) || !isContinuation(b4)) return false
      if (byte1 === 0xf0 && b2 < 0x90) return false
      if (byte1 === 0xf4 && b2 > 0x8f) return false
      i += 4
      continue
    }
    return false
  }
  return true
}

function looksLikeGbk(buffer) {
  let i = 0
  let multibyteCount = 0
  while (i < buffer.length) {
    const byte1 = buffer[i]
    if (byte1 <= 0x7f) {
      i += 1
      continue
    }
    if (byte1 < 0x81 || byte1 > 0xfe) return false
    if (i + 1 >= buffer.length) return false
    const byte2 = buffer[i + 1]
    const validSecond = (byte2 >= 0x40 && byte2 <= 0xfe && byte2 !== 0x7f)
    if (!validSecond) return false
    multibyteCount += 1
    i += 2
  }
  return multibyteCount > 0
}

function isContinuation(byte) {
  return byte >= 0x80 && byte <= 0xbf
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
