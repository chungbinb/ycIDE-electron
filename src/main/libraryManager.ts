/**
 * 支持库管理器（ycmd 版）
 * 扫描 lib 目录中的 *.ycmd.json 清单，并补充窗口单元元数据。
 */
import { app } from 'electron'
import { createHash } from 'crypto'
import AdmZip from 'adm-zip'
import { dirname, isAbsolute, join, normalize, resolve } from 'path'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { getYcmdCommands, scanYcmdRegistry, type YcmdResolvedCommand, type YcmdTargetPlatform } from './ycmd-registry'
import {
  STORE_PLATFORM_ORDER,
  type InstalledLibraryState,
  type LibraryInstallResult,
  type LibraryInstallSource,
  type LibraryInstallStateFile,
  type LibraryPackageEntry,
  type LibraryRemoteIndex,
  type LibraryRemoteIndexResult,
  type LibraryRemoveResult,
  type Platform,
  type StoreLibraryCard,
} from '../shared/library-store'

export interface LibraryParam {
  name: string
  type: string
  description: string
  optional: boolean
  isVariable: boolean
  isArray: boolean
  repeatable?: boolean
}

export interface LibraryCommand {
  name: string
  englishName: string
  description: string
  returnType: string
  category: string
  params: LibraryParam[]
  isHidden: boolean
  isMember: boolean
  ownerTypeName: string
  commandIndex: number
  libraryName: string
  libraryFileName: string
  source: 'ycmd' | 'core'
  manifestPath: string
}

export interface LibraryDataType {
  name: string
  englishName: string
  description: string
  isWindowUnit: boolean
}

export interface LibraryConstant {
  name: string
  englishName: string
  description: string
  type: 'null' | 'number' | 'bool' | 'text'
  value: string
}

export interface LibraryWindowUnitProperty {
  name: string
  englishName: string
  description: string
  type: number
  typeName: string
  isReadOnly: boolean
  pickOptions: string[]
}

export interface LibraryWindowUnitEventArg {
  name: string
  description: string
  dataType: string
  isByRef: boolean
}

export interface LibraryWindowUnitEvent {
  name: string
  description: string
  args: LibraryWindowUnitEventArg[]
}

export interface LibraryWindowUnit {
  name: string
  englishName: string
  description: string
  className: string
  style: string
  properties: LibraryWindowUnitProperty[]
  events: LibraryWindowUnitEvent[]
  libraryName: string
}

export interface LibraryInfo {
  name: string
  guid: string
  version: string
  description: string
  author: string
  zipCode: string
  address: string
  phone: string
  qq: string
  email: string
  homePage: string
  otherInfo: string
  fileName: string
  commands: LibraryCommand[]
  dataTypes: LibraryDataType[]
  constants: LibraryConstant[]
  windowUnits: LibraryWindowUnit[]
}

export interface LibraryItem {
  name: string
  filePath: string
  loaded: boolean
  isCore: boolean
  source?: LibraryInstallSource
  libName?: string
  version?: string
  cmdCount?: number
  dtCount?: number
}

export interface LoadResult {
  success: boolean
  info: LibraryInfo | null
  error?: string
}

interface LibraryMetadataFile {
  guid?: string
  description?: string
  author?: string
  qq?: string
  email?: string
  homePage?: string
  otherInfo?: string
  dataTypes?: unknown
  constants?: unknown
  windowUnits?: unknown
  controlBindings?: unknown
  eventBindings?: unknown
}

interface LibraryProtocolControlBinding {
  unit: string
  unitEnglishName: string
  className: string
  style: string
}

interface LibraryProtocolEventBinding {
  unit: string
  event: string
}

interface ParsedLibraryMetadata {
  guid: string
  description: string
  author: string
  qq: string
  email: string
  homePage: string
  otherInfo: string
  dataTypes: LibraryDataType[]
  constants: LibraryConstant[]
  windowUnits: LibraryWindowUnit[]
}

const CORE_LIBRARY_NAME = '系统核心支持库'
const CORE_LIBRARY_FILE_NAME = 'krnln'
const CORE_LIBRARY_GUID = 'D09F2340818511D396F6AE4C17150413'

const CORE_LIBRARY_EXPECTED_SHA256: Record<string, string> = {
  'impl/linux.cpp': '1ab71de6a48d439a685199c99f61203b736447e10568b618dcdde7214db0d3d4',
  'impl/macos.mm': '3053240e3b75909dfddc22673d1a0f281bbcac4971d94a7fb6adefc096942029',
  'impl/windows.cpp': '1ab71de6a48d439a685199c99f61203b736447e10568b618dcdde7214db0d3d4',
  'krnln.commands.ycmd.json': '8fbe0fd59cbd4913c22ac6551beb7b612cebd55f37b13f3c976c63bb2ccb5b87',
  'krnln.constants.json': '8183767cf86c0348054a810511b2639bdfe7636c7efeacf096ecb8bfbf4a6fa0',
  'krnln.library.json': '0b9deb735168f4e67da1ca8be74d937d764fafc0559d973c72b545cbf391868d',
  'window-units.json': '82a9b8e0a052d4293f828ecabbea55f6357cfcc8db8516f486fc2073efdd14b8',
}

const DEFAULT_PROTOCOL_UNIT_PROPERTIES: LibraryWindowUnitProperty[] = [
  { name: '标题', englishName: 'text', description: '控件显示文本。', type: 0, typeName: '文本型', isReadOnly: false, pickOptions: [] },
  { name: '左边', englishName: 'left', description: '控件左边位置。', type: 0, typeName: '整数型', isReadOnly: false, pickOptions: [] },
  { name: '顶边', englishName: 'top', description: '控件顶边位置。', type: 0, typeName: '整数型', isReadOnly: false, pickOptions: [] },
  { name: '宽度', englishName: 'width', description: '控件宽度。', type: 0, typeName: '整数型', isReadOnly: false, pickOptions: [] },
  { name: '高度', englishName: 'height', description: '控件高度。', type: 0, typeName: '整数型', isReadOnly: false, pickOptions: [] },
  { name: '可视', englishName: 'visible', description: '是否可见。', type: 0, typeName: '逻辑型', isReadOnly: false, pickOptions: [] },
  { name: '禁止', englishName: 'disabled', description: '是否禁用。', type: 0, typeName: '逻辑型', isReadOnly: false, pickOptions: [] },
]

const LIBRARY_INSTALL_STATE_VERSION = '1.0'

function normalizeLibraryId(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')
}

function normalizeRemoteIndex(raw: unknown): LibraryRemoteIndex {
  const input = raw && typeof raw === 'object' ? raw as Partial<LibraryRemoteIndex> : {}
  const libraries = Array.isArray(input.libraries) ? input.libraries : []
  return {
    schemaVersion: typeof input.schemaVersion === 'string' && input.schemaVersion.trim() ? input.schemaVersion.trim() : '1.0',
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt.trim() : undefined,
    libraries: libraries
      .filter(item => !!item && typeof item === 'object')
      .map(item => {
        const id = normalizeLibraryId(item.id)
        const packageFileName = typeof item.packageFileName === 'string' ? item.packageFileName.trim() : `${id}.zip`
        const platforms = Array.isArray(item.supportedPlatforms)
          ? item.supportedPlatforms.filter((platform): platform is Platform => STORE_PLATFORM_ORDER.includes(platform as Platform))
          : []
        return {
          id,
          displayName: typeof item.displayName === 'string' && item.displayName.trim() ? item.displayName.trim() : id,
          version: typeof item.version === 'string' && item.version.trim() ? item.version.trim() : '-',
          packageFileName,
          packageUrl: typeof item.packageUrl === 'string' ? item.packageUrl.trim() : '',
          packageSha256: typeof item.packageSha256 === 'string' ? item.packageSha256.trim().toLowerCase() : '',
          size: typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : undefined,
          supportedPlatforms: platforms,
          minYcideVersion: typeof item.minYcideVersion === 'string' ? item.minYcideVersion.trim() : undefined,
          publishedAt: typeof item.publishedAt === 'string' ? item.publishedAt.trim() : undefined,
          summary: typeof item.summary === 'string' ? item.summary.trim() : undefined,
        }
      })
      .filter(item => item.id.length > 0 && item.packageUrl.length > 0 && item.id !== CORE_LIBRARY_FILE_NAME),
  }
}

function sha256Buffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function assertSafeZipEntry(entryName: string): string {
  const normalized = normalize(entryName.replace(/\\/g, '/')).replace(/\\/g, '/')
  if (!normalized || normalized === '.' || isAbsolute(normalized) || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`zip 内含不安全路径: ${entryName}`)
  }
  return normalized
}

function normalizeTargetPlatform(value?: string): YcmdTargetPlatform | undefined {
  if (value === 'windows' || value === 'macos' || value === 'linux' || value === 'harmony') return value
  return undefined
}

// 核心命令现已统一维护在 lib/krnln/krnln.commands.ycmd.json。

class LibraryManager {
  private libraries: LibraryItem[] = []
  private metadataCache = new Map<string, ParsedLibraryMetadata | null>()

  private shouldEnforceCoreLibraryIntegrity(): boolean {
    if (!app.isPackaged) return false
    const version = (app.getVersion() || '').toLowerCase()
    // 仅在稳定正式版强制校验，开发/预发布阶段允许核心库频繁迭代。
    return !/(alpha|beta|rc|pre|preview|dev|canary)/.test(version)
  }

  private getConfigPath(): string {
    return join(app.getPath('userData'), 'library-state.json')
  }

  private getInstalledRootPath(): string {
    return join(app.getPath('userData'), 'libraries')
  }

  private getInstallStatePath(): string {
    return join(this.getInstalledRootPath(), 'library-install-state.json')
  }

  private readInstallState(): LibraryInstallStateFile {
    try {
      const filePath = this.getInstallStatePath()
      if (!existsSync(filePath)) return { schemaVersion: LIBRARY_INSTALL_STATE_VERSION, libraries: {} }
      const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<LibraryInstallStateFile>
      const libraries = raw && typeof raw.libraries === 'object' && raw.libraries ? raw.libraries : {}
      return { schemaVersion: LIBRARY_INSTALL_STATE_VERSION, libraries: libraries as Record<string, InstalledLibraryState> }
    } catch {
      return { schemaVersion: LIBRARY_INSTALL_STATE_VERSION, libraries: {} }
    }
  }

  private writeInstallState(state: LibraryInstallStateFile): void {
    mkdirSync(this.getInstalledRootPath(), { recursive: true })
    writeFileSync(this.getInstallStatePath(), JSON.stringify({ schemaVersion: LIBRARY_INSTALL_STATE_VERSION, libraries: state.libraries }, null, 2), 'utf-8')
  }

  private getInstalledLibraryRoot(name: string): string {
    return join(this.getInstalledRootPath(), normalizeLibraryId(name))
  }

  async getRemoteIndex(indexUrl: string): Promise<LibraryRemoteIndexResult> {
    try {
      const response = await fetch(indexUrl, { cache: 'no-store' })
      if (!response.ok) return { ok: false, error: `读取支持库索引失败: HTTP ${response.status}` }
      const json = await response.json()
      return { ok: true, index: normalizeRemoteIndex(json) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: `读取支持库索引失败: ${message}` }
    }
  }

  async installFromRemote(name: string, indexUrl: string): Promise<LibraryInstallResult> {
    const libraryId = normalizeLibraryId(name)
    if (!libraryId) return { ok: false, error: '支持库标识无效' }
    if (this.isCore(libraryId)) return { ok: false, error: '核心支持库随 ycIDE 版本发布，不支持从服务器安装' }
    const indexResult = await this.getRemoteIndex(indexUrl)
    if (!indexResult.ok) return indexResult
    const entry = indexResult.index.libraries.find(item => item.id === libraryId)
    if (!entry) return { ok: false, error: `在线索引中未找到支持库 ${libraryId}` }
    return this.installPackage(entry)
  }

  private async installPackage(entry: LibraryPackageEntry): Promise<LibraryInstallResult> {
    const libraryId = normalizeLibraryId(entry.id)
    if (this.isCore(libraryId)) return { ok: false, error: '核心支持库随 ycIDE 版本发布，不支持从服务器安装' }
    const installRoot = this.getInstalledLibraryRoot(libraryId)
    const tempRoot = join(this.getInstalledRootPath(), `.install-${libraryId}-${Date.now()}`)
    try {
      const response = await fetch(entry.packageUrl, { cache: 'no-store' })
      if (!response.ok) return { ok: false, error: `下载 ${entry.displayName || libraryId} 失败: HTTP ${response.status}` }
      const buffer = Buffer.from(await response.arrayBuffer())
      const actualHash = sha256Buffer(buffer)
      if (entry.packageSha256 && actualHash !== entry.packageSha256.toLowerCase()) {
        return { ok: false, error: `支持库包校验失败: ${actualHash}` }
      }

      mkdirSync(tempRoot, { recursive: true })
      const zip = new AdmZip(buffer)
      const files: string[] = []
      for (const zipEntry of zip.getEntries()) {
        if (zipEntry.isDirectory) continue
        const relativePath = assertSafeZipEntry(zipEntry.entryName)
        const outputPath = resolve(tempRoot, relativePath)
        if (!outputPath.startsWith(resolve(tempRoot))) throw new Error(`zip 内含越界路径: ${zipEntry.entryName}`)
        mkdirSync(dirname(outputPath), { recursive: true })
        writeFileSync(outputPath, zipEntry.getData())
        files.push(relativePath)
      }
      if (!files.some(file => file.toLowerCase().endsWith('.ycmd.json'))) {
        throw new Error('支持库包中未找到 *.ycmd.json 清单')
      }

      rmSync(installRoot, { recursive: true, force: true })
      mkdirSync(this.getInstalledRootPath(), { recursive: true })
      renameSync(tempRoot, installRoot)

      const state = this.readInstallState()
      const previousLoaded = state.libraries[libraryId]?.loaded ?? this.libraries.find(lib => lib.name === libraryId)?.loaded ?? false
      const installed: InstalledLibraryState = {
        id: libraryId,
        downloaded: true,
        installed: true,
        loaded: previousLoaded,
        version: entry.version || '-',
        packageSha256: actualHash,
        sourceUrl: entry.packageUrl,
        installedAt: new Date().toISOString(),
        files: files.sort((a, b) => a.localeCompare(b)),
        updateAvailable: false,
        lastError: '',
        disabledReason: '',
        source: 'installed',
      }
      state.libraries[libraryId] = installed
      this.writeInstallState(state)
      this.metadataCache.clear()
      this.scan()
      return { ok: true, library: installed }
    } catch (error) {
      rmSync(tempRoot, { recursive: true, force: true })
      const message = error instanceof Error ? error.message : String(error)
      const state = this.readInstallState()
      const previous = state.libraries[libraryId]
      state.libraries[libraryId] = {
        id: libraryId,
        downloaded: previous?.downloaded ?? false,
        installed: previous?.installed ?? false,
        loaded: previous?.loaded ?? false,
        version: previous?.version || entry.version || '-',
        packageSha256: previous?.packageSha256 || entry.packageSha256 || '',
        sourceUrl: entry.packageUrl,
        installedAt: previous?.installedAt || '',
        files: previous?.files || [],
        updateAvailable: previous?.updateAvailable ?? false,
        lastError: message,
        disabledReason: previous?.disabledReason || '',
        source: 'installed',
      }
      this.writeInstallState(state)
      return { ok: false, error: message }
    }
  }

  removeInstalled(name: string): LibraryRemoveResult {
    const libraryId = normalizeLibraryId(name)
    if (!libraryId) return { ok: false, error: '支持库标识无效' }
    if (this.isCore(libraryId)) return { ok: false, error: '核心支持库不可移除' }
    rmSync(this.getInstalledLibraryRoot(libraryId), { recursive: true, force: true })
    const state = this.readInstallState()
    delete state.libraries[libraryId]
    this.writeInstallState(state)
    this.metadataCache.clear()
    this.scan()
    return { ok: true }
  }

  private getSavedLoadedNames(): string[] | null {
    try {
      const cfgPath = this.getConfigPath()
      if (!existsSync(cfgPath)) return null
      const data = JSON.parse(readFileSync(cfgPath, 'utf-8')) as { loadedLibs?: unknown }
      if (!Array.isArray(data.loadedLibs)) return []
      return data.loadedLibs.filter((x): x is string => typeof x === 'string')
    } catch {
      return []
    }
  }

  private saveLoadedState(): void {
    try {
      const loadedLibs = this.libraries.filter(l => l.loaded).map(l => l.name)
      writeFileSync(this.getConfigPath(), JSON.stringify({ loadedLibs }, null, 2), 'utf-8')
    } catch {
      // ignore
    }
  }

  private getLibraryDisplayMeta(customFolder?: string): Map<string, { libName: string; version: string; cmdCount: number }> {
    const root = customFolder || this.getLibFolder()
    const scan = scanYcmdRegistry(root)
    const map = new Map<string, { libName: string; version: string; cmdCount: number }>()

    for (const lib of scan.libraries) {
      let libName = lib.name
      let version = '-'
      let cmdCount = 0

      for (const item of lib.manifests) {
        if (!item.valid || !item.manifest) continue
        cmdCount++
        const manifest = item.manifest as {
          library?: string
          libraryDisplayName?: string
          libraryVersion?: string
          contractVersion?: string
        }

        if (manifest.libraryDisplayName && manifest.libraryDisplayName.trim()) {
          libName = manifest.libraryDisplayName.trim()
        } else if (manifest.library && manifest.library.trim() && libName === lib.name) {
          libName = manifest.library.trim()
        }

        if (manifest.libraryVersion && manifest.libraryVersion.trim()) {
          version = manifest.libraryVersion.trim()
        } else if (version === '-' && manifest.contractVersion && manifest.contractVersion.trim()) {
          version = manifest.contractVersion.trim()
        }
      }

      map.set(lib.name, { libName, version, cmdCount })
    }

    return map
  }

  private getLibraryFolder(name: string): string {
    const scanned = this.libraries.find(lib => lib.name === name)
    return scanned?.filePath || join(this.getLibFolder(), name)
  }

  private getMetadataFileCandidates(name: string, folderPath: string): string[] {
    return [
      join(folderPath, `${name}.library.json`),
      join(folderPath, `${name}.metadata.json`),
      join(folderPath, `${name}.identity.json`),
      join(folderPath, `${name}.protocol.json`),
      join(folderPath, `${name}.compile-protocol.json`),
      join(folderPath, 'library.json'),
      join(folderPath, 'identity.json'),
      join(folderPath, 'window-units.json'),
      join(folderPath, `${name}.window-units.json`),
    ]
  }

  private mergeTextField(current: string, value: unknown): string {
    if (typeof value !== 'string') return current
    const trimmed = value.trim()
    return trimmed || current
  }

  private parseLibraryDataTypes(value: unknown): LibraryDataType[] {
    if (!Array.isArray(value)) return []
    return value
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(item => ({
        name: typeof item.name === 'string' ? item.name.trim() : '',
        englishName: typeof item.englishName === 'string' ? item.englishName.trim() : '',
        description: typeof item.description === 'string' ? item.description.trim() : '',
        isWindowUnit: item.isWindowUnit === true,
      }))
      .filter(item => item.name.length > 0)
  }

  private parseLibraryConstants(value: unknown): LibraryConstant[] {
    if (!Array.isArray(value)) return []
    const parsed: LibraryConstant[] = []
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      if (!name) continue

      let constantType: LibraryConstant['type'] = 'null'
      if (item.type === 'number' || item.type === 'bool' || item.type === 'text') {
        constantType = item.type
      }

      parsed.push({
        name: typeof item.name === 'string' ? item.name.trim() : '',
        englishName: typeof item.englishName === 'string' ? item.englishName.trim() : '',
        description: typeof item.description === 'string' ? item.description.trim() : '',
        type: constantType,
        value: typeof item.value === 'string' ? item.value : String(item.value ?? ''),
      })
    }

    return parsed
  }

  private parseWindowUnitProperties(value: unknown): LibraryWindowUnitProperty[] {
    if (!Array.isArray(value)) return []
    return value
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(item => ({
        name: typeof item.name === 'string' ? item.name.trim() : '',
        englishName: typeof item.englishName === 'string' ? item.englishName.trim() : '',
        description: typeof item.description === 'string' ? item.description.trim() : '',
        type: typeof item.type === 'number' ? item.type : 0,
        typeName: typeof item.typeName === 'string' ? item.typeName.trim() : '文本型',
        isReadOnly: item.isReadOnly === true,
        pickOptions: Array.isArray(item.pickOptions)
          ? item.pickOptions.filter((entry): entry is string => typeof entry === 'string')
          : [],
      }))
      .filter(item => item.name.length > 0)
  }

  private parseWindowUnitEvents(value: unknown): LibraryWindowUnitEvent[] {
    if (!Array.isArray(value)) return []
    return value
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(item => ({
        name: typeof item.name === 'string' ? item.name.trim() : '',
        description: typeof item.description === 'string' ? item.description.trim() : '',
        args: Array.isArray(item.args)
          ? item.args
              .filter((arg): arg is Record<string, unknown> => !!arg && typeof arg === 'object')
              .map(arg => ({
                name: typeof arg.name === 'string' ? arg.name.trim() : '',
                description: typeof arg.description === 'string' ? arg.description.trim() : '',
                dataType: typeof arg.dataType === 'string' ? arg.dataType.trim() : '整数型',
                isByRef: arg.isByRef === true,
              }))
              .filter(arg => arg.name.length > 0)
          : [],
      }))
      .filter(item => item.name.length > 0)
  }

  private parseWindowUnits(value: unknown, libraryName: string): LibraryWindowUnit[] {
    if (!Array.isArray(value)) return []
    return value
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(item => ({
        name: typeof item.name === 'string' ? item.name.trim() : '',
        englishName: typeof item.englishName === 'string' ? item.englishName.trim() : '',
        description: typeof item.description === 'string' ? item.description.trim() : '',
        className: typeof item.className === 'string' ? item.className.trim() : '',
        style: typeof item.style === 'string' ? item.style.trim() : '',
        properties: this.parseWindowUnitProperties(item.properties),
        events: this.parseWindowUnitEvents(item.events),
        libraryName,
      }))
      .filter(item => item.name.length > 0)
  }

  private parseProtocolControlBindings(value: unknown): LibraryProtocolControlBinding[] {
    if (!Array.isArray(value)) return []
    return value
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(item => ({
        unit: typeof item.unit === 'string' ? item.unit.trim() : '',
        unitEnglishName: typeof item.unitEnglishName === 'string' ? item.unitEnglishName.trim() : '',
        className: typeof item.className === 'string' ? item.className.trim() : '',
        style: typeof item.style === 'string' ? item.style.trim() : '',
      }))
      .filter(item => item.unit.length > 0)
  }

  private parseProtocolEventBindings(value: unknown): LibraryProtocolEventBinding[] {
    if (!Array.isArray(value)) return []
    return value
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(item => ({
        unit: typeof item.unit === 'string' ? item.unit.trim() : '',
        event: typeof item.event === 'string' ? item.event.trim() : '',
      }))
      .filter(item => item.unit.length > 0 && item.event.length > 0)
  }

  private parseWindowUnitsFromProtocol(raw: LibraryMetadataFile, libraryName: string): LibraryWindowUnit[] {
    const controls = this.parseProtocolControlBindings(raw.controlBindings)
    if (controls.length === 0) return []

    const eventMap = new Map<string, LibraryWindowUnitEvent[]>()
    for (const eventBinding of this.parseProtocolEventBindings(raw.eventBindings)) {
      const existing = eventMap.get(eventBinding.unit) ?? []
      if (!existing.some(item => item.name === eventBinding.event)) {
        existing.push({
          name: eventBinding.event,
          description: `${eventBinding.unit}的${eventBinding.event}事件。`,
          args: [],
        })
      }
      eventMap.set(eventBinding.unit, existing)
    }

    return controls.map(control => ({
      name: control.unit,
      englishName: control.unitEnglishName,
      description: `${control.unit}控件。`,
      className: control.className,
      style: control.style,
      properties: DEFAULT_PROTOCOL_UNIT_PROPERTIES.map(item => ({
        ...item,
        pickOptions: [...item.pickOptions],
      })),
      events: eventMap.get(control.unit) ?? [],
      libraryName,
    }))
  }

  private mergeWindowUnits(primary: LibraryWindowUnit[], fallback: LibraryWindowUnit[]): LibraryWindowUnit[] {
    if (fallback.length === 0) return primary
    if (primary.length === 0) return fallback

    const map = new Map(primary.map(item => [item.name, item]))
    for (const unit of fallback) {
      const existing = map.get(unit.name)
      if (!existing) {
        map.set(unit.name, unit)
        continue
      }

      const mergedEvents = existing.events.length > 0
        ? existing.events
        : unit.events
      const mergedProperties = existing.properties.length > 0
        ? existing.properties
        : unit.properties
      map.set(unit.name, {
        ...existing,
        className: existing.className || unit.className,
        style: existing.style || unit.style,
        events: mergedEvents,
        properties: mergedProperties,
      })
    }

    return Array.from(map.values())
  }

  private getLibraryMetadata(name: string): ParsedLibraryMetadata | null {
    if (this.metadataCache.has(name)) {
      return this.metadataCache.get(name) ?? null
    }

    const folderPath = this.getLibraryFolder(name)
    const parsed: ParsedLibraryMetadata = {
      guid: '',
      description: '',
      author: '',
      qq: '',
      email: '',
      homePage: '',
      otherInfo: '',
      dataTypes: [],
      constants: [],
      windowUnits: [],
    }
    let hasMetadata = false

    for (const candidate of this.getMetadataFileCandidates(name, folderPath)) {
      if (!existsSync(candidate)) continue
      try {
        const raw = JSON.parse(readFileSync(candidate, 'utf-8')) as LibraryMetadataFile
        hasMetadata = true
        parsed.guid = this.mergeTextField(parsed.guid, raw.guid)
        parsed.description = this.mergeTextField(parsed.description, raw.description)
        parsed.author = this.mergeTextField(parsed.author, raw.author)
        parsed.qq = this.mergeTextField(parsed.qq, raw.qq)
        parsed.email = this.mergeTextField(parsed.email, raw.email)
        parsed.homePage = this.mergeTextField(parsed.homePage, raw.homePage)
        parsed.otherInfo = this.mergeTextField(parsed.otherInfo, raw.otherInfo)

        const dataTypes = this.parseLibraryDataTypes(raw.dataTypes)
        if (dataTypes.length > 0) parsed.dataTypes = dataTypes
        const constants = this.parseLibraryConstants(raw.constants)
        if (constants.length > 0) parsed.constants = constants
        const windowUnits = this.parseWindowUnits(raw.windowUnits, name)
        const protocolWindowUnits = this.parseWindowUnitsFromProtocol(raw, name)
        const mergedWindowUnits = this.mergeWindowUnits(windowUnits, protocolWindowUnits)
        if (mergedWindowUnits.length > 0) {
          parsed.windowUnits = this.mergeWindowUnits(parsed.windowUnits, mergedWindowUnits)
        }
      } catch {
        // ignore malformed metadata file and continue with other candidates
      }
    }

    this.metadataCache.set(name, hasMetadata ? parsed : null)
    return hasMetadata ? parsed : null
  }

  isCore(name: string): boolean {
    return normalizeLibraryId(name) === CORE_LIBRARY_FILE_NAME
  }

  validateCoreLibraryIntegrity(): { ok: boolean; errors: string[] } {
    if (!this.shouldEnforceCoreLibraryIntegrity()) {
      return { ok: true, errors: [] }
    }

    const errors: string[] = []
    const libRoot = this.getLibFolder()
    const coreFolder = join(libRoot, CORE_LIBRARY_FILE_NAME)
    if (!existsSync(coreFolder)) {
      errors.push(`核心支持库目录不存在: ${coreFolder}`)
      return { ok: false, errors }
    }

    const registry = scanYcmdRegistry(libRoot)
    const core = registry.libraries.find(lib => lib.name === CORE_LIBRARY_FILE_NAME)
    if (!core) {
      errors.push('核心支持库清单不存在或未包含任何 *.ycmd.json 文件')
    } else {
      for (const manifest of core.manifests) {
        if (manifest.valid) continue
        const detail = manifest.errors.join('；') || '清单无效'
        errors.push(`${manifest.filePath}: ${detail}`)
      }
    }

    for (const [relativePath, expectedHash] of Object.entries(CORE_LIBRARY_EXPECTED_SHA256)) {
      const filePath = join(coreFolder, relativePath)
      if (!existsSync(filePath)) {
        errors.push(`核心支持库文件缺失: ${relativePath}`)
        continue
      }
      const actualHash = sha256Buffer(readFileSync(filePath))
      if (actualHash !== expectedHash) {
        errors.push(`核心支持库文件被修改: ${relativePath}`)
      }
    }

    const metadata = this.getLibraryMetadata(CORE_LIBRARY_FILE_NAME)
    if (!metadata || metadata.guid !== CORE_LIBRARY_GUID) {
      errors.push('核心支持库标识文件无效或数字签名不匹配')
    }

    return { ok: errors.length === 0, errors }
  }

  getLibFolder(): string {
    const isDev = !app.isPackaged
    if (isDev) {
      return join(app.getAppPath(), 'lib')
    }
    return join(dirname(process.execPath), 'lib')
  }

  scan(customFolder?: string): LibraryItem[] {
    const roots = customFolder ? [customFolder] : [this.getLibFolder(), this.getInstalledRootPath()]
    const previousLoaded = new Map(this.libraries.map(l => [l.name, l.loaded]))
    const savedLoaded = this.getSavedLoadedNames()
    const savedSet = savedLoaded ? new Set(savedLoaded) : null
    const libraryMap = new Map<string, LibraryItem>()

    this.metadataCache.clear()

    for (const root of roots) {
      if (!existsSync(root)) continue
      const result = scanYcmdRegistry(root)
      const metaMap = this.getLibraryDisplayMeta(root)
      const source: LibraryInstallSource = root === this.getInstalledRootPath() ? 'installed' : 'bundled'
      for (const lib of result.libraries) {
        if (source === 'installed' && this.isCore(lib.name)) continue
        libraryMap.set(lib.name, {
          name: lib.name,
          filePath: lib.folderPath,
          loaded: this.isCore(lib.name)
            ? true
            : (savedSet
                ? savedSet.has(lib.name)
                : (previousLoaded.get(lib.name) ?? true)),
          isCore: this.isCore(lib.name),
          source,
          libName: metaMap.get(lib.name)?.libName || lib.name,
          version: metaMap.get(lib.name)?.version || '-',
          cmdCount: metaMap.get(lib.name)?.cmdCount ?? lib.manifests.filter(item => item.valid).length,
          dtCount: 0,
        })
      }
    }

    this.libraries = Array.from(libraryMap.values()).sort((a, b) => {
      if (a.isCore !== b.isCore) return a.isCore ? -1 : 1
      return (a.libName || a.name).localeCompare(b.libName || b.name, 'zh-CN')
    })
    this.libraries = this.libraries.map(lib => ({
      ...lib,
      dtCount: this.getLibraryMetadata(lib.name)?.dataTypes.length ?? 0,
    }))

    return this.libraries
  }

  scanAndAutoLoad(): void {
    this.scan()
  }

  load(name: string): LoadResult {
    if (this.libraries.length === 0) this.scan()
    const item = this.libraries.find(l => l.name === name)
    if (!item) return { success: false, info: null, error: `未找到支持库 ${name}` }
    if (!item.loaded) {
      item.loaded = true
      this.saveLoadedState()
    }
    const info = this.getLibInfo(name)
    if (!info) return { success: false, info: null, error: `未找到支持库 ${name}` }
    return { success: true, info }
  }

  unload(name: string): { success: boolean; error?: string } {
    if (this.isCore(name)) {
      return { success: false, error: '核心支持库不可卸载' }
    }
    if (this.libraries.length === 0) this.scan()
    const item = this.libraries.find(l => l.name === name)
    if (!item) return { success: false, error: `未找到支持库 ${name}` }
    if (!item.loaded) return { success: true }
    item.loaded = false
    this.saveLoadedState()
    return { success: true }
  }

  applySelection(selectedNames: string[]): { loadedCount: number; unloadedCount: number; failed: Array<{ name: string; error: string }> } {
    if (this.libraries.length === 0) this.scan()

    const failed: Array<{ name: string; error: string }> = []
    const selected = new Set(selectedNames)
    selected.add(CORE_LIBRARY_FILE_NAME)

    let loadedCount = 0
    let unloadedCount = 0

    for (const item of this.libraries) {
      const targetLoaded = this.isCore(item.name) ? true : selected.has(item.name)
      if (item.loaded === targetLoaded) continue

      if (!targetLoaded && this.isCore(item.name)) {
        failed.push({ name: item.name, error: '核心支持库不可卸载' })
        continue
      }

      if (targetLoaded) {
        item.loaded = true
        loadedCount++
      } else {
        item.loaded = false
        unloadedCount++
      }
    }

    this.saveLoadedState()
    return { loadedCount, unloadedCount, failed }
  }

  loadAll(): number {
    if (this.libraries.length === 0) this.scan()
    let changed = 0
    for (const item of this.libraries) {
      if (!item.loaded) {
        item.loaded = true
        changed++
      }
    }
    if (changed > 0) this.saveLoadedState()
    return changed
  }

  getList(): LibraryItem[] {
    return this.scan()
  }

  private librarySupportsTargetPlatform(lib: LibraryItem, targetPlatform?: string): boolean {
    const platform = normalizeTargetPlatform(targetPlatform)
    if (!platform || lib.isCore) return true
    const registry = scanYcmdRegistry(dirname(lib.filePath))
    const scanned = registry.libraries.find(item => item.name === lib.name)
    if (!scanned) return false
    return scanned.manifests.some(item => item.valid && !!item.manifest?.implementations?.[platform]?.entry)
  }

  private getLoadedLibrariesForTarget(targetPlatform?: string): LibraryItem[] {
    if (this.libraries.length === 0) this.scan()
    return this.libraries.filter(lib => lib.loaded && this.librarySupportsTargetPlatform(lib, targetPlatform))
  }

  async getStoreCards(indexUrl?: string): Promise<StoreLibraryCard[]> {
    const libraries = this.scan()
    const supportedPlatformsById = new Map<string, Platform[]>()
    const downloadedById = new Map<string, boolean>()
    const installState = this.readInstallState()
    const remoteIndex = indexUrl ? await this.getRemoteIndex(indexUrl) : null
    const remoteById = new Map<string, LibraryPackageEntry>()

    if (remoteIndex?.ok) {
      for (const item of remoteIndex.index.libraries) remoteById.set(item.id, item)
    }

    for (const root of [this.getLibFolder(), this.getInstalledRootPath()]) {
      if (!existsSync(root)) continue
      const registry = scanYcmdRegistry(root)
      for (const lib of registry.libraries) {
        const platforms = new Set<Platform>(supportedPlatformsById.get(lib.name) || [])
        let hasValidManifest = downloadedById.get(lib.name) || false
        for (const item of lib.manifests) {
          if (!item.valid || !item.manifest) continue
          hasValidManifest = true
          const implementations = item.manifest.implementations
          if (!implementations || typeof implementations !== 'object') continue
          for (const platform of STORE_PLATFORM_ORDER) {
            if (implementations[platform]?.entry) {
              platforms.add(platform)
            }
          }
        }
        supportedPlatformsById.set(lib.name, STORE_PLATFORM_ORDER.filter(platform => platforms.has(platform)))
        downloadedById.set(lib.name, hasValidManifest)
      }
    }

    const cards = libraries.map(lib => {
      const installInfo = installState.libraries[lib.name]
      const remoteInfo = remoteById.get(lib.name)
      return {
      id: lib.name,
      displayName: lib.libName || lib.name,
      version: installInfo?.version || lib.version || '-',
      supportedPlatforms: remoteInfo?.supportedPlatforms || supportedPlatformsById.get(lib.name) || [],
      isDownloaded: installInfo?.downloaded || downloadedById.get(lib.name) || false,
      isInstalled: installInfo?.installed || lib.source === 'installed' || lib.source === 'bundled',
      isLoaded: lib.loaded,
      isCore: lib.isCore,
      source: lib.source,
      updateAvailable: !!remoteInfo && !!installInfo?.version && remoteInfo.version !== installInfo.version,
      lastError: installInfo?.lastError || '',
      packageFileName: remoteInfo?.packageFileName,
      packageUrl: remoteInfo?.packageUrl,
      packageSha256: remoteInfo?.packageSha256,
      remoteVersion: remoteInfo?.version,
      } satisfies StoreLibraryCard
    })

    for (const remote of remoteById.values()) {
      if (cards.some(card => card.id === remote.id)) continue
      const installInfo = installState.libraries[remote.id]
      cards.push({
        id: remote.id,
        displayName: remote.displayName,
        version: installInfo?.version || remote.version || '-',
        supportedPlatforms: remote.supportedPlatforms,
        isDownloaded: installInfo?.downloaded || false,
        isInstalled: installInfo?.installed || false,
        isLoaded: installInfo?.loaded || false,
        isCore: this.isCore(remote.id),
        source: installInfo?.source || 'installed',
        updateAvailable: !!installInfo?.version && installInfo.version !== remote.version,
        lastError: installInfo?.lastError || '',
        packageFileName: remote.packageFileName,
        packageUrl: remote.packageUrl,
        packageSha256: remote.packageSha256,
        remoteVersion: remote.version,
      })
    }

    return cards
  }

  private mapYcmdCommand(cmd: YcmdResolvedCommand): LibraryCommand {
    return {
      ...cmd,
      params: (cmd.params || []).map(p => ({
        name: p.name,
        type: p.type,
        description: p.description,
        optional: !!p.optional,
        isVariable: !!p.isVariable,
        isArray: !!p.isArray,
      })),
    }
  }

  getAllCommands(targetPlatform?: string): LibraryCommand[] {
    const platform = normalizeTargetPlatform(targetPlatform)
    const loadedLibraries = this.getLoadedLibrariesForTarget(platform)
    const loadedYcmdCommands = loadedLibraries
      .flatMap(lib => getYcmdCommands(dirname(lib.filePath), platform).filter(cmd => cmd.libraryFileName === lib.name))
    const commands: LibraryCommand[] = loadedYcmdCommands.map(cmd => this.mapYcmdCommand(cmd))

    const deduped = new Map<string, LibraryCommand>()
    for (const command of commands) {
      if (!deduped.has(command.name)) deduped.set(command.name, command)
    }
    return Array.from(deduped.values())
  }

  getAllDataTypes(targetPlatform?: string): LibraryDataType[] {
    return this.getLoadedLibrariesForTarget(targetPlatform)
      .flatMap(lib => this.getLibraryMetadata(lib.name)?.dataTypes || [])
  }

  getLibInfo(name: string): LibraryInfo | null {
    if (this.libraries.length === 0) this.scan()
    const isCoreLibrary = this.isCore(name) || name === CORE_LIBRARY_NAME
    const item = this.libraries.find(lib => lib.name === name || lib.libName === name)
    const libraryId = item?.name || name
    const commands = (item ? getYcmdCommands(dirname(item.filePath)) : [])
      .map(cmd => this.mapYcmdCommand(cmd))
      .filter(cmd => cmd.libraryFileName === libraryId || cmd.libraryName === name || cmd.libraryName === libraryId)
    const metadata = this.getLibraryMetadata(libraryId)

    if (commands.length === 0 && !metadata) return null

    const displayMeta = item ? { libName: item.libName || item.name, version: item.version || '-', cmdCount: item.cmdCount || 0 } : this.getLibraryDisplayMeta().get(libraryId)
    return {
      name: isCoreLibrary ? CORE_LIBRARY_NAME : (displayMeta?.libName || name),
      guid: metadata?.guid || '-',
      version: displayMeta?.version || '-',
      description: metadata?.description || (isCoreLibrary ? '系统核心支持库命令与元数据由支持库清单提供。' : '由 ycmd 清单生成'),
      author: metadata?.author || '-',
      zipCode: '-',
      address: '-',
      phone: '-',
      qq: metadata?.qq || '-',
      email: metadata?.email || '-',
      homePage: metadata?.homePage || '-',
      otherInfo: metadata?.otherInfo || '-',
      fileName: libraryId,
      commands,
      dataTypes: metadata?.dataTypes || [],
      constants: metadata?.constants || [],
      windowUnits: metadata?.windowUnits || [],
    }
  }

  getAllWindowUnits(targetPlatform?: string): LibraryWindowUnit[] {
    return this.getLoadedLibrariesForTarget(targetPlatform)
      .flatMap(lib => this.getLibraryMetadata(lib.name)?.windowUnits || [])
  }

  findStaticLib(_name: string, _arch: string): string | null {
    return null
  }

  getLoadedLibraryFiles(): Array<{ name: string; libraryPath: string; libName: string }> {
    return []
  }
}

export const libraryManager = new LibraryManager()
