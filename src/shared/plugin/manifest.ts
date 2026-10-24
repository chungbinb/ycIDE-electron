// 插件清单（plugin.json）的类型与校验。设计依据：docs/插件架构设计稿.md §3、§6。
// 阶段 0 只落地命令 / 菜单 / 快捷键三类贡献点，其余贡献点字段先原样保留、不做解释。

import { RENDERER_SURFACES } from './rendererContributions'
import { parseWhenClause } from './whenClause'
import { parseKeybinding } from './keybinding'
import { BUILTIN_API_KEY_SETTINGS } from './aiContributions'

export type PluginHostPlatform = 'windows' | 'linux' | 'macos'
export type PluginHostKind = 'electron' | 'native'

/** 插件 ID：发布者.名称，只用小写英文、数字、短横线（设计稿 §13.1 第 7 条） */
export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/

/** 平台标签：windows / linux / macos，可带架构后缀，如 windows-x64（设计稿 §3.4） */
const PLATFORM_TAG_PATTERN = /^(windows|linux|macos)(-(x64|x86|arm64))?$/

export interface CommandContribution {
  /** 命令 ID，如 file:save */
  id: string
  /** 显示名（不含助记符） */
  title: string
  /** 启用条件（when 表达式）；不满足时菜单项置灰 */
  enablement?: string
}

export interface MenubarMenuContribution {
  /** 顶层菜单 ID，如 file；菜单项挂在 menus["menubar/<id>"] 下 */
  id: string
  title: string
  /** 助记符，自绘菜单显示为「文件(F)」 */
  mnemonic?: string
  /** 顶层菜单的排序值，越小越靠左 */
  order: number
}

export interface MenuItemContribution {
  /** 与 submenu 二选一：执行的命令 */
  command?: string
  /** 与 command 二选一：动态子菜单的提供者 ID（如最近打开、主题列表），由宿主在渲染时填充 */
  submenu?: string
  /** 覆盖命令的显示名；动态子菜单必须提供 */
  title?: string
  mnemonic?: string
  /** 分组与组内顺序，格式「组名@序号」；不同组之间自动插入分隔线，组按名称排序 */
  group?: string
  /** 显示条件（when 表达式）；不满足时不显示 */
  when?: string
  /** 原生菜单（macOS）里改用系统角色，如 undo / copy；自绘菜单忽略 */
  nativeRole?: string
}

export interface KeybindingContribution {
  command: string
  /** 默认按键，Electron 加速键格式，如 CmdOrCtrl+Shift+S、F5 */
  key: string
  /** 平台专用按键，覆盖 key */
  mac?: string
  win?: string
  linux?: string
  /** 只在这些平台生效；省略表示全平台 */
  platforms?: PluginHostPlatform[]
  /** 生效条件（when 表达式） */
  when?: string
  /** 执行命令时附带的参数 */
  args?: unknown[]
  /**
   * false：不由全局快捷键分发器触发，只用于菜单上显示按键、以及作为原生菜单的加速键。
   * 用于按键实际由系统 / 编辑器 / 其他绑定处理的情况（如 Alt+F4、Delete、全选）。
   */
  dispatch?: boolean
}

/** 主题：插件目录内的主题 JSON 文件，格式与 themes/ 目录下的主题文件相同 */
export interface ThemeContribution {
  /** 主题 ID（即主题名，显示在主题菜单和主题管理器里） */
  id: string
  /** 相对插件目录的路径 */
  path: string
}

export interface PluginContributes {
  commands?: CommandContribution[]
  menubarMenus?: MenubarMenuContribution[]
  /** 键为菜单位置，阶段 0 只支持 menubar/<顶层菜单ID> */
  menus?: Record<string, MenuItemContribution[]>
  keybindings?: KeybindingContribution[]
  themes?: ThemeContribution[]
  /** AI 模型提供方，见 aiContributions.ts */
  aiProviders?: unknown[]
  /** AI Agent 工具，见 aiContributions.ts */
  aiTools?: unknown[]
  /** 编译器，见 src/main/compilers/compilerService.ts */
  compilers?: unknown[]
  /** 语言：文档语言 ID 与扩展名（语言服务插件声明） */
  languages?: Array<{ id: string; aliases?: string[]; extensions?: string[] }>
  /** 编辑器提供者，见 editorContributions.ts */
  editors?: unknown[]
  /** 渲染后端，见 rendererContributions.ts */
  renderers?: unknown[]
  /** 支持库：插件目录本身就是一个支持库目录（*.ycmd.json、window-units.json、impl/ 等），name 为支持库名 */
  libraries?: Array<{ name: string }>
  [contributionPoint: string]: unknown
}

export interface PluginManifest {
  id: string
  displayName: string
  version: string
  publisher: string
  description?: string
  engines?: { ycide?: string; protocol?: string }
  /** 可加载的宿主平台；省略表示全平台 */
  platforms?: string[]
  /** 可加载的宿主类型；省略表示全部 */
  hosts?: PluginHostKind[]
  /** 支持库、编译器专用：编译产物可运行的目标平台（与宿主平台无关，见设计稿 §3.4） */
  targets?: string[]
  runtime?: { type: 'node' | 'executable' | 'none'; [key: string]: unknown }
  activationEvents?: string[]
  permissions?: string[]
  /** 依赖的其他插件：ID → 版本范围（阶段 0 只检查存在性） */
  dependencies?: Record<string, string>
  /** 内置插件标记：内置插件由宿主随版本发布 */
  builtin?: boolean
  contributes?: PluginContributes
}

export type ManifestValidationResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; errors: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** 插件内文件路径：相对路径，且不能用 .. 跳出插件目录 */
export function isSafeRelativePath(path: string): boolean {
  if (/^([a-zA-Z]:|[\\/])/.test(path)) return false
  return !path.split(/[\\/]+/).some(part => part === '..')
}

function checkWhen(expr: unknown, where: string, errors: string[]): void {
  if (expr === undefined) return
  if (typeof expr !== 'string') {
    errors.push(`${where}: when 表达式必须是字符串`)
    return
  }
  try {
    parseWhenClause(expr)
  } catch (err) {
    errors.push(`${where}: when 表达式无效（${(err as Error).message}）`)
  }
}

function checkKey(key: unknown, where: string, errors: string[]): void {
  if (key === undefined) return
  if (typeof key !== 'string' || !parseKeybinding(key)) {
    errors.push(`${where}: 无法识别的按键「${String(key)}」`)
  }
}

/** 校验并规范化插件清单；只做结构校验，不检查依赖是否存在（由插件解析阶段负责） */
export function validatePluginManifest(raw: unknown): ManifestValidationResult {
  const errors: string[] = []
  if (!isRecord(raw)) return { ok: false, errors: ['清单必须是 JSON 对象'] }

  const id = raw.id
  if (!isNonEmptyString(id) || !PLUGIN_ID_PATTERN.test(id)) {
    errors.push(`id「${String(id)}」不符合「发布者.名称」格式（小写英文、数字、短横线）`)
  }
  if (!isNonEmptyString(raw.displayName)) errors.push('缺少 displayName')
  if (!isNonEmptyString(raw.version)) errors.push('缺少 version')
  if (!isNonEmptyString(raw.publisher)) errors.push('缺少 publisher')
  else if (isNonEmptyString(id) && !id.startsWith(`${raw.publisher}.`)) {
    errors.push(`id「${id}」必须以发布者「${raw.publisher}.」开头`)
  }

  if (raw.platforms !== undefined) {
    if (!Array.isArray(raw.platforms) || raw.platforms.some(p => typeof p !== 'string' || !PLATFORM_TAG_PATTERN.test(p))) {
      errors.push('platforms 只能包含 windows / linux / macos（可带 -x64 / -x86 / -arm64 后缀）')
    }
  }
  if (raw.hosts !== undefined) {
    if (!Array.isArray(raw.hosts) || raw.hosts.some(h => h !== 'electron' && h !== 'native')) {
      errors.push('hosts 只能包含 electron / native')
    }
  }
  if (raw.dependencies !== undefined) {
    if (!isRecord(raw.dependencies) || Object.values(raw.dependencies).some(v => typeof v !== 'string')) {
      errors.push('dependencies 必须是「插件ID → 版本范围」的对象')
    }
  }

  const contributes = raw.contributes
  if (contributes !== undefined && !isRecord(contributes)) {
    errors.push('contributes 必须是对象')
  } else if (contributes) {
    const commandIds = new Set<string>()
    if (contributes.commands !== undefined) {
      if (!Array.isArray(contributes.commands)) errors.push('contributes.commands 必须是数组')
      else contributes.commands.forEach((cmd, i) => {
        const where = `contributes.commands[${i}]`
        if (!isRecord(cmd) || !isNonEmptyString(cmd.id) || !isNonEmptyString(cmd.title)) {
          errors.push(`${where}: 需要 id 和 title`)
          return
        }
        if (commandIds.has(cmd.id)) errors.push(`${where}: 命令 ${cmd.id} 重复声明`)
        commandIds.add(cmd.id)
        checkWhen(cmd.enablement, where, errors)
      })
    }

    if (contributes.menubarMenus !== undefined) {
      if (!Array.isArray(contributes.menubarMenus)) errors.push('contributes.menubarMenus 必须是数组')
      else contributes.menubarMenus.forEach((menu, i) => {
        if (!isRecord(menu) || !isNonEmptyString(menu.id) || !isNonEmptyString(menu.title) || typeof menu.order !== 'number') {
          errors.push(`contributes.menubarMenus[${i}]: 需要 id、title 和数字 order`)
        }
      })
    }

    if (contributes.menus !== undefined) {
      if (!isRecord(contributes.menus)) errors.push('contributes.menus 必须是对象')
      else for (const [location, items] of Object.entries(contributes.menus)) {
        if (!/^menubar\/[a-z0-9-]+$/.test(location)) {
          errors.push(`contributes.menus: 不支持的菜单位置「${location}」`)
          continue
        }
        if (!Array.isArray(items)) {
          errors.push(`contributes.menus["${location}"] 必须是数组`)
          continue
        }
        items.forEach((item, i) => {
          const where = `contributes.menus["${location}"][${i}]`
          if (!isRecord(item)) {
            errors.push(`${where}: 必须是对象`)
            return
          }
          const hasCommand = isNonEmptyString(item.command)
          const hasSubmenu = isNonEmptyString(item.submenu)
          if (hasCommand === hasSubmenu) errors.push(`${where}: command 与 submenu 必须且只能有一个`)
          if (hasSubmenu && !isNonEmptyString(item.title)) errors.push(`${where}: 动态子菜单需要 title`)
          if (item.group !== undefined && (typeof item.group !== 'string' || !/^[^@]+(@\d+)?$/.test(item.group))) {
            errors.push(`${where}: group 格式应为「组名@序号」`)
          }
          checkWhen(item.when, where, errors)
        })
      }
    }

    if (contributes.keybindings !== undefined) {
      if (!Array.isArray(contributes.keybindings)) errors.push('contributes.keybindings 必须是数组')
      else contributes.keybindings.forEach((kb, i) => {
        const where = `contributes.keybindings[${i}]`
        if (!isRecord(kb) || !isNonEmptyString(kb.command) || !isNonEmptyString(kb.key)) {
          errors.push(`${where}: 需要 command 和 key`)
          return
        }
        checkKey(kb.key, where, errors)
        checkKey(kb.mac, `${where}.mac`, errors)
        checkKey(kb.win, `${where}.win`, errors)
        checkKey(kb.linux, `${where}.linux`, errors)
        checkWhen(kb.when, where, errors)
        if (kb.args !== undefined && !Array.isArray(kb.args)) errors.push(`${where}: args 必须是数组`)
      })
    }

    if (contributes.aiProviders !== undefined) {
      if (!Array.isArray(contributes.aiProviders)) errors.push('contributes.aiProviders 必须是数组')
      else contributes.aiProviders.forEach((provider, i) => {
        const where = `contributes.aiProviders[${i}]`
        if (!isRecord(provider) || !isNonEmptyString(provider.id) || !isNonEmptyString(provider.label) || !isNonEmptyString(provider.endpoint)) {
          errors.push(`${where}: 需要 id、label 和 endpoint`)
          return
        }
        if (!/^https?:\/\//i.test(provider.endpoint)) errors.push(`${where}: endpoint 必须是 http / https 地址`)
        if (provider.envKey !== undefined && !isNonEmptyString(provider.envKey)) errors.push(`${where}: envKey 必须是字符串`)
        if (provider.apiKeySetting !== undefined && !BUILTIN_API_KEY_SETTINGS.includes(provider.apiKeySetting as never)) {
          errors.push(`${where}: apiKeySetting 只能是 ${BUILTIN_API_KEY_SETTINGS.join(' / ')}`)
        }
        if (!Array.isArray(provider.models) || provider.models.length === 0) {
          errors.push(`${where}: models 必须是非空数组`)
          return
        }
        provider.models.forEach((model, j) => {
          if (!isRecord(model) || !isNonEmptyString(model.id) || !isNonEmptyString(model.label) || !isNonEmptyString(model.model)) {
            errors.push(`${where}.models[${j}]: 需要 id、label 和 model`)
          }
        })
      })
    }

    if (contributes.aiTools !== undefined) {
      if (!Array.isArray(contributes.aiTools)) errors.push('contributes.aiTools 必须是数组')
      else contributes.aiTools.forEach((tool, i) => {
        const where = `contributes.aiTools[${i}]`
        if (!isRecord(tool) || !isNonEmptyString(tool.name) || !isNonEmptyString(tool.description) || !isNonEmptyString(tool.command)) {
          errors.push(`${where}: 需要 name、description 和 command`)
          return
        }
        if (!/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(tool.name)) errors.push(`${where}: name 只能用英文字母、数字、下划线和短横线`)
        if (tool.risk !== undefined && !['read', 'write', 'exec'].includes(String(tool.risk))) errors.push(`${where}: risk 只能是 read / write / exec`)
        if (tool.parameters !== undefined && !isRecord(tool.parameters)) errors.push(`${where}: parameters 必须是 JSON Schema 对象`)
      })
    }

    if (contributes.compilers !== undefined) {
      if (!Array.isArray(contributes.compilers)) errors.push('contributes.compilers 必须是数组')
      else contributes.compilers.forEach((compiler, i) => {
        const where = `contributes.compilers[${i}]`
        if (!isRecord(compiler) || !isNonEmptyString(compiler.id) || !isNonEmptyString(compiler.displayName)) {
          errors.push(`${where}: 需要 id 和 displayName`)
          return
        }
        for (const field of ['targets', 'acceptsImplementations'] as const) {
          const value = compiler[field]
          if (value !== undefined && (!Array.isArray(value) || value.some(v => !isNonEmptyString(v)))) errors.push(`${where}: ${field} 必须是字符串数组`)
        }
        if (compiler.commands !== undefined) {
          if (!isRecord(compiler.commands) || !isNonEmptyString(compiler.commands.build)) errors.push(`${where}: commands.build 必须是命令 ID`)
        } else if (!raw.builtin) {
          errors.push(`${where}: 第三方编译器必须提供 commands.build`)
        }
      })
    }

    if (contributes.languages !== undefined) {
      if (!Array.isArray(contributes.languages) || contributes.languages.some(l => !isRecord(l) || !isNonEmptyString(l.id))) {
        errors.push('contributes.languages 必须是 [{ id, aliases?, extensions? }] 数组')
      }
    }

    if (contributes.editors !== undefined) {
      if (!Array.isArray(contributes.editors)) errors.push('contributes.editors 必须是数组')
      else contributes.editors.forEach((editor, i) => {
        const where = `contributes.editors[${i}]`
        if (!isRecord(editor) || !isNonEmptyString(editor.id) || !isNonEmptyString(editor.displayName)) {
          errors.push(`${where}: 需要 id 和 displayName`)
          return
        }
        if (!Array.isArray(editor.languages) || editor.languages.length === 0 || editor.languages.some(l => !isNonEmptyString(l))) {
          errors.push(`${where}: languages 必须是非空字符串数组`)
        }
        if (editor.priority !== undefined && editor.priority !== 'default' && editor.priority !== 'option') {
          errors.push(`${where}: priority 只能是 default / option`)
        }
        const ui = editor.ui
        if (!isRecord(ui) || (ui.type !== 'builtin' && ui.type !== 'web')) {
          errors.push(`${where}: ui.type 只能是 builtin / web`)
        } else if (ui.type === 'builtin') {
          if (!raw.builtin) errors.push(`${where}: 只有内置插件可以使用 builtin 编辑器`)
          if (!isNonEmptyString(ui.component)) errors.push(`${where}: builtin 编辑器需要 ui.component`)
        } else if (!isNonEmptyString(ui.entry) || !isSafeRelativePath(ui.entry)) {
          errors.push(`${where}: web 编辑器需要插件目录内的 ui.entry`)
        }
      })
    }

    if (contributes.renderers !== undefined) {
      if (!Array.isArray(contributes.renderers)) errors.push('contributes.renderers 必须是数组')
      else contributes.renderers.forEach((renderer, i) => {
        const where = `contributes.renderers[${i}]`
        if (!isRecord(renderer) || !isNonEmptyString(renderer.id) || !isNonEmptyString(renderer.displayName)) {
          errors.push(`${where}: 需要 id 和 displayName`)
          return
        }
        if (!raw.builtin) errors.push(`${where}: 渲染后端直接操作编辑器界面，只有内置插件可以提供`)
        if (!Array.isArray(renderer.surfaces) || renderer.surfaces.length === 0
          || renderer.surfaces.some(s => !(RENDERER_SURFACES as readonly unknown[]).includes(s))) {
          errors.push(`${where}: surfaces 必须是非空数组，可选 ${RENDERER_SURFACES.join(' / ')}`)
        }
        if (!isNonEmptyString(renderer.implementation)) errors.push(`${where}: 需要 implementation`)
      })
    }

    if (contributes.libraries !== undefined) {
      if (!Array.isArray(contributes.libraries) || contributes.libraries.some(lib => !isRecord(lib) || !isNonEmptyString(lib.name))) {
        errors.push('contributes.libraries 必须是 [{ name }] 数组')
      }
    }

    if (contributes.themes !== undefined) {
      if (!Array.isArray(contributes.themes)) errors.push('contributes.themes 必须是数组')
      else contributes.themes.forEach((theme, i) => {
        if (!isRecord(theme) || !isNonEmptyString(theme.id) || !isNonEmptyString(theme.path)) {
          errors.push(`contributes.themes[${i}]: 需要 id 和 path`)
        } else if (!isSafeRelativePath(theme.path)) {
          errors.push(`contributes.themes[${i}]: path 必须是插件目录内的相对路径`)
        }
      })
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, manifest: raw as unknown as PluginManifest }
}

/** 判断插件能否在指定宿主平台 / 架构上加载（设计稿 §3.4 规则 1、2） */
export function isPlatformSupported(manifest: Pick<PluginManifest, 'platforms'>, platform: string, arch?: string): boolean {
  const tags = manifest.platforms
  if (!tags || tags.length === 0) return true
  return tags.some(tag => {
    const [os, tagArch] = tag.split('-')
    if (os !== platform) return false
    return !tagArch || !arch || tagArch === arch
  })
}

/** 判断插件能否在指定宿主类型上加载 */
export function isHostSupported(manifest: Pick<PluginManifest, 'hosts'>, host: PluginHostKind): boolean {
  const hosts = manifest.hosts
  return !hosts || hosts.length === 0 || hosts.includes(host)
}
