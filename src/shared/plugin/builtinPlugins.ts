// 内置插件清单。内置插件位于仓库根目录 plugins/<id>/，随安装包分发到 <安装目录>/plugins/（设计稿 §3.1）。
// 清单在这里静态导入，保证首屏菜单、快捷键不依赖磁盘扫描；插件附带的数据文件（如主题）由主进程按目录读取。
// 命令的处理函数暂时仍由工作台（App.tsx）注册；后续阶段逐个把实现迁进各自的插件目录。

import workbench from '../../../plugins/ycide.workbench/plugin.json'
import project from '../../../plugins/ycide.project/plugin.json'
import build from '../../../plugins/ycide.build/plugin.json'
import debug from '../../../plugins/ycide.debug/plugin.json'
import colorfulThemes from '../../../plugins/ycide.themes-colorful/plugin.json'
import terminal from '../../../plugins/ycide.terminal/plugin.json'
import aiDeepseek from '../../../plugins/ycide.ai-deepseek/plugin.json'
import aiGlm from '../../../plugins/ycide.ai-glm/plugin.json'
import compilerZig from '../../../plugins/ycide.compiler-zig/plugin.json'
import langEyc from '../../../plugins/ycide.lang-eyc/plugin.json'
import editorEycTable from '../../../plugins/ycide.editor-eyc-table/plugin.json'
import editorFormDesigner from '../../../plugins/ycide.editor-form-designer/plugin.json'
import editorText from '../../../plugins/ycide.editor-text/plugin.json'
import renderDom from '../../../plugins/ycide.render-dom/plugin.json'
import renderImage from '../../../plugins/ycide.render-image/plugin.json'
import { resolvePlugins, type PluginCandidate, type PluginResolution, type PluginResolveEnv } from './pluginResolver'
import { buildContributionModel, type ContributionModel } from './contributions'

export const BUILTIN_PLUGIN_CANDIDATES: PluginCandidate[] = [
  { manifest: workbench, source: '内置:ycide.workbench' },
  { manifest: project, source: '内置:ycide.project' },
  { manifest: build, source: '内置:ycide.build' },
  { manifest: debug, source: '内置:ycide.debug' },
  { manifest: colorfulThemes, source: '内置:ycide.themes-colorful' },
  { manifest: terminal, source: '内置:ycide.terminal' },
  { manifest: aiDeepseek, source: '内置:ycide.ai-deepseek' },
  { manifest: aiGlm, source: '内置:ycide.ai-glm' },
  { manifest: compilerZig, source: '内置:ycide.compiler-zig' },
  { manifest: langEyc, source: '内置:ycide.lang-eyc' },
  { manifest: editorEycTable, source: '内置:ycide.editor-eyc-table' },
  { manifest: editorFormDesigner, source: '内置:ycide.editor-form-designer' },
  { manifest: editorText, source: '内置:ycide.editor-text' },
  { manifest: renderDom, source: '内置:ycide.render-dom' },
  { manifest: renderImage, source: '内置:ycide.render-image' },
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
