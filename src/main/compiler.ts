import { join, dirname, basename, extname } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, copyFileSync, rmSync } from 'fs'
import { execFile, ChildProcess } from 'child_process'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { libraryManager } from './libraryManager'
import { getRuntimeEnv } from './runtimeEnv'
import type { LibraryCommand as LibCommand, LibraryConstant as LibConstant, LibraryWindowUnit as LibWindowUnit } from './libraryManager'
import { generateDebugRuntimeCode } from './debug-runtime'
import { createCommandResolvers } from './compilerCommandResolvers'
import { ycmdCommandIdToNativeSymbol } from './ycmd-registry'

// 编译消息类型
export interface CompileMessage {
  type: 'info' | 'warning' | 'error' | 'success'
  text: string
}

// 编译选项
export interface CompileOptions {
  projectDir: string
  debug?: boolean
  arch?: string                    // 目标架构（优先于 .epp 中的 platform）
  mode?: 'compile' | 'run'         // compile: 按 .epp 目标平台；run: 按宿主平台
  breakpoints?: Record<string, number[]>
}

// 编译结果
export interface CompileResult {
  success: boolean
  outputFile: string
  errorCount: number
  warningCount: number
  elapsedMs: number
}

// 窗口控件信息
interface WindowControlInfo {
  type: string
  name: string
  x: number
  y: number
  width: number
  height: number
  text: string
  visible: boolean
  disabled: boolean
  extraProps: Record<string, unknown>  // 支持库自定义属性原始值
}

// 窗口文件信息
interface WindowFileInfo {
  formName: string
  width: number
  height: number
  title: string
  visible: boolean
  disabled: boolean
  border: number       // 0无边框 1单线 2可调(default) 3对话框 4工具窗 5可调工具窗
  maxButton: boolean
  minButton: boolean
  controlBox: boolean
  topmost: boolean
  startPos: number     // 0手工 1居中(default)
  controls: WindowControlInfo[]
}

// 项目文件条目
interface ProjectFileEntry {
  type: string
  fileName: string
  flag: number
}

// 项目信息
interface ProjectInfo {
  projectName: string
  outputType: string
  platform: string
  files: ProjectFileEntry[]
  projectDir: string
}

interface ProjectResourceEntry {
  name: string
  fileName: string
  type: string
}

interface GlobalVarDef {
  name: string
  type: string
}

interface ConstantDef {
  name: string
  value: string
}

interface SubprogramDef {
  name: string
  params: Array<{ name: string; type: string }>
  isClassModule: boolean
  returnType: string
  isPublic: boolean
  className: string // 所属类模块的类名（非类模块为空字符串）
}

interface ProjectClassModuleDef {
  className: string
  fileName: string
  memberVars: Array<{ name: string; type: string }>
}

interface ProjectDataTypeFieldDef {
  name: string
  type: string
}

interface ProjectDataTypeDef {
  name: string
  fields: ProjectDataTypeFieldDef[]
}

interface ProjectDllParamDef {
  name: string
  type: string
  isByRef: boolean
  isArray: boolean
  optional: boolean
}

interface ProjectDllCommandDef {
  name: string
  returnType: string
  dllFileName: string
  entryName: string
  params: ProjectDllParamDef[]
  // .指针命令：不绑定 DLL 导出，调用时第一个实参为函数地址（长整数型），按声明签名间接调用
  isIndirect?: boolean
}

interface LibraryConstantDef extends ConstantDef {
  type: 'null' | 'number' | 'bool' | 'text'
}

type EventChannel = 'WM_COMMAND' | 'WM_NOTIFY' | 'WM_HSCROLL' | 'WM_VSCROLL'

interface LibraryEventBindingSpec {
  library?: string
  unit: string
  unitEnglishName?: string
  event: string
  channel: EventChannel
  code?: string
}

interface LibraryCompileProtocol {
  version?: string | number
  eventBindings?: LibraryEventBindingSpec[]
  commandBindings?: LibraryCommandBindingSpec[]
  controlBindings?: LibraryControlBindingSpec[]
  windowUnits?: Array<{
    name?: string
    englishName?: string
    className?: string
    style?: string
    events?: Array<{
      name?: string
      channel?: EventChannel
      code?: string
    }>
  }>
}

interface NormalizedEventBinding {
  library: string
  unit: string
  unitEnglishName: string
  event: string
  channel: EventChannel
  code: string
}

interface LibraryCommandBindingSpec {
  library?: string
  command: string
  commandEnglishName?: string
  emit?: string
  expr?: string
  exprOp?: string
  exprBuilder?: string
  emitBuilder?: string
}

interface NormalizedCommandBinding {
  library: string
  command: string
  commandEnglishName: string
  emit: string
  expr: string
  exprOp: string
  exprBuilder: string
  emitBuilder: string
}

interface LibraryControlBindingSpec {
  library?: string
  unit: string
  unitEnglishName?: string
  className?: string
  style?: string
}

interface NormalizedControlBinding {
  library: string
  unit: string
  unitEnglishName: string
  className: string
  style: string
}

interface LoadedCompileProtocols {
  events: NormalizedEventBinding[]
  commands: NormalizedCommandBinding[]
  controls: NormalizedControlBinding[]
}

interface TranspileCacheEntry {
  fingerprint: string
  cFileName: string
}

interface TranspileCacheFile {
  version: number
  entries: Record<string, TranspileCacheEntry>
}

const TRANSPILE_CACHE_VERSION = 7

interface BuildArtifactCacheFile {
  version: number
  fingerprint: string
  outputBinary: string
}

const BUILD_ARTIFACT_CACHE_VERSION = 1

interface ProjectCompileMetadata {
  globals: GlobalVarDef[]
  constants: ConstantDef[]
  resources: ProjectResourceEntry[]
  subprograms: SubprogramDef[]
  dataTypes: ProjectDataTypeDef[]
  dllCommands: ProjectDllCommandDef[]
  classModules: ProjectClassModuleDef[]
}

let compileProtocolCache: LoadedCompileProtocols | null = null
let compileProtocolCacheSignature = ''
let projectCompileMetadataCache: { fingerprint: string; metadata: ProjectCompileMetadata } | null = null
let activeProjectCustomTypeNames: Set<string> = new Set()
let activeProjectClassNames: Set<string> = new Set()

// 正在运行的进程
let runningProcess: ChildProcess | null = null
let runningDebugCmdFile: string | null = null
let runningDebugResumeToken = 0

// 编译器宿主：把"需要 Electron 主进程能力"的副作用（广播输出、聚焦窗口、回报进程退出、
// 系统 Shell 打开）抽成回调，由宿主注入。主进程注入真实实现；worker 注入 postMessage 转发。
export interface CompilerHost {
  emitOutput: (msg: CompileMessage) => void
  requestFocusIdeWindow: () => void
  notifyProcessExit: (code: number | null) => void
  // 返回空字符串表示成功，否则返回错误描述（对应 shell.openPath 的语义）。
  openPathExternally: (targetPath: string) => Promise<string>
}

let compilerHost: CompilerHost | null = null

export function setCompilerHost(host: CompilerHost): void {
  compilerHost = host
}

// 发送编译消息到渲染进程（经宿主转发）
function sendMessage(msg: CompileMessage): void {
  compilerHost?.emitOutput(msg)
}

function focusIdeWindow(): void {
  compilerHost?.requestFocusIdeWindow()
}

function emitBufferedOutputChunk(
  chunk: string,
  buffer: string,
  type: CompileMessage['type']
): string {
  const merged = (buffer + chunk).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const parts = merged.split('\n')
  const remainder = parts.pop() ?? ''
  for (const part of parts) {
    if (part === '__YCDBG_BREAK_END__') {
      focusIdeWindow()
    }
    sendMessage({ type, text: part })
  }
  return remainder
}

function flushBufferedOutputRemainder(
  buffer: string,
  type: CompileMessage['type']
): void {
  if (!buffer) return
  sendMessage({ type, text: buffer })
}

function localizeCompilerMessage(line: string): string {
  let text = line.trimEnd()
  if (!text) return text

  const undefSymbol = text.match(/^lld-link:\s*error:\s*undefined symbol:\s*(.+)$/i)
  if (undefSymbol) {
    return `链接器错误: 未定义符号: ${undefSymbol[1]}`
  }

  const linkerFail = text.match(/^(?:clang|zig):\s*error:\s*linker command failed with exit code\s+(\d+)\s*\(use -v to see invocation\)$/i)
  if (linkerFail) {
    return `编译器错误: 链接命令失败，退出码 ${linkerFail[1]}（使用 -v 可查看调用详情）`
  }

  const referencedBy = text.match(/^>>>\s*referenced by\s+(.+)$/i)
  if (referencedBy) {
    return `>>> 引用位置: ${referencedBy[1]}`
  }

  text = text.replace(/^lld-link:\s*error:\s*/i, '链接器错误: ')
  text = text.replace(/^lld-link:\s*warning:\s*/i, '链接器警告: ')
  text = text.replace(/^clang:\s*error:\s*/i, '编译器错误: ')
  text = text.replace(/^clang:\s*warning:\s*/i, '编译器警告: ')
  text = text.replace(/^zig:\s*error:\s*/i, '编译器错误: ')
  text = text.replace(/^zig:\s*warning:\s*/i, '编译器警告: ')
  return text
}

// 获取应用目录（开发模式下是项目根目录）
function getAppDirectory(): string {
  const { isPackaged, appPath } = getRuntimeEnv()
  if (!isPackaged) {
    return appPath
  }
  return dirname(process.execPath)
}

type TargetPlatform = 'windows' | 'linux' | 'macos'
type UnsupportedTargetPlatform = 'android' | 'ios' | 'harmony'
type TargetArch = 'x86' | 'x64' | 'arm64'

function getHostTargetPlatform(): TargetPlatform {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'macos'
  return 'linux'
}

function getHostTargetArch(): TargetArch {
  if (process.arch === 'ia32') return 'x86'
  if (process.arch === 'arm64') return 'arm64'
  return 'x64'
}

function normalizeTargetPlatform(value?: string | null): TargetPlatform | null {
  const normalized = (value || '').trim().toLowerCase()
  if (normalized === 'windows' || normalized === 'linux' || normalized === 'macos') return normalized
  return null
}

function normalizeUnsupportedTargetPlatform(value?: string | null): UnsupportedTargetPlatform | null {
  const normalized = (value || '').trim().toLowerCase()
  if (normalized === 'android') return 'android'
  if (normalized === 'ios' || normalized === 'iphone' || normalized === 'ipad') return 'ios'
  if (normalized === 'harmony' || normalized === 'harmonyos' || normalized === 'openharmony') return 'harmony'
  return null
}

function normalizeTargetArch(value?: string | null): TargetArch | null {
  const normalized = (value || '').trim().toLowerCase()
  if (normalized === 'x86' || normalized === 'x64' || normalized === 'arm64') return normalized
  return null
}

function buildZigTargetTriple(platform: TargetPlatform, arch: TargetArch): string {
  if (platform === 'windows') {
    if (arch === 'x86') return 'x86-windows-gnu'
    if (arch === 'arm64') return 'aarch64-windows-gnu'
    return 'x86_64-windows-gnu'
  }
  if (platform === 'linux') {
    if (arch === 'x86') return 'x86-linux-gnu'
    if (arch === 'arm64') return 'aarch64-linux-gnu'
    return 'x86_64-linux-gnu'
  }

  // macOS 目标不支持 x86；回退到 x64 以避免无效目标。
  if (arch === 'arm64') return 'aarch64-macos'
  return 'x86_64-macos'
}

// 让出主进程事件循环：编译准备阶段是大量同步 fs/解析/哈希工作，全在主进程线程上跑，
// 期间所有 IPC 被阻塞，整个 IDE 表现为「停止响应」。在各阶段之间让出一次，
// 使主进程能处理渲染层的 IPC/重绘，避免界面冻结。
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

/** 耗时显示：超过 1 秒时附加人类可读单位，如 "5996 毫秒/5.9 秒"、"599600 毫秒/9 分钟 59.6 秒" */
function formatElapsedDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  if (ms < 1000) return `${ms} 毫秒`
  const truncate1 = (v: number): string => (Math.floor(v * 10) / 10).toFixed(1)
  const totalSeconds = ms / 1000
  let human: string
  if (totalSeconds < 60) {
    human = `${truncate1(totalSeconds)} 秒`
  } else {
    const dayMs = 24 * 60 * 60 * 1000
    const hourMs = 60 * 60 * 1000
    const minuteMs = 60 * 1000
    const days = Math.floor(ms / dayMs)
    const hours = Math.floor((ms % dayMs) / hourMs)
    const minutes = Math.floor((ms % hourMs) / minuteMs)
    const seconds = (ms % minuteMs) / 1000
    const parts: string[] = []
    if (days > 0) parts.push(`${days} 天`)
    if (days > 0 || hours > 0) parts.push(`${hours} 小时`)
    parts.push(`${minutes} 分钟`)
    parts.push(`${truncate1(seconds)} 秒`)
    human = parts.join(' ')
  }
  return `${ms} 毫秒/${human}`
}

// ========== 编译诊断日志 ==========
// 将每个编译动作及其耗时写入日志文件，便于排查“为什么编译慢”。
// 输出区只保留友好简洁的进度提示，逐段计时只进日志文件，不污染输出区。
interface CompileDiagLogger {
  filePath: string
  startTs: number
  lastTs: number
  lines: string[]
}

let activeCompileLog: CompileDiagLogger | null = null

function pad2(n: number): string { return n < 10 ? '0' + n : String(n) }
function pad3(n: number): string { return n < 10 ? '00' + n : (n < 100 ? '0' + n : String(n)) }

function formatLogTimestamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} `
    + `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`
}

// 把当前日志缓冲整体落盘。每段都落盘，万一编译卡死/崩溃，日志仍然完整可发。
function persistCompileLog(): void {
  const log = activeCompileLog
  if (!log || !log.filePath) return
  try {
    writeFileSync(log.filePath, log.lines.join('\r\n') + '\r\n', 'utf-8')
  } catch {
    // 日志写入失败不影响编译本身。
  }
}

// 开始一次编译诊断日志。日志写入项目 temp 目录，方便用户找到并发回排查。
function startCompileLog(projectDir: string, projectName: string): string {
  const now = Date.now()
  let filePath = ''
  try {
    const logDir = join(projectDir, 'temp')
    mkdirSync(logDir, { recursive: true })
    filePath = join(logDir, '编译诊断日志.log')
  } catch {
    filePath = ''
  }
  activeCompileLog = { filePath, startTs: now, lastTs: now, lines: [] }
  compileLogRaw('==================================================')
  compileLogRaw(`编译诊断日志 - 项目: ${projectName}`)
  compileLogRaw(`开始时间: ${formatLogTimestamp(now)}`)
  compileLogRaw(`运行平台: ${process.platform} / ${process.arch}`)
  compileLogRaw('格式: [+距开始ms] (本段ms)  动作')
  compileLogRaw('==================================================')
  persistCompileLog()
  return filePath
}

// 写入一行原始文本（不带计时）。
function compileLogRaw(text: string): void {
  const log = activeCompileLog
  if (!log) return
  log.lines.push(text)
}

// 记录一个动作完成：自动计算距上一个标记的耗时（本段）与距开始的总耗时。
function compileLogMark(label: string): void {
  const log = activeCompileLog
  if (!log) return
  const now = Date.now()
  const sinceStart = now - log.startTs
  const sinceLast = now - log.lastTs
  log.lastTs = now
  log.lines.push(`[+${String(sinceStart).padStart(7)}ms] (本段 ${String(sinceLast).padStart(7)}ms)  ${label}`)
  persistCompileLog()
}

// 结束日志：写入总耗时与结果，返回日志文件路径。
function finishCompileLog(resultText: string): string {
  const log = activeCompileLog
  if (!log) return ''
  const total = Date.now() - log.startTs
  log.lines.push('--------------------------------------------------')
  log.lines.push(`结束: ${resultText}`)
  log.lines.push(`总耗时: ${formatElapsedDuration(total)}`)
  log.lines.push('==================================================')
  persistCompileLog()
  const filePath = log.filePath
  activeCompileLog = null
  return filePath
}

function getBinaryFileName(projectName: string, outputType: string, platform: TargetPlatform): string {
  if (outputType === 'DynamicLibrary') {
    if (platform === 'windows') return `${projectName}.dll`
    if (platform === 'macos') return `lib${projectName}.dylib`
    return `lib${projectName}.so`
  }
  if (platform === 'windows') return `${projectName}.exe`
  return projectName
}

function getHostExecutableCandidates(baseName: string): string[] {
  if (process.platform === 'win32') {
    return [`${baseName}.exe`, baseName]
  }
  return [baseName, `${baseName}.exe`]
}

// 查找 Zig 编译器
function findZigCompiler(): string | null {
  const appDir = getAppDirectory()
  const searchDirs = [
    join(appDir, 'compiler', 'zig'),
    join(appDir, 'compiler', 'zig', 'bin'),
    join(appDir, 'compiler', 'bin'),
  ]
  for (const dir of searchDirs) {
    for (const fileName of getHostExecutableCandidates('zig')) {
      const fullPath = join(dir, fileName)
      if (existsSync(fullPath)) return fullPath
    }
  }
  return null
}

// 解析 .epp 项目文件
function parseEppFile(eppPath: string): ProjectInfo | null {
  if (!existsSync(eppPath)) return null
  const content = readFileSync(eppPath, 'utf-8')
  const lines = content.split('\n').map(l => l.trim())
  const info: Record<string, string> = {}
  const files: ProjectFileEntry[] = []
  for (const line of lines) {
    if (line.startsWith('#') || line === '') continue
    if (line.startsWith('File=')) {
      const parts = line.substring(5).split('|')
      if (parts.length >= 2) {
        files.push({
          type: parts[0],
          fileName: parts[1],
          flag: parts[2] ? parseInt(parts[2], 10) : 0
        })
      }
    } else {
      const eqIdx = line.indexOf('=')
      if (eqIdx > 0) {
        info[line.substring(0, eqIdx)] = line.substring(eqIdx + 1)
      }
    }
  }
  return {
    projectName: info['ProjectName'] || '',
    outputType: info['OutputType'] || 'WindowsApp',
    platform: info['Platform'] || 'x64',
    files,
    projectDir: dirname(eppPath)
  }
}

function parseProjectResourceEntries(content: string): ProjectResourceEntry[] {
  const entries: ProjectResourceEntry[] = []
  const lines = content.split('\n')
  for (const rawLine of lines) {
    const line = rawLine.replace(/[\u200B\u200C\u200D\u2060]/g, '').trim()
    if (!line || line.startsWith("'")) continue

    let body = ''
    if (line.startsWith('.资源 ')) body = line.substring('.资源 '.length)
    else if (line.startsWith('.常量 ')) body = line.substring('.常量 '.length)
    else continue

    const parts = splitDeclParts(body)
    const name = (parts[0] || '').trim()
    const fileName = unquoteDeclValue(parts[1] || '')
    const type = (parts[2] || '').trim()
    if (!name || !fileName) continue

    entries.push({ name, fileName, type })
  }
  return entries
}

function collectProjectResourceEntries(project: ProjectInfo, editorFiles?: Map<string, string>): ProjectResourceEntry[] {
  const result: ProjectResourceEntry[] = []
  const seenName = new Set<string>()
  const seenFile = new Set<string>()
  let hasErcDeclarationSource = false

  const addEntry = (entry: ProjectResourceEntry): void => {
    const normalizedName = entry.name.trim().toLowerCase()
    const normalizedFile = entry.fileName.trim().toLowerCase()
    if (!normalizedName || !normalizedFile) return
    if (seenName.has(normalizedName)) return
    seenName.add(normalizedName)
    seenFile.add(normalizedFile)
    result.push(entry)
  }

  // Prefer entries declared in .erc.
  for (const f of project.files) {
    if (f.type !== 'ERC' && !/\.erc$/i.test(f.fileName)) continue
    hasErcDeclarationSource = true
    const sourcePath = join(project.projectDir, f.fileName)
    const editorContent = editorFiles?.get(f.fileName)
    const content = editorContent || (existsSync(sourcePath) ? readFileSync(sourcePath, 'utf-8') : '')
    if (!content) continue
    for (const entry of parseProjectResourceEntries(content)) {
      addEntry(entry)
    }
  }

  // When .erc exists, only embed resources explicitly declared there.
  // Fallback to File=RES is kept only for old projects without any .erc file.
  if (hasErcDeclarationSource) {
    return result
  }

  // Fallback to File=RES entries for legacy projects.
  let autoIndex = 1
  for (const f of project.files) {
    if (f.type !== 'RES') continue
    const normalizedFile = f.fileName.trim().toLowerCase()
    if (!normalizedFile || seenFile.has(normalizedFile)) continue
    let autoName = `资源文件${autoIndex}`
    while (seenName.has(autoName.toLowerCase())) {
      autoIndex += 1
      autoName = `资源文件${autoIndex}`
    }
    autoIndex += 1
    addEntry({ name: autoName, fileName: f.fileName, type: '其它' })
  }

  return result
}

function resolveProjectResourcePath(projectDir: string, fileName: string): string | null {
  const normalized = (fileName || '').trim()
  if (!normalized) return null

  const rcPath = join(projectDir, 'rc', normalized)
  if (existsSync(rcPath)) return rcPath

  const legacyPath = join(projectDir, normalized)
  if (existsSync(legacyPath)) return legacyPath

  return null
}

function escapeRcString(text: string): string {
  return text.replace(/\\/g, '/').replace(/"/g, '\\"')
}

function mapRcTargetMachine(arch: TargetArch): string {
  if (arch === 'x86') return 'x86'
  if (arch === 'arm64') return 'aarch64'
  return 'x86_64'
}

function isAsciiOnlyPath(text: string): boolean {
  return !/[^\x00-\x7F]/.test(text)
}

function pickResourceStageRoot(zigPath: string): string {
  const candidates = [
    join(tmpdir(), 'ycide-rc-stage'),
    join(dirname(zigPath), 'ycide-rc-stage'),
    join(getAppDirectory(), 'temp', 'ycide-rc-stage'),
  ]
  for (const candidate of candidates) {
    if (isAsciiOnlyPath(candidate)) return candidate
  }
  return candidates[0]
}

function buildWindowsCommonControlsManifest(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">',
    '  <dependency>',
    '    <dependentAssembly>',
    '      <assemblyIdentity',
    '        type="win32"',
    '        name="Microsoft.Windows.Common-Controls"',
    '        version="6.0.0.0"',
    '        processorArchitecture="*"',
    '        publicKeyToken="6595b64144ccf1df"',
    '        language="*" />',
    '    </dependentAssembly>',
    '  </dependency>',
    '</assembly>',
  ].join('\n')
}

async function compileProjectResources(
  project: ProjectInfo,
  targetPlatform: TargetPlatform,
  targetArch: TargetArch,
  tempDir: string,
  zigPath: string,
  editorFiles?: Map<string, string>,
): Promise<{ success: boolean; objectFilePath: string | null }> {
  const entries = collectProjectResourceEntries(project, editorFiles)
  const shouldEmbedManifest = project.outputType === 'WindowsApp'
  if (entries.length === 0 && !shouldEmbedManifest) return { success: true, objectFilePath: null }

  if (targetPlatform !== 'windows') {
    sendMessage({ type: 'warning', text: `警告: 目标平台 ${targetPlatform} 暂不支持编译 .erc 资源，已跳过 ${entries.length} 项资源。` })
    return { success: true, objectFilePath: null }
  }

  const stageRoot = pickResourceStageRoot(zigPath)
  mkdirSync(stageRoot, { recursive: true })
  const stageDir = join(stageRoot, `build-${Date.now()}-${Math.floor(Math.random() * 1000000)}`)
  mkdirSync(stageDir, { recursive: true })

  try {
    const rcLines: string[] = ['// Generated by ycIDE compiler']
    if (shouldEmbedManifest) {
      const manifestFileName = 'ycide_app.manifest'
      writeFileSync(join(stageDir, manifestFileName), buildWindowsCommonControlsManifest() + '\n', 'utf-8')
      rcLines.push(`1 RT_MANIFEST "${manifestFileName}"`)
    }
    const usedNames = new Set<string>()
    let embeddedCount = 0

    for (const entry of entries) {
      const resourcePath = resolveProjectResourcePath(project.projectDir, entry.fileName)
      if (!resourcePath) {
        sendMessage({ type: 'warning', text: `警告: 资源文件不存在，已跳过: ${entry.fileName}` })
        continue
      }

      let resourceName = entry.name.trim() || `资源${embeddedCount + 1}`
      let dedupeIndex = 2
      while (usedNames.has(resourceName.toLowerCase())) {
        resourceName = `${entry.name}_${dedupeIndex}`
        dedupeIndex += 1
      }
      usedNames.add(resourceName.toLowerCase())

      const rawExt = extname(entry.fileName).toLowerCase()
      const safeExt = rawExt && /^[.a-z0-9_-]+$/.test(rawExt) ? rawExt : '.bin'
      const stagedFileName = `res_${embeddedCount + 1}${safeExt}`
      const stagedFilePath = join(stageDir, stagedFileName)
      copyFileSync(resourcePath, stagedFilePath)

      rcLines.push(`"${escapeRcString(resourceName)}" RCDATA "${escapeRcString(stagedFileName)}"`)
      embeddedCount += 1
    }

    if (embeddedCount === 0 && !shouldEmbedManifest) {
      sendMessage({ type: 'warning', text: '警告: 没有可用资源被编译进目标文件。' })
      return { success: true, objectFilePath: null }
    }

    const stageRcPath = join(stageDir, 'project_resources.rc')
    const stageObjectPath = join(stageDir, 'project_resources.o')
    const finalObjectPath = join(tempDir, 'project_resources.o')
    writeFileSync(stageRcPath, rcLines.join('\n') + '\n', 'utf-8')

    sendMessage({ type: 'info', text: embeddedCount === 0 ? '正在编译应用程序清单资源(首次需构建资源编译器，可能较慢)...' : `正在编译资源(${embeddedCount} 项)...` })

    const rcSuccess = await new Promise<boolean>((resolve) => {
      const rcArgs = [
        'rc',
        '/c', '65001',
        '/:output-format', 'coff',
        '/:target', mapRcTargetMachine(targetArch),
        '/fo', stageObjectPath,
        stageRcPath,
      ]
      const proc = execFile(zigPath, rcArgs, { cwd: stageDir, maxBuffer: 10 * 1024 * 1024 }, (error, _stdout, stderr) => {
        if (stderr) {
          const lines = stderr.split('\n').filter(l => l.trim())
          for (const line of lines) {
            const lower = line.toLowerCase()
            if (lower.includes('error')) {
              sendMessage({ type: 'error', text: line })
            } else if (lower.includes('warning')) {
              sendMessage({ type: 'warning', text: line })
            } else {
              sendMessage({ type: 'info', text: line })
            }
          }
        }
        resolve(!error)
      })
      proc.on('error', (err) => {
        sendMessage({ type: 'error', text: `资源编译器启动失败: ${err.message}` })
        resolve(false)
      })
    })

    if (!rcSuccess || !existsSync(stageObjectPath)) {
      sendMessage({ type: 'error', text: '资源编译失败。' })
      return { success: false, objectFilePath: null }
    }

    copyFileSync(stageObjectPath, finalObjectPath)
    sendMessage({ type: 'success', text: embeddedCount === 0 ? '应用程序清单资源编译完成' : `资源编译成功: ${embeddedCount} 项` })
    return { success: true, objectFilePath: finalObjectPath }
  } finally {
    try {
      rmSync(stageDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup failures
    }
  }
}

// 获取控件的 Win32 类名
function getWin32ClassName(ctrlType: string): string {
  const map: Record<string, string> = {
    'Button': 'BUTTON', '按钮': 'BUTTON',
    'Label': 'STATIC', '标签': 'STATIC',
    'Edit': 'EDIT', '编辑框': 'EDIT',
    'TextBox': 'EDIT', '文本框': 'EDIT',
    'CheckBox': 'BUTTON', '复选框': 'BUTTON', '选择框': 'BUTTON',
    'RadioButton': 'BUTTON', '单选框': 'BUTTON',
    'ListBox': 'LISTBOX', '列表框': 'LISTBOX',
    'ListView': 'SysListView32', '列表视图': 'SysListView32',
    'TreeView': 'SysTreeView32', '树形框': 'SysTreeView32',
    'TabControl': 'SysTabControl32', '标签页': 'SysTabControl32',
    'ComboBox': 'COMBOBOX', '组合框': 'COMBOBOX',
    'SliderBar': 'msctls_trackbar32', '滑块条': 'msctls_trackbar32',
    'ScrollBar': 'SCROLLBAR', '滚动条': 'SCROLLBAR',
    'ProgressBar': 'msctls_progress32', '进度条': 'msctls_progress32',
    'GroupBox': 'BUTTON', '分组框': 'BUTTON',
    '图片框': 'STATIC',
    'ycUI按钮': 'ycButton',
  }
  return map[ctrlType] || 'STATIC'
}

// 获取控件的 Win32 样式（不含 WS_VISIBLE，由外层 visFlag 控制）
function getWin32Style(ctrlType: string): string {
  const map: Record<string, string> = {
    'Button': 'WS_CHILD | BS_PUSHBUTTON',
    '按钮': 'WS_CHILD | BS_PUSHBUTTON',
    'Label': 'WS_CHILD | SS_LEFT',
    '标签': 'WS_CHILD | SS_LEFT',
    'Edit': 'WS_CHILD | WS_BORDER | ES_AUTOHSCROLL',
    '编辑框': 'WS_CHILD | WS_BORDER | ES_AUTOHSCROLL',
    'TextBox': 'WS_CHILD | WS_BORDER | ES_AUTOHSCROLL',
    '文本框': 'WS_CHILD | WS_BORDER | ES_AUTOHSCROLL',
    'CheckBox': 'WS_CHILD | BS_AUTOCHECKBOX',
    '复选框': 'WS_CHILD | BS_AUTOCHECKBOX',
    '选择框': 'WS_CHILD | BS_AUTOCHECKBOX',
    'ListBox': 'WS_CHILD | WS_BORDER | WS_VSCROLL | LBS_NOTIFY',
    '列表框': 'WS_CHILD | WS_BORDER | WS_VSCROLL | LBS_NOTIFY',
    'ListView': 'WS_CHILD | WS_BORDER | LVS_REPORT',
    '列表视图': 'WS_CHILD | WS_BORDER | LVS_REPORT',
    'TreeView': 'WS_CHILD | WS_BORDER | TVS_HASLINES | TVS_LINESATROOT | TVS_HASBUTTONS',
    '树形框': 'WS_CHILD | WS_BORDER | TVS_HASLINES | TVS_LINESATROOT | TVS_HASBUTTONS',
    'TabControl': 'WS_CHILD | WS_CLIPSIBLINGS',
    '标签页': 'WS_CHILD | WS_CLIPSIBLINGS',
    'ComboBox': 'WS_CHILD | CBS_DROPDOWNLIST | WS_VSCROLL',
    '组合框': 'WS_CHILD | CBS_DROPDOWNLIST | WS_VSCROLL',
    'SliderBar': 'WS_CHILD | TBS_AUTOTICKS',
    '滑块条': 'WS_CHILD | TBS_AUTOTICKS',
    'ScrollBar': 'WS_CHILD | SBS_HORZ',
    '滚动条': 'WS_CHILD | SBS_HORZ',
    'ProgressBar': 'WS_CHILD',
    '进度条': 'WS_CHILD',
    'GroupBox': 'WS_CHILD | BS_GROUPBOX',
    '分组框': 'WS_CHILD | BS_GROUPBOX',
    '图片框': 'WS_CHILD | SS_LEFT',
    'ycUI按钮': 'WS_CHILD',
  }
  return map[ctrlType] || 'WS_CHILD | SS_LEFT'
}

function resolveCommandNotifyCode(className: string, eventName: string): string | null {
  const cls = (className || '').toUpperCase()
  const ev = (eventName || '').replace(/\s+/g, '')

  const isClick = ev.includes('被单击') || ev === '单击' || ev === '点击'
  const isDblClick = ev.includes('双击')
  const isTextChange = ev.includes('内容被改变') || ev.includes('内容改变') || ev.includes('文本被改变') || ev.includes('文本改变')
  const isSelectChange = ev.includes('选择项被改变') || ev.includes('选择被改变') || ev.includes('选中项被改变') || ev.includes('选中被改变')
  const isFocus = ev.includes('得到焦点')
  const isBlur = ev.includes('失去焦点')

  if (isClick) {
    if (cls === 'BUTTON' || cls === 'YCBUTTON') return 'BN_CLICKED'
    if (cls === 'STATIC') return 'STN_CLICKED'
  }
  if (isDblClick) {
    if (cls === 'BUTTON' || cls === 'YCBUTTON') return 'BN_DBLCLK'
    if (cls === 'STATIC') return 'STN_DBLCLK'
    if (cls === 'LISTBOX') return 'LBN_DBLCLK'
  }
  if (isTextChange) {
    if (cls === 'EDIT') return 'EN_CHANGE'
    if (cls === 'COMBOBOX') return 'CBN_EDITCHANGE'
  }
  if (isSelectChange) {
    if (cls === 'LISTBOX') return 'LBN_SELCHANGE'
    if (cls === 'COMBOBOX') return 'CBN_SELCHANGE'
  }
  if (isFocus) {
    if (cls === 'EDIT') return 'EN_SETFOCUS'
    if (cls === 'LISTBOX') return 'LBN_SETFOCUS'
    if (cls === 'COMBOBOX') return 'CBN_SETFOCUS'
    if (cls === 'BUTTON' || cls === 'YCBUTTON') return 'BN_SETFOCUS'
  }
  if (isBlur) {
    if (cls === 'EDIT') return 'EN_KILLFOCUS'
    if (cls === 'LISTBOX') return 'LBN_KILLFOCUS'
    if (cls === 'COMBOBOX') return 'CBN_KILLFOCUS'
    if (cls === 'BUTTON' || cls === 'YCBUTTON') return 'BN_KILLFOCUS'
  }

  return null
}

function resolveNotifyCode(className: string, eventName: string): string | null {
  const cls = (className || '').toUpperCase()
  const ev = (eventName || '').replace(/\s+/g, '')

  const isClick = ev.includes('被单击') || ev === '单击' || ev === '点击'
  const isDblClick = ev.includes('双击')
  const isSelectChange = ev.includes('选择项被改变') || ev.includes('选择被改变') || ev.includes('选中项被改变') || ev.includes('选中被改变')
  const isItemActivate = ev.includes('项被激活') || ev.includes('激活项')
  const isLabelBegin = ev.includes('开始标签编辑') || ev.includes('开始编辑标签')
  const isLabelEnd = ev.includes('结束标签编辑') || ev.includes('标签编辑结束')
  const isExpandCollapse = ev.includes('展开') || ev.includes('折叠')
  const isCustomDraw = ev.includes('自定义绘制') || ev.includes('绘制')

  if (cls === 'SYSLISTVIEW32') {
    if (isClick) return 'NM_CLICK'
    if (isDblClick) return 'NM_DBLCLK'
    if (isSelectChange) return 'LVN_ITEMCHANGED'
    if (isItemActivate) return 'LVN_ITEMACTIVATE'
    if (isLabelBegin) return 'LVN_BEGINLABELEDIT'
    if (isLabelEnd) return 'LVN_ENDLABELEDIT'
    if (isCustomDraw) return 'NM_CUSTOMDRAW'
  }

  if (cls === 'SYSTREEVIEW32') {
    if (isClick) return 'NM_CLICK'
    if (isDblClick) return 'NM_DBLCLK'
    if (isSelectChange) return 'TVN_SELCHANGED'
    if (isLabelBegin) return 'TVN_BEGINLABELEDIT'
    if (isLabelEnd) return 'TVN_ENDLABELEDIT'
    if (isExpandCollapse) return 'TVN_ITEMEXPANDED'
    if (isCustomDraw) return 'NM_CUSTOMDRAW'
  }

  if (cls === 'SYSTABCONTROL32') {
    if (isSelectChange) return 'TCN_SELCHANGE'
    if (isClick) return 'NM_CLICK'
    if (isDblClick) return 'NM_DBLCLK'
  }

  return null
}

function resolveScrollMessage(className: string, eventName: string): 'WM_HSCROLL' | 'WM_VSCROLL' | null {
  const cls = (className || '').toUpperCase()
  const ev = (eventName || '').replace(/\s+/g, '')
  const isScrollLike = ev.includes('滚动') || ev.includes('位置') || ev.includes('值被改变') || ev.includes('值改变')
  if (!isScrollLike) return null

  if (cls === 'MSCTLS_TRACKBAR32') return 'WM_HSCROLL'
  if (cls === 'SCROLLBAR') return 'WM_HSCROLL'
  return null
}

function normalizeKey(text: string): string {
  return (text || '').replace(/\s+/g, '').toLowerCase()
}

function parseEventBindingsFromProtocol(content: string, libName: string): NormalizedEventBinding[] {
  let json: LibraryCompileProtocol
  try {
    json = JSON.parse(content) as LibraryCompileProtocol
  } catch {
    return []
  }

  const result: NormalizedEventBinding[] = []
  const pushNormalizedEvent = (
    libraryName: string,
    unitText: string,
    unitEnglishNameText: string,
    eventText: string,
    channel: EventChannel,
    codeText?: string,
  ): void => {
    if (!['WM_COMMAND', 'WM_NOTIFY', 'WM_HSCROLL', 'WM_VSCROLL'].includes(channel)) return
    const unit = normalizeKey(unitText)
    const event = normalizeKey(eventText)
    if (!unit || !event) return

    const normalized: NormalizedEventBinding = {
      library: normalizeKey(libraryName),
      unit,
      unitEnglishName: normalizeKey(unitEnglishNameText),
      event,
      channel,
      code: (codeText || '').trim(),
    }
    // WM_COMMAND / WM_NOTIFY 需要通知码，滚动消息不需要。
    if ((channel === 'WM_COMMAND' || channel === 'WM_NOTIFY') && !normalized.code) return
    result.push(normalized)
  }

  if (Array.isArray(json.eventBindings)) {
    for (const item of json.eventBindings) {
      if (!item || typeof item !== 'object') continue
      const channel = item.channel
      if (!channel) continue
      pushNormalizedEvent(
        item.library || libName,
        item.unit || '',
        item.unitEnglishName || '',
        item.event || '',
        channel,
        item.code,
      )
    }
  }

  if (Array.isArray(json.windowUnits)) {
    for (const unit of json.windowUnits) {
      if (!unit || typeof unit !== 'object' || !Array.isArray(unit.events)) continue
      for (const ev of unit.events) {
        if (!ev || typeof ev !== 'object' || !ev.channel) continue
        pushNormalizedEvent(
          libName,
          unit.name || '',
          unit.englishName || '',
          ev.name || '',
          ev.channel,
          ev.code,
        )
      }
    }
  }
  return result
}

function parseCommandBindingsFromProtocol(content: string, libName: string): NormalizedCommandBinding[] {
  let json: LibraryCompileProtocol
  try {
    json = JSON.parse(content) as LibraryCompileProtocol
  } catch {
    return []
  }

  if (!json || !Array.isArray(json.commandBindings)) return []

  const result: NormalizedCommandBinding[] = []
  for (const item of json.commandBindings) {
    if (!item || typeof item !== 'object') continue
    const command = normalizeKey(item.command || '')
    const commandEnglishName = normalizeKey(item.commandEnglishName || '')
    const emit = (item.emit || '').trim()
    const expr = (item.expr || '').trim()
    const exprOp = normalizeKey(item.exprOp || '')
    const exprBuilder = normalizeKey(item.exprBuilder || '')
    const emitBuilder = normalizeKey(item.emitBuilder || '')
    if ((!command && !commandEnglishName) || (!emit && !expr && !exprOp && !exprBuilder && !emitBuilder)) continue
    result.push({
      library: normalizeKey(item.library || libName),
      command,
      commandEnglishName,
      emit,
      expr,
      exprOp,
      exprBuilder,
      emitBuilder,
    })
  }
  return result
}

function parseControlBindingsFromProtocol(content: string, libName: string): NormalizedControlBinding[] {
  let json: LibraryCompileProtocol
  try {
    json = JSON.parse(content) as LibraryCompileProtocol
  } catch {
    return []
  }

  const result: NormalizedControlBinding[] = []
  const pushNormalizedControl = (
    libraryName: string,
    unitText: string,
    unitEnglishNameText: string,
    classNameText?: string,
    styleText?: string,
  ): void => {
    const unit = normalizeKey(unitText)
    const className = (classNameText || '').trim()
    if (!unit || !className) return
    result.push({
      library: normalizeKey(libraryName),
      unit,
      unitEnglishName: normalizeKey(unitEnglishNameText),
      className,
      style: (styleText || '').trim(),
    })
  }

  if (Array.isArray(json.controlBindings)) {
    for (const item of json.controlBindings) {
      if (!item || typeof item !== 'object') continue
      pushNormalizedControl(
        item.library || libName,
        item.unit || '',
        item.unitEnglishName || '',
        item.className,
        item.style,
      )
    }
  }

  if (Array.isArray(json.windowUnits)) {
    for (const unit of json.windowUnits) {
      if (!unit || typeof unit !== 'object') continue
      pushNormalizedControl(
        libName,
        unit.name || '',
        unit.englishName || '',
        unit.className,
        unit.style,
      )
    }
  }
  return result
}

function loadCompileProtocols(): LoadedCompileProtocols {
  const libs = libraryManager.getCachedList().filter(l => l.loaded)
  const signatureParts: string[] = []
  for (const lib of libs) {
    const dir = (() => {
      try {
        return statSync(lib.filePath).isDirectory() ? lib.filePath : dirname(lib.filePath)
      } catch {
        return dirname(lib.filePath)
      }
    })()
    const candidates = [
      join(dir, `${lib.name}.events.json`),
      join(dir, 'window-units.json'),
      join(dir, `${lib.name}.window-units.json`),
      join(dir, `${lib.name}.protocol.json`),
      join(dir, `${lib.name}.compile-protocol.json`),
    ]
    let matchedPath = ''
    let matchedMtime = 0
    let matchedSize = 0
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue
      matchedPath = candidate
      try {
        const st = statSync(candidate)
        matchedMtime = st.mtimeMs
        matchedSize = st.size
      } catch {
        matchedMtime = 0
        matchedSize = 0
      }
      break
    }
    signatureParts.push(`${lib.name}|${matchedPath}|${matchedMtime}|${matchedSize}`)
  }
  const signature = signatureParts.sort().join('||')

  if (compileProtocolCache && compileProtocolCacheSignature === signature) return compileProtocolCache

  const events: NormalizedEventBinding[] = []
  const commands: NormalizedCommandBinding[] = []
  const controls: NormalizedControlBinding[] = []
  for (const lib of libs) {
    const dir = (() => {
      try {
        return statSync(lib.filePath).isDirectory() ? lib.filePath : dirname(lib.filePath)
      } catch {
        return dirname(lib.filePath)
      }
    })()
    const candidates = [
      join(dir, `${lib.name}.events.json`),
      join(dir, 'window-units.json'),
      join(dir, `${lib.name}.window-units.json`),
      join(dir, `${lib.name}.protocol.json`),
      join(dir, `${lib.name}.compile-protocol.json`),
    ]

    for (const p of candidates) {
      if (!existsSync(p)) continue
      try {
        const content = readFileSync(p, 'utf-8')
        const parsedEvents = parseEventBindingsFromProtocol(content, lib.name)
        const parsedCommands = parseCommandBindingsFromProtocol(content, lib.name)
        const parsedControls = parseControlBindingsFromProtocol(content, lib.name)
        if (parsedEvents.length > 0 || parsedCommands.length > 0 || parsedControls.length > 0) {
          events.push(...parsedEvents)
          commands.push(...parsedCommands)
          controls.push(...parsedControls)
          sendMessage({
            type: 'info',
            text: `已加载支持库编译协议: ${basename(p)} (事件 ${parsedEvents.length} / 命令 ${parsedCommands.length} / 控件 ${parsedControls.length})`
          })
          break
        }
      } catch {
        sendMessage({ type: 'warning', text: `警告: 读取支持库编译协议失败: ${p}` })
      }
    }
  }

  compileProtocolCache = { events, commands, controls }
  compileProtocolCacheSignature = signature
  return compileProtocolCache
}

function resolveEventByProtocol(
  bindings: NormalizedEventBinding[],
  libraryFileName: string,
  unitName: string,
  unitEnglishName: string,
  eventName: string,
): { channel: EventChannel; code: string } | null {
  if (bindings.length === 0) return null

  const lib = normalizeKey(libraryFileName)
  const unit = normalizeKey(unitName)
  const unitEn = normalizeKey(unitEnglishName)
  const event = normalizeKey(eventName)
  if (!event) return null

  for (const b of bindings) {
    if (b.library && b.library !== lib) continue
    const unitMatch = b.unit === unit || (!!b.unitEnglishName && b.unitEnglishName === unitEn)
    if (!unitMatch || b.event !== event) continue
    return { channel: b.channel, code: b.code }
  }
  return null
}

function applyEmitTemplate(template: string, args: string[]): string {
  const cArgs = args.map(a => formatArgForC(a))
  const optionalTextArgs = args.map(a => formatOptionalTextArgForC(a))
  return template
    .replace(/\{opt(\d+)\}/g, (_m, idxText) => {
      const idx = parseInt(idxText, 10)
      return Number.isInteger(idx) && idx >= 0 && idx < optionalTextArgs.length ? optionalTextArgs[idx] : 'NULL'
    })
    .replace(/\{args\}/g, cArgs.join(', '))
    .replace(/\{(\d+)\}/g, (_m, idxText) => {
      const idx = parseInt(idxText, 10)
      return Number.isInteger(idx) && idx >= 0 && idx < cArgs.length ? cArgs[idx] : '0'
    })
}

function resolveCommandByProtocol(
  bindings: NormalizedCommandBinding[],
  libraryFileName: string,
  commandName: string,
  commandEnglishName: string,
  args: string[],
): string | null {
  if (bindings.length === 0) return null

  const lib = normalizeKey(libraryFileName)
  const cmd = normalizeKey(commandName)
  const cmdEn = normalizeKey(commandEnglishName)
  if (!cmd && !cmdEn) return null

  for (const b of bindings) {
    if (b.library && b.library !== lib) continue
    const matched = (!!b.command && b.command === cmd) || (!!b.commandEnglishName && b.commandEnglishName === cmdEn)
    if (!matched || !b.emit) continue
    return applyEmitTemplate(b.emit, args)
  }

  for (const b of bindings) {
    if (b.library && b.library !== lib) continue
    const matched = (!!b.command && b.command === cmd) || (!!b.commandEnglishName && b.commandEnglishName === cmdEn)
    if (!matched || !b.emitBuilder) continue
    if (b.emitBuilder === 'outputdebugtext') {
      const fallbackCommandMap = buildCommandMap()
      const parts = args.filter(arg => (arg || '').trim().length > 0)
      const lines: string[] = []
      lines.push('do {')
      lines.push('#if YC_DEBUG_BUILD')
      lines.push('    yc_debug_line_begin();')
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        if (i > 0) lines.push('    yc_debug_line_part("|");')
        lines.push(`    yc_debug_line_part(${translateExpressionToC(part, fallbackCommandMap)});`)
      }
      lines.push('    yc_debug_line_end();')
      lines.push('#endif')
      lines.push('} while (0);')
      return lines.join('\n')
    }
    if (b.emitBuilder === 'pause') {
      return ['do {', '#if YC_DEBUG_BUILD', '    DebugBreak();', '#endif', '} while (0);'].join('\n')
    }
    if (b.emitBuilder === 'check') {
      const cond = translateExpressionToC(args[0] || '0')
      const rawCond = ((args[0] || '').trim() || '0').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      return [
        'do {',
        '#if YC_DEBUG_BUILD',
        `    if (!(${cond})) {`,
        '        yc_debug_line_begin();',
        '        yc_debug_line_part(L"检查失败: ");',
        `        yc_debug_line_part(L"${rawCond}");`,
        '        yc_debug_line_end();',
        '        DebugBreak();',
        '    }',
        '#endif',
        '} while (0);',
      ].join('\n')
    }
  }
  return null
}

function resolveCommandExprByProtocol(
  bindings: NormalizedCommandBinding[],
  libraryFileName: string,
  commandName: string,
  commandEnglishName: string,
  args: string[],
  commandMap?: Map<string, ResolvedCommand>,
  directCallables?: DirectCallableNames,
): string | null {
  if (bindings.length === 0) return null

  const lib = normalizeKey(libraryFileName)
  const cmd = normalizeKey(commandName)
  const cmdEn = normalizeKey(commandEnglishName)
  if (!cmd && !cmdEn) return null

  for (const b of bindings) {
    if (b.library && b.library !== lib) continue
    const matched = (!!b.command && b.command === cmd) || (!!b.commandEnglishName && b.commandEnglishName === cmdEn)
    if (!matched || !b.expr) continue
    return applyEmitTemplate(b.expr, args)
  }

  for (const b of bindings) {
    if (b.library && b.library !== lib) continue
    const matched = (!!b.command && b.command === cmd) || (!!b.commandEnglishName && b.commandEnglishName === cmdEn)
    if (!matched || !b.exprOp) continue
    switch (b.exprOp) {
      case 'eq': return buildComparisonExpression(args[0] || '0', args[1] || '0', '==', commandMap, directCallables)
      case 'ne': return buildComparisonExpression(args[0] || '0', args[1] || '0', '!=', commandMap, directCallables)
      case 'lt': return buildComparisonExpression(args[0] || '0', args[1] || '0', '<', commandMap, directCallables)
      case 'gt': return buildComparisonExpression(args[0] || '0', args[1] || '0', '>', commandMap, directCallables)
      case 'le': return buildComparisonExpression(args[0] || '0', args[1] || '0', '<=', commandMap, directCallables)
      case 'ge': return buildComparisonExpression(args[0] || '0', args[1] || '0', '>=', commandMap, directCallables)
      case 'and': return buildLogicChainExpression(args, '&&', commandMap, directCallables)
      case 'or': return buildLogicChainExpression(args, '||', commandMap, directCallables)
      case 'not': return `(!(${translateExpressionToC(args[0] || '0', commandMap, directCallables)}))`
      case 'startswith': return `yc_text_starts_with(${translateExpressionToC(args[0] || '""', commandMap, directCallables)}, ${translateExpressionToC(args[1] || '""', commandMap, directCallables)})`
      default: break
    }
  }

  for (const b of bindings) {
    if (b.library && b.library !== lib) continue
    const matched = (!!b.command && b.command === cmd) || (!!b.commandEnglishName && b.commandEnglishName === cmdEn)
    if (!matched || !b.exprBuilder) continue
    if (b.exprBuilder === 'writefilebins') {
      return `yc_fs_write_file_bins(${formatArgForC(args[0] || '""', commandMap, directCallables)}, std::vector<YC_BIN>{${args.slice(1).map(arg => formatArgForC(arg, commandMap, directCallables)).join(', ')}})`
    }
  }

  return null
}

function resolveControlByProtocol(
  bindings: NormalizedControlBinding[],
  libraryFileName: string,
  unitName: string,
  unitEnglishName: string,
): { className: string; style: string } | null {
  if (bindings.length === 0) return null

  const lib = normalizeKey(libraryFileName)
  const unit = normalizeKey(unitName)
  const unitEn = normalizeKey(unitEnglishName)

  for (const b of bindings) {
    if (b.library && b.library !== lib) continue
    const unitMatch = b.unit === unit || (!!b.unitEnglishName && b.unitEnglishName === unitEn)
    if (!unitMatch) continue
    return { className: b.className, style: b.style }
  }
  return null
}

function resolveControlClassName(ctrlType: string, unit: LibWindowUnit | undefined, libraryFileName: string, protocolBindings: NormalizedControlBinding[]): string {
  const byProtocol = resolveControlByProtocol(protocolBindings, libraryFileName, unit?.name || ctrlType, unit?.englishName || '')
  if (byProtocol?.className) return byProtocol.className
  if (unit?.englishName) return unit.englishName
  return getWin32ClassName(ctrlType)
}

function resolveControlStyle(ctrlType: string, unit: LibWindowUnit | undefined, libraryFileName: string, protocolBindings: NormalizedControlBinding[]): string {
  const byProtocol = resolveControlByProtocol(protocolBindings, libraryFileName, unit?.name || ctrlType, unit?.englishName || '')
  if (byProtocol?.style) return byProtocol.style
  return getWin32Style(ctrlType)
}

// 控件初始文本：编辑框类的空内容不能回退到控件名（空编辑框应显示为空），
// 浏览框的窗口文本承载初始地址；按钮/标签等标题类控件保留回退控件名的行为
function resolveControlInitialText(
  c: { type?: string; text?: string; name?: string },
  props: Record<string, unknown>,
): string {
  const fromProps = props['标题'] || props['内容'] || props['文本'] || props['地址'] || props['title'] || props['text']
  const noNameFallback = c.type === '编辑框' || c.type === '超级编辑框' || c.type === '文本框' || c.type === 'Edit' || c.type === 'TextBox'
    || c.type === '浏览框' || c.type === 'WebView' || c.type === '网页编辑框' || c.type === 'WebEdit'
  const fallbackName = noNameFallback ? '' : (c.name || '')
  return String(fromProps || c.text || fallbackName || '')
}

// 设计器属性值容错读取：属性面板存布尔/数字，但手工编辑的 .efw 可能是 '真'/'假'/数字字符串
function readBoolProp(value: unknown, def: boolean): boolean {
  if (value === undefined || value === null) return def
  if (typeof value === 'boolean') return value
  if (value === '真' || value === 'true' || value === 1) return true
  if (value === '假' || value === 'false' || value === 0) return false
  return def
}

function readIntProp(value: unknown, def: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10)
  return def
}

interface EditControlCodegen {
  exStyle: string
  style: string
  postCreateLines: string[]
  colorEntry: { textColor: number; backColor: number } | null
  needsInputFilter: boolean
}

// 标准 EDIT 控件不走 WCM_SETPROP 协议（Win32 原生类忽略 WM_APP+1），
// 编辑框属性必须在创建时落成样式位，创建后用 EM_* 消息补齐动态属性。
// 各属性默认值必须与 lib/krnln/window-units.json 编辑框定义中的 defaultValue 保持一致。
function buildStdEditCodegen(extraProps: Record<string, unknown>): EditControlCodegen {
  const border = readIntProp(extraProps['边框'], 2)
  const multiline = readBoolProp(extraProps['是否允许多行'], false)
  const scroll = readIntProp(extraProps['滚动条'], 0)
  const align = readIntProp(extraProps['对齐方式'], 0)
  const inputMode = readIntProp(extraProps['输入方式'], 0)
  const caseConvert = readIntProp(extraProps['转换方式'], 0)
  const hideSelection = readBoolProp(extraProps['隐藏选择'], true)
  const tabStop = readBoolProp(extraProps['可停留焦点'], true)
  const maxLen = readIntProp(extraProps['最大允许长度'], 0)
  const selStart = readIntProp(extraProps['起始选择位置'], 0)
  const selLength = readIntProp(extraProps['被选择字符数'], 0)
  const spinMode = readIntProp(extraProps['调节器方式'], 0)
  const spinMin = readIntProp(extraProps['调节器底限值'], 0)
  const spinMax = readIntProp(extraProps['调节器上限值'], 100)
  const passwordChar = String(extraProps['密码遮盖字符'] ?? '*')
  const textColor = readIntProp(extraProps['文本颜色'], 0)
  const backColor = readIntProp(extraProps['背景颜色'], 0xffffff)

  const parts = ['WS_CHILD']
  if (tabStop) parts.push('WS_TABSTOP')
  if (multiline) {
    parts.push('ES_MULTILINE', 'ES_AUTOVSCROLL', 'ES_WANTRETURN')
  } else {
    parts.push('ES_AUTOHSCROLL')
  }
  if (scroll === 1 || scroll === 3) parts.push('WS_HSCROLL')
  if (scroll === 2 || scroll === 3) parts.push('WS_VSCROLL')
  if (align === 1) parts.push('ES_CENTER')
  else if (align === 2) parts.push('ES_RIGHT')
  // 输入方式：0通常 1只读文本 2密码输入 3整数文本 4小数文本 5字节 6短整数 7整数 8长整数 9小数 10双精度 11日期时间
  if (inputMode === 1) parts.push('ES_READONLY')
  if (inputMode === 2) parts.push('ES_PASSWORD')
  if (caseConvert === 1) parts.push('ES_UPPERCASE')
  else if (caseConvert === 2) parts.push('ES_LOWERCASE')
  if (!hideSelection) parts.push('ES_NOHIDESEL')
  if (border === 1) parts.push('WS_BORDER')

  const postCreateLines: string[] = []
  if (maxLen > 0) {
    postCreateLines.push(`SendMessage(hCtrl, EM_LIMITTEXT, ${maxLen}, 0);`)
  }
  if (inputMode === 2) {
    const maskCodePoint = passwordChar.codePointAt(0) ?? 42
    if (maskCodePoint !== 42) {
      postCreateLines.push(`SendMessage(hCtrl, EM_SETPASSWORDCHAR, ${maskCodePoint}, 0);`)
    }
  }
  const needsInputFilter = inputMode >= 3 && inputMode <= 11
  if (needsInputFilter) {
    postCreateLines.push(`SetWindowSubclass(hCtrl, YcEditInputFilterProc, 1, (DWORD_PTR)${inputMode});`)
  }
  if (selStart > 0 || selLength > 0) {
    postCreateLines.push(`SendMessage(hCtrl, EM_SETSEL, ${Math.max(selStart, 0)}, ${Math.max(selStart, 0) + Math.max(selLength, 0)});`)
  }
  if (spinMode === 1) {
    postCreateLines.push(
      '{ HWND hSpin = CreateWindowExW(0, L"msctls_updown32", L"", WS_CHILD | WS_VISIBLE | UDS_SETBUDDYINT | UDS_ALIGNRIGHT | UDS_ARROWKEYS | UDS_NOTHOUSANDS, 0, 0, 0, 0, hWndParent, NULL, g_hInstance, NULL);'
      + ' SendMessage(hSpin, UDM_SETBUDDY, (WPARAM)hCtrl, 0);'
      + ` SendMessage(hSpin, UDM_SETRANGE32, (WPARAM)${spinMin}, (LPARAM)${spinMax}); }`,
    )
  }

  return {
    exStyle: border === 2 ? 'WS_EX_CLIENTEDGE' : '0',
    style: parts.join(' | '),
    postCreateLines,
    colorEntry: (textColor !== 0 || backColor !== 0xffffff) ? { textColor, backColor } : null,
    needsInputFilter,
  }
}

// 解析窗口文件
function parseWindowFile(efwPath: string): WindowFileInfo {
  const defaultFormName = basename(efwPath, '.efw') || '_启动窗口'
  const info: WindowFileInfo = { formName: defaultFormName, width: 592, height: 384, title: '窗口', visible: true, disabled: false, border: 2, maxButton: true, minButton: true, controlBox: true, topmost: false, startPos: 1, controls: [] }
  if (!existsSync(efwPath)) return info
  try {
    const data = JSON.parse(readFileSync(efwPath, 'utf-8'))
    info.formName = (data.name || data.formName || defaultFormName || '_启动窗口')
    info.width = data.formWidth || data.width || 592
    info.height = data.formHeight || data.height || 384
    info.title = data.formTitle || data.title || data.name || '窗口'
    const p = data.properties || {}
    if (p['可视'] === false) info.visible = false
    if (p['禁止'] === true) info.disabled = true
    if (typeof p['边框'] === 'number') info.border = p['边框']
    if (p['最大化按鈕'] === false) info.maxButton = false
    if (p['最小化按鈕'] === false) info.minButton = false
    if (p['控制按鈕'] === false) info.controlBox = false
    if (p['总在最前'] === true) info.topmost = true
    if (typeof p['位置'] === 'number') info.startPos = p['位置']
    if (Array.isArray(data.controls)) {
      for (const c of data.controls) {
        const props = c.properties || {}
        info.controls.push({
          type: c.type || '',
          name: c.name || '',
          x: c.x ?? c.left ?? 0,
          y: c.y ?? c.top ?? 0,
          width: c.width ?? 80,
          height: c.height ?? 24,
          text: resolveControlInitialText(c, props),
          visible: c.visible ?? true,
          disabled: c.enabled === false || props['禁止'] === true,
          extraProps: { ...props },
        })
      }
    }
  } catch { /* ignore */ }
  return info
}

// 易语言数据类型 → C 类型
function mapTypeToCType(type: string): string {
  const trimmed = (type || '').trim()
  if (activeProjectClassNames.has(trimmed)) return trimmed
  if (activeProjectCustomTypeNames.has(trimmed)) return `struct ${trimmed}`
  if (trimmed.includes('指针') || trimmed.includes('ptr') || trimmed.includes('PTR')) return 'intptr_t'
  const map: Record<string, string> = {
    '整数型': 'int', '长整数型': 'long long', '小数型': 'float',
    '双精度小数型': 'double', '文本型': 'wchar_t*', '逻辑型': 'int', '字节集': 'YC_BIN', '大整数型': 'YC_BIG', '大数': 'YC_BIG',
    '字节型': 'unsigned char', '短整数型': 'short',
  }
  return map[trimmed] || 'int'
}

function getTypeDefaultInitializer(type: string): string {
  const trimmed = (type || '').trim()
  if (activeProjectClassNames.has(trimmed)) return '{}'
  if (activeProjectCustomTypeNames.has(trimmed)) return '{}'
  const cType = mapTypeToCType(trimmed)
  if (cType === 'wchar_t*') return 'NULL'
  if (cType === 'YC_BIN') return 'YC_BIN()'
  if (cType === 'YC_BIG') return 'YC_BIG()'
  if (cType === 'float') return '0.0f'
  if (cType === 'double') return '0.0'
  return '0'
}

function splitDeclParts(text: string): string[] {
  return text.split(/[\uFF0C,]/).map(s => s.trim())
}

// \u5265\u79BB\u4EE3\u7801\u884C\u7684\u884C\u5C3E\u5355\u5F15\u53F7\u6CE8\u91CA\uFF08\u5FFD\u7565\u53CC\u5F15\u53F7\u5B57\u7B26\u4E32\u5185\u7684 '\uFF09\u3002
// \u6574\u884C\u6CE8\u91CA\uFF08\u4EE5 ' \u5F00\u5934\uFF09\u539F\u6837\u4FDD\u7559\uFF0C\u7531\u8C03\u7528\u65B9\u6309\u6CE8\u91CA\u884C\u5904\u7406\u3002
function stripTrailingEycComment(line: string): string {
  if (!line || line.startsWith("'")) return line
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuote) {
      if (ch === '"' || ch === '\u201D') inQuote = false
      continue
    }
    if (ch === '"' || ch === '\u201C') {
      inQuote = true
      continue
    }
    if (ch === "'") return line.slice(0, i).trimEnd()
  }
  return line
}

function unquoteDeclValue(text: string): string {
  const trimmed = (text || '').trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\u201c') && trimmed.endsWith('\u201d'))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseGlobalVarDeclarations(content: string): GlobalVarDef[] {
  const vars: GlobalVarDef[] = []
  const lines = content.split('\n')
  for (const rawLine of lines) {
    const line = rawLine.replace(/[\u200B\u200C\u200D\u2060]/g, '').trim()
    if (!line.startsWith('.全局变量 ')) continue
    const parts = splitDeclParts(line.substring(5))
    const name = parts[0] || ''
    const type = parts[1] || '整数型'
    if (!name) continue
    vars.push({ name, type })
  }
  return vars
}

function parseConstantDeclarations(content: string): ConstantDef[] {
  const constants: ConstantDef[] = []
  const lines = content.split('\n')
  for (const rawLine of lines) {
    const line = rawLine.replace(/[\u200B\u200C\u200D\u2060]/g, '').trim()
    if (!line.startsWith('.常量 ')) continue
    const parts = splitDeclParts(line.substring(3))
    const name = parts[0] || ''
    const value = parts[1] || '0'
    if (!name) continue
    constants.push({ name, value })
  }
  return constants
}

function collectProjectGlobalVars(project: ProjectInfo, editorFiles?: Map<string, string>): GlobalVarDef[] {
  const result: GlobalVarDef[] = []
  const seen = new Set<string>()

  for (const f of project.files) {
    if (f.type !== 'EYC' && f.type !== 'EGV' && f.type !== 'ECS' && f.type !== 'EDT' && f.type !== 'ELL') continue
    const sourcePath = join(project.projectDir, f.fileName)
    const editorContent = editorFiles?.get(f.fileName)
    const content = editorContent || (existsSync(sourcePath) ? readFileSync(sourcePath, 'utf-8') : '')
    if (!content) continue

    const vars = parseGlobalVarDeclarations(content)
    for (const v of vars) {
      if (seen.has(v.name)) continue
      seen.add(v.name)
      result.push(v)
    }
  }

  return result
}

function collectProjectConstants(project: ProjectInfo, editorFiles?: Map<string, string>): ConstantDef[] {
  const result: ConstantDef[] = []
  const seen = new Set<string>()

  for (const f of project.files) {
    if (f.type !== 'EYC' && f.type !== 'EGV' && f.type !== 'ECS' && f.type !== 'EDT' && f.type !== 'ELL') continue
    const sourcePath = join(project.projectDir, f.fileName)
    const editorContent = editorFiles?.get(f.fileName)
    const content = editorContent || (existsSync(sourcePath) ? readFileSync(sourcePath, 'utf-8') : '')
    if (!content) continue

    const constants = parseConstantDeclarations(content)
    for (const c of constants) {
      if (seen.has(c.name)) continue
      seen.add(c.name)
      result.push(c)
    }
  }

  return result
}

function collectLibraryConstants(usedLibraryNames?: Set<string>): LibraryConstantDef[] {
  const result: LibraryConstantDef[] = []
  const seen = new Set<string>()

  for (const lib of libraryManager.getLoadedLibraryFiles()) {
    if (usedLibraryNames && !usedLibraryNames.has(lib.name)) continue
    const info = libraryManager.getLibInfo(lib.name)
    const constants = (info?.constants || []) as LibConstant[]
    for (const c of constants) {
      const name = (c.name || '').trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      result.push({
        name,
        value: (c.value || '').trim(),
        type: c.type || 'null',
      })
    }
  }

  return result
}

function collectUsedLibraryFileNames(project: ProjectInfo, editorFiles?: Map<string, string>): Set<string> {
  const used = new Set<string>()
  const commandMap = buildCommandMap()

  // 1) 分析源代码中的命令调用，映射到支持库
  for (const f of project.files) {
    if (f.type !== 'EYC' && f.type !== 'EGV' && f.type !== 'ECS' && f.type !== 'EDT' && f.type !== 'ELL') continue
    const sourcePath = join(project.projectDir, f.fileName)
    const editorContent = editorFiles?.get(f.fileName)
    const content = editorContent || (existsSync(sourcePath) ? readFileSync(sourcePath, 'utf-8') : '')
    if (!content) continue

    const lines = content.split('\n')
    for (const rawLine of lines) {
      const line = rawLine.replace(/[\u200B\u200C\u200D\u2060]/g, '').trim()
      if (!line || line.startsWith("'")) continue

      if (
        line.startsWith('.版本') ||
        line.startsWith('.程序集') ||
        line.startsWith('.参数 ') ||
        line.startsWith('.全局变量 ') ||
        line.startsWith('.局部变量 ') ||
        line.startsWith('.常量 ') ||
        line.startsWith('.数据类型 ') ||
        line.startsWith('.成员 ') ||
        line.startsWith('.支持库 ')
      ) {
        continue
      }

      // 赋值右值中的命令调用：例如 test = 取本机名()
      const assignMatch = line.match(/^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*\s*[＝=]\s*(.+)$/)
      if (assignMatch) {
        const rhsCall = parseCommandCall(assignMatch[1].trim())
        if (rhsCall?.name) {
          const rhsResolved = commandMap.get(rhsCall.name)
          if (rhsResolved?.libraryFileName) used.add(rhsResolved.libraryFileName)
        }
      }

      // 嵌套在实参中的命令调用：例如 a ＝ 外部命令(指针到长整数(地址), 0)
      // 顶层命令名识别不到这类调用，会漏标支持库导致链接缺符号
      const codeLine = stripTrailingEycComment(line)
      const nestedCallRe = /([一-龥A-Za-z_][一-龥A-Za-z0-9_]*)\s*[（(]/g
      let nestedMatch: RegExpExecArray | null
      while ((nestedMatch = nestedCallRe.exec(codeLine)) !== null) {
        const nestedResolved = commandMap.get(nestedMatch[1])
        if (nestedResolved?.libraryFileName) used.add(nestedResolved.libraryFileName)
      }

      const callableLine = line.startsWith('.') ? line.substring(1).trim() : line
      if (!callableLine) continue
      const cmdName = extractCommandName(callableLine)
      if (!cmdName) continue
      const resolved = commandMap.get(cmdName)
      if (resolved?.libraryFileName) used.add(resolved.libraryFileName)
    }
  }

  // 2) 分析窗口文件中的控件类型，映射到支持库
  const allUnits = libraryManager.getAllWindowUnits()
  const loadedLibs = libraryManager.getCachedList().filter(l => l.loaded)
  const libNameToFileName = new Map<string, string>()
  for (const lib of loadedLibs) {
    libNameToFileName.set(normalizeKey(lib.libName || ''), lib.name)
    libNameToFileName.set(normalizeKey(lib.name), lib.name)
  }

  for (const f of project.files) {
    if (f.type !== 'EFW' && !f.fileName.toLowerCase().endsWith('.efw')) continue
    const efwPath = join(project.projectDir, f.fileName)
    const editorContent = editorFiles?.get(f.fileName)
    const winInfo = editorContent ? (() => {
      try {
        const data = JSON.parse(editorContent)
        const controls = Array.isArray(data.controls) ? data.controls : []
        return controls.map((c: any) => ({ type: c?.type || '' }))
      } catch {
        return []
      }
    })() : parseWindowFile(efwPath).controls

    for (const ctrl of winInfo) {
      const ctrlType = typeof ctrl.type === 'string' ? ctrl.type : ''
      if (!ctrlType) continue
      const unit = allUnits.find(u => u.name === ctrlType || u.englishName === ctrlType)
      if (!unit) continue
      const libFile = libNameToFileName.get(normalizeKey(unit.libraryName))
      if (libFile) used.add(libFile)
    }
  }

  return used
}

function collectGenericFallbackLibraryFileNames(project: ProjectInfo, editorFiles?: Map<string, string>): Set<string> {
  const used = new Set<string>()
  const commandMap = buildCommandMap()
  const protocols = loadCompileProtocols()

  const markIfGenericFallback = (call: { name: string; args: string[] } | null): void => {
    if (!call?.name) return
    const resolved = commandMap.get(call.name)
    if (!resolved?.libraryFileName) return
    if (isYcmdNativeCommand(resolved)) return
    const protocolCode = resolveCommandByProtocol(
      protocols.commands,
      resolved.libraryFileName,
      resolved.name,
      resolved.englishName,
      call.args || [],
    )
    if (protocolCode) return
    if (COMMAND_CODE_GENERATORS[resolved.name]) return
    if (COMMAND_EXPR_GENERATORS[resolved.name]) return
    used.add(resolved.libraryFileName)
  }

  for (const f of project.files) {
    if (f.type !== 'EYC' && f.type !== 'EGV' && f.type !== 'ECS' && f.type !== 'EDT' && f.type !== 'ELL') continue
    const sourcePath = join(project.projectDir, f.fileName)
    const editorContent = editorFiles?.get(f.fileName)
    const content = editorContent || (existsSync(sourcePath) ? readFileSync(sourcePath, 'utf-8') : '')
    if (!content) continue

    const lines = content.split('\n')
    for (const rawLine of lines) {
      const line = rawLine.replace(/[\u200B\u200C\u200D\u2060]/g, '').trim()
      if (!line || line.startsWith("'")) continue
      if (
        line.startsWith('.版本') ||
        line.startsWith('.程序集') ||
        line.startsWith('.参数 ') ||
        line.startsWith('.全局变量 ') ||
        line.startsWith('.局部变量 ') ||
        line.startsWith('.常量 ') ||
        line.startsWith('.数据类型 ') ||
        line.startsWith('.成员 ') ||
        line.startsWith('.支持库 ')
      ) {
        continue
      }

      const assignMatch = line.match(/^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*\s*[＝=]\s*(.+)$/)
      if (assignMatch) {
        markIfGenericFallback(parseCommandCall(assignMatch[1].trim()))
      }

      const callableLine = line.startsWith('.') ? line.substring(1).trim() : line
      if (!callableLine) continue
      markIfGenericFallback(parseCommandCall(callableLine))
    }
  }

  return used
}

interface CommandSourceLocation {
  fileName: string
  lineNo: number
  commandName: string
}

function collectCommandSourceLocationsByLibrary(project: ProjectInfo, editorFiles?: Map<string, string>): Map<string, CommandSourceLocation[]> {
  const byLib = new Map<string, CommandSourceLocation[]>()
  const seen = new Set<string>()
  const commandMap = buildCommandMap()

  const addLocation = (libFileName: string, fileName: string, lineNo: number, commandName: string): void => {
    const key = `${libFileName}|${fileName}|${lineNo}|${commandName}`
    if (seen.has(key)) return
    seen.add(key)
    if (!byLib.has(libFileName)) byLib.set(libFileName, [])
    byLib.get(libFileName)!.push({ fileName, lineNo, commandName })
  }

  const markCall = (fileName: string, lineNo: number, call: { name: string; args: string[] } | null): void => {
    if (!call?.name) return
    const resolved = commandMap.get(call.name)
    if (!resolved?.libraryFileName) return
    addLocation(resolved.libraryFileName, fileName, lineNo, resolved.name)
  }

  for (const f of project.files) {
    if (f.type !== 'EYC' && f.type !== 'EGV' && f.type !== 'ECS' && f.type !== 'EDT' && f.type !== 'ELL') continue
    const sourcePath = join(project.projectDir, f.fileName)
    const editorContent = editorFiles?.get(f.fileName)
    const content = editorContent || (existsSync(sourcePath) ? readFileSync(sourcePath, 'utf-8') : '')
    if (!content) continue

    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1
      const line = lines[i].replace(/[\u200B\u200C\u200D\u2060]/g, '').trim()
      if (!line || line.startsWith("'")) continue

      const assignMatch = line.match(/^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*\s*[＝=]\s*(.+)$/)
      if (assignMatch) {
        markCall(f.fileName, lineNo, parseCommandCall(assignMatch[1].trim()))
      }

      const callableLine = line.startsWith('.') ? line.substring(1).trim() : line
      if (!callableLine) continue
      markCall(f.fileName, lineNo, parseCommandCall(callableLine))
    }
  }

  return byLib
}

function escapeCString(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
}

function toCLibraryConstantValue(c: LibraryConstantDef): string {
  if (c.type === 'text') return `L"${escapeCString(c.value)}"`
  if (c.type === 'bool') return (c.value === '真' || c.value === '1') ? '1' : '0'
  if (c.type === 'number') return c.value || '0'
  return '0'
}

// ========== 基于支持库的命令解析系统 ==========

// 从已加载的支持库构建命令查找表
// 命令名 → 支持库命令信息（来源由支持库元数据决定）
function buildCommandMap(targetPlatform?: TargetPlatform): Map<string, LibCommand & { libraryName: string; libraryFileName: string }> {
  const map = new Map<string, LibCommand & { libraryName: string; libraryFileName: string }>()
  const allCommands = libraryManager.getAllCommands(targetPlatform)

  for (const cmd of allCommands) {
    if (cmd.isHidden) continue
    // 同名命令后加载的覆盖先加载的（与自动补全行为一致）
    map.set(cmd.name, cmd)
  }
  return map
}

interface CommandSignatureDef {
  name: string
  englishName: string
  params: Array<{ optional: boolean; repeatable?: boolean }>
  source: 'fne' | 'ycmd' | 'projectDll'
  libraryFileName: string
  manifestPath?: string
}

function buildCommandSignatureMap(projectDllCommands: ProjectDllCommandDef[] = [], targetPlatform?: TargetPlatform): Map<string, CommandSignatureDef> {
  const map = new Map<string, CommandSignatureDef>()

  for (const cmd of libraryManager.getAllCommands(targetPlatform)) {
    if (cmd.isHidden) continue
    map.set(cmd.name, {
      name: cmd.name,
      englishName: cmd.englishName || '',
      params: (cmd.params || []).map(p => ({ optional: !!p.optional, repeatable: !!p.repeatable })),
      source: cmd.source === 'ycmd' ? 'ycmd' : 'fne',
      libraryFileName: cmd.libraryFileName,
      manifestPath: cmd.manifestPath,
    })
  }

  for (const dllCmd of projectDllCommands) {
    // 指针命令调用时第一个实参为函数地址，签名中体现为一个隐式必填参数
    const implicitParams = dllCmd.isIndirect ? [{ optional: false }] : []
    map.set(dllCmd.name, {
      name: dllCmd.name,
      englishName: '',
      params: [...implicitParams, ...dllCmd.params.map(param => ({ optional: !!param.optional }))],
      source: 'projectDll',
      libraryFileName: dllCmd.dllFileName,
    })
  }

  return map
}

function collectProjectSubprogramDefs(project: ProjectInfo, editorFiles?: Map<string, string>): SubprogramDef[] {
  const result: SubprogramDef[] = []
  const seen = new Set<string>()
  for (const f of project.files) {
    if (f.type !== 'EYC' && f.type !== 'EGV' && f.type !== 'ECS' && f.type !== 'EDT' && f.type !== 'ELL') continue
    const sourcePath = join(project.projectDir, f.fileName)
    const editorContent = editorFiles?.get(f.fileName)
    const content = editorContent || (existsSync(sourcePath) ? readFileSync(sourcePath, 'utf-8') : '')
    if (!content) continue

    const isClassFile = /\.ecc$/i.test(f.fileName)
    let currentClassName = ''
    let currentSub: SubprogramDef | null = null
    for (const rawLine of content.split('\n')) {
      const line = rawLine.replace(/[\u200B\u200C\u200D\u2060]/g, '').trim()
      if (line.startsWith('.子程序 ')) {
        const parts = line.substring(4).split(',').map(s => s.trim())
        const name = (parts[0] || '').trim()
        if (!name) {
          currentSub = null
          continue
        }
        // 类方法以 类名::方法名 去重，不同类可以有同名方法（如 _初始化/_销毁）
        const dedupeKey = isClassFile ? `${currentClassName}::${name}` : name
        if (!seen.has(dedupeKey)) {
          currentSub = {
            name,
            params: [],
            isClassModule: isClassFile,
            returnType: (parts[1] || '').trim(),
            isPublic: (parts[2] || '').includes('公开'),
            className: isClassFile ? currentClassName : '',
          }
          result.push(currentSub)
          seen.add(dedupeKey)
        } else {
          currentSub = result.find(sub => sub.name === name && sub.className === (isClassFile ? currentClassName : '')) || null
        }
        continue
      }
      if (line.startsWith('.参数 ') && currentSub) {
        const parts = splitDeclParts(line.substring(3))
        const paramName = (parts[0] || '').trim()
        const paramType = (parts[1] || '整数型').trim()
        if (paramName) currentSub.params.push({ name: paramName, type: paramType })
        continue
      }
      if (line.startsWith('.程序集 ')) {
        if (isClassFile) {
          currentClassName = (splitDeclParts(line.substring(5))[0] || '').trim()
        }
        currentSub = null
        continue
      }
      if (line.startsWith('.版本 ') || line.startsWith('.全局变量 ') || line.startsWith('.程序集变量 ')) {
        currentSub = null
      }
    }
  }
  return result
}

// 收集项目类模块（.ecc）的类名与成员变量（程序集变量）
function collectProjectClassModules(project: ProjectInfo, editorFiles?: Map<string, string>): ProjectClassModuleDef[] {
  const result: ProjectClassModuleDef[] = []
  const seen = new Set<string>()
  for (const f of project.files) {
    if (f.type !== 'EYC' || !/\.ecc$/i.test(f.fileName)) continue
    const sourcePath = join(project.projectDir, f.fileName)
    const editorContent = editorFiles?.get(f.fileName)
    const content = editorContent || (existsSync(sourcePath) ? readFileSync(sourcePath, 'utf-8') : '')
    if (!content) continue

    let current: ProjectClassModuleDef | null = null
    for (const rawLine of content.split('\n')) {
      const line = rawLine.replace(/[\u200B\u200C\u200D\u2060]/g, '').trim()
      if (line.startsWith('.程序集 ')) {
        const className = (splitDeclParts(line.substring(5))[0] || '').trim()
        if (className && !seen.has(className)) {
          current = { className, fileName: f.fileName, memberVars: [] }
          result.push(current)
          seen.add(className)
        } else {
          current = result.find(c => c.className === className) || null
        }
        continue
      }
      if (line.startsWith('.程序集变量 ') && current) {
        const parts = splitDeclParts(line.substring(6))
        const varName = (parts[0] || '').trim()
        if (varName) current.memberVars.push({ name: varName, type: (parts[1] || '整数型').trim() })
      }
    }
  }
  return result
}

function parseProjectDataTypes(content: string): ProjectDataTypeDef[] {
  const regexResult = new Map<string, ProjectDataTypeDef>()
  let regexCurrent: ProjectDataTypeDef | null = null
  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/[\u200B\u200C\u200D\u2060]/g, '').trim()
    if (!line || line.startsWith("'")) continue

    const dataTypeMatch = line.match(/^\.数据类型\s+(.+)$/)
    if (dataTypeMatch) {
      const parts = splitDeclParts(dataTypeMatch[1])
      const name = (parts[0] || '').trim()
      if (!name) {
        regexCurrent = null
        continue
      }
      regexCurrent = regexResult.get(name) || { name, fields: [] }
      regexResult.set(name, regexCurrent)
      continue
    }

    const fieldMatch = line.match(/^\.成员\s+(.+)$/)
    if (fieldMatch && regexCurrent) {
      const parts = splitDeclParts(fieldMatch[1])
      const fieldName = (parts[0] || '').trim()
      const fieldType = (parts[1] || '整数型').trim()
      if (fieldName) regexCurrent.fields.push({ name: fieldName, type: fieldType })
      continue
    }

    if (line.startsWith('.子程序') || line.startsWith('.程序集') || line.startsWith('.DLL命令') || line.startsWith('.指针命令')) {
      regexCurrent = null
    }
  }
  if (regexResult.size > 0) return [...regexResult.values()]

  const result = new Map<string, ProjectDataTypeDef>()
  let current: ProjectDataTypeDef | null = null

  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/[\u200B\u200C\u200D\u2060]/g, '').trim()
    if (!line || line.startsWith("'")) continue

    if (line.startsWith('.数据类型 ')) {
      const parts = splitDeclParts(line.substring(5))
      const name = (parts[0] || '').trim()
      if (!name) {
        current = null
        continue
      }
      current = result.get(name) || { name, fields: [] }
      result.set(name, current)
      continue
    }

    if (line.startsWith('.成员 ') && current) {
      const parts = splitDeclParts(line.substring(3))
      const fieldName = (parts[0] || '').trim()
      const fieldType = (parts[1] || '整数型').trim()
      if (fieldName) current.fields.push({ name: fieldName, type: fieldType })
      continue
    }

    if (line.startsWith('.子程序 ') || line.startsWith('.程序集 ') || line.startsWith('.DLL命令 ') || line.startsWith('.指针命令 ')) {
      current = null
    }
  }

  return [...result.values()]
}

function collectProjectDataTypes(project: ProjectInfo, editorFiles?: Map<string, string>): ProjectDataTypeDef[] {
  const result = new Map<string, ProjectDataTypeDef>()

  for (const f of project.files) {
    if (f.type !== 'EDT' && f.type !== 'EYC' && f.type !== 'EGV' && f.type !== 'ECS' && f.type !== 'ELL') continue
    const sourcePath = join(project.projectDir, f.fileName)
    const editorContent = editorFiles?.get(f.fileName)
    const content = editorContent || (existsSync(sourcePath) ? readFileSync(sourcePath, 'utf-8') : '')
    if (!content) continue

    for (const dt of parseProjectDataTypes(content)) {
      if (!result.has(dt.name)) result.set(dt.name, dt)
    }
  }

  return [...result.values()]
}

function parseProjectDllCommands(content: string): ProjectDllCommandDef[] {
  const result = new Map<string, ProjectDllCommandDef>()
  let current: ProjectDllCommandDef | null = null

  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/[\u200B\u200C\u200D\u2060]/g, '').trim()
    if (!line || line.startsWith("'")) continue

    if (line.startsWith('.DLL命令 ')) {
      const parts = splitDeclParts(line.substring('.DLL命令 '.length))
      const name = (parts[0] || '').trim()
      if (!name) {
        current = null
        continue
      }

      const existing = result.get(name)
      if (existing) {
        current = existing
      } else {
        current = {
          name,
          returnType: (parts[1] || '').trim(),
          dllFileName: unquoteDeclValue(parts[2] || ''),
          entryName: unquoteDeclValue(parts[3] || '') || name,
          params: [],
        }
        result.set(name, current)
      }
      continue
    }

    if (line.startsWith('.指针命令 ')) {
      const parts = splitDeclParts(line.substring('.指针命令 '.length))
      const name = (parts[0] || '').trim()
      if (!name) {
        current = null
        continue
      }

      const existing = result.get(name)
      if (existing) {
        current = existing
      } else {
        current = {
          name,
          returnType: (parts[1] || '').trim(),
          dllFileName: '',
          entryName: name,
          params: [],
          isIndirect: true,
        }
        result.set(name, current)
      }
      continue
    }

    if (line.startsWith('.子程序 ') || line.startsWith('.程序集 ')) {
      current = null
      continue
    }

    if (line.startsWith('.参数 ') && current) {
      const parts = splitDeclParts(line.substring('.参数 '.length))
      current.params.push({
        name: (parts[0] || '').trim(),
        type: (parts[1] || '整数型').trim(),
        isByRef: parts.includes('传址'),
        isArray: parts.includes('数组'),
        optional: parts.includes('可空'),
      })
    }
  }

  return [...result.values()]
}

function collectProjectDllCommands(project: ProjectInfo, editorFiles?: Map<string, string>): ProjectDllCommandDef[] {
  const result = new Map<string, ProjectDllCommandDef>()

  for (const f of project.files) {
    if (f.type !== 'ELL' && !/\.ell$/i.test(f.fileName)) continue
    const sourcePath = join(project.projectDir, f.fileName)
    const editorContent = editorFiles?.get(f.fileName)
    const content = editorContent || (existsSync(sourcePath) ? readFileSync(sourcePath, 'utf-8') : '')
    if (!content) continue

    for (const dllCmd of parseProjectDllCommands(content)) {
      if (!result.has(dllCmd.name)) result.set(dllCmd.name, dllCmd)
    }
  }

  return [...result.values()]
}

function collectProjectSubprogramNames(project: ProjectInfo, editorFiles?: Map<string, string>): Set<string> {
  return new Set(collectProjectSubprogramDefs(project, editorFiles).map(sub => sub.name))
}

function buildProjectCompileMetadataFingerprint(project: ProjectInfo, editorFiles?: Map<string, string>): string {
  const relevant = project.files.filter(f =>
    f.type === 'EYC'
    || f.type === 'EGV'
    || f.type === 'ECS'
    || f.type === 'EDT'
    || f.type === 'ELL'
    || f.type === 'ERC'
    || /\.(eyc|ecc|egv|ecs|edt|ell|erc)$/i.test(f.fileName),
  )

  const fileStamps = relevant
    .map((f) => {
      const inMemory = editorFiles?.get(f.fileName)
      if (inMemory !== undefined) {
        const memHash = createHash('sha1').update(inMemory).digest('hex')
        return `${f.fileName}|mem|${memHash}`
      }
      const sourcePath = join(project.projectDir, f.fileName)
      try {
        const st = statSync(sourcePath)
        return `${f.fileName}|disk|${st.size}|${Math.round(st.mtimeMs)}`
      } catch {
        return `${f.fileName}|missing`
      }
    })
    .sort()

  return createHash('sha1').update(JSON.stringify({
    projectDir: project.projectDir,
    projectName: project.projectName,
    outputType: project.outputType,
    fileStamps,
  })).digest('hex')
}

function resolveProjectCompileMetadata(project: ProjectInfo, editorFiles?: Map<string, string>): ProjectCompileMetadata {
  const fingerprint = buildProjectCompileMetadataFingerprint(project, editorFiles)
  compileLogMark('元数据: 计算项目指纹')
  if (projectCompileMetadataCache && projectCompileMetadataCache.fingerprint === fingerprint) {
    compileLogMark('元数据: 命中缓存，直接复用')
    return projectCompileMetadataCache.metadata
  }

  const globals = collectProjectGlobalVars(project, editorFiles)
  compileLogMark('元数据: 收集全局变量')
  const constants = collectProjectConstants(project, editorFiles)
  compileLogMark('元数据: 收集常量')
  const resources = collectProjectResourceEntries(project, editorFiles)
  compileLogMark('元数据: 收集资源')
  const subprograms = collectProjectSubprogramDefs(project, editorFiles)
  compileLogMark('元数据: 收集子程序')
  const dataTypes = collectProjectDataTypes(project, editorFiles)
  compileLogMark('元数据: 收集数据类型')
  const dllCommands = collectProjectDllCommands(project, editorFiles)
  compileLogMark('元数据: 收集DLL/命令声明')
  const classModules = collectProjectClassModules(project, editorFiles)
  compileLogMark('元数据: 收集类模块')

  const metadata: ProjectCompileMetadata = {
    globals, constants, resources, subprograms, dataTypes, dllCommands, classModules,
  }
  projectCompileMetadataCache = { fingerprint, metadata }
  return metadata
}

function validateProjectCommandSignatures(project: ProjectInfo, editorFiles?: Map<string, string>, targetPlatform?: TargetPlatform): string[] {
  const errors: string[] = []
  const commandMap = buildCommandSignatureMap(collectProjectDllCommands(project, editorFiles), targetPlatform)
  compileLogMark('  校验签名: buildCommandSignatureMap(含getAllCommands)')
  const subprogramNames = collectProjectSubprogramNames(project, editorFiles)
  const protocols = loadCompileProtocols()
  compileLogMark('  校验签名: 收集子程序名/协议')

  const validateOne = (fileName: string, lineNo: number, call: { name: string; args: string[] } | null): void => {
    if (!call?.name) return

    const command = commandMap.get(call.name)
    if (!command) return

    const args = call.args || []
    const maxParams = command.params.length
    const minParams = command.params.filter(p => !p.optional).length
    const hasRepeatableTail = command.params.length > 0 && !!command.params[command.params.length - 1].repeatable
    const tooManyArgs = hasRepeatableTail ? false : args.length > maxParams
    if (args.length < minParams || tooManyArgs) {
      const expected = minParams === maxParams ? `${maxParams}` : `${minParams}-${maxParams}`
      const expectedText = hasRepeatableTail ? `${expected}+` : expected
      errors.push(`错误: ${fileName}:${lineNo} 命令「${command.name}」参数数量不匹配，期望 ${expectedText} 个，实际 ${args.length} 个`)
      return
    }

    // ycmd 命令只在“无任何后端路径”时才报错：
    // 1) 协议映射（window-units / protocol）
    // 2) 内建命令代码生成器
    // 3) 内建表达式生成器
    // 4) 同名子程序（用户自定义）
    if (command.source === 'ycmd' && !subprogramNames.has(call.name)) {
      const protocolCode = resolveCommandByProtocol(
        protocols.commands,
        command.libraryFileName,
        command.name,
        command.englishName,
        args,
      )
      const protocolExpr = resolveCommandExprByProtocol(
        protocols.commands,
        command.libraryFileName,
        command.name,
        command.englishName,
        args,
      )
      const hasBackendPath = isYcmdNativeCommand(command as ResolvedCommand) || !!protocolCode || !!protocolExpr || !!COMMAND_CODE_GENERATORS[command.name] || !!COMMAND_EXPR_GENERATORS[command.name]
      if (!hasBackendPath) {
        const detail = command.manifestPath ? `（清单: ${command.manifestPath}）` : ''
        errors.push(`错误: ${fileName}:${lineNo} 命令「${command.name}」来自 ycmd，但当前命令尚未接入后端实现${detail}`)
      }
    }
  }

  for (const f of project.files) {
    if (f.type !== 'EYC' && f.type !== 'EGV' && f.type !== 'ECS' && f.type !== 'EDT' && f.type !== 'ELL') continue
    const sourcePath = join(project.projectDir, f.fileName)
    const editorContent = editorFiles?.get(f.fileName)
    const content = editorContent || (existsSync(sourcePath) ? readFileSync(sourcePath, 'utf-8') : '')
    if (!content) continue

    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1
      const line = lines[i].replace(/[\u200B\u200C\u200D\u2060]/g, '').trim()
      if (!line || line.startsWith("'")) continue

      if (
        line.startsWith('.版本') ||
        line.startsWith('.程序集') ||
        line.startsWith('.参数 ') ||
        line.startsWith('.全局变量 ') ||
        line.startsWith('.局部变量 ') ||
        line.startsWith('.常量 ') ||
        line.startsWith('.数据类型 ') ||
        line.startsWith('.成员 ') ||
        line.startsWith('.支持库 ') ||
        line.startsWith('.DLL命令 ') ||
        line.startsWith('.指针命令 ') ||
        line.startsWith('.子程序 ')
      ) {
        continue
      }

      const assignMatch = line.match(/^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*\s*[＝=]\s*(.+)$/)
      if (assignMatch) {
        validateOne(f.fileName, lineNo, parseCommandCall(assignMatch[1].trim()))
      }

      const callableLine = line.startsWith('.') ? line.substring(1).trim() : line
      if (!callableLine) continue
      validateOne(f.fileName, lineNo, parseCommandCall(callableLine))
    }
  }

  return errors
}

// 将全角运算符转换为C运算符
function convertFullWidthOps(expr: string): string {
  return expr
    .replace(/<>/g, '!=')
    .replace(/≠/g, '!=')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/＝/g, '==')
    .replace(/＜/g, '<')
    .replace(/＞/g, '>')
    .replace(/＋/g, '+')
    .replace(/－/g, '-')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/％/g, '%')
}

function replaceConstantRefs(expr: string): string {
  return expr.replace(/#([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*)/g, '$1')
}

function replaceBooleanLiterals(expr: string): string {
  return expr
    .replace(/(^|[^\u4e00-\u9fa5A-Za-z0-9_])真(?=$|[^\u4e00-\u9fa5A-Za-z0-9_])/g, '$11')
    .replace(/(^|[^\u4e00-\u9fa5A-Za-z0-9_])假(?=$|[^\u4e00-\u9fa5A-Za-z0-9_])/g, '$10')
}

function replaceLogicalOperatorAliases(expr: string): string {
  return expr
    .replace(/(^|[^\u4e00-\u9fa5A-Za-z0-9_])且(?=$|[^\u4e00-\u9fa5A-Za-z0-9_])/g, '$1&&')
    .replace(/(^|[^\u4e00-\u9fa5A-Za-z0-9_])或(?=$|[^\u4e00-\u9fa5A-Za-z0-9_])/g, '$1||')
    .replace(/\bAnd\b/gi, '&&')
    .replace(/\bOr\b/gi, '||')
}

function replaceControlTextPropertyRefs(expr: string): string {
  return expr.replace(
    /([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_]*)\.(内容|文本|标题|text)(?![\u4e00-\u9fa5A-Za-z0-9_])/gi,
    (_match, ctrlName: string) => `yc_get_control_text(L"${escapeCString(ctrlName)}")`,
  )
}

function isTextExpression(expr: string): boolean {
  const trimmed = expr.trim()
  return /^L"(?:[^"\\]|\\.)*"$/.test(trimmed)
    || /^yc_get_control_text\(/.test(trimmed)
    || /^yc_text_concat\(/.test(trimmed)
    || /^yc_utf8_to_wide\(/.test(trimmed)
    || /^\(\[\&\]\(\)\s*->\s*wchar_t\*/.test(trimmed)
    || /^yc_fs_get_current_dir\(/.test(trimmed)
    || /^yc_fs_get_disk_label\(/.test(trimmed)
    || /^yc_fs_get_temp_file_name\(/.test(trimmed)
    || /^yc_fs_dir\(/.test(trimmed)
}

function isTextLiteralExpression(expr: string): boolean {
  return /^L"(?:[^"\\]|\\.)*"$/.test((expr || '').trim())
}

function isBigExpression(expr: string): boolean {
  const trimmed = expr.trim()
  return /^YC_BIG\(/.test(trimmed)
}

type VariableTypeResolver = (name: string) => string | undefined

function getExprSimpleIdentifierType(expr: string, variableTypeResolver?: VariableTypeResolver): string {
  if (!variableTypeResolver) return ''
  const trimmed = (expr || '').trim()
  if (!trimmed) return ''
  const identMatch = trimmed.match(/^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*$/)
  if (!identMatch) return ''
  const baseName = trimmed.split('.')[0] || ''
  return (variableTypeResolver(baseName) || '').trim()
}

function isTextRawOperand(expr: string, variableTypeResolver?: VariableTypeResolver): boolean {
  const dataType = getExprSimpleIdentifierType(expr, variableTypeResolver)
  return dataType === '文本型'
}

function isBigRawOperand(expr: string, variableTypeResolver?: VariableTypeResolver): boolean {
  const dataType = getExprSimpleIdentifierType(expr, variableTypeResolver)
  return dataType === '大整数型' || dataType === '大数'
}

function normalizeBuiltinCallName(name: string): string {
  return (name || '').trim().toLowerCase()
}

function findTopLevelComparison(expr: string): { left: string; operator: string; right: string } | null {
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (inString) {
      if ((stringChar === '"' && ch === '"') || (stringChar === '\u201c' && ch === '\u201d')) inString = false
      continue
    }
    if (ch === '"' || ch === '\u201c') {
      inString = true
      stringChar = ch
      continue
    }
    if (ch === '(' || ch === '\uff08') {
      depth++
      continue
    }
    if (ch === ')' || ch === '\uff09') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth !== 0) continue

    const twoChars = expr.slice(i, i + 2)
    if (twoChars === '==' || twoChars === '!=' || twoChars === '<=' || twoChars === '>=') {
      return {
        left: expr.slice(0, i).trim(),
        operator: twoChars,
        right: expr.slice(i + 2).trim(),
      }
    }

    if (ch === '=' || ch === '<' || ch === '>') {
      return {
        left: expr.slice(0, i).trim(),
        operator: ch,
        right: expr.slice(i + 1).trim(),
      }
    }
  }

  return null
}

function findTopLevelAdditive(expr: string): { left: string; operator: string; right: string } | null {
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = expr.length - 1; i >= 0; i--) {
    const ch = expr[i]
    if (inString) {
      if ((stringChar === '"' && ch === '"') || (stringChar === '\u201c' && ch === '\u201c')) inString = false
      continue
    }
    if (ch === '"' || ch === '\u201d') {
      inString = true
      stringChar = ch === '\u201d' ? '\u201c' : ch
      continue
    }
    if (ch === ')' || ch === '\uff09') {
      depth++
      continue
    }
    if (ch === '(' || ch === '\uff08') {
      depth--
      continue
    }
    if (depth !== 0) continue
    if (ch !== '+' && ch !== '-') continue

    let j = i - 1
    while (j >= 0 && /\s/.test(expr[j])) j--
    const prev = j >= 0 ? expr[j] : ''
    if (!prev || /[+\-*/%(<>=!&|,]/.test(prev)) continue

    return {
      left: expr.slice(0, i).trim(),
      operator: ch,
      right: expr.slice(i + 1).trim(),
    }
  }

  return null
}

function findTopLevelMultiplicative(expr: string): { left: string; operator: string; right: string } | null {
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = expr.length - 1; i >= 0; i--) {
    const ch = expr[i]
    if (inString) {
      if ((stringChar === '"' && ch === '"') || (stringChar === '\u201c' && ch === '\u201c')) inString = false
      continue
    }
    if (ch === '"' || ch === '\u201d') {
      inString = true
      stringChar = ch === '\u201d' ? '\u201c' : ch
      continue
    }
    if (ch === ')' || ch === '\uff09') {
      depth++
      continue
    }
    if (ch === '(' || ch === '\uff08') {
      depth--
      continue
    }
    if (depth !== 0) continue
    if (ch !== '*' && ch !== '/' && ch !== '%') continue

    return {
      left: expr.slice(0, i).trim(),
      operator: ch,
      right: expr.slice(i + 1).trim(),
    }
  }

  return null
}

function translateExpressionToC(
  expr: string,
  commandMap?: Map<string, ResolvedCommand>,
  directCallables?: DirectCallableNames,
  variableTypeResolver?: VariableTypeResolver,
  preferBigIntLiteral = false,
): string {
  const trimmed = (expr || '').trim()
  if (!trimmed) return '0'

  const chineseStrMatch = trimmed.match(/^\u201c(.*)\u201d$/)
  if (chineseStrMatch) {
    const content = chineseStrMatch[1].replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return `L"${content}"`
  }

  const englishStrMatch = trimmed.match(/^"(.*)"$/)
  if (englishStrMatch) {
    const content = englishStrMatch[1].replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return `L"${content}"`
  }

  if (trimmed === '真') return '1'
  if (trimmed === '假') return '0'
  if (/^-?\d+$/.test(trimmed)) {
    try {
      const value = BigInt(trimmed)
      const max = BigInt('9223372036854775807')
      const min = BigInt('-9223372036854775808')
      if (value > max || value < min) {
        if (preferBigIntLiteral) {
          return `YC_BIG(L"${trimmed}")`
        }
        if (value > max) return '9223372036854775807LL'
        return '-9223372036854775807LL - 1'
      }
      return `${trimmed}LL`
    } catch {
      return '0'
    }
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) return trimmed

  if (commandMap) {
    const call = parseCommandCall(trimmed)
    if (call && call.name) {
      const builtinName = normalizeBuiltinCallName(call.name)
      if (builtinName === '到文本') {
        const src = translateExpressionToC(
          call.args?.[0] || '0',
          commandMap,
          directCallables,
          variableTypeResolver,
          preferBigIntLiteral,
        )
        return `yc_value_to_text(${src})`
      }
      if (builtinName === '到数值') {
        const src = translateExpressionToC(
          call.args?.[0] || '0',
          commandMap,
          directCallables,
          variableTypeResolver,
          preferBigIntLiteral,
        )
        if (preferBigIntLiteral) {
          return `yc_value_to_big(${src})`
        }
      }

      const resolved = commandMap.get(call.name)
      if (resolved) {
        if (isYcmdNativeCommand(resolved)) {
          return generateYcmdNativeCommandExpr(resolved, call.args || [], commandMap, directCallables)
        }
        const protocols = loadCompileProtocols()
        const protocolExpr = resolveCommandExprByProtocol(
          protocols.commands,
          resolved.libraryFileName,
          resolved.name,
          resolved.englishName,
          call.args || [],
          commandMap,
          directCallables,
        )
        if (protocolExpr) return protocolExpr
        const exprGenerator = COMMAND_EXPR_GENERATORS[resolved.name]
        if (exprGenerator) return exprGenerator(call.args || [], commandMap, directCallables)
        return generateYcGenericCommandExpr(resolved, call.args || [])
      }
      if (directCallables?.has(call.name)) {
        return `${call.name}(${(call.args || []).map(arg => translateExpressionToC(arg, commandMap, directCallables, variableTypeResolver, preferBigIntLiteral)).join(', ')})`
      }
    }
  }

  let translated = replaceConstantRefs(convertFullWidthOps(trimmed))
  translated = replaceBooleanLiterals(translated)
  translated = replaceLogicalOperatorAliases(translated)
  translated = replaceControlTextPropertyRefs(translated)

  const comparison = findTopLevelComparison(translated)
  if (comparison && comparison.left && comparison.right) {
    const left = translateExpressionToC(comparison.left, commandMap, directCallables, variableTypeResolver, preferBigIntLiteral)
    const right = translateExpressionToC(comparison.right, commandMap, directCallables, variableTypeResolver, preferBigIntLiteral)
    const normalizedOperator = comparison.operator === '=' ? '==' : comparison.operator
    const leftIsBig = isBigExpression(left) || isBigRawOperand(comparison.left, variableTypeResolver)
    const rightIsBig = isBigExpression(right) || isBigRawOperand(comparison.right, variableTypeResolver)

    if (
      (normalizedOperator === '==' || normalizedOperator === '!=')
      && !(leftIsBig || rightIsBig)
      && (
        isTextExpression(left)
        || isTextExpression(right)
        || isTextRawOperand(comparison.left, variableTypeResolver)
        || isTextRawOperand(comparison.right, variableTypeResolver)
      )
    ) {
      return `(yc_text_compare(${left}, ${right}) ${normalizedOperator} 0)`
    }

    if (leftIsBig || rightIsBig) {
      return `(yc_value_to_big(${left}) ${normalizedOperator} yc_value_to_big(${right}))`
    }

    return `(${left} ${normalizedOperator} ${right})`
  }

  const additive = findTopLevelAdditive(translated)
  if (additive && additive.left && additive.right) {
    const left = translateExpressionToC(additive.left, commandMap, directCallables, variableTypeResolver, preferBigIntLiteral)
    const right = translateExpressionToC(additive.right, commandMap, directCallables, variableTypeResolver, preferBigIntLiteral)
    const leftIsBig = isBigExpression(left) || isBigRawOperand(additive.left, variableTypeResolver)
    const rightIsBig = isBigExpression(right) || isBigRawOperand(additive.right, variableTypeResolver)
    if (
      additive.operator === '+'
      && !(leftIsBig || rightIsBig)
      && (
        isTextExpression(left)
        || isTextExpression(right)
        || isTextRawOperand(additive.left, variableTypeResolver)
        || isTextRawOperand(additive.right, variableTypeResolver)
      )
    ) {
      return `yc_text_concat(${left}, ${right})`
    }
    return `(${left} ${additive.operator} ${right})`
  }

  const multiplicative = findTopLevelMultiplicative(translated)
  if (multiplicative && multiplicative.left && multiplicative.right) {
    const left = translateExpressionToC(multiplicative.left, commandMap, directCallables, variableTypeResolver, preferBigIntLiteral)
    const right = translateExpressionToC(multiplicative.right, commandMap, directCallables, variableTypeResolver, preferBigIntLiteral)
    const leftIsBig = isBigExpression(left) || isBigRawOperand(multiplicative.left, variableTypeResolver)
    const rightIsBig = isBigExpression(right) || isBigRawOperand(multiplicative.right, variableTypeResolver)
    if (leftIsBig || rightIsBig) {
      if (multiplicative.operator === '%') {
        return `yc_big_mod(yc_value_to_big(${left}), yc_value_to_big(${right}))`
      }
      return `(yc_value_to_big(${left}) ${multiplicative.operator} yc_value_to_big(${right}))`
    }
    return `(${left} ${multiplicative.operator} ${right})`
  }

  return translated
}

function buildComparisonExpression(leftArg: string, rightArg: string, operator: '==' | '!=' | '<' | '>' | '<=' | '>=', commandMap?: Map<string, ResolvedCommand>, directCallables?: DirectCallableNames): string {
  const left = translateExpressionToC(leftArg, commandMap, directCallables)
  const right = translateExpressionToC(rightArg, commandMap, directCallables)
  if (isTextExpression(left) || isTextExpression(right)) {
    return `(yc_text_compare(${left}, ${right}) ${operator} 0)`
  }
  return `(${left} ${operator} ${right})`
}

function buildLogicChainExpression(args: string[], operator: '&&' | '||', commandMap?: Map<string, ResolvedCommand>, directCallables?: DirectCallableNames): string {
  const parts = args
    .map(arg => (arg || '').trim())
    .filter(Boolean)
    .map(arg => `(${translateExpressionToC(arg, commandMap, directCallables)})`)
  if (parts.length === 0) return '0'
  if (parts.length === 1) return parts[0]
  return `(${parts.join(` ${operator} `)})`
}

// 从行中提取命令名称（括号或空格之前的部分）
function extractCommandName(line: string): string {
  let end = line.length
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === ' ' || ch === '(' || ch === '\uff08' || ch === '\t') {
      end = i
      break
    }
  }
  return line.substring(0, end)
}

// 解析命令调用行，提取名称和参数
function parseCommandCall(line: string): { name: string; args: string[] } | null {
  const trimmed = line.trim()
  // 查找第一个括号（中文或英文）
  let openIdx = -1
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '(' || ch === '\uff08') {
      openIdx = i
      break
    }
  }

  if (openIdx < 0) {
    // 没有括号 - 无参数的命令调用
    return { name: trimmed, args: [] }
  }

  const name = trimmed.substring(0, openIdx).trim()
  if (!name) return null

  // 查找匹配的右括号
  let depth = 1
  let closeIdx = -1
  for (let i = openIdx + 1; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '(' || ch === '\uff08') depth++
    else if (ch === ')' || ch === '\uff09') {
      depth--
      if (depth === 0) { closeIdx = i; break }
    }
  }

  if (closeIdx < 0) return null

  const trailing = trimmed.substring(closeIdx + 1).trim()
  if (trailing) return null

  const argsStr = trimmed.substring(openIdx + 1, closeIdx)
  const args = splitArguments(argsStr)
  return { name, args }
}

// 分割参数列表（处理嵌套括号和字符串字面量）
function splitArguments(argsStr: string): string[] {
  const args: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i]
    if (inString) {
      current += ch
      if ((stringChar === '"' && ch === '"') || (stringChar === '\u201c' && ch === '\u201d')) {
        inString = false
      }
      continue
    }
    if (ch === '"' || ch === '\u201c') {
      inString = true
      stringChar = ch
      current += ch
      continue
    }
    if (ch === '(' || ch === '\uff08') { depth++; current += ch; continue }
    if (ch === ')' || ch === '\uff09') { depth--; current += ch; continue }

    if ((ch === ',' || ch === '\uff0c') && depth === 0) {
      args.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }

  if (current.trim()) args.push(current.trim())
  return args
}

// 将易语言参数格式化为C语言参数
type ResolvedCommand = LibCommand & { libraryName: string; libraryFileName: string }
type DirectCallableNames = Set<string>

function getYcmdNativeSymbol(cmd: ResolvedCommand): string {
  return cmd.nativeSymbol || ycmdCommandIdToNativeSymbol(cmd.englishName || cmd.name || '')
}

function isYcmdNativeCommand(cmd: ResolvedCommand): boolean {
  return cmd.source === 'ycmd' && !!getYcmdNativeSymbol(cmd)
}

function mapYcmdNativeParamType(typeName: string): { cType: string; expr: (arg: string, commandMap?: Map<string, ResolvedCommand>, directCallables?: DirectCallableNames) => string } {
  const normalizedType = (typeName || '').trim()
  if (normalizedType === '通用型' || normalizedType.includes('通用') || normalizedType.includes('閫氱敤')) {
    return { cType: 'const char*', expr: (arg, commandMap, directCallables) => (arg ? `yc_wide_to_utf8(yc_value_to_text(${formatArgForC(arg, commandMap, directCallables)}))` : '(const char*)""') }
  }
  const cType = mapTypeToCType(typeName || '')
  if (cType === 'wchar_t*') {
    return { cType: 'const char*', expr: (arg, commandMap, directCallables) => (arg ? `yc_wide_to_utf8(${formatArgForC(arg, commandMap, directCallables)})` : '(const char*)""') }
  }
  if (cType === 'YC_BIN') {
    return { cType: 'const char*', expr: (arg, commandMap, directCallables) => (arg ? `yc_bin_to_cstr(${formatArgForC(arg, commandMap, directCallables)})` : '(const char*)""') }
  }
  if (cType === 'YC_BIG') {
    return { cType: 'long long', expr: (arg, commandMap, directCallables) => `(long long)(${formatArgForC(arg, commandMap, directCallables)})` }
  }
  return { cType, expr: (arg, commandMap, directCallables) => formatArgForC(arg, commandMap, directCallables) }
}

function mapYcmdNativeReturnType(typeName: string): { cType: string; expr: (callExpr: string) => string; isVoid: boolean } {
  const trimmed = (typeName || '').trim()
  if (!trimmed || trimmed === '无返回值' || trimmed === 'void') {
    return { cType: 'void', expr: callExpr => callExpr, isVoid: true }
  }
  const cType = mapTypeToCType(trimmed)
  if (cType === 'wchar_t*') {
    return { cType: 'const char*', expr: callExpr => `yc_utf8_to_wide(${callExpr})`, isVoid: false }
  }
  if (cType === 'YC_BIN') {
    return { cType: 'const char*', expr: callExpr => `yc_cstr_to_bin(${callExpr})`, isVoid: false }
  }
  if (cType === 'YC_BIG') {
    return { cType: 'long long', expr: callExpr => `YC_BIG(std::to_wstring((long long)(${callExpr})).c_str())`, isVoid: false }
  }
  return { cType, expr: callExpr => callExpr, isVoid: false }
}

function buildYcmdNativeSignature(cmd: ResolvedCommand): { symbol: string; returnType: ReturnType<typeof mapYcmdNativeReturnType>; params: ReturnType<typeof mapYcmdNativeParamType>[] } {
  return {
    symbol: getYcmdNativeSymbol(cmd),
    returnType: mapYcmdNativeReturnType(cmd.returnType || ''),
    params: (cmd.params || []).map(p => mapYcmdNativeParamType(p.type || '')),
  }
}

function generateYcmdNativeCommandExpr(cmd: ResolvedCommand, args: string[], commandMap?: Map<string, ResolvedCommand>, directCallables?: DirectCallableNames): string {
  const sig = buildYcmdNativeSignature(cmd)
  const argCount = Math.max(args.length, sig.params.length)
  const callArgs = Array.from({ length: argCount }, (_unused, index) => {
    const param = sig.params[index] || sig.params[sig.params.length - 1] || mapYcmdNativeParamType('')
    const arg = args[index] || ''
    return param.expr(arg, commandMap, directCallables)
  })
  const callExpr = `${sig.symbol}(${callArgs.join(', ')})`
  if (sig.returnType.isVoid) {
    return `([&]() -> int { ${callExpr}; return 0; })()`
  }
  return `([&]() -> ${mapTypeToCType(cmd.returnType || '整数型')} { return ${sig.returnType.expr(callExpr)}; })()`
}

function generateYcmdNativeCommandCall(cmd: ResolvedCommand, args: string[], commandMap?: Map<string, ResolvedCommand>, directCallables?: DirectCallableNames): string {
  const sig = buildYcmdNativeSignature(cmd)
  const argCount = Math.max(args.length, sig.params.length)
  const callArgs = Array.from({ length: argCount }, (_unused, index) => {
    const param = sig.params[index] || sig.params[sig.params.length - 1] || mapYcmdNativeParamType('')
    const arg = args[index] || ''
    return param.expr(arg, commandMap, directCallables)
  })
  return `{ (void)${sig.symbol}(${callArgs.join(', ')}); }`
}

function generateYcmdNativeDeclarations(targetPlatform: TargetPlatform): string {
  const declarations: string[] = []
  const seen = new Set<string>()
  for (const cmd of buildCommandMap(targetPlatform).values()) {
    if (!isYcmdNativeCommand(cmd)) continue
    const sig = buildYcmdNativeSignature(cmd)
    if (seen.has(sig.symbol)) continue
    seen.add(sig.symbol)
    const paramTypes = sig.params.map(p => p.cType).join(', ')
    declarations.push(`extern "C" ${sig.returnType.cType} ${sig.symbol}(${paramTypes});`)
  }
  return declarations.length > 0 ? `${declarations.join('\n')}\n\n` : ''
}

function generateYcGenericCommandExpr(cmd: ResolvedCommand, args: string[]): string {
  const n = args.length
  const lines: string[] = []
  lines.push(`([&]() -> ${mapTypeToCType(cmd.returnType || '整数型')} {`)
  lines.push('YC_MDATA_INF __yc_ret = {};')
  if (n > 0) {
    lines.push(`YC_MDATA_INF __yc_args[${n}] = {};`)
    for (let i = 0; i < n; i++) {
      const p = resolveYcCommandParamSpec(cmd.params, i)
      const mapped = mapParamTypeToYcDataType(p?.type || '')
      const valueExpr = formatArgForYcCommand(args[i], mapped.field)
      lines.push(`__yc_args[${i}].m_dtDataType = ${mapped.dtConst};`)
      lines.push(`__yc_args[${i}].${mapped.field} = ${valueExpr};`)
    }
  }
  const libNameEscaped = (cmd.libraryFileName || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  lines.push(`yc_invoke_support_cmd("${libNameEscaped}", ${cmd.commandIndex}, &__yc_ret, ${n}, ${n > 0 ? '__yc_args' : 'NULL'});`)
  const retMapped = mapReturnTypeToYcField(cmd.returnType || '')
  lines.push(`return ${retMapped.expr};`)
  lines.push('})()')
  return lines.join(' ')
}

function formatArgForC(arg: string, commandMap?: Map<string, ResolvedCommand>, directCallables?: DirectCallableNames): string {
  if (!arg) return '0'
  return translateExpressionToC(arg, commandMap, directCallables)
}

function wrapConditionForC(expr: string): string {
  const trimmed = (expr || '').trim()
  if (!trimmed) return '(0)'
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) return trimmed
  return `(${trimmed})`
}

function formatOptionalTextArgForC(arg: string | undefined, commandMap?: Map<string, ResolvedCommand>, directCallables?: DirectCallableNames): string {
  const trimmed = (arg || '').trim()
  if (!trimmed) return 'NULL'
  return formatArgForC(trimmed, commandMap, directCallables)
}

function mapParamTypeToYcDataType(typeName: string): { dtConst: string; field: string } {
  switch (typeName) {
    case '字节型': return { dtConst: 'YC_SDT_BYTE', field: 'm_byte' }
    case '短整数型': return { dtConst: 'YC_SDT_SHORT', field: 'm_short' }
    case '整数型': return { dtConst: 'YC_SDT_INT', field: 'm_int' }
    case '长整数型': return { dtConst: 'YC_SDT_INT64', field: 'm_int64' }
    case '小数型': return { dtConst: 'YC_SDT_FLOAT', field: 'm_float' }
    case '双精度小数型': return { dtConst: 'YC_SDT_DOUBLE', field: 'm_double' }
    case '逻辑型': return { dtConst: 'YC_SDT_BOOL', field: 'm_bool' }
    case '文本型': return { dtConst: 'YC_SDT_TEXT', field: 'm_pText' }
    default: return { dtConst: 'YC_SDT_INT', field: 'm_int' }
  }
}

function formatArgForYcCommand(arg: string, field: string): string {
  const trimmed = (arg || '').trim()
  if (!trimmed) return field === 'm_pText' ? '(char*)""' : '0'

  if (field === 'm_pText') {
    const quoted = trimmed.match(/^\u201c(.*)\u201d$/) || trimmed.match(/^"(.*)"$/)
    if (quoted) {
      const content = quoted[1].replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      return `(char*)"${content}"`
    }
    return `(char*)(${replaceConstantRefs(convertFullWidthOps(trimmed))})`
  }

  if (field === 'm_bool') {
    if (trimmed === '真') return '1'
    if (trimmed === '假') return '0'
    return `(${translateExpressionToC(trimmed, buildCommandMap())} ? 1 : 0)`
  }

  return replaceConstantRefs(convertFullWidthOps(trimmed))
}

function mapReturnTypeToYcField(typeName: string): { field: string; expr: string } {
  switch (typeName) {
    case '字节型': return { field: 'm_byte', expr: '__yc_ret.m_byte' }
    case '短整数型': return { field: 'm_short', expr: '__yc_ret.m_short' }
    case '整数型': return { field: 'm_int', expr: '__yc_ret.m_int' }
    case '长整数型': return { field: 'm_int64', expr: '__yc_ret.m_int64' }
    case '小数型': return { field: 'm_float', expr: '__yc_ret.m_float' }
    case '双精度小数型': return { field: 'm_double', expr: '__yc_ret.m_double' }
    case '逻辑型': return { field: 'm_bool', expr: '(__yc_ret.m_bool ? 1 : 0)' }
    case '文本型': return { field: 'm_pText', expr: 'yc_utf8_to_wide(__yc_ret.m_pText)' }
    default: return { field: 'm_int', expr: '__yc_ret.m_int' }
  }
}

function generateYcGenericCommandCall(cmd: LibCommand & { libraryName: string; libraryFileName: string }, args: string[]): string {
  if (isYcmdNativeCommand(cmd as ResolvedCommand)) {
    return generateYcmdNativeCommandCall(cmd as ResolvedCommand, args)
  }
  const n = args.length
  const lines: string[] = []
  lines.push('{')
  lines.push('YC_MDATA_INF __yc_ret = {};')
  if (n > 0) {
    lines.push(`YC_MDATA_INF __yc_args[${n}] = {};`)
    for (let i = 0; i < n; i++) {
      const p = resolveYcCommandParamSpec(cmd.params, i)
      const mapped = mapParamTypeToYcDataType(p?.type || '')
      const valueExpr = formatArgForYcCommand(args[i], mapped.field)
      lines.push(`__yc_args[${i}].m_dtDataType = ${mapped.dtConst};`)
      lines.push(`__yc_args[${i}].${mapped.field} = ${valueExpr};`)
    }
  }
  const libNameEscaped = (cmd.libraryFileName || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  lines.push(`yc_invoke_support_cmd("${libNameEscaped}", ${cmd.commandIndex}, &__yc_ret, ${n}, ${n > 0 ? '__yc_args' : 'NULL'});`)
  lines.push('}')
  return lines.join(' ')
}

function generateYcGenericCommandAssign(cmd: LibCommand & { libraryName: string; libraryFileName: string }, args: string[], leftExpr: string): string {
  if (isYcmdNativeCommand(cmd as ResolvedCommand)) {
    return `{ ${leftExpr} = ${generateYcmdNativeCommandExpr(cmd as ResolvedCommand, args)}; }`
  }
  const n = args.length
  const lines: string[] = []
  lines.push('{')
  lines.push('YC_MDATA_INF __yc_ret = {};')
  if (n > 0) {
    lines.push(`YC_MDATA_INF __yc_args[${n}] = {};`)
    for (let i = 0; i < n; i++) {
      const p = resolveYcCommandParamSpec(cmd.params, i)
      const mapped = mapParamTypeToYcDataType(p?.type || '')
      const valueExpr = formatArgForYcCommand(args[i], mapped.field)
      lines.push(`__yc_args[${i}].m_dtDataType = ${mapped.dtConst};`)
      lines.push(`__yc_args[${i}].${mapped.field} = ${valueExpr};`)
    }
  }
  const libNameEscaped = (cmd.libraryFileName || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  lines.push(`yc_invoke_support_cmd("${libNameEscaped}", ${cmd.commandIndex}, &__yc_ret, ${n}, ${n > 0 ? '__yc_args' : 'NULL'});`)
  const retMapped = mapReturnTypeToYcField(cmd.returnType || '')
  lines.push(`${leftExpr} = ${retMapped.expr};`)
  lines.push('}')
  return lines.join(' ')
}

function resolveYcCommandParamSpec(
  params: Array<{ type?: string; repeatable?: boolean }> | undefined,
  index: number,
): { type?: string; repeatable?: boolean } | undefined {
  if (!Array.isArray(params) || params.length === 0) return undefined
  if (index >= 0 && index < params.length) return params[index]

  const tail = params[params.length - 1]
  if (tail?.repeatable) return tail
  return undefined
}

const {
  COMMAND_EXPR_GENERATORS,
  COMMAND_CODE_GENERATORS,
  generateCCodeForCommand,
} = createCommandResolvers({
  resolveCommandByProtocol: (protocolBindings, libraryFileName, commandName, commandEnglishName, args) => resolveCommandByProtocol(protocolBindings as NormalizedCommandBinding[], libraryFileName, commandName, commandEnglishName, args),
  resolveCommandExprByProtocol: (protocolBindings, libraryFileName, commandName, commandEnglishName, args, commandMap, directCallables) => resolveCommandExprByProtocol(protocolBindings as NormalizedCommandBinding[], libraryFileName, commandName, commandEnglishName, args, commandMap as Map<string, ResolvedCommand> | undefined, directCallables as DirectCallableNames | undefined),
  loadCompileProtocols,
  generateYcGenericCommandCall: (cmd, args, commandMap, directCallables) => {
    if (isYcmdNativeCommand(cmd as ResolvedCommand)) {
      return generateYcmdNativeCommandCall(cmd as ResolvedCommand, args, commandMap as Map<string, ResolvedCommand> | undefined, directCallables as DirectCallableNames | undefined)
    }
    return generateYcGenericCommandCall(cmd as ResolvedCommand, args)
  },
})

function mapProjectDllTypeToCType(type: string): string {
  const trimmed = (type || '').trim()
  if (!trimmed) return 'void'
  return mapTypeToCType(trimmed)
}

function mapProjectDllProcReturnType(type: string): string {
  const trimmed = (type || '').trim()
  if (trimmed === '文本型') return 'const char*'
  return mapProjectDllTypeToCType(trimmed)
}

function mapProjectDllWrapperParamType(type: string): string {
  const trimmed = (type || '').trim()
  if (trimmed === '字节集') return 'const YC_BIN&'
  return mapProjectDllTypeToCType(trimmed)
}

function mapProjectDllProcParamType(type: string): string {
  const trimmed = (type || '').trim()
  if (trimmed === '字节集') return 'const unsigned char*'
  return mapProjectDllTypeToCType(trimmed)
}

function sanitizeDllSymbolBase(name: string, index: number): string {
  const normalized = (name || '').replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  if (normalized && /^[A-Za-z_]/.test(normalized)) return `${normalized}_${index}`
  return `dll_${index}`
}

function getProjectDllWrapperParamDecl(param: ProjectDllParamDef, index: number): string {
  const paramType = mapProjectDllWrapperParamType(param.type)
  const paramName = (param.name || `arg${index}`).trim() || `arg${index}`
  if (param.isArray) return `${paramType}* ${paramName}`
  if (param.isByRef) return `${paramType}& ${paramName}`
  if (paramType === 'wchar_t*') return `const wchar_t* ${paramName}`
  return `${paramType} ${paramName}`
}

function getProjectDllProcParamDecl(param: ProjectDllParamDef): string {
  const paramType = mapProjectDllProcParamType(param.type)
  if (param.isArray || param.isByRef) return `${paramType}*`
  return paramType
}

function getProjectDllCallArg(param: ProjectDllParamDef, index: number): string {
  const paramType = mapProjectDllTypeToCType(param.type)
  const paramName = (param.name || `arg${index}`).trim() || `arg${index}`
  if ((param.type || '').trim() === '字节集') return `${paramName}.empty() ? NULL : ${paramName}.data()`
  if (param.isArray) return paramName
  if (param.isByRef) return `&${paramName}`
  if (paramType === 'wchar_t*') return `(wchar_t*)${paramName}`
  return paramName
}

function getProjectDllDefaultReturn(type: string): string {
  const cType = mapProjectDllTypeToCType(type)
  if (cType === 'void') return ''
  if (cType === 'wchar_t*') return 'yc_empty_text()'
  return '0'
}

function generateProjectDataTypeStructCode(projectDataTypes: ProjectDataTypeDef[]): string {
  if (projectDataTypes.length === 0) return ''
  let result = '/* 项目自定义数据类型 */\n'
  for (const dataType of projectDataTypes) {
    result += `struct ${dataType.name} {\n`
    if (dataType.fields.length === 0) {
      result += '    int _reserved;\n'
    } else {
      for (const field of dataType.fields) {
        result += `    ${mapTypeToCType(field.type)} ${field.name};\n`
      }
    }
    result += '};\n\n'
  }
  return result
}

function generateProjectDllWrapperCode(projectDllCommands: ProjectDllCommandDef[]): string {
  if (projectDllCommands.length === 0) return ''

  let result = '/* 项目外部 DLL 命令封装 */\n'
  for (let i = 0; i < projectDllCommands.length; i++) {
    const dllCmd = projectDllCommands[i]
    const symbolBase = sanitizeDllSymbolBase(dllCmd.name, i)
    const wrapperReturnType = mapProjectDllTypeToCType(dllCmd.returnType)
    const procReturnType = mapProjectDllProcReturnType(dllCmd.returnType)
    const procParams = dllCmd.params.length > 0 ? dllCmd.params.map(getProjectDllProcParamDecl).join(', ') : 'void'
    const wrapperParams = dllCmd.params.length > 0 ? dllCmd.params.map(getProjectDllWrapperParamDecl).join(', ') : 'void'
    const callArgs = dllCmd.params.map((param, idx) => getProjectDllCallArg(param, idx)).join(', ')
    const dllFileName = escapeCString(dllCmd.dllFileName || '')
    const rawEntryName = dllCmd.entryName || dllCmd.name
    const entryName = escapeCString(rawEntryName.startsWith('@') ? rawEntryName.slice(1) : rawEntryName)
    const defaultReturn = getProjectDllDefaultReturn(dllCmd.returnType)

    if (dllCmd.isIndirect) {
      // 指针命令：第一个实参为函数地址，按声明签名间接调用，无需 LoadLibrary/GetProcAddress
      const indirectWrapperParams = wrapperParams === 'void' ? 'long long __yc_fnptr' : `long long __yc_fnptr, ${wrapperParams}`
      result += `typedef ${procReturnType} (WINAPI *YC_EXT_PFN_${symbolBase})(${procParams});\n`
      result += `static ${wrapperReturnType} ${dllCmd.name}(${indirectWrapperParams}) {\n`
      result += `    YC_EXT_PFN_${symbolBase} __yc_fn = (YC_EXT_PFN_${symbolBase})(intptr_t)__yc_fnptr;\n`
      if (wrapperReturnType === 'void') {
        result += `    if (!__yc_fn) { yc_runtime_report_dll_error(L"指针调用", L"${escapeCString(dllCmd.name)}", "${entryName}", 0); return; }\n`
        result += `    __yc_fn(${callArgs});\n`
      } else {
        result += `    if (!__yc_fn) { yc_runtime_report_dll_error(L"指针调用", L"${escapeCString(dllCmd.name)}", "${entryName}", 0); return ${defaultReturn}; }\n`
        if (wrapperReturnType === 'wchar_t*' && procReturnType === 'const char*') {
          result += `    const char* __yc_ret = __yc_fn(${callArgs});\n`
          result += `    if (!__yc_ret) {\n`
          result += `        yc_runtime_report_dll_text_result(L"${escapeCString(dllCmd.name)}", "${entryName}");\n`
          result += '        return yc_empty_text();\n'
          result += '    }\n'
          result += '    return yc_utf8_to_wide(__yc_ret);\n'
        } else {
          result += `    return __yc_fn(${callArgs});\n`
        }
      }
      result += '}\n\n'
      continue
    }

    result += `typedef ${procReturnType} (WINAPI *YC_EXT_PFN_${symbolBase})(${procParams});\n`
    result += `static HMODULE g_ext_dll_mod_${symbolBase} = NULL;\n`
    result += `static YC_EXT_PFN_${symbolBase} g_ext_dll_fn_${symbolBase} = NULL;\n`
    result += `static YC_EXT_PFN_${symbolBase} yc_resolve_ext_dll_${symbolBase}(void) {\n`
    result += `    if (!g_ext_dll_mod_${symbolBase}) {\n`
    result += `        SetLastError(0);\n`
    result += `        g_ext_dll_mod_${symbolBase} = LoadLibraryW(L"${dllFileName}");\n`
    result += `        if (!g_ext_dll_mod_${symbolBase}) {\n`
    result += `            yc_runtime_report_dll_error(L"加载DLL", L"${dllFileName}", "${entryName}", GetLastError());\n`
    result += '            return NULL;\n'
    result += '        }\n'
    result += '    }\n'
    result += `    if (!g_ext_dll_fn_${symbolBase}) {\n`
    result += '        SetLastError(0);\n'
    result += `        FARPROC __yc_proc = GetProcAddress(g_ext_dll_mod_${symbolBase}, "${entryName}");\n`
    result += '        if (!__yc_proc) {\n'
    result += `            yc_runtime_report_dll_error(L"查找导出", L"${dllFileName}", "${entryName}", GetLastError());\n`
    result += '            return NULL;\n'
    result += '        }\n'
    result += `        g_ext_dll_fn_${symbolBase} = (YC_EXT_PFN_${symbolBase})__yc_proc;\n`
    result += '    }\n'
    result += `    return g_ext_dll_fn_${symbolBase};\n`
    result += '}\n'
    result += `static ${wrapperReturnType} ${dllCmd.name}(${wrapperParams}) {\n`
    result += `    YC_EXT_PFN_${symbolBase} __yc_fn = yc_resolve_ext_dll_${symbolBase}();\n`
    if (wrapperReturnType === 'void') {
      result += '    if (!__yc_fn) return;\n'
      result += `    __yc_fn(${callArgs});\n`
    } else {
      result += `    if (!__yc_fn) return ${defaultReturn};\n`
      if (wrapperReturnType === 'wchar_t*' && procReturnType === 'const char*') {
        result += `    const char* __yc_ret = __yc_fn(${callArgs});\n`
        result += `    if (!__yc_ret) {\n`
        result += `        yc_runtime_report_dll_text_result(L"${dllFileName}", "${entryName}");\n`
        result += '        return yc_empty_text();\n'
        result += '    }\n'
        result += '    return yc_utf8_to_wide(__yc_ret);\n'
      } else {
        result += `    return __yc_fn(${callArgs});\n`
      }
    }
    result += '}\n\n'
  }

  return result
}

// .eyc 转 C 代码转译器
// 将易语言源代码中的子程序转译成 C 函数
// 命令识别基于已加载的支持库，支持第三方支持库扩展
function transpileEycContent(eycContent: string, fileName: string, projectGlobals: GlobalVarDef[] = [], projectConstants: ConstantDef[] = [], projectResources: ProjectResourceEntry[] = [], libraryConstants: LibraryConstantDef[] = [], projectSubprograms: SubprogramDef[] = [], projectDataTypes: ProjectDataTypeDef[] = [], projectDllCommands: ProjectDllCommandDef[] = [], debugBuild = false, breakpoints: Record<string, number[]> = {}, targetPlatform: TargetPlatform = 'windows', projectClassModules: ProjectClassModuleDef[] = []): string {
  // 从已加载的支持库构建命令查找表
  const commandMap = buildCommandMap(targetPlatform)
  const isClassModuleSource = /\.ecc$/i.test(fileName)
  // 类方法不能按裸名跨文件直接调用；类模块自身文件内允许调用本类方法（C++ 成员调用）
  const ownClassNames = new Set(
    isClassModuleSource ? projectClassModules.filter(c => c.fileName === fileName).map(c => c.className) : [],
  )
  const directCallables: DirectCallableNames = new Set(
    projectSubprograms
      .filter(sub => !sub.isClassModule || ownClassNames.has(sub.className))
      .map(sub => sub.name),
  )
  for (const dllCmd of projectDllCommands) directCallables.add(dllCmd.name)

  const lines = eycContent.split('\n')
  let result = `/* 由 ycIDE 自动从 ${fileName} 生成 */\n`
  result += '#include <windows.h>\n#include <stdio.h>\n#include <stdint.h>\n#include <stdlib.h>\n#include <direct.h>\n#include <wchar.h>\n#include <wctype.h>\n#include <string.h>\n#include <filesystem>\n#include <vector>\n#include <string>\n#include <algorithm>\n#include <fstream>\n\n'
  result += generateYcmdNativeDeclarations(targetPlatform)
  result += 'namespace ycfs = std::filesystem;\n\n'
  result += 'typedef std::vector<unsigned char> YC_BIN;\n\n'
  result += 'struct YC_BIG {\n'
  result += '    bool neg;\n'
  result += '    std::string digits;\n'
  result += '    YC_BIG(): neg(false), digits("0") {}\n'
  result += '    YC_BIG(long long v): neg(false), digits("0") {\n'
  result += '        unsigned long long mag = 0;\n'
  result += '        if (v < 0) {\n'
  result += '            neg = true;\n'
  result += '            mag = (unsigned long long)(-(v + 1)) + 1ULL;\n'
  result += '        } else {\n'
  result += '            mag = (unsigned long long)v;\n'
  result += '        }\n'
  result += '        digits.clear();\n'
  result += '        do {\n'
  result += '            digits.push_back((char)(\'0\' + (mag % 10ULL)));\n'
  result += '            mag /= 10ULL;\n'
  result += '        } while (mag > 0ULL);\n'
  result += '        std::reverse(digits.begin(), digits.end());\n'
  result += '        if (digits == "0") neg = false;\n'
  result += '    }\n'
  result += '    YC_BIG(int v): YC_BIG((long long)v) {}\n'
  result += '    YC_BIG(short v): YC_BIG((long long)v) {}\n'
  result += '    YC_BIG(unsigned char v): YC_BIG((long long)v) {}\n'
  result += '    YC_BIG(const wchar_t* s): neg(false), digits("0") {\n'
  result += '        if (!s) return;\n'
  result += '        while (*s && iswspace(*s)) ++s;\n'
  result += '        if (*s == L\'-\') { neg = true; ++s; }\n'
  result += '        else if (*s == L\'+\') { ++s; }\n'
  result += '        std::string out;\n'
  result += '        while (*s) {\n'
  result += '            if (*s >= L\'0\' && *s <= L\'9\') out.push_back((char)(*s));\n'
  result += '            else if (!iswspace(*s)) break;\n'
  result += '            ++s;\n'
  result += '        }\n'
  result += '        size_t first = 0;\n'
  result += '        while (first + 1 < out.size() && out[first] == \'0\') ++first;\n'
  result += '        if (!out.empty()) out = out.substr(first);\n'
  result += '        if (out.empty()) { digits = "0"; neg = false; }\n'
  result += '        else { digits = out; if (digits == "0") neg = false; }\n'
  result += '    }\n'
  result += '    YC_BIG(wchar_t* s): YC_BIG((const wchar_t*)s) {}\n'
  result += '};\n\n'
  result += 'static std::string yc_big_trim_abs(const std::string& in) {\n'
  result += '    if (in.empty()) return "0";\n'
  result += '    size_t i = 0;\n'
  result += '    while (i + 1 < in.size() && in[i] == \'0\') ++i;\n'
  result += '    return in.substr(i);\n'
  result += '}\n\n'
  result += 'static int yc_big_cmp_abs(const std::string& a, const std::string& b) {\n'
  result += '    std::string aa = yc_big_trim_abs(a);\n'
  result += '    std::string bb = yc_big_trim_abs(b);\n'
  result += '    if (aa.size() != bb.size()) return aa.size() < bb.size() ? -1 : 1;\n'
  result += '    if (aa == bb) return 0;\n'
  result += '    return aa < bb ? -1 : 1;\n'
  result += '}\n\n'
  result += 'static std::string yc_big_add_abs(const std::string& a, const std::string& b) {\n'
  result += '    std::string aa = yc_big_trim_abs(a);\n'
  result += '    std::string bb = yc_big_trim_abs(b);\n'
  result += '    int i = (int)aa.size() - 1;\n'
  result += '    int j = (int)bb.size() - 1;\n'
  result += '    int carry = 0;\n'
  result += '    std::string out;\n'
  result += '    while (i >= 0 || j >= 0 || carry) {\n'
  result += '        int da = i >= 0 ? (aa[(size_t)i] - \'0\') : 0;\n'
  result += '        int db = j >= 0 ? (bb[(size_t)j] - \'0\') : 0;\n'
  result += '        int sum = da + db + carry;\n'
  result += '        out.push_back((char)(\'0\' + (sum % 10)));\n'
  result += '        carry = sum / 10;\n'
  result += '        --i; --j;\n'
  result += '    }\n'
  result += '    std::reverse(out.begin(), out.end());\n'
  result += '    return yc_big_trim_abs(out);\n'
  result += '}\n\n'
  result += 'static std::string yc_big_sub_abs(const std::string& a, const std::string& b) {\n'
  result += '    // 要求 |a| >= |b|\n'
  result += '    std::string aa = yc_big_trim_abs(a);\n'
  result += '    std::string bb = yc_big_trim_abs(b);\n'
  result += '    int i = (int)aa.size() - 1;\n'
  result += '    int j = (int)bb.size() - 1;\n'
  result += '    int borrow = 0;\n'
  result += '    std::string out;\n'
  result += '    while (i >= 0) {\n'
  result += '        int da = (aa[(size_t)i] - \'0\') - borrow;\n'
  result += '        int db = j >= 0 ? (bb[(size_t)j] - \'0\') : 0;\n'
  result += '        if (da < db) { da += 10; borrow = 1; } else { borrow = 0; }\n'
  result += '        out.push_back((char)(\'0\' + (da - db)));\n'
  result += '        --i; --j;\n'
  result += '    }\n'
  result += '    while (out.size() > 1 && out.back() == \'0\') out.pop_back();\n'
  result += '    std::reverse(out.begin(), out.end());\n'
  result += '    return yc_big_trim_abs(out);\n'
  result += '}\n\n'
  result += 'static std::string yc_big_mul_abs(const std::string& a, const std::string& b) {\n'
  result += '    std::string aa = yc_big_trim_abs(a);\n'
  result += '    std::string bb = yc_big_trim_abs(b);\n'
  result += '    if (aa == "0" || bb == "0") return "0";\n'
  result += '    std::vector<int> tmp(aa.size() + bb.size(), 0);\n'
  result += '    for (int i = (int)aa.size() - 1; i >= 0; --i) {\n'
  result += '        for (int j = (int)bb.size() - 1; j >= 0; --j) {\n'
  result += '            int p = (aa[(size_t)i] - \'0\') * (bb[(size_t)j] - \'0\');\n'
  result += '            int idx = i + j + 1;\n'
  result += '            int sum = tmp[(size_t)idx] + p;\n'
  result += '            tmp[(size_t)idx] = sum % 10;\n'
  result += '            tmp[(size_t)(idx - 1)] += sum / 10;\n'
  result += '        }\n'
  result += '    }\n'
  result += '    std::string out;\n'
  result += '    size_t i = 0;\n'
  result += '    while (i + 1 < tmp.size() && tmp[i] == 0) ++i;\n'
  result += '    for (; i < tmp.size(); ++i) out.push_back((char)(\'0\' + tmp[i]));\n'
  result += '    return yc_big_trim_abs(out);\n'
  result += '}\n\n'
  result += 'static void yc_big_runtime_div_zero(const char* op) {\n'
  result += '    fprintf(stderr, "! 大整数型运算错误|除数不能为0|%s\\n", op ? op : "/");\n'
  result += '    fflush(stderr);\n'
  result += '    if (IsDebuggerPresent()) DebugBreak();\n'
  result += '}\n\n'
  result += 'static std::string yc_big_div_abs(const std::string& a, const std::string& b) {\n'
  result += '    std::string aa = yc_big_trim_abs(a);\n'
  result += '    std::string bb = yc_big_trim_abs(b);\n'
  result += '    if (bb == "0") { yc_big_runtime_div_zero("/"); return "0"; }\n'
  result += '    if (yc_big_cmp_abs(aa, bb) < 0) return "0";\n'
  result += '    std::string cur = "0";\n'
  result += '    std::string quo;\n'
  result += '    for (size_t i = 0; i < aa.size(); ++i) {\n'
  result += '        if (cur == "0") cur = std::string(1, aa[i]);\n'
  result += '        else cur.push_back(aa[i]);\n'
  result += '        cur = yc_big_trim_abs(cur);\n'
  result += '        int q = 0;\n'
  result += '        while (yc_big_cmp_abs(cur, bb) >= 0) {\n'
  result += '            cur = yc_big_sub_abs(cur, bb);\n'
  result += '            ++q;\n'
  result += '        }\n'
  result += '        quo.push_back((char)(\'0\' + q));\n'
  result += '    }\n'
  result += '    return yc_big_trim_abs(quo);\n'
  result += '}\n\n'
  result += 'static std::string yc_big_mod_abs(const std::string& a, const std::string& b) {\n'
  result += '    std::string aa = yc_big_trim_abs(a);\n'
  result += '    std::string bb = yc_big_trim_abs(b);\n'
  result += '    if (bb == "0") { yc_big_runtime_div_zero("%"); return "0"; }\n'
  result += '    if (yc_big_cmp_abs(aa, bb) < 0) return aa;\n'
  result += '    std::string cur = "0";\n'
  result += '    for (size_t i = 0; i < aa.size(); ++i) {\n'
  result += '        if (cur == "0") cur = std::string(1, aa[i]);\n'
  result += '        else cur.push_back(aa[i]);\n'
  result += '        cur = yc_big_trim_abs(cur);\n'
  result += '        while (yc_big_cmp_abs(cur, bb) >= 0) {\n'
  result += '            cur = yc_big_sub_abs(cur, bb);\n'
  result += '        }\n'
  result += '    }\n'
  result += '    return yc_big_trim_abs(cur);\n'
  result += '}\n\n'
  result += 'static YC_BIG yc_big_normalized(bool neg, const std::string& digits) {\n'
  result += '    YC_BIG out;\n'
  result += '    out.digits = yc_big_trim_abs(digits);\n'
  result += '    out.neg = (out.digits != "0") ? neg : false;\n'
  result += '    return out;\n'
  result += '}\n\n'
  result += 'static YC_BIG operator-(const YC_BIG& v) {\n'
  result += '    return yc_big_normalized(!v.neg, v.digits);\n'
  result += '}\n\n'
  result += 'static YC_BIG operator+(const YC_BIG& a, const YC_BIG& b) {\n'
  result += '    if (a.neg == b.neg) return yc_big_normalized(a.neg, yc_big_add_abs(a.digits, b.digits));\n'
  result += '    int cmp = yc_big_cmp_abs(a.digits, b.digits);\n'
  result += '    if (cmp == 0) return YC_BIG();\n'
  result += '    if (cmp > 0) return yc_big_normalized(a.neg, yc_big_sub_abs(a.digits, b.digits));\n'
  result += '    return yc_big_normalized(b.neg, yc_big_sub_abs(b.digits, a.digits));\n'
  result += '}\n\n'
  result += 'static YC_BIG operator-(const YC_BIG& a, const YC_BIG& b) {\n'
  result += '    return a + (-b);\n'
  result += '}\n\n'
  result += 'static YC_BIG operator*(const YC_BIG& a, const YC_BIG& b) {\n'
  result += '    bool neg = (a.neg != b.neg);\n'
  result += '    return yc_big_normalized(neg, yc_big_mul_abs(a.digits, b.digits));\n'
  result += '}\n\n'
  result += 'static YC_BIG operator/(const YC_BIG& a, const YC_BIG& b) {\n'
  result += '    bool neg = (a.neg != b.neg);\n'
  result += '    return yc_big_normalized(neg, yc_big_div_abs(a.digits, b.digits));\n'
  result += '}\n\n'
  result += 'static YC_BIG yc_big_mod(const YC_BIG& a, const YC_BIG& b) {\n'
  result += '    bool neg = a.neg;\n'
  result += '    return yc_big_normalized(neg, yc_big_mod_abs(a.digits, b.digits));\n'
  result += '}\n\n'
  result += 'static YC_BIG operator%(const YC_BIG& a, const YC_BIG& b) {\n'
  result += '    return yc_big_mod(a, b);\n'
  result += '}\n\n'
  result += 'static bool operator==(const YC_BIG& a, const YC_BIG& b) {\n'
  result += '    return a.neg == b.neg && yc_big_trim_abs(a.digits) == yc_big_trim_abs(b.digits);\n'
  result += '}\n\n'
  result += 'static bool operator!=(const YC_BIG& a, const YC_BIG& b) { return !(a == b); }\n\n'
  result += 'static bool operator<(const YC_BIG& a, const YC_BIG& b) {\n'
  result += '    if (a.neg != b.neg) return a.neg;\n'
  result += '    int cmp = yc_big_cmp_abs(a.digits, b.digits);\n'
  result += '    return a.neg ? (cmp > 0) : (cmp < 0);\n'
  result += '}\n\n'
  result += 'static bool operator>(const YC_BIG& a, const YC_BIG& b) { return b < a; }\n\n'
  result += 'static bool operator<=(const YC_BIG& a, const YC_BIG& b) { return !(b < a); }\n\n'
  result += 'static bool operator>=(const YC_BIG& a, const YC_BIG& b) { return !(a < b); }\n\n'

  result += `#define YC_DEBUG_BUILD ${debugBuild ? 1 : 0}\n\n`
  result += '#define YC_SDT_BYTE 0x80000101u\n'
  result += '#define YC_SDT_SHORT 0x80000201u\n'
  result += '#define YC_SDT_INT 0x80000301u\n'
  result += '#define YC_SDT_INT64 0x80000401u\n'
  result += '#define YC_SDT_FLOAT 0x80000501u\n'
  result += '#define YC_SDT_DOUBLE 0x80000601u\n'
  result += '#define YC_SDT_BOOL 0x80000002u\n'
  result += '#define YC_SDT_TEXT 0x80000004u\n\n'
  result += 'typedef uint32_t YC_DATA_TYPE;\n'
  result += 'typedef struct YC_MDATA_INF {\n'
  result += '    union {\n'
  result += '        unsigned char m_byte;\n'
  result += '        short m_short;\n'
  result += '        int m_int;\n'
  result += '        long long m_int64;\n'
  result += '        float m_float;\n'
  result += '        double m_double;\n'
  result += '        int m_bool;\n'
  result += '        char* m_pText;\n'
  result += '    };\n'
  result += '    YC_DATA_TYPE m_dtDataType;\n'
  result += '} YC_MDATA_INF;\n\n'
  result += 'extern "C" void yc_invoke_support_cmd(const char* libName, int cmdIndex, YC_MDATA_INF* pRetData, int argCount, YC_MDATA_INF* pArgs);\n'
  result += 'extern void yc_set_control_text(const wchar_t* ctrlName, const wchar_t* text);\n'
  result += 'extern const wchar_t* yc_get_control_text(const wchar_t* ctrlName);\n'
  result += 'extern int yc_text_compare(const wchar_t* left, const wchar_t* right);\n'
  result += 'extern int yc_text_starts_with(const wchar_t* text, const wchar_t* prefix);\n\n'
  result += 'static wchar_t* yc_wcsdup_text(const wchar_t* s);\n'
  result += 'static wchar_t* yc_empty_text(void);\n'
  result += 'static wchar_t* yc_utf8_to_wide(const char* s);\n'
  result += 'static const char* yc_wide_to_utf8(const wchar_t* s);\n'
  result += 'static const char* yc_bin_to_cstr(const YC_BIN& value);\n'
  result += 'static YC_BIN yc_cstr_to_bin(const char* value);\n'
  result += 'static wchar_t* yc_format_win32_error(DWORD errorCode);\n'
  result += 'static void yc_runtime_note_begin(void);\n'
  result += 'static void yc_runtime_note_part(const wchar_t* s);\n'
  result += 'static void yc_runtime_note_part(const char* s);\n'
  result += 'static void yc_runtime_note_part(float v);\n'
  result += 'static void yc_runtime_note_part(double v);\n'
  result += 'static void yc_runtime_note_end(void);\n'
  result += 'static void yc_runtime_report_dll_error(const wchar_t* stage, const wchar_t* dllName, const char* entryName, DWORD errorCode);\n'
  result += 'static void yc_runtime_report_dll_text_result(const wchar_t* dllName, const char* entryName);\n\n'
  result += 'static YC_BIN yc_load_resource_bin(const wchar_t* resourceName);\n\n'
  result += 'static void yc_write_utf8_wide(const wchar_t* s) {\n'
  result += '    if (!s) return;\n'
  result += '    int n = WideCharToMultiByte(CP_UTF8, 0, s, -1, NULL, 0, NULL, NULL);\n'
  result += '    if (n <= 1) return;\n'
  result += '    char* out = (char*)malloc((size_t)n);\n'
  result += '    if (!out) return;\n'
  result += '    if (WideCharToMultiByte(CP_UTF8, 0, s, -1, out, n, NULL, NULL) > 0) {\n'
  result += '        fwrite(out, 1, (size_t)(n - 1), stdout);\n'
  result += '    }\n'
  result += '    free(out);\n'
  result += '}\n'
  result += 'static void yc_write_utf8_wide_single_line(const wchar_t* s) {\n'
  result += '    const wchar_t* p = s ? s : L"";\n'
  result += '    while (*p) {\n'
  result += '        if (*p < 32) {\n'
  result += '            fputc(\' \', stdout);\n'
  result += '        } else {\n'
  result += '            wchar_t one[2] = { *p, 0 };\n'
  result += '            yc_write_utf8_wide(one);\n'
  result += '        }\n'
  result += '        ++p;\n'
  result += '    }\n'
  result += '}\n'
  result += 'static void yc_write_utf8_single_line(const char* s) {\n'
  result += '    const char* p = s ? s : "";\n'
  result += '    while (*p) {\n'
  result += '        if ((unsigned char)(*p) < 32) fputc(\' \', stdout);\n'
  result += '        else fputc(*p, stdout);\n'
  result += '        ++p;\n'
  result += '    }\n'
  result += '}\n'
  result += 'static void yc_debug_output_value(const wchar_t* s) {\n'
  result += '    yc_write_utf8_wide(s ? s : L"");\n'
  result += '    printf("\\n");\n'
  result += '}\n'
  result += 'static void yc_debug_output_value(wchar_t* s) {\n'
  result += '    yc_debug_output_value((const wchar_t*)s);\n'
  result += '}\n'
  result += 'static void yc_debug_output_value(const char* s) {\n'
  result += '    printf("%s\\n", s ? s : "");\n'
  result += '}\n'
  result += 'static void yc_debug_output_value(char* s) {\n'
  result += '    yc_debug_output_value((const char*)s);\n'
  result += '}\n'
  result += 'static void yc_debug_output_value(const YC_BIN& value) {\n'
  result += '    printf("<字节集 %zu>\\n", value.size());\n'
  result += '}\n'
  result += 'static void yc_debug_output_value(const YC_BIG& value) {\n'
  result += '    if (value.neg && value.digits != "0") printf("-");\n'
  result += '    printf("%s\\n", value.digits.c_str());\n'
  result += '}\n'
  result += 'static void yc_debug_output_value(float v) {\n'
  result += '    printf("%.6g\\n", v);\n'
  result += '}\n'
  result += 'static void yc_debug_output_value(double v) {\n'
  result += '    printf("%.12g\\n", v);\n'
  result += '}\n'
  result += 'template <typename T> static void yc_debug_output_value(T v) {\n'
  result += '    printf("%lld\\n", (long long)(v));\n'
  result += '}\n\n'
  result += 'static void yc_debug_line_begin(void) {\n'
  result += '#if YC_DEBUG_BUILD\n'
  result += '    printf("* ");\n'
  result += '#endif\n'
  result += '}\n'
  result += 'static void yc_debug_line_part(const wchar_t* s) {\n'
  result += '#if YC_DEBUG_BUILD\n'
  result += '    yc_write_utf8_wide_single_line(s ? s : L"");\n'
  result += '#endif\n'
  result += '}\n'
  result += 'static void yc_debug_line_part(wchar_t* s) {\n'
  result += '#if YC_DEBUG_BUILD\n'
  result += '    yc_debug_line_part((const wchar_t*)s);\n'
  result += '#endif\n'
  result += '}\n'
  result += 'static void yc_debug_line_part(const char* s) {\n'
  result += '#if YC_DEBUG_BUILD\n'
  result += '    yc_write_utf8_single_line(s ? s : "");\n'
  result += '#endif\n'
  result += '}\n'
  result += 'static void yc_debug_line_part(char* s) {\n'
  result += '#if YC_DEBUG_BUILD\n'
  result += '    yc_debug_line_part((const char*)s);\n'
  result += '#endif\n'
  result += '}\n'
  result += 'static void yc_debug_line_part(const YC_BIN& value) {\n'
  result += '#if YC_DEBUG_BUILD\n'
  result += '    printf("<字节集 %zu>", value.size());\n'
  result += '#endif\n'
  result += '}\n'
  result += 'static void yc_debug_line_part(const YC_BIG& value) {\n'
  result += '#if YC_DEBUG_BUILD\n'
  result += '    if (value.neg && value.digits != "0") printf("-");\n'
  result += '    printf("%s", value.digits.c_str());\n'
  result += '#endif\n'
  result += '}\n'
  result += 'static void yc_debug_line_part(float v) {\n'
  result += '#if YC_DEBUG_BUILD\n'
  result += '    printf("%.6g", v);\n'
  result += '#endif\n'
  result += '}\n'
  result += 'static void yc_debug_line_part(double v) {\n'
  result += '#if YC_DEBUG_BUILD\n'
  result += '    printf("%.12g", v);\n'
  result += '#endif\n'
  result += '}\n'
  result += 'template <typename T> static void yc_debug_line_part(T v) {\n'
  result += '#if YC_DEBUG_BUILD\n'
  result += '    printf("%lld", (long long)(v));\n'
  result += '#endif\n'
  result += '}\n'
  result += 'static void yc_debug_line_end(void) {\n'
  result += '#if YC_DEBUG_BUILD\n'
  result += '    printf("\\n");\n'
  result += '    fflush(stdout);\n'
  result += '#endif\n'
  result += '}\n\n'
  result += 'static void yc_runtime_note_begin(void) {\n'
  result += '    printf("! ");\n'
  result += '}\n'
  result += 'static void yc_runtime_note_part(const wchar_t* s) {\n'
  result += '    yc_write_utf8_wide_single_line(s ? s : L"");\n'
  result += '}\n'
  result += 'static void yc_runtime_note_part(const char* s) {\n'
  result += '    yc_write_utf8_single_line(s ? s : "");\n'
  result += '}\n'
  result += 'static void yc_runtime_note_part(float v) {\n'
  result += '    printf("%.6g", v);\n'
  result += '}\n'
  result += 'static void yc_runtime_note_part(double v) {\n'
  result += '    printf("%.12g", v);\n'
  result += '}\n'
  result += 'static void yc_runtime_note_part(const YC_BIG& value) {\n'
  result += '    if (value.neg && value.digits != "0") printf("-");\n'
  result += '    printf("%s", value.digits.c_str());\n'
  result += '}\n'
  result += 'template <typename T> static void yc_runtime_note_part(T v) {\n'
  result += '    printf("%lld", (long long)(v));\n'
  result += '}\n'
  result += 'static void yc_runtime_note_end(void) {\n'
  result += '    printf("\\n");\n'
  result += '    fflush(stdout);\n'
  result += '}\n\n'
  result += 'static wchar_t* yc_utf8_to_wide(const char* s) {\n'
  result += '    if (!s) {\n'
  result += '        return yc_empty_text();\n'
  result += '    }\n'
  result += '    int n = MultiByteToWideChar(CP_UTF8, 0, s, -1, NULL, 0);\n'
  result += '    if (n <= 0) return yc_empty_text();\n'
  result += '    wchar_t* out = (wchar_t*)malloc(sizeof(wchar_t) * (size_t)n);\n'
  result += '    if (!out) return yc_empty_text();\n'
  result += '    if (MultiByteToWideChar(CP_UTF8, 0, s, -1, out, n) <= 0) {\n'
  result += '        free(out);\n'
  result += '        return yc_empty_text();\n'
  result += '    }\n'
  result += '    return out;\n'
  result += '}\n\n'

  // 轮转缓冲池：同一条调用语句的多个实参可能各自经过本函数转换，
  // 单一共享缓冲会让后求值的实参覆盖先求值的（如 信息框 的提示信息与窗口标题变成同一文本）
  result += 'static std::string& yc_c_str_slot(void) {\n'
  result += '    static thread_local std::string slots[8];\n'
  result += '    static thread_local unsigned slotIdx = 0;\n'
  result += '    return slots[(slotIdx++) & 7u];\n'
  result += '}\n\n'

  result += 'static const char* yc_wide_to_utf8(const wchar_t* s) {\n'
  result += '    std::string& out = yc_c_str_slot();\n'
  result += '    out.clear();\n'
  result += '    if (!s) return out.c_str();\n'
  result += '    int n = WideCharToMultiByte(CP_UTF8, 0, s, -1, NULL, 0, NULL, NULL);\n'
  result += '    if (n <= 1) return out.c_str();\n'
  result += '    out.resize((size_t)n - 1);\n'
  result += '    WideCharToMultiByte(CP_UTF8, 0, s, -1, out.data(), n, NULL, NULL);\n'
  result += '    return out.c_str();\n'
  result += '}\n\n'

  result += 'static const char* yc_bin_to_cstr(const YC_BIN& value) {\n'
  result += '    std::string& out = yc_c_str_slot();\n'
  result += '    out.assign((const char*)value.data(), value.size());\n'
  result += '    return out.c_str();\n'
  result += '}\n\n'

  result += 'static YC_BIN yc_cstr_to_bin(const char* value) {\n'
  result += '    YC_BIN out;\n'
  result += '    if (!value) return out;\n'
  result += '    const size_t n = strlen(value);\n'
  result += '    out.assign((const unsigned char*)value, (const unsigned char*)value + n);\n'
  result += '    return out;\n'
  result += '}\n\n'
  result += 'static wchar_t* yc_get_local_hostname(void) {\n'
  result += '    static wchar_t host[256];\n'
  result += '    DWORD n = (DWORD)(sizeof(host) / sizeof(host[0]));\n'
  result += '    if (!GetComputerNameW(host, &n)) {\n'
  result += '        host[0] = L\'\\0\';\n'
  result += '    }\n'
  result += '    return host;\n'
  result += '}\n\n'
  result += 'static wchar_t* yc_wcsdup_text(const wchar_t* s) {\n'
  result += '    const wchar_t* src = s ? s : L"";\n'
  result += '    size_t len = wcslen(src);\n'
  result += '    wchar_t* out = (wchar_t*)malloc(sizeof(wchar_t) * (len + 1));\n'
  result += '    if (!out) return NULL;\n'
  result += '    memcpy(out, src, sizeof(wchar_t) * (len + 1));\n'
  result += '    return out;\n'
  result += '}\n\n'
  result += 'static wchar_t* yc_empty_text(void) {\n'
  result += '    return yc_wcsdup_text(L"");\n'
  result += '}\n\n'
  result += 'static wchar_t* yc_format_win32_error(DWORD errorCode) {\n'
  result += '    if (errorCode == 0) return yc_empty_text();\n'
  result += '    LPWSTR sysMsg = NULL;\n'
  result += '    DWORD len = FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,\n'
  result += '        NULL, errorCode, 0, (LPWSTR)&sysMsg, 0, NULL);\n'
  result += '    if (!len || !sysMsg) return yc_empty_text();\n'
  result += '    while (len > 0 && (sysMsg[len - 1] == L\'\\r\' || sysMsg[len - 1] == L\'\\n\' || sysMsg[len - 1] == L\' \' || sysMsg[len - 1] == L\'\\t\')) {\n'
  result += '        sysMsg[--len] = 0;\n'
  result += '    }\n'
  result += '    wchar_t* out = yc_wcsdup_text(sysMsg);\n'
  result += '    LocalFree(sysMsg);\n'
  result += '    return out ? out : yc_empty_text();\n'
  result += '}\n\n'
  result += 'static void yc_runtime_report_dll_error(const wchar_t* stage, const wchar_t* dllName, const char* entryName, DWORD errorCode) {\n'
  result += '    wchar_t* winMsg = yc_format_win32_error(errorCode);\n'
  result += '    yc_runtime_note_begin();\n'
  result += '    yc_runtime_note_part(L"DLL调用失败");\n'
  result += '    if (stage && *stage) { yc_runtime_note_part(L"|"); yc_runtime_note_part(stage); }\n'
  result += '    if (dllName && *dllName) { yc_runtime_note_part(L"|"); yc_runtime_note_part(dllName); }\n'
  result += '    if (entryName && *entryName) { yc_runtime_note_part(L"|"); yc_runtime_note_part(entryName); }\n'
  result += '    if (errorCode != 0) { yc_runtime_note_part(L"|"); yc_runtime_note_part((long long)errorCode); }\n'
  result += '    if (winMsg && *winMsg) { yc_runtime_note_part(L"|"); yc_runtime_note_part(winMsg); }\n'
  result += '    yc_runtime_note_end();\n'
  result += '    if (winMsg) free(winMsg);\n'
  result += '}\n\n'
  result += 'static void yc_runtime_report_dll_text_result(const wchar_t* dllName, const char* entryName) {\n'
  result += '    yc_runtime_note_begin();\n'
  result += '    yc_runtime_note_part(L"DLL返回空文本");\n'
  result += '    if (dllName && *dllName) { yc_runtime_note_part(L"|"); yc_runtime_note_part(dllName); }\n'
  result += '    if (entryName && *entryName) { yc_runtime_note_part(L"|"); yc_runtime_note_part(entryName); }\n'
  result += '    yc_runtime_note_end();\n'
  result += '}\n\n'
  result += 'static YC_BIN yc_load_resource_bin(const wchar_t* resourceName) {\n'
  result += '    YC_BIN out;\n'
  result += '    if (!resourceName || !resourceName[0]) return out;\n'
  result += '    HRSRC hRes = FindResourceW(NULL, resourceName, MAKEINTRESOURCEW(10));\n'
  result += '    if (!hRes) {\n'
  result += '        size_t nameLen = wcslen(resourceName);\n'
  result += '        wchar_t* quotedName = (wchar_t*)malloc(sizeof(wchar_t) * (nameLen + 3));\n'
  result += '        if (quotedName) {\n'
  result += '            quotedName[0] = L\'"\';\n'
  result += '            memcpy(quotedName + 1, resourceName, sizeof(wchar_t) * nameLen);\n'
  result += '            quotedName[nameLen + 1] = L\'"\';\n'
  result += '            quotedName[nameLen + 2] = 0;\n'
  result += '            hRes = FindResourceW(NULL, quotedName, MAKEINTRESOURCEW(10));\n'
  result += '            free(quotedName);\n'
  result += '        }\n'
  result += '    }\n'
  result += '    if (!hRes) return out;\n'
  result += '    DWORD size = SizeofResource(NULL, hRes);\n'
  result += '    if (size == 0) return out;\n'
  result += '    HGLOBAL hData = LoadResource(NULL, hRes);\n'
  result += '    if (!hData) return out;\n'
  result += '    const unsigned char* bytes = (const unsigned char*)LockResource(hData);\n'
  result += '    if (!bytes) return out;\n'
  result += '    out.assign(bytes, bytes + size);\n'
  result += '    return out;\n'
  result += '}\n\n'
  result += generateDebugRuntimeCode(targetPlatform)
  result += 'static wchar_t* yc_text_concat(const wchar_t* left, const wchar_t* right) {\n'
  result += '    const wchar_t* lhs = left ? left : L"";\n'
  result += '    const wchar_t* rhs = right ? right : L"";\n'
  result += '    size_t leftLen = wcslen(lhs);\n'
  result += '    size_t rightLen = wcslen(rhs);\n'
  result += '    wchar_t* out = (wchar_t*)malloc(sizeof(wchar_t) * (leftLen + rightLen + 1));\n'
  result += '    if (!out) return NULL;\n'
  result += '    memcpy(out, lhs, sizeof(wchar_t) * leftLen);\n'
  result += '    memcpy(out + leftLen, rhs, sizeof(wchar_t) * (rightLen + 1));\n'
  result += '    return out;\n'
  result += '}\n\n'
  result += 'static wchar_t* yc_value_to_text(long long value) {\n'
  result += '    wchar_t buf[64];\n'
  result += '    swprintf(buf, 64, L"%lld", value);\n'
  result += '    return yc_wcsdup_text(buf);\n'
  result += '}\n\n'
  result += 'static wchar_t* yc_value_to_text(int value) {\n'
  result += '    return yc_value_to_text((long long)value);\n'
  result += '}\n\n'
  result += 'static wchar_t* yc_value_to_text(double value) {\n'
  result += '    wchar_t buf[128];\n'
  result += '    swprintf(buf, 128, L"%.15g", value);\n'
  result += '    return yc_wcsdup_text(buf);\n'
  result += '}\n\n'
  result += 'static wchar_t* yc_value_to_text(float value) {\n'
  result += '    return yc_value_to_text((double)value);\n'
  result += '}\n\n'
  result += 'static wchar_t* yc_value_to_text(const wchar_t* value) {\n'
  result += '    return yc_wcsdup_text(value ? value : L"");\n'
  result += '}\n\n'
  result += 'static wchar_t* yc_value_to_text(wchar_t* value) {\n'
  result += '    return yc_value_to_text((const wchar_t*)value);\n'
  result += '}\n\n'
  result += 'static wchar_t* yc_value_to_text(const YC_BIG& value) {\n'
  result += '    std::wstring out;\n'
  result += '    if (value.neg && value.digits != "0") out.push_back(L\'-\');\n'
  result += '    for (char c : value.digits) out.push_back((wchar_t)c);\n'
  result += '    return yc_wcsdup_text(out.c_str());\n'
  result += '}\n\n'
  result += 'static YC_BIG yc_value_to_big(const YC_BIG& value) { return value; }\n\n'
  result += 'static YC_BIG yc_value_to_big(long long value) { return YC_BIG(value); }\n\n'
  result += 'static YC_BIG yc_value_to_big(int value) { return YC_BIG((long long)value); }\n\n'
  result += 'static YC_BIG yc_value_to_big(short value) { return YC_BIG((long long)value); }\n\n'
  result += 'static YC_BIG yc_value_to_big(unsigned char value) { return YC_BIG((long long)value); }\n\n'
  result += 'static YC_BIG yc_value_to_big(double value) { return YC_BIG((long long)value); }\n\n'
  result += 'static YC_BIG yc_value_to_big(float value) { return YC_BIG((long long)value); }\n\n'
  result += 'static YC_BIG yc_value_to_big(const wchar_t* value) { return YC_BIG(value); }\n\n'
  result += 'static YC_BIG yc_value_to_big(wchar_t* value) { return YC_BIG((const wchar_t*)value); }\n\n'
  result += 'static size_t yc_bin_clamp_count(int count) {\n'
  result += '    return count <= 0 ? 0u : (size_t)count;\n'
  result += '}\n\n'
  result += 'static size_t yc_bin_pos_to_index(int pos, size_t size) {\n'
  result += '    if (pos <= 1) return 0u;\n'
  result += '    return (size_t)(pos - 1) > size ? size : (size_t)(pos - 1);\n'
  result += '}\n\n'
  result += 'static YC_BIN yc_bin_from_ptr(const void* ptr, size_t len) {\n'
  result += '    if (!ptr || len == 0) return YC_BIN();\n'
  result += '    const unsigned char* p = (const unsigned char*)ptr;\n'
  result += '    return YC_BIN(p, p + len);\n'
  result += '}\n\n'
  result += 'template <typename T> static YC_BIN yc_bin_from_scalar(const T& value) {\n'
  result += '    return yc_bin_from_ptr(&value, sizeof(T));\n'
  result += '}\n\n'
  result += 'static YC_BIN yc_to_bin(const YC_BIN& value) {\n'
  result += '    return value;\n'
  result += '}\n\n'
  result += 'static YC_BIN yc_to_bin(const wchar_t* text) {\n'
  result += '    if (!text) return YC_BIN();\n'
  result += '    return yc_bin_from_ptr(text, wcslen(text) * sizeof(wchar_t));\n'
  result += '}\n\n'
  result += 'static YC_BIN yc_to_bin(wchar_t* text) {\n'
  result += '    return yc_to_bin((const wchar_t*)text);\n'
  result += '}\n\n'
  result += 'static YC_BIN yc_to_bin(const char* text) {\n'
  result += '    if (!text) return YC_BIN();\n'
  result += '    return yc_bin_from_ptr(text, strlen(text));\n'
  result += '}\n\n'
  result += 'static YC_BIN yc_to_bin(char* text) {\n'
  result += '    return yc_to_bin((const char*)text);\n'
  result += '}\n\n'
  result += 'template <typename T> static YC_BIN yc_to_bin(const T& value) {\n'
  result += '    return yc_bin_from_scalar(value);\n'
  result += '}\n\n'
  result += 'static int yc_bin_len(const YC_BIN& value) {\n'
  result += '    return value.size() > 2147483647u ? 2147483647 : (int)value.size();\n'
  result += '}\n\n'
  result += 'static YC_BIN yc_bin_left(const YC_BIN& value, int count) {\n'
  result += '    size_t n = yc_bin_clamp_count(count);\n'
  result += '    if (n > value.size()) n = value.size();\n'
  result += '    return YC_BIN(value.begin(), value.begin() + n);\n'
  result += '}\n\n'
  result += 'static YC_BIN yc_bin_right(const YC_BIN& value, int count) {\n'
  result += '    size_t n = yc_bin_clamp_count(count);\n'
  result += '    if (n > value.size()) n = value.size();\n'
  result += '    return YC_BIN(value.end() - n, value.end());\n'
  result += '}\n\n'
  result += 'static YC_BIN yc_bin_mid(const YC_BIN& value, int startPos, int count) {\n'
  result += '    size_t start = yc_bin_pos_to_index(startPos, value.size());\n'
  result += '    size_t n = yc_bin_clamp_count(count);\n'
  result += '    if (start >= value.size() || n == 0) return YC_BIN();\n'
  result += '    if (start + n > value.size()) n = value.size() - start;\n'
  result += '    return YC_BIN(value.begin() + start, value.begin() + start + n);\n'
  result += '}\n\n'
  result += 'static int yc_bin_find(const YC_BIN& haystack, const YC_BIN& needle, int startPos) {\n'
  result += '    size_t start = yc_bin_pos_to_index(startPos <= 0 ? 1 : startPos, haystack.size());\n'
  result += '    if (needle.empty()) return start < haystack.size() ? (int)start + 1 : 1;\n'
  result += '    if (start >= haystack.size() || needle.size() > haystack.size()) return -1;\n'
  result += '    auto it = std::search(haystack.begin() + start, haystack.end(), needle.begin(), needle.end());\n'
  result += '    return it == haystack.end() ? -1 : (int)(it - haystack.begin()) + 1;\n'
  result += '}\n\n'
  result += 'static int yc_bin_rfind(const YC_BIN& haystack, const YC_BIN& needle, int startPos) {\n'
  result += '    if (needle.empty()) return haystack.empty() ? 1 : (startPos > 0 ? startPos : (int)haystack.size());\n'
  result += '    if (needle.size() > haystack.size()) return -1;\n'
  result += '    size_t limit = haystack.size() - needle.size();\n'
  result += '    if (startPos > 0) {\n'
  result += '      size_t requested = yc_bin_pos_to_index(startPos, haystack.size());\n'
  result += '      if (requested < limit) limit = requested;\n'
  result += '    }\n'
  result += '    for (size_t i = limit + 1; i-- > 0;) {\n'
  result += '      if (memcmp(haystack.data() + i, needle.data(), needle.size()) == 0) return (int)i + 1;\n'
  result += '      if (i == 0) break;\n'
  result += '    }\n'
  result += '    return -1;\n'
  result += '}\n\n'
  result += 'static YC_BIN yc_bin_replace(const YC_BIN& value, int startPos, int replaceLen, const YC_BIN& repl) {\n'
  result += '    YC_BIN out = value;\n'
  result += '    size_t start = yc_bin_pos_to_index(startPos, out.size());\n'
  result += '    size_t len = yc_bin_clamp_count(replaceLen);\n'
  result += '    if (start > out.size()) start = out.size();\n'
  result += '    if (start + len > out.size()) len = out.size() - start;\n'
  result += '    out.erase(out.begin() + start, out.begin() + start + len);\n'
  result += '    out.insert(out.begin() + start, repl.begin(), repl.end());\n'
  result += '    return out;\n'
  result += '}\n\n'
  result += 'static YC_BIN yc_bin_replace_sub(const YC_BIN& value, const YC_BIN& from, const YC_BIN& to, int startPos, int replaceCount) {\n'
  result += '    YC_BIN out = value;\n'
  result += '    if (from.empty()) return out;\n'
  result += '    size_t pos = yc_bin_pos_to_index(startPos <= 0 ? 1 : startPos, out.size());\n'
  result += '    int done = 0;\n'
  result += '    while (pos <= out.size()) {\n'
  result += '      auto it = std::search(out.begin() + pos, out.end(), from.begin(), from.end());\n'
  result += '      if (it == out.end()) break;\n'
  result += '      size_t idx = (size_t)(it - out.begin());\n'
  result += '      out.erase(out.begin() + idx, out.begin() + idx + from.size());\n'
  result += '      out.insert(out.begin() + idx, to.begin(), to.end());\n'
  result += '      pos = idx + to.size();\n'
  result += '      done++;\n'
  result += '      if (replaceCount > 0 && done >= replaceCount) break;\n'
  result += '    }\n'
  result += '    return out;\n'
  result += '}\n\n'
  result += 'static YC_BIN yc_bin_space(int count) {\n'
  result += '    return YC_BIN(yc_bin_clamp_count(count), 0);\n'
  result += '}\n\n'
  result += 'static YC_BIN yc_bin_repeat(int count, const YC_BIN& value) {\n'
  result += '    YC_BIN out;\n'
  result += '    int times = count < 0 ? 0 : count;\n'
  result += '    if (times == 0 || value.empty()) return out;\n'
  result += '    out.reserve((size_t)times * value.size());\n'
  result += '    for (int i = 0; i < times; i++) out.insert(out.end(), value.begin(), value.end());\n'
  result += '    return out;\n'
  result += '}\n\n'
  result += 'static YC_BIN yc_bin_from_address(long long ptrValue, int len) {\n'
  result += '    size_t n = yc_bin_clamp_count(len);\n'
  result += '    return yc_bin_from_ptr((const void*)(intptr_t)ptrValue, n);\n'
  result += '}\n\n'
  result += 'static int yc_ptr_to_int(long long ptrValue) {\n'
  result += '    const int* p = (const int*)(intptr_t)ptrValue;\n'
  result += '    return p ? *p : 0;\n'
  result += '}\n\n'
  result += 'static float yc_ptr_to_float(long long ptrValue) {\n'
  result += '    const float* p = (const float*)(intptr_t)ptrValue;\n'
  result += '    return p ? *p : 0.0f;\n'
  result += '}\n\n'
  result += 'static double yc_ptr_to_double(long long ptrValue) {\n'
  result += '    const double* p = (const double*)(intptr_t)ptrValue;\n'
  result += '    return p ? *p : 0.0;\n'
  result += '}\n\n'
  result += 'static int yc_byteswap_i32(int value) {\n'
  result += '    unsigned int v = (unsigned int)value;\n'
  result += '    v = ((v & 0x000000FFu) << 24) | ((v & 0x0000FF00u) << 8) | ((v & 0x00FF0000u) >> 8) | ((v & 0xFF000000u) >> 24);\n'
  result += '    return (int)v;\n'
  result += '}\n\n'
  result += 'static int yc_bin_get_int(const YC_BIN& value, int offset, int reverseBytes) {\n'
  result += '    size_t pos = offset < 0 ? 0u : (size_t)offset;\n'
  result += '    int out = 0;\n'
  result += '    if (pos + sizeof(int) > value.size()) return 0;\n'
  result += '    memcpy(&out, value.data() + pos, sizeof(int));\n'
  result += '    return reverseBytes ? yc_byteswap_i32(out) : out;\n'
  result += '}\n\n'
  result += 'static void yc_bin_set_int(YC_BIN& value, int offset, int data, int reverseBytes) {\n'
  result += '    size_t pos = offset < 0 ? 0u : (size_t)offset;\n'
  result += '    int out = reverseBytes ? yc_byteswap_i32(data) : data;\n'
  result += '    if (value.size() < pos + sizeof(int)) value.resize(pos + sizeof(int), 0);\n'
  result += '    memcpy(value.data() + pos, &out, sizeof(int));\n'
  result += '}\n\n'
  result += 'static void yc_fs_build_root(const wchar_t* driveText, wchar_t outRoot[4]) {\n'
  result += '    wchar_t drive = 0;\n'
  result += '    if (driveText && driveText[0]) drive = (wchar_t)towupper(driveText[0]);\n'
  result += '    if (!drive) {\n'
  result += '        int currentDrive = _getdrive();\n'
  result += '        if (currentDrive >= 1 && currentDrive <= 26) drive = (wchar_t)(L\'A\' + currentDrive - 1);\n'
  result += '    }\n'
  result += '    if (!drive) drive = L\'C\';\n'
  result += '    outRoot[0] = drive;\n'
  result += '    outRoot[1] = L\':\';\n'
  result += '    outRoot[2] = L\'\\\\\';\n'
  result += '    outRoot[3] = L\'\\0\';\n'
  result += '}\n\n'
  result += 'static int yc_fs_clamp_kb(unsigned long long value) {\n'
  result += '    return value > 2147483647ULL ? 2147483647 : (int)value;\n'
  result += '}\n\n'
  result += 'static int yc_fs_disk_total_kb(const wchar_t* driveText) {\n'
  result += '    wchar_t root[4];\n'
  result += '    ULARGE_INTEGER freeBytesAvailable, totalBytes, totalFreeBytes;\n'
  result += '    yc_fs_build_root(driveText, root);\n'
  result += '    if (!GetDiskFreeSpaceExW(root, &freeBytesAvailable, &totalBytes, &totalFreeBytes)) return -1;\n'
  result += '    return yc_fs_clamp_kb(totalBytes.QuadPart / 1024ULL);\n'
  result += '}\n\n'
  result += 'static int yc_fs_disk_free_kb(const wchar_t* driveText) {\n'
  result += '    wchar_t root[4];\n'
  result += '    ULARGE_INTEGER freeBytesAvailable, totalBytes, totalFreeBytes;\n'
  result += '    yc_fs_build_root(driveText, root);\n'
  result += '    if (!GetDiskFreeSpaceExW(root, &freeBytesAvailable, &totalBytes, &totalFreeBytes)) return -1;\n'
  result += '    return yc_fs_clamp_kb(totalFreeBytes.QuadPart / 1024ULL);\n'
  result += '}\n\n'
  result += 'static wchar_t* yc_fs_get_disk_label(const wchar_t* driveText) {\n'
  result += '    wchar_t root[4];\n'
  result += '    wchar_t volumeName[MAX_PATH];\n'
  result += '    DWORD serialNumber = 0, maxComponentLen = 0, fileSystemFlags = 0;\n'
  result += '    wchar_t fileSystemName[MAX_PATH];\n'
  result += '    yc_fs_build_root(driveText, root);\n'
  result += '    if (!GetVolumeInformationW(root, volumeName, MAX_PATH, &serialNumber, &maxComponentLen, &fileSystemFlags, fileSystemName, MAX_PATH)) {\n'
  result += '        return yc_wcsdup_text(L"");\n'
  result += '    }\n'
  result += '    return yc_wcsdup_text(volumeName);\n'
  result += '}\n\n'
  result += 'static int yc_fs_set_disk_label(const wchar_t* driveText, const wchar_t* label) {\n'
  result += '    wchar_t root[4];\n'
  result += '    yc_fs_build_root(driveText, root);\n'
  result += '    return SetVolumeLabelW(root, label ? label : L"") ? 1 : 0;\n'
  result += '}\n\n'
  result += 'static int yc_fs_change_drive(const wchar_t* driveText) {\n'
  result += '    wchar_t root[4];\n'
  result += '    if (!driveText || !driveText[0]) return 1;\n'
  result += '    yc_fs_build_root(driveText, root);\n'
  result += '    return SetCurrentDirectoryW(root) ? 1 : 0;\n'
  result += '}\n\n'
  result += 'static int yc_fs_change_dir(const wchar_t* path) {\n'
  result += '    if (!path || !path[0]) return 0;\n'
  result += '    return _wchdir(path) == 0 ? 1 : 0;\n'
  result += '}\n\n'
  result += 'static wchar_t* yc_fs_get_current_dir(void) {\n'
  result += '    wchar_t* cwd = _wgetcwd(NULL, 0);\n'
  result += '    if (!cwd) return yc_wcsdup_text(L"");\n'
  result += '    return cwd;\n'
  result += '}\n\n'
  result += 'static int yc_fs_create_dir(const wchar_t* path) {\n'
  result += '    if (!path || !path[0]) return 0;\n'
  result += '    std::error_code ec;\n'
  result += '    if (ycfs::exists(ycfs::path(path), ec)) return 1;\n'
  result += '    return ycfs::create_directories(ycfs::path(path), ec) ? 1 : 0;\n'
  result += '}\n\n'
  result += 'static int yc_fs_remove_dir_all(const wchar_t* path) {\n'
  result += '    if (!path || !path[0]) return 0;\n'
  result += '    std::error_code ec;\n'
  result += '    return ycfs::remove_all(ycfs::path(path), ec) > 0 ? 1 : 0;\n'
  result += '}\n\n'
  result += 'static int yc_fs_copy_file(const wchar_t* src, const wchar_t* dst) {\n'
  result += '    if (!src || !src[0] || !dst || !dst[0]) return 0;\n'
  result += '    return CopyFileW(src, dst, FALSE) ? 1 : 0;\n'
  result += '}\n\n'
  result += 'static int yc_fs_move_file(const wchar_t* src, const wchar_t* dst) {\n'
  result += '    if (!src || !src[0] || !dst || !dst[0]) return 0;\n'
  result += '    return MoveFileExW(src, dst, MOVEFILE_REPLACE_EXISTING | MOVEFILE_COPY_ALLOWED) ? 1 : 0;\n'
  result += '}\n\n'
  result += 'static int yc_fs_delete_file(const wchar_t* path) {\n'
  result += '    if (!path || !path[0]) return 0;\n'
  result += '    return DeleteFileW(path) ? 1 : 0;\n'
  result += '}\n\n'
  result += 'static int yc_fs_rename_path(const wchar_t* src, const wchar_t* dst) {\n'
  result += '    if (!src || !src[0] || !dst || !dst[0]) return 0;\n'
  result += '    return MoveFileExW(src, dst, MOVEFILE_REPLACE_EXISTING) ? 1 : 0;\n'
  result += '}\n\n'
  result += 'static int yc_fs_file_exists(const wchar_t* path) {\n'
  result += '    DWORD attr;\n'
  result += '    if (!path || !path[0]) return 0;\n'
  result += '    attr = GetFileAttributesW(path);\n'
  result += '    return attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY) ? 1 : 0;\n'
  result += '}\n\n'
  result += 'static int yc_fs_file_len(const wchar_t* path) {\n'
  result += '    WIN32_FILE_ATTRIBUTE_DATA data;\n'
  result += '    ULARGE_INTEGER size;\n'
  result += '    if (!path || !path[0]) return -1;\n'
  result += '    if (!GetFileAttributesExW(path, GetFileExInfoStandard, &data)) return -1;\n'
  result += '    if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) return -1;\n'
  result += '    size.LowPart = data.nFileSizeLow;\n'
  result += '    size.HighPart = data.nFileSizeHigh;\n'
  result += '    return size.QuadPart > 2147483647ULL ? 2147483647 : (int)size.QuadPart;\n'
  result += '}\n\n'
  result += 'static int yc_fs_get_attr(const wchar_t* path) {\n'
  result += '    DWORD attr;\n'
  result += '    if (!path || !path[0]) return -1;\n'
  result += '    attr = GetFileAttributesW(path);\n'
  result += '    return attr == INVALID_FILE_ATTRIBUTES ? -1 : (int)attr;\n'
  result += '}\n\n'
  result += 'static int yc_fs_set_attr(const wchar_t* path, int attr) {\n'
  result += '    if (!path || !path[0]) return 0;\n'
  result += '    return SetFileAttributesW(path, (DWORD)attr) ? 1 : 0;\n'
  result += '}\n\n'
  result += 'static wchar_t* yc_fs_get_temp_file_name(const wchar_t* dir) {\n'
  result += '    wchar_t tempPath[MAX_PATH];\n'
  result += '    wchar_t tempFile[MAX_PATH];\n'
  result += '    DWORD pathLen = 0;\n'
  result += '    if (dir && dir[0]) {\n'
  result += '        wcsncpy(tempPath, dir, MAX_PATH - 1);\n'
  result += '        tempPath[MAX_PATH - 1] = L\'\\0\';\n'
  result += '    } else {\n'
  result += '        pathLen = GetTempPathW(MAX_PATH, tempPath);\n'
  result += '        if (pathLen == 0 || pathLen >= MAX_PATH) return yc_wcsdup_text(L"");\n'
  result += '    }\n'
  result += '    if (!GetTempFileNameW(tempPath, L"YCD", 0, tempFile)) return yc_wcsdup_text(L"");\n'
  result += '    DeleteFileW(tempFile);\n'
  result += '    return yc_wcsdup_text(tempFile);\n'
  result += '}\n\n'
  result += 'static YC_BIN yc_fs_read_file_bin(const wchar_t* path) {\n'
  result += '    YC_BIN out;\n'
  result += '    if (!path || !path[0]) return out;\n'
  result += '    std::ifstream in(ycfs::path(path), std::ios::binary);\n'
  result += '    if (!in) return out;\n'
  result += '    in.seekg(0, std::ios::end);\n'
  result += '    std::streamoff size = in.tellg();\n'
  result += '    if (size < 0) return out;\n'
  result += '    in.seekg(0, std::ios::beg);\n'
  result += '    out.resize((size_t)size);\n'
  result += '    if (size > 0) in.read((char*)out.data(), size);\n'
  result += '    if (!in && size > 0) out.clear();\n'
  result += '    return out;\n'
  result += '}\n\n'
  result += 'static int yc_fs_write_file_bins(const wchar_t* path, const std::vector<YC_BIN>& parts) {\n'
  result += '    if (!path || !path[0]) return 0;\n'
  result += '    std::ofstream out(ycfs::path(path), std::ios::binary | std::ios::trunc);\n'
  result += '    if (!out) return 0;\n'
  result += '    for (const YC_BIN& part : parts) {\n'
  result += '        if (!part.empty()) out.write((const char*)part.data(), (std::streamsize)part.size());\n'
  result += '        if (!out) return 0;\n'
  result += '    }\n'
  result += '    return 1;\n'
  result += '}\n\n'
  result += 'static HANDLE g_yc_find_handle = INVALID_HANDLE_VALUE;\n'
  result += 'static WIN32_FIND_DATAW g_yc_find_data;\n'
  result += 'static int g_yc_find_attr = 0;\n'
  result += 'static int yc_fs_find_match(const WIN32_FIND_DATAW* data, int attr) {\n'
  result += '    int isDir;\n'
  result += '    int required = attr & ~FILE_ATTRIBUTE_DIRECTORY;\n'
  result += '    if (!data) return 0;\n'
  result += '    if (wcscmp(data->cFileName, L".") == 0 || wcscmp(data->cFileName, L"..") == 0) return 0;\n'
  result += '    isDir = (data->dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) ? 1 : 0;\n'
  result += '    if (attr == 0) return isDir ? 0 : 1;\n'
  result += '    if (isDir && !(attr & FILE_ATTRIBUTE_DIRECTORY)) return 0;\n'
  result += '    if (!isDir && (attr & FILE_ATTRIBUTE_DIRECTORY) && required == 0) return 0;\n'
  result += '    return ((int)data->dwFileAttributes & required) == required ? 1 : 0;\n'
  result += '}\n\n'
  result += 'static wchar_t* yc_fs_dir(const wchar_t* pattern, int attr) {\n'
  result += '    int firstCall = pattern && pattern[0];\n'
  result += '    if (firstCall) {\n'
  result += '        if (g_yc_find_handle != INVALID_HANDLE_VALUE) { FindClose(g_yc_find_handle); g_yc_find_handle = INVALID_HANDLE_VALUE; }\n'
  result += '        g_yc_find_attr = attr;\n'
  result += '        g_yc_find_handle = FindFirstFileW(pattern, &g_yc_find_data);\n'
  result += '        if (g_yc_find_handle == INVALID_HANDLE_VALUE) return yc_wcsdup_text(L"");\n'
  result += '        do {\n'
  result += '            if (yc_fs_find_match(&g_yc_find_data, g_yc_find_attr)) return yc_wcsdup_text(g_yc_find_data.cFileName);\n'
  result += '        } while (FindNextFileW(g_yc_find_handle, &g_yc_find_data));\n'
  result += '        FindClose(g_yc_find_handle);\n'
  result += '        g_yc_find_handle = INVALID_HANDLE_VALUE;\n'
  result += '        return yc_wcsdup_text(L"");\n'
  result += '    }\n'
  result += '    if (g_yc_find_handle == INVALID_HANDLE_VALUE) return yc_wcsdup_text(L"");\n'
  result += '    while (FindNextFileW(g_yc_find_handle, &g_yc_find_data)) {\n'
  result += '        if (yc_fs_find_match(&g_yc_find_data, g_yc_find_attr)) return yc_wcsdup_text(g_yc_find_data.cFileName);\n'
  result += '    }\n'
  result += '    FindClose(g_yc_find_handle);\n'
  result += '    g_yc_find_handle = INVALID_HANDLE_VALUE;\n'
  result += '    return yc_wcsdup_text(L"");\n'
  result += '}\n\n'

  result += generateProjectDataTypeStructCode(projectDataTypes)

  if (projectGlobals.length > 0) {
    result += '/* 项目全局变量声明 */\n'
    for (const gv of projectGlobals) {
      result += `extern ${mapTypeToCType(gv.type)} ${gv.name};\n`
    }
    result += '\n'
  }

  if (libraryConstants.length > 0) {
    result += '/* 支持库常量定义 */\n'
    for (const c of libraryConstants) {
      result += `#define ${c.name} (${toCLibraryConstantValue(c)})\n`
    }
    result += '\n'
  }

  if (projectConstants.length > 0) {
    result += '/* 项目常量定义 */\n'
    for (const c of projectConstants) {
      const cValue = replaceConstantRefs(convertFullWidthOps((c.value || '0').trim() || '0'))
      if (libraryConstants.some(lc => lc.name === c.name)) {
        result += `#undef ${c.name}\n`
      }
      result += `#define ${c.name} (${cValue})\n`
    }
    result += '\n'
  }

  if (projectResources.length > 0) {
    const validIdentifier = /^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_]*$/
    result += '/* Project resource reference macros (#name -> YC_BIN) */\n'
    for (const r of projectResources) {
      const resourceName = (r.name || '').trim()
      if (!resourceName) continue
      if (!validIdentifier.test(resourceName)) {
        sendMessage({ type: 'warning', text: `警告: 资源名“${resourceName}”不是合法标识符，无法用于 #资源引用。` })
        continue
      }
      if (libraryConstants.some(lc => lc.name === resourceName) || projectConstants.some(c => c.name === resourceName)) {
        result += `#undef ${resourceName}\n`
      }
      result += `#define ${resourceName} (yc_load_resource_bin(L"${escapeCString(resourceName)}"))\n`
    }
    result += '\n'
  }

  if (projectDllCommands.length > 0) {
    result += generateProjectDllWrapperCode(projectDllCommands)
  }

  // ---- 项目类模块：struct 声明（成员变量 + 方法签名），方法体在各自类模块 cpp 中定义 ----
  const classMethodsByName = new Map<string, SubprogramDef[]>()
  for (const sub of projectSubprograms) {
    if (!sub.isClassModule || !sub.className) continue
    const list = classMethodsByName.get(sub.className) || []
    list.push(sub)
    classMethodsByName.set(sub.className, list)
  }
  const buildMethodSignature = (params: Array<{ name: string; type: string }>): string => {
    if (params.length === 0) return 'void'
    return params.map(p => `${mapTypeToCType(p.type)} ${p.name}`).join(', ')
  }
  const methodReturnC = (returnType: string): string => (returnType ? mapTypeToCType(returnType) : 'void')
  if (projectClassModules.length > 0) {
    result += '/* 项目类模块声明 */\n'
    for (const cls of projectClassModules) {
      result += `struct ${cls.className} {\n`
      for (const mv of cls.memberVars) {
        result += `    ${mapTypeToCType(mv.type)} ${mv.name} = ${getTypeDefaultInitializer(mv.type)};\n`
      }
      result += `    ${cls.className}();\n`
      result += `    ~${cls.className}();\n`
      for (const m of classMethodsByName.get(cls.className) || []) {
        result += `    ${methodReturnC(m.returnType)} ${m.name}(${buildMethodSignature(m.params)});\n`
      }
      result += '};\n'
      result += `static wchar_t* yc_value_to_text(const ${cls.className}&) { return (wchar_t*)L"<${cls.className}>"; }\n\n`
    }
  }

  const externalSubprograms = projectSubprograms.filter(sub => !sub.isClassModule)
  if (externalSubprograms.length > 0) {
    result += '/* 项目子程序前置声明 */\n'
    for (const sub of externalSubprograms) {
      const params = sub.params.length === 0
        ? 'void'
        : sub.params.map(p => `${mapTypeToCType(p.type)} ${p.name}`).join(', ')
      result += `extern ${methodReturnC(sub.returnType)} ${sub.name}(${params});\n`
    }
    result += '\n'
  }

  // ---- 第一遍：收集并输出 自定义数据类型 ----
  if (false) {
    let inDataType = false
    let structName = ''
    let structFields = ''
    for (const rawLine of lines) {
      const line = rawLine.replace(/[\u200B\u200C\u200D\u2060]/g, '').trim()
      if (line.startsWith('.数据类型 ')) {
        // 保存上一个结构体
        if (inDataType && structName) {
          result += `struct ${structName} {\n${structFields}};\n\n`
        }
        const parts = line.substring(5).split(',').map(s => s.trim())
        structName = parts[0] || 'UnknownType'
        structFields = ''
        inDataType = true
        continue
      }
      if (inDataType) {
        // 遇到新的块（子程序/程序集/版本）则结束当前结构体
      if (line.startsWith('.子程序 ') || line.startsWith('.程序集 ') || line.startsWith('.版本')) {
        result += `struct ${structName} {\n${structFields}};\n\n`
        inDataType = false
        structName = ''
        structFields = ''
        continue
        }
        if (line.startsWith('.成员 ')) {
          const parts = line.substring(3).split(',').map(s => s.trim())
          const fieldName = parts[0] || 'field'
          const fieldType = parts[1] || '整数型'
          structFields += `    ${mapTypeToCType(fieldType)} ${fieldName};\n`
        }
        // 其他行（注释等）跳过
      }
    }
    // 最后一个结构体
    if (inDataType && structName) {
      result += `struct ${structName} {\n${structFields}};\n\n`
    }
  }

  const breakpointLines = new Set<number>(breakpoints[fileName] || [])
  const projectDataTypeMap = new Map(projectDataTypes.map(dt => [dt.name, dt.fields]))
  const assemblyVars: Array<{ name: string; type: string }> = []
  let inSub = false
  let subName = ''
  let subReturnType = ''
  let currentClassName = ''
  const localClassSubNames = new Set<string>()
  let subParams: Array<{ name: string; type: string }> = []
  let subBody = ''
  let blockIndent = 1
  let flowStack: Array<{ name: string; lineNo: number; hasElse: boolean }> = []
  let loopTempIndex = 0
  let pendingBreakpointLine: number | null = null
  let visibleDebugVars: Array<{ name: string; type: string }> = []

  const buildSubSignature = (_name: string, params: Array<{ name: string; type: string }>): string => {
    if (params.length === 0) return 'void'
    return params.map(p => `${mapTypeToCType(p.type)} ${p.name}`).join(', ')
  }

  const flushCurrentSub = (): void => {
    const retC = subReturnType ? mapTypeToCType(subReturnType) : 'void'
    // 有返回值的子程序补默认返回，避免控制流落出函数末尾
    const tailReturn = subReturnType ? `    return ${getTypeDefaultInitializer(subReturnType)};\n` : ''
    if (isClassModuleSource && currentClassName) {
      // 类模块子程序输出为成员函数定义
      result += `${retC} ${currentClassName}::${subName}(${buildSubSignature(subName, subParams)}) {\n${subBody}${tailReturn}}\n\n`
      localClassSubNames.add(subName)
    } else {
      const storage = isClassModuleSource ? 'static ' : ''
      result += `${storage}${retC} ${subName}(${buildSubSignature(subName, subParams)}) {\n${subBody}${tailReturn}}\n\n`
    }
  }

  const appendSubLine = (code: string) => {
    subBody += `${'    '.repeat(Math.max(1, blockIndent))}${code}\n`
  }

  const pushVisibleDebugVar = (name: string, type: string) => {
    if (!name) return
    if (visibleDebugVars.some(v => v.name === name)) return
    visibleDebugVars.push({ name, type })
  }

  const resolveVisibleVarType = (name: string): string | undefined => {
    const target = (name || '').trim()
    if (!target) return undefined
    for (let i = visibleDebugVars.length - 1; i >= 0; i--) {
      if (visibleDebugVars[i].name === target) return visibleDebugVars[i].type
    }
    return undefined
  }

  const emitDebugVarSnapshot = (displayName: string, typeName: string, expr: string, depth = 0) => {
    const trimmedType = (typeName || '').trim()
    if (depth < 1) {
      const fields = projectDataTypeMap.get(trimmedType)
      if (fields && fields.length > 0) {
        for (const field of fields) {
          emitDebugVarSnapshot(`${displayName}.${field.name}`, field.type, `${expr}.${field.name}`, depth + 1)
        }
        return
      }
    }
    appendSubLine(`yc_dbg_emit_var("${escapeCString(displayName)}", "${escapeCString(trimmedType || 'unknown')}", ${expr});`)
  }

  const emitBreakpointProbe = (lineNo: number) => {
    appendSubLine(`yc_dbg_break_begin("${escapeCString(fileName)}", ${lineNo});`)
    for (const visibleVar of visibleDebugVars) {
      emitDebugVarSnapshot(visibleVar.name, visibleVar.type, visibleVar.name)
    }
    appendSubLine('yc_dbg_wait_for_resume();')
  }

  const emitSubLine = (code: string) => {
    if (pendingBreakpointLine !== null) {
      emitBreakpointProbe(pendingBreakpointLine)
      pendingBreakpointLine = null
    }
    appendSubLine(code)
  }

  const throwSourceError = (lineNo: number, message: string): never => {
    throw new Error(`${fileName}:${lineNo}: ${message}`)
  }

  const assertSubFlowClosed = (lineNo: number) => {
    const unclosed = flowStack[flowStack.length - 1]
    if (unclosed) {
      throwSourceError(lineNo, `${unclosed.lineNo} 行的 .${unclosed.name} 缺少结束语句`)
    }
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const rawLine = lines[lineIndex]
    pendingBreakpointLine = inSub && breakpointLines.has(lineIndex + 1) ? (lineIndex + 1) : null
    // 剥离流程标记零宽字符（\u200C/\u200D/\u2060/\u200B）与行尾单引号注释
    const line = stripTrailingEycComment(rawLine.replace(/[\u200B\u200C\u200D\u2060]/g, '').trim())
    if (line === '') continue

    if (!inSub && line.startsWith('.程序集变量 ')) {
      const parts = splitDeclParts(line.substring(6))
      const varName = parts[0] || 'assemblyVar'
      assemblyVars.push({ name: varName, type: parts[1] || '整数型' })
      const varType = parts[1] || '整数型'
      if (!isClassModuleSource) {
        result += `static ${mapTypeToCType(varType)} ${varName};\n`
      }
      continue
    }

    if (line.startsWith('.程序集 ')) {
      if (isClassModuleSource) {
        currentClassName = (splitDeclParts(line.substring(5))[0] || '').trim()
      }
      continue
    }

    if (line.startsWith('.版本')) continue

    if (line.startsWith('.子程序 ')) {
      // 如果之前有子程序，先输出
      if (inSub && subName) {
        assertSubFlowClosed(lineIndex + 1)
        flushCurrentSub()
      }
      const parts = line.substring(4).split(',').map(s => s.trim())
      subName = parts[0] || 'unnamed'
      subReturnType = (parts[1] || '').trim()
      subParams = []
      subBody = ''
      blockIndent = 1
      flowStack = []
      inSub = true
      visibleDebugVars = [
        ...projectGlobals.map(gv => ({ name: gv.name, type: gv.type })),
        ...assemblyVars.map(av => ({ name: av.name, type: av.type })),
      ]
      continue
    }

    if (inSub && line.startsWith('.参数 ')) {
      const parts = splitDeclParts(line.substring(3))
      const paramName = (parts[0] || '').trim()
      const paramType = (parts[1] || '整数型').trim()
      if (paramName) {
        subParams.push({ name: paramName, type: paramType })
        pushVisibleDebugVar(paramName, paramType)
      }
      continue
    }

    if (line.startsWith('.局部变量 ')) {
      const parts = splitDeclParts(line.substring(5))
      const varName = parts[0] || 'v'
      const varType = parts[1] || '整数型'
      emitSubLine(`${mapTypeToCType(varType)} ${varName} = ${getTypeDefaultInitializer(varType)};`)
      pushVisibleDebugVar(varName, varType)
      continue
    }

    if (!inSub && line.startsWith('.全局变量 ')) {
      const parts = splitDeclParts(line.substring(5))
      const varName = parts[0] || 'g'
      const varType = parts[1] || '整数型'
      result += `${mapTypeToCType(varType)} ${varName};\n`
      continue
    }

    if (inSub) {
      // 声明行跳过
      if (line.startsWith('.参数 ') || line.startsWith('.支持库 ')) {
        continue
      }

      // 流程控制语句
      if (line.startsWith('.')) {
        const flowCall = parseCommandCall(line.substring(1).trim())
        const flowName = flowCall?.name || ''

        if (flowName === '如果' || flowName === '如果真' || flowName === '判断') {
          const cond = formatArgForC(flowCall?.args?.[0] || '0', commandMap, directCallables)
          emitSubLine(`if ${wrapConditionForC(cond)} {`)
          blockIndent++
          flowStack.push({ name: flowName, lineNo: lineIndex + 1, hasElse: false })
          continue
        }

        if (flowName === '否则' || flowName === '默认') {
          const currentFlow = flowStack[flowStack.length - 1]
          const expectedStart = flowName === '默认' ? '判断' : '如果'
          if (!currentFlow || currentFlow.name !== expectedStart) {
            throwSourceError(lineIndex + 1, `.${flowName} 没有匹配的 .${expectedStart}`)
          }
          if (currentFlow.hasElse) {
            throwSourceError(lineIndex + 1, `.${currentFlow.name} 只能包含一个 .${flowName}`)
          }
          currentFlow.hasElse = true
          blockIndent = Math.max(1, blockIndent - 1)
          emitSubLine('} else {')
          blockIndent++
          continue
        }

        if (flowName === '如果结束' || flowName === '如果真结束' || flowName === '判断结束') {
          const currentFlow = flowStack[flowStack.length - 1]
          const expectedStart = flowName === '判断结束' ? '判断' : flowName === '如果真结束' ? '如果真' : '如果'
          if (!currentFlow || currentFlow.name !== expectedStart) {
            throwSourceError(lineIndex + 1, `.${flowName} 没有匹配的 .${expectedStart}`)
          }
          flowStack.pop()
          blockIndent = Math.max(1, blockIndent - 1)
          emitSubLine('}')
          continue
        }

        if (flowName === '计次循环首') {
          const countExpr = formatArgForC(flowCall?.args?.[0] || '0', commandMap, directCallables)
          const userVar = (flowCall?.args?.[1] || '').trim()
          // C++ 允许在 for 内部声明循环变量，避免重复声明问题
          const loopVar = userVar || `__loop_${loopTempIndex++}`
          const initDecl = userVar ? `${userVar} = 1` : `int64_t ${loopVar} = 1`
          emitSubLine(`for (${initDecl}; ${loopVar} <= (${countExpr}); ${loopVar}++) {`)
          blockIndent++
          continue
        }

        if (flowName === '计次循环尾') {
          blockIndent = Math.max(1, blockIndent - 1)
          emitSubLine('}')
          continue
        }

        if (flowName === '判断循环首') {
          const cond = formatArgForC(flowCall?.args?.[0] || '0', commandMap, directCallables)
          emitSubLine(`while ${wrapConditionForC(cond)} {`)
          blockIndent++
          continue
        }

        if (flowName === '判断循环尾') {
          blockIndent = Math.max(1, blockIndent - 1)
          emitSubLine('}')
          continue
        }

        if (flowName === '循环判断首') {
          emitSubLine('do {')
          blockIndent++
          continue
        }

        if (flowName === '循环判断尾') {
          const cond = formatArgForC(flowCall?.args?.[0] || '0', commandMap, directCallables)
          blockIndent = Math.max(1, blockIndent - 1)
          emitSubLine(`} while ${wrapConditionForC(cond)};`)
          continue
        }

        if (flowName === '变量循环首') {
          const startExpr = formatArgForC(flowCall?.args?.[0] || '1', commandMap, directCallables)
          const endExpr = formatArgForC(flowCall?.args?.[1] || '0', commandMap, directCallables)
          const stepExpr = formatArgForC(flowCall?.args?.[2] || '1', commandMap, directCallables)
          const userVar = (flowCall?.args?.[3] || '').trim()
          const loopVar = userVar || `__for_${loopTempIndex++}`
          const initExpr = userVar ? `${loopVar} = (${startExpr})` : `int64_t ${loopVar} = (${startExpr})`
          emitSubLine(`for (${initExpr}; ((${stepExpr}) >= 0 ? ${loopVar} <= (${endExpr}) : ${loopVar} >= (${endExpr})); ${loopVar} += (${stepExpr})) {`)
          blockIndent++
          continue
        }

        if (flowName === '变量循环尾') {
          blockIndent = Math.max(1, blockIndent - 1)
          emitSubLine('}')
          continue
        }

        if (flowName === '到循环尾') {
          emitSubLine('continue;')
          continue
        }

        if (flowName === '跳出循环') {
          emitSubLine('break;')
          continue
        }

        if (flowName === '返回') {
          const retArg = (flowCall?.args?.[0] || '').trim()
          if (retArg && subReturnType) {
            emitSubLine(`return ${formatArgForC(retArg, commandMap, directCallables)};`)
          } else {
            emitSubLine('return;')
          }
          continue
        }

        if (flowName === '结束') {
          emitSubLine('ExitProcess(0);')
          continue
        }
      }

      // 注释行
      if (line.startsWith("'")) {
        emitSubLine(`/* ${line.slice(1).trim()} */`)
        continue
      }

      // 赋值表达式：支持全角/半角等号
      const assignMatch = line.match(/^([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*)\s*[＝=]\s*(.+)$/)
      if (assignMatch) {
        const left = assignMatch[1]
        const rightRaw = assignMatch[2].trim()

        const propMatch = left.match(/^([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_]*)\.([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_]*)$/)
        // 地址 属性走窗口文本通道（浏览框 WM_SETTEXT 即导航）
        const isTextProp = !!propMatch && (propMatch[2] === '内容' || propMatch[2] === '文本' || propMatch[2] === '标题' || propMatch[2] === '地址' || propMatch[2].toLowerCase() === 'text')

        const rhsCall = parseCommandCall(rightRaw)
        const rhsResolved = rhsCall ? commandMap.get(rhsCall.name) : undefined
        if (rhsCall && rhsResolved) {
          const exprGenerator = COMMAND_EXPR_GENERATORS[rhsResolved.name]
          if (exprGenerator) {
            const expr = exprGenerator(rhsCall.args || [], commandMap, directCallables)
            if (propMatch && isTextProp) {
              // 数值等非文本表达式赋给控件文本属性时自动转文本（与文本变量赋值的处理一致）
              const textArg = isTextExpression(expr) ? expr : `yc_value_to_text(${expr})`
              emitSubLine(`yc_set_control_text(L"${escapeCString(propMatch[1])}", ${textArg});`)
            } else {
              emitSubLine(`${left} = ${expr};`)
            }
            continue
          }
          const assignCode = isYcmdNativeCommand(rhsResolved)
            ? `{ ${left} = ${generateYcmdNativeCommandExpr(rhsResolved, rhsCall.args || [], commandMap, directCallables)}; }`
            : generateYcGenericCommandAssign(rhsResolved, rhsCall.args || [], left)
          emitSubLine(assignCode)
          continue
        }

        const leftSimpleVarType = (() => {
          if (!/^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_]*$/.test(left)) return ''
          for (let i = visibleDebugVars.length - 1; i >= 0; i--) {
            if (visibleDebugVars[i].name === left) return (visibleDebugVars[i].type || '').trim()
          }
          return ''
        })()

        const right = translateExpressionToC(
          rightRaw,
          commandMap,
          directCallables,
          resolveVisibleVarType,
          leftSimpleVarType === '大整数型' || leftSimpleVarType === '大数',
        )

        if (leftSimpleVarType === '文本型' && (!isTextExpression(right) || isTextLiteralExpression(right))) {
          emitSubLine(`${left} = yc_value_to_text(${right});`)
          continue
        }

        if (propMatch) {
          const ctrlName = propMatch[1]
          const propName = propMatch[2]
          if (isTextProp) {
            // 数值等非文本表达式赋给控件文本属性时自动转文本（与文本变量赋值的处理一致）
            const textArg = isTextExpression(right) ? right : `yc_value_to_text(${right})`
            emitSubLine(`yc_set_control_text(L"${escapeCString(ctrlName)}", ${textArg});`)
            continue
          }
        }

        emitSubLine(`${left} = ${right};`)
        continue
      }

      const callableLine = line.startsWith('.') ? line.substring(1).trim() : line

      // 提取命令名并在支持库中查找
      const cmdName = extractCommandName(callableLine)
      const resolved = commandMap.get(cmdName)

      if (resolved) {
        // 命令在支持库中找到 - 解析参数并生成C代码
        const call = parseCommandCall(callableLine)
        const args = call ? call.args : []
        const cCode = generateCCodeForCommand(resolved, args, commandMap, directCallables)
        emitSubLine(cCode)
      } else {
        // 非支持库命令 - 尝试作为用户自定义子程序调用
        const call = parseCommandCall(callableLine)
        if (call && call.name) {
          const cArgs = call.args.map(a => formatArgForC(a, commandMap, directCallables)).join(', ')
          emitSubLine(`${call.name}(${cArgs});`)
        } else {
          emitSubLine(`/* ${line} */`)
        }
      }
    }
  }

  // 输出最后一个子程序
  if (inSub && subName) {
    assertSubFlowClosed(lines.length)
    flushCurrentSub()
  }

  // 类模块：构造/析构函数定义（自动调用 _初始化/_销毁）
  if (isClassModuleSource && currentClassName) {
    const hasInit = localClassSubNames.has('_初始化')
    const hasDestroy = localClassSubNames.has('_销毁')
    result += `${currentClassName}::${currentClassName}() {${hasInit ? ' _初始化();' : ''} }\n`
    result += `${currentClassName}::~${currentClassName}() {${hasDestroy ? ' _销毁();' : ''} }\n\n`
  }

  return result
}

// 生成 main.cpp 入口文件
function generateMainC(
  project: ProjectInfo,
  tempDir: string,
  editorFiles?: Map<string, string>,
  linkedLibraries?: Array<{ name: string; libraryPath: string; libName: string }>,
  commandDispatchLibs?: string[],
  debugBuild = false,
  breakpoints: Record<string, number[]> = {},
  targetPlatform: TargetPlatform = 'windows',
): string[] {
  const mainCPath = join(tempDir, 'main.cpp')
  const additionalCFiles: string[] = []
  const transpileCachePath = join(tempDir, '.transpile-cache.json')
  const metadataStartTime = Date.now()
  sendMessage({ type: 'info', text: '正在分析项目元数据...' })

  const cacheFile = (() => {
    try {
      if (!existsSync(transpileCachePath)) return null
      const raw = JSON.parse(readFileSync(transpileCachePath, 'utf-8')) as Partial<TranspileCacheFile>
      if (!raw || raw.version !== TRANSPILE_CACHE_VERSION || !raw.entries || typeof raw.entries !== 'object') return null
      return raw as TranspileCacheFile
    } catch {
      return null
    }
  })()
  const previousTranspileEntries = cacheFile?.entries || {}
  const nextTranspileEntries: Record<string, TranspileCacheEntry> = {}
  compileLogMark('生成C++: 读取转换缓存')

  let mainCode = '/* 由 ycIDE 自动生成 */\n'
  mainCode += `/* 项目名称: ${project.projectName} */\n\n`
  mainCode += '#include <windows.h>\n#include <commctrl.h>\n#include <stdint.h>\n#include <stdio.h>\n#include <string.h>\n#include <stdlib.h>\n#include <io.h>\n#include <fcntl.h>\n\n'
  mainCode += generateYcmdNativeDeclarations(targetPlatform)

  const isWindowsApp = project.outputType === 'WindowsApp'
  const projectMeta = resolveProjectCompileMetadata(project, editorFiles)
  const projectGlobals = projectMeta.globals
  const projectConstants = projectMeta.constants
  const projectResources = projectMeta.resources
  const projectSubprograms = projectMeta.subprograms
  const projectDataTypes = projectMeta.dataTypes
  const projectDllCommands = projectMeta.dllCommands
  const projectClassModules = projectMeta.classModules
  activeProjectCustomTypeNames = new Set(projectDataTypes.map(dt => dt.name))
  activeProjectClassNames = new Set(projectClassModules.map(c => c.className))
  const librariesForBuild = linkedLibraries || libraryManager.getLoadedLibraryFiles()
  const usedLibraryNames = new Set(librariesForBuild.map(l => l.name))
  const libraryConstants = collectLibraryConstants(usedLibraryNames)
  compileLogMark('生成C++: 收集支持库常量')
  sendMessage({ type: 'info', text: `项目元数据分析完成 (${formatElapsedDuration(Date.now() - metadataStartTime)})` })
  compileLogMark(`生成C++: 项目元数据分析完成(累计 ${Date.now() - metadataStartTime}ms)`)

  const transpileContextDigest = createHash('sha1').update(JSON.stringify({
    debugBuild,
    targetPlatform,
    outputType: project.outputType,
    globals: projectGlobals,
    constants: projectConstants,
    resources: projectResources,
    subprograms: projectSubprograms,
    dataTypes: projectDataTypes,
    dllCommands: projectDllCommands,
    classModules: projectClassModules,
    libraryConstants,
  })).digest('hex')
  compileLogMark('生成C++: 计算转换上下文指纹')

  const getBreakpointDigest = (fileName: string): string => {
    const points = breakpoints[fileName] || []
    if (points.length === 0) return ''
    const sorted = Array.from(new Set(points)).sort((a, b) => a - b)
    return sorted.join(',')
  }

  const transpileProjectFile = (
    fileName: string,
    content: string,
    constantsForFile: LibraryConstantDef[],
  ): void => {
    const cFileName = fileName.replace(/\.(eyc|ecc|egv|ecs|edt|ell)$/i, '.cpp')
    const cFilePath = join(tempDir, cFileName)
    const fingerprint = createHash('sha1').update([
      String(TRANSPILE_CACHE_VERSION),
      fileName,
      transpileContextDigest,
      getBreakpointDigest(fileName),
      JSON.stringify(constantsForFile),
      content,
    ].join('\n---\n')).digest('hex')

    const previous = previousTranspileEntries[fileName]
    if (previous && previous.fingerprint === fingerprint && existsSync(cFilePath)) {
      additionalCFiles.push(cFilePath)
      nextTranspileEntries[fileName] = { fingerprint, cFileName }
      sendMessage({ type: 'info', text: `复用已转换文件: ${cFileName}` })
      compileLogMark(`生成C++: 复用已转换文件 ${cFileName}`)
      return
    }

    sendMessage({ type: 'info', text: `正在转换源文件: ${fileName}` })
    const cCode = transpileEycContent(
      content,
      fileName,
      projectGlobals,
      projectConstants,
      projectResources,
      constantsForFile,
      projectSubprograms,
      projectDataTypes,
      projectDllCommands,
      debugBuild,
      breakpoints,
      targetPlatform,
      projectClassModules,
    )
    writeFileSync(cFilePath, cCode, 'utf-8')
    additionalCFiles.push(cFilePath)
    nextTranspileEntries[fileName] = { fingerprint, cFileName }
    sendMessage({ type: 'info', text: `已生成: ${cFileName}` })
    compileLogMark(`生成C++: 转换并写出 ${cFileName}`)
  }

  mainCode += '#define YC_SDT_BYTE 0x80000101u\n'
  mainCode += '#define YC_SDT_SHORT 0x80000201u\n'
  mainCode += '#define YC_SDT_INT 0x80000301u\n'
  mainCode += '#define YC_SDT_INT64 0x80000401u\n'
  mainCode += '#define YC_SDT_FLOAT 0x80000501u\n'
  mainCode += '#define YC_SDT_DOUBLE 0x80000601u\n'
  mainCode += '#define YC_SDT_BOOL 0x80000002u\n'
  mainCode += '#define YC_SDT_TEXT 0x80000004u\n\n'
  mainCode += 'typedef uint32_t YC_DATA_TYPE;\n'
  mainCode += 'typedef struct YC_MDATA_INF {\n'
  mainCode += '    union {\n'
  mainCode += '        unsigned char m_byte;\n'
  mainCode += '        short m_short;\n'
  mainCode += '        int m_int;\n'
  mainCode += '        long long m_int64;\n'
  mainCode += '        float m_float;\n'
  mainCode += '        double m_double;\n'
  mainCode += '        int m_bool;\n'
  mainCode += '        char* m_pText;\n'
  mainCode += '    };\n'
  mainCode += '    YC_DATA_TYPE m_dtDataType;\n'
  mainCode += '} YC_MDATA_INF;\n'
  mainCode += 'typedef void (*YC_PFN_EXECUTE_CMD)(YC_MDATA_INF* pRetData, int nArgCount, YC_MDATA_INF* pArgInf);\n\n'

  const staticCmdDispatchLibs = Array.from(new Set(commandDispatchLibs || []))
  const dispatchLibInfos = staticCmdDispatchLibs
    .map((libName) => ({ libName, lib: librariesForBuild.find(l => l.name === libName) }))
    .filter((x): x is { libName: string; lib: { name: string; libraryPath: string; libName: string } } => !!x.lib)

  mainCode += 'typedef INT_PTR (WINAPI *YC_PFN_NOTIFY_LIB)(INT nMsg, DWORD_PTR dwParam1, DWORD_PTR dwParam2);\n'
  mainCode += '#define NL_GET_CMD_FUNC_NAMES 14\n\n'
  mainCode += 'static YC_PFN_EXECUTE_CMD yc_resolve_cmd_from_module(HMODULE hMod, const char* notifyExport, int cmdIndex) {\n'
  mainCode += '    if (!hMod || !notifyExport || cmdIndex < 0) return NULL;\n'
  mainCode += '    FARPROC pNotify = GetProcAddress(hMod, notifyExport);\n'
  mainCode += '    if (!pNotify) return NULL;\n'
  mainCode += '    YC_PFN_NOTIFY_LIB notifyFn = (YC_PFN_NOTIFY_LIB)pNotify;\n'
  mainCode += '    const char** cmdNames = (const char**)notifyFn(NL_GET_CMD_FUNC_NAMES, 0, 0);\n'
  mainCode += '    if (!cmdNames) return NULL;\n'
  mainCode += '    const char* fnName = cmdNames[cmdIndex];\n'
  mainCode += '    if (!fnName || !fnName[0]) return NULL;\n'
  mainCode += '    return (YC_PFN_EXECUTE_CMD)GetProcAddress(hMod, fnName);\n'
  mainCode += '}\n\n'

  for (const info of dispatchLibInfos) {
    mainCode += `static HMODULE g_cmd_mod_${info.libName} = NULL;\n`
  }
  if (dispatchLibInfos.length > 0) mainCode += '\n'

  mainCode += 'extern "C" void yc_invoke_support_cmd(const char* libName, int cmdIndex, YC_MDATA_INF* pRetData, int argCount, YC_MDATA_INF* pArgs) {\n'
  mainCode += '    if (!libName || cmdIndex < 0) return;\n'
  mainCode += '    YC_PFN_EXECUTE_CMD fn = NULL;\n'
  for (const info of dispatchLibInfos) {
    const libPathEscaped = escapeCString(info.lib.libraryPath).replace(/"/g, '\\"')
    const notifyExport = `${info.libName}_ProcessNotifyLib_${info.libName}`
    mainCode += `    if (strcmp(libName, "${info.libName}") == 0) {\n`
    mainCode += `        if (!g_cmd_mod_${info.libName}) g_cmd_mod_${info.libName} = LoadLibraryW(L"${libPathEscaped}");\n`
    mainCode += `        fn = yc_resolve_cmd_from_module(g_cmd_mod_${info.libName}, "${notifyExport}", cmdIndex);\n`
    mainCode += '    }\n'
    mainCode += '    else '
  }
  if (dispatchLibInfos.length > 0) {
    mainCode += '{ }\n'
  }
  mainCode += '    if (!fn) return;\n'
  mainCode += '    fn(pRetData, argCount, pArgs);\n'
  mainCode += '}\n\n'

  if (isWindowsApp) {
    // 查找启动窗口文件
    let efwFile = project.files.find(f => f.fileName === '_启动窗口.efw')
    if (!efwFile) efwFile = project.files.find(f => f.type === 'EFW')

    const defaultWindowFormName = efwFile ? basename(efwFile.fileName, '.efw') : '_启动窗口'
    let winInfo: WindowFileInfo = { formName: defaultWindowFormName, width: 592, height: 384, title: project.projectName, visible: true, disabled: false, border: 2, maxButton: true, minButton: true, controlBox: true, topmost: false, startPos: 1, controls: [] }
    if (efwFile) {
      // 优先从编辑器内存中获取
      const editorContent = editorFiles?.get(efwFile.fileName)
      if (editorContent) {
        try {
          const data = JSON.parse(editorContent)
          winInfo.formName = (data.name || data.formName || defaultWindowFormName || '_启动窗口')
          winInfo.width = data.width || 592
          winInfo.height = data.height || 384
          winInfo.title = data.title || data.name || project.projectName
          const p = data.properties || {}
          if (p['可视'] === false) winInfo.visible = false
          if (p['禁止'] === true) winInfo.disabled = true
          if (typeof p['边框'] === 'number') winInfo.border = p['边框']
          if (p['最大化按钮'] === false) winInfo.maxButton = false
          if (p['最小化按钮'] === false) winInfo.minButton = false
          if (p['控制按钮'] === false) winInfo.controlBox = false
          if (p['总在最前'] === true) winInfo.topmost = true
          if (typeof p['位置'] === 'number') winInfo.startPos = p['位置']
          if (Array.isArray(data.controls)) {
            for (const c of data.controls) {
              const props = c.properties || {}
              winInfo.controls.push({
                type: c.type || '', name: c.name || '',
                x: c.x ?? c.left ?? 0, y: c.y ?? c.top ?? 0,
                width: c.width ?? 80, height: c.height ?? 24,
                text: resolveControlInitialText(c, props),
                visible: c.visible ?? true,
                disabled: c.enabled === false || props['禁止'] === true,
                extraProps: { ...props },
              })
            }
          }
        } catch { /* fall through to file */ }
      } else {
        winInfo = parseWindowFile(join(project.projectDir, efwFile.fileName))
      }
    }

    const windowEventTarget = (winInfo.formName || defaultWindowFormName || '_启动窗口').trim() || '_启动窗口'
    const windowEventPrefix = `_${windowEventTarget}`

    // 停留顺序决定控件创建顺序（Win32 Tab 焦点顺序 = 创建顺序），数值小者优先，相同时保持原序。
    // 注意：必须在所有按 winInfo.controls 顺序生成代码（IDC 宏/创建/事件分发）之前排序，保证 ctrlId 一致。
    winInfo.controls = winInfo.controls
      .map((c, i) => ({ c, i }))
      .sort((a, b) => (readIntProp(a.c.extraProps['停留顺序'], 0) - readIntProp(b.c.extraProps['停留顺序'], 0)) || (a.i - b.i))
      .map(x => x.c)

    // 全局变量
    mainCode += 'static const wchar_t* g_szClassName = L"ycIDEWindowClass";\n'
    mainCode += `static const wchar_t* g_szTitle = L"${winInfo.title}";\n`
    mainCode += `static int g_nWidth = ${winInfo.width};\n`
    mainCode += `static int g_nHeight = ${winInfo.height};\n`
    mainCode += 'static HINSTANCE g_hInstance;\n'
    mainCode += 'static HWND g_hMainWnd = NULL;\n\n'
    mainCode += '\n'

    // 控件ID
    if (winInfo.controls.length > 0) {
      mainCode += '/* 控件ID定义 */\n'
      let ctrlId = 1001
      for (const ctrl of winInfo.controls) {
        mainCode += `#define IDC_${ctrl.name.toUpperCase()} ${ctrlId++}\n`
      }
      mainCode += '\n'
    }

    mainCode += 'static HWND yc_get_control_handle_by_name(const wchar_t* ctrlName) {\n'
    mainCode += '    if (!ctrlName || !g_hMainWnd) return NULL;\n'
    for (const ctrl of winInfo.controls) {
      mainCode += `    if (lstrcmpW(ctrlName, L"${escapeCString(ctrl.name)}") == 0) return GetDlgItem(g_hMainWnd, IDC_${ctrl.name.toUpperCase()});\n`
    }
    mainCode += '    return NULL;\n'
    mainCode += '}\n\n'

    mainCode += 'static wchar_t* g_yc_text_buffers[4] = { NULL, NULL, NULL, NULL };\n'
    mainCode += 'static int g_yc_text_buffer_sizes[4] = { 0, 0, 0, 0 };\n'
    mainCode += 'static int g_yc_text_buffer_index = 0;\n\n'
    mainCode += 'const wchar_t* yc_get_control_text(const wchar_t* ctrlName) {\n'
    mainCode += '    HWND hCtrl = yc_get_control_handle_by_name(ctrlName);\n'
    mainCode += '    if (!hCtrl) return L"";\n'
    mainCode += '    int slot = g_yc_text_buffer_index++ % 4;\n'
    mainCode += '    int len = GetWindowTextLengthW(hCtrl);\n'
    mainCode += '    int need = len + 1;\n'
    mainCode += '    if (need < 1) need = 1;\n'
    mainCode += '    if (g_yc_text_buffer_sizes[slot] < need) {\n'
    mainCode += '        wchar_t* resized = (wchar_t*)realloc(g_yc_text_buffers[slot], sizeof(wchar_t) * (size_t)need);\n'
    mainCode += '        if (!resized) return L"";\n'
    mainCode += '        g_yc_text_buffers[slot] = resized;\n'
    mainCode += '        g_yc_text_buffer_sizes[slot] = need;\n'
    mainCode += '    }\n'
    mainCode += '    g_yc_text_buffers[slot][0] = L\'\\0\';\n'
    mainCode += '    GetWindowTextW(hCtrl, g_yc_text_buffers[slot], need);\n'
    mainCode += '    return g_yc_text_buffers[slot];\n'
    mainCode += '}\n\n'

    mainCode += 'int yc_text_compare(const wchar_t* left, const wchar_t* right) {\n'
    mainCode += '    const wchar_t* lhs = left ? left : L"";\n'
    mainCode += '    const wchar_t* rhs = right ? right : L"";\n'
    mainCode += '    return lstrcmpW(lhs, rhs);\n'
    mainCode += '}\n\n'

    mainCode += 'int yc_text_starts_with(const wchar_t* text, const wchar_t* prefix) {\n'
    mainCode += '    const wchar_t* src = text ? text : L"";\n'
    mainCode += '    const wchar_t* pre = prefix ? prefix : L"";\n'
    mainCode += '    size_t preLen = wcslen(pre);\n'
    mainCode += '    return wcsncmp(src, pre, preLen) == 0 ? 1 : 0;\n'
    mainCode += '}\n\n'

    mainCode += 'void yc_set_control_text(const wchar_t* ctrlName, const wchar_t* text) {\n'
    mainCode += '    HWND hCtrl = yc_get_control_handle_by_name(ctrlName);\n'
    mainCode += '    if (!hCtrl) return;\n'
    mainCode += '    SetWindowTextW(hCtrl, text ? text : L"");\n'
    mainCode += '}\n\n'

    // 前向声明 .eyc 中的子程序
    // 查找关联的 .eyc 文件并转译
    for (const f of project.files) {
      if (f.type !== 'EYC' && f.type !== 'EGV' && f.type !== 'ECS' && f.type !== 'EDT' && f.type !== 'ELL') continue
      const eycPath = join(project.projectDir, f.fileName)
      const editorContent = editorFiles?.get(f.fileName)
      const content = editorContent || (existsSync(eycPath) ? readFileSync(eycPath, 'utf-8') : '')
      if (!content) continue

      transpileProjectFile(f.fileName, content, libraryConstants)
    }
    compileLogMark('  组装: 二次转译 .eyc(前向声明)')

    const allUnits = libraryManager.getAllWindowUnits()
    const compileProtocols = loadCompileProtocols()
    const protocolBindings = compileProtocols.events
    const controlProtocolBindings = compileProtocols.controls
    const loadedLibs = libraryManager.getCachedList().filter(l => l.loaded)
    const libNameToFileName = new Map<string, string>()
    for (const lib of loadedLibs) {
      libNameToFileName.set(normalizeKey(lib.libName || ''), lib.name)
      libNameToFileName.set(normalizeKey(lib.name), lib.name)
    }
    compileLogMark('  组装: getAllWindowUnits/loadCompileProtocols/getList')

    // 编辑框颜色表：WM_CTLCOLOREDIT/WM_CTLCOLORSTATIC 按控件 ID 查表上色（只读编辑框走 STATIC 通道）
    const editColorEntries: Array<{ idMacro: string; textColor: number; backColor: number }> = []
    let anyEditNeedsInputFilter = false
    {
      for (const ctrl of winInfo.controls) {
        const unitInfo = allUnits.find(u => u.name === ctrl.type || u.englishName === ctrl.type)
        const libraryFileName = unitInfo ? (libNameToFileName.get(normalizeKey(unitInfo.libraryName)) || '') : ''
        const className = resolveControlClassName(ctrl.type, unitInfo, libraryFileName, controlProtocolBindings)
        if (className !== 'EDIT') continue
        const editCodegenInfo = buildStdEditCodegen(ctrl.extraProps)
        if (editCodegenInfo.colorEntry) {
          editColorEntries.push({ idMacro: `IDC_${ctrl.name.toUpperCase()}`, ...editCodegenInfo.colorEntry })
        }
        if (editCodegenInfo.needsInputFilter) anyEditNeedsInputFilter = true
      }
    }
    if (anyEditNeedsInputFilter) {
      // 输入方式 3~11 的字符过滤：整数/小数/日期时间等模式按字符集放行，其余字符蜂鸣拒绝
      mainCode += '/* 编辑框输入方式字符过滤 */\n'
      mainCode += 'static LRESULT CALLBACK YcEditInputFilterProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam, UINT_PTR uIdSubclass, DWORD_PTR dwRefData) {\n'
      mainCode += '    if (message == WM_CHAR) {\n'
      mainCode += '        wchar_t ch = (wchar_t)wParam;\n'
      mainCode += '        if (ch >= 0x20) {\n'
      mainCode += '            int mode = (int)dwRefData;\n'
      mainCode += '            int ok = (ch >= L\'0\' && ch <= L\'9\');\n'
      mainCode += '            if (!ok && ch == L\'-\' && mode != 5) ok = 1;\n'
      mainCode += '            if (!ok && ch == L\'.\' && (mode == 4 || mode == 9 || mode == 10 || mode == 11)) ok = 1;\n'
      mainCode += '            if (!ok && mode == 11 && (ch == L\'/\' || ch == L\':\' || ch == L\' \')) ok = 1;\n'
      mainCode += '            if (!ok) { MessageBeep(MB_OK); return 0; }\n'
      mainCode += '        }\n'
      mainCode += '    }\n'
      mainCode += '    return DefSubclassProc(hWnd, message, wParam, lParam);\n'
      mainCode += '}\n\n'
    }
    if (editColorEntries.length > 0) {
      mainCode += '/* 编辑框自定义颜色表 */\n'
      mainCode += 'typedef struct { int id; COLORREF textColor; COLORREF backColor; HBRUSH brush; } YcEditColorEntry;\n'
      mainCode += 'static YcEditColorEntry g_ycEditColors[] = {\n'
      for (const entry of editColorEntries) {
        mainCode += `    { ${entry.idMacro}, (COLORREF)${entry.textColor}, (COLORREF)${entry.backColor}, NULL },\n`
      }
      mainCode += '};\n\n'
    }

    // 创建控件函数
    mainCode += '/* 创建所有控件 */\n'
    mainCode += 'void CreateControls(HWND hWndParent) {\n'
    mainCode += '    HFONT hFont = (HFONT)GetStockObject(DEFAULT_GUI_FONT);\n'
    mainCode += '    HWND hCtrl;\n'

    let ctrlId = 1001
    for (const ctrl of winInfo.controls) {
      const unitInfo = allUnits.find(u => u.name === ctrl.type || u.englishName === ctrl.type)
      const libraryFileName = unitInfo ? (libNameToFileName.get(normalizeKey(unitInfo.libraryName)) || '') : ''
      const className = resolveControlClassName(ctrl.type, unitInfo, libraryFileName, controlProtocolBindings)
      const isStdEdit = className === 'EDIT'
      const editCodegen = isStdEdit ? buildStdEditCodegen(ctrl.extraProps) : null
      const baseStyle = editCodegen ? editCodegen.style : resolveControlStyle(ctrl.type, unitInfo, libraryFileName, controlProtocolBindings)
      const exStyle = editCodegen ? editCodegen.exStyle : '0'
      const visFlag = ctrl.visible ? ' | WS_VISIBLE' : ''
      const disFlag = ctrl.disabled ? ' | WS_DISABLED' : ''
      const style = `${baseStyle}${visFlag}${disFlag}`
      const isEditLike =
        className === 'EDIT'
        || className === 'YcWebView2Host'
        || className === 'YcWebEdit'
        || ctrl.type === '编辑框'
        || ctrl.type === '超级编辑框'
        || ctrl.type === '文本框'
        || ctrl.type === '浏览框'
        || ctrl.type === '网页编辑框'
        || ctrl.type === 'Edit'
        || ctrl.type === 'TextBox'
      const text = isEditLike ? (ctrl.text || '') : (ctrl.text || ctrl.name)
      mainCode += `    hCtrl = CreateWindowExW(${exStyle}, L"${className}", L"${text}",\n`
      mainCode += `        ${style},\n`
      mainCode += `        ${ctrl.x}, ${ctrl.y}, ${ctrl.width}, ${ctrl.height},\n`
      mainCode += `        hWndParent, (HMENU)${ctrlId++}, g_hInstance, NULL);\n`
      mainCode += '    SendMessage(hCtrl, WM_SETFONT, (WPARAM)hFont, TRUE);\n'
      if (editCodegen) {
        // 标准 EDIT：属性已落成创建样式，动态属性用 EM_* 消息补齐，不走 WCM_SETPROP
        for (const line of editCodegen.postCreateLines) {
          mainCode += `    ${line}\n`
        }
      } else if (unitInfo && Object.keys(ctrl.extraProps).length > 0) {
        // 通用窗口组件属性：通过标准 WCM_SETPROP 协议 (WM_APP+1) 设置
        // wParam = 属性在 FNE 元数据中的声明索引，lParam = 属性值
        // 任何按此协议实现 WndProc 的第三方组件库均自动支持
        for (let pi = 0; pi < unitInfo.properties.length; pi++) {
          const prop = unitInfo.properties[pi]
          const value = ctrl.extraProps[prop.name]
          if (value === undefined) continue
          if (prop.typeName === '文本型') continue  // 文本由 CreateWindowExW 第3参数处理
          let lparamCode: string
          if (prop.typeName === '逻辑型') {
            lparamCode = (value === true || value === '真') ? 'TRUE' : 'FALSE'
          } else {
            lparamCode = typeof value === 'number' ? String(value) : '0'
          }
          mainCode += `    SendMessage(hCtrl, WM_APP + 1, ${pi}, (LPARAM)${lparamCode});\n`
        }
      }
      mainCode += '\n'
    }
    mainCode += '}\n\n'

    // 弱链接事件处理函数
    type CommandEventBinding = { ctrlName: string; notifyCode: string; handlerName: string }
    type NotifyEventBinding = { ctrlName: string; notifyCode: string; handlerName: string }
    type ScrollEventBinding = { ctrlName: string; message: 'WM_HSCROLL' | 'WM_VSCROLL'; handlerName: string }
    const commandEventBindings: CommandEventBinding[] = []
    const notifyEventBindings: NotifyEventBinding[] = []
    const scrollEventBindings: ScrollEventBinding[] = []
    const unresolvedEvents = new Set<string>()

    for (const ctrl of winInfo.controls) {
      const unit = allUnits.find(u => u.name === ctrl.type || u.englishName === ctrl.type)
      const libraryFileName = unit ? (libNameToFileName.get(normalizeKey(unit.libraryName)) || '') : ''
      const className = resolveControlClassName(ctrl.type, unit, libraryFileName, controlProtocolBindings)
      const events = unit?.events || []
      for (const ev of events) {
        const handlerName = `_${ctrl.name.replace(/^_+/, '')}_${ev.name}`
        const proto = resolveEventByProtocol(
          protocolBindings,
          libraryFileName,
          unit?.name || ctrl.type,
          unit?.englishName || '',
          ev.name,
        )

        if (proto) {
          if (proto.channel === 'WM_COMMAND') {
            commandEventBindings.push({ ctrlName: ctrl.name, notifyCode: proto.code, handlerName })
            continue
          }
          if (proto.channel === 'WM_NOTIFY') {
            notifyEventBindings.push({ ctrlName: ctrl.name, notifyCode: proto.code, handlerName })
            continue
          }
          if (proto.channel === 'WM_HSCROLL' || proto.channel === 'WM_VSCROLL') {
            scrollEventBindings.push({ ctrlName: ctrl.name, message: proto.channel, handlerName })
            continue
          }
        }

        const notifyCode = resolveCommandNotifyCode(className, ev.name)
        if (notifyCode) {
          commandEventBindings.push({ ctrlName: ctrl.name, notifyCode, handlerName })
          continue
        }
        const nmCode = resolveNotifyCode(className, ev.name)
        if (nmCode) {
          notifyEventBindings.push({ ctrlName: ctrl.name, notifyCode: nmCode, handlerName })
          continue
        }
        const scrollMsg = resolveScrollMessage(className, ev.name)
        if (scrollMsg) {
          scrollEventBindings.push({ ctrlName: ctrl.name, message: scrollMsg, handlerName })
          continue
        }

        const unresolvedKey = `${ctrl.type}:${ev.name}`
        if (!unresolvedEvents.has(unresolvedKey)) {
          unresolvedEvents.add(unresolvedKey)
          sendMessage({ type: 'warning', text: `未解析事件绑定: 组件「${ctrl.type}」事件「${ev.name}」，请在支持库协议中补充 eventBindings` })
        }
      }
    }

    // 去重：支持库元数据或协议重复时，避免同一事件处理函数被重复分发调用。
    const seenCommandBindings = new Set<string>()
    const uniqueCommandEventBindings = commandEventBindings.filter(b => {
      const key = `${b.ctrlName}|${b.notifyCode}|${b.handlerName}`
      if (seenCommandBindings.has(key)) return false
      seenCommandBindings.add(key)
      return true
    })
    const seenNotifyBindings = new Set<string>()
    const uniqueNotifyEventBindings = notifyEventBindings.filter(b => {
      const key = `${b.ctrlName}|${b.notifyCode}|${b.handlerName}`
      if (seenNotifyBindings.has(key)) return false
      seenNotifyBindings.add(key)
      return true
    })
    const seenScrollBindings = new Set<string>()
    const uniqueScrollEventBindings = scrollEventBindings.filter(b => {
      const key = `${b.ctrlName}|${b.message}|${b.handlerName}`
      if (seenScrollBindings.has(key)) return false
      seenScrollBindings.add(key)
      return true
    })

    mainCode += '/* 事件处理函数默认实现 */\n'
    mainCode += '#define WEAK_FUNC __attribute__((weak))\n'

    // 兼容历史按钮事件命名
    const isClickable = (t: string) => ['Button', '按钮', 'ycUI按钮', '网页按钮', 'WebButton'].includes(t)
    const declaredHandlers = new Set<string>()
    for (const ctrl of winInfo.controls) {
      if (isClickable(ctrl.type)) {
        mainCode += `WEAK_FUNC void ${ctrl.name}_被单击(void) { }\n`
        const compatHandlerName = `_${ctrl.name.replace(/^_+/, '')}_被单击`
        mainCode += `WEAK_FUNC void ${compatHandlerName}(void) { ${ctrl.name}_被单击(); }\n`
        declaredHandlers.add(compatHandlerName)
      }
    }

    for (const b of uniqueCommandEventBindings) {
      if (declaredHandlers.has(b.handlerName)) continue
      declaredHandlers.add(b.handlerName)
      mainCode += `WEAK_FUNC void ${b.handlerName}(void) { }\n`
    }
    for (const b of uniqueNotifyEventBindings) {
      if (declaredHandlers.has(b.handlerName)) continue
      declaredHandlers.add(b.handlerName)
      mainCode += `WEAK_FUNC void ${b.handlerName}(void) { }\n`
    }
    for (const b of uniqueScrollEventBindings) {
      if (declaredHandlers.has(b.handlerName)) continue
      declaredHandlers.add(b.handlerName)
      mainCode += `WEAK_FUNC void ${b.handlerName}(void) { }\n`
    }

    mainCode += `WEAK_FUNC void ${windowEventPrefix}_创建完毕(void) { }\n`
    mainCode += `WEAK_FUNC void ${windowEventPrefix}_按下某键(int 键代码, int 功能键状态) { }\n`
    mainCode += `WEAK_FUNC void ${windowEventPrefix}_某键被放开(int 键代码, int 功能键状态) { }\n`
    mainCode += `WEAK_FUNC void ${windowEventPrefix}_窗口尺寸被改变(int 宽度, int 高度) { }\n`
    mainCode += `WEAK_FUNC void ${windowEventPrefix}_被移动(int 左边, int 顶边) { }\n`
    mainCode += `WEAK_FUNC void ${windowEventPrefix}_被激活(int 激活状态) { }\n`
    mainCode += `WEAK_FUNC void ${windowEventPrefix}_得到焦点(void) { }\n`
    mainCode += `WEAK_FUNC void ${windowEventPrefix}_失去焦点(void) { }\n`
    mainCode += `WEAK_FUNC void ${windowEventPrefix}_即将被销毁(void) { }\n`
    mainCode += `WEAK_FUNC void ${windowEventPrefix}_被销毁(void) { }\n`

    // 窗口过程
    mainCode += '/* 窗口过程函数 */\n'
    mainCode += 'LRESULT CALLBACK WndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam) {\n'
    mainCode += '    switch (message) {\n'
    mainCode += '    case WM_CREATE:\n'
    // 创建完毕事件里会按名操作控件（yc_set_control_text 等依赖 g_hMainWnd），
    // 此时 CreateWindowExW 尚未返回，必须先在这里完成赋值
    mainCode += '        g_hMainWnd = hWnd;\n'
    mainCode += '        CreateControls(hWnd);\n'
    mainCode += `        ${windowEventPrefix}_创建完毕();\n`
    mainCode += '        break;\n'
    mainCode += '    case WM_COMMAND: {\n'
    mainCode += '        int wmId = LOWORD(wParam);\n'
    mainCode += '        int wmEvent = HIWORD(wParam);\n'
    mainCode += '        switch (wmId) {\n'

    ctrlId = 1001
    for (const ctrl of winInfo.controls) {
      const bindings = uniqueCommandEventBindings.filter(b => b.ctrlName === ctrl.name)
      const hasCompatClick = isClickable(ctrl.type)
      const compatClickHandler = `_${ctrl.name.replace(/^_+/, '')}_被单击`
      const hasCompatClickBinding = bindings.some(b => b.notifyCode === 'BN_CLICKED' && b.handlerName === compatClickHandler)
      if (bindings.length > 0 || hasCompatClick) {
        mainCode += `        case IDC_${ctrl.name.toUpperCase()}:\n`
        if (hasCompatClick && !hasCompatClickBinding) {
          mainCode += '            if (wmEvent == BN_CLICKED) {\n'
          mainCode += `                ${compatClickHandler}();\n`
          mainCode += '            }\n'
        }
        for (const b of bindings) {
          mainCode += `            if (wmEvent == ${b.notifyCode}) { ${b.handlerName}(); }\n`
        }
        mainCode += '            break;\n'
      }
      ctrlId++
    }

    mainCode += '        }\n'
    mainCode += '        break;\n'
    mainCode += '    }\n'
    mainCode += '    case WM_NOTIFY: {\n'
    mainCode += '        LPNMHDR pnm = (LPNMHDR)lParam;\n'
    mainCode += '        if (!pnm) break;\n'
    mainCode += '        switch ((int)pnm->idFrom) {\n'

    ctrlId = 1001
    for (const ctrl of winInfo.controls) {
      const bindings = uniqueNotifyEventBindings.filter(b => b.ctrlName === ctrl.name)
      if (bindings.length > 0) {
        mainCode += `        case IDC_${ctrl.name.toUpperCase()}:\n`
        for (const b of bindings) {
          mainCode += `            if (pnm->code == ${b.notifyCode}) { ${b.handlerName}(); }\n`
        }
        mainCode += '            break;\n'
      }
      ctrlId++
    }

    mainCode += '        }\n'
    mainCode += '        break;\n'
    mainCode += '    }\n'
    mainCode += '    case WM_HSCROLL:\n'
    mainCode += '    case WM_VSCROLL: {\n'
    mainCode += '        HWND hScroll = (HWND)lParam;\n'
    mainCode += '        if (!hScroll) break;\n'
    mainCode += '        int sid = GetDlgCtrlID(hScroll);\n'
    mainCode += '        switch (sid) {\n'

    ctrlId = 1001
    for (const ctrl of winInfo.controls) {
      const bindings = uniqueScrollEventBindings.filter(b => b.ctrlName === ctrl.name)
      if (bindings.length > 0) {
        mainCode += `        case IDC_${ctrl.name.toUpperCase()}:\n`
        for (const b of bindings) {
          const cond = b.message === 'WM_HSCROLL' ? 'message == WM_HSCROLL' : 'message == WM_VSCROLL'
          mainCode += `            if (${cond}) { ${b.handlerName}(); }\n`
        }
        mainCode += '            break;\n'
      }
      ctrlId++
    }

    mainCode += '        default:\n'
    mainCode += '            break;\n'
    mainCode += '        }\n'
    mainCode += '        break;\n'
    mainCode += '    }\n'
    if (editColorEntries.length > 0) {
      mainCode += '    case WM_CTLCOLOREDIT:\n'
      mainCode += '    case WM_CTLCOLORSTATIC: {\n'
      mainCode += '        int colorCtrlId = GetDlgCtrlID((HWND)lParam);\n'
      mainCode += '        for (size_t ci = 0; ci < sizeof(g_ycEditColors) / sizeof(g_ycEditColors[0]); ci++) {\n'
      mainCode += '            if (g_ycEditColors[ci].id != colorCtrlId) continue;\n'
      mainCode += '            SetTextColor((HDC)wParam, g_ycEditColors[ci].textColor);\n'
      mainCode += '            SetBkColor((HDC)wParam, g_ycEditColors[ci].backColor);\n'
      mainCode += '            if (!g_ycEditColors[ci].brush) g_ycEditColors[ci].brush = CreateSolidBrush(g_ycEditColors[ci].backColor);\n'
      mainCode += '            return (LRESULT)g_ycEditColors[ci].brush;\n'
      mainCode += '        }\n'
      mainCode += '        break;\n'
      mainCode += '    }\n'
    }
    mainCode += '    case WM_PAINT: {\n'
    mainCode += '        PAINTSTRUCT ps;\n'
    mainCode += '        HDC hdc = BeginPaint(hWnd, &ps);\n'
    mainCode += '        EndPaint(hWnd, &ps);\n'
    mainCode += '        break;\n'
    mainCode += '    }\n'
    mainCode += '    case WM_KEYDOWN:\n'
    mainCode += '    case WM_SYSKEYDOWN:\n'
    mainCode += `        ${windowEventPrefix}_按下某键((int)wParam, (int)lParam);\n`
    mainCode += '        break;\n'
    mainCode += '    case WM_KEYUP:\n'
    mainCode += '    case WM_SYSKEYUP:\n'
    mainCode += `        ${windowEventPrefix}_某键被放开((int)wParam, (int)lParam);\n`
    mainCode += '        break;\n'
    mainCode += '    case WM_SIZE:\n'
    mainCode += `        ${windowEventPrefix}_窗口尺寸被改变((int)LOWORD(lParam), (int)HIWORD(lParam));\n`
    mainCode += '        break;\n'
    mainCode += '    case WM_MOVE:\n'
    mainCode += `        ${windowEventPrefix}_被移动((int)(short)LOWORD(lParam), (int)(short)HIWORD(lParam));\n`
    mainCode += '        break;\n'
    mainCode += '    case WM_ACTIVATE:\n'
    mainCode += `        ${windowEventPrefix}_被激活((int)LOWORD(wParam));\n`
    mainCode += '        break;\n'
    mainCode += '    case WM_SETFOCUS:\n'
    mainCode += `        ${windowEventPrefix}_得到焦点();\n`
    mainCode += '        break;\n'
    mainCode += '    case WM_KILLFOCUS:\n'
    mainCode += `        ${windowEventPrefix}_失去焦点();\n`
    mainCode += '        break;\n'
    mainCode += '    case WM_CLOSE:\n'
    mainCode += `        ${windowEventPrefix}_即将被销毁();\n`
    mainCode += '        DestroyWindow(hWnd);\n'
    mainCode += '        break;\n'
    mainCode += '    case WM_DESTROY:\n'
    mainCode += `        ${windowEventPrefix}_被销毁();\n`
    mainCode += '        PostQuitMessage(0);\n'
    mainCode += '        break;\n'
    mainCode += '    default:\n'
    mainCode += '        return DefWindowProcW(hWnd, message, wParam, lParam);\n'
    mainCode += '    }\n'
    mainCode += '    return 0;\n'
    mainCode += '}\n\n'

    // 源码型带窗口组件的支持库：注册函数前置声明
    {
      for (const lib of librariesForBuild) {
        if (libraryManager.isCore(lib.name)) continue
        const info = libraryManager.getLibInfo(lib.name)
        if (!info || !info.windowUnits || info.windowUnits.length === 0) continue
        if (/\.(?:c|cc|cpp|cxx|m|mm)$/i.test(lib.libraryPath) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(lib.name)) {
          mainCode += `extern "C" void ${lib.name}_register_window_units(HINSTANCE);\n`
        }
      }
    }

    // WinMain
    mainCode += 'int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance,\n'
    mainCode += '                   LPSTR lpCmdLine, int nCmdShow) {\n'
    mainCode += '    /* 重定向 stdout 到父进程管道（使调试输出可被 IDE 捕获） */\n'
    mainCode += '    HANDLE hOut = GetStdHandle(STD_OUTPUT_HANDLE);\n'
    mainCode += '    if (hOut && hOut != INVALID_HANDLE_VALUE) {\n'
    mainCode += '        int fd = _open_osfhandle((intptr_t)hOut, _O_TEXT);\n'
    mainCode += '        if (fd >= 0) {\n'
    mainCode += '            FILE* fp = _fdopen(fd, "w");\n'
    mainCode += '            if (fp) { *stdout = *fp; setvbuf(stdout, NULL, _IONBF, 0); }\n'
    mainCode += '        }\n'
    mainCode += '    }\n'
    mainCode += '    g_hInstance = hInstance;\n'
    mainCode += '    INITCOMMONCONTROLSEX icc = { sizeof(INITCOMMONCONTROLSEX), ICC_WIN95_CLASSES | ICC_STANDARD_CLASSES | ICC_BAR_CLASSES | ICC_LISTVIEW_CLASSES | ICC_TREEVIEW_CLASSES | ICC_TAB_CLASSES };\n'
    mainCode += '    InitCommonControlsEx(&icc);\n'
    // 初始化有窗口组件的支持库：
    // - 动态库形式：LoadLibraryW 触发其 DllMain 注册窗口类
    // - 源码形式（impl/*.cpp 静态编译进来）：调用约定函数 <库名>_register_window_units(HINSTANCE)
    {
      for (const lib of librariesForBuild) {
        if (libraryManager.isCore(lib.name)) continue
        const info = libraryManager.getLibInfo(lib.name)
        if (!info || !info.windowUnits || info.windowUnits.length === 0) continue
        if (/\.(?:c|cc|cpp|cxx|m|mm)$/i.test(lib.libraryPath)) {
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(lib.name)) {
            mainCode += `    ${lib.name}_register_window_units(hInstance);\n`
          }
        } else {
          const libraryPath = lib.libraryPath.replace(/\\/g, '\\\\')
          mainCode += `    LoadLibraryW(L"${libraryPath}");\n`
        }
      }
    }
    mainCode += '    WNDCLASSEXW wcex;\n'
    mainCode += '    wcex.cbSize = sizeof(WNDCLASSEXW);\n'
    mainCode += '    wcex.style = CS_HREDRAW | CS_VREDRAW;\n'
    mainCode += '    wcex.lpfnWndProc = WndProc;\n'
    mainCode += '    wcex.cbClsExtra = 0;\n'
    mainCode += '    wcex.cbWndExtra = 0;\n'
    mainCode += '    wcex.hInstance = hInstance;\n'
    mainCode += '    wcex.hIcon = LoadIcon(NULL, IDI_APPLICATION);\n'
    mainCode += '    wcex.hCursor = LoadCursor(NULL, IDC_ARROW);\n'
    mainCode += '    wcex.hbrBackground = (HBRUSH)(COLOR_BTNFACE + 1);\n'
    mainCode += '    wcex.lpszMenuName = NULL;\n'
    mainCode += '    wcex.lpszClassName = g_szClassName;\n'
    mainCode += '    wcex.hIconSm = LoadIcon(NULL, IDI_APPLICATION);\n'
    mainCode += '    if (!RegisterClassExW(&wcex)) {\n'
    mainCode += '        MessageBoxW(NULL, L"窗口类注册失败!", L"错误", MB_ICONERROR);\n'
    mainCode += '        return 1;\n'
    mainCode += '    }\n'
    // 根据边框属性计算窗口样式
    {
      let dwStyle = 'WS_OVERLAPPED | WS_CAPTION'
      let dwExStyle = winInfo.topmost ? 'WS_EX_TOPMOST' : '0'
      switch (winInfo.border) {
        case 0: // 无边框
          dwStyle = 'WS_POPUP'
          break
        case 1: // 单线边框
          dwStyle = 'WS_OVERLAPPED | WS_CAPTION | WS_BORDER'
          break
        case 2: // 可调边框（默认）
        default:
          dwStyle = 'WS_OVERLAPPED | WS_CAPTION | WS_THICKFRAME'
          break
        case 3: // 对话框边框
          dwStyle = 'WS_OVERLAPPED | WS_CAPTION'
          dwExStyle = (winInfo.topmost ? 'WS_EX_TOPMOST | ' : '') + 'WS_EX_DLGMODALFRAME'
          break
        case 4: // 工具窗口边框
          dwStyle = 'WS_OVERLAPPED | WS_CAPTION'
          dwExStyle = (winInfo.topmost ? 'WS_EX_TOPMOST | ' : '') + 'WS_EX_TOOLWINDOW'
          break
        case 5: // 可调工具窗口边框
          dwStyle = 'WS_OVERLAPPED | WS_CAPTION | WS_THICKFRAME'
          dwExStyle = (winInfo.topmost ? 'WS_EX_TOPMOST | ' : '') + 'WS_EX_TOOLWINDOW'
          break
      }
      if (winInfo.border !== 0) {
        if (winInfo.controlBox) dwStyle += ' | WS_SYSMENU'
        if (winInfo.minButton && winInfo.controlBox) dwStyle += ' | WS_MINIMIZEBOX'
        if (winInfo.maxButton && winInfo.controlBox) dwStyle += ' | WS_MAXIMIZEBOX'
      }
      mainCode += `    DWORD dwStyle = ${dwStyle};\n`
      mainCode += `    DWORD dwExStyle = ${dwExStyle};\n`
    }
    mainCode += '    RECT rc = { 0, 0, g_nWidth, g_nHeight };\n'
    mainCode += '    AdjustWindowRectEx(&rc, dwStyle, FALSE, dwExStyle);\n'
    mainCode += '    int winW = rc.right - rc.left;\n'
    mainCode += '    int winH = rc.bottom - rc.top;\n'
    // 根据位置属性决定起始坐标
    if (winInfo.startPos === 0) {
      // 手工调整 - 系统默认
      mainCode += '    int posX = CW_USEDEFAULT;\n'
      mainCode += '    int posY = CW_USEDEFAULT;\n'
    } else {
      // 居中（默认）
      mainCode += '    int screenW = GetSystemMetrics(SM_CXSCREEN);\n'
      mainCode += '    int screenH = GetSystemMetrics(SM_CYSCREEN);\n'
      mainCode += '    int posX = (screenW - winW) / 2;\n'
      mainCode += '    int posY = (screenH - winH) / 2;\n'
    }
    mainCode += '    HWND hWnd = CreateWindowExW(dwExStyle, g_szClassName, g_szTitle,\n'
    mainCode += '        dwStyle,\n'
    mainCode += '        posX, posY, winW, winH,\n'
    mainCode += '        NULL, NULL, hInstance, NULL);\n'
    mainCode += '    if (!hWnd) {\n'
    mainCode += '        MessageBoxW(NULL, L"窗口创建失败!", L"错误", MB_ICONERROR);\n'
    mainCode += '        return 1;\n'
    mainCode += '    }\n'
    mainCode += '    g_hMainWnd = hWnd;\n'
    if (winInfo.disabled) mainCode += '    EnableWindow(hWnd, FALSE);\n'
    mainCode += `    ShowWindow(hWnd, ${winInfo.visible ? 'nCmdShow' : 'SW_HIDE'});\n`
    mainCode += '    UpdateWindow(hWnd);\n'
    mainCode += '    MSG msg;\n'
    mainCode += '    while (GetMessage(&msg, NULL, 0, 0)) {\n'
    mainCode += '        TranslateMessage(&msg);\n'
    mainCode += '        DispatchMessage(&msg);\n'
    mainCode += '    }\n'
    mainCode += '    return (int)msg.wParam;\n'
    mainCode += '}\n'
  } else {
    // 控制台程序
    // 先转译 .eyc 文件
    for (const f of project.files) {
      if (f.type !== 'EYC' && f.type !== 'EGV' && f.type !== 'ECS' && f.type !== 'EDT' && f.type !== 'ELL') continue
      const eycPath = join(project.projectDir, f.fileName)
      const editorContent = editorFiles?.get(f.fileName)
      const content = editorContent || (existsSync(eycPath) ? readFileSync(eycPath, 'utf-8') : '')
      if (!content) continue

      transpileProjectFile(f.fileName, content, [])
    }

    mainCode += '/* 控制台程序入口点 */\n'
    mainCode += 'int main(int argc, char* argv[]) {\n'
    mainCode += '    SetConsoleOutputCP(65001);\n'
    mainCode += '    SetConsoleCP(65001);\n'
    mainCode += `    printf("程序开始运行...\\n");\n`
    mainCode += `    printf("项目: ${project.projectName}\\n");\n`
    mainCode += '    printf("\\n");\n'

    // 查找是否有 _启动子程序
    let hasStartupSub = false
    for (const f of project.files) {
      if (f.type !== 'EYC') continue
      const eycPath = join(project.projectDir, f.fileName)
      const editorContent = editorFiles?.get(f.fileName)
      const content = editorContent || (existsSync(eycPath) ? readFileSync(eycPath, 'utf-8') : '')
      if (content && content.includes('.子程序 _启动子程序')) {
        hasStartupSub = true
        mainCode += '    extern void _启动子程序(void);\n'
        mainCode += '    _启动子程序();\n'
        break
      }
    }

    if (!hasStartupSub) {
      mainCode += '    printf("无启动子程序\\n");\n'
    }

    mainCode += '    printf("\\n程序运行结束.\\n");\n'
    mainCode += '    return 0;\n'
    mainCode += '}\n'
  }

  compileLogMark('生成C++: 组装 main.cpp 入口代码')

  try {
    const cachePayload: TranspileCacheFile = {
      version: TRANSPILE_CACHE_VERSION,
      entries: nextTranspileEntries,
    }
    writeFileSync(transpileCachePath, JSON.stringify(cachePayload), 'utf-8')
  } catch {
    // 缓存写入失败不影响本次编译。
  }

  writeFileSync(mainCPath, mainCode, 'utf-8')
  compileLogMark('生成C++: 写出 main.cpp 与转换缓存')
  return additionalCFiles
}

// 编译项目
export async function compileProject(options: CompileOptions, editorFiles?: Map<string, string>): Promise<CompileResult> {
  const result: CompileResult = {
    success: false, outputFile: '', errorCount: 0, warningCount: 0, elapsedMs: 0
  }

  const startTime = Date.now()
  activeProjectCustomTypeNames = new Set()
  activeProjectClassNames = new Set()

  try {
    // 查找 .epp 文件
    const projectDir = options.projectDir
    const eppFiles = readdirSync(projectDir).filter(f => f.endsWith('.epp'))
    if (eppFiles.length === 0) {
      sendMessage({ type: 'error', text: '错误: 项目目录中找不到 .epp 文件' })
      result.errorCount++
      return result
    }

    const eppPath = join(projectDir, eppFiles[0])
    const project = parseEppFile(eppPath)
    if (!project) {
      sendMessage({ type: 'error', text: '错误: 无法解析项目文件' })
      result.errorCount++
      return result
    }

    startCompileLog(projectDir, project.projectName)
    compileLogRaw(`项目目录: ${projectDir}`)
    compileLogRaw(`文件数: ${project.files.length}, 输出类型: ${project.outputType}, 平台标记: ${project.platform}`)
    compileLogMark('解析项目文件 .epp')

    const buildMode = options.mode || 'compile'
    const hostPlatform = getHostTargetPlatform()
    const hostArch = getHostTargetArch()
    const projectPlatform = normalizeTargetPlatform(project.platform)
    const unsupportedProjectPlatform = normalizeUnsupportedTargetPlatform(project.platform)

    if (buildMode === 'compile' && unsupportedProjectPlatform) {
      sendMessage({ type: 'error', text: `错误: 目标平台 ${unsupportedProjectPlatform} 已可在项目中选择，但当前编译后端还没有实现移动端原生构建。` })
      result.errorCount++
      result.elapsedMs = Date.now() - startTime
      finishCompileLog(`失败：目标平台 ${unsupportedProjectPlatform} 暂不支持`)
      return result
    }

    // 运行按钮固定编译为宿主平台；编译按钮按 .epp 目标平台。
    const targetPlatform: TargetPlatform = buildMode === 'run'
      ? hostPlatform
      : (projectPlatform || hostPlatform)

    await yieldToEventLoop()
    const signatureErrors = validateProjectCommandSignatures(project, editorFiles, targetPlatform)
    compileLogMark('校验命令签名（遍历全部源文件）')
    await yieldToEventLoop()
    if (signatureErrors.length > 0) {
      for (const message of signatureErrors) {
        sendMessage({ type: 'error', text: message })
      }
      result.errorCount += signatureErrors.length
      result.elapsedMs = Date.now() - startTime
      finishCompileLog(`失败：命令签名校验未通过（${signatureErrors.length} 处）`)
      return result
    }

    sendMessage({ type: 'info', text: `正在编译项目: ${project.projectName}` })

    // 编译按钮允许工具栏架构覆盖；运行按钮固定宿主架构。
    const targetArch: TargetArch = buildMode === 'run'
      ? hostArch
      : (normalizeTargetArch(options.arch)
        || normalizeTargetArch(project.platform)
        || (targetPlatform === 'macos' ? 'arm64' : 'x64'))

    const targetTriple = buildZigTargetTriple(targetPlatform, targetArch)
    if (buildMode === 'compile' && !projectPlatform) {
      sendMessage({ type: 'warning', text: `警告: .epp 的 Platform 非法或缺失，已回退为宿主平台 ${targetPlatform}` })
    }
    sendMessage({ type: 'info', text: `构建模式: ${buildMode === 'run' ? '运行(宿主平台)' : '编译(项目平台)'}` })
    sendMessage({ type: 'info', text: `目标平台: ${targetPlatform}, 目标架构: ${targetArch}` })

    // 查找编译器
    const zigPath = findZigCompiler()
    if (!zigPath) {
      const zigHint = hostPlatform === 'windows'
        ? '请确保 compiler/zig/zig.exe存在'
        : '请确保 compiler/zig/zig存在'
      sendMessage({ type: 'error', text: `错误: 找不到 Zig 编译器\n${zigHint}` })
      result.errorCount++
      finishCompileLog('失败：找不到 Zig 编译器')
      return result
    }
    sendMessage({ type: 'info', text: `编译器: ${zigPath}` })
    compileLogMark(`查找 Zig 编译器: ${zigPath}`)

    // 准备目录
    const tempDir = join(projectDir, 'temp')
    const outputDir = join(projectDir, 'output', targetPlatform, targetArch)
    mkdirSync(tempDir, { recursive: true })
    mkdirSync(outputDir, { recursive: true })
    compileLogMark('准备临时/输出目录')

    // ========== 支持库链接 ==========
    const loadedLibs = libraryManager.getLoadedLibraryFiles(targetPlatform)
    compileLogMark('  收集支持库: getLoadedLibraryFiles')
    const usedLibraryNames = collectUsedLibraryFileNames(project, editorFiles)
    compileLogMark('  收集支持库: collectUsedLibraryFileNames')
    const genericFallbackLibraryNames = collectGenericFallbackLibraryFileNames(project, editorFiles)
    compileLogMark('  收集支持库: collectGenericFallbackLibraryFileNames')
    const libsToLink = loadedLibs.filter(l => usedLibraryNames.has(l.name))
    compileLogMark(`收集支持库链接信息（已加载 ${loadedLibs.length} / 使用 ${libsToLink.length}）`)
    sendMessage({ type: 'info', text: '编译模式: 普通编译' })

    // 仅对“本次会静态链接”的支持库生成命令分发表引用，避免动态路径下出现未定义符号。
    const staticCmdDispatchLibs: string[] = []
    for (const lib of libsToLink) {
      if (!genericFallbackLibraryNames.has(lib.name)) continue
      staticCmdDispatchLibs.push(lib.name)
    }

    // 生成C++代码
    sendMessage({ type: 'info', text: '正在生成C++代码...' })
    compileLogMark('开始生成C++代码')
    await yieldToEventLoop()
    const additionalCFiles = generateMainC(project, tempDir, editorFiles, libsToLink, staticCmdDispatchLibs, !!options.debug, options.breakpoints || {}, targetPlatform)
    compileLogMark('C++代码生成完成')
    await yieldToEventLoop()
    const outputName = project.projectName
    const outputFileName = getBinaryFileName(outputName, project.outputType, targetPlatform)
    const outputBinary = join(outputDir, outputFileName)
    const mainC = join(tempDir, 'main.cpp')
    const buildCachePath = join(tempDir, '.build-artifact-cache.json')

    const args: string[] = [
      '-o', outputBinary,
      mainC,
      ...additionalCFiles,
    ]

    // ========== 产物指纹缓存 ==========
    // 生成的临时源文件每次构建都会重写（mtime 必变），必须按内容哈希参与指纹，
    // 否则"输入未变化、复用上次产物"的快路径永远不会命中。
    const collectContentStamp = (filePath: string): string => {
      try {
        return `${filePath}|sha1:${createHash('sha1').update(readFileSync(filePath)).digest('hex')}`
      } catch {
        return `${filePath}|missing`
      }
    }
    const collectFileStamp = (filePath: string): string => {
      try {
        const st = statSync(filePath)
        return `${filePath}|${st.size}|${Math.round(st.mtimeMs)}`
      } catch {
        return `${filePath}|missing`
      }
    }

    const resourceEntries = collectProjectResourceEntries(project, editorFiles)
    const resourceStamps = resourceEntries
      .map(entry => collectFileStamp(join(project.projectDir, entry.fileName)))
      .sort()
    const sourceStamps = [mainC, ...additionalCFiles].map(collectContentStamp).sort()
    const staticLibStamps = libsToLink
      .map(lib => libraryManager.findStaticLib(lib.name, targetArch))
      .filter((x): x is string => !!x)
      .map(collectFileStamp)
      .sort()
    const platformImplStamps = libsToLink
      .map(lib => lib.libraryPath)
      .filter(filePath => /\.(?:c|cc|cpp|cxx|m|mm)$/i.test(filePath))
      .map(collectContentStamp)
      .sort()

    const buildFingerprint = createHash('sha1').update(JSON.stringify({
      mode: buildMode,
      debug: !!options.debug,
      targetPlatform,
      targetArch,
      targetTriple,
      outputType: project.outputType,
      outputName: outputFileName,
      sourceStamps,
      staticLibStamps,
      platformImplStamps,
      resourceStamps,
    })).digest('hex')
    compileLogMark(`计算产物指纹（哈希 ${sourceStamps.length} 个源文件 / ${staticLibStamps.length} 个静态库 / ${resourceStamps.length} 项资源）`)
    await yieldToEventLoop()

    const previousBuildCache = (() => {
      try {
        if (!existsSync(buildCachePath)) return null
        const raw = JSON.parse(readFileSync(buildCachePath, 'utf-8')) as Partial<BuildArtifactCacheFile>
        if (!raw || raw.version !== BUILD_ARTIFACT_CACHE_VERSION) return null
        if (typeof raw.fingerprint !== 'string' || typeof raw.outputBinary !== 'string') return null
        return raw as BuildArtifactCacheFile
      } catch {
        return null
      }
    })()

    if (
      previousBuildCache
      && previousBuildCache.fingerprint === buildFingerprint
      && previousBuildCache.outputBinary === outputBinary
      && existsSync(outputBinary)
    ) {
      sendMessage({ type: 'info', text: '未检测到编译输入变化，跳过编译与链接，直接复用上次产物。' })
      result.success = true
      result.outputFile = outputBinary
      result.elapsedMs = Date.now() - startTime
      compileLogMark('命中产物缓存，跳过编译与链接')
      sendMessage({ type: 'success', text: `编译成功 (${formatElapsedDuration(result.elapsedMs)})` })
      sendMessage({ type: 'info', text: `输出文件: ${outputBinary}` })
      const reuseLogPath = finishCompileLog('成功（复用上次产物，未重新编译）')
      if (reuseLogPath) sendMessage({ type: 'info', text: `编译诊断日志: ${reuseLogPath}` })
      return result
    }
    compileLogMark('读取上次产物缓存并比对指纹（未命中，需重新编译）')

    const resourceBuild = await compileProjectResources(project, targetPlatform, targetArch, tempDir, zigPath, editorFiles)
    compileLogMark('编译资源(.erc/清单)')
    if (!resourceBuild.success) {
      result.errorCount++
      result.elapsedMs = Date.now() - startTime
      finishCompileLog('失败：资源编译失败')
      return result
    }
    if (resourceBuild.objectFilePath) {
      args.push(resourceBuild.objectFilePath)
    }

    // 项目类型
    const isWindowsApp = project.outputType === 'WindowsApp'
    if (isWindowsApp) {
      if (targetPlatform !== 'windows') {
        sendMessage({ type: 'warning', text: `警告: 窗口程序当前仅支持 Windows 目标，已按 ${targetPlatform} 继续尝试编译` })
      }
      args.push('-Xlinker', '--subsystem', '-Xlinker', 'windows')
      sendMessage({ type: 'info', text: '项目类型: Windows窗口程序' })
    } else if (project.outputType === 'DynamicLibrary') {
      args.push('-shared')
      sendMessage({ type: 'info', text: '项目类型: 动态链接库(DLL)' })
    } else {
      sendMessage({ type: 'info', text: '项目类型: 控制台程序' })
    }

    // 平台系统库（advapi32=注册表、ole32=COM 初始化，webview2 等支持库需要）
    if (targetPlatform === 'windows') {
      args.push('-lkernel32', '-luser32', '-lgdi32', '-lcomctl32', '-loleaut32', '-ladvapi32', '-lole32')
    }

    // ========== 支持库链接 ==========
    if (loadedLibs.length > 0) {
      sendMessage({ type: 'info', text: `已加载 ${loadedLibs.length} 个支持库，实际使用 ${libsToLink.length} 个，正在处理链接依赖...` })
    }

    for (const lib of libsToLink) {
      const staticLib = libraryManager.findStaticLib(lib.name, targetArch)

      // 窗口组件静态库需要额外链接的系统库
      const winUnitExtraDeps: Record<string, string[]> = {
        ycui: ['d2d1.lib', 'dwrite.lib'],
      }
      const extraDeps = (targetPlatform === 'windows' && staticLib && winUnitExtraDeps[lib.name]) ? winUnitExtraDeps[lib.name] : []

      if (staticLib) {
        args.push(staticLib, ...extraDeps)
        sendMessage({ type: 'info', text: `  ✓ ${lib.libName} (${lib.name}) - 静态链接: ${basename(staticLib)}` })
      } else if (/\.(?:c|cc|cpp|cxx|m|mm)$/i.test(lib.libraryPath)) {
        // 库自带头文件目录（如 webview2 的 WebView2.h）
        const libIncludeDir = join(dirname(lib.libraryPath), '..', 'include')
        if (existsSync(libIncludeDir)) args.push(`-I${libIncludeDir}`)
        args.push(lib.libraryPath, ...extraDeps)
        sendMessage({ type: 'info', text: `  ${lib.libName} (${lib.name}) - platform source: ${basename(lib.libraryPath)}` })
      } else {
        sendMessage({ type: 'warning', text: `  ○ ${lib.libName} (${lib.name}) - 未找到静态库，跳过链接` })
      }
    }

    args.push('-target', targetTriple)

    // 源文件/执行字符集均使用 UTF-8，确保中文字符串字面量不被 MSVC 模式按 GBK 解析
    args.push('-finput-charset=utf-8', '-fexec-charset=utf-8')

    // 调试/优化选项
    if (options.debug) {
      args.push('-g', '-O0')
      sendMessage({ type: 'info', text: '优化级别: O0 (调试优先)' })
    } else if (buildMode === 'run') {
      // 运行按钮优先响应速度，避免每次测试都走 O2 的慢编译路径。
      args.push('-O0', '-fno-ident')
      sendMessage({ type: 'info', text: '优化级别: O0 (快速运行)' })
    } else {
      args.push('-O2', '-fno-ident', '-ffunction-sections', '-fdata-sections')
      args.push('-Wl,--gc-sections')
      sendMessage({ type: 'info', text: '优化级别: O2 (发布编译)' })
    }

    sendMessage({ type: 'info', text: '正在编译...' })
    compileLogMark('准备链接参数，开始调用 zig c++')
    compileLogRaw(`zig 命令行参数: c++ ${args.join(' ')}`)

    const commandSourceLocations = collectCommandSourceLocationsByLibrary(project, editorFiles)
    const unresolvedCmdLibReported = new Set<string>()

    // 调用 zig c++
    const compileSuccess = await new Promise<boolean>((resolve) => {
      const zigDir = dirname(zigPath)
      const zigArgs = ['c++', ...args]
      const proc = execFile(zigPath, zigArgs, { cwd: zigDir, maxBuffer: 10 * 1024 * 1024 }, (error, _stdout, stderr) => {
        if (stderr) {
          const lines = stderr.split('\n').filter(l => l.trim())
          for (const line of lines) {
            const lower = line.toLowerCase()
            const localized = localizeCompilerMessage(line)

            const unresolvedMatch = line.match(/g_cmdInfo_([A-Za-z0-9_]+)_global_var_fun/i)
            if (unresolvedMatch) {
              const libFileName = unresolvedMatch[1]
              if (!unresolvedCmdLibReported.has(libFileName)) {
                unresolvedCmdLibReported.add(libFileName)
                const hits = commandSourceLocations.get(libFileName) || []
                if (hits.length > 0) {
                  sendMessage({ type: 'warning', text: `>>> 易语言源码位置（支持库 ${libFileName}）:` })
                  const maxHints = 8
                  for (const hit of hits.slice(0, maxHints)) {
                    sendMessage({ type: 'warning', text: `>>>   ${hit.fileName}:${hit.lineNo}  命令: ${hit.commandName}` })
                  }
                  if (hits.length > maxHints) {
                    sendMessage({ type: 'warning', text: `>>>   ... 其余 ${hits.length - maxHints} 处调用已省略` })
                  }
                } else {
                  sendMessage({ type: 'warning', text: `>>> 未能自动定位对应易语言源码位置（支持库 ${libFileName}）` })
                }
              }
            }

            if (lower.includes('error')) {
              sendMessage({ type: 'error', text: localized })
              result.errorCount++
            } else if (lower.includes('warning')) {
              sendMessage({ type: 'warning', text: localized })
              result.warningCount++
            } else {
              sendMessage({ type: 'info', text: localized })
            }
          }
        }
        resolve(!error)
      })
      proc.on('error', (err) => {
        sendMessage({ type: 'error', text: `编译器进程启动失败: ${err.message}` })
        resolve(false)
      })
    })

    compileLogMark('zig c++ 编译与链接完成')

    if (!compileSuccess || !existsSync(outputBinary)) {
      sendMessage({ type: 'error', text: '编译失败!' })
      result.errorCount++
      result.elapsedMs = Date.now() - startTime
      const failLogPath = finishCompileLog(`失败：编译/链接失败（${result.errorCount} 个错误）`)
      if (failLogPath) sendMessage({ type: 'info', text: `编译诊断日志: ${failLogPath}` })
      return result
    }

    try {
      const cachePayload: BuildArtifactCacheFile = {
        version: BUILD_ARTIFACT_CACHE_VERSION,
        fingerprint: buildFingerprint,
        outputBinary,
      }
      writeFileSync(buildCachePath, JSON.stringify(cachePayload), 'utf-8')
    } catch {
      // 缓存写入失败不影响本次编译。
    }

    result.success = true
    result.outputFile = outputBinary
    result.elapsedMs = Date.now() - startTime

    sendMessage({ type: 'success', text: `编译成功 (${formatElapsedDuration(result.elapsedMs)})` })
    sendMessage({ type: 'info', text: `输出文件: ${outputBinary}` })
    const okLogPath = finishCompileLog('成功（完整编译并链接）')
    if (okLogPath) sendMessage({ type: 'info', text: `编译诊断日志: ${okLogPath}` })

  } catch (e) {
    sendMessage({ type: 'error', text: `编译异常: ${e instanceof Error ? e.message : String(e)}` })
    result.errorCount++
    const exLogPath = finishCompileLog(`异常：${e instanceof Error ? e.message : String(e)}`)
    if (exLogPath) sendMessage({ type: 'info', text: `编译诊断日志: ${exLogPath}` })
  }

  result.elapsedMs = Date.now() - startTime
  return result
}

// 运行已编译的程序
export function runExecutable(exePath: string): boolean {
  if (!exePath || !existsSync(exePath)) {
    sendMessage({ type: 'error', text: '错误: 可执行文件不存在: ' + exePath })
    return false
  }

  // 如果已有程序在运行，先停止
  stopExecutable()

  sendMessage({ type: 'info', text: '' })
  sendMessage({ type: 'info', text: '==========================================' })
  sendMessage({ type: 'info', text: '正在运行程序...' })
  sendMessage({ type: 'info', text: '==========================================' })

  const workDir = dirname(exePath)
  const debugCmdFile = join(workDir, '.ycdbg_cmd')

  const formatLaunchError = (err: NodeJS.ErrnoException): string => {
    const parts = [err.message]
    if (err.code) parts.push(`code=${err.code}`)
    if (typeof err.errno === 'number') parts.push(`errno=${err.errno}`)
    if (err.syscall) parts.push(`syscall=${err.syscall}`)
    if (err.path) parts.push(`path=${err.path}`)
    return parts.join(' | ')
  }

  const canFallbackToShellOpen = (err: NodeJS.ErrnoException): boolean => {
    if (process.platform !== 'win32') return false

    const code = (err.code ?? '').toUpperCase()
    const message = err.message ?? ''
    const errno = typeof err.errno === 'number' ? err.errno : null

    if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') return true
    if (errno === -4048) return true
    return /spawn\s+(EPERM|EACCES)/i.test(message)
  }

  const isLikelySecurityInterception = (err: NodeJS.ErrnoException): boolean => {
    if (process.platform !== 'win32') return false

    const message = err.message ?? ''
    const code = (err.code ?? '').toUpperCase()
    const errno = typeof err.errno === 'number' ? err.errno : null

    if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') return true
    if (errno === -4048) return true
    return /spawn\s+(EPERM|EACCES)|operation not permitted|access is denied/i.test(message)
  }

  const fallbackOpenViaShell = (): void => {
    const openExternally = compilerHost?.openPathExternally ?? (async () => '宿主未提供系统打开能力')
    void openExternally(exePath).then((result) => {
      if (result) {
        sendMessage({ type: 'error', text: `启动程序失败(回退启动也失败): ${result}` })
        return
      }
      sendMessage({ type: 'warning', text: '已回退为系统 Shell 启动，当前会话无法跟踪进程输出/退出状态。' })
      sendMessage({ type: 'success', text: '程序已通过系统 Shell 启动。' })
    }).catch((error) => {
      const text = error instanceof Error ? error.message : String(error)
      sendMessage({ type: 'error', text: `启动程序失败(回退启动异常): ${text}` })
    })
  }

  try {
    writeFileSync(debugCmdFile, '0', 'utf-8')
    runningDebugCmdFile = debugCmdFile
    runningDebugResumeToken = 0
    const proc = execFile(exePath, [], {
      cwd: workDir,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: false,
    })

    runningProcess = proc
    let stdoutBuffer = ''
    let stderrBuffer = ''

    proc.on('spawn', () => {
      sendMessage({ type: 'success', text: `程序已启动 (PID: ${proc.pid})` })
    })

    proc.stdout?.on('data', (data: Buffer) => {
      stdoutBuffer = emitBufferedOutputChunk(data.toString('utf-8'), stdoutBuffer, 'info')
    })

    proc.stderr?.on('data', (data: Buffer) => {
      stderrBuffer = emitBufferedOutputChunk(data.toString('utf-8'), stderrBuffer, 'warning')
    })

    proc.on('exit', (code) => {
      runningProcess = null
      runningDebugCmdFile = null
      runningDebugResumeToken = 0
      flushBufferedOutputRemainder(stdoutBuffer, 'info')
      flushBufferedOutputRemainder(stderrBuffer, 'warning')
      sendMessage({ type: 'info', text: '' })
      if (code === 0) {
        sendMessage({ type: 'success', text: `程序已退出 (退出码: ${code})` })
      } else {
        sendMessage({ type: 'warning', text: `程序已退出 (退出码: ${code})` })
      }
      compilerHost?.notifyProcessExit(code)
    })

    proc.on('error', (err) => {
      runningProcess = null
      runningDebugCmdFile = null
      runningDebugResumeToken = 0
      const detailed = formatLaunchError(err)
      const blockedBySecuritySoftware = isLikelySecurityInterception(err)
      if (canFallbackToShellOpen(err)) {
        sendMessage({ type: 'warning', text: `直接启动失败，正在尝试系统 Shell 回退启动: ${detailed}` })
        if (blockedBySecuritySoftware) {
          sendMessage({ type: 'warning', text: `疑似被安全软件拦截。请检查杀毒软件隔离区/日志，并将输出目录加入“受信任或排除”后重试。输出目录: ${workDir}` })
        }
        fallbackOpenViaShell()
        return
      }
      if (blockedBySecuritySoftware) {
        sendMessage({ type: 'warning', text: `疑似被安全软件拦截。请检查杀毒软件隔离区/日志，并将输出目录加入“受信任或排除”后重试。输出目录: ${workDir}` })
      }
      sendMessage({ type: 'error', text: `启动程序失败: ${detailed}` })
    })

    // execFile 返回即表示启动请求已发起；实际成功由 spawn 事件回报。
    return true
  } catch (e) {
    sendMessage({ type: 'error', text: `启动程序失败: ${e instanceof Error ? e.message : String(e)}` })
    return false
  }
}

// 停止正在运行的程序
export function stopExecutable(): boolean {
  if (!runningProcess) return true

  try {
    runningProcess.kill()
    sendMessage({ type: 'info', text: '程序已停止' })
  } catch { /* ignore */ }

  runningProcess = null
  runningDebugCmdFile = null
  runningDebugResumeToken = 0
  return true
}

// 检查是否有程序在运行
export function isRunning(): boolean {
  return runningProcess !== null
}

export function continueDebugExecutable(): boolean {
  if (!runningProcess || !runningDebugCmdFile) return false
  try {
    runningDebugResumeToken += 1
    writeFileSync(runningDebugCmdFile, String(runningDebugResumeToken), 'utf-8')
    return true
  } catch {
    return false
  }
}
