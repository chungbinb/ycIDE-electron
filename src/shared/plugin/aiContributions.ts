// AI 相关贡献点（设计稿 §6.7）：
//   aiProviders —— 模型提供方（OpenAI 兼容的 chat/completions 接口），一个提供方可以有多个模型
//   aiTools     —— 给 AI Agent 用的工具；工具的实现是一条命令，任何插件都可以提供
// 主进程据 aiProviders 解析模型请求地址与 API Key，渲染进程据此生成模型下拉框和 Agent 工具列表。

import type { PluginManifest } from './manifest'

/** 内置提供方可以沿用设置里已有的 API Key 字段；第三方提供方的 Key 存在 aiProviderApiKeys 里 */
export const BUILTIN_API_KEY_SETTINGS = ['aiDeepseekApiKey', 'aiGlmApiKey'] as const
export type BuiltinApiKeySetting = typeof BUILTIN_API_KEY_SETTINGS[number]

export interface AIModelContribution {
  /** 模型 ID：保存在设置的 aiModel 里，全局唯一 */
  id: string
  label: string
  /** 请求体里的 model 字段 */
  model: string
}

export interface AIProviderContribution {
  id: string
  label: string
  /** OpenAI 兼容的 chat/completions 地址 */
  endpoint: string
  /** 设置里没填 Key 时读取的环境变量 */
  envKey?: string
  /** 只对内置插件生效：使用设置里已有的 Key 字段 */
  apiKeySetting?: BuiltinApiKeySetting
  models: AIModelContribution[]
}

export type AIToolRisk = 'read' | 'write' | 'exec'

export interface AIToolContribution {
  /** 提供给模型的函数名 */
  name: string
  description: string
  /** JSON Schema */
  parameters?: unknown
  /** 实现工具的命令：以 (参数对象, 运行上下文) 调用，返回 AgentToolResult */
  command: string
  /** read 只读；write 修改文件；exec 执行命令。第三方插件的 write / exec 工具每次调用前需要用户确认 */
  risk?: AIToolRisk
}

export interface AIModelEntry {
  id: string
  label: string
  model: string
  endpoint: string
  envKey?: string
  providerId: string
  providerLabel: string
  pluginId: string
  /** 取 API Key 的位置：内置设置字段，或 aiProviderApiKeys 里的键 */
  apiKey: { kind: 'setting'; setting: BuiltinApiKeySetting } | { kind: 'provider'; key: string }
}

export interface AIToolEntry extends AIToolContribution {
  pluginId: string
  builtin: boolean
}

/** aiProviderApiKeys 里第三方提供方的键：插件ID:提供方ID */
export function providerApiKeyId(pluginId: string, providerId: string): string {
  return `${pluginId}:${providerId}`
}

/** 汇总已启用插件提供的模型；模型 ID 重复时先声明的生效（插件按依赖拓扑序，内置在前） */
export function collectAIModels(manifests: PluginManifest[]): AIModelEntry[] {
  const seen = new Set<string>()
  const result: AIModelEntry[] = []
  for (const manifest of manifests) {
    const providers = (manifest.contributes?.aiProviders ?? []) as AIProviderContribution[]
    for (const provider of providers) {
      const apiKey: AIModelEntry['apiKey'] = manifest.builtin && provider.apiKeySetting
        ? { kind: 'setting', setting: provider.apiKeySetting }
        : { kind: 'provider', key: providerApiKeyId(manifest.id, provider.id) }
      for (const model of provider.models) {
        if (seen.has(model.id)) continue
        seen.add(model.id)
        result.push({
          id: model.id,
          label: model.label,
          model: model.model,
          endpoint: provider.endpoint,
          envKey: provider.envKey,
          providerId: provider.id,
          providerLabel: provider.label,
          pluginId: manifest.id,
          apiKey,
        })
      }
    }
  }
  return result
}

/** 需要用户填写 API Key 的第三方提供方（内置提供方的 Key 在原有设置项里填） */
export function collectProviderKeySlots(manifests: PluginManifest[]): Array<{ key: string; label: string; pluginId: string; envKey?: string }> {
  const slots = new Map<string, { key: string; label: string; pluginId: string; envKey?: string }>()
  for (const entry of collectAIModels(manifests)) {
    if (entry.apiKey.kind !== 'provider' || slots.has(entry.apiKey.key)) continue
    slots.set(entry.apiKey.key, { key: entry.apiKey.key, label: entry.providerLabel, pluginId: entry.pluginId, envKey: entry.envKey })
  }
  return [...slots.values()]
}

/** 汇总已启用插件提供的 Agent 工具；工具名重复时先声明的生效 */
export function collectAITools(manifests: PluginManifest[]): AIToolEntry[] {
  const seen = new Set<string>()
  const result: AIToolEntry[] = []
  for (const manifest of manifests) {
    for (const tool of (manifest.contributes?.aiTools ?? []) as AIToolContribution[]) {
      if (seen.has(tool.name)) continue
      seen.add(tool.name)
      result.push({ ...tool, risk: tool.risk ?? 'read', pluginId: manifest.id, builtin: !!manifest.builtin })
    }
  }
  return result
}
