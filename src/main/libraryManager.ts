/**
 * 支持库管理器（ycmd 版）
 * 扫描 lib 目录中的 *.ycmd.json 清单，并补充窗口单元元数据。
 */
import { app } from 'electron'
import { dirname, join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { getYcmdCommands, scanYcmdRegistry, type YcmdResolvedCommand } from './ycmd-registry'
import { STORE_PLATFORM_ORDER, type Platform, type StoreLibraryCard } from '../shared/library-store'

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
  description?: string
  author?: string
  homePage?: string
  dataTypes?: unknown
  constants?: unknown
  windowUnits?: unknown
}

interface ParsedLibraryMetadata {
  description: string
  author: string
  homePage: string
  dataTypes: LibraryDataType[]
  constants: LibraryConstant[]
  windowUnits: LibraryWindowUnit[]
}

const CORE_LIBRARY_NAME = '系统核心支持库'

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
  private static readonly CORE_LIBRARY_FILE_NAME = 'krnln'
  private libraries: LibraryItem[] = []
  private metadataCache = new Map<string, ParsedLibraryMetadata | null>()

  private getConfigPath(): string {
    return join(app.getPath('userData'), 'library-state.json')
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
      join(folderPath, 'window-units.json'),
      join(folderPath, `${name}.window-units.json`),
      join(folderPath, `${name}.metadata.json`),
      join(folderPath, `${name}.library.json`),
    ]
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
    return value
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(item => ({
        name: typeof item.name === 'string' ? item.name.trim() : '',
        englishName: typeof item.englishName === 'string' ? item.englishName.trim() : '',
        description: typeof item.description === 'string' ? item.description.trim() : '',
        type: item.type === 'number' || item.type === 'bool' || item.type === 'text' ? item.type : 'null',
        value: typeof item.value === 'string' ? item.value : String(item.value ?? ''),
      }))
      .filter(item => item.name.length > 0)
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
    for (const candidate of this.getMetadataFileCandidates(name, folderPath)) {
      if (!existsSync(candidate)) continue
      try {
        const raw = JSON.parse(readFileSync(candidate, 'utf-8')) as LibraryMetadataFile
        const parsed: ParsedLibraryMetadata = {
          description: typeof raw.description === 'string' ? raw.description.trim() : '',
          author: typeof raw.author === 'string' ? raw.author.trim() : '',
          homePage: typeof raw.homePage === 'string' ? raw.homePage.trim() : '',
          dataTypes: this.parseLibraryDataTypes(raw.dataTypes),
          constants: this.parseLibraryConstants(raw.constants),
          windowUnits: this.parseWindowUnits(raw.windowUnits, name),
        }
        this.metadataCache.set(name, parsed)
        return parsed
      } catch {
        this.metadataCache.set(name, null)
        return null
      }
    }

    this.metadataCache.set(name, null)
    return null
  }

  isCore(name: string): boolean {
    return name === LibraryManager.CORE_LIBRARY_FILE_NAME
  }

  getLibFolder(): string {
    const isDev = !app.isPackaged
    if (isDev) {
      return join(app.getAppPath(), 'lib')
    }
    return join(dirname(process.execPath), 'lib')
  }

  scan(customFolder?: string): LibraryItem[] {
    const root = customFolder || this.getLibFolder()
    const result = scanYcmdRegistry(root)
    const metaMap = this.getLibraryDisplayMeta(root)
    const previousLoaded = new Map(this.libraries.map(l => [l.name, l.loaded]))
    const savedLoaded = this.getSavedLoadedNames()
    const savedSet = savedLoaded ? new Set(savedLoaded) : null

    this.metadataCache.clear()

    this.libraries = result.libraries.map(lib => ({
      name: lib.name,
      filePath: lib.folderPath,
      loaded: this.isCore(lib.name)
        ? true
        : (savedSet
            ? savedSet.has(lib.name)
            : (previousLoaded.get(lib.name) ?? true)),
      isCore: this.isCore(lib.name),
      libName: metaMap.get(lib.name)?.libName || lib.name,
      version: metaMap.get(lib.name)?.version || '-',
      cmdCount: metaMap.get(lib.name)?.cmdCount ?? lib.manifests.filter(item => item.valid).length,
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
    selected.add(LibraryManager.CORE_LIBRARY_FILE_NAME)

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

  getStoreCards(): StoreLibraryCard[] {
    const libraries = this.scan()
    const registry = scanYcmdRegistry(this.getLibFolder())
    const supportedPlatformsById = new Map<string, Platform[]>()
    const downloadedById = new Map<string, boolean>()

    for (const lib of registry.libraries) {
      const platforms = new Set<Platform>()
      let hasValidManifest = false
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

    return libraries.map(lib => ({
      id: lib.name,
      displayName: lib.libName || lib.name,
      version: lib.version || '-',
      supportedPlatforms: supportedPlatformsById.get(lib.name) || [],
      isDownloaded: downloadedById.get(lib.name) || false,
      isLoaded: lib.loaded,
      isCore: lib.isCore,
    }))
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

  getAllCommands(): LibraryCommand[] {
    if (this.libraries.length === 0) this.scan()
    const loadedSet = new Set(this.libraries.filter(l => l.loaded).map(l => l.name))
    const commands: LibraryCommand[] = [
      ...(loadedSet.has(LibraryManager.CORE_LIBRARY_FILE_NAME) ? [...CORE_FLOW_COMMANDS, ...CORE_LOGIC_COMMANDS, ...CORE_DEBUG_COMMANDS, ...CORE_DISK_COMMANDS, ...CORE_BIN_COMMANDS] : []),
      ...getYcmdCommands()
      .filter(cmd => loadedSet.has(cmd.libraryFileName))
      .map(cmd => this.mapYcmdCommand(cmd)),
    ]

    const deduped = new Map<string, LibraryCommand>()
    for (const command of commands) {
      if (!deduped.has(command.name)) deduped.set(command.name, command)
    }
    return Array.from(deduped.values())
  }

  getAllDataTypes(): LibraryDataType[] {
    if (this.libraries.length === 0) this.scan()
    return this.libraries
      .filter(lib => lib.loaded)
      .flatMap(lib => this.getLibraryMetadata(lib.name)?.dataTypes || [])
  }

  getLibInfo(name: string): LibraryInfo | null {
    const isCoreLibrary = name === LibraryManager.CORE_LIBRARY_FILE_NAME || name === CORE_LIBRARY_NAME
    const commands = [
      ...(isCoreLibrary ? [...CORE_FLOW_COMMANDS, ...CORE_LOGIC_COMMANDS, ...CORE_DEBUG_COMMANDS, ...CORE_DISK_COMMANDS, ...CORE_BIN_COMMANDS] : []),
      ...getYcmdCommands()
      .map(cmd => this.mapYcmdCommand(cmd))
      .filter(cmd => cmd.libraryFileName === name || cmd.libraryName === name),
    ]
    const metadata = this.getLibraryMetadata(name)

    if (commands.length === 0 && !metadata) return null

    const displayMeta = this.getLibraryDisplayMeta().get(name)
    return {
      name: isCoreLibrary ? CORE_LIBRARY_NAME : (displayMeta?.libName || name),
      guid: '-',
      version: displayMeta?.version || '-',
      description: metadata?.description || (isCoreLibrary ? '系统核心支持库内建命令与元数据。' : '由 ycmd 清单生成'),
      author: metadata?.author || '-',
      zipCode: '-',
      address: '-',
      phone: '-',
      qq: '-',
      email: '-',
      homePage: metadata?.homePage || '-',
      otherInfo: '-',
      fileName: name,
      commands,
      dataTypes: metadata?.dataTypes || [],
      constants: metadata?.constants || [],
      windowUnits: metadata?.windowUnits || [],
    }
  }

  getAllWindowUnits(): LibraryWindowUnit[] {
    if (this.libraries.length === 0) this.scan()
    return this.libraries
      .filter(lib => lib.loaded)
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
