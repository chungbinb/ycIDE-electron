// 贡献点汇总：把各插件清单里的命令、菜单、快捷键合并成一份模型，
// 再按当前平台与上下文「渲染」成具体的菜单树（自绘标题栏菜单和 macOS 原生菜单共用）。

import type {
  CommandContribution,
  KeybindingContribution,
  MenuItemContribution,
  PluginHostPlatform,
  PluginManifest,
} from './manifest'
import { evaluateWhenClause, type ContextLookup } from './whenClause'
import { formatKeybindingLabel, matchesKeyEvent, parseKeybinding, type KeyEventLike } from './keybinding'

export interface ContributedCommand extends CommandContribution {
  pluginId: string
}

export interface ContributedMenuItem extends MenuItemContribution {
  pluginId: string
  groupName: string
  groupOrder: number
}

export interface ContributedMenubarMenu {
  id: string
  title: string
  mnemonic?: string
  order: number
  pluginId: string
  items: ContributedMenuItem[]
}

export interface ContributedKeybinding extends KeybindingContribution {
  pluginId: string
}

export interface ContributionModel {
  commands: Map<string, ContributedCommand>
  menubar: ContributedMenubarMenu[]
  keybindings: ContributedKeybinding[]
  /** 合并过程中发现的问题（重复声明、引用不存在的菜单等），不阻断加载 */
  warnings: string[]
}

/** 没写 group 的菜单项排在所有分组之后 */
const DEFAULT_GROUP = '~default'

function splitGroup(group: string | undefined): { groupName: string; groupOrder: number } {
  if (!group) return { groupName: DEFAULT_GROUP, groupOrder: Number.MAX_SAFE_INTEGER }
  const at = group.lastIndexOf('@')
  if (at < 0) return { groupName: group, groupOrder: Number.MAX_SAFE_INTEGER }
  return { groupName: group.slice(0, at), groupOrder: Number(group.slice(at + 1)) }
}

/** 合并已启用插件的贡献点；manifests 应已按依赖拓扑序排列 */
export function buildContributionModel(manifests: PluginManifest[]): ContributionModel {
  const commands = new Map<string, ContributedCommand>()
  const menus = new Map<string, ContributedMenubarMenu>()
  const keybindings: ContributedKeybinding[] = []
  const warnings: string[] = []

  for (const manifest of manifests) {
    const c = manifest.contributes
    if (!c) continue
    for (const cmd of c.commands ?? []) {
      const existing = commands.get(cmd.id)
      if (existing) {
        warnings.push(`命令 ${cmd.id} 已由 ${existing.pluginId} 声明，${manifest.id} 的声明被忽略`)
        continue
      }
      commands.set(cmd.id, { ...cmd, pluginId: manifest.id })
    }
    for (const menu of c.menubarMenus ?? []) {
      const existing = menus.get(menu.id)
      if (existing) {
        warnings.push(`顶层菜单 ${menu.id} 已由 ${existing.pluginId} 声明，${manifest.id} 的声明被忽略`)
        continue
      }
      menus.set(menu.id, { ...menu, pluginId: manifest.id, items: [] })
    }
    for (const kb of c.keybindings ?? []) keybindings.push({ ...kb, pluginId: manifest.id })
  }

  // 菜单项放在顶层菜单都收集完之后处理：插件可以往别的插件声明的顶层菜单里加项
  let seq = 0
  const insertionOrder = new Map<ContributedMenuItem, number>()
  for (const manifest of manifests) {
    for (const [location, items] of Object.entries(manifest.contributes?.menus ?? {})) {
      const menuId = location.slice('menubar/'.length)
      const menu = menus.get(menuId)
      if (!menu) {
        warnings.push(`${manifest.id} 往不存在的顶层菜单 ${menuId} 添加菜单项，已忽略`)
        continue
      }
      for (const item of items) {
        if (item.command && !commands.has(item.command)) {
          warnings.push(`${manifest.id} 的菜单项引用了未声明的命令 ${item.command}，已忽略`)
          continue
        }
        const entry: ContributedMenuItem = { ...item, pluginId: manifest.id, ...splitGroup(item.group) }
        insertionOrder.set(entry, seq++)
        menu.items.push(entry)
      }
    }
  }

  for (const menu of menus.values()) {
    menu.items.sort((a, b) =>
      a.groupName === b.groupName
        ? (a.groupOrder - b.groupOrder) || (insertionOrder.get(a)! - insertionOrder.get(b)!)
        : (a.groupName < b.groupName ? -1 : 1),
    )
  }

  const menubar = [...menus.values()].sort((a, b) => a.order - b.order)
  return { commands, menubar, keybindings, warnings }
}

// ───────────────────────── 菜单渲染 ─────────────────────────

export interface DynamicMenuEntry {
  label: string
  command?: string
  args?: unknown[]
  checked?: boolean
  enabled?: boolean
  /** 为 true 时表示分隔线，其余字段忽略 */
  separator?: boolean
}

export type ResolvedMenuItem =
  | { kind: 'separator' }
  | {
    kind: 'command'
    label: string
    command: string
    args?: unknown[]
    enabled: boolean
    checked?: boolean
    /** 菜单上显示的按键文字 */
    shortcut?: string
    /** 原生菜单使用的加速键（Electron 格式） */
    accelerator?: string
    nativeRole?: string
  }
  | { kind: 'submenu'; label: string; items: ResolvedMenuItem[] }

export interface ResolvedMenu {
  id: string
  label: string
  items: ResolvedMenuItem[]
}

export interface ResolveMenubarOptions {
  platform: PluginHostPlatform
  context: ContextLookup
  /** 动态子菜单内容：提供者 ID → 条目 */
  dynamicSubmenus?: Record<string, DynamicMenuEntry[]>
  /** 自绘菜单显示助记符「文件(F)」，原生菜单不显示 */
  showMnemonics: boolean
}

function withMnemonic(title: string, mnemonic: string | undefined, show: boolean): string {
  return show && mnemonic ? `${title}(${mnemonic})` : title
}

/** 取某平台上的有效按键：平台专用按键优先 */
export function effectiveKey(kb: KeybindingContribution, platform: PluginHostPlatform): string {
  if (platform === 'macos' && kb.mac) return kb.mac
  if (platform === 'windows' && kb.win) return kb.win
  if (platform === 'linux' && kb.linux) return kb.linux
  return kb.key
}

function keybindingApplies(kb: KeybindingContribution, platform: PluginHostPlatform): boolean {
  return !kb.platforms || kb.platforms.length === 0 || kb.platforms.includes(platform)
}

/** 命令在菜单上显示的按键：取该平台上第一个不带参数的绑定 */
export function findPrimaryKeybinding(model: ContributionModel, command: string, platform: PluginHostPlatform): string | undefined {
  const kb = model.keybindings.find(k => k.command === command && !k.args && keybindingApplies(k, platform))
  return kb ? effectiveKey(kb, platform) : undefined
}

function resolveDynamicEntries(entries: DynamicMenuEntry[] | undefined): ResolvedMenuItem[] {
  if (!entries || entries.length === 0) {
    return [{ kind: 'command', label: '(空)', command: '', enabled: false }]
  }
  return entries.map(entry => entry.separator
    ? { kind: 'separator' as const }
    : {
      kind: 'command' as const,
      label: entry.label,
      command: entry.command ?? '',
      args: entry.args,
      enabled: entry.enabled !== false && !!entry.command,
      checked: entry.checked,
    })
}

export function resolveMenubar(model: ContributionModel, options: ResolveMenubarOptions): ResolvedMenu[] {
  const { platform, context, dynamicSubmenus, showMnemonics } = options
  return model.menubar.map(menu => {
    const items: ResolvedMenuItem[] = []
    let lastGroup: string | null = null
    for (const item of menu.items) {
      if (!evaluateWhenClause(item.when, context)) continue
      if (lastGroup !== null && item.groupName !== lastGroup) items.push({ kind: 'separator' })
      lastGroup = item.groupName
      if (item.submenu) {
        items.push({
          kind: 'submenu',
          label: withMnemonic(item.title ?? item.submenu, item.mnemonic, showMnemonics),
          items: resolveDynamicEntries(dynamicSubmenus?.[item.submenu]),
        })
        continue
      }
      const cmd = model.commands.get(item.command!)!
      const key = findPrimaryKeybinding(model, cmd.id, platform)
      items.push({
        kind: 'command',
        label: withMnemonic(item.title ?? cmd.title, item.mnemonic, showMnemonics),
        command: cmd.id,
        enabled: evaluateWhenClause(cmd.enablement, context),
        shortcut: key ? formatKeybindingLabel(key, platform) : undefined,
        accelerator: key,
        nativeRole: item.nativeRole,
      })
    }
    return { id: menu.id, label: withMnemonic(menu.title, menu.mnemonic, showMnemonics), items }
  })
}

// ───────────────────────── 快捷键分发 ─────────────────────────

export interface KeybindingMatch {
  command: string
  args?: unknown[]
}

/**
 * 找出键盘事件对应的命令：按声明顺序取第一个按键匹配且 when 满足的绑定。
 * dispatch 为 false 的绑定只用于显示，不参与分发。
 */
export function matchKeybinding(
  model: ContributionModel,
  event: KeyEventLike,
  platform: PluginHostPlatform,
  context: ContextLookup,
): KeybindingMatch | null {
  for (const kb of model.keybindings) {
    if (kb.dispatch === false || !keybindingApplies(kb, platform)) continue
    const parsed = parseKeybinding(effectiveKey(kb, platform))
    if (!parsed || !matchesKeyEvent(parsed, event)) continue
    if (!evaluateWhenClause(kb.when, context)) continue
    return { command: kb.command, args: kb.args }
  }
  return null
}
