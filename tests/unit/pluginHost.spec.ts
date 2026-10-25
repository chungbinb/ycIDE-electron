// 插件化阶段 0：JSON-RPC 通道、插件宿主进程运行时、宿主侧插件服务。
// 插件宿主进程用内存管道在同一进程里模拟（真实进程由 tests/ui/plugin-commands.spec.js 覆盖）。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { RpcError, RpcErrorCode, RpcPeer, createInMemoryTransportPair } from '../../src/shared/plugin/rpc'
import { PluginHostRuntime } from '../../src/main/plugins/pluginHostRuntime'
import { PluginService, type PluginHostConnection, type PluginServiceOptions } from '../../src/main/plugins/pluginService'
import { BUILTIN_PLUGIN_CANDIDATES } from '../../src/shared/plugin/builtinPlugins'
import type { ShowMessageParams } from '../../src/main/plugins/pluginProtocol'

const demoPluginDir = resolve(__dirname, '..', 'fixtures', 'plugins', 'demo.hello')

describe('JSON-RPC 通道', () => {
  it('请求 / 响应、通知、错误码、未知方法', async () => {
    const [a, b] = createInMemoryTransportPair()
    const client = new RpcPeer(a)
    const server = new RpcPeer(b)
    server.onRequest('math/add', params => {
      const { x, y } = params as { x: number; y: number }
      return x + y
    })
    server.onRequest('fail', () => { throw new RpcError(RpcErrorCode.PermissionDenied, '无权限') })
    const notified = vi.fn()
    server.onNotification('log', notified)

    expect(await client.request('math/add', { x: 1, y: 2 })).toBe(3)
    await expect(client.request('fail')).rejects.toMatchObject({ code: RpcErrorCode.PermissionDenied, message: '无权限' })
    await expect(client.request('nope')).rejects.toMatchObject({ code: RpcErrorCode.MethodNotFound })
    client.notify('log', { text: 'hi' })
    await new Promise(r => setTimeout(r, 0))
    expect(notified).toHaveBeenCalledWith({ text: 'hi' })
  })

  it('超时与关闭连接时未完成的请求以错误结束', async () => {
    const [a, b] = createInMemoryTransportPair()
    const client = new RpcPeer(a)
    const server = new RpcPeer(b)
    server.onRequest('slow', () => new Promise(() => undefined))
    await expect(client.request('slow', undefined, 20)).rejects.toMatchObject({ code: RpcErrorCode.Timeout })
    const pending = client.request('slow', undefined, 0)
    client.dispose('测试关闭')
    await expect(pending).rejects.toThrow('测试关闭')
  })
})

interface Harness {
  service: PluginService
  messages: ShowMessageParams[]
  hostCommandCalls: Array<{ command: string; args: unknown[] }>
  spawnCount: () => number
  crashHost: () => void
  changes: () => number
  root: string
}

const harnesses: Harness[] = []

function writePlugin(dir: string, manifest: Record<string, unknown>, mainSource?: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2))
  if (mainSource !== undefined) writeFileSync(join(dir, 'main.js'), mainSource)
}

function createHarness(setup: (pluginsDir: string) => void, overrides: Partial<PluginServiceOptions> = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'ycide-plugins-'))
  const pluginsDir = join(root, 'plugins')
  mkdirSync(pluginsDir)
  setup(pluginsDir)
  const messages: ShowMessageParams[] = []
  const hostCommandCalls: Array<{ command: string; args: unknown[] }> = []
  let spawned = 0
  let changes = 0
  let killCurrent: (() => void) | null = null
  const service = new PluginService({
    builtinCandidates: BUILTIN_PLUGIN_CANDIDATES,
    pluginDirs: [pluginsDir],
    // 测试插件按开发目录处理：权限视同已授权（授权流程见 pluginPhase5.spec.ts）
    devDirs: [pluginsDir],
    statePath: join(root, 'plugin-state.json'),
    platform: 'windows',
    host: 'electron',
    spawnHost: (): PluginHostConnection => {
      spawned++
      const [hostSide, pluginSide] = createInMemoryTransportPair()
      const runtime = new PluginHostRuntime(pluginSide)
      const exitListeners: Array<(code: number | null) => void> = []
      killCurrent = () => {
        runtime.dispose()
        exitListeners.forEach(l => l(1))
      }
      return {
        transport: hostSide,
        onExit: l => { exitListeners.push(l) },
        kill: () => runtime.dispose(),
      }
    },
    executeHostCommand: async (command, args) => {
      hostCommandCalls.push({ command, args })
      return `host:${command}`
    },
    showMessage: params => { messages.push(params) },
    onDidChange: () => { changes++ },
    log: () => undefined,
    ...overrides,
  })
  const harness: Harness = {
    service,
    messages,
    hostCommandCalls,
    spawnCount: () => spawned,
    crashHost: () => killCurrent?.(),
    changes: () => changes,
    root,
  }
  harnesses.push(harness)
  return harness
}

afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    await h.service.shutdown()
    rmSync(h.root, { recursive: true, force: true })
  }
})

function statusOf(h: Harness, id: string): { status: string; reason?: string } | undefined {
  return h.service.getState().plugins.find(p => p.id === id)
}

describe('插件服务：扫描与解析', () => {
  it('扫描用户插件目录：合法插件启用，平台不符、入口缺失、JSON 损坏、入口越界都报出原因', async () => {
    const h = createHarness(dir => {
      cpSync(demoPluginDir, join(dir, 'demo.hello'), { recursive: true })
      writePlugin(join(dir, 'linux-only'), { id: 'demo.linux-only', displayName: 'L', version: '1.0.0', publisher: 'demo', platforms: ['linux'] })
      writePlugin(join(dir, 'no-main'), { id: 'demo.no-main', displayName: 'N', version: '1.0.0', publisher: 'demo', runtime: { type: 'node', main: 'main.js' } })
      writePlugin(join(dir, 'escape'), { id: 'demo.escape', displayName: 'E', version: '1.0.0', publisher: 'demo', runtime: { type: 'node', main: '../outside.js' } })
      mkdirSync(join(dir, 'broken'))
      writeFileSync(join(dir, 'broken', 'plugin.json'), '{ not json')
    })
    await h.service.start()
    expect(statusOf(h, 'demo.hello')?.status).toBe('enabled')
    expect(statusOf(h, 'demo.linux-only')).toMatchObject({ status: 'unavailable', reason: expect.stringMatching(/当前平台不可用/) })
    expect(statusOf(h, 'demo.no-main')).toMatchObject({ status: 'error', reason: expect.stringMatching(/入口文件不存在/) })
    expect(statusOf(h, 'demo.escape')).toMatchObject({ status: 'error', reason: expect.stringMatching(/必须位于插件目录内/) })
    expect(statusOf(h, 'broken')).toMatchObject({ status: 'error', reason: expect.stringMatching(/不是合法 JSON/) })
    // 插件贡献的菜单项并入内置插件声明的「工具」菜单
    const tools = h.service.getModel().menubar.find(m => m.id === 'tools')!
    expect(tools.items.map(i => i.command)).toContain('hello:greet')
    // 懒加载：只是扫描，不启动插件进程
    expect(h.spawnCount()).toBe(0)
  })
})

describe('插件服务：激活、命令路由、停用', () => {
  it('执行插件命令时自动激活插件，消息与内置命令调用经宿主转发', async () => {
    const h = createHarness(dir => cpSync(demoPluginDir, join(dir, 'demo.hello'), { recursive: true }))
    await h.service.start()
    expect(h.service.isPluginCommand('hello:greet')).toBe(true)
    expect(h.service.isPluginCommand('file:save')).toBe(false)

    expect(await h.service.executeCommand('hello:greet', ['张三'])).toBe('你好，张三！（第 1 次，来自示例插件）')
    expect(h.spawnCount()).toBe(1)
    expect(h.messages).toEqual([{ pluginId: 'demo.hello', type: 'success', message: '你好，张三！（第 1 次，来自示例插件）' }])
    expect(h.service.getState().plugins.find(p => p.id === 'demo.hello')?.active).toBe(true)

    // 插件调用内置命令 → 交给宿主（渲染进程）执行
    expect(await h.service.executeCommand('hello:openAbout')).toBe('about-opened')
    expect(h.hostCommandCalls).toEqual([{ command: 'help:about', args: [] }])

    // 内置命令不经过插件进程
    expect(await h.service.executeCommand('file:save')).toBe('host:file:save')
  })

  it('停用插件：调用 deactivate、注销命令、持久化；核心插件不能停用', async () => {
    const h = createHarness(dir => cpSync(demoPluginDir, join(dir, 'demo.hello'), { recursive: true }))
    await h.service.start()
    await h.service.executeCommand('hello:greet')
    await h.service.setEnabled('demo.hello', false)

    expect(statusOf(h, 'demo.hello')).toMatchObject({ status: 'disabled' })
    expect(h.service.isPluginCommand('hello:greet')).toBe(false)
    expect(h.service.getModel().commands.has('hello:greet')).toBe(false)
    expect(JSON.parse(readFileSync(join(h.root, 'plugin-state.json'), 'utf-8'))).toEqual({ disabled: ['demo.hello'], granted: {} })

    // 重新启用后从头激活（deactivate 已把计数清零）
    await h.service.setEnabled('demo.hello', true)
    expect(await h.service.executeCommand('hello:greet')).toMatch(/第 1 次/)

    await expect(h.service.setEnabled('ycide.workbench', false)).rejects.toThrow(/核心插件/)
    await expect(h.service.setEnabled('ycide.project', false)).rejects.toThrow(/核心插件/)
  })

  it('停用内置插件 ycide.build 会连带让依赖它的 ycide.debug 不可用，菜单随之移除', async () => {
    const h = createHarness(() => undefined)
    await h.service.start()
    await h.service.setEnabled('ycide.build', false)
    expect(statusOf(h, 'ycide.debug')).toMatchObject({ status: 'unavailable', reason: '依赖插件 ycide.build 已停用' })
    expect(h.service.getModel().menubar.map(m => m.id)).not.toContain('debug')
    expect(h.service.getModel().menubar.map(m => m.id)).not.toContain('build')
  })

  it('插件只能注册清单里声明过的命令，激活失败会报出原因且不会卡住后续重试', async () => {
    const h = createHarness(dir => writePlugin(join(dir, 'bad'), {
      id: 'demo.bad', displayName: 'B', version: '1.0.0', publisher: 'demo',
      runtime: { type: 'node', main: 'main.js' },
      contributes: { commands: [{ id: 'bad:run', title: '运行' }] },
    }, "exports.activate = (ctx, ycide) => { ycide.commands.registerCommand('bad:undeclared', () => 1) }"))
    await h.service.start()
    await expect(h.service.executeCommand('bad:run')).rejects.toThrow(/没有在插件 demo\.bad 的清单 contributes\.commands 中声明/)
    await expect(h.service.executeCommand('bad:run')).rejects.toThrow(/没有在插件 demo\.bad 的清单/)
  })

  it('依赖的插件先激活；onStartup 插件在启动时激活', async () => {
    const order: string[] = []
    const h = createHarness(dir => {
      writePlugin(join(dir, 'base'), {
        id: 'demo.base', displayName: 'Base', version: '1.0.0', publisher: 'demo',
        runtime: { type: 'node', main: 'main.js' },
      }, "exports.activate = (ctx, ycide) => { ycide.window.showMessage('base') }")
      writePlugin(join(dir, 'app'), {
        id: 'demo.app', displayName: 'App', version: '1.0.0', publisher: 'demo',
        runtime: { type: 'node', main: 'main.js' }, activationEvents: ['onStartup'],
        dependencies: { 'demo.base': '^1.0.0' },
      }, "exports.activate = (ctx, ycide) => { ycide.window.showMessage('app') }")
    }, { showMessage: p => order.push(p.message) })
    await h.service.start()
    expect(order).toEqual(['base', 'app'])
  })

  it('插件进程崩溃后状态复位，下次执行命令时重新启动', async () => {
    const h = createHarness(dir => cpSync(demoPluginDir, join(dir, 'demo.hello'), { recursive: true }))
    await h.service.start()
    await h.service.executeCommand('hello:greet')
    h.crashHost()
    expect(h.service.getState().plugins.find(p => p.id === 'demo.hello')?.active).toBe(false)
    // 同一测试进程里模块缓存会保留计数，这里只验证能重新激活并执行
    expect(await h.service.executeCommand('hello:greet')).toMatch(/^你好/)
    expect(h.spawnCount()).toBe(2)
  })
})
