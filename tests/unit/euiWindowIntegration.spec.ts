import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { compileProject, setCompilerHost } from '../../src/main/compiler'
import { libraryManager } from '../../src/main/libraryManager'
import { getEuiBuildTools } from '../../src/main/euiBuildTools'
import { readEuiForms } from '../../src/main/euiCompiler'
import { filterWindowUnits, resolveWindowProviders } from '../../src/main/windowUiService'
import { collectWindowUiProviders, EUI_WINDOW_UI_PROVIDER, LEGACY_WINDOW_UI_PROVIDER, parseWindowUiPreviewTheme, readWindowUiProject, requireWindowUiProvider } from '../../src/shared/plugin/windowUiProviders'
import { validatePluginManifest, type PluginManifest } from '../../src/shared/plugin/manifest'
import { findWindowControlUnit, windowUnitKey } from '../../src/shared/plugin/windowControls'

const { createEuiControlLibrary } = require('../fixtures/eui-control-library.cjs')

const root = resolve(__dirname, '..', '..')
const manifests = [
  ...['krnln', 'eui'].map(name => JSON.parse(readFileSync(join(root, 'lib', name, 'plugin.json'), 'utf8')) as PluginManifest),
  JSON.parse(readFileSync(join(root, 'plugins', 'ycide.compiler-zig', 'plugin.json'), 'utf8')) as PluginManifest,
]
const temporary: string[] = []
let buildAvailable = false
try { getEuiBuildTools(root); buildAvailable = true } catch { /* Optional local native toolchain. */ }

beforeAll(() => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'ycide-eui-user-'))
  temporary.push(userDataPath)
  createEuiControlLibrary(userDataPath, root)
  setRuntimeEnv({ appPath: root, isPackaged: false, userDataPath, appVersion: 'test' })
  setCompilerHost({ emitOutput: () => {}, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
  libraryManager.scanAndAutoLoad()
})
afterAll(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }) })

describe('window UI provider integration', () => {
  it('validates provider namespaces and prevents silent replacement or version upgrades', () => {
    expect(manifests.map(validatePluginManifest).every(result => result.ok)).toBe(true)
    const invalid = structuredClone(manifests[1])
    invalid.contributes!.windowUiProviders![0].id = LEGACY_WINDOW_UI_PROVIDER
    expect(validatePluginManifest(invalid).ok).toBe(false)
    const entries = collectWindowUiProviders(manifests, 'windows-x64')
    expect(() => requireWindowUiProvider(entries, { uiProvider: 'missing.provider' })).toThrow('不能自动更换')
    expect(() => requireWindowUiProvider(entries, { uiProvider: EUI_WINDOW_UI_PROVIDER, uiProviderPluginVersion: '99' })).toThrow('版本不同')
    expect(readWindowUiProject('OutputType=WindowsApp').uiProvider).toBe(LEGACY_WINDOW_UI_PROVIDER)
    expect(collectWindowUiProviders(manifests, 'linux-x64').every(entry => !entry.available)).toBe(true)
    expect(() => collectWindowUiProviders([...manifests, manifests[1]], 'windows-x64')).toThrow('重复')
  })

  it('separates provider host adapters from control libraries and target support', () => {
    const units = libraryManager.getAllWindowUnits('windows')
    const eui = filterWindowUnits(units, EUI_WINDOW_UI_PROVIDER, 'windows-x64')
    expect(eui.some(unit => unit.englishName === 'EuiWindow' && unit.topLevel)).toBe(true)
    expect(eui.some(unit => unit.name === 'EUI按钮')).toBe(true)
    expect(eui.some(unit => unit.libraryName === 'fixturecontrols')).toBe(true)
    expect(eui.some(unit => unit.libraryName === 'script' && unit.englishName === 'Script')).toBe(true)
    expect(eui.find(unit => unit.libraryName === 'script')?.properties.map(property => property.name)).toEqual(['语言', '错误信息', '超时'])
    expect(filterWindowUnits(units).find(unit => unit.libraryName === 'script')?.properties.some(property => property.name === '左边')).toBe(true)
    const nativeControls = eui.filter(unit => unit.libraryName === 'krnln')
    expect(nativeControls.map(unit => unit.englishName)).toEqual(expect.arrayContaining([
      'Button', 'Static', 'Edit', 'CheckBox', 'RadioButton', 'SliderBar', 'ProgressBar', 'GroupBox', 'PictureBox',
    ]))
    expect(nativeControls.every(unit => unit.controlAdapters?.includes('win32') && unit.targetSupported)).toBe(true)
    expect(nativeControls.every(unit => unit.runtimeType === undefined)).toBe(true)
    expect(eui.filter(unit => unit.libraryName === 'webview2').map(unit => unit.englishName)).toEqual(expect.arrayContaining([
      'WebView', 'WebButton', 'WebEdit',
    ]))
    expect(filterWindowUnits(units).find(unit => unit.libraryName === 'krnln' && unit.englishName === 'CheckBox')?.toolboxCategory).toBe('Win32控件')
    expect(filterWindowUnits(units).some(unit => unit.libraryName === 'eui')).toBe(false)
    const linuxUnits = filterWindowUnits(units, EUI_WINDOW_UI_PROVIDER, 'linux-x64')
    expect(linuxUnits.find(unit => unit.libraryName === 'krnln' && unit.englishName === 'CheckBox')).toMatchObject({
      targetSupported: false,
      targetSupportReason: expect.stringContaining('linux-x64'),
    })
    expect(linuxUnits.some(unit => unit.libraryName === 'krnln' && unit.englishName === 'CheckBox')).toBe(true)
    const entries = resolveWindowProviders(manifests, units, 'windows-x64', root)
    expect(units.find(unit => unit.libraryName === 'krnln' && unit.englishName === 'Window')).toMatchObject({
      topLevel: true,
      uiProviders: [LEGACY_WINDOW_UI_PROVIDER],
    })
    expect(entries.find(entry => entry.id === LEGACY_WINDOW_UI_PROVIDER)?.available).toBe(true)
    expect(entries.find(entry => entry.id === EUI_WINDOW_UI_PROVIDER)?.controlAdapters).toEqual(['eui', 'win32'])
    expect(entries.find(entry => entry.id === EUI_WINDOW_UI_PROVIDER)?.available).toBe(buildAvailable)
    const withoutTheme = units.map(unit => ({ ...unit, previewTheme: undefined }))
    expect(resolveWindowProviders(manifests, withoutTheme, 'windows-x64', root).find(entry => entry.id === EUI_WINDOW_UI_PROVIDER)?.reason).toContain('主题')
  })

  it('resolves cross-library controls by stable identity, not display name or window ownership', () => {
    const units = libraryManager.getAllWindowUnits('windows')
    const coreButton = units.find(unit => unit.libraryName === 'eui' && unit.englishName === 'EuiButton')!
    const externalButton = units.find(unit => unit.libraryName === 'fixturecontrols' && unit.englishName === 'EuiButton')!
    expect(windowUnitKey(coreButton)).not.toBe(windowUnitKey(externalButton))
    expect(filterWindowUnits([externalButton], EUI_WINDOW_UI_PROVIDER)[0].events.map(event => event.name)).toEqual(['外库单击'])
    expect(findWindowControlUnit(units, { type: 'EUI按钮' })).toBeUndefined()
    expect(findWindowControlUnit(units, { type: '显示名已修改', libraryId: 'fixturecontrols', typeId: 'EuiButton' })).toBe(externalButton)
    expect(findWindowControlUnit([coreButton], { type: 'EUI按钮', libraryId: 'fixturecontrols', typeId: 'EuiButton' })).toBeUndefined()
    expect(filterWindowUnits([{ ...externalButton, runtimeType: undefined, englishName: 'Unsupported' }], EUI_WINDOW_UI_PROVIDER)).toEqual([])
  })

  it('rejects malformed shared theme data and incompatible control identities', () => {
    const theme = JSON.parse(readFileSync(join(root, 'lib', 'eui', 'theme-tokens.json'), 'utf8'))
    expect(parseWindowUiPreviewTheme(theme)?.bodyFontSize).toBe(theme.bodyFontSize)
    expect(() => parseWindowUiPreviewTheme([])).toThrow('对象')
    theme.light.text = [2, 0, 0, 1]
    expect(() => parseWindowUiPreviewTheme(theme)).toThrow('颜色无效')
    const form = JSON.parse(readFileSync(join(root, 'examples', 'eui-window', '_启动窗口.efw'), 'utf8'))
    form.controls[0].libraryId = 'krnln'
    const project = { projectName: 'invalid', projectDir: root, files: [{ type: 'EFW', fileName: 'invalid.efw', flag: 1 }] }
    expect(() => readEuiForms(project, libraryManager.getAllWindowUnits('windows'), new Map([['invalid.efw', JSON.stringify(form)]]))).toThrow('稳定类型标识')
    form.controls[0].libraryId = 'eui'
    form.controls[0].properties = { 扩展值: 1 }
    const extended = libraryManager.getAllWindowUnits('windows').map(unit => unit.libraryName === 'eui' && unit.englishName === 'EuiInput'
      ? { ...unit, properties: [...unit.properties, { ...unit.properties[0], name: '扩展值' }] }
      : unit)
    expect(() => readEuiForms(project, extended, new Map([['invalid.efw', JSON.stringify(form)]]))).toThrow('初始化适配')
    form.controls = [{ name: '脚本组件1', type: '脚本组件', libraryId: 'script', typeId: 'Script', width: 32, height: 32, properties: {} }]
    for (const properties of [{ 语言: 'Python' }, { 超时: 2147483648 }, { 超时: -2147483649 }, { 错误信息: '只读' }]) {
      form.controls[0].properties = properties
      expect(() => readEuiForms(project, libraryManager.getAllWindowUnits('windows'), new Map([['invalid.efw', JSON.stringify(form)]]))).toThrow()
    }
    form.controls[0].properties = { 语言: 'VBScript', 超时: -2 }
    expect(readEuiForms(project, libraryManager.getAllWindowUnits('windows'), new Map([['invalid.efw', JSON.stringify(form)]]))).toHaveLength(1)
  })

  it('validates the shipped core and WebView2 controls against their EUI adapters', () => {
    const units = libraryManager.getAllWindowUnits('windows')
    const project = { projectName: 'compatible', projectDir: root, files: [{ type: 'EFW', fileName: 'compatible.efw', flag: 1 }] }
    const controls = [
      { name: '按钮1', type: '按钮', libraryId: 'krnln', typeId: 'Button', width: 120, height: 32, properties: { 标题: '确定' } },
      { name: '编辑框1', type: '编辑框', libraryId: 'krnln', typeId: 'Edit', width: 160, height: 32, properties: { 内容: '输入', 是否允许多行: false } },
      { name: '标签1', type: '标签', libraryId: 'krnln', typeId: 'Static', width: 120, height: 24, properties: { 标题: '说明' } },
      { name: '图片框1', type: '图片框', libraryId: 'krnln', typeId: 'PictureBox', width: 120, height: 80, properties: { 图片: '' } },
      { name: '复选框1', type: '选择框', libraryId: 'krnln', typeId: 'CheckBox', width: 120, height: 32, text: '允许', properties: { 标题: '允许', 选中: true } },
      { name: '单选框1', type: '单选框', libraryId: 'krnln', typeId: 'RadioButton', width: 120, height: 32, text: '选项', properties: { 标题: '选项', 选中: true } },
      { name: '滑块条1', type: '滑块条', libraryId: 'krnln', typeId: 'SliderBar', width: 160, height: 32, properties: { 最小位置: 0, 最大位置: 10, 位置: 5 } },
      { name: '进度条1', type: '进度条', libraryId: 'krnln', typeId: 'ProgressBar', width: 160, height: 20, properties: { 最小位置: 0, 最大位置: 10, 位置: 5 } },
      { name: '分组框1', type: '分组框', libraryId: 'krnln', typeId: 'GroupBox', width: 240, height: 120, properties: { 标题: '选项' } },
      { name: '浏览框1', type: '浏览框', libraryId: 'webview2', typeId: 'WebView', width: 240, height: 120, properties: { 地址: 'https://example.com' } },
      { name: '网页按钮1', type: '网页按钮', libraryId: 'webview2', typeId: 'WebButton', width: 120, height: 32, properties: { 标题: '确认' } },
      { name: '网页编辑框1', type: '网页编辑框', libraryId: 'webview2', typeId: 'WebEdit', width: 160, height: 32, properties: { 内容: '文本' } },
    ]
    const raw = { name: 'compatible', title: 'Compatible controls', width: 640, height: 480, controls }
    expect(readEuiForms(project, units, new Map([['compatible.efw', JSON.stringify(raw)]]))).toHaveLength(1)
    const invalidUrl = structuredClone(raw)
    invalidUrl.controls.find(control => control.typeId === 'WebView')!.properties = { 地址: 'file:///secret' }
    expect(() => readEuiForms(project, units, new Map([['compatible.efw', JSON.stringify(invalidUrl)]]))).toThrow('仅支持 http(s)')
    const invalidRange = structuredClone(raw)
    invalidRange.controls.find(control => control.typeId === 'SliderBar')!.properties = { 最小位置: 10, 最大位置: 10, 位置: 10 }
    expect(() => readEuiForms(project, units, new Map([['compatible.efw', JSON.stringify(invalidRange)]]))).toThrow('位置无效')
  })

  it.skipIf(!buildAvailable)('compiles cross-library controls, their native property bindings and image resources', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-eui-project-'))
    temporary.push(dir)
    writeFileSync(join(dir, 'sample.epp'), [
      'Version=1', 'ProjectName=EUI集成测试', 'OutputType=WindowsApp', 'Platform=windows',
      `UiProvider=${EUI_WINDOW_UI_PROVIDER}`, 'UiProviderApiVersion=1', 'UiProviderPluginVersion=0.1.0',
      'Compiler=ycide.eui-msvc', 'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0',
    ].join('\n'))
    writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
      name: '_启动窗口', title: 'EUI integration', width: 640, height: 480, sourceFile: '_启动窗口.eyc',
      controls: [
        { id: 'name', name: '编辑框1', type: 'EUI编辑框', typeId: 'EuiInput', libraryId: 'eui', left: 20, top: 20, width: 240, height: 44, text: '真实输入' },
        { id: 'label', name: '标签1', type: 'EUI标签', typeId: 'EuiLabel', libraryId: 'eui', left: 20, top: 80, width: 300, height: 36, text: '初始文本' },
        { id: 'builtin', name: '库内按钮1', type: 'EUI按钮', typeId: 'EuiButton', libraryId: 'eui', left: 20, top: 140, width: 120, height: 36, text: '' },
        { id: 'external', name: '外库按钮1', type: 'EUI按钮', typeId: 'EuiButton', libraryId: 'fixturecontrols', left: 160, top: 140, width: 120, height: 36, text: '' },
        { id: 'picture', name: '外库图片1', type: 'EUI图片框', typeId: 'ForeignImage', libraryId: 'fixturecontrols', left: 20, top: 200, width: 120, height: 80,
          properties: { 图片: join(root, 'lib', 'eui-poc', 'assets', 'layout-preview.svg') } },
        { id: 'checkbox', name: '选择框1', type: '选择框', typeId: 'CheckBox', libraryId: 'krnln', left: 300, top: 20, width: 140, height: 32, text: '允许', properties: { 标题: '允许', 选中: false } },
        { id: 'radio', name: '单选框1', type: '单选框', typeId: 'RadioButton', libraryId: 'krnln', left: 300, top: 60, width: 140, height: 32, text: '选项', properties: { 标题: '选项', 选中: true } },
        { id: 'slider', name: '滑块条1', type: '滑块条', typeId: 'SliderBar', libraryId: 'krnln', left: 300, top: 100, width: 160, height: 32, properties: { 最小位置: 0, 最大位置: 10, 位置: 5 } },
        { id: 'progress', name: '进度条1', type: '进度条', typeId: 'ProgressBar', libraryId: 'krnln', left: 300, top: 140, width: 160, height: 20, properties: { 最小位置: 0, 最大位置: 10, 位置: 5 } },
        { id: 'group', name: '分组框1', type: '分组框', typeId: 'GroupBox', libraryId: 'krnln', left: 280, top: 50, width: 220, height: 90, text: '选项', properties: { 标题: '选项' } },
        { id: 'coreButton', name: '核心按钮1', type: '按钮', typeId: 'Button', libraryId: 'krnln', left: 480, top: 20, width: 120, height: 32, text: '核心按钮', properties: { 标题: '核心按钮' } },
        { id: 'coreEdit', name: '核心编辑框1', type: '编辑框', typeId: 'Edit', libraryId: 'krnln', left: 480, top: 60, width: 160, height: 32, text: '核心文本', properties: { 内容: '核心文本', 是否允许多行: false } },
        { id: 'coreLabel', name: '核心标签1', type: '标签', typeId: 'Static', libraryId: 'krnln', left: 480, top: 100, width: 120, height: 24, text: '核心标签', properties: { 标题: '核心标签' } },
        { id: 'corePicture', name: '核心图片框1', type: '图片框', typeId: 'PictureBox', libraryId: 'krnln', left: 480, top: 140, width: 120, height: 80, properties: { 图片: '' } },
        { id: 'webview', name: '浏览框1', type: '浏览框', typeId: 'WebView', libraryId: 'webview2', left: 20, top: 300, width: 240, height: 120, properties: { 地址: 'about:blank' } },
        { id: 'webbutton', name: '网页按钮1', type: '网页按钮', typeId: 'WebButton', libraryId: 'webview2', left: 300, top: 280, width: 120, height: 36, text: '确认', properties: { 标题: '确认' } },
        { id: 'webedit', name: '网页编辑框1', type: '网页编辑框', typeId: 'WebEdit', libraryId: 'webview2', left: 300, top: 330, width: 160, height: 36, text: '文本', properties: { 内容: '文本' } },
      ],
    }))
    writeFileSync(join(dir, '_启动窗口.eyc'), [
      '.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 __启动窗口_创建完毕',
      '标签1.标题 ＝ 编辑框1.内容',
      '库内按钮1.标题 ＝ “ok”', '外库按钮1.标题 ＝ “ok”',
      '选择框1.选中 ＝ 真', '滑块条1.位置 ＝ 6', '进度条1.位置 ＝ 4', '浏览框1.地址 ＝ “about:blank”',
      '网页按钮1.标题 ＝ “继续”', '网页编辑框1.内容 ＝ “已更新”',
      '核心按钮1.标题 ＝ “核心按钮已更新”', '核心编辑框1.内容 ＝ “核心编辑框已更新”', '核心标签1.标题 ＝ “核心标签已更新”',
      '.如果真 (标签1.标题 ＝ “真实输入” 且 库内按钮1.标题 ＝ “ok” 且 外库按钮1.标题 ＝ “[external]ok”)',
      '    销毁 ()',
      '.如果真结束',
    ].join('\n'))
    const messages: string[] = []
    setCompilerHost({ emitOutput: message => messages.push(message.text), requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
    const result = await compileProject({ projectDir: dir, mode: 'compile' })
    expect(result.success, messages.join('\n')).toBe(true)
    expect(existsSync(result.outputFile)).toBe(true)
    expect(existsSync(join(dir, 'output', 'windows', 'x64', 'assets', 'project-images', 'image-0.svg'))).toBe(true)
    const generated = readFileSync(join(dir, 'temp', 'eui', 'main.cpp'), 'utf8')
    expect(generated).toContain('__启动窗口_创建完毕')
    expect(generated).toContain('EuiWebView')
    expect(readFileSync(join(dir, 'temp', 'eui', 'CMakeLists.txt'), 'utf8')).toContain('webview2/impl/windows.cpp')
    await new Promise<void>((complete, fail) => {
      execFile(result.outputFile, [], { cwd: tmpdir(), timeout: 15000 }, error => error ? fail(error) : complete())
    })
    const binary = readFileSync(result.outputFile)
    writeFileSync(join(dir, '_启动窗口.eyc'), '.版本 2\n.程序集 无效源码\n.子程序 错误\n不存在的命令 ()')
    const failed = await compileProject({ projectDir: dir, mode: 'compile' })
    expect(failed.success).toBe(false)
    expect(readFileSync(result.outputFile).equals(binary)).toBe(true)
    const preview = await compileProject({ projectDir: dir, mode: 'compile', previewWindow: '_启动窗口' })
    expect(preview.success, messages.join('\n')).toBe(true)
    expect(readFileSync(join(dir, 'temp', 'eui', 'main.cpp'), 'utf8')).not.toContain('extern void __启动窗口_创建完毕')
  }, 180000)

  it.skipIf(!buildAvailable)('reopens a destroyed native child and deploys image resources', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-eui-reopen-'))
    temporary.push(dir)
    const example = join(root, 'examples', 'eui-window')
    for (const file of ['EUI窗口示例.epp', '_启动窗口.efw', '_启动窗口.eyc', '第二窗口.efw', '第二窗口.eyc']) {
      copyFileSync(join(example, file), join(dir, file))
    }
    const formPath = join(dir, '_启动窗口.efw')
    const form = JSON.parse(readFileSync(formPath, 'utf8'))
    form.controls.find((control: { type: string }) => control.type === 'EUI图片框').properties['图片'] =
      join(root, 'lib', 'eui-poc', 'assets', 'layout-preview.svg')
    writeFileSync(formPath, JSON.stringify(form))
    const sourcePath = join(dir, '_启动窗口.eyc')
    writeFileSync(sourcePath, readFileSync(sourcePath, 'utf8').replace('标签1.标题 ＝ “窗口创建事件已执行。请输入文本，再点应用。”', '载入 (第二窗口, _启动窗口, 假)'))
    writeFileSync(join(dir, '第二窗口.eyc'), [
      '.版本 2', '.程序集 子窗口测试', '.程序集变量 次数, 整数型',
      '.子程序 _第二窗口_创建完毕', '次数 ＝ 次数 ＋ 1',
      '.如果 (次数 ＝ 1)', '    销毁 (第二窗口)', '    载入 (第二窗口, _启动窗口, 假)',
      '.否则', '    销毁 (_启动窗口)', '.如果结束',
    ].join('\n'))
    const messages: string[] = []
    setCompilerHost({ emitOutput: message => messages.push(message.text), requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
    const result = await compileProject({ projectDir: dir, mode: 'compile' })
    expect(result.success, messages.join('\n')).toBe(true)
    expect(existsSync(join(dir, 'output', 'windows', 'x64', 'assets', 'project-images', 'image-0.svg'))).toBe(true)
    await new Promise<void>((complete, fail) => {
      execFile(result.outputFile, [], { cwd: tmpdir(), timeout: 15000 }, error => error ? fail(error) : complete())
    })
  }, 180000)

  it.skipIf(!buildAvailable)('runs the shipped script component and resets its state when an EUI child is reopened', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-eui-script-'))
    temporary.push(dir)
    writeFileSync(join(dir, 'script.epp'), [
      'Version=1', 'ProjectName=EUI脚本测试', 'OutputType=WindowsApp', 'Platform=windows',
      `UiProvider=${EUI_WINDOW_UI_PROVIDER}`, 'UiProviderApiVersion=1', 'UiProviderPluginVersion=0.1.0', 'Compiler=ycide.eui-msvc',
      'File=EFW|主窗口.efw|1', 'File=EYC|主窗口.eyc|0',
      'File=EFW|子窗口.efw|0', 'File=EYC|子窗口.eyc|0',
    ].join('\n'))
    writeFileSync(join(dir, '主窗口.efw'), JSON.stringify({
      name: '主窗口', title: 'Shipped script component', width: 640, height: 480,
      controls: [],
    }))
    const child = {
      name: '子窗口', title: 'Script lifecycle', width: 400, height: 300,
      controls: [
        { name: '脚本组件1', type: '脚本组件', libraryId: 'script', typeId: 'Script', width: 32, height: 32, properties: { 语言: 'JScript', 超时: 1000 } },
        { name: '脚本组件2', type: '脚本组件', libraryId: 'script', typeId: 'Script', width: 32, height: 32 },
      ],
    }
    writeFileSync(join(dir, '子窗口.efw'), JSON.stringify(child))
    writeFileSync(join(dir, '主窗口.eyc'), [
      '.版本 2', '.程序集 主窗口程序集', '.子程序 _主窗口_创建完毕',
      '载入 (子窗口, 主窗口, 假)',
    ].join('\n'))
    writeFileSync(join(dir, '子窗口.eyc'), [
      '.版本 2', '.程序集 子窗口程序集', '.程序集变量 次数, 整数型',
      '.子程序 _子窗口_创建完毕', '次数 ＝ 次数 ＋ 1',
      '.如果真 (脚本组件1.语言 ≠ “JScript” 或 脚本组件1.超时 ≠ 1000 或 脚本组件2.超时 ≠ 0)',
      '    返回 ()', '.如果真结束',
      '.如果真 (脚本组件1.计算表达式 (“typeof retained”) ≠ “undefined”)',
      '    返回 ()', '.如果真结束',
      '.如果 (次数 ＝ 1)',
      '    脚本组件1.执行 (“var retained = 42; function greet(v) { return v + retained; }”)',
      '    .如果真 (脚本组件1.运行 (“greet”, “value:”) ≠ “value:42” 或 脚本组件2.计算表达式 (“typeof retained”) ≠ “undefined”)',
      '        返回 ()', '    .如果真结束',
      '    脚本组件1.超时 ＝ 9',
      '    销毁 (子窗口)', '    载入 (子窗口, 主窗口, 假)',
      '.否则',
      '    脚本组件1.执行 (“var retained = 7;”)',
      '    脚本组件1.清除 ()',
      '    .如果真 (脚本组件1.计算表达式 (“typeof retained”) ＝ “undefined” 且 脚本组件1.错误信息 ＝ “”)',
      '        销毁 (主窗口)', '    .如果真结束',
      '.如果结束',
    ].join('\n'))
    const messages: string[] = []
    setCompilerHost({ emitOutput: message => messages.push(message.text), requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
    const result = await compileProject({ projectDir: dir, mode: 'compile' })
    expect(result.success, messages.join('\n')).toBe(true)
    await new Promise<void>((complete, fail) => {
      execFile(result.outputFile, [], { cwd: tmpdir(), timeout: 15000 }, error => error ? fail(error) : complete())
    })
    const preview = await compileProject({ projectDir: dir, mode: 'compile', previewWindow: '子窗口' })
    expect(preview.success, messages.join('\n')).toBe(true)
  }, 180000)

  it.skipIf(!buildAvailable)('builds the editable example with real self-drawn chrome and working caption buttons', async () => {
    const messages: string[] = []
    setCompilerHost({ emitOutput: message => messages.push(message.text), requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
    const themePath = join(root, 'lib', 'eui', 'theme-tokens.json')
    const theme = JSON.parse(readFileSync(themePath, 'utf8'))
    const example = join(root, 'examples', 'eui-window')
    for (const darkTheme of [false, true]) {
      let directory = example
      if (darkTheme) {
        directory = mkdtempSync(join(tmpdir(), 'ycide-eui-dark-'))
        temporary.push(directory)
        for (const file of ['EUI窗口示例.epp', '_启动窗口.efw', '_启动窗口.eyc', '第二窗口.efw', '第二窗口.eyc']) copyFileSync(join(example, file), join(directory, file))
        const formPath = join(directory, '_启动窗口.efw')
        const form = JSON.parse(readFileSync(formPath, 'utf8'))
        form.properties['深色主题'] = true
        writeFileSync(formPath, JSON.stringify(form))
      }
      const result = await compileProject({ projectDir: directory, mode: 'compile' })
      expect(result.success, messages.join('\n')).toBe(true)
      await new Promise<void>((complete, fail) => {
        execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
          join(root, 'tests', 'unit', 'helpers', 'eui-window-chrome.ps1'), '-ExecutablePath', result.outputFile,
          '-ClientWidth', '800', '-ClientHeight', '520', '-TitlebarHeight', String(theme.titlebarHeight),
          '-CaptionButtonWidth', String(theme.captionButtonWidth), '-ThemePath', themePath,
          ...(darkTheme ? ['-DarkTheme'] : [])],
        { timeout: 45000 }, (error, stdout, stderr) => error ? fail(new Error(`${error.message}\n${stdout}\n${stderr}`)) : complete())
      })
    }
  }, 180000)
})
