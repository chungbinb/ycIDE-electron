import { app } from 'electron'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { dirname, extname, join, relative } from 'path'

export interface YcmdPlatformImplementation {
  entry: string
  language?: string
}

export interface YcmdManifest {
  contractVersion: string
  commandId: string
  libraryDisplayName?: string
  libraryVersion?: string
  displayName?: string
  summary?: string
  library?: string
  params?: Array<{ name: string; type: string; optional?: boolean }>
  returnType?: string
  implementations?: {
    windows?: YcmdPlatformImplementation
    macos?: YcmdPlatformImplementation
    linux?: YcmdPlatformImplementation
    harmony?: YcmdPlatformImplementation
  }
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
  params: Array<{ name: string; type: string; optional: boolean; isVariable: boolean; isArray: boolean; description: string }>
  isHidden: boolean
  isMember: boolean
  ownerTypeName: string
  commandIndex: number
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

export type YcmdTargetPlatform = 'windows' | 'macos' | 'linux' | 'harmony'

function getLibRootPath(): string {
  const isDev = !app.isPackaged
  if (isDev) {
    return join(app.getAppPath(), 'lib')
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

function validateManifest(filePath: string, manifest: YcmdManifest): string[] {
  const errors: string[] = []
  if (!manifest.contractVersion || typeof manifest.contractVersion !== 'string') {
    errors.push('缺少 contractVersion')
  }
  if (!manifest.commandId || typeof manifest.commandId !== 'string') {
    errors.push('缺少 commandId')
  }

  const impl = manifest.implementations
  if (!impl || typeof impl !== 'object') {
    errors.push('缺少 implementations')
    return errors
  }

  const manifestDir = dirname(filePath)
  const entries: Array<{ platform: string; entry?: string }> = [
    { platform: 'windows', entry: impl.windows?.entry },
    { platform: 'macos', entry: impl.macos?.entry },
    { platform: 'linux', entry: impl.linux?.entry },
    { platform: 'harmony', entry: impl.harmony?.entry },
  ]

  for (const item of entries) {
    if (!item.entry) continue
    const resolved = join(manifestDir, item.entry)
    if (!existsSync(resolved)) {
      errors.push(`实现文件不存在: ${item.platform} -> ${item.entry}`)
    }
  }

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

export function scanYcmdRegistry(customRootPath?: string): YcmdRegistryScanResult {
  const rootPath = customRootPath || getLibRootPath()
  const errors: string[] = []

  if (!existsSync(rootPath)) {
    return { rootPath, libraries: [], errors: ['lib 根目录不存在'] }
  }

  const libraries: YcmdLibraryItem[] = []
  let children: string[] = []
  try {
    children = readdirSync(rootPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { rootPath, libraries: [], errors: [`读取 lib 根目录失败: ${message}`] }
  }

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

    const manifests = ycmdFiles.map(file => parseManifest(file))
    libraries.push({ name: child, folderPath, manifests })

    for (const item of manifests) {
      if (!item.valid) {
        for (const detail of item.errors) {
          errors.push(`${relative(rootPath, item.filePath)}: ${detail}`)
        }
      }
    }
  }

  return { rootPath, libraries, errors }
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

export function getYcmdCommands(customRootPath?: string, targetPlatform?: YcmdTargetPlatform): YcmdResolvedCommand[] {
  const scanResult = scanYcmdRegistry(customRootPath)
  const commands: YcmdResolvedCommand[] = []

  for (const lib of scanResult.libraries) {
    for (const item of lib.manifests) {
      if (!item.valid || !item.manifest) continue
      const manifest = item.manifest
      if (!manifestSupportsTargetPlatform(manifest, targetPlatform)) continue
      const commandName = (manifest.displayName || manifest.commandId || '').trim()
      const commandId = (manifest.commandId || '').trim()
      if (!commandName || !commandId) continue

      const params = (manifest.params || []).map(p => ({
        name: (p.name || '').trim() || '参数',
        type: (p.type || '').trim() || '整数型',
        optional: !!p.optional,
        isVariable: false,
        isArray: false,
        description: '',
      }))

      commands.push({
        name: commandName,
        englishName: commandId,
        description: (manifest.summary || '').trim(),
        returnType: (manifest.returnType || '').trim() || '整数型',
        category: 'ycmd',
        params,
        isHidden: false,
        isMember: false,
        ownerTypeName: '',
        commandIndex: -1,
        libraryName: (manifest.libraryDisplayName || manifest.library || '').trim() || lib.name,
        libraryFileName: lib.name,
        source: 'ycmd',
        manifestPath: item.filePath,
      })
    }
  }

  return commands
}
