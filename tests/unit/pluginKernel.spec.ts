// 插件内核（阶段 0）：清单校验、when 表达式、快捷键、插件解析、贡献点汇总、命令注册表。
// 设计依据：docs/插件架构设计稿.md §3、§6.1、§9。
import { describe, it, expect, vi } from 'vitest'
import { evaluateWhenClause, parseWhenClause } from '../../src/shared/plugin/whenClause'
import { formatKeybindingLabel, matchesKeyEvent, parseKeybinding, type KeyEventLike } from '../../src/shared/plugin/keybinding'
import { isPlatformSupported, validatePluginManifest } from '../../src/shared/plugin/manifest'
import { resolvePlugins } from '../../src/shared/plugin/pluginResolver'
import { buildContributionModel, matchKeybinding, resolveMenubar } from '../../src/shared/plugin/contributions'
import { CommandRegistry } from '../../src/shared/plugin/commandRegistry'
import { BUILTIN_PLUGIN_CANDIDATES, loadPlugins } from '../../src/shared/plugin/builtinPlugins'

function key(partial: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, code: '', ...partial }
}

function manifest(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  // ycide 发布者保留给官方内置插件，测试里的 ycide.* 清单按内置插件构造
  return { id, displayName: id, version: '1.0.0', publisher: id.split('.')[0], ...(id.startsWith('ycide.') ? { builtin: true } : {}), ...extra }
}

describe('when 表达式', () => {
  it('支持标识符、取反、与或、比较和括号', () => {
    const ctx = { projectOpen: true, fileOpen: false, lang: 'eyc', count: 2 }
    expect(evaluateWhenClause('projectOpen', ctx)).toBe(true)
    expect(evaluateWhenClause('!fileOpen', ctx)).toBe(true)
    expect(evaluateWhenClause('projectOpen && fileOpen', ctx)).toBe(false)
    expect(evaluateWhenClause('fileOpen || projectOpen', ctx)).toBe(true)
    expect(evaluateWhenClause("lang == 'eyc'", ctx)).toBe(true)
    expect(evaluateWhenClause('lang != eyc', ctx)).toBe(false)
    expect(evaluateWhenClause('count == 2', ctx)).toBe(true)
    expect(evaluateWhenClause('!(projectOpen && fileOpen)', ctx)).toBe(true)
    expect(evaluateWhenClause('fileOpen || projectOpen && lang == eyc', ctx)).toBe(true)
    expect(evaluateWhenClause('missingKey', ctx)).toBe(false)
  })

  it('空表达式恒真，语法错误时解析抛错、求值按不满足处理', () => {
    expect(evaluateWhenClause(undefined, {})).toBe(true)
    expect(evaluateWhenClause('  ', {})).toBe(true)
    expect(() => parseWhenClause('a &&')).toThrow()
    expect(() => parseWhenClause('(a')).toThrow()
    expect(() => parseWhenClause("a == 'x")).toThrow()
    expect(evaluateWhenClause('a &&', { a: true })).toBe(false)
  })
})

describe('快捷键', () => {
  it('解析修饰键与主键，拒绝无法识别的按键', () => {
    expect(parseKeybinding('CmdOrCtrl+Shift+S')).toMatchObject({ cmdOrCtrl: true, shift: true, alt: false, key: 'S' })
    expect(parseKeybinding('F11')).toMatchObject({ key: 'F11' })
    expect(parseKeybinding('Delete')).toMatchObject({ key: 'Delete' })
    expect(parseKeybinding('Ctrl+')).toBeNull()
    expect(parseKeybinding('Ctrl+Foo')).toBeNull()
    expect(parseKeybinding('Shift+Ctrl')).toBeNull()
  })

  it('字母按物理键位匹配，修饰键必须完全一致，CmdOrCtrl 接受 Ctrl 或 Cmd', () => {
    const save = parseKeybinding('CmdOrCtrl+S')!
    expect(matchesKeyEvent(save, key({ key: 's', code: 'KeyS', ctrlKey: true }))).toBe(true)
    expect(matchesKeyEvent(save, key({ key: 's', code: 'KeyS', metaKey: true }))).toBe(true)
    expect(matchesKeyEvent(save, key({ key: 's', code: 'KeyS', ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(matchesKeyEvent(save, key({ key: 's', code: 'KeyS', ctrlKey: true, altKey: true }))).toBe(false)
    expect(matchesKeyEvent(save, key({ key: 's', code: 'KeyS' }))).toBe(false)
    const f5 = parseKeybinding('F5')!
    expect(matchesKeyEvent(f5, key({ key: 'F5', code: 'F5' }))).toBe(true)
    expect(matchesKeyEvent(f5, key({ key: 'F5', code: 'F5', ctrlKey: true }))).toBe(false)
  })

  it('菜单显示文字按平台区分 Ctrl / Cmd', () => {
    expect(formatKeybindingLabel('CmdOrCtrl+Alt+N', 'windows')).toBe('Ctrl+Alt+N')
    expect(formatKeybindingLabel('CmdOrCtrl+Alt+N', 'macos')).toBe('Cmd+Alt+N')
    expect(formatKeybindingLabel('Shift+F11', 'linux')).toBe('Shift+F11')
  })
})

describe('插件清单校验', () => {
  it('接受合法清单', () => {
    const result = validatePluginManifest(manifest('zhangsan.json-helper', {
      platforms: ['windows', 'linux-arm64'],
      contributes: {
        commands: [{ id: 'json:format', title: '格式化', enablement: 'fileOpen' }],
        keybindings: [{ command: 'json:format', key: 'CmdOrCtrl+Alt+F', when: '!editableFocus' }],
      },
    }))
    expect(result.ok).toBe(true)
  })

  it('拒绝不合规的 ID、发布者、平台标签、when 表达式与按键', () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [manifest('Bad.ID'), /发布者\.名称/],
      [{ ...manifest('ycide.a'), publisher: 'other' }, /必须以发布者/],
      [manifest('ycide.a', { platforms: ['win32'] }), /platforms/],
      [manifest('ycide.a', { hosts: ['web'] }), /hosts/],
      [manifest('ycide.a', { contributes: { commands: [{ id: 'x', title: 'X', enablement: 'a &&' }] } }), /when 表达式无效/],
      [manifest('ycide.a', { contributes: { keybindings: [{ command: 'x', key: 'Ctrl+Nope' }] } }), /无法识别的按键/],
      [manifest('ycide.a', { contributes: { menus: { 'menubar/file': [{ command: 'x', submenu: 'y', title: 't' }] } } }), /command 与 submenu/],
      [manifest('ycide.a', { contributes: { menus: { 'editor/context': [] } } }), /不支持的菜单位置/],
    ]
    for (const [raw, pattern] of cases) {
      const result = validatePluginManifest(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.join('\n')).toMatch(pattern)
    }
  })

  it('平台标签可以带架构后缀', () => {
    expect(isPlatformSupported({ platforms: ['windows'] }, 'windows', 'arm64')).toBe(true)
    expect(isPlatformSupported({ platforms: ['windows-x64'] }, 'windows', 'arm64')).toBe(false)
    expect(isPlatformSupported({ platforms: ['windows-x64'] }, 'windows', 'x64')).toBe(true)
    expect(isPlatformSupported({ platforms: ['windows'] }, 'linux')).toBe(false)
    expect(isPlatformSupported({}, 'macos')).toBe(true)
  })
})

describe('插件解析', () => {
  const env = { platform: 'linux' as const, host: 'electron' as const }

  it('当前平台或宿主不支持的插件不启用，并沿依赖链传递', () => {
    const { plugins, enabled } = resolvePlugins([
      { manifest: manifest('ycide.d2d', { platforms: ['windows'] }), source: 'a' },
      { manifest: manifest('ycide.native-ui', { hosts: ['native'] }), source: 'b' },
      { manifest: manifest('ycide.uses-d2d', { dependencies: { 'ycide.d2d': '^1.0.0' } }), source: 'c' },
      { manifest: manifest('ycide.plain'), source: 'd' },
    ], env)
    expect(enabled.map(m => m.id)).toEqual(['ycide.plain'])
    const byId = Object.fromEntries(plugins.map(p => [p.id, p]))
    expect(byId['ycide.d2d'].reason).toMatch(/当前平台不可用/)
    expect(byId['ycide.native-ui'].reason).toMatch(/当前宿主不可用/)
    expect(byId['ycide.uses-d2d'].reason).toMatch(/依赖插件 ycide.d2d 不可用/)
  })

  it('缺少依赖、循环依赖、重复 ID、无效清单都能报出原因', () => {
    const { plugins, enabled } = resolvePlugins([
      { manifest: manifest('ycide.a', { dependencies: { 'ycide.missing': '1' } }), source: 'a' },
      { manifest: manifest('ycide.b', { dependencies: { 'ycide.c': '1' } }), source: 'b' },
      { manifest: manifest('ycide.c', { dependencies: { 'ycide.b': '1' } }), source: 'c' },
      { manifest: manifest('ycide.ok'), source: 'builtin' },
      { manifest: manifest('ycide.ok'), source: 'user' },
      { manifest: { id: 'broken' }, source: 'x' },
    ], env)
    expect(enabled.map(m => m.id)).toEqual(['ycide.ok'])
    const reasons = plugins.map(p => `${p.id}:${p.status}:${p.reason ?? ''}`)
    expect(reasons).toContainEqual(expect.stringMatching(/^ycide\.a:unavailable:缺少依赖插件 ycide\.missing/))
    expect(reasons).toContainEqual(expect.stringMatching(/^ycide\.b:unavailable:存在循环依赖/))
    expect(reasons).toContainEqual(expect.stringMatching(/^ycide\.c:unavailable:存在循环依赖/))
    expect(reasons).toContainEqual(expect.stringMatching(/^ycide\.ok:error:插件 ID 与 builtin 重复/))
    expect(reasons).toContainEqual(expect.stringMatching(/^broken:error:清单无效/))
  })

  it('按依赖拓扑序启用：被依赖者在前', () => {
    const { enabled } = resolvePlugins([
      { manifest: manifest('ycide.app', { dependencies: { 'ycide.lib': '1', 'ycide.core': '1' } }), source: 'a' },
      { manifest: manifest('ycide.lib', { dependencies: { 'ycide.core': '1' } }), source: 'b' },
      { manifest: manifest('ycide.core'), source: 'c' },
    ], env)
    expect(enabled.map(m => m.id)).toEqual(['ycide.core', 'ycide.lib', 'ycide.app'])
  })
})

describe('贡献点汇总', () => {
  it('菜单项按分组排序、组间插入分隔线、按 when 隐藏、按 enablement 置灰', () => {
    const model = buildContributionModel([
      manifest('ycide.a', {
        contributes: {
          menubarMenus: [{ id: 'file', title: '文件', mnemonic: 'F', order: 10 }],
          commands: [
            { id: 'a:one', title: '一' },
            { id: 'a:two', title: '二', enablement: 'projectOpen' },
            { id: 'a:hidden', title: '隐藏' },
          ],
          menus: {
            'menubar/file': [
              { command: 'a:two', group: '2_b@1' },
              { command: 'a:one', group: '1_a@1', mnemonic: 'O' },
              { command: 'a:hidden', group: '1_a@2', when: 'never' },
            ],
          },
          keybindings: [{ command: 'a:one', key: 'CmdOrCtrl+1' }],
        },
      }) as never,
      manifest('ycide.b', {
        contributes: {
          commands: [{ id: 'b:extra', title: '扩展' }],
          menus: { 'menubar/file': [{ command: 'b:extra', group: '1_a@3' }] },
        },
      }) as never,
    ])
    expect(model.warnings).toEqual([])
    const [file] = resolveMenubar(model, { platform: 'windows', context: { projectOpen: false }, showMnemonics: true })
    expect(file.label).toBe('文件(F)')
    expect(file.items).toEqual([
      { kind: 'command', label: '一(O)', command: 'a:one', enabled: true, shortcut: 'Ctrl+1', accelerator: 'CmdOrCtrl+1', nativeRole: undefined },
      { kind: 'command', label: '扩展', command: 'b:extra', enabled: true, shortcut: undefined, accelerator: undefined, nativeRole: undefined },
      { kind: 'separator' },
      { kind: 'command', label: '二', command: 'a:two', enabled: false, shortcut: undefined, accelerator: undefined, nativeRole: undefined },
    ])
  })

  it('重复命令、不存在的顶层菜单、未声明的命令记为警告而不中断', () => {
    const model = buildContributionModel([
      manifest('ycide.a', { contributes: { commands: [{ id: 'x', title: 'X' }] } }) as never,
      manifest('ycide.b', {
        contributes: {
          commands: [{ id: 'x', title: 'X2' }],
          menus: { 'menubar/nope': [{ command: 'x' }] },
        },
      }) as never,
    ])
    expect(model.commands.get('x')?.pluginId).toBe('ycide.a')
    expect(model.warnings.join('\n')).toMatch(/命令 x 已由 ycide\.a 声明/)
    expect(model.warnings.join('\n')).toMatch(/不存在的顶层菜单 nope/)
  })
})

describe('命令注册表', () => {
  it('注册、执行、注销；未注册的命令只告警', async () => {
    const registry = new CommandRegistry()
    const handler = vi.fn((a: unknown) => `got ${String(a)}`)
    const disposable = registry.register('x:run', handler as never)
    expect(() => registry.register('x:run', () => undefined)).toThrow()
    expect(await registry.execute('x:run', 1)).toBe('got 1')
    disposable.dispose()
    expect(registry.has('x:run')).toBe(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await registry.execute('x:run')).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('内置插件', () => {
  it('全部清单合法，三个桌面平台上都能启用且没有合并警告', () => {
    for (const candidate of BUILTIN_PLUGIN_CANDIDATES) {
      const result = validatePluginManifest(candidate.manifest)
      expect(result.ok ? [] : result.errors).toEqual([])
    }
    for (const platform of ['windows', 'linux', 'macos'] as const) {
      const { resolution, model } = loadPlugins({ platform, host: 'electron' })
      expect(resolution.plugins.every(p => p.status === 'enabled')).toBe(true)
      expect(model.warnings).toEqual([])
    }
  })

  it('debug 插件排在它依赖的 build 插件之后', () => {
    const { resolution } = loadPlugins({ platform: 'windows', host: 'electron' })
    const ids = resolution.enabled.map(m => m.id)
    expect(ids.indexOf('ycide.build')).toBeLessThan(ids.indexOf('ycide.debug'))
  })

  it('快捷键分发遵守 when 条件：可编辑控件里不抢编辑类快捷键', () => {
    const { model } = loadPlugins({ platform: 'windows', host: 'electron' })
    const ctrlZ = key({ key: 'z', code: 'KeyZ', ctrlKey: true })
    expect(matchKeybinding(model, ctrlZ, 'windows', { editableFocus: false })?.command).toBe('edit:undo')
    expect(matchKeybinding(model, ctrlZ, 'windows', { editableFocus: true })).toBeNull()
    const ctrlF = key({ key: 'f', code: 'KeyF', ctrlKey: true })
    expect(matchKeybinding(model, ctrlF, 'windows', { editableFocus: true })?.command).toBe('edit:find')
    // dispatch:false 的绑定只用于显示：F5 分发给「编译运行」而不是「调试 → 运行」
    expect(matchKeybinding(model, key({ key: 'F5', code: 'F5' }), 'windows', {})?.command).toBe('build:run')
  })
})
