// 插件解析：在加载任何插件代码之前，根据清单决定哪些插件可以启用、按什么顺序启用。
// 规则（设计稿 §3.4、§9）：
//   1. 清单无效 → error
//   2. 宿主平台 / 宿主类型不匹配 → unavailable
//   3. 依赖缺失、依赖不可用、存在循环依赖 → unavailable（会沿依赖链传递）
//   4. 同 ID 重复 → 后出现的报 error，保留先出现的（内置插件排在前面，不能被覆盖）
// 可用的插件按依赖拓扑排序：被依赖者在前。

import {
  isHostSupported,
  isPlatformSupported,
  validatePluginManifest,
  type PluginHostKind,
  type PluginHostPlatform,
  type PluginManifest,
} from './manifest'

export interface PluginResolveEnv {
  platform: PluginHostPlatform
  arch?: string
  host: PluginHostKind
}

export type ResolvedPluginStatus = 'enabled' | 'unavailable' | 'error'

export interface ResolvedPlugin {
  id: string
  status: ResolvedPluginStatus
  /** status 不是 enabled 时的原因，用于插件管理界面展示 */
  reason?: string
  manifest?: PluginManifest
  /** 清单来源（路径或「内置」），便于排查 */
  source: string
}

export interface PluginCandidate {
  manifest: unknown
  source: string
}

export interface PluginResolution {
  /** 全部插件（含不可用的），顺序：可用插件按拓扑序在前，其余按出现顺序在后 */
  plugins: ResolvedPlugin[]
  /** 可用插件的清单，已按拓扑序排好 */
  enabled: PluginManifest[]
}

export function resolvePlugins(candidates: PluginCandidate[], env: PluginResolveEnv): PluginResolution {
  const byId = new Map<string, ResolvedPlugin>()
  const extras: ResolvedPlugin[] = []

  for (const candidate of candidates) {
    const validation = validatePluginManifest(candidate.manifest)
    if (!validation.ok) {
      const rawId = (candidate.manifest as { id?: unknown } | null)?.id
      extras.push({
        id: typeof rawId === 'string' ? rawId : '(未知)',
        status: 'error',
        reason: `清单无效：${validation.errors.join('；')}`,
        source: candidate.source,
      })
      continue
    }
    const manifest = validation.manifest
    if (byId.has(manifest.id)) {
      extras.push({ id: manifest.id, status: 'error', reason: `插件 ID 与 ${byId.get(manifest.id)!.source} 重复，已忽略`, manifest, source: candidate.source })
      continue
    }
    let status: ResolvedPluginStatus = 'enabled'
    let reason: string | undefined
    if (!isPlatformSupported(manifest, env.platform, env.arch)) {
      status = 'unavailable'
      reason = `当前平台不可用（仅支持 ${manifest.platforms!.join('、')}）`
    } else if (!isHostSupported(manifest, env.host)) {
      status = 'unavailable'
      reason = `当前宿主不可用（仅支持 ${manifest.hosts!.join('、')}）`
    }
    byId.set(manifest.id, { id: manifest.id, status, reason, manifest, source: candidate.source })
  }

  // 依赖检查，传递到不动点：A 依赖 B、B 不可用 → A 也不可用
  let changed = true
  while (changed) {
    changed = false
    for (const plugin of byId.values()) {
      if (plugin.status !== 'enabled') continue
      for (const depId of Object.keys(plugin.manifest!.dependencies ?? {})) {
        const dep = byId.get(depId)
        if (!dep) {
          plugin.status = 'unavailable'
          plugin.reason = `缺少依赖插件 ${depId}`
        } else if (dep.status !== 'enabled') {
          plugin.status = 'unavailable'
          plugin.reason = `依赖插件 ${depId} 不可用`
        } else continue
        changed = true
        break
      }
    }
  }

  // 拓扑排序（DFS）；遇到环则把环上的插件都标成不可用
  const ordered: ResolvedPlugin[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (plugin: ResolvedPlugin, stack: string[]): boolean => {
    const s = state.get(plugin.id)
    if (s === 'done') return plugin.status === 'enabled'
    if (s === 'visiting') {
      const cycle = stack.slice(stack.indexOf(plugin.id))
      for (const id of cycle) {
        const p = byId.get(id)!
        p.status = 'unavailable'
        p.reason = `存在循环依赖：${[...cycle, plugin.id].join(' → ')}`
      }
      return false
    }
    state.set(plugin.id, 'visiting')
    let ok = true
    for (const depId of Object.keys(plugin.manifest!.dependencies ?? {})) {
      const dep = byId.get(depId)
      if (!dep || !visit(dep, [...stack, plugin.id])) ok = false
    }
    state.set(plugin.id, 'done')
    if (!ok && plugin.status === 'enabled') {
      plugin.status = 'unavailable'
      plugin.reason = plugin.reason ?? '依赖插件不可用'
    }
    if (plugin.status === 'enabled') ordered.push(plugin)
    return plugin.status === 'enabled'
  }
  for (const plugin of byId.values()) {
    if (plugin.status === 'enabled') visit(plugin, [])
  }

  const enabledIds = new Set(ordered.filter(p => p.status === 'enabled').map(p => p.id))
  const enabled = ordered.filter(p => enabledIds.has(p.id))
  const rest = [...byId.values()].filter(p => !enabledIds.has(p.id))
  return {
    plugins: [...enabled, ...rest, ...extras],
    enabled: enabled.map(p => p.manifest!),
  }
}
