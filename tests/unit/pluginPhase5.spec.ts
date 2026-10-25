// 插件化阶段 5：对第三方开放——权限、授权、按发布者隔离进程、可执行文件插件、密钥、崩溃退避。
// 设计依据：docs/插件架构设计稿.md §2.2、§4.1、§8、§11 阶段 5。
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync, cpSync } from 'node:fs'
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import AdmZip from 'adm-zip'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { validatePluginManifest } from '../../src/shared/plugin/manifest'
import { isHostAllowed, isValidPermission, requestedPermissions, hasPermission } from '../../src/shared/plugin/permissions'
import { createInMemoryTransportPair, RpcErrorCode, type RpcTransport } from '../../src/shared/plugin/rpc'
import { encodeFrame, FrameDecoder, createStdioTransport } from '../../src/shared/plugin/stdioTransport'
import { PluginHostRuntime } from '../../src/main/plugins/pluginHostRuntime'
import { PluginInstaller } from '../../src/main/plugins/pluginInstaller'
import type { LibraryPackageEntry } from '../../src/shared/library-store'
import { PluginService, MAX_HOST_CRASHES, type PluginHostConnection, type PluginHostSpec, type PluginServiceOptions } from '../../src/main/plugins/pluginService'

function manifest(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, displayName: id, version: '1.0.0', publisher: id.split('.')[0], ...extra }
}

describe('权限声明', () => {
  it('只认已知权限与 net:<域名>；可执行文件插件额外需要 runtime:executable 授权', () => {
    expect(['workspace:read', 'documents:write', 'net:api.example.com', 'net:*.example.com', 'net:*'].every(isValidPermission)).toBe(true)
    expect(['fs:all', 'net:', 'net:http://x.com', 'net:exa mple.com', 42].some(isValidPermission)).toBe(false)
    const bad = validatePluginManifest(manifest('acme.x', { permissions: ['workspace:read', 'root'] }))
    expect(bad.ok ? [] : bad.errors).toEqual(['未知的权限：root'])
    expect(requestedPermissions({ permissions: ['net:a.com', 'workspace:read', 'net:a.com'], runtime: { type: 'executable' } }))
      .toEqual(['net:a.com', 'runtime:executable', 'workspace:read'])
  })

  it('net 权限按域名匹配：*.a.com 含 a.com 与子域名，net:* 放行全部', () => {
    expect(isHostAllowed('api.a.com', ['net:api.a.com'])).toBe(true)
    expect(isHostAllowed('evil.com', ['net:api.a.com'])).toBe(false)
    expect(isHostAllowed('x.y.a.com', ['net:*.a.com'])).toBe(true)
    expect(isHostAllowed('a.com', ['net:*.a.com'])).toBe(true)
    expect(isHostAllowed('a.com.evil.com', ['net:*.a.com'])).toBe(false)
    expect(isHostAllowed('anything.org', ['net:*'])).toBe(true)
    expect(hasPermission({ builtin: true }, [], 'fs:any')).toBe(true)
  })

  it('清单校验：可执行文件插件的入口必须在插件目录内；ycide 发布者保留给官方', () => {
    const ok = validatePluginManifest(manifest('acme.tool', { runtime: { type: 'executable', command: 'bin/tool.exe', args: ['--stdio'] } }))
    expect(ok.ok).toBe(true)
    const escape = validatePluginManifest(manifest('acme.tool', { runtime: { type: 'executable', command: '../../evil.exe' } }))
    expect(escape.ok ? [] : escape.errors).toEqual(['runtime.type 为 executable 时需要插件目录内的 runtime.command'])
    const reserved = validatePluginManifest(manifest('ycide.fake'))
    expect(reserved.ok ? [] : reserved.errors).toEqual(['发布者 ycide 保留给官方内置插件'])
  })
})

describe('stdio 分帧（可执行文件插件）', () => {
  it('按 Content-Length 拆包：跨块、粘包、多字节字符都能正确还原；坏消息报错后继续', () => {
    const got: unknown[] = []
    const errors: string[] = []
    const decoder = new FrameDecoder(m => got.push(m), e => errors.push(e.message))
    const a = encodeFrame({ jsonrpc: '2.0', method: '中文消息', params: { text: '易语言🙂' } })
    const b = encodeFrame({ jsonrpc: '2.0', id: 1, result: 42 })
    const all = Buffer.concat([a, b])
    for (let i = 0; i < all.length; i += 7) decoder.push(all.subarray(i, i + 7))
    expect(got).toEqual([{ jsonrpc: '2.0', method: '中文消息', params: { text: '易语言🙂' } }, { jsonrpc: '2.0', id: 1, result: 42 }])
    decoder.push(Buffer.from('Content-Length: 3\r\n\r\n{x}'))
    decoder.push(Buffer.from('Content-Type: x\r\nContent-Length: 2\r\n\r\n[]'))
    expect(errors).toHaveLength(1)
    expect(got[2]).toEqual([])
    decoder.push(Buffer.from('Bad-Header: 1\r\n\r\n'))
    expect(errors[1]).toMatch(/Content-Length/)
  })
})

interface Harness {
  service: PluginService
  root: string
  pluginsDir: string
  specs: PluginHostSpec[]
  /** 每个已启动进程插件侧的传输（模拟插件代码直接发原始消息） */
  pluginSides: Map<string, RpcTransport>
  exits: Map<string, (code: number | null) => void>
  hostCalls: string[]
}

const roots: string[] = []
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })

function writePlugin(dir: string, m: Record<string, unknown>, main?: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(m))
  if (main !== undefined) writeFileSync(join(dir, 'main.js'), main)
}

function createHarness(setup: (pluginsDir: string) => void, overrides: Partial<PluginServiceOptions> = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'ycide-phase5-'))
  roots.push(root)
  const pluginsDir = join(root, 'plugins')
  mkdirSync(pluginsDir)
  setup(pluginsDir)
  const specs: PluginHostSpec[] = []
  const pluginSides = new Map<string, RpcTransport>()
  const exits = new Map<string, (code: number | null) => void>()
  const hostCalls: string[] = []
  const secrets = new Map<string, string>()
  const service = new PluginService({
    builtinCandidates: [],
    pluginDirs: [pluginsDir],
    statePath: join(root, 'state.json'),
    storageRoot: join(root, 'storage'),
    platform: 'windows',
    host: 'electron',
    spawnHost: (spec): PluginHostConnection => {
      specs.push(spec)
      const [hostSide, pluginSide] = createInMemoryTransportPair()
      const runtime = new PluginHostRuntime(pluginSide)
      pluginSides.set(spec.key, pluginSide)
      let onExit: ((code: number | null) => void) | null = null
      exits.set(spec.key, code => { runtime.dispose(); onExit?.(code) })
      return { transport: hostSide, onExit: l => { onExit = l }, kill: () => runtime.dispose() }
    },
    executeHostCommand: async command => { hostCalls.push(command); return `host:${command}` },
    showMessage: () => undefined,
    onDidChange: () => undefined,
    secrets: {
      get: (id, key) => secrets.get(`${id}/${key}`),
      store: (id, key, value) => { secrets.set(`${id}/${key}`, value) },
      delete: (id, key) => { secrets.delete(`${id}/${key}`) },
    },
    log: () => undefined,
    ...overrides,
  })
  return { service, root, pluginsDir, specs, pluginSides, exits, hostCalls }
}

/** 一个调用宿主能力的插件：命令 <id>:run 依次尝试读文档、执行内置命令、读写密钥，返回每一步的结果 */
const PROBE_MAIN = `
exports.activate = (context, ycide) => {
  const name = context.pluginId.split('.')[1]
  context.subscriptions.push(ycide.commands.registerCommand(name + ':run', async () => {
    const out = {}
    const attempt = async (label, fn) => { try { out[label] = await fn() } catch (e) { out[label] = 'DENIED:' + e.code } }
    await attempt('read', () => ycide.documents.getText('a.eyc'))
    await attempt('workbench', () => ycide.commands.executeCommand('file:save'))
    await attempt('secretStore', () => ycide.secrets.store('token', name + '-secret'))
    await attempt('secretGet', () => ycide.secrets.get('token'))
    out.storagePath = context.storagePath
    return out
  }))
}
`

function probePlugin(id: string, permissions: string[]): Record<string, unknown> {
  const name = id.split('.')[1]
  return manifest(id, {
    runtime: { type: 'node', main: 'main.js' },
    permissions,
    contributes: { commands: [{ id: `${name}:run`, title: 'run' }] },
  })
}

describe('授权与权限检查', () => {
  it('申请了权限的第三方插件先「等待授权」，同意后启用；收回后回到等待授权', async () => {
    const h = createHarness(dir => writePlugin(join(dir, 'p'), probePlugin('acme.probe', ['workspace:read']), PROBE_MAIN))
    await h.service.start()
    let info = h.service.getState().plugins.find(p => p.id === 'acme.probe')!
    expect([info.status, info.needsConsent, info.permissions, info.processKind]).toEqual(['disabled', true, ['workspace:read'], 'sandboxed'])
    expect(info.reason).toMatch(/等待授权/)
    // 等待授权的插件不贡献命令，也不会被激活
    expect(h.service.isPluginCommand('probe:run')).toBe(false)
    expect(h.specs).toEqual([])

    await h.service.grantPermissions('acme.probe')
    info = h.service.getState().plugins.find(p => p.id === 'acme.probe')!
    expect([info.status, info.needsConsent]).toEqual(['enabled', false])
    expect(JSON.parse(readFileSync(join(h.root, 'state.json'), 'utf-8')).granted).toEqual({ 'acme.probe': ['workspace:read'] })

    await h.service.revokePermissions('acme.probe')
    expect(h.service.getState().plugins.find(p => p.id === 'acme.probe')!.needsConsent).toBe(true)
  })

  it('越权请求返回 -33001：只同意了读文档的插件不能执行内置命令、不能用密钥；存储目录只属于自己', async () => {
    const h = createHarness(dir => {
      writePlugin(join(dir, 'a'), probePlugin('acme.reader', ['workspace:read']), PROBE_MAIN)
      writePlugin(join(dir, 'b'), probePlugin('acme.full', ['workspace:read', 'workbench:commands', 'secrets:own']), PROBE_MAIN)
    })
    await h.service.start()
    await h.service.grantPermissions('acme.reader')
    await h.service.grantPermissions('acme.full')
    const reader = await h.service.executeCommand('reader:run') as Record<string, unknown>
    expect(reader).toMatchObject({ read: 'host:documents:getText', workbench: `DENIED:${RpcErrorCode.PermissionDenied}`, secretStore: `DENIED:${RpcErrorCode.PermissionDenied}` })
    expect(reader.storagePath).toBe(join(h.root, 'storage', 'acme.reader'))
    const full = await h.service.executeCommand('full:run') as Record<string, unknown>
    expect(full).toMatchObject({ read: 'host:documents:getText', workbench: 'host:file:save', secretGet: 'full-secret' })
    expect(h.hostCalls).toEqual(['documents:getText', 'documents:getText', 'file:save'])
  })

  it('同一发布者的插件共用一个受限进程（目录、权限取并集），不同发布者各自一个进程', async () => {
    const h = createHarness(dir => {
      writePlugin(join(dir, 'a1'), probePlugin('acme.one', []), PROBE_MAIN)
      writePlugin(join(dir, 'a2'), probePlugin('acme.two', ['net:api.acme.com']), PROBE_MAIN)
      writePlugin(join(dir, 'z'), probePlugin('zeta.other', []), PROBE_MAIN)
    })
    await h.service.start()
    await h.service.grantPermissions('acme.two')
    await h.service.executeCommand('one:run')
    await h.service.executeCommand('two:run')
    await h.service.executeCommand('other:run')
    expect(h.specs.map(s => [s.key, s.kind])).toEqual([['publisher:acme', 'sandboxed'], ['publisher:zeta', 'sandboxed']])
    expect(h.specs[0].pluginDirs).toEqual([join(h.pluginsDir, 'a1'), join(h.pluginsDir, 'a2')])
    expect(h.specs[0].storageDirs).toEqual([join(h.root, 'storage', 'acme.one'), join(h.root, 'storage', 'acme.two')])
    expect(h.specs[0].permissions).toEqual(['net:api.acme.com'])
  })

  it('插件冒充别的发布者的插件发请求会被拒绝（宿主核对插件确实在发请求的进程里）', async () => {
    const h = createHarness(dir => {
      writePlugin(join(dir, 'evil'), probePlugin('evil.probe', []), PROBE_MAIN)
      writePlugin(join(dir, 'good'), probePlugin('good.probe', ['workspace:read']), PROBE_MAIN)
    })
    await h.service.start()
    await h.service.grantPermissions('good.probe')
    await h.service.executeCommand('probe:run').catch(() => undefined)
    const evilSide = h.pluginSides.get('publisher:evil')!
    const response = new Promise<unknown>(resolve => {
      const off = evilSide.onMessage(m => { if ((m as { id?: unknown }).id === 'forged') { off(); resolve(m) } })
    })
    evilSide.send({ jsonrpc: '2.0', id: 'forged', method: 'commands/executeHost', params: { pluginId: 'good.probe', command: 'documents:getText', args: ['secret.eyc'] } })
    expect(((await response) as { error?: { code: number } }).error?.code).toBe(RpcErrorCode.PermissionDenied)
    expect(h.hostCalls).not.toContain('documents:getText')
  })
})

describe('插件进程崩溃', () => {
  it(`5 分钟内崩溃 ${MAX_HOST_CRASHES} 次后不再拉起，重新加载插件后恢复`, async () => {
    const h = createHarness(dir => writePlugin(join(dir, 'p'), probePlugin('acme.crashy', []), PROBE_MAIN))
    await h.service.start()
    for (let i = 0; i < MAX_HOST_CRASHES; i++) {
      await h.service.executeCommand('crashy:run')
      h.exits.get('publisher:acme')!(1)
    }
    await expect(h.service.executeCommand('crashy:run')).rejects.toThrow(/反复崩溃/)
    await h.service.reload()
    await expect(h.service.executeCommand('crashy:run')).resolves.toBeTruthy()
  })
})

// 用 Node 脚本模拟一个可执行文件插件：只会 stdio + Content-Length 分帧的 JSON-RPC，不依赖任何 ycIDE 代码
const EXE_PLUGIN_SOURCE = `
let buf = Buffer.alloc(0)
const send = m => { const b = Buffer.from(JSON.stringify(m)); process.stdout.write('Content-Length: ' + b.length + '\\r\\n\\r\\n'); process.stdout.write(b) }
let nextId = 1000
const pending = new Map()
const call = (method, params) => new Promise(r => { const id = nextId++; pending.set(id, r); send({ jsonrpc: '2.0', id, method, params }) })
process.stdin.on('data', chunk => {
  buf = Buffer.concat([buf, chunk])
  for (;;) {
    const end = buf.indexOf('\\r\\n\\r\\n'); if (end < 0) return
    const len = Number(/Content-Length: (\\d+)/i.exec(buf.subarray(0, end).toString())[1])
    if (buf.length < end + 4 + len) return
    const msg = JSON.parse(buf.subarray(end + 4, end + 4 + len).toString()); buf = buf.subarray(end + 4 + len)
    if (msg.id !== undefined && msg.method === undefined) { pending.get(msg.id)?.(msg); continue }
    const reply = result => send({ jsonrpc: '2.0', id: msg.id, result })
    if (msg.method === 'initialize') reply({ protocolVersion: '0.2' })
    else if (msg.method === 'plugin/activate') reply({ commands: [] })
    else if (msg.method === 'commands/execute') {
      send({ jsonrpc: '2.0', method: 'window/showMessage', params: { type: 'info', message: '来自可执行文件插件' } })
      call('commands/executeHost', { command: 'documents:getText', args: ['x'] }).then(res => reply({ upper: String(msg.params.args[0]).toUpperCase(), host: res.error ? 'DENIED:' + res.error.code : res.result }))
    } else if (msg.method === 'shutdown') { reply(null); setTimeout(() => process.exit(0), 10) }
    else if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'no' } })
  }
})
`

describe('可执行文件插件（stdio + JSON-RPC）', () => {
  it('宿主经 stdio 激活它、登记它声明的命令、转发命令；它调用宿主能力同样受权限检查', async () => {
    const messages: string[] = []
    const h = createHarness(dir => {
      writePlugin(join(dir, 'exe'), manifest('acme.native', {
        runtime: { type: 'executable', command: 'plugin.js' },
        contributes: { commands: [{ id: 'native:upper', title: 'upper' }] },
      }))
      writeFileSync(join(dir, 'exe', 'plugin.js'), EXE_PLUGIN_SOURCE)
    }, {
      // 测试里用 node 运行脚本代替原生可执行文件
      spawnHost: (spec): PluginHostConnection => {
        const child = spawn(process.execPath, [spec.command!], { cwd: spec.cwd, stdio: ['pipe', 'pipe', 'inherit'] })
        return {
          transport: createStdioTransport(child.stdout!, child.stdin!),
          onExit: l => { child.on('exit', l) },
          kill: () => { child.kill() },
        }
      },
      showMessage: p => messages.push(`${p.pluginId}:${p.message}`),
    })
    await h.service.start()
    const info = h.service.getState().plugins.find(p => p.id === 'acme.native')!
    expect([info.needsConsent, info.permissions, info.processKind]).toEqual([true, ['runtime:executable'], 'executable'])
    await h.service.grantPermissions('acme.native')
    const result = await h.service.executeCommand('native:upper', ['hello'])
    expect(result).toEqual({ upper: 'HELLO', host: `DENIED:${RpcErrorCode.PermissionDenied}` })
    expect(messages).toEqual(['acme.native:来自可执行文件插件'])
    await h.service.shutdown()
  }, 20000)
})

describe('商店安装插件', () => {
  function makeZip(files: Record<string, string>): Buffer {
    const zip = new AdmZip()
    for (const [name, content] of Object.entries(files)) zip.addFile(name, Buffer.from(content, 'utf-8'))
    return zip.toBuffer()
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  const sign = (buffer: Buffer): string => cryptoSign(null, Buffer.from(createHash('sha256').update(buffer).digest('hex')), privateKey).toString('base64')

  function setup() {
    const h = createHarness(() => undefined)
    const installer = new PluginInstaller({
      userPluginsDir: join(h.root, 'user-plugins'),
      publishersFile: join(h.root, 'publishers.json'),
      service: h.service,
      fetchIndex: async () => ({ ok: false, error: 'unused' }),
      download: async () => Buffer.alloc(0),
    })
    return { h, installer }
  }
  const pluginZip = (): Buffer => makeZip({
    'plugin.json': JSON.stringify(probePlugin('acme.store', ['workspace:read'])),
    'main.js': PROBE_MAIN,
  })
  const entryFor = (buffer: Buffer, extra: Partial<LibraryPackageEntry> = {}): LibraryPackageEntry => ({
    id: 'acme.store', kind: 'plugin', displayName: 'Store', version: '1.0.0', packageFileName: 'a.zip', packageUrl: 'https://x/a.zip',
    packageSha256: createHash('sha256').update(buffer).digest('hex'), supportedPlatforms: ['windows'], publisher: 'acme', permissions: ['workspace:read'],
    signature: sign(buffer), ...extra,
  })

  it('签名正确、权限经确认：安装到用户插件目录、记录授权、固定发布者公钥', async () => {
    const { h, installer } = setup()
    const zip = pluginZip()
    const result = await installer.installPackage(entryFor(zip), zip, { publishers: { acme: publicKeyBase64 } }, { permissions: ['workspace:read'] })
    expect(result).toEqual({ ok: true, id: 'acme.store', permissions: ['workspace:read'] })
    expect(readFileSync(join(h.root, 'user-plugins', 'acme.store', 'main.js'), 'utf-8')).toBe(PROBE_MAIN)
    expect(JSON.parse(readFileSync(join(h.root, 'state.json'), 'utf-8')).granted).toEqual({ 'acme.store': ['workspace:read'] })
    expect(JSON.parse(readFileSync(join(h.root, 'publishers.json'), 'utf-8'))).toEqual({ acme: publicKeyBase64 })
  })

  it('篡改的包、签名不对、发布者公钥被换、未签名未同意、权限超出确认范围、主题带代码、ID 不符、路径穿越：全部拒绝且不留文件', async () => {
    const { h, installer } = setup()
    const zip = pluginZip()
    const publishers = { publishers: { acme: publicKeyBase64 } }
    const consent = { permissions: ['workspace:read'] }
    const tampered = await installer.installPackage(entryFor(zip, { packageSha256: 'ab'.repeat(32) }), zip, publishers, consent)
    expect(tampered.ok ? '' : tampered.error).toMatch(/校验失败/)
    const badSig = await installer.installPackage(entryFor(zip, { signature: sign(Buffer.from('other')) }), zip, publishers, consent)
    expect(badSig.ok ? '' : badSig.error).toMatch(/签名校验失败/)
    // 先成功安装一次，固定公钥；之后索引里的公钥被换成别的，拒绝
    expect((await installer.installPackage(entryFor(zip), zip, publishers, consent)).ok).toBe(true)
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    const swapped = await installer.installPackage(entryFor(zip), zip, { publishers: { acme: other } }, consent)
    expect(swapped.ok ? '' : swapped.error).toMatch(/公钥与本机之前记录的不一致/)
    const unsigned = await installer.installPackage(entryFor(zip, { signature: undefined }), zip, publishers, consent)
    expect(unsigned.ok ? '' : unsigned.error).toMatch(/没有发布者签名/)
    expect((await installer.installPackage(entryFor(zip, { signature: undefined }), zip, publishers, { ...consent, allowUnsigned: true })).ok).toBe(true)
    const tooMuch = await installer.installPackage(entryFor(zip), zip, publishers, { permissions: [] })
    expect(tooMuch.ok ? '' : tooMuch.error).toMatch(/未经你确认的权限：workspace:read/)
    const themeZip = makeZip({ 'plugin.json': JSON.stringify(probePlugin('acme.store', [])), 'main.js': '' })
    const theme = await installer.installPackage(entryFor(themeZip, { kind: 'theme' }), themeZip, publishers, consent)
    expect(theme.ok ? '' : theme.error).toMatch(/主题包不能带代码/)
    const wrongId = makeZip({ 'plugin.json': JSON.stringify(probePlugin('acme.other', [])), 'main.js': '' })
    const mismatch = await installer.installPackage(entryFor(wrongId), wrongId, publishers, consent)
    expect(mismatch.ok ? '' : mismatch.error).toMatch(/不一致/)
    const evilZip = makeZip({ 'plugin.json': '{}' })
    // adm-zip 的 addFile 会规范化路径，这里手工改条目名制造穿越
    const evilArchive = new AdmZip(evilZip)
    evilArchive.getEntries()[0].entryName = '../escape.txt'
    const evilBuffer = evilArchive.toBuffer()
    const evil = await installer.installPackage(entryFor(evilBuffer), evilBuffer, publishers, consent)
    expect(evil.ok ? '' : evil.error).toMatch(/不安全路径|越界/)
    expect(readdirSync(join(h.root, 'user-plugins')).filter(n => n.startsWith('.install-'))).toEqual([])
    expect(existsSync(join(h.root, 'escape.txt'))).toBe(false)
  })

  it('用户插件目录里的插件可以卸载：卸下进程、删除目录、清掉授权', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ycide-uninstall-'))
    roots.push(root)
    const userDir = join(root, 'user-plugins')
    writePlugin(join(userDir, 'acme.store'), probePlugin('acme.store', ['workspace:read']), PROBE_MAIN)
    const h = createHarness(() => undefined, { pluginDirs: [userDir], userPluginsDir: userDir })
    const installer = new PluginInstaller({ userPluginsDir: userDir, publishersFile: join(root, 'p.json'), service: h.service, fetchIndex: async () => ({ ok: false, error: '' }), download: async () => Buffer.alloc(0) })
    await h.service.start()
    await h.service.grantPermissions('acme.store')
    await h.service.executeCommand('store:run')
    expect(h.service.getState().plugins.find(p => p.id === 'acme.store')?.removable).toBe(true)
    expect(await installer.uninstall('acme.store')).toEqual({ ok: true, id: 'acme.store', permissions: [] })
    expect(existsSync(join(userDir, 'acme.store'))).toBe(false)
    expect(h.service.getState().plugins.find(p => p.id === 'acme.store')).toBeUndefined()
    expect(JSON.parse(readFileSync(join(h.root, 'state.json'), 'utf-8')).granted).toEqual({})
  })
})

describe('JS 插件模板', () => {
  it('模板插件在受限进程里激活，命令读取文档并返回行数', async () => {
    const h = createHarness(dir => cpSync(join(__dirname, '..', '..', 'templates', 'plugins', 'js-hello'), join(dir, 'hello'), { recursive: true }), {
      executeHostCommand: async () => '一\n二\n三',
    })
    await h.service.start()
    await h.service.grantPermissions('yourname.hello')
    expect(await h.service.executeCommand('hello:countLines', [{ path: 'a.eyc' }])).toBe(3)
  })
})
