#!/usr/bin/env node
// 重新生成核心支持库完整性哈希（src/main/coreLibraryHashes.json）。
// 改动 lib/krnln 下受校验的文件后运行：node scripts/update-core-hashes.mjs
// 哈希按「换行统一为 LF」计算，Windows（CRLF 检出）与 Linux / macOS 上结果一致。
// tests/unit/coreLibraryHashes.spec.ts 会在哈希过期时失败，提醒运行本脚本。

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const coreDir = join(repoRoot, 'lib', 'krnln')

/** 受校验的文件（相对 lib/krnln） */
export const CORE_LIBRARY_HASHED_FILES = [
  'codegen/controls.cjs',
  'codegen/window.cjs',
  'control-traits.json',
  'impl/linux.cpp',
  'impl/macos.mm',
  'impl/pinyin-table.inc',
  'impl/windows.cpp',
  'krnln.commands.ycmd.json',
  'krnln.constants.json',
  'krnln.library.json',
  'plugin.json',
  'window-units.json',
]

export function normalizedSha256(buffer) {
  return createHash('sha256').update(buffer.toString('utf-8').replace(/\r\n/g, '\n'), 'utf-8').digest('hex')
}

const hashes = Object.fromEntries(CORE_LIBRARY_HASHED_FILES.map(file => [file, normalizedSha256(readFileSync(join(coreDir, file)))]))
const out = join(repoRoot, 'src', 'main', 'coreLibraryHashes.json')
writeFileSync(out, JSON.stringify(hashes, null, 2) + '\n', 'utf-8')
console.log(`已更新 ${out}（${CORE_LIBRARY_HASHED_FILES.length} 个文件）`)
