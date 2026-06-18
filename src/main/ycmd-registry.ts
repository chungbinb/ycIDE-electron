import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { dirname, extname, join, relative } from 'path'
import { getRuntimeEnv } from './runtimeEnv'

export interface YcmdPlatformImplementation {
  entry: string
  language?: string
}

export interface YcmdCommandEntry {
  commandId: string
  displayName?: string
  summary?: string
  category?: string
  supportedPlatforms?: string[]
  params?: Array<{ name: string; type: string; optional?: boolean; repeatable?: boolean }>
  returnType?: string
  implementations?: {
    windows?: YcmdPlatformImplementation
    macos?: YcmdPlatformImplementation
    linux?: YcmdPlatformImplementation
    android?: YcmdPlatformImplementation
    ios?: YcmdPlatformImplementation
    harmony?: YcmdPlatformImplementation
  }
}

export interface YcmdCommandSectionMarker {
  __section: string
  __comment?: string
}

export interface YcmdManifest {
  contractVersion: string
  commandId?: string
  libraryDisplayName?: string
  libraryVersion?: string
  displayName?: string
  summary?: string
  library?: string
  params?: Array<{ name: string; type: string; optional?: boolean; repeatable?: boolean }>
  returnType?: string
  commands?: Array<YcmdCommandEntry | YcmdCommandSectionMarker>
  implementations?: {
    windows?: YcmdPlatformImplementation
    macos?: YcmdPlatformImplementation
    linux?: YcmdPlatformImplementation
    android?: YcmdPlatformImplementation
    ios?: YcmdPlatformImplementation
    harmony?: YcmdPlatformImplementation
  }
}

function isCommandSectionMarker(command: unknown): command is YcmdCommandSectionMarker {
  if (!command || typeof command !== 'object') return false
  const marker = command as Record<string, unknown>
  return typeof marker.__section === 'string'
}

export interface YcmdManifestItem {
  filePath: string
  manifest: YcmdManifest | null
  valid: boolean
  errors: string[]
}

export interface YcmdResolvedCommand {
  name: string
  englishName: string
  description: string
  returnType: string
  category: string
  supportedPlatforms: string[]
  params: Array<{ name: string; type: string; optional: boolean; repeatable?: boolean; isVariable: boolean; isArray: boolean; description: string }>
  isHidden: boolean
  isMember: boolean
  ownerTypeName: string
  commandIndex: number
  nativeSymbol: string
  libraryName: string
  libraryFileName: string
  source: 'ycmd'
  manifestPath: string
}

export interface YcmdLibraryItem {
  name: string
  folderPath: string
  manifests: YcmdManifestItem[]
}

export interface YcmdRegistryScanResult {
  rootPath: string
  libraries: YcmdLibraryItem[]
  errors: string[]
}

export type YcmdTargetPlatform = 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'harmony'

const CORE_LIBRARY_FILE_NAME = 'krnln'

export function ycmdCommandIdToNativeSymbol(commandId: string): string {
  const trimmed = (commandId || '').trim()
  const dot = trimmed.indexOf('.')
  const prefix = dot >= 0 ? trimmed.slice(0, dot) : CORE_LIBRARY_FILE_NAME
  const suffix = dot >= 0 ? trimmed.slice(dot + 1) : trimmed
  const safePrefix = (prefix || CORE_LIBRARY_FILE_NAME).replace(/[^A-Za-z0-9_]/g, '_')
  return `${safePrefix}_${suffix.replace(/[^A-Za-z0-9_]/g, '_')}`
}

function inferCoreCommandCategory(commandId: string, displayName: string): string {
  const id = commandId.toLowerCase()
  const name = displayName.trim()

  const inIdList = (items: string[]): boolean => items.some(item => id === `krnln.${item}`)

  if (inIdList([
    'ife', 'if', 'switch', 'while', 'counter', 'for', 'continue', 'break', 'return', 'end',
    'else', 'default', 'endife', 'endif', 'endswitch', 'wend', 'dowhile', 'loop', 'counterloop', 'next',
  ])) return '流程控制'

  if (inIdList([
    'add', 'sub', 'mul', 'div', 'mod', 'abs', 'round', 'pow', 'sqr', 'sin', 'cos', 'tan', 'atn',
    'idiv', 'neg', 'sgn', 'int', 'fix', 'log', 'exp', 'iscalcok', 'randomize', 'rnd',
  ])) return '算术运算'

  if (inIdList([
    'equal', 'notequal', 'less', 'greater', 'lessorequal', 'greaterorequal', 'like', 'and', 'or', 'not',
  ])) return '逻辑比较'

  if (inIdList(['outputdebugtext', 'stop', 'assert', 'isdebugver'])) return '调试操作'

  if (inIdList([
    'getdisktotalspace', 'getdiskfreespace', 'getdisklabel', 'setdisklabel', 'chdrive', 'chdir', 'curdir',
    'mkdir', 'rmdir', 'filecopy', 'filemove', 'kill', 'name', 'isfileexist', 'dir', 'filelen', 'getattr',
    'setattr', 'gettempfilename', 'filedatetime', 'readfile', 'writefile', 'open', 'openmemfile', 'close',
  ])) return '磁盘操作'

  if (inIdList([
    'binlen', 'tobin', 'binleft', 'binright', 'binmid', 'inbin', 'inbinrev', 'rpbin', 'rpsubbin', 'spacebin',
    'bin', 'pbin', 'p2int', 'p2float', 'p2double', 'getintinsidebin', 'setintinsidebin', 'splitbin', 'getbinelement',
  ])) return '字节集操作'

  if (inIdList(['bnot', 'band', 'bor', 'bxor', 'shl', 'shr', 'makelong', 'makeword'])) return '位运算'

  if (inIdList(['set', 'store'])) return '变量操作'

  if (inIdList([
    'redim', 'getaryelementcount', 'ubound', 'copyary', 'addelement', 'inselement', 'removeelement', 'removeall',
    'sortary', 'zeroary',
  ])) return '数组操作'

  if (inIdList(['getcmdline', 'getrunpath', 'getrunfilename', 'getenv', 'putenv'])) return '环境存取'

  if (inIdList([
    'len', 'left', 'right', 'mid', 'chr', 'asc', 'instr', 'instrrev', 'ucase', 'lcase', 'qjcase', 'bjcase',
    'str', 'ltrim', 'rtrim', 'trim', 'trimall', 'replacetext', 'rpsubtext', 'space', 'string', 'strcomp',
    'split', 'pstr', 'strtoutf8', 'utf8tostr', 'strtoutf16', 'utf16tostr',
  ])) return '文本操作'

  if (inIdList([
    'totime', 'timechg', 'timediff', 'getdaysofspecmonth', 'timetotext', 'timepart', 'year', 'month', 'day',
    'weekday', 'hour', 'minute', 'second', 'getspectime', 'now', 'setsystime', 'getdatepart', 'gettimepart',
  ])) return '时间操作'

  if (inIdList([
    'val', 'unum', 'numtormb', 'numtotext', 'gethextext', 'getocttext', 'tobyte', 'toshort', 'toint', 'tolong',
    'tofloat', 'hex', 'binary', 'reverseintbytes',
  ])) return '转换函数'

  if (name.endsWith('结束')) return '流程控制'
  if (name.includes('循环')) return '流程控制'
  if (name.includes('随机') || name.includes('求')) return '算术运算'
  return '其他'
}

function getLibRootPath(): string {
  const { isPackaged, appPath } = getRuntimeEnv()
  const isDev = !isPackaged
  if (isDev) {
    return join(appPath, 'lib')
  }
  return join(dirname(process.execPath), 'lib')
}

function collectYcmdFiles(folderPath: string): string[] {
  const result: string[] = []
  if (!existsSync(folderPath)) return result

  const stack = [folderPath]
  while (stack.length > 0) {
    const current = stack.pop()!
    let children: string[] = []
    try {
      children = readdirSync(current)
    } catch {
      continue
    }

    for (const child of children) {
      const childPath = join(current, child)
      let isDir = false
      try {
        isDir = statSync(childPath).isDirectory()
      } catch {
        continue
      }
      if (isDir) {
        stack.push(childPath)
      } else if (child.toLowerCase().endsWith('.ycmd.json')) {
        result.push(childPath)
      }
    }
  }

  return result
}

function validateImplementations(
  filePath: string,
  implementations: YcmdManifest['implementations'] | undefined,
  errors: string[],
  prefix: string,
): void {
  if (!implementations || typeof implementations !== 'object') {
    errors.push(`${prefix}缺少 implementations`)
    return
  }
  const manifestDir = dirname(filePath)
  const entries: Array<{ platform: string; entry?: string }> = [
    { platform: 'windows', entry: implementations.windows?.entry },
    { platform: 'macos', entry: implementations.macos?.entry },
    { platform: 'linux', entry: implementations.linux?.entry },
    { platform: 'android', entry: implementations.android?.entry },
    { platform: 'ios', entry: implementations.ios?.entry },
    { platform: 'harmony', entry: implementations.harmony?.entry },
  ]
  for (const item of entries) {
    if (!item.entry) continue
    const resolved = join(manifestDir, item.entry)
    if (!existsSync(resolved)) {
      errors.push(`${prefix}实现文件不存在: ${item.platform} -> ${item.entry}`)
    }
  }
}

function validateManifest(filePath: string, manifest: YcmdManifest): string[] {
  const errors: string[] = []
  if (!manifest.contractVersion || typeof manifest.contractVersion !== 'string') {
    errors.push('缺少 contractVersion')
  }

  const isCommandSet = Array.isArray(manifest.commands) && manifest.commands.length > 0
  if (isCommandSet) {
    for (let i = 0; i < manifest.commands!.length; i++) {
      const command = manifest.commands![i]
      if (!command || typeof command !== 'object') {
        errors.push(`commands[${i}] 无效`)
        continue
      }
      if (isCommandSectionMarker(command)) {
        continue
      }
      if (!command.commandId || typeof command.commandId !== 'string') {
        errors.push(`commands[${i}] 缺少 commandId`)
      }
      validateImplementations(filePath, command.implementations || manifest.implementations, errors, `commands[${i}] `)
    }
    return errors
  }

  if (!manifest.commandId || typeof manifest.commandId !== 'string') {
    errors.push('缺少 commandId')
  }
  validateImplementations(filePath, manifest.implementations, errors, '')

  return errors
}

function parseManifest(filePath: string): YcmdManifestItem {
  let manifest: YcmdManifest | null = null
  const errors: string[] = []
  try {
    const content = readFileSync(filePath, 'utf-8')
    manifest = JSON.parse(content) as YcmdManifest
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { filePath, manifest: null, valid: false, errors: [`JSON 解析失败: ${message}`] }
  }

  const validateErrors = validateManifest(filePath, manifest)
  errors.push(...validateErrors)

  return {
    filePath,
    manifest,
    valid: errors.length === 0,
    errors,
  }
}

// ========== 扫描结果缓存 ==========
// scanYcmdRegistry 会被编译与代码补全反复调用（一次编译里 6~10 次），
// 而每次都全量读盘 + JSON.parse + 校验所有 .ycmd.json，开销极大（实测单次约 3 秒）。
// 这里用“目录签名（文件 mtime/大小）”做缓存：库内容未变化时直接复用已解析结果，
// 库增删/改动会让签名变化而自动失效；另加一个 TTL，让同一次编译内的连续调用
// 连 stat（目录遍历）都省掉，彻底消除重复扫描。
//
// 注意 TTL 必须覆盖一整次编译/运行周期：慢盘（机械盘/移动盘/被杀软实时扫描的非系统盘）
// 上一次目录遍历可达 ~2 秒，而编译里“校验命令签名 / 收集支持库 / 组装入口”三步各自都会
// 触发一次扫描，彼此间隔常超过 1 秒。若 TTL 太短（曾为 1500ms），后两步会因 TTL 过期而
// 重新全量遍历目录，等于一次编译扫了 3 遍盘——慢盘上直接吃掉 4~6 秒。
// 库通过 IDE 增删改时 scan() 会主动调 invalidateYcmdRegistryCache()，因此长 TTL 不影响
// 正确性；唯一被推迟的是“IDE 运行期间在磁盘上手改 .ycmd.json 且未触发重扫”这种罕见场景，
// 最长 30 秒后也会自愈。
interface ScanCacheEntry {
  signature: string
  checkedAt: number
  result: YcmdRegistryScanResult
}

const scanCacheByRoot = new Map<string, ScanCacheEntry>()
// 同一根目录在该时间窗内的重复调用直接复用，连签名都不重算（编译/补全的连续调用场景）。
const SCAN_SIGNATURE_TTL_MS = 30000
// 已解析命令列表缓存，键为扫描结果对象本身（签名变化会产生新对象，旧缓存随之被 GC）。
const ycmdCommandsCacheByScan = new WeakMap<YcmdRegistryScanResult, Map<string, YcmdResolvedCommand[]>>()

/** 强制清空 ycmd 注册表缓存。库被显式重载时调用，确保立即生效。 */
export function invalidateYcmdRegistryCache(): void {
  scanCacheByRoot.clear()
}

// 收集某根目录下所有 .ycmd.json 文件清单，并按库分组（只列文件，不读内容）。
function collectLibraryYcmdFiles(rootPath: string, children: string[]): Array<{ name: string; folderPath: string; files: string[] }> {
  const libFolders: Array<{ name: string; folderPath: string; files: string[] }> = []
  for (const child of children) {
    const folderPath = join(rootPath, child)
    let isDir = false
    try {
      isDir = statSync(folderPath).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    if (child === 'x64' || child === 'x86') continue
    const ycmdFiles = collectYcmdFiles(folderPath)
    if (ycmdFiles.length === 0) continue
    libFolders.push({ name: child, folderPath, files: ycmdFiles.slice().sort() })
  }
  return libFolders
}

// 用所有 manifest 文件的“路径|大小|mtime”拼出轻量签名（只 stat，不读内容）。
function computeScanSignature(libFolders: Array<{ files: string[] }>): string {
  const parts: string[] = []
  for (const lib of libFolders) {
    for (const file of lib.files) {
      try {
        const st = statSync(file)
        parts.push(`${file}|${st.size}|${Math.round(st.mtimeMs)}`)
      } catch {
        parts.push(`${file}|missing`)
      }
    }
  }
  return parts.join('\n')
}

export function scanYcmdRegistry(customRootPath?: string): YcmdRegistryScanResult {
  const rootPath = customRootPath || getLibRootPath()

  if (!existsSync(rootPath)) {
    return { rootPath, libraries: [], errors: ['lib 根目录不存在'] }
  }

  const now = Date.now()
  const cached = scanCacheByRoot.get(rootPath)
  // TTL 窗口内：直接复用，连目录都不再 stat。
  if (cached && now - cached.checkedAt < SCAN_SIGNATURE_TTL_MS) {
    return cached.result
  }

  let children: string[] = []
  try {
    children = readdirSync(rootPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { rootPath, libraries: [], errors: [`读取 lib 根目录失败: ${message}`] }
  }

  // 轻量扫描：只列文件 + 算签名（不读内容）。
  const libFolders = collectLibraryYcmdFiles(rootPath, children)
  const signature = computeScanSignature(libFolders)

  // 签名未变：内容没动，复用已解析结果，跳过全部读盘/解析。
  if (cached && cached.signature === signature) {
    cached.checkedAt = now
    return cached.result
  }

  // 缓存未命中：真正读取并解析所有 manifest。
  const libraries: YcmdLibraryItem[] = []
  const errors: string[] = []
  for (const lib of libFolders) {
    const manifests = lib.files.map(file => parseManifest(file))
    libraries.push({ name: lib.name, folderPath: lib.folderPath, manifests })
    for (const item of manifests) {
      if (!item.valid) {
        for (const detail of item.errors) {
          errors.push(`${relative(rootPath, item.filePath)}: ${detail}`)
        }
      }
    }
  }

  const result: YcmdRegistryScanResult = { rootPath, libraries, errors }
  scanCacheByRoot.set(rootPath, { signature, checkedAt: now, result })
  return result
}

export function detectYcmdImplementationLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.cpp' || ext === '.cc' || ext === '.cxx') return 'cpp'
  if (ext === '.c') return 'c'
  if (ext === '.mm') return 'objc++'
  if (ext === '.m') return 'objc'
  if (ext === '.rs') return 'rust'
  return 'unknown'
}

function manifestSupportsTargetPlatform(manifest: YcmdManifest, targetPlatform?: YcmdTargetPlatform): boolean {
  if (!targetPlatform) return true
  return !!manifest.implementations?.[targetPlatform]?.entry
}

function commandSupportsTargetPlatform(
  command: YcmdCommandEntry,
  manifest: YcmdManifest,
  targetPlatform?: YcmdTargetPlatform,
): boolean {
  if (!targetPlatform) return true
  const implementations = command.implementations || manifest.implementations
  return !!implementations?.[targetPlatform]?.entry
}

function normalizePlatformName(name: string): YcmdTargetPlatform | null {
  const lower = name.trim().toLowerCase()
  if (!lower) return null
  if (lower === 'windows' || lower === 'win') return 'windows'
  if (lower === 'linux') return 'linux'
  if (lower === 'macos' || lower === 'mac' || lower === 'unix') return 'macos'
  if (lower === 'android') return 'android'
  if (lower === 'ios' || lower === 'iphone' || lower === 'ipad') return 'ios'
  if (lower === 'harmony' || lower === 'harmonyos' || lower === 'openharmony') return 'harmony'
  return null
}

function extractSupportedPlatforms(
  command: YcmdCommandEntry,
  manifest: YcmdManifest,
): YcmdTargetPlatform[] {
  const fromField = Array.isArray(command.supportedPlatforms)
    ? command.supportedPlatforms
        .map(normalizePlatformName)
        .filter((item): item is YcmdTargetPlatform => !!item)
    : []
  if (fromField.length > 0) return Array.from(new Set(fromField))

  const implementations = command.implementations || manifest.implementations
  const platforms: YcmdTargetPlatform[] = []
  if (implementations?.windows?.entry) platforms.push('windows')
  if (implementations?.linux?.entry) platforms.push('linux')
  if (implementations?.macos?.entry) platforms.push('macos')
  if (implementations?.android?.entry) platforms.push('android')
  if (implementations?.ios?.entry) platforms.push('ios')
  if (implementations?.harmony?.entry) platforms.push('harmony')
  return platforms
}

function mapCommandParams(params?: Array<{ name: string; type: string; optional?: boolean; repeatable?: boolean }>): Array<{ name: string; type: string; optional: boolean; repeatable?: boolean; isVariable: boolean; isArray: boolean; description: string }> {
  return (params || []).map(p => ({
    name: (p.name || '').trim() || '参数',
    type: (p.type || '').trim() || '整数型',
    optional: !!p.optional,
    repeatable: !!p.repeatable,
    isVariable: false,
    isArray: false,
    description: '',
  }))
}

export function getYcmdCommands(customRootPath?: string, targetPlatform?: YcmdTargetPlatform): YcmdResolvedCommand[] {
  const scanResult = scanYcmdRegistry(customRootPath)

  // 命令列表只依赖扫描结果与目标平台，按扫描结果对象缓存，避免每次重建数千条命令。
  const platformKey = targetPlatform || ''
  let byPlatform = ycmdCommandsCacheByScan.get(scanResult)
  if (byPlatform) {
    const hit = byPlatform.get(platformKey)
    if (hit) return hit
  } else {
    byPlatform = new Map<string, YcmdResolvedCommand[]>()
    ycmdCommandsCacheByScan.set(scanResult, byPlatform)
  }

  const commands: YcmdResolvedCommand[] = []

  for (const lib of scanResult.libraries) {
    for (const item of lib.manifests) {
      if (!item.valid || !item.manifest) continue
      const manifest = item.manifest
      if (Array.isArray(manifest.commands) && manifest.commands.length > 0) {
        let currentSection = ''
        for (const command of manifest.commands) {
          if (!command || typeof command !== 'object') continue
          if (isCommandSectionMarker(command)) {
            currentSection = command.__section.trim()
            continue
          }
          if (!commandSupportsTargetPlatform(command, manifest, targetPlatform)) continue
          const commandName = (command.displayName || command.commandId || '').trim()
          const commandId = (command.commandId || '').trim()
          if (!commandName || !commandId) continue

          const inferredCategory = lib.name === CORE_LIBRARY_FILE_NAME
            ? inferCoreCommandCategory(commandId, commandName)
            : '其他'
          const category = currentSection || (command.category || '').trim() || inferredCategory

          commands.push({
            name: commandName,
            englishName: commandId,
            description: (command.summary || '').trim(),
            returnType: (command.returnType || manifest.returnType || '').trim() || '整数型',
            category,
            supportedPlatforms: extractSupportedPlatforms(command, manifest),
            params: mapCommandParams(command.params),
            isHidden: false,
            isMember: false,
            ownerTypeName: '',
            commandIndex: -1,
            nativeSymbol: ycmdCommandIdToNativeSymbol(commandId),
            libraryName: (manifest.libraryDisplayName || manifest.library || '').trim() || lib.name,
            libraryFileName: lib.name,
            source: 'ycmd',
            manifestPath: item.filePath,
          })
        }
        continue
      }

      if (!manifestSupportsTargetPlatform(manifest, targetPlatform)) continue
      const commandName = (manifest.displayName || manifest.commandId || '').trim()
      const commandId = (manifest.commandId || '').trim()
      if (!commandName || !commandId) continue

      const inferredCategory = lib.name === CORE_LIBRARY_FILE_NAME
        ? inferCoreCommandCategory(commandId, commandName)
        : '其他'

      commands.push({
        name: commandName,
        englishName: commandId,
        description: (manifest.summary || '').trim(),
        returnType: (manifest.returnType || '').trim() || '整数型',
        category: inferredCategory,
        supportedPlatforms: [],
        params: mapCommandParams(manifest.params),
        isHidden: false,
        isMember: false,
        ownerTypeName: '',
        commandIndex: -1,
        nativeSymbol: ycmdCommandIdToNativeSymbol(commandId),
        libraryName: (manifest.libraryDisplayName || manifest.library || '').trim() || lib.name,
        libraryFileName: lib.name,
        source: 'ycmd',
        manifestPath: item.filePath,
      })
    }
  }

  byPlatform.set(platformKey, commands)
  return commands
}
