// 核心支持库完整性校验：哈希表由 scripts/update-core-hashes.mjs 生成，换行统一为 LF 后计算。
// 本测试失败说明 lib/krnln 改过但没重新生成哈希——运行 node scripts/update-core-hashes.mjs。
import { describe, it, expect, afterEach } from 'vitest'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { libraryManager, normalizedTextSha256 } from '../../src/main/libraryManager'
import hashes from '../../src/main/coreLibraryHashes.json'

const repoRoot = resolve(__dirname, '..', '..')
const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-hash-ud-')), appVersion: 'test' })
})

describe('核心支持库完整性哈希', () => {
  it('哈希表与 lib/krnln 现有文件一致（不一致请运行 node scripts/update-core-hashes.mjs）', () => {
    const stale = Object.entries(hashes as Record<string, string>)
      .filter(([file, hash]) => normalizedTextSha256(readFileSync(join(repoRoot, 'lib', 'krnln', file))) !== hash)
      .map(([file]) => file)
    expect(stale).toEqual([])
  })

  it('换行风格不影响结果；内容被改则校验失败', () => {
    expect(normalizedTextSha256(Buffer.from('a\r\nb\r\n'))).toBe(normalizedTextSha256(Buffer.from('a\nb\n')))
    const appPath = mkdtempSync(join(tmpdir(), 'ycide-hash-'))
    roots.push(appPath)
    cpSync(join(repoRoot, 'lib'), join(appPath, 'lib'), { recursive: true })
    setRuntimeEnv({ appPath, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-hash-ud-')), appVersion: 'test' })
    libraryManager.scan()
    expect(libraryManager.checkCoreLibraryIntegrity()).toEqual({ ok: true, errors: [] })
    // CRLF ↔ LF 互换仍然通过
    const constants = join(appPath, 'lib', 'krnln', 'krnln.constants.json')
    const text = readFileSync(constants, 'utf-8')
    writeFileSync(constants, text.includes('\r\n') ? text.replace(/\r\n/g, '\n') : text.replace(/\n/g, '\r\n'))
    expect(libraryManager.checkCoreLibraryIntegrity().ok).toBe(true)
    writeFileSync(constants, text.replace('}', ' }'))
    expect(libraryManager.checkCoreLibraryIntegrity().errors).toEqual(['核心支持库文件被修改: krnln.constants.json'])
  })
})
