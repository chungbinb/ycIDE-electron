// 编辑器提供者贡献点（设计稿 §6.3）：哪种文档用哪个编辑器由插件声明。
//   - 同一种文档可以有多个编辑器，priority 为 default 的作为默认，option 的出现在「打开方式」里；
//   - languages 填文档语言 ID（如 eyc、efw、plaintext），'*' 表示任何文档（文本编辑器作为兜底）；
//   - ui.type：builtin —— 宿主内置组件（component 为组件名）；web —— 插件目录里的网页，
//     运行在沙箱 iframe 中，经 postMessage 收发文档（见 src/renderer/src/workbench/pluginWebEditor.tsx）。

import type { PluginManifest } from './manifest'

export type EditorPriority = 'default' | 'option'

export interface EditorContribution {
  id: string
  displayName: string
  languages: string[]
  priority?: EditorPriority
  ui: { type: 'builtin'; component: string } | { type: 'web'; entry: string }
}

export interface EditorEntry extends EditorContribution {
  pluginId: string
  priority: EditorPriority
}

export function collectEditors(manifests: PluginManifest[]): EditorEntry[] {
  const seen = new Set<string>()
  const result: EditorEntry[] = []
  for (const manifest of manifests) {
    for (const editor of (manifest.contributes?.editors ?? []) as EditorContribution[]) {
      if (seen.has(editor.id)) continue
      seen.add(editor.id)
      result.push({ ...editor, priority: editor.priority ?? 'default', pluginId: manifest.id })
    }
  }
  return result
}

/**
 * 某种文档可用的编辑器，按优先顺序：专门声明该语言的 default → 通配（'*'，即文本编辑器兜底）→ 专门声明的 option。
 * option 编辑器只在用户从「打开方式」里选择时使用，不会抢在兜底的文本编辑器前面成为默认。
 */
export function editorsForLanguage(language: string, editors: EditorEntry[]): EditorEntry[] {
  const specific = editors.filter(e => e.languages.includes(language))
  const wildcard = editors.filter(e => e.languages.includes('*') && !e.languages.includes(language))
  return [
    ...specific.filter(e => e.priority === 'default'),
    ...wildcard,
    ...specific.filter(e => e.priority !== 'default'),
  ]
}

/** 选出要用的编辑器：用户在「打开方式」里选过且仍可用的优先，否则取排在最前的 */
export function pickEditor(language: string, editors: EditorEntry[], preferredId?: string | null): EditorEntry | null {
  const candidates = editorsForLanguage(language, editors)
  if (preferredId) {
    const preferred = candidates.find(e => e.id === preferredId)
    if (preferred) return preferred
  }
  return candidates[0] ?? null
}
