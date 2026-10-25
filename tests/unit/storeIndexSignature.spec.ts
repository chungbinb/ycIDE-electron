// 商店索引签名（设计稿 §8.2）：配置了可信公钥时，索引必须带有效的 <索引地址>.sig。
// 签名用 scripts/plugin-pack.mjs sign-index 生成，这里直接跑脚本，保证工具与校验一致。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { libraryManager } from '../../src/main/libraryManager'

const repoRoot = resolve(__dirname, '..', '..')
const dir = mkdtempSync(join(tmpdir(), 'ycide-index-sig-'))
const files: Record<string, Buffer | null> = {}
let server: Server
let base = ''

beforeAll(async () => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-index-ud-')), appVersion: 'test' })
  server = createServer((req, res) => {
    const body = files[req.url ?? '']
    if (!body) { res.statusCode = 404; res.end(); return }
    res.end(body)
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
  const address = server.address()
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
})
afterAll(() => {
  server.close()
  rmSync(dir, { recursive: true, force: true })
  libraryManager.setTrustedIndexKeysProvider(() => [])
})

function script(...args: string[]): string {
  return execFileSync(process.execPath, [join(repoRoot, 'scripts', 'plugin-pack.mjs'), ...args], { encoding: 'utf-8' })
}

describe('商店索引签名', () => {
  it('有可信公钥时只接受签名有效的索引；没有公钥时不校验', async () => {
    script('keygen', join(dir, 'keys'))
    const publicKey = readFileSync(join(dir, 'keys', 'publisher-public.txt'), 'utf-8').trim()
    const indexPath = join(dir, 'index.json')
    writeFileSync(indexPath, JSON.stringify({ schemaVersion: '1.0', libraries: [] }))
    script('sign-index', indexPath, '--key', join(dir, 'keys', 'publisher-private.pem'))
    files['/index.json'] = readFileSync(indexPath)
    files['/index.json.sig'] = readFileSync(`${indexPath}.sig`)

    libraryManager.setTrustedIndexKeysProvider(() => [publicKey])
    expect((await libraryManager.getRemoteIndex(`${base}/index.json`)).ok).toBe(true)

    // 索引被改
    files['/index.json'] = Buffer.from(JSON.stringify({ schemaVersion: '1.0', libraries: [], extra: 1 }))
    const tampered = await libraryManager.getRemoteIndex(`${base}/index.json`)
    expect(tampered.ok ? '' : tampered.error).toMatch(/签名校验失败/)

    // 缺签名
    files['/index.json'] = readFileSync(indexPath)
    files['/index.json.sig'] = null
    const missing = await libraryManager.getRemoteIndex(`${base}/index.json`)
    expect(missing.ok ? '' : missing.error).toMatch(/缺少签名/)

    // 没配置公钥：不校验（保持旧行为）
    libraryManager.setTrustedIndexKeysProvider(() => [])
    expect((await libraryManager.getRemoteIndex(`${base}/index.json`)).ok).toBe(true)
  }, 30000)
})
