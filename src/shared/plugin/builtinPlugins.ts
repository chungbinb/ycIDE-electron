// 内置插件清单。阶段 0 内置插件随源码一起打包（src/plugins/<id>/plugin.json），
// 命令的处理函数暂时仍由工作台（App.tsx）注册；后续阶段逐个把实现迁进各自的插件目录。

import workbench from '../../plugins/ycide.workbench/plugin.json'
import project from '../../plugins/ycide.project/plugin.json'
import build from '../../plugins/ycide.build/plugin.json'
import debug from '../../plugins/ycide.debug/plugin.json'
import { resolvePlugins, type PluginCandidate, type PluginResolution, type PluginResolveEnv } from './pluginResolver'
import { buildContributionModel, type ContributionModel } from './contributions'

export const BUILTIN_PLUGIN_CANDIDATES: PluginCandidate[] = [
  { manifest: workbench, source: '内置:ycide.workbench' },
  { manifest: project, source: '内置:ycide.project' },
  { manifest: build, source: '内置:ycide.build' },
  { manifest: debug, source: '内置:ycide.debug' },
]

export interface LoadedPlugins {
  resolution: PluginResolution
  model: ContributionModel
}

/** 解析插件并汇总贡献点；extraCandidates 预留给用户安装的插件（内置插件排在前面，ID 不能被覆盖） */
export function loadPlugins(env: PluginResolveEnv, extraCandidates: PluginCandidate[] = []): LoadedPlugins {
  const resolution = resolvePlugins([...BUILTIN_PLUGIN_CANDIDATES, ...extraCandidates], env)
  const model = buildContributionModel(resolution.enabled)
  for (const plugin of resolution.plugins) {
    if (plugin.status !== 'enabled') console.warn(`[plugins] ${plugin.id} 未启用：${plugin.reason}`)
  }
  for (const warning of model.warnings) console.warn(`[plugins] ${warning}`)
  return { resolution, model }
}
