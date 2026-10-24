// 渲染后端贡献点（设计稿 §6.3、§11 阶段 3/4）：编辑器里重绘最频繁的部分（目前是表格编辑器的流程线）
// 交给可替换的渲染后端，编辑器本身不关心是 DOM 还是 Canvas 画出来的。
//   - surface：渲染面，目前只有 eycTable.flowLines（表格编辑器的流程线）；
//   - implementation：宿主里注册的渲染实现名（见 src/renderer/src/components/Editor/flowLineRenderers.tsx），
//     渲染实现直接操作编辑器的 DOM，只有内置插件可以提供；
//   - 用户在设置里选择渲染后端（tableRendererId），选的后端不可用时回到第一个可用的（DOM）。

import type { PluginManifest } from './manifest'

export const RENDERER_SURFACES = ['eycTable.flowLines'] as const
export type RendererSurface = typeof RENDERER_SURFACES[number]

export interface RendererContribution {
  id: string
  displayName: string
  surfaces: string[]
  implementation: string
  description?: string
}

export interface RendererEntry extends RendererContribution {
  pluginId: string
}

export function collectRenderers(manifests: PluginManifest[]): RendererEntry[] {
  const seen = new Set<string>()
  const result: RendererEntry[] = []
  for (const manifest of manifests) {
    for (const renderer of (manifest.contributes?.renderers ?? []) as RendererContribution[]) {
      if (seen.has(renderer.id)) continue
      seen.add(renderer.id)
      result.push({ ...renderer, pluginId: manifest.id })
    }
  }
  return result
}

export function renderersForSurface(surface: RendererSurface, renderers: RendererEntry[]): RendererEntry[] {
  return renderers.filter(r => r.surfaces.includes(surface))
}

/** 选出某个渲染面用的后端：用户选过且仍可用的优先，否则取第一个（内置 DOM 后端排在最前） */
export function pickRenderer(surface: RendererSurface, renderers: RendererEntry[], preferredId?: string | null): RendererEntry | null {
  const candidates = renderersForSurface(surface, renderers)
  if (preferredId) {
    const preferred = candidates.find(r => r.id === preferredId)
    if (preferred) return preferred
  }
  return candidates[0] ?? null
}
