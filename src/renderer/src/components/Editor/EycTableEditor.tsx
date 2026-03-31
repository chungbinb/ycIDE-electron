import { useState, useCallback, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react'
import { matchScore, isEnglishMatch } from '../../utils/pinyin'
import { eycToYiFormat, sanitizePastedTextForCurrent, normalizeEycText } from './eycFormat'
import {
  buildBlocks,
  inferResourceTypeByFileName,
  parseLines,
  splitCSV,
  unquote,
} from './eycBlocks'
import {
  FLOW_AUTO_COMPLETE,
  FLOW_AUTO_TAG,
  FLOW_ELSE_MARK,
  FLOW_JUDGE_END_MARK,
  FLOW_KW,
  FLOW_LOOP_KW,
  FLOW_TRUE_MARK,
  computeFlowLines,
  extractFlowKw,
  getFlowStructureAround,
  isFlowMarkerLine,
} from './eycFlow'
import type { FlowSegment } from './eycFlow'
import type { RenderBlock } from './eycTableModel'
import type { LibWindowUnit } from './VisualDesigner'
import Icon from '../Icon/Icon'
import '../Icon/Icon.css'
import closeIcon from '../../assets/icons/Close.svg'
import './EycTableEditor.css'

// ========== 运算符格式化 ==========

function formatOps(val: string): string {
  // 统一字符串引号风格，便于失焦后呈现易语言常见样式
  val = val.replace(/"([^"\r\n]*)"/g, '“$1”')
  const strPlaceholders: string[] = []
  let s = val.replace(/["“](.*?)["”]/g, (m) => {
    strPlaceholders.push(m)
    return `\x00STR${strPlaceholders.length - 1}\x00`
  })
  s = s.replace(/(<>|!=)/g, ' ≠ ')
  s = s.replace(/<=/g, ' ≤ ')
  s = s.replace(/>=/g, ' ≥ ')
  s = s.replace(/＝/g, ' ＝ ')
  s = s.replace(/(?<!=)=(?!=)/g, ' ＝ ')
  s = s.replace(/</g, ' ＜ ')
  s = s.replace(/>/g, ' ＞ ')
  s = s.replace(/\+/g, ' ＋ ')
  s = s.replace(/(?<!\x00)-/g, ' － ')
  s = s.replace(/\*/g, ' × ')
  s = s.replace(/\//g, ' ÷ ')
  s = s.replace(/ {2,}/g, ' ').trim()
  s = s.replace(/\x00STR(\d+)\x00/g, (_, idx) => strPlaceholders[parseInt(idx)])
  return s
}

// ========== 流程线计算 ==========

interface Span { text: string; cls: string }

interface CompletionParam { name: string; type: string; description: string; optional: boolean; isVariable: boolean; isArray: boolean }
interface CompletionItem { name: string; englishName: string; description: string; returnType: string; category: string; libraryName: string; isMember: boolean; ownerTypeName: string; params: CompletionParam[] }

const MEMBER_DELIMITER_REGEX = /[。．]/g
const MEMBER_DELIMITERS = new Set(['.', '。', '．'])

const WINDOW_METHOD_WHITELIST = new Set([
  '取窗口句柄', '销毁', '获取焦点', '可有焦点',
  '取用户区宽度', '取用户区高度', '禁止重画', '允许重画',
  '重画', '部分重画', '取消重画', '刷新显示',
  '移动', '调整层次', '弹出菜单', '发送信息',
  '投递信息', '取标记组件', '置外形图片', '激活',
  '置托盘图标', '弹出托盘菜单', '置父窗口',
])

const NUMERIC_TYPE_COMMON_NOTE = '字节型、短整数型、整数型、长整数型、小数型、双精度小数型统称为数值型，彼此可转换；编程时需注意溢出与精度丢失（例如 257 转字节型后为 1）。'

const BUILTIN_TYPE_ITEMS: Array<{ name: string; englishName: string; description: string }> = [
  { name: '字节型', englishName: 'byte', description: '可容纳 0 到 255 之间的数值。' + NUMERIC_TYPE_COMMON_NOTE },
  { name: '短整数型', englishName: 'short', description: '可容纳 -32,768 到 32,767 之间的数值，尺寸为 2 个字节。' + NUMERIC_TYPE_COMMON_NOTE },
  { name: '整数型', englishName: 'int', description: '可容纳 -2,147,483,648 到 2,147,483,647 之间的数值，尺寸为 4 个字节。' + NUMERIC_TYPE_COMMON_NOTE },
  { name: '长整数型', englishName: 'int64', description: '可容纳 -9,223,372,036,854,775,808 到 9,223,372,036,854,775,807 之间的数值，尺寸为 8 个字节。' + NUMERIC_TYPE_COMMON_NOTE },
  { name: '小数型', englishName: 'float', description: '可容纳 3.4E +/- 38（7位小数）之间的数值，尺寸为 4 个字节。' + NUMERIC_TYPE_COMMON_NOTE },
  { name: '双精度小数型', englishName: 'double', description: '可容纳 1.7E +/- 308（15位小数）之间的数值，尺寸为 8 个字节。' + NUMERIC_TYPE_COMMON_NOTE },
  { name: '逻辑型', englishName: 'bool', description: '值只可能为“真”或“假”，尺寸为 2 个字节。“真”和“假”为系统预定义常量，其对应的英文常量名称为“true”和“false”。' },
  { name: '日期时间型', englishName: 'datetime', description: '用作记录日期及时间，尺寸为 8 个字节。' },
  { name: '文本型', englishName: 'text', description: '用作记录一段文本，文本由以字节 0 结束的一系列字符组成。' },
  { name: '字节集', englishName: 'bin', description: '用作记录一段字节型数据。字节集与字节数组之间可以互相转换，在程序中允许使用字节数组的地方也可以使用字节集，或者相反。字节数组的使用方法，譬如用中括号对“[]”加索引数值引用字节成员，使用数组型数值数据进行赋值等等，都可以被字节集所使用。两者之间唯一的不同是字节集可以变长，因此可把字节集看作可变长的字节数组。' },
  { name: '子程序指针', englishName: 'subptr', description: '用作指向一个子程序，尺寸为 4 个字节。具有此数据类型的容器可以用来间接调用子程序。参见例程 sample.e 中的相应部分。' },
  { name: '通用型', englishName: 'any', description: '可存放不同类型的数据，适用于需要接收多种类型值的场景。' },
]

const BUILTIN_LITERAL_COMPLETION_ITEMS: CompletionItem[] = [
  {
    name: '真',
    englishName: 'true',
    description: '逻辑真常量',
    returnType: '逻辑型',
    category: '常量',
    libraryName: '系统核心支持库',
    isMember: false,
    ownerTypeName: '',
    params: [],
  },
  {
    name: '假',
    englishName: 'false',
    description: '逻辑假常量',
    returnType: '逻辑型',
    category: '常量',
    libraryName: '系统核心支持库',
    isMember: false,
    ownerTypeName: '',
    params: [],
  },
  {
    name: '空',
    englishName: 'null',
    description: '空常量',
    returnType: '',
    category: '常量',
    libraryName: '系统核心支持库',
    isMember: false,
    ownerTypeName: '',
    params: [],
  },
]

const AC_PAGE_SIZE = 30

function colorize(raw: string): Span[] {
  const trimmed = raw.replace(/[\r\t]/g, '')
  let stripped = trimmed.replace(/^ +/, '')
  const indent = trimmed.length - stripped.length
  // 剥离流程标记零宽字符
  if (stripped.startsWith('\u200C') || stripped.startsWith('\u200D') || stripped.startsWith('\u2060')) {
    stripped = stripped.slice(1)
  }
  if (!stripped) return [{ text: '', cls: '' }]

  // 注释
  if (stripped.startsWith("'")) {
    return [
      ...(indent > 0 ? [{ text: '\u00A0'.repeat(indent), cls: '' }] : []),
      { text: stripped, cls: 'Remarkscolor' },
    ]
  }

  // 提取备注
  let code = stripped, remark = ''
  const ri = findRemark(stripped)
  if (ri >= 0) { code = stripped.slice(0, ri).trimEnd(); remark = stripped.slice(ri) }

  const spans: Span[] = []

  // 缩进树线
  if (indent > 0) {
    const lvl = Math.floor(indent / 4)
    for (let l = 0; l < lvl; l++) spans.push({ text: '\u2502\u00A0\u00A0\u00A0', cls: 'eTreeLine' })
    const ex = indent % 4
    if (ex > 0) spans.push({ text: '\u00A0'.repeat(ex), cls: '' })
  }

  // 流程控制以.开头
  if (code.startsWith('.')) {
    const kw = code.split(/[\s(（]/)[0]
    if (FLOW_KW.has(kw.slice(1))) {
      spans.push({ text: kw, cls: 'comecolor' })
      if (code.length > kw.length) spans.push(...colorExpr(code.slice(kw.length)))
    } else {
      spans.push(...colorExpr(code))
    }
  } else {
    const exprSpans = colorExpr(code)
    // 易语言中，非 . 开头的代码行首标识符视为命令调用
    // colorExpr 只在后面有括号时才标记 funccolor，这里补充处理无括号的情况
    if (exprSpans.length > 0 && exprSpans[0].cls === '') {
      const firstText = exprSpans[0].text
      const m = firstText.match(/^([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*)(.*)/)
      if (m) {
        const ident = m[1]
        const rest = m[2]
        // 后面紧跟 = 或 ＝ 的是赋值目标，不是命令调用
        if (/^\s*[=＝]/.test(rest)) {
          // 赋值目标：标记为 assignTarget，后续由渲染层检查有效性
          exprSpans.splice(0, 1,
            { text: ident, cls: 'assignTarget' },
            ...(rest ? [{ text: rest, cls: '' }] : [])
          )
        } else {
          exprSpans.splice(0, 1,
            { text: ident, cls: ident.includes('.') ? 'cometwolr' : 'funccolor' },
            ...(rest ? [{ text: rest, cls: '' }] : [])
          )
        }
      }
    }
    spans.push(...exprSpans)
  }

  if (remark) { spans.push({ text: ' ', cls: '' }); spans.push({ text: remark, cls: 'Remarkscolor' }) }
  return spans
}

function findRemark(s: string): number {
  let inS = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inS) { if (c === '"' || c === '\u201d') inS = false; continue }
    if (c === '"' || c === '\u201c') { inS = true; continue }
    if (c === "'" && i > 0) return i
  }
  return -1
}

function colorExpr(expr: string): Span[] {
  const out: Span[] = []
  let r = expr
  while (r.length > 0) {
    // 字符串
    const sm = r.match(/^([""\u201c])(.*?)([""\u201d])/)
    if (sm && r.startsWith(sm[1])) { out.push({ text: sm[0], cls: 'eTxtcolor' }); r = r.slice(sm[0].length); continue }

    // 常量 #
    if (r.startsWith('#')) {
      const end = r.slice(1).search(/[\s(（)）,，+＋\-－×÷=＝>＞<＜≥≤≈≠;：]/)
      const cn = end >= 0 ? r.slice(0, end + 1) : r
      out.push({ text: cn, cls: 'conscolor' }); r = r.slice(cn.length); continue
    }

    // 真/假
    const bm = r.match(/^(真|假)(?=[\s(（)）,，=＝]|$)/)
    if (bm) { out.push({ text: bm[0], cls: 'conscolor' }); r = r.slice(bm[0].length); continue }

    // 且/或
    const lm = r.match(/^(且|或)(?=[\s(（)）,，]|$)/)
    if (lm) { out.push({ text: lm[0], cls: 'funccolor' }); r = r.slice(lm[0].length); continue }

    // 括号
    if ('()（）{}[]'.includes(r[0])) { out.push({ text: r[0], cls: 'conscolor' }); r = r.slice(1); continue }

    // 函数调用（名字后面紧跟括号）
    const fm = r.match(/^([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*)\s*(?=[(\uff08])/)
    if (fm) {
      const name = fm[1]
      if (name.includes('.')) { out.push({ text: name, cls: 'cometwolr' }) }
      else if (FLOW_KW.has(name)) { out.push({ text: name, cls: 'comecolor' }) }
      else { out.push({ text: name, cls: 'funccolor' }) }
      r = r.slice(name.length); continue
    }

    // 普通文本
    const pm = r.match(/^[^""\u201c#(（)）{}\[\]]+/)
    if (pm) { out.push({ text: pm[0], cls: '' }); r = r.slice(pm[0].length); continue }
    out.push({ text: r[0], cls: '' }); r = r.slice(1)
  }
  return out
}

function getMissingAssignmentRhsTarget(rawLine: string): string | null {
  const trimmed = rawLine.replace(/[\r\t]/g, '').trim()
  const m = /^([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*)\s*(?:=|＝)\s*$/.exec(trimmed)
  return m ? m[1] : null
}

function isKnownAssignmentTarget(target: string, knownVars: Set<string>): boolean {
  const normalized = (target || '').trim().replace(MEMBER_DELIMITER_REGEX, '.')
  if (!normalized) return false
  const base = normalized.split('.')[0]?.trim() || ''
  if (!base) return false
  return knownVars.has(base)
}

function isValidVariableLikeName(name: string): boolean {
  return /^[\u4e00-\u9fa5A-Za-z_]/.test(name.trim())
}

// ========== 行重建 ==========

const DECL_PREFIXES = [
  '.程序集变量 ', '.程序集 ', '.子程序 ', '.局部变量 ',
  '.全局变量 ', '.常量 ', '.资源 ', '.数据类型 ', '.DLL命令 ',
  '.图片 ', '.声音 ', '.参数 ', '.成员 ',
]

function rebuildLineField(rawLine: string, fieldIdx: number, newValue: string, isSlice: boolean): string {
  const line = rawLine.replace(/\r/g, '')
  const stripped = line.replace(/^ +/, '')
  const indent = line.length - stripped.length

  for (const pf of DECL_PREFIXES) {
    if (stripped.startsWith(pf)) {
      const fieldsStr = stripped.slice(pf.length)
      const fields = splitCSV(fieldsStr)

      if (isSlice) {
        fields.splice(fieldIdx, fields.length - fieldIdx, newValue)
      } else {
        while (fields.length <= fieldIdx) fields.push('')
        fields[fieldIdx] = newValue
      }

      // 去除尾部空字段，避免产生多余逗号
      while (fields.length > 0 && fields[fields.length - 1] === '') fields.pop()

      return ' '.repeat(indent) + pf + fields.join(', ')
    }
  }

  return rawLine
}

function parseFlagFieldTokens(rawValue: string): string[] {
  return (rawValue || '')
    .split(/[,\s]+/)
    .map(token => token.trim())
    .filter(Boolean)
}

function rebuildLineFlagField(rawLine: string, fieldIdx: number, flag: string): string {
  const line = rawLine.replace(/\r/g, '')
  const stripped = line.replace(/^ +/, '')
  const indent = line.length - stripped.length

  for (const pf of DECL_PREFIXES) {
    if (!stripped.startsWith(pf)) continue
    const fieldsStr = stripped.slice(pf.length)
    const fields = splitCSV(fieldsStr)
    while (fields.length <= fieldIdx) fields.push('')
    const tokens = parseFlagFieldTokens(fields[fieldIdx] || '')
    const nextTokens = tokens.includes(flag)
      ? tokens.filter(token => token !== flag)
      : [...tokens, flag]
    fields[fieldIdx] = nextTokens.join(' ')
    while (fields.length > 0 && fields[fields.length - 1] === '') fields.pop()
    return ' '.repeat(indent) + pf + fields.join(', ')
  }

  return rawLine
}

// ========== 组件 ==========

export interface EycTableEditorHandle {
  insertSubroutine: () => void
  insertLocalVariable: () => void
  insertConstant: () => void
  navigateOrCreateSub: (subName: string, params: Array<{ name: string; dataType: string; isByRef: boolean }>) => void
  navigateToLine: (line: number) => void
  editorAction: (action: string) => void
}

interface EycTableEditorProps {
  value: string
  docLanguage?: string
  projectDir?: string
  isClassModule?: boolean
  projectGlobalVars?: Array<{ name: string; type: string }>
  windowControlNames?: string[]
  windowControlTypes?: Array<{ name: string; type: string }>
  windowUnits?: LibWindowUnit[]
  projectConstants?: Array<{ name: string; value: string; kind?: 'constant' | 'resource' }>
  projectDllCommands?: Array<{ name: string; returnType: string; description: string; params: CompletionParam[] }>
  projectDataTypes?: Array<{ name: string }>
  projectClassNames?: Array<{ name: string }>
  onClassNameRename?: (oldName: string, newName: string) => void
  onChange: (value: string) => void
  onCommandClick?: (commandName: string, paramIndex?: number) => void
  onCommandClear?: () => void
  onProblemsChange?: (problems: FileProblem[]) => void
  onCursorChange?: (line: number, column: number) => void
}

export interface FileProblem {
  line: number
  column: number
  message: string
  severity: 'error' | 'warning'
}

interface EditState {
  lineIndex: number
  cellIndex: number
  fieldIdx: number    // -1 表示无字段映射（代码行编辑整行）
  sliceField: boolean
  isVirtual?: boolean // 虚拟代码行（编辑时插入而非替换）
  paramIdx?: number   // 展开参数编辑：第几个参数 (0-based)
}

/** 根据命令类别返回图标字符 */
function getCmdIconLabel(category: string): string {
  const cat = category.toLowerCase()
  if (cat.includes('窗口') || cat.includes('组件') || cat.includes('控件')) return '◻'
  if (cat.includes('事件')) return '⚡'
  if (cat.includes('属性')) return '◆'
  if (cat.includes('方法') || cat.includes('成员')) return 'ƒ'
  if (cat.includes('常量')) return 'C'
  if (cat.includes('数据') || cat.includes('类型')) return 'T'
  if (cat.includes('流程') || cat.includes('控制')) return '⇥'
  if (cat.includes('文件') || cat.includes('磁盘')) return '📄'
  if (cat.includes('网络') || cat.includes('通信')) return '🌐'
  if (cat.includes('系统') || cat.includes('环境')) return '⚙'
  if (cat.includes('算') || cat.includes('数学')) return '∑'
  if (cat.includes('文本') || cat.includes('字符')) return 'S'
  if (cat.includes('时间') || cat.includes('日期')) return '⏱'
  if (cat.includes('数组')) return '[]'
  if (cat.includes('绘图') || cat.includes('图形')) return '🖌'
  return 'ƒ'
}

/** 根据命令类别返回图标CSS类 */
function getCmdIconClass(category: string): string {
  const cat = category.toLowerCase()
  if (cat.includes('窗口') || cat.includes('组件') || cat.includes('控件')) return 'eyc-ac-icon-widget'
  if (cat.includes('事件')) return 'eyc-ac-icon-event'
  if (cat.includes('属性')) return 'eyc-ac-icon-prop'
  if (cat.includes('全局变量')) return 'eyc-ac-icon-field'
  if (cat.includes('dll')) return 'eyc-ac-icon-dll'
  if (cat.includes('资源')) return 'eyc-ac-icon-resource'
  if (cat.includes('常量')) return 'eyc-ac-icon-const'
  if (cat.includes('数据') || cat.includes('类型')) return 'eyc-ac-icon-type'
  if (cat.includes('流程') || cat.includes('控制')) return 'eyc-ac-icon-flow'
  return 'eyc-ac-icon-func'
}

/** 找到文本中最外层括号的位置范围 (start=开括号位置, end=闭括号位置) */
function getOuterParenRange(text: string): { start: number; end: number } | null {
  const openIdx = text.search(/[(（]/)
  if (openIdx < 0) return null
  let depth = 0
  let inStr = false
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i]
    if (inStr) { if (ch === '"' || ch === '\u201d') inStr = false; continue }
    if (ch === '"' || ch === '\u201c') { inStr = true; continue }
    if (ch === '(' || ch === '（') depth++
    else if (ch === ')' || ch === '）') {
      depth--
      if (depth === 0) return { start: openIdx, end: i }
    }
  }
  return null
}

const EycTableEditor = forwardRef<EycTableEditorHandle, EycTableEditorProps>(function EycTableEditor({ value, docLanguage = '', projectDir, isClassModule = false, projectGlobalVars = [], windowControlNames = [], windowControlTypes = [], windowUnits = [], projectConstants = [], projectDllCommands = [], projectDataTypes = [], projectClassNames = [], onClassNameRename, onChange, onCommandClick, onCommandClear, onProblemsChange, onCursorChange }, ref) {
  const [editCell, setEditCell] = useState<EditState | null>(null)
  const [editVal, setEditVal] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const paramInputRef = useRef<HTMLInputElement>(null)
  const prevRef = useRef(value)
  const [currentText, setCurrentText] = useState(value)
  const lastFocusedLine = useRef<number>(-1)
  const flowMarkRef = useRef<string>('')
  const flowIndentRef = useRef<string>('')
  const userVarNamesRef = useRef<Set<string>>(new Set())
  const userSubNamesRef = useRef<Set<string>>(new Set())
  const wasFlowStartRef = useRef(false) // 编辑行是否为流程起始行（用于防止流程命令缩进翻倍）
  const commitGuardRef = useRef(false) // 防止 commit 被重复调用（mousedown + blur-on-unmount）
  const editCellOrigValRef = useRef<string>('') // 表格单元格编辑前的原始值（liveUpdate 会实时更新 lines，需保存原始值用于重命名比较）
  const [expandedLines, setExpandedLines] = useState<Set<number>>(new Set())
  const [expandedAssignRhsParamLines, setExpandedAssignRhsParamLines] = useState<Set<number>>(new Set())
  const isResourceTableDoc = docLanguage === 'erc'
  const [resourcePreview, setResourcePreview] = useState<{
    visible: boolean
    lineIndex: number
    resourceName: string
    resourceFile: string
    resourceType: string
    version: number
  }>({ visible: false, lineIndex: -1, resourceName: '', resourceFile: '', resourceType: '', version: 0 })
  const [resourcePreviewBusy, setResourcePreviewBusy] = useState(false)
  const [resourcePreviewSrc, setResourcePreviewSrc] = useState('')
  const [resourcePreviewMsg, setResourcePreviewMsg] = useState('')
  const [resourcePreviewMeta, setResourcePreviewMeta] = useState<{ mime: string; ext: string; filePath: string; sizeBytes: number; modifiedAtMs: number } | null>(null)
  const [resourcePreviewMediaMeta, setResourcePreviewMediaMeta] = useState<{ width?: number; height?: number; durationSec?: number }>({})

  const formatFileSize = useCallback((bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes < 0) return '未知'
    if (bytes < 1024) return `${bytes} B`
    const units = ['KB', 'MB', 'GB', 'TB']
    let value = bytes / 1024
    let idx = 0
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024
      idx += 1
    }
    return `${value.toFixed(value < 10 ? 2 : 1)} ${units[idx]}`
  }, [])

  const formatDateTime = useCallback((tsMs: number): string => {
    if (!Number.isFinite(tsMs) || tsMs <= 0) return '未知'
    return new Date(tsMs).toLocaleString('zh-CN', { hour12: false })
  }, [])

  const formatDuration = useCallback((seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return '未知'
    const total = Math.floor(seconds)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }, [])

  // ===== 行选择状态 =====
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set())
  const dragAnchor = useRef<number | null>(null)  // 拖选起点行号
  const isDragging = useRef(false)
  const dragStartPos = useRef<{ x: number; y: number } | null>(null)
  const wasDragSelect = useRef(false)
  const pendingInputDragRef = useRef<{ lineIndex: number; x: number; y: number; allowRowDrag: boolean } | null>(null)

  // ===== 撤销/重做栈 =====
  const undoStack = useRef<string[]>([])
  const redoStack = useRef<string[]>([])
  const pushUndo = useCallback((oldText: string) => {
    undoStack.current.push(oldText)
    if (undoStack.current.length > 200) undoStack.current.shift()
    redoStack.current = []
  }, [])

  const applySingleLineUpdate = useCallback((lineIndex: number, updater: (rawLine: string) => string | null): boolean => {
    const ls = currentText.split('\n')
    if (lineIndex < 0 || lineIndex >= ls.length) return false
    const nextLine = updater(ls[lineIndex])
    if (nextLine == null || nextLine === ls[lineIndex]) return false
    pushUndo(currentText)
    ls[lineIndex] = nextLine
    const nextText = ls.join('\n')
    setCurrentText(nextText)
    prevRef.current = nextText
    onChange(nextText)
    return true
  }, [currentText, onChange, pushUndo])

  const tryToggleTableBooleanCell = useCallback((tableType: string | undefined, lineIndex: number, cellIndex: number): boolean => {
    return applySingleLineUpdate(lineIndex, (rawLine) => {
      const parsed = parseLines(rawLine)[0]
      if (!parsed) return null

      if (parsed.type === 'dll' && cellIndex === 2) {
        return rebuildLineField(rawLine, 4, (parsed.fields[4] || '').trim() === '公开' ? '' : '公开', false)
      }
      if (parsed.type === 'sub' && cellIndex === 2) {
        return rebuildLineField(rawLine, 2, (parsed.fields[2] || '').trim() === '公开' ? '' : '公开', false)
      }
      if (parsed.type === 'localVar' && cellIndex === 2) {
        return rebuildLineField(rawLine, 2, (parsed.fields[2] || '').trim() === '静态' ? '' : '静态', false)
      }
      if (parsed.type === 'globalVar' && cellIndex === 3) {
        return rebuildLineField(rawLine, 2, (parsed.fields[2] || '').includes('公开') ? '' : '公开', false)
      }
      if (parsed.type === 'dataTypeMember' && cellIndex === 2) {
        return rebuildLineField(rawLine, 2, (parsed.fields[2] || '').trim() === '传址' ? '' : '传址', false)
      }
      if (parsed.type === 'subParam') {
        if (tableType === 'dll') {
          if (cellIndex === 2) return rebuildLineFlagField(rawLine, 2, '传址')
          if (cellIndex === 3) return rebuildLineFlagField(rawLine, 2, '数组')
          return null
        }
        if (cellIndex === 2) return rebuildLineFlagField(rawLine, 2, '参考')
        if (cellIndex === 3) return rebuildLineFlagField(rawLine, 2, '可空')
        if (cellIndex === 4) return rebuildLineFlagField(rawLine, 2, '数组')
      }

      return null
    })
  }, [applySingleLineUpdate])

  // ===== 行选择：拖选逻辑 =====
  // 从行号到实际元素的映射（用于鼠标位置判定）
  const wrapperRef = useRef<HTMLDivElement>(null)

  /** 根据鼠标 Y 坐标找到对应的行号 */
  const findLineAtY = useCallback((clientY: number): number => {
    if (!wrapperRef.current) return -1
    const rows = wrapperRef.current.querySelectorAll<HTMLElement>('[data-line-index]')
    let closest = -1
    for (const el of rows) {
      const li = parseInt(el.dataset.lineIndex!, 10)
      const rect = el.getBoundingClientRect()
      if (clientY >= rect.top && clientY < rect.bottom) return li
      if (clientY >= rect.top) closest = li
    }
    return closest
  }, [])

  /** 计算 anchor 到 end 之间的行集合 */
  const rangeSet = useCallback((a: number, b: number): Set<number> => {
    const lo = Math.min(a, b), hi = Math.max(a, b)
    const s = new Set<number>()
    for (let i = lo; i <= hi; i++) s.add(i)
    return s
  }, [])

  const handleLineMouseDown = useCallback((e: React.MouseEvent, lineIndex: number) => {
    // 正在编辑的输入框中不处理
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    // 命令点击不触发选择
    if ((e.target as HTMLElement).classList.contains('eyc-cmd-clickable')) return

    e.preventDefault()
    // 如果有活跃编辑，先提交当前编辑（含自动补全上屏）
    if (editCellRef.current) {
      commitRef.current()
    }
    dragStartPos.current = { x: e.clientX, y: e.clientY }
    wasDragSelect.current = false
    if (e.shiftKey && dragAnchor.current !== null) {
      // Shift+点击: 扩展选择到当前行
      setSelectedLines(rangeSet(dragAnchor.current, lineIndex))
    } else {
      dragAnchor.current = lineIndex
      // 普通单击不立即标记行选中，避免蓝色闪烁；只有实际拖动时才设置
    }
    isDragging.current = true
    // 聚焦 wrapper 以便接收键盘事件（Delete等）
    wrapperRef.current?.focus()
  }, [rangeSet])

  // mousemove 和 mouseup 全局监听
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!isDragging.current && pendingInputDragRef.current) {
        const p = pendingInputDragRef.current
        if (!p.allowRowDrag) return
        // 判断鼠标是否已离开 input 元素边界
        const inputEl = inputRef.current
        if (inputEl) {
          const rect = inputEl.getBoundingClientRect()
          const outside = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom
          if (outside) {
            if (editCellRef.current) commitRef.current()
            dragStartPos.current = { x: p.x, y: p.y }
            dragAnchor.current = p.lineIndex
            setSelectedLines(new Set([p.lineIndex]))
            isDragging.current = true
            wasDragSelect.current = true
            wrapperRef.current?.focus()
          }
        }
      }
      if (!isDragging.current || dragAnchor.current === null) return
      if (dragStartPos.current) {
        const dx = e.clientX - dragStartPos.current.x
        const dy = e.clientY - dragStartPos.current.y
        if (dx * dx + dy * dy > 25) wasDragSelect.current = true
      }
      // 只有确认是拖动后才更新行选中，避免普通点击时也出现蓝色高亮
      if (!wasDragSelect.current) return
      const li = findLineAtY(e.clientY)
      if (li >= 0) {
        // 确保锚点行也被选中（首次拖入超过阈值时）
        setSelectedLines(rangeSet(dragAnchor.current, li))
      }
    }
    const onUp = (): void => {
      isDragging.current = false
      pendingInputDragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [findLineAtY, rangeSet])

  // 全局键盘处理（选择状态下 Ctrl+C 复制、Delete 删除；Ctrl+A 全选）
  useEffect(() => {
    const getProtectedDeclarationLine = (ls: string[]): number => {
      const parsed = parseLines(ls.join('\n'))
      for (let i = 0; i < parsed.length; i++) {
        if (parsed[i].type === 'assembly') return i
      }
      return -1
    }

    const getDeletableSelection = (ls: string[], selection: Set<number>): { protectedLine: number; deletable: Set<number>; sorted: number[] } => {
      const protectedLine = getProtectedDeclarationLine(ls)
      const deletable = new Set<number>()
      for (const i of selection) {
        if (i < 0 || i >= ls.length) continue
        if (i === protectedLine) continue
        deletable.add(i)
      }
      return { protectedLine, deletable, sorted: Array.from(deletable).sort((a, b) => a - b) }
    }

    const getInsertAtForPastedSubs = (ls: string[], cursorLine: number): number => {
      if (cursorLine < 0 || cursorLine >= ls.length) return ls.length
      const parsed = parseLines(ls.join('\n'))
      let ownerSubLine = -1
      for (let i = Math.min(cursorLine, parsed.length - 1); i >= 0; i--) {
        if (parsed[i].type === 'sub') { ownerSubLine = i; break }
      }
      if (ownerSubLine < 0) return ls.length
      for (let i = ownerSubLine + 1; i < parsed.length; i++) {
        if (parsed[i].type === 'sub') return i
      }
      return ls.length
    }

    const handler = (e: KeyboardEvent): void => {
      // 正在编辑输入框时不处理（交给 onKey）
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      // 检查焦点是否在本编辑器区域内
      const inEditor = wrapperRef.current?.contains(document.activeElement as Node)
        || document.activeElement === wrapperRef.current
        || document.activeElement === document.body
        || wrapperRef.current?.closest('.eyc-table-editor')?.contains(document.activeElement as Node)

      const ctrl = e.ctrlKey || e.metaKey

      // Ctrl+A：全选所有行（只要焦点在编辑器区域）
      if (ctrl && e.key === 'a' && inEditor) {
        e.preventDefault()
        const ls = currentText.split('\n')
        const all = new Set<number>()
        for (let i = 0; i < ls.length; i++) all.add(i)
        setSelectedLines(all)
        dragAnchor.current = 0
        return
      }

      // Ctrl+Z / Ctrl+Y：撤销/重做（编辑器区域内）
      const key = e.key.toLowerCase()
      if (ctrl && key === 'z' && !e.shiftKey && inEditor) {
        e.preventDefault()
        if (undoStack.current.length > 0) {
          const prev = undoStack.current.pop()!
          redoStack.current.push(currentText)
          setCurrentText(prev); prevRef.current = prev; onChange(prev)
        }
        return
      }
      if (ctrl && (key === 'y' || (e.shiftKey && key === 'z')) && inEditor) {
        e.preventDefault()
        if (redoStack.current.length > 0) {
          const next = redoStack.current.pop()!
          undoStack.current.push(currentText)
          setCurrentText(next); prevRef.current = next; onChange(next)
        }
        return
      }

      // Ctrl+V：粘贴多行内容
      if (ctrl && e.key === 'v' && inEditor) {
        const state = editCellRef.current
        if (state && state.cellIndex === -1 && state.paramIdx === undefined) return
        if (shouldUseNativeInputPaste(editCellRef.current)) return
        e.preventDefault()
        navigator.clipboard.readText().then(clipText => {
          if (!clipText) return
          const sanitized = sanitizePastedTextForCurrent(clipText, currentText)
          const pastedLines = sanitized.split('\n').map(l => l.replace(/\r$/, ''))
          if (pastedLines.length === 0) return
          const pastedHasSub = parseLines(pastedLines.join('\n')).some(ln => ln.type === 'sub')
          const ls = currentText.split('\n')
          const cursorLine = editCellRef.current?.lineIndex ?? lastFocusedLine.current
          pushUndo(currentText)
          // 统一采用“向下插入”：不覆盖现有内容，连续粘贴会继续往下追加
          let insertAt = ls.length
          if (pastedHasSub) {
            insertAt = getInsertAtForPastedSubs(ls, cursorLine)
          } else if (cursorLine >= 0) {
            insertAt = Math.min(cursorLine + 1, ls.length)
          }
          const nl = [...ls]
          nl.splice(insertAt, 0, ...pastedLines)
          const nt = nl.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt)
          const newSel = new Set<number>()
          for (let i = 0; i < pastedLines.length; i++) newSel.add(insertAt + i)
          setSelectedLines(newSel)
          lastFocusedLine.current = insertAt + pastedLines.length - 1
        })
        return
      }

      // 以下操作需要有选中行且焦点在编辑器内
      if (selectedLines.size === 0 || !inEditor) return

      if (ctrl && e.key === 'c') {
        e.preventDefault()
        const sorted = [...selectedLines].sort((a, b) => a - b)
        const ls = currentText.split('\n')
        const selectedText = eycToYiFormat(sorted.filter(i => i < ls.length).map(i => ls[i]).join('\n'))
        navigator.clipboard.writeText(selectedText)
        return
      }
      if (ctrl && e.key === 'x') {
        e.preventDefault()
        const ls = currentText.split('\n')
        const { deletable, sorted } = getDeletableSelection(ls, selectedLines)
        if (sorted.length === 0) return
        const selectedText = eycToYiFormat(sorted.map(i => ls[i]).join('\n'))
        navigator.clipboard.writeText(selectedText)
        // 检查删除后是否会破坏流程结构（各区段最少保留1行）
        const checkedCmds = new Set<number>()
        const wouldBreak = sorted.some(i => {
          if (i >= ls.length) return false
          const st = getFlowStructureAround(ls, i)
          if (!st || checkedCmds.has(st.cmdLine)) return false
          checkedCmds.add(st.cmdLine)
          if (deletable.has(st.cmdLine)) return false // 命令行也选中，允许整体删除
          return st.sections.some(sec => {
            let remaining = 0
            for (let j = sec.startLine; j <= sec.endLine; j++) { if (!deletable.has(j)) remaining++ }
            return remaining < 1
          })
        })
        if (wouldBreak) return
        // 删除选中行
        pushUndo(currentText)
        const nl = ls.filter((_, i) => !deletable.has(i))
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt)
        setSelectedLines(new Set())
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        const ls = currentText.split('\n')
        // 检查删除后是否会破坏流程结构（各区段最少保留1行）
        const { deletable, sorted: sortedSel } = getDeletableSelection(ls, selectedLines)
        if (sortedSel.length === 0) return
        const checkedCmds2 = new Set<number>()
        const wouldBreak2 = sortedSel.some(i => {
          if (i >= ls.length) return false
          const st = getFlowStructureAround(ls, i)
          if (!st || checkedCmds2.has(st.cmdLine)) return false
          checkedCmds2.add(st.cmdLine)
          if (deletable.has(st.cmdLine)) return false
          return st.sections.some(sec => {
            let remaining = 0
            for (let j = sec.startLine; j <= sec.endLine; j++) { if (!deletable.has(j)) remaining++ }
            return remaining < 1
          })
        })
        if (wouldBreak2) return
        pushUndo(currentText)
        const nl = ls.filter((_, i) => !deletable.has(i))
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt)
        setSelectedLines(new Set())
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedLines, currentText, onChange, pushUndo])

  // ===== 自动补全状态 =====
  interface AcDisplayItem {
    cmd: CompletionItem
    engMatch: boolean
    isMore?: boolean
    remainCount?: number
    hiddenItems?: AcDisplayItem[]
  }
  const [acItems, setAcItems] = useState<AcDisplayItem[]>([])
  const [acIndex, setAcIndex] = useState(0)
  const [acVisible, setAcVisible] = useState(false)
  const [acPos, setAcPos] = useState({ left: 0, top: 0 })
  const [libraryDataTypeNames, setLibraryDataTypeNames] = useState<string[]>([])
  const [libraryConstants, setLibraryConstants] = useState<Array<{ name: string; englishName: string; description: string; value: string; libraryName: string }>>([])
  const allCommandsRef = useRef<CompletionItem[]>([])
  const memberCommandsRef = useRef<CompletionItem[]>([])
  const [cmdLoadId, setCmdLoadId] = useState(0) // 触发重新验证
  const acWordStartRef = useRef(0) // 当前补全词在 editVal 中的起始位置
  const acPrefixRef = useRef('')
  const acListRef = useRef<HTMLDivElement>(null)
  // 用 ref 跟踪最新值，以便在 useCallback 闭包中访问（避免依赖项膨胀）
  const editCellRef = useRef(editCell)
  editCellRef.current = editCell
  const shouldUseNativeInputPaste = useCallback((state: EditState | null): boolean => {
    if (!state) return false
    return state.cellIndex >= 0 || state.paramIdx !== undefined
  }, [])
  const acVisibleRef = useRef(false)
  acVisibleRef.current = acVisible
  const acItemsRef = useRef<AcDisplayItem[]>([])
  acItemsRef.current = acItems
  const userVarCompletionItemsRef = useRef<CompletionItem[]>([])
  const userSubCompletionItemsRef = useRef<CompletionItem[]>([])
  const constantCompletionItemsRef = useRef<CompletionItem[]>([])
  const libraryConstantCompletionItemsRef = useRef<CompletionItem[]>([])
  const dllCompletionItemsRef = useRef<CompletionItem[]>([])
  const typeCompletionItemsRef = useRef<CompletionItem[]>([])
  const classNameCompletionItemsRef = useRef<CompletionItem[]>([])

  const canUseTypeCompletion = useCallback((lineIndex: number, fieldIdx: number): boolean => {
    if (fieldIdx !== 1) return false
    const srcLines = currentText.split('\n')
    const raw = (srcLines[lineIndex] || '').replace(/[\r\t]/g, '').trimStart()
    return raw.startsWith('.局部变量 ')
      || raw.startsWith('.参数 ')
      || raw.startsWith('.程序集变量 ')
      || raw.startsWith('.程序集 ')
      || raw.startsWith('.全局变量 ')
      || raw.startsWith('.成员 ')
      || raw.startsWith('.子程序 ')
      || raw.startsWith('.DLL命令 ')
  }, [currentText])

  const canUseClassNameCompletion = useCallback((lineIndex: number, fieldIdx: number): boolean => {
    if (fieldIdx !== 1) return false
    const srcLines = currentText.split('\n')
    const raw = (srcLines[lineIndex] || '').replace(/[\r\t]/g, '').trimStart()
    return raw.startsWith('.程序集 ')
  }, [currentText])

  const windowControlTypeMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of windowControlTypes) {
      const name = (item?.name || '').trim()
      const type = (item?.type || '').trim()
      if (!name || !type) continue
      map.set(name, type)
    }
    return map
  }, [windowControlTypes])

  // 加载所有命令（用于补全），含流程关键字
  const reloadCommands = useCallback(() => {
    window.api.library.getAllCommands().then((cmds: CompletionItem[]) => {
      const seen = new Set<string>()
      const constantSeen = new Set<string>()
      const mapCmd = (c: CompletionItem) => ({
        name: c.name,
        englishName: c.englishName || '',
        description: c.description || '',
        returnType: c.returnType || '',
        category: c.category || '',
        libraryName: (c as CompletionItem & { libraryName?: string }).libraryName || '',
        isMember: !!(c as CompletionItem & { isMember?: boolean }).isMember,
        ownerTypeName: (c as CompletionItem & { ownerTypeName?: string }).ownerTypeName || '',
        params: (c.params || []).map((p: CompletionParam) => ({ name: p.name, type: p.type, description: p.description || '', optional: !!p.optional, isVariable: !!p.isVariable, isArray: !!p.isArray })),
      })
      // 独立函数命令（排除成员命令）
      const independentItems: CompletionItem[] = cmds
        .filter((c: CompletionItem & { isHidden?: boolean; isMember?: boolean }) => !c.isHidden && !c.isMember)
        .map(mapCmd)
        .filter(c => { if (seen.has(c.name)) return false; seen.add(c.name); return true })
      allCommandsRef.current = independentItems
      // 成员命令（属于组件/数据类型）
      const memberItems: CompletionItem[] = cmds
        .filter((c: CompletionItem & { isHidden?: boolean; isMember?: boolean }) => !c.isHidden && c.isMember)
        .map(mapCmd)
      memberCommandsRef.current = memberItems

      // 支持库常量候选：优先识别“常量”类别，其次识别以 # 开头的名称
      const libConstantItems: CompletionItem[] = cmds
        .filter((c: CompletionItem & { isHidden?: boolean; category?: string; name?: string }) => {
          if (c.isHidden) return false
          const category = c.category || ''
          const name = c.name || ''
          return category.includes('常量') || name.startsWith('#')
        })
        .map(mapCmd)
        .map((c) => {
          const normalizedName = c.name.startsWith('#') ? c.name.slice(1) : c.name
          return {
            ...c,
            name: normalizedName,
            category: '支持库常量',
          }
        })
        .filter(c => {
          const key = c.name.trim()
          if (!key || constantSeen.has(key)) return false
          constantSeen.add(key)
          return true
        })
      libraryConstantCompletionItemsRef.current = libConstantItems

      setCmdLoadId(n => n + 1)
    }).catch(() => {})
  }, [])

  // 初始加载 + 支持库变更时重新加载命令
  useEffect(() => {
    reloadCommands()
    window.api.on('library:loaded', reloadCommands)
    return () => { window.api.off('library:loaded') }
  }, [reloadCommands])

  // 从已加载支持库收集数据类型
  useEffect(() => {
    let cancelled = false
    const loadLibraryMeta = async () => {
      try {
        const list = await window.api.library.getList() as Array<{ name: string; loaded?: boolean }>
        const loadedLibs = (list || []).filter(lib => lib?.loaded !== false)
        const detailList = await Promise.all(loadedLibs.map(lib => window.api.library.getInfo(lib.name))) as Array<{ name?: string; dataTypes?: Array<{ name?: string }>; constants?: Array<{ name?: string; englishName?: string; description?: string; value?: string }> } | null>
        const names = new Set<string>()
        const constants: Array<{ name: string; englishName: string; description: string; value: string; libraryName: string }> = []
        const constSeen = new Set<string>()
        for (let i = 0; i < detailList.length; i++) {
          const detail = detailList[i]
          const libName = (detail?.name || loadedLibs[i]?.name || '支持库').trim()
          for (const dt of (detail?.dataTypes || [])) {
            const name = (dt?.name || '').trim()
            if (name) names.add(name)
          }

          for (const c of (detail?.constants || [])) {
            const name = (c?.name || '').trim()
            if (!name) continue
            const key = name
            if (constSeen.has(key)) continue
            constSeen.add(key)
            constants.push({
              name,
              englishName: (c?.englishName || '').trim(),
              description: (c?.description || '').trim(),
              value: (c?.value || '').trim(),
              libraryName: libName,
            })
          }
        }
        if (!cancelled) {
          setLibraryDataTypeNames([...names])
          setLibraryConstants(constants)
        }
      } catch {
        if (!cancelled) {
          setLibraryDataTypeNames([])
          setLibraryConstants([])
        }
      }
    }
    void loadLibraryMeta()
    window.api.on('library:loaded', loadLibraryMeta)
    return () => {
      cancelled = true
      window.api.off('library:loaded')
    }
  }, [])

  // 确保选中项始终可见
  useEffect(() => {
    if (acVisible && acListRef.current) {
      const selected = acListRef.current.children[acIndex] as HTMLElement | undefined
      selected?.scrollIntoView({ block: 'nearest' })
    }
  }, [acIndex, acVisible])

  /** 根据光标位置的"词"更新补全列表 */
  const updateCompletion = useCallback((val: string, cursorPos: number) => {
    if (!editCell) { setAcVisible(false); return }
    const isCodeEdit = editCell.cellIndex < 0
    const isClassNameCellEdit = editCell.cellIndex >= 0 && canUseClassNameCompletion(editCell.lineIndex, editCell.fieldIdx)
    const isTypeCellEdit = editCell.cellIndex >= 0 && canUseTypeCompletion(editCell.lineIndex, editCell.fieldIdx)
    if (!isCodeEdit && !isTypeCellEdit) { setAcVisible(false); return }

    // 引号内是自由文本输入，不弹补全窗（支持英文/中文引号）
    let inAsciiQuote = false
    let inCnQuote = false
    for (let i = 0; i < cursorPos; i++) {
      const ch = val[i]
      if (inAsciiQuote) {
        if (ch === '"' && val[i - 1] !== '\\') inAsciiQuote = false
        continue
      }
      if (inCnQuote) {
        if (ch === '”') inCnQuote = false
        continue
      }
      if (ch === '"') inAsciiQuote = true
      else if (ch === '“') inCnQuote = true
    }
    if (inAsciiQuote || inCnQuote) { setAcVisible(false); return }

    // 向前找当前输入词的起始位置（中文/英文/下划线连续字符）
    let wordStart = cursorPos
    while (wordStart > 0 && /[\u4e00-\u9fa5A-Za-z0-9_]/.test(val[wordStart - 1])) wordStart--
    let word = val.slice(wordStart, cursorPos)
    let hashMode = false

    if (wordStart > 0 && val[wordStart - 1] === '#') {
      hashMode = true
    }

    const isMemberAccess = wordStart > 0 && MEMBER_DELIMITERS.has(val[wordStart - 1])
    if (!isTypeCellEdit && !isClassNameCellEdit && !hashMode && word.length === 0 && !isMemberAccess) { setAcVisible(false); return }

    acWordStartRef.current = wordStart
    acPrefixRef.current = hashMode ? '#' : ''

    // 检查是否在"组件名."后面 → 显示成员命令
    let sourceList: CompletionItem[] = [
      ...BUILTIN_LITERAL_COMPLETION_ITEMS,
      ...userVarCompletionItemsRef.current,
      ...userSubCompletionItemsRef.current,
      ...dllCompletionItemsRef.current,
      ...allCommandsRef.current,
    ]
    if (isClassNameCellEdit) {
      sourceList = [...classNameCompletionItemsRef.current]
    } else if (isTypeCellEdit) {
      sourceList = [...typeCompletionItemsRef.current]
    } else if (hashMode) {
      const merged = [...constantCompletionItemsRef.current, ...libraryConstantCompletionItemsRef.current]
      const seen = new Set<string>()
      sourceList = merged.filter(item => {
        const key = item.name.trim()
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })
    } else if (isMemberAccess) {
      // 提取点号前的组件名
      let objEnd = wordStart - 1
      let objStart = objEnd
      while (objStart > 0 && /[\u4e00-\u9fa5A-Za-z0-9_]/.test(val[objStart - 1])) objStart--
      const objName = val.slice(objStart, objEnd)
      if (objName.length > 0) {
        const normalizeTypeName = (s: string): string => {
          const t = (s || '').trim()
          if (!t) return ''
          const parts = t.split(/[.:]/).map(p => p.trim()).filter(Boolean)
          const base = (parts.length > 0 ? parts[parts.length - 1] : t).toLowerCase()
          return base.replace(/(类型|类|组件|控件)$/u, '')
        }

        const mappedType = windowControlTypeMap.get(objName)
        const inferredType = objName.replace(/[0-9]+$/, '')
        const typeName = normalizeTypeName(mappedType || inferredType || objName)

        const toMemberItem = (name: string, englishName: string, description: string, category: string, returnType: string, ownerTypeName: string, libraryName: string, params: CompletionParam[] = []): CompletionItem => ({
          name,
          englishName,
          description,
          returnType,
          category,
          libraryName,
          isMember: true,
          ownerTypeName,
          params,
        })

        // 1) 来自窗口组件定义的属性（最可靠，最相关）
        const unitMembers: CompletionItem[] = []
        for (const unit of windowUnits) {
          const unitName = normalizeTypeName(unit.name)
          const unitEn = normalizeTypeName(unit.englishName || '')
          if (typeName && unitName !== typeName && unitEn !== typeName) continue

          for (const p of unit.properties || []) {
            const propName = (p.name || '').trim()
            if (!propName) continue
            unitMembers.push(toMemberItem(
              propName,
              (p.englishName || '').trim(),
              (p.description || '').trim(),
              '属性',
              (p.typeName || '').trim(),
              unit.name,
              unit.libraryName || '支持库'
            ))
          }
        }

        // 2) 来自成员命令的同类型方法/成员（排除事件）
        const commandMembers = memberCommandsRef.current.filter(c => {
          const owner = normalizeTypeName(c.ownerTypeName)
          if (!owner || !typeName) return false
          if (owner !== typeName) return false
          return !(c.category || '').includes('事件')
        })

        // 3) 将窗口通用方法并入所有控件成员补全（仅保留命令源中真实存在的方法）
        const windowMethods = [...memberCommandsRef.current, ...allCommandsRef.current]
          .filter(c => WINDOW_METHOD_WHITELIST.has((c.name || '').trim()))
          .filter(c => !((c.category || '').includes('事件')))

        const merged = [...unitMembers, ...commandMembers, ...windowMethods]
        const seen = new Set<string>()
        sourceList = merged.filter(item => {
          const key = `${item.category}:${item.name}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      }
    }

    const allowEmptyWord = isMemberAccess && !isTypeCellEdit && !isClassNameCellEdit && !hashMode && word.length === 0

    // 过滤并排序
    const fullMatches: AcDisplayItem[] = sourceList
      .map(cmd => ({
        cmd,
        score: isClassNameCellEdit
          ? (word.length === 0
            ? (cmd.name.length > 0 ? 1 : 0)
            : matchScore(word, cmd.name, cmd.englishName))
          : isTypeCellEdit
          ? (word.length === 0
            ? (cmd.name.length > 0 ? 1 : 0)
            : matchScore(word, cmd.name, cmd.englishName))
          : hashMode
          ? (word.length === 0
            ? (cmd.name.length > 0 ? 1 : 0)
            : matchScore(word, cmd.name, cmd.englishName))
          : (allowEmptyWord
            ? (cmd.name.length > 0 ? 1 : 0)
            : matchScore(word, cmd.name, cmd.englishName))
      }))
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score || a.cmd.name.length - b.cmd.name.length)
      .map(m => ({ cmd: m.cmd, engMatch: !isTypeCellEdit && !isClassNameCellEdit && !hashMode && isEnglishMatch(word, m.cmd.englishName) && !m.cmd.name.includes(word) }))

    if (fullMatches.length === 0) { setAcVisible(false); return }

    let matches = fullMatches
    if (fullMatches.length > AC_PAGE_SIZE) {
      const hiddenItems = fullMatches.slice(AC_PAGE_SIZE)
      matches = [
        ...fullMatches.slice(0, AC_PAGE_SIZE),
        {
          cmd: {
            name: '...',
            englishName: '',
            description: '双击显示剩余项',
            returnType: '',
            category: '补全提示',
            libraryName: '',
            isMember: false,
            ownerTypeName: '',
            params: [],
          },
          engMatch: false,
          isMore: true,
          remainCount: hiddenItems.length,
          hiddenItems,
        },
      ]
    }

    // 计算弹窗位置
    if (inputRef.current) {
      const input = inputRef.current
      const rect = input.getBoundingClientRect()
      // 用 canvas 估算光标像素位置
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      let leftOffset = 0
      if (ctx) {
        ctx.font = getComputedStyle(input).font || '13px Consolas, "Microsoft YaHei", monospace'
        leftOffset = ctx.measureText(val.slice(0, wordStart)).width
      }
      setAcPos({
        left: rect.left + leftOffset,
        top: rect.bottom + 2,
      })
    }

    setAcItems(matches)
    setAcIndex(0)
    setAcVisible(true)
  }, [editCell, canUseTypeCompletion, canUseClassNameCompletion, windowControlTypeMap])

  /** 应用补全项：替换当前输入词为命令名 */
  const applyCompletion = useCallback((displayItem: AcDisplayItem) => {
    if (displayItem.isMore) return
    const item = displayItem.cmd
    const wordStart = acWordStartRef.current
    const prefix = acPrefixRef.current
    const cursorPos = inputRef.current?.selectionStart ?? editVal.length
    const before = editVal.slice(0, prefix ? Math.max(0, wordStart - 1) : wordStart)
    const after = editVal.slice(cursorPos)
    const newVal = before + prefix + item.name + after
    setEditVal(newVal)
    setAcVisible(false)
    setTimeout(() => {
      if (inputRef.current) {
        const newPos = before.length + prefix.length + item.name.length
        inputRef.current.selectionStart = newPos
        inputRef.current.selectionEnd = newPos
        inputRef.current.focus()
      }
    }, 0)
  }, [editVal])

  const expandMoreCompletion = useCallback((index: number) => {
    setAcItems(prev => {
      const item = prev[index]
      if (!item || !item.isMore || !item.hiddenItems || item.hiddenItems.length === 0) return prev
      return [...prev.slice(0, index), ...item.hiddenItems]
    })
    setAcIndex(index)
  }, [])

  /** 代码行编辑结束时自动补全括号（格式化命令），返回 [主行, ...需要插入的后续行] */
  const formatCommandLine = useCallback((val: string): string[] => {
    const trimmed = val.trimStart()
    if (!trimmed || trimmed.startsWith("'")) return [val]

    // 赋值表达式：identifier = expr → 格式化运算符
    const assignM = trimmed.match(/^([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*)\s*(?:=(?!=)|＝)/)
    if (assignM && isKnownAssignmentTarget(assignM[1], userVarNamesRef.current)) {
      const indentLen = val.length - trimmed.length
      return [val.slice(0, indentLen) + formatOps(trimmed)]
    }

    const indent = val.length - trimmed.length
    const prefix = val.slice(0, indent)

    const allCmdPool = [
      ...allCommandsRef.current,
      ...dllCompletionItemsRef.current,
      ...memberCommandsRef.current,
    ]

    const resolveCmdToken = (token: string): { normalizedToken: string; lookupName: string; command: CompletionItem | null } => {
      const normalizedToken = token.replace(MEMBER_DELIMITER_REGEX, '.')
      const dotIndex = normalizedToken.lastIndexOf('.')
      if (dotIndex >= 0) {
        const objPrefix = normalizedToken.slice(0, dotIndex + 1)
        const memberName = normalizedToken.slice(dotIndex + 1)
        const cmd = allCmdPool.find(c => c.name === memberName || ((c.englishName || '').trim() === memberName)) || null
        return { normalizedToken, lookupName: cmd?.name || memberName, command: cmd }
      }

      const cmd = allCmdPool.find(c => c.name === normalizedToken || ((c.englishName || '').trim() === normalizedToken)) || null
      return { normalizedToken, lookupName: cmd?.name || normalizedToken, command: cmd }
    }

    // 提取命令名（支持“命令名”或“命令名 (...)”两种输入）
    const rawCmdToken = trimmed.split(/[\s(（]/)[0]
    const resolved = resolveCmdToken(rawCmdToken)
    const cmdName = resolved.normalizedToken
    const lookupCmdName = resolved.lookupName
    if (!/^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*$/.test(cmdName)) return [val]

    // 流程控制命令自动补齐后续行
    const autoLines = FLOW_AUTO_COMPLETE[cmdName]
    if (autoLines) {
      const cmd = resolved.command || allCmdPool.find(c => c.name === lookupCmdName)
      // 命令本身和内部代码行都缩进4空格（两个汉字宽度）给流程线留空间
      const innerPrefix = prefix + '    '
      let mainLine: string
      const parenRange = getOuterParenRange(trimmed)
      if (parenRange) {
        // 已输入括号时尽量保留用户输入参数内容，再做流程补齐
        const argText = trimmed.slice(parenRange.start + 1, parenRange.end).trim()
        mainLine = innerPrefix + cmdName + ' (' + argText + ')'
      } else if (cmd && cmd.params.length > 0) {
        const paramSlots = cmd.params.map(p => p.optional ? '' : '').join(', ')
        mainLine = innerPrefix + cmdName + ' (' + paramSlots + ')'
      } else {
        mainLine = innerPrefix + cmdName + ' ()'
      }
      // 自动插入的分支/结束行
      const extra = autoLines.map(kw => {
        if (kw === null) return ''
        if (kw === FLOW_TRUE_MARK || kw === FLOW_ELSE_MARK || kw === FLOW_JUDGE_END_MARK) return innerPrefix + kw
        // 流程尾命令也需要括号（如 计次循环尾）
        const tailCmd = allCommandsRef.current.find(c => c.name === kw)
        if (tailCmd && tailCmd.params.length > 0) {
          const tailSlots = tailCmd.params.map(p => p.optional ? '' : '').join(', ')
          return innerPrefix + FLOW_AUTO_TAG + kw + ' (' + tailSlots + ')'
        }
        return innerPrefix + FLOW_AUTO_TAG + kw + ' ()'
      })
      return [mainLine, ...extra]
    }

    // 普通命令：仅对“裸命令名”自动补括号
    const m = trimmed.match(/^([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*)\s*$/)
    if (!m) return [val]

    if (trimmed.startsWith('.')) return [val]
    const cmd = resolved.command || allCmdPool.find(c => c.name === lookupCmdName)
    if (!cmd) {
      if (userSubNamesRef.current.has(cmdName)) {
        return [prefix + cmdName + ' ()']
      }
      return [val]
    }

    if (cmd.params.length === 0) {
      return [prefix + cmdName + ' ()']
    }
    const paramSlots = cmd.params.map(p => p.optional ? '' : '').join(', ')
    return [prefix + cmdName + ' (' + paramSlots + ')']
  }, [])

  useEffect(() => {
    if (value !== prevRef.current) { setCurrentText(value); prevRef.current = value }
  }, [value])

  const lines = useMemo(() => currentText.split('\n'), [currentText])
  const parsedLines = useMemo(() => parseLines(currentText), [currentText])

  const findOwnerSubName = useCallback((lineIndex: number): string => {
    for (let i = lineIndex; i >= 0; i--) {
      const ln = parsedLines[i]
      if (ln?.type === 'sub') return (ln.fields[0] || '').trim()
    }
    return ''
  }, [parsedLines])

  const findOwnerAssemblyName = useCallback((lineIndex: number): string => {
    for (let i = lineIndex; i >= 0; i--) {
      const ln = parsedLines[i]
      if (ln?.type === 'assembly') return (ln.fields[0] || '').trim()
    }
    return ''
  }, [parsedLines])

  const handleTableCellHint = useCallback((lineIndex: number, fieldIdx: number, cellText: string): void => {
    if (!onCommandClick || fieldIdx < 0) return
    const ln = parsedLines[lineIndex]
    if (!ln) return
    const val = (cellText || '').replace(/\u00A0/g, '').trim()
    if (!val) return

    if (fieldIdx === 1 && (ln.type === 'subParam' || ln.type === 'localVar' || ln.type === 'globalVar' || ln.type === 'assemblyVar' || ln.type === 'dataTypeMember' || ln.type === 'dll' || ln.type === 'sub' || ln.type === 'assembly')) {
      onCommandClick(`__TYPE__:${val}`)
      return
    }

    if (fieldIdx === 0 && ln.type === 'subParam') {
      const paramName = val
      const paramType = (ln.fields[1] || '').trim()
      const ownerSub = findOwnerSubName(lineIndex)
      onCommandClick(`__PARAM__:${paramName}:${paramType}:${ownerSub}`)
      return
    }

    if (fieldIdx === 0 && ln.type === 'sub') {
      const ownerAssembly = findOwnerAssemblyName(lineIndex)
      onCommandClick(`__SUBDECL__:${val}:${ownerAssembly}`)
    }
  }, [findOwnerAssemblyName, findOwnerSubName, onCommandClick, parsedLines])

  const blocks = useMemo<RenderBlock[]>(() => {
    try {
      return buildBlocks(currentText, isClassModule, isResourceTableDoc)
    } catch (error) {
      console.error('[EycTableEditor] buildBlocks failed, fallback to line blocks', error)
      return currentText.split('\n').map((line, idx): RenderBlock => ({
        kind: 'codeline' as const,
        rows: [],
        codeLine: line,
        lineIndex: idx,
        isVirtual: false,
      }))
    }
  }, [currentText, isClassModule, isResourceTableDoc])
  const flowLines = useMemo(() => {
    try {
      return computeFlowLines(blocks)
    } catch (error) {
      console.error('[EycTableEditor] computeFlowLines failed, disable flow rendering for current content', error)
      return { map: new Map<number, FlowSegment[]>(), maxDepth: 0 }
    }
  }, [blocks])

  // 对实际渲染的可见行按顺序分配连续行号（跳过 isHeader / isVirtual）
  // 注意：表格内可能存在多个可见行映射到同一源码 lineIndex（如 DLL 命令块），
  // 行号显示应按“可见行”递增，而不是按源码行号去重。
  const lineNumMaps = useMemo(() => {
    const tableRowNumMap = new Map<string, number>()
    const codeLineNumMap = new Map<number, number>()
    let display = 0
    for (let bi = 0; bi < blocks.length; bi++) {
      const blk = blocks[bi]
      if (blk.kind === 'table') {
        for (let ri = 0; ri < blk.rows.length; ri++) {
          const row = blk.rows[ri]
          if (row.isHeader) continue
          display++
          tableRowNumMap.set(`${bi}:${ri}`, display)
        }
      } else {
        if (!blk.isVirtual) {
          display++
          codeLineNumMap.set(blk.lineIndex, display)
        }
      }
    }
    return { tableRowNumMap, codeLineNumMap }
  }, [blocks])

  const getSelectedSourceText = useCallback((): string => {
    const sorted = [...selectedLines].sort((a, b) => a - b)
    const ls = currentText.split('\n')
    const raw = sorted.filter(i => i >= 0 && i < ls.length).map(i => ls[i]).join('\n')
    return eycToYiFormat(raw)
  }, [selectedLines, currentText])

  const getMouseRangeSelectedSourceText = useCallback((): string | null => {
    if (!wrapperRef.current) return null
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
    const range = selection.getRangeAt(0)
    if (!wrapperRef.current.contains(range.commonAncestorContainer)) return null

    const nativeText = selection.toString()
    const lineElements = Array.from(wrapperRef.current.querySelectorAll<HTMLElement>('[data-line-index]'))
    const lineIndices = Array.from(new Set(
      lineElements
        .filter(el => range.intersectsNode(el))
        .map(el => Number.parseInt(el.dataset.lineIndex || '', 10))
        .filter(idx => Number.isInteger(idx) && idx >= 0),
    )).sort((a, b) => a - b)

    if (lineIndices.length < 2 || nativeText.includes('\n')) return null

    const ls = currentText.split('\n')
    const raw = lineIndices.filter(i => i < ls.length).map(i => ls[i]).join('\n')
    return raw ? eycToYiFormat(raw) : null
  }, [currentText])

  // 收集用户定义的子程序名和变量名
  const { userSubNames, userVarNames } = useMemo(() => {
    const subs = new Set<string>()
    const vars = new Set<string>()
    const parsed = parseLines(currentText)
    for (const ln of parsed) {
      if (ln.type === 'sub' && ln.fields[0]) subs.add(ln.fields[0])
      if ((ln.type === 'localVar' || ln.type === 'subParam' || ln.type === 'assemblyVar' || ln.type === 'globalVar') && ln.fields[0]) vars.add(ln.fields[0])
    }
    return { userSubNames: subs, userVarNames: vars }
  }, [currentText])
  const projectGlobalVarNameSet = useMemo(() => new Set(projectGlobalVars.map(v => v.name).filter(Boolean)), [projectGlobalVars])
  const windowControlNameSet = useMemo(() => new Set(windowControlNames.map(n => (n || '').trim()).filter(Boolean)), [windowControlNames])
  const allKnownVarNames = useMemo(() => {
    const set = new Set<string>(userVarNames)
    for (const n of projectGlobalVarNameSet) set.add(n)
    for (const n of windowControlNameSet) set.add(n)
    return set
  }, [userVarNames, projectGlobalVarNameSet, windowControlNameSet])
  useEffect(() => { userVarNamesRef.current = allKnownVarNames }, [allKnownVarNames])
  useEffect(() => { userSubNamesRef.current = userSubNames }, [userSubNames])

  // 生成用于补全的用户变量项（局部/参数按当前子程序作用域）
  const userVarCompletionItems = useMemo<CompletionItem[]>(() => {
    const parsed = parseLines(currentText)
    const cursorLine = editCell?.lineIndex ?? -1

    let subStart = -1
    let subEnd = parsed.length
    if (cursorLine >= 0 && cursorLine < parsed.length) {
      for (let i = cursorLine; i >= 0; i--) {
        const t = parsed[i].type
        if (t === 'sub') { subStart = i; break }
        if (t === 'assembly') break
      }
      if (subStart >= 0) {
        for (let i = subStart + 1; i < parsed.length; i++) {
          const t = parsed[i].type
          if (t === 'sub' || t === 'assembly') { subEnd = i; break }
        }
      }
    }

    const items: CompletionItem[] = []
    const seen = new Set<string>()
    const addVar = (name: string, varType: string, category: string): void => {
      const nm = (name || '').trim()
      if (!nm || seen.has(nm)) return
      seen.add(nm)
      items.push({
        name: nm,
        englishName: '',
        description: varType ? `${category}（${varType}）` : category,
        returnType: varType || '',
        category,
        libraryName: '用户定义',
        isMember: false,
        ownerTypeName: '',
        params: [],
      })
    }

    // 当前子程序的参数/局部变量优先（更贴近当前输入上下文）
    if (subStart >= 0) {
      for (let i = subStart + 1; i < subEnd; i++) {
        const ln = parsed[i]
        if ((ln.type === 'subParam' || ln.type === 'localVar') && ln.fields[0]) {
          addVar(ln.fields[0], (ln.fields[1] || '').trim(), ln.type === 'subParam' ? '参数' : '局部变量')
        }
      }
    }

    // 程序集变量
    for (const ln of parsed) {
      if (ln.type === 'assemblyVar' && ln.fields[0]) {
        addVar(ln.fields[0], (ln.fields[1] || '').trim(), '程序集变量')
      }
    }

    // 全局变量
    for (const ln of parsed) {
      if (ln.type === 'globalVar' && ln.fields[0]) {
        addVar(ln.fields[0], (ln.fields[1] || '').trim(), '全局变量')
      }
    }

    // 项目级全局变量（来自 .egv 文件与其他已打开标签页）
    for (const v of projectGlobalVars) {
      addVar(v.name, v.type || '', '全局变量')
    }

    // 当前窗口设计器中的控件实例名（如 按钮1）
    for (const controlName of windowControlNames) {
      addVar(controlName, '', '窗口组件')
    }

    return items
  }, [currentText, editCell?.lineIndex, projectGlobalVars, windowControlNames])
  useEffect(() => {
    userVarCompletionItemsRef.current = userVarCompletionItems
  }, [userVarCompletionItems])

  const userSubCompletionItems = useMemo<CompletionItem[]>(() => {
    const items: CompletionItem[] = []
    for (const subName of userSubNames) {
      const name = (subName || '').trim()
      if (!name) continue
      items.push({
        name,
        englishName: '',
        description: '用户子程序',
        returnType: '',
        category: '子程序',
        libraryName: '用户定义',
        isMember: false,
        ownerTypeName: '',
        params: [],
      })
    }
    return items
  }, [userSubNames])
  useEffect(() => {
    userSubCompletionItemsRef.current = userSubCompletionItems
  }, [userSubCompletionItems])

  const constantCompletionItems = useMemo<CompletionItem[]>(() => {
    const parsed = parseLines(currentText)
    const items: CompletionItem[] = []
    const seen = new Set<string>()

    const addConstant = (
      name: string,
      constantValue: string,
      englishName = '',
      description = '',
      libraryName = '用户定义',
      category: '常量' | '资源' = '常量',
    ): void => {
      const nm = (name || '').trim()
      if (!nm || seen.has(nm)) return
      seen.add(nm)
      const val = (constantValue || '').trim()
      const desc = description.trim()
      const typeLabel = category === '资源' ? '资源' : '常量'
      items.push({
        name: nm,
        englishName: (englishName || '').trim(),
        description: desc || (val ? `${typeLabel}（值：${val}）` : typeLabel),
        returnType: '',
        category,
        libraryName,
        isMember: false,
        ownerTypeName: '',
        params: [],
      })
    }

    for (const item of BUILTIN_LITERAL_COMPLETION_ITEMS) {
      addConstant(
        item.name,
        '',
        item.englishName,
        item.description,
        item.libraryName,
        '常量',
      )
    }

    for (const ln of parsed) {
      if (ln.type === 'constant' && ln.fields[0]) {
        addConstant(ln.fields[0], ln.fields[1] || '')
      }
    }

    for (const c of projectConstants) {
      addConstant(c.name, c.value || '', '', '', '用户定义', c.kind === 'resource' ? '资源' : '常量')
    }

    for (const c of libraryConstants) {
      addConstant(c.name, c.value || '', c.englishName || '', c.description || '', c.libraryName || '支持库')
    }

    return items
  }, [currentText, projectConstants, libraryConstants])

  useEffect(() => {
    constantCompletionItemsRef.current = constantCompletionItems
  }, [constantCompletionItems])

  const dllCompletionItems = useMemo<CompletionItem[]>(() => {
    const parsed = parseLines(currentText)
    const items: CompletionItem[] = []
    const seen = new Set<string>()

    const addDll = (name: string, returnType: string, description: string, params: CompletionParam[]) => {
      const nm = (name || '').trim()
      if (!nm || seen.has(nm)) return
      seen.add(nm)
      items.push({
        name: nm,
        englishName: '',
        description: description || (returnType ? `DLL命令（返回：${returnType}）` : 'DLL命令'),
        returnType: returnType || '',
        category: 'DLL命令',
        libraryName: '用户定义',
        isMember: false,
        ownerTypeName: '',
        params: (params || []).map(p => ({
          name: p.name,
          type: p.type,
          description: p.description || '',
          optional: !!p.optional,
          isVariable: !!p.isVariable,
          isArray: !!p.isArray,
        })),
      })
    }

    // 当前文档内的 DLL 命令
    const currentDocDllMap = new Map<string, { returnType: string; description: string; params: CompletionParam[] }>()
    let currentDllName = ''
    for (const ln of parsed) {
      if (ln.type === 'dll') {
        const name = (ln.fields[0] || '').trim()
        if (!name) {
          currentDllName = ''
          continue
        }
        currentDllName = name
        if (!currentDocDllMap.has(name)) {
          currentDocDllMap.set(name, {
            returnType: (ln.fields[1] || '').trim(),
            description: ln.fields.length > 5 ? ln.fields.slice(5).join(', ').trim() : '',
            params: [],
          })
        }
        continue
      }

      if (ln.type === 'sub') {
        currentDllName = ''
        continue
      }

      if (ln.type === 'subParam' && currentDllName) {
        const target = currentDocDllMap.get(currentDllName)
        if (!target) continue
        const flags = (ln.fields[2] || '').trim()
        target.params.push({
          name: (ln.fields[0] || '').trim(),
          type: (ln.fields[1] || '').trim(),
          description: ln.fields.length > 3 ? ln.fields.slice(3).join(', ').trim() : '',
          optional: flags.includes('可空'),
          isVariable: flags.includes('传址'),
          isArray: flags.includes('数组'),
        })
      }
    }

    for (const [name, meta] of currentDocDllMap.entries()) {
      addDll(name, meta.returnType, meta.description, meta.params)
    }

    // 项目级 DLL 命令（来自 .ell 与其他已打开标签页）
    for (const c of projectDllCommands) {
      addDll(c.name, c.returnType || '', c.description || '', c.params || [])
    }

    return items
  }, [currentText, projectDllCommands])

  useEffect(() => {
    dllCompletionItemsRef.current = dllCompletionItems
  }, [dllCompletionItems])

  const typeCompletionItems = useMemo<CompletionItem[]>(() => {
    const items: CompletionItem[] = []
    const seen = new Set<string>()

    const addType = (name: string, category: string, englishName = '', description?: string) => {
      const nm = (name || '').trim()
      if (!nm || seen.has(nm)) return
      seen.add(nm)
      items.push({
        name: nm,
        englishName,
        description: description || category,
        returnType: '',
        category,
        libraryName: '用户定义',
        isMember: false,
        ownerTypeName: '',
        params: [],
      })
    }

    // 基础数据类型始终可用，不依赖支持库数据类型列表
    for (const t of BUILTIN_TYPE_ITEMS) addType(t.name, '基础数据类型', t.englishName, t.description)

    for (const t of libraryDataTypeNames) addType(t, '支持库数据类型')

    const parsed = parseLines(currentText)
    for (const ln of parsed) {
      if (ln.type === 'dataType' && ln.fields[0]) {
        addType(ln.fields[0], '自定义数据类型')
      }
    }

    for (const dt of projectDataTypes) {
      addType(dt.name, '自定义数据类型')
    }

    // 项目类模块中的类名也可作为返回值类型/数据类型使用
    for (const c of projectClassNames) {
      addType(c.name, '项目类名')
    }

    return items
  }, [currentText, libraryDataTypeNames, projectDataTypes, projectClassNames])

  useEffect(() => {
    typeCompletionItemsRef.current = typeCompletionItems
  }, [typeCompletionItems])

  const classNameCompletionItems = useMemo<CompletionItem[]>(() => {
    const items: CompletionItem[] = []
    const seen = new Set<string>()

    const addClass = (name: string) => {
      const nm = (name || '').trim()
      if (!nm || seen.has(nm)) return
      seen.add(nm)
      items.push({
        name: nm,
        englishName: '',
        description: '项目类模块',
        returnType: '',
        category: '类名',
        libraryName: '用户定义',
        isMember: false,
        ownerTypeName: '',
        params: [],
      })
    }

    const parsed = parseLines(currentText)
    for (const ln of parsed) {
      if (ln.type === 'assembly' && ln.fields[0]) {
        addClass(ln.fields[0])
      }
    }

    for (const c of projectClassNames) addClass(c.name)

    return items
  }, [currentText, projectClassNames])

  useEffect(() => {
    classNameCompletionItemsRef.current = classNameCompletionItems
  }, [classNameCompletionItems])

  // 有效命令名集合（支持库命令 + 用户子程序 + 流程关键字 + 变量名）
  const validCommandNames = useMemo(() => {
    const s = new Set<string>()
    for (const c of allCommandsRef.current) s.add(c.name)
    for (const c of dllCompletionItemsRef.current) s.add(c.name)
    for (const n of userSubNames) s.add(n)
    for (const n of allKnownVarNames) s.add(n)
    for (const k of FLOW_KW) s.add(k)
    return s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSubNames, allKnownVarNames, cmdLoadId, dllCompletionItems])

  const missingRhsLineSet = useMemo(() => {
    const set = new Set<number>()
    for (const blk of blocks) {
      if (blk.kind !== 'codeline' || !blk.codeLine) continue
      const rawLine = blk.codeLine.replace(FLOW_AUTO_TAG, '')
      if (getMissingAssignmentRhsTarget(rawLine)) set.add(blk.lineIndex)
    }
    return set
  }, [blocks])

  const invalidVarNameLineSet = useMemo(() => {
    const set = new Set<number>()
    const parsed = parseLines(currentText)
    for (let i = 0; i < parsed.length; i++) {
      const ln = parsed[i]
      if (ln.type === 'localVar' || ln.type === 'assemblyVar' || ln.type === 'globalVar' || ln.type === 'subParam') {
        const name = (ln.fields[0] || '').trim()
        if (name && !isValidVariableLikeName(name)) set.add(i)
      }
    }
    return set
  }, [currentText])

  // 计算问题列表（无效命令 + 变量名冲突）
  useEffect(() => {
    if (!onProblemsChange) return
    const problems: FileProblem[] = []

    // 无效命令检查
    if (allCommandsRef.current.length > 0) {
      for (const blk of blocks) {
        if (blk.kind !== 'codeline' || !blk.codeLine) continue
        const rawLine = blk.codeLine.replace(FLOW_AUTO_TAG, '')
        const spans = colorize(rawLine)
        let col = 1
        for (const s of spans) {
          if (s.cls === 'funccolor' && !validCommandNames.has(s.text)) {
            problems.push({ line: blk.lineIndex + 1, column: col, message: `未知命令"${s.text}"`, severity: 'error' })
          }
          if (s.cls === 'assignTarget' && !isKnownAssignmentTarget(s.text, allKnownVarNames)) {
            problems.push({ line: blk.lineIndex + 1, column: col, message: `未知变量"${s.text}"`, severity: 'error' })
          }
          col += s.text.length
        }

        // 赋值语句缺少右值：例如“全局变量1 ＝”
        const missingTarget = getMissingAssignmentRhsTarget(rawLine)
        if (missingTarget) {
          const eqPos = rawLine.search(/(?:=|＝)\s*$/)
          const column = eqPos >= 0 ? eqPos + 1 : 1
          problems.push({ line: blk.lineIndex + 1, column, message: `赋值语句缺少右值（${missingTarget}）`, severity: 'error' })
        }
      }
    }

    // 变量名冲突检查
    const parsedLines = parseLines(currentText)
    const assemblyVars = new Map<string, number>()
    const globalVars = new Map<string, number>()
    let localVarsByName = new Map<string, number[]>()
    let inSub = false

    const checkLocalVars = (): void => {
      if (!inSub) return
      for (const [name, lineIndices] of localVarsByName) {
        if (lineIndices.length > 1) {
          for (let k = 1; k < lineIndices.length; k++) {
            problems.push({ line: lineIndices[k] + 1, column: 1, message: `局部变量"${name}"在当前子程序中重复定义`, severity: 'error' })
          }
        }
        if (assemblyVars.has(name)) {
          for (const li of lineIndices) {
            problems.push({ line: li + 1, column: 1, message: `局部变量"${name}"与程序集变量同名`, severity: 'error' })
          }
        }
        if (globalVars.has(name)) {
          for (const li of lineIndices) {
            problems.push({ line: li + 1, column: 1, message: `局部变量"${name}"与全局变量同名`, severity: 'error' })
          }
        }
      }
      localVarsByName = new Map()
    }

    for (let i = 0; i < parsedLines.length; i++) {
      const ln = parsedLines[i]
      if (ln.type === 'assemblyVar') {
        const name = ln.fields[0]
        if (name) {
          if (!isValidVariableLikeName(name)) {
            problems.push({ line: i + 1, column: 1, message: `变量名"${name}"不能以数字或特殊符号开头`, severity: 'error' })
          }
          if (assemblyVars.has(name)) {
            problems.push({ line: i + 1, column: 1, message: `程序集变量"${name}"重复定义`, severity: 'error' })
          } else {
            assemblyVars.set(name, i)
          }
        }
      } else if (ln.type === 'globalVar') {
        const name = ln.fields[0]
        if (name) {
          if (!isValidVariableLikeName(name)) {
            problems.push({ line: i + 1, column: 1, message: `变量名"${name}"不能以数字或特殊符号开头`, severity: 'error' })
          }
          if (globalVars.has(name)) {
            problems.push({ line: i + 1, column: 1, message: `全局变量"${name}"重复定义`, severity: 'error' })
          } else {
            globalVars.set(name, i)
          }
        }
      } else if (ln.type === 'sub') {
        checkLocalVars()
        inSub = true
      } else if (ln.type === 'assembly') {
        checkLocalVars()
        inSub = false
      } else if (ln.type === 'localVar') {
        const name = ln.fields[0]
        if (name) {
          if (!isValidVariableLikeName(name)) {
            problems.push({ line: i + 1, column: 1, message: `变量名"${name}"不能以数字或特殊符号开头`, severity: 'error' })
          }
          const arr = localVarsByName.get(name)
          if (arr) arr.push(i)
          else localVarsByName.set(name, [i])
        }
      } else if (ln.type === 'subParam') {
        const name = ln.fields[0]
        if (name && !isValidVariableLikeName(name)) {
          problems.push({ line: i + 1, column: 1, message: `参数名"${name}"不能以数字或特殊符号开头`, severity: 'error' })
        }
      }
    }
    checkLocalVars()

    onProblemsChange(problems)
  }, [blocks, validCommandNames, allKnownVarNames, onProblemsChange, currentText])

  const commit = useCallback((overrideVal?: string) => {
    if (!editCell || commitGuardRef.current) return
    commitGuardRef.current = true
    setAcVisible(false)

    // 如果补全弹窗可见且输入词完全匹配命令名，自动上屏
    let effectiveVal = overrideVal !== undefined ? overrideVal : editVal
    if (overrideVal === undefined && acVisibleRef.current && acItemsRef.current.length > 0) {
      const firstItem = acItemsRef.current[0]
      if (!firstItem.isMore) {
        const item = firstItem.cmd
        const wordStart = acWordStartRef.current
        const cursorPos = inputRef.current?.selectionStart ?? effectiveVal.length
        const typedWord = effectiveVal.slice(wordStart, cursorPos)
        if (typedWord === item.name) {
          const before = effectiveVal.slice(0, wordStart)
          const after = effectiveVal.slice(cursorPos)
          effectiveVal = before + item.name + after
        }
      }
    }

    // 参数值编辑 / 赋值语句右值编辑
    if (editCell.paramIdx !== undefined) {
      if (editCell.paramIdx >= 0) {
        const codeLine = lines[editCell.lineIndex]
        const formattedVal = formatParamOperators(effectiveVal)
        const newLine = replaceCallArg(codeLine, editCell.paramIdx, formattedVal)
        const nl = [...lines]; nl[editCell.lineIndex] = newLine
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
        return
      }
      if (editCell.paramIdx === -100) {
        const codeLine = lines[editCell.lineIndex] || ''
        const parsed = parseAssignmentLineParts(codeLine)
        if (!parsed) {
          setEditCell(null)
          return
        }
        const formattedVal = formatParamOperators(effectiveVal)
        const newLine = `${parsed.indent}${parsed.lhs} ＝ ${formattedVal}`
        const nl = [...lines]; nl[editCell.lineIndex] = newLine
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
        return
      }
      if (editCell.paramIdx <= -200) {
        const codeLine = lines[editCell.lineIndex] || ''
        const parsed = parseAssignmentLineParts(codeLine)
        if (!parsed) {
          setEditCell(null)
          return
        }
        const rhsParamIdx = -editCell.paramIdx - 200
        const formattedVal = formatParamOperators(effectiveVal)
        const newRhs = replaceCallArg(parsed.rhs, rhsParamIdx, formattedVal)
        const newLine = `${parsed.indent}${parsed.lhs} ＝ ${newRhs}`
        const nl = [...lines]; nl[editCell.lineIndex] = newLine
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
        return
      }
    }

    if (editCell.cellIndex < 0) {
      // 流程标记行：检查是否输入了流程命令（嵌套流程控制）
      if (flowMarkRef.current) {
        const markerChar = flowMarkRef.current.trimStart().charAt(0) // '\u200C' or '\u200D' or '\u2060'
        const markerIndent = flowMarkRef.current.slice(0, flowMarkRef.current.length - 1) // 缩进（去掉末尾标记字符）
        const trimmedVal = effectiveVal.trim()
        const cmdCheckName = trimmedVal.startsWith('.') ? trimmedVal : trimmedVal.split(/[\s(（]/)[0]
        if (trimmedVal && FLOW_AUTO_COMPLETE[cmdCheckName]) {
          if (markerChar === '\u2060' && cmdCheckName === '判断') {
            const parentPrefix = markerIndent.length >= 4 ? markerIndent.slice(0, -4) : ''
            let formattedLines = formatCommandLine(parentPrefix + effectiveVal)
            if (formattedLines.length > 0 && formattedLines[formattedLines.length - 1].trim() === '') {
              formattedLines = formattedLines.slice(0, -1)
            }
            const nl = [...lines]
            // 替换当前 \u2060 标记行为格式化的命令
            nl.splice(editCell.lineIndex, 1, ...formattedLines)
            const nt = nl.join('\n')
            setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
            flowMarkRef.current = ''
            return
          }
          // 标记行上输入流程命令 → 嵌套流程控制
          // 使用标记行的缩进作为流程命令缩进基础
          let formattedLines = formatCommandLine(markerIndent + effectiveVal)
          // 内层不需要尾部普通空行，去掉
          if (formattedLines.length > 0 && formattedLines[formattedLines.length - 1].trim() === '') {
            formattedLines = formattedLines.slice(0, -1)
          }
          const nl = [...lines]
          // 替换当前标记行为格式化的命令（不保留原标记行）
          nl.splice(editCell.lineIndex, 1, ...formattedLines)
          // 在内层块结束后追加外层标记行
          const insertPos = editCell.lineIndex + formattedLines.length
          nl.splice(insertPos, 0, flowMarkRef.current)
          const nt = nl.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
          flowMarkRef.current = ''
          return
        }
        // 非流程命令：格式化后保存（自动补全括号和参数）
        const fmtLines = formatCommandLine(markerIndent + effectiveVal)
        const nl = [...lines]; nl[editCell.lineIndex] = flowMarkRef.current + fmtLines[0].slice(markerIndent.length)
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
        flowMarkRef.current = ''
        return
      }
      // formatCommandLine 会为流程命令额外加4空格，若 flowIndent 已包含流程缩进则需减去以避免翻倍
      let baseIndent = flowIndentRef.current
      const trimmedCmd = effectiveVal.trim()
      const cmdCheckName = trimmedCmd.startsWith('.') ? trimmedCmd : trimmedCmd.split(/[\s(（]/)[0]
      const isBareCmd = /^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*\s*$/.test(trimmedCmd)
      const isParenCmd = /^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*\s*[\(（].*[\)）]\s*$/.test(trimmedCmd)
      if ((isBareCmd || isParenCmd) && trimmedCmd && FLOW_AUTO_COMPLETE[cmdCheckName] && baseIndent.length >= 4) {
        baseIndent = baseIndent.slice(0, baseIndent.length - 4)
      }
      const formattedLines = formatCommandLine(baseIndent + effectiveVal)
      flowIndentRef.current = ''
      const mainLine = formattedLines[0]
      // 检查是否需要插入自动补齐的后续行（只在新输入时插入，已有匹配结束标记时不重复插入）
      let extraLines = formattedLines.slice(1)
      if (extraLines.length > 0) {
        // 检查后续行是否已存在对应的结束/分支关键词（只在新输入时插入，已有匹配结束标记时不重复插入）
        // 只在当前子程序范围内检查（遇到 .子程序/.程序集 停止）
        const afterIdx = editCell.isVirtual ? editCell.lineIndex + 2 : editCell.lineIndex + 1
        const remainingLines: string[] = []
        for (let ri = afterIdx; ri < lines.length; ri++) {
          const rl = lines[ri].replace(/[\r\t]/g, '').trim()
          if (rl.startsWith('.子程序 ') || rl.startsWith('.程序集 ')) break
          remainingLines.push(lines[ri])
        }
        const kwLines = extraLines.filter(el => {
          const t = el.trim()
          return el.includes(FLOW_AUTO_TAG) || t === FLOW_TRUE_MARK || t === FLOW_ELSE_MARK || t === FLOW_JUDGE_END_MARK
        })
        const hasEnding = kwLines.length > 0 && kwLines.every(el => {
          const t = el.trim()
          const rawKw = (t === FLOW_TRUE_MARK || t === FLOW_ELSE_MARK || t === FLOW_JUDGE_END_MARK) ? t : el.replace(FLOW_AUTO_TAG, '').trim()
          // 提取纯关键词名（去掉括号和参数部分）
          const kw = rawKw.split(/[\s(（]/)[0] || rawKw
          return remainingLines.some(rl => extractFlowKw(rl) === kw)
        })
        if (hasEnding) extraLines = []
      }
      if (editCell.isVirtual) {
        // 虚拟代码行：插入新行而非替换
        const nl = [...lines]
        nl.splice(editCell.lineIndex + 1, 0, mainLine, ...extraLines)
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
        return
      }
      // 代码行编辑：替换当前行并插入后续自动补齐行
      const nl = [...lines]
      nl.splice(editCell.lineIndex, 1, mainLine, ...extraLines)
      const nt = nl.join('\n')
      setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
      return
    }
    if (editCell.fieldIdx < 0) {
      // 无字段映射（如 tick 单元格），不修改
      setEditCell(null)
      return
    }
    // 表格单元格编辑：重建字段
    const rawLine = lines[editCell.lineIndex]
    let fieldValue = effectiveVal
    const parsedRaw = parseLines(rawLine)[0]
    if (isResourceTableDoc && editCell.fieldIdx === 1 && parsedRaw && (parsedRaw.type === 'resource' || parsedRaw.type === 'constant')) {
      const trimmed = effectiveVal.trim()
      if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\u201c') && trimmed.endsWith('\u201d'))) {
        fieldValue = trimmed
      } else {
        fieldValue = `"${trimmed.replace(/"/g, '\\"')}"`
      }
    }
    const newLine = rebuildLineField(rawLine, editCell.fieldIdx, fieldValue, editCell.sliceField)
    const nl = [...lines]; nl[editCell.lineIndex] = newLine

    // 变量名重命名同步：fieldIdx === 0 且为变量声明行时，替换代码中的引用
    if (editCell.fieldIdx === 0) {
      const trimmedRaw = rawLine.replace(/[\r\t]/g, '').trim()
      const varPrefixes = ['.局部变量 ', '.参数 ', '.程序集变量 ', '.全局变量 ']
      const matchedPrefix = varPrefixes.find(pf => trimmedRaw.startsWith(pf))
      if (matchedPrefix) {
        // 使用编辑前保存的原始值作为旧名（liveUpdate 会实时更新 lines，导致 rawLine 已是新值）
        const oldName = editCellOrigValRef.current.trim()
        const newName = effectiveVal.trim()
        if (oldName && newName && oldName !== newName) {
          // 确定作用域范围
          const li = editCell.lineIndex
          let scopeStart = 0
          let scopeEnd = nl.length
          const isLocal = matchedPrefix === '.局部变量 ' || matchedPrefix === '.参数 '
          const isAssembly = matchedPrefix === '.程序集变量 '
          // 全局变量：整个文件
          if (isLocal) {
            // 局部变量/参数：从上方最近的 .子程序 到下方最近的 .子程序/.程序集
            for (let i = li - 1; i >= 0; i--) {
              const t = nl[i].replace(/[\r\t]/g, '').trim()
              if (t.startsWith('.子程序 ')) { scopeStart = i; break }
              if (t.startsWith('.程序集 ')) { scopeStart = i; break }
            }
            for (let i = li + 1; i < nl.length; i++) {
              const t = nl[i].replace(/[\r\t]/g, '').trim()
              if (t.startsWith('.子程序 ') || t.startsWith('.程序集 ')) { scopeEnd = i; break }
            }
          } else if (isAssembly) {
            // 程序集变量：从上方最近的 .程序集 到下方最近的 .程序集
            for (let i = li - 1; i >= 0; i--) {
              const t = nl[i].replace(/[\r\t]/g, '').trim()
              if (t.startsWith('.程序集 ')) { scopeStart = i; break }
            }
            for (let i = li + 1; i < nl.length; i++) {
              const t = nl[i].replace(/[\r\t]/g, '').trim()
              if (t.startsWith('.程序集 ')) { scopeEnd = i; break }
            }
          }
          // 在作用域内的代码行中替换变量名（不替换声明行和注释行）
          const nameRegex = new RegExp(
            '(?<=[^\\u4e00-\\u9fa5A-Za-z0-9_.]|^)' + oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[^\\u4e00-\\u9fa5A-Za-z0-9_.]|$)',
            'g'
          )
          for (let i = scopeStart; i < scopeEnd; i++) {
            if (i === editCell.lineIndex) continue // 跳过声明行本身
            const t = nl[i].replace(/[\r\t]/g, '').trim()
            if (!t || t.startsWith("'") || t.startsWith('.')) continue // 跳过空行、注释、声明
            nl[i] = nl[i].replace(nameRegex, newName)
          }
        }
      }

      // 类模块程序集名重命名：提交后回调给上层执行文件/项目同步
      if (isClassModule && trimmedRaw.startsWith('.程序集 ')) {
        const oldClassName = editCellOrigValRef.current.trim()
        const newClassName = effectiveVal.trim()
        if (oldClassName && newClassName && oldClassName !== newClassName) {
          onClassNameRename?.(oldClassName, newClassName)
        }
      }
    }

    const nt = nl.join('\n')
    setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
  }, [editCell, editVal, isClassModule, isResourceTableDoc, lines, onChange, onClassNameRename])

  // 每次渲染后重置 commitGuard，允许下一次合法的 commit 调用
  useEffect(() => { commitGuardRef.current = false })

  // 光标位置变化通知
  useEffect(() => {
    if (editCell && editCell.lineIndex >= 0) {
      const col = inputRef.current?.selectionStart ?? 1
      onCursorChange?.(editCell.lineIndex + 1, col + 1)
    }
  }, [editCell, onCursorChange])

  // commitRef: 始终指向最新的 commit 函数，供 mouseDown 等闭包调用
  const commitRef = useRef<(overrideVal?: string) => void>(commit)
  commitRef.current = commit

  // 窗口失焦兜底提交：处理 Win 键/Alt+Tab 打断编辑导致的未格式化状态
  useEffect(() => {
    const flushEditing = (): void => {
      if (editCellRef.current) {
        commitRef.current()
      }
    }

    const onWindowBlur = (): void => {
      flushEditing()
    }

    const onVisibilityChange = (): void => {
      if (document.hidden) flushEditing()
    }

    window.addEventListener('blur', onWindowBlur)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('blur', onWindowBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const startEditCell = useCallback((li: number, ci: number, cellText: string, fieldIdx?: number, sliceField?: boolean) => {
    if (fieldIdx === undefined) return // 无字段映射（tick 单元格等），不可编辑
    setSelectedLines(new Set())
    pushUndo(prevRef.current)
    lastFocusedLine.current = li
    setEditCell({ lineIndex: li, cellIndex: ci, fieldIdx, sliceField: sliceField || false })
    // 将占位符 \u00A0 视为空值
    const initVal = cellText === '\u00A0' ? '' : (cellText || '')
    editCellOrigValRef.current = initVal
    setEditVal(initVal)
    setTimeout(() => {
      inputRef.current?.focus()
      if (canUseTypeCompletion(li, fieldIdx)) {
        const pos = inputRef.current?.selectionStart ?? initVal.length
        updateCompletion(initVal, pos)
      }
    }, 0)
  }, [pushUndo, canUseTypeCompletion, updateCompletion])

  const attachResourceFileToLine = useCallback(async (lineIndex: number): Promise<string | null> => {
    if (!isResourceTableDoc || !projectDir) return null
    const ln = parsedLines[lineIndex]
    if (!ln || (ln.type !== 'resource' && ln.type !== 'constant')) return null

    try {
      const result = await window.api.project.importResourceFile(projectDir)
      if (!result.success) {
        if (!result.canceled) {
          window.alert('添加资源文件失败：' + result.message)
        }
        return null
      }

      const fileName = result.fileName
      const rawLine = lines[lineIndex] || ''
      const safeName = `"${fileName.replace(/"/g, '\\"')}"`
      const withFile = rebuildLineField(rawLine, 1, safeName, false)
      const withType = rebuildLineField(withFile, 2, inferResourceTypeByFileName(fileName), false)

      pushUndo(currentText)
      const nl = [...lines]
      nl[lineIndex] = withType
      const nt = nl.join('\n')
      setCurrentText(nt)
      prevRef.current = nt
      onChange(nt)

      return fileName
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      window.alert('添加资源文件失败：' + msg)
      return null
    }
  }, [isResourceTableDoc, projectDir, parsedLines, lines, pushUndo, currentText, onChange])

  const openResourcePreview = useCallback(async (lineIndex: number) => {
    if (!isResourceTableDoc) return
    const ln = parsedLines[lineIndex]
    if (!ln || (ln.type !== 'resource' && ln.type !== 'constant')) return
    const resourceName = (ln.fields[0] || '').trim()
    let resourceFile = unquote((ln.fields[1] || '').trim())
    if (!resourceFile) {
      const imported = await attachResourceFileToLine(lineIndex)
      if (!imported) return
      // 空内容单元格双击仅用于快速绑定文件，不自动弹预览窗口。
      return
    }
    const resourceType = (ln.fields[2] || '').trim() || inferResourceTypeByFileName(resourceFile)
    setResourcePreview({
      visible: true,
      lineIndex,
      resourceName,
      resourceFile,
      resourceType,
      version: Date.now(),
    })
  }, [isResourceTableDoc, parsedLines, attachResourceFileToLine])

  const handleReplaceResourceFile = useCallback(async () => {
    if (!resourcePreview.visible || !projectDir || !resourcePreview.resourceFile || resourcePreviewBusy) return
    setResourcePreviewBusy(true)
    try {
      const result = await window.api.project.replaceResourceFile(projectDir, resourcePreview.resourceFile)
      if (result.success) {
        setResourcePreview(prev => ({ ...prev, version: Date.now() }))
      } else if (!result.canceled) {
        window.alert('更换资源文件失败：' + result.message)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      window.alert('更换资源文件失败：' + msg)
    } finally {
      setResourcePreviewBusy(false)
    }
  }, [projectDir, resourcePreview.visible, resourcePreview.resourceFile, resourcePreviewBusy])

  useEffect(() => {
    if (!resourcePreview.visible || !projectDir || !resourcePreview.resourceFile) {
      setResourcePreviewSrc('')
      setResourcePreviewMsg('')
      setResourcePreviewMeta(null)
      setResourcePreviewMediaMeta({})
      return
    }

    const viewType = resourcePreview.resourceType || inferResourceTypeByFileName(resourcePreview.resourceFile)
    const shouldLoad = viewType === '图片' || viewType === '声音' || viewType === '视频'

    let canceled = false
    setResourcePreviewMsg(shouldLoad ? '正在加载预览...' : '当前资源类型暂不支持内嵌预览，可使用“更换文件”来替换资源。')
    setResourcePreviewSrc('')
    setResourcePreviewMediaMeta({})
    ;(async () => {
      try {
        const result = await window.api.project.getResourcePreviewData(projectDir, resourcePreview.resourceFile, shouldLoad)
        if (canceled) return
        if (!result.success) {
          setResourcePreviewMeta(null)
          setResourcePreviewMsg('预览加载失败：' + result.message)
          return
        }
        setResourcePreviewMeta({
          mime: result.mime,
          ext: result.ext,
          filePath: result.filePath,
          sizeBytes: result.sizeBytes,
          modifiedAtMs: result.modifiedAtMs,
        })

        if (shouldLoad && result.base64) {
          setResourcePreviewSrc(`data:${result.mime};base64,${result.base64}`)
          setResourcePreviewMsg('')
        } else {
          setResourcePreviewSrc('')
        }
      } catch (error) {
        if (canceled) return
        setResourcePreviewMeta(null)
        const msg = error instanceof Error ? error.message : String(error)
        setResourcePreviewMsg('预览加载失败：' + msg)
      }
    })()

    return () => { canceled = true }
  }, [projectDir, resourcePreview.visible, resourcePreview.resourceFile, resourcePreview.resourceType, resourcePreview.version])

  const startEditLine = useCallback((li: number, clientX?: number, containerLeft?: number, isVirtual?: boolean) => {
    // 使用 prevRef 获取最新行数据，防止 commit 修改文本后 React 尚未重渲染导致闭包中 lines 过时
    const latestText = prevRef.current
    const latestLines = latestText.split('\n')
    let text = isVirtual ? '' : (latestLines[li] || '')
    // 剥离流程标记零宽字符和对应的缩进前缀，编辑时不显示
    const stripped = text.replace(/^ +/, '')
    let flowMark = ''
    if (stripped.startsWith('\u200C') || stripped.startsWith('\u200D') || stripped.startsWith('\u2060')) {
      flowMark = text.slice(0, text.length - stripped.length + 1) // 保留缩进 + 标记字符
      text = stripped.slice(1) // 实际可编辑内容
    }
    // 对于有流程线的普通行，剥离被流程线覆盖的前导空格
    let flowIndent = ''
    if (!flowMark && !isVirtual) {
      // 若 commit 刚修改了文本但尚未重渲染，flowLines 可能过时，需重新计算
      const currentFlowLines = (latestText === currentText) ? flowLines : computeFlowLines(buildBlocks(latestText, isClassModule, isResourceTableDoc))
      const segs = currentFlowLines.map.get(li) || []
      if (segs.length > 0) {
        const lineMaxDepth = Math.max(...segs.map(s => s.depth)) + 1
        const stripCount = lineMaxDepth * 4
        const leadingSpaces = text.match(/^ */)?.[0] || ''
        const actualStrip = Math.min(stripCount, leadingSpaces.length)
        // 已有内容的行使用真实剥离的缩进，避免嵌套流程起始行在反复点击后重复右移；
        // 只有空行/无足够前导空格时才回退到流程深度占位，保证新输入命令仍能落在正确层级。
        flowIndent = ' '.repeat(actualStrip > 0 ? actualStrip : stripCount)
        if (actualStrip > 0) {
          text = text.slice(actualStrip)
        }
        wasFlowStartRef.current = segs.some(s => s.type === 'start')
      } else {
        wasFlowStartRef.current = false
      }
    }
    pushUndo(latestText)
    setSelectedLines(new Set())
    lastFocusedLine.current = li
    flowMarkRef.current = flowMark
    flowIndentRef.current = flowIndent
    setEditCell({ lineIndex: li, cellIndex: -1, fieldIdx: -1, sliceField: false, isVirtual }); setEditVal(text)
    setTimeout(() => {
      if (!inputRef.current) return
      inputRef.current.focus()
      if (clientX !== undefined && containerLeft !== undefined) {
        let relX = clientX - containerLeft // 相对于代码行内容区域
        // 减去流程线段占用的宽度，使光标定位到输入框内正确位置
        const currentFlowLines2 = (latestText === currentText) ? flowLines : computeFlowLines(buildBlocks(latestText, isClassModule, isResourceTableDoc))
        const segs2 = currentFlowLines2.map.get(li) || []
        if (segs2.length > 0) {
          const lineMaxDepth2 = Math.max(...segs2.map(s => s.depth)) + 1
          // 每个流程段宽度为 4ch，用 canvas 测量实际像素宽度
          const canvas2 = document.createElement('canvas')
          const ctx2 = canvas2.getContext('2d')
          if (ctx2) {
            ctx2.font = '13px Consolas, "Microsoft YaHei", monospace'
            const segWidth = ctx2.measureText('    '.repeat(lineMaxDepth2)).width
            relX -= segWidth
            if (relX < 0) relX = 0
          }
        }
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.font = '13px Consolas, "Microsoft YaHei", monospace'
          let pos = text.length
          for (let i = 1; i <= text.length; i++) {
            const w = ctx.measureText(text.slice(0, i)).width
            if (w > relX) {
              const wPrev = ctx.measureText(text.slice(0, i - 1)).width
              pos = (relX - wPrev < w - relX) ? i - 1 : i
              break
            }
          }
          inputRef.current.selectionStart = pos
          inputRef.current.selectionEnd = pos
        }
      }
    }, 0)
  }, [currentText, pushUndo, flowLines])

  const onKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // ===== 补全弹窗键盘处理 =====
    if (acVisible && acItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAcIndex(i => (i + 1) % acItems.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAcIndex(i => (i - 1 + acItems.length) % acItems.length)
        return
      }
      if (e.key === ' ') {
        // 空格键：选中当前补全项上屏
        e.preventDefault()
        const target = acItems[acIndex]
        if (target?.isMore) expandMoreCompletion(acIndex)
        else applyCompletion(target)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        const target = acItems[acIndex]
        if (target?.isMore) expandMoreCompletion(acIndex)
        else applyCompletion(target)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setAcVisible(false)
        return
      }
    }

    // ===== Ctrl 快捷键 =====
    const ctrl = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (ctrl && key === 'z' && !e.shiftKey) {
      e.preventDefault()
      if (undoStack.current.length > 0) {
        const prev = undoStack.current.pop()!
        redoStack.current.push(currentText)
        setCurrentText(prev); prevRef.current = prev; onChange(prev)
      }
      return
    }
    if (ctrl && (key === 'y' || (e.shiftKey && key === 'z'))) {
      e.preventDefault()
      if (redoStack.current.length > 0) {
        const next = redoStack.current.pop()!
        undoStack.current.push(currentText)
        setCurrentText(next); prevRef.current = next; onChange(next)
      }
      return
    }
    if (ctrl && key === 'a') {
      e.preventDefault()
      const ls = prevRef.current.split('\n')
      const all = new Set<number>()
      for (let i = 0; i < ls.length; i++) all.add(i)
      setSelectedLines(all)
      dragAnchor.current = 0
      setAcVisible(false)
      setEditCell(null)
      wrapperRef.current?.focus()
      return
    }
    if (ctrl && key === 'v') {
      if (editCell && editCell.cellIndex === -1 && editCell.paramIdx === undefined) return
      if (shouldUseNativeInputPaste(editCell)) return
      e.preventDefault()
      setAcVisible(false)
      navigator.clipboard.readText().then(clipText => {
        if (!clipText) return
        const sanitized = sanitizePastedTextForCurrent(clipText, currentText)
        const pastedLines = sanitized.split('\n').map(l => l.replace(/\r$/, ''))
        if (pastedLines.length === 0) return
        const pastedHasSub = parseLines(pastedLines.join('\n')).some(ln => ln.type === 'sub')
        const ls = currentText.split('\n')
        const cursorLine = editCell?.lineIndex ?? lastFocusedLine.current
        const getInsertAtForPastedSubs = (line: number): number => {
          if (line < 0 || line >= ls.length) return ls.length
          const parsed = parseLines(ls.join('\n'))
          let ownerSubLine = -1
          for (let i = Math.min(line, parsed.length - 1); i >= 0; i--) {
            if (parsed[i].type === 'sub') { ownerSubLine = i; break }
          }
          if (ownerSubLine < 0) return ls.length
          for (let i = ownerSubLine + 1; i < parsed.length; i++) {
            if (parsed[i].type === 'sub') return i
          }
          return ls.length
        }
        let insertAt = ls.length
        if (pastedHasSub) {
          insertAt = getInsertAtForPastedSubs(cursorLine)
        } else if (cursorLine >= 0) {
          insertAt = Math.min(cursorLine + 1, ls.length)
        }
        pushUndo(currentText)
        const nl = [...ls]
        nl.splice(insertAt, 0, ...pastedLines)
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt)
        const newSel = new Set<number>()
        for (let i = 0; i < pastedLines.length; i++) newSel.add(insertAt + i)
        setSelectedLines(newSel)
        lastFocusedLine.current = insertAt + pastedLines.length - 1
      })
      return
    }

    // ===== 命令行括号保护：已格式化的命令行只允许在括号内编辑参数 =====
    if (editCell && editCell.cellIndex < 0 && editCell.paramIdx === undefined) {
      const parenRange = getOuterParenRange(editVal)
      if (parenRange) {
        const cur = e.currentTarget.selectionStart ?? 0
        const selE = e.currentTarget.selectionEnd ?? cur
        const pS = parenRange.start + 1  // 开括号后的第一个可编辑位置
        const pE = parenRange.end        // 闭括号位置（不可编辑）
        const hasSel = cur !== selE
        const selInRange = cur >= pS && selE <= pE

        // Enter：光标在最前面时在上方插入空行（命令整体下移），否则在下方插入空行
        if (e.key === 'Enter') {
          e.preventDefault()
          setAcVisible(false)
          if (expandedLines.has(editCell.lineIndex)) {
            setExpandedLines(prev => {
              const next = new Set(prev)
              next.delete(editCell.lineIndex)
              return next
            })
          }
          const cursorAtStart = cur === 0
          // commit 会清除 flowMarkRef，需提前保存
          const savedFlowMark = flowMarkRef.current
          commit()
          setTimeout(() => {
            const latestText = prevRef.current
            const latestLines = latestText.split('\n')
            // 标记行：新行带标记前缀；普通行：用 flowIndent 缩进
            const fi = savedFlowMark
              ? savedFlowMark.slice(0, savedFlowMark.length - 1)
              : (flowIndentRef.current || '')
            const newLineContent = savedFlowMark || fi
            if (cursorAtStart) {
              // 光标在最前面：在命令上方插入空行，光标停在新空行
              const insertAt = editCell!.lineIndex
              latestLines.splice(insertAt, 0, newLineContent)
              const nt = latestLines.join('\n')
              pushUndo(latestText)
              setCurrentText(nt); prevRef.current = nt; onChange(nt)
              flowMarkRef.current = savedFlowMark
              flowIndentRef.current = savedFlowMark ? '' : fi
              wasFlowStartRef.current = false
              setEditCell({ lineIndex: insertAt, cellIndex: -1, fieldIdx: -1, sliceField: false })
              setEditVal('')
            } else {
              // 光标在其他位置：在命令下方插入空行
              const insertAt = editCell!.lineIndex + 1
              latestLines.splice(insertAt, 0, newLineContent)
              const nt = latestLines.join('\n')
              pushUndo(latestText)
              setCurrentText(nt); prevRef.current = nt; onChange(nt)
              flowMarkRef.current = savedFlowMark
              flowIndentRef.current = savedFlowMark ? '' : fi
              wasFlowStartRef.current = false
              setEditCell({ lineIndex: insertAt, cellIndex: -1, fieldIdx: -1, sliceField: false })
              setEditVal('')
            }
            setTimeout(() => inputRef.current?.focus(), 0)
          }, 0)
          return
        }
        // Tab：提交编辑并跳转到下一行编辑
        if (e.key === 'Tab') {
          e.preventDefault()
          setAcVisible(false)
          commit()
          setTimeout(() => {
            const latestText = prevRef.current
            const latestLines = latestText.split('\n')
            const nextLi = editCell!.lineIndex + 1
            if (nextLi < latestLines.length) {
              startEditLine(nextLi)
            }
          }, 0)
          return
        }
        // Backspace：光标在括号内正常删除；光标在命令名区域时剥离括号，回退为裸命令名自由编辑
        if (e.key === 'Backspace') {
          if (hasSel ? !selInRange : cur <= pS) {
            e.preventDefault()
            // 剥离括号及其内容，保留命令名部分供自由编辑
            const rawName = editVal.slice(0, parenRange.start).trimEnd()
            if (cur > 0 && rawName.length > 0) {
              const newVal = rawName.slice(0, -1)
              setEditVal(newVal)
              liveUpdate(newVal)
              setTimeout(() => { if (inputRef.current) { inputRef.current.selectionStart = newVal.length; inputRef.current.selectionEnd = newVal.length } }, 0)
            }
            return
          }
        }
        // Delete：光标在括号外或选区跨出括号时阻止
        if (e.key === 'Delete') {
          if (hasSel ? !selInRange : cur >= pE) { e.preventDefault(); return }
        }
        // Ctrl+X/V：选区跨出括号时阻止
        if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'v')) {
          if (!selInRange) { e.preventDefault(); return }
        }
        // 可打印字符：光标在括号外时阻止输入
        if (e.key.length === 1 && !(e.ctrlKey || e.metaKey)) {
          if (hasSel ? !selInRange : (cur < pS || cur > pE)) { e.preventDefault(); return }
        }
      }
    }

    // ===== 原有键盘处理 =====
    if (e.key === 'Enter') {
      e.preventDefault()
      setAcVisible(false)
      if (editCell && editCell.cellIndex < 0 && expandedLines.has(editCell.lineIndex)) {
        setExpandedLines(prev => {
          const next = new Set(prev)
          next.delete(editCell.lineIndex)
          return next
        })
      }
      if (editCell && editCell.cellIndex < 0) {
        const cur = e.currentTarget
        const pos = cur.selectionStart ?? editVal.length
        const before = editVal.slice(0, pos)
        const after = editVal.slice(pos)
        const nl = [...lines]

        // ===== 流程命令自动格式化：输入流程命令后按回车自动展开结构 =====
        if (after.trim() === '') {
          const trimmedCheck = editVal.trim()
          const cmdCheckName = trimmedCheck.startsWith('.') ? trimmedCheck : trimmedCheck.split(/[\s(（]/)[0]
          if (trimmedCheck && FLOW_AUTO_COMPLETE[cmdCheckName]) {
            if (flowMarkRef.current) {
              const markerChar = flowMarkRef.current.trimStart().charAt(0)
              const markerIndent = flowMarkRef.current.slice(0, flowMarkRef.current.length - 1)
              if (markerChar === '\u2060' && cmdCheckName === '判断') {
                const parentPrefix = markerIndent.length >= 4 ? markerIndent.slice(0, -4) : ''
                let formattedLines = formatCommandLine(parentPrefix + editVal)
                if (formattedLines.length > 1) {
                  if (formattedLines[formattedLines.length - 1].trim() === '') {
                    formattedLines = formattedLines.slice(0, -1)
                  }
                  // 替换 \u2060 标记行为格式化的命令
                  nl.splice(editCell.lineIndex, 1, ...formattedLines)
                  const nt = nl.join('\n')
                  setCurrentText(nt); prevRef.current = nt; onChange(nt)
                  const cursorLi = editCell.lineIndex + 1
                  const targetLine = nl[cursorLi] || ''
                  const strippedTarget = targetLine.replace(/^ +/, '')
                  if (strippedTarget.startsWith('\u200C') || strippedTarget.startsWith('\u200D') || strippedTarget.startsWith('\u2060')) {
                    flowMarkRef.current = targetLine.slice(0, targetLine.length - strippedTarget.length + 1)
                    setEditCell({ lineIndex: cursorLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
                    setEditVal(strippedTarget.slice(1))
                  } else {
                    flowMarkRef.current = ''
                    setEditCell({ lineIndex: cursorLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
                    setEditVal(targetLine)
                  }
                  setTimeout(() => { inputRef.current?.focus(); if (inputRef.current) { inputRef.current.selectionStart = 0; inputRef.current.selectionEnd = 0 } }, 0)
                  commitGuardRef.current = true
                  return
                }
              } else {
              // 标记行上输入流程命令 → 嵌套流程控制
              let formattedLines = formatCommandLine(markerIndent + editVal)
              if (formattedLines.length > 1) {
                if (formattedLines[formattedLines.length - 1].trim() === '') {
                  formattedLines = formattedLines.slice(0, -1)
                }
                const isLoopFlow = FLOW_LOOP_KW.has(cmdCheckName)
                if (isLoopFlow) {
                  // 循环类命令：在首命令和尾命令之间插入流程体内空行
                  const mainLine = formattedLines[0]
                  const mainIndent = mainLine.length - mainLine.trimStart().length
                  const bodyIndent = ' '.repeat(mainIndent + 4)
                  const withBody = [mainLine, bodyIndent, ...formattedLines.slice(1)]
                  nl.splice(editCell.lineIndex, 1, ...withBody)
                  const insertPos = editCell.lineIndex + withBody.length
                  nl.splice(insertPos, 0, flowMarkRef.current)
                  const nt = nl.join('\n')
                  setCurrentText(nt); prevRef.current = nt; onChange(nt)
                  // 光标移到流程体内的空行
                  const cursorLi = editCell.lineIndex + 1
                  flowMarkRef.current = ''
                  flowIndentRef.current = bodyIndent
                  wasFlowStartRef.current = false
                  setEditCell({ lineIndex: cursorLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
                  setEditVal('')
                } else {
                  // 非循环类（如果/如果真/判断）：光标移到分支标记行
                  nl.splice(editCell.lineIndex, 1, ...formattedLines)
                  const insertPos = editCell.lineIndex + formattedLines.length
                  nl.splice(insertPos, 0, flowMarkRef.current)
                  const nt = nl.join('\n')
                  setCurrentText(nt); prevRef.current = nt; onChange(nt)
                  const cursorLi = editCell.lineIndex + 1
                  const targetLine = nl[cursorLi] || ''
                  const strippedTarget = targetLine.replace(/^ +/, '')
                  if (strippedTarget.startsWith('\u200C') || strippedTarget.startsWith('\u200D') || strippedTarget.startsWith('\u2060')) {
                    flowMarkRef.current = targetLine.slice(0, targetLine.length - strippedTarget.length + 1)
                    setEditCell({ lineIndex: cursorLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
                    setEditVal(strippedTarget.slice(1))
                  } else {
                    flowMarkRef.current = ''
                    setEditCell({ lineIndex: cursorLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
                    setEditVal(targetLine)
                  }
                }
                setTimeout(() => { inputRef.current?.focus(); if (inputRef.current) { inputRef.current.selectionStart = 0; inputRef.current.selectionEnd = 0 } }, 0)
                commitGuardRef.current = true
                return
              }
              }
            } else {
              // 普通代码行/虚拟行：自动展开流程结构
              // 需要加回 flowIndent（被 startEditLine 剥离的流程区域缩进）
              // 但 formatCommandLine 会为流程命令额外加4空格，所以需减去以避免缩进翻倍
              // 只有裸命令名（无括号）才会被 formatCommandLine 重新格式化
              let enterIndent = flowIndentRef.current
              const isBareEnterCmd = /^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*\s*$/.test(editVal.trim())
              if (isBareEnterCmd && enterIndent.length >= 4) {
                enterIndent = enterIndent.slice(0, enterIndent.length - 4)
              }
              const formattedLines = formatCommandLine(enterIndent + editVal)
              if (formattedLines.length > 1) {
                const mainLine = formattedLines[0]
                let extraLines = formattedLines.slice(1)
                const afterIdx = editCell.isVirtual ? editCell.lineIndex + 2 : editCell.lineIndex + 1
                const remainingLines: string[] = []
                for (let ri = afterIdx; ri < lines.length; ri++) {
                  const rl = lines[ri].replace(/[\r\t]/g, '').trim()
                  if (rl.startsWith('.子程序 ') || rl.startsWith('.程序集 ')) break
                  remainingLines.push(lines[ri])
                }
                const kwLines = extraLines.filter(el => {
                  const t = el.trim()
                  return el.includes(FLOW_AUTO_TAG) || t === FLOW_TRUE_MARK || t === FLOW_ELSE_MARK || t === FLOW_JUDGE_END_MARK
                })
                // 检查紧邻下方的行是否已经是当前命令的流程结构（防止重复插入）
                // 必须从 remainingLines 的最前面开始匹配，跳过空行/普通代码行
                let hasEnding = false
                if (kwLines.length > 0) {
                  // 提取第一个 remaining 行的流程关键词
                  const firstRemainingKw = remainingLines.length > 0 ? extractFlowKw(remainingLines[0]) : null
                  // 提取第一个 kwLine 的期望关键词
                  const firstKwT = kwLines[0].trim()
                  const firstExpectedKw = (firstKwT === FLOW_TRUE_MARK || firstKwT === FLOW_ELSE_MARK || firstKwT === FLOW_JUDGE_END_MARK)
                    ? firstKwT : kwLines[0].replace(FLOW_AUTO_TAG, '').trim().split(/[\s(（]/)[0]
                  // 只有当紧邻的第一行就匹配第一个期望关键词时，才视为已有结构
                  if (firstRemainingKw === firstExpectedKw) {
                    hasEnding = kwLines.every(el => {
                      const t = el.trim()
                      const kw = (t === FLOW_TRUE_MARK || t === FLOW_ELSE_MARK || t === FLOW_JUDGE_END_MARK) ? t : el.replace(FLOW_AUTO_TAG, '').trim().split(/[\s(（]/)[0]
                      return remainingLines.some(rl => extractFlowKw(rl) === kw)
                    })
                  }
                }
                if (hasEnding) extraLines = []

                const isLoopFlow = FLOW_LOOP_KW.has(cmdCheckName)
                if (isLoopFlow) {
                  // 循环类命令：在首命令和尾命令之间插入流程体内空行
                  const mainIndent = mainLine.length - mainLine.trimStart().length
                  const bodyIndent = ' '.repeat(mainIndent + 4)
                  if (editCell.isVirtual) {
                    nl.splice(editCell.lineIndex + 1, 0, mainLine, bodyIndent, ...extraLines)
                  } else {
                    nl.splice(editCell.lineIndex, 1, mainLine, bodyIndent, ...extraLines)
                  }
                  const nt = nl.join('\n')
                  setCurrentText(nt); prevRef.current = nt; onChange(nt)
                  const baseLi = editCell.isVirtual ? editCell.lineIndex + 1 : editCell.lineIndex
                  const cursorLi = baseLi + 1
                  flowMarkRef.current = ''
                  flowIndentRef.current = bodyIndent
                  wasFlowStartRef.current = false
                  setEditCell({ lineIndex: cursorLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
                  setEditVal('')
                } else {
                  // 非循环类（如果/如果真/判断）：光标移到分支标记行
                  if (editCell.isVirtual) {
                    nl.splice(editCell.lineIndex + 1, 0, mainLine, ...extraLines)
                  } else {
                    nl.splice(editCell.lineIndex, 1, mainLine, ...extraLines)
                  }
                  const nt = nl.join('\n')
                  setCurrentText(nt); prevRef.current = nt; onChange(nt)
                  const baseLi = editCell.isVirtual ? editCell.lineIndex + 1 : editCell.lineIndex
                  const cursorLi = baseLi + 1
                  const targetLine = nl[cursorLi] || ''
                  const strippedTarget = targetLine.replace(/^ +/, '')
                  if (strippedTarget.startsWith('\u200C') || strippedTarget.startsWith('\u200D') || strippedTarget.startsWith('\u2060')) {
                    flowMarkRef.current = targetLine.slice(0, targetLine.length - strippedTarget.length + 1)
                    setEditCell({ lineIndex: cursorLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
                    setEditVal(strippedTarget.slice(1))
                  } else {
                    flowMarkRef.current = ''
                    setEditCell({ lineIndex: cursorLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
                    setEditVal(targetLine)
                  }
                }
                setTimeout(() => { inputRef.current?.focus(); if (inputRef.current) { inputRef.current.selectionStart = 0; inputRef.current.selectionEnd = 0 } }, 0)
                commitGuardRef.current = true
                return
              }
            }
          }
        }

        if (editCell.isVirtual) {
          // 虚拟代码行：插入两行（光标前/后）
          nl.splice(editCell.lineIndex + 1, 0, before, after)
          const nt = nl.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt)
          const newLi = editCell.lineIndex + 2
          setEditCell({ lineIndex: newLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
          setEditVal(after)
        } else if (flowMarkRef.current && (flowMarkRef.current.trimStart().startsWith('\u200D') || flowMarkRef.current.trimStart().startsWith('\u2060'))) {
          // 标记结束行（\u200D/\u2060）：在当前行前插入空行，标记下移
          const markerChar = flowMarkRef.current.trimStart().charAt(0)
          const indent = flowMarkRef.current.slice(0, flowMarkRef.current.length - 1) // 去掉末尾标记字符保留缩进
          // 格式化当前行内容（自动补全括号和参数）
          const fmtBefore = after.trim() === '' ? formatCommandLine(indent + before)[0].slice(indent.length) : before
          nl[editCell.lineIndex] = flowMarkRef.current + fmtBefore
          nl.splice(editCell.lineIndex + 1, 0, indent + markerChar + after)
          const nt = nl.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt)
          const newLi = editCell.lineIndex + 1
          flowMarkRef.current = indent + markerChar
          setEditCell({ lineIndex: newLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
          setEditVal(after)
        } else if (flowMarkRef.current && flowMarkRef.current.trimStart().startsWith('\u200C') && after.trim() === '') {
          // \u200C 标记行上输入非流程命令后回车：格式化命令 + 在下方插入新 \u200C 行
          const markerIndent = flowMarkRef.current.slice(0, flowMarkRef.current.length - 1)
          const fmtLines = formatCommandLine(markerIndent + before)
          const fmtContent = fmtLines[0].slice(markerIndent.length)
          nl[editCell.lineIndex] = flowMarkRef.current + fmtContent
          nl.splice(editCell.lineIndex + 1, 0, flowMarkRef.current)
          const nt = nl.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt)
          const newLi = editCell.lineIndex + 1
          // 新行是 \u200C 标记行，保持 flowMark
          setEditCell({ lineIndex: newLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
          setEditVal('')
        } else {
          // 代码行：在光标位置拆行，插入新行
          const fi = flowIndentRef.current
          // 如果当前行是流程结束行（如循环尾），新行应在该流程块外部，缩进减少一层
          const curSegs = flowLines.map.get(editCell.lineIndex) || []
          const hasFlowEnd = curSegs.some(s => s.type === 'end')
          const newFi = hasFlowEnd && fi.length >= 4 ? fi.slice(0, fi.length - 4) : fi
          // 格式化当前行内容（自动补全括号和参数）
          const fmtBefore = after.trim() === '' ? formatCommandLine(fi + before)[0].slice(fi.length) : before
          if (flowMarkRef.current) {
            nl[editCell.lineIndex] = flowMarkRef.current + fmtBefore
            nl.splice(editCell.lineIndex + 1, 0, flowMarkRef.current + after)
          } else {
            nl[editCell.lineIndex] = fi + fmtBefore
            nl.splice(editCell.lineIndex + 1, 0, newFi + after)
          }
          const nt = nl.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt)
          const newLi = editCell.lineIndex + 1
          setEditCell({ lineIndex: newLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
          setEditVal(after)
          // 更新 flowIndentRef 为新行实际的流程缩进，防止旧值残留导致后续命令多缩进
          flowIndentRef.current = flowMarkRef.current ? '' : newFi
          wasFlowStartRef.current = false
        }
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus()
            inputRef.current.selectionStart = 0
            inputRef.current.selectionEnd = 0
          }
        }, 0)
      } else if (editCell && editCell.cellIndex >= 0 && editCell.fieldIdx >= 0) {
        // 表格行：先提交当前编辑，再插入同类型新行
        const li = editCell.lineIndex
        let rawLine = lines[li]
        rawLine = rebuildLineField(rawLine, editCell.fieldIdx, editVal, editCell.sliceField)

        const stripped = rawLine.replace(/[\r\t]/g, '').trimStart()
        const rowTemplates: [string, string][] = [
          ['.子程序 ', '    .参数 , 整数型'],
          ['.DLL命令 ', '    .参数 , 整数型'],
          ['.程序集 ', '.程序集变量 , 整数型'],
          ['.程序集变量 ', '.程序集变量 , 整数型'],
          ['.局部变量 ', '.局部变量 , 整数型'],
          ['.全局变量 ', '.全局变量 , 整数型'],
          ['.参数 ', '    .参数 , 整数型'],
          ['.成员 ', '    .成员 , 整数型'],
          ['.常量 ', '.常量 , '],
        ]

        let newLine: string | null = null
        for (const [prefix, template] of rowTemplates) {
          if (stripped.startsWith(prefix)) {
            newLine = template
            break
          }
        }

        if (newLine) {
          const nl = [...lines]
          nl[li] = rawLine

          // 变量名重命名同步（与 commit 中逻辑一致）
          if (editCell.fieldIdx === 0) {
            const origRaw = lines[li]
            const trimmedOrig = origRaw.replace(/[\r\t]/g, '').trim()
            const varPfxs = ['.局部变量 ', '.参数 ', '.程序集变量 ', '.全局变量 ']
            const mPfx = varPfxs.find(pf => trimmedOrig.startsWith(pf))
            if (mPfx) {
              // 使用编辑前保存的原始值作为旧名
              const oName = editCellOrigValRef.current.trim()
              const nName = editVal.trim()
              if (oName && nName && oName !== nName) {
                let sStart = 0, sEnd = nl.length
                const isLoc = mPfx === '.局部变量 ' || mPfx === '.参数 '
                const isAsm = mPfx === '.程序集变量 '
                if (isLoc) {
                  for (let j = li - 1; j >= 0; j--) { const tt = nl[j].replace(/[\r\t]/g, '').trim(); if (tt.startsWith('.子程序 ') || tt.startsWith('.程序集 ')) { sStart = j; break } }
                  for (let j = li + 1; j < nl.length; j++) { const tt = nl[j].replace(/[\r\t]/g, '').trim(); if (tt.startsWith('.子程序 ') || tt.startsWith('.程序集 ')) { sEnd = j; break } }
                } else if (isAsm) {
                  for (let j = li - 1; j >= 0; j--) { const tt = nl[j].replace(/[\r\t]/g, '').trim(); if (tt.startsWith('.程序集 ')) { sStart = j; break } }
                  for (let j = li + 1; j < nl.length; j++) { const tt = nl[j].replace(/[\r\t]/g, '').trim(); if (tt.startsWith('.程序集 ')) { sEnd = j; break } }
                }
                const nrx = new RegExp(
                  '(?<=[^\\u4e00-\\u9fa5A-Za-z0-9_.]|^)' + oName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[^\\u4e00-\\u9fa5A-Za-z0-9_.]|$)', 'g'
                )
                for (let j = sStart; j < sEnd; j++) {
                  if (j === li) continue
                  const tt = nl[j].replace(/[\r\t]/g, '').trim()
                  if (!tt || tt.startsWith("'") || tt.startsWith('.')) continue
                  nl[j] = nl[j].replace(nrx, nName)
                }
              }
            }

            // 类模块程序集名重命名：回车提交分支也触发同步
            if (isClassModule && trimmedOrig.startsWith('.程序集 ')) {
              const oName = editCellOrigValRef.current.trim()
              const nName = editVal.trim()
              if (oName && nName && oName !== nName) {
                onClassNameRename?.(oName, nName)
              }
            }
          }

          nl.splice(li + 1, 0, newLine)
          const nt = nl.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt)
          // 开始编辑新行的名称单元格
          const newLi = li + 1
          editCellOrigValRef.current = ''
          setEditCell({ lineIndex: newLi, cellIndex: 0, fieldIdx: 0, sliceField: false })
          setEditVal('')
          setTimeout(() => { inputRef.current?.focus() }, 0)
        } else {
          commit()
        }
      } else {
        commit()
      }
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      // 输入为空时按退格/删除键
      if (editCell && editCell.cellIndex < 0 && editVal.trim() === '' && lines.length > 1) {
        const li = editCell.lineIndex
        const firstDeclLine = (() => {
          const parsed = parseLines(lines.join('\n'))
          for (let i = 0; i < parsed.length; i++) {
            const tp = parsed[i].type
            if (tp !== 'blank' && tp !== 'comment' && tp !== 'code' && tp !== 'version' && tp !== 'supportLib') return i
          }
          return -1
        })()
        if (li === firstDeclLine) {
          e.preventDefault()
          return
        }
        if (!flowMarkRef.current && !isFlowMarkerLine(lines[li] || '')) {
          e.preventDefault()
          pushUndo(currentText)
          const nl = [...lines]
          nl.splice(li, 1)
          const nt = nl.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt)
          setEditCell(null)
          flowIndentRef.current = ''
          setTimeout(() => wrapperRef.current?.focus(), 0)
        }
      }
    } else if (e.key === 'Escape') { setAcVisible(false); setEditCell(null) }
    // ===== 方向键导航 =====
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (editCell && editCell.cellIndex < 0) {
        e.preventDefault()
        const cursorPos = e.currentTarget.selectionStart ?? 0
        commit()
        const targetLi = e.key === 'ArrowUp' ? editCell.lineIndex - 1 : editCell.lineIndex + 1
        setTimeout(() => {
          const latestLines = prevRef.current.split('\n')
          if (targetLi >= 0 && targetLi < latestLines.length) {
            startEditLine(targetLi)
            // 尝试保持光标水平位置
            setTimeout(() => {
              if (inputRef.current) {
                const maxPos = inputRef.current.value.length
                const pos = Math.min(cursorPos, maxPos)
                inputRef.current.selectionStart = pos
                inputRef.current.selectionEnd = pos
              }
            }, 0)
          }
        }, 0)
      }
    } else if (e.key === 'ArrowLeft') {
      if (editCell && editCell.cellIndex < 0) {
        const pos = e.currentTarget.selectionStart ?? 0
        if (pos === 0 && editCell.lineIndex > 0) {
          e.preventDefault()
          commit()
          const targetLi = editCell.lineIndex - 1
          setTimeout(() => {
            const latestLines = prevRef.current.split('\n')
            if (targetLi >= 0 && targetLi < latestLines.length) {
              startEditLine(targetLi)
              setTimeout(() => {
                if (inputRef.current) {
                  const end = inputRef.current.value.length
                  inputRef.current.selectionStart = end
                  inputRef.current.selectionEnd = end
                }
              }, 0)
            }
          }, 0)
        }
      }
    } else if (e.key === 'ArrowRight') {
      if (editCell && editCell.cellIndex < 0) {
        const pos = e.currentTarget.selectionStart ?? 0
        const len = editVal.length
        if (pos >= len) {
          e.preventDefault()
          commit()
          const targetLi = editCell.lineIndex + 1
          setTimeout(() => {
            const latestLines = prevRef.current.split('\n')
            if (targetLi < latestLines.length) {
              startEditLine(targetLi)
              setTimeout(() => {
                if (inputRef.current) {
                  inputRef.current.selectionStart = 0
                  inputRef.current.selectionEnd = 0
                }
              }, 0)
            }
          }, 0)
        }
      }
    }
  }, [commit, editCell, editVal, lines, onChange, acVisible, acItems, acIndex, applyCompletion, currentText, pushUndo, startEditLine, expandedLines, shouldUseNativeInputPaste])

  // 插入子程序：在当前光标所处子程序后方插入，无光标时插入到末尾
  const deleteLineSelection = useCallback((selection: Set<number>): boolean => {
    const ls = currentText.split('\n')
    const protectedLine = (() => {
      const parsed = parseLines(ls.join('\n'))
      for (let i = 0; i < parsed.length; i++) {
        if (parsed[i].type === 'assembly') return i
      }
      return -1
    })()

    const deletable = new Set<number>()
    for (const i of selection) {
      if (i < 0 || i >= ls.length) continue
      if (i === protectedLine) continue
      deletable.add(i)
    }
    const sorted = Array.from(deletable).sort((a, b) => a - b)
    if (sorted.length === 0) return false

    const checkedCmds = new Set<number>()
    const wouldBreak = sorted.some(i => {
      const st = getFlowStructureAround(ls, i)
      if (!st || checkedCmds.has(st.cmdLine)) return false
      checkedCmds.add(st.cmdLine)
      if (deletable.has(st.cmdLine)) return false
      return st.sections.some(sec => {
        let remaining = 0
        for (let j = sec.startLine; j <= sec.endLine; j++) {
          if (!deletable.has(j)) remaining++
        }
        return remaining < 1
      })
    })
    if (wouldBreak) return false

    pushUndo(currentText)
    const nt = ls.filter((_, i) => !deletable.has(i)).join('\n')
    setCurrentText(nt)
    prevRef.current = nt
    onChange(nt)
    setSelectedLines(new Set())
    setContextMenu(null)
    return true
  }, [currentText, onChange, pushUndo])

  useImperativeHandle(ref, () => ({
    insertSubroutine: () => {
      pushUndo(currentText)
      const curLines = currentText.split('\n')
      const focusLi = lastFocusedLine.current

      // 收集已有子程序名，生成唯一名称
      const existingNames = new Set<string>()
      for (const ln of curLines) {
        const t = ln.replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ')) {
          const name = splitCSV(t.slice('.子程序 '.length))[0]
          if (name) existingNames.add(name)
        }
      }
      let num = 1
      while (existingNames.has('子程序' + num)) num++
      const newName = '子程序' + num

      let insertAt: number

      if (focusLi < 0) {
        // 无光标焦点：插入到文件末尾
        insertAt = curLines.length
      } else {
        // 先找光标所在或上方最近的 .子程序 声明行
        let curSubStart = -1
        for (let i = Math.min(focusLi, curLines.length - 1); i >= 0; i--) {
          const t = curLines[i].replace(/[\r\t]/g, '').trim()
          if (t.startsWith('.子程序 ')) { curSubStart = i; break }
          // 碰到程序集声明就停止（程序集表格始终在最上方）
          if (t.startsWith('.程序集 ')) break
        }

        // 找下一个子程序/程序集的起始行（即当前子程序的结束后）
        insertAt = curLines.length
        const searchStart = curSubStart >= 0 ? curSubStart + 1 : Math.max(focusLi + 1, 0)
        for (let i = searchStart; i < curLines.length; i++) {
          const t = curLines[i].replace(/[\r\t]/g, '').trim()
          if (t.startsWith('.子程序 ') || t.startsWith('.程序集 ')) {
            insertAt = i
            break
          }
        }
      }

      const newSubText = '\n.子程序 ' + newName + ', , , '
      const nl = [...curLines]
      nl.splice(insertAt, 0, newSubText)
      const nt = nl.join('\n')
      setCurrentText(nt); prevRef.current = nt; onChange(nt)
    },

    insertLocalVariable: () => {
      const curLines = currentText.split('\n')
      const focusLi = lastFocusedLine.current

      // 向上查找当前所在的 .子程序 或 .程序集
      let contextStart = -1
      let isAssembly = false
      for (let i = Math.min(focusLi, curLines.length - 1); i >= 0; i--) {
        const t = curLines[i].replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ')) { contextStart = i; break }
        if (t.startsWith('.程序集 ')) { contextStart = i; isAssembly = true; break }
      }
      if (contextStart < 0) return

      // 在程序集上下文插入程序集变量，在子程序上下文插入局部变量
      const declPrefix = isAssembly ? '.程序集变量 ' : '.局部变量 '
      const searchPrefixes = isAssembly
        ? ['.程序集变量 ']
        : ['.参数 ', '.局部变量 ']

      // 找到当前范围内最后一个相关声明行
      let insertAt = contextStart
      for (let i = contextStart + 1; i < curLines.length; i++) {
        const t = curLines[i].replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ') || t.startsWith('.程序集 ')) break
        if (searchPrefixes.some(p => t.startsWith(p))) insertAt = i
      }

      pushUndo(currentText)
      const nl = [...curLines]
      nl.splice(insertAt + 1, 0, declPrefix + ', 整数型')
      const nt = nl.join('\n')
      setCurrentText(nt); prevRef.current = nt; onChange(nt)

      // 开始编辑新行的名称单元格
      const newLi = insertAt + 1
      lastFocusedLine.current = newLi
      setEditCell({ lineIndex: newLi, cellIndex: 0, fieldIdx: 0, sliceField: false })
      setEditVal('')
      setTimeout(() => {
        const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${newLi}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        inputRef.current?.focus()
      }, 50)
    },

    insertConstant: () => {
      const curLines = currentText.split('\n')
      const constPrefix = isResourceTableDoc ? '.资源 ' : '.常量 '
      const defaultType = '其它'

      // 生成不重复的常量名
      const existingNames = new Set<string>()
      for (const ln of curLines) {
        const t = ln.replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.常量 ') || t.startsWith('.资源 ')) {
          const raw = t.startsWith('.资源 ') ? t.slice('.资源 '.length) : t.slice('.常量 '.length)
          const name = splitCSV(raw)[0]
          if (name) existingNames.add(name)
        }
      }
      let num = 1
      while (existingNames.has((isResourceTableDoc ? '资源' : '常量') + num)) num++
      const newName = (isResourceTableDoc ? '资源' : '常量') + num

      // 默认插入到首个子程序前；若已有常量/全局变量则追加到其后
      let firstSub = curLines.findIndex(ln => ln.replace(/[\r\t]/g, '').trim().startsWith('.子程序 '))
      if (firstSub < 0) firstSub = curLines.length

      let insertAt = firstSub
      let lastConstant = -1
      let lastGlobal = -1
      for (let i = 0; i < firstSub; i++) {
        const t = curLines[i].replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.常量 ') || t.startsWith('.资源 ')) lastConstant = i
        if (t.startsWith('.全局变量 ')) lastGlobal = i
      }
      if (lastConstant >= 0) insertAt = lastConstant + 1
      else if (lastGlobal >= 0) insertAt = lastGlobal + 1

      pushUndo(currentText)
      const nl = [...curLines]
      if (isResourceTableDoc) {
        nl.splice(insertAt, 0, constPrefix + newName + ', "", ' + defaultType)
      } else {
        nl.splice(insertAt, 0, constPrefix + newName + ', 0')
      }
      const nt = nl.join('\n')
      setCurrentText(nt); prevRef.current = nt; onChange(nt)

      // 自动进入名称编辑
      lastFocusedLine.current = insertAt
      setEditCell({ lineIndex: insertAt, cellIndex: 0, fieldIdx: 0, sliceField: false })
      setEditVal(newName)
      setTimeout(() => {
        const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${insertAt}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 50)
    },

    navigateOrCreateSub: (subName: string, params: Array<{ name: string; dataType: string; isByRef: boolean }>) => {
      const curLines = currentText.split('\n')

      // 查找同名子程序是否已存在
      let subLineIndex = -1
      for (let i = 0; i < curLines.length; i++) {
        const t = curLines[i].replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ')) {
          const name = splitCSV(t.slice('.子程序 '.length))[0]
          if (name === subName) { subLineIndex = i; break }
        }
      }

      if (subLineIndex >= 0) {
        // 已存在：滚动到该子程序
        lastFocusedLine.current = subLineIndex
        setTimeout(() => {
          const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${subLineIndex}"]`)
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 50)
        return
      }

      // 不存在：在文件末尾插入新子程序
      pushUndo(currentText)
      const insertLines: string[] = ['\n.子程序 ' + subName + ', , , ']
      for (const p of params) {
        insertLines.push('    .参数 ' + p.name + ', ' + (p.dataType || '整数型') + (p.isByRef ? ', 传址' : ''))
      }
      const nl = [...curLines, ...insertLines]
      const nt = nl.join('\n')
      setCurrentText(nt); prevRef.current = nt; onChange(nt)

      // 新子程序行在 join 后的位置：curLines.length + 1（因 insertLines[0] 以 \n 开头产生空行）
      const newSubLineIndex = curLines.length + 1
      lastFocusedLine.current = newSubLineIndex
      setTimeout(() => {
        const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${newSubLineIndex}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 150)
    },
    navigateToLine: (line: number) => {
      const lineIndex = line - 1
      lastFocusedLine.current = lineIndex
      setTimeout(() => {
        const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${lineIndex}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // 高亮闪烁效果
        if (el) {
          el.classList.add('highlight-flash')
          setTimeout(() => el.classList.remove('highlight-flash'), 1500)
        }
      }, 50)
    },
    editorAction: (action: string) => {
      if (action === 'copy') {
        if (selectedLines.size > 0) {
          void navigator.clipboard.writeText(getSelectedSourceText())
        } else {
          const selectedText = getMouseRangeSelectedSourceText()
          if (selectedText) void navigator.clipboard.writeText(selectedText)
        }
        return
      }
      if (action === 'selectAll') {
        const ls = currentText.split('\n')
        const all = new Set<number>()
        for (let i = 0; i < ls.length; i++) all.add(i)
        setSelectedLines(all)
        dragAnchor.current = 0
        return
      }
    },
  }), [currentText, onChange, pushUndo, selectedLines, getSelectedSourceText, getMouseRangeSelectedSourceText, isResourceTableDoc, shouldUseNativeInputPaste])

  // 查找代码行中第一个有参数的有效命令
  const findCmdWithParams = useCallback((codeLine: string): CompletionItem | null => {
    if (!codeLine) return null
    const spans = colorize(codeLine)
    for (const s of spans) {
      if ((s.cls === 'funccolor' || s.cls === 'comecolor') && validCommandNames.has(s.text)) {
        const cmd = allCommandsRef.current.find(c => c.name === s.text) || dllCompletionItemsRef.current.find(c => c.name === s.text)
        if (cmd && cmd.params.length > 0) return cmd
      }
    }
    return null
  }, [validCommandNames])

  // 查找代码行中第一个命令名（不要求有参数）
  const findFirstCommandName = useCallback((codeLine: string): string | null => {
    if (!codeLine) return null
    const spans = colorize(codeLine)
    for (const s of spans) {
      if ((s.cls === 'funccolor' || s.cls === 'comecolor' || s.cls === 'cometwolr') && s.text.trim()) {
        return s.text
      }
    }
    return null
  }, [])

  /** 识别赋值语句并提取左值/右值（支持对象成员写法） */
  const parseAssignmentDetail = useCallback((codeLine: string): { target: string; value: string } | null => {
    if (!codeLine) return null
    const trimmed = codeLine.replace(FLOW_AUTO_TAG, '').trim()
    if (!trimmed || trimmed.startsWith('.')) return null
    const m = /^([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.。．]*)\s*(?:=|＝)\s*(.+)$/.exec(trimmed)
    if (!m) return null
    const target = (m[1] || '').trim()
    const value = (m[2] || '').trim()
    if (!target || !value) return null
    return { target, value }
  }, [])

  const parseAssignmentLineParts = useCallback((codeLine: string): { indent: string; lhs: string; rhs: string } | null => {
    if (!codeLine) return null
    const m = /^(\s*[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.。．]*)\s*(?:=|＝)\s*(.*)$/.exec(codeLine)
    if (!m) return null
    const lhsRaw = m[1] || ''
    const rhs = (m[2] || '').trim()
    const indentLen = lhsRaw.length - lhsRaw.trimStart().length
    return {
      indent: lhsRaw.slice(0, indentLen),
      lhs: lhsRaw.trim(),
      rhs,
    }
  }, [])

  const isQuotedTextLiteral = useCallback((text: string): boolean => {
    const t = (text || '').trim()
    if (!t) return false
    const isAsciiQuoted = t.length >= 2 && t.startsWith('"') && t.endsWith('"')
    const isCnQuoted = t.length >= 2 && t.startsWith('“') && t.endsWith('”')
    return isAsciiQuoted || isCnQuoted
  }, [])

  /** 从代码行中提取括号内的实际参数值列表 */
  const parseCallArgs = useCallback((codeLine: string): string[] => {
    // 找到第一个 ( 或 （
    const openIdx = codeLine.search(/[(（]/)
    if (openIdx < 0) return []
    const open = codeLine[openIdx]
    const close = open === '(' ? ')' : '）'
    let depth = 0
    let start = openIdx + 1
    const args: string[] = []
    let inStr = false
    for (let i = openIdx; i < codeLine.length; i++) {
      const ch = codeLine[i]
      if (inStr) { if (ch === '"' || ch === '\u201d') inStr = false; continue }
      if (ch === '"' || ch === '\u201c') { inStr = true; continue }
      if (ch === open || ch === '(' || ch === '（') {
        if (depth === 0) start = i + 1
        depth++
      } else if (ch === close || ch === ')' || ch === '）') {
        depth--
        if (depth === 0) {
          args.push(codeLine.slice(start, i).trim())
          break
        }
      } else if ((ch === ',' || ch === '，') && depth === 1) {
        args.push(codeLine.slice(start, i).trim())
        start = i + 1
      }
    }
    return args
  }, [])

  /** 格式化参数中的运算符：半角→全角 + 前后加空格 */
  const formatParamOperators = useCallback((val: string): string => {
    return formatOps(val)
  }, [])

  /** 替换代码行中第 argIdx 个参数的值 */
  const replaceCallArg = useCallback((codeLine: string, argIdx: number, newVal: string): string => {
    const openIdx = codeLine.search(/[(（]/)
    if (openIdx < 0) return codeLine
    // 解析参数位置范围，skipStr 控制是否跳过字符串内容
    const parseRanges = (skipStr: boolean) => {
      const ranges: { start: number; end: number }[] = []
      let depth = 0
      let start = openIdx + 1
      let inStr = false
      let closeIdx = codeLine.length
      let found = false
      for (let i = openIdx; i < codeLine.length; i++) {
        const ch = codeLine[i]
        if (skipStr) {
          if (inStr) { if (ch === '"' || ch === '\u201d') inStr = false; continue }
          if (ch === '"' || ch === '\u201c') { inStr = true; continue }
        }
        if (ch === '(' || ch === '（') {
          if (depth === 0) start = i + 1
          depth++
        } else if (ch === ')' || ch === '）') {
          depth--
          if (depth === 0) { ranges.push({ start, end: i }); closeIdx = i; found = true; break }
        } else if ((ch === ',' || ch === '，') && depth === 1) {
          ranges.push({ start, end: i })
          start = i + 1
        }
      }
      return { ranges, closeIdx, found }
    }
    // 先尝试带字符串检测的解析，失败则回退不检测字符串
    let { ranges, closeIdx, found } = parseRanges(true)
    if (!found) {
      ({ ranges, closeIdx, found } = parseRanges(false))
    }
    if (argIdx < ranges.length) {
      return codeLine.slice(0, ranges[argIdx].start) + newVal + codeLine.slice(ranges[argIdx].end)
    }
    // 参数不存在时追加空位到 argIdx
    let result = codeLine.slice(0, closeIdx)
    const sep = codeLine[openIdx] === '（' ? '，' : ', '
    for (let i = ranges.length; i <= argIdx; i++) {
      if (i > 0 || ranges.length > 0) result += sep
      result += (i === argIdx) ? newVal : ''
    }
    result += codeLine.slice(closeIdx)
    return result
  }, [])

  /** 实时同步编辑内容到底层数据（不关闭编辑状态） */
  const liveUpdate = useCallback((val: string) => {
    if (!editCell) return

    // 参数值编辑
    if (editCell.paramIdx !== undefined) {
      if (editCell.paramIdx >= 0) {
        const codeLine = lines[editCell.lineIndex]
        const newLine = replaceCallArg(codeLine, editCell.paramIdx, val)
        const nl = [...lines]; nl[editCell.lineIndex] = newLine
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt)
        return
      }
      if (editCell.paramIdx <= -200) {
        const codeLine = lines[editCell.lineIndex] || ''
        const parsed = parseAssignmentLineParts(codeLine)
        if (!parsed) return
        const rhsParamIdx = -editCell.paramIdx - 200
        const newRhs = replaceCallArg(parsed.rhs, rhsParamIdx, val)
        const newLine = `${parsed.indent}${parsed.lhs} ＝ ${newRhs}`
        const nl = [...lines]; nl[editCell.lineIndex] = newLine
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt)
        return
      }
    }

    if (editCell.cellIndex < 0) {
      if (editCell.isVirtual) return
      const nl = [...lines]; nl[editCell.lineIndex] = flowIndentRef.current + flowMarkRef.current + val
      const nt = nl.join('\n')
      setCurrentText(nt); prevRef.current = nt; onChange(nt)
      return
    }

    if (editCell.fieldIdx < 0) return

    // 表格单元格
    const rawLine = lines[editCell.lineIndex]
    const newLine = rebuildLineField(rawLine, editCell.fieldIdx, val, editCell.sliceField)
    const nl = [...lines]; nl[editCell.lineIndex] = newLine
    const nt = nl.join('\n')
    setCurrentText(nt); prevRef.current = nt; onChange(nt)
  }, [editCell, lines, onChange, replaceCallArg, parseAssignmentLineParts])

  /** 渲染某行的流程线段 */
  const renderFlowSegs = (lineIndex: number, isExpanded?: boolean): { node: React.ReactNode; skipTreeLines: number } => {
    if (flowLines.maxDepth === 0) return { node: null, skipTreeLines: 0 }
    const segs = flowLines.map.get(lineIndex) || []
    if (segs.length === 0) return { node: null, skipTreeLines: 0 }
    // 按该行实际最大深度分配占位（而非全局 maxDepth），避免外层行被内层撑宽
    const lineMaxDepth = Math.max(...segs.map(s => s.depth)) + 1
    const slots: (FlowSegment | null)[] = Array(lineMaxDepth).fill(null)
    for (const s of segs) slots[s.depth] = s
    return {
      node: (
        <>
          {slots.map((seg, d) => (
            <span key={d} className={`eyc-flow-seg ${seg ? `eyc-flow-${seg.type}` : ''} ${seg?.isLoop ? 'eyc-flow-loop' : ''} ${seg?.isMarker ? 'eyc-flow-marker' : ''}${(seg?.isInnerThrough || seg?.isInnerEnd) ? ' eyc-flow-no-outer' : ''}${seg?.hasPrevFlowEnd ? ' eyc-flow-has-prev-end' : ''}${seg?.hasOuterLink ? ' eyc-flow-has-outer-link' : ''}${seg?.outerHidden ? ' eyc-flow-outer-hidden' : ''}${seg?.hasInnerLink ? ' eyc-flow-has-inner-link' : ''}${seg?.isStraightEnd ? ' eyc-flow-straight-end' : ''}`}>
              {seg?.isMarker && seg.type === 'branch' && seg?.markerInnerVert && !seg?.outerHidden && <span className="eyc-flow-inner-vert" />}
              {seg?.type === 'branch' && !seg?.isMarker && seg?.hasInnerVert && <span className="eyc-flow-inner-vert eyc-flow-inner-through" />}
              {seg?.type === 'branch' && !seg?.isMarker && seg?.hasInnerLink && <span className="eyc-flow-outer-resume" />}
              {seg?.type === 'branch' && !seg?.isMarker && seg?.hasInnerLink && <span className="eyc-flow-outer-horz" />}
              {seg?.type === 'branch' && !seg?.isMarker && seg?.hasInnerLink && <span className="eyc-flow-outer-arrow" />}
              {seg?.isMarker && seg.type === 'end' && !seg?.hasExtraEnds && !seg?.hasNextFlow && !seg?.outerHidden && (isExpanded ? <span className="eyc-flow-inner-vert eyc-flow-inner-through" /> : <><span className="eyc-flow-inner-vert" /><span className="eyc-flow-arrow-down eyc-flow-inner-arrow-down" /><span className="eyc-flow-arrow-right" /></>)}
              {seg?.isMarker && seg.type === 'end' && !seg?.hasExtraEnds && !seg?.hasNextFlow && seg?.outerHidden && (isExpanded ? <span className="eyc-flow-inner-vert eyc-flow-inner-through" /> : <><span className="eyc-flow-inner-vert" /><span className="eyc-flow-arrow-down eyc-flow-inner-arrow-down" /></>)}
              {seg?.isMarker && seg.type === 'end' && !seg?.hasExtraEnds && seg?.hasNextFlow && !seg?.outerHidden && <><span className="eyc-flow-inner-vert eyc-flow-inner-through" /><span className="eyc-flow-arrow-right" /></>}
              {seg?.isMarker && seg.type === 'end' && seg?.hasExtraEnds && !seg?.outerHidden && <><span className="eyc-flow-inner-vert eyc-flow-inner-through" /><span className="eyc-flow-arrow-right" /></>}
              {seg?.type === 'start' && seg?.hasPrevFlowEnd && <><span className="eyc-flow-link-vert" /><span className="eyc-flow-link-horz" /><span className="eyc-flow-link-arrow" /></>}
              {seg?.type === 'start' && seg?.isLoop && <span className="eyc-flow-arrow-right" />}
              {seg?.type === 'end' && !seg?.isMarker && !seg?.isStraightEnd && !seg?.isLoop && <span className="eyc-flow-arrow-down" />}
              {seg?.isStraightEnd && <span className="eyc-flow-arrow-down" />}
              {seg?.hasInnerVert && !seg?.hasInnerLink && <span className="eyc-flow-inner-vert eyc-flow-inner-through" />}
              {seg?.hasInnerLink && seg?.type !== 'branch' && <><span className="eyc-flow-inner-link-horz" /><span className="eyc-flow-inner-link-arrow" /></>}
              {seg?.isInnerThrough && <span className="eyc-flow-inner-vert eyc-flow-inner-through" />}
              {seg?.isInnerEnd && <><span className="eyc-flow-inner-vert eyc-flow-inner-end" /><span className="eyc-flow-arrow-down eyc-flow-inner-arrow-down" /></>}
            </span>
          ))}
        </>
      ),
      skipTreeLines: lineMaxDepth,
    }
  }

  /** 渲染参数展开区域的流程线延续（只绘制纵向穿越线） */
  const renderFlowContinuation = (lineIndex: number): React.ReactNode => {
    if (flowLines.maxDepth === 0) return null
    const segs = flowLines.map.get(lineIndex) || []
    if (segs.length === 0) return null
    const lineMaxDepth = Math.max(...segs.map(s => s.depth)) + 1
    const slots: (FlowSegment | null)[] = Array(lineMaxDepth).fill(null)
    for (const s of segs) slots[s.depth] = s
    // 只绘制有纵向延续的线段（start/through/branch/标记end 都有竖线穿过）
    const hasAny = slots.some(seg => seg && (seg.type === 'start' || seg.type === 'through' || seg.type === 'branch' || (seg.type === 'end' && (seg.hasExtraEnds || seg.isMarker))))
    if (!hasAny) return null
    return (
      <div className="eyc-param-flow-cont">
        {slots.map((seg, d) => {
          // 内侧竖线延续：标记分支/标记结束/hasInnerVert/isInnerThrough/isInnerEnd
          const hasInnerCont = seg && (
            (seg.isMarker && ((seg.type === 'branch' && seg.markerInnerVert) || seg.type === 'end'))
            || (seg.hasInnerVert)
            || (seg.isInnerThrough)
            || (seg.isInnerEnd)
          )
          // 有内侧竖线时用内侧位置绘制，否则用外侧竖线
          const hasCont = seg && (seg.type === 'start' || seg.type === 'through' || seg.type === 'branch' || (seg.type === 'end' && (seg.hasExtraEnds || seg.isMarker))) && !seg.outerHidden
          // 标记结束行：延续内侧竖线到底部并绘制向下箭头
          const isEndMarker = seg && seg.type === 'end' && seg.isMarker && !seg.hasExtraEnds
          // 需要同时绘制外侧和内侧两条线：标记分支行 / 含内侧竖线的穿越行
          const needsBothLines = seg && hasInnerCont && hasCont && (
            (seg.isMarker && seg.type === 'branch' && seg.markerInnerVert)
            || seg.hasInnerVert
          )
          return (
            <span key={d} className={`eyc-flow-seg eyc-flow-cont-seg ${hasCont ? (hasInnerCont ? (isEndMarker ? '' : (needsBothLines ? 'eyc-flow-through' : 'eyc-flow-through eyc-flow-cont-inner')) : 'eyc-flow-through') : ''} ${seg?.isLoop && hasCont ? 'eyc-flow-loop' : ''}`}>
              {hasCont && hasInnerCont && isEndMarker && <><span className="eyc-flow-inner-vert eyc-flow-inner-end" /><span className="eyc-flow-arrow-down eyc-flow-inner-arrow-down" /></>}
              {needsBothLines && <span className="eyc-flow-inner-vert eyc-flow-inner-through" />}
            </span>
          )
        })}
      </div>
    )
  }

  // 点击空白区域：清除选择和编辑状态
  const handleWrapperMouseDown = useCallback((e: React.MouseEvent) => {
    // 只处理直接点击 wrapper 自身（空白区域），不处理子元素冒泡
    if (e.target !== wrapperRef.current) return
    e.preventDefault()
    // 如果有活跃编辑，先提交（含自动补全上屏），而非直接丢弃
    if (editCellRef.current) {
      commitRef.current()
    } else {
      setEditCell(null)
      setAcVisible(false)
    }
    // 点击末尾空白区域：不立即标记行选中蓝色，等 mouseup 确认是否为拖动
    const lastLine = lines.length - 1
    if (lastLine >= 0) {
      dragStartPos.current = { x: e.clientX, y: e.clientY }
      wasDragSelect.current = false
      dragAnchor.current = lastLine
      isDragging.current = true
      wrapperRef.current?.focus()

      // 仅在“点击未拖动”时进入最后一行编辑；若发生拖动则保持多选结果
      const handleMouseUp = (): void => {
        window.removeEventListener('mouseup', handleMouseUp)
        if (!wasDragSelect.current) {
          setSelectedLines(new Set())
          startEditLine(lastLine)
        }
      }
      window.addEventListener('mouseup', handleMouseUp)
    } else {
      setSelectedLines(new Set())
    }
  }, [lines.length, startEditLine])

  return (
    <div className="eyc-table-editor ebackcolor1" onClick={() => onCommandClear?.()}>
      <div
        className="eyc-table-wrapper"
        ref={wrapperRef}
        onMouseDown={handleWrapperMouseDown}
        onCopy={(e) => {
          const mouseRangeText = selectedLines.size === 0 ? getMouseRangeSelectedSourceText() : null
          if (selectedLines.size === 0 && !mouseRangeText) return
          e.preventDefault()
          e.clipboardData.setData('text/plain', selectedLines.size > 0 ? getSelectedSourceText() : (mouseRangeText || ''))
        }}
        onPaste={(e) => {
          const clipText = e.clipboardData.getData('text/plain')
          if (!clipText) return
          const target = e.target as HTMLElement
          const state = editCellRef.current
          const isCodeLineInput = !!state && state.cellIndex === -1 && state.paramIdx === undefined
          const isMultiLinePaste = /[\r\n]/.test(clipText)
          if (target.closest('input')) {
            if (shouldUseNativeInputPaste(state)) return
            if (!isCodeLineInput || !isMultiLinePaste) return
          }
          e.preventDefault()
          const pastedLines = sanitizePastedTextForCurrent(clipText, currentText).split('\n').map(l => l.replace(/\r$/, ''))
          if (pastedLines.length === 0) return
          const pastedHasSub = parseLines(pastedLines.join('\n')).some(ln => ln.type === 'sub')
          const ls = currentText.split('\n')
          const getInsertAtForPastedSubs = (cursorLine: number): number => {
            if (cursorLine < 0 || cursorLine >= ls.length) return ls.length
            const parsed = parseLines(ls.join('\n'))
            let ownerSubLine = -1
            for (let i = Math.min(cursorLine, parsed.length - 1); i >= 0; i--) {
              if (parsed[i].type === 'sub') { ownerSubLine = i; break }
            }
            if (ownerSubLine < 0) return ls.length
            for (let i = ownerSubLine + 1; i < parsed.length; i++) {
              if (parsed[i].type === 'sub') return i
            }
            return ls.length
          }
          pushUndo(currentText)
          const cursorLine = editCellRef.current?.lineIndex ?? lastFocusedLine.current
          let insertAt = ls.length
          if (pastedHasSub) {
            insertAt = getInsertAtForPastedSubs(cursorLine)
          } else if (cursorLine >= 0) {
            insertAt = Math.min(cursorLine + 1, ls.length)
          }
          const nl = [...ls]
          nl.splice(insertAt, 0, ...pastedLines)
          const nt = nl.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt)
          const newSel = new Set<number>()
          for (let i = 0; i < pastedLines.length; i++) newSel.add(insertAt + i)
          setSelectedLines(newSel)
          lastFocusedLine.current = insertAt + pastedLines.length - 1
        }}
        tabIndex={0}
        style={{ outline: 'none' }}
      >
        {blocks.map((blk, bi) => {
          if (blk.kind === 'table') {
            const tableLineIndices = blk.rows.filter(r => !r.isHeader).map(r => r.lineIndex)
            return (
              <div
                key={bi}
                className="eyc-block-row"
                onMouseDown={(e) => {
                  // 单元格/行内点击由 tr 处理；这里只兜底处理表格外区域（行号区、空白区）
                  const target = e.target as HTMLElement
                  if (target.closest('tr.eyc-data-row') || target.closest('input')) return
                  const byY = findLineAtY(e.clientY)
                  if (byY >= 0) {
                    handleLineMouseDown(e, byY)
                    return
                  }
                  if (tableLineIndices.length > 0) {
                    handleLineMouseDown(e, tableLineIndices[0])
                  }
                }}
              >
                <div className="eyc-line-gutter">
                  {blk.rows.map((row, ri) => (
                    <div
                      key={ri}
                      className={row.isHeader ? 'eyc-gutter-cell' : `eyc-gutter-cell${selectedLines.has(row.lineIndex) ? ' eyc-line-selected' : ''}`}
                    >
                      <span className="eyc-gutter-linenum">{row.isHeader ? '' : (lineNumMaps.tableRowNumMap.get(`${bi}:${ri}`) ?? row.lineIndex + 1)}</span>
                      <span className="eyc-gutter-fold-area" />
                    </div>
                  ))}
                </div>
                <div className="eyc-block-content">
                  <table className="eyc-decl-table" cellSpacing={0}>
                    <tbody>
                      {blk.rows.map((row, ri) => (
                        <tr
                          key={ri}
                          className={row.isHeader ? 'eyc-hdr-row' : `eyc-data-row${selectedLines.has(row.lineIndex) ? ' eyc-line-selected' : ''}`}
                          {...(!row.isHeader ? { 'data-line-index': row.lineIndex } : {})}
                          onMouseDown={row.isHeader ? undefined : (e) => {
                            e.stopPropagation()
                            handleLineMouseDown(e, row.lineIndex)
                          }}
                        >
                      {row.cells.map((cell, ci) => (
                        (() => {
                          const isInvalidVarNameCell = !row.isHeader && cell.fieldIdx === 0 && invalidVarNameLineSet.has(row.lineIndex)
                          return (
                        <td
                          key={ci}
                          className={`${cell.cls} Rowheight${isInvalidVarNameCell ? ' eyc-cell-invalid' : ''}`}
                          colSpan={cell.colSpan}
                          style={cell.align ? { textAlign: cell.align as 'center' } : undefined}
                          onMouseDown={(e) => {
                            // 单元格点击/拖选优先走单元格逻辑，不触发行级选择
                            e.stopPropagation()
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (row.isHeader) return
                            if (tryToggleTableBooleanCell(blk.tableType, row.lineIndex, ci)) return
                            if (isResourceTableDoc && blk.tableType === 'constant' && cell.fieldIdx === 1) return
                            handleTableCellHint(row.lineIndex, cell.fieldIdx ?? -1, cell.text)
                            startEditCell(row.lineIndex, ci, cell.text, cell.fieldIdx, cell.sliceField)
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            if (row.isHeader) return
                            if (isResourceTableDoc && blk.tableType === 'constant' && cell.fieldIdx === 1) {
                              void openResourcePreview(row.lineIndex)
                              return
                            }
                            startEditCell(row.lineIndex, ci, cell.text, cell.fieldIdx, cell.sliceField)
                          }}
                        >
                          {editCell && editCell.lineIndex === row.lineIndex && editCell.cellIndex === ci && editCell.fieldIdx === cell.fieldIdx && !row.isHeader ? (
                            <div style={{ position: 'relative', display: 'inline-grid' }}>
                              <span style={{ gridArea: '1/1', visibility: 'hidden', whiteSpace: 'pre', font: 'inherit', padding: 0 }}>
                                {(editVal.length > (cell.text || '\u00A0').length ? editVal : (cell.text || '\u00A0')) + '\u00A0'}
                              </span>
                              <input
                                ref={inputRef}
                                className={`eyc-cell-input${isInvalidVarNameCell ? ' eyc-input-invalid' : ''}`}
                                style={{ gridArea: '1/1' }}
                                value={editVal}
                                onPaste={(e) => e.stopPropagation()}
                                onMouseDown={(e) => {
                                  if (e.button !== 0) return
                                  // 单元格输入框内拖选仅限单元格，不切换到行拖选
                                  pendingInputDragRef.current = { lineIndex: row.lineIndex, x: e.clientX, y: e.clientY, allowRowDrag: false }
                                }}
                                onChange={e => {
                                  const v = e.target.value
                                  setEditVal(v)
                                  liveUpdate(v)
                                  const pos = e.target.selectionStart ?? v.length
                                  updateCompletion(v, pos)
                                }}
                                onBlur={() => commit()}
                                onKeyDown={onKey}
                                spellCheck={false}
                              />
                            </div>
                          ) : (
                            cell.text || '\u00A0'
                          )}
                        </td>
                          )
                        })()
                      ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            )
          }

          // 代码行
          const codeLineRaw = blk.codeLine || ''
          const isLoopEnd = /[\u200B]?(判断循环尾|循环判断尾|计次循环尾|变量循环尾)/.test(codeLineRaw)
          const isAutoFlowLine = !blk.isVirtual && codeLineRaw.includes(FLOW_AUTO_TAG) && !isLoopEnd
          const spans = colorize((blk.codeLine || '').replace(FLOW_AUTO_TAG, ''))
          const lineCmd = blk.isVirtual ? null : findCmdWithParams((blk.codeLine || '').replace(FLOW_AUTO_TAG, ''))
          const assignDetail = blk.isVirtual ? null : parseAssignmentDetail((blk.codeLine || '').replace(FLOW_AUTO_TAG, ''))
          const hasExpandableDetail = !!lineCmd || !!assignDetail
          const isExpanded = expandedLines.has(blk.lineIndex)
          const isLineSelected = selectedLines.has(blk.lineIndex)
          return (
            <div
              key={bi}
              className={`eyc-block-row eyc-block-row-wrap${isAutoFlowLine ? ' eyc-flow-auto-line' : ''}${isLineSelected ? ' eyc-line-selected' : ''}`}
              data-line-index={blk.lineIndex}
              onMouseDown={(e) => handleLineMouseDown(e, blk.lineIndex)}
            >
              <div className="eyc-line-gutter">
                <div className="eyc-gutter-cell">
                  <span className="eyc-gutter-linenum">{blk.isVirtual ? '' : (lineNumMaps.codeLineNumMap.get(blk.lineIndex) ?? blk.lineIndex + 1)}</span>
                  <span className="eyc-gutter-fold-area">
                    {hasExpandableDetail && (isLineSelected || (editCell && editCell.lineIndex === blk.lineIndex && editCell.paramIdx === undefined)) && (
                      <span
                        className="eyc-gutter-fold"
                        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
                        onClick={(e) => {
                          e.stopPropagation()
                          setExpandedLines(prev => {
                            const next = new Set(prev)
                            if (next.has(blk.lineIndex)) next.delete(blk.lineIndex)
                            else next.add(blk.lineIndex)
                            return next
                          })
                        }}
                      >{isExpanded ? '−' : '+'}</span>
                    )}
                  </span>
                </div>
              </div>
              <div
                className={`eyc-code-line${editCell && editCell.lineIndex === blk.lineIndex && editCell.isVirtual === blk.isVirtual && editCell.paramIdx === undefined ? ' eyc-code-line-editing' : ''}`}
                onClick={(e) => {
                  // 已在输入框内操作（如拖选文字）时不重置编辑状态
                  if ((e.target as HTMLElement).tagName === 'INPUT') return
                  // 拖选后不进入编辑模式，保留行选中状态
                  if (wasDragSelect.current) { wasDragSelect.current = false; return }
                  // 普通单击进入编辑模式前清除任何行选中
                  setSelectedLines(new Set())
                  // 点击代码行时触发命令提示（显示命令全部信息）
                  const rawCode = (blk.codeLine || '').replace(FLOW_AUTO_TAG, '')
                  const cmdName = findFirstCommandName(rawCode)
                  if (cmdName) {
                    e.stopPropagation()
                    const ownerAssembly = findOwnerAssemblyName(blk.lineIndex)
                    const hintName = userSubNamesRef.current.has(cmdName) ? `__SUB__:${cmdName}:${ownerAssembly}` : cmdName
                    onCommandClick?.(hintName)
                  }
                  startEditLine(blk.lineIndex, e.clientX, e.currentTarget.getBoundingClientRect().left, blk.isVirtual)
                }}
              >
              {editCell && editCell.lineIndex === blk.lineIndex && editCell.isVirtual === blk.isVirtual && editCell.paramIdx === undefined ? (
                <>
                  {renderFlowSegs(blk.lineIndex, isExpanded).node}
                  <input
                    ref={inputRef}
                    className="eyc-inline-input"
                    value={editVal}
                    onPaste={(e) => {
                      const clipText = e.clipboardData.getData('text/plain')
                      if (!/[\r\n]/.test(clipText)) e.stopPropagation()
                    }}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return
                      // 记录起始位置；如果鼠标拖出 input 边界则切换为跳行拖选
                      pendingInputDragRef.current = { lineIndex: blk.lineIndex, x: e.clientX, y: e.clientY, allowRowDrag: true }
                    }}
                    onChange={e => {
                      const v = e.target.value
                      // 命令行括号保护：阻止 IME/粘贴等修改括号外的内容
                      if (editCell?.cellIndex === -1) {
                        const oldRange = getOuterParenRange(editVal)
                        if (oldRange) {
                          const prefix = editVal.slice(0, oldRange.start + 1)
                          const suffix = editVal.slice(oldRange.end)
                          if (!v.startsWith(prefix) || !v.endsWith(suffix)) {
                            e.target.value = editVal
                            return
                          }
                        }
                      }
                      setEditVal(v)
                      liveUpdate(v)
                      const pos = e.target.selectionStart ?? v.length
                      updateCompletion(v, pos)
                    }}
                    onBlur={() => {
                      setTimeout(() => setAcVisible(false), 150)
                      commit()
                    }}
                    onKeyDown={onKey}
                    spellCheck={false}
                  />
                </>
              ) : (
                <span className="eyc-code-spans">
                  {(() => {
                    const flow = renderFlowSegs(blk.lineIndex, isExpanded)
                    let treeSkipped = 0
                            const lineHasMissingRhs = missingRhsLineSet.has(blk.lineIndex)
                    return (
                      <>
                        {flow.node}
                        {spans.map((s, si) => {
                          // 跳过被流程线替代的树线缩进
                          if (s.cls === 'eTreeLine' && treeSkipped < flow.skipTreeLines) {
                            treeSkipped++
                            return null
                          }
                          const isFunc = s.cls === 'funccolor'
                          const isObjMethod = s.cls === 'cometwolr'
                          const isFlowKw = s.cls === 'comecolor'
                          const isUserSubRef = isFunc && userSubNamesRef.current.has(s.text)
                          const isAssignTarget = s.cls === 'assignTarget'
                          const isInvalid = (isFunc && !validCommandNames.has(s.text)) || (isAssignTarget && !isKnownAssignmentTarget(s.text, allKnownVarNames))
                          const isLineSyntaxInvalid = lineHasMissingRhs && (isAssignTarget || (!isFunc && !isObjMethod && !isFlowKw && s.text.trim() !== ''))
                          if (isFunc || isObjMethod || isFlowKw || isAssignTarget) {
                            return (
                              <span
                                key={si}
                                className={`${isAssignTarget ? 'Variablescolor' : (isUserSubRef ? 'eyc-subrefcolor' : s.cls)}${(isInvalid || isLineSyntaxInvalid) ? ' eyc-cmd-invalid' : ''}`}
                              >{s.text}</span>
                            )
                          }
                          return <span key={si} className={`${s.cls}${isLineSyntaxInvalid ? ' eyc-cmd-invalid' : ''}`}>{s.text}</span>
                        })}
                      </>
                    )
                  })()}
                </span>
              )}
              </div>
              {/* 展开的参数详情 */}
              {lineCmd && isExpanded && (() => {
                const argVals = parseCallArgs(blk.codeLine || '')
                // 计算代码行前导空格数，用于参数面板缩进
                const codeLine = (blk.codeLine || '').replace(FLOW_AUTO_TAG, '')
                const leadingSpaces = codeLine.length - codeLine.replace(/^ +/, '').length
                // 基础左边距 = gutter(80px) + 缩进空格(ch) + 命令名约1.5个字符居中位置
                const baseLeft = 80 + 8  // gutter + padding
                const indentCh = leadingSpaces + 1.5  // 缩进 + 命令名中间约1.5字符
                const arrowLeftStyle = `calc(${baseLeft}px + ${indentCh}ch)`
                const expandPadding = `calc(${baseLeft + 20}px + ${leadingSpaces}ch)`
                return (
                  <div className="eyc-param-expand" style={{ paddingLeft: expandPadding }}>
                    {renderFlowContinuation(blk.lineIndex)}
                    <span className="eyc-param-expand-arrow" style={{ left: arrowLeftStyle }} />
                    <div className="eyc-param-expand-inner" style={{ '--vline-offset': 'calc(-20px + 1.5ch)' } as React.CSSProperties}>
                      {lineCmd.params.map((p, pi) => {
                        const isEditingParam = editCell && editCell.lineIndex === blk.lineIndex && editCell.paramIdx === pi
                        const startParamEdit = (e: React.MouseEvent) => {
                          e.stopPropagation()
                          // 点击参数行时提示该参数的信息
                          const rawCode = (blk.codeLine || '').replace(FLOW_AUTO_TAG, '')
                          const cmdName = findFirstCommandName(rawCode)
                          if (cmdName) {
                            const ownerAssembly = findOwnerAssemblyName(blk.lineIndex)
                            const hintName = userSubNamesRef.current.has(cmdName) ? `__SUB__:${cmdName}:${ownerAssembly}` : cmdName
                            onCommandClick?.(hintName, pi)
                          }
                          setEditCell({ lineIndex: blk.lineIndex, cellIndex: -2, fieldIdx: -1, sliceField: false, paramIdx: pi })
                          setEditVal(argVals[pi] !== undefined ? argVals[pi] : '')
                          setTimeout(() => paramInputRef.current?.focus(), 0)
                        }
                        return (
                          <div key={pi} className="eyc-param-expand-row" onClick={isEditingParam ? undefined : startParamEdit} style={{ cursor: isEditingParam ? undefined : 'text' }}>
                            <span className="eyc-param-expand-mark">※</span>
                            <span className="eyc-param-expand-name">{p.name}</span>
                            <span className="eyc-param-expand-colon">：</span>
                            {isEditingParam ? (
                              <input
                                ref={paramInputRef}
                                className="eyc-param-val-input"
                                value={editVal}
                                onChange={e => { setEditVal(e.target.value); liveUpdate(e.target.value) }}
                                onBlur={() => commit()}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') { e.preventDefault(); commit() }
                                  else if (e.key === 'Escape') setEditCell(null)
                                }}
                                spellCheck={false}
                              />
                            ) : (
                              <span className="eyc-param-expand-val">{argVals[pi] !== undefined ? argVals[pi] : '\u00A0'}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
              {!lineCmd && assignDetail && isExpanded && (() => {
                const codeLine = (blk.codeLine || '').replace(FLOW_AUTO_TAG, '')
                const leadingSpaces = codeLine.length - codeLine.replace(/^ +/, '').length
                const baseLeft = 80 + 8
                const indentCh = leadingSpaces + 1.5
                const arrowLeftStyle = `calc(${baseLeft}px + ${indentCh}ch)`
                const expandPadding = `calc(${baseLeft + 20}px + ${leadingSpaces}ch)`
                const isEditingAssignValue = editCell && editCell.lineIndex === blk.lineIndex && editCell.paramIdx === -100
                const assignValueCmd = findCmdWithParams(assignDetail.value || '')
                const assignValueArgVals = assignValueCmd ? parseCallArgs(assignDetail.value || '') : []
                const isAssignValueCmdExpanded = expandedAssignRhsParamLines.has(blk.lineIndex)
                const showAssignValueFold = !!assignValueCmd && assignValueCmd.params.length > 0 && (isLineSelected || !!(editCell && editCell.lineIndex === blk.lineIndex))
                return (
                  <div className="eyc-param-expand" style={{ paddingLeft: expandPadding }}>
                    {showAssignValueFold && (
                      <span className="eyc-param-expand-gutter-fold-area">
                        <span
                          className="eyc-gutter-fold"
                          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setExpandedAssignRhsParamLines(prev => {
                              const next = new Set(prev)
                              if (next.has(blk.lineIndex)) next.delete(blk.lineIndex)
                              else next.add(blk.lineIndex)
                              return next
                            })
                          }}
                        >{isAssignValueCmdExpanded ? '−' : '+'}</span>
                      </span>
                    )}
                    {renderFlowContinuation(blk.lineIndex)}
                    <span className="eyc-param-expand-arrow" style={{ left: arrowLeftStyle }} />
                    <div className="eyc-param-expand-inner" style={{ '--vline-offset': 'calc(-20px + 1.5ch)' } as React.CSSProperties}>
                      <div className="eyc-param-expand-row">
                        <span className="eyc-param-expand-mark">※</span>
                        <span className="eyc-param-expand-name">被赋值的变量或变量数组</span>
                        <span className="eyc-param-expand-colon">：</span>
                        <span className="eyc-param-expand-val">{assignDetail.target || '\u00A0'}</span>
                      </div>
                      <div className="eyc-param-expand-row eyc-param-expand-row-assign-value" onClick={isEditingAssignValue ? undefined : (e) => {
                        e.stopPropagation()
                        setEditCell({ lineIndex: blk.lineIndex, cellIndex: -2, fieldIdx: -1, sliceField: false, paramIdx: -100 })
                        setEditVal(assignDetail.value || '')
                        setTimeout(() => paramInputRef.current?.focus(), 0)
                      }} style={{ cursor: isEditingAssignValue ? undefined : 'text' }}>
                        <span className="eyc-param-expand-mark">※</span>
                        <span className="eyc-param-expand-name">用作赋予的值或资源</span>
                        <span className="eyc-param-expand-colon">：</span>
                        {isEditingAssignValue ? (
                          <input
                            ref={paramInputRef}
                            className="eyc-param-val-input"
                            value={editVal}
                            onChange={e => { setEditVal(e.target.value); liveUpdate(e.target.value) }}
                            onBlur={() => commit()}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { e.preventDefault(); commit() }
                              else if (e.key === 'Escape') setEditCell(null)
                            }}
                            spellCheck={false}
                          />
                        ) : (
                          <span className={`eyc-param-expand-val${isQuotedTextLiteral(assignDetail.value) ? ' eTxtcolor' : ''}`}>{assignDetail.value || '\u00A0'}</span>
                        )}
                      </div>
                      {assignValueCmd && isAssignValueCmdExpanded && (
                        <div className="eyc-param-expand-secondary">
                          <span className="eyc-param-expand-arrow eyc-param-expand-arrow-secondary" />
                          {assignValueCmd.params.map((p, pi) => {
                            const assignParamEditIdx = -200 - pi
                            const isEditingAssignCmdParam = editCell && editCell.lineIndex === blk.lineIndex && editCell.paramIdx === assignParamEditIdx
                            return (
                              <div
                                key={`assign-param-${pi}`}
                                className="eyc-param-expand-row eyc-param-expand-row-secondary"
                                onClick={isEditingAssignCmdParam ? undefined : (e) => {
                                  e.stopPropagation()
                                  const cmdName = findFirstCommandName(assignDetail.value || '')
                                  if (cmdName) {
                                    const ownerAssembly = findOwnerAssemblyName(blk.lineIndex)
                                    const hintName = userSubNamesRef.current.has(cmdName) ? `__SUB__:${cmdName}:${ownerAssembly}` : cmdName
                                    onCommandClick?.(hintName, pi)
                                  }
                                  setEditCell({ lineIndex: blk.lineIndex, cellIndex: -2, fieldIdx: -1, sliceField: false, paramIdx: assignParamEditIdx })
                                  setEditVal(assignValueArgVals[pi] !== undefined ? assignValueArgVals[pi] : '')
                                  setTimeout(() => paramInputRef.current?.focus(), 0)
                                }}
                                style={{ cursor: isEditingAssignCmdParam ? undefined : 'text' }}
                              >
                                <span className="eyc-param-expand-mark">※</span>
                                <span className="eyc-param-expand-name">{p.name}</span>
                                <span className="eyc-param-expand-colon">：</span>
                                {isEditingAssignCmdParam ? (
                                  <input
                                    ref={paramInputRef}
                                    className="eyc-param-val-input"
                                    value={editVal}
                                    onChange={e => { setEditVal(e.target.value); liveUpdate(e.target.value) }}
                                    onBlur={() => commit()}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') { e.preventDefault(); commit() }
                                      else if (e.key === 'Escape') setEditCell(null)
                                    }}
                                    spellCheck={false}
                                  />
                                ) : (
                                  <span className="eyc-param-expand-val">{assignValueArgVals[pi] !== undefined ? assignValueArgVals[pi] : '\u00A0'}</span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })()}
            </div>
          )
        })}
      </div>

      {resourcePreview.visible && (() => {
        const viewType = resourcePreview.resourceType || inferResourceTypeByFileName(resourcePreview.resourceFile)
        const isImage = viewType === '图片'
        const isAudio = viewType === '声音'
        const isVideo = viewType === '视频'
        return (
          <div className="eyc-resource-preview-overlay" onClick={() => setResourcePreview(prev => ({ ...prev, visible: false }))}>
            <div className="eyc-resource-preview-modal" onClick={(e) => e.stopPropagation()}>
              <div className="eyc-resource-preview-header">
                <div className="eyc-resource-preview-title">资源预览</div>
                <button
                  type="button"
                  className="eyc-resource-preview-close"
                  aria-label="关闭预览"
                  title="关闭"
                  onClick={() => setResourcePreview(prev => ({ ...prev, visible: false }))}
                >
                  <img className="eyc-resource-preview-close-icon" src={closeIcon} alt="" aria-hidden="true" />
                </button>
              </div>
              <div className="eyc-resource-preview-meta">
                <div>资源名称：{resourcePreview.resourceName || '（未命名）'}</div>
                <div>资源类型：{viewType || '其它'}</div>
                <div>文件扩展名：{resourcePreviewMeta?.ext ? `.${resourcePreviewMeta.ext}` : '未知'}</div>
                <div>MIME：{resourcePreviewMeta?.mime || '未知'}</div>
                <div>文件大小：{resourcePreviewMeta ? formatFileSize(resourcePreviewMeta.sizeBytes) : '加载中...'}</div>
                <div>修改时间：{resourcePreviewMeta ? formatDateTime(resourcePreviewMeta.modifiedAtMs) : '加载中...'}</div>
                {!!resourcePreviewMediaMeta.width && !!resourcePreviewMediaMeta.height && (
                  <div>分辨率：{resourcePreviewMediaMeta.width} × {resourcePreviewMediaMeta.height}</div>
                )}
                {Number.isFinite(resourcePreviewMediaMeta.durationSec) && (
                  <div>时长：{formatDuration(resourcePreviewMediaMeta.durationSec as number)}</div>
                )}
                <div className="eyc-resource-preview-path">资源路径：{resourcePreviewMeta?.filePath || (projectDir ? `${projectDir}\\${resourcePreview.resourceFile}` : resourcePreview.resourceFile)}</div>
              </div>
              <div className="eyc-resource-preview-body">
                {!!resourcePreviewSrc && isImage && <img className="eyc-resource-preview-image" src={resourcePreviewSrc} alt={resourcePreview.resourceFile} onLoad={(e) => {
                  const width = e.currentTarget.naturalWidth
                  const height = e.currentTarget.naturalHeight
                  setResourcePreviewMediaMeta(prev => ({ ...prev, width, height }))
                }} />}
                {!!resourcePreviewSrc && isAudio && <audio className="eyc-resource-preview-audio" src={resourcePreviewSrc} controls onLoadedMetadata={(e) => {
                  const duration = e.currentTarget.duration
                  const durationSec = Number.isFinite(duration) ? duration : undefined
                  setResourcePreviewMediaMeta(prev => ({ ...prev, durationSec }))
                }} />}
                {!!resourcePreviewSrc && isVideo && <video className="eyc-resource-preview-video" src={resourcePreviewSrc} controls onLoadedMetadata={(e) => {
                  const width = e.currentTarget.videoWidth
                  const height = e.currentTarget.videoHeight
                  const duration = e.currentTarget.duration
                  const durationSec = Number.isFinite(duration) ? duration : undefined
                  setResourcePreviewMediaMeta(prev => ({ ...prev, width, height, durationSec }))
                }} />}
                {!resourcePreviewSrc && <div className="eyc-resource-preview-empty">{resourcePreviewMsg || '当前资源类型暂不支持内嵌预览，可使用“更换文件”来替换资源。'}</div>}
              </div>
              <div className="eyc-resource-preview-footer">
                <button className="eyc-resource-preview-replace" onClick={() => { void handleReplaceResourceFile() }} disabled={resourcePreviewBusy || !projectDir}>
                  {resourcePreviewBusy ? '更换中...' : '更换文件'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* 自动补全弹窗 */}
      {acVisible && acItems.length > 0 && (
        <div
          className="eyc-ac-container"
          style={{ left: acPos.left, top: acPos.top }}
          onMouseDown={e => e.preventDefault()}
        >
          <div className="eyc-ac-popup" ref={acListRef}>
            {acItems.map((item, i) => (
              <div
                key={`${item.cmd.name}_${i}`}
                className={`eyc-ac-item ${i === acIndex ? 'eyc-ac-item-active' : ''}${item.isMore ? ' eyc-ac-item-more' : ''}`}
                onMouseEnter={() => setAcIndex(i)}
                onClick={() => {
                  if (item.isMore) return
                  applyCompletion(item)
                }}
                onDoubleClick={() => {
                  if (item.isMore) expandMoreCompletion(i)
                }}
              >
                <span className={`eyc-ac-icon ${item.isMore ? 'eyc-ac-icon-flow' : getCmdIconClass(item.cmd.category)}`}>
                  {item.isMore
                    ? '…'
                    : item.cmd.category.includes('资源')
                      ? <Icon name="resource-view" size={14} />
                    : item.cmd.category.includes('子程序')
                      ? <Icon name="method" size={14} />
                    : item.cmd.category.includes('常量')
                      ? <Icon name="constant" size={14} />
                    : item.cmd.category.includes('全局变量')
                      ? <Icon name="field" size={14} />
                      : item.cmd.category.toLowerCase().includes('dll')
                        ? <Icon name="dll-command" size={14} />
                      : getCmdIconLabel(item.cmd.category)}
                </span>
                <span className="eyc-ac-name">
                  {item.isMore
                    ? `...（双击显示剩余 ${item.remainCount || 0} 项）`
                    : `${item.cmd.name}${item.engMatch && item.cmd.englishName ? `（${item.cmd.englishName}）` : ''}`}
                </span>
                {!item.isMore && (item.cmd.category.includes('常量') || item.cmd.category.includes('资源')) && item.cmd.libraryName && (
                  <span className="eyc-ac-source">{item.cmd.libraryName}</span>
                )}
                {!item.isMore && item.cmd.returnType && <span className="eyc-ac-return">{item.cmd.returnType}</span>}
              </div>
            ))}
          </div>
          {acItems[acIndex] && (() => {
            const selectedItem = acItems[acIndex]
            if (selectedItem.isMore) {
              return (
                <div className="eyc-ac-detail">
                  <div className="eyc-ac-detail-desc">双击列表最后一项“...”可展开显示剩余匹配项。</div>
                </div>
              )
            }
            const ci = selectedItem.cmd
            const paramSig = ci.params.length > 0
              ? ci.params.map(p => {
                  let s = ''
                  if (p.optional) s += '［'
                  s += p.type
                  if (p.isArray) s += '数组'
                  s += ' ' + p.name
                  if (p.optional) s += '］'
                  return s
                }).join('，')
              : ''
            const retLabel = ci.returnType ? `〈${ci.returnType}〉` : '〈无返回值〉'
            const source = [ci.libraryName, ci.category].filter(Boolean).join('->')
            return (
              <div className="eyc-ac-detail">
                <div className="eyc-ac-detail-call">
                  <span className="eyc-ac-detail-label">调用格式：</span>
                  {retLabel} {ci.name} （{paramSig}）{source && <> - {source}</>}
                </div>
                {ci.englishName && (
                  <div className="eyc-ac-detail-eng">
                    <span className="eyc-ac-detail-label">英文名称：</span>{ci.englishName}
                  </div>
                )}
                {ci.description && (
                  <div className="eyc-ac-detail-desc">{ci.description}</div>
                )}
                {ci.params.length > 0 && (
                  <div className="eyc-ac-detail-params">
                    {ci.params.map((p, pi) => (
                      <div key={pi} className="eyc-ac-detail-param">
                        <span className="eyc-ac-detail-param-head">
                          参数&lt;{pi + 1}&gt;的名称为"{p.name}"，类型为"{p.type}{p.isArray ? '(数组)' : ''}{p.isVariable ? '(参考)' : ''}"{p.optional ? '，可以被省略' : ''}。
                        </span>
                        {p.description && <span className="eyc-ac-detail-param-desc">{p.description}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
})

export default EycTableEditor
