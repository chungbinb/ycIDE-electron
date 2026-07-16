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
import { parseColorLiteralToColorref } from '../shared/colorNames'

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
  // 窗口预览：以该 .efw（文件名或窗体名）为启动窗口、跳过所有源代码(.eyc等)转译，
  // 只编译出纯 UI 窗口（事件走 WEAK 空实现），用于「预览」——不编译对应源代码。
  previewWindow?: string
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

// 窗口菜单项（菜单编辑器生成，存在 .efw 的 menu 字段里，一棵树）
interface MenuNodeInfo {
  name?: string
  caption?: string
  shortcut?: string
  checked?: boolean
  disabled?: boolean
  visible?: boolean
  separator?: boolean
  children?: MenuNodeInfo[]
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
  left: number         // 左边（位置=手工时生效）
  top: number          // 顶边（位置=手工时生效）
  backColor: number    // 底色 COLORREF；0=默认底色(COLOR_BTNFACE)
  mousePointer: number // 鼠标指针枚举 0=默认型
  movable: boolean     // 可否移动(default true)
  enterAsTab: boolean  // 回车下移焦点(default false)
  escClose: boolean    // Esc键关闭(default false)
  showInTaskbar: boolean // 在任务条中显示(default true)
  dragMove: boolean    // 随意移动：按住客户区拖动窗口(default false)
  keepCaptionActive: boolean // 保持标题条激活(default false)
  wndClassName: string // 自定义窗口类名；空=默认
  shape: number        // 外形 0矩形(default) 1圆角矩形 2椭圆形
  cornerRadius: number // 圆角半径（像素，仅圆角矩形用），default 20
  backImage: string    // 底图 base64 data URL（空=无）
  backImageMode: number // 底图方式 0平铺(default) 1居左上 2居中 3居右下 4缩放
  iconImage: string    // 图标 base64 data URL（空=用默认应用图标）
  controls: WindowControlInfo[]
  menu?: MenuNodeInfo[]  // 窗口菜单栏
}

function createDefaultWindowFileInfo(formName: string, title: string): WindowFileInfo {
  return {
    formName, width: 592, height: 384, title, visible: true, disabled: false,
    border: 2, maxButton: true, minButton: true, controlBox: true, topmost: false, startPos: 1,
    left: 0, top: 0, backColor: 0, mousePointer: 0, movable: true, enterAsTab: false,
    escClose: false, showInTaskbar: true, dragMove: false, keepCaptionActive: false, wndClassName: '',
    shape: 0, cornerRadius: 20, backImage: '', backImageMode: 0, iconImage: '',
    controls: [],
  }
}

// 从 .efw 的 properties 字典读取窗口属性（编辑器内存与磁盘解析两条路径共用）
function applyWindowProperties(info: WindowFileInfo, p: Record<string, unknown>): void {
  if (p['可视'] === false) info.visible = false
  if (p['禁止'] === true) info.disabled = true
  if (typeof p['边框'] === 'number') info.border = p['边框']
  // 兼容简体"钮"（设计器内存路径与 window-units.json 用简体）与历史繁体"鈕"，
  // 否则关闭标签页后按磁盘 .efw 编译时这几个属性被忽略、与标签开着时行为不一致。
  if (p['最大化按钮'] === false || p['最大化按鈕'] === false) info.maxButton = false
  if (p['最小化按钮'] === false || p['最小化按鈕'] === false) info.minButton = false
  if (p['控制按钮'] === false || p['控制按鈕'] === false) info.controlBox = false
  if (p['总在最前'] === true) info.topmost = true
  if (typeof p['位置'] === 'number') info.startPos = p['位置']
  if (typeof p['左边'] === 'number') info.left = p['左边']
  if (typeof p['顶边'] === 'number') info.top = p['顶边']
  if (typeof p['底色'] === 'number') info.backColor = p['底色']
  if (typeof p['鼠标指针'] === 'number') info.mousePointer = p['鼠标指针']
  if (p['可否移动'] === false) info.movable = false
  if (p['回车下移焦点'] === true) info.enterAsTab = true
  if (p['Esc键关闭'] === true) info.escClose = true
  if (p['在任务条中显示'] === false) info.showInTaskbar = false
  if (p['随意移动'] === true) info.dragMove = true
  if (p['保持标题条激活'] === true) info.keepCaptionActive = true
  if (typeof p['窗口类名'] === 'string' && p['窗口类名'].trim() !== '') info.wndClassName = p['窗口类名'].trim()
  if (typeof p['外形'] === 'number' && p['外形'] >= 0 && p['外形'] <= 2) info.shape = p['外形']
  if (typeof p['圆角半径'] === 'number' && p['圆角半径'] >= 0) info.cornerRadius = p['圆角半径']
  if (typeof p['底图'] === 'string' && p['底图'].startsWith('data:image')) info.backImage = p['底图']
  if (typeof p['底图方式'] === 'number' && p['底图方式'] >= 0 && p['底图方式'] <= 4) info.backImageMode = p['底图方式']
  if (typeof p['图标'] === 'string' && p['图标'].startsWith('data:image')) info.iconImage = p['图标']
}

// 鼠标指针枚举 → Win32 系统光标（15 自定义型暂按默认箭头处理）
const MOUSE_POINTER_CURSOR_IDS = [
  'IDC_ARROW', 'IDC_ARROW', 'IDC_CROSS', 'IDC_IBEAM', 'IDC_WAIT', 'IDC_HELP',
  'IDC_APPSTARTING', 'IDC_NO', 'IDC_SIZEALL', 'IDC_UPARROW', 'IDC_SIZENS',
  'IDC_SIZEWE', 'IDC_SIZENWSE', 'IDC_SIZENESW', 'IDC_HAND', 'IDC_ARROW',
]

function mapMousePointerCursor(mousePointer: number): string {
  return MOUSE_POINTER_CURSOR_IDS[mousePointer] || 'IDC_ARROW'
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
  params: Array<{ name: string; type: string; isByRef?: boolean; isArray?: boolean; optional?: boolean }>
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
  // 顶层控件成员绑定：unit 为控件类型名，`*` 表示通用（适用所有控件，如文本类公共属性 标题/内容）。
  // 与 windowUnits[].properties[].access 二选一或并用；公共属性因由 libraryManager 合并、不在 per-unit properties[]，故走这里。
  controlMemberBindings?: Array<{
    library?: string
    unit?: string
    unitEnglishName?: string
    member?: string
    memberEnglishName?: string
    get?: string
    set?: string
  }>
  // 顶层控件成员【方法】绑定：unit=控件类型，member=方法名，call=C 表达式模板。
  // 模板占位 {h}=句柄、{n}=控件名 L"…"、{0}/{1|默认}/{args}=实参。返回文本的方法其 helper 名须在 isTextExpression 列出。
  // callEach=「尾参可重复」方法用（如 编辑框.加入文本(a,b,c)）：逐个实参展开一次模板（占位 {arg}=当前实参），
  // 用逗号表达式串成一个表达式 `(f(a), f(b), f(c))`。**不要改用变参 helper**——文本型实参是 YC_TEXT 对象，
  // 过 C variadic 会 `cannot pass object of non-trivial type through variadic function` 编译错误（踩过）。
  controlMethodBindings?: Array<{
    library?: string
    unit?: string
    unitEnglishName?: string
    member?: string
    memberEnglishName?: string
    call?: string
    callEach?: string
  }>
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
    // 控件属性的运行时读写绑定（声明式）：get/set 为 C 表达式模板，占位符 {h}=控件句柄、{v}=原始值、{vtext}=文本化值。
    // 缺 access 的属性只作设计期元数据（面板/补全），不生成运行时读写。第三方库靠此让控件属性可编程且零改编译器。
    properties?: Array<{
      name?: string
      englishName?: string
      access?: { get?: string; set?: string }
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

// 控件成员（属性/方法）运行时绑定，归一化后。unit=控件类型名，member=成员中文名。
// get/set 为 C 表达式模板（属性）；method 侧后续期扩展 emit/expr（见分期计划）。
interface NormalizedControlMemberBinding {
  library: string
  unit: string
  unitEnglishName: string
  member: string
  memberEnglishName: string
  get: string
  set: string
}

// 控件成员【方法】运行时绑定，归一化后。call 为 C 表达式模板（{h}/{n}/{0..}）。
interface NormalizedControlMethodBinding {
  library: string
  unit: string
  unitEnglishName: string
  member: string
  memberEnglishName: string
  call: string
  /** 尾参可重复的方法：逐实参展开一次（占位 {arg}），逗号表达式串起来。与 call 二选一。 */
  callEach: string
}

interface LoadedCompileProtocols {
  events: NormalizedEventBinding[]
  commands: NormalizedCommandBinding[]
  controls: NormalizedControlBinding[]
  controlMembers: NormalizedControlMemberBinding[]
  controlMethods: NormalizedControlMethodBinding[]
}

interface TranspileCacheEntry {
  fingerprint: string
  cFileName: string
}

interface TranspileCacheFile {
  version: number
  entries: Record<string, TranspileCacheEntry>
}

// 29: 条件表达式括号配对修复 + 生成代码每行加 /*@eyc行号*/ 来源标记（旧缓存产物没有标记，报错回溯不到）
// 30: ÷ 相除改生成双精度除法（旧产物里是截断的整数除法）+ 整体括号表达式改为递归翻译
const TRANSPILE_CACHE_VERSION = 30

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

  const generatedSummary = text.match(/^(\d+)\s+(error|warning)s?\s+generated\.$/i)
  if (generatedSummary) {
    return `共 ${generatedSummary[1]} 个${generatedSummary[2].toLowerCase() === 'error' ? '错误' : '警告'}。`
  }

  text = text.replace(/^lld-link:\s*error:\s*/i, '链接器错误: ')
  text = text.replace(/^lld-link:\s*warning:\s*/i, '链接器警告: ')
  text = text.replace(/^clang:\s*error:\s*/i, '编译器错误: ')
  text = text.replace(/^clang:\s*warning:\s*/i, '编译器警告: ')
  text = text.replace(/^zig:\s*error:\s*/i, '编译器错误: ')
  text = text.replace(/^zig:\s*warning:\s*/i, '编译器警告: ')
  return text
}

/* ============ C++ 编译诊断 → 易语言源码位置 + 中文说明 ============
 *
 * 易语言用户读不懂 clang 的英文诊断，且它指的是 temp/*.cpp（用户从没写过的中间产物）的行号。
 * 这一层把 `_启动窗口.cpp:2164:9: error: …` 还原成「_启动窗口.eyc 第 152 行」+ 回显那行易语言
 * 源码 + 中文说明；C++ 原文全量留给编译诊断日志。
 *
 * 行号映射靠生成代码每行开头的 /*@<eyc行号>*\/ 标记（appendSubLine 打上）。标记**留在 .cpp 文件
 * 里**而不是转译完就剥掉，为的是：① 转译缓存命中时压根不重跑转译，映射必须能从产物自身恢复；
 * ② 人工翻 temp/*.cpp 排查时能直接看出每行来自 .eyc 哪一行。
 */

const EYC_ORIGIN_MARK_RE = /^\/\*@(\d+)\*\//
const EYC_GEN_HEADER_RE = /^\/\* 由 ycIDE 自动从 (.+?) 生成 \*\//
// clang 诊断首行：<路径>:<行>:<列>: error|warning|note: <正文>
const CLANG_DIAGNOSTIC_RE = /^(.*?):(\d+):(\d+):\s*(error|warning|note):\s*(.+)$/i
// 诊断后跟的源码回显行（` 2164 |     if (…`）与插入符行（`      | ^~~~`）——展示的是用户没写过的 C++
const CLANG_ECHO_RE = /^\s*(?:\d+\s*)?\|/

type EycOrigin = { eycFileName: string; lineOf: Map<number, number> }

// 每次编译重建：源码会变，缓存跨编译不能留
const eycOriginCache = new Map<string, EycOrigin | null>()
const activeEycSourceLines = new Map<string, string[]>()

function resetCompileDiagnosticContext(): void {
  eycOriginCache.clear()
  activeEycSourceLines.clear()
}

// 从生成的 .cpp 里恢复「.cpp 行号 → .eyc 行号」映射
function loadEycOrigin(cppPath: string): EycOrigin | null {
  const cached = eycOriginCache.get(cppPath)
  if (cached !== undefined) return cached

  let origin: EycOrigin | null = null
  try {
    const lines = readFileSync(cppPath, 'utf-8').split('\n')
    const header = lines[0]?.match(EYC_GEN_HEADER_RE)
    if (header) {
      const lineOf = new Map<number, number>()
      let current = 0
      for (let i = 0; i < lines.length; i++) {
        const mark = lines[i].match(EYC_ORIGIN_MARK_RE)
        if (mark) {
          // 一条易语言语句可能摊成多行 C++，故标记之后的行继续归属它
          current = Number(mark[1])
        } else if (lines[i].startsWith('}')) {
          // 顶格的 } 是子程序收尾：出了函数体就不再归属上一条语句
          current = 0
        }
        if (current > 0) lineOf.set(i + 1, current)
      }
      origin = { eycFileName: header[1], lineOf }
    }
  } catch {
    origin = null
  }
  eycOriginCache.set(cppPath, origin)
  return origin
}

/**
 * clang 诊断正文 → 中文说明 + 归咎方。
 * 只覆盖实测见过/可预期的形态；命不中就返回 null 让调用方保留英文原文——瞎猜一句中文比留原文更糟。
 *
 * blame 的判据是「用户改自己的易语言代码能不能解决」：
 *  - user   : 能。名字拼错、变量没声明。
 *  - codegen: 不能。生成的 C++ 语法就不合法（用户再怎么写也写不出 lambda 转 bool 失败），必是 ycIDE 的锅。
 *  - mixed  : 说不准。类型对不上通常是用户自己类型用错了（只是 ycIDE 没在转译期拦住），
 *             但也可能是 ycIDE 编组错了。**不能**咬定「不是你的代码写错了」——那句话在这里多半是假的。
 */
type DiagnosticBlame = 'user' | 'codegen' | 'mixed'
type TranslatedDiagnostic = { text: string; blame: DiagnosticBlame }

function translateCppDiagnosticBody(body: string): TranslatedDiagnostic | null {
  const undeclared = body.match(/use of undeclared identifier '(.+?)'/)
  if (undeclared) {
    const name = undeclared[1]
    // 中日韩名字 = 用户自己写的标识符（变量/命令/流程语句名）；
    // 纯 ASCII（krnln_Xxx 等）是 ycIDE 或支持库生成的符号，用户改不动
    const byUser = /[㐀-䶿一-鿿가-힣぀-ヿ]/.test(name)
    return byUser
      ? { text: `找不到「${name}」这个变量或命令。请检查拼写、是否已经声明，以及流程语句名是否写对。`, blame: 'user' }
      : { text: `生成的代码里用到了未声明的符号「${name}」。`, blame: 'codegen' }
  }

  if (/is not contextually convertible to 'bool'/.test(body)) {
    return { text: '这一行的条件没能生成成合法的判断表达式。', blame: 'codegen' }
  }
  if (/^expected /.test(body)) {
    return { text: `生成的 C++ 代码语法不完整（${body}）。`, blame: 'codegen' }
  }

  const noMember = body.match(/no member named '(.+?)' in '(.+?)'/)
  if (noMember) {
    return { text: `生成的代码在类型「${noMember[2]}」上取了不存在的成员「${noMember[1]}」。`, blame: 'codegen' }
  }

  // 以下都是「类型对不上」族：多半是用户自己类型用错了（转译期没拦住），少数是 ycIDE 编组错了。
  // cType 是 C++ 类型名（int/wchar_t*/YC_TEXT…），对易语言用户没意义，故只报现象不报类型名。
  const noMatch = body.match(/no matching function for call to '(.+?)'/)
  if (noMatch) {
    return { text: `调用「${noMatch[1]}」时，参数的个数或类型对不上。`, blame: 'mixed' }
  }

  if (/cannot initialize a parameter of type/.test(body)) {
    return { text: '这一行传给命令的参数类型不对（比如该给数值的地方给了文本）。', blame: 'mixed' }
  }

  // clang 这条有好几种前缀形态，实测至少两种：
  //   assigning to 'int' from incompatible type 'YC_TEXT'
  //   incompatible pointer to integer conversion assigning to 'int' from 'const wchar_t *'
  // 故只认中间的 assigning to … from，不锚定前缀。
  if (/assigning to '.+?' from /.test(body)) {
    return { text: '这一行赋值两边的类型不兼容（比如把文本赋给整数型变量）。', blame: 'mixed' }
  }

  if (/invalid operands to binary expression/.test(body)) {
    return { text: '这一行运算符两边的类型不能这样运算（比如拿文本去做减法）。', blame: 'mixed' }
  }

  return null
}

function blameHint(blame: DiagnosticBlame | null): string {
  if (blame === 'user') return '↳ 这一行需要你修改易语言代码。'
  if (blame === 'codegen') return '↳ 这是 ycIDE 生成代码的问题，不是你的代码写错了，请反馈。'
  if (blame === 'mixed') return '↳ 请先检查这一行的类型用得对不对；确认没问题的话就是 ycIDE 的问题，请反馈。'
  // 没命中翻译规则 = 不知道谁的锅，就别装作知道。上面留的是 C++ 英文原文。
  return '↳ ycIDE 还没认识这条错误。请先检查这一行的写法；确认没问题的话，把编译诊断日志一起反馈。'
}

/**
 * 处理一行 zig/clang 输出：能定位回 .eyc 的就换成友好形态并返回 true（调用方不再发原文）。
 * 定位不到（报错落在生成代码的公共前导部分、链接期错误等）返回 false，走原有的 localizeCompilerMessage。
 */
function reportFriendlyCppDiagnostic(line: string, kind: 'error' | 'warning'): boolean {
  const matched = line.match(CLANG_DIAGNOSTIC_RE)
  if (!matched) return false

  const [, rawPath, cppLineText, , severity, body] = matched
  if (severity.toLowerCase() !== kind) return false
  if (!/\.cpp$/i.test(rawPath.trim())) return false

  const origin = loadEycOrigin(rawPath.trim())
  if (!origin) return false
  const eycLine = origin.lineOf.get(Number(cppLineText))
  if (!eycLine) return false

  const label = kind === 'error' ? '错误' : '警告'
  const type: CompileMessage['type'] = kind === 'error' ? 'error' : 'warning'
  sendMessage({ type, text: `${label}: ${origin.eycFileName} 第 ${eycLine} 行` })

  const sourceLine = activeEycSourceLines.get(origin.eycFileName)?.[eycLine - 1]
  if (sourceLine !== undefined) {
    sendMessage({ type, text: `  ${String(eycLine).padStart(4)} |  ${sourceLine.trim()}` })
  }

  const translated = translateCppDiagnosticBody(body)
  sendMessage({ type, text: `  ${translated ? `↳ ${translated.text}` : `↳ ${body}`}` })
  sendMessage({ type, text: `  ${blameHint(translated?.blame ?? null)}` })
  return true
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

// 从 window-units.json 的 windowUnits[].properties[].access 抽取控件属性读写绑定。
function parseControlMemberBindingsFromProtocol(content: string, libName: string): NormalizedControlMemberBinding[] {
  let json: LibraryCompileProtocol
  try {
    json = JSON.parse(content) as LibraryCompileProtocol
  } catch {
    return []
  }
  const result: NormalizedControlMemberBinding[] = []
  // 来源①：windowUnits[].properties[].access（与属性定义就地共存，适合 per-unit 属性）
  if (Array.isArray(json.windowUnits)) {
    for (const unit of json.windowUnits) {
      if (!unit || typeof unit !== 'object' || !Array.isArray(unit.properties)) continue
      const unitKey = normalizeKey(unit.name || '')
      const unitEn = normalizeKey(unit.englishName || '')
      if (!unitKey && !unitEn) continue
      for (const prop of unit.properties) {
        if (!prop || typeof prop !== 'object' || !prop.access) continue
        const get = (prop.access.get || '').trim()
        const set = (prop.access.set || '').trim()
        if (!get && !set) continue
        const member = normalizeKey(prop.name || '')
        const memberEn = normalizeKey(prop.englishName || '')
        if (!member && !memberEn) continue
        result.push({ library: normalizeKey(libName), unit: unitKey, unitEnglishName: unitEn, member, memberEnglishName: memberEn, get, set })
      }
    }
  }
  // 来源②：顶层 controlMemberBindings[]（unit 可为 `*` 通用；公共属性 标题/内容 走这里）
  if (Array.isArray(json.controlMemberBindings)) {
    for (const b of json.controlMemberBindings) {
      if (!b || typeof b !== 'object') continue
      const get = (b.get || '').trim()
      const set = (b.set || '').trim()
      if (!get && !set) continue
      const member = normalizeKey(b.member || '')
      const memberEn = normalizeKey(b.memberEnglishName || '')
      if (!member && !memberEn) continue
      const unitKey = normalizeKey(b.unit || '')
      const unitEn = normalizeKey(b.unitEnglishName || '')
      if (!unitKey && !unitEn) continue
      result.push({ library: normalizeKey(b.library || libName), unit: unitKey, unitEnglishName: unitEn, member, memberEnglishName: memberEn, get, set })
    }
  }
  return result
}

// 从 window-units.json 的顶层 controlMethodBindings[] 与 windowUnits[].methods[] 抽取控件方法绑定。
function parseControlMethodBindingsFromProtocol(content: string, libName: string): NormalizedControlMethodBinding[] {
  let json: LibraryCompileProtocol
  try {
    json = JSON.parse(content) as LibraryCompileProtocol
  } catch {
    return []
  }
  const result: NormalizedControlMethodBinding[] = []
  const push = (library: string, unit: string, unitEn: string, member: string, memberEn: string, call: string, callEach: string): void => {
    const c = (call || '').trim(); const ce = (callEach || '').trim()
    const m = normalizeKey(member); const mEn = normalizeKey(memberEn)
    const u = normalizeKey(unit); const uEn = normalizeKey(unitEn)
    if ((!c && !ce) || (!m && !mEn) || (!u && !uEn)) return
    result.push({ library: normalizeKey(library || libName), unit: u, unitEnglishName: uEn, member: m, memberEnglishName: mEn, call: c, callEach: ce })
  }
  if (Array.isArray(json.controlMethodBindings)) {
    for (const b of json.controlMethodBindings) {
      if (b && typeof b === 'object') push(b.library || libName, b.unit || '', b.unitEnglishName || '', b.member || '', b.memberEnglishName || '', b.call || '', b.callEach || '')
    }
  }
  // 就地形式：windowUnits[].methods[] 尚未在 schema 展开（留待需要），当前只读顶层数组。
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
  const controlMembers: NormalizedControlMemberBinding[] = []
  const controlMethods: NormalizedControlMethodBinding[] = []
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
        const parsedMembers = parseControlMemberBindingsFromProtocol(content, lib.name)
        const parsedMethods = parseControlMethodBindingsFromProtocol(content, lib.name)
        if (parsedEvents.length > 0 || parsedCommands.length > 0 || parsedControls.length > 0 || parsedMembers.length > 0 || parsedMethods.length > 0) {
          events.push(...parsedEvents)
          commands.push(...parsedCommands)
          controls.push(...parsedControls)
          controlMembers.push(...parsedMembers)
          controlMethods.push(...parsedMethods)
          sendMessage({
            type: 'info',
            text: `已加载支持库编译协议: ${basename(p)} (事件 ${parsedEvents.length} / 命令 ${parsedCommands.length} / 控件 ${parsedControls.length} / 成员 ${parsedMembers.length} / 方法 ${parsedMethods.length})`
          })
          break
        }
      } catch {
        sendMessage({ type: 'warning', text: `警告: 读取支持库编译协议失败: ${p}` })
      }
    }
  }

  compileProtocolCache = { events, commands, controls, controlMembers, controlMethods }
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

// 控件成员访问模板展开：{h}=控件句柄表达式、{v}=原始值 C 表达式、{vtext}=文本化值（非文本自动 yc_value_to_text）、
// {n}=控件名 L"…"、{0..}/{args}=方法实参、{N|默认}=第 N 实参缺省时取「默认」字面量。属性 get 无值时 valueExpr 传 ''。
// （尾参可重复的方法不在这里展开，走 controlMethodBindings 的 callEach：逐实参各展开一次模板。）
// 注意：valueExpr 与 cArgs 均须为**已转译的 C 表达式**（调用方先跑 translateExpressionToC/tx），本函数不再二次转译。
function applyMemberTemplate(template: string, handleExpr: string, valueExpr: string, cArgs: string[] = [], nameExpr = ''): string {
  const vtext = valueExpr
    ? (isTextExpression(valueExpr) ? valueExpr : `yc_value_to_text(${valueExpr})`)
    : 'L""'
  return template
    .replace(/\{h\}/g, handleExpr)
    .replace(/\{n\}/g, nameExpr)
    .replace(/\{vtext\}/g, vtext)
    .replace(/\{v\}/g, valueExpr || '0')
    .replace(/\{args\}/g, cArgs.join(', '))
    .replace(/\{(\d+)(?:\|([^}]*))?\}/g, (_m, idxText, dflt) => {
      const idx = parseInt(idxText, 10)
      if (Number.isInteger(idx) && idx >= 0 && idx < cArgs.length) return cArgs[idx]
      return dflt !== undefined ? dflt : '0'
    })
}

// 按（控件类型, 方法名）解析方法绑定（call 或 callEach）；先精确类型、再回退通用 '*'。
function resolveControlMethod(bindings: NormalizedControlMethodBinding[], unitType: string, method: string): NormalizedControlMethodBinding | null {
  if (bindings.length === 0) return null
  const ut = normalizeKey(unitType)
  const mb = normalizeKey(method)
  if (!ut || !mb) return null
  const memberMatches = (b: NormalizedControlMethodBinding) =>
    (!!b.member && b.member === mb) || (!!b.memberEnglishName && b.memberEnglishName === mb)
  const hasTpl = (b: NormalizedControlMethodBinding) => !!b.call || !!b.callEach
  for (const b of bindings) {
    const unitMatch = (!!b.unit && b.unit === ut) || (!!b.unitEnglishName && b.unitEnglishName === ut)
    if (unitMatch && memberMatches(b) && hasTpl(b)) return b
  }
  for (const b of bindings) {
    if (b.unit === '*' && memberMatches(b) && hasTpl(b)) return b
  }
  return null
}

// 控件方法声明式派发：`控件.方法(参数)` → 协议 call 模板（按控件类型键控）。
// 返回 null = 无声明式绑定（交回 translateListLikeMethodCall 旧路，如画板 / 未迁移方法）。
function translateControlMethodCall(call: { name: string; args: string[] }, tx: (expr: string) => string): string | null {
  const dot = call.name.lastIndexOf('.')
  if (dot <= 0) return null
  const objName = call.name.slice(0, dot)
  const method = call.name.slice(dot + 1)
  if (!/^[一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*$/.test(objName)) return null
  const type = resolveProjectControlType(objName)
  if (!type) return null
  const binding = resolveControlMethod(loadCompileProtocols().controlMethods, type, method)
  if (!binding) return null
  const cArgs = (call.args || []).map(a => tx(a ?? '0'))
  const hExpr = `yc_get_control_handle_by_name(L"${escapeCString(objName)}")`
  const nExpr = `L"${escapeCString(objName)}"`
  // 尾参可重复（如 编辑框.加入文本(甲, 乙, 丙)）：逐实参展开一次模板、用逗号表达式串成单个表达式，
  // 语义=依次执行。跳过空实参——展开参数行「回车追加下一个值行」会在源码里留下尾部空实参
  // （如 `加入文本(“甲”,乙,)`，与 调试输出 同款），空值不该发调用；全空则发 ((void)0) 保持合法表达式。
  if (binding.callEach) {
    const eachArgs = (call.args || []).filter(a => (a ?? '').trim() !== '').map(a => tx(a))
    if (eachArgs.length === 0) return '((void)0)'
    const calls = eachArgs.map(a => applyMemberTemplate(binding.callEach.replace(/\{arg\}/g, () => a), hExpr, '', [a], nExpr))
    return calls.length === 1 ? calls[0] : `(${calls.join(', ')})`
  }
  return applyMemberTemplate(binding.call, hExpr, '', cArgs, nExpr)
}

// 按（控件类型, 成员名）解析属性读写模板。控件类型全局唯一，故不按 library 过滤（与 resolveControlByProtocol 一致宽松）。
function resolveControlMemberTemplate(
  bindings: NormalizedControlMemberBinding[],
  unitType: string,
  member: string,
  kind: 'get' | 'set',
): string | null {
  if (bindings.length === 0) return null
  const ut = normalizeKey(unitType)
  const mb = normalizeKey(member)
  if (!ut || !mb) return null
  const memberMatches = (b: NormalizedControlMemberBinding) =>
    (!!b.member && b.member === mb) || (!!b.memberEnglishName && b.memberEnglishName === mb)
  // 先精确匹配控件类型，再回退到通用绑定（unit 为 '*'）——per-unit 属性覆盖同名公共属性。
  for (const b of bindings) {
    const unitMatch = (!!b.unit && b.unit === ut) || (!!b.unitEnglishName && b.unitEnglishName === ut)
    if (!unitMatch || !memberMatches(b)) continue
    const tpl = kind === 'get' ? b.get : b.set
    if (tpl) return tpl
  }
  for (const b of bindings) {
    if (b.unit !== '*' || !memberMatches(b)) continue
    const tpl = kind === 'get' ? b.get : b.set
    if (tpl) return tpl
  }
  return null
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
  const border = readIntProp(extraProps['边框'], 1)
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
  // 输入方式：0通常 1只读方式 2密码输入 3整数文本 4小数文本 5字节 6短整数 7整数 8长整数 9小数 10双精度 11日期时间
  if (inputMode === 1) parts.push('ES_READONLY')
  if (inputMode === 2) parts.push('ES_PASSWORD')
  // 转换方式（与易语言 ConvertMode 索引一致）：1=大写->小写(强制小写) 2=小写->大写(强制大写)
  if (caseConvert === 1) parts.push('ES_LOWERCASE')
  else if (caseConvert === 2) parts.push('ES_UPPERCASE')
  if (!hideSelection) parts.push('ES_NOHIDESEL')
  // 边框（与易语言 EditBox.border 索引一致）：0无 1凹入式 2凸出式 3浅凹入式 4镜框式 5单线边框式
  if (border === 5) parts.push('WS_BORDER')

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
  if (spinMode === 1 || spinMode === 2) {
    // 自动调节器(1)：UDS_SETBUDDYINT 让上下键在上/下限内自动增减编辑框整数内容 + 设范围；
    // 手动调节器(2)：不绑整数、不设范围，仅贴附编辑框，由程序在 WM_VSCROLL 事件里自行处理。
    const budInt = spinMode === 1 ? ' | UDS_SETBUDDYINT' : ''
    const rangeMsg = spinMode === 1 ? ` SendMessage(hSpin, UDM_SETRANGE32, (WPARAM)${spinMin}, (LPARAM)${spinMax});` : ''
    postCreateLines.push(
      `{ HWND hSpin = CreateWindowExW(0, L"msctls_updown32", L"", WS_CHILD | WS_VISIBLE${budInt} | UDS_ALIGNRIGHT | UDS_ARROWKEYS | UDS_NOTHOUSANDS, 0, 0, 0, 0, hWndParent, NULL, g_hInstance, NULL);`
      + ' SendMessage(hSpin, UDM_SETBUDDY, (WPARAM)hCtrl, 0);'
      + rangeMsg + ' }',
    )
  }

  return {
    exStyle: border === 1 ? 'WS_EX_CLIENTEDGE'
      : border === 2 ? 'WS_EX_WINDOWEDGE'
      : border === 3 ? 'WS_EX_STATICEDGE'
      : border === 4 ? 'WS_EX_DLGMODALFRAME'
      : '0',
    style: parts.join(' | '),
    postCreateLines,
    colorEntry: (textColor !== 0 || backColor !== 0xffffff) ? { textColor, backColor } : null,
    needsInputFilter,
  }
}

// 标准 STATIC 标签：横/纵对齐落成 SS_* 样式位、边框走 exStyle（与编辑框同 6 路映射 + 渐变镜框式）、
// 文本/背景色与透明经 WM_CTLCOLORSTATIC 查表（复用 g_ycEditColors）。字体走通用 CreateFontW 路径。
// 底图/底图方式/数据源/数据列暂声明占位（需 owner-draw/数据绑定，待后续）。
function buildStdLabelCodegen(extraProps: Record<string, unknown>): {
  style: string; exStyle: string; colorEntry: { textColor: number; backColor: number } | null; transparent: boolean
} {
  const hAlign = readIntProp(extraProps['横向对齐方式'], 0)  // 0左 1中 2右
  const vAlign = readIntProp(extraProps['纵向对齐方式'], 0)  // 0顶 1中 2底
  const border = readIntProp(extraProps['边框'], 0)          // 0无 1凹入 2凸出 3浅凹 4镜框 5单线 6渐变镜框
  const effect = readIntProp(extraProps['效果'], 0)          // 0通常 1凹入 2凸出 3阴影 4透明
  const textColor = readIntProp(extraProps['文本颜色'], 0)
  const backColor = readIntProp(extraProps['背景颜色'], 16777215)  // 默认白色（进颜色表填白，创建即白底不再融入窗口）；-1 兼容旧工程=融入窗口；0=纯黑；显式白/黑=真白/真黑
  const autoWrap = readBoolProp(extraProps['是否自动折行'], false)
  const parts = ['WS_CHILD', 'SS_NOTIFY']
  // 横向对齐：居中/右总是折行；左对齐时按「是否自动折行」选 SS_LEFT(折行)/SS_LEFTNOWORDWRAP(不折行)
  parts.push(hAlign === 1 ? 'SS_CENTER' : hAlign === 2 ? 'SS_RIGHT' : (autoWrap ? 'SS_LEFT' : 'SS_LEFTNOWORDWRAP'))
  if (vAlign === 1) parts.push('SS_CENTERIMAGE')  // STATIC 仅支持垂直居中（单行）
  if (border === 5) parts.push('WS_BORDER')
  const exStyle = border === 1 ? 'WS_EX_CLIENTEDGE'
    : border === 2 ? 'WS_EX_WINDOWEDGE'
    : border === 3 ? 'WS_EX_STATICEDGE'
    : (border === 4 || border === 6) ? 'WS_EX_DLGMODALFRAME'
    : '0'
  return {
    style: parts.join(' | '),
    exStyle,
    colorEntry: (textColor !== 0 || backColor >= 0) ? { textColor, backColor: backColor >= 0 ? backColor : 0xffffff } : null,
    transparent: effect === 4,
  }
}

// 标准 BUTTON·选择框(BS_AUTOCHECKBOX)/单选框(BS_AUTORADIOBUTTON)：勾选/按钮形式/平面/标题居左/对齐落成样式，
// 选中态创建后 BM_SETCHECK。文本/背景色经 WM_CTLCOLORSTATIC（复用 g_ycEditColors），字体走通用路径。
// 图片/数据源/数据列暂声明占位。
function buildStdCheckableCodegen(extraProps: Record<string, unknown>, isRadio: boolean): {
  style: string; checked: boolean; colorEntry: { textColor: number; backColor: number } | null
} {
  const hAlign = readIntProp(extraProps['横向对齐方式'], 0)  // 0左 1中 2右
  const vAlign = readIntProp(extraProps['纵向对齐方式'], 0)  // 0顶 1中 2底
  const pushLike = readBoolProp(extraProps['按钮形式'], false)
  const flat = readBoolProp(extraProps['平面'], false)
  const leftText = readBoolProp(extraProps['标题居左'], false)
  const checked = readBoolProp(extraProps['选中'], false)
  const textColor = readIntProp(extraProps['文本颜色'], 0)
  const backColor = readIntProp(extraProps['背景颜色'], 16777215)  // 默认白色（进颜色表填白，创建即白底不再融入窗口）；-1 兼容旧工程=融入窗口；0=纯黑；显式白/黑=真白/真黑
  const parts = ['WS_CHILD', 'WS_TABSTOP', isRadio ? 'BS_AUTORADIOBUTTON' : 'BS_AUTOCHECKBOX']
  if (pushLike) parts.push('BS_PUSHLIKE')
  if (flat) parts.push('BS_FLAT')
  if (leftText) parts.push('BS_LEFTTEXT')  // 标题居左（勾选框移到右侧）
  parts.push(hAlign === 1 ? 'BS_CENTER' : hAlign === 2 ? 'BS_RIGHT' : 'BS_LEFT')
  parts.push(vAlign === 1 ? 'BS_VCENTER' : vAlign === 2 ? 'BS_BOTTOM' : 'BS_TOP')
  return {
    style: parts.join(' | '),
    checked,
    colorEntry: (textColor !== 0 || backColor >= 0) ? { textColor, backColor: backColor >= 0 ? backColor : 0xffffff } : null,
  }
}

// 标准 BUTTON·分组框(BS_GROUPBOX)：标题对齐落成样式，文本/背景色经 WM_CTLCOLORSTATIC，字体走通用路径。
function buildStdGroupBoxCodegen(extraProps: Record<string, unknown>): {
  style: string; colorEntry: { textColor: number; backColor: number } | null
} {
  const hAlign = readIntProp(extraProps['对齐方式'], 0)  // 0左 1中 2右
  const textColor = readIntProp(extraProps['文本颜色'], 0)
  const backColor = readIntProp(extraProps['背景颜色'], 16777215)  // 默认白色（进颜色表填白，创建即白底不再融入窗口）；-1 兼容旧工程=融入窗口；0=纯黑；显式白/黑=真白/真黑
  const parts = ['WS_CHILD', 'BS_GROUPBOX']
  parts.push(hAlign === 1 ? 'BS_CENTER' : hAlign === 2 ? 'BS_RIGHT' : 'BS_LEFT')
  return {
    style: parts.join(' | '),
    colorEntry: (textColor !== 0 || backColor >= 0) ? { textColor, backColor: backColor >= 0 ? backColor : 0xffffff } : null,
  }
}

// 标准 STATIC·图片框：边框走 exStyle，背景色经 WM_CTLCOLORSTATIC；有图片则 SS_BITMAP + SS_REALSIZECONTROL
// + 创建后 STM_SETIMAGE。显示方式=居中→SS_CENTERIMAGE；=缩放→STM_SETIMAGE 前把位图拉伸到控件客户区（见图片赋值处）。
// SS_REALSIZECONTROL 关键：不加则 SS_BITMAP 会把控件放大到图片原始尺寸（运行后图片框异常变大），加了才保持设计尺寸。
function buildStdPicBoxCodegen(extraProps: Record<string, unknown>, hasImage: boolean): {
  style: string; exStyle: string; colorEntry: { textColor: number; backColor: number } | null
} {
  const border = readIntProp(extraProps['边框'], 0)      // 0无 1凹入 2凸出 3浅凹 4镜框 5单线
  const drawMode = readIntProp(extraProps['显示方式'], 0) // 0居左上 1缩放 2居中
  const backColor = readIntProp(extraProps['背景颜色'], 0xffffff)
  const parts = ['WS_CHILD', 'SS_NOTIFY']
  if (hasImage) parts.push('SS_BITMAP', 'SS_REALSIZECONTROL')  // REALSIZECONTROL：控件不随位图自动放大，恒守设计尺寸
  if (drawMode === 2) parts.push('SS_CENTERIMAGE')  // 图片居中（真实尺寸居中，裁剪）
  const exStyle = border === 1 ? 'WS_EX_CLIENTEDGE'
    : border === 2 ? 'WS_EX_WINDOWEDGE'
    : border === 3 ? 'WS_EX_STATICEDGE'
    : border === 4 ? 'WS_EX_DLGMODALFRAME'
    : '0'
  if (border === 5) parts.push('WS_BORDER')
  return {
    style: parts.join(' | '),
    exStyle,
    // 图片框是实底控件：背景色恒经 WM_CTLCOLORSTATIC 上色（含白色），否则 STATIC 会透出父窗口背景。
    colorEntry: { textColor: 0, backColor },
  }
}

// 控件「边框」6 路映射到 exStyle（0无/1凹入CLIENTEDGE/2凸出WINDOWEDGE/3浅凹STATICEDGE/4镜框DLGMODALFRAME；5单线走 style 的 WS_BORDER）。
function ctrlBorderExStyle(border: number): string {
  return border === 1 ? 'WS_EX_CLIENTEDGE'
    : border === 2 ? 'WS_EX_WINDOWEDGE'
    : border === 3 ? 'WS_EX_STATICEDGE'
    : border === 4 ? 'WS_EX_DLGMODALFRAME'
    : '0'
}

// 通用控件后创建 codegen 的返回型（样式 + exStyle + 创建后消息 + 可选颜色表项）。
interface CommonCtrlCodegen { style: string; exStyle: string; postCreateLines: string[]; colorEntry: { textColor: number; backColor: number } | null }

// 进度条（msctls_progress32）：方向/显示方式→样式位，边框→exStyle，范围/位置→PBM_ 消息。
function buildStdProgressCodegen(extraProps: Record<string, unknown>): CommonCtrlCodegen {
  const orient = readIntProp(extraProps['方向'], 0)      // 0横 1纵
  const drawMode = readIntProp(extraProps['显示方式'], 0) // 0分块 1连续
  const border = readIntProp(extraProps['边框'], 1)
  const minPos = readIntProp(extraProps['最小位置'], 0)
  const maxPos = readIntProp(extraProps['最大位置'], 100)
  const pos = readIntProp(extraProps['位置'], 0)
  const parts = ['WS_CHILD']
  if (orient === 1) parts.push('PBS_VERTICAL')
  if (drawMode === 1) parts.push('PBS_SMOOTH')
  if (border === 5) parts.push('WS_BORDER')
  const post: string[] = []
  if (minPos !== 0 || maxPos !== 100) post.push(`SendMessage(hCtrl, PBM_SETRANGE32, (WPARAM)${minPos}, (LPARAM)${maxPos});`)
  if (pos !== 0) post.push(`SendMessage(hCtrl, PBM_SETPOS, (WPARAM)${pos}, 0);`)
  return { style: parts.join(' | '), exStyle: ctrlBorderExStyle(border), postCreateLines: post, colorEntry: null }
}

// 画板（自注册 YCDRAWPANEL 类）：边框→style/exStyle。无 WS_TABSTOP（画板只有绘画事件、无焦点输入）；
// 运行时状态/backbuffer/绘画事件由 YcDrawPanelProc + g_ycDrawPanels 负责（见 CreateControls 前的画板运行时块）。
function buildStdDrawPanelCodegen(extraProps: Record<string, unknown>): CommonCtrlCodegen {
  const border = readIntProp(extraProps['边框'], 0)
  const parts = ['WS_CHILD', 'WS_CLIPSIBLINGS']
  if (border === 5) parts.push('WS_BORDER')
  return { style: parts.join(' | '), exStyle: ctrlBorderExStyle(border), postCreateLines: [], colorEntry: null }
}

// 滑块条（msctls_trackbar32）：方向/刻度类型/允许选择→样式位，范围/刻度/页行/选区/位置→TBM_ 消息。
function buildStdSliderCodegen(extraProps: Record<string, unknown>): CommonCtrlCodegen {
  const orient = readIntProp(extraProps['方向'], 0)
  const tick = readIntProp(extraProps['刻度类型'], 2)      // 0无 1上左 2下右 3双向
  const tickFreq = readIntProp(extraProps['单位刻度值'], 1)
  const allowSel = readBoolProp(extraProps['允许选择'], false)
  const selStart = readIntProp(extraProps['首选择位置'], 0)
  const selLen = readIntProp(extraProps['选择长度'], 0)
  const pageChange = readIntProp(extraProps['页改变值'], 0)
  const lineChange = readIntProp(extraProps['行改变值'], 0)
  const minPos = readIntProp(extraProps['最小位置'], 0)
  const maxPos = readIntProp(extraProps['最大位置'], 100)
  const pos = readIntProp(extraProps['位置'], 0)
  const border = readIntProp(extraProps['边框'], 0)
  const parts = ['WS_CHILD', 'WS_TABSTOP']
  parts.push(orient === 1 ? 'TBS_VERT' : 'TBS_HORZ')
  if (tick === 0) parts.push('TBS_NOTICKS')
  else { parts.push('TBS_AUTOTICKS'); if (tick === 1) parts.push('TBS_TOP'); else if (tick === 3) parts.push('TBS_BOTH') }
  if (allowSel) parts.push('TBS_ENABLESELRANGE')
  if (border === 5) parts.push('WS_BORDER')
  const post: string[] = []
  post.push(`SendMessage(hCtrl, TBM_SETRANGEMIN, (WPARAM)TRUE, (LPARAM)${minPos});`)
  post.push(`SendMessage(hCtrl, TBM_SETRANGEMAX, (WPARAM)TRUE, (LPARAM)${maxPos});`)
  if (tick !== 0 && tickFreq > 0) post.push(`SendMessage(hCtrl, TBM_SETTICFREQ, (WPARAM)${tickFreq}, 0);`)
  if (pageChange > 0) post.push(`SendMessage(hCtrl, TBM_SETPAGESIZE, 0, (LPARAM)${pageChange});`)
  if (lineChange > 0) post.push(`SendMessage(hCtrl, TBM_SETLINESIZE, 0, (LPARAM)${lineChange});`)
  if (allowSel && selLen > 0) post.push(`SendMessage(hCtrl, TBM_SETSEL, (WPARAM)TRUE, (LPARAM)MAKELONG(${selStart}, ${selStart + selLen}));`)
  if (pos !== 0) post.push(`SendMessage(hCtrl, TBM_SETPOS, (WPARAM)TRUE, (LPARAM)${pos});`)
  return { style: parts.join(' | '), exStyle: ctrlBorderExStyle(border), postCreateLines: post, colorEntry: null }
}

// 滚动条（SCROLLBAR）：SBS_HORZ/VERT，范围+页+位置→SetScrollInfo。跟随/事件门控在 WM_?SCROLL 处理器（未在此实现，静态范围/位置已生效）。
function buildStdScrollBarCodegen(extraProps: Record<string, unknown>, isVert: boolean): CommonCtrlCodegen {
  const minPos = readIntProp(extraProps['最小位置'], 0)
  const maxPos = readIntProp(extraProps['最大位置'], 100)
  const pageChange = readIntProp(extraProps['页改变值'], 10)
  const pos = readIntProp(extraProps['位置'], 0)
  const post = [
    `{ SCROLLINFO si; ZeroMemory(&si, sizeof(si)); si.cbSize = sizeof(si); si.fMask = SIF_RANGE | SIF_PAGE | SIF_POS; si.nMin = ${minPos}; si.nMax = ${maxPos}; si.nPage = ${Math.max(0, pageChange)}; si.nPos = ${pos}; SetScrollInfo(hCtrl, SB_CTL, &si, TRUE); }`,
  ]
  return { style: `WS_CHILD | ${isVert ? 'SBS_VERT' : 'SBS_HORZ'}`, exStyle: '0', postCreateLines: post, colorEntry: null }
}

// 日期框（SysDateTimePick32）：允许编辑/附件类型/边框→样式位/exStyle。今天/最小/最大日期缺文本→SYSTEMTIME 解析，暂占位。
function buildStdDatePickerCodegen(extraProps: Record<string, unknown>): CommonCtrlCodegen {
  const allowEdit = readBoolProp(extraProps['允许编辑'], false)
  const kind = readIntProp(extraProps['附件类型'], 0)  // 0下拉月历 1调节器
  const border = readIntProp(extraProps['边框'], 0)
  const parts = ['WS_CHILD', 'WS_TABSTOP']
  if (allowEdit) parts.push('DTS_APPCANPARSE')
  if (kind === 1) parts.push('DTS_UPDOWN')
  if (border === 5) parts.push('WS_BORDER')
  const today = String(extraProps['今天'] ?? '')
  const minDate = String(extraProps['最小日期'] ?? '')
  const maxDate = String(extraProps['最大日期'] ?? '')
  const post: string[] = []
  if (today) post.push(`{ SYSTEMTIME st; if (yc_parse_systemtime(L"${escapeCString(today)}", &st)) SendMessage(hCtrl, DTM_SETSYSTEMTIME, GDT_VALID, (LPARAM)&st); }`)
  if (minDate || maxDate) {
    const setMin = minDate ? `if (yc_parse_systemtime(L"${escapeCString(minDate)}", &r[0])) f |= GDTR_MIN;` : ''
    const setMax = maxDate ? `if (yc_parse_systemtime(L"${escapeCString(maxDate)}", &r[1])) f |= GDTR_MAX;` : ''
    post.push(`{ SYSTEMTIME r[2]; ZeroMemory(r, sizeof(r)); DWORD f = 0; ${setMin} ${setMax} if (f) SendMessage(hCtrl, DTM_SETRANGE, (WPARAM)f, (LPARAM)r); }`)
  }
  return { style: parts.join(' | '), exStyle: ctrlBorderExStyle(border), postCreateLines: post, colorEntry: null }
}

// 月历（SysMonthCal32）：显示项样式位 + 首日/滚动月/最多选天→MCM_ 消息 + 颜色→MCM_SETCOLOR。日期属性暂占位。
function buildStdMonthCalCodegen(extraProps: Record<string, unknown>): CommonCtrlCodegen {
  const border = readIntProp(extraProps['边框'], 0)
  const noToday = readBoolProp(extraProps['不显示今天'], false)
  const noTodayCircle = readBoolProp(extraProps['不圈注今天'], false)
  const weekNumbers = readBoolProp(extraProps['显示星期序号'], false)
  const multiSel = readBoolProp(extraProps['允许选择多天'], false)
  const firstDay = readIntProp(extraProps['开始星期首日'], 0)
  const monthDelta = readIntProp(extraProps['滚动月数'], 0)
  const maxSel = readIntProp(extraProps['最多选择天数'], 0)
  const parts = ['WS_CHILD']
  if (noToday) parts.push('MCS_NOTODAY')
  if (noTodayCircle) parts.push('MCS_NOTODAYCIRCLE')
  if (weekNumbers) parts.push('MCS_WEEKNUMBERS')
  if (multiSel) parts.push('MCS_MULTISELECT')
  if (border === 5) parts.push('WS_BORDER')
  const post: string[] = []
  if (firstDay !== 0) post.push(`SendMessage(hCtrl, MCM_SETFIRSTDAYOFWEEK, 0, (LPARAM)${firstDay});`)
  if (monthDelta > 0) post.push(`SendMessage(hCtrl, MCM_SETMONTHDELTA, (WPARAM)${monthDelta}, 0);`)
  if (multiSel && maxSel > 0) post.push(`SendMessage(hCtrl, MCM_SETMAXSELCOUNT, (WPARAM)${maxSel}, 0);`)
  const colorMap: Array<[string, string, number]> = [
    ['文本颜色', 'MCSC_TEXT', 0], ['背景颜色', 'MCSC_BACKGROUND', 0xffffff], ['标题颜色', 'MCSC_TITLETEXT', 0],
    ['标题背景颜色', 'MCSC_TITLEBK', 0], ['内背景颜色', 'MCSC_MONTHBK', 0xffffff], ['非本月颜色', 'MCSC_TRAILINGTEXT', 0],
  ]
  for (const [prop, macro, def] of colorMap) {
    const v = readIntProp(extraProps[prop], def)
    if (v !== def) post.push(`SendMessage(hCtrl, MCM_SETCOLOR, ${macro}, (LPARAM)(COLORREF)${v >>> 0});`)
  }
  // 日期属性（今天/最小/最大日期/首尾选择日）经 yc_parse_systemtime 解析 → MCM_ 消息。
  const today = String(extraProps['今天'] ?? '')
  const minDate = String(extraProps['最小日期'] ?? '')
  const maxDate = String(extraProps['最大日期'] ?? '')
  const minSel = String(extraProps['首选择日'] ?? '')
  const maxSel2 = String(extraProps['尾选择日'] ?? '')
  if (today) post.push(`{ SYSTEMTIME st; if (yc_parse_systemtime(L"${escapeCString(today)}", &st)) SendMessage(hCtrl, MCM_SETTODAY, 0, (LPARAM)&st); }`)
  if (minDate || maxDate) {
    const setMin = minDate ? `if (yc_parse_systemtime(L"${escapeCString(minDate)}", &r[0])) f |= GDTR_MIN;` : ''
    const setMax = maxDate ? `if (yc_parse_systemtime(L"${escapeCString(maxDate)}", &r[1])) f |= GDTR_MAX;` : ''
    post.push(`{ SYSTEMTIME r[2]; ZeroMemory(r, sizeof(r)); DWORD f = 0; ${setMin} ${setMax} if (f) SendMessage(hCtrl, MCM_SETRANGE, (WPARAM)f, (LPARAM)r); }`)
  }
  if (multiSel && minSel && maxSel2) {
    post.push(`{ SYSTEMTIME r[2]; ZeroMemory(r, sizeof(r)); if (yc_parse_systemtime(L"${escapeCString(minSel)}", &r[0]) && yc_parse_systemtime(L"${escapeCString(maxSel2)}", &r[1])) SendMessage(hCtrl, MCM_SETSELRANGE, 0, (LPARAM)r); }`)
  } else if (!multiSel && minSel) {
    post.push(`{ SYSTEMTIME st; if (yc_parse_systemtime(L"${escapeCString(minSel)}", &st)) SendMessage(hCtrl, MCM_SETCURSEL, 0, (LPARAM)&st); }`)
  }
  return { style: parts.join(' | '), exStyle: ctrlBorderExStyle(border), postCreateLines: post, colorEntry: null }
}

// 组合框（COMBOBOX）：类型→CBS_SIMPLE/DROPDOWN/DROPDOWNLIST，自动排序→CBS_SORT；内容/长度/选中→CB_ 消息；文本/背景色→颜色表。
function buildStdComboBoxCodegen(extraProps: Record<string, unknown>): CommonCtrlCodegen {
  const kind = readIntProp(extraProps['类型'], 2)  // 0可编辑列表 1可编辑下拉 2不可编辑下拉
  const sort = readBoolProp(extraProps['自动排序'], false)
  const maxLen = readIntProp(extraProps['最大文本长度'], 0)
  const curSel = readIntProp(extraProps['现行选中项'], -1)
  const content = String(extraProps['内容'] ?? '')
  const textColor = readIntProp(extraProps['文本颜色'], 0)
  const backColor = readIntProp(extraProps['背景颜色'], 0xffffff)
  const parts = ['WS_CHILD', 'WS_TABSTOP', 'WS_VSCROLL', 'CBS_HASSTRINGS']
  parts.push(kind === 0 ? 'CBS_SIMPLE' : kind === 1 ? 'CBS_DROPDOWN' : 'CBS_DROPDOWNLIST')
  if (sort) parts.push('CBS_SORT')
  const post: string[] = []
  if (content && kind !== 2) post.push(`SetWindowTextW(hCtrl, L"${escapeCString(content)}");`)
  if (maxLen > 0 && kind !== 2) post.push(`SendMessage(hCtrl, CB_LIMITTEXT, (WPARAM)${maxLen}, 0);`)
  if (curSel >= 0) post.push(`SendMessage(hCtrl, CB_SETCURSEL, (WPARAM)${curSel}, 0);`)
  return { style: parts.join(' | '), exStyle: '0', postCreateLines: post, colorEntry: (textColor !== 0 || backColor !== 0xffffff) ? { textColor, backColor } : null }
}

// 列表框/选择列表框（LISTBOX）：自动排序/多列/允许多选→样式位，边框→exStyle，行间距/选中→LB_ 消息；文本/背景色→颜色表。
function buildStdListBoxCodegen(extraProps: Record<string, unknown>, isChecked: boolean): CommonCtrlCodegen {
  const border = readIntProp(extraProps['边框'], isChecked ? 1 : 1)
  const sort = readBoolProp(extraProps['自动排序'], false)
  const multiCol = readBoolProp(extraProps['多列'], false)
  const multiSel = readBoolProp(extraProps['允许选择多项'], false)
  const rowExtra = readIntProp(extraProps['行间距'], 0)
  const curSel = readIntProp(extraProps['现行选中项'], -1)
  const textColor = readIntProp(extraProps['文本颜色'], 0)
  const backColor = readIntProp(extraProps['背景颜色'], 0xffffff)
  const parts = ['WS_CHILD', 'WS_TABSTOP', 'LBS_NOTIFY', 'LBS_HASSTRINGS']
  if (multiCol) parts.push('LBS_MULTICOLUMN', 'WS_HSCROLL')
  else parts.push('WS_VSCROLL')
  if (sort) parts.push('LBS_SORT')
  if (!isChecked && multiSel) parts.push('LBS_EXTENDEDSEL', 'LBS_MULTIPLESEL')
  if (isChecked) parts.push('LBS_OWNERDRAWFIXED')  // 选择列表框：自绘复选框（WM_DRAWITEM 画勾选框+文本）
  if (border === 5) parts.push('WS_BORDER')
  const post: string[] = []
  if (isChecked) post.push('SetWindowSubclass(hCtrl, YcChkListProc, 1, 0);')  // 选择列表框：挂子类做点击/空格切换勾选
  if (rowExtra > 0) post.push(`{ int ih = (int)SendMessage(hCtrl, LB_GETITEMHEIGHT, 0, 0); SendMessage(hCtrl, LB_SETITEMHEIGHT, 0, (LPARAM)(ih + ${rowExtra})); }`)
  if (curSel >= 0 && (isChecked || !multiSel)) post.push(`SendMessage(hCtrl, LB_SETCURSEL, (WPARAM)${curSel}, 0);`)
  return { style: parts.join(' | '), exStyle: ctrlBorderExStyle(border), postCreateLines: post, colorEntry: (textColor !== 0 || backColor !== 0xffffff) ? { textColor, backColor } : null }
}

// 标准 BUTTON 控件同样忽略 WM_APP+1，按钮属性必须在创建时落成样式位。
// 类型/横向/纵向对齐/可停留焦点默认值须与 window-units.json 按钮定义一致。
// ownerDraw=true（设了底色或文本色）时用 BS_OWNERDRAW，颜色/文字由 WM_DRAWITEM 自绘。
function buildStdButtonCodegen(extraProps: Record<string, unknown>, hasImage: boolean, ownerDraw: boolean): { style: string } {
  const style = readIntProp(extraProps['类型'], 0)           // 0通常 1默认
  const hAlign = readIntProp(extraProps['横向对齐方式'], 1)   // 0左 1中 2右
  const vAlign = readIntProp(extraProps['纵向对齐方式'], 1)   // 0顶 1中 2底
  const tabStop = readBoolProp(extraProps['可停留焦点'], true)
  const parts = ['WS_CHILD']
  if (ownerDraw) {
    parts.push('BS_OWNERDRAW')
  } else {
    parts.push(style === 1 ? 'BS_DEFPUSHBUTTON' : 'BS_PUSHBUTTON')
    parts.push(hAlign === 0 ? 'BS_LEFT' : hAlign === 2 ? 'BS_RIGHT' : 'BS_CENTER')
    parts.push(vAlign === 0 ? 'BS_TOP' : vAlign === 2 ? 'BS_BOTTOM' : 'BS_VCENTER')
    if (hasImage) parts.push('BS_BITMAP')
  }
  if (tabStop) parts.push('WS_TABSTOP')
  return { style: parts.join(' | ') }
}

// 解析窗口文件
function parseWindowFile(efwPath: string): WindowFileInfo {
  const defaultFormName = basename(efwPath, '.efw') || '_启动窗口'
  const info = createDefaultWindowFileInfo(defaultFormName, '窗口')
  if (!existsSync(efwPath)) return info
  try {
    const data = JSON.parse(readFileSync(efwPath, 'utf-8'))
    info.formName = (data.name || data.formName || defaultFormName || '_启动窗口')
    info.width = data.formWidth || data.width || 592
    info.height = data.formHeight || data.height || 384
    info.title = data.formTitle || data.title || data.name || '窗口'
    applyWindowProperties(info, data.properties || {})
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
    if (Array.isArray(data.menu)) info.menu = data.menu as MenuNodeInfo[]
  } catch { /* ignore */ }
  return info
}

// 易语言数据类型 → C 类型
// 清单里的「X数组」返回类型（如 分割文本 的〈文本型数组〉）。运行时数组统一是 std::vector<long long>
// （与 ARRAY_ELEM_INTEGER_TYPES/ARRAY_ELEM_FLOAT_TYPES 同一套元素存储：int 直存、f64 位模式、
//  text/bin 存堆指针位模式）。
const YCMD_ARRAY_RETURN_TYPES: Record<string, ArrayElemKind> = {
  '字节型数组': 'int', '短整数型数组': 'int', '整数型数组': 'int', '长整数型数组': 'int', '逻辑型数组': 'int',
  '小数型数组': 'f64', '双精度小数型数组': 'f64',
  '文本型数组': 'text',
  '字节集数组': 'bin',
}

function mapTypeToCType(type: string): string {
  const trimmed = (type || '').trim()
  if (activeProjectClassNames.has(trimmed)) return trimmed
  if (activeProjectCustomTypeNames.has(trimmed)) return `struct ${trimmed}`
  if (YCMD_ARRAY_RETURN_TYPES[trimmed]) return 'std::vector<long long>'
  if (trimmed.includes('指针') || trimmed.includes('ptr') || trimmed.includes('PTR')) return 'intptr_t'
  const map: Record<string, string> = {
    '整数型': 'int', '长整数型': 'long long', '小数型': 'float',
    '双精度小数型': 'double', '文本型': 'YC_TEXT', '逻辑型': 'int', '字节集': 'YC_BIN', '大整数型': 'YC_BIG', '大数': 'YC_BIG',
    '字节型': 'unsigned char', '短整数型': 'short',
    // 日期时间型=OLE 自动化日期（1899-12-30 起的天数、小数部分为时刻），krnln impl 全按 double 收发
    //（krnln_year/month/day/hour/minute/second/TimeChg/TimeDiff/now… 皆是）。
    // 此前本表漏了它 → 掉进下面的默认 'int'，声明与 impl 错位：传参把 double 当 int、
    // 取返回值读错寄存器（如 取现行时间 必拿垃圾）。见签名审计 C 类。
    '日期时间型': 'double',
  }
  return map[trimmed] || 'int'
}

function getTypeDefaultInitializer(type: string): string {
  const trimmed = (type || '').trim()
  if (activeProjectClassNames.has(trimmed)) return '{}'
  if (activeProjectCustomTypeNames.has(trimmed)) return '{}'
  const cType = mapTypeToCType(trimmed)
  if (cType === 'YC_TEXT') return 'YC_TEXT()'
  if (cType === 'YC_BIN') return 'YC_BIN()'
  if (cType === 'YC_BIG') return 'YC_BIG()'
  if (cType === 'float') return '0.0f'
  if (cType === 'double') return '0.0'
  return '0'
}

function splitDeclParts(text: string): string[] {
  return text.split(/[\uFF0C,]/).map(s => s.trim())
}

// 引号感知的声明字段切分：数组尺寸字段形如 "100,100"，内部逗号不能当分隔符
function splitDeclPartsQuoted(text: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  let qc = ''
  for (const ch of text) {
    if (inQ) {
      cur += ch
      if ((qc === '"' && ch === '"') || (qc === '“' && ch === '”')) inQ = false
      continue
    }
    if (ch === '"' || ch === '“') { inQ = true; qc = ch; cur += ch; continue }
    if (ch === ',' || ch === '，') { out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  out.push(cur.trim())
  return out
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
      // 清单里常量名带 # 前缀（如 "#换行符"），#define 与表达式引用（replaceConstantRefs 剥 #）都用裸名
      const name = (c.name || '').trim().replace(/^#/, '')
      if (!name || seen.has(name)) continue
      seen.add(name)
      result.push({
        name,
        // 文本常量的值可能就是空白字符本身（#换行符 = CRLF、#制表符 = TAB），不能 trim
        value: c.type === 'text' ? (c.value || '') : (c.value || '').trim(),
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
      const assignMatch = line.match(/^[\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]*\s*[＝=]\s*(.+)$/)
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
      const nestedCallRe = /([一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*)\s*[（(]/g
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

  // 3) 窗口程序无条件依赖核心库 krnln 运行时：生成的 main.cpp 总会发窗口运行时封装
  //    （yc_ctrl_get_text→krnln_ctrl_*、yc_ll_get_text→krnln_ll_* 等），故即使空窗口
  //    （无控件、无命令）也必须链接 krnln，否则链接期缺 krnln_* 符号。
  if (project.outputType === 'WindowsApp') {
    used.add('krnln')
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

      const assignMatch = line.match(/^[\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]*\s*[＝=]\s*(.+)$/)
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

      const assignMatch = line.match(/^[\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]*\s*[＝=]\s*(.+)$/)
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

// data:image/...;base64,XXXX → 原始文件字节（PNG/JPG 等编码字节，运行时由 GDI+ 解码）
function decodeImageDataUrl(dataUrl: string): Buffer | null {
  const m = /^data:[^;]*;base64,([\s\S]*)$/.exec(dataUrl)
  if (!m) return null
  try {
    const buf = Buffer.from(m[1], 'base64')
    return buf.length > 0 ? buf : null
  } catch {
    return null
  }
}

// 控件「字体」属性（JSON 字符串）→ 字体规格，供 CreateFontW；color 为文本颜色 COLORREF（可空）
interface ControlFontSpec { name: string; size: number; bold: boolean; italic: boolean; underline: boolean; strikeout: boolean; color?: number }
function parseControlFont(value: unknown): ControlFontSpec | null {
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return null
  try {
    const o = JSON.parse(value) as Partial<ControlFontSpec>
    if (o && typeof o.name === 'string' && o.name.trim()) {
      const size = Number(o.size)
      return {
        name: o.name.trim(),
        size: Number.isFinite(size) && size > 0 ? Math.round(size) : 9,
        bold: !!o.bold, italic: !!o.italic, underline: !!o.underline, strikeout: !!o.strikeout,
        color: typeof o.color === 'number' && o.color >= 0 ? Math.floor(o.color) : undefined,
      }
    }
  } catch { /* 非法 JSON → 无字体 */ }
  return null
}

// 字节缓冲 → C 语言 unsigned char 数组初始化体（不含声明）
function bytesToCArrayBody(bytes: Buffer): string {
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i++) {
    parts.push(String(bytes[i]))
  }
  // 每行 20 个，便于阅读且避免超长行
  let out = ''
  for (let i = 0; i < parts.length; i += 20) {
    out += '  ' + parts.slice(i, i + 20).join(',') + ',\n'
  }
  return out
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
        // 标志字段从 parts[2] 起查（参数名/类型本身可能叫「数组」）
        if (paramName) currentSub.params.push({ name: paramName, type: paramType, isArray: parts.slice(2).includes('数组'), isByRef: parts.slice(2).includes('传址') })
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
        isByRef: parts.slice(2).includes('传址'),
        isArray: parts.slice(2).includes('数组'),
        optional: parts.slice(2).includes('可空'),
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
      // 协议解析会真的生成代码（含参数表达式转译），而校验阶段没有转译上下文
      //（如数组变量集合未填充，数组命令的实参转换会抛错）——试生成抛错恰说明
      // 存在后端路径，按「有路径」处理，真实的转译错误留给主转译阶段带上下文再报。
      const tryResolve = (fn: () => string | null | undefined): string | null => {
        try {
          return fn() || null
        } catch {
          return 'has-backend-path'
        }
      }
      const protocolCode = tryResolve(() => resolveCommandByProtocol(
        protocols.commands,
        command.libraryFileName,
        command.name,
        command.englishName,
        args,
      ))
      const protocolExpr = tryResolve(() => resolveCommandExprByProtocol(
        protocols.commands,
        command.libraryFileName,
        command.name,
        command.englishName,
        args,
      ))
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

      const assignMatch = line.match(/^[\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]*\s*[＝=]\s*(.+)$/)
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

/**
 * 【相除 ÷ 的哨兵】÷(相除) 与 ＼(整除) 都长得像 C 的 /，语义却不同：÷ **恒返回双精度小数**
 * （易语言 20 ÷ 7 ＝ 2.857142857143），＼ 才是截断整数商（20 ＼ 7 ＝ 2）。C 的 / 在两个整数
 * 操作数下就是截断除法，所以 ÷ 直接映射成 / 会把小数部分丢掉。
 *
 * 转换阶段先把 ÷ 记成这个哨兵带过表达式拆分，由 translateExpressionToC 的乘除分支按操作数
 * 类型分诊生成（大数仍走整数商——大数没有小数表示）。哨兵取自 Unicode 私用区（类别 Co，
 * 不被 \p{L} 与本文件的标识符区间命中），源码与生成的 C 都不可能出现。
 *
 * 哨兵不是合法 C：凡是没走到乘除分支的路径（旧的库命令实参编组、项目常量、拆分兜底）
 * 都必须经 inlineRealDiv 落地。
 */
const REAL_DIV_MARK = '\uE000'

/**
 * 没走乘除拆分时的 ÷ 就地形态：`a ÷ b` → `a /(double) b`。
 * 是合法 C 且语义正确——右操作数转 double 后整个除法即走浮点，且 (double) 的结合力高于 /、*，
 * 故 `a ÷ b × c` → `a /(double) b * c` 仍是 (a / (double)b) * c。
 * 只是拿不到拆分器那份大数/文本分诊，故仅作兜底，正路走 translateExpressionToC 的乘除分支。
 */
function inlineRealDiv(expr: string): string {
  return expr.split(REAL_DIV_MARK).join('/(double)')
}

// 将全角运算符转换为C运算符（仅用于字符串字面量**之外**的片段，见 convertFullWidthOps）
function convertFullWidthOpsInCode(segment: string): string {
  return segment
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
    // ÷ 相除：恒双精度，不能直接给 /（会截断）——见 REAL_DIV_MARK
    .replace(/÷/g, REAL_DIV_MARK)
    .replace(/％/g, '%')
    // ＼ 整除：整数操作数下 C 的 / 即截断除法
    .replace(/＼/g, '/')
}

/**
 * 将全角运算符转换为 C 运算符。**字符串字面量内一律不改写**——引号里的 ＋÷＝ 是要原样打印给
 * 用户的文本，不是运算符。此前整串无脑 replace：`“20 ＋ 7 ＝ 27”` 会被打成 `20 + 7 == 27`，
 * `“ ÷ ”` 更会变成 REAL_DIV_MARK 那个私用区字符（打印出来是个看不见的方块）。
 *
 * 引号约定同 findTopLevel* 系列与本文件的字面量正则：“…” 与 "…"，都不支持转义。
 */
function convertFullWidthOps(expr: string): string {
  let out = ''
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if (ch === '"' || ch === '“') {
      const close = ch === '“' ? '”' : '"'
      const end = expr.indexOf(close, i + 1)
      // 引号未闭合 → 剩下整段按字面量原样带走，不当运算式改写（真有语法错另有报错管）
      if (end < 0) { out += expr.slice(i); break }
      out += expr.slice(i, end + 1)
      i = end + 1
      continue
    }
    let j = i
    while (j < expr.length && expr[j] !== '"' && expr[j] !== '“') j++
    out += convertFullWidthOpsInCode(expr.slice(i, j))
    i = j
  }
  return out
}

function replaceConstantRefs(expr: string): string {
  return expr.replace(/#([\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]*)/g, '$1')
}

// \u5168\u4f53\u5df2\u77e5\u5e38\u91cf\u540d\uff08\u5e93\u5e38\u91cf + \u9879\u76ee\u5e38\u91cf\uff0c\u5747\u5265\u53bb\u524d\u5bfc #\uff09\u3002\u540d\u8272\u8f6c\u6362\u547d\u4e2d\u540c\u540d\u5e38\u91cf\u65f6\u8ba9\u5e38\u91cf\u4f18\u5148\uff0c
// \u907f\u514d\u906e\u853d\u7528\u6237/\u5e93\u5e38\u91cf\u3002\u8f6c\u8bd1\u5f00\u59cb\u524d\u4e0e currentProjectControls \u540c\u5904\u704c\u4e00\u6b21\u3002
let currentKnownConstantNames = new Set<string>()

// \u989c\u8272\u5b57\u9762\u91cf\u9884\u5904\u7406\uff1a\u628a #RRGGBB / #RGB / #RRGGBBAA(\u4e22 alpha) / #\u540d\u8272 \u5c31\u5730\u66ff\u6362\u4e3a\u5341\u8fdb\u5236 COLORREF\u3002
// \u5fc5\u987b\u5728 replaceConstantRefs \u4e4b\u524d\u8dd1\u2014\u2014\u5426\u5219 #ffffff \u88ab\u5265\u6210\u672a\u5b9a\u4e49\u6807\u8bc6\u7b26\u3001#00ff00 \u6b8b\u7559\u88f8 # \u6210\u975e\u6cd5 C++\u3002
// \u5b57\u7b26\u4e32\u5b57\u9762\u91cf\u5185\u4e0d\u6539\u5199\uff1b\u547d\u4e2d\u5df2\u77e5\u5e38\u91cf\u540d\u7684 token \u539f\u6837\u4fdd\u7559\u4ea4\u7ed9\u5e38\u91cf\u5904\u7406\u3002\u8f93\u51fa\u5341\u8fdb\u5236\uff08\u6570\u5b57\u5feb\u8def\u53ea\u8ba4 /^-?\d+$/\uff09\u3002
function applyColorLiterals(expr: string): string {
  if (expr.indexOf('#') < 0) return expr
  const COLOR_TOKEN = /^#([0-9a-fA-F]{8}(?![0-9a-fA-F])|[0-9a-fA-F]{6}(?![0-9a-fA-F])|[0-9a-fA-F]{3}(?![0-9a-fA-F])|[\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_]*)/
  let out = ''
  let inStr = false
  let strClose = ''
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (inStr) {
      out += ch
      if (ch === strClose) inStr = false
      continue
    }
    if (ch === '"') { inStr = true; strClose = '"'; out += ch; continue }
    if (ch === '\u201c') { inStr = true; strClose = '\u201d'; out += ch; continue }
    if (ch === '#') {
      const m = COLOR_TOKEN.exec(expr.slice(i))
      if (m && !currentKnownConstantNames.has(m[1])) {
        const cr = parseColorLiteralToColorref(m[0])
        if (cr !== null) {
          out += String(cr >>> 0)
          i += m[0].length - 1
          continue
        }
      }
      out += ch
      continue
    }
    out += ch
  }
  return out
}

// ===== \u6570\u7ec4\u53d8\u91cf\u652f\u6301 =====
// \u8fd0\u884c\u65f6\u6570\u7ec4\u7edf\u4e00\u4e3a std::vector<long long>\uff08krnln impl \u7684\u65e2\u5b9a ABI\uff0c\u6307\u9488\u7ecf void* \u4f20\u9012\uff09\u3002
// \u8f6c\u8bd1\u671f\u8ddf\u8e2a\u5f53\u524d\u53ef\u89c1\u7684\u6570\u7ec4\u53d8\u91cf\u540d\uff1a\u4e0b\u6807\u5f15\u7528\u6539\u5199\u4e3a yc_ary_at(\u540d\u79f0, \u4e00\u57fa\u4e0b\u6807)\uff08\u8fd4\u56de\u5f15\u7528\uff0c
// \u53ef\u4f5c\u5de6\u503c\uff09\uff0c\u6570\u7ec4\u547d\u4ee4\u5b9e\u53c2\u6539\u4f20 (void*)&\u540d\u79f0\u3002\u8868\u8fbe\u5f0f\u6811\u6309\u62ec\u53f7\u611f\u77e5\u5207\u5206\uff0cyc_ary_at(...) \u7684
// \u62ec\u53f7\u5f62\u5f0f\u5929\u7136\u517c\u5bb9\uff1b\u65b9\u62ec\u53f7\u539f\u6837\u7559\u7ed9 C++ \u4f1a\u56e0\u53d8\u91cf\u58f0\u660e\u4e0d\u662f\u539f\u751f\u6570\u7ec4\u800c\u7f16\u8bd1\u5931\u8d25\u3002
const ARRAY_ELEM_INTEGER_TYPES = new Set(['\u5b57\u8282\u578b', '\u77ed\u6574\u6570\u578b', '\u6574\u6570\u578b', '\u957f\u6574\u6570\u578b', '\u903b\u8f91\u578b'])
// \u6d6e\u70b9\u65cf\u5143\u7d20\u540c\u6837\u5b58\u8fdb vector<long long>\uff1a\u6309 double \u4f4d\u6a21\u5f0f\uff08yc_f64_bits/yc_f64_from_bits\uff09\u8bfb\u5199
const ARRAY_ELEM_FLOAT_TYPES = new Set(['\u5c0f\u6570\u578b', '\u53cc\u7cbe\u5ea6\u5c0f\u6570\u578b'])

interface TranspileArrayInfo {
  elemType: string
  /** \u5404\u7ef4\u5c3a\u5bf8\uff1b\u7a7a\u6570\u7ec4=\u52a8\u6001\u4e00\u7ef4\uff08"0"\uff09\uff0c\u591a\u7ef4\u4e3a\u5b9a\u957f\uff08\u5982 "100,100" \u2192 [100, 100]\uff09\uff0c\u884c\u4e3b\u5e8f\u6241\u5e73\u5b58\u50a8 */
  dims: number[]
}
let currentTranspileArrayVars = new Map<string, TranspileArrayInfo>()
let fileScopeArrayVars = new Map<string, TranspileArrayInfo>()

// 项目全体控件名→控件类型（跨所有窗口，转译开始前灌一次）。控件成员访问按类型键控派发的依据：
// 只有确属控件的 `名.成员` 才译成运行时读写，避免与自定义类型成员（如 rect.位置）撞名。
let currentProjectControls = new Map<string, string>()
function resolveProjectControlType(name: string): string {
  return currentProjectControls.get(name) || ''
}

function isFloatArrayElem(info: TranspileArrayInfo | undefined): boolean {
  return !!info && ARRAY_ELEM_FLOAT_TYPES.has(info.elemType)
}

function isTextArrayElem(info: TranspileArrayInfo | undefined): boolean {
  return !!info && info.elemType === '文本型'
}

// 字节集（YC_BIN=std::vector<unsigned char>）是值类型、装不进 long long，与文本型同策：
// 元素存「堆上 YC_BIN 的指针位模式」，读回是 (*(YC_BIN*)(intptr_t)元素)。
// 注意别和 ARRAY_ELEM_INTEGER_TYPES 里的「字节型」（0-255 的数）混了——那是数、这是二进制块。
function isBinArrayElem(info: TranspileArrayInfo | undefined): boolean {
  return !!info && info.elemType === '字节集'
}

/** 数组元素存储类别：int=直存、f64=double 位模式、text=堆拷贝文本指针、bin=堆拷贝字节集指针 */
type ArrayElemKind = 'int' | 'f64' | 'text' | 'bin'

function arrayElemKindOf(info: TranspileArrayInfo | undefined): ArrayElemKind {
  if (isTextArrayElem(info)) return 'text'
  if (isBinArrayElem(info)) return 'bin'
  if (isFloatArrayElem(info)) return 'f64'
  return 'int'
}

/** 数组元素类型是否受支持（整数族直存 / 小数族位模式 / 文本型·字节集存堆指针位模式） */
function isSupportedArrayElemType(elemType: string): boolean {
  return ARRAY_ELEM_INTEGER_TYPES.has(elemType) || ARRAY_ELEM_FLOAT_TYPES.has(elemType)
    || elemType === '文本型' || elemType === '字节集'
}
const SUPPORTED_ARRAY_ELEM_HINT = '当前支持整数族/小数族/文本型/字节集元素'

/** \u58f0\u660e parts \u4e2d\u7684\u6570\u7ec4\u5c3a\u5bf8\u5b57\u6bb5\uff08\u53ef\u7a7a\u3001\u53ef\u5e26\u5f15\u53f7\uff1b"0"=\u52a8\u6001\u4e00\u7ef4\uff0c"100,100"=\u4e8c\u7ef4\u5b9a\u957f\uff09 */
function parseArrayDimsField(field: string | undefined): { isArray: boolean; dims: number[]; invalid?: string } {
  const raw = unquoteDeclValue(field || '').trim()
  if (!raw) return { isArray: false, dims: [] }
  const parts = raw.split(/[,\uff0c]/).map(s => s.trim())
  if (parts.length === 1) {
    const n = Number.parseInt(parts[0], 10)
    return { isArray: true, dims: Number.isFinite(n) && n > 0 ? [n] : [] }
  }
  const dims = parts.map(p => Number.parseInt(p, 10))
  if (dims.some(n => !Number.isFinite(n) || n <= 0)) {
    return { isArray: true, dims: [], invalid: `\u591a\u7ef4\u6570\u7ec4\u5404\u7ef4\u5c3a\u5bf8\u5fc5\u987b\u4e3a\u6b63\u6574\u6570\uff08\u6536\u5230 "${raw}"\uff09` }
  }
  return { isArray: true, dims }
}

/** \u591a\u7ef4\u4e0b\u6807\u6298\u7b97\u4e3a\u4e00\u57fa\u7ebf\u6027\u4e0b\u6807\u8868\u8fbe\u5f0f\uff1a((e1)-1)*d2*\u2026*dk + ((e2)-1)*d3*\u2026*dk + \u2026 + (ek) */
function buildAryLinearIndexExpr(indexExprsC: string[], dims: number[]): string {
  if (indexExprsC.length <= 1) return indexExprsC[0] || '1'
  const terms: string[] = []
  for (let i = 0; i < indexExprsC.length; i++) {
    let stride = 1
    for (let d = i + 1; d < dims.length; d++) stride *= dims[d] || 1
    terms.push(i === indexExprsC.length - 1
      ? `(${indexExprsC[i]})`
      : `((${indexExprsC[i]}) - 1) * ${stride}`)
  }
  return terms.join(' + ')
}

/** \u4ece pos \u8d77\u5339\u914d\u4e00\u4e2a\u914d\u5e73\u7684 [ ... ] \u7ec4\uff08\u5f15\u53f7\u611f\u77e5\uff09\uff0c\u8fd4\u56de\u7ed3\u675f\u4f4d\u7f6e\u4e0e\u5185\u5bb9\uff1bpos \u5fc5\u987b\u6307\u5411 '[' */
function matchBracketGroup(expr: string, pos: number): { inner: string; end: number } | null {
  let depth = 0
  let q = false
  let qc = ''
  for (let m = pos; m < expr.length; m++) {
    const c = expr[m]
    if (q) { if (c === qc) q = false; continue }
    if (c === '"') { q = true; qc = '"'; continue }
    if (c === '\u201c') { q = true; qc = '\u201d'; continue }
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return { inner: expr.slice(pos + 1, m), end: m }
    }
  }
  return null
}

function rewriteArrayIndexOnce(
  expr: string,
  commandMap?: Map<string, ResolvedCommand>,
  directCallables?: DirectCallableNames,
  variableTypeResolver?: VariableTypeResolver,
): string {
  let inQuote = false
  let quoteClose = ''
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (inQuote) {
      if (ch === quoteClose) inQuote = false
      continue
    }
    if (ch === '"') { inQuote = true; quoteClose = '"'; continue }
    if (ch === '\u201c') { inQuote = true; quoteClose = '\u201d'; continue }
    if (!/[\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_]/.test(ch)) continue

    let j = i
    while (j < expr.length && /[\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_]/.test(expr[j])) j++
    const name = expr.slice(i, j)
    const info = currentTranspileArrayVars.get(name)
    let k = j
    while (k < expr.length && /\s/.test(expr[k])) k++
    if (expr[k] !== '[' || !info) {
      i = j - 1
      continue
    }
    // \u6536\u96c6\u8fde\u7eed\u7684\u4e0b\u6807\u62ec\u53f7\u7ec4\uff08\u591a\u7ef4\u94fe\u5f0f\uff1a\u77e9\u9635A [i] [j]\uff09
    const groups: string[] = []
    let cursor = k
    let lastEnd = -1
    while (cursor < expr.length && expr[cursor] === '[') {
      const g = matchBracketGroup(expr, cursor)
      if (!g) break
      groups.push(g.inner)
      lastEnd = g.end
      let next = g.end + 1
      while (next < expr.length && /\s/.test(expr[next])) next++
      cursor = next
    }
    if (groups.length === 0 || lastEnd < 0) { i = j - 1; continue }
    const expectDims = Math.max(1, info.dims.length)
    if (groups.length !== expectDims) {
      throw new Error(`\u6570\u7ec4\u201c${name}\u201d\u662f ${expectDims} \u7ef4\uff0c\u4f46\u4e0b\u6807\u7ed9\u4e86 ${groups.length} \u7ec4\uff1a${expr.trim()}`)
    }
    // \u6d88\u8d39\u5230\u6700\u540e\u4e00\u4e2a\u4f7f\u7528\u7684\u62ec\u53f7\u7ec4\u672b\u5c3e\uff08\u591a\u4f59\u7684\u76f8\u90bb\u7ec4\u4e0d\u541e\u2014\u2014\u4e0a\u9762\u5df2\u6821\u9a8c\u7ec4\u6570\u4e00\u81f4\uff09
    const consumedEnd = lastEnd
    const idxParts = groups.map(g => translateExpressionToC(g, commandMap, directCallables, variableTypeResolver))
    const linear = buildAryLinearIndexExpr(idxParts, info.dims)
    const ref = `yc_ary_at(${name}, ${linear})`
    const kind = arrayElemKindOf(info)
    const wrapped = kind === 'f64' ? `yc_f64_from_bits(${ref})`
      : kind === 'text' ? `((wchar_t*)(intptr_t)${ref})`
      : kind === 'bin' ? `(*(YC_BIN*)(intptr_t)${ref})`
      : ref
    return `${expr.slice(0, i)}${wrapped}${expr.slice(consumedEnd + 1)}`
  }
  return expr
}

/** 表达式是否恰为一个数组字面量 { e1, e2, … }（配平判定，引号感知） */
function matchArrayLiteral(expr: string): { inner: string } | null {
  const t = (expr || '').trim()
  if (!t.startsWith('{') && !t.startsWith('｛')) return null
  let depth = 0
  let q = false
  let qc = ''
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) { if (c === qc) q = false; continue }
    if (c === '"') { q = true; qc = '"'; continue }
    if (c === '“') { q = true; qc = '”'; continue }
    if (c === '{' || c === '｛') depth++
    else if (c === '}' || c === '｝') {
      depth--
      if (depth === 0) return i === t.length - 1 ? { inner: t.slice(1, i) } : null
    }
  }
  return null
}

/**
 * 数组字面量 → 构造临时 vector<long long> 的表达式。
 * forceFloat 指定按浮点元素存位模式（赋给浮点族数组时），缺省按“任一元素含小数点”推断。
 */
function buildArrayLiteralExpr(
  inner: string,
  commandMap?: Map<string, ResolvedCommand>,
  directCallables?: DirectCallableNames,
  variableTypeResolver?: VariableTypeResolver,
  forceKind?: ArrayElemKind,
): string {
  const elems = splitArguments(inner).filter(e => e.trim().length > 0)
  const kind: ArrayElemKind = forceKind
    ?? (elems.some(e => /^["“]/.test(e.trim())) ? 'text'
      : elems.some(e => /[.．]/.test(e)) ? 'f64'
      : 'int')
  const parts = elems.map(e => translateExpressionToC(e, commandMap, directCallables, variableTypeResolver))
  if (kind === 'text') {
    return `yc_ary_lit_text({${parts.map(p => `(const wchar_t*)(${p})`).join(', ')}})`
  }
  // 字节集元素无从按字面推断（forceKind 来自「赋给字节集数组」），故只有 forceKind='bin' 才走这支
  if (kind === 'bin') {
    return `yc_ary_lit_bin({${parts.map(p => `YC_BIN(${p})`).join(', ')}})`
  }
  if (kind === 'f64') {
    return `yc_ary_lit_f64({${parts.map(p => `(double)(${p})`).join(', ')}})`
  }
  return `yc_ary_lit({${parts.map(p => `(long long)(${p})`).join(', ')}})`
}

/** 解析下标赋值语句左值：`名称 [e1] [e2]… ＝ 右值`；非该形态返回 null（是否数组由调用方查表判定） */
function parseIndexedAssignTarget(line: string): { name: string; indexExprs: string[]; rhs: string } | null {
  const head = line.match(/^\s*([一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*)\s*(?=\[)/)
  if (!head) return null
  const name = head[1]
  let cursor = head[0].length
  const groups: string[] = []
  while (cursor < line.length && line[cursor] === '[') {
    const g = matchBracketGroup(line, cursor)
    if (!g) return null
    groups.push(g.inner)
    let next = g.end + 1
    while (next < line.length && /\s/.test(line[next])) next++
    cursor = next
  }
  if (groups.length === 0) return null
  if (line[cursor] !== '＝' && line[cursor] !== '=') return null
  const rhs = line.slice(cursor + 1).trim()
  if (!rhs) return null
  return { name, indexExprs: groups, rhs }
}

/** \u628a\u8868\u8fbe\u5f0f\u4e2d\u6570\u7ec4\u53d8\u91cf\u7684\u4e0b\u6807\u5f15\u7528\uff08\u4e00\u57fa\uff09\u6539\u5199\u4e3a yc_ary_at(\u540d\u79f0, \u4e0b\u6807) \u5f15\u7528\u5f62\u5f0f */
function rewriteArrayIndexRefs(
  expr: string,
  commandMap?: Map<string, ResolvedCommand>,
  directCallables?: DirectCallableNames,
  variableTypeResolver?: VariableTypeResolver,
): string {
  if (currentTranspileArrayVars.size === 0) return expr
  let cur = expr
  for (let guard = 0; guard < 16; guard++) {
    const next = rewriteArrayIndexOnce(cur, commandMap, directCallables, variableTypeResolver)
    if (next === cur) break
    cur = next
  }
  return cur
}

function replaceBooleanLiterals(expr: string): string {
  return expr
    .replace(/(^|[^\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_])真(?=$|[^\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_])/g, '$11')
    .replace(/(^|[^\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_])假(?=$|[^\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_])/g, '$10')
}

function replaceLogicalOperatorAliases(expr: string): string {
  return expr
    .replace(/(^|[^\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_])且(?=$|[^\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_])/g, '$1&&')
    .replace(/(^|[^\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_])或(?=$|[^\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_])/g, '$1||')
    .replace(/\bAnd\b/gi, '&&')
    .replace(/\bOr\b/gi, '||')
}

// 控件属性【读取】：`控件名.属性` → 声明式 get 模板（按控件类型键控派发）。
// 触发条件：①ctrlName 确在 currentProjectControls（是控件，非自定义类型变量）；②该控件类型在协议里为此属性声明了 get 绑定。
// 否则原样保留。方法调用（成员名后接 '(' 或全角 '（'）用负向前瞻排除（方法本就无 get 绑定，双重保险）。
function replaceControlPropertyReads(expr: string, variableTypeResolver?: (name: string) => string | undefined): string {
  if (currentProjectControls.size === 0) return expr
  const bindings = loadCompileProtocols().controlMembers
  return expr.replace(
    /([一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*)\.([一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*)(?!\s*[(（])(?![一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_])/g,
    (whole, ctrlName: string, member: string) => {
      const type = resolveProjectControlType(ctrlName)
      if (!type) return whole
      // 同名变量遮蔽控件名（如自定义类型变量恰与控件同名）→ 按变量成员处理，原样保留
      if (variableTypeResolver?.(ctrlName)) return whole
      const getTpl = resolveControlMemberTemplate(bindings, type, member, 'get')
      // 确属控件而属性无 get 绑定 → 友好报错并中止（原样保留会变成难懂的 undeclared identifier）；
      // 行号前缀由 transpileEycContent 主循环的 catch 统一补上。
      if (!getTpl) throw new Error(`${type}“${ctrlName}”的属性“${member}”暂不支持在代码中读取`)
      return applyMemberTemplate(getTpl, `yc_get_control_handle_by_name(L"${escapeCString(ctrlName)}")`, '', [], `L"${escapeCString(ctrlName)}"`)
    },
  )
}
// 组合框/列表框/选择列表框 项目成员方法名（这些名字对控件是专属的，用作 名.方法(参数) 的运行时派发判据）。
const LISTLIKE_METHOD_NAMES = new Set([
  '跳转',  // 超级链接框：按类型 ShellExecute 打开邮件/网址
  '是否被选中', '选中项目', '是否被允许', '允许',  // 选择列表框：勾选/允许状态
  '取子夹数目', '取子夹名称', '置子夹名称',  // 选择夹
  // 画板绘图方法（名称与上面各控件不重叠，故共用派发不冲突）
  '取设备句柄', '清除', '取点', '画点', '画直线', '画椭圆', '画弧线', '画弦', '画饼',
  '画矩形', '画渐变矩形', '填充矩形', '画圆角矩形', '翻转矩形区', '画多边形',
  '置写出位置', '写文本行', '滚动写行', '写出', '定位写出', '取宽度', '取高度',
  '画图片', '取图片宽度', '取图片高度', '复制', '取图片', '单位转换',
])

// 把 组合框1.加入项目("x", 5) 之类的控件项目成员方法调用译成 yc_ll_*/yc_lb_* 运行时助手调用。
// tx = 递归翻译参数表达式的回调。返回 null 表示不是此类调用（交回主流程）。
function translateListLikeMethodCall(
  call: { name: string; args: string[] },
  tx: (expr: string) => string,
): string | null {
  const dot = call.name.lastIndexOf('.')
  if (dot <= 0) return null
  const objName = call.name.slice(0, dot)
  const method = call.name.slice(dot + 1)
  if (!LISTLIKE_METHOD_NAMES.has(method)) return null
  if (!/^[一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*$/.test(objName)) return null
  const args = call.args || []
  const nm = `L"${escapeCString(objName)}"`
  const A = (i: number): string => tx(args[i] ?? '0')
  switch (method) {
    // 组合框/列表框 项目方法已全部走声明式协议（controlMethodBindings→krnln_ll_*/krnln_lb_*），旧路不再兜底。
    case '跳转': return `yc_hyperlink_jump(${nm})`
    case '是否被选中': return `yc_chk_is_checked(${nm}, ${A(0)})`
    case '选中项目': return `yc_chk_set_checked(${nm}, ${A(0)}, ${args.length > 1 ? A(1) : '1'})`
    case '是否被允许': return `yc_chk_is_enabled(${nm}, ${A(0)})`
    case '允许': return `yc_chk_enable(${nm}, ${A(0)}, ${args.length > 1 ? A(1) : '1'})`
    case '取子夹数目': return `yc_tab_count(${nm})`
    case '取子夹名称': return `yc_tab_get_name(${nm}, ${A(0)})`
    case '置子夹名称': return `yc_tab_set_name(${nm}, ${A(0)}, ${A(1)})`
    // ===== 画板绘图方法（省略参数用 (-2147483647-1)=INT_MIN 哨兵；通用型文本参数经 yc_value_to_text 转文本）=====
    case '取设备句柄': return `yc_dp_gethdc(${nm})`
    case '清除': return `yc_dp_cls(${nm}, ${args.length > 0 ? A(0) : '0'}, ${args.length > 1 ? A(1) : '0'}, ${args.length > 2 ? A(2) : '0'}, ${args.length > 3 ? A(3) : '0'})`
    case '取点': return `yc_dp_getpixel(${nm}, ${A(0)}, ${A(1)})`
    case '画点': return `yc_dp_setpixel(${nm}, ${A(0)}, ${A(1)}, ${A(2)})`
    case '画直线': return `yc_dp_line(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)})`
    case '画椭圆': return `yc_dp_ellipse(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)})`
    case '画弧线': return `yc_dp_arc(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)}, ${A(4)}, ${A(5)}, ${A(6)}, ${A(7)})`
    case '画弦': return `yc_dp_chord(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)}, ${A(4)}, ${A(5)}, ${A(6)}, ${A(7)})`
    case '画饼': return `yc_dp_pie(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)}, ${A(4)}, ${A(5)}, ${A(6)}, ${A(7)})`
    case '画矩形': return `yc_dp_rect(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)})`
    case '画渐变矩形': return args.length >= 7
      ? `yc_dp_gradrect(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)}, ${A(4)}, ${A(5)}, ${A(6)})`
      : `yc_dp_gradrect(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)}, 2, ${A(4)}, ${A(5)})`
    case '填充矩形': return `yc_dp_fillrect(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)})`
    case '画圆角矩形': return `yc_dp_roundrect(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)}, ${A(4)}, ${args.length > 5 ? A(5) : '(-2147483647-1)'})`
    case '翻转矩形区': return `yc_dp_invert(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${A(3)})`
    case '画多边形': return `yc_dp_polygon(${nm}, ${A(0)}, ${args.length > 1 ? A(1) : '0'})`
    case '置写出位置': return `yc_dp_setwritepos(${nm}, ${args.length > 0 ? A(0) : '(-2147483647-1)'}, ${args.length > 1 ? A(1) : '(-2147483647-1)'})`
    case '写文本行': return `yc_dp_print(${nm}, ${args.length > 0 ? `yc_value_to_text(${A(0)})` : 'L""'})`
    case '滚动写行': return `yc_dp_sprint(${nm}, ${args.length > 0 ? `yc_value_to_text(${A(0)})` : 'L""'})`
    case '写出': return `yc_dp_writeout(${nm}, ${args.length > 0 ? `yc_value_to_text(${A(0)})` : 'L""'})`
    case '定位写出': return `yc_dp_say(${nm}, ${args.length > 0 ? A(0) : '(-2147483647-1)'}, ${args.length > 1 ? A(1) : '(-2147483647-1)'}, ${args.length > 2 ? `yc_value_to_text(${A(2)})` : 'L""'})`
    case '取宽度': return `yc_dp_getwidth(${nm}, yc_value_to_text(${A(0)}))`
    case '取高度': return `yc_dp_getheight(${nm}, yc_value_to_text(${A(0)}))`
    case '画图片': return `yc_dp_drawpic(${nm}, ${A(0)}, ${A(1)}, ${A(2)}, ${args.length > 3 ? A(3) : '0'}, ${args.length > 4 ? A(4) : '0'}, ${args.length > 5 ? A(5) : '0'})`
    case '取图片宽度': return `yc_dp_getpicwidth(${nm}, ${A(0)})`
    case '取图片高度': return `yc_dp_getpicheight(${nm}, ${A(0)})`
    case '复制': return `yc_dp_copy(${nm})`
    case '取图片': return `yc_dp_getpic(${nm}, ${args.length > 0 ? A(0) : '0'}, ${args.length > 1 ? A(1) : '0'})`
    case '单位转换': return `yc_dp_unitcnv(${nm}, ${A(0)}, ${A(1)})`
    default: return null
  }
}

function isTextExpression(expr: string): boolean {
  const trimmed = expr.trim()
  return /^L"(?:[^"\\]|\\.)*"$/.test(trimmed)
    || /^yc_ctrl_get_text\(/.test(trimmed)
    || /^yc_ctrl_get_tag\(/.test(trimmed)
    || /^yc_ctrl_get_date\(/.test(trimmed)
    || /^yc_ctrl_get_seltext\(/.test(trimmed)
    || /^yc_text_concat\(/.test(trimmed)
    || /^yc_utf8_to_wide\(/.test(trimmed)
    || /^\(\[\&\]\(\)\s*->\s*wchar_t\*/.test(trimmed)
    || /^yc_fs_get_current_dir\(/.test(trimmed)
    || /^yc_fs_get_disk_label\(/.test(trimmed)
    || /^yc_fs_get_temp_file_name\(/.test(trimmed)
    || /^yc_fs_dir\(/.test(trimmed)
    || /^yc_ll_get_text\(/.test(trimmed)
    || /^yc_tab_get_name\(/.test(trimmed)
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
  const identMatch = trimmed.match(/^[\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]*$/)
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

// 顶层逻辑运算符（&&/||）切分：优先级低于比较运算，必须先于 findTopLevelComparison 切，
// 否则 `i ＜ j 且 x ≥ p` 会被切成 `i < (j && x >= p)`（i≥1 时恒假 → 循环体不执行 → 死循环）。
// 先找 ||（优先级最低），再找 &&；同级取最右切分点（左结合，左半递归续切）。
function findTopLevelLogical(expr: string): { left: string; operator: '&&' | '||'; right: string } | null {
  for (const op of ['||', '&&'] as const) {
    let depth = 0
    let inString = false
    let stringChar = ''
    let found = -1
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i]
      if (inString) {
        if ((stringChar === '"' && ch === '"') || (stringChar === '“' && ch === '”')) inString = false
        continue
      }
      if (ch === '"' || ch === '“') {
        inString = true
        stringChar = ch
        continue
      }
      if (ch === '(' || ch === '（') { depth++; continue }
      if (ch === ')' || ch === '）') { depth = Math.max(0, depth - 1); continue }
      if (depth !== 0) continue
      if (expr.slice(i, i + 2) === op) {
        found = i
        i++
      }
    }
    if (found > 0) {
      const left = expr.slice(0, found).trim()
      const right = expr.slice(found + 2).trim()
      if (left && right) return { left, operator: op, right }
    }
  }
  return null
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
    // 前一个非空白是运算符 → 这个 -/+ 是一元符号不是二元运算，不在此处切分。
    // ÷ 的哨兵也算运算符：漏了它 `a ÷ －b` 会被切成 `(a ÷) - b`，左半成了半截表达式。
    if (!prev || prev === REAL_DIV_MARK || /[+\-*/%(<>=!&|,]/.test(prev)) continue

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
    // REAL_DIV_MARK = 相除 ÷（恒双精度）；'/' 此时只可能来自整除 ＼（截断）
    if (ch !== '*' && ch !== '/' && ch !== '%' && ch !== REAL_DIV_MARK) continue

    return {
      left: expr.slice(0, i).trim(),
      operator: ch,
      right: expr.slice(i + 1).trim(),
    }
  }

  return null
}

/**
 * 表达式整体是否正好是「一层括号包住的一整块」，是则返回括号内的内容，否则 null。
 *
 * 「首字符是 ( 且尾字符是 )」证明不了这件事——`(a) ＋ (b)` 的首尾括号并不互相配对，
 * 首个 ( 的配对括号必须正好是末字符（同 isSingleParenGroup 的判据，但这里认全角括号与
 * 全角引号，因为吃的是易语言源码而非生成的 C）。判不准一律返回 null（不剥只多余，不出错）。
 */
function matchEnclosingParens(expr: string): string | null {
  const first = expr[0]
  if (first !== '(' && first !== '（') return null
  const last = expr[expr.length - 1]
  if (last !== ')' && last !== '）') return null

  let depth = 0
  let inString = false
  let stringChar = ''
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (inString) {
      if ((stringChar === '"' && ch === '"') || (stringChar === '“' && ch === '”')) inString = false
      continue
    }
    if (ch === '"' || ch === '“') { inString = true; stringChar = ch; continue }
    if (ch === '(' || ch === '（') { depth++; continue }
    if (ch === ')' || ch === '）') {
      depth--
      if (depth === 0) return i === expr.length - 1 ? expr.slice(1, -1) : null
      if (depth < 0) return null
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
  let trimmed = (expr || '').trim()
  if (!trimmed) return '0'
  // \u6570\u7ec4\u5b57\u9762\u91cf { 1, 2, 3 } \u2192 \u6784\u9020\u4e34\u65f6 vector\uff08\u5143\u7d20\u542b\u5c0f\u6570\u70b9\u6309 double \u4f4d\u6a21\u5f0f\u5b58\uff09
  const aryLit = matchArrayLiteral(trimmed)
  if (aryLit) {
    return buildArrayLiteralExpr(aryLit.inner, commandMap, directCallables, variableTypeResolver)
  }
  // \u6570\u7ec4\u4e0b\u6807\u5f15\u7528\u5148\u6539\u5199\u4e3a yc_ary_at(\u540d\u79f0, \u4e0b\u6807) \u5f62\u5f0f\uff08\u62ec\u53f7\u5f62\u5f0f\u4e0e\u540e\u7eed\u6309\u62ec\u53f7\u611f\u77e5\u7684
  // \u8868\u8fbe\u5f0f\u5207\u5206\u517c\u5bb9\uff1b\u65b9\u62ec\u53f7\u5207\u5206\u4e0d\u611f\u77e5\uff0c\u5982 \u6570\u7ec4[j \uff0b 1] \u4f1a\u88ab\u52a0\u6cd5\u5207\u5206\u6495\u88c2\uff09
  trimmed = rewriteArrayIndexRefs(trimmed, commandMap, directCallables, variableTypeResolver)

  // \u6574\u4f53\u88ab\u4e00\u5c42\u62ec\u53f7\u5305\u4f4f \u2192 \u5265\u6389\u9012\u5f52\u7ffb\u8bd1\uff0c\u518d\u539f\u6837\u5305\u56de\u3002
  // \u4e0d\u5265\u7684\u8bdd\u4e0b\u9762\u7684\u62c6\u5206\u5668\u5168\u5728 depth>0 \u4e0a\u7a7a\u8f6c\uff0c\u8fd9\u4e00\u6574\u5757\u4f1a**\u539f\u6837**\u843d\u8fdb C++\uff1a
  // `(\u201c\u7532\u201d \uff0b \u201c\u4e59\u201d)` \u6f0f\u5168\u89d2\u5f15\u53f7\u7f16\u4e0d\u8fc7\u3001`(20 \uff0b 7)` \u7684\u5b57\u9762\u91cf\u62ff\u4e0d\u5230 LL \u540e\u7f00\u3001\u00f7 \u7684\u54e8\u5175\u4e5f\u4f1a\u6f0f\u51fa\u53bb\u3002
  // \u62ec\u53f7\u5fc5\u987b\u5305\u56de\u53bb\u2014\u2014\u8c03\u7528\u65b9\uff08\u5982\u4e58\u9664\u62c6\u5206\u7684\u5de6\u534a\uff09\u9760\u5b83\u7ef4\u6301\u4f18\u5148\u7ea7\uff1a`(a \uff0b b) \u00d7 c` \u5265\u6ca1\u4e86\u5c31\u6210\u4e86 a + b * c\u3002
  const enclosed = matchEnclosingParens(trimmed)
  if (enclosed !== null) {
    const inner = enclosed.trim()
    if (!inner) return '0'
    return `(${translateExpressionToC(inner, commandMap, directCallables, variableTypeResolver, preferBigIntLiteral)})`
  }

  // \u6574\u4f53\u5b57\u9762\u91cf\u5224\u5b9a\u5fc5\u987b\u8981\u6c42\u5185\u90e8\u4e0d\u518d\u51fa\u73b0\u540c\u7c7b\u5f15\u53f7\uff1a
  // \u5426\u5219 \u201c\u5171\u201d \uff0b \u5230\u6587\u672c(n) \uff0b \u201c\u4e2a\u201d \u4f1a\u88ab\u8d2a\u5a6a\u5339\u914d\u6574\u4f53\u541e\u6210\u4e00\u4e2a\u5b57\u9762\u91cf\uff0c
  // \u7f16\u8bd1\u901a\u8fc7\u4f46\u8fd0\u884c\u65f6\u539f\u6837\u8f93\u51fa\u4e2d\u95f4\u7684\u53d8\u91cf\u4e0e\u52a0\u53f7\uff08\u9759\u9ed8\u9519\u8bef\u7a0b\u5e8f\uff09\u3002
  const chineseStrMatch = trimmed.match(/^\u201c([^\u201c\u201d]*)\u201d$/)
  if (chineseStrMatch) {
    const content = chineseStrMatch[1].replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return `L"${content}"`
  }

  const englishStrMatch = trimmed.match(/^"([^"]*)"$/)
  if (englishStrMatch) {
    const content = englishStrMatch[1].replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return `L"${content}"`
  }

  // 颜色字面量（#hex / #名色）→ 十进制 COLORREF，须在 replaceConstantRefs 之前；
  // 整体是单个颜色时下面数字快路接住，复合表达式里的颜色 token 也已就地换成整数。
  trimmed = applyColorLiterals(trimmed)

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

  // rgb()/rgba() 颜色构造 → COLORREF 整数。放在 commandMap 守卫之外（不依赖库），rgba 丢弃 alpha
  // （GDI 文本颜色无 alpha）。参数递归转译，支持变量/表达式；RGB 宏由用户 cpp 前导的 <windows.h> 提供。
  if (/^rgba?\s*[（(]/i.test(trimmed)) {
    const colorCall = parseCommandCall(trimmed)
    const colorBuiltin = colorCall && colorCall.name ? normalizeBuiltinCallName(colorCall.name) : ''
    if (colorCall && (colorBuiltin === 'rgb' || colorBuiltin === 'rgba')) {
      const txArg = (e: string): string => translateExpressionToC(e, commandMap, directCallables, variableTypeResolver)
      const rr = txArg(colorCall.args?.[0] || '0')
      const gg = txArg(colorCall.args?.[1] || '0')
      const bb = txArg(colorCall.args?.[2] || '0')
      return `RGB(${rr}, ${gg}, ${bb})`
    }
  }

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

      // 控件成员方法：先走声明式协议派发（按控件类型），未命中再回退旧硬编码路（画板等）。
      const methodTx = (e: string) => translateExpressionToC(e, commandMap, directCallables, variableTypeResolver, preferBigIntLiteral)
      const declMethod = translateControlMethodCall(call, methodTx)
      if (declMethod) return declMethod
      const llCall = translateListLikeMethodCall(call, methodTx)
      if (llCall) return llCall
      // `控件.方法(…)` 未命中任何绑定（表达式上下文）→ 友好报错；行号前缀由主循环 catch 统一补上。
      // 仅对带括号的真调用报错——无括号的 `控件.属性`（parseCommandCall 会把裸点名当零参调用）放行给下方属性读取替换器；
      // 且方法段必须是纯标识符——`控件.属性 ＋ 函数(x)` 会被 parseCommandCall 整段吞进 call.name，不得误报。
      if (/[(（]/.test(trimmed)) {
        const dotAt = call.name.lastIndexOf('.')
        if (dotAt > 0) {
          const objName = call.name.slice(0, dotAt)
          const method = call.name.slice(dotAt + 1)
          const objType = /^[一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*$/.test(objName) && /^[一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*$/.test(method)
            ? resolveProjectControlType(objName)
            : ''
          if (objType && !variableTypeResolver?.(objName)) {
            throw new Error(`${objType}“${objName}”的方法“${method}”暂不支持在代码中调用`)
          }
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
  translated = replaceControlPropertyReads(translated, variableTypeResolver)

  // 逻辑运算（且/或 已转 &&/||）优先级最低，必须先于比较运算切分
  const logical = findTopLevelLogical(translated)
  if (logical) {
    const left = translateExpressionToC(logical.left, commandMap, directCallables, variableTypeResolver, preferBigIntLiteral)
    const right = translateExpressionToC(logical.right, commandMap, directCallables, variableTypeResolver, preferBigIntLiteral)
    return `(${left} ${logical.operator} ${right})`
  }

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
      // 大数没有小数表示：÷ 与 ＼ 在大数上同为整数商（除零由 YC_BIG 自己报「除数不能为0」）
      const bigOp = multiplicative.operator === REAL_DIV_MARK ? '/' : multiplicative.operator
      return `(yc_value_to_big(${left}) ${bigOp} yc_value_to_big(${right}))`
    }
    // ÷ 相除恒返回双精度小数：两边都转 double，否则 20 ÷ 7 会走 C 的整数截断除法得 2 而非 2.857…
    // （整除 ＼ 走下面的 '/'，截断正是它要的语义）
    if (multiplicative.operator === REAL_DIV_MARK) {
      return `((double)(${left}) / (double)(${right}))`
    }
    return `(${left} ${multiplicative.operator} ${right})`
  }

  // 未定义标识符友好报错：走到这里还是个裸标识符 → 前面所有转换（命令/控件属性/常量/运算符/字面量）
  // 都没认领它。仅在有变量解析器（真实转译上下文）时校验，排除已知变量/数组/命令/子程序/常量/控件/
  // 保留字后仍不认识 → 报中文错（由转译主循环 try/catch 补「文件名:行号:」前缀），替代难懂的 C++
  // undeclared identifier。非中英文（韩/日等）标识符经上方标识符正则放宽后同样能被识别与校验。
  if (
    variableTypeResolver
    && /^[\p{L}_][\p{L}0-9_]*$/u.test(translated)
    && translated !== '真' && translated !== '假' && translated !== '空'
    && !variableTypeResolver(translated)
    && !currentTranspileArrayVars.has(translated)
    && !commandMap?.has(translated)
    && !directCallables?.has(translated)
    && !currentKnownConstantNames.has(translated)
    && !currentProjectControls.has(translated)
  ) {
    throw new Error(`未定义的变量或标识符“${translated}”（若这是一段文本，请用引号括起来，例如 "${translated}"）`)
  }

  // 兜底：走到这里还带着 ÷ 哨兵，说明它没被上面的乘除分支接住（如藏在未识别命令的实参里）。
  // 哨兵不是合法 C，必须就地落地成 /(double) —— 语义仍对，只是没经过类型分诊。
  return inlineRealDiv(translated)
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
    // \u82b1\u62ec\u53f7\u4e5f\u8ba1\u6df1\u5ea6\uff1a\u6570\u7ec4\u5b57\u9762\u91cf { 1, 2, 3 } \u5185\u7684\u9017\u53f7\u4e0d\u662f\u53c2\u6570\u5206\u9694\u7b26
    if (ch === '(' || ch === '\uff08' || ch === '{' || ch === '\uff5b') { depth++; current += ch; continue }
    if (ch === ')' || ch === '\uff09' || ch === '}' || ch === '\uff5d') { depth--; current += ch; continue }

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
    return {
      cType: 'const char*',
      expr: (arg, commandMap, directCallables) => {
        const t = (arg || '').trim()
        if (!t) return '(const char*)""'
        // 数组（变量/字面量/返回数组的命令）按元素存储类别选打印：f64/文本/字节集都是位模式，需专用还原
        const kind = arrayValueElemKind(t, commandMap)
        const toText = kind === 'f64' ? 'yc_ary_to_text_f64'
          : kind === 'text' ? 'yc_ary_to_text_str'
          : kind === 'bin' ? 'yc_ary_to_text_bin'
          : 'yc_value_to_text'
        return `yc_wide_to_utf8(${toText}(${formatArgForC(t, commandMap, directCallables)}))`
      },
    }
  }
  const cType = mapTypeToCType(typeName || '')
  if (cType === 'YC_TEXT') {
    return { cType: 'const char*', expr: (arg, commandMap, directCallables) => (arg ? `yc_wide_to_utf8(${formatArgForC(arg, commandMap, directCallables)})` : '(const char*)""') }
  }
  // 【字节集 ABI v2】按 const YC_BIN*（= const std::vector<unsigned char>*）传，不再是 const char*。
  // 旧法 yc_bin_to_cstr 返回 out.c_str()、长度靠 NUL 结尾 → 含 0x00 的字节集整条截断，
  // 而字节集本就是任意二进制。改用指针传递（复用数组那套既有的跨 TU vector 指针契约），长度完整。
  // 临时量取不了址 → 先落 yc_bin_tmp 轮转槽；实参省略 → nullptr（impl 据此取默认值）。
  if (cType === 'YC_BIN') {
    return {
      cType: 'const void*',
      expr: (arg, commandMap, directCallables) => (arg
        ? `(const void*)&yc_bin_tmp(${formatArgForC(arg, commandMap, directCallables)})`
        : '(const void*)nullptr'),
    }
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
  // 【数组返回 ABI】impl 在堆上 new std::vector<long long> 填好后以 void* 交回，yc_ary_take 接管所有权
  // （移走内容并 delete）。跨 TU 传 std::vector<long long>* 的契约与 YCMD_ARRAY_PARAM_KINDS 的
  // (void*)&数组变量 是同一个，不引入新假设。返回值的 C++ 侧类型由 mapTypeToCType 给成 vector<long long>。
  if (YCMD_ARRAY_RETURN_TYPES[trimmed]) {
    return { cType: 'void*', expr: callExpr => `yc_ary_take(${callExpr})`, isVoid: false }
  }
  const cType = mapTypeToCType(trimmed)
  if (cType === 'YC_TEXT') {
    return { cType: 'const char*', expr: callExpr => `yc_utf8_to_wide(${callExpr})`, isVoid: false }
  }
  // 【字节集 ABI v2】impl 在堆上 new YC_BIN 交回 void*，yc_bin_take 接管（移走内容并 delete）。
  // 与数组返回的 yc_ary_take 同款；旧法 yc_cstr_to_bin 按 strlen 还原，遇 0x00 即截断。
  if (cType === 'YC_BIN') {
    return { cType: 'void*', expr: callExpr => `yc_bin_take(${callExpr})`, isVoid: false }
  }
  if (cType === 'YC_BIG') {
    return { cType: 'long long', expr: callExpr => `YC_BIG(std::to_wstring((long long)(${callExpr})).c_str())`, isVoid: false }
  }
  return { cType, expr: callExpr => callExpr, isVoid: false }
}

// 数组类命令的原生 ABI（krnln impl：数组经 void* 传 std::vector<long long>*，值为 long long）。
// 这些命令的参数在清单里是「通用型」，通用映射会把实参转成文本指针，与 impl 形参错位——按符号显式给定。
const YCMD_ARRAY_PARAM_KINDS: Record<string, Array<'arrayptr' | 'binref' | 'int' | 'int64'>> = {
  // 置字节集内整数：要**就地改写**待处理的字节集（帮助：〈无返回值〉）。通用字节集编组交的是
  // yc_bin_tmp 轮转槽里的临时副本，写进去就丢——必须绑到用户变量本身，故按符号特办成 binref。
  krnln_SetIntInsideBin: ['binref', 'int', 'int', 'int'],
  krnln_AddElement: ['arrayptr', 'int64'],
  krnln_InsElement: ['arrayptr', 'int', 'int64'],
  krnln_RemoveElement: ['arrayptr', 'int', 'int'],
  krnln_RemoveAll: ['arrayptr'],
  krnln_GetAryElementCount: ['arrayptr'],
  krnln_UBound: ['arrayptr', 'int'],
  krnln_ReDim: ['arrayptr', 'int', 'int'],
  krnln_CopyAry: ['arrayptr', 'arrayptr'],
  krnln_SortAry: ['arrayptr', 'int'],
}

/**
 * 表达式的数组元素存储类别：数组变量 / 数组字面量 / 返回数组的原生命令（如 分割文本(…)）。
 * 不是数组值则返回 null。数组的元素存储类别只有转译期知道（f64/text 都是位模式），
 * 打印/编组前必须据此选还原函数，否则文本数组会被按指针整数印出来。
 */
function arrayValueElemKind(expr: string, commandMap?: Map<string, ResolvedCommand>): ArrayElemKind | null {
  const t = (expr || '').trim()
  if (!t) return null
  const info = currentTranspileArrayVars.get(t)
  if (info) return arrayElemKindOf(info)
  const lit = matchArrayLiteral(t)
  if (lit) {
    const elems = splitArguments(lit.inner)
    if (elems.some(e => /^["“]/.test(e.trim()))) return 'text'
    if (elems.some(e => /[.．]/.test(e))) return 'f64'
    return 'int'
  }
  const call = commandMap ? parseCommandCall(t) : null
  const resolved = call ? commandMap?.get(call.name) : undefined
  if (resolved && isYcmdNativeCommand(resolved)) return YCMD_ARRAY_RETURN_TYPES[(resolved.returnType || '').trim()] || null
  return null
}

/**
 * 试把表达式当「数组值」译出：目前只认「返回数组的原生命令」（如 分割文本(…)）。
 * 不是数组值则返回 null，由调用处照旧友好报错——绝不能兜底乱译，否则 (void*)& 一个非数组
 * 会把任意值当 vector* 解引用。
 */
function tryTranslateArrayValueExpr(expr: string, commandMap?: Map<string, ResolvedCommand>, directCallables?: DirectCallableNames): string | null {
  const t = (expr || '').trim()
  if (!t || !commandMap) return null
  const call = parseCommandCall(t)
  const resolved = call ? commandMap.get(call.name) : undefined
  if (!call || !resolved || !isYcmdNativeCommand(resolved)) return null
  if (!YCMD_ARRAY_RETURN_TYPES[(resolved.returnType || '').trim()]) return null
  return generateYcmdNativeCommandExpr(resolved, call.args || [], commandMap, directCallables)
}

function mapYcmdArrayParamKind(kind: 'arrayptr' | 'binref' | 'int' | 'int64', cmdName: string): ReturnType<typeof mapYcmdNativeParamType> {
  // 「参考」形态的字节集实参：命令要就地改写它，故必须绑到用户变量本身——通用字节集编组交的是
  // yc_bin_tmp 轮转槽里的临时副本，写进去就丢。yc_bin_ref 借重载解析当类型闸：
  // 实参不是 YC_BIN 左值就编译失败，而不是 (void*)& 出一个错类型指针后在运行时踩内存。
  if (kind === 'binref') {
    return {
      cType: 'void*',
      expr: (arg) => {
        const t = (arg || '').trim()
        if (!/^[^\s(),]+$/.test(t)) {
          throw new Error(`命令“${cmdName}”需要字节集变量作为参数（它会就地改写该变量），但收到：${t || '(空)'}`)
        }
        return `(void*)&yc_bin_ref(${t})`
      },
    }
  }
  if (kind === 'arrayptr') {
    return {
      cType: 'void*',
      expr: (arg, commandMap, directCallables) => {
        const t = (arg || '').trim()
        if (t && currentTranspileArrayVars.has(t)) return `(void*)&${t}`
        // 数组命令收 (void*)&数组变量，但帮助文件里数组返回的规范用法正是
        // 「复制数组(目标数组, 分割文本(…))」——右边是临时量、取不了址，先落进轮转槽再取址。
        const arrayValue = tryTranslateArrayValueExpr(t, commandMap, directCallables)
        if (arrayValue) return `(void*)&yc_ary_tmp(${arrayValue})`
        throw new Error(`命令“${cmdName}”需要数组变量作为参数，但收到：${t || '(空)'}`)
      },
    }
  }
  const cType = kind === 'int64' ? 'long long' : 'int'
  return {
    cType,
    expr: (arg, commandMap, directCallables) => `(${cType})(${arg ? formatArgForC(arg, commandMap, directCallables) : '0'})`,
  }
}

/** int64 元素值参的存储形态变体：f64=double 位模式、text/bin=堆拷贝后存指针（加入成员/插入成员） */
function mapYcmdArrayElemValueParam(kind: ArrayElemKind): ReturnType<typeof mapYcmdNativeParamType> {
  return {
    cType: 'long long',
    expr: (arg, commandMap, directCallables) => {
      const src = arg ? formatArgForC(arg, commandMap, directCallables) : "0"
      if (kind === 'f64') return `yc_f64_bits((double)(${src}))`
      // 【此前编不过】原为 `(long long)(intptr_t)yc_value_to_text(...)`：C 风格转换不肯把 YC_TEXT
      // 连着经 operator const wchar_t*() 再转 intptr_t（no matching conversion），故「加入成员到
      // 文本数组」一直是死路。须先显式转 const wchar_t*（同 yc_ary_lit_text 的写法），
      // 再 yc_wcsdup_text 堆拷贝——直接存 YC_TEXT 临时量的内部指针会在整表达式结束时悬垂。
      if (kind === 'text') return `(long long)(intptr_t)yc_wcsdup_text((const wchar_t*)yc_value_to_text(${src}))`
      if (kind === 'bin') return `(long long)(intptr_t)yc_bin_dup(${src})`
      return `(long long)(${src})`
    },
  }
}

/** 数组命令首参（数组变量）的元素存储类别；浮点/文本数组的 数组排序 直接拦截（位模式排序会错序） */
function ycmdArrayCallElemKind(cmd: ResolvedCommand, args: string[]): ArrayElemKind {
  const symbol = getYcmdNativeSymbol(cmd)
  if (!YCMD_ARRAY_PARAM_KINDS[symbol]) return 'int'
  const info = currentTranspileArrayVars.get((args[0] || '').trim())
  const kind = arrayElemKindOf(info)
  if (kind !== 'int' && symbol === 'krnln_SortAry') {
    throw new Error(`暂不支持对 ${info?.elemType} 数组使用「${cmd.name || '数组排序'}」（元素按位模式存储，排序会错序）`)
  }
  return kind
}

// 【签名对齐】清单标「通用型」但 impl 实收数值的命令：通用映射会把实参转成**文本指针**传给收
// double/long long 的实现——C 链接不跨 TU 校验签名，故能编能链，只在调用时把指针当数值算（运行时静默出错）。
// 与 YCMD_ARRAY_PARAM_KINDS 同思路：按符号显式给定形参/返回类型，让声明与 impl 对齐。
// 注：这只是对齐 ABI；这些命令在易语言里本是「通用型」(数值或文本)，此处按 impl 的数值语义收敛，
// 文本形态（如 相加("a","b") 文本连接）仍不支持——要支持须把 impl 改成 const char* 泛型实现。
const YCMD_NATIVE_PARAM_TYPE_OVERRIDES: Record<string, string[]> = {
  krnln_equal: ['双精度小数型', '双精度小数型'],            // impl: int(double, double)
  krnln_notEqual: ['双精度小数型', '双精度小数型'],
  krnln_less: ['双精度小数型', '双精度小数型'],
  krnln_greater: ['双精度小数型', '双精度小数型'],
  krnln_lessOrEqual: ['双精度小数型', '双精度小数型'],
  krnln_greaterOrEqual: ['双精度小数型', '双精度小数型'],
  krnln_add: ['长整数型', '长整数型'],                      // impl: long long(long long, long long)
}
const YCMD_NATIVE_RETURN_TYPE_OVERRIDES: Record<string, string> = {
  // 取字节集数据：清单标〈通用型〉，通用映射掉默认 int 而 impl 返回 long long（长整数/双精度都塞在里头）
  krnln_GetBinElement: '长整数型',
  krnln_add: '长整数型',                                    // 清单标「通用型」→ 会被映射成 int，与 impl 的 long long 不符
}

// 【数组返回】impl 已按数组 ABI（返回 void* = 堆上新建的 std::vector<long long>*）落地的命令白名单。
// **必须按符号显式登记，不能只看清单的「X数组」返回类型**：krnln 512 条命令里 379 条是自动桩，
// 桩体形如 `return keepUtf8("[]")`（const char*）。若让桩也吃数组 ABI，yc_ary_take 会把字符串
// 字面量当 vector* 解引用并 delete —— 比现在「静默返回垃圾」更糟（直接崩）。与 YCMD_ARRAY_PARAM_KINDS 同思路。
const YCMD_ARRAY_RETURN_SYMBOLS = new Set<string>([
  'krnln_split',               // 分割文本    〈文本型数组〉
  'krnln_GetSectionNames',     // 取配置节名  〈文本型数组〉
  'krnln_OpenManyFileDialog',  // 多文件对话框〈文本型数组〉
  'krnln_GetAllPY',            // 取所有发音  〈文本型数组〉（国标汉字拼音表见 impl/pinyin-table.inc）
  'krnln_SplitBin',            // 分割字节集  〈字节集数组〉
])

/**
 * 「对象.xxx」是**对象成员命令**，帮助里的「对象．」是占位符（=任意对象），不是能直接写的命令名。
 * 但 ycmd 的 displayName 字面就是「对象.移动」，于是它们进了命令表、补全补得出来、写出来还能编过——
 * 而 impl 收的是「前导对象句柄 + 清单里那几个参数」，清单不含句柄 → 生成的调用**少一个参数**，
 * 运行时按错位的栈/寄存器取值。堵在转译期，并指路正确写法。
 *
 * 只堵「当自由命令调用」这一条路：提示面板走的是 findControlMethodEntry（剥「对象.」前缀去匹配
 * `编辑框1.加入文本`），那条路不经过这里，不受影响。
 */
function assertNotBareObjectMemberCommand(cmd: ResolvedCommand): void {
  const name = (cmd.name || '').trim()
  if (!/^对象[.．]/.test(name)) return
  const member = name.replace(/^对象[.．]/, '')
  throw new Error(`“${name}”是对象成员命令，不能这样直接调用；请写成「控件名.${member}(…)」的形式`)
}

/**
 * 清单标了数组返回、但 impl 还没按数组 ABI 落地 → 转译期友好报错。
 * 好过静默返回垃圾：这些命令此前 mapTypeToCType 认不得「X数组」而掉默认 int，
 * 声明 int 收 impl 的 const char*，调用处拿到的是被截断的指针值（且从不报错）。
 */
function assertYcmdArrayReturnSupported(cmd: ResolvedCommand, symbol: string): void {
  const rt = (cmd.returnType || '').trim()
  if (!/数组$/.test(rt) || YCMD_ARRAY_RETURN_SYMBOLS.has(symbol)) return
  if (!YCMD_ARRAY_RETURN_TYPES[rt]) {
    throw new Error(`命令“${cmd.name || symbol}”返回「${rt}」，编译器暂不支持该数组元素类型`)
  }
  throw new Error(`命令“${cmd.name || symbol}”在核心支持库中尚未实现（占位桩），暂不能调用`)
}

// 【省略 ≠ 零值】通用映射把「实参省略」一律译成零值（0 / "" / nullptr），但帮助里不少可省参数的
// 默认值并不是零值，且「省略」与「显式给了零值」语义不同——转译期本来就分得清（实参没写 vs 写了）。
// 按 符号→形参序号→省略时发的 C 表达式 显式给定。
const YCMD_OMITTED_PARAM_EXPRS: Record<string, Record<number, string>> = {
  // 分割文本 的「用作分割的文本」：省略→默认半角逗号；显式空文本→整段不分割。impl 靠 nullptr 区分。
  krnln_split: { 1: '(const char*)nullptr' },
  // 取统一文本 的「转换到宽文本」「添加结束零字符」：帮助明说省略时**默认均为真**（通用映射会给 0=假）
  krnln_GetUTextBin: { 1: '1', 2: '1' },
  // 取统一文本长度 的「转换到宽文本」：同上，省略默认真
  krnln_GetUTextLength: { 1: '1' },
}

/** 省略时改发指定 C 表达式的形参包装；实参给了则照原映射译 */
function withOmittedDefault(p: ReturnType<typeof mapYcmdNativeParamType>, omittedExpr: string): ReturnType<typeof mapYcmdNativeParamType> {
  return {
    cType: p.cType,
    expr: (arg, commandMap, directCallables) => ((arg || '').trim() ? p.expr(arg, commandMap, directCallables) : omittedExpr),
  }
}

function buildYcmdNativeSignature(cmd: ResolvedCommand, elemKind: ArrayElemKind = 'int'): { symbol: string; returnType: ReturnType<typeof mapYcmdNativeReturnType>; params: ReturnType<typeof mapYcmdNativeParamType>[] } {
  const symbol = getYcmdNativeSymbol(cmd)
  const arrayKinds = YCMD_ARRAY_PARAM_KINDS[symbol]
  const paramOverride = YCMD_NATIVE_PARAM_TYPE_OVERRIDES[symbol]
  const params = arrayKinds
    ? arrayKinds.map(kind => (kind === 'int64' && elemKind !== 'int'
      ? mapYcmdArrayElemValueParam(elemKind)
      : mapYcmdArrayParamKind(kind, cmd.name || symbol)))
    : (paramOverride || (cmd.params || []).map(p => p.type || '')).map(t => mapYcmdNativeParamType(t))
  const omitted = YCMD_OMITTED_PARAM_EXPRS[symbol]
  return {
    symbol,
    returnType: mapYcmdNativeReturnType(YCMD_NATIVE_RETURN_TYPE_OVERRIDES[symbol] || cmd.returnType || ''),
    params: omitted ? params.map((p, i) => (omitted[i] !== undefined ? withOmittedDefault(p, omitted[i]) : p)) : params,
  }
}

// 「尾参可重复」的原生命令（帮助文件：命令参数表中最后一个参数可以被重复添加）：impl 一次只收一个值，
// 多值按易语言「依次执行」语义展开成逐次调用（前 k-1 实参固定复用、末参逐值各发一次）。
// **只收录 ycmd 元数据与原生签名一致、且语义确为「逐值重复执行」的命令**——
// 光凭「尾参可重复」标记不能进这里：相加(通用型→const char* vs impl long long 签名不符)、
// 写出数据(ycmd 少了文件号)、读入数据(const char* vs void*) 都是坏的；多项选择 语义是「选一个」不是重复写。
const YCMD_REPEAT_TAIL_SYMBOLS = new Set<string>([
  'krnln_AddElement',                                  // 加入成员(数组, 值…)
  'krnln_WriteText', 'krnln_WriteLine',                // 写出文本 / 写文本行
  'krnln_InsText', 'krnln_InsLine',                    // 插入文本 / 插入文本行
  'krnln_WriteBin', 'krnln_InsBin',                    // 写出字节集 / 插入字节集
  'krnln_fputs', 'krnln_OutputDebugText',              // 标准输出 / 输出调试文本
  'krnln_write',                                       // 写出数据（ycmd 曾漏「文件号」参数+返回值标错，已对齐帮助与 impl）
])

/** 尾参可重复的多值展开：返回逐次调用的 C 片段（前 k-1 实参复用），空值跳过（展开参数行回车会留尾部空实参）。 */
function buildYcmdRepeatTailCalls(
  sig: ReturnType<typeof buildYcmdNativeSignature>,
  args: string[],
  commandMap?: Map<string, ResolvedCommand>,
  directCallables?: DirectCallableNames,
): string[] | null {
  if (!YCMD_REPEAT_TAIL_SYMBOLS.has(sig.symbol)) return null
  if (sig.params.length === 0 || args.length <= sig.params.length) return null
  const leadCount = sig.params.length - 1
  const lead = sig.params.slice(0, leadCount).map((p, i) => p.expr(args[i] || '', commandMap, directCallables))
  const tailP = sig.params[leadCount]
  const tailArgs = args.slice(leadCount).filter(a => (a ?? '').trim() !== '')
  if (tailArgs.length === 0) return null
  return tailArgs.map(v => `${sig.symbol}(${[...lead, tailP.expr(v, commandMap, directCallables)].join(', ')})`)
}

function generateYcmdNativeCommandExpr(cmd: ResolvedCommand, args: string[], commandMap?: Map<string, ResolvedCommand>, directCallables?: DirectCallableNames): string {
  assertNotBareObjectMemberCommand(cmd)
  assertYcmdArrayReturnSupported(cmd, getYcmdNativeSymbol(cmd))
  const sig = buildYcmdNativeSignature(cmd, ycmdArrayCallElemKind(cmd, args))
  // 尾参可重复的多值：逐次调用用逗号表达式串起（值=最后一次调用的结果，与易语言一致）
  const repeatCalls = buildYcmdRepeatTailCalls(sig, args, commandMap, directCallables)
  if (repeatCalls) {
    const chained = repeatCalls.length === 1 ? repeatCalls[0] : `(${repeatCalls.join(', ')})`
    if (sig.returnType.isVoid) return `([&]() -> int { ${chained}; return 0; })()`
    return `([&]() -> ${mapTypeToCType(cmd.returnType || '整数型')} { return ${sig.returnType.expr(chained)}; })()`
  }
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

/**
 * 内建要求实参是变量本身（裸标识符）——「参考」语义下传字面量/表达式没有意义。
 * 必须用标识符正则（与本文件其它处一致），不能只判「没有空格括号」：那样 `交换变量(1, 2)`
 * 里的 1/2 会被当成变量名放行，最后炸在 C++ 的 no matching function for call to 'swap'。
 */
const YC_IDENT_RE = /^[一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*$/

function requireVarArg(arg: string, cmdName: string): string {
  const t = (arg || '').trim()
  if (!YC_IDENT_RE.test(t)) {
    throw new Error(`命令“${cmdName}”需要变量作为参数（它按引用操作该变量），但收到：${t || '(空)'}`)
  }
  return t
}

/**
 * 【变量操作族的调用生成】「赋值/连续赋值/交换变量/强制交换变量/数组清零」在帮助里的参数是
 * 「**通用型变量/变量数组**」（vs 值参的「通用型数组/非数组」）——是**按引用**语义。
 * 通用编组把实参译成「值的文本形态」，连变量地址都不是，故这几条必须专门生成调用。
 *
 * **实现仍在支持库**（krnln_set/store/XchgVar/ForceXchgVar/ZeroAry）：这里只负责把
 * 「变量地址 + 类型标签」交过去。标签经生成侧的 yc_vt_of(变量) 由 C++ 重载解析得出——
 * 转译期不必再查一次变量类型表，且遇到不支持的类型直接编译失败，不会静默按错类型写内存。
 * 值参用 decltype(目标) 落到临时量上，类型转换交给 C++ 完成后再取址交给 krnln。
 */
const YCMD_VARREF_CALLS: Record<string, (args: string[], tx: (e: string) => string, name: string) => string> = {
  // 赋值(被赋值的变量, 值)
  krnln_set: (args, tx, name) => {
    const t = requireVarArg(args[0], name)
    return `{ decltype(${t}) __yc_v = (${tx(args[1] || '')}); krnln_set((void*)&${t}, (const void*)&__yc_v, yc_vt_of(${t})); }`
  },
  // 连续赋值(值, 变量1, 变量2…)——注意参数顺序与 赋值 相反（帮助如此），尾参可重复
  krnln_store: (args, tx, name) => {
    const value = tx(args[0] || '')
    const targets = args.slice(1).filter(a => (a || '').trim()).map(a => requireVarArg(a, name))
    if (targets.length === 0) throw new Error(`命令“${name}”至少需要一个被赋值的变量`)
    // 每个目标各按自己的类型转换一次（多个目标类型可以不同）
    return `{ ${targets.map((t, i) => `{ decltype(${t}) __yc_v${i} = (${value}); krnln_store((const void*)&__yc_v${i}, (void*)&${t}, yc_vt_of(${t})); }`).join(' ')} }`
  },
  // 交换变量：帮助要求类型一致 → static_assert 挡在编译期
  krnln_XchgVar: (args, _tx, name) => {
    const a = requireVarArg(args[0], name)
    const b = requireVarArg(args[1], name)
    return `{ static_assert(std::is_same<decltype(${a}), decltype(${b})>::value, "\\u4ea4\\u6362\\u53d8\\u91cf: two variables must have the same type"); krnln_XchgVar((void*)&${a}, (void*)&${b}, yc_vt_of(${a})); }`
  },
  // 强制交换变量：帮助说它「不对数据类型进行检查，仅要求数据尺寸一致，文本/字节集只交换指针值」。
  // 我们这里仍要求类型一致——按字节交换 std::wstring/vector 会踩 SSO 的自指指针（libstdc++ 的
  // 短串优化里 _M_p 指向对象内部缓冲），换完两个变量都是坏的。而且我们的实现本就是 O(1) 指针交换，
  // 原命令那点性能优势在这里不存在，放开类型检查只剩风险。
  krnln_ForceXchgVar: (args, _tx, name) => {
    const a = requireVarArg(args[0], name)
    const b = requireVarArg(args[1], name)
    return `{ static_assert(std::is_same<decltype(${a}), decltype(${b})>::value, "\\u5f3a\\u5236\\u4ea4\\u6362\\u53d8\\u91cf: two variables must have the same type"); krnln_ForceXchgVar((void*)&${a}, (void*)&${b}, yc_vt_of(${a})); }`
  },
  // 数组清零(数值数组变量)——帮助：全部成员置零，不影响维定义。
  // 元素类别是转译期才知道的信息，故「只收数值数组」这个诊断留在这边；清零本身仍在 krnln。
  krnln_ZeroAry: (args, _tx, name) => {
    const t = requireVarArg(args[0], name)
    const info = currentTranspileArrayVars.get(t)
    if (!info) throw new Error(`命令“${name}”需要数组变量作为参数，但收到：${t}`)
    const kind = arrayElemKindOf(info)
    if (kind === 'text' || kind === 'bin') {
      throw new Error(`命令“${name}”只支持数值数组（帮助：数值数组变量），但“${t}”是 ${info.elemType} 数组`)
    }
    return `{ krnln_ZeroAry((void*)&${t}); }`
  },
}

function generateYcmdNativeCommandCall(cmd: ResolvedCommand, args: string[], commandMap?: Map<string, ResolvedCommand>, directCallables?: DirectCallableNames): string {
  const varrefCall = YCMD_VARREF_CALLS[getYcmdNativeSymbol(cmd)]
  if (varrefCall) return varrefCall(args, (e) => formatArgForC(e, commandMap, directCallables), cmd.name || getYcmdNativeSymbol(cmd))
  assertNotBareObjectMemberCommand(cmd)
  assertYcmdArrayReturnSupported(cmd, getYcmdNativeSymbol(cmd))
  const sig = buildYcmdNativeSignature(cmd, ycmdArrayCallElemKind(cmd, args))
  // 调试输出：impl 单参（const char*）。所有值经 yc_dbg_fmt 格式化（照易语言——文本带
  // 全角引号、数值裸、数组/字节集带类型头），多值拼成一行（值间双空格）单次输出。
  // 数组的元素存储类别只有转译期知道（f64/text 位模式），先按类别选专用打印。
  if (sig.symbol === 'spec_Trace' && args.length >= 1) {
    const fmtOne = (a: string): string => {
      const t = (a || '').trim()
      const kind = arrayValueElemKind(t, commandMap)
      const arg = formatArgForC(t, commandMap, directCallables)
      if (kind === 'f64') return `yc_ary_to_text_f64(${arg})`
      if (kind === 'text') return `yc_ary_to_text_str(${arg})`
      if (kind === 'bin') return `yc_ary_to_text_bin(${arg})`
      return `yc_dbg_fmt(${arg})`
    }
    const wideParts = args.map(fmtOne)
    let joined = wideParts[0]
    for (let i = 1; i < wideParts.length; i++) {
      joined = `yc_text_concat(yc_text_concat(${joined}, L"  "), ${wideParts[i]})`
    }
    return `{ (void)spec_Trace(yc_wide_to_utf8(${joined})); }`
  }
  // 尾参可重复（加入成员(数组,值…) / 写出文本(文件号,文本…) / 输出调试文本(值…) 等）：
  // impl 一次只收一个值，多值展开为逐次调用（前 k-1 实参复用）。
  const repeatCalls = buildYcmdRepeatTailCalls(sig, args, commandMap, directCallables)
  if (repeatCalls) {
    return `{ ${repeatCalls.map(c => `(void)${c};`).join(' ')} }`
  }
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
    // 变量操作族的声明是手写的（「地址+类型标签」通用映射译不出，见 prelude 里的 extern 块）→ 这里跳过，
    // 否则会按清单的「通用型」再发一份 const char* 的错声明。
    if (YCMD_VARREF_CALLS[getYcmdNativeSymbol(cmd)]) continue
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

/**
 * 判断表达式整体是否正好被一层括号包住——即第 0 个 ( 的配对括号就是末字符。
 *
 * 「首字符是 ( 且尾字符是 )」证明不了这件事：这俩括号未必互相配对。命令表达式的通用生成
 * 形态是 IIFE `([&]() -> int { … })()`，首尾都是括号，但开头的 ( 配的是 `})(` 里那个 )，
 * 末尾的 ) 属于调用括号。误判成「已包住」就会生成 `if ([&]() -> int { … })() {`，
 * 条件在 lambda 处提前闭合，clang 报 lambda is not contextually convertible to 'bool'。
 *
 * 判不准时一律返回 false（宁可多包一层，只多余不出错）。反过来无脑全包不行：
 * `if ((a == b))` 会触发 clang 的 -Wparentheses-equality 警告刷屏。
 */
function isSingleParenGroup(expr: string): boolean {
  if (!expr.startsWith('(') || !expr.endsWith(')')) return false
  let depth = 0
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    // 字符串/字符字面量里的括号不参与配对，如 yc_text_compare(x, L"(") 里的那个
    if (ch === '"' || ch === '\'') {
      const quote = ch
      i++
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === '\\') i++
        i++
      }
      if (i >= expr.length) return false
      continue
    }
    if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
      if (depth === 0) return i === expr.length - 1
      if (depth < 0) return false
    }
  }
  return false
}

function wrapConditionForC(expr: string): string {
  const trimmed = (expr || '').trim()
  if (!trimmed) return '(0)'
  if (isSingleParenGroup(trimmed)) return trimmed
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
    // \u540c translateExpressionToC\uff1a\u5185\u90e8\u542b\u540c\u7c7b\u5f15\u53f7\u8bf4\u660e\u4e0d\u662f\u5355\u4e2a\u5b57\u9762\u91cf\uff08\u5982\u5b57\u7b26\u4e32\u62fc\u63a5\u8868\u8fbe\u5f0f\uff09
    const quoted = trimmed.match(/^\u201c([^\u201c\u201d]*)\u201d$/) || trimmed.match(/^"([^"]*)"$/)
    if (quoted) {
      // \u5b57\u9762\u91cf\u5728 -fexec-charset=utf-8 \u4e0b\u5373\u4e3a UTF-8 \u7a84\u5b57\u8282\uff0c\u76f4\u63a5\u4f5c char* \u4f20\u5165\u3002
      const content = quoted[1].replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      return `(char*)"${content}"`
    }
    // \u6587\u672c\u578b\u53d8\u91cf/\u8868\u8fbe\u5f0f\u5728\u8fd0\u884c\u65f6\u662f wchar_t*(UTF-16)\uff0c\u901a\u7528 fne \u5206\u53d1\u63a5\u53e3\u8981 UTF-8 char*\uff0c
    // \u5fc5\u987b\u7ecf yc_wide_to_utf8 \u8f6c\u6362\uff1b\u6b64\u524d\u76f4\u63a5 (char*) \u91cd\u89e3\u91ca\u4f1a\u628a UTF-16 \u5b57\u8282\u5f53\u7a84\u4e32\u4f20\u51fa\uff08\u4e71\u7801/\u622a\u65ad\uff09\u3002
    return `(char*)yc_wide_to_utf8(${inlineRealDiv(replaceConstantRefs(convertFullWidthOps(trimmed)))})`
  }

  if (field === 'm_bool') {
    if (trimmed === '真') return '1'
    if (trimmed === '假') return '0'
    return `(${translateExpressionToC(trimmed, buildCommandMap())} ? 1 : 0)`
  }

  // 这条旧路径不走 translateExpressionToC（故也没有乘除拆分）→ ÷ 哨兵在此就地落地
  return inlineRealDiv(replaceConstantRefs(convertFullWidthOps(trimmed)))
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

function generateYcGenericCommandTextExpr(cmd: LibCommand & { libraryName: string; libraryFileName: string }, args: string[]): string {
  // 控件文本属性赋值专用：把通用支持库命令调用包成返回 wchar_t* 的表达式
  //（与 ycmd 原生命令的 lambda 同款），非文本返回值经 yc_value_to_text 转文本。
  const n = args.length
  const lines: string[] = []
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
  const retExpr = (cmd.returnType || '') === '文本型' ? retMapped.expr : `yc_value_to_text(${retMapped.expr})`
  lines.push(`return ${retExpr};`)
  return `([&]() -> wchar_t* { ${lines.join(' ')} })()`
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
  // DLL 命令走原生 wchar_t* ABI（不用 YC_TEXT，文本变量传参时经 YC_TEXT→const wchar_t* 隐式转换）
  if (trimmed === '文本型') return 'wchar_t*'
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

  currentTranspileArrayVars = new Map()
  fileScopeArrayVars = new Map()

  const lines = eycContent.split('\n')
  let result = `/* 由 ycIDE 自动从 ${fileName} 生成 */\n`
  result += '#include <windows.h>\n#include <stdio.h>\n#include <stdint.h>\n#include <stdlib.h>\n#include <direct.h>\n#include <wchar.h>\n#include <wctype.h>\n#include <string.h>\n#include <filesystem>\n#include <vector>\n#include <string>\n#include <algorithm>\n#include <type_traits>\n#include <fstream>\n\n'
  result += generateYcmdNativeDeclarations(targetPlatform)
  result += 'namespace ycfs = std::filesystem;\n\n'
  result += 'typedef std::vector<unsigned char> YC_BIN;\n'
  // 字节集连接：易语言里 字节集 ＋ 字节集 是基本操作，但 YC_BIN 是 std::vector 别名、没有 operator+
  //（`到字节集(…) ＋ 到字节集(…)` 此前直接编译失败：invalid operands to binary expression）。
  result += 'static inline YC_BIN operator+(const YC_BIN& a, const YC_BIN& b) { YC_BIN r; r.reserve(a.size() + b.size()); r.insert(r.end(), a.begin(), a.end()); r.insert(r.end(), b.begin(), b.end()); return r; }\n'
  // 文本型：包裹 std::wstring 的值类型（RAII、拷贝即值语义、出作用域自动释放，无泄漏）；
  // operator const wchar_t*() 让它无缝落进所有既有 const wchar_t* 调用点与原生 ABI。
  result += 'struct YC_TEXT {\n'
  result += '    std::wstring s;\n'
  result += '    YC_TEXT() {}\n'
  result += '    YC_TEXT(const wchar_t* p) : s(p ? p : L"") {}\n'
  result += '    YC_TEXT(const std::wstring& w) : s(w) {}\n'
  result += '    YC_TEXT(std::wstring&& w) : s(std::move(w)) {}\n'
  result += '    operator const wchar_t*() const { return s.c_str(); }\n'
  result += '    const wchar_t* c_str() const { return s.c_str(); }\n'
  result += '    bool empty() const { return s.empty(); }\n'
  result += '};\n\n'
  // 易语言数组下标为一基；越界回落到哑元引用（读得 0、写被丢弃），不崩溃
  result += 'static long long yc_ary_dummy_slot = 0;\n'
  result += 'static inline long long& yc_ary_at(std::vector<long long>& a, long long idx1) {\n'
  result += '    if (idx1 < 1 || (size_t)idx1 > a.size()) { yc_ary_dummy_slot = 0; return yc_ary_dummy_slot; }\n'
  result += '    return a[(size_t)(idx1 - 1)];\n'
  result += '}\n\n'
  // 浮点族数组元素按 double 位模式存进 vector<long long>，读写经位转换
  result += 'static inline long long yc_f64_bits(double v) { long long r; memcpy(&r, &v, 8); return r; }\n'
  result += 'static inline double yc_f64_from_bits(long long b) { double r; memcpy(&r, &b, 8); return r; }\n\n'
  // 数组字面量 { 1, 2, 3 } 的临时 vector 构造（浮点元素按 double 位模式存）
  result += 'static std::vector<long long> yc_ary_lit(std::initializer_list<long long> v) { return std::vector<long long>(v); }\n'
  result += 'static std::vector<long long> yc_ary_lit_f64(std::initializer_list<double> v) { std::vector<long long> r; r.reserve(v.size()); for (double d : v) r.push_back(yc_f64_bits(d)); return r; }\n\n'
  // 文本数组字面量：元素堆拷贝后存指针位模式（需要前向声明 yc_wcsdup_text，其定义在后段）
  result += 'static wchar_t* yc_wcsdup_text(const wchar_t* s);\n'
  result += 'static std::vector<long long> yc_ary_lit_text(std::initializer_list<const wchar_t*> v) { std::vector<long long> r; r.reserve(v.size()); for (const wchar_t* s : v) r.push_back((long long)(intptr_t)yc_wcsdup_text(s ? s : L"")); return r; }\n\n'
  // 字节集数组：元素存堆上 YC_BIN 的指针位模式（YC_BIN 是值类型、装不进 long long）。
  // 与 yc_wcsdup_text 同策——全程序生命期，不回收（数组元素没有析构时机）。
  result += 'static YC_BIN* yc_bin_dup(const YC_BIN& b) { return new YC_BIN(b); }\n'
  result += 'static std::vector<long long> yc_ary_lit_bin(std::initializer_list<YC_BIN> v) { std::vector<long long> r; r.reserve(v.size()); for (const YC_BIN& b : v) r.push_back((long long)(intptr_t)yc_bin_dup(b)); return r; }\n\n'
  // 【数组返回 ABI】接管 krnln impl 交回的堆 vector：移走内容后 delete，所有权到此为止归调用处。
  // impl 只负责 new + 填充（文本元素用 _wcsdup 出的宽串指针存位模式，与 yc_ary_lit_text 同款、同样不回收）。
  result += 'static std::vector<long long> yc_ary_take(void* p) {\n'
  result += '    std::vector<long long>* v = reinterpret_cast<std::vector<long long>*>(p);\n'
  result += '    if (!v) return std::vector<long long>();\n'
  result += '    std::vector<long long> r = std::move(*v);\n'
  result += '    delete v;\n'
  result += '    return r;\n'
  result += '}\n'
  // 数组「值」表达式（如 分割文本(…) 的返回、数组字面量）要当数组命令实参时的落地槽：
  // 数组命令收 (void*)&数组变量，而临时量取不了址——先落进轮转池再取址（同 yc_c_str_slot 的路子）。
  result += 'static std::vector<long long> yc_ary_tmp_slots[8];\n'
  result += 'static int yc_ary_tmp_pos = 0;\n'
  result += 'static std::vector<long long>& yc_ary_tmp(std::vector<long long> v) {\n'
  result += '    std::vector<long long>& s = yc_ary_tmp_slots[yc_ary_tmp_pos];\n'
  result += '    yc_ary_tmp_pos = (yc_ary_tmp_pos + 1) % 8;\n'
  result += '    s = std::move(v);\n'
  result += '    return s;\n'
  result += '}\n'
  // 字节集要按 YC_BIN* 交给 krnln 时的落地槽（同上：临时量取不了址）。见 mapYcmdArrayParamKind 的 binptr。
  result += 'static YC_BIN yc_bin_tmp_slots[8];\n'
  result += 'static int yc_bin_tmp_pos = 0;\n'
  result += 'static YC_BIN& yc_bin_tmp(YC_BIN v) {\n'
  result += '    YC_BIN& s = yc_bin_tmp_slots[yc_bin_tmp_pos];\n'
  result += '    yc_bin_tmp_pos = (yc_bin_tmp_pos + 1) % 8;\n'
  result += '    s = std::move(v);\n'
  result += '    return s;\n'
  result += '}\n\n'
  // ========== 「按引用操作变量」族的类型标签（赋值/连续赋值/交换变量/强制交换变量）==========
  // 这族是「通用型变量」语义：krnln 收到变量地址后，得知道该按什么类型去赋值/交换——裸 void*
  // 没有类型信息。转译期本来就知道类型，故把标签一起交过去，**实现仍留在支持库**。
  // 独立编号、不复用 YC_SDT_*：那套是易语言的数据类型 ID（YC_MDATA_INF 在用），
  // 字节集/数组的真实 ID 我们没有确证，不在这里瞎认领。
  result += '#define YC_VT_INT 1\n#define YC_VT_INT64 2\n#define YC_VT_SHORT 3\n#define YC_VT_BYTE 4\n'
  result += '#define YC_VT_FLOAT 5\n#define YC_VT_DOUBLE 6\n#define YC_VT_TEXT 7\n#define YC_VT_BIN 8\n#define YC_VT_ARY 9\n'
  // 标签由 C++ 重载解析得出，转译期不必再查一次变量类型表；不支持的类型直接编译失败（诚实），
  // 不会静默按错类型写内存。逻辑型/整数型同为 int，赋值与交换的行为本就一致，不必区分。
  result += 'static inline int yc_vt_of(int) { return YC_VT_INT; }\n'
  result += 'static inline int yc_vt_of(long long) { return YC_VT_INT64; }\n'
  result += 'static inline int yc_vt_of(short) { return YC_VT_SHORT; }\n'
  result += 'static inline int yc_vt_of(unsigned char) { return YC_VT_BYTE; }\n'
  result += 'static inline int yc_vt_of(float) { return YC_VT_FLOAT; }\n'
  result += 'static inline int yc_vt_of(double) { return YC_VT_DOUBLE; }\n'
  result += 'static inline int yc_vt_of(const YC_TEXT&) { return YC_VT_TEXT; }\n'
  result += 'static inline int yc_vt_of(const YC_BIN&) { return YC_VT_BIN; }\n'
  result += 'static inline int yc_vt_of(const std::vector<long long>&) { return YC_VT_ARY; }\n\n'
  // 变量操作族的原生签名（清单里这几条的参数是「通用型变量/变量数组」，通用映射译不出「地址+标签」，
  // 故手写声明、并在 generateYcmdNativeDeclarations 里跳过它们）。
  result += 'extern "C" void krnln_set(void* target, const void* value, int dataType);\n'
  result += 'extern "C" void krnln_store(const void* value, void* target, int dataType);\n'
  result += 'extern "C" void krnln_XchgVar(void* a, void* b, int dataType);\n'
  result += 'extern "C" void krnln_ForceXchgVar(void* a, void* b, int dataType);\n'
  result += 'extern "C" void krnln_ZeroAry(void* arrayVar);\n\n'
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
  result += 'extern HWND yc_get_control_handle_by_name(const wchar_t* ctrlName);\n'
  result += 'extern YC_TEXT yc_ctrl_get_text(HWND h);\n'
  result += 'extern void yc_ctrl_set_text_color(HWND h, COLORREF c);\n'
  result += 'extern YC_TEXT yc_ctrl_get_tag(HWND h);\n'
  result += 'extern YC_TEXT yc_ctrl_get_date(HWND h, const wchar_t* prop);\n'
  result += 'extern "C" void krnln_ctrl_set_tag(HWND h, const wchar_t* t);\n'
  result += 'extern "C" void krnln_ctrl_set_date(HWND h, const wchar_t* prop, const wchar_t* text);\n'
  result += 'extern "C" long long krnln_ctrl_get_number(HWND h, const wchar_t* prop);\n'
  result += 'extern "C" void krnln_ctrl_set_number(HWND h, const wchar_t* prop, long long value);\n'
  result += 'extern "C" void krnln_ctrl_set_text(HWND h, const wchar_t* text);\n'
  result += 'extern int yc_text_compare(const wchar_t* left, const wchar_t* right);\n'
  result += 'extern int yc_text_starts_with(const wchar_t* text, const wchar_t* prefix);\n'
  // 组合框/列表框 项目成员方法：纯 Win32 版已搬入 krnln 库（HWND 版）；文本读取/取所有被选择项目 留 main.cpp（返回编译器内部 C++ 类型）。
  result += 'extern "C" int krnln_ll_add_item(HWND h, const wchar_t* t, int data);\n'
  result += 'extern "C" int krnln_ll_insert_item(HWND h, int pos, const wchar_t* t, int data);\n'
  result += 'extern "C" int krnln_ll_delete_item(HWND h, int idx);\n'
  result += 'extern "C" void krnln_ll_clear(HWND h);\n'
  result += 'extern "C" int krnln_ll_count(HWND h);\n'
  result += 'extern YC_TEXT yc_ll_get_text(HWND h, int idx);\n'
  result += 'extern "C" int krnln_ll_set_text(HWND h, int idx, const wchar_t* t);\n'
  result += 'extern "C" int krnln_ll_get_data(HWND h, int idx);\n'
  result += 'extern "C" int krnln_ll_set_data(HWND h, int idx, int data);\n'
  result += 'extern "C" int krnln_ll_get_top(HWND h);\n'
  result += 'extern "C" int krnln_ll_set_top(HWND h, int idx);\n'
  result += 'extern "C" int krnln_ll_select(HWND h, const wchar_t* t);\n'
  result += 'extern "C" int krnln_lb_sel_count(HWND h);\n'
  result += 'extern "C" int krnln_lb_caret(HWND h);\n'
  result += 'extern "C" int krnln_lb_set_caret(HWND h, int idx);\n'
  result += 'extern "C" int krnln_lb_is_selected(HWND h, int idx);\n'
  result += 'extern "C" int krnln_lb_select_item(HWND h, int idx, int state);\n'
  result += 'extern std::vector<long long> yc_lb_get_sel_items(HWND h);\n'
  result += 'extern void yc_hyperlink_jump(const wchar_t* n);\n'
  result += 'extern int yc_chk_is_checked(const wchar_t* n, int idx);\n'
  result += 'extern int yc_chk_set_checked(const wchar_t* n, int idx, int st);\n'
  result += 'extern int yc_chk_is_enabled(const wchar_t* n, int idx);\n'
  result += 'extern int yc_chk_enable(const wchar_t* n, int idx, int st);\n'
  result += 'extern int yc_tab_count(const wchar_t* n);\n'
  result += 'extern YC_TEXT yc_tab_get_name(const wchar_t* n, int idx);\n'
  result += 'extern int yc_tab_set_name(const wchar_t* n, int idx, const wchar_t* nm);\n'
  result += 'extern int yc_tab_get_cur(const wchar_t* n);\n'
  result += 'extern int yc_tab_set_cur(const wchar_t* n, int idx);\n'
  // 画板绘图方法（定义在 main.cpp，两站点声明）
  result += 'extern int yc_dp_gethdc(const wchar_t* n);\n'
  result += 'extern void yc_dp_cls(const wchar_t* n, int l, int t, int w, int h);\n'
  result += 'extern int yc_dp_getpixel(const wchar_t* n, int x, int y);\n'
  result += 'extern void yc_dp_setpixel(const wchar_t* n, int x, int y, int c);\n'
  result += 'extern void yc_dp_line(const wchar_t* n, int x1, int y1, int x2, int y2);\n'
  result += 'extern void yc_dp_ellipse(const wchar_t* n, int l, int t, int r, int b);\n'
  result += 'extern void yc_dp_arc(const wchar_t* n, int l, int t, int r, int b, int xs, int ys, int xe, int ye);\n'
  result += 'extern void yc_dp_chord(const wchar_t* n, int l, int t, int r, int b, int xs, int ys, int xe, int ye);\n'
  result += 'extern void yc_dp_pie(const wchar_t* n, int l, int t, int r, int b, int xs, int ys, int xe, int ye);\n'
  result += 'extern void yc_dp_rect(const wchar_t* n, int l, int t, int r, int b);\n'
  result += 'extern void yc_dp_gradrect(const wchar_t* n, int x, int y, int w, int h, int dir, int c1, int c2);\n'
  result += 'extern void yc_dp_fillrect(const wchar_t* n, int l, int t, int r, int b);\n'
  result += 'extern void yc_dp_roundrect(const wchar_t* n, int l, int t, int r, int b, int ew, int eh);\n'
  result += 'extern void yc_dp_invert(const wchar_t* n, int l, int t, int r, int b);\n'
  result += 'extern void yc_dp_polygon(const wchar_t* n, const std::vector<long long>& arr, int cnt);\n'
  result += 'extern void yc_dp_setwritepos(const wchar_t* n, int x, int y);\n'
  result += 'extern void yc_dp_print(const wchar_t* n, const wchar_t* text);\n'
  result += 'extern void yc_dp_sprint(const wchar_t* n, const wchar_t* text);\n'
  result += 'extern void yc_dp_writeout(const wchar_t* n, const wchar_t* text);\n'
  result += 'extern void yc_dp_say(const wchar_t* n, int x, int y, const wchar_t* text);\n'
  result += 'extern int yc_dp_getwidth(const wchar_t* n, const wchar_t* text);\n'
  result += 'extern int yc_dp_getheight(const wchar_t* n, const wchar_t* text);\n'
  result += 'extern void yc_dp_drawpic(const wchar_t* n, const std::vector<unsigned char>& img, int x, int y, int w, int h, int mode);\n'
  result += 'extern int yc_dp_getpicwidth(const wchar_t* n, const std::vector<unsigned char>& img);\n'
  result += 'extern int yc_dp_getpicheight(const wchar_t* n, const std::vector<unsigned char>& img);\n'
  result += 'extern void yc_dp_copy(const wchar_t* n);\n'
  result += 'extern YC_BIN yc_dp_getpic(const wchar_t* n, int ow, int oh);\n'
  result += 'extern int yc_dp_unitcnv(const wchar_t* n, int v, int type);\n'
  result += 'extern int yc_dp_get_prop(const wchar_t* n, int prop);\n'
  result += 'extern void yc_dp_set_prop(const wchar_t* n, int prop, int v);\n'
  // 时钟周期运行时读写（时钟无 HWND，按名查生成的定时器表）
  result += 'extern int yc_timer_get_period(const wchar_t* n);\n'
  result += 'extern void yc_timer_set_period(const wchar_t* n, int v);\n'
  // 编辑框/组合框「被选择文本」（库返 owned wchar_t*，main.cpp 包 YC_TEXT）
  result += 'extern YC_TEXT yc_ctrl_get_seltext(HWND h);\n'
  result += 'extern "C" void krnln_ctrl_set_seltext(HWND h, const wchar_t* t);\n'
  result += 'extern "C" void krnln_ctrl_append_text(HWND h, const wchar_t* t);\n\n'  // 编辑框「加入文本」（多值由 callEach 逐值发一次调用）
  result += 'static wchar_t* yc_wcsdup_text(const wchar_t* s);\n'
  result += 'static wchar_t* yc_empty_text(void);\n'
  result += 'static YC_TEXT yc_utf8_to_wide(const char* s);\n'
  result += 'static const char* yc_wide_to_utf8(const wchar_t* s);\n'
  result += 'static YC_BIN yc_bin_take(void* p);\n'
  result += 'static YC_BIN& yc_bin_ref(YC_BIN& b);\n'
  result += 'static YC_TEXT yc_format_win32_error(DWORD errorCode);\n'
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
  result += 'static YC_TEXT yc_utf8_to_wide(const char* s) {\n'
  result += '    if (!s) return YC_TEXT();\n'
  result += '    int n = MultiByteToWideChar(CP_UTF8, 0, s, -1, NULL, 0);\n'
  result += '    if (n <= 1) return YC_TEXT();\n'
  result += '    std::wstring out; out.resize((size_t)n - 1);\n'
  result += '    if (MultiByteToWideChar(CP_UTF8, 0, s, -1, &out[0], n) <= 0) return YC_TEXT();\n'
  result += '    return YC_TEXT(std::move(out));\n'
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

  // 【字节集 ABI v2】接管 krnln impl 交回的堆 YC_BIN（移走内容后 delete）。与 yc_ary_take 同款。
  result += 'static YC_BIN yc_bin_take(void* p) {\n'
  result += '    YC_BIN* v = reinterpret_cast<YC_BIN*>(p);\n'
  result += '    if (!v) return YC_BIN();\n'
  result += '    YC_BIN r = std::move(*v);\n'
  result += '    delete v;\n'
  result += '    return r;\n'
  result += '}\n\n'
  // 「参考」形态的字节集实参（置字节集内整数 要就地改写）：必须绑到用户变量本身、不能是临时副本。
  // 借 C++ 重载解析当类型闸——实参不是 YC_BIN 左值就编译失败，而非 (void*)& 出一个错类型指针。
  result += 'static YC_BIN& yc_bin_ref(YC_BIN& b) { return b; }\n\n'
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
  result += 'static YC_TEXT yc_format_win32_error(DWORD errorCode) {\n'
  result += '    if (errorCode == 0) return YC_TEXT();\n'
  result += '    LPWSTR sysMsg = NULL;\n'
  result += '    DWORD len = FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,\n'
  result += '        NULL, errorCode, 0, (LPWSTR)&sysMsg, 0, NULL);\n'
  result += '    if (!len || !sysMsg) return YC_TEXT();\n'
  result += '    while (len > 0 && (sysMsg[len - 1] == L\'\\r\' || sysMsg[len - 1] == L\'\\n\' || sysMsg[len - 1] == L\' \' || sysMsg[len - 1] == L\'\\t\')) {\n'
  result += '        sysMsg[--len] = 0;\n'
  result += '    }\n'
  result += '    YC_TEXT out(sysMsg);\n'
  result += '    LocalFree(sysMsg);\n'
  result += '    return out;\n'
  result += '}\n\n'
  result += 'static void yc_runtime_report_dll_error(const wchar_t* stage, const wchar_t* dllName, const char* entryName, DWORD errorCode) {\n'
  result += '    YC_TEXT winMsg = yc_format_win32_error(errorCode);\n'
  result += '    yc_runtime_note_begin();\n'
  result += '    yc_runtime_note_part(L"DLL调用失败");\n'
  result += '    if (stage && *stage) { yc_runtime_note_part(L"|"); yc_runtime_note_part(stage); }\n'
  result += '    if (dllName && *dllName) { yc_runtime_note_part(L"|"); yc_runtime_note_part(dllName); }\n'
  result += '    if (entryName && *entryName) { yc_runtime_note_part(L"|"); yc_runtime_note_part(entryName); }\n'
  result += '    if (errorCode != 0) { yc_runtime_note_part(L"|"); yc_runtime_note_part((long long)errorCode); }\n'
  result += '    if (!winMsg.empty()) { yc_runtime_note_part(L"|"); yc_runtime_note_part((const wchar_t*)winMsg); }\n'
  result += '    yc_runtime_note_end();\n'
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
  result += 'static YC_TEXT yc_text_concat(const wchar_t* left, const wchar_t* right) {\n'
  result += '    std::wstring out(left ? left : L"");\n'
  result += '    out += (right ? right : L"");\n'
  result += '    return YC_TEXT(std::move(out));\n'
  result += '}\n\n'
  result += 'static YC_TEXT yc_value_to_text(long long value) {\n'
  result += '    wchar_t buf[64];\n'
  result += '    swprintf(buf, 64, L"%lld", value);\n'
  result += '    return YC_TEXT(buf);\n'
  result += '}\n\n'
  result += 'static YC_TEXT yc_value_to_text(int value) {\n'
  result += '    return yc_value_to_text((long long)value);\n'
  result += '}\n\n'
  result += 'static YC_TEXT yc_value_to_text(double value) {\n'
  result += '    wchar_t buf[128];\n'
  result += '    swprintf(buf, 128, L"%.15g", value);\n'
  result += '    return YC_TEXT(buf);\n'
  result += '}\n\n'
  result += 'static YC_TEXT yc_value_to_text(float value) {\n'
  result += '    return yc_value_to_text((double)value);\n'
  result += '}\n\n'
  result += 'static YC_TEXT yc_value_to_text(const wchar_t* value) {\n'
  result += '    return YC_TEXT(value ? value : L"");\n'
  result += '}\n\n'
  result += 'static YC_TEXT yc_value_to_text(const YC_TEXT& value) {\n'
  result += '    return value;\n'
  result += '}\n\n'
  // 数组转文本：{1, 2, 3}（调试输出 数组变量/数组字面量 用；浮点元素按位模式存无类型标记，按整数显示）
  result += 'static YC_TEXT yc_value_to_text(const std::vector<long long>& a) {\n'
  result += '    std::wstring out = L"数组:" + std::to_wstring(a.size()) + L"{";\n'
  result += '    for (size_t i = 0; i < a.size(); i++) { if (i) out += L","; out += std::to_wstring(a[i]); }\n'
  result += '    out += L"}";\n'
  result += '    return YC_TEXT(std::move(out));\n'
  result += '}\n\n'
  // 浮点族数组转文本（元素为 double 位模式）
  result += 'static YC_TEXT yc_ary_to_text_f64(const std::vector<long long>& a) {\n'
  result += '    std::wstring out = L"数组:" + std::to_wstring(a.size()) + L"{";\n'
  result += '    wchar_t buf[128];\n'
  result += '    for (size_t i = 0; i < a.size(); i++) { if (i) out += L","; swprintf(buf, 128, L"%.15g", yc_f64_from_bits(a[i])); out += buf; }\n'
  result += '    out += L"}";\n'
  result += '    return YC_TEXT(std::move(out));\n'
  result += '}\n\n'
  // 文本数组转文本（元素为堆拷贝的 wchar_t* 指针位模式）
  result += 'static YC_TEXT yc_ary_to_text_str(const std::vector<long long>& a) {\n'
  result += '    std::wstring out = L"数组:" + std::to_wstring(a.size()) + L"{";\n'
  result += '    for (size_t i = 0; i < a.size(); i++) { if (i) out += L","; const wchar_t* s = (const wchar_t*)(intptr_t)a[i]; out += L"“"; out += (s ? s : L""); out += L"”"; }\n'
  result += '    out += L"}";\n'
  result += '    return YC_TEXT(std::move(out));\n'
  result += '}\n\n'
  // 字节集转文本：{1, 2, 3}（调试输出 字节集 用）
  result += 'static YC_TEXT yc_value_to_text(const YC_BIN& b) {\n'
  result += '    std::wstring out = L"字节集:" + std::to_wstring(b.size()) + L"{";\n'
  result += '    for (size_t i = 0; i < b.size(); i++) { if (i) out += L","; out += std::to_wstring((int)b[i]); }\n'
  result += '    out += L"}";\n'
  result += '    return YC_TEXT(std::move(out));\n'
  result += '}\n\n'
  // 字节集数组转文本（元素为堆拷贝的 YC_BIN* 指针位模式）——套用上面的 字节集:N{…} 逐元素打印
  result += 'static YC_TEXT yc_ary_to_text_bin(const std::vector<long long>& a) {\n'
  result += '    std::wstring out = L"数组:" + std::to_wstring(a.size()) + L"{";\n'
  result += '    for (size_t i = 0; i < a.size(); i++) { if (i) out += L","; const YC_BIN* p = (const YC_BIN*)(intptr_t)a[i]; out += p ? yc_value_to_text(*p).s : std::wstring(L"字节集:0{}"); }\n'
  result += '    out += L"}";\n'
  result += '    return YC_TEXT(std::move(out));\n'
  result += '}\n\n'
  result += 'static YC_TEXT yc_value_to_text(const YC_BIG& value) {\n'
  result += '    std::wstring out;\n'
  result += '    if (value.neg && value.digits != "0") out.push_back(L\'-\');\n'
  result += '    for (char c : value.digits) out.push_back((wchar_t)c);\n'
  result += '    return YC_TEXT(std::move(out));\n'
  result += '}\n\n'
  // 调试输出 的值格式化（照易语言）：文本带全角引号标记类型，数值/容器原样。
  // C++ 重载按实参静态类型自动分发，转译器无需类型推断。
  result += 'static YC_TEXT yc_dbg_fmt(const wchar_t* v) { std::wstring o = L"“"; o += (v ? v : L""); o += L"”"; return YC_TEXT(std::move(o)); }\n'
  result += 'static YC_TEXT yc_dbg_fmt(long long v) { return yc_value_to_text(v); }\n'
  result += 'static YC_TEXT yc_dbg_fmt(int v) { return yc_value_to_text((long long)v); }\n'
  result += 'static YC_TEXT yc_dbg_fmt(short v) { return yc_value_to_text((long long)v); }\n'
  result += 'static YC_TEXT yc_dbg_fmt(unsigned char v) { return yc_value_to_text((long long)v); }\n'
  result += 'static YC_TEXT yc_dbg_fmt(double v) { return yc_value_to_text(v); }\n'
  result += 'static YC_TEXT yc_dbg_fmt(float v) { return yc_value_to_text((double)v); }\n'
  result += 'static YC_TEXT yc_dbg_fmt(const std::vector<long long>& v) { return yc_value_to_text(v); }\n'
  result += 'static YC_TEXT yc_dbg_fmt(const YC_BIN& v) { return yc_value_to_text(v); }\n'
  result += 'static YC_TEXT yc_dbg_fmt(const YC_BIG& v) { return yc_value_to_text(v); }\n\n'
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
      // 常量值直接铺进 #define（不走 translateExpressionToC，故也没有乘除拆分）→ ÷ 哨兵在此就地落地
      const cValue = inlineRealDiv(replaceConstantRefs(convertFullWidthOps((c.value || '0').trim() || '0')))
      if (libraryConstants.some(lc => lc.name === c.name)) {
        result += `#undef ${c.name}\n`
      }
      result += `#define ${c.name} (${cValue})\n`
    }
    result += '\n'
  }

  if (projectResources.length > 0) {
    const validIdentifier = /^[\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_]*$/
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
  const buildMethodSignature = (params: Array<{ name: string; type: string; isArray?: boolean }>): string => {
    if (params.length === 0) return 'void'
    return params.map(p => (p.isArray ? `std::vector<long long>& ${p.name}` : `${mapTypeToCType(p.type)} ${p.name}`)).join(', ')
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
        : sub.params.map(p => (p.isArray ? `std::vector<long long>& ${p.name}` : `${mapTypeToCType(p.type)} ${p.name}`)).join(', ')
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
  let subParams: Array<{ name: string; type: string; isArray?: boolean }> = []
  let subBody = ''
  let blockIndent = 1
  let flowStack: Array<{ name: string; lineNo: number; hasElse: boolean }> = []
  let loopTempIndex = 0
  let pendingBreakpointLine: number | null = null
  let visibleDebugVars: Array<{ name: string; type: string }> = []
  // 正在转译的 .eyc 行号：随生成的每行 C++ 打成 /*@行号*/ 前缀，供编译报错回溯到易语言源码（见 loadEycOrigin）
  let currentEycLine = 0

  const buildSubSignature = (_name: string, params: Array<{ name: string; type: string; isArray?: boolean }>): string => {
    if (params.length === 0) return 'void'
    return params.map(p => (p.isArray ? `std::vector<long long>& ${p.name}` : `${mapTypeToCType(p.type)} ${p.name}`)).join(', ')
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
    const origin = currentEycLine > 0 ? `/*@${currentEycLine}*/` : ''
    subBody += `${origin}${'    '.repeat(Math.max(1, blockIndent))}${code}\n`
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
    try {
    const rawLine = lines[lineIndex]
    currentEycLine = lineIndex + 1
    pendingBreakpointLine = inSub && breakpointLines.has(lineIndex + 1) ? (lineIndex + 1) : null
    // 剥离流程标记零宽字符（\u200C/\u200D/\u2060/\u200B）与行尾单引号注释
    const line = stripTrailingEycComment(rawLine.replace(/[\u200B\u200C\u200D\u2060]/g, '').trim())
    if (line === '') continue

    if (!inSub && line.startsWith('.程序集变量 ')) {
      const parts = splitDeclPartsQuoted(line.substring(6))
      const varName = parts[0] || 'assemblyVar'
      const varType = parts[1] || '整数型'
      // parts[2]=公开，parts[3]=数组尺寸
      const dims = parseArrayDimsField(parts[3])
      if (dims.isArray && !isClassModuleSource) {
        if (dims.invalid) throwSourceError(lineIndex + 1, dims.invalid)
        if (!isSupportedArrayElemType(varType)) {
          throwSourceError(lineIndex + 1, `暂不支持 ${varType} 数组（${SUPPORTED_ARRAY_ELEM_HINT}）`)
        }
        const dimTotal = dims.dims.reduce((acc, n) => acc * n, 1)
        result += `static std::vector<long long> ${varName}${dims.dims.length > 0 ? `(${dimTotal}, 0)` : ''};\n`
        fileScopeArrayVars.set(varName, { elemType: varType, dims: dims.dims })
        continue
      }
      assemblyVars.push({ name: varName, type: varType })
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
      currentTranspileArrayVars = new Map(fileScopeArrayVars)
      visibleDebugVars = [
        ...projectGlobals.map(gv => ({ name: gv.name, type: gv.type })),
        ...assemblyVars.map(av => ({ name: av.name, type: av.type })),
      ]
      continue
    }

    if (inSub && line.startsWith('.参数 ')) {
      const parts = splitDeclPartsQuoted(line.substring(3))
      const paramName = (parts[0] || '').trim()
      const paramType = (parts[1] || '整数型').trim()
      if (paramName) {
        const isArrayParam = parts.slice(2).includes('数组')
        if (isArrayParam && !isSupportedArrayElemType(paramType)) {
          throwSourceError(lineIndex + 1, `暂不支持 ${paramType} 数组参数（${SUPPORTED_ARRAY_ELEM_HINT}）`)
        }
        subParams.push({ name: paramName, type: paramType, isArray: isArrayParam })
        if (isArrayParam) {
          // 参数维度未知，按动态一维处理（多维数组传参时在被调方按线性一基访问）
          currentTranspileArrayVars.set(paramName, { elemType: paramType, dims: [] })
        } else {
          pushVisibleDebugVar(paramName, paramType)
        }
      }
      continue
    }

    if (line.startsWith('.局部变量 ')) {
      const parts = splitDeclPartsQuoted(line.substring(5))
      const varName = parts[0] || 'v'
      const varType = parts[1] || '整数型'
      // parts[2]=静态，parts[3]=数组尺寸（"0"=动态数组）
      const dims = parseArrayDimsField(parts[3])
      if (dims.isArray) {
        if (dims.invalid) throwSourceError(lineIndex + 1, dims.invalid)
        if (!isSupportedArrayElemType(varType)) {
          throwSourceError(lineIndex + 1, `暂不支持 ${varType} 数组（${SUPPORTED_ARRAY_ELEM_HINT}）`)
        }
        const dimTotal = dims.dims.reduce((acc, n) => acc * n, 1)
        emitSubLine(`std::vector<long long> ${varName}${dims.dims.length > 0 ? `(${dimTotal}, 0)` : ''};`)
        currentTranspileArrayVars.set(varName, { elemType: varType, dims: dims.dims })
        continue
      }
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

        // "判断开始" 块内的 ".判断 (条件)" 是新分支（else if），与表格编辑器落盘结构一致：
        // .判断开始 (c1) / 正文 / .判断 (c2) / 正文 / .默认 / 正文 / .判断结束
        if (flowName === '判断' && flowStack[flowStack.length - 1]?.name === '判断开始') {
          const currentFlow = flowStack[flowStack.length - 1]
          if (currentFlow.hasElse) {
            throwSourceError(lineIndex + 1, '.默认 之后不能再出现 .判断 分支')
          }
          const cond = formatArgForC(flowCall?.args?.[0] || '0', commandMap, directCallables)
          blockIndent = Math.max(1, blockIndent - 1)
          emitSubLine(`} else if ${wrapConditionForC(cond)} {`)
          blockIndent++
          continue
        }

        if (flowName === '如果' || flowName === '如果真' || flowName === '判断' || flowName === '判断开始') {
          const cond = formatArgForC(flowCall?.args?.[0] || '0', commandMap, directCallables)
          emitSubLine(`if ${wrapConditionForC(cond)} {`)
          blockIndent++
          flowStack.push({ name: flowName, lineNo: lineIndex + 1, hasElse: false })
          continue
        }

        if (flowName === '否则' || flowName === '默认') {
          const currentFlow = flowStack[flowStack.length - 1]
          const expectedStarts = flowName === '默认' ? ['判断', '判断开始'] : ['如果']
          if (!currentFlow || !expectedStarts.includes(currentFlow.name)) {
            throwSourceError(lineIndex + 1, `.${flowName} 没有匹配的 .${expectedStarts[0]}`)
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
          const expectedStarts = flowName === '判断结束' ? ['判断', '判断开始'] : flowName === '如果真结束' ? ['如果真'] : ['如果']
          if (!currentFlow || !expectedStarts.includes(currentFlow.name)) {
            throwSourceError(lineIndex + 1, `.${flowName} 没有匹配的 .${expectedStarts[0]}`)
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

      // 数组下标赋值：数组 [i] ＝ 右值 / 矩阵 [i] [j] ＝ 右值 → yc_ary_at 引用做左值（一基，
      // 多维链式下标折算行主序线性下标；浮点族元素经 yc_f64_bits 存位模式）
      const idxAssignTarget = parseIndexedAssignTarget(line)
      if (idxAssignTarget) {
        const info = currentTranspileArrayVars.get(idxAssignTarget.name)
        if (info) {
          const expectDims = Math.max(1, info.dims.length)
          if (idxAssignTarget.indexExprs.length !== expectDims) {
            throwSourceError(lineIndex + 1, `数组“${idxAssignTarget.name}”是 ${expectDims} 维，但下标给了 ${idxAssignTarget.indexExprs.length} 组`)
          }
          const idxParts = idxAssignTarget.indexExprs.map(g => translateExpressionToC(g, commandMap, directCallables, resolveVisibleVarType))
          const linear = buildAryLinearIndexExpr(idxParts, info.dims)
          const rhsC = translateExpressionToC(idxAssignTarget.rhs, commandMap, directCallables, resolveVisibleVarType)
          const kind = arrayElemKindOf(info)
          // text/bin 与 mapYcmdArrayElemValueParam 同策：先显式转到指针类型再堆拷贝存指针位模式。
          // （原文本分支 `(intptr_t)yc_value_to_text(...)` 编不过——C 风格转换不肯把 YC_TEXT
          //  连着经 operator const wchar_t*() 再转 intptr_t，故「文本数组[i] ＝ 值」一直是死路。）
          const valueExpr = kind === 'f64' ? `yc_f64_bits((double)(${rhsC}))`
            : kind === 'text' ? `(long long)(intptr_t)yc_wcsdup_text((const wchar_t*)yc_value_to_text(${rhsC}))`
            : kind === 'bin' ? `(long long)(intptr_t)yc_bin_dup(${rhsC})`
            : `(long long)(${rhsC})`
          emitSubLine(`yc_ary_at(${idxAssignTarget.name}, ${linear}) = ${valueExpr};`)
          continue
        }
      }

      // 数组变量整体赋值字面量：数组 ＝ { 1, 2, 3 }（元素存储形态按数组声明的元素类型定）
      const aryLitAssign = line.match(/^([一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*)\s*[＝=]\s*([{｛][\s\S]*)$/)
      if (aryLitAssign && currentTranspileArrayVars.has(aryLitAssign[1])) {
        const info = currentTranspileArrayVars.get(aryLitAssign[1])!
        const lit = matchArrayLiteral(aryLitAssign[2])
        if (lit) {
          const litC = buildArrayLiteralExpr(lit.inner, commandMap, directCallables, resolveVisibleVarType, arrayElemKindOf(info))
          emitSubLine(`${aryLitAssign[1]} = ${litC};`)
          continue
        }
      }

      // 赋值表达式：支持全角/半角等号
      const assignMatch = line.match(/^([\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]*)\s*[＝=]\s*(.+)$/)
      if (assignMatch) {
        const left = assignMatch[1]
        const rightRaw = assignMatch[2].trim()

        const propMatch = left.match(/^([\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_]*)\.([\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_]*)$/)
        // 控件属性做左值：按控件类型解析协议里声明的 set 模板（进度条.位置、编辑框.内容 等），读写机制来自 window-units.json 而非硬编码。
        // 模板占位 {h}=控件句柄、{v}=原始值、{vtext}=文本化值。
        const propCtrlType = propMatch ? resolveProjectControlType(propMatch[1]) : ''
        const propSetTpl = (propMatch && propCtrlType)
          ? resolveControlMemberTemplate(loadCompileProtocols().controlMembers, propCtrlType, propMatch[2], 'set')
          : null
        // 确属控件（且名字未被同名变量遮蔽）而属性无 set 绑定 → 友好报错并中止，
        // 不再把 `控件.属性` 原样发成 C++ 左值（那会变成难懂的 undeclared identifier）。
        if (propMatch && propCtrlType && !propSetTpl && !resolveVisibleVarType(propMatch[1])) {
          throwSourceError(lineIndex + 1, `${propCtrlType}“${propMatch[1]}”的属性“${propMatch[2]}”暂不支持在代码中赋值`)
        }
        const propSetIsText = !!propSetTpl && propSetTpl.includes('{vtext}')
        const emitPropSet = (valueExpr: string) =>
          emitSubLine(applyMemberTemplate(propSetTpl!, `yc_get_control_handle_by_name(L"${escapeCString(propMatch![1])}")`, valueExpr, [], `L"${escapeCString(propMatch![1])}"`) + ';')

        const rhsCall = parseCommandCall(rightRaw)
        const rhsResolved = rhsCall ? commandMap.get(rhsCall.name) : undefined
        if (rhsCall && rhsResolved) {
          const exprGenerator = COMMAND_EXPR_GENERATORS[rhsResolved.name]
          if (exprGenerator) {
            const expr = exprGenerator(rhsCall.args || [], commandMap, directCallables)
            if (propSetTpl) {
              emitPropSet(expr)
            } else {
              emitSubLine(`${left} = ${expr};`)
            }
            continue
          }
          if (propSetTpl) {
            // 命令返回值赋给控件属性：文本属性取文本形态、其余取通用表达式形态，再经 set 模板（{vtext}/{v} 负责编组）发射。
            const valExpr = isYcmdNativeCommand(rhsResolved)
              ? generateYcmdNativeCommandExpr(rhsResolved, rhsCall.args || [], commandMap, directCallables)
              : (propSetIsText
                  ? generateYcGenericCommandTextExpr(rhsResolved, rhsCall.args || [])
                  : generateYcGenericCommandExpr(rhsResolved, rhsCall.args || []))
            emitPropSet(valExpr)
            continue
          }
          const assignCode = isYcmdNativeCommand(rhsResolved)
            ? `{ ${left} = ${generateYcmdNativeCommandExpr(rhsResolved, rhsCall.args || [], commandMap, directCallables)}; }`
            : generateYcGenericCommandAssign(rhsResolved, rhsCall.args || [], left)
          emitSubLine(assignCode)
          continue
        }

        const leftSimpleVarType = (() => {
          if (!/^[\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_]*$/.test(left)) return ''
          for (let i = visibleDebugVars.length - 1; i >= 0; i--) {
            if (visibleDebugVars[i].name === left) return (visibleDebugVars[i].type || '').trim()
          }
          return ''
        })()

        // 字节集字面量赋值（易语言 { 1, 2, 3 } 亦为字节集常量）：按元素构造 YC_BIN
        if (leftSimpleVarType === '字节集') {
          const binLit = matchArrayLiteral(rightRaw)
          if (binLit) {
            const parts = splitArguments(binLit.inner).filter(e => e.trim().length > 0)
              .map(e => translateExpressionToC(e, commandMap, directCallables, resolveVisibleVarType))
            emitSubLine(`${left} = YC_BIN{${parts.map(x => `(unsigned char)(${x})`).join(', ')}};`)
            continue
          }
        }

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

        if (propSetTpl) {
          emitPropSet(right)
          continue
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
        // 控件成员方法（语句上下文，如 组合框1.加入项目("x")）：先声明式协议派发，未命中回退旧路。
        const stmtMethodTx = (e: string) => translateExpressionToC(e, commandMap, directCallables, resolveVisibleVarType)
        const llCall = call && call.name
          ? (translateControlMethodCall(call, stmtMethodTx) ?? translateListLikeMethodCall(call, stmtMethodTx))
          : null
        if (llCall) {
          emitSubLine(`${llCall};`)
        } else if (call && call.name) {
          // `控件.方法(…)` 未命中任何绑定 → 友好报错（原样发出去必是 undeclared identifier）。
          // 对象/方法段须均为纯标识符（防 parseCommandCall 吞并运算表达式后误报，与表达式路同款守卫）。
          const dotAt = call.name.lastIndexOf('.')
          if (dotAt > 0) {
            const objName = call.name.slice(0, dotAt)
            const method = call.name.slice(dotAt + 1)
            const objType = /^[一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*$/.test(objName) && /^[一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*$/.test(method)
              ? resolveProjectControlType(objName)
              : ''
            if (objType && !resolveVisibleVarType(objName)) {
              throwSourceError(lineIndex + 1, `${objType}“${objName}”的方法“${method}”暂不支持在代码中调用`)
            }
          }
          const cArgs = call.args.map(a => formatArgForC(a, commandMap, directCallables)).join(', ')
          emitSubLine(`${call.name}(${cArgs});`)
        } else {
          emitSubLine(`/* ${line} */`)
        }
      }
    }
    } catch (e) {
      // 深层转译错误统一补「文件名:行号:」前缀（throwSourceError 已带前缀的原样重抛）
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.startsWith(`${fileName}:`)) throw e
      throwSourceError(lineIndex + 1, msg)
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
  previewWindow?: string, // 非空 = 窗口预览：以该窗体为启动窗口 + 跳过源代码转译
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
  mainCode += '#include <windows.h>\n#include <commctrl.h>\n#include <shellapi.h>\n#include <stdint.h>\n#include <stdio.h>\n#include <string.h>\n#include <stdlib.h>\n#include <io.h>\n#include <fcntl.h>\n#include <gdiplus.h>\n#include <string>\n#include <map>\n#include <vector>\n'
  // 部分 mingw commctrl.h 未定义较新的通用控件常量（SysLink 注册用），补齐守卫。
  mainCode += '#ifndef ICC_LINK_CLASSES\n#define ICC_LINK_CLASSES 0x00008000\n#endif\n\n'
  // 文本型值类型（与转译文件里的定义一致，供 yc_ctrl_get_text 跨编译单元按值返回）
  mainCode += 'struct YC_TEXT {\n    std::wstring s;\n    YC_TEXT() {}\n    YC_TEXT(const wchar_t* p) : s(p ? p : L"") {}\n    YC_TEXT(const std::wstring& w) : s(w) {}\n    YC_TEXT(std::wstring&& w) : s(std::move(w)) {}\n    operator const wchar_t*() const { return s.c_str(); }\n    const wchar_t* c_str() const { return s.c_str(); }\n    bool empty() const { return s.empty(); }\n};\n\n'
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
    // 编译报错要回显易语言源码行。这里存的是**实际参与转译的** content（含编辑器里未保存的改动），
    // 且在转译缓存命中的分支之前——缓存命中不重跑转译，但报错回显仍然需要源码。
    activeEycSourceLines.set(fileName, content.split('\n'))
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
    // 查找启动窗口文件（预览时优先用指定的当前窗体作为启动窗口）
    let efwFile = previewWindow
      ? project.files.find(f => f.type === 'EFW' && (f.fileName === previewWindow || basename(f.fileName, '.efw') === previewWindow))
      : undefined
    if (!efwFile) efwFile = project.files.find(f => f.fileName === '_启动窗口.efw')
    if (!efwFile) efwFile = project.files.find(f => f.type === 'EFW')

    const defaultWindowFormName = efwFile ? basename(efwFile.fileName, '.efw') : '_启动窗口'
    let winInfo: WindowFileInfo = createDefaultWindowFileInfo(defaultWindowFormName, project.projectName)
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
          applyWindowProperties(winInfo, data.properties || {})
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
          if (Array.isArray(data.menu)) winInfo.menu = data.menu as MenuNodeInfo[]
        } catch { /* fall through to file */ }
      } else {
        winInfo = parseWindowFile(join(project.projectDir, efwFile.fileName))
      }
    }

    const windowEventTarget = (winInfo.formName || defaultWindowFormName || '_启动窗口').trim() || '_启动窗口'
    // 窗口事件名 = `_` + 原始窗口名 + `_事件`：_启动窗口 的事件是「__启动窗口_创建完毕」（双下划线合法，
    // 与编辑器双击窗体生成的子程序名一致）。不要剥前导下划线——只有程序集名（窗口程序集_核心名）才剥。
    const windowEventPrefix = `_${windowEventTarget}`

    // 停留顺序决定控件创建顺序（Win32 Tab 焦点顺序 = 创建顺序），数值小者优先，相同时保持原序。
    // 注意：必须在所有按 winInfo.controls 顺序生成代码（IDC 宏/创建/事件分发）之前排序，保证 ctrlId 一致。
    winInfo.controls = winInfo.controls
      .map((c, i) => ({ c, i }))
      .sort((a, b) => (readIntProp(a.c.extraProps['停留顺序'], 0) - readIntProp(b.c.extraProps['停留顺序'], 0)) || (a.i - b.i))
      .map(x => x.c)

    // 全局变量
    mainCode += `static const wchar_t* g_szClassName = L"${winInfo.wndClassName ? escapeCString(winInfo.wndClassName) : 'ycIDEWindowClass'}";\n`
    mainCode += `static const wchar_t* g_szTitle = L"${escapeCString(winInfo.title)}";\n`
    mainCode += `static int g_nWidth = ${winInfo.width};\n`
    mainCode += `static int g_nHeight = ${winInfo.height};\n`
    mainCode += 'static HINSTANCE g_hInstance;\n'
    mainCode += 'static HWND g_hMainWnd = NULL;\n'
    // 窗体背景刷全局化：类注册与 WM_PRINTCLIENT（主题化公共控件向父窗要背景）共用
    mainCode += 'static HBRUSH g_hFormBgBrush = NULL;\n\n'

    // 底图（背景图片）/ 图标 / 按钮图片：把选中的图片文件字节内嵌为数组，运行时经 GDI+ 从内存流解码
    const backImageBytes = winInfo.backImage ? decodeImageDataUrl(winInfo.backImage) : null
    const iconImageBytes = winInfo.iconImage ? decodeImageDataUrl(winInfo.iconImage) : null
    // 按索引与 winInfo.controls 对齐（controls 已按停留顺序排序，两处循环同序）
    const controlImageBytes: Array<Buffer | null> = winInfo.controls.map(c => {
      // 图片框/按钮用「图片」，画板/标签用「底图」
      const img = (c.type === '画板' || c.type === 'DrawPanel' || c.type === '标签' || c.type === 'Label') ? c.extraProps?.['底图'] : c.extraProps?.['图片']
      return (typeof img === 'string' && img.startsWith('data:image')) ? decodeImageDataUrl(img) : null
    })
    const hasAnyControlImage = controlImageBytes.some(Boolean)
    // 画板即使无底图也用 GDI+（取图片 PNG 编码、画图片 字节集解码），故 GDI+ 门控含画板
    const hasDrawPanel = winInfo.controls.some(c => c.type === '画板' || c.type === 'DrawPanel')
    if (backImageBytes || iconImageBytes || hasAnyControlImage || hasDrawPanel) {
      mainCode += 'static ULONG_PTR g_gdiplusToken = 0;\n'
    }
    if (backImageBytes) {
      mainCode += `static const unsigned char g_backImageData[] = {\n${bytesToCArrayBody(backImageBytes)}};\n`
      mainCode += `static const unsigned int g_backImageSize = ${backImageBytes.length}u;\n`
      mainCode += 'static Gdiplus::Image* g_backImage = NULL;\n'
    }
    if (iconImageBytes) {
      mainCode += `static const unsigned char g_iconImageData[] = {\n${bytesToCArrayBody(iconImageBytes)}};\n`
      mainCode += `static const unsigned int g_iconImageSize = ${iconImageBytes.length}u;\n`
      mainCode += 'static HICON g_hWindowIcon = NULL;\n'
    }
    controlImageBytes.forEach((bytes, idx) => {
      if (bytes) {
        mainCode += `static const unsigned char g_ctrlImg_${idx}[] = {\n${bytesToCArrayBody(bytes)}};\n`
        mainCode += `static const unsigned int g_ctrlImgSize_${idx} = ${bytes.length}u;\n`
      }
    })
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

    mainCode += 'HWND yc_get_control_handle_by_name(const wchar_t* ctrlName) {\n'
    mainCode += '    if (!ctrlName || !g_hMainWnd) return NULL;\n'
    // 窗体名解析到主窗句柄——`窗口名.标题/宽度/可视` 等经通用控件属性绑定直接作用于窗口本身
    mainCode += `    if (lstrcmpW(ctrlName, L"${escapeCString(winInfo.formName)}") == 0) return g_hMainWnd;\n`
    for (const ctrl of winInfo.controls) {
      mainCode += `    if (lstrcmpW(ctrlName, L"${escapeCString(ctrl.name)}") == 0) return GetDlgItem(g_hMainWnd, IDC_${ctrl.name.toUpperCase()});\n`
    }
    mainCode += '    return NULL;\n'
    mainCode += '}\n\n'

    // 控件文本读取：Win32 机制（GetWindowTextW）已搬入 krnln 库（krnln_ctrl_get_text 返回 malloc 独占宽串拷贝）。
    // 此处仅保留把库返回的 owned wchar_t* 包成 YC_TEXT 值（编译器内部文本类型，不宜跨库 ABI 直出）的薄封装。
    mainCode += 'extern "C" wchar_t* krnln_ctrl_get_text(HWND h);\n'
    mainCode += 'extern "C" void krnln_ctrl_free_text(wchar_t* p);\n'
    mainCode += 'YC_TEXT yc_ctrl_get_text(HWND h) {\n'
    mainCode += '    wchar_t* p = krnln_ctrl_get_text(h);\n'
    mainCode += '    YC_TEXT t(p ? p : L"");\n'
    mainCode += '    krnln_ctrl_free_text(p);\n'
    mainCode += '    return t;\n'
    mainCode += '}\n\n'

    // 控件「标记」/日期属性文本读取：同款薄封装（库返 owned wchar_t* → YC_TEXT）
    mainCode += 'extern "C" wchar_t* krnln_ctrl_get_tag(HWND h);\n'
    mainCode += 'extern "C" wchar_t* krnln_ctrl_get_date(HWND h, const wchar_t* prop);\n'
    mainCode += 'YC_TEXT yc_ctrl_get_tag(HWND h) { wchar_t* p = krnln_ctrl_get_tag(h); YC_TEXT t(p ? p : L""); krnln_ctrl_free_text(p); return t; }\n'
    mainCode += 'YC_TEXT yc_ctrl_get_date(HWND h, const wchar_t* prop) { wchar_t* p = krnln_ctrl_get_date(h, prop); YC_TEXT t(p ? p : L""); krnln_ctrl_free_text(p); return t; }\n'
    mainCode += 'extern "C" wchar_t* krnln_ctrl_get_seltext(HWND h);\n'
    mainCode += 'YC_TEXT yc_ctrl_get_seltext(HWND h) { wchar_t* p = krnln_ctrl_get_seltext(h); YC_TEXT t(p ? p : L""); krnln_ctrl_free_text(p); return t; }\n\n'

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

    // 日期框/月历日期属性：解析 "年/月/日 [时:分:秒]"（分隔符 / 或 -）为 SYSTEMTIME。
    mainCode += 'static int yc_parse_systemtime(const wchar_t* s, SYSTEMTIME* st) {\n'
    mainCode += '    if (!s || !st || !s[0]) return 0; ZeroMemory(st, sizeof(SYSTEMTIME));\n'
    mainCode += '    int y=0,mo=0,d=0,h=0,mi=0,se=0;\n'
    mainCode += '    int n = swscanf(s, L"%d%*[-/.]%d%*[-/.]%d %d:%d:%d", &y,&mo,&d,&h,&mi,&se);\n'
    mainCode += '    if (n < 3 || y < 1601 || mo < 1 || mo > 12 || d < 1 || d > 31) return 0;\n'
    mainCode += '    st->wYear=(WORD)y; st->wMonth=(WORD)mo; st->wDay=(WORD)d; st->wHour=(WORD)h; st->wMinute=(WORD)mi; st->wSecond=(WORD)se;\n'
    mainCode += '    return 1;\n'
    mainCode += '}\n\n'

    // 组合框/列表框 项目成员方法：纯 Win32 版已搬入 krnln 库（krnln_ll_*/krnln_lb_* HWND 版）。
    // 此处仅留：①文本读取 YC_TEXT 薄封装（库返回 owned wchar_t*）；②取所有被选择项目（std::vector 返回，编译器内部类型）。
    mainCode += 'extern "C" wchar_t* krnln_ll_get_text(HWND h, int idx);\n'
    mainCode += 'YC_TEXT yc_ll_get_text(HWND h, int idx){ wchar_t* p=krnln_ll_get_text(h, idx); YC_TEXT t(p?p:L""); if(p) free(p); return t; }\n'
    mainCode += 'std::vector<long long> yc_lb_get_sel_items(HWND h){ std::vector<long long> r; if(!h) return r; int cnt=(int)SendMessageW(h, LB_GETSELCOUNT, 0, 0); if(cnt<=0) return r; std::vector<int> ix(cnt); if(SendMessageW(h, LB_GETSELITEMS, (WPARAM)cnt, (LPARAM)ix.data())!=LB_ERR){ for(int i=0;i<cnt;i++) r.push_back((long long)ix[i]); } return r; }\n\n'

    // 控件成员访问按控件类型键控派发：转译前从项目所有窗口(.efw)灌一次「控件名→类型」表。
    // 只有确属控件的 `名.成员` 才走声明式读写，避免与自定义类型成员撞名。
    // 窗体名也注册为「窗口」类型——`窗口名.标题/宽度/可视` 等经通用绑定生效（启动窗口经名字解析到 g_hMainWnd；
    // 非启动窗口暂解析不到句柄，运行时为无害空操作，与声明式化前的行为一致）。
    currentProjectControls = new Map<string, string>()
    // 已知常量名（供颜色名色转换防遮蔽）：库常量 + 项目常量，剥去前导 #。
    currentKnownConstantNames = new Set<string>()
    for (const c of libraryConstants) currentKnownConstantNames.add((c.name || '').replace(/^#/, ''))
    for (const c of projectConstants) currentKnownConstantNames.add((c.name || '').replace(/^#/, ''))
    for (const f of project.files) {
      if (f.type !== 'EFW' && !f.fileName.toLowerCase().endsWith('.efw')) continue
      const efwEditorContent = editorFiles?.get(f.fileName)
      let formName = ''
      let ctrls: Array<{ name?: unknown; type?: unknown }> = []
      if (efwEditorContent) {
        try {
          const d = JSON.parse(efwEditorContent)
          ctrls = Array.isArray(d.controls) ? d.controls : []
          formName = typeof d.name === 'string' ? d.name : ''
        } catch { /* ignore */ }
      } else {
        const parsed = parseWindowFile(join(project.projectDir, f.fileName))
        ctrls = parsed.controls
        formName = parsed.formName || ''
      }
      if (formName) currentProjectControls.set(formName, '窗口')
      for (const c of ctrls) {
        const nm = typeof c?.name === 'string' ? c.name : ''
        const ty = typeof c?.type === 'string' ? c.type : ''
        if (nm && ty) currentProjectControls.set(nm, ty)
      }
    }

    // 查找关联的 .eyc 文件并转译。
    // 预览模式：跳过所有源代码转译——不生成任何用户 .cpp，事件处理全部回退到 main.cpp 里的
    // WEAK 空实现，于是窗口能显示、控件在位，但点击等无任何逻辑（即“编译窗口不编译源代码”）。
    if (!previewWindow) {
      for (const f of project.files) {
        if (f.type !== 'EYC' && f.type !== 'EGV' && f.type !== 'ECS' && f.type !== 'EDT' && f.type !== 'ELL') continue
        const eycPath = join(project.projectDir, f.fileName)
        const editorContent = editorFiles?.get(f.fileName)
        const content = editorContent || (existsSync(eycPath) ? readFileSync(eycPath, 'utf-8') : '')
        if (!content) continue

        transpileProjectFile(f.fileName, content, libraryConstants)
      }
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

    // 编辑框/标签颜色表：WM_CTLCOLOREDIT/WM_CTLCOLORSTATIC 按控件 ID 查表上色（只读编辑框、标签走 STATIC 通道）
    // transparent=1（标签效果=透明）时不填底色、返回 NULL_BRUSH 让父窗口透出。
    const editColorEntries: Array<{ idMacro: string; textColor: number; backColor: number; transparent: number }> = []
    let anyEditNeedsInputFilter = false
    {
      for (const ctrl of winInfo.controls) {
        const unitInfo = allUnits.find(u => u.name === ctrl.type || u.englishName === ctrl.type)
        const libraryFileName = unitInfo ? (libNameToFileName.get(normalizeKey(unitInfo.libraryName)) || '') : ''
        const className = resolveControlClassName(ctrl.type, unitInfo, libraryFileName, controlProtocolBindings)
        if (className === 'EDIT') {
          const editCodegenInfo = buildStdEditCodegen(ctrl.extraProps)
          if (editCodegenInfo.colorEntry) {
            editColorEntries.push({ idMacro: `IDC_${ctrl.name.toUpperCase()}`, ...editCodegenInfo.colorEntry, transparent: 0 })
          }
          if (editCodegenInfo.needsInputFilter) anyEditNeedsInputFilter = true
        } else if (ctrl.type === '标签' || ctrl.type === 'Label') {
          const lc = buildStdLabelCodegen(ctrl.extraProps)
          // 有底图/渐变背景的标签：文字必须以透明背景模式画在图/渐变上（transparent 路径 = SetBkMode(TRANSPARENT)+NULL_BRUSH，
          // 擦除由 YcLblBgProc 子类的 WM_ERASEBKGND 负责画图/渐变），否则文字自带底色矩形会在其上打洞。
          const lblHasBgImg = !!controlImageBytes[winInfo.controls.indexOf(ctrl)]
          const lblHasGrad = readIntProp(ctrl.extraProps?.['渐变背景方式'], 0) !== 0
          if (lc.colorEntry || lc.transparent || lblHasBgImg || lblHasGrad) {
            editColorEntries.push({
              idMacro: `IDC_${ctrl.name.toUpperCase()}`,
              textColor: lc.colorEntry?.textColor ?? 0,
              backColor: lc.colorEntry?.backColor ?? 0xffffff,
              transparent: (lc.transparent || lblHasBgImg || lblHasGrad) ? 1 : 0,
            })
          }
        } else if (ctrl.type === '选择框' || ctrl.type === 'CheckBox' || ctrl.type === '单选框' || ctrl.type === 'RadioBox') {
          const cc = buildStdCheckableCodegen(ctrl.extraProps, ctrl.type === '单选框' || ctrl.type === 'RadioBox')
          if (cc.colorEntry) editColorEntries.push({ idMacro: `IDC_${ctrl.name.toUpperCase()}`, ...cc.colorEntry, transparent: 0 })
        } else if (ctrl.type === '分组框' || ctrl.type === 'GroupBox') {
          const gc = buildStdGroupBoxCodegen(ctrl.extraProps)
          if (gc.colorEntry) editColorEntries.push({ idMacro: `IDC_${ctrl.name.toUpperCase()}`, ...gc.colorEntry, transparent: 0 })
        } else if (ctrl.type === '图片框' || ctrl.type === 'PicBox') {
          const img = ctrl.extraProps?.['图片']
          const hasImg = typeof img === 'string' && img.startsWith('data:image')
          const pc = buildStdPicBoxCodegen(ctrl.extraProps, hasImg)
          if (pc.colorEntry) editColorEntries.push({ idMacro: `IDC_${ctrl.name.toUpperCase()}`, ...pc.colorEntry, transparent: 0 })
        } else if (ctrl.type === '组合框' || ctrl.type === 'ComboBox') {
          const cbc = buildStdComboBoxCodegen(ctrl.extraProps)
          if (cbc.colorEntry) editColorEntries.push({ idMacro: `IDC_${ctrl.name.toUpperCase()}`, ...cbc.colorEntry, transparent: 0 })
        } else if (className === 'LISTBOX') {
          const lbc = buildStdListBoxCodegen(ctrl.extraProps, ctrl.type === '选择列表框' || ctrl.type === 'ChkListBox')
          if (lbc.colorEntry) editColorEntries.push({ idMacro: `IDC_${ctrl.name.toUpperCase()}`, ...lbc.colorEntry, transparent: 0 })
        }
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
    {
      // 颜色表始终生成（空占位 id=0 永不匹配）：WM_CTLCOLOR* case 恒存在，未配色控件的兜底路径对所有项目一致
      mainCode += '/* 编辑框自定义颜色表 */\n'
      mainCode += 'typedef struct { int id; COLORREF textColor; COLORREF backColor; HBRUSH brush; int transparent; } YcEditColorEntry;\n'
      mainCode += 'static YcEditColorEntry g_ycEditColors[] = {\n'
      for (const entry of editColorEntries) {
        mainCode += `    { ${entry.idMacro}, (COLORREF)${entry.textColor}, (COLORREF)${entry.backColor}, NULL, ${entry.transparent} },\n`
      }
      if (editColorEntries.length === 0) mainCode += '    { 0, (COLORREF)0, (COLORREF)0, NULL, 0 },\n'
      mainCode += '};\n\n'
    }

    // 运行时「文本颜色」覆盖表 + setter（代码里 `控件.文本颜色 ＝ 颜色`）。文本颜色与生成的
    // WM_CTLCOLOR* + g_ycEditColors 深度纠缠，故 helper 与覆盖表放生成代码（krnln 库不动）。
    // 月历经类名派发到 MCM_SETCOLOR（用户 cpp 无 commctrl.h，须在此 main.cpp 内处理）；
    // 其余共用 WM_CTLCOLOR 的控件写覆盖表并重绘；超级链接框(SysLink)存值但视觉无效（无消息可改链接文字色）。
    mainCode += '/* 运行时文本颜色覆盖 */\n'
    mainCode += 'static std::map<HWND,COLORREF> g_ycTextColorOverride;\n'
    mainCode += 'void yc_ctrl_set_text_color(HWND h, COLORREF c){\n'
    mainCode += '    if(!h) return;\n'
    mainCode += '    wchar_t tcCls[32]=L""; GetClassNameW(h,tcCls,32);\n'
    mainCode += '    if(_wcsicmp(tcCls,L"SysMonthCal32")==0){ SendMessageW(h,MCM_SETCOLOR,MCSC_TEXT,(LPARAM)c); return; }\n'
    mainCode += '    g_ycTextColorOverride[h]=c;\n'
    mainCode += '    InvalidateRect(h,NULL,TRUE);\n'
    mainCode += '}\n\n'

    // 自绘按钮表：按钮设了底色或文本色则 BS_OWNERDRAW，WM_DRAWITEM 按 ID 查表自绘。
    // hasCustomColor 决定是否自绘；textColor<0 表示用默认按钮文本色。
    const buttonDrawEntries: Array<{ idMacro: string; bgColor: number; textColor: number; hAlign: number; vAlign: number; isDefault: boolean }> = []
    for (const ctrl of winInfo.controls) {
      if (!(ctrl.type === '按钮' || ctrl.type === 'Button')) continue
      const backColor = readIntProp(ctrl.extraProps?.['底色'], 0)
      const font = parseControlFont(ctrl.extraProps?.['字体'])
      const textColor = font && typeof font.color === 'number' ? font.color : -1
      if (backColor === 0 && textColor < 0) continue  // 无自定义颜色 → 标准按钮
      buttonDrawEntries.push({
        idMacro: `IDC_${ctrl.name.toUpperCase()}`,
        bgColor: backColor,
        textColor,
        hAlign: readIntProp(ctrl.extraProps?.['横向对齐方式'], 1),
        vAlign: readIntProp(ctrl.extraProps?.['纵向对齐方式'], 1),
        isDefault: readIntProp(ctrl.extraProps?.['类型'], 0) === 1,
      })
    }
    if (buttonDrawEntries.length > 0) {
      mainCode += '/* 自绘按钮颜色表（底色/文本色）*/\n'
      mainCode += 'typedef struct { int id; COLORREF bgColor; LONG textColor; int hAlign; int vAlign; int isDefault; } YcButtonDrawEntry;\n'
      mainCode += 'static YcButtonDrawEntry g_ycButtonDraws[] = {\n'
      for (const e of buttonDrawEntries) {
        mainCode += `    { ${e.idMacro}, (COLORREF)${e.bgColor >>> 0}, ${e.textColor}, ${e.hAlign}, ${e.vAlign}, ${e.isDefault ? 1 : 0} },\n`
      }
      mainCode += '};\n\n'
    }

    // 外形框自绘表：SS_OWNERDRAW 静态框，WM_DRAWITEM(ODT_STATIC) 按 ID 查表画形状/线条/填充。
    const shapeBoxEntries: Array<{ idMacro: string; shape: number; effect: number; lineStyle: number; lineWidth: number; lineColor: number; fillColor: number; backColor: number }> = []
    for (const ctrl of winInfo.controls) {
      if (!(ctrl.type === '外形框' || ctrl.type === 'ShapeBox')) continue
      shapeBoxEntries.push({
        idMacro: `IDC_${ctrl.name.toUpperCase()}`,
        shape: readIntProp(ctrl.extraProps?.['外形'], 0),
        effect: readIntProp(ctrl.extraProps?.['线条效果'], 0),
        lineStyle: readIntProp(ctrl.extraProps?.['线型'], 1),
        lineWidth: readIntProp(ctrl.extraProps?.['线宽'], 1),
        lineColor: readIntProp(ctrl.extraProps?.['线条颜色'], 0),
        fillColor: readIntProp(ctrl.extraProps?.['填充颜色'], 0xffffff),
        backColor: readIntProp(ctrl.extraProps?.['背景颜色'], 0xffffff),
      })
    }
    if (shapeBoxEntries.length > 0) {
      mainCode += '/* 外形框自绘表（外形/线型/线宽/线色/填充色）*/\n'
      mainCode += 'typedef struct { int id; int shape; int effect; int lineStyle; int lineWidth; COLORREF lineColor; COLORREF fillColor; COLORREF backColor; } YcShapeBoxEntry;\n'
      mainCode += 'static YcShapeBoxEntry g_ycShapeBoxes[] = {\n'
      for (const e of shapeBoxEntries) {
        mainCode += `    { ${e.idMacro}, ${e.shape}, ${e.effect}, ${e.lineStyle}, ${e.lineWidth}, (COLORREF)${e.lineColor >>> 0}, (COLORREF)${e.fillColor >>> 0}, (COLORREF)${e.backColor >>> 0} },\n`
      }
      mainCode += '};\n\n'
    }

    // 标签「底图/渐变背景」运行时：g_ycLblBgs 表（内嵌图字节懒解码为 GDI+ Image；渐变方式+3 色）+ YcLblBgProc 子类。
    // WM_ERASEBKGND：先填窗体背景刷（图有透明区/未铺满时透出窗体），再按「底图方式」(0居左上/1平铺/2居中/3缩放)
    // 画图；无底图时按「渐变背景方式」(0无/1上下/2左右/3-4-7-8 对角/5-6 反向) 用 3 色线性渐变填充；返回 1。
    // 底图优先于渐变（易语言「未设定底图时的渐变背景」语义）。标签文字由 STATIC 自身 WM_PAINT 以透明背景模式叠加。
    const labelBgEntries: Array<{ idMacro: string; imgIdx: number; hasImg: boolean; mode: number; gradMode: number; g1: number; g2: number; g3: number }> = []
    {
      let lblCtrlIdx = 0
      for (const ctrl of winInfo.controls) {
        const idx = lblCtrlIdx++
        if (!(ctrl.type === '标签' || ctrl.type === 'Label')) continue
        const hasImg = !!controlImageBytes[idx]
        const gradMode = readIntProp(ctrl.extraProps?.['渐变背景方式'], 0)
        if (!hasImg && gradMode === 0) continue  // 无底图无渐变 → 不挂子类
        labelBgEntries.push({
          idMacro: `IDC_${ctrl.name.toUpperCase()}`, imgIdx: idx, hasImg,
          mode: readIntProp(ctrl.extraProps?.['底图方式'], 0),
          gradMode,
          g1: readIntProp(ctrl.extraProps?.['渐变背景颜色1'], 0),
          g2: readIntProp(ctrl.extraProps?.['渐变背景颜色2'], 0),
          g3: readIntProp(ctrl.extraProps?.['渐变背景颜色3'], 0),
        })
      }
    }
    if (labelBgEntries.length > 0) {
      mainCode += '/* 标签底图/渐变背景表（懒解码 GDI+ Image）与子类过程 */\n'
      mainCode += 'typedef struct { int id; int mode; const unsigned char* data; unsigned int size; Gdiplus::Image* img; int gradMode; COLORREF g1; COLORREF g2; COLORREF g3; } YcLblBgEntry;\n'
      mainCode += 'static YcLblBgEntry g_ycLblBgs[] = {\n'
      for (const e of labelBgEntries) {
        const dataRef = e.hasImg ? `g_ctrlImg_${e.imgIdx}, g_ctrlImgSize_${e.imgIdx}` : 'NULL, 0'
        mainCode += `    { ${e.idMacro}, ${e.mode}, ${dataRef}, NULL, ${e.gradMode}, (COLORREF)${e.g1}, (COLORREF)${e.g2}, (COLORREF)${e.g3} },\n`
      }
      mainCode += '};\n'
      mainCode += 'static LRESULT CALLBACK YcLblBgProc(HWND h, UINT m, WPARAM w, LPARAM l, UINT_PTR, DWORD_PTR ref) {\n'
      mainCode += '    if (m == WM_ERASEBKGND) {\n'
      mainCode += '        YcLblBgEntry* e = (YcLblBgEntry*)ref;\n'
      mainCode += '        HDC hdc = (HDC)w; RECT rc; GetClientRect(h, &rc);\n'
      mainCode += '        FillRect(hdc, &rc, g_hFormBgBrush ? g_hFormBgBrush : GetSysColorBrush(COLOR_BTNFACE));\n'
      mainCode += '        if (!e->img && e->data && e->size > 0) {\n'
      mainCode += '            HGLOBAL hm = GlobalAlloc(GMEM_MOVEABLE, e->size);\n'
      mainCode += '            if (hm) { void* pm = GlobalLock(hm); if (pm) { memcpy(pm, e->data, e->size); GlobalUnlock(hm); }\n'
      mainCode += '                IStream* ps = NULL;\n'
      mainCode += '                if (CreateStreamOnHGlobal(hm, TRUE, &ps) == S_OK && ps) { e->img = Gdiplus::Image::FromStream(ps, FALSE); if (e->img && e->img->GetLastStatus() != Gdiplus::Ok) { delete e->img; e->img = NULL; } ps->Release(); }\n'
      mainCode += '                else { GlobalFree(hm); }\n'
      mainCode += '            }\n'
      mainCode += '        }\n'
      mainCode += '        if (e->img) {\n'
      mainCode += '            Gdiplus::Graphics g(hdc); int cw = rc.right - rc.left, ch = rc.bottom - rc.top;\n'
      mainCode += '            int iw = (int)e->img->GetWidth(), ih = (int)e->img->GetHeight();\n'
      mainCode += '            if (e->mode == 1) { Gdiplus::TextureBrush tb(e->img); g.FillRectangle(&tb, 0, 0, cw, ch); }\n'
      mainCode += '            else if (e->mode == 2) { g.DrawImage(e->img, (cw - iw) / 2, (ch - ih) / 2, iw, ih); }\n'
      mainCode += '            else if (e->mode == 3) { g.DrawImage(e->img, 0, 0, cw, ch); }\n'
      mainCode += '            else { g.DrawImage(e->img, 0, 0, iw, ih); }\n'
      mainCode += '        }\n'
      mainCode += '        else if (e->gradMode != 0) {\n'
      mainCode += '            int cw = rc.right - rc.left, ch = rc.bottom - rc.top;\n'
      mainCode += '            if (cw > 0 && ch > 0) {\n'
      mainCode += '                Gdiplus::Graphics g(hdc);\n'
      mainCode += '                Gdiplus::PointF p0(0.0f, 0.0f), p1(0.0f, (Gdiplus::REAL)ch);\n'
      mainCode += '                switch (e->gradMode) {\n'
      mainCode += '                    case 1: p0=Gdiplus::PointF(0,0); p1=Gdiplus::PointF(0,(Gdiplus::REAL)ch); break;\n'                       // 从上到下
      mainCode += '                    case 2: p0=Gdiplus::PointF(0,0); p1=Gdiplus::PointF((Gdiplus::REAL)cw,0); break;\n'                       // 从左到右
      mainCode += '                    case 3: p0=Gdiplus::PointF(0,0); p1=Gdiplus::PointF((Gdiplus::REAL)cw,(Gdiplus::REAL)ch); break;\n'       // 从左上到右下
      mainCode += '                    case 4: p0=Gdiplus::PointF((Gdiplus::REAL)cw,0); p1=Gdiplus::PointF(0,(Gdiplus::REAL)ch); break;\n'       // 从右上到左下
      mainCode += '                    case 5: p0=Gdiplus::PointF(0,(Gdiplus::REAL)ch); p1=Gdiplus::PointF(0,0); break;\n'                       // 从下到上
      mainCode += '                    case 6: p0=Gdiplus::PointF((Gdiplus::REAL)cw,0); p1=Gdiplus::PointF(0,0); break;\n'                       // 从右到左
      mainCode += '                    case 7: p0=Gdiplus::PointF((Gdiplus::REAL)cw,(Gdiplus::REAL)ch); p1=Gdiplus::PointF(0,0); break;\n'       // 从右下到左上
      mainCode += '                    case 8: p0=Gdiplus::PointF(0,(Gdiplus::REAL)ch); p1=Gdiplus::PointF((Gdiplus::REAL)cw,0); break;\n'       // 从左下到右上
      mainCode += '                }\n'
      mainCode += '                Gdiplus::Color c1(255, GetRValue(e->g1), GetGValue(e->g1), GetBValue(e->g1));\n'
      mainCode += '                Gdiplus::Color c2(255, GetRValue(e->g2), GetGValue(e->g2), GetBValue(e->g2));\n'
      mainCode += '                Gdiplus::Color c3(255, GetRValue(e->g3), GetGValue(e->g3), GetBValue(e->g3));\n'
      mainCode += '                Gdiplus::LinearGradientBrush lgb(p0, p1, c1, c3);\n'
      mainCode += '                Gdiplus::Color cols[3] = { c1, c2, c3 };\n'
      mainCode += '                Gdiplus::REAL poss[3] = { 0.0f, 0.5f, 1.0f };\n'
      mainCode += '                lgb.SetInterpolationColors(cols, poss, 3);\n'
      mainCode += '                g.FillRectangle(&lgb, 0, 0, cw, ch);\n'
      mainCode += '            }\n'
      mainCode += '        }\n'
      mainCode += '        return 1;\n'
      mainCode += '    }\n'
      mainCode += '    if (m == WM_NCDESTROY) RemoveWindowSubclass(h, YcLblBgProc, 1);\n'
      mainCode += '    return DefSubclassProc(h, m, w, l);\n'
      mainCode += '}\n\n'
    }

    // 超级链接框表：SysLink 控件，点击(NM_CLICK)或调用「跳转」方法时按类型 ShellExecute 打开邮件/网址。
    const hyperLinkEntries: Array<{ idMacro: string; type: number; email: string; url: string }> = []
    for (const ctrl of winInfo.controls) {
      if (!(ctrl.type === '超级链接框' || ctrl.type === 'HyperLinker')) continue
      hyperLinkEntries.push({
        idMacro: `IDC_${ctrl.name.toUpperCase()}`,
        type: readIntProp(ctrl.extraProps?.['类型'], 0),  // 0电子邮件 1网址
        email: String(ctrl.extraProps?.['电子邮件地址'] ?? ''),
        url: String(ctrl.extraProps?.['Internet地址'] ?? ''),
      })
    }
    // 表与助手始终生成（空时给占位项，id=0 永不匹配真实控件 id≥1001），使「跳转」方法跨编译单元恒可链接。
    mainCode += '/* 超级链接框表（类型/邮件/网址）+ 跳转 */\n'
    mainCode += 'typedef struct { int id; int type; const wchar_t* email; const wchar_t* url; } YcHyperLinkEntry;\n'
    mainCode += 'static YcHyperLinkEntry g_ycHyperLinks[] = {\n'
    if (hyperLinkEntries.length > 0) {
      for (const e of hyperLinkEntries) {
        mainCode += `    { ${e.idMacro}, ${e.type}, L"${escapeCString(e.email)}", L"${escapeCString(e.url)}" },\n`
      }
    } else {
      mainCode += '    { 0, 0, L"", L"" },\n'
    }
    mainCode += '};\n'
    mainCode += 'static void yc_hyperlink_do(int id){ for(size_t i=0;i<sizeof(g_ycHyperLinks)/sizeof(g_ycHyperLinks[0]);i++){ if(g_ycHyperLinks[i].id!=id) continue; const wchar_t* u=g_ycHyperLinks[i].url; if(g_ycHyperLinks[i].type==0){ std::wstring m=L"mailto:"; m+=g_ycHyperLinks[i].email; if(m.size()>7) ShellExecuteW(NULL,L"open",m.c_str(),NULL,NULL,SW_SHOWNORMAL); } else if(u && u[0]){ ShellExecuteW(NULL,L"open",u,NULL,NULL,SW_SHOWNORMAL); } return; } }\n'
    mainCode += 'void yc_hyperlink_jump(const wchar_t* n){ HWND h=yc_get_control_handle_by_name(n); if(h) yc_hyperlink_do(GetDlgCtrlID(h)); }\n\n'

    // 选择列表框：LBS_OWNERDRAWFIXED 自绘复选框。勾选/禁止状态用运行时 map<HWND, map<index,int>>；点击/空格切换勾选。
    const chkListIds = winInfo.controls
      .map((c, i) => ({ c, id: 1001 + i }))
      .filter(x => x.c.type === '选择列表框' || x.c.type === 'ChkListBox')
      .map(x => `IDC_${x.c.name.toUpperCase()}`)
    mainCode += '/* 选择列表框自绘复选框：勾选/允许状态运行时表 + 点击切换 */\n'
    mainCode += 'static std::map<HWND, std::map<int,int>> g_ycChkChecked;\n'
    mainCode += 'static std::map<HWND, std::map<int,int>> g_ycChkDisabled;\n'
    mainCode += `static int g_ycChkIds[] = { ${chkListIds.length ? chkListIds.join(', ') : '0'} };\n`
    mainCode += 'static int yc_is_chklist(int id){ if(id==0) return 0; for(size_t i=0;i<sizeof(g_ycChkIds)/sizeof(g_ycChkIds[0]);i++){ if(g_ycChkIds[i]==id) return 1; } return 0; }\n'
    mainCode += 'static void yc_chk_toggle(HWND h, int item){ int cnt=(int)SendMessageW(h,LB_GETCOUNT,0,0); if(item<0||item>=cnt||g_ycChkDisabled[h][item]) return; g_ycChkChecked[h][item]=!g_ycChkChecked[h][item]; RECT rc; if(SendMessageW(h,LB_GETITEMRECT,item,(LPARAM)&rc)!=LB_ERR) InvalidateRect(h,&rc,FALSE); }\n'
    mainCode += 'static LRESULT CALLBACK YcChkListProc(HWND h, UINT m, WPARAM w, LPARAM l, UINT_PTR uid, DWORD_PTR ref){\n'
    mainCode += '    if(m==WM_LBUTTONDOWN){ DWORD r=(DWORD)SendMessageW(h, LB_ITEMFROMPOINT, 0, MAKELPARAM(LOWORD(l), HIWORD(l))); if(HIWORD(r)==0) yc_chk_toggle(h, LOWORD(r)); }\n'
    mainCode += '    else if(m==WM_CHAR && w==L\' \'){ yc_chk_toggle(h, (int)SendMessageW(h,LB_GETCARETINDEX,0,0)); }\n'
    mainCode += '    return DefSubclassProc(h,m,w,l);\n'
    mainCode += '}\n'
    mainCode += 'int yc_chk_is_checked(const wchar_t* n, int idx){ HWND h=yc_get_control_handle_by_name(n); return (h && g_ycChkChecked[h][idx])?1:0; }\n'
    mainCode += 'int yc_chk_set_checked(const wchar_t* n, int idx, int st){ HWND h=yc_get_control_handle_by_name(n); if(!h) return 0; g_ycChkChecked[h][idx]=st?1:0; RECT rc; if(SendMessageW(h,LB_GETITEMRECT,idx,(LPARAM)&rc)!=LB_ERR) InvalidateRect(h,&rc,FALSE); return 1; }\n'
    mainCode += 'int yc_chk_is_enabled(const wchar_t* n, int idx){ HWND h=yc_get_control_handle_by_name(n); return (h && !g_ycChkDisabled[h][idx])?1:0; }\n'
    mainCode += 'int yc_chk_enable(const wchar_t* n, int idx, int st){ HWND h=yc_get_control_handle_by_name(n); if(!h) return 0; g_ycChkDisabled[h][idx]=st?0:1; RECT rc; if(SendMessageW(h,LB_GETITEMRECT,idx,(LPARAM)&rc)!=LB_ERR) InvalidateRect(h,&rc,FALSE); return 1; }\n\n'

    // 滚动条：原生 SCROLLBAR 的滑块不会自己移动，须父窗口在 WM_?SCROLL 里 GetScrollInfo→按滚动码调 pos→SetScrollInfo。收集行/页增量。
    const scrollBarEntries = winInfo.controls
      .map((c, i) => ({ c, id: 1001 + i }))
      .filter(x => ['横向滚动条', '纵向滚动条', 'HScrollBar', 'VScrollBar'].includes(x.c.type))
      .map(x => ({
        idMacro: `IDC_${x.c.name.toUpperCase()}`,
        lineChange: readIntProp(x.c.extraProps?.['行改变值'], 1),
        pageChange: readIntProp(x.c.extraProps?.['页改变值'], 10),
      }))
    if (scrollBarEntries.length > 0) {
      mainCode += '/* 滚动条：行/页增量表（供 WM_?SCROLL 移动滑块）*/\n'
      mainCode += 'typedef struct { int id; int lineChange; int pageChange; } YcScrollBarEntry;\n'
      mainCode += 'static YcScrollBarEntry g_ycScrollBars[] = {\n'
      for (const e of scrollBarEntries) {
        mainCode += `    { ${e.idMacro}, ${Math.max(1, e.lineChange)}, ${Math.max(1, e.pageChange)} },\n`
      }
      mainCode += '};\n\n'
    }

    // 选择夹子夹页：扁平显隐模型——子控件仍挂主窗口，切页时按归属 ShowWindow。表{childId,tabId,pageIndex}始终生成（空占位）。
    const tabPageEntries = winInfo.controls
      .map(c => ({
        childMacro: `IDC_${c.name.toUpperCase()}`,
        owner: typeof c.extraProps?.['所属选择夹'] === 'string' ? String(c.extraProps['所属选择夹']) : '',
        page: readIntProp(c.extraProps?.['所属子夹'], 0),
      }))
      .filter(x => x.owner)
    mainCode += '/* 选择夹子夹页表 + 切页显隐/子夹方法 */\n'
    mainCode += 'typedef struct { int childId; int tabId; int pageIndex; } YcTabPageEntry;\n'
    mainCode += 'static YcTabPageEntry g_ycTabPages[] = {\n'
    if (tabPageEntries.length > 0) {
      for (const e of tabPageEntries) mainCode += `    { ${e.childMacro}, IDC_${e.owner.toUpperCase()}, ${e.page} },\n`
    } else {
      mainCode += '    { 0, 0, 0 },\n'
    }
    mainCode += '};\n'
    mainCode += 'static void yc_tab_sync(int tabId){ HWND ht=GetDlgItem(g_hMainWnd, tabId); if(!ht) return; int cur=(int)SendMessageW(ht, TCM_GETCURSEL, 0, 0); for(size_t i=0;i<sizeof(g_ycTabPages)/sizeof(g_ycTabPages[0]);i++){ if(g_ycTabPages[i].tabId!=tabId) continue; HWND hc=GetDlgItem(g_hMainWnd, g_ycTabPages[i].childId); if(hc) ShowWindow(hc, g_ycTabPages[i].pageIndex==cur?SW_SHOW:SW_HIDE); } }\n'
    mainCode += 'int yc_tab_count(const wchar_t* n){ HWND h=yc_get_control_handle_by_name(n); return h?(int)SendMessageW(h,TCM_GETITEMCOUNT,0,0):0; }\n'
    mainCode += 'YC_TEXT yc_tab_get_name(const wchar_t* n, int idx){ HWND h=yc_get_control_handle_by_name(n); if(!h) return YC_TEXT(); wchar_t b[256]=L""; TCITEMW ti; ZeroMemory(&ti,sizeof(ti)); ti.mask=TCIF_TEXT; ti.pszText=b; ti.cchTextMax=256; if(SendMessageW(h,TCM_GETITEMW,(WPARAM)(idx-1),(LPARAM)&ti)) return YC_TEXT(std::wstring(b)); return YC_TEXT(); }\n'
    mainCode += 'int yc_tab_set_name(const wchar_t* n, int idx, const wchar_t* nm){ HWND h=yc_get_control_handle_by_name(n); if(!h) return 0; TCITEMW ti; ZeroMemory(&ti,sizeof(ti)); ti.mask=TCIF_TEXT; ti.pszText=(LPWSTR)(nm?nm:L""); return SendMessageW(h,TCM_SETITEMW,(WPARAM)(idx-1),(LPARAM)&ti)?1:0; }\n'
    mainCode += 'int yc_tab_get_cur(const wchar_t* n){ HWND h=yc_get_control_handle_by_name(n); return h?(int)SendMessageW(h,TCM_GETCURSEL,0,0):-1; }\n'
    mainCode += 'int yc_tab_set_cur(const wchar_t* n, int idx){ HWND h=yc_get_control_handle_by_name(n); if(!h) return 0; SendMessageW(h,TCM_SETCURSEL,(WPARAM)idx,0); yc_tab_sync(GetDlgCtrlID(h)); return 1; }\n\n'

    // 时钟「时钟周期」运行时读写：时钟无 HWND，靠生成的 名→定时器id 表；周期存表内（可变），
    // 置周期 = KillTimer + (周期>0 时) SetTimer；0=不产生时钟事件（易语言语义）。表始终生成（空占位）保证跨编译单元可链接。
    {
      const timerCtrls = winInfo.controls.filter(c => c.type === '时钟' || c.type === 'Timer')
      mainCode += 'struct YcTimerEntry { const wchar_t* name; int id; int period; };\n'
      const timerEntries = timerCtrls.map(c =>
        `{ L"${escapeCString(c.name)}", IDC_${c.name.toUpperCase()}, ${readIntProp(c.extraProps?.['时钟周期'], 0)} }`)
      mainCode += `static YcTimerEntry g_ycTimers[] = { ${timerEntries.length ? timerEntries.join(', ') : '{ NULL, 0, 0 }'} };\n`
      mainCode += 'static YcTimerEntry* yc_timer_find(const wchar_t* n){ if(!n) return NULL; for(size_t i=0;i<sizeof(g_ycTimers)/sizeof(g_ycTimers[0]);i++){ if(g_ycTimers[i].name && lstrcmpW(g_ycTimers[i].name, n)==0) return &g_ycTimers[i]; } return NULL; }\n'
      mainCode += 'int yc_timer_get_period(const wchar_t* n){ YcTimerEntry* e=yc_timer_find(n); return e?e->period:0; }\n'
      mainCode += 'void yc_timer_set_period(const wchar_t* n, int v){ YcTimerEntry* e=yc_timer_find(n); if(!e||!g_hMainWnd) return; if(v<0) v=0; e->period=v; KillTimer(g_hMainWnd, (UINT_PTR)e->id); if(v>0) SetTimer(g_hMainWnd, (UINT_PTR)e->id, (UINT)v, NULL); }\n\n'
    }

    // ===== 画板（DrawPanel）运行时：首个自注册控件窗口类 YCDRAWPANEL + 离屏 backbuffer + GDI 状态机 + 绘画事件 =====
    // 状态/助手/proc 始终生成（同超级链接框/选择夹策略，保证跨编译单元的画板方法调用可链接）。
    const drawPanelCtrls = winInfo.controls.filter(c => c.type === '画板' || c.type === 'DrawPanel')
    // 各画板绘画事件处理函数原型（弱定义在事件区、用户 .eyc 强符号覆盖）：地址存入 state.paintHandler，由 WM_PAINT 派发。
    for (const dp of drawPanelCtrls) {
      mainCode += `void _${dp.name.replace(/^_+/, '')}_绘画(int, int, int, int);\n`
    }
    mainCode += '/* 画板运行时状态：backbuffer + GDI 画笔/刷子/文本状态 + 底图 + 绘画事件指针 */\n'
    mainCode += 'struct YcDrawPanelState { HDC memDC; HBITMAP memBmp; HBITMAP oldBmp; int cw; int ch; int penStyle; int penWidth; COLORREF penColor; int rop2; int brushStyle; COLORREF brushColor; COLORREF textColor; COLORREF textBkColor; HFONT hFont; int writeX; int writeY; int unit; int autoRedraw; COLORREF backColor; Gdiplus::Image* bgImage; int bgMode; void (*paintHandler)(int,int,int,int); };\n'
    mainCode += 'static std::map<HWND, YcDrawPanelState> g_ycDrawPanels;\n'
    // 用 背景色 + 底图 填满整块 backbuffer（清除/非自动重画每次重绘前调用）
    mainCode += 'static void yc_dp_fill_back(YcDrawPanelState& st){ if(!st.memDC) return; RECT rc={0,0,st.cw,st.ch}; HBRUSH hb=CreateSolidBrush(st.backColor); FillRect(st.memDC,&rc,hb); DeleteObject(hb); if(st.bgImage){ Gdiplus::Graphics g(st.memDC); int iw=(int)st.bgImage->GetWidth(), ih=(int)st.bgImage->GetHeight(); if(iw>0&&ih>0){ if(st.bgMode==1){ for(int y=0;y<st.ch;y+=ih) for(int x=0;x<st.cw;x+=iw) g.DrawImage(st.bgImage,x,y,iw,ih); } else if(st.bgMode==2){ g.DrawImage(st.bgImage,(st.cw-iw)/2,(st.ch-ih)/2,iw,ih); } else if(st.bgMode==3){ g.DrawImage(st.bgImage,0,0,st.cw,st.ch); } else { g.DrawImage(st.bgImage,0,0,iw,ih); } } } }\n'
    // 按客户区尺寸建 backbuffer
    mainCode += 'static void yc_dp_make_buffer(HWND h, YcDrawPanelState& st){ RECT rc; GetClientRect(h,&rc); st.cw=rc.right-rc.left; st.ch=rc.bottom-rc.top; if(st.cw<1)st.cw=1; if(st.ch<1)st.ch=1; HDC hdc=GetDC(h); st.memDC=CreateCompatibleDC(hdc); st.memBmp=CreateCompatibleBitmap(hdc,st.cw,st.ch); st.oldBmp=(HBITMAP)SelectObject(st.memDC,st.memBmp); ReleaseDC(h,hdc); yc_dp_fill_back(st); }\n'
    // 画板窗口过程：backbuffer 生命周期 + WM_PAINT（自动重画=真直接贴图；=假先清背景+产生绘画事件再贴图）
    mainCode += 'static LRESULT CALLBACK YcDrawPanelProc(HWND h, UINT m, WPARAM w, LPARAM l){\n'
    mainCode += '    if(m==WM_CREATE){ YcDrawPanelState st; ZeroMemory(&st,sizeof(st)); st.penStyle=1; st.penWidth=0; st.penColor=RGB(0,0,0); st.rop2=12; st.brushStyle=1; st.brushColor=RGB(255,255,255); st.textColor=RGB(0,0,0); st.textBkColor=RGB(255,255,255); st.hFont=(HFONT)GetStockObject(DEFAULT_GUI_FONT); st.writeX=0; st.writeY=0; st.unit=0; st.autoRedraw=1; st.backColor=RGB(255,255,255); st.bgImage=NULL; st.bgMode=0; st.paintHandler=NULL; yc_dp_make_buffer(h,st); g_ycDrawPanels[h]=st; return 0; }\n'
    mainCode += '    std::map<HWND,YcDrawPanelState>::iterator it=g_ycDrawPanels.find(h); if(it==g_ycDrawPanels.end()) return DefWindowProcW(h,m,w,l); YcDrawPanelState& st=it->second;\n'
    mainCode += '    if(m==WM_ERASEBKGND) return 1;\n'
    mainCode += '    if(m==WM_SIZE){ RECT rc; GetClientRect(h,&rc); int nw=rc.right-rc.left, nh=rc.bottom-rc.top; if(nw<1)nw=1; if(nh<1)nh=1; if(nw!=st.cw||nh!=st.ch){ HDC hdc=GetDC(h); HDC nDC=CreateCompatibleDC(hdc); HBITMAP nBmp=CreateCompatibleBitmap(hdc,nw,nh); HBITMAP nOld=(HBITMAP)SelectObject(nDC,nBmp); RECT r2={0,0,nw,nh}; HBRUSH hb=CreateSolidBrush(st.backColor); FillRect(nDC,&r2,hb); DeleteObject(hb); if(st.memDC) BitBlt(nDC,0,0,(nw<st.cw?nw:st.cw),(nh<st.ch?nh:st.ch),st.memDC,0,0,SRCCOPY); if(st.memDC){ SelectObject(st.memDC,st.oldBmp); DeleteObject(st.memBmp); DeleteDC(st.memDC); } st.memDC=nDC; st.memBmp=nBmp; st.oldBmp=nOld; st.cw=nw; st.ch=nh; ReleaseDC(h,hdc); InvalidateRect(h,NULL,FALSE); } return 0; }\n'
    mainCode += '    if(m==WM_PAINT){ PAINTSTRUCT ps; HDC hdc=BeginPaint(h,&ps); if(!st.autoRedraw){ yc_dp_fill_back(st); if(st.paintHandler) st.paintHandler(ps.rcPaint.left, ps.rcPaint.top, ps.rcPaint.right, ps.rcPaint.bottom); } if(st.memDC) BitBlt(hdc,0,0,st.cw,st.ch,st.memDC,0,0,SRCCOPY); EndPaint(h,&ps); return 0; }\n'
    mainCode += '    if(m==WM_DESTROY){ if(st.memDC){ SelectObject(st.memDC,st.oldBmp); DeleteObject(st.memBmp); DeleteDC(st.memDC); } if(st.bgImage) delete st.bgImage; g_ycDrawPanels.erase(h); return 0; }\n'
    mainCode += '    return DefWindowProcW(h,m,w,l);\n'
    mainCode += '}\n\n'

    // ===== 画板 28 个绘图方法运行时（GDI；坐标全经 yc_dp_u2px 换算绘画单位；画进 memDC 后 InvalidateRect）=====
    mainCode += `/* 画板绘图方法：enum→GDI 映射表 + 单位换算 + 画笔/刷子应用 + 28 方法 */
#define YC_DP_NOARG (-2147483647-1)
static const int YC_DP_PS[7] = { PS_NULL, PS_SOLID, PS_DASH, PS_DOT, PS_DASHDOT, PS_DASHDOTDOT, PS_INSIDEFRAME };
static const int YC_DP_ROP2[16] = { R2_BLACK, R2_NOTMERGEPEN, R2_MASKNOTPEN, R2_NOTCOPYPEN, R2_MASKPENNOT, R2_NOT, R2_XORPEN, R2_NOTMASKPEN, R2_MASKPEN, R2_NOTXORPEN, R2_NOP, R2_MERGENOTPEN, R2_COPYPEN, R2_MERGEPENNOT, R2_MERGEPEN, R2_WHITE };
static const int YC_DP_HATCH[56] = { -2, -1, HS_FDIAGONAL, HS_CROSS, HS_DIAGCROSS, HS_BDIAGONAL, HS_HORIZONTAL, HS_VERTICAL, -1,-1,-1,-1,-1,-1,-1,-1, -1,-1,-1,-1,-1,-1,-1,-1, -1,-1,-1,-1,-1,-1,-1,-1, -1,-1,-1,-1,-1,-1,-1,-1, -1,-1,-1,-1,-1,-1,-1,-1, -1,-1,-1,-1,-1,-1,-1,-1 };
static int yc_dp_u2px(YcDrawPanelState& st, int v, int horiz){ if(st.unit==0) return v; int dpi=GetDeviceCaps(st.memDC, horiz?LOGPIXELSX:LOGPIXELSY); if(dpi<=0) return v; switch(st.unit){ case 1: return (int)((double)v*dpi/254.0); case 2: return (int)((double)v*dpi/2540.0); case 3: return (int)((double)v*dpi/100.0); case 4: return (int)((double)v*dpi/1000.0); case 5: return (int)((double)v*dpi/1440.0); } return v; }
static int yc_dp_px2u(YcDrawPanelState& st, int v, int horiz){ if(st.unit==0) return v; int dpi=GetDeviceCaps(st.memDC, horiz?LOGPIXELSX:LOGPIXELSY); if(dpi<=0) return v; switch(st.unit){ case 1: return (int)((double)v*254.0/dpi); case 2: return (int)((double)v*2540.0/dpi); case 3: return (int)((double)v*100.0/dpi); case 4: return (int)((double)v*1000.0/dpi); case 5: return (int)((double)v*1440.0/dpi); } return v; }
static void yc_dp_setup(YcDrawPanelState& st, HPEN* op, HBRUSH* ob, HPEN* np, HBRUSH* nb, int* db){ int ps=(st.penStyle>=0&&st.penStyle<7)?YC_DP_PS[st.penStyle]:PS_SOLID; int pw=yc_dp_u2px(st,st.penWidth,1); if(pw<0)pw=0; *np=CreatePen(ps,pw,st.penColor); int hs=(st.brushStyle>=0&&st.brushStyle<56)?YC_DP_HATCH[st.brushStyle]:-1; if(hs==-2){ *nb=(HBRUSH)GetStockObject(NULL_BRUSH); *db=0; } else if(hs>=0){ *nb=CreateHatchBrush(hs,st.brushColor); *db=1; } else { *nb=CreateSolidBrush(st.brushColor); *db=1; } *op=(HPEN)SelectObject(st.memDC,*np); *ob=(HBRUSH)SelectObject(st.memDC,*nb); SetROP2(st.memDC,(st.rop2>=0&&st.rop2<16)?YC_DP_ROP2[st.rop2]:R2_COPYPEN); }
static void yc_dp_teardown(YcDrawPanelState& st, HPEN op, HBRUSH ob, HPEN np, HBRUSH nb, int db){ SelectObject(st.memDC,op); SelectObject(st.memDC,ob); DeleteObject(np); if(db) DeleteObject(nb); SetROP2(st.memDC,R2_COPYPEN); }
static void yc_dp_textcommon(YcDrawPanelState& st, int px, int py, const wchar_t* t){ HFONT of=(HFONT)SelectObject(st.memDC,st.hFont); SetTextColor(st.memDC,st.textColor); SetBkColor(st.memDC,st.textBkColor); SetBkMode(st.memDC,OPAQUE); TextOutW(st.memDC,px,py,t,(int)wcslen(t)); SelectObject(st.memDC,of); }
static Gdiplus::Image* yc_dp_decode(const std::vector<unsigned char>& img){ if(img.empty()) return NULL; HGLOBAL hm=GlobalAlloc(GMEM_MOVEABLE,img.size()); if(!hm) return NULL; void* pm=GlobalLock(hm); if(pm){ memcpy(pm,&img[0],img.size()); GlobalUnlock(hm); } IStream* ps=NULL; Gdiplus::Image* im=NULL; if(CreateStreamOnHGlobal(hm,TRUE,&ps)==S_OK&&ps){ im=Gdiplus::Image::FromStream(ps,FALSE); if(im&&im->GetLastStatus()!=Gdiplus::Ok){ delete im; im=NULL; } ps->Release(); } else { GlobalFree(hm); } return im; }
#define YC_DP_V(nm) HWND _h=yc_get_control_handle_by_name(nm); std::map<HWND,YcDrawPanelState>::iterator _it=g_ycDrawPanels.find(_h); if(_it==g_ycDrawPanels.end()||!_it->second.memDC) return; YcDrawPanelState& st=_it->second;
#define YC_DP_R(nm,dv) HWND _h=yc_get_control_handle_by_name(nm); std::map<HWND,YcDrawPanelState>::iterator _it=g_ycDrawPanels.find(_h); if(_it==g_ycDrawPanels.end()||!_it->second.memDC) return (dv); YcDrawPanelState& st=_it->second;
int yc_dp_gethdc(const wchar_t* n){ YC_DP_R(n,0); return (int)(intptr_t)st.memDC; }
void yc_dp_cls(const wchar_t* n,int l,int t,int w,int h){ YC_DP_V(n); int px=yc_dp_u2px(st,l,1),py=yc_dp_u2px(st,t,0); int pw=(w<=0)?(st.cw-px):yc_dp_u2px(st,w,1); int ph=(h<=0)?(st.ch-py):yc_dp_u2px(st,h,0); RECT rc={px,py,px+pw,py+ph}; HBRUSH hb=CreateSolidBrush(st.backColor); FillRect(st.memDC,&rc,hb); DeleteObject(hb); st.writeX=px; st.writeY=py; InvalidateRect(_h,NULL,FALSE); }
int yc_dp_getpixel(const wchar_t* n,int x,int y){ YC_DP_R(n,-1); COLORREF c=GetPixel(st.memDC,yc_dp_u2px(st,x,1),yc_dp_u2px(st,y,0)); return (c==CLR_INVALID)?-1:(int)c; }
void yc_dp_setpixel(const wchar_t* n,int x,int y,int c){ YC_DP_V(n); SetPixel(st.memDC,yc_dp_u2px(st,x,1),yc_dp_u2px(st,y,0),(COLORREF)c); InvalidateRect(_h,NULL,FALSE); }
void yc_dp_line(const wchar_t* n,int x1,int y1,int x2,int y2){ YC_DP_V(n); HPEN op,np;HBRUSH ob,nb;int db; yc_dp_setup(st,&op,&ob,&np,&nb,&db); MoveToEx(st.memDC,yc_dp_u2px(st,x1,1),yc_dp_u2px(st,y1,0),NULL); LineTo(st.memDC,yc_dp_u2px(st,x2,1),yc_dp_u2px(st,y2,0)); yc_dp_teardown(st,op,ob,np,nb,db); InvalidateRect(_h,NULL,FALSE); }
void yc_dp_ellipse(const wchar_t* n,int l,int t,int r,int b){ YC_DP_V(n); HPEN op,np;HBRUSH ob,nb;int db; yc_dp_setup(st,&op,&ob,&np,&nb,&db); Ellipse(st.memDC,yc_dp_u2px(st,l,1),yc_dp_u2px(st,t,0),yc_dp_u2px(st,r,1),yc_dp_u2px(st,b,0)); yc_dp_teardown(st,op,ob,np,nb,db); InvalidateRect(_h,NULL,FALSE); }
void yc_dp_arc(const wchar_t* n,int l,int t,int r,int b,int xs,int ys,int xe,int ye){ YC_DP_V(n); HPEN op,np;HBRUSH ob,nb;int db; yc_dp_setup(st,&op,&ob,&np,&nb,&db); Arc(st.memDC,yc_dp_u2px(st,l,1),yc_dp_u2px(st,t,0),yc_dp_u2px(st,r,1),yc_dp_u2px(st,b,0),yc_dp_u2px(st,xs,1),yc_dp_u2px(st,ys,0),yc_dp_u2px(st,xe,1),yc_dp_u2px(st,ye,0)); yc_dp_teardown(st,op,ob,np,nb,db); InvalidateRect(_h,NULL,FALSE); }
void yc_dp_chord(const wchar_t* n,int l,int t,int r,int b,int xs,int ys,int xe,int ye){ YC_DP_V(n); HPEN op,np;HBRUSH ob,nb;int db; yc_dp_setup(st,&op,&ob,&np,&nb,&db); Chord(st.memDC,yc_dp_u2px(st,l,1),yc_dp_u2px(st,t,0),yc_dp_u2px(st,r,1),yc_dp_u2px(st,b,0),yc_dp_u2px(st,xs,1),yc_dp_u2px(st,ys,0),yc_dp_u2px(st,xe,1),yc_dp_u2px(st,ye,0)); yc_dp_teardown(st,op,ob,np,nb,db); InvalidateRect(_h,NULL,FALSE); }
void yc_dp_pie(const wchar_t* n,int l,int t,int r,int b,int xs,int ys,int xe,int ye){ YC_DP_V(n); HPEN op,np;HBRUSH ob,nb;int db; yc_dp_setup(st,&op,&ob,&np,&nb,&db); Pie(st.memDC,yc_dp_u2px(st,l,1),yc_dp_u2px(st,t,0),yc_dp_u2px(st,r,1),yc_dp_u2px(st,b,0),yc_dp_u2px(st,xs,1),yc_dp_u2px(st,ys,0),yc_dp_u2px(st,xe,1),yc_dp_u2px(st,ye,0)); yc_dp_teardown(st,op,ob,np,nb,db); InvalidateRect(_h,NULL,FALSE); }
void yc_dp_rect(const wchar_t* n,int l,int t,int r,int b){ YC_DP_V(n); HPEN op,np;HBRUSH ob,nb;int db; yc_dp_setup(st,&op,&ob,&np,&nb,&db); Rectangle(st.memDC,yc_dp_u2px(st,l,1),yc_dp_u2px(st,t,0),yc_dp_u2px(st,r,1),yc_dp_u2px(st,b,0)); yc_dp_teardown(st,op,ob,np,nb,db); InvalidateRect(_h,NULL,FALSE); }
void yc_dp_gradrect(const wchar_t* n,int x,int y,int w,int h,int dir,int c1,int c2){ YC_DP_V(n); int px=yc_dp_u2px(st,x,1),py=yc_dp_u2px(st,y,0),pw=yc_dp_u2px(st,w,1),ph=yc_dp_u2px(st,h,0); if(pw<=0||ph<=0) return; int vert=(dir==1||dir==5); int steps=vert?ph:pw; if(steps<=0) steps=1; int r1=GetRValue(c1),g1=GetGValue(c1),b1=GetBValue(c1),r2=GetRValue(c2),g2=GetGValue(c2),b2=GetBValue(c2); for(int i=0;i<steps;i++){ int rr=r1+(r2-r1)*i/steps, gg=g1+(g2-g1)*i/steps, bb=b1+(b2-b1)*i/steps; HBRUSH hb=CreateSolidBrush(RGB(rr,gg,bb)); RECT ln; if(vert){ ln.left=px; ln.right=px+pw; ln.top=py+i; ln.bottom=py+i+1; } else { ln.left=px+i; ln.right=px+i+1; ln.top=py; ln.bottom=py+ph; } FillRect(st.memDC,&ln,hb); DeleteObject(hb); } InvalidateRect(_h,NULL,FALSE); }
void yc_dp_fillrect(const wchar_t* n,int l,int t,int r,int b){ YC_DP_V(n); RECT rc={yc_dp_u2px(st,l,1),yc_dp_u2px(st,t,0),yc_dp_u2px(st,r,1),yc_dp_u2px(st,b,0)}; int hs=(st.brushStyle>=0&&st.brushStyle<56)?YC_DP_HATCH[st.brushStyle]:-1; if(hs!=-2){ HBRUSH hb=(hs>=0)?CreateHatchBrush(hs,st.brushColor):CreateSolidBrush(st.brushColor); FillRect(st.memDC,&rc,hb); DeleteObject(hb); } InvalidateRect(_h,NULL,FALSE); }
void yc_dp_roundrect(const wchar_t* n,int l,int t,int r,int b,int ew,int eh){ YC_DP_V(n); if(eh==YC_DP_NOARG) eh=ew; HPEN op,np;HBRUSH ob,nb;int db; yc_dp_setup(st,&op,&ob,&np,&nb,&db); RoundRect(st.memDC,yc_dp_u2px(st,l,1),yc_dp_u2px(st,t,0),yc_dp_u2px(st,r,1),yc_dp_u2px(st,b,0),yc_dp_u2px(st,ew,1),yc_dp_u2px(st,eh,0)); yc_dp_teardown(st,op,ob,np,nb,db); InvalidateRect(_h,NULL,FALSE); }
void yc_dp_invert(const wchar_t* n,int l,int t,int r,int b){ YC_DP_V(n); RECT rc={yc_dp_u2px(st,l,1),yc_dp_u2px(st,t,0),yc_dp_u2px(st,r,1),yc_dp_u2px(st,b,0)}; InvertRect(st.memDC,&rc); InvalidateRect(_h,NULL,FALSE); }
void yc_dp_polygon(const wchar_t* n, const std::vector<long long>& arr, int cnt){ YC_DP_V(n); int nv=(cnt>0)?cnt:(int)(arr.size()/2); if(nv<2) return; std::vector<POINT> pts((size_t)nv); for(int i=0;i<nv;i++){ long long ax=(2*i<(int)arr.size())?arr[2*i]:0; long long ay=(2*i+1<(int)arr.size())?arr[2*i+1]:0; pts[i].x=yc_dp_u2px(st,(int)ax,1); pts[i].y=yc_dp_u2px(st,(int)ay,0); } HPEN op,np;HBRUSH ob,nb;int db; yc_dp_setup(st,&op,&ob,&np,&nb,&db); Polygon(st.memDC,&pts[0],nv); yc_dp_teardown(st,op,ob,np,nb,db); InvalidateRect(_h,NULL,FALSE); }
void yc_dp_setwritepos(const wchar_t* n,int x,int y){ YC_DP_V(n); if(x!=YC_DP_NOARG) st.writeX=yc_dp_u2px(st,x,1); if(y!=YC_DP_NOARG) st.writeY=yc_dp_u2px(st,y,0); }
void yc_dp_print(const wchar_t* n, const wchar_t* text){ YC_DP_V(n); const wchar_t* t=text?text:L""; yc_dp_textcommon(st,st.writeX,st.writeY,t); HFONT of=(HFONT)SelectObject(st.memDC,st.hFont); SIZE sz; GetTextExtentPoint32W(st.memDC,t,(int)wcslen(t),&sz); SelectObject(st.memDC,of); st.writeY+=sz.cy; st.writeX=0; InvalidateRect(_h,NULL,FALSE); }
void yc_dp_sprint(const wchar_t* n, const wchar_t* text){ YC_DP_V(n); const wchar_t* t=text?text:L""; HFONT of=(HFONT)SelectObject(st.memDC,st.hFont); SIZE sz; GetTextExtentPoint32W(st.memDC,t,(int)wcslen(t),&sz); SelectObject(st.memDC,of); if(st.writeY+sz.cy>st.ch && st.ch>sz.cy){ int dy=sz.cy; BitBlt(st.memDC,0,0,st.cw,st.ch-dy,st.memDC,0,dy,SRCCOPY); RECT rb={0,st.ch-dy,st.cw,st.ch}; HBRUSH hb=CreateSolidBrush(st.backColor); FillRect(st.memDC,&rb,hb); DeleteObject(hb); st.writeY-=dy; } yc_dp_textcommon(st,st.writeX,st.writeY,t); st.writeY+=sz.cy; st.writeX=0; InvalidateRect(_h,NULL,FALSE); }
void yc_dp_writeout(const wchar_t* n, const wchar_t* text){ YC_DP_V(n); const wchar_t* t=text?text:L""; yc_dp_textcommon(st,st.writeX,st.writeY,t); HFONT of=(HFONT)SelectObject(st.memDC,st.hFont); SIZE sz; GetTextExtentPoint32W(st.memDC,t,(int)wcslen(t),&sz); SelectObject(st.memDC,of); st.writeX+=sz.cx; InvalidateRect(_h,NULL,FALSE); }
void yc_dp_say(const wchar_t* n,int x,int y,const wchar_t* text){ YC_DP_V(n); const wchar_t* t=text?text:L""; int wx=(x==YC_DP_NOARG)?st.writeX:yc_dp_u2px(st,x,1); int wy=(y==YC_DP_NOARG)?st.writeY:yc_dp_u2px(st,y,0); yc_dp_textcommon(st,wx,wy,t); InvalidateRect(_h,NULL,FALSE); }
int yc_dp_getwidth(const wchar_t* n, const wchar_t* text){ YC_DP_R(n,0); const wchar_t* t=text?text:L""; HFONT of=(HFONT)SelectObject(st.memDC,st.hFont); SIZE sz; GetTextExtentPoint32W(st.memDC,t,(int)wcslen(t),&sz); SelectObject(st.memDC,of); return yc_dp_px2u(st,sz.cx,1); }
int yc_dp_getheight(const wchar_t* n, const wchar_t* text){ YC_DP_R(n,0); const wchar_t* t=text?text:L""; HFONT of=(HFONT)SelectObject(st.memDC,st.hFont); SIZE sz; GetTextExtentPoint32W(st.memDC,t,(int)wcslen(t),&sz); SelectObject(st.memDC,of); return yc_dp_px2u(st,sz.cy,0); }
void yc_dp_drawpic(const wchar_t* n, const std::vector<unsigned char>& img, int x, int y, int w, int h, int mode){ (void)mode; YC_DP_V(n); Gdiplus::Image* im=yc_dp_decode(img); if(!im) return; { Gdiplus::Graphics g(st.memDC); int dw=(w>0)?yc_dp_u2px(st,w,1):(int)im->GetWidth(); int dh=(h>0)?yc_dp_u2px(st,h,0):(int)im->GetHeight(); g.DrawImage(im,yc_dp_u2px(st,x,1),yc_dp_u2px(st,y,0),dw,dh); } delete im; InvalidateRect(_h,NULL,FALSE); }
int yc_dp_getpicwidth(const wchar_t* n, const std::vector<unsigned char>& img){ YC_DP_R(n,0); Gdiplus::Image* im=yc_dp_decode(img); if(!im) return 0; int wv=(int)im->GetWidth(); delete im; return yc_dp_px2u(st,wv,1); }
int yc_dp_getpicheight(const wchar_t* n, const std::vector<unsigned char>& img){ YC_DP_R(n,0); Gdiplus::Image* im=yc_dp_decode(img); if(!im) return 0; int hv=(int)im->GetHeight(); delete im; return yc_dp_px2u(st,hv,0); }
void yc_dp_copy(const wchar_t* n){ (void)n; /* v1 未实现：跨画板复制需以画板对象作参数，待后续 */ }
std::vector<unsigned char> yc_dp_getpic(const wchar_t* n, int ow, int oh){ (void)ow; (void)oh; std::vector<unsigned char> out; HWND _h=yc_get_control_handle_by_name(n); std::map<HWND,YcDrawPanelState>::iterator _it=g_ycDrawPanels.find(_h); if(_it==g_ycDrawPanels.end()||!_it->second.memBmp) return out; YcDrawPanelState& st=_it->second; Gdiplus::Bitmap* bmp=Gdiplus::Bitmap::FromHBITMAP(st.memBmp,NULL); if(!bmp) return out; IStream* ps=NULL; if(CreateStreamOnHGlobal(NULL,TRUE,&ps)==S_OK&&ps){ CLSID pngClsid={0x557cf406,0x1a04,0x11d3,{0x9a,0x73,0x00,0x00,0xf8,0x1e,0xf3,0x2e}}; if(bmp->Save(ps,&pngClsid,NULL)==Gdiplus::Ok){ HGLOBAL hg=NULL; GetHGlobalFromStream(ps,&hg); if(hg){ SIZE_T sz=GlobalSize(hg); void* pd=GlobalLock(hg); if(pd&&sz>0){ out.assign((unsigned char*)pd,(unsigned char*)pd+sz); GlobalUnlock(hg); } } } ps->Release(); } delete bmp; return out; }
int yc_dp_unitcnv(const wchar_t* n, int v, int type){ YC_DP_R(n,v); if(type==1) return yc_dp_u2px(st,v,1); if(type==2) return yc_dp_u2px(st,v,0); if(type==3) return yc_dp_px2u(st,v,1); if(type==4) return yc_dp_px2u(st,v,0); return v; }
/* 画板 GDI 状态属性运行时读写：state 存原始枚举值、笔刷每次绘图现建，故直接改字段即对下一次绘图生效。
   prop id 与 window-units.json 画板 access 绑定一致：0画笔类型 1画笔粗细 2画出方式 3刷子类型 4绘画单位 5自动重画 6画笔颜色 7刷子颜色 8画板背景色 9文本颜色 10文本背景颜色 */
int yc_dp_get_prop(const wchar_t* n, int prop){ YC_DP_R(n,0); switch(prop){ case 0:return st.penStyle; case 1:return st.penWidth; case 2:return st.rop2; case 3:return st.brushStyle; case 4:return st.unit; case 5:return st.autoRedraw; case 6:return (int)st.penColor; case 7:return (int)st.brushColor; case 8:return (int)st.backColor; case 9:return (int)st.textColor; case 10:return (int)st.textBkColor; } return 0; }
void yc_dp_set_prop(const wchar_t* n, int prop, int v){ YC_DP_V(n); switch(prop){ case 0:st.penStyle=v;break; case 1:st.penWidth=v;break; case 2:st.rop2=v;break; case 3:st.brushStyle=v;break; case 4:st.unit=v;break; case 5:st.autoRedraw=v?1:0;break; case 6:st.penColor=(COLORREF)v;break; case 7:st.brushColor=(COLORREF)v;break; case 8:st.backColor=(COLORREF)v;break; case 9:st.textColor=(COLORREF)v;break; case 10:st.textBkColor=(COLORREF)v;break; } if(prop==5||prop==8) InvalidateRect(_h,NULL,FALSE); }
`

    // 创建控件函数
    mainCode += '/* 创建所有控件 */\n'
    mainCode += 'void CreateControls(HWND hWndParent) {\n'
    mainCode += '    HFONT hFont = (HFONT)GetStockObject(DEFAULT_GUI_FONT);\n'
    mainCode += '    HWND hCtrl;\n'

    // 选择夹名 → 现行子夹（供子控件初始可视判定：非当前页子控件 born hidden）
    const tabCurTabMap = new Map<string, number>()
    for (const c of winInfo.controls) {
      if (c.type === '选择夹' || c.type === 'Tab') tabCurTabMap.set(c.name, readIntProp(c.extraProps?.['现行子夹'], 0))
    }
    let ctrlId = 1001
    for (const ctrl of winInfo.controls) {
      const ctrlIndex = ctrlId - 1001  // 与 controlImageBytes 同序对齐（loop 顶 ctrlId 尚未自增）
      const lblBgEntryIdx = labelBgEntries.findIndex(e => e.imgIdx === ctrlIndex)
      const unitInfo = allUnits.find(u => u.name === ctrl.type || u.englishName === ctrl.type)
      const libraryFileName = unitInfo ? (libNameToFileName.get(normalizeKey(unitInfo.libraryName)) || '') : ''
      const className = resolveControlClassName(ctrl.type, unitInfo, libraryFileName, controlProtocolBindings)
      // 时钟（Timer）：非可视组件，不创建窗口——用 SetTimer(定时器 id=IDC) 挂定时器，跳过其余生成。
      if (ctrl.type === '时钟' || ctrl.type === 'Timer') {
        const elapse = readIntProp(ctrl.extraProps?.['时钟周期'], 0)
        if (elapse > 0) mainCode += `    SetTimer(hWndParent, ${ctrlId}, (UINT)${elapse}, NULL);\n`
        ctrlId++
        continue
      }
      const isStdEdit = className === 'EDIT'
      const editCodegen = isStdEdit ? buildStdEditCodegen(ctrl.extraProps) : null
      // 标准按钮（非复选框/单选框/分组框，它们也是 BUTTON 类但样式不同）
      const isStdButton = ctrl.type === '按钮' || ctrl.type === 'Button'
      const buttonImageBytes = controlImageBytes[ctrlIndex]
      // 设了底色或文本色 → 自绘按钮（BS_OWNERDRAW）；自绘时图片让位于颜色（不走 BS_BITMAP）
      const ownerDrawButton = isStdButton && (readIntProp(ctrl.extraProps?.['底色'], 0) !== 0 || typeof parseControlFont(ctrl.extraProps?.['字体'])?.color === 'number')
      const buttonCodegen = isStdButton ? buildStdButtonCodegen(ctrl.extraProps, !!buttonImageBytes, ownerDrawButton) : null
      // 标准 STATIC 标签：对齐/边框落成样式位（颜色/透明已在上方颜色表收集）
      const isStdLabel = ctrl.type === '标签' || ctrl.type === 'Label'
      const labelCodegen = isStdLabel ? buildStdLabelCodegen(ctrl.extraProps) : null
      // 标准 BUTTON·选择框/单选框/分组框
      const isStdCheckable = ctrl.type === '选择框' || ctrl.type === 'CheckBox' || ctrl.type === '单选框' || ctrl.type === 'RadioBox'
      const checkableCodegen = isStdCheckable ? buildStdCheckableCodegen(ctrl.extraProps, ctrl.type === '单选框' || ctrl.type === 'RadioBox') : null
      const isStdGroupBox = ctrl.type === '分组框' || ctrl.type === 'GroupBox'
      const groupBoxCodegen = isStdGroupBox ? buildStdGroupBoxCodegen(ctrl.extraProps) : null
      // 标准 STATIC·图片框（SS_BITMAP）
      const isStdPicBox = ctrl.type === '图片框' || ctrl.type === 'PicBox'
      const picBoxImageBytes = controlImageBytes[ctrlIndex]
      const picBoxCodegen = isStdPicBox ? buildStdPicBoxCodegen(ctrl.extraProps, !!picBoxImageBytes) : null
      // 外形框：SS_OWNERDRAW（样式取 json），自绘参数在 g_ycShapeBoxes 表，需跳过 WCM_SETPROP
      const isStdShapeBox = ctrl.type === '外形框' || ctrl.type === 'ShapeBox'
      // 画板：自注册 YCDRAWPANEL 类（边框→style/exStyle），运行时状态/绘画由 g_ycDrawPanels + YcDrawPanelProc 负责
      const isStdDrawPanel = ctrl.type === '画板' || ctrl.type === 'DrawPanel'
      const drawPanelCodegen = isStdDrawPanel ? buildStdDrawPanelCodegen(ctrl.extraProps) : null
      // 通用控件（原生 Win32 类，同样忽略 WM_APP+1，须专用 builder + 拦截分支）
      const isStdProgress = ctrl.type === '进度条' || ctrl.type === 'ProgressBar'
      const progressCodegen = isStdProgress ? buildStdProgressCodegen(ctrl.extraProps) : null
      const isStdSlider = ctrl.type === '滑块条' || ctrl.type === 'SliderBar'
      const sliderCodegen = isStdSlider ? buildStdSliderCodegen(ctrl.extraProps) : null
      const isStdScrollBar = ctrl.type === '横向滚动条' || ctrl.type === '纵向滚动条' || ctrl.type === 'HScrollBar' || ctrl.type === 'VScrollBar'
      const scrollBarCodegen = isStdScrollBar ? buildStdScrollBarCodegen(ctrl.extraProps, ctrl.type === '纵向滚动条' || ctrl.type === 'VScrollBar') : null
      const isStdDatePicker = ctrl.type === '日期框' || ctrl.type === 'DatePicker'
      const datePickerCodegen = isStdDatePicker ? buildStdDatePickerCodegen(ctrl.extraProps) : null
      const isStdMonthCal = ctrl.type === '月历' || ctrl.type === 'MonthCalendar'
      const monthCalCodegen = isStdMonthCal ? buildStdMonthCalCodegen(ctrl.extraProps) : null
      const isStdComboBox = ctrl.type === '组合框' || ctrl.type === 'ComboBox'
      const comboCodegen = isStdComboBox ? buildStdComboBoxCodegen(ctrl.extraProps) : null
      const isStdChecklist = ctrl.type === '选择列表框' || ctrl.type === 'ChkListBox'
      const isStdListBox = className === 'LISTBOX'
      const listBoxCodegen = isStdListBox ? buildStdListBoxCodegen(ctrl.extraProps, isStdChecklist) : null
      const baseStyle = editCodegen ? editCodegen.style
        : buttonCodegen ? buttonCodegen.style
        : labelCodegen ? labelCodegen.style
        : checkableCodegen ? checkableCodegen.style
        : groupBoxCodegen ? groupBoxCodegen.style
        : picBoxCodegen ? picBoxCodegen.style
        : progressCodegen ? progressCodegen.style
        : sliderCodegen ? sliderCodegen.style
        : scrollBarCodegen ? scrollBarCodegen.style
        : datePickerCodegen ? datePickerCodegen.style
        : monthCalCodegen ? monthCalCodegen.style
        : comboCodegen ? comboCodegen.style
        : listBoxCodegen ? listBoxCodegen.style
        : drawPanelCodegen ? drawPanelCodegen.style
        : resolveControlStyle(ctrl.type, unitInfo, libraryFileName, controlProtocolBindings)
      const exStyle = editCodegen ? editCodegen.exStyle
        : labelCodegen ? labelCodegen.exStyle
        : picBoxCodegen ? picBoxCodegen.exStyle
        : progressCodegen ? progressCodegen.exStyle
        : sliderCodegen ? sliderCodegen.exStyle
        : datePickerCodegen ? datePickerCodegen.exStyle
        : monthCalCodegen ? monthCalCodegen.exStyle
        : listBoxCodegen ? listBoxCodegen.exStyle
        : drawPanelCodegen ? drawPanelCodegen.exStyle
        : '0'
      const isStdTabControl = ctrl.type === '选择夹' || ctrl.type === 'Tab'
      // 子控件属于某选择夹的某页：初始可视=（所属子夹 == 该选择夹现行子夹）；隐藏自身=真时选择夹自身也不可视。
      const tabOwner = typeof ctrl.extraProps?.['所属选择夹'] === 'string' ? String(ctrl.extraProps['所属选择夹']) : ''
      let effVisible = ctrl.visible
      if (tabOwner && tabCurTabMap.has(tabOwner)) {
        effVisible = ctrl.visible && readIntProp(ctrl.extraProps?.['所属子夹'], 0) === tabCurTabMap.get(tabOwner)
      }
      if (isStdTabControl && readBoolProp(ctrl.extraProps?.['隐藏自身'], false)) effVisible = false
      const visFlag = effVisible ? ' | WS_VISIBLE' : ''
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
        || ctrl.type === '组合框' || ctrl.type === 'ComboBox'
        || ctrl.type === '日期框' || ctrl.type === 'DatePicker'
        || ctrl.type === '月历' || ctrl.type === 'MonthCalendar'
        || className === 'LISTBOX' || className === 'SysDateTimePick32' || className === 'SysMonthCal32'
        || className === 'msctls_progress32' || className === 'msctls_trackbar32' || className === 'SCROLLBAR'
      // 超级链接框(SysLink)：标题包 <a>…</a> 标记才渲染为可点击链接（点击经 WM_NOTIFY NM_CLICK 打开）。
      const isStdHyperLink = ctrl.type === '超级链接框' || ctrl.type === 'HyperLinker'
      const text = isStdHyperLink ? `<a>${ctrl.text || ctrl.name}</a>`
        : isEditLike ? (ctrl.text || '') : (ctrl.text || ctrl.name)
      mainCode += `    hCtrl = CreateWindowExW(${exStyle}, L"${className}", L"${escapeCString(text)}",\n`
      mainCode += `        ${style},\n`
      mainCode += `        ${ctrl.x}, ${ctrl.y}, ${ctrl.width}, ${ctrl.height},\n`
      mainCode += `        hWndParent, (HMENU)${ctrlId++}, g_hInstance, NULL);\n`
      // 标签底图：创建后即挂 YcLblBgProc 子类（WM_ERASEBKGND 画底图），ref 传表项指针
      if (lblBgEntryIdx >= 0) {
        mainCode += `    SetWindowSubclass(hCtrl, YcLblBgProc, 1, (DWORD_PTR)&g_ycLblBgs[${lblBgEntryIdx}]);\n`
      }
      // 字体：控件设了「字体」则 CreateFontW 专用字体，否则用默认 GUI 字体（所有控件通用）
      // 画板不走 WM_SETFONT（自绘用 st.hFont，在下方画板分支里创建），跳过通用字体块。
      const ctrlFont = parseControlFont(ctrl.extraProps?.['字体'])
      if (ctrlFont && !isStdDrawPanel) {
        mainCode += '    {\n'
        mainCode += '      HDC hdcF = GetDC(NULL);\n'
        mainCode += `      int fh = -MulDiv(${ctrlFont.size}, GetDeviceCaps(hdcF, LOGPIXELSY), 72);\n`
        mainCode += '      ReleaseDC(NULL, hdcF);\n'
        mainCode += `      HFONT hCtrlFont = CreateFontW(fh, 0, 0, 0, ${ctrlFont.bold ? 700 : 400}, ${ctrlFont.italic ? 'TRUE' : 'FALSE'}, ${ctrlFont.underline ? 'TRUE' : 'FALSE'}, ${ctrlFont.strikeout ? 'TRUE' : 'FALSE'}, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"${escapeCString(ctrlFont.name)}");\n`
        mainCode += '      SendMessageW(hCtrl, WM_SETFONT, (WPARAM)(hCtrlFont ? hCtrlFont : hFont), TRUE);\n'
        mainCode += '    }\n'
      } else if (!isStdDrawPanel) {
        mainCode += '    SendMessage(hCtrl, WM_SETFONT, (WPARAM)hFont, TRUE);\n'
      }
      if (editCodegen) {
        // 标准 EDIT：属性已落成创建样式，动态属性用 EM_* 消息补齐，不走 WCM_SETPROP
        for (const line of editCodegen.postCreateLines) {
          mainCode += `    ${line}\n`
        }
      } else if (buttonCodegen) {
        // 标准按钮：样式已落成，图片经 GDI+ 解码为 HBITMAP 后 BM_SETIMAGE（自绘按钮不设图，让位于颜色）
        if (buttonImageBytes && !ownerDrawButton) {
          mainCode += '    {\n'
          mainCode += `      HGLOBAL hBtnMem = GlobalAlloc(GMEM_MOVEABLE, g_ctrlImgSize_${ctrlIndex});\n`
          mainCode += '      if (hBtnMem) {\n'
          mainCode += '        void* pBtnMem = GlobalLock(hBtnMem);\n'
          mainCode += `        if (pBtnMem) { memcpy(pBtnMem, g_ctrlImg_${ctrlIndex}, g_ctrlImgSize_${ctrlIndex}); GlobalUnlock(hBtnMem); }\n`
          mainCode += '        IStream* pBtnStream = NULL;\n'
          mainCode += '        if (CreateStreamOnHGlobal(hBtnMem, TRUE, &pBtnStream) == S_OK && pBtnStream) {\n'
          mainCode += '          Gdiplus::Bitmap* pBtnBmp = Gdiplus::Bitmap::FromStream(pBtnStream, FALSE);\n'
          mainCode += '          if (pBtnBmp) {\n'
          mainCode += '            if (pBtnBmp->GetLastStatus() == Gdiplus::Ok) {\n'
          mainCode += '              HBITMAP hBtnBitmap = NULL;\n'
          mainCode += '              pBtnBmp->GetHBITMAP(Gdiplus::Color(255, 255, 255), &hBtnBitmap);\n'
          mainCode += '              if (hBtnBitmap) SendMessageW(hCtrl, BM_SETIMAGE, IMAGE_BITMAP, (LPARAM)hBtnBitmap);\n'
          mainCode += '            }\n'
          mainCode += '            delete pBtnBmp;\n'
          mainCode += '          }\n'
          mainCode += '          pBtnStream->Release();\n'
          mainCode += '        } else { GlobalFree(hBtnMem); }\n'
          mainCode += '      }\n'
          mainCode += '    }\n'
        }
      } else if (checkableCodegen || groupBoxCodegen) {
        // 标准 BUTTON·选择框/单选框/分组框：样式已落成（BUTTON 忽略 WM_APP+1，故不走下方 WCM_SETPROP）。
        // 选中态创建后经 BM_SETCHECK 落定；颜色已在颜色表，图片/数据源/数据列暂声明占位。
        if (checkableCodegen?.checked) {
          mainCode += '    SendMessage(hCtrl, BM_SETCHECK, BST_CHECKED, 0);\n'
        }
      } else if (picBoxCodegen) {
        // 标准 STATIC·图片框（忽略 WM_APP+1）：图片经 GDI+ 解码为 HBITMAP 后 STM_SETIMAGE
        if (picBoxImageBytes) {
          const picDrawMode = readIntProp(ctrl.extraProps['显示方式'], 0)  // 0居左上 1缩放 2居中
          mainCode += '    {\n'
          mainCode += `      HGLOBAL hPicMem = GlobalAlloc(GMEM_MOVEABLE, g_ctrlImgSize_${ctrlIndex});\n`
          mainCode += '      if (hPicMem) {\n'
          mainCode += '        void* pPicMem = GlobalLock(hPicMem);\n'
          mainCode += `        if (pPicMem) { memcpy(pPicMem, g_ctrlImg_${ctrlIndex}, g_ctrlImgSize_${ctrlIndex}); GlobalUnlock(hPicMem); }\n`
          mainCode += '        IStream* pPicStream = NULL;\n'
          mainCode += '        if (CreateStreamOnHGlobal(hPicMem, TRUE, &pPicStream) == S_OK && pPicStream) {\n'
          mainCode += '          Gdiplus::Bitmap* pPicBmp = Gdiplus::Bitmap::FromStream(pPicStream, FALSE);\n'
          mainCode += '          if (pPicBmp) {\n'
          mainCode += '            if (pPicBmp->GetLastStatus() == Gdiplus::Ok) {\n'
          mainCode += '              HBITMAP hPicBitmap = NULL;\n'
          if (picDrawMode === 1) {
            // 缩放：位图拉伸到控件客户区，配合 SS_REALSIZECONTROL 铺满且保持控件尺寸（此前无实现，图片按原尺寸撑大控件）
            mainCode += '              RECT _rcPic; GetClientRect(hCtrl, &_rcPic);\n'
            mainCode += '              int _pcw = _rcPic.right - _rcPic.left, _pch = _rcPic.bottom - _rcPic.top;\n'
            mainCode += '              if (_pcw < 1) _pcw = 1;\n'
            mainCode += '              if (_pch < 1) _pch = 1;\n'
            mainCode += '              Gdiplus::Bitmap _scaledPic(_pcw, _pch, PixelFormat32bppARGB);\n'
            mainCode += '              Gdiplus::Graphics _gPic(&_scaledPic);\n'
            mainCode += '              _gPic.SetInterpolationMode(Gdiplus::InterpolationModeHighQualityBicubic);\n'
            mainCode += '              _gPic.DrawImage(pPicBmp, 0, 0, _pcw, _pch);\n'
            mainCode += '              _scaledPic.GetHBITMAP(Gdiplus::Color(255, 255, 255), &hPicBitmap);\n'
          } else {
            mainCode += '              pPicBmp->GetHBITMAP(Gdiplus::Color(255, 255, 255), &hPicBitmap);\n'
          }
          mainCode += '              if (hPicBitmap) SendMessageW(hCtrl, STM_SETIMAGE, IMAGE_BITMAP, (LPARAM)hPicBitmap);\n'
          mainCode += '            }\n'
          mainCode += '            delete pPicBmp;\n'
          mainCode += '          }\n'
          mainCode += '          pPicStream->Release();\n'
          mainCode += '        } else { GlobalFree(hPicMem); }\n'
          mainCode += '      }\n'
          mainCode += '    }\n'
        }
      } else if (isStdShapeBox) {
        // 外形框：SS_OWNERDRAW 自绘，参数已在 g_ycShapeBoxes 表，WM_DRAWITEM 绘制；跳过 WCM_SETPROP。
      } else if (isStdDrawPanel) {
        // 画板：WM_CREATE 已建好 backbuffer + 默认态，这里用设计属性覆盖 + 底图解码 + 绑定绘画事件指针。
        const dpPenStyle = readIntProp(ctrl.extraProps?.['画笔类型'], 1)
        const dpPenWidth = readIntProp(ctrl.extraProps?.['画笔粗细'], 0)
        const dpPenColor = readIntProp(ctrl.extraProps?.['画笔颜色'], 0) >>> 0
        const dpRop2 = readIntProp(ctrl.extraProps?.['画出方式'], 12)
        const dpBrushStyle = readIntProp(ctrl.extraProps?.['刷子类型'], 1)
        const dpBrushColor = readIntProp(ctrl.extraProps?.['刷子颜色'], 16777215) >>> 0
        const dpTextColor = readIntProp(ctrl.extraProps?.['文本颜色'], 0) >>> 0
        const dpTextBk = readIntProp(ctrl.extraProps?.['文本背景颜色'], 16777215) >>> 0
        const dpUnit = readIntProp(ctrl.extraProps?.['绘画单位'], 0)
        const dpAuto = readBoolProp(ctrl.extraProps?.['自动重画'], false) ? 1 : 0
        const dpBack = readIntProp(ctrl.extraProps?.['画板背景色'], 16777215) >>> 0
        const dpBgMode = readIntProp(ctrl.extraProps?.['底图方式'], 0)
        const dpHandler = `_${ctrl.name.replace(/^_+/, '')}_绘画`
        mainCode += '    if (g_ycDrawPanels.count(hCtrl)) {\n'
        mainCode += '      YcDrawPanelState& dps = g_ycDrawPanels[hCtrl];\n'
        mainCode += `      dps.penStyle=${dpPenStyle}; dps.penWidth=${dpPenWidth}; dps.penColor=(COLORREF)${dpPenColor}; dps.rop2=${dpRop2};\n`
        mainCode += `      dps.brushStyle=${dpBrushStyle}; dps.brushColor=(COLORREF)${dpBrushColor}; dps.textColor=(COLORREF)${dpTextColor}; dps.textBkColor=(COLORREF)${dpTextBk};\n`
        mainCode += `      dps.unit=${dpUnit}; dps.autoRedraw=${dpAuto}; dps.backColor=(COLORREF)${dpBack}; dps.bgMode=${dpBgMode}; dps.paintHandler=${dpHandler};\n`
        if (ctrlFont) {
          mainCode += '      { HDC hdcDF = GetDC(NULL);\n'
          mainCode += `        int dfh = -MulDiv(${ctrlFont.size}, GetDeviceCaps(hdcDF, LOGPIXELSY), 72);\n`
          mainCode += '        ReleaseDC(NULL, hdcDF);\n'
          mainCode += `        dps.hFont = CreateFontW(dfh, 0, 0, 0, ${ctrlFont.bold ? 700 : 400}, ${ctrlFont.italic ? 'TRUE' : 'FALSE'}, ${ctrlFont.underline ? 'TRUE' : 'FALSE'}, ${ctrlFont.strikeout ? 'TRUE' : 'FALSE'}, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"${escapeCString(ctrlFont.name)}");\n`
          mainCode += '        if (!dps.hFont) dps.hFont = (HFONT)GetStockObject(DEFAULT_GUI_FONT); }\n'
        }
        const dpImg = controlImageBytes[ctrlIndex]
        if (dpImg) {
          // 底图：GDI+ 从内嵌字节解码为 Image* 存入 state（fill_back 每次绘制时贴上）
          mainCode += '      {\n'
          mainCode += `        HGLOBAL hDpMem = GlobalAlloc(GMEM_MOVEABLE, g_ctrlImgSize_${ctrlIndex});\n`
          mainCode += '        if (hDpMem) {\n'
          mainCode += '          void* pDpMem = GlobalLock(hDpMem);\n'
          mainCode += `          if (pDpMem) { memcpy(pDpMem, g_ctrlImg_${ctrlIndex}, g_ctrlImgSize_${ctrlIndex}); GlobalUnlock(hDpMem); }\n`
          mainCode += '          IStream* pDpStream = NULL;\n'
          mainCode += '          if (CreateStreamOnHGlobal(hDpMem, TRUE, &pDpStream) == S_OK && pDpStream) {\n'
          mainCode += '            Gdiplus::Image* pDpImg = Gdiplus::Image::FromStream(pDpStream, FALSE);\n'
          mainCode += '            if (pDpImg) { if (pDpImg->GetLastStatus() == Gdiplus::Ok) dps.bgImage = pDpImg; else delete pDpImg; }\n'
          mainCode += '            pDpStream->Release();\n'
          mainCode += '          } else { GlobalFree(hDpMem); }\n'
          mainCode += '        }\n'
          mainCode += '      }\n'
        }
        mainCode += '      yc_dp_fill_back(dps);\n'
        mainCode += '    }\n'
        mainCode += '    InvalidateRect(hCtrl, NULL, FALSE);\n'
      } else if (isStdTabControl) {
        // 选择夹：按「子夹标题」逐页 TCM_INSERTITEM，按「现行子夹」设当前页；切页显隐经 g_ycTabPages + yc_tab_sync。
        const titles = String(ctrl.extraProps?.['子夹标题'] ?? '').split('\n').map(t => t.trim()).filter(Boolean)
        titles.forEach((t, i) => {
          mainCode += `    { TCITEMW ti; ZeroMemory(&ti, sizeof(ti)); ti.mask = TCIF_TEXT; wchar_t tb[128]; wcsncpy(tb, L"${escapeCString(t)}", 127); tb[127]=0; ti.pszText = tb; SendMessageW(hCtrl, TCM_INSERTITEMW, (WPARAM)${i}, (LPARAM)&ti); }\n`
        })
        if (titles.length > 0) {
          const curTab = Math.max(0, Math.min(readIntProp(ctrl.extraProps?.['现行子夹'], 0), titles.length - 1))
          mainCode += `    SendMessage(hCtrl, TCM_SETCURSEL, (WPARAM)${curTab}, 0);\n`
        }
      } else if (progressCodegen || sliderCodegen || scrollBarCodegen || datePickerCodegen || monthCalCodegen || comboCodegen || listBoxCodegen) {
        // 通用控件（进度条/滑块条/滚动条/日期框/月历/组合框/列表框：原生 Win32 类，忽略 WM_APP+1）：
        // 发创建后消息落定属性，拦截以跳过下方通用 WCM_SETPROP 通道。
        const cc = (progressCodegen || sliderCodegen || scrollBarCodegen || datePickerCodegen || monthCalCodegen || comboCodegen || listBoxCodegen)!
        for (const line of cc.postCreateLines) mainCode += `    ${line}\n`
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
        // 画板「绘画」事件不走 WM_COMMAND/NOTIFY/SCROLL 通道，由 YcDrawPanelProc 的 WM_PAINT 带 4 个 int 参直接派发。
        if ((ctrl.type === '画板' || ctrl.type === 'DrawPanel') && ev.name === '绘画') continue
        // 时钟「周期事件」不走 WM_COMMAND/NOTIFY/SCROLL 通道，由主窗 WM_TIMER 按定时器 id 直接派发。
        if ((ctrl.type === '时钟' || ctrl.type === 'Timer') && ev.name === '周期事件') continue
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

    // 时钟「周期事件」处理函数（WM_TIMER 派发；weak 空实现保证无用户处理时可链接）
    const timerEventCtrls = winInfo.controls.filter(c => c.type === '时钟' || c.type === 'Timer')
    for (const ctrl of timerEventCtrls) {
      const handlerName = `_${ctrl.name.replace(/^_+/, '')}_周期事件`
      if (declaredHandlers.has(handlerName)) continue
      declaredHandlers.add(handlerName)
      mainCode += `WEAK_FUNC void ${handlerName}(void) { }\n`
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
    // 画板「绘画」事件默认弱实现（带 4 个 int 参：需重画区 左/上/右/下）；用户 .eyc 强符号覆盖。
    for (const dp of drawPanelCtrls) {
      mainCode += `WEAK_FUNC void _${dp.name.replace(/^_+/, '')}_绘画(int 左, int 上, int 右, int 下) { }\n`
    }

    // ===== 窗口菜单（菜单编辑器的 menu 字段）：生成 CreateMenus + 菜单项被选择的弱空实现 + 命令表 =====
    const menuCommands: Array<{ cmdId: number; evSub: string }> = []
    let menuCreateBody = ''
    const hasWindowMenu = Array.isArray(winInfo.menu) && winInfo.menu.length > 0
    if (hasWindowMenu) {
      let menuHandleSeq = 0
      let nextMenuCmdId = 40001
      const emitMenuItems = (items: MenuNodeInfo[], parentVar: string): void => {
        for (const it of items || []) {
          if (!it || it.visible === false) continue
          if (it.separator) { menuCreateBody += `    AppendMenuW(${parentVar}, MF_SEPARATOR, 0, NULL);\n`; continue }
          const caption = it.caption || ''
          const kids = Array.isArray(it.children) ? it.children.filter(Boolean) : []
          if (kids.length > 0) {
            const sub = `hSub${++menuHandleSeq}`
            menuCreateBody += `    HMENU ${sub} = CreatePopupMenu();\n`
            emitMenuItems(kids, sub)
            let flags = 'MF_POPUP'
            if (it.disabled) flags += ' | MF_GRAYED'
            menuCreateBody += `    AppendMenuW(${parentVar}, ${flags}, (UINT_PTR)${sub}, L"${escapeCString(caption)}");\n`
          } else {
            const cmdId = nextMenuCmdId++
            const evSub = it.name ? `_${it.name.replace(/^_+/, '')}_被选择` : ''
            if (evSub) menuCommands.push({ cmdId, evSub })
            let flags = 'MF_STRING'
            if (it.disabled) flags += ' | MF_GRAYED'
            if (it.checked) flags += ' | MF_CHECKED'
            const cLabel = it.shortcut ? `${escapeCString(caption)}\\t${escapeCString(it.shortcut)}` : escapeCString(caption)
            menuCreateBody += `    AppendMenuW(${parentVar}, ${flags}, ${cmdId}, L"${cLabel}");\n`
          }
        }
      }
      emitMenuItems(winInfo.menu!, 'hMenuBar')
      menuCreateBody = '    HMENU hMenuBar = CreateMenu();\n' + menuCreateBody + '    SetMenu(hWnd, hMenuBar);\n'
      // 菜单项被选择事件的弱空实现（用户 .eyc 提供强实现覆盖；预览无源码时保留空实现）
      for (const mc of menuCommands) {
        if (declaredHandlers.has(mc.evSub)) continue
        declaredHandlers.add(mc.evSub)
        mainCode += `WEAK_FUNC void ${mc.evSub}(void) { }\n`
      }
      // CreateMenus 函数（定义在 WndProc 之前，供 WM_CREATE 调用）
      mainCode += 'void CreateMenus(HWND hWnd) {\n' + menuCreateBody + '}\n'
    }

    // 窗口过程
    mainCode += '/* 窗口过程函数 */\n'
    mainCode += 'LRESULT CALLBACK WndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam) {\n'
    mainCode += '    switch (message) {\n'
    mainCode += '    case WM_CREATE:\n'
    // 创建完毕事件里会按名操作控件（krnln_ctrl_set_text 等经 yc_get_control_handle_by_name 依赖 g_hMainWnd），
    // 此时 CreateWindowExW 尚未返回，必须先在这里完成赋值
    mainCode += '        g_hMainWnd = hWnd;\n'
    mainCode += '        CreateControls(hWnd);\n'
    // 选择夹初始按现行子夹同步子控件显隐（TCM_SETCURSEL 不发 TCN_SELCHANGE，故显式同步一次）
    for (const c of winInfo.controls) {
      if (c.type === '选择夹' || c.type === 'Tab') mainCode += `        yc_tab_sync(IDC_${c.name.toUpperCase()});\n`
    }
    if (hasWindowMenu) mainCode += '        CreateMenus(hWnd);\n'
    mainCode += `        ${windowEventPrefix}_创建完毕();\n`
    mainCode += '        break;\n'
    // 时钟「周期事件」派发：定时器 id = 控件 IDC 宏值（SetTimer 创建期/yc_timer_set_period 均用它）
    if (timerEventCtrls.length > 0) {
      mainCode += '    case WM_TIMER:\n'
      mainCode += '        switch ((int)wParam) {\n'
      for (const ctrl of timerEventCtrls) {
        mainCode += `        case IDC_${ctrl.name.toUpperCase()}: _${ctrl.name.replace(/^_+/, '')}_周期事件(); return 0;\n`
      }
      mainCode += '        }\n'
      mainCode += '        break;\n'
    }
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

    // 菜单项被选择 → 派发到 _名_被选择()（命令 ID 从 40001 起，与控件 ID 1001+ 不冲突）
    for (const mc of menuCommands) {
      mainCode += `        case ${mc.cmdId}: ${mc.evSub}(); break;\n`
    }

    mainCode += '        }\n'
    mainCode += '        break;\n'
    mainCode += '    }\n'
    mainCode += '    case WM_NOTIFY: {\n'
    mainCode += '        LPNMHDR pnm = (LPNMHDR)lParam;\n'
    mainCode += '        if (!pnm) break;\n'
    mainCode += '        if (pnm->code == NM_CLICK || pnm->code == NM_RETURN) yc_hyperlink_do((int)pnm->idFrom);\n'
    mainCode += '        if (pnm->code == TCN_SELCHANGE) yc_tab_sync((int)pnm->idFrom);\n'
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
    if (scrollBarEntries.length > 0) {
      // 独立滚动条：按滚动码移动滑块（原生 SCROLLBAR 不自动移动，须父窗口 SetScrollInfo）。
      mainCode += '        { int sc = LOWORD(wParam);\n'
      mainCode += '          for (size_t si = 0; si < sizeof(g_ycScrollBars)/sizeof(g_ycScrollBars[0]); si++) {\n'
      mainCode += '            if (g_ycScrollBars[si].id != sid) continue;\n'
      mainCode += '            SCROLLINFO sinf; ZeroMemory(&sinf, sizeof(sinf)); sinf.cbSize = sizeof(sinf); sinf.fMask = SIF_ALL; GetScrollInfo(hScroll, SB_CTL, &sinf);\n'
      mainCode += '            int p = sinf.nPos;\n'
      mainCode += '            if (sc==SB_LINELEFT) p-=g_ycScrollBars[si].lineChange; else if (sc==SB_LINERIGHT) p+=g_ycScrollBars[si].lineChange;\n'
      mainCode += '            else if (sc==SB_PAGELEFT) p-=g_ycScrollBars[si].pageChange; else if (sc==SB_PAGERIGHT) p+=g_ycScrollBars[si].pageChange;\n'
      mainCode += '            else if (sc==SB_THUMBTRACK || sc==SB_THUMBPOSITION) p=sinf.nTrackPos; else if (sc==SB_TOP) p=sinf.nMin; else if (sc==SB_BOTTOM) p=sinf.nMax;\n'
      mainCode += '            if (p<sinf.nMin) p=sinf.nMin; if (p>sinf.nMax) p=sinf.nMax;\n'
      mainCode += '            SCROLLINFO sset; ZeroMemory(&sset, sizeof(sset)); sset.cbSize = sizeof(sset); sset.fMask = SIF_POS; sset.nPos = p; SetScrollInfo(hScroll, SB_CTL, &sset, TRUE);\n'
      mainCode += '            break;\n'
      mainCode += '          } }\n'
    }
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
    {
      const formBackRefExpr = winInfo.backColor !== 0 ? `(COLORREF)${winInfo.backColor >>> 0}` : 'GetSysColor(COLOR_BTNFACE)'
      mainCode += '    case WM_CTLCOLOREDIT:\n'
      mainCode += '    case WM_CTLCOLORLISTBOX:\n'
      mainCode += '    case WM_CTLCOLORSTATIC: {\n'
      mainCode += '        int colorCtrlId = GetDlgCtrlID((HWND)lParam);\n'
      mainCode += '        HWND hColorParent = GetParent((HWND)lParam);\n'
      mainCode += '        int colorParentId = hColorParent ? GetDlgCtrlID(hColorParent) : 0;\n'
      mainCode += '        std::map<HWND,COLORREF>::iterator _ovIt = g_ycTextColorOverride.find((HWND)lParam);\n'
      mainCode += '        bool _hasOv = (_ovIt != g_ycTextColorOverride.end());\n'
      mainCode += '        for (size_t ci = 0; ci < sizeof(g_ycEditColors) / sizeof(g_ycEditColors[0]); ci++) {\n'
      mainCode += '            if (g_ycEditColors[ci].id != colorCtrlId && g_ycEditColors[ci].id != colorParentId) continue;\n'
      mainCode += '            SetTextColor((HDC)wParam, _hasOv ? _ovIt->second : g_ycEditColors[ci].textColor);\n'
      mainCode += '            if (g_ycEditColors[ci].transparent) { SetBkMode((HDC)wParam, TRANSPARENT); return (LRESULT)GetStockObject(NULL_BRUSH); }\n'
      mainCode += '            SetBkColor((HDC)wParam, g_ycEditColors[ci].backColor);\n'
      mainCode += '            if (!g_ycEditColors[ci].brush) g_ycEditColors[ci].brush = CreateSolidBrush(g_ycEditColors[ci].backColor);\n'
      mainCode += '            return (LRESULT)g_ycEditColors[ci].brush;\n'
      mainCode += '        }\n'
      // 运行时覆盖但无设计期条目：也必须返回真实刷子（绝不落 return 0，否则同下方黑底陷阱）。
      // STATIC 非 EDIT（标签/选择框/单选框/分组框）→ 融入窗体底色；EDIT/LISTBOX/只读编辑框 → 系统默认底。
      mainCode += '        if (_hasOv) {\n'
      mainCode += '            SetTextColor((HDC)wParam, _ovIt->second);\n'
      mainCode += '            wchar_t ovCls[16] = L""; GetClassNameW((HWND)lParam, ovCls, 16);\n'
      mainCode += '            if (message == WM_CTLCOLORSTATIC && _wcsicmp(ovCls, L"EDIT") != 0) {\n'
      mainCode += `                SetBkColor((HDC)wParam, ${formBackRefExpr});\n`
      mainCode += '                return (LRESULT)(g_hFormBgBrush ? g_hFormBgBrush : GetSysColorBrush(COLOR_BTNFACE));\n'
      mainCode += '            }\n'
      mainCode += '            SetBkColor((HDC)wParam, GetSysColor(COLOR_WINDOW));\n'
      mainCode += '            return (LRESULT)GetSysColorBrush(COLOR_WINDOW);\n'
      mainCode += '        }\n'
      // 查表不中：**绝不能 break**——switch 之后是 return 0，NULL 背景刷会让主题化滑块条等
      // 公共控件的双缓冲位图保持全黑（用户实测黑底根因）。STATIC 通道且非 EDIT 类（滑块条/标签/
      // 选择框/单选框/分组框）→ 返回窗体背景刷（融入窗体底色，易语言行为）；只读编辑框虽走
      // STATIC 通道但按类名识别为 EDIT → 与 EDIT/LISTBOX 通道一起显式 DefWindowProc（系统默认观感）。
      mainCode += '        if (message == WM_CTLCOLORSTATIC) {\n'
      mainCode += '            wchar_t ccCls[16] = L""; GetClassNameW((HWND)lParam, ccCls, 16);\n'
      mainCode += '            if (_wcsicmp(ccCls, L"EDIT") != 0) {\n'
      mainCode += `            SetBkColor((HDC)wParam, ${formBackRefExpr});\n`
      mainCode += '                return (LRESULT)(g_hFormBgBrush ? g_hFormBgBrush : GetSysColorBrush(COLOR_BTNFACE));\n'
      mainCode += '            }\n'
      mainCode += '        }\n'
      mainCode += '        return DefWindowProcW(hWnd, message, wParam, lParam);\n'
      mainCode += '    }\n'
    }
    if (buttonDrawEntries.length > 0 || shapeBoxEntries.length > 0 || chkListIds.length > 0) {
      mainCode += '    case WM_DRAWITEM: {\n'
      mainCode += '        LPDRAWITEMSTRUCT dis = (LPDRAWITEMSTRUCT)lParam;\n'
    }
    if (chkListIds.length > 0) {
      // 选择列表框自绘：填背景(选中态高亮) → 画复选框(勾选/禁止) → 画项目文本
      mainCode += '        if (dis && dis->CtlType == ODT_LISTBOX && yc_is_chklist((int)dis->CtlID) && dis->itemID != (UINT)-1) {\n'
      mainCode += '            HWND hLb = dis->hwndItem; RECT rc = dis->rcItem;\n'
      mainCode += '            BOOL sel = (dis->itemState & ODS_SELECTED) != 0;\n'
      mainCode += '            BOOL dis2 = g_ycChkDisabled[hLb][(int)dis->itemID] != 0;\n'
      mainCode += '            FillRect(dis->hDC, &rc, sel ? (HBRUSH)GetSysColorBrush(COLOR_HIGHLIGHT) : (HBRUSH)GetSysColorBrush(COLOR_WINDOW));\n'
      mainCode += '            int box = rc.bottom - rc.top - 4; if (box < 10) box = 10; if (box > 16) box = 16;\n'
      mainCode += '            RECT cb; cb.left = rc.left + 2; cb.top = rc.top + ((rc.bottom-rc.top-box)/2); cb.right = cb.left + box; cb.bottom = cb.top + box;\n'
      mainCode += '            UINT st = DFCS_BUTTONCHECK | DFCS_FLAT; if (g_ycChkChecked[hLb][(int)dis->itemID]) st |= DFCS_CHECKED; if (dis2) st |= DFCS_INACTIVE;\n'
      mainCode += '            DrawFrameControl(dis->hDC, &cb, DFC_BUTTON, st);\n'
      mainCode += '            wchar_t itxt[512] = L""; SendMessageW(hLb, LB_GETTEXT, dis->itemID, (LPARAM)itxt);\n'
      mainCode += '            SetBkMode(dis->hDC, TRANSPARENT);\n'
      mainCode += '            SetTextColor(dis->hDC, sel ? GetSysColor(COLOR_HIGHLIGHTTEXT) : (dis2 ? GetSysColor(COLOR_GRAYTEXT) : GetSysColor(COLOR_WINDOWTEXT)));\n'
      mainCode += '            RECT tr = rc; tr.left = cb.right + 4;\n'
      mainCode += '            DrawTextW(dis->hDC, itxt, -1, &tr, DT_SINGLELINE | DT_VCENTER | DT_LEFT | DT_NOPREFIX);\n'
      mainCode += '            if (dis->itemState & ODS_FOCUS) DrawFocusRect(dis->hDC, &dis->rcItem);\n'
      mainCode += '            return TRUE;\n'
      mainCode += '        }\n'
    }
    if (buttonDrawEntries.length > 0) {
      // 自绘按钮：按 ID 查表，填底色/边框（按下态下沉）/文本（字体+文本色+对齐）
      mainCode += '        if (dis && dis->CtlType == ODT_BUTTON) {\n'
      mainCode += '            for (size_t bi = 0; bi < sizeof(g_ycButtonDraws) / sizeof(g_ycButtonDraws[0]); bi++) {\n'
      mainCode += '                if (g_ycButtonDraws[bi].id != (int)dis->CtlID) continue;\n'
      mainCode += '                RECT rc = dis->rcItem;\n'
      mainCode += '                BOOL pressed = (dis->itemState & ODS_SELECTED) != 0;\n'
      mainCode += '                COLORREF bg = g_ycButtonDraws[bi].bgColor;\n'
      mainCode += '                HBRUSH hbr = CreateSolidBrush(bg);\n'
      mainCode += '                FillRect(dis->hDC, &rc, hbr);\n'
      mainCode += '                DeleteObject(hbr);\n'
      mainCode += '                DrawEdge(dis->hDC, &rc, pressed ? EDGE_SUNKEN : EDGE_RAISED, BF_RECT);\n'
      mainCode += '                if (g_ycButtonDraws[bi].isDefault) { HBRUSH hbf = CreateSolidBrush(GetSysColor(COLOR_WINDOWFRAME)); FrameRect(dis->hDC, &dis->rcItem, hbf); DeleteObject(hbf); }\n'
      mainCode += '                wchar_t btxt[256] = L""; GetWindowTextW(dis->hwndItem, btxt, 256);\n'
      mainCode += '                HFONT hbfont = (HFONT)SendMessageW(dis->hwndItem, WM_GETFONT, 0, 0);\n'
      mainCode += '                HGDIOBJ oldF = hbfont ? SelectObject(dis->hDC, hbfont) : NULL;\n'
      mainCode += '                SetBkMode(dis->hDC, TRANSPARENT);\n'
      mainCode += '                SetTextColor(dis->hDC, g_ycButtonDraws[bi].textColor >= 0 ? (COLORREF)g_ycButtonDraws[bi].textColor : GetSysColor(COLOR_BTNTEXT));\n'
      mainCode += '                UINT fmt = DT_SINGLELINE;\n'
      mainCode += '                fmt |= (g_ycButtonDraws[bi].hAlign == 0) ? DT_LEFT : (g_ycButtonDraws[bi].hAlign == 2) ? DT_RIGHT : DT_CENTER;\n'
      mainCode += '                fmt |= (g_ycButtonDraws[bi].vAlign == 0) ? DT_TOP : (g_ycButtonDraws[bi].vAlign == 2) ? DT_BOTTOM : DT_VCENTER;\n'
      mainCode += '                RECT tr = rc; if (pressed) OffsetRect(&tr, 1, 1);\n'
      mainCode += '                DrawTextW(dis->hDC, btxt, -1, &tr, fmt);\n'
      mainCode += '                if (oldF) SelectObject(dis->hDC, oldF);\n'
      mainCode += '                if (dis->itemState & ODS_FOCUS) { RECT fr = dis->rcItem; InflateRect(&fr, -3, -3); DrawFocusRect(dis->hDC, &fr); }\n'
      mainCode += '                return TRUE;\n'
      mainCode += '            }\n'
      mainCode += '        }\n'
    }
    if (shapeBoxEntries.length > 0) {
      // 外形框自绘（SS_OWNERDRAW）：填背景 → 画形状(线型/线宽/线色/填充) → 立体效果
      mainCode += '        if (dis && dis->CtlType == ODT_STATIC) {\n'
      mainCode += '            for (size_t si = 0; si < sizeof(g_ycShapeBoxes) / sizeof(g_ycShapeBoxes[0]); si++) {\n'
      mainCode += '                if (g_ycShapeBoxes[si].id != (int)dis->CtlID) continue;\n'
      mainCode += '                RECT rc = dis->rcItem;\n'
      mainCode += '                HBRUSH hbg = CreateSolidBrush(g_ycShapeBoxes[si].backColor);\n'
      mainCode += '                FillRect(dis->hDC, &rc, hbg); DeleteObject(hbg);\n'
      mainCode += '                int shp = g_ycShapeBoxes[si].shape, ls = g_ycShapeBoxes[si].lineStyle;\n'
      mainCode += '                int psStyle = (ls==0)?PS_NULL:(ls==2)?PS_DASH:(ls==3)?PS_DOT:(ls==4)?PS_DASHDOT:(ls==5)?PS_DASHDOTDOT:PS_SOLID;\n'
      mainCode += '                int lw = g_ycShapeBoxes[si].lineWidth; if (lw < 1) lw = 1;\n'
      mainCode += '                HPEN hpen = CreatePen(psStyle, lw, g_ycShapeBoxes[si].lineColor);\n'
      mainCode += '                HBRUSH hfill = CreateSolidBrush(g_ycShapeBoxes[si].fillColor);\n'
      mainCode += '                HGDIOBJ oldPen = SelectObject(dis->hDC, hpen), oldBr = SelectObject(dis->hDC, hfill);\n'
      mainCode += '                int L = rc.left, T = rc.top, R = rc.right - 1, B = rc.bottom - 1;\n'
      mainCode += '                if (shp==1 || shp==3 || shp==5) { int s = (R-L < B-T) ? (R-L) : (B-T); R = L + s; B = T + s; }\n'
      mainCode += '                switch (shp) {\n'
      mainCode += '                    case 0: case 1: Rectangle(dis->hDC, L, T, R, B); break;\n'
      mainCode += '                    case 2: case 3: Ellipse(dis->hDC, L, T, R, B); break;\n'
      mainCode += '                    case 4: case 5: RoundRect(dis->hDC, L, T, R, B, (R-L)/4, (B-T)/4); break;\n'
      mainCode += '                    case 6: { int y=(T+B)/2; MoveToEx(dis->hDC, L, y, NULL); LineTo(dis->hDC, R, y); break; }\n'
      mainCode += '                    case 7: { int x=(L+R)/2; MoveToEx(dis->hDC, x, T, NULL); LineTo(dis->hDC, x, B); break; }\n'
      mainCode += '                }\n'
      mainCode += '                SelectObject(dis->hDC, oldPen); SelectObject(dis->hDC, oldBr);\n'
      mainCode += '                DeleteObject(hpen); DeleteObject(hfill);\n'
      mainCode += '                if (g_ycShapeBoxes[si].effect==1) DrawEdge(dis->hDC, &rc, EDGE_SUNKEN, BF_RECT);\n'
      mainCode += '                else if (g_ycShapeBoxes[si].effect==2) DrawEdge(dis->hDC, &rc, EDGE_RAISED, BF_RECT);\n'
      mainCode += '                return TRUE;\n'
      mainCode += '            }\n'
      mainCode += '        }\n'
    }
    if (buttonDrawEntries.length > 0 || shapeBoxEntries.length > 0 || chkListIds.length > 0) {
      mainCode += '        break;\n'
      mainCode += '    }\n'
    }
    if (chkListIds.length > 0) {
      // 选择列表框 LBS_OWNERDRAWFIXED 需 WM_MEASUREITEM 定项高。
      mainCode += '    case WM_MEASUREITEM: {\n'
      mainCode += '        LPMEASUREITEMSTRUCT mis = (LPMEASUREITEMSTRUCT)lParam;\n'
      mainCode += '        if (mis && mis->CtlType == ODT_LISTBOX && yc_is_chklist((int)mis->CtlID)) { mis->itemHeight = 18; return TRUE; }\n'
      mainCode += '        break;\n'
      mainCode += '    }\n'
    }
    // 底图绘制块（要求作用域内已有 HDC hdc）——WM_PAINT 与 WM_PRINTCLIENT 共用
    let backImageDrawBlock = ''
    if (backImageBytes) {
      backImageDrawBlock += '        if (g_backImage) {\n'
      backImageDrawBlock += '            RECT crc; GetClientRect(hWnd, &crc);\n'
      backImageDrawBlock += '            int cw = (int)(crc.right - crc.left), ch = (int)(crc.bottom - crc.top);\n'
      backImageDrawBlock += '            Gdiplus::Graphics graphics(hdc);\n'
      const biMode = winInfo.backImageMode
      if (biMode === 4) {
        backImageDrawBlock += '            graphics.SetInterpolationMode(Gdiplus::InterpolationModeHighQualityBicubic);\n'
        backImageDrawBlock += '            graphics.DrawImage(g_backImage, 0, 0, cw, ch);\n'
      } else if (biMode === 0) {
        backImageDrawBlock += '            Gdiplus::TextureBrush texBrush(g_backImage);\n'
        backImageDrawBlock += '            graphics.FillRectangle(&texBrush, 0, 0, cw, ch);\n'
      } else {
        backImageDrawBlock += '            int iw = (int)g_backImage->GetWidth(), ih = (int)g_backImage->GetHeight();\n'
        if (biMode === 1) backImageDrawBlock += '            int ix = 0, iy = 0;\n'
        else if (biMode === 2) backImageDrawBlock += '            int ix = (cw - iw) / 2, iy = (ch - ih) / 2;\n'
        else backImageDrawBlock += '            int ix = cw - iw, iy = ch - ih;\n'
        backImageDrawBlock += '            graphics.DrawImage(g_backImage, ix, iy, iw, ih);\n'
      }
      backImageDrawBlock += '        }\n'
    }
    // 主题化公共控件（滑块条等）经 DrawThemeParentBackground 向父窗要背景——DefWindowProc 不处理
    // WM_PRINTCLIENT，缺此处理则主题引擎的内存位图保持全黑（滑块条黑底）。填窗体背景刷，有底图连底图一起画。
    mainCode += '    case WM_PRINTCLIENT: {\n'
    mainCode += '        HDC hdc = (HDC)wParam;\n'
    mainCode += '        RECT prc; GetClientRect(hWnd, &prc);\n'
    mainCode += '        FillRect(hdc, &prc, g_hFormBgBrush ? g_hFormBgBrush : GetSysColorBrush(COLOR_BTNFACE));\n'
    mainCode += backImageDrawBlock
    mainCode += '        return 0;\n'
    mainCode += '    }\n'
    mainCode += '    case WM_PAINT: {\n'
    mainCode += '        PAINTSTRUCT ps;\n'
    mainCode += '        HDC hdc = BeginPaint(hWnd, &ps);\n'
    mainCode += backImageDrawBlock
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
    if (!winInfo.movable) {
      // 可否移动=假：标题栏拖动与 HTCAPTION 拖动都会走 SC_MOVE，一处拦全断
      mainCode += '    case WM_SYSCOMMAND:\n'
      mainCode += '        if ((wParam & 0xFFF0) == SC_MOVE) return 0;\n'
      mainCode += '        return DefWindowProcW(hWnd, message, wParam, lParam);\n'
    }
    if (winInfo.dragMove && winInfo.movable) {
      // 随意移动：客户区空白处按住即拖动窗口（控件是子窗口，不受影响）
      mainCode += '    case WM_NCHITTEST: {\n'
      mainCode += '        LRESULT ycHit = DefWindowProcW(hWnd, message, wParam, lParam);\n'
      mainCode += '        if (ycHit == HTCLIENT) return HTCAPTION;\n'
      mainCode += '        return ycHit;\n'
      mainCode += '    }\n'
    }
    if (winInfo.keepCaptionActive) {
      // 保持标题条激活：失去焦点时仍按激活状态绘制标题条
      mainCode += '    case WM_NCACTIVATE:\n'
      mainCode += '        return DefWindowProcW(hWnd, message, TRUE, lParam);\n'
    }
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
    mainCode += '    INITCOMMONCONTROLSEX icc = { sizeof(INITCOMMONCONTROLSEX), ICC_WIN95_CLASSES | ICC_STANDARD_CLASSES | ICC_BAR_CLASSES | ICC_LISTVIEW_CLASSES | ICC_TREEVIEW_CLASSES | ICC_TAB_CLASSES | ICC_DATE_CLASSES | ICC_LINK_CLASSES };\n'
    mainCode += '    InitCommonControlsEx(&icc);\n'
    if (backImageBytes || iconImageBytes || hasAnyControlImage || hasDrawPanel) {
      // 底图/图标/按钮图片/画板：启动 GDI+，从内嵌字节建内存流并解码
      mainCode += '    { Gdiplus::GdiplusStartupInput gdiplusStartupInput;\n'
      mainCode += '      Gdiplus::GdiplusStartup(&g_gdiplusToken, &gdiplusStartupInput, NULL);\n'
      mainCode += '    }\n'
    }
    if (backImageBytes) {
      mainCode += '    {\n'
      mainCode += '      HGLOBAL hImgMem = GlobalAlloc(GMEM_MOVEABLE, g_backImageSize);\n'
      mainCode += '      if (hImgMem) {\n'
      mainCode += '        void* pImgMem = GlobalLock(hImgMem);\n'
      mainCode += '        if (pImgMem) { memcpy(pImgMem, g_backImageData, g_backImageSize); GlobalUnlock(hImgMem); }\n'
      mainCode += '        IStream* pImgStream = NULL;\n'
      mainCode += '        if (CreateStreamOnHGlobal(hImgMem, TRUE, &pImgStream) == S_OK && pImgStream) {\n'
      mainCode += '          g_backImage = Gdiplus::Image::FromStream(pImgStream, FALSE);\n'
      mainCode += '          if (g_backImage && g_backImage->GetLastStatus() != Gdiplus::Ok) { delete g_backImage; g_backImage = NULL; }\n'
      mainCode += '          pImgStream->Release();\n'
      mainCode += '        } else { GlobalFree(hImgMem); }\n'
      mainCode += '      }\n'
      mainCode += '    }\n'
    }
    if (iconImageBytes) {
      // 图标：把图片解码为 GDI+ 位图，再转 HICON（任意图片格式均可，无需 .ico）
      mainCode += '    {\n'
      mainCode += '      HGLOBAL hIcoMem = GlobalAlloc(GMEM_MOVEABLE, g_iconImageSize);\n'
      mainCode += '      if (hIcoMem) {\n'
      mainCode += '        void* pIcoMem = GlobalLock(hIcoMem);\n'
      mainCode += '        if (pIcoMem) { memcpy(pIcoMem, g_iconImageData, g_iconImageSize); GlobalUnlock(hIcoMem); }\n'
      mainCode += '        IStream* pIcoStream = NULL;\n'
      mainCode += '        if (CreateStreamOnHGlobal(hIcoMem, TRUE, &pIcoStream) == S_OK && pIcoStream) {\n'
      mainCode += '          Gdiplus::Bitmap* pIconBmp = Gdiplus::Bitmap::FromStream(pIcoStream, FALSE);\n'
      mainCode += '          if (pIconBmp) {\n'
      mainCode += '            if (pIconBmp->GetLastStatus() == Gdiplus::Ok) pIconBmp->GetHICON(&g_hWindowIcon);\n'
      mainCode += '            delete pIconBmp;\n'
      mainCode += '          }\n'
      mainCode += '          pIcoStream->Release();\n'
      mainCode += '        } else { GlobalFree(hIcoMem); }\n'
      mainCode += '      }\n'
      mainCode += '    }\n'
    }
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
    if (hasDrawPanel) {
      // 画板自绘画布窗口类（首个自注册控件类）：cbWndExtra=0（状态存 std::map），hbrBackground=NULL（全靠 backbuffer 贴图）。
      mainCode += '    { WNDCLASSEXW dpwc; ZeroMemory(&dpwc, sizeof(dpwc)); dpwc.cbSize = sizeof(WNDCLASSEXW); dpwc.style = CS_HREDRAW | CS_VREDRAW; dpwc.lpfnWndProc = YcDrawPanelProc; dpwc.cbClsExtra = 0; dpwc.cbWndExtra = 0; dpwc.hInstance = hInstance; dpwc.hCursor = LoadCursor(NULL, IDC_ARROW); dpwc.hbrBackground = NULL; dpwc.lpszClassName = L"YCDRAWPANEL"; RegisterClassExW(&dpwc); }\n'
    }
    mainCode += '    WNDCLASSEXW wcex;\n'
    mainCode += '    wcex.cbSize = sizeof(WNDCLASSEXW);\n'
    mainCode += '    wcex.style = CS_HREDRAW | CS_VREDRAW;\n'
    mainCode += '    wcex.lpfnWndProc = WndProc;\n'
    mainCode += '    wcex.cbClsExtra = 0;\n'
    mainCode += '    wcex.cbWndExtra = 0;\n'
    mainCode += '    wcex.hInstance = hInstance;\n'
    mainCode += iconImageBytes
      ? '    wcex.hIcon = g_hWindowIcon ? g_hWindowIcon : LoadIcon(NULL, IDI_APPLICATION);\n'
      : '    wcex.hIcon = LoadIcon(NULL, IDI_APPLICATION);\n'
    mainCode += `    wcex.hCursor = LoadCursor(NULL, ${mapMousePointerCursor(winInfo.mousePointer)});\n`
    mainCode += winInfo.backColor !== 0
      ? `    g_hFormBgBrush = CreateSolidBrush((COLORREF)${winInfo.backColor >>> 0});\n    wcex.hbrBackground = g_hFormBgBrush;\n`
      : '    g_hFormBgBrush = GetSysColorBrush(COLOR_BTNFACE);\n    wcex.hbrBackground = g_hFormBgBrush;\n'
    mainCode += '    wcex.lpszMenuName = NULL;\n'
    mainCode += '    wcex.lpszClassName = g_szClassName;\n'
    mainCode += iconImageBytes
      ? '    wcex.hIconSm = g_hWindowIcon ? g_hWindowIcon : LoadIcon(NULL, IDI_APPLICATION);\n'
      : '    wcex.hIconSm = LoadIcon(NULL, IDI_APPLICATION);\n'
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
      if (!winInfo.showInTaskbar && !dwExStyle.includes('WS_EX_TOOLWINDOW')) {
        dwExStyle = (dwExStyle === '0' ? '' : dwExStyle + ' | ') + 'WS_EX_TOOLWINDOW'
      }
      mainCode += `    DWORD dwStyle = ${dwStyle};\n`
      mainCode += `    DWORD dwExStyle = ${dwExStyle};\n`
    }
    mainCode += '    RECT rc = { 0, 0, g_nWidth, g_nHeight };\n'
    mainCode += `    AdjustWindowRectEx(&rc, dwStyle, ${hasWindowMenu ? 'TRUE' : 'FALSE'}, dwExStyle);\n`
    mainCode += '    int winW = rc.right - rc.left;\n'
    mainCode += '    int winH = rc.bottom - rc.top;\n'
    // 根据位置属性决定起始坐标
    if (winInfo.startPos === 0) {
      // 手工调整：有左边/顶边就按属性放，否则维持系统默认（老项目无这两个属性）
      if (winInfo.left !== 0 || winInfo.top !== 0) {
        mainCode += `    int posX = ${winInfo.left};\n`
        mainCode += `    int posY = ${winInfo.top};\n`
      } else {
        mainCode += '    int posX = CW_USEDEFAULT;\n'
        mainCode += '    int posY = CW_USEDEFAULT;\n'
      }
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
    if (iconImageBytes) {
      // 图标：显式设置标题栏(小)与任务栏(大)图标
      mainCode += '    if (g_hWindowIcon) {\n'
      mainCode += '        SendMessageW(hWnd, WM_SETICON, ICON_SMALL, (LPARAM)g_hWindowIcon);\n'
      mainCode += '        SendMessageW(hWnd, WM_SETICON, ICON_BIG, (LPARAM)g_hWindowIcon);\n'
      mainCode += '    }\n'
    }
    if (winInfo.shape === 1 || winInfo.shape === 2) {
      // 外形：按整窗矩形（含非客户区边框）建区域裁剪窗口
      mainCode += '    { RECT wrc; GetWindowRect(hWnd, &wrc);\n'
      mainCode += '      int rgnW = wrc.right - wrc.left; int rgnH = wrc.bottom - wrc.top;\n'
      if (winInfo.shape === 1) {
        // 圆角矩形：用「圆角半径」属性，夹取到不超过较短边的一半
        mainCode += `      int rr = ${Math.max(0, Math.round(winInfo.cornerRadius))};\n`
        mainCode += '      int rrMax = (rgnW < rgnH ? rgnW : rgnH) / 2; if (rr > rrMax) rr = rrMax; if (rr < 0) rr = 0;\n'
        mainCode += '      HRGN hRgn = CreateRoundRectRgn(0, 0, rgnW + 1, rgnH + 1, rr * 2, rr * 2);\n'
      } else {
        mainCode += '      HRGN hRgn = CreateEllipticRgn(0, 0, rgnW + 1, rgnH + 1);\n'
      }
      mainCode += '      if (hRgn) SetWindowRgn(hWnd, hRgn, TRUE);\n'
      mainCode += '    }\n'
    }
    if (winInfo.disabled) mainCode += '    EnableWindow(hWnd, FALSE);\n'
    mainCode += `    ShowWindow(hWnd, ${winInfo.visible ? 'nCmdShow' : 'SW_HIDE'});\n`
    mainCode += '    UpdateWindow(hWnd);\n'
    mainCode += '    MSG msg;\n'
    mainCode += '    while (GetMessage(&msg, NULL, 0, 0)) {\n'
    if (winInfo.escClose) {
      // Esc键关闭：焦点在子控件时按键消息发给控件，须在消息循环预检
      mainCode += '        if (msg.message == WM_KEYDOWN && msg.wParam == VK_ESCAPE) {\n'
      mainCode += '            PostMessage(g_hMainWnd, WM_CLOSE, 0, 0);\n'
      mainCode += '            continue;\n'
      mainCode += '        }\n'
    }
    if (winInfo.enterAsTab) {
      // 回车下移焦点：多行编辑框保留回车换行语义
      mainCode += '        if (msg.message == WM_KEYDOWN && msg.wParam == VK_RETURN) {\n'
      mainCode += '            HWND ycFocus = GetFocus();\n'
      mainCode += '            wchar_t ycCls[16] = L""; if (ycFocus) GetClassNameW(ycFocus, ycCls, 16);\n'
      mainCode += '            BOOL ycMlEdit = (lstrcmpiW(ycCls, L"Edit") == 0) && (GetWindowLongW(ycFocus, GWL_STYLE) & ES_MULTILINE);\n'
      mainCode += '            if (!ycMlEdit) {\n'
      mainCode += '                HWND ycNext = GetNextDlgTabItem(g_hMainWnd, ycFocus, FALSE);\n'
      mainCode += '                if (ycNext && ycNext != ycFocus) { SetFocus(ycNext); continue; }\n'
      mainCode += '            }\n'
      mainCode += '        }\n'
    }
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

      // 与窗口分支一致注入支持库常量，否则控制台项目用 #键代码_回车 等常量会报 undeclared identifier。
      transpileProjectFile(f.fileName, content, libraryConstants)
    }

    mainCode += '/* 控制台程序入口点 */\n'
    mainCode += 'int main(int argc, char* argv[]) {\n'
    mainCode += '    SetConsoleOutputCP(65001);\n'
    mainCode += '    SetConsoleCP(65001);\n'
    mainCode += `    printf("程序开始运行...\\n");\n`
    mainCode += `    printf("项目: ${escapeCString(project.projectName)}\\n");\n`
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
  resetCompileDiagnosticContext()

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
    const additionalCFiles = generateMainC(project, tempDir, editorFiles, libsToLink, staticCmdDispatchLibs, !!options.debug, options.breakpoints || {}, targetPlatform, options.previewWindow)
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
      // 必须与实际加载一致地解析（优先 rc/ 子目录），否则 rc/ 下的资源修改
      // 不会改变指纹，重编译静默复用旧产物（exe 里还是旧图片）。
      .map(entry => collectFileStamp(resolveProjectResourcePath(project.projectDir, entry.fileName) ?? join(project.projectDir, entry.fileName)))
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

    // 平台系统库（advapi32=注册表、ole32=COM 初始化，webview2 等支持库需要；
    // comdlg32=通用对话框 GetOpenFileNameW，多文件对话框 用）
    if (targetPlatform === 'windows') {
      args.push('-lkernel32', '-luser32', '-lgdi32', '-lcomctl32', '-loleaut32', '-ladvapi32', '-lole32', '-lgdiplus', '-lcomdlg32')
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
          // 必须剥掉行尾 \r（zig 的 stderr 是 CRLF）：JS 正则里 \r 是行终止符、. 不匹配它，
          // 留着它下面所有以 $ 收尾的诊断正则会全部失配，友好化静默退化成透传英文原文。
          const lines = stderr.split('\n').map(l => l.trimEnd()).filter(Boolean)
          for (const line of lines) {
            // C++ 原文无删减进诊断日志：面板里被改写/折叠掉的细节，排查 ycIDE 自身问题时还得翻得到
            compileLogRaw(line)

            const lower = line.toLowerCase()

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

            // 诊断后跟的源码回显行与插入符行秀的是 temp/*.cpp 里的 C++——用户从没写过那些代码，
            // 面板里纯属噪音（原文已进日志）。clang 的 note: 同理，全是 C++ 实现细节。
            if (CLANG_ECHO_RE.test(line)) continue
            const noteMatch = line.match(CLANG_DIAGNOSTIC_RE)
            if (noteMatch && noteMatch[4].toLowerCase() === 'note') continue

            if (lower.includes('error')) {
              if (!reportFriendlyCppDiagnostic(line, 'error')) {
                sendMessage({ type: 'error', text: localizeCompilerMessage(line) })
              }
              result.errorCount++
            } else if (lower.includes('warning')) {
              if (!reportFriendlyCppDiagnostic(line, 'warning')) {
                sendMessage({ type: 'warning', text: localizeCompilerMessage(line) })
              }
              result.warningCount++
            } else {
              sendMessage({ type: 'info', text: localizeCompilerMessage(line) })
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
      // 必须 'buffer'：execFile 默认 encoding='utf8' 会对子进程 stdout/stderr 调用 setEncoding，
      // 于是 'data' 事件回调收到的是字符串而非 Buffer，下面的 TextDecoder.decode(字符串) 会抛
      // ERR_INVALID_ARG_TYPE 成为主进程未捕获异常、整个应用崩溃（如被运行程序退出时 libpng 往 stderr 写告警）。
      encoding: 'buffer',
    })

    runningProcess = proc
    let stdoutBuffer = ''
    let stderrBuffer = ''

    proc.on('spawn', () => {
      sendMessage({ type: 'success', text: `程序已启动 (PID: ${proc.pid})` })
    })

    // 流式解码：UTF-8 多字节字符可能被切在 chunk 边界，用 {stream:true} 的 TextDecoder
    // 保留半个字符到下一 chunk，避免逐 chunk toString('utf-8') 产生的 � 乱码。
    const stdoutDecoder = new TextDecoder('utf-8')
    const stderrDecoder = new TextDecoder('utf-8')

    // 防御：即便上游 encoding 变化导致 data 是字符串，也不再崩溃（TextDecoder.decode 只接受 Buffer/视图）。
    const decodeChunk = (decoder: TextDecoder, data: Buffer | string): string =>
      typeof data === 'string' ? data : decoder.decode(data, { stream: true })

    proc.stdout?.on('data', (data: Buffer | string) => {
      stdoutBuffer = emitBufferedOutputChunk(decodeChunk(stdoutDecoder, data), stdoutBuffer, 'info')
    })

    proc.stderr?.on('data', (data: Buffer | string) => {
      stderrBuffer = emitBufferedOutputChunk(decodeChunk(stderrDecoder, data), stderrBuffer, 'warning')
    })

    proc.on('exit', (code) => {
      flushBufferedOutputRemainder(stdoutBuffer, 'info')
      flushBufferedOutputRemainder(stderrBuffer, 'warning')
      // 身份校验：停止后立刻重新运行时，旧进程延迟到达的 exit 不得清空新进程的全局状态、
      // 也不该冒出"程序已退出"误导用户（否则停止按钮失效、断点续跑对新进程恒返回 false）。
      if (runningProcess !== proc) return
      runningProcess = null
      runningDebugCmdFile = null
      runningDebugResumeToken = 0
      sendMessage({ type: 'info', text: '' })
      if (code === 0) {
        sendMessage({ type: 'success', text: `程序已退出 (退出码: ${code})` })
      } else {
        sendMessage({ type: 'warning', text: `程序已退出 (退出码: ${code})` })
      }
      compilerHost?.notifyProcessExit(code)
    })

    proc.on('error', (err) => {
      if (runningProcess === proc) {
        runningProcess = null
        runningDebugCmdFile = null
        runningDebugResumeToken = 0
      }
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
