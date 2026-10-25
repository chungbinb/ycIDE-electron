// 插件化阶段 1：主题贡献点、AI 模型提供方与工具贡献点、Agent 循环、插件文档 API。
// 设计依据：docs/插件架构设计稿.md §6.7、§6.10、§11 阶段 1。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { validatePluginManifest, type PluginManifest } from '../../src/shared/plugin/manifest'
import { collectAIModels, collectAITools, collectProviderKeySlots } from '../../src/shared/plugin/aiContributions'
import { BUILTIN_PLUGIN_CANDIDATES } from '../../src/shared/plugin/builtinPlugins'
import { resolvePlugins } from '../../src/shared/plugin/pluginResolver'
import { runAgentTask, createProjectPathHelpers, normalizeToolResult } from '../../src/renderer/src/workbench/aiAgent'
import { PluginService, type PluginHostConnection } from '../../src/main/plugins/pluginService'
import { PluginHostRuntime } from '../../src/main/plugins/pluginHostRuntime'
import { createInMemoryTransportPair } from '../../src/shared/plugin/rpc'
import type { AIChatMessage, AIChatTool, AIChatWithToolsResult } from '../../src/shared/ai'

const repoRoot = resolve(__dirname, '..', '..')
const builtinManifests = resolvePlugins(BUILTIN_PLUGIN_CANDIDATES, { platform: 'windows', host: 'electron' }).enabled

function manifest(id: string, extra: Record<string, unknown> = {}): PluginManifest {
  return { id, displayName: id, version: '1.0.0', publisher: id.split('.')[0], ...extra } as PluginManifest
}

describe('AI 模型提供方贡献点', () => {
  it('内置 DeepSeek / GLM 插件提供原来写死的 4 个模型，Key 沿用原设置字段', () => {
    const models = collectAIModels(builtinManifests)
    expect(models.map(m => [m.id, m.model, m.endpoint])).toEqual([
      ['deepseek', 'deepseek-v4-pro', 'https://api.deepseek.com/chat/completions'],
      ['deepseek-v4-flash', 'deepseek-v4-flash', 'https://api.deepseek.com/chat/completions'],
      ['deepseek-v3.2', 'deepseek-v3.2', 'https://api.deepseek.com/chat/completions'],
      ['glm', 'glm-4-flash', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
    ])
    expect(models.find(m => m.id === 'glm')?.apiKey).toEqual({ kind: 'setting', setting: 'aiGlmApiKey' })
    expect(models.find(m => m.id === 'deepseek')?.envKey).toBe('DEEPSEEK_API_KEY')
    expect(collectProviderKeySlots(builtinManifests)).toEqual([])
  })

  it('第三方提供方：Key 按「插件ID:提供方ID」单独存放，不能借用内置 Key 字段；模型 ID 重复时先声明的生效', () => {
    const qwen = manifest('acme.qwen', {
      contributes: {
        aiProviders: [{
          id: 'qwen', label: '通义千问', endpoint: 'https://dashscope.example.com/v1/chat/completions',
          apiKeySetting: 'aiDeepseekApiKey',
          models: [{ id: 'qwen-max', label: '千问 Max', model: 'qwen-max' }, { id: 'glm', label: '冒名 GLM', model: 'x' }],
        }],
      },
    })
    const models = collectAIModels([...builtinManifests, qwen])
    expect(models.find(m => m.id === 'qwen-max')?.apiKey).toEqual({ kind: 'provider', key: 'acme.qwen:qwen' })
    expect(models.find(m => m.id === 'glm')?.pluginId).toBe('ycide.ai-glm')
    expect(collectProviderKeySlots([...builtinManifests, qwen])).toEqual([{ key: 'acme.qwen:qwen', label: '通义千问', pluginId: 'acme.qwen', envKey: undefined }])
  })

  it('清单校验：地址必须是 http(s)、模型列表非空、工具名与风险等级合法、主题路径不能越出插件目录', () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ aiProviders: [{ id: 'x', label: 'X', endpoint: 'ftp://a', models: [{ id: 'm', label: 'M', model: 'm' }] }] }, /http \/ https/],
      [{ aiProviders: [{ id: 'x', label: 'X', endpoint: 'https://a', models: [] }] }, /models 必须是非空数组/],
      [{ aiProviders: [{ id: 'x', label: 'X', endpoint: 'https://a', apiKeySetting: 'other', models: [{ id: 'm', label: 'M', model: 'm' }] }] }, /apiKeySetting 只能是/],
      [{ aiTools: [{ name: '中文名', description: 'd', command: 'c' }] }, /name 只能用/],
      [{ aiTools: [{ name: 'ok', description: 'd', command: 'c', risk: 'delete' }] }, /risk 只能是/],
      [{ themes: [{ id: '主题', path: '../evil.json' }] }, /插件目录内的相对路径/],
      [{ themes: [{ id: '主题', path: 'C:/evil.json' }] }, /插件目录内的相对路径/],
    ]
    for (const [contributes, pattern] of cases) {
      const result = validatePluginManifest({ ...manifest('demo.x'), contributes })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.join('\n')).toMatch(pattern)
    }
  })
})

describe('AI 工具贡献点', () => {
  it('原来写死在 App.tsx 的 7 个工具改由内置插件声明，内置工具不需要确认', () => {
    const tools = collectAITools(builtinManifests)
    expect(tools.map(t => [t.name, t.command, t.risk, t.builtin])).toEqual([
      ['list_files', 'aiTool:listFiles', 'read', true],
      ['read_file', 'aiTool:readFile', 'read', true],
      ['open_file', 'aiTool:openFile', 'read', true],
      ['edit_file', 'aiTool:editFile', 'write', true],
      ['terminal_send', 'aiTool:terminalSend', 'exec', true],
      ['terminal_read', 'aiTool:terminalRead', 'read', true],
      ['terminal_last_command', 'aiTool:terminalLastCommand', 'read', true],
    ])
  })
})

describe('Agent 循环', () => {
  function scriptedChat(rounds: AIChatWithToolsResult[]): { chat: (m: AIChatMessage[], t: AIChatTool[]) => Promise<AIChatWithToolsResult>; seen: Array<{ messages: AIChatMessage[]; tools: AIChatTool[] }> } {
    const seen: Array<{ messages: AIChatMessage[]; tools: AIChatTool[] }> = []
    let i = 0
    return {
      seen,
      chat: async (messages, tools) => {
        seen.push({ messages: JSON.parse(JSON.stringify(messages)), tools })
        return rounds[Math.min(i++, rounds.length - 1)]
      },
    }
  }

  const thirdPartyWrite = manifest('acme.fmt', {
    contributes: {
      commands: [{ id: 'fmt:format', title: '格式化' }],
      aiTools: [{ name: 'format_file', description: '格式化文件', command: 'fmt:format', risk: 'write' }],
    },
  })

  it('按模型的工具调用执行命令、把结果交回模型；文件清单写进系统提示；记录主要改动', async () => {
    const tools = collectAITools(builtinManifests)
    const { chat, seen } = scriptedChat([
      { ok: true, message: '', toolCalls: [
        { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.eyc"}' } },
        { id: 'c2', type: 'function', function: { name: 'edit_file', arguments: '{"path":"a.eyc","instruction":"改"}' } },
      ] },
      { ok: true, message: '完成', toolCalls: [] },
    ])
    const executed: Array<[string, unknown, unknown]> = []
    const executeCommand = vi.fn(async (command: string, args?: unknown, ctx?: unknown) => {
      executed.push([command, args, ctx])
      if (command === 'aiTool:listFiles') return { ok: true, data: { ok: true, files: ['a.eyc', 'b.eyc'] } }
      if (command === 'aiTool:readFile') return { ok: true, data: { ok: true, content: 'x' }, logs: ['读了 a.eyc'] }
      if (command === 'aiTool:editFile') return { ok: true, data: { ok: true }, logs: ['改了 a.eyc'], edit: { filePath: 'D:/p/a.eyc', addedLines: 2, deletedLines: 1 } }
      throw new Error(`unexpected ${command}`)
    })
    const traces: string[] = []
    const result = await runAgentTask('改一下 a', {
      projectDir: 'D:/p', runId: 7, runtimePlatform: 'windows', tools, chatWithTools: chat, executeCommand,
      confirmTool: async () => { throw new Error('内置工具不应询问') },
      onToolTrace: t => traces.push(`${t.tool}:${t.ok}`),
    })
    expect(result).toEqual({ ok: true, logs: ['读了 a.eyc', '改了 a.eyc'], finalMessage: '完成', primaryEdit: { filePath: 'D:/p/a.eyc', addedLines: 2, deletedLines: 1 } })
    expect(executed.map(e => e[0])).toEqual(['aiTool:listFiles', 'aiTool:readFile', 'aiTool:editFile'])
    expect(executed[1][2]).toEqual({ projectDir: 'D:/p', runId: 7 })
    expect(seen[0].messages[0].content).toContain('a.eyc\nb.eyc')
    expect(seen[0].tools.map(t => t.function.name)).toContain('terminal_send')
    // 第二轮把工具结果交回模型
    expect(seen[1].messages.filter(m => m.role === 'tool').map(m => m.name)).toEqual(['read_file', 'edit_file'])
    expect(traces).toEqual(['read_file:true', 'edit_file:true'])
  })

  it('第三方插件的写入工具调用前需要确认，拒绝时不执行；未知工具与抛错的工具都转成错误结果交回模型', async () => {
    const tools = collectAITools([...builtinManifests, thirdPartyWrite])
    const { chat, seen } = scriptedChat([
      { ok: true, message: '', toolCalls: [
        { id: 'c1', type: 'function', function: { name: 'format_file', arguments: '{"path":"a.eyc"}' } },
        { id: 'c2', type: 'function', function: { name: 'no_such_tool', arguments: '{}' } },
        { id: 'c3', type: 'function', function: { name: 'terminal_read', arguments: 'not json' } },
      ] },
      { ok: true, message: '好', toolCalls: [] },
    ])
    const confirmTool = vi.fn(async () => false)
    const executeCommand = vi.fn(async (command: string) => {
      if (command === 'aiTool:listFiles') return { ok: true, data: { ok: true, files: [] } }
      if (command === 'aiTool:terminalRead') throw new Error('终端没开')
      throw new Error(`不应执行 ${command}`)
    })
    const result = await runAgentTask('格式化', {
      projectDir: 'D:/p', runId: 1, runtimePlatform: 'windows', tools, chatWithTools: chat, executeCommand, confirmTool,
    })
    expect(confirmTool).toHaveBeenCalledTimes(1)
    expect(result.logs).toEqual(['未索引到可编辑源码文件。', '工具 format_file：用户拒绝执行。', '工具调用失败：不支持的工具 no_such_tool', '工具 terminal_read 失败：终端没开'])
    const toolMessages = seen[1].messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content))
    expect(toolMessages).toEqual([
      { ok: false, error: '用户拒绝执行该工具。' },
      { ok: false, error: '不支持的工具: no_such_tool' },
      { ok: false, error: '终端没开' },
    ])
  })

  it('网络诊断目标直接走终端工具，不调用模型', async () => {
    const chat = vi.fn()
    const executeCommand = vi.fn(async (_command: string, args?: unknown) => ({ ok: true, data: { ok: true }, logs: [`执行 ${(args as { command: string }).command}`] }))
    const result = await runAgentTask('检查一下网络连通性', {
      projectDir: 'D:/p', runId: 1, runtimePlatform: 'windows', tools: collectAITools(builtinManifests),
      chatWithTools: chat, executeCommand, confirmTool: async () => true,
    })
    expect(chat).not.toHaveBeenCalled()
    expect(executeCommand).toHaveBeenCalledWith('aiTool:terminalSend', { command: 'ping -n 4 8.8.8.8', pollAttempts: 8, pollIntervalMs: 300, outputLimit: 1800 }, { projectDir: 'D:/p', runId: 1 })
    expect(result).toEqual({ ok: true, logs: ['检测到网络连通性意图，优先使用终端命令进行诊断。', '执行 ping -n 4 8.8.8.8'], finalMessage: '网络连通性检查已完成，结果见上方终端输出。' })
  })

  it('插件工具可以直接返回任意值；项目路径解析不允许越出项目目录', () => {
    expect(normalizeToolResult(42)).toEqual({ ok: true, data: 42 })
    expect(normalizeToolResult(undefined)).toEqual({ ok: true, data: { ok: true } })
    const helpers = createProjectPathHelpers('D:\\proj', (a, b) => `${a}\\${b}`, '\\')
    expect(helpers.resolveProjectPath('src/a.eyc')).toBe('D:\\proj\\src\\a.eyc')
    expect(helpers.resolveProjectPath('D:\\other\\a.eyc')).toBeNull()
    expect(helpers.toRelative('D:\\proj\\src\\a.eyc')).toBe('src/a.eyc')
  })
})

describe('插件主题与文档 API', () => {
  const roots: string[] = []
  afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })

  function makeService(setup: (pluginsDir: string) => void, executeHostCommand = vi.fn(async () => undefined as unknown)): PluginService {
    const root = mkdtempSync(join(tmpdir(), 'ycide-phase1-'))
    roots.push(root)
    const pluginsDir = join(root, 'plugins')
    mkdirSync(pluginsDir)
    setup(pluginsDir)
    return new PluginService({
      builtinCandidates: BUILTIN_PLUGIN_CANDIDATES.map(c => ({ ...c, dir: join(repoRoot, 'plugins', (c.manifest as { id: string }).id) })),
      pluginDirs: [pluginsDir],
      devDirs: [pluginsDir],
      statePath: join(root, 'state.json'),
      platform: 'windows',
      host: 'electron',
      spawnHost: (): PluginHostConnection => {
        const [a, b] = createInMemoryTransportPair()
        const runtime = new PluginHostRuntime(b)
        return { transport: a, onExit: () => undefined, kill: () => runtime.dispose() }
      },
      executeHostCommand,
      showMessage: () => undefined,
      onDidChange: () => undefined,
      log: () => undefined,
    })
  }

  it('内置彩色主题包与用户插件的主题都能解析到文件；同名先到先得；文件缺失的被忽略', async () => {
    const service = makeService(dir => {
      const p = join(dir, 'mytheme')
      mkdirSync(join(p, 'themes'), { recursive: true })
      writeFileSync(join(p, 'themes', 'a.json'), '{"name":"夜空","colors":{}}')
      writeFileSync(join(p, 'plugin.json'), JSON.stringify({
        id: 'demo.mytheme', displayName: 'T', version: '1.0.0', publisher: 'demo',
        contributes: { themes: [{ id: '夜空', path: 'themes/a.json' }, { id: '抹茶绿', path: 'themes/a.json' }, { id: '缺失', path: 'themes/none.json' }] },
      }))
    })
    await service.start()
    const themes = service.getContributedThemes()
    expect(themes.map(t => [t.id, t.pluginId])).toEqual([
      ['抹茶绿', 'ycide.themes-colorful'],
      ['抹茶绿-渐变', 'ycide.themes-colorful'],
      ['樱花粉', 'ycide.themes-colorful'],
      ['樱花粉-渐变', 'ycide.themes-colorful'],
      ['深海蓝', 'ycide.themes-colorful'],
      ['深海蓝-渐变', 'ycide.themes-colorful'],
      ['夜空', 'demo.mytheme'],
    ])
    expect(themes[0].file).toBe(join(repoRoot, 'plugins', 'ycide.themes-colorful', 'themes', '抹茶绿.json'))
    // 停用主题包后主题随之消失
    await service.setEnabled('ycide.themes-colorful', false)
    expect(service.getContributedThemes().map(t => t.id)).toEqual(['夜空', '抹茶绿'])
  })

  it('插件经 ycide.documents 读取文档、作为 AI 工具被调用', async () => {
    const executeHostCommand = vi.fn(async (command: string) => (command === 'documents:getText' ? '第一行\r\n第二行\n第三行' : undefined))
    const service = makeService(dir => cpSync(resolve(repoRoot, 'tests', 'fixtures', 'plugins', 'demo.hello'), join(dir, 'demo.hello'), { recursive: true }), executeHostCommand)
    await service.start()
    const result = await service.executeCommand('hello:countLines', [{ path: 'src/a.eyc' }, { projectDir: 'D:\\proj', runId: 1 }])
    expect(result).toEqual({ ok: true, data: { ok: true, path: 'src/a.eyc', lines: 3 }, logs: ['示例插件：src/a.eyc 共 3 行'] })
    expect(executeHostCommand).toHaveBeenCalledWith('documents:getText', [join('D:\\proj', 'src/a.eyc')])
    expect(collectAITools(service.getState().manifests).find(t => t.name === 'count_lines')).toMatchObject({ pluginId: 'demo.hello', builtin: false, risk: 'read' })
    await service.shutdown()
  })
})
