// 插件化阶段 3：语言服务、编辑器提供者、插件网页 UI 文件读取。
// 设计依据：docs/插件架构设计稿.md §6.2、§6.3、§7、§11 阶段 3。
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { validatePluginManifest, type PluginManifest } from '../../src/shared/plugin/manifest'
import { collectEditors, editorsForLanguage, pickEditor } from '../../src/shared/plugin/editorContributions'
import { collectRenderers, pickRenderer } from '../../src/shared/plugin/rendererContributions'
import { BUILTIN_PLUGIN_CANDIDATES } from '../../src/shared/plugin/builtinPlugins'
import { resolvePlugins } from '../../src/shared/plugin/pluginResolver'
import { PluginService, NON_DISABLEABLE_PLUGINS } from '../../src/main/plugins/pluginService'

const repoRoot = resolve(__dirname, '..', '..')
const builtinManifests = resolvePlugins(BUILTIN_PLUGIN_CANDIDATES, { platform: 'windows', host: 'electron' }).enabled

function manifest(id: string, extra: Record<string, unknown> = {}): PluginManifest {
  return { id, displayName: id, version: '1.0.0', publisher: id.split('.')[0], ...extra } as PluginManifest
}

const webEditor = (id: string, languages: string[], priority: 'default' | 'option') => manifest(`acme.${id}`, {
  contributes: { editors: [{ id, displayName: id, languages, priority, ui: { type: 'web', entry: 'ui/index.html' } }] },
})

describe('编辑器提供者', () => {
  it('内置：易语言源码用表格编辑器、窗口文件用设计器、其它文档用文本编辑器兜底', () => {
    const editors = collectEditors(builtinManifests)
    expect(editors.map(e => [e.id, e.pluginId])).toEqual([
      ['ycide.eycTable', 'ycide.editor-eyc-table'],
      ['ycide.formDesigner', 'ycide.editor-form-designer'],
      ['ycide.text', 'ycide.editor-text'],
    ])
    expect(pickEditor('eyc', editors)?.id).toBe('ycide.eycTable')
    expect(pickEditor('ell', editors)?.id).toBe('ycide.eycTable')
    expect(pickEditor('efw', editors)?.id).toBe('ycide.formDesigner')
    expect(pickEditor('json', editors)?.id).toBe('ycide.text')
    expect(editorsForLanguage('eyc', editors).map(e => e.id)).toEqual(['ycide.eycTable', 'ycide.text'])
  })

  it('option 编辑器只出现在「打开方式」里，不会抢在文本编辑器前面成为默认；default 编辑器会成为默认', () => {
    const editors = collectEditors([...builtinManifests, webEditor('markdownPreview', ['plaintext'], 'option'), webEditor('csvGrid', ['csv'], 'default')])
    expect(pickEditor('plaintext', editors)?.id).toBe('ycide.text')
    expect(editorsForLanguage('plaintext', editors).map(e => e.id)).toEqual(['ycide.text', 'markdownPreview'])
    expect(pickEditor('plaintext', editors, 'markdownPreview')?.id).toBe('markdownPreview')
    expect(pickEditor('csv', editors)?.id).toBe('csvGrid')
    // 选过的编辑器不可用了（插件停用）→ 回到默认
    expect(pickEditor('plaintext', collectEditors(builtinManifests), 'markdownPreview')?.id).toBe('ycide.text')
  })

  it('清单校验：第三方插件不能用内置编辑器组件，网页编辑器入口必须在插件目录内', () => {
    const builtinUi = validatePluginManifest(manifest('acme.x', { contributes: { editors: [{ id: 'x', displayName: 'X', languages: ['eyc'], ui: { type: 'builtin', component: 'eycTable' } }] } }))
    expect(builtinUi.ok ? [] : builtinUi.errors).toEqual(['contributes.editors[0]: 只有内置插件可以使用 builtin 编辑器'])
    const escape = validatePluginManifest(manifest('acme.y', { contributes: { editors: [{ id: 'y', displayName: 'Y', languages: ['*'], ui: { type: 'web', entry: '../../secret.html' } }] } }))
    expect(escape.ok ? [] : escape.errors).toEqual(['contributes.editors[0]: web 编辑器需要插件目录内的 ui.entry'])
  })

  it('语言服务、文本编辑器、表格编辑器不可停用（设计稿 §13.1 卸载规则）', () => {
    for (const id of ['ycide.lang-eyc', 'ycide.editor-text', 'ycide.editor-eyc-table']) expect(NON_DISABLEABLE_PLUGINS.has(id)).toBe(true)
    expect(NON_DISABLEABLE_PLUGINS.has('ycide.editor-form-designer')).toBe(false)
  })
})

describe('插件网页 UI 文件读取（ycide-plugin:// 协议）', () => {
  const roots: string[] = []
  afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })

  it('只能读取已启用插件目录内存在的文件', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ycide-ui-'))
    roots.push(root)
    const dir = join(root, 'plugins', 'ed')
    mkdirSync(join(dir, 'ui'), { recursive: true })
    writeFileSync(join(dir, 'ui', 'index.html'), '<p>ok</p>')
    writeFileSync(join(root, 'plugins', 'secret.txt'), '机密')
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify(webEditor('ed', ['*'], 'option')))
    const service = new PluginService({
      builtinCandidates: [],
      pluginDirs: [join(root, 'plugins')],
      statePath: join(root, 'state.json'),
      platform: 'windows', host: 'electron',
      spawnHost: () => { throw new Error('不应启动') },
      executeHostCommand: async () => undefined, showMessage: () => undefined, onDidChange: () => undefined, log: () => undefined,
    })
    await service.start()
    expect(readFileSync(service.resolvePluginFile('acme.ed', 'ui/index.html')!, 'utf-8')).toBe('<p>ok</p>')
    expect(service.resolvePluginFile('acme.ed', '../secret.txt')).toBeNull()
    expect(service.resolvePluginFile('acme.ed', 'ui/missing.html')).toBeNull()
    expect(service.resolvePluginFile('acme.ed', 'ui')).toBeNull()
    expect(service.resolvePluginFile('acme.other', 'ui/index.html')).toBeNull()
    await service.setEnabled('acme.ed', false)
    expect(service.resolvePluginFile('acme.ed', 'ui/index.html')).toBeNull()
  })
})

describe('表格编辑器不再从父组件接收项目语义', () => {
  it('EycTableEditor 的 props 里没有项目符号与装饰，改由语言服务与装饰服务提供', () => {
    const source = readFileSync(join(repoRoot, 'src', 'renderer', 'src', 'components', 'Editor', 'EycTableEditor.tsx'), 'utf-8')
    const propsBlock = source.slice(source.indexOf('interface EycTableEditorProps {'), source.indexOf('export interface FileProblem'))
    for (const prop of ['projectGlobalVars', 'windowControlNames', 'windowControlTypes', 'projectWindows', 'windowUnits', 'projectConstants',
      'projectDllCommands', 'projectDataTypes', 'projectClassNames', 'breakpointLines', 'debugSourceLine', 'debugVariables', 'diffAddedLines']) {
      expect(propsBlock).not.toMatch(new RegExp(`\\b${prop}\\??:`))
    }
    expect(source).toContain('useEycProjectSymbolsService()')
    expect(source).toContain('useDocumentDecorations()')
  })
})

describe('渲染后端贡献点', () => {
  it('内置 DOM 后端提供表格编辑器流程线；设置里选的后端不可用时回到 DOM', () => {
    const renderers = collectRenderers(builtinManifests)
    expect(renderers.map(r => [r.id, r.pluginId, r.implementation])).toEqual([
      ['ycide.dom', 'ycide.render-dom', 'dom'],
      ['ycide.image', 'ycide.render-image', 'image'],
    ])
    expect(pickRenderer('eycTable.flowLines', renderers)?.id).toBe('ycide.dom')
    expect(pickRenderer('eycTable.flowLines', renderers, 'ycide.image')?.id).toBe('ycide.image')
    // 图像后端可以停用（停用后设置里选的图像后端自动回到 DOM）
    expect(NON_DISABLEABLE_PLUGINS.has('ycide.render-image')).toBe(false)
    expect(pickRenderer('eycTable.flowLines', renderers.filter(r => r.pluginId !== 'ycide.render-image'), 'ycide.image')?.id).toBe('ycide.dom')
    expect(pickRenderer('eycTable.flowLines', renderers, 'acme.missing')?.id).toBe('ycide.dom')
    expect(NON_DISABLEABLE_PLUGINS.has('ycide.render-dom')).toBe(true)
  })

  it('清单校验：只有内置插件能提供渲染后端，surface 必须是已知渲染面', () => {
    const renderer = { id: 'r', displayName: 'R', surfaces: ['eycTable.flowLines'], implementation: 'x' }
    const third = validatePluginManifest(manifest('acme.r', { contributes: { renderers: [renderer] } }))
    expect(third.ok ? [] : third.errors).toEqual(['contributes.renderers[0]: 渲染后端直接操作编辑器界面，只有内置插件可以提供'])
    const badSurface = validatePluginManifest(manifest('ycide.r', { builtin: true, contributes: { renderers: [{ ...renderer, surfaces: ['minimap'] }] } }))
    expect(badSurface.ok ? [] : badSurface.errors).toEqual(['contributes.renderers[0]: surfaces 必须是非空数组，可选 eycTable.flowLines'])
    expect(validatePluginManifest(manifest('ycide.r', { builtin: true, contributes: { renderers: [renderer] } })).ok).toBe(true)
  })

  it('表格编辑器经渲染后端绘制流程线，不再直接调用 DOM 实现', () => {
    const source = readFileSync(join(repoRoot, 'src', 'renderer', 'src', 'components', 'Editor', 'EycTableEditor.tsx'), 'utf-8')
    expect(source).not.toContain('editorFlowRenderUtils')
    expect(source).toContain('flowLineRenderer.renderLine(')
    expect(source).toContain('flowLineRenderer.renderContinuation(')
  })
})
