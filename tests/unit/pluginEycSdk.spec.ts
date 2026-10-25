// 插件化阶段 5：用易语言写插件（设计稿 §13.1 第 1 条）。
// 用「插件开发支持库」(lib/ycplugin) 真编译一个易语言程序，把它当可执行文件插件交给插件服务运行：
// 宿主经 stdio 激活它、转发命令；它显示消息、回复结果、调用宿主命令（同样受权限检查）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync, copyFileSync, cpSync, readFileSync } from 'fs'
import { spawn } from 'child_process'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'
import { libraryManager } from '../../src/main/libraryManager'
import { createStdioTransport } from '../../src/shared/plugin/stdioTransport'
import { RpcErrorCode } from '../../src/shared/plugin/rpc'
import { validatePluginManifest } from '../../src/shared/plugin/manifest'
import { PluginService, type PluginHostConnection } from '../../src/main/plugins/pluginService'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []
const tmpDirs: string[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-sdk-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})
afterAll(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 占用中 */ } } })

const PLUGIN_SOURCE = [
  '.版本 2',
  '.程序集 程序集1',
  '',
  '.子程序 _启动子程序',
  '.局部变量 命令, 文本型',
  '.判断循环首 (真)',
  '    命令 ＝ 插件_等待请求 ()',
  '    .如果真 (命令 ＝ “”)',
  '        跳出循环 ()',
  '    .如果真结束',
  '    .判断开始 (命令 ＝ “eyc:greet”)',
  '        插件_显示消息 (“你好，” ＋ 插件_取参数 (1), )',
  '        插件_回复 (“问候了 ” ＋ 插件_取参数 (1) ＋ “，参数个数 ” ＋ 到文本 (插件_取参数数量 ()))',
  '    .判断 (命令 ＝ “eyc:read”)',
  '        插件_回复 (“结果=” ＋ 插件_执行命令 (“documents:getText”, 插件_取参数 (1)) ＋ “;错误=” ＋ 插件_取错误信息 ())',
  '    .判断 (命令 ＝ “eyc:who”)',
  '        插件_回复 (插件_取插件标识 ())',
  '    .默认',
  '        插件_回复错误 (“未知命令 ” ＋ 命令)',
  '    .判断结束',
  '.判断循环尾 ()',
  '',
]

async function compilePlugin(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'ycide-sdk-'))
  tmpDirs.push(dir)
  writeFileSync(join(dir, 'p.epp'), ['ProjectName=易语言插件', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
  writeFileSync(join(dir, '程序.eyc'), PLUGIN_SOURCE.join('\r\n'), 'utf-8')
  libraryManager.scan()
  expect(libraryManager.load('ycplugin').success).toBe(true)
  const before = messages.length
  const r = await compileProject({ projectDir: dir, mode: 'build' })
  const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
  expect(r.success, `编译失败：\n${errs}`).toBe(true)
  return r.outputFile!
}

describe('易语言插件（插件开发支持库）', () => {
  it.skipIf(!zigAvailable)('编译出的程序作为可执行文件插件：激活、命令、消息、调用宿主命令受权限检查', async () => {
    const exe = await compilePlugin()
    const root = mkdtempSync(join(tmpdir(), 'ycide-sdk-plugins-'))
    tmpDirs.push(root)
    const makePlugin = (id: string, permissions: string[]): void => {
      const dir = join(root, 'plugins', id)
      mkdirSync(dir, { recursive: true })
      copyFileSync(exe, join(dir, 'plugin.exe'))
      writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
        id, displayName: id, version: '1.0.0', publisher: id.split('.')[0], platforms: ['windows'], permissions,
        runtime: { type: 'executable', command: 'plugin.exe' },
        contributes: { commands: ['greet', 'read', 'who'].map(c => ({ id: `eyc:${c}`, title: c })) },
      }))
    }
    makePlugin('eyc.reader', ['workspace:read'])
    // 同一个程序，清单里不申请 workspace:read
    makePlugin('eyc.plain', [])
    const shown: string[] = []
    const service = new PluginService({
      builtinCandidates: [],
      pluginDirs: [join(root, 'plugins')],
      statePath: join(root, 'state.json'),
      storageRoot: join(root, 'storage'),
      platform: 'windows',
      host: 'electron',
      spawnHost: (spec): PluginHostConnection => {
        const child = spawn(spec.command!, spec.args ?? [], { cwd: spec.cwd, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true })
        return { transport: createStdioTransport(child.stdout!, child.stdin!), onExit: l => { child.on('exit', l) }, kill: () => { child.kill() } }
      },
      executeHostCommand: async (command, args) => `宿主:${command}:${String(args[0])}`,
      showMessage: p => shown.push(`${p.pluginId}|${p.type}|${p.message}`),
      onDidChange: () => undefined,
      log: () => undefined,
    })
    try {
      await service.start()
      await service.grantPermissions('eyc.reader')
      await service.grantPermissions('eyc.plain')
      // 两个插件声明了同名命令，按扫描顺序先到先得：先归 eyc.plain（没申请 workspace:read），调用宿主命令被拒
      expect(await service.executeCommand('eyc:who')).toBe('eyc.plain')
      expect(await service.executeCommand('eyc:read', ['a.eyc'])).toBe(`结果=;错误=${RpcErrorCode.PermissionDenied} 插件 eyc.plain 没有权限：读取当前项目里的文件和打开的文档（workspace:read）`)
      // 停用 eyc.plain 后命令归 eyc.reader
      await service.setEnabled('eyc.plain', false)
      expect(await service.executeCommand('eyc:greet', ['世界'])).toBe('问候了 世界，参数个数 1')
      expect(shown).toEqual(['eyc.reader|info|你好，世界'])
      expect(await service.executeCommand('eyc:who')).toBe('eyc.reader')
      expect(await service.executeCommand('eyc:read', ['a.eyc'])).toBe('结果=宿主:documents:getText:a.eyc;错误=')
    } finally {
      await service.shutdown()
    }
  }, 240000)
})

describe('插件模板', () => {
  it('模板清单都合法（第三方插件身份）', () => {
    for (const name of ['js-hello', 'eyc-hello']) {
      const raw = JSON.parse(readFileSync(join(repoRoot, 'templates', 'plugins', name, 'plugin.json'), 'utf-8'))
      const result = validatePluginManifest(raw)
      expect(result.ok ? [] : result.errors, name).toEqual([])
    }
  })

  it.skipIf(!zigAvailable)('易语言模板能编译', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-sdk-tpl-'))
    tmpDirs.push(dir)
    cpSync(join(repoRoot, 'templates', 'plugins', 'eyc-hello'), dir, { recursive: true })
    libraryManager.scan()
    libraryManager.load('ycplugin')
    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)
  }, 240000)
})
