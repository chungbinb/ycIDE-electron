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
  'krnln.library.json': '0b9deb735168f4e67da1ca8be74d937d764fafc0559d973c72b545cbf391868d',
  'krnln.protocol.json': '95d58141151568ae3962f5f110822cd04153b9b6a003d3b768be27234a97b9d8',
  'messageBox.ycmd.json': '1b529b2c40e8a8289fc4d937f4112a85c0b42238f77e6bb1c67b1c97b60abfcf',
  'window-units.json': '613374ad7107c508868212654590b44189066e9f8cae53970bd2c54ba757e6b3',
}

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
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
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

const CORE_FLOW_COMMANDS: LibraryCommand[] = [
  {
    name: '如果',
    englishName: 'ife',
    description: '根据逻辑条件决定是否执行后续语句，否则跳转到对应分支或结束处。',
    returnType: '',
    category: '流程控制',
    params: [{ name: '条件', type: '逻辑型', description: '本条件值的结果决定下一步程序执行位置。', optional: false, isVariable: false, isArray: false }],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '如果真',
    englishName: 'if',
    description: '条件为真时继续向下执行，否则直接跳到对应结束处。',
    returnType: '',
    category: '流程控制',
    params: [{ name: '条件', type: '逻辑型', description: '本条件值的结果决定下一步程序执行位置。', optional: false, isVariable: false, isArray: false }],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '判断',
    englishName: 'switch',
    description: '根据逻辑条件决定是否进入当前分支，否则跳转到下一分支继续判断。',
    returnType: '',
    category: '流程控制',
    params: [{ name: '条件', type: '逻辑型', description: '本条件值的结果决定下一步程序执行位置。', optional: false, isVariable: false, isArray: false }],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '否则',
    englishName: 'else',
    description: '条件结构的否则分支。',
    returnType: '',
    category: '流程控制',
    params: [],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '默认',
    englishName: 'default',
    description: '判断结构中的默认分支。',
    returnType: '',
    category: '流程控制',
    params: [],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '如果结束',
    englishName: 'endife',
    description: '结束“如果”结构。',
    returnType: '',
    category: '流程控制',
    params: [],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '如果真结束',
    englishName: 'endif',
    description: '结束“如果真”结构。',
    returnType: '',
    category: '流程控制',
    params: [],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '判断结束',
    englishName: 'endswitch',
    description: '结束“判断”结构。',
    returnType: '',
    category: '流程控制',
    params: [],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '判断循环首',
    englishName: 'while',
    description: '条件为真时进入循环，否则跳出循环。',
    returnType: '',
    category: '流程控制',
    params: [{ name: '条件', type: '逻辑型', description: '本条件值的结果决定是否进入循环。', optional: false, isVariable: false, isArray: false }],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '判断循环尾',
    englishName: 'wend',
    description: '结束“判断循环首”结构并回到循环条件处。',
    returnType: '',
    category: '流程控制',
    params: [],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '循环判断首',
    englishName: 'DoWhile',
    description: '先执行一次循环体，再由对应的“循环判断尾”决定是否继续。',
    returnType: '',
    category: '流程控制',
    params: [],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '循环判断尾',
    englishName: 'loop',
    description: '根据逻辑条件决定是否回到对应的“循环判断首”继续循环。',
    returnType: '',
    category: '流程控制',
    params: [{ name: '条件', type: '逻辑型', description: '本条件值的结果决定下一步程序执行位置。', optional: false, isVariable: false, isArray: false }],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '计次循环首',
    englishName: 'counter',
    description: '按指定次数执行循环体，可选输出当前已循环次数变量。',
    returnType: '',
    category: '流程控制',
    params: [
      { name: '循环次数', type: '整数型', description: '指定执行循环体的次数。', optional: false, isVariable: false, isArray: false },
      { name: '已循环次数记录变量', type: '整数型', description: '记录当前已进入循环的次数。', optional: true, isVariable: true, isArray: false },
    ],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '计次循环尾',
    englishName: 'CounterLoop',
    description: '结束“计次循环首”结构。',
    returnType: '',
    category: '流程控制',
    params: [],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '变量循环首',
    englishName: 'for',
    description: '利用循环变量执行循环，可指定起始值、目标值和递增值。',
    returnType: '',
    category: '流程控制',
    params: [
      { name: '变量起始值', type: '整数型', description: '循环变量初始值。', optional: false, isVariable: false, isArray: false },
      { name: '变量目标值', type: '整数型', description: '循环变量目标值。', optional: false, isVariable: false, isArray: false },
      { name: '变量递增值', type: '整数型', description: '每轮循环递增或递减值。', optional: false, isVariable: false, isArray: false },
      { name: '循环变量', type: '整数型', description: '循环变量，可省略。', optional: true, isVariable: true, isArray: false },
    ],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '变量循环尾',
    englishName: 'next',
    description: '结束“变量循环首”结构。',
    returnType: '',
    category: '流程控制',
    params: [],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '到循环尾',
    englishName: 'continue',
    description: '转移当前程序执行位置到当前所处循环体的循环尾语句处。',
    returnType: '',
    category: '流程控制',
    params: [],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '跳出循环',
    englishName: 'break',
    description: '转移当前程序执行位置到当前所处循环体结束后的下一条语句。',
    returnType: '',
    category: '流程控制',
    params: [],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '返回',
    englishName: 'return',
    description: '返回到调用本子程序的下一条语句处。当前编译器暂不支持返回值类型推导。',
    returnType: '',
    category: '流程控制',
    params: [{ name: '返回到调用方的值', type: '通用型', description: '可选。当前版本仅保留语义，不参与返回值编译。', optional: true, isVariable: false, isArray: false }],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '结束',
    englishName: 'end',
    description: '结束当前程序运行。',
    returnType: '',
    category: '流程控制',
    params: [],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
]

const CORE_LOGIC_COMMANDS: LibraryCommand[] = [
  {
    name: '等于',
    englishName: 'equal',
    description: '被比较值与比较值相同时返回真，否则返回假。',
    returnType: '逻辑型',
    category: '逻辑比较',
    params: [
      { name: '被比较值', type: '通用型', description: '参与比较的值。', optional: false, isVariable: false, isArray: false },
      { name: '比较值', type: '通用型', description: '用于比较的值。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '不等于',
    englishName: 'notEqual',
    description: '被比较值与比较值不相同时返回真，否则返回假。',
    returnType: '逻辑型',
    category: '逻辑比较',
    params: [
      { name: '被比较值', type: '通用型', description: '参与比较的值。', optional: false, isVariable: false, isArray: false },
      { name: '比较值', type: '通用型', description: '用于比较的值。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '小于',
    englishName: 'less',
    description: '被比较值小于比较值时返回真。',
    returnType: '逻辑型',
    category: '逻辑比较',
    params: [
      { name: '被比较值', type: '通用型', description: '参与比较的值。', optional: false, isVariable: false, isArray: false },
      { name: '比较值', type: '通用型', description: '用于比较的值。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '大于',
    englishName: 'greater',
    description: '被比较值大于比较值时返回真。',
    returnType: '逻辑型',
    category: '逻辑比较',
    params: [
      { name: '被比较值', type: '通用型', description: '参与比较的值。', optional: false, isVariable: false, isArray: false },
      { name: '比较值', type: '通用型', description: '用于比较的值。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '小于或等于',
    englishName: 'lessOrEqual',
    description: '被比较值小于或等于比较值时返回真。',
    returnType: '逻辑型',
    category: '逻辑比较',
    params: [
      { name: '被比较值', type: '通用型', description: '参与比较的值。', optional: false, isVariable: false, isArray: false },
      { name: '比较值', type: '通用型', description: '用于比较的值。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '大于或等于',
    englishName: 'greaterOrEqual',
    description: '被比较值大于或等于比较值时返回真。',
    returnType: '逻辑型',
    category: '逻辑比较',
    params: [
      { name: '被比较值', type: '通用型', description: '参与比较的值。', optional: false, isVariable: false, isArray: false },
      { name: '比较值', type: '通用型', description: '用于比较的值。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '近似等于',
    englishName: 'like',
    description: '比较文本出现在被比较文本首部时返回真。',
    returnType: '逻辑型',
    category: '逻辑比较',
    params: [
      { name: '被比较文本', type: '文本型', description: '参与比较的文本。', optional: false, isVariable: false, isArray: false },
      { name: '比较文本', type: '文本型', description: '用于比较的文本。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '并且',
    englishName: 'and',
    description: '所有逻辑值都为真时返回真。',
    returnType: '逻辑型',
    category: '逻辑比较',
    params: [
      { name: '逻辑值一', type: '逻辑型', description: '参与运算的逻辑值。', optional: false, isVariable: false, isArray: false },
      { name: '逻辑值二', type: '逻辑型', description: '参与运算的逻辑值。', optional: false, isVariable: false, isArray: false, repeatable: true },
    ],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '或者',
    englishName: 'or',
    description: '任一逻辑值为真时返回真。',
    returnType: '逻辑型',
    category: '逻辑比较',
    params: [
      { name: '逻辑值一', type: '逻辑型', description: '参与运算的逻辑值。', optional: false, isVariable: false, isArray: false },
      { name: '逻辑值二', type: '逻辑型', description: '参与运算的逻辑值。', optional: false, isVariable: false, isArray: false, repeatable: true },
    ],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '取反',
    englishName: 'not',
    description: '将逻辑值取反。',
    returnType: '逻辑型',
    category: '逻辑比较',
    params: [
      { name: '被反转的逻辑值', type: '逻辑型', description: '需要取反的逻辑值。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
]

const CORE_DEBUG_COMMANDS: LibraryCommand[] = [
  {
    name: '输出调试文本',
    englishName: 'OutputDebugText',
    description: '仅在调试版中输出调试文本行，发布版直接跳过。',
    returnType: '',
    category: '程序调试',
    params: [
      { name: '准备输出的调试文本信息', type: '通用型', description: '要输出的调试文本或值。', optional: false, isVariable: false, isArray: false, repeatable: true },
    ],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '暂停',
    englishName: 'stop',
    description: '仅在调试版中执行，相当于命中断点。',
    returnType: '',
    category: '程序调试',
    params: [],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '检查',
    englishName: 'assert',
    description: '仅在调试版中执行，条件为假时暂停并警示。',
    returnType: '',
    category: '程序调试',
    params: [
      { name: '被校验的条件', type: '逻辑型', description: '需要校验的条件。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
  {
    name: '是否为调试版',
    englishName: 'IsDebugVer',
    description: '当前程序为调试版时返回真，否则返回假。',
    returnType: '逻辑型',
    category: '程序调试',
    params: [],
    isHidden: false,
    isMember: false,
    ownerTypeName: '',
    commandIndex: -1,
    libraryName: CORE_LIBRARY_NAME,
    libraryFileName: 'krnln',
    source: 'core',
    manifestPath: '',
  },
]

const CORE_DISK_COMMANDS: LibraryCommand[] = [
  {
    name: '取磁盘总空间',
    englishName: 'GetDiskTotalSpace',
    description: '返回以 1024 字节为单位的指定磁盘全部空间；失败返回 -1。',
    returnType: '整数型',
    category: '磁盘操作',
    params: [
      { name: '磁盘驱动器字符', type: '文本型', description: '类似“A”“C”，只取首字符；省略时使用当前驱动器。', optional: true, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '取磁盘剩余空间',
    englishName: 'GetDiskFreeSpace',
    description: '返回以 1024 字节为单位的指定磁盘剩余空间；失败返回 -1。',
    returnType: '整数型',
    category: '磁盘操作',
    params: [
      { name: '磁盘驱动器字符', type: '文本型', description: '类似“A”“C”，只取首字符；省略时使用当前驱动器。', optional: true, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '取磁盘卷标',
    englishName: 'GetDiskLabel',
    description: '返回指定磁盘的卷标文本；失败返回空文本。',
    returnType: '文本型',
    category: '磁盘操作',
    params: [
      { name: '磁盘驱动器字符', type: '文本型', description: '类似“A”“C”，只取首字符；省略时使用当前驱动器。', optional: true, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '置磁盘卷标',
    englishName: 'SetDiskLabel',
    description: '设置指定磁盘的卷标文本。成功返回真，失败返回假。',
    returnType: '逻辑型',
    category: '磁盘操作',
    params: [
      { name: '磁盘驱动器字符', type: '文本型', description: '类似“A”“C”，只取首字符；省略时使用当前驱动器。', optional: true, isVariable: false, isArray: false },
      { name: '欲置入的卷标文本', type: '文本型', description: '新的卷标文本。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '改变驱动器',
    englishName: 'ChDrive',
    description: '改变当前的缺省驱动器。成功返回真，失败返回假。',
    returnType: '逻辑型',
    category: '磁盘操作',
    params: [
      { name: '欲改变到的驱动器', type: '文本型', description: '类似“A”“C”，只取首字符。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '改变目录',
    englishName: 'ChDir',
    description: '改变当前目录。成功返回真，失败返回假。',
    returnType: '逻辑型',
    category: '磁盘操作',
    params: [
      { name: '欲改变到的目录', type: '文本型', description: '目标目录。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '取当前目录',
    englishName: 'CurDir',
    description: '返回当前目录；失败返回空文本。',
    returnType: '文本型',
    category: '磁盘操作',
    params: [],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '创建目录',
    englishName: 'MkDir',
    description: '创建目录。成功返回真，失败返回假。',
    returnType: '逻辑型',
    category: '磁盘操作',
    params: [
      { name: '欲创建的目录名称', type: '文本型', description: '要创建的目录。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '删除目录',
    englishName: 'RmDir',
    description: '递归删除目录及其中的所有文件和子目录。成功返回真，失败返回假。',
    returnType: '逻辑型',
    category: '磁盘操作',
    params: [
      { name: '欲删除的目录名称', type: '文本型', description: '要删除的目录。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '复制文件',
    englishName: 'FileCopy',
    description: '复制文件。成功返回真，失败返回假。',
    returnType: '逻辑型',
    category: '磁盘操作',
    params: [
      { name: '被复制的文件名', type: '文本型', description: '源文件。', optional: false, isVariable: false, isArray: false },
      { name: '复制到的文件名', type: '文本型', description: '目标文件。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '移动文件',
    englishName: 'FileMove',
    description: '移动文件。成功返回真，失败返回假。',
    returnType: '逻辑型',
    category: '磁盘操作',
    params: [
      { name: '被移动的文件', type: '文本型', description: '源文件。', optional: false, isVariable: false, isArray: false },
      { name: '移动到的位置', type: '文本型', description: '目标位置。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '删除文件',
    englishName: 'kill',
    description: '删除文件。成功返回真，失败返回假。',
    returnType: '逻辑型',
    category: '磁盘操作',
    params: [
      { name: '欲删除的文件名', type: '文本型', description: '目标文件。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '文件更名',
    englishName: 'name',
    description: '重命名文件或目录。成功返回真，失败返回假。',
    returnType: '逻辑型',
    category: '磁盘操作',
    params: [
      { name: '欲更名的原文件或目录名', type: '文本型', description: '原路径。', optional: false, isVariable: false, isArray: false },
      { name: '欲更改为的现文件或目录名', type: '文本型', description: '新路径。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '文件是否存在',
    englishName: 'IsFileExist',
    description: '判断指定文件是否存在。存在返回真，否则返回假。',
    returnType: '逻辑型',
    category: '磁盘操作',
    params: [
      { name: '欲测试的文件名称', type: '文本型', description: '目标文件。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '寻找文件',
    englishName: 'dir',
    description: '按通配符顺序枚举匹配的文件或目录名；第一次调用应提供匹配模式。',
    returnType: '文本型',
    category: '磁盘操作',
    params: [
      { name: '欲寻找的文件或目录名称', type: '文本型', description: '支持 * 和 ?；后续继续枚举时可省略。', optional: true, isVariable: false, isArray: false },
      { name: '欲寻找文件的属性', type: '整数型', description: 'Windows 文件属性过滤。省略时默认匹配非目录项。', optional: true, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '取文件尺寸',
    englishName: 'FileLen',
    description: '返回文件长度，单位字节；文件不存在时返回 -1。',
    returnType: '整数型',
    category: '磁盘操作',
    params: [
      { name: '文件名', type: '文本型', description: '目标文件。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '取文件属性',
    englishName: 'GetAttr',
    description: '返回文件或目录属性；失败返回 -1。',
    returnType: '整数型',
    category: '磁盘操作',
    params: [
      { name: '文件名', type: '文本型', description: '目标文件或目录。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '置文件属性',
    englishName: 'SetAttr',
    description: '设置文件属性。成功返回真，失败返回假。',
    returnType: '逻辑型',
    category: '磁盘操作',
    params: [
      { name: '欲设置其属性的文件名称', type: '文本型', description: '目标文件或目录。', optional: false, isVariable: false, isArray: false },
      { name: '欲设置为的属性值', type: '整数型', description: 'Windows 文件属性值。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '取临时文件名',
    englishName: 'GetTempFileName',
    description: '返回一个在目标目录中不存在的 .TMP 全路径文件名。',
    returnType: '文本型',
    category: '磁盘操作',
    params: [
      { name: '目录名', type: '文本型', description: '省略时使用系统临时目录。', optional: true, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
]

const CORE_BIN_COMMANDS: LibraryCommand[] = [
  {
    name: '取字节集长度',
    englishName: 'BinLen',
    description: '取字节集型数据的长度。',
    returnType: '整数型',
    category: '字节集操作',
    params: [{ name: '字节集数据', type: '字节集', description: '欲检查长度的字节集数据。', optional: false, isVariable: false, isArray: false }],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '到字节集',
    englishName: 'ToBin',
    description: '将指定数据转换为字节集后返回转换结果。',
    returnType: '字节集',
    category: '字节集操作',
    params: [{ name: '欲转换为字节集的数据', type: '通用型', description: '只能为基本数据类型数据或数值型数组。当前版本优先支持基础标量与文本。', optional: false, isVariable: false, isArray: false }],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '取字节集左边',
    englishName: 'BinLeft',
    description: '返回字节集左边指定数量的字节。',
    returnType: '字节集',
    category: '字节集操作',
    params: [
      { name: '欲取其部分的字节集', type: '字节集', description: '源字节集。', optional: false, isVariable: false, isArray: false },
      { name: '欲取出字节的数目', type: '整数型', description: '要取出的字节数。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '取字节集右边',
    englishName: 'BinRight',
    description: '返回字节集右边指定数量的字节。',
    returnType: '字节集',
    category: '字节集操作',
    params: [
      { name: '欲取其部分的字节集', type: '字节集', description: '源字节集。', optional: false, isVariable: false, isArray: false },
      { name: '欲取出字节的数目', type: '整数型', description: '要取出的字节数。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '取字节集中间',
    englishName: 'BinMid',
    description: '返回字节集中从指定位置开始的指定数量字节。',
    returnType: '字节集',
    category: '字节集操作',
    params: [
      { name: '欲取其部分的字节集', type: '字节集', description: '源字节集。', optional: false, isVariable: false, isArray: false },
      { name: '起始取出位置', type: '整数型', description: '从 1 开始。', optional: false, isVariable: false, isArray: false },
      { name: '欲取出字节的数目', type: '整数型', description: '要取出的字节数。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '寻找字节集',
    englishName: 'InBin',
    description: '返回一个字节集在另一字节集中最先出现的位置，位置值从 1 开始；未找到返回 -1。',
    returnType: '整数型',
    category: '字节集操作',
    params: [
      { name: '被搜寻的字节集', type: '字节集', description: '源字节集。', optional: false, isVariable: false, isArray: false },
      { name: '欲寻找的字节集', type: '字节集', description: '待查找的子字节集。', optional: false, isVariable: false, isArray: false },
      { name: '起始搜寻位置', type: '整数型', description: '从 1 开始。', optional: true, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '倒找字节集',
    englishName: 'InBinRev',
    description: '返回一个字节集在另一字节集中最后出现的位置，位置值从 1 开始；未找到返回 -1。',
    returnType: '整数型',
    category: '字节集操作',
    params: [
      { name: '被搜寻的字节集', type: '字节集', description: '源字节集。', optional: false, isVariable: false, isArray: false },
      { name: '欲寻找的字节集', type: '字节集', description: '待查找的子字节集。', optional: false, isVariable: false, isArray: false },
      { name: '起始搜寻位置', type: '整数型', description: '从 1 开始。', optional: true, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '字节集替换',
    englishName: 'RpBin',
    description: '将字节集指定位置和长度的部分替换为另一字节集，并返回替换后的结果。',
    returnType: '字节集',
    category: '字节集操作',
    params: [
      { name: '欲替换其部分的字节集', type: '字节集', description: '源字节集。', optional: false, isVariable: false, isArray: false },
      { name: '起始替换位置', type: '整数型', description: '从 1 开始。', optional: false, isVariable: false, isArray: false },
      { name: '替换长度', type: '整数型', description: '欲替换的字节数。', optional: false, isVariable: false, isArray: false },
      { name: '用作替换的字节集', type: '字节集', description: '省略时删除指定部分。', optional: true, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '子字节集替换',
    englishName: 'RpSubBin',
    description: '返回一个字节集，其中指定子字节集已被替换为另一子字节集。',
    returnType: '字节集',
    category: '字节集操作',
    params: [
      { name: '欲被替换的字节集', type: '字节集', description: '源字节集。', optional: false, isVariable: false, isArray: false },
      { name: '欲被替换的子字节集', type: '字节集', description: '待查找并替换的子字节集。', optional: false, isVariable: false, isArray: false },
      { name: '用作替换的子字节集', type: '字节集', description: '省略时默认为空字节集。', optional: true, isVariable: false, isArray: false },
      { name: '进行替换的起始位置', type: '整数型', description: '从 1 开始。', optional: true, isVariable: false, isArray: false },
      { name: '替换进行的次数', type: '整数型', description: '省略时替换所有可能位置。', optional: true, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '取空白字节集',
    englishName: 'SpaceBin',
    description: '返回具有特定数目 0 字节的字节集。',
    returnType: '字节集',
    category: '字节集操作',
    params: [{ name: '零字节数目', type: '整数型', description: '返回字节集的字节数。', optional: false, isVariable: false, isArray: false }],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '取重复字节集',
    englishName: 'bin',
    description: '返回包含指定次数字节集重复结果的字节集。',
    returnType: '字节集',
    category: '字节集操作',
    params: [
      { name: '重复次数', type: '整数型', description: '重复次数。', optional: false, isVariable: false, isArray: false },
      { name: '待重复的字节集', type: '字节集', description: '待重复的字节集。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '指针到字节集',
    englishName: 'pbin',
    description: '返回指定内存指针地址处的一段数据。',
    returnType: '字节集',
    category: '字节集操作',
    params: [
      { name: '内存数据指针', type: '整数型', description: '指向内存地址的指针值。', optional: false, isVariable: false, isArray: false },
      { name: '内存数据长度', type: '整数型', description: '要读取的字节数。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '指针到整数',
    englishName: 'p2int',
    description: '返回指定内存指针地址处的一个整数值。',
    returnType: '整数型',
    category: '字节集操作',
    params: [{ name: '内存数据指针', type: '整数型', description: '指向内存地址的指针值。', optional: false, isVariable: false, isArray: false }],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '指针到小数',
    englishName: 'p2float',
    description: '返回指定内存指针地址处的一个小数值。',
    returnType: '小数型',
    category: '字节集操作',
    params: [{ name: '内存数据指针', type: '整数型', description: '指向内存地址的指针值。', optional: false, isVariable: false, isArray: false }],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '指针到双精度小数',
    englishName: 'p2double',
    description: '返回指定内存指针地址处的一个双精度小数值。',
    returnType: '双精度小数型',
    category: '字节集操作',
    params: [{ name: '内存数据指针', type: '整数型', description: '指向内存地址的指针值。', optional: false, isVariable: false, isArray: false }],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '取字节集内整数',
    englishName: 'GetIntInsideBin',
    description: '返回字节集中所指定偏移处的整数值。',
    returnType: '整数型',
    category: '字节集操作',
    params: [
      { name: '待处理的字节集', type: '字节集', description: '待处理的字节集。', optional: false, isVariable: false, isArray: false },
      { name: '欲获取整数所处偏移', type: '整数型', description: '整数值在字节集中的偏移位置。', optional: false, isVariable: false, isArray: false },
      { name: '是否反转字节序', type: '逻辑型', description: '省略时默认为假。', optional: true, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '置字节集内整数',
    englishName: 'SetIntInsideBin',
    description: '设置字节集中所指定偏移处的整数值。',
    returnType: '',
    category: '字节集操作',
    params: [
      { name: '待处理的字节集', type: '字节集', description: '待处理的字节集变量。', optional: false, isVariable: true, isArray: false },
      { name: '欲设置整数所处偏移', type: '整数型', description: '整数值在字节集中的偏移位置。', optional: false, isVariable: false, isArray: false },
      { name: '欲设置的整数值', type: '整数型', description: '要写入的整数值。', optional: false, isVariable: false, isArray: false },
      { name: '是否反转字节序', type: '逻辑型', description: '省略时默认为假。', optional: true, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '读入文件',
    englishName: 'ReadFile',
    description: '返回一个字节集，其中包含指定文件的所有数据。',
    returnType: '字节集',
    category: '磁盘操作',
    params: [
      { name: '文件名', type: '文本型', description: '要读入的文件路径。', optional: false, isVariable: false, isArray: false },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
  {
    name: '写到文件',
    englishName: 'WriteFile',
    description: '将一个或数个字节集顺序写到指定文件中，文件原有内容被覆盖。成功返回真，失败返回假。',
    returnType: '逻辑型',
    category: '磁盘操作',
    params: [
      { name: '文件名', type: '文本型', description: '目标文件路径。', optional: false, isVariable: false, isArray: false },
      { name: '欲写入文件的数据', type: '字节集', description: '要顺序写入的字节集数据。', optional: false, isVariable: false, isArray: false, repeatable: true },
    ],
    isHidden: false, isMember: false, ownerTypeName: '', commandIndex: -1, libraryName: CORE_LIBRARY_NAME, libraryFileName: 'krnln', source: 'core', manifestPath: '',
  },
]

class LibraryManager {
  private libraries: LibraryItem[] = []
  private metadataCache = new Map<string, ParsedLibraryMetadata | null>()

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
        if (windowUnits.length > 0) parsed.windowUnits = windowUnits
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
    const loadedSet = new Set(loadedLibraries.map(l => l.name))
    const loadedYcmdCommands = loadedLibraries
      .filter(lib => !lib.isCore)
      .flatMap(lib => getYcmdCommands(dirname(lib.filePath), platform).filter(cmd => cmd.libraryFileName === lib.name))
    const commands: LibraryCommand[] = [
      ...(loadedSet.has(CORE_LIBRARY_FILE_NAME) ? [...CORE_FLOW_COMMANDS, ...CORE_LOGIC_COMMANDS, ...CORE_DEBUG_COMMANDS, ...CORE_DISK_COMMANDS, ...CORE_BIN_COMMANDS] : []),
      ...loadedYcmdCommands.map(cmd => this.mapYcmdCommand(cmd)),
    ]

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
    const commands = [
      ...(isCoreLibrary ? [...CORE_FLOW_COMMANDS, ...CORE_LOGIC_COMMANDS, ...CORE_DEBUG_COMMANDS, ...CORE_DISK_COMMANDS, ...CORE_BIN_COMMANDS] : []),
      ...(item ? getYcmdCommands(dirname(item.filePath)) : [])
      .map(cmd => this.mapYcmdCommand(cmd))
      .filter(cmd => cmd.libraryFileName === libraryId || cmd.libraryName === name || cmd.libraryName === libraryId),
    ]
    const metadata = this.getLibraryMetadata(libraryId)

    if (commands.length === 0 && !metadata) return null

    const displayMeta = item ? { libName: item.libName || item.name, version: item.version || '-', cmdCount: item.cmdCount || 0 } : this.getLibraryDisplayMeta().get(libraryId)
    return {
      name: isCoreLibrary ? CORE_LIBRARY_NAME : (displayMeta?.libName || name),
      guid: metadata?.guid || '-',
      version: displayMeta?.version || '-',
      description: metadata?.description || (isCoreLibrary ? '系统核心支持库内建命令与元数据。' : '由 ycmd 清单生成'),
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
