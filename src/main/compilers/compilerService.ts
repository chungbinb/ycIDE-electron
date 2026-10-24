// 编译器后端选择与调度（设计稿 §6.5）。编译器是普通插件，可卸载、可替换：
//   - 插件在清单 contributes.compilers 里声明编译器；
//   - 内置 Zig 编译器（ycide.compiler-zig）的实现在主进程里（compiler.ts + 编译工作线程）；
//   - 第三方编译器插件用命令实现：commands.build / run / stop / isRunning / continueDebug，
//     build 以 CompileRequest 调用、返回 CompileResult，输出经 ycide.output.append 写到编译输出面板。
// 选择顺序：项目文件（.epp）里的 Compiler= → 设置里的默认编译器 → 第一个可用的编译器。

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginManifest } from '../../shared/plugin/manifest'
import { collectCompilers, type CompilerEntry } from '../../shared/plugin/compilerContributions'

export { collectCompilers, type CompilerEntry }
import type { CompileResult } from '../compiler'

export interface CompileRequest {
  projectDir: string
  editorFiles?: Record<string, string>
  arch?: string
  mode: 'compile' | 'run'
  debug: boolean
  breakpoints?: Record<string, number[]>
  previewWindow?: string
}

/** 编译器后端：内置编译器直接实现，插件编译器由命令适配而来 */
export interface CompilerBackend {
  id: string
  displayName: string
  build(request: CompileRequest): Promise<CompileResult>
  /** 启动编译产物；返回是否启动成功 */
  run(outputFile: string): Promise<boolean>
  stop(): Promise<boolean>
  isRunning(): Promise<boolean>
  continueDebug(): Promise<boolean>
}

export type BuiltinCompilerFactory = (entry: CompilerEntry) => CompilerBackend

export interface CompilerServiceDeps {
  /** 已启用插件的清单（按依赖拓扑序） */
  getManifests(): PluginManifest[]
  /** 内置编译器的实现，键为编译器 ID */
  builtinBackends: Record<string, BuiltinCompilerFactory>
  /** 执行插件命令 */
  executeCommand(command: string, args: unknown[]): Promise<unknown>
  /** 设置里的默认编译器 ID，空表示自动 */
  getDefaultCompilerId(): string
  /** 已加载支持库在目标平台上的实现语言 */
  getLibraryImplementationLanguages(targetPlatform: string): Array<{ library: string; languages: string[] }>
}

export const DEFAULT_COMPILER_ID = 'ycide.zig'

/** 读取项目文件（.epp）里「键=值」行的值，没有则返回空字符串 */
export function readProjectValue(projectDir: string, key: string): string {
  try {
    const epp = readdirSync(projectDir).find(name => name.toLowerCase().endsWith('.epp'))
    if (!epp) return ''
    const content = readFileSync(join(projectDir, epp), 'utf-8')
    const line = content.split(/\r?\n/).map(l => l.trim()).find(l => l.startsWith(`${key}=`))
    return line ? line.slice(key.length + 1).trim() : ''
  } catch {
    return ''
  }
}

/** 项目文件里指定的编译器（Compiler= 行） */
export function readProjectCompilerId(projectDir: string): string {
  return readProjectValue(projectDir, 'Compiler')
}

function compileError(text: string): CompileResult & { error: string } {
  return { success: false, outputFile: '', errorCount: 1, warningCount: 0, elapsedMs: 0, error: text }
}

export class CompilerService {
  /** 最近一次运行所用的后端：停止、继续调试都发给它 */
  private lastRunBackend: CompilerBackend | null = null

  constructor(private readonly deps: CompilerServiceDeps) {}

  listCompilers(): CompilerEntry[] {
    return collectCompilers(this.deps.getManifests())
  }

  /** 选出项目要用的编译器：项目指定 → 设置默认 → 第一个可用 */
  pickCompiler(projectDir?: string): CompilerEntry | null {
    const compilers = this.listCompilers()
    if (compilers.length === 0) return null
    const wanted = [projectDir ? readProjectCompilerId(projectDir) : '', this.deps.getDefaultCompilerId(), DEFAULT_COMPILER_ID]
    for (const id of wanted) {
      const hit = id && compilers.find(c => c.id === id)
      if (hit) return hit
    }
    return compilers[0]
  }

  private createBackend(entry: CompilerEntry): CompilerBackend | null {
    const builtin = this.deps.builtinBackends[entry.id]
    if (builtin && entry.builtin) return builtin(entry)
    const commands = entry.commands
    if (!commands?.build) return null
    const exec = this.deps.executeCommand
    const call = async (command: string | undefined, args: unknown[], fallback: boolean): Promise<boolean> =>
      command ? !!(await exec(command, args)) : fallback
    return {
      id: entry.id,
      displayName: entry.displayName,
      build: async request => (await exec(commands.build, [request])) as CompileResult,
      run: outputFile => call(commands.run, [outputFile], false),
      stop: () => call(commands.stop, [], false),
      isRunning: () => call(commands.isRunning, [], false),
      continueDebug: () => call(commands.continueDebug, [], false),
    }
  }

  /** 编译器能否处理已加载支持库的实现语言；不能时返回错误说明 */
  checkLibraryImplementations(entry: CompilerEntry, targetPlatform: string): string | null {
    const accepted = entry.acceptsImplementations
    if (!accepted || accepted.length === 0) return null
    const problems = this.deps.getLibraryImplementationLanguages(targetPlatform)
      .map(lib => ({ lib: lib.library, bad: lib.languages.filter(l => !accepted.includes(l)) }))
      .filter(item => item.bad.length > 0)
    if (problems.length === 0) return null
    return `编译器「${entry.displayName}」不能编译以下支持库的实现：${problems.map(p => `${p.lib}（${p.bad.join('、')}）`).join('，')}。请换用其他编译器或卸载这些支持库。`
  }

  async compile(request: CompileRequest, targetPlatform: string): Promise<CompileResult & { error?: string }> {
    const entry = this.pickCompiler(request.projectDir)
    if (!entry) return compileError('没有可用的编译器：请在插件管理中启用编译器插件（如内置的 Zig 编译器）。')
    const backend = this.createBackend(entry)
    if (!backend) return compileError(`编译器「${entry.displayName}」没有提供编译实现（缺少 commands.build）。`)
    const incompatible = this.checkLibraryImplementations(entry, targetPlatform)
    if (incompatible) return compileError(incompatible)
    return backend.build(request)
  }

  /** 编译并运行；返回编译结果，成功时同时启动产物 */
  async compileAndRun(request: CompileRequest, targetPlatform: string): Promise<CompileResult & { error?: string }> {
    const entry = this.pickCompiler(request.projectDir)
    const result = await this.compile(request, targetPlatform)
    if (!result.success || !result.outputFile || !entry) return result
    const backend = this.createBackend(entry)!
    this.lastRunBackend = backend
    await backend.run(result.outputFile)
    return result
  }

  async stop(): Promise<boolean> {
    return this.lastRunBackend ? this.lastRunBackend.stop() : false
  }

  async isRunning(): Promise<boolean> {
    return this.lastRunBackend ? this.lastRunBackend.isRunning() : false
  }

  async continueDebug(): Promise<boolean> {
    return this.lastRunBackend ? this.lastRunBackend.continueDebug() : false
  }
}

/** 支持库实现文件扩展名 → 语言（ycmd 清单没写 language 时使用） */
export function languageOfImplementation(entry: string, declared?: string): string {
  if (declared && declared.trim()) return declared.trim().toLowerCase()
  const lower = entry.toLowerCase()
  if (lower.endsWith('.mm')) return 'objcpp'
  if (lower.endsWith('.c')) return 'c'
  if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx')) return 'cpp'
  return lower.slice(lower.lastIndexOf('.') + 1)
}
