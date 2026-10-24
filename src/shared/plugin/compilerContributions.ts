// 编译器贡献点（设计稿 §6.5）。渲染进程据此判断有没有可用的编译器（决定编译、运行入口是否可用），
// 主进程的编译器服务（src/main/compilers/compilerService.ts）据此选择并调度编译器。

import type { PluginManifest } from './manifest'

export interface CompilerCommands {
  build: string
  run?: string
  stop?: string
  isRunning?: string
  continueDebug?: string
}

export interface CompilerContribution {
  id: string
  displayName: string
  /** 支持的目标平台，如 windows-x64 */
  targets?: string[]
  /** 能编译的支持库实现语言，如 cpp、objcpp */
  acceptsImplementations?: string[]
  /** 第三方编译器：实现各操作的命令；内置编译器省略 */
  commands?: CompilerCommands
}

export interface CompilerEntry extends CompilerContribution {
  pluginId: string
  builtin: boolean
}

export function collectCompilers(manifests: PluginManifest[]): CompilerEntry[] {
  const seen = new Set<string>()
  const result: CompilerEntry[] = []
  for (const manifest of manifests) {
    for (const compiler of (manifest.contributes?.compilers ?? []) as CompilerContribution[]) {
      if (seen.has(compiler.id)) continue
      seen.add(compiler.id)
      result.push({ ...compiler, pluginId: manifest.id, builtin: !!manifest.builtin })
    }
  }
  return result
}

