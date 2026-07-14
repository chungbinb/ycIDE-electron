import { Fragment, memo, useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react'
import { flushSync } from 'react-dom'
import { eycToYiFormat, sanitizePastedTextForCurrent, extractAssemblyVarLinesFromPasted, extractRoutedDeclarationLinesFromPasted } from './eycFormat'
import {
  inferResourceTypeByFileName,
  parseLines,
  splitCSV,
  unquote,
} from './eycBlocks'
import { getBlocksFlowModelCached } from './editorBlocksModelShared'
import {
  FLOW_AUTO_COMPLETE,
  FLOW_AUTO_TAG,
  FLOW_END_KW,
  FLOW_KW,
  FLOW_LOOP_KW,
  FLOW_START,
  appendMissingFlowEnds,
  computeFlowLines,
  extractFlowKw,
  getFlowStructureAround,
} from './eycFlow'
import type { FlowSegment } from './eycFlow'
import type { RenderBlock } from './eycTableModel'
import type { LibWindowUnit } from './VisualDesigner'
import Icon from '../Icon/Icon'
import '../Icon/Icon.css'
import './EycTableEditor.css'
import EycResourcePreview from './EycResourcePreview'
import { resolveFlowLineColors } from './flowLineTheme'
import { useCodeLineEditor, type CodeLineNavigationAction, type EmptyCodeLineDeleteAction, type ParenScopedKeyAction } from './useCodeLineEditor'
import {
  balanceArgParens,
  insertCallArgAfter,
  removeCallArgs,
  isArgParensBalanced,
  isQuotedTextLiteral,
  parseAssignmentDetail,
  parseAssignmentLineParts,
  parseCallArgs,
  replaceCallArg,
} from './editorTextUtils'
import {
  dispatchCtrlShortcutWithHistory,
  handleCompletionPopupKey,
  handleTypeCellSpaceGuard,
  dispatchMainEditingKey,
  dispatchPreKeyGuards,
} from './editorKeyboardDispatch'
import {
  applyScopedVariableRename,
  getTableRowInsertTemplate,
} from './editorTableRowUtils'
import {
  applyFlowMarkerSection,
  applyMainAndExtraLines,
  buildLoopFlowBodyLines,
  collectRemainingLinesInCurrentScope,
  getAutoExpandCursorBaseLine,
  removeDuplicateFlowAutoEndings,
  trimTrailingEmptyFormattedLine,
} from './editorFlowAutoExpandUtils'
import {
  renderFlowContinuationLine,
  renderFlowSegsLine,
} from './editorFlowRenderUtils'
import { buildMultiLinePasteResult, relocateMisplacedLocalVarLines } from './editorPasteUtils'
import { useEditorInteractionHandlers } from './useEditorInteractionHandlers'
import {
  getCmdIconClass,
  getCmdIconLabel,
  getOuterParenRange,
} from './editorCommandDisplayUtils'
import { readFlowLineConfigFromCss } from './editorFlowLineConfig'
import {
  AC_PAGE_SIZE,
  BUILTIN_LITERAL_COMPLETION_ITEMS,
  BUILTIN_TYPE_ITEMS,
  LOGIC_OPERATOR_ALIASES,
  MEMBER_DELIMITER_REGEX,
  clampNumber,
  colorize,
  formatOps,
  getMissingAssignmentRhsTarget,
  isKnownAssignmentTarget,
  isValidVariableLikeName,
  normalizeMemberTypeName,
  rebuildLineField,
  rebuildLineFlagField,
  splitDebugRenderableText,
} from './editorCoreUtils'
import type { CompletionItem, CompletionParam } from './editorCoreUtils'
import { buildCompletionCatalog } from './editorCompletionCatalogUtils'
import {
  buildCompletionMatches,
  computeCompletionPopupPosition,
  paginateCompletionDisplayItems,
  type AcDisplayItem,
} from './editorCompletionDisplayUtils'
import {
  selectCompletionSourceList,
} from './editorCompletionSourceUtils'
import {
  isCursorInsideQuotedText,
  resolveCompletionWordContext,
} from './editorCompletionInputUtils'
import { useEditorDiagnosticsProblems } from './editorDiagnostics'
import { buildControlPropTypes, type DiagCommandSignature } from './editorDiagnosticsShared'
import { useEditorBlocksModel } from './editorBlocksModel'

// ========== 组件 ==========

export interface EycTableEditorHandle {
  insertSubroutine: () => void
  insertLocalVariable: () => void
  insertConstant: () => void
  navigateOrCreateSub: (subName: string, params: Array<{ name: string; dataType: string; isByRef: boolean }>) => void
  navigateToLine: (line: number) => void
  navigateToSubprogram: (subName: string, fallbackLine?: number) => void
  getVisibleLineForSourceLine: (line: number) => number
  editorAction: (action: string) => void
}

interface EycTableEditorProps {
  value: string
  docLanguage?: string
  editorFontFamily?: string
  editorFontSize?: number
  editorLineHeight?: number
  freezeSubTableHeader?: boolean
  showMinimapPreview?: boolean
  projectDir?: string
  targetPlatform?: string
  isClassModule?: boolean
  projectGlobalVars?: Array<{ name: string; type: string }>
  windowControlNames?: string[]
  windowControlTypes?: Array<{ name: string; type: string; properties?: Record<string, string | number | boolean> }>
  // 项目内所有窗口的控件+子程序（供跨窗口成员补全：在本窗口代码里引用另一窗口名）
  projectWindows?: Array<{ name: string; controls: Array<{ name: string; type: string; properties?: Record<string, string | number | boolean> }>; subs: string[] }>
  windowUnits?: LibWindowUnit[]
  projectConstants?: Array<{ name: string; value: string; kind?: 'constant' | 'resource' }>
  projectDllCommands?: Array<{ name: string; returnType: string; description: string; params: CompletionParam[]; isIndirect?: boolean }>
  projectDataTypes?: Array<{ name: string; fields: Array<{ name: string; type: string }> }>
  projectClassNames?: Array<{ name: string; methods?: Array<{ name: string; returnType: string; description: string; params: Array<{ name: string; type: string }> }> }>
  onClassNameRename?: (oldName: string, newName: string) => void
  onChange: (value: string) => void
  // 全局撤销/重做：编辑器区域内按 Ctrl+Z / Ctrl+Y 时上抛给外层统一的全局撤销栈处理（不再各自维护）
  onGlobalUndo?: () => void
  onGlobalRedo?: () => void
  onCommandClick?: (commandName: string, paramIndex?: number) => void
  onCommandClear?: () => void
  onProblemsChange?: (problems: FileProblem[]) => void
  onCursorChange?: (line: number, column: number, sourceLine?: number) => void
  onRouteDeclarationPaste?: (routes: Array<{ language: 'ell' | 'egv' | 'ecs' | 'edt'; lines: string[] }>) => void
  breakpointLines?: number[]
  debugSourceLine?: number
  debugVariables?: Array<{ name: string; type: string; value: string }>
  diffHighlightLines?: Set<number>
  diffAddedLines?: Set<number>
  diffEditedLines?: Set<number>
  diffDeletedAfterLines?: Set<number>
  // 锚点行 → 被删除的原文（红色删除占位行内展示被删内容）
  diffDeletedTextAfterLines?: Map<number, string>
  // 右侧变量汇总面板总开关（系统设置），关闭时连收起细条也不渲染
  showVarSummaryPanel?: boolean
}

export interface FileProblem {
  line: number
  column: number
  message: string
  severity: 'error' | 'warning'
}

/** 可勾切换格（公开/静态/传址/参考/可空/数组）的 cellIndex 集合——与 tryToggleTableBooleanCell 的判定一一对应 */
function getBooleanToggleCellIndexes(lineType: string, tableType?: string): Set<number> {
  switch (lineType) {
    case 'dll': return new Set([2])
    case 'ptrCmd': return new Set([2])
    case 'sub': return new Set([2])
    case 'localVar': return new Set([2])
    case 'globalVar': return new Set([3])
    case 'dataTypeMember': return new Set([2])
    case 'subParam':
      return (tableType === 'dll' || tableType === 'ptrcmd') ? new Set([2, 3]) : new Set([2, 3, 4])
    default: return new Set()
  }
}

interface EditState {
  lineIndex: number
  cellIndex: number
  fieldIdx: number    // -1 表示无字段映射（代码行编辑整行）
  sliceField: boolean
  isVirtual?: boolean // 虚拟代码行（编辑时插入而非替换）
  booleanCell?: boolean // 打勾格（公开/静态/传址…）键盘焦点态：无输入框，空格切换、方向键导航
  paramIdx?: number   // 展开参数编辑：第几个参数 (0-based)
  exprPath?: number[] // 嵌套表达式行编辑：从顶层参数值出发的子节点路径（加法拆分 0/1 或子命令参数序号）
}

// ===== 右侧变量汇总面板 =====
interface VarSummaryItem {
  name: string
  typeName: string
  arrayText: string   // 数组说明（如"数组[601]"），非数组为空串
  lineIndex: number
  isParam?: boolean   // 子程序参数（与局部变量同组展示时标注）
}

interface VarSummaryGroup {
  key: string
  title: string
  items: VarSummaryItem[]  // 已按搜索词过滤
  total: number            // 过滤前总数
  isCurrentSub?: boolean   // 光标所在子程序的组（高亮）
}

// 变量类型 → 图标配色类别（图标字符取类型名首字）
const VAR_TYPE_ICON_CLASS: Record<string, string> = {
  '整数型': 'int', '长整数型': 'int', '短整数型': 'int', '字节型': 'int',
  '逻辑型': 'bool', '文本型': 'text', '字节集': 'bin',
  '小数型': 'float', '双精度小数型': 'float', '日期时间型': 'date',
  '子程序指针': 'ptr', '变体型': 'variant',
}

function varTypeIconOf(typeName: string): { char: string; cls: string } {
  const t = (typeName || '').trim()
  return { char: t.charAt(0) || '变', cls: VAR_TYPE_ICON_CLASS[t] || 'custom' }
}

interface ExprExpandItem {
  name: string
  value: string
  commandName?: string
  commandParamIndex?: number
  children?: ExprExpandItem[]
}

const setCssVars = (element: HTMLElement | null, vars: Record<string, string>): void => {
  if (!element) return
  for (const [name, value] of Object.entries(vars)) {
    element.style.setProperty(name, value)
  }
}

const TABLE_MODE_HIDDEN_FLOW_COMMANDS = new Set(['否则', '如果结束', '默认', '判断结束', '如果真结束'])

// 复制/剪切时过滤选区：范围拖选（rangeSet 填满整个 index 区间）会把区间内**表格模式隐藏的配对标记**
//（否则/默认/如果结束/判断结束/如果真结束）一并纳进选区。若某隐藏标记所属结构的**头**（如果/判断开始/
// 循环首 等）不在选区里，说明用户只是选了中间可见的正文、并没打算连隐藏标记一起剪切/复制（表格模式里
// 它们本就看不见），故从剪贴板文本里剔除，避免粘贴出孤立的「否则/如果结束」（用户报的剪切内容多出配对标记）。
// 头也在选区=整体复制该结构，则保留标记（粘贴可完整重建）。
function filterClipboardSelectionIndices(ls: string[], sortedIndices: number[]): number[] {
  const sel = new Set(sortedIndices)
  const blocks: RenderBlock[] = ls.map((codeLine, idx) => ({ kind: 'codeline', rows: [], codeLine, lineIndex: idx } as RenderBlock))
  const { map } = computeFlowLines(blocks)
  return sortedIndices.filter((i) => {
    if (i < 0 || i >= ls.length) return false
    const kw = extractFlowKw(ls[i] || '')
    if (!kw || !TABLE_MODE_HIDDEN_FLOW_COMMANDS.has(kw)) return true // 非隐藏标记（含可见正文/命令头）：保留
    const segs = map.get(i) || []
    const depth = segs.length ? Math.max(...segs.map((s) => s.depth)) : 0
    // 向上找该隐藏标记所属结构的头（同深度、有 start 但非 branch，跳过既 start 又 branch 的判断 case）
    for (let j = i; j >= 0; j--) {
      const sj = map.get(j) || []
      if (sj.some((s) => s.depth === depth && s.type === 'start') && !sj.some((s) => s.depth === depth && s.type === 'branch')) {
        return sel.has(j) // 头在选区→保留（整体复制）；头不在→剔除（只是顺带被范围填充选中）
      }
    }
    return false // 找不到头（孤立标记）→ 剔除
  })
}

// 删除/剪切后修复：若某流程段被删空——「开启标记(head/branch，如 如果/否则/判断开始/默认)」紧跟着
// 同深度的「闭合标记(branch/end，如 否则/如果结束/判断结束)」、中间没有任何 body——就补一条空 body 行。
// 场景：某段 body 只有一行正文（如 如果体里只有「调试输出」，没有额外空行），剪切掉那行正文后该段就
// 空瘪成「如果紧贴否则」；用户要的是留一条空行占位好继续输入。protectMinimalFlowInPartialSelection 只能
// 保护「已存在的空 body」，救不了「body 全是正文」的情况，故这里在删除后再统一补空 body 兜底。
// 顺带修复「空的如果体在表格模式显示塌行」——只要段内始终有一条空 body 行，表格就正常显示可点入。
function ensureMinimalFlowBodies(lines: string[]): string[] {
  const blocks: RenderBlock[] = lines.map((codeLine, idx) => ({ kind: 'codeline', rows: [], codeLine, lineIndex: idx } as RenderBlock))
  const { map } = computeFlowLines(blocks)
  const isCloserAtDepth = (idx: number, d: number): boolean =>
    (map.get(idx) || []).some((s) => s.depth === d && (s.type === 'branch' || s.type === 'end'))
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i])
    const segs = map.get(i) || []
    // (a) 空瘪段：开启标记(head/branch)紧跟同深度闭合标记(branch/end)、段内无 body → 补一条空行占位
    const opener = segs.find((s) => s.type === 'start' || s.type === 'branch')
    if (opener && i + 1 < lines.length && isCloserAtDepth(i + 1, opener.depth)) {
      out.push('')
    }
    // (b) 顶层结构结束(depth-0 的 end)正好落在子程序末尾——到文件尾，或紧跟下一个 .子程序/.程序集——
    //     补一条尾部普通空行，好在结构**外面**接着写命令；否则结构后没有空行分隔，光标/新命令会落进流程体内。
    //     （后面已是空行或还有其它内容时不补：只兜"结构正好在子程序尾部、外面无处可写"这一种。）
    if (segs.some((s) => s.type === 'end' && s.depth === 0)) {
      const nextTrim = i + 1 < lines.length ? (lines[i + 1] || '').trim() : null
      if (nextTrim === null || nextTrim.startsWith('.子程序') || nextTrim.startsWith('.程序集')) {
        out.push('')
      }
    }
  }
  return out
}

const EycTableEditor = forwardRef<EycTableEditorHandle, EycTableEditorProps>(function EycTableEditor({ value, docLanguage = '', editorFontFamily = '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace', editorFontSize = 14, editorLineHeight = 20, freezeSubTableHeader = false, showMinimapPreview = true, projectDir, targetPlatform = 'windows', isClassModule = false, projectGlobalVars = [], windowControlNames = [], windowControlTypes = [], projectWindows = [], windowUnits = [], projectConstants = [], projectDllCommands = [], projectDataTypes = [], projectClassNames = [], onClassNameRename, onChange, onGlobalUndo, onGlobalRedo, onCommandClick, onCommandClear, onProblemsChange, onCursorChange, onRouteDeclarationPaste, breakpointLines = [], debugSourceLine, debugVariables = [], diffHighlightLines, diffAddedLines = new Set<number>(), diffEditedLines = new Set<number>(), diffDeletedAfterLines = new Set<number>(), diffDeletedTextAfterLines, showVarSummaryPanel = true }, ref) {
  const eycScale = useMemo(() => clampNumber(editorFontSize / 13, 0.75, 2), [editorFontSize])
  const [editCell, setEditCell] = useState<EditState | null>(null)
  const [editVal, setEditVal] = useState('')
  const editorRootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // onChange 归一化改写输入值（如 “”→"）后，受控 input 会把光标重置到末尾；
  // 记录期望光标位，由 layout effect 在 DOM 提交后同步恢复，避免下一个按键落到行尾。
  const pendingInputCaretRef = useRef<number | null>(null)
  const paramInputRef = useRef<HTMLInputElement>(null)
  const prevRef = useRef(value)
  const [currentText, setCurrentText] = useState(value)

  // 归一化改写 editVal 后同步恢复光标（必须在浏览器处理下一个输入事件前完成，故用 layout effect）
  useLayoutEffect(() => {
    const pos = pendingInputCaretRef.current
    if (pos === null) return
    pendingInputCaretRef.current = null
    const input = inputRef.current
    if (input) input.setSelectionRange(pos, pos)
  }, [editVal])

  const lastFocusedLine = useRef<number>(-1)
  const subNavSeqRef = useRef(0) // 子程序跳转序列号：仅允许最后一次跳转生效，避免多重定时导致抖动
  const flowMarkRef = useRef<string>('')
  const flowIndentRef = useRef<string>('')
  const userVarNamesRef = useRef<Set<string>>(new Set())
  const userSubNamesRef = useRef<Set<string>>(new Set())
  const wasFlowStartRef = useRef(false) // 编辑行是否为流程起始行（用于防止流程命令缩进翻倍）
  const wasFlowKwRef = useRef<string>('') // 编辑行原始流程关键字（如果/如果真/判断/循环...），用于在删除流程命令时溶解流程块
  const wasFlowOrigIndentRef = useRef<string>('') // 编辑流程起始行的"真实"前导空格（flowIndent 在回退路径下可能虚撑，需要真值用于熔解）
  const commitGuardRef = useRef(false) // 防止 commit 被重复调用（mousedown + blur-on-unmount）
  const suppressBlurCommitUntilRef = useRef(0) // 键盘切行时临时屏蔽 blur->commit，避免编辑态被抢占清空
  const preserveEditOnScrollbarRef = useRef(false) // 拖动滚动条时保留编辑态，避免 blur 提交
  const editCellOrigValRef = useRef<string>('') // 表格单元格编辑前的原始值（liveUpdate 会实时更新 lines，需保存原始值用于重命名比较）
  const codeLineEditOrigValRef = useRef<string>('') // 代码行编辑初始值，用于无改动时跳过重排
  const editOrigRawLineRef = useRef<string>('') // 代码行编辑前的整行原始文本，编辑期间供流程模型使用（避免正在键入/删除的流程命令实时改流程线）
  const liveUpdateTimerRef = useRef<number | null>(null)
  const pendingLiveUpdateValRef = useRef<string | null>(null)
  const [expandedLines, setExpandedLines] = useState<Set<number>>(new Set())
  const [expandedAssignRhsParamLines, setExpandedAssignRhsParamLines] = useState<Set<number>>(new Set())
  // 参数行的嵌套表达式子树展开状态（手动 +/- 控制），键为 `${lineIndex}:${paramIdx}`
  const [expandedParamExprKeys, setExpandedParamExprKeys] = useState<Set<string>>(new Set())
  const isResourceTableDoc = docLanguage === 'erc'
  const shouldAliasJudgeStartInTableMode = docLanguage === 'eyc' && !isClassModule
  const shouldFreezeTableHeader = freezeSubTableHeader
    && docLanguage === 'eyc'
    && !isClassModule
    && currentText.split('\n').length <= 1200
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
  const [debugHover, setDebugHover] = useState<{ x: number; y: number; variable: { name: string; type: string; value: string } } | null>(null)
  const [themeRevision, setThemeRevision] = useState(0)
  const [diagnosticsText, setDiagnosticsText] = useState(value)
  const [diagnosticsErrorLines, setDiagnosticsErrorLines] = useState<number[]>([])
  const breakpointLineSet = useMemo(() => new Set(breakpointLines), [breakpointLines])
  const flowLineModeConfig = useMemo(() => readFlowLineConfigFromCss(), [themeRevision])
  const debugVariableMap = useMemo(() => {
    const map = new Map<string, { name: string; type: string; value: string }>()
    for (const variable of debugVariables) map.set(variable.name, variable)
    return map
  }, [debugVariables])

  const renderDebugAwareSpan = useCallback((text: string, className: string, keyPrefix: string) => {
    const parts = splitDebugRenderableText(text)
    return parts.map((part, index) => {
      const variable = part.token ? debugVariableMap.get(part.token) : undefined
      if (!variable) {
        return <span key={`${keyPrefix}-${index}`} className={className}>{part.text}</span>
      }
      return (
        <span
          key={`${keyPrefix}-${index}`}
          className={`${className} eyc-debug-hoverable`}
          onMouseEnter={(e) => setDebugHover({ x: e.clientX + 12, y: e.clientY + 12, variable })}
          onMouseMove={(e) => setDebugHover({ x: e.clientX + 12, y: e.clientY + 12, variable })}
          onMouseLeave={() => setDebugHover(current => (current?.variable.name === variable.name ? null : current))}
        >{part.text}</span>
      )
    })
  }, [debugVariableMap])

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setThemeRevision(prev => prev + 1)
    })
    observer.observe(root, { attributes: true, attributeFilter: ['style'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!editCell) {
      setDiagnosticsText(currentText)
      return
    }
    const timer = window.setTimeout(() => {
      setDiagnosticsText(currentText)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [currentText, editCell])

  // ===== 行选择状态 =====
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set())
  // 粘贴入口经 ref 取最新选区（覆盖粘贴语义），避免把选区塞进各粘贴回调的依赖
  const selectedLinesRef = useRef(selectedLines)
  useEffect(() => { selectedLinesRef.current = selectedLines }, [selectedLines])
  // ===== 展开参数行多选状态（Ctrl/Shift 点选 → Delete 删除，与行选择互斥）=====
  const [selectedParamRows, setSelectedParamRows] = useState<{ lineIndex: number; argIdxs: Set<number> } | null>(null)
  const paramSelAnchorRef = useRef<number | null>(null)  // 上次点选的 argIdx，供 Shift 连选
  // 展开参数行「按住左键拖动跨行多选」：mousedown 记锚点，mousemove 过阈值转拖选、按 argIdx 连选
  const paramDragRef = useRef<{ lineIndex: number; anchorArg: number; startX: number; startY: number; active: boolean } | null>(null)
  const suppressParamClickRef = useRef(false)  // 拖选刚结束时吞掉随后的 click，避免误进入编辑

  // 悬停命令说明窗（照易语言）：鼠标停在命令名上稍候弹出签名+解释的浮动提示
  const [cmdHoverTip, setCmdHoverTip] = useState<{ cmd: CompletionItem; x: number; y: number } | null>(null)
  const cmdHoverTimerRef = useRef<number | null>(null)
  const clearCmdHoverTip = useCallback(() => {
    if (cmdHoverTimerRef.current !== null) {
      window.clearTimeout(cmdHoverTimerRef.current)
      cmdHoverTimerRef.current = null
    }
    setCmdHoverTip(prev => (prev ? null : prev))
  }, [])
  const resolveHoverCommand = useCallback((spanText: string, isMember: boolean): CompletionItem | null => {
    const raw = (spanText || '').trim()
    if (!raw) return null
    if (isMember) {
      const tail = raw.split(/[.．。]/).pop() || ''
      return memberCommandsRef.current.find(c => c.name === tail) || null
    }
    return allCommandsRef.current.find(c => c.name === raw)
      || dllCompletionItemsRef.current.find(c => c.name === raw)
      || null
  }, [])
  const scheduleCmdHoverTip = useCallback((e: React.MouseEvent, spanText: string, isMember: boolean) => {
    const target = e.currentTarget as HTMLElement
    if (cmdHoverTimerRef.current !== null) window.clearTimeout(cmdHoverTimerRef.current)
    cmdHoverTimerRef.current = window.setTimeout(() => {
      cmdHoverTimerRef.current = null
      const cmd = resolveHoverCommand(spanText, isMember)
      if (!cmd) return
      // 延时到点时目标 span 可能已被重渲染/卸载（乐观编辑把代码行换成输入框、滚动虚拟化等）：
      // 此时 getBoundingClientRect() 全为 0，会把提示弹到 IDE 左上角(0,0)。脱离 DOM 或零尺寸则不弹。
      if (!target.isConnected) return
      const rect = target.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return
      setCmdHoverTip({ cmd, x: rect.left, y: rect.bottom + 4 })
    }, 420)
  }, [resolveHoverCommand])
  // 命令悬停提示是纯信息弹窗：任何点击/按键/滚动都关掉它。仅靠 span 的 onMouseLeave 不够——
  // 点击触发乐观编辑会把 span 换成输入框、mouseLeave 不触发，弹窗会卡住不消失。
  useEffect(() => {
    if (!cmdHoverTip) return
    const dismiss = (): void => clearCmdHoverTip()
    window.addEventListener('mousedown', dismiss, true)
    window.addEventListener('keydown', dismiss, true)
    window.addEventListener('wheel', dismiss, { passive: true, capture: true })
    return () => {
      window.removeEventListener('mousedown', dismiss, true)
      window.removeEventListener('keydown', dismiss, true)
      window.removeEventListener('wheel', dismiss, true)
    }
  }, [cmdHoverTip, clearCmdHoverTip])
  const [editorContextMenu, setEditorContextMenu] = useState<{ x: number; y: number; lineIndex: number | null } | null>(null)
  const [contextMenuCanPaste, setContextMenuCanPaste] = useState(false)
  const dragAnchor = useRef<number | null>(null)  // 拖选起点行号
  // 打勾格键盘态从 window keydown 接管按键：经 ref 调用，避免把大函数塞进监听 effect 依赖
  const applyArrowNavigationKeyRef = useRef<((params: { key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'; cursorPos: number }) => { handled: boolean; preventDefault: boolean }) | null>(null)
  const tryToggleTableBooleanCellRef = useRef<((tableType: string | undefined, lineIndex: number, cellIndex: number) => boolean) | null>(null)
  // 未知标识符回车 → 「插入变量」提示框：{ 名称, 所在行 }
  const [insertVarPrompt, setInsertVarPrompt] = useState<{ name: string; anchorLine: number } | null>(null)
  useEffect(() => {
    if (!insertVarPrompt) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); setInsertVarPrompt(null) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [insertVarPrompt])
  const isDragging = useRef(false)
  const dragStartPos = useRef<{ x: number; y: number } | null>(null)
  const wasDragSelect = useRef(false)
  const pendingInputDragRef = useRef<{ lineIndex: number; x: number; y: number; allowRowDrag: boolean } | null>(null)
  // 起始于代码行内容区的拖动手势：未跨行时按"行内文本选择"处理（与已聚焦行内拖选行为一致）
  // isVirtual 保留原始值（普通行为 undefined），与 blk.isVirtual 的全等比较才能匹配
  const lineTextDragCandidateRef = useRef<{ lineIndex: number; isVirtual?: boolean } | null>(null)
  // 行内文本拖选已激活（编辑态已进入），记录锚点 X 用于拖动过程中实时更新选择范围
  const lineTextSelectDragRef = useRef<{ anchorX: number } | null>(null)
  // 指向"进入行编辑态并按拖动范围选中文本"的最新实现（startEditLine 定义在后，需经 ref 转发给 mouseup 监听）
  const beginLineTextSelectRef = useRef<(li: number, isVirtual: boolean | undefined, anchorX: number, headX: number) => void>(() => {})
  // mousedown 乐观进入行编辑态的实现（同样经 ref 转发解决 startEditLine 定义顺序）
  const startEditLineOnMouseDownRef = useRef<(li: number, isVirtual: boolean | undefined, clientX: number, target: EventTarget | null) => void>(() => {})
  // mousedown 已乐观进入编辑的行号，click 阶段据此跳过重复 startEditLine
  const optimisticLineEditRef = useRef<number | null>(null)

  useEffect(() => {
    if (!editorContextMenu) return
    const close = (): void => setEditorContextMenu(null)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [editorContextMenu])

  useEffect(() => {
    if (!editorContextMenu) {
      setContextMenuCanPaste(false)
      return
    }
    let cancelled = false
    setContextMenuCanPaste(false)
    void navigator.clipboard.readText()
      .then((text) => {
        if (cancelled) return
        setContextMenuCanPaste((text || '').length > 0)
      })
      .catch(() => {
        if (cancelled) return
        setContextMenuCanPaste(false)
      })
    return () => {
      cancelled = true
    }
  }, [editorContextMenu])

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
      if (parsed.type === 'ptrCmd' && cellIndex === 2) {
        return rebuildLineField(rawLine, 2, (parsed.fields[2] || '').trim() === '公开' ? '' : '公开', false)
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
        if (tableType === 'dll' || tableType === 'ptrcmd') {
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
  tryToggleTableBooleanCellRef.current = tryToggleTableBooleanCell

  // ===== 行选择：拖选逻辑 =====
  // 从行号到实际元素的映射（用于鼠标位置判定）
  const wrapperRef = useRef<HTMLDivElement>(null)
  const tableShellRef = useRef<HTMLDivElement>(null)
  const minimapTrackRef = useRef<HTMLDivElement>(null)
  const minimapContentRef = useRef<HTMLDivElement>(null)
  const minimapViewportRef = useRef<HTMLDivElement>(null)
  const minimapViewportRafRef = useRef<number | null>(null)
  const visibleLineWindowRafRef = useRef<number | null>(null)
  const stickyScopeRafRef = useRef<number | null>(null)
  const stickyScopeRowRef = useRef<HTMLDivElement>(null)
  const stickyStartTopByLineRef = useRef<Map<number, number>>(new Map())
  const blocksRef = useRef<RenderBlock[]>([])
  const subTableMetaRef = useRef<Array<{
    startLine: number
    nextStartLine: number | null
    colCount: number
    rows: Array<{
      lineIndex: number
      isHeader: boolean
      cells: Array<{ text: string; cls: string; colSpan?: number; align?: string; fieldIdx?: number; sliceField?: boolean }>
    }>
  }>>([])
  const [stickySubTable, setStickySubTable] = useState<{
    lineIndex: number
    nextStartLine: number | null
    colCount: number
    rows: Array<{
      lineIndex: number
      isHeader: boolean
      cells: Array<{ text: string; cls: string; colSpan?: number; align?: string; fieldIdx?: number; sliceField?: boolean }>
    }>
  } | null>(null)
  const [stickyPushOffsetPx, setStickyPushOffsetPx] = useState(0)
  const [scrollbarLaneHeightPx, setScrollbarLaneHeightPx] = useState(0)
  const minimapMetricsRef = useRef({
    topRatio: -1,
    heightRatio: -1,
    scrollbarWidth: -1,
    scrollbarHeight: -1,
    laneHeight: -1,
    contentOffsetPx: -1,
  })
  const minimapWidthPx = useMemo(() => {
    const base = (editorFontSize / 14) * 75
    return Math.max(52, Math.round(base))
  }, [editorFontSize])
  const logicalLineCount = useMemo(() => currentText.split('\n').length, [currentText])
  const shouldShowMinimapPreview = showMinimapPreview && logicalLineCount <= 600
  const [visibleLineWindow, setVisibleLineWindow] = useState<{ startLine: number; endLine: number }>({
    startLine: 0,
    endLine: Math.max(logicalLineCount - 1, 0),
  })

  useEffect(() => {
    const root = editorRootRef.current
    if (!root) return
    root.style.setProperty('--editor-font-family', editorFontFamily)
    root.style.setProperty('--editor-font-size', `${editorFontSize}px`)
    root.style.setProperty('--editor-line-height', `${editorLineHeight}px`)
    root.style.setProperty('--eyc-scale', `${eycScale}`)
    root.style.setProperty('zoom', `${eycScale}`)
  }, [editorFontFamily, editorFontSize, editorLineHeight, eycScale])

  useEffect(() => {
    tableShellRef.current?.style.setProperty('--eyc-minimap-width', `${shouldShowMinimapPreview ? minimapWidthPx : 0}px`)
  }, [minimapWidthPx, shouldShowMinimapPreview])

  // 抑制编辑器内的原生文本选择。代码编辑走 <input>、行多选走 selectedLines（CSS 类）、
  // 变量面板/预览缩略图走点击，均不需要原生 document 选择；放任它会在按住/拖动鼠标时
  // 于变量汇总面板与预览缩略图边界渲染出一条蓝色竖条（浏览器默认 ::selection 高亮，
  // 本项目未定义 ::selection 故为系统蓝）。只放行 input/textarea 内的原生选择
  // （行内文本选择、变量搜索框），其余一律 preventDefault。
  useEffect(() => {
    const root = editorRootRef.current
    if (!root) return
    const onSelectStart = (e: Event): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.closest?.('input, textarea'))) return
      e.preventDefault()
    }
    root.addEventListener('selectstart', onSelectStart)
    return () => root.removeEventListener('selectstart', onSelectStart)
  }, [])

  const scrollToLineIndex = useCallback((lineIndex: number, behavior: ScrollBehavior = 'smooth') => {
    if (!Number.isFinite(lineIndex) || lineIndex < 0) return
    const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${lineIndex}"]`)
    if (el) {
      el.scrollIntoView({ behavior, block: 'center' })
      return
    }
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const maxLineIndex = Math.max(currentText.split('\n').length - 1, 0)
    const targetRatio = maxLineIndex > 0 ? Math.min(Math.max(lineIndex / maxLineIndex, 0), 1) : 0
    const targetTop = targetRatio * Math.max(wrapper.scrollHeight - wrapper.clientHeight, 0)
    wrapper.scrollTo({ top: targetTop, behavior })
  }, [currentText])

  const updateMinimapViewport = useCallback(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const minimapScale = 0.24
    const scrollHeight = Math.max(wrapper.scrollHeight, 1)
    const clientHeight = Math.max(wrapper.clientHeight, 1)
    const topRatio = Math.min(Math.max(wrapper.scrollTop / scrollHeight, 0), 1)
    const heightRatio = Math.min(Math.max(clientHeight / scrollHeight, 0.08), 1)

    const viewportEl = minimapViewportRef.current
    if (viewportEl) {
      const { topRatio: prevTop, heightRatio: prevHeight } = minimapMetricsRef.current
      if (Math.abs(prevTop - topRatio) > 0.0005) {
        viewportEl.style.top = `${topRatio * 100}%`
      }
      if (Math.abs(prevHeight - heightRatio) > 0.0005) {
        viewportEl.style.height = `${heightRatio * 100}%`
      }
    }

    const scrollbarWidth = Math.max(wrapper.offsetWidth - wrapper.clientWidth, 0)
    const scrollbarHeight = Math.max(wrapper.offsetHeight - wrapper.clientHeight, 0)
    const laneHeight = Math.max(wrapper.clientHeight, 1)
    let contentOffsetPx = minimapMetricsRef.current.contentOffsetPx

    const shellEl = tableShellRef.current
    if (shellEl) {
      const { scrollbarWidth: prevWidth, scrollbarHeight: prevHeight } = minimapMetricsRef.current
      if (prevWidth !== scrollbarWidth) {
        shellEl.style.setProperty('--eyc-scrollbar-width', `${scrollbarWidth}px`)
      }
      if (prevHeight !== scrollbarHeight) {
        shellEl.style.setProperty('--eyc-scrollbar-height', `${scrollbarHeight}px`)
      }
    }

    if (Math.abs(minimapMetricsRef.current.laneHeight - laneHeight) > 0.5) {
      setScrollbarLaneHeightPx(laneHeight)
    }

    const contentEl = minimapContentRef.current
    if (contentEl) {
      const maxScrollTop = Math.max(scrollHeight - clientHeight, 0)
      const scrollRatio = maxScrollTop > 0 ? Math.min(Math.max(wrapper.scrollTop / maxScrollTop, 0), 1) : 0
      const renderedContentHeight = contentEl.scrollHeight * minimapScale
      const maxContentOffsetPx = Math.max(renderedContentHeight - wrapper.clientHeight, 0)
      const nextOffsetPx = scrollRatio * maxContentOffsetPx
      if (Math.abs(minimapMetricsRef.current.contentOffsetPx - nextOffsetPx) > 0.5) {
        contentEl.style.transform = `translate3d(0, ${-nextOffsetPx}px, 0) scale(${minimapScale})`
      }
      contentOffsetPx = nextOffsetPx
    }

    minimapMetricsRef.current = {
      topRatio,
      heightRatio,
      scrollbarWidth,
      scrollbarHeight,
      laneHeight,
      contentOffsetPx,
    }
  }, [])

  const scheduleMinimapViewportUpdate = useCallback(() => {
    if (minimapViewportRafRef.current != null) return
    minimapViewportRafRef.current = window.requestAnimationFrame(() => {
      minimapViewportRafRef.current = null
      updateMinimapViewport()
    })
  }, [updateMinimapViewport])

  const updateVisibleLineWindow = useCallback(() => {
    const wrapper = wrapperRef.current
    const maxLineIndex = Math.max(logicalLineCount - 1, 0)
    if (!wrapper || maxLineIndex <= 0) {
      setVisibleLineWindow({ startLine: 0, endLine: maxLineIndex })
      return
    }

    const scrollHeight = Math.max(wrapper.scrollHeight, 1)
    const maxScrollTop = Math.max(scrollHeight - wrapper.clientHeight, 1)
    const topRatio = Math.min(Math.max(wrapper.scrollTop / maxScrollTop, 0), 1)
    const bottomRatio = Math.min(Math.max((wrapper.scrollTop + wrapper.clientHeight) / scrollHeight, 0), 1)
    // overscan 直接决定每次重渲染的行数（点击/输入的主线程开销大头是行虚拟 DOM 构建），
    // 取视口典型高度（~40 行）的 2 倍冗余，滚动窗口更新由 rAF 驱动足以跟上。
    const overscanLines = 80
    const quantizeStep = 32
    const rawStart = Math.max(0, Math.floor(topRatio * maxLineIndex) - overscanLines)
    const rawEnd = Math.min(maxLineIndex, Math.ceil(bottomRatio * maxLineIndex) + overscanLines)
    const startLine = Math.max(0, Math.floor(rawStart / quantizeStep) * quantizeStep)
    const endLine = Math.min(maxLineIndex, Math.ceil(rawEnd / quantizeStep) * quantizeStep)

    setVisibleLineWindow(prev => {
      if (prev.startLine === startLine && prev.endLine === endLine) return prev
      return { startLine, endLine }
    })
  }, [logicalLineCount])

  const scheduleVisibleLineWindowUpdate = useCallback(() => {
    if (visibleLineWindowRafRef.current != null) return
    visibleLineWindowRafRef.current = window.requestAnimationFrame(() => {
      visibleLineWindowRafRef.current = null
      updateVisibleLineWindow()
    })
  }, [updateVisibleLineWindow])

  const jumpByMinimapClientY = useCallback((clientY: number, behavior: ScrollBehavior = 'smooth') => {
    const wrapper = wrapperRef.current
    const track = minimapTrackRef.current
    if (!wrapper || !track) return
    const rect = track.getBoundingClientRect()
    const ratio = Math.min(Math.max((clientY - rect.top) / Math.max(rect.height, 1), 0), 1)
    const targetTop = ratio * Math.max(wrapper.scrollHeight - wrapper.clientHeight, 0)
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    wrapper.scrollTo({ top: targetTop, behavior: prefersReducedMotion ? 'auto' : behavior })
    const maxLineIndex = Math.max(currentText.split('\n').length - 1, 0)
    lastFocusedLine.current = Math.round(ratio * maxLineIndex)
  }, [currentText])

  const handleMinimapMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    jumpByMinimapClientY(e.clientY, 'smooth')
    const wrapper = wrapperRef.current
    if (!wrapper) return
    try {
      wrapper.focus({ preventScroll: true })
    } catch {
      wrapper.focus()
    }
  }, [jumpByMinimapClientY])

  const handleMinimapWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    if (e.deltaY === 0 && e.deltaX === 0) return
    e.preventDefault()
    wrapper.scrollBy({ top: e.deltaY, left: e.deltaX, behavior: 'auto' })
  }, [])

  const handleMinimapKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const lineStep = Math.max(editorLineHeight, 16)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      wrapper.scrollBy({ top: lineStep, behavior: 'auto' })
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      wrapper.scrollBy({ top: -lineStep, behavior: 'auto' })
      return
    }
    if (e.key === 'PageDown') {
      e.preventDefault()
      wrapper.scrollBy({ top: wrapper.clientHeight * 0.9, behavior: 'auto' })
      return
    }
    if (e.key === 'PageUp') {
      e.preventDefault()
      wrapper.scrollBy({ top: -wrapper.clientHeight * 0.9, behavior: 'auto' })
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      scrollToLineIndex(0, 'auto')
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      scrollToLineIndex(Math.max(currentText.split('\n').length - 1, 0), 'auto')
    }
  }, [currentText, editorLineHeight, scrollToLineIndex])

  useEffect(() => {
    scheduleMinimapViewportUpdate()
    scheduleVisibleLineWindowUpdate()
  }, [scheduleMinimapViewportUpdate, scheduleVisibleLineWindowUpdate, currentText])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const onScroll = (): void => {
      scheduleMinimapViewportUpdate()
      scheduleVisibleLineWindowUpdate()
      clearCmdHoverTip()
    }
    wrapper.addEventListener('scroll', onScroll, { passive: true })
    const onResize = (): void => {
      scheduleMinimapViewportUpdate()
      scheduleVisibleLineWindowUpdate()
    }
    window.addEventListener('resize', onResize)
    let resizeObserver: ResizeObserver | null = null
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(() => {
        scheduleMinimapViewportUpdate()
        scheduleVisibleLineWindowUpdate()
      })
      resizeObserver.observe(wrapper)
    }
    return () => {
      if (minimapViewportRafRef.current != null) {
        window.cancelAnimationFrame(minimapViewportRafRef.current)
        minimapViewportRafRef.current = null
      }
      if (visibleLineWindowRafRef.current != null) {
        window.cancelAnimationFrame(visibleLineWindowRafRef.current)
        visibleLineWindowRafRef.current = null
      }
      wrapper.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      resizeObserver?.disconnect()
    }
  }, [scheduleMinimapViewportUpdate, scheduleVisibleLineWindowUpdate, clearCmdHoverTip])

  const focusWrapper = useCallback(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    try {
      wrapper.focus({ preventScroll: true })
    } catch {
      wrapper.focus()
    }
  }, [])

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

  // 删除行后：失去配对结束行的流程结构按"溶解"处理——删除其起始行与分支行、
  // 结构内部整体反缩进一层，内部完整的子结构原样保留。
  // （删掉"计次循环尾" → 循环首溶解，只留循环体内的如果/否则/如果结束等内容。）
  // 仅对"本次删除的结束关键字族"生效：文件中原本就未闭合/缩进错位的结构不受删除无关行的牵连。
  const repairBrokenFlowAfterDelete = useCallback((sourceLines: string[], deletedFlowEndKws?: Set<string>): string[] => {
    if (!deletedFlowEndKws || deletedFlowEndKws.size === 0) return sourceLines
    let lines = [...sourceLines]
    const isBoundary = (line: string): boolean => {
      const trimmed = (line || '').replace(/[\r\t]/g, '').trim()
      return trimmed.startsWith('.子程序 ') || trimmed.startsWith('.程序集 ')
    }
    const indentLenOf = (line: string): number => line.length - line.replace(/^ +/, '').length
    const outdentOneLevel = (line: string): string => {
      const lead = line.match(/^ */)?.[0] || ''
      return line.slice(Math.min(4, lead.length))
    }

    // 连删多层时可能有多个结构同时失去结束行，循环直到没有可溶解的结构。
    let changed = true
    let guard = 0
    while (changed && guard++ < 64) {
      changed = false
      for (let i = 0; i < lines.length; i++) {
        const startKw = extractFlowKw(lines[i] || '')
        if (!startKw || !FLOW_START[startKw]) continue
        const endKw = FLOW_START[startKw]
        if (!deletedFlowEndKws.has(endKw)) continue
        const pattern = FLOW_AUTO_COMPLETE[startKw] || []
        const branchKwSet = new Set(pattern.filter((kw): kw is string => !!kw && kw !== endKw))
        const baseIndentLen = indentLenOf(lines[i] || '')

        // 向下扫描：同缩进的结束行即闭合（更深层未闭合由后续轮次单独处理，不影响本层判定）。
        let closed = false
        let scanEnd = lines.length
        const branchIndexes: number[] = []
        for (let j = i + 1; j < lines.length; j++) {
          const line = lines[j] || ''
          if (isBoundary(line)) { scanEnd = j; break }
          const trimmed = line.replace(/[\r\t]/g, '').trim()
          const indentLen = indentLenOf(line)
          if (trimmed && indentLen < baseIndentLen) { scanEnd = j; break }
          const kw = extractFlowKw(line)
          if (!kw || indentLen !== baseIndentLen) continue
          if (kw === endKw) { closed = true; break }
          if (branchKwSet.has(kw)) { branchIndexes.push(j); continue }
          // 判断结构的额外分支：同缩进的 ".判断 (x)" 行
          if (kw === '判断' && (startKw === '判断开始' || startKw === '判断')) branchIndexes.push(j)
        }
        if (closed) continue

        // 溶解：删起始行与分支行，结构内部（缩进更深的行）反缩进一层。
        const deleteSet = new Set<number>([i, ...branchIndexes])
        const result: string[] = []
        for (let j = 0; j < lines.length; j++) {
          if (deleteSet.has(j)) continue
          if (j > i && j < scanEnd && indentLenOf(lines[j] || '') > baseIndentLen) {
            result.push(outdentOneLevel(lines[j]))
            continue
          }
          result.push(lines[j])
        }
        lines = result
        changed = true
        break
      }
    }

    return lines
  }, [])

  // 「判断」既是 FLOW_START（映射判断结束）又是判断块里的分支/case 关键字。删除一个作为分支的「判断」
  // 应等同普通删行（只删该分支），而非按起始行溶解整个判断块。判据：同缩进向上先遇到 判断开始/判断/默认
  //（说明它处在某判断块内）而非 判断结束/子程序边界（说明它是新结构头）。因 formatCommandLine 会把新建的
  // 「判断」自动转成「判断开始」，正常文档里裸「判断」几乎总是分支；此检查同时对畸形输入保守兜底。
  // 同缩进向上扫：先遇 判断开始/判断/默认 → 处在判断块内（分支）；先遇 判断结束/子程序边界 → 是新结构头。
  const isEnclosedJudgeBranchAt = useCallback((lines: string[], index: number, indentLen: number): boolean => {
    for (let i = index - 1; i >= 0; i--) {
      const line = lines[i] || ''
      const trimmed = line.replace(/[\r\t]/g, '').trim()
      if (trimmed.startsWith('.子程序 ') || trimmed.startsWith('.程序集 ')) return false
      const kw = extractFlowKw(line)
      if (!kw) continue
      const il = line.length - line.replace(/^ +/, '').length
      if (il !== indentLen) continue
      if (kw === '判断结束') return false
      if (kw === '判断开始' || kw === '判断' || kw === '默认') return true
    }
    return false
  }, [])

  const isEnclosedJudgeBranchLine = useCallback((lines: string[], index: number): boolean => {
    if (extractFlowKw(lines[index] || '') !== '判断') return false
    const indentLen = (lines[index]?.match(/^ */)?.[0] || '').length
    return isEnclosedJudgeBranchAt(lines, index, indentLen)
  }, [isEnclosedJudgeBranchAt])

  // 删除/清空「流程起始行」→ 溶解整个结构：删起始行、其分支行、其结束行，块内正文整体反缩进一层。
  // 必须在头还在（或已知头的位置/关键字/缩进）时做——删掉头后无法可靠反推结构上边界（会误吞头上方同缩进兄弟语句）。
  // 用于删除起始行的三条路径（右键删除/Ctrl+X/Delete）与退格删空起始行；headIndex 处即使已被清空也照删。
  const dissolveFlowStructureAtHead = useCallback((sourceLines: string[], headIndex: number, headKw: string, headIndentLen: number): string[] => {
    const endKw = FLOW_START[headKw]
    if (!endKw) return sourceLines
    const pattern = FLOW_AUTO_COMPLETE[headKw] || []
    const branchKwSet = new Set(pattern.filter((kw): kw is string => !!kw && kw !== endKw))
    const indentLenOf = (line: string): number => line.length - line.replace(/^ +/, '').length
    const outdentOneLevel = (line: string): string => line.slice(Math.min(4, (line.match(/^ */)?.[0] || '').length))

    // 注意：不能因"某行缩进 < 头缩进"就中断——退格删空起始行时 flow 编辑的 live-update
    // 会把循环体去缩进到 0（比头还浅），此时结构仍在（否则/如果结束在头缩进上），需继续扫到匹配结束/子程序边界。
    // 扫描只对"头缩进上的流程关键字"动作，普通语句一律跳过，不会误吞结构外的兄弟语句。
    const deleteSet = new Set<number>([headIndex])
    let depth = 0
    let endIndex = -1
    for (let j = headIndex + 1; j < sourceLines.length; j++) {
      const line = sourceLines[j] || ''
      const trimmed = line.replace(/[\r\t]/g, '').trim()
      if (trimmed.startsWith('.子程序 ') || trimmed.startsWith('.程序集 ')) break
      const indentLen = indentLenOf(line)
      const kw = extractFlowKw(line)
      if (!kw) continue
      if (indentLen !== headIndentLen) {
        // 单分支结构（如 如果真）的结束行被 live-update 去缩进到比头浅时也识别为结束，避免残留。
        if (indentLen < headIndentLen && depth === 0 && kw === endKw) { deleteSet.add(j); endIndex = j; break }
        continue
      }
      if (kw === headKw) { depth++; continue } // 同名嵌套起始：自平衡计数，避免匹配到内层结束
      if (kw === endKw) {
        if (depth === 0) { deleteSet.add(j); endIndex = j; break }
        depth--
        continue
      }
      if (depth === 0 && branchKwSet.has(kw)) deleteSet.add(j)
      if (depth === 0 && kw === '判断' && (headKw === '判断开始' || headKw === '判断')) deleteSet.add(j)
    }

    const upTo = endIndex >= 0 ? endIndex : sourceLines.length
    const result: string[] = []
    for (let j = 0; j < sourceLines.length; j++) {
      if (deleteSet.has(j)) continue
      if (j > headIndex && j < upTo && indentLenOf(sourceLines[j] || '') > headIndentLen) {
        result.push(outdentOneLevel(sourceLines[j]))
        continue
      }
      result.push(sourceLines[j])
    }
    return result
  }, [])

  // 多选删除时，为「起始来源集合」里每个流程起始行找出其配对的（表格模式下隐藏、常落在可见选区下方的）
  // 结束行与分支行下标——否则拖选可见行删除后，隐藏的 判断结束/如果真结束/如果结束 会残留（用户反馈"结束语句残留"）。
  // 起始来源同时包含被删行与被 sub-anchor 规则清空的行（清空即丢失起始关键字，其结束也需一并清理）。
  const collectMatchingFlowMarkers = useCallback((ls: string[], startSources: Iterable<number>): Set<number> => {
    const indentLenOf = (line: string): number => line.length - line.replace(/^ +/, '').length
    const markers = new Set<number>()
    for (const i of startSources) {
      const startKw = extractFlowKw(ls[i] || '')
      if (!startKw || !FLOW_START[startKw]) continue
      // 作为分支的「判断」不是结构头，删它不应带出整块的判断结束（其结束由块头「判断开始」负责）。
      if (startKw === '判断' && isEnclosedJudgeBranchLine(ls, i)) continue
      const endKw = FLOW_START[startKw]
      const baseIndent = indentLenOf(ls[i] || '')
      const pattern = FLOW_AUTO_COMPLETE[startKw] || []
      const branchKwSet = new Set(pattern.filter((kw): kw is string => !!kw && kw !== endKw))
      let depth = 0
      for (let j = i + 1; j < ls.length; j++) {
        const line = ls[j] || ''
        const trimmed = line.replace(/[\r\t]/g, '').trim()
        if (trimmed.startsWith('.子程序 ') || trimmed.startsWith('.程序集 ')) break
        const kw = extractFlowKw(line)
        if (!kw) continue
        if (indentLenOf(line) !== baseIndent) continue
        if (kw === startKw) { depth++; continue } // 同名嵌套：自平衡计数
        if (kw === endKw) { if (depth === 0) { markers.add(j); break } depth--; continue }
        if (depth === 0 && branchKwSet.has(kw)) markers.add(j)
        if (depth === 0 && kw === '判断' && (startKw === '判断开始' || startKw === '判断')) markers.add(j)
      }
    }
    return markers
  }, [isEnclosedJudgeBranchLine])

  // 多选删除时保护「最小结构」：仅对「有分支的多部件结构」（判断有默认、如果有否则）——若选区未包含其头
  // （即不是"完整删除整个命令"），则骨架行（判断开始/默认/否则/判断结束 start/branch/end）与每段紧跟骨架后的
  // 最小空 body 行不删，避免删残成残缺骨架。**无分支结构**（各类循环、如果真——只有首/尾无分支）不保护，
  // 让"选到尾/体"时经 repairBrokenFlowAfterDelete 正常溶解。选区含头=用户要整块删/溶解，正常删。
  const protectMinimalFlowInPartialSelection = useCallback((ls: string[], selection: Set<number>): Set<number> => {
    const blocks = ls.map((codeLine, idx) => ({ kind: 'codeline', rows: [], codeLine, lineIndex: idx } as RenderBlock))
    const { map } = computeFlowLines(blocks)
    const isSkel = (idx: number): boolean =>
      (map.get(idx) || []).some(s => s.type === 'start' || s.type === 'branch' || s.type === 'end')
    const keep = new Set<number>()
    for (const i of selection) {
      const segs = map.get(i) || []
      if (segs.length === 0) continue
      const depth = Math.max(...segs.map(s => s.depth))
      // 裸「判断」case 是额外分支、可删——它虽带 start/branch 段但不属最小结构，不保护（否则删中间 case 会卡住）。
      if (extractFlowKw(ls[i] || '') === '判断') continue
      const skel = isSkel(i)
      // 空 body 行属「最小占位」需保护的判据：它是所在段的边界空行——
      // 上紧邻任意流程标记（isSkel(i-1)，段首那条空 body），**或**下紧邻本段的分支/结束标记
      // （nextIsSectionEnd，段尾那条空 body）。补上「段尾」这条，修复：如果段 body=[调试输出, 空行]
      // 时，多选剪切「调试输出+空行」——空行的上一行是正文(调试输出)、旧判据 isSkel(i-1) 判否→空行没被
      // 保护→连同正文一起删掉→如果段变空瘪(头紧跟否则、无 body)。现按「下一行是本段结束标记」也保护，
      // 从而给该段留一条最小空 body。
      const nextIsSectionEnd = (map.get(i + 1) || []).some(s => s.depth === depth && (s.type === 'branch' || s.type === 'end'))
      const isEmptyMinimalBody = !skel && (ls[i] || '').trim() === '' && (isSkel(i - 1) || nextIsSectionEnd)
      if (!skel && !isEmptyMinimalBody) continue
      // 找「真正的结构头」：有 start 但非 branch（判断开始/如果/循环首）——必须跳过「既是 start 又是 branch」的判断 case，
      // 否则默认/结束的头会被误定位到相邻的 case；该 case 被选中时默认/结束就漏保护 → 被删、整条判断链散架。
      let headLine = -1
      for (let j = i; j >= 0; j--) {
        const sj = map.get(j) || []
        if (sj.some(s => s.depth === depth && s.type === 'start') && !sj.some(s => s.depth === depth && s.type === 'branch')) { headLine = j; break }
      }
      if (headLine < 0 || selection.has(headLine)) continue // 头在选区=要删整块，不保护
      // 只对「非循环」结构做最小保护（判断/如果/如果真——命令行回车仍能在体内加行，故删到只剩壳也保留）；
      // 循环各类（计次/判断循环/循环判断/变量）→ 选到尾/体时经 repairBrokenFlowAfterDelete 正常溶解，不保护。
      const headIsLoop = (map.get(headLine) || []).some(s => s.depth === depth && s.type === 'start' && s.flowKind === 'loop')
      if (headIsLoop) continue
      keep.add(i)
    }
    return keep
  }, [])

  // 删除行（右键删除/Ctrl+X/Delete 共用）的流程感知处理：
  // 单个「流程起始行」→ 溶解整个结构（删前定位头，删头+分支+结束+反缩进正文）；
  // 其余（含删除「结束行」）→ 补齐被删起始行的隐藏结束/分支行 + repairBrokenFlowAfterDelete（起始未闭合则溶解）。
  const applyFlowAwareDeletion = useCallback((ls: string[], deletable: Set<number>): string[] => {
    if (deletable.size === 1) {
      const only = [...deletable][0]
      const headKw = extractFlowKw(ls[only] || '')
      // 作为分支的「判断」不溶解，按普通删行处理（落到下方 repairBrokenFlowAfterDelete 分支）。
      if (headKw && FLOW_START[headKw] && !isEnclosedJudgeBranchLine(ls, only)) {
        const headIndentLen = (ls[only]?.match(/^ */)?.[0] || '').length
        return dissolveFlowStructureAtHead(ls, only, headKw, headIndentLen)
      }
    }
    const expanded = new Set<number>([...deletable, ...collectMatchingFlowMarkers(ls, deletable)])
    for (const p of protectMinimalFlowInPartialSelection(ls, deletable)) expanded.delete(p)
    const endKws = new Set<string>()
    for (const i of expanded) {
      const kw = extractFlowKw(ls[i] || '')
      if (kw && FLOW_END_KW.has(kw)) endKws.add(kw)
    }
    return ensureMinimalFlowBodies(repairBrokenFlowAfterDelete(ls.filter((_, i) => !expanded.has(i)), endKws))
  }, [dissolveFlowStructureAtHead, repairBrokenFlowAfterDelete, isEnclosedJudgeBranchLine, collectMatchingFlowMarkers, protectMinimalFlowInPartialSelection])

  // 键盘删除路径专用：仅当"单个流程起始行"时返回溶解后的整段文本，否则 null（走原有 forceBlank 删除逻辑）。
  const dissolveSingleFlowHeadIfAny = useCallback((ls: string[], deletable: Set<number>): string | null => {
    if (deletable.size !== 1) return null
    const only = [...deletable][0]
    const headKw = extractFlowKw(ls[only] || '')
    if (!headKw || !FLOW_START[headKw]) return null
    // 作为分支的「判断」不溶解，返回 null 走普通删除逻辑。
    if (isEnclosedJudgeBranchLine(ls, only)) return null
    const headIndentLen = (ls[only]?.match(/^ */)?.[0] || '').length
    return dissolveFlowStructureAtHead(ls, only, headKw, headIndentLen).join('\n')
  }, [dissolveFlowStructureAtHead, isEnclosedJudgeBranchLine])

  /** 行内文本拖选过程中，按锚点/当前 X 坐标实时更新输入框的选择范围（产生原生选中背景） */
  const updateLineTextSelect = useCallback((anchorX: number, headX: number): void => {
    const input = inputRef.current
    if (!input) return
    const rect = input.getBoundingClientRect()
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.font = getComputedStyle(input).font || '13px "Consolas", "Cascadia Mono", "MS Gothic", "NSimSun", "Microsoft YaHei UI", monospace'
    const text = input.value
    const posForClientX = (cx: number): number => {
      let relX = cx - rect.left
      if (relX < 0) relX = 0
      const fullWidth = ctx.measureText(text).width
      let pos = text.length
      if (relX < fullWidth) {
        for (let i = 1; i <= text.length; i++) {
          const w = ctx.measureText(text.slice(0, i)).width
          if (w > relX) {
            const wPrev = ctx.measureText(text.slice(0, i - 1)).width
            pos = (relX - wPrev < w - relX) ? i - 1 : i
            break
          }
        }
      }
      return pos
    }
    const anchorPos = posForClientX(anchorX)
    const headPos = posForClientX(headX)
    input.setSelectionRange(Math.min(anchorPos, headPos), Math.max(anchorPos, headPos), headPos < anchorPos ? 'backward' : 'forward')
  }, [])

  const handleLineMouseDown = useCallback((e: React.MouseEvent, lineIndex: number, opts?: { textSelectable?: boolean; isVirtual?: boolean }) => {
    // 正在编辑的输入框中不处理
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    // 命令点击不触发选择
    if ((e.target as HTMLElement).classList.contains('eyc-cmd-clickable')) return

    e.preventDefault()
    optimisticLineEditRef.current = null
    // 如果有活跃编辑，先提交当前编辑（含自动补全上屏）
    if (editCellRef.current) {
      commitRef.current()
    }
    dragStartPos.current = { x: e.clientX, y: e.clientY }
    wasDragSelect.current = false
    lineTextDragCandidateRef.current = null
    lineTextSelectDragRef.current = null
    if (e.shiftKey && dragAnchor.current !== null) {
      // Shift+点击: 扩展选择到当前行
      setSelectedLines(rangeSet(dragAnchor.current, lineIndex))
    } else {
      dragAnchor.current = lineIndex
      // 普通单击不立即标记行选中，避免蓝色闪烁；只有实际拖动时才设置
      if (opts?.textSelectable) {
        lineTextDragCandidateRef.current = { lineIndex, isVirtual: opts.isVirtual }
        // 左键按下即乐观进入编辑态：与上面 commit 的 setState 合并为同一渲染批次
        // （click 阶段再进入要多一整轮渲染，且要等到 mouseup 之后才开始）。
        // 拖动转行多选时由 mousemove 路径清除编辑态。
        if (e.button === 0) {
          startEditLineOnMouseDownRef.current(lineIndex, opts.isVirtual, e.clientX, e.target)
          optimisticLineEditRef.current = lineIndex
        }
      }
    }
    isDragging.current = true
    // 聚焦 wrapper 以便接收键盘事件（Delete等）
    focusWrapper()
  }, [focusWrapper, rangeSet])

  // 行号区按下：单击=整行选中、按住拖动=整行多选（不进入编辑态）；Shift+单击扩展选择。
  // 折叠按钮自带 stopPropagation 不会到这；断点圆点无独立交互、一并按整行选中处理。
  const handleGutterMouseDown = useCallback((e: React.MouseEvent, lineIndex: number) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation() // 不冒泡到行 mousedown，避免乐观进入编辑态
    optimisticLineEditRef.current = null
    if (editCellRef.current) commitRef.current()
    lineTextDragCandidateRef.current = null
    lineTextSelectDragRef.current = null
    dragStartPos.current = { x: e.clientX, y: e.clientY }
    if (e.shiftKey && dragAnchor.current !== null) {
      setSelectedLines(rangeSet(dragAnchor.current, lineIndex))
    } else {
      dragAnchor.current = lineIndex
      setSelectedLines(new Set([lineIndex]))
    }
    // 点击即选中整行；置 wasDragSelect 让后续拖动直接走 onMove 的 rangeSet 多选、
    // 并吞掉随后的 click（不触发点击进编辑）。
    wasDragSelect.current = true
    isDragging.current = true
    focusWrapper()
  }, [focusWrapper, rangeSet])

  // mousemove 和 mouseup 全局监听
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      // 展开参数行拖选：优先处理（param mousedown 已 stopPropagation，故行拖选相关 ref 未激活）
      if (paramDragRef.current) {
        const pd = paramDragRef.current
        const dx = e.clientX - pd.startX, dy = e.clientY - pd.startY
        if (!pd.active && dx * dx + dy * dy <= 25) return  // 未过阈值：仍可能是普通点击，先不动
        pd.active = true
        if (editCellRef.current) { setEditCell(null); setAcVisible(false) }
        let curArg = pd.anchorArg
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
        const rowEl = el?.closest?.('.eyc-param-expand-row[data-param-arg]') as HTMLElement | null
        if (rowEl && Number(rowEl.dataset.paramLine) === pd.lineIndex) curArg = Number(rowEl.dataset.paramArg)
        const lo = Math.min(pd.anchorArg, curArg), hi = Math.max(pd.anchorArg, curArg)
        const set = new Set<number>()
        for (let k = lo; k <= hi; k++) set.add(k)
        setSelectedLines(prev => (prev.size ? new Set<number>() : prev))
        setSelectedParamRows({ lineIndex: pd.lineIndex, argIdxs: set })
        paramSelAnchorRef.current = pd.anchorArg
        focusWrapper()  // 焦点移回 wrapper，Delete/Backspace 才能删选中的参数
        return
      }
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
            focusWrapper()
          }
        }
      }
      if (!isDragging.current || dragAnchor.current === null) return
      // 行内文本拖选已激活：实时更新输入框选择范围（拖动过程中即可看到选中背景）
      if (lineTextSelectDragRef.current) {
        const liNow = findLineAtY(e.clientY)
        if (liNow >= 0 && liNow !== dragAnchor.current) {
          // 拖出该行：放弃文本选择（文本未改动，直接退出编辑态），转为行多选
          lineTextSelectDragRef.current = null
          setEditCell(null)
          setAcVisible(false)
          optimisticLineEditRef.current = null
          wasDragSelect.current = true
          setSelectedLines(rangeSet(dragAnchor.current, liNow))
          // 焦点移回 wrapper：否则输入框卸载后焦点落到 body，inEditor 判否、Backspace/Delete 删不了选中行。
          focusWrapper()
          return
        }
        updateLineTextSelect(lineTextSelectDragRef.current.anchorX, e.clientX)
        return
      }
      const li = findLineAtY(e.clientY)
      if (dragStartPos.current && !wasDragSelect.current) {
        const dx = e.clientX - dragStartPos.current.x
        const dy = e.clientY - dragStartPos.current.y
        if (dx * dx + dy * dy > 25) {
          const cand = lineTextDragCandidateRef.current
          // 起始于代码行内容区的拖动：拖到另一行、或纵向拖动意图 → 行多选；
          // 同一行内横向拖动 → 行内文本选择。
          if (!cand || (li >= 0 && li !== dragAnchor.current) || Math.abs(dy) >= Math.abs(dx)) {
            wasDragSelect.current = true
            // 从代码行内容区起拖、转为行多选时：退出 mousedown 时开的乐观编辑态并把焦点移回 wrapper。
            // 否则输入框仍聚焦，随后按 Backspace/Delete 会落到输入框删单个字符，而非删除选中的多行。
            if (editCellRef.current) {
              setEditCell(null)
              setAcVisible(false)
              optimisticLineEditRef.current = null
              focusWrapper()
            }
          } else if (li === cand.lineIndex) {
            // 同一行内横向拖动超过阈值：立即进入编辑态并选中拖过的范围，后续移动实时更新
            lineTextSelectDragRef.current = { anchorX: dragStartPos.current.x }
            beginLineTextSelectRef.current(cand.lineIndex, cand.isVirtual, dragStartPos.current.x, e.clientX)
            return
          }
        }
      }
      // 只有确认是拖动后才更新行选中，避免普通点击时也出现蓝色高亮
      if (!wasDragSelect.current) return
      if (li >= 0) {
        // 确保锚点行也被选中（首次拖入超过阈值时）
        setSelectedLines(rangeSet(dragAnchor.current, li))
      }
    }
    const onUp = (e: MouseEvent): void => {
      if (paramDragRef.current) {
        const wasActive = paramDragRef.current.active
        paramDragRef.current = null
        // 真拖动过：吞掉随后的 click，别进入编辑（跨行拖动时 click 落在共同祖先、可能不在参数行上，
        // 故也靠下一次 mousedown 顶部清零兜底）
        if (wasActive) suppressParamClickRef.current = true
        return
      }
      if (lineTextSelectDragRef.current) {
        // 拖动期间已进入编辑态并实时更新选择，此处做最终更新并吞掉随后的 click
        updateLineTextSelect(lineTextSelectDragRef.current.anchorX, e.clientX)
        wasDragSelect.current = true
        lineTextSelectDragRef.current = null
      } else {
        const cand = lineTextDragCandidateRef.current
        if (isDragging.current && !wasDragSelect.current && cand && dragStartPos.current) {
          const dx = e.clientX - dragStartPos.current.x
          const dy = e.clientY - dragStartPos.current.y
          if (dx * dx + dy * dy > 25 && Math.abs(dx) > Math.abs(dy) && findLineAtY(e.clientY) === cand.lineIndex) {
            // 兜底：拖动期间未来得及激活（如移动事件被吞）时，松开时仍按文本选择处理
            beginLineTextSelectRef.current(cand.lineIndex, cand.isVirtual, dragStartPos.current.x, e.clientX)
            wasDragSelect.current = true // 吞掉随后的 click，避免按单击重新定位光标
          }
        }
      }
      lineTextDragCandidateRef.current = null
      isDragging.current = false
      pendingInputDragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [findLineAtY, focusWrapper, rangeSet, updateLineTextSelect])

  // 全局键盘处理（选择状态下 Ctrl+C 复制、Delete 删除；Ctrl+A 全选）
  useEffect(() => {
    const getSubAnchorInfoForLine = (ls: string[], lineIndex: number): { anchorLine: number; ordinaryLines: number[] } | null => {
      if (lineIndex < 0 || lineIndex >= ls.length) return null
      let subStart = -1
      for (let i = lineIndex; i >= 0; i--) {
        const t = (ls[i] || '').replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ')) { subStart = i; break }
        if (t.startsWith('.程序集 ')) break
      }
      if (subStart < 0) return null

      let subEnd = ls.length
      for (let i = subStart + 1; i < ls.length; i++) {
        const t = (ls[i] || '').replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ') || t.startsWith('.程序集 ')) {
          subEnd = i
          break
        }
      }

      const ordinaryLines: number[] = []
      for (let i = subStart + 1; i < subEnd; i++) {
        const t = (ls[i] || '').replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.')) continue
        ordinaryLines.push(i)
      }
      if (ordinaryLines.length === 0) return null
      return { anchorLine: ordinaryLines[0], ordinaryLines }
    }

    const applySubAnchorDeleteRule = (ls: string[], deletableInput: Set<number>): { deletable: Set<number>; forceBlank: Set<number> } => {
      const deletable = new Set<number>(deletableInput)
      const forceBlank = new Set<number>()
      const touchedAnchors = new Set<number>()

      for (const i of Array.from(deletable)) {
        const info = getSubAnchorInfoForLine(ls, i)
        if (!info) continue
        const anchor = info.anchorLine
        if (touchedAnchors.has(anchor)) continue
        if (!deletable.has(anchor)) continue
        touchedAnchors.add(anchor)

        // 子程序首条普通行必须保留：
        // 1) 有命令时改为空行保留；
        // 2) 本来就是空行时，改删其下方普通行（若存在）。
        deletable.delete(anchor)
        if (((ls[anchor] || '').trim()) !== '') {
          forceBlank.add(anchor)
          continue
        }

        const hasOtherSelected = info.ordinaryLines.some(line => line > anchor && deletable.has(line))
        if (!hasOtherSelected) {
          const nextOrdinary = info.ordinaryLines.find(line => line > anchor)
          if (nextOrdinary !== undefined) deletable.add(nextOrdinary)
        }
      }

      return { deletable, forceBlank }
    }

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

    const preserveTrailingBlankLine = (before: string[], after: string[]): string[] => {
      const hadTrailingBlank = before.length > 0 && (before[before.length - 1] || '').trim() === ''
      if (!hadTrailingBlank) return after
      const hasTrailingBlank = after.length > 0 && (after[after.length - 1] || '').trim() === ''
      if (hasTrailingBlank) return after
      return [...after, '']
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

      // 打勾格（公开/静态/传址…）键盘焦点态：空格切换、方向键继续导航、Esc 退出。
      // 该状态下焦点在 wrapper（无输入框），按键从这里接管。
      if (editCellRef.current?.booleanCell) {
        const bc = editCellRef.current
        if (e.key === ' ' && !ctrl) {
          e.preventDefault()
          let boolTableType: string | undefined
          for (const b of blocksRef.current) {
            if (b.kind !== 'table') continue
            if (b.rows.some(r => !r.isHeader && r.lineIndex === bc.lineIndex)) { boolTableType = b.tableType; break }
          }
          tryToggleTableBooleanCellRef.current?.(boolTableType, bc.lineIndex, bc.cellIndex)
          return
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          applyArrowNavigationKeyRef.current?.({ key: e.key, cursorPos: 0 })
          return
        }
        if (e.key === 'Escape') {
          setEditCell(null)
          return
        }
      }

      // Ctrl+A：全选所有行（只要焦点在编辑器区域）
      if (ctrl && e.key === 'a' && inEditor) {
        e.preventDefault()
        const ls = prevRef.current.split('\n')
        const all = new Set<number>()
        for (let i = 0; i < ls.length; i++) all.add(i)
        setSelectedLines(all)
        dragAnchor.current = 0
        return
      }

      // Ctrl+Z / Ctrl+Y（撤销/重做）不在此 window 监听里处理：
      // 焦点在编辑器区域(非输入框)时，App 的全局快捷键会派发 editorAction('undo'/'redo')
      // → 外层全局撤销栈统一处理；若此处再处理会与 App 的 window 监听重复触发（双重撤销）。
      // 输入框内的 Ctrl+Z 由各输入框的 onKey / handleParamInputCtrlKey 上抛全局栈。

      // Ctrl+V：粘贴多行内容
      if (ctrl && e.key === 'v' && inEditor) {
        const state = editCellRef.current
        if (state && state.cellIndex === -1 && state.paramIdx === undefined) return
        if (shouldUseNativeInputPaste(editCellRef.current)) return
        e.preventDefault()
        navigator.clipboard.readText().then(clipText => {
          const latestText = prevRef.current
          const cursorLine = editCellRef.current?.lineIndex ?? lastFocusedLine.current
          const pasteResult = buildMultiLinePasteResult({
            currentText: latestText,
            clipText,
            cursorLine,
            sanitizePastedText: sanitizePastedTextForCurrent,
            extractAssemblyVarLines: extractAssemblyVarLinesFromPasted,
            extractRoutedDeclarationLines: extractRoutedDeclarationLinesFromPasted,
            replaceLineIndices: selectedLinesRef.current.size > 0 ? Array.from(selectedLinesRef.current) : undefined,
          })
          if (!pasteResult) return
          if (pasteResult.routedDeclarations.length > 0) {
            onRouteDeclarationPaste?.(pasteResult.routedDeclarations)
          }
          pushUndo(latestText)
          const nt = pasteResult.nextText
          setCurrentText(nt); prevRef.current = nt; onChange(nt)
          const newSel = new Set<number>()
          for (let i = 0; i < pasteResult.pastedLineCount; i++) newSel.add(pasteResult.insertAt + i)
          setSelectedLines(newSel)
          lastFocusedLine.current = pasteResult.insertAt + pasteResult.pastedLineCount - 1
        })
        return
      }

      // 以下操作需要有选中行且焦点在编辑器内
      if (selectedLines.size === 0 || !inEditor) return

      if (ctrl && e.key === 'c') {
        e.preventDefault()
        const sorted = [...selectedLines].sort((a, b) => a - b)
        const ls = currentText.split('\n')
        const selectedText = eycToYiFormat(appendMissingFlowEnds(filterClipboardSelectionIndices(ls, sorted.filter(i => i >= 0 && i < ls.length)).map(i => ls[i])).join('\n'))
        navigator.clipboard.writeText(selectedText)
        return
      }
      if (ctrl && e.key === 'x') {
        e.preventDefault()
        const ls = currentText.split('\n')
        const { deletable: rawDeletable, sorted } = getDeletableSelection(ls, selectedLines)
        if (sorted.length === 0) return
        const selectedText = eycToYiFormat(appendMissingFlowEnds(filterClipboardSelectionIndices(ls, sorted).map(i => ls[i])).join('\n'))
        navigator.clipboard.writeText(selectedText)
        // 删除选中行
        const { deletable, forceBlank } = applySubAnchorDeleteRule(ls, rawDeletable)
        pushUndo(currentText)
        const cutHeadNt = dissolveSingleFlowHeadIfAny(ls, deletable)
        if (cutHeadNt != null) {
          setCurrentText(cutHeadNt); prevRef.current = cutHeadNt; onChange(cutHeadNt)
          setSelectedLines(new Set())
          return
        }
        const cutDeletable = new Set<number>([...deletable, ...collectMatchingFlowMarkers(ls, new Set<number>([...deletable, ...forceBlank]))])
        for (const p of protectMinimalFlowInPartialSelection(ls, new Set<number>([...deletable, ...forceBlank]))) cutDeletable.delete(p)
        const cutFlowEndKws = new Set<string>()
        for (const i of cutDeletable) {
          const kw = extractFlowKw(ls[i] || '')
          if (kw && FLOW_END_KW.has(kw)) cutFlowEndKws.add(kw)
        }
        const deletedLines = preserveTrailingBlankLine(ls, ls.reduce<string[]>((acc, line, i) => {
          if (cutDeletable.has(i)) return acc
          acc.push(forceBlank.has(i) ? '' : line)
          return acc
        }, []))
        const nl = ensureMinimalFlowBodies(repairBrokenFlowAfterDelete(deletedLines, cutFlowEndKws))
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt)
        setSelectedLines(new Set())
        return
      }
      // 空格 = 删除：易语言代码里没有空格语义，行多选状态下按空格等同 Delete（同一套
      // 最小结构保护/溶解逻辑）。仅在有行选区时劫持空格；输入框内的空格不受影响（本
      // 监听器开头已对 INPUT/TEXTAREA 提前返回，正常文本编辑照常输入空格）。
      if (e.key === 'Delete' || e.key === 'Backspace' || (e.key === ' ' && !ctrl && selectedLines.size > 0)) {
        e.preventDefault()
        const ls = currentText.split('\n')
        const { deletable: rawDeletable, sorted: sortedSel } = getDeletableSelection(ls, selectedLines)
        if (sortedSel.length === 0) return
        const { deletable, forceBlank } = applySubAnchorDeleteRule(ls, rawDeletable)
        pushUndo(currentText)
        const delHeadNt = dissolveSingleFlowHeadIfAny(ls, deletable)
        if (delHeadNt != null) {
          setCurrentText(delHeadNt); prevRef.current = delHeadNt; onChange(delHeadNt)
          setSelectedLines(new Set())
          return
        }
        const delDeletable = new Set<number>([...deletable, ...collectMatchingFlowMarkers(ls, new Set<number>([...deletable, ...forceBlank]))])
        for (const p of protectMinimalFlowInPartialSelection(ls, new Set<number>([...deletable, ...forceBlank]))) delDeletable.delete(p)
        const delFlowEndKws = new Set<string>()
        for (const i of delDeletable) {
          const kw = extractFlowKw(ls[i] || '')
          if (kw && FLOW_END_KW.has(kw)) delFlowEndKws.add(kw)
        }
        const deletedLines = preserveTrailingBlankLine(ls, ls.reduce<string[]>((acc, line, i) => {
          if (delDeletable.has(i)) return acc
          acc.push(forceBlank.has(i) ? '' : line)
          return acc
        }, []))
        const nl = ensureMinimalFlowBodies(repairBrokenFlowAfterDelete(deletedLines, delFlowEndKws))
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt)
        setSelectedLines(new Set())
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedLines, onChange, pushUndo, repairBrokenFlowAfterDelete, dissolveSingleFlowHeadIfAny, collectMatchingFlowMarkers, protectMinimalFlowInPartialSelection, onGlobalUndo, onGlobalRedo])

  // ===== 自动补全状态 =====
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
  const acContainerRef = useRef<HTMLDivElement | null>(null)
  const acWordLeftOffsetRef = useRef(0) // 当前补全词起点相对输入框左缘的像素偏移

  // 弹窗打开期间逐帧跟踪输入框位置：输出面板开合动画、滚动、提交收起参数面板等
  // 都会在弹窗定位之后移动行布局，固定坐标会漂移，必须持续吸附到输入框当前位置。
  // rect 是 zoom 放大后的视口坐标，写入 fixed 坐标前同样要除以 eycScale 反向补偿。
  useEffect(() => {
    if (!acVisible) return
    const safeScale = Math.max(eycScale, 0.01)
    let raf = 0
    const track = (): void => {
      const input = inputRef.current
      const container = acContainerRef.current
      if (input && container) {
        const rect = input.getBoundingClientRect()
        container.style.setProperty('--eyc-ac-left', `${(rect.left + acWordLeftOffsetRef.current) / safeScale}px`)
        container.style.setProperty('--eyc-ac-top', `${(rect.bottom + 2) / safeScale}px`)
      }
      raf = window.requestAnimationFrame(track)
    }
    raf = window.requestAnimationFrame(track)
    return () => window.cancelAnimationFrame(raf)
  }, [acVisible, eycScale])
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

  // 项目内所有窗口 名称→{控件,子程序}，供跨窗口成员补全（引用别的窗口名）。
  const projectWindowMemberMap = useMemo(() => {
    const map = new Map<string, { controls: Array<{ name: string; type: string }>; subs: string[] }>()
    for (const w of projectWindows) {
      const name = (w?.name || '').trim()
      if (!name) continue
      map.set(name, {
        controls: (w.controls || []).map(c => ({ name: (c.name || '').trim(), type: (c.type || '').trim() })).filter(c => c.name),
        subs: (w.subs || []).map(s => (s || '').trim()).filter(Boolean),
      })
    }
    return map
  }, [projectWindows])

  const parsedLinesForCurrentText = useMemo(() => parseLines(currentText), [currentText])

  const userVarTypeMap = useMemo(() => {
    const parsed = parsedLinesForCurrentText
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

    const map = new Map<string, string>()
    const addVar = (name: string, varType: string): void => {
      const nm = (name || '').trim()
      const tp = (varType || '').trim()
      if (!nm || !tp) return
      map.set(nm, tp)
    }

    if (subStart >= 0) {
      for (let i = subStart + 1; i < subEnd; i++) {
        const ln = parsed[i]
        if ((ln.type === 'subParam' || ln.type === 'localVar') && ln.fields[0]) {
          addVar(ln.fields[0], ln.fields[1] || '')
        }
      }
    }

    for (const ln of parsed) {
      if ((ln.type === 'assemblyVar' || ln.type === 'globalVar') && ln.fields[0]) {
        addVar(ln.fields[0], ln.fields[1] || '')
      }
    }

    for (const v of projectGlobalVars) addVar(v.name, v.type || '')
    for (const item of windowControlTypes) addVar(item?.name || '', item?.type || '')
    return map
  }, [parsedLinesForCurrentText, editCell?.lineIndex, projectGlobalVars, windowControlTypes])

  const customDataTypeFieldMap = useMemo(() => {
    const map = new Map<string, Array<{ name: string; type: string }>>()
    const addField = (typeName: string, fieldName: string, fieldType: string): void => {
      const tn = normalizeMemberTypeName(typeName)
      const fn = (fieldName || '').trim()
      if (!tn || !fn) return
      if (!map.has(tn)) map.set(tn, [])
      const fields = map.get(tn)!
      if (!fields.some(field => field.name === fn)) {
        fields.push({ name: fn, type: (fieldType || '').trim() })
      }
    }

    for (const dt of projectDataTypes) {
      for (const field of dt.fields || []) {
        addField(dt.name, field.name, field.type)
      }
    }

    const parsed = parsedLinesForCurrentText
    let currentTypeName = ''
    for (const ln of parsed) {
      if (ln.type === 'dataType') {
        currentTypeName = (ln.fields[0] || '').trim()
        continue
      }
      if (ln.type === 'dataTypeMember') {
        addField(currentTypeName, ln.fields[0] || '', ln.fields[1] || '')
        continue
      }
      if (ln.type !== 'blank' && ln.type !== 'comment') {
        currentTypeName = ''
      }
    }

    return map
  }, [parsedLinesForCurrentText, projectDataTypes])

  // 加载所有命令（用于补全），含流程关键字
  const reloadCommands = useCallback(() => {
    window.api.library.getAllCommands(targetPlatform).then((cmds: CompletionItem[]) => {
      const { independentItems, memberItems, libraryConstantItems } = buildCompletionCatalog(cmds)
      allCommandsRef.current = independentItems
      memberCommandsRef.current = memberItems
      libraryConstantCompletionItemsRef.current = libraryConstantItems

      setCmdLoadId(n => n + 1)
    }).catch(() => {})
  }, [targetPlatform])

  // 初始加载 + 支持库变更时重新加载命令
  useEffect(() => {
    reloadCommands()
    const dispose = window.api.on('library:loaded', reloadCommands)
    return () => { dispose() }
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
    const dispose = window.api.on('library:loaded', loadLibraryMeta)
    return () => {
      cancelled = true
      dispose()
    }
  }, [])

  // 确保选中项始终可见
  useEffect(() => {
    if (acVisible && acListRef.current) {
      const selected = acListRef.current.children[acIndex] as HTMLElement | undefined
      selected?.scrollIntoView({ block: 'nearest' })
    }
  }, [acIndex, acVisible])

  // 项目类名 → 公开方法补全项（用于 对象.方法 成员补全）
  const classMethodMap = useMemo(() => {
    const map = new Map<string, CompletionItem[]>()
    for (const cls of projectClassNames) {
      if (!cls.methods || cls.methods.length === 0) continue
      map.set(cls.name, cls.methods.map(m => ({
        name: m.name,
        englishName: '',
        description: m.description || `类 ${cls.name} 的公开方法`,
        returnType: m.returnType || '',
        category: '方法',
        libraryName: '用户定义',
        isMember: true,
        ownerTypeName: cls.name,
        params: m.params.map(p => ({ name: p.name, type: p.type, description: '', optional: false, isVariable: false, isArray: false })),
      })))
    }
    return map
  }, [projectClassNames])

  // 按方法名查找项目类的公开方法（支持 对象.方法 形式，取最后一段）
  const findProjectClassMethodByName = useCallback((rawName: string): CompletionItem | null => {
    const name = (rawName || '').trim().replace(/^.*[.。．]/, '')
    if (!name) return null
    for (const methods of classMethodMap.values()) {
      const hit = methods.find(m => m.name === name)
      if (hit) return hit
    }
    return null
  }, [classMethodMap])

  /** 根据光标位置的"词"更新补全列表 */
  const updateCompletion = useCallback((val: string, cursorPos: number) => {
    if (!editCell) { setAcVisible(false); return }
    const isCodeEdit = editCell.cellIndex < 0
    const isClassNameCellEdit = editCell.cellIndex >= 0 && canUseClassNameCompletion(editCell.lineIndex, editCell.fieldIdx)
    const isTypeCellEdit = editCell.cellIndex >= 0 && canUseTypeCompletion(editCell.lineIndex, editCell.fieldIdx)
    if (!isCodeEdit && !isTypeCellEdit) { setAcVisible(false); return }

    // 引号内是自由文本输入，不弹补全窗（支持英文/中文引号）
    if (isCursorInsideQuotedText(val, cursorPos)) { setAcVisible(false); return }

    const {
      wordStart,
      word,
      hashMode,
      isMemberAccess,
    } = resolveCompletionWordContext(val, cursorPos)
    // 普通代码输入下，空词且不在成员访问上下文时不弹补全，避免无意义打扰。
    if (!isTypeCellEdit && !isClassNameCellEdit && !hashMode && word.length === 0 && !isMemberAccess) { setAcVisible(false); return }
    // 数字开头的输入是数值字面量（如 .如果真（1） 里的 1），易语言标识符不能以数字开头，
    // 故它绝不会是命令/变量/类型/类名——不弹补全窗，免得 "1" 去 fuzzy 匹配含 1 的命令/变量打扰输入。
    // （# 常量、成员访问 obj. 两种上下文的前导字符不是标识符起始，不在此列。）
    if (!hashMode && !isMemberAccess && /^[0-9０-９]/.test(word)) { setAcVisible(false); return }

    acWordStartRef.current = wordStart
    acPrefixRef.current = hashMode ? '#' : ''

    const defaultSourceList: CompletionItem[] = [
      ...BUILTIN_LITERAL_COMPLETION_ITEMS,
      ...userVarCompletionItemsRef.current,
      ...userSubCompletionItemsRef.current,
      ...dllCompletionItemsRef.current,
      // 隐藏的配对结构标记（否则/默认/如果结束/判断结束/如果真结束）由结构自动补全生成，手打会造出孤立标记，故不进补全弹窗。
      ...allCommandsRef.current.filter(c => !TABLE_MODE_HIDDEN_FLOW_COMMANDS.has(c.name)),
    ]

    const sourceList = selectCompletionSourceList({
      defaultSourceList,
      isClassNameCellEdit,
      isTypeCellEdit,
      hashMode,
      isMemberAccess,
      classNameItems: classNameCompletionItemsRef.current,
      typeItems: typeCompletionItemsRef.current,
      constantItems: constantCompletionItemsRef.current,
      libraryConstantItems: libraryConstantCompletionItemsRef.current,
      memberParams: {
        val,
        wordStart,
        userVarCompletionItems: userVarCompletionItemsRef.current,
        userVarTypeMap,
        windowControlTypeMap,
        windowUnits,
        customDataTypeFieldMap,
        classMethodMap,
        memberCommands: memberCommandsRef.current,
        allCommands: allCommandsRef.current,
        windowSubNames: userSubNamesRef.current,
        projectWindowMemberMap,
      },
    })

    const allowEmptyWord = isMemberAccess


    // 统一在工具层处理打分和排序，主流程只保留输入上下文编排。
    const fullMatches = buildCompletionMatches({
      sourceList,
      word,
      isClassNameCellEdit,
      isTypeCellEdit,
      hashMode,
      allowEmptyWord,
    })

    if (fullMatches.length === 0) { setAcVisible(false); return }

    const matches = paginateCompletionDisplayItems(fullMatches, AC_PAGE_SIZE)

    // 计算弹窗位置（词首像素偏移记入 ref，供弹窗打开期间的位置跟踪复用）。
    // 展开参数编辑时锚定到参数输入框（inputRef 是代码行输入框、此时未渲染）。
    const anchorInput = editCell.paramIdx !== undefined ? paramInputRef.current : inputRef.current
    if (anchorInput) {
      const popupPos = computeCompletionPopupPosition(anchorInput, val, wordStart, eycScale)
      acWordLeftOffsetRef.current = popupPos.leftOffset
      setAcPos({ left: popupPos.left, top: popupPos.top })
    }

    setAcItems(matches)
    setAcIndex(0)
    setAcVisible(true)
  }, [editCell, canUseTypeCompletion, canUseClassNameCompletion, userVarTypeMap, windowControlTypeMap, windowUnits, customDataTypeFieldMap, classMethodMap, eycScale])

  /** 应用补全项：替换当前输入词为命令名 */
  const applyCompletion = useCallback((displayItem: AcDisplayItem) => {
    if (displayItem.isMore) return
    const item = displayItem.cmd
    const wordStart = acWordStartRef.current
    const prefix = acPrefixRef.current
    // 展开参数编辑时活动输入框是 paramInputRef（inputRef 是代码行输入框、此时未渲染）
    const isParamExprEdit = !!editCell && editCell.paramIdx !== undefined
    const activeInput = isParamExprEdit ? paramInputRef.current : inputRef.current
    const cursorPos = activeInput?.selectionStart ?? editVal.length
    const before = editVal.slice(0, prefix ? Math.max(0, wordStart - 1) : wordStart)
    const after = editVal.slice(cursorPos)

    const commandPool = [
      ...allCommandsRef.current,
      ...dllCompletionItemsRef.current,
      ...memberCommandsRef.current,
    ]
    const isCodeLineEdit = !!editCell && editCell.cellIndex === -1 && editCell.paramIdx === undefined
    // 参数值是表达式，命令（如 到字节集）同样可调用、自动补括号
    const isCallable = (isCodeLineEdit || isParamExprEdit) && (
      commandPool.some(c => c.name === item.name)
      || userSubNamesRef.current.has(item.name)
      // 项目类的公开方法（对象.方法）同样可调用
      || (item.isMember && item.category === '方法')
    )
    const leadingAfter = after.match(/^\s*/) ? (after.match(/^\s*/)?.[0] || '') : ''
    const afterNext = after.slice(leadingAfter.length, leadingAfter.length + 1)
    const hasCallAlready = afterNext === '(' || afterNext === '（'
    const canInsertCall = !hasCallAlready && !/^[\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]$/.test(afterNext)

    let callSuffix = ''
    let caretExtra = 0
    if (isCallable && canInsertCall) {
      // 可调用项自动补全括号，减少手动输入成本。
      if (item.params.length > 0) {
        callSuffix = `（${item.params.map(p => p.optional ? '' : '').join(',')}）`
      } else {
        callSuffix = '（）'
      }
      caretExtra = 2
    }

    const normalizedAfter = isCodeLineEdit
      ? after.replace(/^[\s\u00A0]+(?=[,，\)\）])/, '')
      : after

    const newVal = before + prefix + item.name + callSuffix + normalizedAfter
    setEditVal(newVal)
    setAcVisible(false)
    setTimeout(() => {
      const target = isParamExprEdit ? paramInputRef.current : inputRef.current
      if (target) {
        const newPos = before.length + prefix.length + item.name.length + caretExtra
        try {
          target.focus({ preventScroll: true })
        } catch {
          target.focus()
        }
        target.setSelectionRange(newPos, newPos)
      }
    }, 0)
  }, [editVal, editCell])

  // 编辑态结束（blur 提交 / Esc / 提交后 setEditCell(null) 等路径）统一关掉补全弹窗，
  // 避免参数输入框 blur 提交后弹窗残留在原位。
  useEffect(() => {
    if (!editCell) setAcVisible(false)
  }, [editCell])

  // 手工输入的 .局部变量 自动归位：编辑会话结束时把错位的局部变量声明（子程序正文中敲出的、
  // 会形成第二张局部变量表）归位到所属子程序头部声明区。只在"确有编辑发生后"的会话结束时跑，
  // 打开文件不触发；会话进行中不动（正在编辑的行不能被抽走，行号也不能在编辑态下平移）。
  const hadEditSessionRef = useRef(false)
  useEffect(() => {
    if (editCell) {
      hadEditSessionRef.current = true
      return
    }
    if (!hadEditSessionRef.current) return
    hadEditSessionRef.current = false
    const nt = relocateMisplacedLocalVarLines(prevRef.current)
    if (nt != null && nt !== prevRef.current) {
      setCurrentText(nt)
      prevRef.current = nt
      onChange(nt)
    }
  }, [editCell, onChange])

  const expandMoreCompletion = useCallback((index: number) => {
    setAcItems(prev => {
      const item = prev[index]
      if (!item || !item.isMore || !item.hiddenItems || item.hiddenItems.length === 0) return prev
      return [...prev.slice(0, index), ...item.hiddenItems]
    })
    setAcIndex(index)
  }, [])

  const isFlowPasteDebugEnabled = useCallback((): boolean => {
    const g = globalThis as {
      __EYC_ACTION_DEBUG__?: boolean
      __EYC_FLOW_PASTE_DEBUG__?: boolean
      localStorage?: { getItem: (key: string) => string | null }
    }
    if (g.__EYC_ACTION_DEBUG__ === true) return true
    if (g.__EYC_FLOW_PASTE_DEBUG__ === true) return true
    try {
      if (g.localStorage?.getItem('__EYC_ACTION_DEBUG__') === '1') return true
      return g.localStorage?.getItem('__EYC_FLOW_PASTE_DEBUG__') === '1'
    } catch {
      return false
    }
  }, [])

  const debugFlowPaste = useCallback((stage: string, payload: Record<string, unknown>) => {
    if (!isFlowPasteDebugEnabled()) return
    console.debug('[EYC_FLOW_DEBUG]', stage, payload)
    const g = globalThis as {
      api?: {
        debug?: {
          logRendererEvent?: (payload: { source?: string; message: string; extra?: unknown }) => Promise<{ success: boolean }>
          logRendererError?: (payload: { source?: string; message: string; extra?: unknown }) => Promise<{ success: boolean }>
        }
      }
    }
    const evt = g.api?.debug?.logRendererEvent
    if (evt) {
      void evt({ source: 'flow-paste', message: stage, extra: payload }).catch(() => {
        const err = g.api?.debug?.logRendererError
        if (err) {
          void err({ source: 'flow-paste-fallback', message: stage, extra: payload })
        }
      })
      return
    }
    const err = g.api?.debug?.logRendererError
    if (err) {
      void err({ source: 'flow-paste-fallback', message: stage, extra: payload })
    }
  }, [isFlowPasteDebugEnabled])

  /** 编辑 判断开始 行时输入值以"判断"别名显示，写回源码前还原真实关键字 */
  const restoreJudgeStartAlias = useCallback((val: string): string => {
    if (!shouldAliasJudgeStartInTableMode || wasFlowKwRef.current !== '判断开始') return val
    return val.replace(/^(\s*\.?)判断(?![一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_])/, '$1判断开始')
  }, [shouldAliasJudgeStartInTableMode])

  const normalizeFlowCommandName = useCallback((raw: string): string => {
    const trimmed = (raw || '').trim()
    if (!trimmed) return ''
    const token = trimmed
      .replace(/^[\u200B\u200C\u200D\u2060]+/, '')
      .split(/[\s(（]/)[0]
    if (token.startsWith('.')) return token.slice(1)
    return token
  }, [])

  const normalizeCodeLineInput = useCallback((raw: string): string => {
    if (!raw) return raw

    let next = raw
      .replace(/，/g, ',')
      .replace(/。/g, '.')
      .replace(/；/g, ';')
      .replace(/：/g, ':')
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      .replace(/【/g, '[')
      .replace(/】/g, ']')
      .replace(/｛/g, '{')
      .replace(/｝/g, '}')
      .replace(/＝/g, '=')
      .replace(/＋/g, '+')
      .replace(/－/g, '-')
      .replace(/＊/g, '*')
      .replace(/／/g, '/')
      .replace(/％/g, '%')
      .replace(/！/g, '!')
      .replace(/？/g, '?')
      .replace(/[“”]/g, '"')
      .replace(/、/g, ',')

    // 中文输入法里的单引号起始（‘/’）按注释前缀处理。
    next = next.replace(/^(\s*)[‘’]/, "$1'")

    // 注意：`'` 后的空格归一（'内容 → ' 内容）只在编辑结束落盘时做（formatCommandLine），
    // 编辑期间强补会把「删除该空格」的操作立即还原，光标行为诡异（删不掉的空格）。

    return next
  }, [])

  /** 代码行编辑结束时自动补全括号（格式化命令），返回 [主行, ...需要插入的后续行] */
  const formatCommandLine = useCallback((val: string, options?: { preferJudgeBranch?: boolean }): string[] => {
    const trimmed = val.trimStart()
    if (!trimmed) return [val]
    if (trimmed.startsWith("'")) {
      // 注释落盘时统一为 `'<space>内容`（编辑期间不强补，删空格才能真删掉）
      return [val.replace(/^(\s*)'(?!\s|$)/, "$1' ")]
    }

    // 赋值表达式：identifier = expr → 格式化运算符
    const assignM = trimmed.match(/^([\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]*)\s*(?:=(?!=)|＝)/)
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
    const rawCmdToken = normalizeFlowCommandName(trimmed)
    const resolved = resolveCmdToken(rawCmdToken)
    const cmdName = resolved.normalizedToken
    const lookupCmdName = resolved.lookupName
    if (!/^[\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]*$/.test(cmdName)) return [val]

    if (options?.preferJudgeBranch && cmdName === '判断') {
      const parenRange = getOuterParenRange(trimmed)
      if (parenRange) {
        const argText = formatOps(trimmed.slice(parenRange.start + 1, parenRange.end).trim())
        return [prefix + '判断（' + argText + '）']
      }
      const cmd = resolved.command || allCmdPool.find(c => c.name === lookupCmdName)
      if (!cmd || cmd.params.length === 0) return [prefix + '判断（）']
      const paramSlots = cmd.params.map(p => p.optional ? '' : '').join(',')
      return [prefix + '判断（' + paramSlots + '）']
    }

    // 流程控制命令自动补齐后续行
    const autoLines = FLOW_AUTO_COMPLETE[cmdName]
    if (autoLines) {
      const flowStartCmdName = cmdName === '判断' ? '判断开始' : cmdName
      const cmd = resolved.command || allCmdPool.find(c => c.name === lookupCmdName)
      // 命令本身和内部代码行都缩进4空格（两个汉字宽度）给流程线留空间
      const innerPrefix = prefix + '    '
      let mainLine: string
      const parenRange = getOuterParenRange(trimmed)
      if (parenRange) {
        // 已输入括号时尽量保留用户输入参数内容，再做流程补齐（顺带把 != / <> / >= / <= 等规范成 ≠ / ≥ / ≤）
        const argText = formatOps(trimmed.slice(parenRange.start + 1, parenRange.end).trim())
        mainLine = innerPrefix + flowStartCmdName + '（' + argText + '）'
      } else if (cmd && cmd.params.length > 0) {
        const paramSlots = cmd.params.map(p => p.optional ? '' : '').join(',')
        mainLine = innerPrefix + flowStartCmdName + '（' + paramSlots + '）'
      } else {
        mainLine = innerPrefix + flowStartCmdName + '（）'
      }
      // 自动插入的分支/结束行
      const extra = autoLines.map(kw => {
        if (kw === null) return ''
        // 有参数的流程尾命令（如 循环判断尾 带「条件」）必须带括号并铺参数位——即便它是流程关键字，
        // 故参数判定要在 FLOW_KW 之前。此前先走 FLOW_KW 一律不加括号，导致带参尾命令丢括号。
        const tailCmd = allCommandsRef.current.find(c => c.name === kw)
        if (tailCmd && tailCmd.params.length > 0) {
          const tailSlots = tailCmd.params.map(p => p.optional ? '' : '').join(',')
          return innerPrefix + kw + '（' + tailSlots + '）'
        }
        // 隐藏的配对结构标记（否则/默认/各种结束）是纯结构关键字，不带括号；其余流程尾命令（如计次循环尾）带空括号。
        if (TABLE_MODE_HIDDEN_FLOW_COMMANDS.has(kw)) return innerPrefix + kw
        return innerPrefix + kw + '（）'
      })
      return [mainLine, ...extra]
    }

    // 普通命令：仅对“裸命令名”自动补括号
    const m = trimmed.match(/^([\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]*)\s*$/)
    if (!m) return [val]

    // 流程关键字（非自动展开起始命令）不做普通命令式补括号，
    // 否则嵌套场景里 `如果结束` 会被误格式化成 `如果结束（）`。
    if (FLOW_KW.has(cmdName) && !FLOW_AUTO_COMPLETE[cmdName]) {
      return [prefix + cmdName]
    }

    if (trimmed.startsWith('.')) return [val]
    const cmd = resolved.command || allCmdPool.find(c => c.name === lookupCmdName)
    if (!cmd) {
      if (userSubNamesRef.current.has(cmdName)) {
        return [prefix + cmdName + '（）']
      }
      return [val]
    }

    if (cmd.params.length === 0) {
      return [prefix + cmdName + '（）']
    }
    const paramSlots = cmd.params.map(p => p.optional ? '' : '').join(',')
    return [prefix + cmdName + '（' + paramSlots + '）']
  }, [])

  // 找出包裹 lineIndex 的最内层「判断」结构（判断开始…判断结束），返回控制缩进、默认行下标（无则 -1）、结束行下标（无则 -1）。
  // 用已修正的 computeFlowLines 复算（把当前行中和成空 body 行，避免正在输入的“判断”自我污染），按段 depth 取最内层，正确处理多层嵌套。
  const analyzeEnclosingJudge = useCallback((lines: string[], lineIndex: number): { controlIndentLen: number; defaultLineIdx: number; endLineIdx: number } | null => {
    try {
      const indentLenOf = (line: string): number => line.length - line.replace(/^ +/, '').length
      const probe = [...lines]
      probe[lineIndex] = ' '.repeat(indentLenOf(lines[lineIndex] || ''))
      const { map } = computeFlowLines(
        probe.map((codeLine, i) => ({ kind: 'codeline', rows: [], codeLine, lineIndex: i } as RenderBlock)),
      )
      let depth = -1
      for (const seg of map.get(lineIndex) || []) if (seg.flowKind === 'judge' && seg.depth > depth) depth = seg.depth
      if (depth < 0) return null
      let startLine = -1
      for (let i = lineIndex - 1; i >= 0; i--) {
        if ((map.get(i) || []).some(seg => seg.depth === depth && seg.type === 'start' && seg.flowKind === 'judge')) { startLine = i; break }
      }
      if (startLine < 0) return null
      const controlIndentLen = indentLenOf(probe[startLine] || '')
      let endLineIdx = -1
      for (let i = lineIndex + 1; i < probe.length; i++) {
        if ((map.get(i) || []).some(seg => seg.depth === depth && seg.type === 'end' && seg.flowKind === 'judge')) { endLineIdx = i; break }
      }
      // 默认行必须按「同一 depth 的 judge 分支段」定位，不能按缩进——表格模式源码扁平（内层结构与外层同缩进），
      // 若按缩进匹配会把内层已闭合判断的「默认」误当外层默认（→ 外层 body 键入判断被错当默认区加 case，嵌套兄弟判断建不出来）。
      let defaultLineIdx = -1
      const scanTo = endLineIdx >= 0 ? endLineIdx : probe.length
      for (let i = startLine + 1; i < scanTo; i++) {
        if ((map.get(i) || []).some(seg => seg.depth === depth && seg.type === 'branch' && seg.flowKind === 'judge')
          && extractFlowKw(probe[i] || '') === '默认') { defaultLineIdx = i; break }
      }
      return { controlIndentLen, defaultLineIdx, endLineIdx }
    } catch {
      return null
    }
  }, [])

  // 键入「判断」时：仅当当前行处在最内层判断结构的「默认区」（默认之后、判断结束之前）时，作为该判断的新分支 case（插到默认之前）；
  // 其余位置（如判断开始之后的首个 body）键入「判断」应新建嵌套判断结构（自动补全）。这与用户预期一致：
  // 首个 body 输入判断→嵌套；默认区输入判断→加分支。无默认的判断块暂按“不在默认区”处理（键入判断→嵌套）。
  const shouldPreferJudgeBranchAtLine = useCallback((lineIndex: number): boolean => {
    const judge = analyzeEnclosingJudge(prevRef.current.split('\n'), lineIndex)
    if (!judge) return false
    return judge.defaultLineIdx >= 0
      && lineIndex > judge.defaultLineIdx
      && (judge.endLineIdx < 0 || lineIndex < judge.endLineIdx)
  }, [analyzeEnclosingJudge])

  const normalizeNonFlowCommandIndent = useCallback((text: string): string => {
    if (isResourceTableDoc) return text
    const linesForNormalize = text.split('\n')
    if (linesForNormalize.length === 0) return text
    if (linesForNormalize.length > 1200) return text

    // 先做廉价的候选行筛选，全文都无需处理时直接跳过昂贵的全量解析
    const candidateIndexes: number[] = []
    for (let i = 0; i < linesForNormalize.length; i++) {
      const line = linesForNormalize[i]
      if (!/^[ \t]+/.test(line)) continue

      const trimmed = line.replace(/[\r\t]/g, '').trim()
      if (!trimmed) continue
      if (trimmed.startsWith('.')) continue
      if (trimmed.startsWith("'")) continue
      candidateIndexes.push(i)
    }
    if (candidateIndexes.length === 0) return text

    let flowMap = new Map<number, FlowSegment[]>()
    try {
      flowMap = getBlocksFlowModelCached(text, isClassModule, isResourceTableDoc).flowMap
    } catch {
      // ignore parse/flow errors and fallback to conservative line-based normalization
    }

    let changed = false
    for (const i of candidateIndexes) {
      if ((flowMap.get(i)?.length || 0) > 0) continue

      const line = linesForNormalize[i]
      const deindented = line.replace(/^[ \t]+/, '')
      if (deindented !== line) {
        linesForNormalize[i] = deindented
        changed = true
      }
    }

    return changed ? linesForNormalize.join('\n') : text
  }, [isClassModule, isResourceTableDoc])

  useEffect(() => {
    const normalizedValue = normalizeNonFlowCommandIndent(value)
    if (normalizedValue !== prevRef.current) {
      setCurrentText(normalizedValue)
      prevRef.current = normalizedValue
    }
    if (normalizedValue !== value) {
      onChange(normalizedValue)
    }
  }, [value, normalizeNonFlowCommandIndent, onChange])

  const lines = useMemo(() => currentText.split('\n'), [currentText])
  const parsedLines = parsedLinesForCurrentText

  const resolveStickyTableHeader = useCallback((): {
    lineIndex: number
    nextStartLine: number | null
    colCount: number
    rows: Array<{
      lineIndex: number
      isHeader: boolean
      cells: Array<{ text: string; cls: string; colSpan?: number; align?: string; fieldIdx?: number; sliceField?: boolean }>
    }>
  } | null => {
    if (!shouldFreezeTableHeader) return null
    const wrapper = wrapperRef.current
    if (!wrapper) return null

    const metas = subTableMetaRef.current
    if (metas.length === 0) return null

    // 缓存每个子程序起始行在滚动容器内的绝对 top，滚动时仅做数字比较，
    // 避免每帧 querySelector + getBoundingClientRect 带来的切换卡顿。
    const topCache = stickyStartTopByLineRef.current
    if (topCache.size !== metas.length) {
      topCache.clear()
      const wrapperRect = wrapper.getBoundingClientRect()
      const scrollTop = wrapper.scrollTop
      for (const meta of metas) {
        const el = wrapper.querySelector<HTMLElement>(`[data-line-index="${meta.startLine}"]`)
        if (!el) continue
        const startTop = el.getBoundingClientRect().top - wrapperRect.top + scrollTop
        topCache.set(meta.startLine, startTop)
      }
    }

    const currentTop = wrapper.scrollTop + 0.5
    type MetaItem = typeof metas[number]
    let activeMeta: MetaItem | null = null
    for (const meta of metas) {
      const startTop = topCache.get(meta.startLine)
      if (startTop == null) continue
      if (startTop <= currentTop) {
        activeMeta = meta
      } else {
        // metas 按文件顺序排列，后续子程序一定位于更下方
        break
      }
    }

    if (!activeMeta) return null
    return {
      lineIndex: activeMeta.startLine,
      nextStartLine: activeMeta.nextStartLine,
      colCount: activeMeta.colCount,
      rows: activeMeta.rows,
    }
  }, [shouldFreezeTableHeader])

  const computeStickyPushOffset = useCallback((state: {
    nextStartLine: number | null
  } | null): number => {
    if (!state || state.nextStartLine == null) return 0
    const wrapper = wrapperRef.current
    const frozenRow = stickyScopeRowRef.current
    if (!wrapper || !frozenRow) return 0
    const nextEl = wrapper.querySelector<HTMLElement>(`[data-line-index="${state.nextStartLine}"]`)
    if (!nextEl) return 0
    const frozenHeight = Math.max(frozenRow.offsetHeight, 0)
    if (frozenHeight <= 0) return 0
    // 用 getBoundingClientRect 相对 wrapper 视口顶计算，避免 <tr>.offsetTop 的 offsetParent 不稳定问题。
    const nextTopInViewport = nextEl.getBoundingClientRect().top - wrapper.getBoundingClientRect().top
    return Math.min(0, nextTopInViewport - frozenHeight)
  }, [])

  const scheduleStickyScopeUpdate = useCallback(() => {
    if (stickyScopeRafRef.current != null) return
    stickyScopeRafRef.current = window.requestAnimationFrame(() => {
      stickyScopeRafRef.current = null
      const next = resolveStickyTableHeader()
      setStickySubTable(prev => {
        if (!prev && !next) return prev
        if (!prev || !next) return next
        if (prev.lineIndex === next.lineIndex && prev.nextStartLine === next.nextStartLine && prev.colCount === next.colCount) {
          return prev
        }
        return next
      })
      setStickyPushOffsetPx(computeStickyPushOffset(next))
    })
  }, [computeStickyPushOffset, resolveStickyTableHeader])

  useEffect(() => {
    if (!shouldFreezeTableHeader) {
      stickyStartTopByLineRef.current.clear()
      setStickySubTable(null)
      setStickyPushOffsetPx(0)
      return
    }
    stickyStartTopByLineRef.current.clear()
    scheduleStickyScopeUpdate()
  }, [scheduleStickyScopeUpdate, currentText, shouldFreezeTableHeader])

  useEffect(() => {
    if (!shouldFreezeTableHeader || !stickySubTable) {
      setStickyPushOffsetPx(0)
      return
    }
    const raf = window.requestAnimationFrame(() => {
      setStickyPushOffsetPx(computeStickyPushOffset(stickySubTable))
    })
    return () => window.cancelAnimationFrame(raf)
  }, [computeStickyPushOffset, shouldFreezeTableHeader, stickySubTable])

  useEffect(() => {
    if (!shouldFreezeTableHeader) return
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const onScroll = (): void => scheduleStickyScopeUpdate()
    const onResize = (): void => {
      stickyStartTopByLineRef.current.clear()
      scheduleStickyScopeUpdate()
    }

    wrapper.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)

    let resizeObserver: ResizeObserver | null = null
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(() => {
        stickyStartTopByLineRef.current.clear()
        scheduleStickyScopeUpdate()
      })
      resizeObserver.observe(wrapper)
    }

    return () => {
      if (stickyScopeRafRef.current != null) {
        window.cancelAnimationFrame(stickyScopeRafRef.current)
        stickyScopeRafRef.current = null
      }
      wrapper.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      resizeObserver?.disconnect()
    }
  }, [scheduleStickyScopeUpdate, shouldFreezeTableHeader])

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

  // 编辑代码行期间，流程模型（决定流程线/隐藏标记）用该行「编辑前的原始值」参与计算，而不是正在键入/删除的瞬时值——
  // 否则刚打「如果」还没上屏就会实时把流程线画到下方结构的结束位置，或删头瞬间闪现否则/如果结束。等上屏提交后
  // editCell 清空、流程线按新结构重绘（用户要求「等上屏自动格式化后再绘制流程线」）。参数/表达式/单元格/虚拟行编辑不介入。
  const flowModelText = useMemo(() => {
    if (!editCell || editCell.cellIndex >= 0 || editCell.fieldIdx >= 0
      || editCell.paramIdx !== undefined || editCell.exprPath !== undefined || editCell.isVirtual) return currentText
    const li = editCell.lineIndex
    if (li < 0) return currentText
    const lines = currentText.split('\n')
    if (li >= lines.length || lines[li] === editOrigRawLineRef.current) return currentText
    lines[li] = editOrigRawLineRef.current
    return lines.join('\n')
  }, [currentText, editCell])

  const { blocks, flowLines } = useEditorBlocksModel({
    text: flowModelText,
    isClassModule,
    isResourceTableDoc,
    suppressHeadPreview: !!editCell,
  })

  // ===== 子程序整体折叠（行号旁常驻 +/- 按钮，与代码行参数展开的 +/- 无关）=====
  // 以子程序名为 key（文本编辑导致行号平移时折叠状态仍跟随该子程序）
  const [collapsedSubNames, setCollapsedSubNames] = useState<Set<string>>(new Set())

  // 每个子程序的折叠范围：声明行 → 下一个非局部变量表格块的前一行（或文末）
  const subFoldRanges = useMemo(() => {
    const ranges: Array<{ name: string; startLine: number; endLine: number }> = []
    const docLines = currentText.split('\n')
    for (let bi = 0; bi < blocks.length; bi++) {
      const blk = blocks[bi]
      if (blk.kind !== 'table' || blk.tableType !== 'sub') continue
      const rawLine = (docLines[blk.lineIndex] || '').trim()
      if (!rawLine.startsWith('.子程序')) continue
      const name = (rawLine.slice('.子程序'.length).trim().split(/[,，]/)[0] || '').trim()
      if (!name) continue
      let endLine = docLines.length - 1
      for (let bj = bi + 1; bj < blocks.length; bj++) {
        const nextBlk = blocks[bj]
        if (nextBlk.kind === 'table' && nextBlk.tableType !== 'localVar') {
          endLine = nextBlk.lineIndex - 1
          break
        }
      }
      ranges.push({ name, startLine: blk.lineIndex, endLine })
    }
    return ranges
  }, [blocks, currentText])

  const subFoldNameByLine = useMemo(() => {
    const map = new Map<number, string>()
    for (const range of subFoldRanges) map.set(range.startLine, range.name)
    return map
  }, [subFoldRanges])

  const collapsedSubRanges = useMemo(
    () => subFoldRanges.filter(range => collapsedSubNames.has(range.name)),
    [subFoldRanges, collapsedSubNames],
  )
  const collapsedSubRangesRef = useRef(collapsedSubRanges)
  collapsedSubRangesRef.current = collapsedSubRanges

  const toggleSubFold = useCallback((name: string) => {
    setCollapsedSubNames(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  // 编辑落在折叠范围内时自动展开该子程序（键盘导航/搜索跳转等路径兜底）
  const expandSubContainingLine = useCallback((lineIndex: number) => {
    const hit = collapsedSubRangesRef.current.find(range => lineIndex > range.startLine && lineIndex <= range.endLine)
    if (hit) {
      setCollapsedSubNames(prev => {
        if (!prev.has(hit.name)) return prev
        const next = new Set(prev)
        next.delete(hit.name)
        return next
      })
    }
  }, [])

  // ===== 右侧变量汇总面板（程序集变量/全局变量为全文件，参数/局部变量跟随光标所在子程序）=====
  const [varPanelOpen, setVarPanelOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('eyc-var-panel-open') !== '0' } catch { return true }
  })
  const [varPanelQuery, setVarPanelQuery] = useState('')
  const [varPanelCollapsedGroups, setVarPanelCollapsedGroups] = useState<Set<string>>(new Set())

  const toggleVarPanel = useCallback(() => {
    setVarPanelOpen(prev => {
      const next = !prev
      try { localStorage.setItem('eyc-var-panel-open', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])

  const toggleVarPanelGroup = useCallback((key: string) => {
    setVarPanelCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // 光标所在子程序（用于高亮对应分组）：优先编辑态行，其次行选择
  const varPanelCurrentSub = useMemo(() => {
    let cursorLine = editCell?.lineIndex ?? -1
    if (cursorLine < 0 && selectedLines.size > 0) cursorLine = Math.min(...selectedLines)
    if (cursorLine < 0) cursorLine = lastFocusedLine.current
    if (cursorLine < 0) return null
    return subFoldRanges.find(r => cursorLine >= r.startLine && cursorLine <= r.endLine) || null
  }, [editCell, selectedLines, subFoldRanges])

  const varPanelGroups = useMemo((): VarSummaryGroup[] => {
    const query = varPanelQuery.trim().toLowerCase()
    const matches = (it: VarSummaryItem): boolean =>
      !query || it.name.toLowerCase().includes(query) || it.typeName.toLowerCase().includes(query)
    const mkVar = (i: number, f: string[]): VarSummaryItem => {
      const size = unquote((f[3] || '').trim())
      return {
        name: (f[0] || '').trim(),
        typeName: (f[1] || '').trim() || '整数型',
        arrayText: size ? `数组[${size}]` : '',
        lineIndex: i,
      }
    }

    const assemblyVars: VarSummaryItem[] = []
    const globalVars: VarSummaryItem[] = []
    // 全文件汇总：每个子程序一个分组（组内按声明顺序，参数天然在局部变量之前）
    const varsBySub = new Map<string, VarSummaryItem[]>()
    let subIdx = 0
    for (let i = 0; i < parsedLines.length; i++) {
      const ln = parsedLines[i]
      if (!ln.fields[0]) continue
      if (ln.type === 'assemblyVar') { assemblyVars.push(mkVar(i, ln.fields)); continue }
      if (ln.type === 'globalVar') { globalVars.push(mkVar(i, ln.fields)); continue }
      if (ln.type !== 'subParam' && ln.type !== 'localVar') continue
      // subFoldRanges 按行号有序，游标推进定位所属子程序（整体 O(n)）
      while (subIdx < subFoldRanges.length && i > subFoldRanges[subIdx].endLine) subIdx++
      const sub = subFoldRanges[subIdx]
      if (!sub || i < sub.startLine) continue  // DLL命令参数等不属于任何子程序
      const item: VarSummaryItem = ln.type === 'subParam'
        ? {
            name: (ln.fields[0] || '').trim(),
            typeName: (ln.fields[1] || '').trim() || '整数型',
            arrayText: (ln.fields[2] || '').includes('数组') ? '数组' : '',
            lineIndex: i,
            isParam: true,
          }
        : mkVar(i, ln.fields)
      const list = varsBySub.get(sub.name)
      if (list) list.push(item)
      else varsBySub.set(sub.name, [item])
    }

    const groups: VarSummaryGroup[] = []
    if (globalVars.length > 0) {
      groups.push({ key: 'global', title: '全局变量', items: globalVars.filter(matches), total: globalVars.length })
    }
    groups.push({ key: 'assembly', title: '程序集变量', items: assemblyVars.filter(matches), total: assemblyVars.length })
    const seenSubNames = new Set<string>()
    for (const range of subFoldRanges) {
      if (seenSubNames.has(range.name)) continue  // 重名子程序：变量已并入首个同名组
      seenSubNames.add(range.name)
      const all = varsBySub.get(range.name)
      if (!all || all.length === 0) continue  // 无变量的子程序不占面板
      const items = all.filter(matches)
      if (query && items.length === 0) continue  // 搜索时隐藏无匹配的子程序组
      groups.push({
        key: `sub:${range.name}`,
        title: range.name,
        items,
        total: all.length,
        isCurrentSub: varPanelCurrentSub?.name === range.name,
      })
    }
    return groups
  }, [parsedLines, subFoldRanges, varPanelCurrentSub, varPanelQuery])

  const handleVarPanelItemClick = useCallback((lineIndex: number) => {
    expandSubContainingLine(lineIndex)
    setSelectedLines(new Set([lineIndex]))
    // 折叠展开后目标行可能尚未渲染，下一拍再滚动定位
    window.setTimeout(() => scrollToLineIndex(lineIndex, 'auto'), 0)
  }, [expandSubContainingLine, scrollToLineIndex])

  const visibleBlocks = useMemo(() => {
    const result: RenderBlock[] = []
    // 正在编辑流程头（退格清空/改动其关键字）期间，其配对标记会瞬时变孤立、闪现出「否则/各种结束」并把流程线画到
    // 下方别的结构去。此时一律保持这些隐藏标记继续隐藏，等提交溶解时随结构一并消失（都溶解了也就不需要流程线）。
    const editingFlowHead = editCell != null && wasFlowStartRef.current
    for (const blk of blocks) {
      if (blk.kind === 'codeline' && blk.codeLine) {
        const kw = extractFlowKw(blk.codeLine)
        if (kw && TABLE_MODE_HIDDEN_FLOW_COMMANDS.has(kw)) {
          // 只隐藏真正配对成功的流程行（该行在流程模型里有对应的 branch/end 段）。
          // 孤立/未配对的分支与结束行保持可见——否则文件里的行会在界面上凭空消失
          //（如 "如果真" 里误写 "否则"、没有匹配起始的 "如果结束"）。但编辑流程头期间的孤立是瞬时的，保持隐藏。
          const segs = flowLines.map.get(blk.lineIndex) || []
          const paired = (kw === '否则' || kw === '默认')
            ? segs.some(seg => seg.type === 'branch')
            : segs.some(seg => seg.type === 'end')
          if (paired || editingFlowHead) continue
        }
      }
      // 折叠的子程序：声明块只保留声明行（表头+子程序名行），范围内其余块全部隐藏
      const owningRange = collapsedSubRanges.find(range => blk.lineIndex > range.startLine && blk.lineIndex <= range.endLine)
      if (owningRange) continue
      if (blk.kind === 'table' && blk.tableType === 'sub') {
        const ownRange = collapsedSubRanges.find(range => range.startLine === blk.lineIndex)
        if (ownRange) {
          result.push({ ...blk, rows: blk.rows.filter(row => row.lineIndex === ownRange.startLine) })
          continue
        }
      }
      result.push(blk)
    }
    return result
  }, [blocks, collapsedSubRanges, flowLines, editCell])

  const visibleCodeLineIndexes = useMemo(() => {
    const indexes = new Set<number>()
    for (const blk of visibleBlocks) {
      if (blk.kind === 'codeline') indexes.add(blk.lineIndex)
    }
    return indexes
  }, [visibleBlocks])

  const displayFlowLines = useMemo(() => {
    const map = new Map<number, FlowSegment[]>()
    for (const [lineIndex, segs] of flowLines.map.entries()) {
      map.set(lineIndex, segs.map(seg => ({ ...seg })))
    }

    const visibleCodeLineSet = new Set<number>()
    for (const blk of visibleBlocks) {
      if (blk.kind === 'codeline') visibleCodeLineSet.add(blk.lineIndex)
    }

    const maxLineIndex = Math.max(lines.length - 1, 0)

    const findPrevVisibleCodeLine = (from: number): number | null => {
      for (let li = from; li >= 0; li--) {
        if (visibleCodeLineSet.has(li)) return li
      }
      return null
    }

    const findNextVisibleCodeLine = (from: number): number | null => {
      for (let li = from; li <= maxLineIndex; li++) {
        if (visibleCodeLineSet.has(li)) return li
      }
      return null
    }

    const hasDepthSegAtLine = (lineIndex: number, depth: number): boolean => {
      const segs = map.get(lineIndex) || []
      return segs.some(seg => seg.depth === depth)
    }

    const findPrevVisibleCodeLineAtDepth = (from: number, depth: number): number | null => {
      for (let li = from; li >= 0; li--) {
        if (!visibleCodeLineSet.has(li)) continue
        if (hasDepthSegAtLine(li, depth)) return li
      }
      return null
    }

    const findNextVisibleCodeLineAtDepth = (from: number, depth: number, endExclusive?: number): number | null => {
      const limit = endExclusive == null ? maxLineIndex + 1 : Math.min(endExclusive, maxLineIndex + 1)
      for (let li = from; li < limit; li++) {
        if (!visibleCodeLineSet.has(li)) continue
        if (hasDepthSegAtLine(li, depth)) return li
      }
      return null
    }

    for (const blk of blocks) {
      if (blk.kind !== 'codeline' || !blk.codeLine) continue
      const kw = extractFlowKw(blk.codeLine)
      if (kw !== '否则' && kw !== '默认') continue
      if (visibleCodeLineSet.has(blk.lineIndex)) continue

      const hiddenLineSegs = map.get(blk.lineIndex) || []
      const branchSegs = hiddenLineSegs.filter(seg => seg.type === 'branch')
      if (branchSegs.length === 0) continue

      const prevVisibleFallback = findPrevVisibleCodeLine(blk.lineIndex - 1)
      const nextVisibleFallback = findNextVisibleCodeLine(blk.lineIndex + 1)

      for (const branchSeg of branchSegs) {
        let flowEndLine: number | null = null
        for (let li = blk.lineIndex + 1; li <= maxLineIndex; li++) {
          const segsAtLine = map.get(li) || []
          if (segsAtLine.some(seg => seg.depth === branchSeg.depth && seg.type === 'end')) {
            flowEndLine = li
            break
          }
        }

        const prevVisibleLine = findPrevVisibleCodeLineAtDepth(blk.lineIndex - 1, branchSeg.depth) ?? prevVisibleFallback
        // 空分支区（否则/默认 与 结束行 之间无可见同深度行，如 autocomplete 刚生成骨架尚未填内容）：
        // 主查找（受 flowEndLine 边界约束）返回 null 时，不能回退到无边界的 nextVisibleFallback——它会越过
        // flowEndLine 落到结构之外的行上，画出一条指向结构外命令的幽灵分支箭头。仅当回退目标仍在结构内
        //（< flowEndLine；结构未闭合 flowEndLine==null 时保持原行为）才锚定外侧结束横线。
        const nextVisibleAtDepth = findNextVisibleCodeLineAtDepth(blk.lineIndex + 1, branchSeg.depth, flowEndLine ?? undefined)
        const boundedNextFallback = (nextVisibleFallback != null && (flowEndLine == null || nextVisibleFallback < flowEndLine))
          ? nextVisibleFallback
          : null
        const nextVisibleLine = nextVisibleAtDepth ?? boundedNextFallback

        let lastVisibleFlowLine: number | null = null
        if (flowEndLine != null) {
          for (let li = flowEndLine - 1; li >= blk.lineIndex + 1; li--) {
            if (visibleCodeLineSet.has(li) && hasDepthSegAtLine(li, branchSeg.depth)) {
              lastVisibleFlowLine = li
              break
            }
          }
        }

        // 隐藏分支命令后：把内侧起始横线锚到“否则/默认”的上一条可见命令行。
        if (prevVisibleLine != null) {
          const prevSegs = map.get(prevVisibleLine) || []
          const sameDepth = prevSegs.find(seg => seg.depth === branchSeg.depth)
          if (sameDepth) {
            sameDepth.hasInnerLink = true
          } else {
            prevSegs.push({
              depth: branchSeg.depth,
              type: 'through',
              isLoop: branchSeg.isLoop,
              flowKind: branchSeg.flowKind,
              hasInnerLink: true,
            })
          }
          map.set(prevVisibleLine, prevSegs)
        }

        // 内侧线延续：从“否则/默认”上一条可见命令向下到该流程块最后一条可见命令，并在末端加下箭头。
        // 若该流程末端紧接同深度新流程（end.hasNextFlow），则末端的下箭头改为“连通”而不绘制三角箭头。
        let endConnected = false
        if (flowEndLine != null) {
          const endSegsAtFlowEnd = map.get(flowEndLine) || []
          endConnected = endSegsAtFlowEnd.some(seg => seg.depth === branchSeg.depth && seg.type === 'end' && !!seg.hasNextFlow)
        }
        if (prevVisibleLine != null && lastVisibleFlowLine != null && lastVisibleFlowLine >= prevVisibleLine) {
          for (let li = prevVisibleLine; li <= lastVisibleFlowLine; li++) {
            if (!visibleCodeLineSet.has(li)) continue
            const segsAtLine = map.get(li) || []
            const sameDepthSegs = segsAtLine.filter(seg => seg.depth === branchSeg.depth)
            if (sameDepthSegs.length > 0) {
              for (const sameDepth of sameDepthSegs) {
                sameDepth.hasInnerVert = true
                if (li > prevVisibleLine) sameDepth.hasInnerVertFromAbove = true
                if (li === lastVisibleFlowLine) {
                  sameDepth.hasInnerVertEnd = true
                  if (endConnected) sameDepth.hasInnerVertEndConnected = true
                }
              }
            } else {
              segsAtLine.push({
                depth: branchSeg.depth,
                type: 'through',
                isLoop: branchSeg.isLoop,
                flowKind: branchSeg.flowKind,
                hasInnerVert: true,
                hasInnerVertFromAbove: li > prevVisibleLine ? true : undefined,
                hasInnerVertEnd: li === lastVisibleFlowLine,
                hasInnerVertEndConnected: li === lastVisibleFlowLine && endConnected ? true : undefined,
              })
            }
            map.set(li, segsAtLine)
          }
        }

        // 隐藏分支命令后：把外侧结束横线锚到“否则/默认”的下一条可见命令行。
        if (nextVisibleLine != null) {
          const nextSegs = map.get(nextVisibleLine) || []
          nextSegs.push({
            depth: branchSeg.depth,
            type: 'branch',
            isLoop: branchSeg.isLoop,
            flowKind: branchSeg.flowKind,
          })
          map.set(nextVisibleLine, nextSegs)
        }

        // 外侧线只到结束横线：否则/默认区后续可见行不再绘制该深度的外侧竖线。
        if (nextVisibleLine != null && lastVisibleFlowLine != null && lastVisibleFlowLine > nextVisibleLine) {
          // 若同深度在结束横线处（或其后）开启了新流程，则 suppress 只应作用到新流程开始之前。
          let suppressEndLine = lastVisibleFlowLine
          for (let li = nextVisibleLine; li <= lastVisibleFlowLine; li++) {
            if (!visibleCodeLineSet.has(li)) continue
            const segsAtLine = map.get(li) || []
            if (segsAtLine.some(seg => seg.depth === branchSeg.depth && seg.type === 'start')) {
              suppressEndLine = li - 1
              break
            }
          }

          for (let li = nextVisibleLine + 1; li <= suppressEndLine; li++) {
            if (!visibleCodeLineSet.has(li)) continue
            const segsAtLine = map.get(li) || []
            const sameDepth = segsAtLine.find(seg => seg.depth === branchSeg.depth)
            if (sameDepth) {
              if (sameDepth.type === 'through') {
                sameDepth.suppressOuter = true
              }
            } else {
              segsAtLine.push({
                depth: branchSeg.depth,
                type: 'through',
                isLoop: branchSeg.isLoop,
                flowKind: branchSeg.flowKind,
                suppressOuter: true,
              })
            }
            map.set(li, segsAtLine)
          }
        }
      }
    }

    // suppressOuter 仅对 through 生效，清理其他类型上的残留标记，避免 start/branch 外侧线被误隐藏。
    for (const [lineIndex, segsAtLine] of map.entries()) {
      let changed = false
      const normalized = segsAtLine.map(seg => {
        if (seg.type !== 'through' && seg.suppressOuter) {
          changed = true
          const { suppressOuter: _drop, ...rest } = seg
          return rest
        }
        return seg
      })
      if (changed) map.set(lineIndex, normalized)
    }

    const hasEndBetweenLinesAtDepth = (fromExclusive: number, toExclusive: number, depth: number): boolean => {
      const start = Math.max(0, fromExclusive + 1)
      const end = Math.min(maxLineIndex, toExclusive - 1)
      if (end < start) return false
      for (let li = start; li <= end; li++) {
        const segs = map.get(li) || []
        if (segs.some(seg => seg.depth === depth && seg.type === 'end')) return true
      }
      return false
    }

    // hasPrevFlowEnd 在隐藏命令后的重映射中可能失效：
    // 若前一可见行不是 end，但两行之间存在被隐藏的同深度 end（如“判断结束”），也应保留。
    for (const [lineIndex, segsAtLine] of map.entries()) {
      let changed = false
      const prevVisibleLine = findPrevVisibleCodeLine(lineIndex - 1)
      const prevSegs = prevVisibleLine != null ? (map.get(prevVisibleLine) || []) : []
      const normalized = segsAtLine.map(seg => {
        if (seg.type !== 'start' || !seg.hasPrevFlowEnd) return seg
        const hasRealPrevEnd = prevSegs.some(prev => prev.depth === seg.depth && prev.type === 'end')
        if (hasRealPrevEnd) return seg
        const hasHiddenPrevEnd = hasEndBetweenLinesAtDepth(prevVisibleLine ?? -1, lineIndex, seg.depth)
        if (hasHiddenPrevEnd) return seg
        changed = true
        const { hasPrevFlowEnd: _drop, ...rest } = seg
        return rest
      })
      if (changed) map.set(lineIndex, normalized)
    }

    // 判断命令同一行若同时出现 branch+start，视为同流程区衔接：
    // 保证下一可见行存在同深度 through，且不抑制外侧线。
    for (const [lineIndex, segsAtLine] of map.entries()) {
      const judgeStarts = segsAtLine.filter(seg => seg.type === 'start' && seg.flowKind === 'judge')
      if (judgeStarts.length === 0) continue

      for (const startSeg of judgeStarts) {
        const hasJudgeBranchSameDepth = segsAtLine.some(seg => (
          seg.type === 'branch' &&
          seg.depth === startSeg.depth &&
          seg.flowKind === 'judge'
        ))
        if (!hasJudgeBranchSameDepth) continue

        // “判断”行同时承担 branch+start 时：
        // 内侧起始横线应锚到“判断”上一可见行，并让内侧竖线从该行向下贯穿“判断”行。
        const prevVisibleLineAtDepth = findPrevVisibleCodeLineAtDepth(lineIndex - 1, startSeg.depth)
          ?? findPrevVisibleCodeLine(lineIndex - 1)
        if (prevVisibleLineAtDepth != null && prevVisibleLineAtDepth <= lineIndex) {
          const prevSegs = map.get(prevVisibleLineAtDepth) || []
          const prevSameDepthSegs = prevSegs.filter(seg => seg.depth === startSeg.depth)
          if (prevSameDepthSegs.length > 0) {
            for (const seg of prevSameDepthSegs) seg.hasInnerLink = true
          } else {
            prevSegs.push({
              depth: startSeg.depth,
              type: 'through',
              isLoop: startSeg.isLoop,
              flowKind: startSeg.flowKind,
              hasInnerLink: true,
            })
          }
          map.set(prevVisibleLineAtDepth, prevSegs)

          for (let li = prevVisibleLineAtDepth; li <= lineIndex; li++) {
            if (!visibleCodeLineSet.has(li)) continue
            const segsAtLi = map.get(li) || []
            const sameDepthSegs = segsAtLi.filter(seg => seg.depth === startSeg.depth)
            if (sameDepthSegs.length > 0) {
              for (const seg of sameDepthSegs) {
                seg.hasInnerVert = true
                if (li > prevVisibleLineAtDepth) seg.hasInnerVertFromAbove = true
              }
            } else {
              segsAtLi.push({
                depth: startSeg.depth,
                type: 'through',
                isLoop: startSeg.isLoop,
                flowKind: startSeg.flowKind,
                hasInnerVert: true,
                hasInnerVertFromAbove: li > prevVisibleLineAtDepth ? true : undefined,
              })
            }
            map.set(li, segsAtLi)
          }
        }

        // 「判断」case 行之后 body 多行时的内侧线向下延续：
        // 上方循环只标到 case 行、隐藏默认的延续段只从「默认的上一可见行」开始标，
        // body 多于一行时中间行两段都不覆盖 → 内侧竖线在 case 下一行断开。
        // 这里从 case 行的下一可见行起逐行补 hasInnerVert，直到接上已标记的锚行
        // （默认/下一 case 的上一可见行）或遇到同深度的下一 case/结束边界为止。
        {
          let li = lineIndex + 1
          while (li < lines.length) {
            if (!visibleCodeLineSet.has(li)) { li++; continue }
            const segsAtLi = map.get(li) || []
            const sameDepthSegs = segsAtLi.filter(seg => seg.depth === startSeg.depth)
            if (sameDepthSegs.length === 0) break // 已出结构范围
            // 下一 case / 结束 / 新起始：边界，交给它们自己的衔接逻辑
            if (sameDepthSegs.some(seg => seg.type === 'branch' || seg.type === 'start' || seg.type === 'end')) break
            // 已被隐藏默认的延续段标记：链路接上，停止
            if (sameDepthSegs.every(seg => seg.hasInnerVert)) break
            for (const seg of sameDepthSegs) {
              seg.hasInnerVert = true
              seg.hasInnerVertFromAbove = true
            }
            map.set(li, segsAtLi)
            li++
          }
        }

        const nextVisibleLine = findNextVisibleCodeLine(lineIndex + 1)
        if (nextVisibleLine == null) continue

        const nextSegs = map.get(nextVisibleLine) || []
        const sameDepth = nextSegs.find(seg => seg.depth === startSeg.depth)
        if (!sameDepth) {
          nextSegs.push({
            depth: startSeg.depth,
            type: 'through',
            isLoop: startSeg.isLoop,
            flowKind: startSeg.flowKind,
          })
          map.set(nextVisibleLine, nextSegs)
          continue
        }

        if (sameDepth.type === 'through' && sameDepth.suppressOuter) {
          const { suppressOuter: _drop, ...rest } = sameDepth
          const nextNormalized = nextSegs.map(seg => seg === sameDepth ? rest : seg)
          map.set(nextVisibleLine, nextNormalized)
        }
      }
    }

    // 隐藏“如果真结束”后：将结束锚到上一条可见同深度命令行，保留结束向下三角箭头。
    for (const blk of blocks) {
      if (blk.kind !== 'codeline' || !blk.codeLine) continue
      const kw = extractFlowKw(blk.codeLine)
      if (kw !== '如果真结束') continue
      if (visibleCodeLineSet.has(blk.lineIndex)) continue

      const hiddenEndSegs = (map.get(blk.lineIndex) || []).filter(seg => seg.type === 'end' && seg.flowKind === 'ifTrue')
      if (hiddenEndSegs.length === 0) continue

      for (const endSeg of hiddenEndSegs) {
        // 桥接到下一如果真：不画向下三角，改由下一如果真起始行的 hasPrevFlowEnd 画向下拐+右指命令的连接箭头。
        if (endSeg.hasNextFlow) continue
        const prevVisibleLine = findPrevVisibleCodeLineAtDepth(blk.lineIndex - 1, endSeg.depth)
        if (prevVisibleLine == null) continue

        const prevSegs = map.get(prevVisibleLine) || []
        const sameDepthSeg = prevSegs.find(seg => seg.depth === endSeg.depth)
        if (sameDepthSeg) {
          sameDepthSeg.endArrowOnly = true
        } else {
          prevSegs.push({
            depth: endSeg.depth,
            type: 'through',
            isLoop: endSeg.isLoop,
            flowKind: endSeg.flowKind,
            endArrowOnly: true,
          })
        }
        map.set(prevVisibleLine, prevSegs)
      }
    }

    // 自动推导“从上方连下来的内侧竖线”：
    // 若同深度上一可见行已存在且仍延续内侧竖线，则当前行应显示内侧竖线的上半段。
    for (const [lineIndex, segsAtLine] of map.entries()) {
      let changed = false
      const normalized = segsAtLine.map(seg => {
        if (!seg.hasInnerVert) return seg
        const prevVisibleAtDepth = findPrevVisibleCodeLineAtDepth(lineIndex - 1, seg.depth)
        if (prevVisibleAtDepth == null) return seg
        const prevSegs = map.get(prevVisibleAtDepth) || []
        const hasPrevInnerContinuation = prevSegs.some(prev => (
          prev.depth === seg.depth &&
          !!prev.hasInnerVert &&
          !prev.hasInnerVertEnd
        ))
        if (!hasPrevInnerContinuation || seg.hasInnerVertFromAbove) return seg
        changed = true
        return { ...seg, hasInnerVertFromAbove: true }
      })
      if (changed) map.set(lineIndex, normalized)
    }

    return {
      map,
      maxDepth: flowLines.maxDepth,
    }
  }, [blocks, flowLines, lines.length, visibleBlocks])

  blocksRef.current = visibleBlocks

  const stickySubTableMeta = useMemo(() => {
    type StickyMeta = typeof subTableMetaRef.current[number]
    const subTables = visibleBlocks.filter((blk): blk is RenderBlock & { kind: 'table'; tableType: 'sub' } => blk.kind === 'table' && blk.tableType === 'sub')
    const starts = subTables.map(blk => {
      const dataLines = Array.from(new Set(
        blk.rows
          .filter(row => !row.isHeader)
          .map(row => row.lineIndex)
          .filter(li => Number.isFinite(li) && li >= 0)
      ))
      return dataLines.length > 0 ? Math.min(...dataLines) : -1
    })

    const list: StickyMeta[] = []
    for (let idx = 0; idx < subTables.length; idx++) {
      const blk = subTables[idx]
      const startLine = starts[idx]
      if (startLine < 0) continue

      const nextStartLine = starts.slice(idx + 1).find(li => li >= 0) ?? null
      const rows: StickyMeta['rows'] = blk.rows.map(row => ({
        lineIndex: row.lineIndex,
        isHeader: !!row.isHeader,
        cells: row.cells.map(cell => ({
          text: cell.text,
          cls: cell.cls,
          colSpan: cell.colSpan,
          align: cell.align,
          fieldIdx: cell.fieldIdx,
          sliceField: cell.sliceField,
        })),
      }))
      if (rows.length === 0) continue

      const colCount = Math.max(
        ...rows.map(row => row.cells.reduce((sum, cell) => sum + (cell.colSpan || 1), 0)),
        1,
      )

      list.push({
        startLine,
        nextStartLine,
        colCount,
        rows,
      })
    }
    return list
  }, [visibleBlocks])

  subTableMetaRef.current = stickySubTableMeta

  // 每个删除锚点的被删原文按行拆开：占位行按被删行数逐行渲染（无记录的锚点回退单行空占位）
  const diffDeletedLinesByAnchor = useMemo(() => {
    const map = new Map<number, string[]>()
    for (const anchor of diffDeletedAfterLines) {
      const text = diffDeletedTextAfterLines?.get(anchor)
      const lines = text ? text.replace(/\r\n/g, '\n').split('\n') : ['']
      map.set(anchor, lines.length > 0 ? lines : [''])
    }
    return map
  }, [diffDeletedAfterLines, diffDeletedTextAfterLines])

  const tableRenderMetaByBlockIndex = useMemo(() => {
    type TableRenderRow = {
      row: RenderBlock['rows'][number]
      ri: number
      isDeletedPlaceholder: boolean
      deletedText?: string
    }

    const map = new Map<number, {
      tableLineIndices: number[]
      tableColCount: number
      tableRenderRowsAll: TableRenderRow[]
    }>()

    for (let bi = 0; bi < visibleBlocks.length; bi++) {
      const blk = visibleBlocks[bi]
      if (blk.kind !== 'table') continue

      const tableLineIndices = blk.rows.filter(r => !r.isHeader).map(r => r.lineIndex)
      const tableColCount = Math.max(1, blk.rows[0]?.cells.reduce((sum, cell) => sum + (cell.colSpan || 1), 0) || 1)
      const tableRenderRowsAll = blk.rows.flatMap((row, ri) => {
        const rows: TableRenderRow[] = [{ row, ri, isDeletedPlaceholder: false }]
        if (!row.isHeader) {
          const deletedLines = diffDeletedLinesByAnchor.get(row.lineIndex)
          if (deletedLines) {
            for (const deletedText of deletedLines) {
              rows.push({ row, ri, isDeletedPlaceholder: true, deletedText })
            }
          }
        }
        return rows
      })

      map.set(bi, { tableLineIndices, tableColCount, tableRenderRowsAll })
    }

    return map
  }, [visibleBlocks, diffDeletedLinesByAnchor])

  const codeRenderMetaCacheRef = useRef(new Map<number, {
    signature: string
    codeLineRaw: string
    spans: Array<{ text: string; cls: string; swatch?: string }>
    lineCmd: CompletionItem | null
    assignDetail: ReturnType<typeof parseAssignmentDetail>
    hasExpandableDetail: boolean
  }>())

  useEffect(() => {
    codeRenderMetaCacheRef.current.clear()
  }, [visibleBlocks, classMethodMap])

  const getCodeRenderMeta = useCallback((blockIndex: number, blk: RenderBlock) => {
    const codeLineRaw = blk.codeLine || ''
    const signature = `${blk.isVirtual ? 1 : 0}|${codeLineRaw}`
    const cached = codeRenderMetaCacheRef.current.get(blockIndex)
    if (cached && cached.signature === signature) return cached

    const normalizedCodeLine = codeLineRaw.replace(FLOW_AUTO_TAG, '')
    const spans = colorize(normalizedCodeLine)
    let lineCmd: CompletionItem | null = null
    if (!blk.isVirtual) {
      for (const span of spans) {
        if (span.cls === 'funccolor' || span.cls === 'comecolor') {
          // 判断结构首行源码关键字为 判断开始，按 判断 命令查找参数（显示别名一致）
          const lookupName = span.text === '判断开始' ? '判断' : span.text
          const candidate = allCommandsRef.current.find(c => c.name === lookupName)
            || dllCompletionItemsRef.current.find(c => c.name === lookupName)
          if (candidate && candidate.params.length > 0) {
            lineCmd = candidate
            break
          }
        }
        // 对象.方法（项目类公开方法）同样支持参数展开
        if (span.cls === 'funccolor' || span.cls === 'cometwolr') {
          const clsMethod = findProjectClassMethodByName(span.text)
          if (clsMethod && clsMethod.params.length > 0) {
            lineCmd = clsMethod
            break
          }
        }
      }
    }
    const assignDetail = blk.isVirtual ? null : parseAssignmentDetail(normalizedCodeLine)
    const nextMeta = {
      signature,
      codeLineRaw,
      spans,
      lineCmd,
      assignDetail,
      hasExpandableDetail: !!lineCmd || !!assignDetail,
    }
    codeRenderMetaCacheRef.current.set(blockIndex, nextMeta)
    return nextMeta
  }, [])

  const lineMarkerTypeMap = useMemo(() => {
    type MarkerType = 'none' | 'error' | 'added' | 'edited'
    const map = new Map<number, MarkerType>()

    for (const lineIndex of diagnosticsErrorLines) {
      if (lineIndex >= 0) map.set(lineIndex, 'error')
    }

    const applyIfNotError = (lineIndex: number, marker: MarkerType): void => {
      if (lineIndex < 0) return
      if (map.get(lineIndex) === 'error') return
      map.set(lineIndex, marker)
    }

    for (const lineIndex of diffAddedLines) applyIfNotError(lineIndex, 'added')
    for (const lineIndex of diffEditedLines) applyIfNotError(lineIndex, 'edited')
    if (diffHighlightLines) {
      for (const lineIndex of diffHighlightLines) {
        if (!map.has(lineIndex)) applyIfNotError(lineIndex, 'edited')
      }
    }

    return map
  }, [diagnosticsErrorLines, diffAddedLines, diffEditedLines, diffHighlightLines])

  // 为指定行生成 diff 相关的 CSS 类后缀（含前导空格）。
  // - added: 绿色；edited: 蓝色
  // 删除行通过独立占位行渲染，不再依赖 deleted-anchor 细线。
  // added/edited 互斥，diffHighlightLines 视为 added 的后备（保留旧行为）。
  const diffClassSuffixFor = useCallback((lineIndex: number): string => {
    if (lineIndex < 0) return ''
    const isEdited = diffEditedLines.has(lineIndex)
    const isAdded = !isEdited && (diffAddedLines.has(lineIndex) || (diffHighlightLines?.has(lineIndex) ?? false))
    const parts: string[] = []
    if (isAdded || isEdited) parts.push('eyc-diff-highlight')
    if (isEdited) parts.push('eyc-diff-edited')
    else if (isAdded) parts.push('eyc-diff-added')
    return parts.length > 0 ? ' ' + parts.join(' ') : ''
  }, [diffAddedLines, diffEditedLines, diffHighlightLines])

  const minimapPreviewRows = useMemo(() => {
    type MiniTableCell = { text: string; cls: string }
    type MiniMarker = 'none' | 'error' | 'added' | 'edited' | 'deleted'
    type MiniRow =
      | { kind: 'table'; cells: MiniTableCell[]; lineIndex: number; marker: MiniMarker }
      | { kind: 'code'; spans: Array<{ text: string; cls: string }>; lineIndex: number; marker: MiniMarker }
      | { kind: 'deleted'; marker: 'deleted' }
    // 先收集不着色的行描述，待采样出最终展示的 ≤260 行后再 colorize，
    // 避免每次文本变化都对全文档所有代码行做语法着色。
    type MiniSourceRow =
      | { kind: 'table'; cells: MiniTableCell[]; lineIndex: number; marker: MiniMarker }
      | { kind: 'code'; codeText: string; lineIndex: number; marker: MiniMarker }
      | { kind: 'deleted'; marker: 'deleted' }

    if (!shouldShowMinimapPreview) return []

    const resolveMarker = (lineIndex: number): MiniMarker => {
      if (lineIndex < 0) return 'none'
      const marker = lineMarkerTypeMap.get(lineIndex)
      if (marker && marker !== 'none') return marker
      return 'none'
    }

    const sourceRows: MiniSourceRow[] = []
    for (const blk of visibleBlocks) {
      if (blk.kind === 'table') {
        for (const row of blk.rows) {
          if (row.isHeader) continue
          const cells = row.cells
            .map(cell => ({
              text: (cell.text || '').replace(/\u00A0/g, ' ').trim() || ' ',
              cls: cell.cls || '',
            }))
          sourceRows.push({
            kind: 'table',
            lineIndex: row.lineIndex,
            marker: resolveMarker(row.lineIndex),
            cells: cells.length > 0 ? cells : [{ text: ' ', cls: '' }],
          })
          for (let di = 0; di < (diffDeletedLinesByAnchor.get(row.lineIndex)?.length || 0); di++) {
            sourceRows.push({ kind: 'deleted', marker: 'deleted' })
          }
        }
        continue
      }
      const codeText = (blk.codeLine || '')
        .replace(FLOW_AUTO_TAG, '')
        .replace(/\u200B/g, '')
      sourceRows.push({
        kind: 'code',
        lineIndex: blk.lineIndex,
        marker: resolveMarker(blk.lineIndex),
        codeText,
      })
      for (let di = 0; di < (diffDeletedLinesByAnchor.get(blk.lineIndex)?.length || 0); di++) {
        sourceRows.push({ kind: 'deleted', marker: 'deleted' })
      }
    }

    const toMiniRow = (row: MiniSourceRow): MiniRow => {
      if (row.kind !== 'code') return row
      const spans = colorize(row.codeText)
      const displaySpans = spans.map(s => {
        if (shouldAliasJudgeStartInTableMode && s.cls === 'comecolor' && s.text === '判断开始') {
          return { ...s, text: '判断' }
        }
        return s
      })
      return {
        kind: 'code',
        lineIndex: row.lineIndex,
        marker: row.marker,
        spans: displaySpans.length > 0 ? displaySpans.map(s => ({ text: s.text || ' ', cls: s.cls || '' })) : [{ text: ' ', cls: '' }],
      }
    }

    const total = Math.max(sourceRows.length, 1)
    const count = Math.max(1, Math.min(total, 260))
    return Array.from({ length: count }, (_, i) => {
      const start = Math.floor((i * total) / count)
      const end = Math.max(start + 1, Math.floor(((i + 1) * total) / count))
      const mid = Math.min(Math.max(Math.floor((start + end) / 2), 0), total - 1)
      const src = sourceRows[mid]
      return src ? toMiniRow(src) : { kind: 'code' as const, lineIndex: -1, marker: 'none' as const, spans: [{ text: ' ', cls: '' }] }
    })
  }, [visibleBlocks, diffDeletedLinesByAnchor, lineMarkerTypeMap, shouldShowMinimapPreview])

  // 对实际渲染的可见行按顺序分配连续行号（跳过 isHeader / isVirtual）
  // 注意：表格内可能存在多个可见行映射到同一源码 lineIndex（如 DLL 命令块），
  // 行号显示应按“可见行”递增，而不是按源码行号去重。
  const lineNumMaps = useMemo(() => {
    const tableRowNumMap = new Map<string, number>()
    const codeLineNumMap = new Map<number, number>()
    const sourceLineNumMap = new Map<number, number>()
    let display = 0
    for (let bi = 0; bi < visibleBlocks.length; bi++) {
      const blk = visibleBlocks[bi]
      if (blk.kind === 'table') {
        for (let ri = 0; ri < blk.rows.length; ri++) {
          const row = blk.rows[ri]
          if (row.isHeader) continue
          display++
          tableRowNumMap.set(`${bi}:${ri}`, display)
          sourceLineNumMap.set(row.lineIndex, display)
        }
      } else {
        if (!blk.isVirtual) {
          display++
          codeLineNumMap.set(blk.lineIndex, display)
          sourceLineNumMap.set(blk.lineIndex, display)
        }
      }
    }
    return { tableRowNumMap, codeLineNumMap, sourceLineNumMap }
  }, [visibleBlocks])

  const blockLineSpans = useMemo(() => {
    if (visibleBlocks.length === 0) {
      return [] as Array<{ startLine: number; endLine: number; visualRows: number }>
    }
    return visibleBlocks.map((blk) => {
      if (blk.kind === 'table') {
        const dataRows = blk.rows.filter(row => !row.isHeader)
        const lineIndices = dataRows.map(row => row.lineIndex).filter(li => Number.isFinite(li) && li >= 0)
        const startLine = lineIndices.length > 0 ? Math.min(...lineIndices) : 0
        const endLine = lineIndices.length > 0 ? Math.max(...lineIndices) : startLine
        const deletedPlaceholderCount = dataRows.reduce((count, row) => count + (diffDeletedLinesByAnchor.get(row.lineIndex)?.length || 0), 0)
        const visualRows = Math.max(dataRows.length + deletedPlaceholderCount, 1)
        return { startLine, endLine, visualRows }
      }

      const lineIndex = Number.isFinite(blk.lineIndex) && blk.lineIndex >= 0 ? blk.lineIndex : 0
      const visualRows = 1 + (diffDeletedLinesByAnchor.get(blk.lineIndex)?.length || 0)
      return { startLine: lineIndex, endLine: lineIndex, visualRows }
    })
  }, [visibleBlocks, diffDeletedLinesByAnchor])

  const blockVirtualWindow = useMemo(() => {
    const approxRowPx = Math.max(editorLineHeight + 6, 22)
    if (blockLineSpans.length === 0) {
      return {
        startBlockIndex: 0,
        endBlockIndex: -1,
        leadingSpacerPx: 0,
        trailingSpacerPx: 0,
      }
    }

    const startBlockIndex = Math.max(0, blockLineSpans.findIndex(span => span.endLine >= visibleLineWindow.startLine))
    let endBlockIndex = blockLineSpans.length - 1
    for (let i = startBlockIndex; i < blockLineSpans.length; i++) {
      if (blockLineSpans[i].startLine > visibleLineWindow.endLine) {
        endBlockIndex = Math.max(startBlockIndex, i - 1)
        break
      }
    }

    const leadingRows = blockLineSpans.slice(0, startBlockIndex).reduce((sum, span) => sum + span.visualRows, 0)
    const trailingRows = blockLineSpans.slice(endBlockIndex + 1).reduce((sum, span) => sum + span.visualRows, 0)

    return {
      startBlockIndex,
      endBlockIndex,
      leadingSpacerPx: leadingRows * approxRowPx,
      trailingSpacerPx: trailingRows * approxRowPx,
    }
  }, [blockLineSpans, editorLineHeight, visibleLineWindow])

  const scrollbarStatusMarkers = useMemo(() => {
    type MarkerType = 'error' | 'added' | 'edited' | 'deleted'
    type MarkerSeg = { topRatio: number; heightRatio: number; type: MarkerType }
    const sourceMap = lineNumMaps.sourceLineNumMap
    let maxDisplay = 0
    for (const val of sourceMap.values()) {
      if (val > maxDisplay) maxDisplay = val
    }
    const total = Math.max(maxDisplay, 1)
    const sourceLinesByType = new Map<MarkerType, Set<number>>([
      ['error', new Set<number>()],
      ['added', new Set<number>()],
      ['edited', new Set<number>()],
      ['deleted', new Set<number>()],
    ])

    const toSegment = (startLine: number, endLine: number, type: MarkerType): MarkerSeg => {
      if (total <= 1) return { topRatio: 0, heightRatio: 1, type }
      const topRatio = Math.min(Math.max((startLine - 1) / total, 0), 1)
      const bottomRatio = Math.min(Math.max(endLine / total, 0), 1)
      const minRatio = 1 / Math.max(total, 240)
      const heightRatio = Math.max(bottomRatio - topRatio, minRatio)
      return { topRatio, heightRatio: Math.min(heightRatio, 1 - topRatio), type }
    }

    const buildTypeSegments = (type: MarkerType): MarkerSeg[] => {
      const set = sourceLinesByType.get(type)
      if (!set || set.size === 0) return []
      const lines = [...set].sort((a, b) => a - b)
      const segs: MarkerSeg[] = []
      let start = lines[0]
      let prev = lines[0]
      const pushSourceSegment = (startLine: number, endLine: number): void => {
        let startDisplay = Number.POSITIVE_INFINITY
        let endDisplay = Number.NEGATIVE_INFINITY
        for (let sourceLine = startLine; sourceLine <= endLine; sourceLine++) {
          const displayLine = sourceMap.get(sourceLine)
          if (!displayLine) continue
          if (displayLine < startDisplay) startDisplay = displayLine
          if (displayLine > endDisplay) endDisplay = displayLine
        }
        if (!Number.isFinite(startDisplay) || !Number.isFinite(endDisplay)) return
        segs.push(toSegment(startDisplay, endDisplay, type))
      }
      for (let i = 1; i < lines.length; i++) {
        const curr = lines[i]
        if (curr === prev + 1) {
          prev = curr
          continue
        }
        pushSourceSegment(start, prev)
        start = curr
        prev = curr
      }
      pushSourceSegment(start, prev)
      return segs
    }

    for (const [lineIndex, marker] of lineMarkerTypeMap.entries()) {
      if (marker === 'none') continue
      sourceLinesByType.get(marker)?.add(lineIndex)
    }

    for (const lineIndex of diffDeletedAfterLines) {
      // 若同一显示行已标为 edited（变更行同时也是删除锚点），跳过 deleted 段，
      // 避免 deleted（绘制顺序靠后）覆盖 edited 蓝色段导致看不到蓝色标记。
      if (sourceLinesByType.get('edited')?.has(lineIndex)) continue
      sourceLinesByType.get('deleted')?.add(lineIndex)
    }

    return [
      ...buildTypeSegments('error'),
      ...buildTypeSegments('added'),
      ...buildTypeSegments('edited'),
      ...buildTypeSegments('deleted'),
    ]
  }, [diffDeletedAfterLines, lineMarkerTypeMap, lineNumMaps])

  const laidOutScrollbarStatusMarkers = useMemo(() => {
    type MarkerType = 'error' | 'added' | 'edited' | 'deleted'
    type LayoutMarker = { type: MarkerType; topPx: number; heightPx: number }

    const laneHeight = Math.max(scrollbarLaneHeightPx, 1)
    const minDiffHeightPx = 6
    const minErrorHeightPx = 3

    const raw: LayoutMarker[] = scrollbarStatusMarkers.map(marker => {
      const baseTop = Math.min(Math.max(marker.topRatio * laneHeight, 0), laneHeight)
      const baseHeight = marker.heightRatio * laneHeight
      const minHeight = marker.type === 'error' ? minErrorHeightPx : minDiffHeightPx
      const heightPx = Math.min(Math.max(baseHeight, minHeight), laneHeight)
      return { type: marker.type, topPx: baseTop, heightPx }
    })

    const errorMarkers = raw
      .filter(marker => marker.type === 'error')
      .map(marker => {
        let topPx = marker.topPx
        if (topPx + marker.heightPx > laneHeight) topPx = Math.max(0, laneHeight - marker.heightPx)
        return { ...marker, topPx }
      })

    const diffMarkers = raw
      .filter(marker => marker.type !== 'error')
      .sort((a, b) => a.topPx - b.topPx)

    const laidOutDiffMarkers: LayoutMarker[] = []
    let cursor = 0
    for (const marker of diffMarkers) {
      let topPx = marker.topPx
      if (topPx < cursor) topPx = cursor
      laidOutDiffMarkers.push({ ...marker, topPx })
      cursor = topPx + marker.heightPx
    }

    const overflow = cursor - laneHeight
    if (overflow > 0 && laidOutDiffMarkers.length > 0) {
      let remaining = overflow
      const shift = Math.min(remaining, laidOutDiffMarkers[0].topPx)
      if (shift > 0) {
        for (const marker of laidOutDiffMarkers) marker.topPx -= shift
        remaining -= shift
      }

      if (remaining > 0) {
        let packedTop = 0
        for (const marker of laidOutDiffMarkers) {
          marker.topPx = packedTop
          packedTop += marker.heightPx
        }
      }
    }

    return [...errorMarkers, ...laidOutDiffMarkers].sort((a, b) => a.topPx - b.topPx)
  }, [scrollbarLaneHeightPx, scrollbarStatusMarkers])

  const getSelectedSourceText = useCallback((): string => {
    const sorted = [...selectedLines].sort((a, b) => a - b)
    const ls = currentText.split('\n')
    const kept = filterClipboardSelectionIndices(ls, sorted.filter(i => i >= 0 && i < ls.length))
    // 复制护栏：选区含流程头但没选到配对结束时，剪贴板自动补齐结束行（粘贴不破坏流程线）
    return eycToYiFormat(appendMissingFlowEnds(kept.map(i => ls[i])).join('\n'))
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
    const parsed = parsedLinesForCurrentText
    for (const ln of parsed) {
      if (ln.type === 'sub' && ln.fields[0]) subs.add(ln.fields[0])
      if ((ln.type === 'localVar' || ln.type === 'subParam' || ln.type === 'assemblyVar' || ln.type === 'globalVar') && ln.fields[0]) vars.add(ln.fields[0])
    }
    return { userSubNames: subs, userVarNames: vars }
  }, [parsedLinesForCurrentText])
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
    const parsed = parsedLinesForCurrentText
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
  }, [parsedLinesForCurrentText, editCell?.lineIndex, projectGlobalVars, windowControlNames])
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
    const parsed = parsedLinesForCurrentText
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
  }, [parsedLinesForCurrentText, projectConstants, libraryConstants])

  useEffect(() => {
    constantCompletionItemsRef.current = constantCompletionItems
  }, [constantCompletionItems])

  const dllCompletionItems = useMemo<CompletionItem[]>(() => {
    const parsed = parsedLinesForCurrentText
    const items: CompletionItem[] = []
    const seen = new Set<string>()

    const addDll = (name: string, returnType: string, description: string, params: CompletionParam[], isIndirect = false) => {
      const nm = (name || '').trim()
      if (!nm || seen.has(nm)) return
      seen.add(nm)
      const kindLabel = isIndirect ? '指针命令' : 'DLL命令'
      items.push({
        name: nm,
        englishName: '',
        description: description || (returnType ? `${kindLabel}（返回：${returnType}）` : kindLabel),
        returnType: returnType || '',
        category: kindLabel,
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

    const ptrCmdImplicitParam = (): CompletionParam => ({
      name: '函数地址',
      type: '长整数型',
      description: '要调用的函数指针地址（如 指针到长整数 从函数表中读出的值）',
      optional: false,
      isVariable: false,
      isArray: false,
    })

    // 当前文档内的 DLL 命令
    const currentDocDllMap = new Map<string, { returnType: string; description: string; params: CompletionParam[]; isIndirect?: boolean }>()
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

      if (ln.type === 'ptrCmd') {
        const name = (ln.fields[0] || '').trim()
        if (!name) {
          currentDllName = ''
          continue
        }
        currentDllName = name
        if (!currentDocDllMap.has(name)) {
          currentDocDllMap.set(name, {
            returnType: (ln.fields[1] || '').trim(),
            description: ln.fields.length > 3 ? ln.fields.slice(3).join(', ').trim() : '',
            params: [ptrCmdImplicitParam()],
            isIndirect: true,
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
      addDll(name, meta.returnType, meta.description, meta.params, !!meta.isIndirect)
    }

    // 项目级 DLL 命令（来自 .ell 与其他已打开标签页）
    for (const c of projectDllCommands) {
      addDll(c.name, c.returnType || '', c.description || '', c.params || [], !!c.isIndirect)
    }

    return items
  }, [parsedLinesForCurrentText, projectDllCommands])

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

    const parsed = parsedLinesForCurrentText
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
  }, [parsedLinesForCurrentText, libraryDataTypeNames, projectDataTypes, projectClassNames])

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

    const parsed = parsedLinesForCurrentText
    for (const ln of parsed) {
      if (ln.type === 'assembly' && ln.fields[0]) {
        addClass(ln.fields[0])
      }
    }

    for (const c of projectClassNames) addClass(c.name)

    return items
  }, [parsedLinesForCurrentText, projectClassNames])

  useEffect(() => {
    classNameCompletionItemsRef.current = classNameCompletionItems
  }, [classNameCompletionItems])

  // 有效命令名集合（支持库命令 + 用户子程序 + 流程关键字 + 变量名 + 逻辑运算符别名 且/或）
  const validCommandNames = useMemo(() => {
    const s = new Set<string>()
    for (const c of allCommandsRef.current) s.add(c.name)
    for (const c of dllCompletionItemsRef.current) s.add(c.name)
    for (const n of userSubNames) s.add(n)
    for (const n of allKnownVarNames) s.add(n)
    for (const k of FLOW_KW) s.add(k)
    for (const a of LOGIC_OPERATOR_ALIASES) s.add(a)
    return s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSubNames, allKnownVarNames, cmdLoadId, dllCompletionItems])
  const hasCommandCatalog = useMemo(() => allCommandsRef.current.length > 0, [cmdLoadId])

  const missingRhsLineSet = useMemo(() => {
    const set = new Set<number>()
    for (const blk of visibleBlocks) {
      if (blk.kind !== 'codeline' || !blk.codeLine) continue
      const rawLine = blk.codeLine.replace(FLOW_AUTO_TAG, '')
      if (getMissingAssignmentRhsTarget(rawLine)) set.add(blk.lineIndex)
    }
    return set
  }, [visibleBlocks])

  // 保留名集合（流程关键字 + 支持库命令 + DLL 命令 + 逻辑字面量 真/假），变量名/参数名不得与之重名
  const reservedNameSet = useMemo(() => {
    const s = new Set<string>()
    for (const k of FLOW_KW) s.add(k)
    for (const c of allCommandsRef.current) s.add(c.name)
    for (const c of dllCompletionItemsRef.current) s.add(c.name)
    s.add('真')
    s.add('假')
    return s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmdLoadId, dllCompletionItems])

  const invalidVarNameLineSet = useMemo(() => {
    const set = new Set<number>()
    const parsed = parsedLinesForCurrentText
    for (let i = 0; i < parsed.length; i++) {
      const ln = parsed[i]
      if (ln.type === 'localVar' || ln.type === 'assemblyVar' || ln.type === 'globalVar' || ln.type === 'subParam') {
        const name = (ln.fields[0] || '').trim()
        if (name && (!isValidVariableLikeName(name) || reservedNameSet.has(name))) set.add(i)
      }
    }
    return set
  }, [parsedLinesForCurrentText, reservedNameSet])

  // 命令签名表（命令名 → 参数/返回类型），供诊断做实参数据类型匹配检查。
  // 只收支持库命令 + DLL 命令（用户子程序的补全项无参数类型信息，天然跳过不误报）。
  const diagCommandSignatures = useMemo(() => {
    const map: Record<string, DiagCommandSignature> = {}
    for (const c of [...allCommandsRef.current, ...dllCompletionItemsRef.current]) {
      if (!c.name || c.isMember) continue
      map[c.name] = {
        params: c.params.map(p => ({ name: p.name, type: p.type, optional: p.optional, isArray: p.isArray, repeatable: p.repeatable })),
        returnType: c.returnType || '',
      }
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmdLoadId, dllCompletionItems])

  // 控件属性类型表（编辑框「内容」随「输入方式」折算），控件属性赋值的类型检查用
  const diagControlPropTypes = useMemo(
    () => buildControlPropTypes(windowControlTypes, windowUnits),
    [windowControlTypes, windowUnits],
  )

  const diagnosticsProblems = useEditorDiagnosticsProblems({
    text: diagnosticsText,
    hasCommandCatalog: allCommandsRef.current.length > 0,
    validCommandNames,
    allKnownVarNames,
    reservedNameSet,
    commandSignatures: diagCommandSignatures,
    controlPropTypes: diagControlPropTypes,
  })

  // 声明重复/同名类错误（局部变量在当前子程序重复定义、与程序集/全局变量同名、子程序重名等）
  // 的行集合 → 声明表格的名称格标红，与问题面板一致（此前只有面板报、表格行内无提示）。
  const duplicateDeclLineSet = useMemo(() => {
    const set = new Set<number>()
    for (const p of diagnosticsProblems) {
      if (p.severity === 'error' && (p.message.includes('重复定义') || p.message.includes('同名'))) {
        set.add(p.line - 1)
      }
    }
    return set
  }, [diagnosticsProblems])

  // 问题列表由 worker 异步计算，主线程仅分发结果。
  useEffect(() => {
    const errorLines = Array.from(new Set(
      diagnosticsProblems
        .filter(problem => problem.severity === 'error' && Number.isFinite(problem.line) && problem.line > 0)
        .map(problem => problem.line - 1),
    )).sort((a, b) => a - b)

    setDiagnosticsErrorLines(prev => {
      if (prev.length === errorLines.length && prev.every((line, index) => line === errorLines[index])) {
        return prev
      }
      return errorLines
    })

    if (!onProblemsChange) return
    onProblemsChange(diagnosticsProblems as FileProblem[])
  }, [onProblemsChange, diagnosticsProblems])

  const commit = useCallback((overrideVal?: string) => {
    if (!editCell || commitGuardRef.current) return
    // 打勾格焦点态没有文本可提交，直接退出编辑态
    if (editCell.booleanCell) { setEditCell(null); return }
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
      // 提交兜底：补齐缺失的右括号/引号（如「到字节集(」→「到字节集()」），
      // 避免未配平的值写回后吞掉外层调用的右括号、破坏整行括号结构。
      effectiveVal = balanceArgParens(effectiveVal)
      if (editCell.paramIdx >= 0) {
        const codeLine = lines[editCell.lineIndex]
        const formattedVal = formatParamOperators(effectiveVal)
        // 嵌套表达式行编辑：按路径替换顶层参数值中的子节点
        const newArgVal = (editCell.exprPath && editCell.exprPath.length > 0)
          ? replaceExprAtPath(parseCallArgs(codeLine)[editCell.paramIdx] ?? '', editCell.exprPath, formattedVal)
          : formattedVal
        const newLine = replaceCallArg(codeLine, editCell.paramIdx, newArgVal)
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
      effectiveVal = normalizeCodeLineInput(effectiveVal)

      // 编辑「流程结束行」（计次循环尾/判断循环尾/循环判断尾/变量循环尾等）为空或改成别的命令
      // → 与删除该结束行等价：溶解所属结构（删起始/分支行、内部反缩进）。
      // 起始行的溶解走下方 editingExistingFlowStart 逻辑；此处专补结束行编辑路径（用户逐字符 backspace 删空后失焦）。
      // 仅关键字变化才触发；改参数（关键字不变，如 .计次循环尾() → .计次循环尾(x)）不溶解。
      if (!editCell.isVirtual) {
        const origEndKw = extractFlowKw(codeLineEditOrigValRef.current || '')
        const newKw = extractFlowKw(effectiveVal)
        if (origEndKw && FLOW_END_KW.has(origEndKw) && newKw !== origEndKw) {
          const nl = [...lines]
          // 清空 → 删掉该行（不留空行）；改成别的命令 → 保留新内容
          if (effectiveVal.trim() === '') nl.splice(editCell.lineIndex, 1)
          else nl[editCell.lineIndex] = effectiveVal
          const dissolved = repairBrokenFlowAfterDelete(nl, new Set([origEndKw]))
          const nt = dissolved.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
          wasFlowStartRef.current = false
          wasFlowKwRef.current = ''
          wasFlowOrigIndentRef.current = ''
          flowIndentRef.current = ''
          return
        }
      }

      const originalFlowKw = wasFlowKwRef.current
      const inferredFlowStart = (() => {
        if (editCell.isVirtual || originalFlowKw) return null
        // 仅当渲染层已认定该行是流程起始（但关键字提取失败）时才向下推断配对结构；
        // 普通正文行下方必然存在所属结构的分支/结束行，放开推断会把正文行误判为流程起始并溶解整个结构。
        if (!wasFlowStartRef.current) return null
        for (const candidateKw of Object.keys(FLOW_START)) {
          const patternKws = (FLOW_AUTO_COMPLETE[candidateKw] || []).filter((kw): kw is string => !!kw)
          const endKw = FLOW_START[candidateKw]
          const branchKws = new Set(patternKws.filter(kw => kw !== endKw))
          let branchIndentLen = -1
          for (let i = editCell.lineIndex + 1; i < lines.length; i++) {
            const lineText = lines[i] || ''
            const kw = extractFlowKw(lineText)
            if (!kw) continue
            const indentLen = lineText.length - lineText.replace(/^ +/, '').length
            if (branchKws.has(kw)) {
              branchIndentLen = indentLen
              continue
            }
            if (kw === endKw && (branchKws.size === 0 || branchIndentLen === indentLen)) {
              return { kw: candidateKw, indent: ' '.repeat(indentLen) }
            }
          }
        }
        return null
      })()
      const effectiveOriginalFlowKw = originalFlowKw || inferredFlowStart?.kw || ''
      const effectiveFlowOrigIndent = originalFlowKw ? wasFlowOrigIndentRef.current : (inferredFlowStart?.indent || wasFlowOrigIndentRef.current)
      const editingExistingFlowStart = !editCell.isVirtual && !!effectiveOriginalFlowKw && !!FLOW_START[effectiveOriginalFlowKw]
      // 编辑「已存在的『判断』分支 case」：原关键字就是裸「判断」（持久化的裸判断必为分支，新键入的判断才会补全成判断开始）。
      // 这类行只需原地更新参数，绝不能走自动补全（会被转成判断开始破坏结构）、也不能走分支插入（会重复）。
      const editingExistingJudgeCase = !editCell.isVirtual && effectiveOriginalFlowKw === '判断'
      // 流程上下文中，若文本未改动则直接退出编辑，避免仅点击/失焦触发格式化导致流程结构漂移。
      const unchanged = overrideVal === undefined
        && (effectiveVal === codeLineEditOrigValRef.current || effectiveVal === normalizeCodeLineInput(codeLineEditOrigValRef.current))
      const flowContext = wasFlowStartRef.current || flowIndentRef.current.length > 0 || editingExistingFlowStart
      const existingFlowCommandIsComplete = !editingExistingFlowStart || !!getOuterParenRange(codeLineEditOrigValRef.current.trim())
      if (unchanged && flowContext && existingFlowCommandIsComplete) {
        flowIndentRef.current = ''
        wasFlowStartRef.current = false
        wasFlowKwRef.current = ''
        wasFlowOrigIndentRef.current = ''
        setEditCell(null)
        return
      }
      // 判断开始 行编辑值以"判断"别名显示，进入格式化前还原真实关键字
      effectiveVal = restoreJudgeStartAlias(effectiveVal)
      // formatCommandLine 会为流程命令额外加4空格，若 flowIndent 已包含流程缩进则需减去以避免翻倍
      let baseIndent = flowIndentRef.current
      const trimmedCmd = effectiveVal.trim()
      const cmdCheckName = normalizeFlowCommandName(trimmedCmd)
      const isBareCmd = /^[\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]*\s*$/.test(trimmedCmd)
      const isParenCmd = /^[\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]*\s*[\(（].*[\)）]\s*$/.test(trimmedCmd)
      if ((isBareCmd || isParenCmd) && trimmedCmd && FLOW_AUTO_COMPLETE[cmdCheckName] && baseIndent.length >= 4 && !editingExistingJudgeCase) {
        baseIndent = baseIndent.slice(0, baseIndent.length - 4)
      }
      // 原流程起始命令被改为普通命令：沿用原始行的真实缩进作为 baseIndent，避免嵌套层级下过度反缩进
      if (wasFlowStartRef.current && trimmedCmd && !FLOW_AUTO_COMPLETE[cmdCheckName]) {
        baseIndent = effectiveFlowOrigIndent
      }
      // 编辑「已有流程头、关键字不变」（只改参数）：必须原地更新、保原缩进、绝不溶解/补标记，
      // 否则会把结构内容甩到结构外并重复出默认/判断结束（用户实测：流程内有内容再改参数就散架）。
      const isSameFlowKeywordEdit = editingExistingFlowStart && !!cmdCheckName && cmdCheckName === effectiveOriginalFlowKw
      // 分支格式化（formatCommandLine 保持「判断」不自动补全）：新键入在默认区、或编辑已有分支，二者都要。
      const preferJudgeBranch = cmdCheckName === '判断' && (editingExistingJudgeCase || shouldPreferJudgeBranchAtLine(editCell.lineIndex))
      debugFlowPaste('commit:main-line-input', {
        lineIndex: editCell.lineIndex,
        effectiveVal,
        trimmedCmd,
        cmdCheckName,
        isBareCmd,
        isParenCmd,
        baseIndentLength: baseIndent.length,
        preferJudgeBranch,
        wasFlowStart: wasFlowStartRef.current,
        wasFlowKw: effectiveOriginalFlowKw,
      })
      const formattedLines = formatCommandLine(baseIndent + effectiveVal, { preferJudgeBranch })
      flowIndentRef.current = ''
      let mainLine = formattedLines[0]
      // 保原缩进：formatCommandLine 的 +4 自动缩进只应给"新键入"，编辑已有流程头时会把它多推一层
      // （如 indent0→4）与下方标记错位，进而下次编辑触发误溶解。编辑已有头（关键字不变）强制回原缩进。
      if (isSameFlowKeywordEdit) mainLine = effectiveFlowOrigIndent + mainLine.trimStart()
      const existingFlowStructureIsIntact = (() => {
        if (!editingExistingFlowStart) return true
        const expected = (FLOW_AUTO_COMPLETE[effectiveOriginalFlowKw] || []).filter((kw): kw is string => !!kw)
        if (expected.length === 0) return true
        const baseIndentLen = effectiveFlowOrigIndent.length
        let cursor = editCell.lineIndex + 1
        for (const expectedKw of expected) {
          let found = false
          for (; cursor < lines.length; cursor++) {
            const lineText = lines[cursor] || ''
            const trimmed = lineText.replace(/[\r\t]/g, '').trim()
            if (trimmed.startsWith('.子程序 ') || trimmed.startsWith('.程序集 ')) return false
            const indentLen = lineText.length - lineText.replace(/^ +/, '').length
            if (trimmed && indentLen < baseIndentLen) return false
            const kw = extractFlowKw(lineText)
            if (kw === expectedKw && indentLen === baseIndentLen) {
              found = true
              cursor++
              break
            }
          }
          if (!found) return false
        }
        return true
      })()
      // 检查是否需要插入自动补齐的后续行（只在新输入时插入，已有匹配结束标记时不重复插入）
      const preservesExistingFlowStructure = editingExistingFlowStart && existingFlowStructureIsIntact && (!cmdCheckName || cmdCheckName === effectiveOriginalFlowKw)
      let extraLines = preservesExistingFlowStructure ? [] : formattedLines.slice(1)
      const rawExtraLineCount = extraLines.length
      if (extraLines.length > 0) {
        const afterIdx = editCell.isVirtual ? editCell.lineIndex + 2 : editCell.lineIndex + 1
        const currentIndentLen = mainLine.length - mainLine.trimStart().length
        const remainingLines = collectRemainingLinesInCurrentScope(lines, afterIdx, currentIndentLen)
        extraLines = removeDuplicateFlowAutoEndings(extraLines, remainingLines)
        // 结构后若紧跟非空行（如外层循环的结束行），补一个普通空行，
        // 否则光标无法落在结构之后、回车只能进入结构内部分支
        if (extraLines.length > 0) {
          const followingLine = afterIdx < lines.length ? lines[afterIdx] : null
          if (followingLine === null || followingLine.replace(/[\r\t]/g, '').trim() !== '') {
            extraLines = [...extraLines, '']
          }
        }
      }
      debugFlowPaste('commit:main-line-result', {
        lineIndex: editCell.lineIndex,
        mainLine,
        rawExtraLineCount,
        dedupedExtraLineCount: extraLines.length,
        isVirtual: !!editCell.isVirtual,
        preferJudgeBranch,
      })
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
      // 流程命令被删除 → 溶解整个流程块：移除分支/结束标记行，将块内正文缩进还原
      const oldKw = effectiveOriginalFlowKw
      const newIsFlow = !!(trimmedCmd && FLOW_AUTO_COMPLETE[cmdCheckName] && !preferJudgeBranch)
      const shouldDissolveExistingFlow = editingExistingFlowStart && (!newIsFlow || !existingFlowStructureIsIntact || cmdCheckName !== effectiveOriginalFlowKw)
      // 作为分支的「判断」被编辑/退格清空后失焦时不溶解整块——它是判断块的 case，不是块头（行此刻可能已空，按原缩进向上扫判定）。
      const oldKwIsJudgeBranch = oldKw === '判断' && isEnclosedJudgeBranchAt(nl, editCell.lineIndex, effectiveFlowOrigIndent.length)
      if (!editCell.isVirtual && oldKw && shouldDissolveExistingFlow && FLOW_START[oldKw] && !oldKwIsJudgeBranch) {
        const deleteSet = new Set<number>()
        const unindentSet = new Set<number>()
        const baseIndentLen = effectiveFlowOrigIndent.length
        const endKw = FLOW_START[oldKw]
        const patternKws = (FLOW_AUTO_COMPLETE[oldKw] || []).filter((kw): kw is string => !!kw)
        const endKwSet = new Set<string>([endKw])
        const branchKwSet = new Set<string>(patternKws.filter(kw => kw !== endKw))
        const dropOneFlowIndent = (line: string): string => {
          const lead = line.match(/^ */)?.[0] || ''
          const drop = Math.min(4, lead.length)
          return line.slice(drop)
        }
        const dissolvedReplacementLines = newIsFlow
          ? [dropOneFlowIndent(mainLine), ...extraLines.map(dropOneFlowIndent)]
          : [dropOneFlowIndent(mainLine)]
        for (let i = editCell.lineIndex + 1; i < nl.length; i++) {
          const lineText = nl[i]
          const trimmed = lineText.replace(/[\r\t]/g, '').trim()
          const lineIndentLen = lineText.length - lineText.replace(/^ +/, '').length

          if (trimmed.startsWith('.子程序 ') || trimmed.startsWith('.程序集 ')) break
          if (lineIndentLen < baseIndentLen && newIsFlow) break
          // 退格清空头时，本块的分支/结束行会被 live-update 去缩进到比头还浅的位置（如 否则/如果结束 从 indent4 掉到 0）。
          // 落不到下面的"同缩进"分支：结束行本已单独识别；分支行（如 否则、默认）此前漏了——会掉进末尾 unindent 残留。
          // 这里对去缩进的分支行也删除（continue 继续扫，遇去缩进的结束行才 break）。
          if (lineIndentLen < baseIndentLen) {
            const kw = extractFlowKw(lineText)
            if (kw && branchKwSet.has(kw)) { deleteSet.add(i); continue }
            if (kw && endKwSet.has(kw)) { deleteSet.add(i); break }
          }

          if (lineIndentLen === baseIndentLen) {
            const kw = extractFlowKw(lineText)
            if (kw && endKwSet.has(kw)) {
              deleteSet.add(i)
              break
            }
            if (kw && branchKwSet.has(kw)) {
              deleteSet.add(i)
              continue
            }
            // 判断块的 case 关键字「判断」不在 FLOW_AUTO_COMPLETE['判断开始'] 的 pattern 里，需单独随头删除，
            // 否则溶解判断开始头后会残留孤立的「判断」行（与 dissolveFlowStructureAtHead line 882 对齐）。
            // 循环在遇到 判断结束 时 break、更深嵌套行走 unindent 分支，故此处 baseIndent 的「判断」必属当前块。
            if (kw === '判断' && (oldKw === '判断开始' || oldKw === '判断')) {
              deleteSet.add(i)
              continue
            }
            if (trimmed === '') {
              if (newIsFlow) unindentSet.add(i)
              else deleteSet.add(i)
              continue
            }
            if (!newIsFlow) {
              unindentSet.add(i)
              continue
            }
            break
          }

          // 缩进更深的行都属于被溶解流程块内容，需要整体左移一层。
          unindentSet.add(i)
        }
        if (deleteSet.size > 0 || unindentSet.size > 0) {
          const result: string[] = []
          for (let i = 0; i < nl.length; i++) {
            if (i === editCell.lineIndex) { result.push(...dissolvedReplacementLines); continue }
            if (deleteSet.has(i)) continue
            if (unindentSet.has(i)) {
              const ln = nl[i]
              const lead = ln.match(/^ */)?.[0] || ''
              const drop = Math.min(4, lead.length)
              result.push(ln.slice(drop))
              continue
            }
            result.push(nl[i])
          }
          const nt = result.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
          wasFlowKwRef.current = ''
          return
        }
      }
      // preferJudgeBranch：用户在 .默认 之后的空 body 行键入“判断”
      // → 在 .默认 行之前插入 .判断 () 分支，并清空当前行（保留为空 body）。
      // 编辑已有分支（editingExistingJudgeCase）不插入——只原地更新参数，否则会重复出一条分支。
      if (preferJudgeBranch && !editingExistingJudgeCase && !editCell.isVirtual) {
        // 键入「判断」作为最内层判断结构的新分支：插到该判断的「默认」之前（无默认则「判断结束」之前），对齐控制缩进，并清空当前行。
        const judge = analyzeEnclosingJudge(nl, editCell.lineIndex)
        const insertAt = judge ? (judge.defaultLineIdx >= 0 ? judge.defaultLineIdx : judge.endLineIdx) : -1
        if (judge && insertAt >= 0 && insertAt <= nl.length) {
          const judgeLine = ' '.repeat(judge.controlIndentLen) + mainLine.trimStart()
          nl[editCell.lineIndex] = ''
          nl.splice(insertAt, 0, judgeLine, '')
          const nt = nl.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
          return
        }
      }
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
            '(?<=[^\\u4e00-\\u9fa5\\u3400-\\u4dbf\\uac00-\\ud7a3\\u3040-\\u30ffA-Za-z0-9_.]|^)' + oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[^\\u4e00-\\u9fa5\\u3400-\\u4dbf\\uac00-\\ud7a3\\u3040-\\u30ffA-Za-z0-9_.]|$)',
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
  }, [editCell, editVal, isClassModule, isResourceTableDoc, lines, normalizeCodeLineInput, normalizeFlowCommandName, onChange, onClassNameRename])

  // 每次渲染后重置 commitGuard，允许下一次合法的 commit 调用
  useEffect(() => { commitGuardRef.current = false })

  // 光标位置变化通知
  useEffect(() => {
    if (editCell && editCell.lineIndex >= 0) {
      const col = inputRef.current?.selectionStart ?? 1
      const displayLine = lineNumMaps.sourceLineNumMap.get(editCell.lineIndex) ?? (editCell.lineIndex + 1)
      onCursorChange?.(displayLine, col + 1, editCell.lineIndex + 1)
    }
  }, [editCell, onCursorChange, lineNumMaps])

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
    expandSubContainingLine(li)
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
    const resourceFile = unquote((ln.fields[1] || '').trim())
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

  const startEditLine = useCallback((li: number, clientX?: number, containerLeft?: number, isVirtual?: boolean, skipPushUndo = false, selectAnchorClientX?: number) => {
    expandSubContainingLine(li)
    // 使用 prevRef 获取最新行数据，防止 commit 修改文本后 React 尚未重渲染导致闭包中 lines 过时
    const latestText = prevRef.current
    const latestLines = latestText.split('\n')
    let text = isVirtual ? '' : (latestLines[li] || '')
    // 对于有流程线的普通行，剥离被流程线覆盖的前导空格
    let flowIndent = ''
    if (!isVirtual) {
      const origLineText = latestLines[li] || ''
      const origFlowKw = extractFlowKw(origLineText)
      // 若 commit 刚修改了文本但尚未重渲染，flowLines 可能过时，需重新计算
      const currentFlowMap = (latestText === currentText) ? flowLines.map : getBlocksFlowModelCached(latestText, isClassModule, isResourceTableDoc).flowMap
      const segs = currentFlowMap.get(li) || []
      if (segs.length > 0) {
        const lineMaxDepth = Math.max(...segs.map(s => s.depth)) + 1
        const stripCount = lineMaxDepth * 4
        const leadingSpaces = text.match(/^ */)?.[0] || ''
        const actualStrip = Math.min(stripCount, leadingSpaces.length)
        const hasEditableContent = text.trim().length > 0
        // 仅空行采用流程深度占位缩进；
        // 对已有内容行，若没有可剥离的真实前导空格，则不注入虚拟缩进，避免失焦格式化时凭空 +4/+8。
        flowIndent = actualStrip > 0
          ? ' '.repeat(actualStrip)
          : (hasEditableContent ? '' : ' '.repeat(stripCount))
        if (actualStrip > 0) {
          text = text.slice(actualStrip)
        }
        wasFlowStartRef.current = segs.some(s => s.type === 'start') || !!(origFlowKw && FLOW_START[origFlowKw])
        if (wasFlowStartRef.current) {
          wasFlowKwRef.current = (origFlowKw && FLOW_START[origFlowKw]) ? origFlowKw : ''
          wasFlowOrigIndentRef.current = origLineText.match(/^ */)?.[0] || ''
        } else {
          wasFlowKwRef.current = ''
          wasFlowOrigIndentRef.current = ''
        }
      } else {
        wasFlowStartRef.current = !!(origFlowKw && FLOW_START[origFlowKw])
        wasFlowKwRef.current = (origFlowKw && FLOW_START[origFlowKw]) ? origFlowKw : ''
        wasFlowOrigIndentRef.current = wasFlowStartRef.current ? (origLineText.match(/^ */)?.[0] || '') : ''
      }
    }
    // 表格模式下 判断开始 以别名"判断"进入编辑态（与非编辑显示一致），提交/实时写回时还原
    if (shouldAliasJudgeStartInTableMode && wasFlowKwRef.current === '判断开始') {
      text = text.replace(/^(\s*\.?)判断开始/, '$1判断')
    }
    if (!skipPushUndo) pushUndo(latestText)
    setSelectedLines(prev => (prev.size === 0 ? prev : new Set()))
    lastFocusedLine.current = li
    flowIndentRef.current = flowIndent
    codeLineEditOrigValRef.current = text
    editOrigRawLineRef.current = isVirtual ? '' : (latestText.split('\n')[li] ?? '')
    setEditCell({ lineIndex: li, cellIndex: -1, fieldIdx: -1, sliceField: false, isVirtual }); setEditVal(text)
    setTimeout(() => {
      if (!inputRef.current) return
      const wrapper = wrapperRef.current
      const prevScrollLeft = wrapper?.scrollLeft ?? 0
      const prevScrollTop = wrapper?.scrollTop ?? 0
      try {
        inputRef.current.focus({ preventScroll: true })
      } catch {
        inputRef.current.focus()
      }
      if (clientX !== undefined && containerLeft !== undefined) {
        // 减去流程线段占用的宽度，使光标定位到输入框内正确位置
        let segWidth = 0
        const currentFlowMap2 = (latestText === currentText) ? flowLines.map : getBlocksFlowModelCached(latestText, isClassModule, isResourceTableDoc).flowMap
        const segs2 = currentFlowMap2.get(li) || []
        if (segs2.length > 0) {
          const lineMaxDepth2 = Math.max(...segs2.map(s => s.depth)) + 1
          // 每个流程段宽度为 4ch，用 canvas 测量实际像素宽度
          const canvas2 = document.createElement('canvas')
          const ctx2 = canvas2.getContext('2d')
          if (ctx2) {
            ctx2.font = '13px Consolas, "Microsoft YaHei", monospace'
            segWidth = ctx2.measureText('    '.repeat(lineMaxDepth2)).width
          }
        }
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.font = '13px "Consolas", "Cascadia Mono", "MS Gothic", "NSimSun", "Microsoft YaHei UI", monospace'
          const posForClientX = (cx: number): number => {
            let relX = cx - containerLeft - segWidth // 相对于代码行内容区域
            if (relX < 0) relX = 0
            const fullWidth = ctx.measureText(text).width
            let pos = text.length
            if (relX < fullWidth) {
              for (let i = 1; i <= text.length; i++) {
                const w = ctx.measureText(text.slice(0, i)).width
                if (w > relX) {
                  const wPrev = ctx.measureText(text.slice(0, i - 1)).width
                  pos = (relX - wPrev < w - relX) ? i - 1 : i
                  break
                }
              }
            }
            return pos
          }
          const headPos = posForClientX(clientX)
          if (selectAnchorClientX !== undefined) {
            // 行内按住拖动进入编辑：按拖动起止位置选中文本范围
            const anchorPos = posForClientX(selectAnchorClientX)
            inputRef.current.selectionStart = Math.min(headPos, anchorPos)
            inputRef.current.selectionEnd = Math.max(headPos, anchorPos)
          } else {
            inputRef.current.selectionStart = headPos
            inputRef.current.selectionEnd = headPos
          }
        }
      }
      if (wrapper) {
        wrapper.scrollLeft = prevScrollLeft
        wrapper.scrollTop = prevScrollTop
      }
    }, 0)
  }, [currentText, pushUndo, flowLines, shouldAliasJudgeStartInTableMode, expandSubContainingLine])

  // 同一行内按住拖动（行未聚焦）：进入该行编辑态并选中拖动范围内的文本
  beginLineTextSelectRef.current = (li, isVirtual, anchorX, headX) => {
    const lineEl = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${li}"] .eyc-code-line`)
    if (!lineEl) return
    startEditLine(li, headX, lineEl.getBoundingClientRect().left, isVirtual, false, anchorX)
  }

  // 同一行内按住拖动（行未聚焦）：进入该行编辑态并选中拖动范围内的文本
  beginLineTextSelectRef.current = (li, isVirtual, anchorX, headX) => {
    const lineEl = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${li}"] .eyc-code-line`)
    if (!lineEl) return
    startEditLine(li, headX, lineEl.getBoundingClientRect().left, isVirtual, false, anchorX)
  }

  startEditLineOnMouseDownRef.current = (li, isVirtual, clientX, target) => {
    const closest = target instanceof HTMLElement ? target.closest<HTMLElement>('.eyc-code-line') : null
    const lineEl = closest || wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${li}"] .eyc-code-line`)
    if (!lineEl) return
    // 命令提示联动必须在 mousedown 做：进入编辑态后 input 覆盖该行，
    // click 事件的 target 变成 INPUT，handleCodeLineClick 会提前返回拿不到原始 token
    const rawCode = isVirtual ? '' : ((prevRef.current.split('\n')[li] || '').replace(FLOW_AUTO_TAG, ''))
    const cmdName = findCommandNameFromClickTarget(target, rawCode)
    if (cmdName) {
      const ownerAssembly = findOwnerAssemblyName(li)
      const hintName = userSubNamesRef.current.has(cmdName) ? `__SUB__:${cmdName}:${ownerAssembly}` : cmdName
      onCommandClick?.(hintName)
    }
    startEditLine(li, clientX, lineEl.getBoundingClientRect().left, isVirtual)
  }

  // click 阶段查验 mousedown 是否已乐观进入该行编辑态；命中则消费标记并跳过重复进入
  const consumeOptimisticLineEdit = useCallback((lineIndex: number): boolean => {
    if (optimisticLineEditRef.current !== lineIndex) return false
    optimisticLineEditRef.current = null
    // 拖动转多选等路径会清掉编辑态，此时不视为已处理，让 click 走原路径兜底
    const state = editCellRef.current
    return !!state && state.lineIndex === lineIndex && state.cellIndex === -1
  }, [])

  const suppressInlineBlurCommit = (durationMs = 250): void => {
    suppressBlurCommitUntilRef.current = Date.now() + durationMs
  }

  const shouldSuppressBlurCommit = useCallback((): boolean => {
    if (preserveEditOnScrollbarRef.current) return true
    if (Date.now() < suppressBlurCommitUntilRef.current) {
      suppressBlurCommitUntilRef.current = 0
      return true
    }
    return false
  }, [])

  const isEditingSameCell = useCallback((target: {
    lineIndex: number
    cellIndex: number
    fieldIdx: number
    paramIdx?: number
    isVirtual?: boolean
  }): boolean => {
    const state = editCellRef.current
    if (!state) return false
    return state.lineIndex === target.lineIndex
      && state.cellIndex === target.cellIndex
      && state.fieldIdx === target.fieldIdx
      && state.paramIdx === target.paramIdx
      && state.isVirtual === target.isVirtual
  }, [])

  const refocusActiveEditorInput = useCallback(() => {
    const state = editCellRef.current
    if (!state) return
    const target = state.paramIdx !== undefined ? (paramInputRef.current || inputRef.current) : inputRef.current
    if (!target) return
    try {
      target.focus({ preventScroll: true })
    } catch {
      target.focus()
    }
  }, [])

  useEffect(() => {
    const handleMouseUp = (): void => {
      if (!preserveEditOnScrollbarRef.current) return
      preserveEditOnScrollbarRef.current = false
      setTimeout(() => {
        refocusActiveEditorInput()
      }, 0)
    }
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [refocusActiveEditorInput])

  useEffect(() => {
    if (!editCell) return
    const timer = window.setTimeout(() => {
      const active = document.activeElement as HTMLElement | null
      if (active === inputRef.current || active === paramInputRef.current) return
      refocusActiveEditorInput()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [editCell, visibleBlocks, refocusActiveEditorInput])

  const {
    getFlowAutoExpandCandidate,
    getCodeLineNavigationAction,
    getEmptyCodeLineDeleteAction,
    getParenScopedKeyAction,
  } = useCodeLineEditor()

  const applyTextChange = useCallback((nextText: string) => {
    setCurrentText(nextText)
    prevRef.current = nextText
    onChange(nextText)
  }, [onChange])

  const beginCodeLineEdit = useCallback((lineIndex: number, value: string) => {
    setEditCell({ lineIndex, cellIndex: -1, fieldIdx: -1, sliceField: false })
    codeLineEditOrigValRef.current = value
    editOrigRawLineRef.current = prevRef.current.split('\n')[lineIndex] ?? ''
    setEditVal(value)
  }, [])

  const beginCodeLineEditByTargetLine = useCallback((lineIndex: number, sourceLines: string[]) => {
    const targetLine = sourceLines[lineIndex] || ''
    beginCodeLineEdit(lineIndex, targetLine)
  }, [beginCodeLineEdit])

  const focusInlineInputAt = useCallback((position: number | 'end') => {
    const focusAt = (attempt = 0): void => {
      const input = inputRef.current
      if (!input) {
        if (attempt < 8) window.setTimeout(() => focusAt(attempt + 1), 16)
        return
      }
      try {
        input.focus({ preventScroll: true })
      } catch {
        input.focus()
      }
      const pos = position === 'end' ? input.value.length : Math.min(position, input.value.length)
      input.setSelectionRange(pos, pos)
      if (document.activeElement !== input && attempt < 8) {
        window.setTimeout(() => focusAt(attempt + 1), 16)
      }
    }
    window.setTimeout(() => focusAt(), 0)
  }, [])

  const focusCodeInputAt = useCallback((position = 0) => {
    focusInlineInputAt(position)
  }, [focusInlineInputAt])

  const resolveVisibleCodeLineTarget = useCallback((targetLine: number, direction: -1 | 1, lineCount: number): number | null => {
    if (targetLine < 0 || targetLine >= lineCount) return null
    if (visibleCodeLineIndexes.has(targetLine)) return targetLine

    for (let li = targetLine + direction; li >= 0 && li < lineCount; li += direction) {
      if (visibleCodeLineIndexes.has(li)) return li
    }
    return null
  }, [visibleCodeLineIndexes])

  const applyCodeLineNavigation = useCallback((navAction: CodeLineNavigationAction) => {
    if (!navAction) return
    const currentLineIndex = editCellRef.current?.lineIndex ?? -1
    commit()
    setTimeout(() => {
      const latestLines = prevRef.current.split('\n')
      if (navAction.type === 'upOrDown') {
        const direction = navAction.targetLine < currentLineIndex ? -1 : 1
        const targetLine = resolveVisibleCodeLineTarget(navAction.targetLine, direction, latestLines.length)
        if (targetLine != null) {
          startEditLine(targetLine)
          focusInlineInputAt(navAction.keepHorizontalPos)
          return
        }
        if (direction === -1) {
          // 已到顶部：进入文档最上方的可编辑处——程序集名表格单元格
          const asmLine = latestLines.findIndex(l => l.replace(/[\r\t]/g, '').trim().startsWith('.程序集 '))
          if (asmLine >= 0) {
            const rest = latestLines[asmLine].replace(/[\r\t]/g, '').trim().slice('.程序集 '.length)
            const name = splitCSV(rest)[0] || ''
            startEditCell(asmLine, 0, name, 0, false)
            return
          }
        }
        // 已是最后一行（或顶部无程序集行）：停留在当前行，不让输入焦点消失
        const stayLine = resolveVisibleCodeLineTarget(
          Math.min(Math.max(currentLineIndex, 0), latestLines.length - 1),
          -direction as -1 | 1,
          latestLines.length,
        )
        if (stayLine != null) {
          startEditLine(stayLine)
          focusInlineInputAt(navAction.keepHorizontalPos)
        }
        return
      }

      if (navAction.type === 'leftToPrevLineEnd') {
        const targetLine = resolveVisibleCodeLineTarget(navAction.targetLine, -1, latestLines.length)
        if (targetLine != null) {
          startEditLine(targetLine)
          focusInlineInputAt('end')
        }
        return
      }

      if (navAction.type === 'rightToNextLineStart') {
        const targetLine = resolveVisibleCodeLineTarget(navAction.targetLine, 1, latestLines.length)
        if (targetLine != null) {
          startEditLine(targetLine)
          focusInlineInputAt(0)
        }
      }
    }, 0)
  }, [commit, focusInlineInputAt, resolveVisibleCodeLineTarget, startEditCell, startEditLine])

  const applyEmptyCodeLineDelete = useCallback((params: {
    action: EmptyCodeLineDeleteAction
    lineIndex: number
    isVirtual: boolean | undefined
  }) => {
    const { action, lineIndex, isVirtual } = params
    if (action.type === 'forbidden') return

    // 用 prevRef.current（最新文本真相）而非 state 派生的 lines：连按退格删空行时
    // React 尚未重渲染、闭包里的 lines 会过时导致多次删除互相覆盖、丢键。
    const latestLines = prevRef.current.split('\n')

    const getSubAnchorInfoForLine = (ls: string[], targetLine: number): { anchorLine: number; ordinaryLines: number[] } | null => {
      if (targetLine < 0 || targetLine >= ls.length) return null
      let subStart = -1
      for (let i = targetLine; i >= 0; i--) {
        const t = (ls[i] || '').replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ')) { subStart = i; break }
        if (t.startsWith('.程序集 ')) break
      }
      if (subStart < 0) return null

      let subEnd = ls.length
      for (let i = subStart + 1; i < ls.length; i++) {
        const t = (ls[i] || '').replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ') || t.startsWith('.程序集 ')) { subEnd = i; break }
      }

      const ordinaryLines: number[] = []
      for (let i = subStart + 1; i < subEnd; i++) {
        const t = (ls[i] || '').replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.')) continue
        ordinaryLines.push(i)
      }
      if (ordinaryLines.length === 0) return null
      return { anchorLine: ordinaryLines[0], ordinaryLines }
    }

    // 被编辑行（lineIndex）原本是流程结构行时，优先于子程序锚点重定向按 lineIndex 溶解整个结构——
    // 否则头被退格清空后会被锚点逻辑当成"普通空行"重定向到 body，导致 origKw 判定落空、结构残留。
    // 行此刻已空、关键字丢失，用编辑前保留的 codeLineEditOrigValRef / wasFlowOrigIndentRef 判定。
    const editedLineOrigKw = extractFlowKw(codeLineEditOrigValRef.current || '')
    // 作为分支的「判断」被退格清空时同样不溶解——按普通空行删除（行此刻已空，用原缩进向上扫判定是否处在判断块内）。
    const editedJudgeIsBranch = editedLineOrigKw === '判断'
      && isEnclosedJudgeBranchAt(latestLines, lineIndex, wasFlowOrigIndentRef.current.length)
    let nl: string[]
    let focusLineAfter = action.targetLine
    if (editedLineOrigKw && FLOW_START[editedLineOrigKw] && !editedJudgeIsBranch) {
      suppressInlineBlurCommit()
      pushUndo(prevRef.current)
      nl = dissolveFlowStructureAtHead(latestLines, lineIndex, editedLineOrigKw, wasFlowOrigIndentRef.current.length)
      focusLineAfter = lineIndex
    } else if (editedLineOrigKw && FLOW_END_KW.has(editedLineOrigKw)) {
      suppressInlineBlurCommit()
      pushUndo(prevRef.current)
      const spliced = [...latestLines]
      spliced.splice(lineIndex, 1)
      nl = repairBrokenFlowAfterDelete(spliced, new Set([editedLineOrigKw])) // 结束行：起始未闭合 → 溶解
      focusLineAfter = lineIndex
    } else {
      // 普通空行删除：保留原有子程序锚点保护 + splice。
      let deleteIndex = lineIndex
      const anchorInfo = getSubAnchorInfoForLine(latestLines, lineIndex)
      if (anchorInfo && anchorInfo.anchorLine === lineIndex) {
        const nextOrdinary = anchorInfo.ordinaryLines.find(i => i > lineIndex)
        if (nextOrdinary === undefined) {
          // 子程序仅剩保底空行时，不允许再删掉它。
          return
        }
        deleteIndex = nextOrdinary
        focusLineAfter = lineIndex
      }
      suppressInlineBlurCommit()
      pushUndo(prevRef.current)
      const spliced = [...latestLines]
      spliced.splice(deleteIndex, 1)
      nl = spliced
    }
    const nt = nl.join('\n')
    const clampedLi = Math.max(0, Math.min(focusLineAfter, nl.length - 1))

    // flushSync 强制删除 + 进入目标行编辑态同步落地：blocks 用 useMemo 同步派生后，
    // 目标行的编辑 input 会在本次提交内挂载，从而可立即同步聚焦——消除连按退格时
    // 旧 input 卸载、新 input 未聚焦的间隙丢键（此前连按5次只删1次）。
    flowMarkRef.current = ''
    flushSync(() => {
      applyTextChange(nt)
      flowIndentRef.current = ''
      if (nl.length === 0) {
        setEditCell(null)
      } else {
        // applyTextChange 已同步写 prevRef.current=nt，startEditLine 读到最新文本；
        // skipPushUndo=true 避免与上面的 pushUndo 重复入栈。
        startEditLine(clampedLi, undefined, undefined, isVirtual, true)
      }
    })

    if (nl.length === 0) {
      focusWrapper()
      return
    }
    // 目标行 input 已同步挂载，立即同步聚焦（不走 focusInlineInputAt 的 setTimeout 延迟）
    const freshInput = inputRef.current
    if (freshInput) {
      try { freshInput.focus({ preventScroll: true }) } catch { freshInput.focus() }
      const pos = action.preferPrevLine ? freshInput.value.length : 0
      freshInput.setSelectionRange(pos, pos)
    } else {
      focusInlineInputAt(action.preferPrevLine ? 'end' : 0)
    }
  }, [applyTextChange, focusInlineInputAt, focusWrapper, pushUndo, startEditLine])

  const applyParenScopedAction = useCallback((params: {
    action: ParenScopedKeyAction
    lineIndex: number
  }) => {
    const { action, lineIndex } = params
    if (!action) return

    suppressInlineBlurCommit()
    setAcVisible(false)

    if (action.type === 'insertBlankLine') {
      if (expandedLines.has(lineIndex)) {
        setExpandedLines(prev => {
          const next = new Set(prev)
          next.delete(lineIndex)
          return next
        })
      }
      const savedFlowMark = flowMarkRef.current
      commit()
      setTimeout(() => {
        const latestText = prevRef.current
        const latestLines = latestText.split('\n')
        const fi = savedFlowMark
          ? savedFlowMark.slice(0, savedFlowMark.length - 1)
          : (flowIndentRef.current || '')
        const newLineContent = savedFlowMark || fi
        const insertAt = action.insertAbove ? lineIndex : lineIndex + 1
        latestLines.splice(insertAt, 0, newLineContent)
        const nt = latestLines.join('\n')
        pushUndo(latestText)
        applyTextChange(nt)
        flowMarkRef.current = savedFlowMark
        flowIndentRef.current = savedFlowMark ? '' : fi
        wasFlowStartRef.current = false
        beginCodeLineEdit(insertAt, '')
        focusCodeInputAt(0)
      }, 0)
      return
    }

    if (action.type === 'jumpToNextLine') {
      commit()
      setTimeout(() => {
        const latestText = prevRef.current
        const latestLines = latestText.split('\n')
        const nextLi = lineIndex + 1
        if (nextLi < latestLines.length) {
          startEditLine(nextLi)
        }
      }, 0)
    }
  }, [applyTextChange, beginCodeLineEdit, commit, expandedLines, focusCodeInputAt, pushUndo, startEditLine])

  const applyFlowAutoExpandOnEnter = useCallback((params: {
    editCellState: EditState
    commandName: string
  }): boolean => {
    const { editCellState, commandName } = params
    debugFlowPaste('enter:auto-expand-input', {
      lineIndex: editCellState.lineIndex,
      commandName,
      isVirtual: !!editCellState.isVirtual,
      hasFlowMarker: !!flowMarkRef.current,
      editVal,
    })
    const needsExitLine = commandName === '如果' || commandName === '如果真' || commandName === '判断'
    const nl = [...lines]

    const ensureExitLine = (target: string[], exitIndent: string): string[] => {
      if (!needsExitLine) return target
      if (target.length === 0) return [exitIndent]
      const last = target[target.length - 1]
      if (last === exitIndent) return target
      return [...target, exitIndent]
    }

    if (flowMarkRef.current) {
      const markerChar = flowMarkRef.current.trimStart().charAt(0)
      const markerIndent = flowMarkRef.current.slice(0, flowMarkRef.current.length - 1)
      // 仅当标记行确实处于判断结构内时，键入“判断”才视为新增分支；
      // 在循环/如果 等其他结构体内键入“判断”应展开为完整判断结构
      const markerStructureKw = (() => {
        const around = getFlowStructureAround(nl, editCellState.lineIndex)
        if (!around) return null
        return extractFlowKw(nl[around.cmdLine] || '')
      })()
      const isJudgeStructureMarker = markerStructureKw === '判断开始' || markerStructureKw === '判断'
      const preferJudgeBranchHere = commandName === '判断' && isJudgeStructureMarker
      if (preferJudgeBranchHere) {
        const trimmedInput = editVal.trim()
        const parenRange = getOuterParenRange(trimmedInput)
        const argText = parenRange ? trimmedInput.slice(parenRange.start + 1, parenRange.end).trim() : ''
        const judgeBranchLine = markerIndent + '判断（' + argText + '）'
        nl.splice(editCellState.lineIndex, 1, judgeBranchLine)
        const nt = nl.join('\n')
        applyTextChange(nt)
        const cursorLi = Math.min(editCellState.lineIndex + 1, nl.length - 1)
        beginCodeLineEditByTargetLine(cursorLi, nl)
        focusCodeInputAt(0)
        commitGuardRef.current = true
        return true
      }
      if (markerChar === '\u2060' && commandName === '判断' && isJudgeStructureMarker) {
        const trimmedInput = editVal.trim()
        const parenRange = getOuterParenRange(trimmedInput)
        const argText = parenRange ? trimmedInput.slice(parenRange.start + 1, parenRange.end).trim() : ''
        const judgeBranchLine = markerIndent + '判断（' + argText + '）'
        nl.splice(editCellState.lineIndex, 1, judgeBranchLine)
        const nt = nl.join('\n')
        applyTextChange(nt)
        const cursorLi = Math.min(editCellState.lineIndex + 1, nl.length - 1)
        beginCodeLineEditByTargetLine(cursorLi, nl)
        focusCodeInputAt(0)
        commitGuardRef.current = true
        return true
      } else {
        let formattedLines = trimTrailingEmptyFormattedLine(formatCommandLine(markerIndent + editVal))
        if (formattedLines.length > 1) {
          const markerParentIndent = markerIndent.length >= 4 ? markerIndent.slice(0, -4) : ''
          formattedLines = ensureExitLine(formattedLines, markerParentIndent)
          const isLoopFlow = FLOW_LOOP_KW.has(commandName)
          if (isLoopFlow) {
            const mainLine = formattedLines[0]
            const loopBody = buildLoopFlowBodyLines(mainLine, formattedLines.slice(1))
            const bodyIndent = loopBody.bodyIndent
            const withBody = loopBody.lines
            nl.splice(editCellState.lineIndex, 1, ...withBody)
            const insertPos = editCellState.lineIndex + withBody.length
            nl.splice(insertPos, 0, flowMarkRef.current)
            const nt = nl.join('\n')
            applyTextChange(nt)
            const cursorLi = editCellState.lineIndex + 1
            flowMarkRef.current = ''
            flowIndentRef.current = bodyIndent
            wasFlowStartRef.current = false
            beginCodeLineEdit(cursorLi, '')
          } else {
            const cursorLi = applyFlowMarkerSection({
              lines: nl,
              lineIndex: editCellState.lineIndex,
              formattedLines,
              flowMark: flowMarkRef.current,
            })
            const nt = nl.join('\n')
            applyTextChange(nt)
            beginCodeLineEditByTargetLine(cursorLi, nl)
          }
          focusCodeInputAt(0)
          commitGuardRef.current = true
          return true
        }
      }
    } else {
      let enterIndent = flowIndentRef.current
      const isBareEnterCmd = /^[\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.]*\s*$/.test(editVal.trim())
      if (isBareEnterCmd && enterIndent.length >= 4) {
        enterIndent = enterIndent.slice(0, enterIndent.length - 4)
      }
      const preferJudgeBranch = commandName === '判断' && shouldPreferJudgeBranchAtLine(editCellState.lineIndex)
      debugFlowPaste('enter:auto-expand-judge-check', {
        lineIndex: editCellState.lineIndex,
        commandName,
        preferJudgeBranch,
      })
      // preferJudgeBranch：用户在 .默认 之后的空 body 行键入“判断”+回车，
      // 在 .默认 之前插入 .判断 () 分支与一个空 body 行，原编辑行保持为 .默认 的空 body。
      if (preferJudgeBranch && !editCellState.isVirtual) {
        // 键入「判断」+回车：作为最内层判断结构的新分支，插到「默认」之前（无默认则「判断结束」之前），对齐控制缩进，光标移到新分支下方空 body。
        const judge = analyzeEnclosingJudge(nl, editCellState.lineIndex)
        const insertAt = judge ? (judge.defaultLineIdx >= 0 ? judge.defaultLineIdx : judge.endLineIdx) : -1
        if (judge && insertAt >= 0 && insertAt <= nl.length) {
          const judgeRawLine = formatCommandLine(enterIndent + editVal, { preferJudgeBranch: true })[0]
          const judgeLine = ' '.repeat(judge.controlIndentLen) + judgeRawLine.trimStart()
          nl[editCellState.lineIndex] = ''
          nl.splice(insertAt, 0, judgeLine, '')
          const nt = nl.join('\n')
          applyTextChange(nt)
          const cursorLi = insertAt + 1
          flowMarkRef.current = ''
          flowIndentRef.current = ''
          wasFlowStartRef.current = false
          beginCodeLineEdit(cursorLi, '')
          focusCodeInputAt(0)
          commitGuardRef.current = true
          return true
        }
      }
      const formattedLines = formatCommandLine(enterIndent + editVal, { preferJudgeBranch })
      if (formattedLines.length > 1) {
        const mainLine = formattedLines[0]
        let extraLines = formattedLines.slice(1)
        const afterIdx = editCellState.isVirtual ? editCellState.lineIndex + 2 : editCellState.lineIndex + 1
        const currentIndentLen = mainLine.length - mainLine.trimStart().length
        const remainingLines = collectRemainingLinesInCurrentScope(lines, afterIdx, currentIndentLen)
        extraLines = removeDuplicateFlowAutoEndings(extraLines, remainingLines)
        const exitIndent = ' '.repeat(Math.max(0, currentIndentLen - 4))
        extraLines = ensureExitLine(extraLines, exitIndent)

        const isLoopFlow = FLOW_LOOP_KW.has(commandName)
        if (isLoopFlow) {
          const loopBody = buildLoopFlowBodyLines(mainLine, extraLines)
          const bodyIndent = loopBody.bodyIndent
          if (editCellState.isVirtual) {
            nl.splice(editCellState.lineIndex + 1, 0, ...loopBody.lines)
          } else {
            nl.splice(editCellState.lineIndex, 1, ...loopBody.lines)
          }
          const nt = nl.join('\n')
          applyTextChange(nt)
          const baseLi = getAutoExpandCursorBaseLine(editCellState.lineIndex, !!editCellState.isVirtual)
          const cursorLi = baseLi + 1
          flowIndentRef.current = bodyIndent
          wasFlowStartRef.current = false
          beginCodeLineEdit(cursorLi, '')
        } else {
          applyMainAndExtraLines({
            lines: nl,
            lineIndex: editCellState.lineIndex,
            isVirtual: !!editCellState.isVirtual,
            mainLine,
            extraLines,
          })
          const nt = nl.join('\n')
          applyTextChange(nt)
          const baseLi = getAutoExpandCursorBaseLine(editCellState.lineIndex, !!editCellState.isVirtual)
          const cursorLi = baseLi + 1
          beginCodeLineEditByTargetLine(cursorLi, nl)
        }
        focusCodeInputAt(0)
        commitGuardRef.current = true
        debugFlowPaste('enter:auto-expand-flow-inserted', {
          lineIndex: editCellState.lineIndex,
          commandName,
          insertedLines: formattedLines.length,
          isVirtual: !!editCellState.isVirtual,
          preferJudgeBranch,
        })
        return true
      }
    }

    return false
  }, [applyTextChange, beginCodeLineEdit, beginCodeLineEditByTargetLine, debugFlowPaste, editVal, focusCodeInputAt, formatCommandLine, lines, shouldPreferJudgeBranchAtLine])

  const applyCodeLineSplitOnEnter = useCallback((params: {
    editCellState: EditState
    beforeText: string
    afterText: string
  }) => {
    const { editCellState, beforeText, afterText } = params
    // 用 prevRef.current（最新文本真相）而非 state 派生的 lines：连续快速按回车时
    // React 尚未重渲染、闭包里的 lines 会过时，多次回车基于同一旧文本计算并互相覆盖
    // （表现为"连按两次回车只新增一行"）。
    const nl = prevRef.current.split('\n')

    // flushSync 强制本次状态同步落地：保证下一次按键事件的闭包（editCell/editVal/lines）
    // 已刷新到最新，避免连按时事件竞争丢键。
    flushSync(() => {
      if (editCellState.isVirtual) {
        nl.splice(editCellState.lineIndex + 1, 0, beforeText, afterText)
        const nt = nl.join('\n')
        applyTextChange(nt)
        const newLi = editCellState.lineIndex + 2
        beginCodeLineEdit(newLi, afterText)
      } else {
        const fi = flowIndentRef.current
        const curSegs = flowLines.map.get(editCellState.lineIndex) || []
        const hasFlowEnd = curSegs.some(s => s.type === 'end')
        const newFi = hasFlowEnd && fi.length >= 4 ? fi.slice(0, fi.length - 4) : fi
        const fmtBefore = afterText.trim() === '' ? formatCommandLine(fi + beforeText)[0].slice(fi.length) : beforeText
        nl[editCellState.lineIndex] = fi + fmtBefore
        nl.splice(editCellState.lineIndex + 1, 0, newFi + afterText)
        const nt = nl.join('\n')
        applyTextChange(nt)
        const newLi = editCellState.lineIndex + 1
        beginCodeLineEdit(newLi, afterText)
        flowIndentRef.current = newFi
        wasFlowStartRef.current = false
      }
    })

    // flushSync 后新行 input 已同步挂载——立即同步聚焦并置光标到行首。
    // 不能走 focusCodeInputAt（其内部 setTimeout(0) 延迟聚焦），否则连按回车时
    // 旧 input 已卸载、新 input 尚未聚焦的间隙里，后续 keydown 会落到 body 上丢失
    // （实测连按5次只有首尾2次到达 handler）。
    const freshInput = inputRef.current
    if (freshInput) {
      try { freshInput.focus({ preventScroll: true }) } catch { freshInput.focus() }
      freshInput.setSelectionRange(0, 0)
    } else {
      focusCodeInputAt(0)
    }
  }, [applyTextChange, beginCodeLineEdit, flowLines, focusCodeInputAt, formatCommandLine])

  const applyTableRowEnterInsert = useCallback((editCellState: EditState): boolean => {
    if (editCellState.cellIndex < 0 || editCellState.fieldIdx === undefined || editCellState.fieldIdx < 0) {
      return false
    }

    // 用 prevRef.current（最新文本真相）派生行数组，避免连按时 state lines 过时
    const latestLines = prevRef.current.split('\n')
    const li = editCellState.lineIndex
    let rawLine = latestLines[li]
    rawLine = rebuildLineField(rawLine, editCellState.fieldIdx, editVal, editCellState.sliceField)

    const newLine = getTableRowInsertTemplate(rawLine)
    if (!newLine) return false

    let nl = [...latestLines]
    nl[li] = rawLine

    if (editCellState.fieldIdx === 0) {
      const origRaw = latestLines[li]
      const trimmedOrig = origRaw.replace(/[\r\t]/g, '').trim()
      nl = applyScopedVariableRename({
        lines: nl,
        lineIndex: li,
        declarationLine: origRaw,
        oldName: editCellOrigValRef.current,
        newName: editVal,
      })

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
    applyTextChange(nt)
    const newLi = li + 1
    editCellOrigValRef.current = ''
    setEditCell({ lineIndex: newLi, cellIndex: 0, fieldIdx: 0, sliceField: false })
    setEditVal('')
    setTimeout(() => { inputRef.current?.focus() }, 0)
    return true
  }, [applyTextChange, editVal, isClassModule, onClassNameRename])

  const applyCustomPasteShortcut = useCallback((): boolean => {
    if (editCell && editCell.cellIndex === -1 && editCell.paramIdx === undefined) return false
    if (shouldUseNativeInputPaste(editCell)) return false

    setAcVisible(false)
    navigator.clipboard.readText().then(clipText => {
      const cursorLine = editCell?.lineIndex ?? lastFocusedLine.current
      debugFlowPaste('paste-shortcut:input', {
        cursorLine,
        clipPreview: String(clipText || '').replace(/\r\n?/g, '\n').split('\n').slice(0, 8),
        clipLength: (clipText || '').length,
      })
      const pasteResult = buildMultiLinePasteResult({
        currentText,
        clipText,
        cursorLine,
        sanitizePastedText: sanitizePastedTextForCurrent,
        extractAssemblyVarLines: extractAssemblyVarLinesFromPasted,
        extractRoutedDeclarationLines: extractRoutedDeclarationLinesFromPasted,
        replaceLineIndices: selectedLinesRef.current.size > 0 ? Array.from(selectedLinesRef.current) : undefined,
      })
      if (!pasteResult) return
      if (pasteResult.routedDeclarations.length > 0) {
        onRouteDeclarationPaste?.(pasteResult.routedDeclarations)
      }
      debugFlowPaste('paste-shortcut:result', {
        insertAt: pasteResult.insertAt,
        pastedLineCount: pasteResult.pastedLineCount,
        resultPreview: pasteResult.nextText.split('\n').slice(Math.max(0, pasteResult.insertAt - 2), pasteResult.insertAt + pasteResult.pastedLineCount + 3),
      })
      pushUndo(currentText)
      const nt = pasteResult.nextText
      applyTextChange(nt)
      const newSel = new Set<number>()
      for (let i = 0; i < pasteResult.pastedLineCount; i++) newSel.add(pasteResult.insertAt + i)
      setSelectedLines(newSel)
      lastFocusedLine.current = pasteResult.insertAt + pasteResult.pastedLineCount - 1
    })

    return true
  }, [applyTextChange, currentText, debugFlowPaste, editCell, pushUndo, shouldUseNativeInputPaste])

  const applyTypeCellSpaceGuard = useCallback((): boolean => {
    return handleTypeCellSpaceGuard({
      isTypeCellEdit: !!(editCell && editCell.cellIndex >= 0 && canUseTypeCompletion(editCell.lineIndex, editCell.fieldIdx)),
      acVisible,
      acItems,
      acIndex,
      onExpandMore: expandMoreCompletion,
      onApplyCompletion: applyCompletion,
    })
  }, [acIndex, acItems, acVisible, applyCompletion, editCell])

  const applyCompletionPopupKey = useCallback((key: string): boolean => {
    const handled = handleCompletionPopupKey({
      key,
      acVisible,
      acItems,
      acIndex,
      onSetAcIndex: setAcIndex,
      onExpandMore: expandMoreCompletion,
      onApplyCompletion: applyCompletion,
      onHidePopup: () => setAcVisible(false),
    })
    if (handled && (key === 'ArrowUp' || key === 'ArrowDown') && editCellRef.current?.paramIdx === undefined) {
      // 代码行输入框需要重新聚焦；参数输入框按键时焦点本就在自身，不抢焦点
      const pos = inputRef.current?.selectionStart ?? editVal.length
      focusInlineInputAt(pos)
    }
    return handled
  }, [acIndex, acItems, acVisible, applyCompletion, editVal.length, expandMoreCompletion, focusInlineInputAt])

  const applyEnterKey = useCallback((cursorPos: number): void => {
    suppressInlineBlurCommit()
    setAcVisible(false)
    if (editCell && editCell.cellIndex < 0 && expandedLines.has(editCell.lineIndex)) {
      setExpandedLines(prev => {
        const next = new Set(prev)
        next.delete(editCell.lineIndex)
        return next
      })
    }

    if (editCell && editCell.cellIndex < 0) {
      const before = editVal.slice(0, cursorPos)
      const after = editVal.slice(cursorPos)

      // 整行是裸的未知标识符（如「我是」）→ 回车后弹「插入变量」提示（照易语言）。
      // 已知命令/变量/流程关键字/保留字不弹；正常回车流程继续执行，弹窗叠加其上。
      if (editCell.paramIdx === undefined) {
        const bareName = editVal.trim()
        if (/^[一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*$/.test(bareName)
          && !validCommandNames.has(bareName)
          && !allKnownVarNames.has(bareName)
          && !reservedNameSet.has(bareName)) {
          setInsertVarPrompt({ name: bareName, anchorLine: editCell.lineIndex })
        }
      }

      // ===== 流程命令自动格式化：输入流程命令后按回车自动展开结构 =====
      const autoExpand = getFlowAutoExpandCandidate({ editValue: editVal, trailingText: after })
      if (autoExpand) {
        const cmdCheckName = autoExpand?.commandName || ''
        if (FLOW_AUTO_COMPLETE[cmdCheckName]) {
          if (applyFlowAutoExpandOnEnter({ editCellState: editCell, commandName: cmdCheckName })) return
        }
      }

      applyCodeLineSplitOnEnter({ editCellState: editCell, beforeText: before, afterText: after })
      return
    }

    if (editCell && editCell.cellIndex >= 0 && editCell.fieldIdx >= 0) {
      if (!applyTableRowEnterInsert(editCell)) commit()
      return
    }

    commit()
  }, [
    commit,
    editCell,
    editVal,
    expandedLines,
    applyCodeLineSplitOnEnter,
    applyFlowAutoExpandOnEnter,
    applyTableRowEnterInsert,
    getFlowAutoExpandCandidate,
    validCommandNames,
    allKnownVarNames,
    reservedNameSet,
  ])

  const applyEmptyDeleteKey = useCallback((key: 'Backspace' | 'Delete'): { handled: boolean; preventDefault: boolean } => {
    if (!(editCell && editCell.cellIndex < 0 && editVal.trim() === '' && lines.length > 1)) {
      return { handled: false, preventDefault: false }
    }

    const li = editCell.lineIndex

    // 保护流程结构体：在结构体内的空 body 行（或结构紧邻其后的首个空行）按 Backspace 时，
    // 不删除该行/破坏结构，而是把光标上移到上一可见行的末尾（复用 ArrowLeft-at-col0 的 leftToPrevLineEnd）。
    // 逐行上移直到命令头行（有内容，不走此路径）才恢复正常字符删除/溶解——这样光标能走出结构而不困在里面。
    if (key === 'Backspace') {
      const guardLines = prevRef.current.split('\n')
      const { map } = computeFlowLines(
        guardLines.map((codeLine, i) => ({ kind: 'codeline', rows: [], codeLine, lineIndex: i } as RenderBlock)),
      )
      const curSegs = map.get(li) || []
      const prevSegs = map.get(li - 1) || []
      // body 行：有流程段但自身不是结构头(start)；trailing 行：自身无段但上一行有段（结构紧邻其后的首个空行）。
      const isFlowBody = curSegs.length > 0 && !curSegs.some(seg => seg.type === 'start')
      const isFlowTrailing = curSegs.length === 0 && prevSegs.length > 0
      const nextSegs = map.get(li + 1) || []
      // 只保护「最小结构体」：那条空 body 行必须**上紧邻头/分支标记、下紧邻本结构的分支/结束标记**
      //（上下都是标记、中间没有任何正文），即它是本段唯一的最小占位 body。
      // 若下一行是正文内容（如 调试输出，只有 through 穿越段、非 branch/end），说明本段已有内容、
      // 这条空行是回车多敲出来的多余行 → 放行正常删除（删该行 + 光标上移到上一行末尾），不再保护。
      const prevIsFlowMarker = prevSegs.some(seg => seg.type === 'start' || seg.type === 'branch' || seg.type === 'end')
      const nextIsFlowMarker = nextSegs.some(seg => seg.type === 'branch' || seg.type === 'end')
      if (((isFlowBody && nextIsFlowMarker) || isFlowTrailing) && prevIsFlowMarker && li > 0) {
        applyCodeLineNavigation({ type: 'leftToPrevLineEnd', targetLine: li - 1 })
        return { handled: true, preventDefault: true }
      }
    }

    const deleteAction = getEmptyCodeLineDeleteAction({
      lines,
      lineIndex: li,
      key,
    })
    if (deleteAction.type === 'forbidden') {
      return { handled: true, preventDefault: true }
    }

    applyEmptyCodeLineDelete({ action: deleteAction, lineIndex: li, isVirtual: editCell.isVirtual })
    return { handled: true, preventDefault: true }
  }, [applyCodeLineNavigation, applyEmptyCodeLineDelete, editCell, editVal, getEmptyCodeLineDeleteAction, lines])

  // 可编辑行序列（文档序）：非虚拟代码行 + 表格非表头行（含该行可编辑单元格清单），
  // 供方向键在 代码行↔表格单元格 之间穿行导航使用。
  type EditableNavEntry =
    | { line: number; kind: 'code' }
    | { line: number; kind: 'cell'; cells: Array<{ ci: number; fieldIdx?: number; text: string; sliceField?: boolean; boolean?: boolean }> }
  const buildEditableNavEntries = useCallback((): EditableNavEntry[] => {
    const entries: EditableNavEntry[] = []
    const parsedAll = parseLines(prevRef.current)
    for (const blk of blocksRef.current) {
      if (blk.kind === 'codeline') {
        if (!blk.isVirtual) entries.push({ line: blk.lineIndex, kind: 'code' })
      } else if (blk.kind === 'table') {
        for (const row of blk.rows) {
          if (row.isHeader) continue
          const boolCis = getBooleanToggleCellIndexes(parsedAll[row.lineIndex]?.type || '', blk.tableType)
          entries.push({
            line: row.lineIndex,
            kind: 'cell',
            cells: row.cells.map((c, ci) => ({ ci, fieldIdx: c.fieldIdx, text: c.text || '', sliceField: c.sliceField, boolean: boolCis.has(ci) || undefined })),
          })
        }
      }
    }
    return entries
  }, [])

  // 进入导航目标单元格：打勾格进键盘焦点态（无输入框、焦点在 wrapper、空格切换），普通格进文本编辑
  const enterNavCell = useCallback((line: number, cell: { ci: number; fieldIdx?: number; text: string; sliceField?: boolean; boolean?: boolean }) => {
    if (cell.boolean) {
      setSelectedLines(new Set())
      lastFocusedLine.current = line
      setEditVal('')
      setEditCell({ lineIndex: line, cellIndex: cell.ci, fieldIdx: -1, sliceField: false, booleanCell: true })
      focusWrapper()
      return
    }
    startEditCell(line, cell.ci, cell.text, cell.fieldIdx, cell.sliceField)
  }, [startEditCell, focusWrapper])

  // 提交后按最新 blocks 定位并进入目标（代码行 / 同列单元格）
  const navigateEditableVertical = useCallback((fromLine: number, dir: -1 | 1, wantFieldIdx: number | undefined, keepHorizontalPos: number, wantCi?: number) => {
    commit()
    setTimeout(() => {
      const entries = buildEditableNavEntries()
      const idx = entries.findIndex(en => en.line === fromLine)
      if (idx < 0) return
      // 文档边界（无相邻可编辑行）：重新进入当前行，保证提交后光标不消失
      const target = entries[idx + dir] ?? entries[idx]
      if (!target) return
      if (target.kind === 'code') {
        startEditLine(target.line)
        focusInlineInputAt(keepHorizontalPos)
        return
      }
      const editableCells = target.cells.filter(c => c.fieldIdx !== undefined || c.boolean)
      if (editableCells.length === 0) return
      const cell = (wantFieldIdx !== undefined && wantFieldIdx >= 0 ? editableCells.find(c => c.fieldIdx === wantFieldIdx) : undefined)
        || (wantCi !== undefined ? editableCells.find(c => c.ci === wantCi) : undefined)
        || editableCells[0]
      enterNavCell(target.line, cell)
    }, 0)
  }, [commit, buildEditableNavEntries, startEditLine, focusInlineInputAt, enterNavCell])

  // 「插入变量」提示框执行：局部/程序集变量插入对应声明区，全局变量路由到 .egv 文件。
  // 插入后按位移恢复正在编辑的行（回车后正编辑下一行，插入声明会使其行号 +1）。
  const applyInsertVariable = useCallback((scope: 'local' | 'assembly' | 'global') => {
    const prompt = insertVarPrompt
    if (!prompt) return
    setInsertVarPrompt(null)
    const resumeLine = editCellRef.current?.lineIndex ?? null
    const resumeIsVirtual = editCellRef.current?.isVirtual
    if (editCellRef.current) commitRef.current()
    if (scope === 'global') {
      onRouteDeclarationPaste?.([{ language: 'egv', lines: [`.全局变量 ${prompt.name}, 整数型`] }])
      if (resumeLine != null) {
        setTimeout(() => { startEditLine(resumeLine, undefined, undefined, resumeIsVirtual); focusInlineInputAt('end') }, 0)
      }
      return
    }
    setTimeout(() => {
      const ls = prevRef.current.split('\n')
      const parsed = parseLines(prevRef.current)
      let insertAt = -1
      if (scope === 'local') {
        let subLine = -1
        for (let i = Math.min(prompt.anchorLine, parsed.length - 1); i >= 0; i--) {
          const t = parsed[i]?.type
          if (t === 'sub') { subLine = i; break }
          if (t === 'assembly') break
        }
        if (subLine < 0) return
        insertAt = subLine + 1
        while (insertAt < parsed.length && (parsed[insertAt].type === 'subParam' || parsed[insertAt].type === 'localVar')) insertAt++
        ls.splice(insertAt, 0, `.局部变量 ${prompt.name}, 整数型`)
      } else {
        let asmLine = -1
        for (let i = 0; i < parsed.length; i++) {
          if (parsed[i].type === 'assembly') { asmLine = i; break }
        }
        if (asmLine < 0) return
        insertAt = asmLine + 1
        while (insertAt < parsed.length && parsed[insertAt].type === 'assemblyVar') insertAt++
        ls.splice(insertAt, 0, `.程序集变量 ${prompt.name}, 整数型`)
      }
      const nt = ls.join('\n')
      setCurrentText(nt)
      prevRef.current = nt
      onChange(nt)
      if (resumeLine != null) {
        const adjusted = insertAt <= resumeLine ? resumeLine + 1 : resumeLine
        setTimeout(() => { startEditLine(adjusted, undefined, undefined, resumeIsVirtual); focusInlineInputAt('end') }, 0)
      }
    }, 0)
  }, [insertVarPrompt, onRouteDeclarationPaste, onChange, startEditLine, focusInlineInputAt])

  const applyArrowNavigationKey = useCallback((params: {
    key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
    cursorPos: number
  }): { handled: boolean; preventDefault: boolean } => {
    const { key, cursorPos } = params
    // 表格单元格编辑：↑/↓ 提交并移动到相邻可编辑行（相邻表格行取同 fieldIdx 单元格、
    // 相邻代码行进入行编辑）；→ 在文本末尾跨到本行下一可编辑格、← 在行首跨到上一格，
    // 其余情况保持输入框原生水平移动。
    if (editCell && editCell.cellIndex >= 0) {
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        navigateEditableVertical(editCell.lineIndex, key === 'ArrowUp' ? -1 : 1, editCell.fieldIdx, 0, editCell.cellIndex)
        return { handled: true, preventDefault: true }
      }
      // ←/→：仅在文本边界处跨列（打勾格无文本，任意 ←/→ 都跨列）
      const atStart = editCell.booleanCell ? true : cursorPos === 0
      const atEnd = editCell.booleanCell ? true : cursorPos >= editVal.length
      if ((key === 'ArrowRight' && !atEnd) || (key === 'ArrowLeft' && !atStart)) {
        return { handled: false, preventDefault: false }
      }
      const hDir = key === 'ArrowRight' ? 1 : -1
      const fromLine = editCell.lineIndex
      const fromCi = editCell.cellIndex
      commit()
      setTimeout(() => {
        const entries = buildEditableNavEntries()
        const rowEntry = entries.find(en => en.line === fromLine && en.kind === 'cell') as Extract<EditableNavEntry, { kind: 'cell' }> | undefined
        if (!rowEntry) return
        const editableCells = rowEntry.cells.filter(c => c.fieldIdx !== undefined || c.boolean)
        const pos = editableCells.findIndex(c => c.ci === fromCi)
        if (pos < 0) return
        const next = editableCells[pos + hDir]
        if (!next) {
          // 行首/行末继续按 → 跨行：→ 进下一可编辑行（表格行取首格、代码行进行首），
          // ← 进上一行（表格行取末格、代码行进行尾）；文档边界重新进入当前格（光标不消失）。
          const idx = entries.findIndex(en => en.line === fromLine)
          const target = idx >= 0 ? entries[idx + hDir] : undefined
          if (!target) {
            const cur = editableCells[pos]
            enterNavCell(fromLine, cur)
            if (!cur.boolean) pendingInputCaretRef.current = hDir === 1 ? cur.text.length : 0
            return
          }
          if (target.kind === 'code') {
            startEditLine(target.line)
            focusInlineInputAt(hDir === 1 ? 0 : 'end')
            return
          }
          const targetCells = target.cells.filter(c => c.fieldIdx !== undefined || c.boolean)
          if (targetCells.length === 0) return
          const cell2 = hDir === 1 ? targetCells[0] : targetCells[targetCells.length - 1]
          enterNavCell(target.line, cell2)
          if (!cell2.boolean) pendingInputCaretRef.current = hDir === 1 ? 0 : cell2.text.length
          return
        }
        enterNavCell(fromLine, next)
        // → 进入下一格光标置行首、← 进入上一格光标置行尾（打勾格无输入框不需要）
        if (!next.boolean) pendingInputCaretRef.current = hDir === 1 ? 0 : next.text.length
      }, 0)
      return { handled: true, preventDefault: true }
    }
    if (!(editCell && editCell.cellIndex < 0)) {
      return { handled: false, preventDefault: false }
    }

    const navAction = getCodeLineNavigationAction({
      key,
      lineIndex: editCell.lineIndex,
      cursorPos,
      currentValueLength: editVal.length,
    })
    if (!navAction) return { handled: false, preventDefault: false }

    // 代码行 ↑/↓：相邻可编辑行若是表格行，进入其单元格（旧路径只认代码行、会整表跳过）；
    // 相邻仍是代码行则走原 applyCodeLineNavigation（保留隐藏行解析与水平位保持等语义）。
    if (navAction.type === 'upOrDown' && !editCell.isVirtual) {
      const dir: -1 | 1 = key === 'ArrowUp' ? -1 : 1
      const entries = buildEditableNavEntries()
      const idx = entries.findIndex(en => en.line === editCell.lineIndex)
      const target = idx >= 0 ? entries[idx + dir] : undefined
      if (target && target.kind === 'cell') {
        navigateEditableVertical(editCell.lineIndex, dir, 0, cursorPos)
        return { handled: true, preventDefault: true }
      }
    }

    applyCodeLineNavigation(navAction)
    return { handled: true, preventDefault: true }
  }, [applyCodeLineNavigation, editCell, editVal, getCodeLineNavigationAction, commit, enterNavCell, startEditLine, focusInlineInputAt, buildEditableNavEntries, navigateEditableVertical])
  applyArrowNavigationKeyRef.current = applyArrowNavigationKey

  const applyParenScopedKey = useCallback((params: {
    key: string
    cursorPos: number
  }): { handled: boolean; preventDefault: boolean } => {
    const { key, cursorPos } = params
    if (!(editCell && editCell.cellIndex < 0 && editCell.paramIdx === undefined)) {
      return { handled: false, preventDefault: false }
    }

    const parenScopedAction = getParenScopedKeyAction({
      key,
      editValue: editVal,
      cursorPos,
    })
    if (!parenScopedAction) return { handled: false, preventDefault: false }

    applyParenScopedAction({ action: parenScopedAction, lineIndex: editCell.lineIndex })
    return { handled: true, preventDefault: true }
  }, [applyParenScopedAction, editCell, editVal, getParenScopedKeyAction])

  const applyEscapeKey = useCallback((): { handled: boolean; preventDefault: boolean } => {
    setAcVisible(false)
    setEditCell(null)
    return { handled: true, preventDefault: false }
  }, [])

  // 参数展开小输入框专用 Ctrl+Z/Y 路由：原先这些输入框只处理 Enter/Escape，
  // Ctrl+Z 落入浏览器原生输入撤销（只撤输入内的打字历史），与文档级 undoStack 无关；
  // 而全局 keydown 监听器遇到 INPUT 焦点会直接跳过。结果就是"按 Ctrl+Z 毫无反应"。
  // 这里显式把 Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z 路由到文档撤销栈，并关闭当前未提交的编辑，
  // 避免撤销后 blur 再把旧 editVal 提交回去覆盖已恢复的文本。
  const handleParamInputCtrlKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>): boolean => {
    if (!(e.ctrlKey || e.metaKey)) return false
    const key = e.key.toLowerCase()
    if (key !== 'z' && key !== 'y') return false
    // 参数展开小输入框内的 Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z → 全局撤销栈；
    // 先关编辑，保证撤销后 onBlur 的 commit 不会把旧 editVal 写回覆盖已回退的文本。
    e.preventDefault()
    setEditCell(null)
    if (key === 'z' && !e.shiftKey) onGlobalUndo?.()
    else onGlobalRedo?.()
    return true
  }, [onGlobalUndo, onGlobalRedo])

  const onKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    const cursorPos = e.currentTarget.selectionStart ?? 0
    // 先过守卫层：补全弹窗、Ctrl 组合键、括号上下文等高优先行为。
    const preAction = dispatchPreKeyGuards({
      key: e.key,
      cursorPos,
      ctrl: e.ctrlKey || e.metaKey,
      shiftKey: e.shiftKey,
      onTypeCellSpaceGuard: applyTypeCellSpaceGuard,
      onCompletionPopupKey: applyCompletionPopupKey,
      onCtrlShortcut: ({ key, shiftKey }) => {
        const k = key.toLowerCase()
        // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z：统一上抛给外层全局撤销栈；先结束当前输入态，
        // 避免撤销后 blur 把旧 editVal 提交回去覆盖已回退的文本。
        if (k === 'z' || k === 'y') {
          setEditCell(null)
          if (k === 'z' && !shiftKey) onGlobalUndo?.()
          else onGlobalRedo?.()
          return { handled: true, preventDefault: true }
        }
        return dispatchCtrlShortcutWithHistory({
          key,
          shiftKey,
          undoStack: undoStack.current,
          redoStack: redoStack.current,
          currentText: prevRef.current,
          applyTextChange: (next) => {
            setEditCell(null)
            applyTextChange(next)
          },
          onSelectAll: () => {
            // 全选基于最新文本快照，避免使用过期闭包内容。
            const ls = prevRef.current.split('\n')
            const all = new Set<number>()
            for (let i = 0; i < ls.length; i++) all.add(i)
            setSelectedLines(all)
            dragAnchor.current = 0
            setAcVisible(false)
            setEditCell(null)
            focusWrapper()
          },
          onPaste: () => applyCustomPasteShortcut(),
        })
      },
      onParenScopedKey: applyParenScopedKey,
    })
    if (preAction.handled) {
      if (preAction.preventDefault) e.preventDefault()
      return
    }

    // ===== 主键分派 =====
    const mainAction = dispatchMainEditingKey({
      key: e.key,
      cursorPos,
      onEnter: applyEnterKey,
      onDeleteKey: applyEmptyDeleteKey,
      onEscape: applyEscapeKey,
      onArrow: applyArrowNavigationKey,
    })
    if (mainAction.handled) {
      if (mainAction.preventDefault) e.preventDefault()
      return
    }
  }, [
    applyArrowNavigationKey,
    applyCompletionPopupKey,
    applyEmptyDeleteKey,
    applyEnterKey,
    applyEscapeKey,
    applyParenScopedKey,
    applyTypeCellSpaceGuard,
    applyTextChange,
    applyCustomPasteShortcut,
    focusWrapper,
    onGlobalUndo,
    onGlobalRedo,
  ])

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

    // 删除结构性结束/起始行不再拒绝：统一按"溶解"语义处理。
    pushUndo(currentText)
    const repaired = applyFlowAwareDeletion(ls, deletable)
    const nt = repaired.join('\n')
    setCurrentText(nt)
    prevRef.current = nt
    onChange(nt)
    setSelectedLines(new Set())
    return true
  }, [currentText, onChange, pushUndo, applyFlowAwareDeletion])

  const handleWrapperContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const host = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-line-index]')
    const lineRaw = host?.dataset.lineIndex
    const lineIndex = lineRaw == null ? NaN : Number.parseInt(lineRaw, 10)
    if (Number.isFinite(lineIndex) && lineIndex >= 0) {
      if (!selectedLines.has(lineIndex)) {
        setSelectedLines(new Set([lineIndex]))
      }
      dragAnchor.current = lineIndex
      lastFocusedLine.current = lineIndex
    }
    focusWrapper()
    const menuScale = Math.max(eycScale, 0.01)
    setEditorContextMenu({
      // 编辑器根节点使用 zoom 缩放；菜单坐标需做反向缩放补偿，保证贴合鼠标点。
      x: Math.round(e.clientX / menuScale),
      y: Math.round(e.clientY / menuScale),
      lineIndex: Number.isFinite(lineIndex) && lineIndex >= 0 ? lineIndex : null,
    })
  }, [eycScale, focusWrapper, selectedLines])

  const copySelectionToClipboard = useCallback((): boolean => {
    if (selectedLines.size > 0) {
      void navigator.clipboard.writeText(getSelectedSourceText())
      return true
    }
    const selectedText = getMouseRangeSelectedSourceText()
    if (!selectedText) return false
    void navigator.clipboard.writeText(selectedText)
    return true
  }, [getMouseRangeSelectedSourceText, getSelectedSourceText, selectedLines])

  const resolveContextLineIndex = useCallback((): number => {
    if (editorContextMenu?.lineIndex !== null && editorContextMenu?.lineIndex !== undefined) {
      return editorContextMenu.lineIndex
    }
    if (selectedLines.size > 0) {
      return Math.min(...selectedLines)
    }
    return Math.max(lastFocusedLine.current, 0)
  }, [editorContextMenu?.lineIndex, selectedLines])

  const applyLineCommentState = useCallback((mode: 'block' | 'unblock') => {
    const ls = prevRef.current.split('\n')
    const targetLines = selectedLines.size > 0
      ? [...selectedLines].sort((a, b) => a - b)
      : [resolveContextLineIndex()]

    let changed = false
    for (const idx of targetLines) {
      if (idx < 0 || idx >= ls.length) continue
      const line = ls[idx] || ''
      const indent = line.match(/^\s*/)?.[0] || ''
      const body = line.slice(indent.length)

      if (mode === 'block') {
        if (!body || body.startsWith("'")) continue
        ls[idx] = `${indent}' ${body}`
        changed = true
        continue
      }

      if (body.startsWith("' ")) {
        ls[idx] = indent + body.slice(2)
        changed = true
      } else if (body.startsWith("'")) {
        ls[idx] = indent + body.slice(1)
        changed = true
      }
    }

    if (!changed) {
      setEditorContextMenu(null)
      return
    }
    const nextText = ls.join('\n')
    pushUndo(prevRef.current)
    setCurrentText(nextText)
    prevRef.current = nextText
    onChange(nextText)
    setEditorContextMenu(null)
  }, [onChange, pushUndo, resolveContextLineIndex, selectedLines])

  const pasteFromClipboardAtContext = useCallback(() => {
    if (shouldUseNativeInputPaste(editCellRef.current)) return
    void navigator.clipboard.readText().then(clipText => {
      if (!clipText) return
      const latestText = prevRef.current
      const cursorLine = editCellRef.current?.lineIndex
        ?? editorContextMenu?.lineIndex
        ?? lastFocusedLine.current
      const pasteResult = buildMultiLinePasteResult({
        currentText: latestText,
        clipText,
        cursorLine,
        sanitizePastedText: sanitizePastedTextForCurrent,
        extractAssemblyVarLines: extractAssemblyVarLinesFromPasted,
        extractRoutedDeclarationLines: extractRoutedDeclarationLinesFromPasted,
        replaceLineIndices: selectedLinesRef.current.size > 0 ? Array.from(selectedLinesRef.current) : undefined,
      })
      if (!pasteResult) return
      if (pasteResult.routedDeclarations.length > 0) {
        onRouteDeclarationPaste?.(pasteResult.routedDeclarations)
      }
      pushUndo(latestText)
      const nt = pasteResult.nextText
      setCurrentText(nt)
      prevRef.current = nt
      onChange(nt)
      const newSel = new Set<number>()
      for (let i = 0; i < pasteResult.pastedLineCount; i++) newSel.add(pasteResult.insertAt + i)
      setSelectedLines(newSel)
      lastFocusedLine.current = pasteResult.insertAt + pasteResult.pastedLineCount - 1
    })
  }, [editorContextMenu?.lineIndex, extractAssemblyVarLinesFromPasted, extractRoutedDeclarationLinesFromPasted, onChange, onRouteDeclarationPaste, pushUndo, sanitizePastedTextForCurrent, shouldUseNativeInputPaste])

  const applyEditorContextAction = useCallback((action: 'newSubprogram' | 'newDllCommand' | 'newPtrCommand' | 'undo' | 'redo' | 'copy' | 'cut' | 'paste' | 'delete' | 'insertLine' | 'compileLine' | 'block' | 'unblock' | 'selectAll') => {
    if (action === 'newSubprogram') {
      setEditorContextMenu(null)
      if (ref && typeof ref !== 'function') {
        ref.current?.insertSubroutine?.()
      }
      return
    }
    if (action === 'newDllCommand' || action === 'newPtrCommand') {
      setEditorContextMenu(null)
      const isPtr = action === 'newPtrCommand'
      const declPrefix = isPtr ? '.指针命令 ' : '.DLL命令 '
      const baseName = isPtr ? '指针命令' : 'DLL命令'
      const baseText = prevRef.current
      const curLines = baseText.split('\n')

      // 收集已有命令名，生成唯一名称
      const existingNames = new Set<string>()
      for (const ln of curLines) {
        const t = ln.replace(/[\r\t]/g, '').trim()
        if (t.startsWith(declPrefix)) {
          const name = (splitCSV(t.slice(declPrefix.length))[0] || '').trim()
          if (name) existingNames.add(name)
        }
      }
      let num = 1
      while (existingNames.has(baseName + num)) num++
      const declLine = isPtr
        ? declPrefix + baseName + num
        : declPrefix + baseName + num + ', , "", ""'

      // 去除末尾空行后追加，使声明块之间保持一个空行
      let end = curLines.length
      while (end > 0 && curLines[end - 1].replace(/[\r\t]/g, '').trim() === '') end--
      const nl = [...curLines.slice(0, end), '', declLine, '']
      pushUndo(baseText)
      applyTextChange(nl.join('\n'))

      const newLineIndex = nl.length - 2
      lastFocusedLine.current = newLineIndex
      window.setTimeout(() => {
        const row = wrapperRef.current?.querySelector<HTMLElement>(`tr.eyc-data-row[data-line-index="${newLineIndex}"]`)
        if (!row) return
        row.scrollIntoView({ block: 'center' })
        row.classList.add('highlight-flash')
        window.setTimeout(() => row.classList.remove('highlight-flash'), 900)
      }, 80)
      return
    }
    if (action === 'undo') {
      // 右键菜单撤销 → 全局撤销栈（与 Ctrl+Z 一致）
      setEditorContextMenu(null)
      onGlobalUndo?.()
      return
    }
    if (action === 'redo') {
      setEditorContextMenu(null)
      onGlobalRedo?.()
      return
    }
    if (action === 'copy') {
      copySelectionToClipboard()
      setEditorContextMenu(null)
      return
    }
    if (action === 'cut') {
      if (selectedLines.size > 0) {
        void navigator.clipboard.writeText(getSelectedSourceText())
        deleteLineSelection(selectedLines)
      }
      setEditorContextMenu(null)
      return
    }
    if (action === 'paste') {
      pasteFromClipboardAtContext()
      setEditorContextMenu(null)
      return
    }
    if (action === 'delete') {
      if (selectedLines.size > 0) {
        deleteLineSelection(selectedLines)
      } else {
        const line = resolveContextLineIndex()
        deleteLineSelection(new Set([line]))
      }
      setEditorContextMenu(null)
      return
    }
    if (action === 'insertLine') {
      const line = resolveContextLineIndex()
      const latestLines = prevRef.current.split('\n')
      const insertAt = Math.min(Math.max(line + 1, 0), latestLines.length)
      latestLines.splice(insertAt, 0, '')
      const nextText = latestLines.join('\n')
      pushUndo(prevRef.current)
      setCurrentText(nextText)
      prevRef.current = nextText
      onChange(nextText)
      lastFocusedLine.current = insertAt
      setEditorContextMenu(null)
      window.setTimeout(() => startEditLine(insertAt, undefined, undefined, undefined, true), 0)
      return
    }
    if (action === 'compileLine') {
      // 触发与快捷键一致的按键事件；如上层已绑定 Shift+Enter，将自动复用。
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', shiftKey: true, bubbles: true }))
      setEditorContextMenu(null)
      return
    }
    if (action === 'block') {
      applyLineCommentState('block')
      return
    }
    if (action === 'unblock') {
      applyLineCommentState('unblock')
      return
    }
    const ls = prevRef.current.split('\n')
    const all = new Set<number>()
    for (let i = 0; i < ls.length; i++) all.add(i)
    setSelectedLines(all)
    dragAnchor.current = 0
    setEditorContextMenu(null)
  }, [applyLineCommentState, applyTextChange, copySelectionToClipboard, deleteLineSelection, getSelectedSourceText, onChange, pasteFromClipboardAtContext, pushUndo, ref, resolveContextLineIndex, selectedLines, startEditLine, onGlobalUndo, onGlobalRedo])

  // 撤销/重做统一走外层全局撤销栈：只要外层接了全局处理器就允许点击，
  // 是否真有可撤销/重做项由全局栈在点击时决定（无项则空操作）。
  const canUndoContextAction = !!onGlobalUndo
  const canRedoContextAction = !!onGlobalRedo
  const hasLineSelection = selectedLines.size > 0
  const hasCopySelection = hasLineSelection || (getMouseRangeSelectedSourceText() || '').length > 0
  const canCutContextAction = hasLineSelection

  useEffect(() => {
    if (!editorContextMenu) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const key = (event.key || '').toLowerCase()
      if (key === 'n') {
        event.preventDefault()
        applyEditorContextAction(docLanguage === 'ell' ? 'newDllCommand' : 'newSubprogram')
        return
      }
      if (key === 'z' && docLanguage === 'ell') {
        event.preventDefault()
        applyEditorContextAction('newPtrCommand')
        return
      }
      if (key === 'u') {
        if (!canUndoContextAction) return
        event.preventDefault()
        applyEditorContextAction('undo')
        return
      }
      if (key === 'y') {
        if (!canRedoContextAction) return
        event.preventDefault()
        applyEditorContextAction('redo')
        return
      }
      if (key === 'c') {
        if (!hasCopySelection) return
        event.preventDefault()
        applyEditorContextAction('copy')
        return
      }
      if (key === 't') {
        if (!canCutContextAction) return
        event.preventDefault()
        applyEditorContextAction('cut')
        return
      }
      if (key === 'p') {
        if (!contextMenuCanPaste) return
        event.preventDefault()
        applyEditorContextAction('paste')
        return
      }
      if (key === 'f') {
        event.preventDefault()
        applyEditorContextAction('selectAll')
        return
      }
      if (key === 'e') {
        event.preventDefault()
        applyEditorContextAction('delete')
        return
      }
      if (key === 'i') {
        event.preventDefault()
        applyEditorContextAction('insertLine')
        return
      }
      if (key === 'k') {
        event.preventDefault()
        applyEditorContextAction('compileLine')
        return
      }
      if (key === 'g') {
        event.preventDefault()
        applyEditorContextAction('block')
        return
      }
      if (key === 'b') {
        event.preventDefault()
        applyEditorContextAction('unblock')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [applyEditorContextAction, canCutContextAction, canRedoContextAction, canUndoContextAction, contextMenuCanPaste, docLanguage, editorContextMenu, hasCopySelection])

  const navigateToSubprogramInternal = useCallback((subName: string, fallbackLine?: number, preferredHeaderIndex?: number) => {
    const navSeq = ++subNavSeqRef.current
    const normalizedName = (subName || '').trim()
    let flashLineIndex = -1
    let cursorLineIndex = -1
    let subHeaderLineIndex = -1
    let ls = currentText.split('\n')

    if (normalizedName) {
      const matches: number[] = []
      for (let i = 0; i < ls.length; i++) {
        const t = ls[i].replace(/[\r\t]/g, '').trim()
        if (!t.startsWith('.子程序 ')) continue
        const name = (splitCSV(t.slice('.子程序 '.length))[0] || '').trim()
        if (name === normalizedName) {
          matches.push(i)
        }
      }

      if (matches.length > 0) {
        if (Number.isFinite(preferredHeaderIndex) && matches.includes(preferredHeaderIndex as number)) {
          subHeaderLineIndex = preferredHeaderIndex as number
        } else if (Number.isFinite(fallbackLine) && (fallbackLine || 0) > 0) {
          const target = (fallbackLine as number) - 1
          subHeaderLineIndex = matches.reduce((best, cur) => (
            Math.abs(cur - target) < Math.abs(best - target) ? cur : best
          ), matches[0])
        } else {
          subHeaderLineIndex = matches[0]
        }
      }
    }

    if (subHeaderLineIndex >= 0) {
      flashLineIndex = subHeaderLineIndex
      let nextSubHeader = ls.length
      for (let i = subHeaderLineIndex + 1; i < ls.length; i++) {
        const t = ls[i].replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ')) {
          nextSubHeader = i
          break
        }
      }

      for (let i = subHeaderLineIndex + 1; i < nextSubHeader; i++) {
        const t = ls[i].replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.')) continue
        cursorLineIndex = i
        break
      }

      if (cursorLineIndex < 0) {
        const insertAt = nextSubHeader
        const materializedLines = [...ls]
        materializedLines.splice(insertAt, 0, '')
        const nextText = materializedLines.join('\n')
        pushUndo(currentText)
        applyTextChange(nextText)
        ls = materializedLines
        cursorLineIndex = insertAt
      }

      if (cursorLineIndex < 0) {
        cursorLineIndex = Math.min(subHeaderLineIndex + 1, Math.max(ls.length - 1, 0))
      }
    }

    if (flashLineIndex < 0 && Number.isFinite(fallbackLine) && (fallbackLine || 0) > 0) {
      flashLineIndex = Math.min((fallbackLine as number) - 1, Math.max(ls.length - 1, 0))
    }
    if (cursorLineIndex < 0 && flashLineIndex >= 0) cursorLineIndex = flashLineIndex
    if (flashLineIndex < 0 || cursorLineIndex < 0) return

    const shouldFlashOnSubTable = subHeaderLineIndex >= 0
    lastFocusedLine.current = flashLineIndex
    scrollToLineIndex(flashLineIndex, 'auto')

    const flashAfterScrollSettled = (attempt = 0): void => {
      if (navSeq !== subNavSeqRef.current) return
      const wrapper = wrapperRef.current
      if (!wrapper) return

      // 子程序跳转仅允许闪烁在表格数据行；在“文本裁切过渡帧”中未就绪时短暂重试。
      const tableFlashEl = wrapper.querySelector<HTMLElement>(`tr.eyc-data-row[data-line-index="${flashLineIndex}"]`)
      const flashEl = shouldFlashOnSubTable
        ? tableFlashEl
        : (tableFlashEl ?? wrapper.querySelector<HTMLElement>(`[data-line-index="${flashLineIndex}"]`))

      if (!flashEl) {
        if (shouldFlashOnSubTable && attempt < 24) {
          window.setTimeout(() => flashAfterScrollSettled(attempt + 1), 34)
          return
        }
        // 目标行未稳定出现时宁可不闪，也不命中过渡态错误节点。
        window.setTimeout(() => focusCursorAtLineStart(), 90)
        return
      }

      // 清理上一跳残留闪烁，避免视觉上出现“闪错行”。
      wrapper.querySelectorAll('.highlight-flash').forEach((node) => {
        node.classList.remove('highlight-flash')
      })
      flashEl.classList.add('highlight-flash')
      setTimeout(() => {
        if (navSeq !== subNavSeqRef.current) return
        flashEl.classList.remove('highlight-flash')
      }, 1500)
      // 先建立视觉定位，再进入输入编辑态，避免渲染重排把闪烁误投到光标行。
      window.setTimeout(() => focusCursorAtLineStart(), 90)
    }

    // 等待滚动与布局收敛后再闪烁，避免“先在下方后瞬间居中”时闪烁错位。
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(() => flashAfterScrollSettled(), 30)
      })
    })

    const focusCursorAtLineStart = (): void => {
      if (navSeq !== subNavSeqRef.current) return
      startEditLine(cursorLineIndex, undefined, undefined, undefined, true)
      window.setTimeout(() => {
        if (navSeq !== subNavSeqRef.current) return
        if (!inputRef.current) startEditLine(cursorLineIndex, undefined, undefined, undefined, true)
        focusCodeInputAt(0)
      }, 0)
    }

    // 聚焦编辑动作由 flashAfterScrollSettled 触发，确保闪烁先落在目标表格行。
  }, [applyTextChange, currentText, focusCodeInputAt, pushUndo, scrollToLineIndex, startEditLine])

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

      const nl = [...curLines]
      // 统一为“真实空行 + 子程序声明 + 真实空普通行”，不再自动附带默认局部变量。
      nl.splice(insertAt, 0, '', '.子程序 ' + newName + ', , , ', '')
      const nt = nl.join('\n')
      applyTextChange(nt)

      const newSubLineIndex = insertAt + 1
      const firstCodeLineIndex = insertAt + 2
      lastFocusedLine.current = newSubLineIndex
      const focusFirstCodeLine = (): void => {
        startEditLine(firstCodeLineIndex, undefined, undefined, undefined, true)
        focusCodeInputAt(0)
      }

      const flashNewSubAfterTableReady = (attempt = 0): void => {
        const wrapper = wrapperRef.current
        if (!wrapper) return
        // 仅允许闪烁在表格数据行，避免文本过渡态节点误命中。
        const tableFlashEl = wrapper.querySelector<HTMLElement>(`tr.eyc-data-row[data-line-index="${newSubLineIndex}"]`)
        if (!tableFlashEl) {
          if (attempt < 24) {
            window.setTimeout(() => flashNewSubAfterTableReady(attempt + 1), 34)
            return
          }
          window.setTimeout(() => focusFirstCodeLine(), 90)
          return
        }

        wrapper.querySelectorAll('.highlight-flash').forEach((node) => {
          node.classList.remove('highlight-flash')
        })
        tableFlashEl.classList.add('highlight-flash')
        window.setTimeout(() => {
          tableFlashEl.classList.remove('highlight-flash')
        }, 1200)
        window.setTimeout(() => focusFirstCodeLine(), 90)
      }

      scrollToLineIndex(newSubLineIndex, 'auto')
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.setTimeout(() => flashNewSubAfterTableReady(), 30)
        })
      })
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
      applyTextChange(nt)

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
      applyTextChange(nt)

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
      const normalizedSubName = (subName || '').trim()

      // 查找同名子程序是否已存在
      let subLineIndex = -1
      for (let i = 0; i < curLines.length; i++) {
        const t = curLines[i].replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ')) {
          const name = (splitCSV(t.slice('.子程序 '.length))[0] || '').trim()
          if (name === normalizedSubName) { subLineIndex = i; break }
        }
      }

      if (subLineIndex >= 0) {
        // 已存在子程序直接复用统一跳转逻辑，保证与项目树双击一致。
        navigateToSubprogramInternal(normalizedSubName, subLineIndex + 1, subLineIndex)
        return
      }

      // 不存在：在文件末尾插入新子程序
      pushUndo(currentText)
      const insertLines: string[] = ['', '.子程序 ' + subName + ', , , ']
      for (const p of params) {
        insertLines.push('    .参数 ' + p.name + ', ' + (p.dataType || '整数型') + (p.isByRef ? ', 传址' : ''))
      }
      // 为新建子程序补一条真实空普通行，避免仅显示无行号的虚拟占位行。
      insertLines.push('')
      const nl = [...curLines, ...insertLines]
      const nt = nl.join('\n')
      applyTextChange(nt)

      // 新子程序行位置：前置空行后为子程序声明。
      const newSubLineIndex = curLines.length + 1
      const firstCodeLineIndex = curLines.length + 2 + params.length
      lastFocusedLine.current = newSubLineIndex
      setTimeout(() => {
        const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${newSubLineIndex}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        startEditLine(firstCodeLineIndex, undefined, undefined, undefined, true)
        focusCodeInputAt(0)
      }, 150)
    },
    navigateToLine: (line: number) => {
      const lineIndex = line - 1
      lastFocusedLine.current = lineIndex
      const focusTargetLine = (): void => {
        // 先走统一跳转逻辑：找得到目标行时精准定位，找不到时按比例跳转。
        scrollToLineIndex(lineIndex, 'auto')
        const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${lineIndex}"]`)
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'center' })
          el.classList.add('highlight-flash')
          setTimeout(() => el.classList.remove('highlight-flash'), 1500)
        }
      }

      // 立即执行一次，再在布局稳定后补两次对齐，避免跨文档长文件首跳未到位。
      focusTargetLine()
      window.requestAnimationFrame(() => {
        focusTargetLine()
        window.requestAnimationFrame(() => focusTargetLine())
      })
      window.setTimeout(() => focusTargetLine(), 180)
    },
    navigateToSubprogram: (subName: string, fallbackLine?: number) => {
      navigateToSubprogramInternal(subName, fallbackLine)
    },
    getVisibleLineForSourceLine: (line: number) => {
      if (!Number.isFinite(line) || line <= 0) return line
      return lineNumMaps.sourceLineNumMap.get(line - 1) ?? line
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
  }), [applyTextChange, currentText, focusCodeInputAt, pushUndo, selectedLines, getSelectedSourceText, getMouseRangeSelectedSourceText, isResourceTableDoc, shouldUseNativeInputPaste, lineNumMaps, startEditLine, navigateToSubprogramInternal])

  // 查找代码行中第一个有参数的有效命令
  const findCmdWithParams = useCallback((codeLine: string): CompletionItem | null => {
    if (!codeLine) return null
    const spans = colorize(codeLine)
    for (const s of spans) {
      if ((s.cls === 'funccolor' || s.cls === 'comecolor') && validCommandNames.has(s.text)) {
        const cmd = allCommandsRef.current.find(c => c.name === s.text) || dllCompletionItemsRef.current.find(c => c.name === s.text)
        if (cmd && cmd.params.length > 0) return cmd
      }
      // 对象.方法（项目类公开方法）同样支持参数展开
      if (s.cls === 'funccolor' || s.cls === 'cometwolr') {
        const clsMethod = findProjectClassMethodByName(s.text)
        if (clsMethod && clsMethod.params.length > 0) return clsMethod
      }
    }
    return null
  }, [validCommandNames, findProjectClassMethodByName])

  const findCommandCallWithParams = useCallback((expr: string): { cmd: CompletionItem; args: string[] } | null => {
    const normalized = (expr || '').trim()
    if (!normalized) return null
    const head = /^([\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z_][\u4e00-\u9fa5\u3400-\u4dbf\uac00-\ud7a3\u3040-\u30ffA-Za-z0-9_.。．]*)\s*[(（]/.exec(normalized)
    if (!head) return null
    const cmdName = (head[1] || '').trim()
    if (!cmdName) return null
    const cmd = allCommandsRef.current.find(c => c.name === cmdName)
      || dllCompletionItemsRef.current.find(c => c.name === cmdName)
      || ((cmdName.includes('.') || cmdName.includes('。') || cmdName.includes('．')) ? findProjectClassMethodByName(cmdName) : null)
    if (!cmd || cmd.params.length === 0) return null
    const args = parseCallArgs(normalized)
    return { cmd, args }
  }, [findProjectClassMethodByName])

  const findTopLevelAdditiveParts = useCallback((expr: string): { left: string; right: string } | null => {
    const normalized = (expr || '').trim()
    if (!normalized) return null
    let depth = 0
    let inStr = false
    let strEnd = ''
    for (let i = normalized.length - 1; i >= 0; i--) {
      const ch = normalized[i]
      if (inStr) {
        if (ch === strEnd) inStr = false
        continue
      }
      if (ch === '"' || ch === '\u201d') {
        inStr = true
        strEnd = ch === '\u201d' ? '\u201c' : '"'
        continue
      }
      if (ch === ')' || ch === '）') { depth++; continue }
      if (ch === '(' || ch === '（') { depth--; continue }
      if (depth !== 0) continue
      if (ch !== '+' && ch !== '＋') continue

      let j = i - 1
      while (j >= 0 && /\s/.test(normalized[j])) j--
      const prev = j >= 0 ? normalized[j] : ''
      if (!prev || /[+\-*/%(<>=!&|,，]/.test(prev)) continue

      const left = normalized.slice(0, i).trim()
      const right = normalized.slice(i + 1).trim()
      if (!left || !right) continue
      return { left, right }
    }
    return null
  }, [])

  const buildExprExpandItems = useCallback((expr: string, depth = 0): ExprExpandItem[] => {
    if (depth > 6) return []
    const normalized = (expr || '').trim()
    if (!normalized) return []

    const additive = findTopLevelAdditiveParts(normalized)
    if (additive) {
      const leftChildren = buildExprExpandItems(additive.left, depth + 1)
      const rightChildren = buildExprExpandItems(additive.right, depth + 1)
      return [
        {
          name: '被加数或文本或字节集',
          value: additive.left,
          children: leftChildren.length > 0 ? leftChildren : undefined,
        },
        {
          name: '加数或文本或字节集',
          value: additive.right,
          children: rightChildren.length > 0 ? rightChildren : undefined,
        },
      ]
    }

    const call = findCommandCallWithParams(normalized)
    if (!call) return []
    return call.cmd.params.map((p, pi) => {
      const argVal = call.args[pi] !== undefined ? call.args[pi] : ''
      const childItems = buildExprExpandItems(argVal, depth + 1)
      return {
        name: p.name,
        value: argVal,
        commandName: call.cmd.name,
        commandParamIndex: pi,
        children: childItems.length > 0 ? childItems : undefined,
      }
    })
  }, [findCommandCallWithParams, findTopLevelAdditiveParts])

  /** 聚焦参数输入框并按点击 X 坐标定位光标（valueLeft 为原值文本的左边缘） */
  const focusParamInputAt = useCallback((clickX?: number, valueLeft?: number): void => {
    setTimeout(() => {
      const input = paramInputRef.current
      if (!input) return
      try {
        input.focus({ preventScroll: true })
      } catch {
        input.focus()
      }
      if (clickX === undefined || valueLeft === undefined) return
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.font = getComputedStyle(input).font || '12px Consolas, "Microsoft YaHei", monospace'
      const text = input.value
      let relX = clickX - valueLeft
      if (relX < 0) relX = 0
      let pos = text.length
      const fullWidth = ctx.measureText(text).width
      if (relX < fullWidth) {
        for (let i = 1; i <= text.length; i++) {
          const w = ctx.measureText(text.slice(0, i)).width
          if (w > relX) {
            const wPrev = ctx.measureText(text.slice(0, i - 1)).width
            pos = (relX - wPrev < w - relX) ? i - 1 : i
            break
          }
        }
      }
      input.setSelectionRange(pos, pos)
    }, 0)
  }, [])

  /** 按路径替换参数表达式中的子节点文本（路径与 buildExprExpandItems 的拆分顺序一致） */
  const replaceExprAtPath = useCallback((expr: string, path: number[], newText: string): string => {
    if (path.length === 0) return newText
    const normalized = (expr || '').trim()
    const [head, ...rest] = path
    const additive = findTopLevelAdditiveParts(normalized)
    if (additive) {
      if (head === 0) return `${replaceExprAtPath(additive.left, rest, newText)} ＋ ${additive.right}`
      if (head === 1) return `${additive.left} ＋ ${replaceExprAtPath(additive.right, rest, newText)}`
      return normalized
    }
    const call = findCommandCallWithParams(normalized)
    if (!call) return normalized
    const newArg = replaceExprAtPath(call.args[head] !== undefined ? call.args[head] : '', rest, newText)
    return replaceCallArg(normalized, head, newArg)
  }, [findCommandCallWithParams, findTopLevelAdditiveParts])

  const renderExprExpandItems = useCallback((items: ExprExpandItem[], lineIndex: number, topParamIdx: number, parentPath: number[], depth = 0, keyPrefix = 'root', baseFlowDepth = 0): React.ReactNode => {
    if (!items || items.length === 0) return null
    const depthClass = `eyc-param-expand-secondary-depth-${Math.min(Math.max(depth, 0), 6)}`
    const levelColors = resolveFlowLineColors(flowLineModeConfig, Math.max(0, baseFlowDepth + depth + 1))
    return (
      <div
        className={`eyc-param-expand-secondary ${depthClass}`}
        ref={(element) => setCssVars(element, {
          '--flow-inner-link-color': levelColors.innerLink,
          '--flow-arrow-color': levelColors.arrow,
        })}
      >
        <span className="eyc-param-expand-arrow eyc-param-expand-arrow-secondary" />
        {items.map((item, idx) => {
          const itemKey = `${keyPrefix}-${depth}-${idx}`
          const itemPath = [...parentPath, idx]
          const hasChildren = !!(item.children && item.children.length > 0)
          const isEditingItem = !!(editCell && editCell.lineIndex === lineIndex && editCell.paramIdx === topParamIdx
            && editCell.exprPath && editCell.exprPath.join('/') === itemPath.join('/'))
          const startNestedEdit = (e: React.MouseEvent): void => {
            e.stopPropagation()
            if (item.commandName) {
              const ownerAssembly = findOwnerAssemblyName(lineIndex)
              const cmdName = item.commandName
              const hintName = userSubNamesRef.current.has(cmdName) ? `__SUB__:${cmdName}:${ownerAssembly}` : cmdName
              onCommandClick?.(hintName, item.commandParamIndex)
            }
            const valEl = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.eyc-param-expand-val')
            const valueLeft = valEl?.getBoundingClientRect().left
            setEditCell({ lineIndex, cellIndex: -2, fieldIdx: -1, sliceField: false, paramIdx: topParamIdx, exprPath: itemPath })
            setEditVal(item.value || '')
            focusParamInputAt(e.clientX, valueLeft)
          }
          return (
            <Fragment key={itemKey}>
              <div
                className={`eyc-param-expand-row eyc-param-expand-row-secondary eyc-param-expand-row-clickable${hasChildren ? ' eyc-param-expand-row-parent' : ''}`}
                onClick={isEditingItem ? undefined : startNestedEdit}
              >
                <span className="eyc-param-expand-mark">※</span>
                <span className="eyc-param-expand-name">{item.name}</span>
                <span className="eyc-param-expand-colon">：</span>
                {isEditingItem ? (
                  <div className="eyc-inline-edit-sizing eyc-param-inline-edit-sizing">
                    <span className="eyc-inline-edit-measure">{(editVal || '') + '\u00A0'}</span>
                    <input
                      ref={paramInputRef}
                      className="eyc-param-val-input"
                      aria-label={`编辑参数 ${item.name}`}
                      value={editVal}
                      onChange={e => { const v = e.target.value; setEditVal(v); updateCompletion(v, e.currentTarget.selectionStart ?? v.length) }}
                      onBlur={() => {
                        if (shouldSuppressBlurCommit()) return
                        commit()
                      }}
                      onKeyDown={e => {
                        if (handleParamInputCtrlKey(e)) return
                        if (applyCompletionPopupKey(e.key)) { e.preventDefault(); return }
                        if (e.key === 'Enter') { e.preventDefault(); commit() }
                        else if (e.key === 'Escape') setEditCell(null)
                      }}
                      spellCheck={false}
                    />
                  </div>
                ) : (
                  <span className={`eyc-param-expand-val${isQuotedTextLiteral(item.value) ? ' eTxtcolor' : ''}`}>{item.value || '\u00A0'}</span>
                )}
              </div>
              {item.children && renderExprExpandItems(item.children, lineIndex, topParamIdx, itemPath, depth + 1, itemKey, baseFlowDepth)}
            </Fragment>
          )
        })}
      </div>
    )
  }, [commit, editCell, editVal, findOwnerAssemblyName, flowLineModeConfig, focusParamInputAt, handleParamInputCtrlKey, onCommandClick, shouldSuppressBlurCommit, applyCompletionPopupKey, updateCompletion])


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

  // 代码行点击时，优先取“当前点击到的命令 token”；否则回退到首个命令
  const findCommandNameFromClickTarget = useCallback((target: EventTarget | null, codeLine: string): string | null => {
    const el = target instanceof HTMLElement ? target : null
    if (el) {
      const tokenEl = el.closest('.funccolor, .comecolor, .cometwolr, .eyc-subrefcolor')
      const tokenText = (tokenEl?.textContent || '').replace(/\u00A0/g, '').trim()
      if (tokenText) return tokenText
    }
    return findFirstCommandName(codeLine)
  }, [findFirstCommandName])

  /** 格式化参数中的运算符：半角→全角 + 前后加空格 */
  const formatParamOperators = useCallback((val: string): string => {
    return formatOps(val)
  }, [])

  /** 实时同步编辑内容到底层数据（不关闭编辑状态） */
  const liveUpdate = useCallback((val: string) => {
    if (!editCell) return

    // 参数值编辑
    if (editCell.paramIdx !== undefined) {
      // 括号/引号未配平的中间态（如正敲「到字节集(」）不写回：未配平的开括号会吞掉外层
      // 调用自身的右括号，下一键 replaceCallArg 在破行上找不到参数边界、走"追加"分支，
      // 每敲一键行尾多出一组重复参数。输入框本地照常编辑，配平后再同步。
      if (!isArgParensBalanced(val)) return
      if (editCell.paramIdx >= 0) {
        // 嵌套表达式行编辑不做实时同步：实时改写会让路径解析跑在中间态文本上，提交时一次性替换
        if (editCell.exprPath && editCell.exprPath.length > 0) return
        const codeLine = lines[editCell.lineIndex]
        const newLine = replaceCallArg(codeLine, editCell.paramIdx, val)
        const nl = [...lines]; nl[editCell.lineIndex] = newLine
        const nt = nl.join('\n')
        applyTextChange(nt)
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
        applyTextChange(nt)
        return
      }
    }

    if (editCell.cellIndex < 0) {
      if (editCell.isVirtual) return
      // 判断开始 行编辑值以"判断"别名显示，实时写回源码前还原真实关键字
      const nl = [...lines]; nl[editCell.lineIndex] = flowIndentRef.current + flowMarkRef.current + restoreJudgeStartAlias(val)
      const nt = nl.join('\n')
      applyTextChange(nt)
      return
    }

    if (editCell.fieldIdx < 0) return

    // 表格单元格
    const rawLine = lines[editCell.lineIndex]
    const newLine = rebuildLineField(rawLine, editCell.fieldIdx, val, editCell.sliceField)
    const nl = [...lines]; nl[editCell.lineIndex] = newLine
    const nt = nl.join('\n')
    applyTextChange(nt)
  }, [applyTextChange, editCell, lines, replaceCallArg, parseAssignmentLineParts, restoreJudgeStartAlias])

  // 输入高频（尤其长按退格）时将文档同步节流到固定频率，降低全量重算导致的卡顿。
  const scheduleLiveUpdate = useCallback((val: string) => {
    pendingLiveUpdateValRef.current = val
    if (liveUpdateTimerRef.current != null) return
    liveUpdateTimerRef.current = window.setTimeout(() => {
      liveUpdateTimerRef.current = null
      const nextVal = pendingLiveUpdateValRef.current
      pendingLiveUpdateValRef.current = null
      if (nextVal == null) return
      liveUpdate(nextVal)
    }, 24)
  }, [liveUpdate])

  /**
   * 展开参数行「新增当前层级参数行」（照易语言：可重复参数上回车/顶层逗号追加下一个值行）。
   * 先把当前值配平/格式化写回本槽（argIdx），再在其后插入一个空参数槽，焦点移入新行。
   * 逐值一行从根本上避免了「多值挤进单槽 → replaceCallArg 反复写回 → 尾部残留级联重复」。
   */
  const appendRepeatParamRow = useCallback((lineIndex: number, argIdx: number, currentVal: string) => {
    const ls = prevRef.current.split('\n')
    const codeLine = ls[lineIndex]
    if (codeLine === undefined) return
    const formatted = formatParamOperators(balanceArgParens(currentVal))
    const written = replaceCallArg(codeLine, argIdx, formatted)
    const inserted = insertCallArgAfter(written, argIdx, '')
    if (inserted === codeLine) return  // 无括号等异常：不动
    // 旧参数行输入框在重渲染中卸载会触发 onBlur→commit（会 setEditCell(null) 关掉编辑、
    // 令随后聚焦新行落空）。压制这一过渡期的 blur 提交。
    suppressBlurCommitUntilRef.current = Date.now() + 250
    if (liveUpdateTimerRef.current != null) { window.clearTimeout(liveUpdateTimerRef.current); liveUpdateTimerRef.current = null }
    pendingLiveUpdateValRef.current = null
    pushUndo(prevRef.current)
    ls[lineIndex] = inserted
    applyTextChange(ls.join('\n'))
    setAcVisible(false)
    setEditCell({ lineIndex, cellIndex: -2, fieldIdx: -1, sliceField: false, paramIdx: argIdx + 1 })
    setEditVal('')
    focusParamInputAt()
  }, [applyTextChange, pushUndo, formatParamOperators, focusParamInputAt])

  /**
   * 展开参数行「回车前进到下一参数行」：先把当前值配平/格式化写回本槽，再把编辑焦点移到
   * 下一参数行（照易语言逐格向下填，连续回车即可逐个填完所有参数）。
   * 值未变化时不压栈、不改文本，避免连续回车把撤销栈刷爆。
   */
  const advanceParamEdit = useCallback((lineIndex: number, argIdx: number, currentVal: string, nextArgIdx: number) => {
    const ls = prevRef.current.split('\n')
    const codeLine = ls[lineIndex]
    if (codeLine === undefined) return
    // 旧参数输入框在重渲染中卸载会触发 onBlur→commit（关掉编辑态、令新行聚焦落空），压制这一过渡期的 blur 提交。
    suppressBlurCommitUntilRef.current = Date.now() + 250
    if (liveUpdateTimerRef.current != null) { window.clearTimeout(liveUpdateTimerRef.current); liveUpdateTimerRef.current = null }
    pendingLiveUpdateValRef.current = null
    // 仅当用户改动了本槽值才写回：连续回车穿行不应重格式化/挪动未触碰的实参（否则空格被吞、直引号被规整成弯引号）。
    let nextLine = codeLine
    const origArg = parseCallArgs(codeLine)[argIdx] ?? ''
    if (currentVal !== origArg) {
      const written = replaceCallArg(codeLine, argIdx, formatParamOperators(balanceArgParens(currentVal)))
      if (written !== codeLine) {
        pushUndo(prevRef.current)
        ls[lineIndex] = written
        nextLine = written
        applyTextChange(ls.join('\n'))
      }
    }
    const nextArgs = parseCallArgs(nextLine)
    setAcVisible(false)
    setEditCell({ lineIndex, cellIndex: -2, fieldIdx: -1, sliceField: false, paramIdx: nextArgIdx })
    setEditVal(nextArgs[nextArgIdx] !== undefined ? nextArgs[nextArgIdx] : '')
    focusParamInputAt()
  }, [applyTextChange, pushUndo, formatParamOperators, focusParamInputAt])

  useEffect(() => {
    return () => {
      if (liveUpdateTimerRef.current != null) {
        window.clearTimeout(liveUpdateTimerRef.current)
        liveUpdateTimerRef.current = null
      }
      pendingLiveUpdateValRef.current = null
    }
  }, [])

  // 展开参数行多选与行选择互斥：一旦选了整行，清掉参数行选区
  useEffect(() => { if (selectedLines.size > 0 && selectedParamRows) setSelectedParamRows(null) }, [selectedLines, selectedParamRows])

  // 展开参数行多选删除：有参数行选区且焦点不在输入框时，Delete/Backspace 删除选中实参，Esc 清空选区
  useEffect(() => {
    if (!selectedParamRows || selectedParamRows.argIdxs.size === 0) return
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return
      if (e.key === 'Escape') { setSelectedParamRows(null); paramSelAnchorRef.current = null; return }
      if (e.key !== 'Delete' && e.key !== 'Backspace' && e.key !== ' ') return
      e.preventDefault()
      const { lineIndex, argIdxs } = selectedParamRows
      const ls = prevRef.current.split('\n')
      const codeLine = ls[lineIndex]
      if (codeLine !== undefined) {
        const newLine = removeCallArgs(codeLine, [...argIdxs])
        if (newLine !== codeLine) {
          pushUndo(prevRef.current)
          ls[lineIndex] = newLine
          applyTextChange(ls.join('\n'))
        }
      }
      setSelectedParamRows(null)
      paramSelAnchorRef.current = null
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedParamRows, applyTextChange, pushUndo])

  /** 渲染某行的流程线段 */
  const renderFlowSegs = (lineIndex: number, isExpanded?: boolean): { node: React.ReactNode; skipTreeLines: number } => {
    return renderFlowSegsLine({
      flowLines: displayFlowLines,
      lineIndex,
      isExpanded,
      resolveColors: (depth) => resolveFlowLineColors(flowLineModeConfig, depth),
    })
  }

  /** 渲染参数展开区域的流程线延续（只绘制纵向穿越线） */
  const renderFlowContinuation = (lineIndex: number): React.ReactNode => {
    return renderFlowContinuationLine({
      flowLines: displayFlowLines,
      lineIndex,
      resolveColors: (depth) => resolveFlowLineColors(flowLineModeConfig, depth),
    })
  }

  const {
    handleWrapperMouseDown,
    handleWrapperCopy,
    handleWrapperPaste,
    handleTableBlockMouseDown,
    handleCodeBlockMouseDown,
    handleCodeLineFoldMouseDown,
    handleCodeLineFoldClick,
    handleCodeLineClick,
    handleTableRowMouseDown,
    handleTableCellMouseDown,
    handleTableCellClick,
    handleTableCellDoubleClick,
  } = useEditorInteractionHandlers({
    flowAutoTag: FLOW_AUTO_TAG,
    wasDragSelectRef: wasDragSelect,
    userSubNamesRef,
    wrapperRef,
    editCellRef,
    preserveEditOnScrollbarRef,
    dragStartPosRef: dragStartPos,
    dragAnchorRef: dragAnchor,
    isDraggingRef: isDragging,
    lastFocusedLineRef: lastFocusedLine,
    setEditCell,
    setAcVisible,
    findLineAtY,
    handleLineMouseDown,
    setExpandedLines,
    setSelectedLines,
    getMouseRangeSelectedSourceText,
    getSelectedSourceText,
    selectedLines,
    currentText,
    applyTextChange,
    pushUndo,
    sanitizePastedTextForCurrent,
    extractAssemblyVarLinesFromPasted,
    extractRoutedDeclarationLinesFromPasted,
    onRouteDeclarationPaste,
    shouldUseNativeInputPaste,
    suppressInlineBlurCommit,
    commitActiveEditor: () => commitRef.current(),
    focusWrapper,
    findCommandNameFromClickTarget,
    findOwnerAssemblyName,
    onCommandClick,
    startEditLine,
    consumeOptimisticLineEdit,
    tryToggleTableBooleanCell,
    isResourceTableDoc,
    handleTableCellHint,
    startEditCell,
    openResourcePreview,
  })

  const stickyRenderView = useMemo(() => {
    if (!stickySubTable) return null

    const base = {
      rows: stickySubTable.rows,
      colCount: stickySubTable.colCount,
      translateY: stickyPushOffsetPx,
    }

    if (stickyPushOffsetPx >= 0 || stickySubTable.nextStartLine == null) return base
    const nextMeta = subTableMetaRef.current.find(meta => meta.startLine === stickySubTable.nextStartLine)
    if (!nextMeta || nextMeta.rows.length === 0) return base

    const overlapPx = Math.max(0, -stickyPushOffsetPx)
    const rowStepPx = Math.max(editorLineHeight, 1)
    const replaceRows = Math.min(
      Math.floor(overlapPx / rowStepPx),
      stickySubTable.rows.length,
      nextMeta.rows.length,
    )

    if (replaceRows <= 0) return base

    // 逐行裁切：旧冻结表顶部每上移一行，就从底部补入下一子程序一行。
    const rows = [
      ...stickySubTable.rows.slice(replaceRows),
      ...nextMeta.rows.slice(0, replaceRows),
    ]
    const residualPx = overlapPx - replaceRows * rowStepPx

    return {
      rows,
      colCount: Math.max(stickySubTable.colCount, nextMeta.colCount),
      translateY: -residualPx,
    }
  }, [editorLineHeight, stickyPushOffsetPx, stickySubTable])

  useEffect(() => {
    stickyScopeRowRef.current?.style.setProperty('--eyc-sticky-translate-y', `${stickyRenderView?.translateY ?? 0}px`)
  }, [stickyRenderView?.translateY])

  const handleStickySubTableCellClick = useCallback((
    e: React.MouseEvent<HTMLTableCellElement>,
    action: {
      rowIsHeader: boolean
      lineIndex: number
      cellIndex: number
      fieldIdx?: number
      text: string
      sliceField?: boolean
    },
  ) => {
    e.stopPropagation()
    if (action.rowIsHeader) return

    // 点击冻结区后立即跳回对应主表格行，确保编辑输入框在主表格中定位。
    scrollToLineIndex(action.lineIndex, 'auto')

    if (tryToggleTableBooleanCell('sub', action.lineIndex, action.cellIndex)) return
    handleTableCellHint(action.lineIndex, action.fieldIdx ?? -1, action.text)
    startEditCell(action.lineIndex, action.cellIndex, action.text, action.fieldIdx, action.sliceField)
  }, [handleTableCellHint, scrollToLineIndex, startEditCell, tryToggleTableBooleanCell])

  return (
    <div
      className="eyc-table-editor ebackcolor1"
      ref={editorRootRef}
      onClick={() => onCommandClear?.()}
    >
      <div className="eyc-editor-main">
      <div
        className="eyc-table-shell"
        ref={tableShellRef}
      >
      <div
        className="eyc-table-wrapper"
        ref={wrapperRef}
        onMouseDown={handleWrapperMouseDown}
        onContextMenu={handleWrapperContextMenu}
        onCopy={handleWrapperCopy}
        onPaste={handleWrapperPaste}
        tabIndex={0}
      >
        {shouldFreezeTableHeader && stickyRenderView && stickyRenderView.rows.length > 0 && (
          <div className="eyc-sticky-scope" aria-hidden="true">
            <div
              className="eyc-sticky-scope-row"
              ref={stickyScopeRowRef}
            >
              <div className="eyc-line-gutter eyc-sticky-scope-gutter">
                {stickyRenderView.rows.map((row, idx) => (
                  <div key={`sticky-gutter-${row.lineIndex}-${idx}`} className="eyc-gutter-cell">
                    <span className="eyc-breakpoint-dot">●</span>
                    <span className="eyc-gutter-linenum">{row.isHeader ? '\u00A0' : (lineNumMaps.sourceLineNumMap.get(row.lineIndex) ?? (row.lineIndex + 1))}</span>
                    <span className="eyc-gutter-fold-area" />
                  </div>
                ))}
              </div>
              <div className="eyc-sticky-scope-table-wrap">
                <table className="eyc-decl-table eyc-sticky-scope-table" cellSpacing={0}>
                  <tbody>
                    {stickyRenderView.rows.map((row, rowIdx) => (
                      <tr key={`sticky-row-${row.lineIndex}-${rowIdx}`}>
                        {row.cells.map((cell, idx) => (
                          <td
                            key={`sticky-cell-${row.lineIndex}-${rowIdx}-${idx}`}
                            className={`${cell.cls} Rowheight${cell.align ? ' eyc-cell-align-center' : ''}`}
                            colSpan={cell.colSpan}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => handleStickySubTableCellClick(e, {
                              rowIsHeader: !!row.isHeader,
                              lineIndex: row.lineIndex,
                              cellIndex: idx,
                              fieldIdx: cell.fieldIdx,
                              text: cell.text,
                              sliceField: cell.sliceField,
                            })}
                          >
                            {cell.text}
                          </td>
                        ))}
                        {row.cells.reduce((sum, cell) => sum + (cell.colSpan || 1), 0) < stickyRenderView.colCount && (
                          <td className="Rowheight" colSpan={stickyRenderView.colCount - row.cells.reduce((sum, cell) => sum + (cell.colSpan || 1), 0)}>&nbsp;</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {blockVirtualWindow.leadingSpacerPx > 0 && (
          <div
            aria-hidden="true"
            className="eyc-virtual-spacer"
            ref={(element) => setCssVars(element, { '--eyc-virtual-spacer-height': `${blockVirtualWindow.leadingSpacerPx}px` })}
          />
        )}
        {visibleBlocks.slice(blockVirtualWindow.startBlockIndex, blockVirtualWindow.endBlockIndex + 1).map((blk, localBlockIndex) => {
          const bi = blockVirtualWindow.startBlockIndex + localBlockIndex
          if (blk.kind === 'table') {
            const tableMeta = tableRenderMetaByBlockIndex.get(bi)
            if (!tableMeta) return null
            const { tableLineIndices, tableColCount, tableRenderRowsAll } = tableMeta
            const tableRowOverscanLines = 120
            const minVisibleLine = Math.max(0, visibleLineWindow.startLine - tableRowOverscanLines)
            const maxVisibleLine = visibleLineWindow.endLine + tableRowOverscanLines
            const isRowVisible = (tableRow: typeof tableRenderRowsAll[number]): boolean => {
              if (tableRow.row.isHeader) return true
              const lineIndex = tableRow.row.lineIndex
              return lineIndex >= minVisibleLine && lineIndex <= maxVisibleLine
            }
            let startRenderIndex = tableRenderRowsAll.findIndex(isRowVisible)
            if (startRenderIndex < 0) startRenderIndex = 0
            let endRenderIndex = startRenderIndex
            for (let i = tableRenderRowsAll.length - 1; i >= startRenderIndex; i--) {
              if (isRowVisible(tableRenderRowsAll[i])) {
                endRenderIndex = i
                break
              }
            }
            const leadingSpacerRowCount = Math.max(0, startRenderIndex)
            const trailingSpacerRowCount = Math.max(0, tableRenderRowsAll.length - endRenderIndex - 1)
            const tableRenderRows = tableRenderRowsAll.slice(startRenderIndex, endRenderIndex + 1)
            return (
              <div
                key={bi}
                className={`eyc-block-row${blk.tableType === 'localVar' ? ' eyc-localvar-block' : ''}`}
                onMouseDown={(e) => handleTableBlockMouseDown(e, tableLineIndices)}
              >
                <div className="eyc-line-gutter">
                  {leadingSpacerRowCount > 0 && (
                    <div
                      className="eyc-gutter-cell eyc-virtual-gutter-spacer"
                      aria-hidden="true"
                      ref={(element) => setCssVars(element, { '--eyc-virtual-table-spacer-height': `${leadingSpacerRowCount * 22}px` })}
                    />
                  )}
                  {tableRenderRows.map(({ row, ri, isDeletedPlaceholder }, renderIndex) => (
                    isDeletedPlaceholder
                      ? (
                          <div key={`gutter-del-${ri}-${renderIndex}`} className="eyc-gutter-cell eyc-diff-deleted-placeholder-gutter" aria-hidden="true">
                            <span className="eyc-breakpoint-dot">●</span>
                            <span className="eyc-gutter-linenum">&nbsp;</span>
                            <span className="eyc-gutter-fold-area" />
                          </div>
                        )
                      : (
                          <div
                            key={`gutter-row-${ri}-${renderIndex}`}
                            className={row.isHeader
                              ? 'eyc-gutter-cell'
                              : `eyc-gutter-cell${selectedLines.has(row.lineIndex) ? ' eyc-line-selected' : ''}${editCell && editCell.lineIndex === row.lineIndex ? ' eyc-line-editing' : ''}${diffClassSuffixFor(row.lineIndex)}`}
                            onMouseDown={row.isHeader ? undefined : (e) => handleGutterMouseDown(e, row.lineIndex)}
                          >
                            {(() => {
                              const actualLine = row.isHeader ? 0 : (lineNumMaps.tableRowNumMap.get(`${bi}:${ri}`) ?? row.lineIndex + 1)
                              const sourceLine = row.isHeader ? 0 : (row.lineIndex + 1)
                              const hasBreakpoint = sourceLine > 0 && breakpointLineSet.has(sourceLine)
                              return (
                                <>
                                  <span className={`eyc-breakpoint-dot${hasBreakpoint ? ' active' : ''}`}>●</span>
                                  <span className="eyc-gutter-linenum">{row.isHeader ? '' : actualLine}</span>
                                </>
                              )
                            })()}
                            <span className="eyc-gutter-fold-area">
                              {/* 子程序名行：常驻展开/收缩按钮（折叠整个子程序，与代码行参数展开 +/- 无关） */}
                              {blk.tableType === 'sub' && !row.isHeader && subFoldNameByLine.has(row.lineIndex) && (
                                <span
                                  className="eyc-gutter-fold eyc-sub-fold"
                                  role="button"
                                  title={collapsedSubNames.has(subFoldNameByLine.get(row.lineIndex)!) ? '展开子程序' : '收缩子程序'}
                                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
                                  onClick={(e) => { e.stopPropagation(); toggleSubFold(subFoldNameByLine.get(row.lineIndex)!) }}
                                >{collapsedSubNames.has(subFoldNameByLine.get(row.lineIndex)!) ? '+' : '−'}</span>
                              )}
                            </span>
                          </div>
                        )
                  ))}
                  {trailingSpacerRowCount > 0 && (
                    <div
                      className="eyc-gutter-cell eyc-virtual-gutter-spacer"
                      aria-hidden="true"
                      ref={(element) => setCssVars(element, { '--eyc-virtual-table-spacer-height': `${trailingSpacerRowCount * 22}px` })}
                    />
                  )}
                </div>
                <div className="eyc-block-content">
                  <table className="eyc-decl-table" cellSpacing={0}>
                    <tbody>
                      {leadingSpacerRowCount > 0 && (
                        <tr className="eyc-virtual-table-spacer" aria-hidden="true">
                          <td
                            colSpan={tableColCount}
                            className="eyc-virtual-table-spacer-cell"
                            ref={(element) => setCssVars(element, { '--eyc-virtual-table-spacer-height': `${leadingSpacerRowCount * 22}px` })}
                          >
                            &nbsp;
                          </td>
                        </tr>
                      )}
                      {tableRenderRows.map(({ row, ri, isDeletedPlaceholder, deletedText }, renderIndex) => (
                        isDeletedPlaceholder
                          ? (
                              <tr key={`tbl-del-${ri}-${renderIndex}`} className="eyc-data-row eyc-diff-deleted-placeholder-row" aria-hidden="true">
                                <td
                                  className="eyc-diff-deleted-placeholder-cell"
                                  colSpan={tableColCount}
                                  title={deletedText || undefined}
                                >
                                  {deletedText?.trim()
                                    ? <span className="eyc-diff-deleted-text">{deletedText}</span>
                                    : ' '}
                                </td>
                              </tr>
                            )
                          : (
                              <tr
                                key={`tbl-row-${ri}-${renderIndex}`}
                                className={row.isHeader ? 'eyc-hdr-row' : `eyc-data-row${selectedLines.has(row.lineIndex) ? ' eyc-line-selected' : ''}${editCell && editCell.lineIndex === row.lineIndex ? ' eyc-line-editing' : ''}${diffClassSuffixFor(row.lineIndex)}`}
                                {...(!row.isHeader ? { 'data-line-index': row.lineIndex } : {})}
                                onMouseDown={row.isHeader ? undefined : (e) => handleTableRowMouseDown(e, row.lineIndex)}
                              >
                            {row.cells.map((cell, ci) => (
                              (() => {
                                const isInvalidVarNameCell = !row.isHeader && cell.fieldIdx === 0 && (invalidVarNameLineSet.has(row.lineIndex) || duplicateDeclLineSet.has(row.lineIndex))
                                return (
                              <td
                                key={ci}
                                className={`${cell.cls} Rowheight${cell.align ? ' eyc-cell-align-center' : ''}${isInvalidVarNameCell ? ' eyc-cell-invalid' : ''}${editCell && editCell.booleanCell && editCell.lineIndex === row.lineIndex && editCell.cellIndex === ci ? ' eyc-cell-bool-focus' : ''}`}
                                colSpan={cell.colSpan}
                                onMouseDown={handleTableCellMouseDown}
                                onClick={(e) => handleTableCellClick(e, {
                                  rowIsHeader: !!row.isHeader,
                                  tableType: blk.tableType,
                                  lineIndex: row.lineIndex,
                                  cellIndex: ci,
                                  fieldIdx: cell.fieldIdx,
                                  text: cell.text,
                                  sliceField: cell.sliceField,
                                })}
                                onDoubleClick={(e) => handleTableCellDoubleClick(e, {
                                  rowIsHeader: !!row.isHeader,
                                  tableType: blk.tableType,
                                  lineIndex: row.lineIndex,
                                  cellIndex: ci,
                                  fieldIdx: cell.fieldIdx,
                                  text: cell.text,
                                  sliceField: cell.sliceField,
                                })}
                              >
                                {editCell && editCell.lineIndex === row.lineIndex && editCell.cellIndex === ci && editCell.fieldIdx === cell.fieldIdx && !row.isHeader ? (
                                  <div className="eyc-inline-edit-sizing eyc-cell-inline-edit-sizing">
                                    <span className="eyc-inline-edit-measure">
                                      {(editVal.length > (cell.text || '\u00A0').length ? editVal : (cell.text || '\u00A0')) + '\u00A0'}
                                    </span>
                                    <input
                                      ref={inputRef}
                                      className={`eyc-cell-input${isInvalidVarNameCell ? ' eyc-input-invalid' : ''}`}
                                      aria-label="编辑表格单元格"
                                      value={editVal}
                                      onPaste={(e) => e.stopPropagation()}
                                      onMouseDown={(e) => {
                                        if (e.button !== 0) return
                                        // 单元格输入框内拖选仅限单元格，不切换到行拖选
                                        pendingInputDragRef.current = { lineIndex: row.lineIndex, x: e.clientX, y: e.clientY, allowRowDrag: false }
                                      }}
                                      onChange={e => {
                                        const raw = e.target.value
                                        const rawPos = e.target.selectionStart ?? raw.length
                                        // IME 组合期间不改写 value、不更新补全弹窗，否则输入法组合会被取消（候选框闪退）
                                        if ((e.nativeEvent as InputEvent).isComposing) {
                                          setEditVal(raw)
                                          scheduleLiveUpdate(raw)
                                          return
                                        }
                                        let v = raw
                                        // 数据类型单元格禁止空格（类型名不含空格，防止粘贴/IME 串入多个类型）
                                        if (editCell && editCell.cellIndex >= 0
                                          && canUseTypeCompletion(editCell.lineIndex, editCell.fieldIdx)
                                          && /\s/.test(v)) {
                                          v = v.replace(/\s+/g, '')
                                        }
                                        setEditVal(v)
                                        scheduleLiveUpdate(v)
                                        // 改写值后受控 input 会把光标重置到末尾，需按改写后的前缀长度恢复
                                        const pos = v === raw ? rawPos : raw.slice(0, rawPos).replace(/\s+/g, '').length
                                        if (v !== raw) pendingInputCaretRef.current = pos
                                        updateCompletion(v, pos)
                                      }}
                                      onCompositionStart={() => setAcVisible(false)}
                                      onCompositionEnd={e => {
                                        // 组合提交后统一做空格清理并恢复补全弹窗
                                        const raw = e.currentTarget.value
                                        let v = raw
                                        if (editCell && editCell.cellIndex >= 0
                                          && canUseTypeCompletion(editCell.lineIndex, editCell.fieldIdx)
                                          && /\s/.test(v)) {
                                          v = v.replace(/\s+/g, '')
                                        }
                                        if (v !== raw) {
                                          setEditVal(v)
                                          scheduleLiveUpdate(v)
                                          pendingInputCaretRef.current = v.length
                                        }
                                        updateCompletion(v, v === raw ? (e.currentTarget.selectionStart ?? v.length) : v.length)
                                      }}
                                      onBlur={() => {
                                        // Enter 切换到下一单元时，旧 input 的 blur 不能再提交。
                                        if (!isEditingSameCell({
                                          lineIndex: row.lineIndex,
                                          cellIndex: ci,
                                          fieldIdx: cell.fieldIdx ?? -1,
                                        })) return
                                        if (shouldSuppressBlurCommit()) return
                                        commit()
                                      }}
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
                          )
                      ))}
                      {trailingSpacerRowCount > 0 && (
                        <tr className="eyc-virtual-table-spacer" aria-hidden="true">
                          <td
                            colSpan={tableColCount}
                            className="eyc-virtual-table-spacer-cell"
                            ref={(element) => setCssVars(element, { '--eyc-virtual-table-spacer-height': `${trailingSpacerRowCount * 22}px` })}
                          >
                            &nbsp;
                          </td>
                        </tr>
                      )}
                  </tbody>
                </table>
              </div>
            </div>
            )
          }

          // 代码行
          const codeMeta = getCodeRenderMeta(bi, blk)
          const codeLineRaw = codeMeta.codeLineRaw
          const spans = codeMeta.spans
          const lineCmd = codeMeta.lineCmd
          const assignDetail = codeMeta.assignDetail
          const hasExpandableDetail = codeMeta.hasExpandableDetail
          const isExpanded = expandedLines.has(blk.lineIndex)
          const isLineSelected = selectedLines.has(blk.lineIndex)
          const actualLine = blk.isVirtual ? 0 : (lineNumMaps.codeLineNumMap.get(blk.lineIndex) ?? blk.lineIndex + 1)
          const sourceLine = blk.isVirtual ? 0 : (blk.lineIndex + 1)
          const hasBreakpoint = sourceLine > 0 && breakpointLineSet.has(sourceLine)
          const isDebugLine = !!debugSourceLine && sourceLine === debugSourceLine
          const isDiagnosticErrorLine = lineMarkerTypeMap.get(blk.lineIndex) === 'error'
          return (
            <Fragment key={bi}>
            <div
              className={`eyc-block-row eyc-block-row-wrap${isLineSelected ? ' eyc-line-selected' : ''}${editCell && editCell.lineIndex === blk.lineIndex && editCell.isVirtual === blk.isVirtual ? ' eyc-line-editing' : ''}${isDebugLine ? ' eyc-debug-line' : ''}${diffClassSuffixFor(blk.lineIndex)}`}
              data-line-index={blk.lineIndex}
              onMouseDown={(e) => handleCodeBlockMouseDown(e, blk.lineIndex, blk.isVirtual)}
            >
              <div className="eyc-line-gutter">
                <div
                  className="eyc-gutter-cell"
                  onMouseDown={blk.isVirtual ? undefined : (e) => handleGutterMouseDown(e, blk.lineIndex)}
                >
                  <span className={`eyc-breakpoint-dot${hasBreakpoint ? ' active' : ''}`}>●</span>
                  <span className="eyc-gutter-linenum">{blk.isVirtual ? '' : actualLine}</span>
                  <span className="eyc-gutter-fold-area">
                    {hasExpandableDetail && (isLineSelected || (editCell && editCell.lineIndex === blk.lineIndex && editCell.paramIdx === undefined)) && (
                      <span
                        className="eyc-gutter-fold"
                        onMouseDown={handleCodeLineFoldMouseDown}
                        onClick={(e) => handleCodeLineFoldClick(e, blk.lineIndex)}
                      >{isExpanded ? '−' : '+'}</span>
                    )}
                  </span>
                </div>
              </div>
              <div
                className={`eyc-code-line${isDiagnosticErrorLine ? ' eyc-code-line-error' : ''}${editCell && editCell.lineIndex === blk.lineIndex && editCell.isVirtual === blk.isVirtual && editCell.paramIdx === undefined ? ' eyc-code-line-editing' : ''}`}
                onClick={(e) => handleCodeLineClick(e, {
                  lineIndex: blk.lineIndex,
                  codeLineRaw,
                  isVirtual: blk.isVirtual,
                })}
              >
              {editCell && editCell.lineIndex === blk.lineIndex && editCell.isVirtual === blk.isVirtual && editCell.paramIdx === undefined ? (
                <>
                  {renderFlowSegs(blk.lineIndex, isExpanded).node}
                  <div className="eyc-inline-edit-sizing eyc-code-inline-edit-sizing">
                    <span
                      className="eyc-inline-edit-measure eyc-code-inline-edit-measure"
                    >
                      {(editVal || '') + '\u00A0'}
                    </span>
                    <input
                      ref={inputRef}
                      className="eyc-inline-input"
                      aria-label="编辑代码行"
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
                        const raw = e.target.value
                        const rawPos = e.target.selectionStart ?? raw.length
                        // IME 组合期间不做任何值改写/光标干预/弹窗更新，否则输入法组合会被取消（候选框闪退）
                        if ((e.nativeEvent as InputEvent).isComposing) {
                          setEditVal(raw)
                          scheduleLiveUpdate(raw)
                          return
                        }
                        const old = editVal
                        const insertedLen = raw.length - old.length
                        const insertAt = rawPos - insertedLen
                        const isPlainInsertion = insertedLen > 0 && insertAt >= 0
                          && raw.slice(0, insertAt) === old.slice(0, insertAt)
                          && raw.slice(rawPos) === old.slice(insertAt)
                        // ===== 括号保护：命令调用行的右括号之后不允许输入内容 =====
                        if (isPlainInsertion) {
                          const trimmedOld = old.trimEnd()
                          const isPureCommandCall = /^\s*\.?[一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_.。．]*\s*[(（][\s\S]*[)）]$/.test(trimmedOld)
                          if (isPureCommandCall && insertAt >= trimmedOld.length) {
                            e.target.value = old
                            const pos = Math.min(insertAt, old.length)
                            e.target.setSelectionRange(pos, pos)
                            updateCompletion(old, pos)
                            return
                          }
                        }
                        // ===== 智能引号 =====
                        // 输入法自动配对会把 “” 成对上屏，连续按引号会堆出 ""\""；
                        // 1) 光标右侧已是引号时再输入引号 → 视为收尾，跳过既有引号不重复插入；
                        // 2) 成对上屏 → 光标置于引号对中间，便于直接输入字符串内容。
                        const isQuoteChar = (c?: string): boolean => c === '“' || c === '”' || c === '"'
                        if (insertedLen === 1 || insertedLen === 2) {
                          const inserted = isPlainInsertion ? raw.slice(insertAt, rawPos) : ''
                          if (inserted && [...inserted].every(isQuoteChar)) {
                            if (isQuoteChar(old[insertAt])) {
                              // 跳过既有引号：把 DOM 值同步回原值并移动光标（状态未变，需直接操作 DOM）
                              e.target.value = old
                              const pos = insertAt + 1
                              e.target.setSelectionRange(pos, pos)
                              updateCompletion(old, pos)
                              return
                            }
                            if (insertedLen === 2) {
                              const v2 = normalizeCodeLineInput(raw)
                              setEditVal(v2)
                              scheduleLiveUpdate(v2)
                              const pos = normalizeCodeLineInput(raw.slice(0, insertAt)).length + 1
                              pendingInputCaretRef.current = pos
                              updateCompletion(v2, pos)
                              return
                            }
                          }
                        }
                        const v = normalizeCodeLineInput(raw)
                        if (v !== raw && v === old) {
                          // 归一化把用户的修改完全还原（如删掉注释 ' 后的空格立即被补回）：
                          // state 不变不会触发受控重渲染，若走常规路径，liveUpdate 改文档后的
                          // 回流才把 DOM 同步回 v，届时光标被重置到行尾。这里直接写回 DOM 并复位光标。
                          e.target.value = v
                          const pos = normalizeCodeLineInput(raw.slice(0, rawPos)).length
                          e.target.setSelectionRange(pos, pos)
                          updateCompletion(v, pos)
                          return
                        }
                        setEditVal(v)
                        scheduleLiveUpdate(v)
                        // 归一化改写了输入值（如 “”→"）时，受控 input 会把光标重置到末尾，
                        // 导致后续字符落到行尾（括号外）；用归一化后的前缀长度恢复光标。
                        const pos = v === raw ? rawPos : normalizeCodeLineInput(raw.slice(0, rawPos)).length
                        if (v !== raw) pendingInputCaretRef.current = pos
                        updateCompletion(v, pos)
                      }}
                      onCompositionStart={() => setAcVisible(false)}
                      onCompositionEnd={e => {
                        // 组合提交后补跑归一化（组合期间跳过了所有改写），并恢复补全弹窗
                        const raw = e.currentTarget.value
                        const rawPos = e.currentTarget.selectionStart ?? raw.length
                        const v = normalizeCodeLineInput(raw)
                        const pos = v === raw ? rawPos : normalizeCodeLineInput(raw.slice(0, rawPos)).length
                        if (v !== raw) {
                          setEditVal(v)
                          scheduleLiveUpdate(v)
                          pendingInputCaretRef.current = pos
                        }
                        updateCompletion(v, pos)
                      }}
                      onBlur={() => {
                        // Enter 切行后旧输入框 blur 会晚到，需忽略以免打断新焦点。
                        if (!isEditingSameCell({
                          lineIndex: blk.lineIndex,
                          cellIndex: -1,
                          fieldIdx: -1,
                          isVirtual: blk.isVirtual,
                        })) return
                        if (shouldSuppressBlurCommit()) return
                        setTimeout(() => setAcVisible(false), 150)
                        commit()
                      }}
                      onKeyDown={onKey}
                      spellCheck={false}
                    />
                  </div>
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
                          const isInvalid = (isFunc && hasCommandCatalog && !validCommandNames.has(s.text)) || (isAssignTarget && !isKnownAssignmentTarget(s.text, allKnownVarNames))
                          const isLineSyntaxInvalid = lineHasMissingRhs && (isAssignTarget || (!isFunc && !isObjMethod && !isFlowKw && s.text.trim() !== ''))
                          const displayText = (shouldAliasJudgeStartInTableMode && isFlowKw && s.text === '判断开始') ? '判断' : s.text
                          if (isFunc || isObjMethod || isFlowKw || isAssignTarget) {
                            const className = `${isAssignTarget ? 'Variablescolor' : (isUserSubRef ? 'eyc-subrefcolor' : s.cls)}${(isInvalid || isLineSyntaxInvalid) ? ' eyc-cmd-invalid' : ''}`
                            const hoverable = (isFunc || isObjMethod) && !isUserSubRef && !isInvalid
                            return (
                              <span
                                key={si}
                                className={className}
                                onMouseEnter={hoverable ? (e) => scheduleCmdHoverTip(e, s.text, isObjMethod) : undefined}
                                onMouseLeave={hoverable ? clearCmdHoverTip : undefined}
                              >{renderDebugAwareSpan(displayText, className, `code-${blk.lineIndex}-${si}`)}</span>
                            )
                          }
                          // 表达式/流程条件里引用的干净标识符，非命令/子程序/变量/保留字 → 未定义变量，红标（与问题面板诊断一致）。
                          const isUndefinedVarRef = s.cls === '' && hasCommandCatalog
                            && /^[一-龥㐀-䶿가-힣぀-ヿA-Za-z_][一-龥㐀-䶿가-힣぀-ヿA-Za-z0-9_]*$/.test(s.text)
                            && !validCommandNames.has(s.text) && !allKnownVarNames.has(s.text) && !reservedNameSet.has(s.text)
                          // 已知变量的引用上变量色、数字字面量上数字色（主题「变量/数字」token 生效）
                          const refCls = s.cls === '' && allKnownVarNames.has(s.text) ? 'Variablescolor'
                            : s.cls === '' && /^[0-9０-９]+(?:[.．][0-9０-９]+)?$/.test(s.text.trim()) && s.text.trim() !== '' ? 'eyc-numcolor'
                            : s.cls
                          const className = `${refCls}${(isLineSyntaxInvalid || isUndefinedVarRef) ? ' eyc-cmd-invalid' : ''}`
                          return (
                            <span key={si} className={className}>
                              {s.swatch ? <span className="eyc-color-swatch" style={{ backgroundColor: s.swatch }} aria-hidden="true" /> : null}
                              {renderDebugAwareSpan(displayText, className, `code-${blk.lineIndex}-${si}`)}
                            </span>
                          )
                        })}
                      </>
                    )
                  })()}
                </span>
              )}
              </div>
              {/* 展开的参数详情（赋值行优先走“被赋值的变量/用作赋予的值”结构） */}
              {lineCmd && !assignDetail && isExpanded && (() => {
                const argVals = parseCallArgs(blk.codeLine || '')
                // 展开参数行：非重复参数每定义一行；末尾「可重复」参数按实际实参逐个成行（至少一行），
                // 每行绑定一个实参下标(argIdx)——照易语言「逐值一行」，回车/逗号在此层级追加下一行。
                const cmdParams = lineCmd.params
                const lastDefIdx = cmdParams.length - 1
                const tailRepeatable = lastDefIdx >= 0 && !!cmdParams[lastDefIdx].repeatable
                const paramRows: Array<{ p: (typeof cmdParams)[number]; argIdx: number; defIdx: number; repeatable: boolean }> = []
                for (let di = 0; di < cmdParams.length; di++) {
                  if (di === lastDefIdx && tailRepeatable) {
                    const count = Math.max(argVals.length - di, 1)  // 至少渲染一行（空实参）
                    for (let k = 0; k < count; k++) paramRows.push({ p: cmdParams[di], argIdx: di + k, defIdx: di, repeatable: true })
                  } else {
                    paramRows.push({ p: cmdParams[di], argIdx: di, defIdx: di, repeatable: false })
                  }
                }
                // 计算代码行前导空格数，用于参数面板缩进
                const codeLine = (blk.codeLine || '').replace(FLOW_AUTO_TAG, '')
                const leadingSpaces = codeLine.length - codeLine.replace(/^ +/, '').length
                // 基础左边距 = gutter(80px) + 缩进空格(ch) + 命令名约1.5个字符居中位置
                const baseLeft = 80 + 8  // gutter + padding
                const indentCh = leadingSpaces + 1.5  // 缩进 + 命令名中间约1.5字符
                const arrowLeftStyle = `calc(${baseLeft}px + ${indentCh}ch)`
                const expandPadding = `calc(${baseLeft + 20}px + ${leadingSpaces}ch)`
                return (
                  <div
                    className="eyc-param-expand"
                    ref={(element) => setCssVars(element, { '--eyc-param-expand-padding-left': expandPadding })}
                  >
                    {renderFlowContinuation(blk.lineIndex)}
                    <span
                      className="eyc-param-expand-arrow"
                      ref={(element) => setCssVars(element, { '--eyc-param-expand-arrow-left': arrowLeftStyle })}
                    />
                    <div
                      className="eyc-param-expand-inner"
                      ref={(element) => {
                        const baseFlowDepth = Math.max(0, Math.floor(leadingSpaces / 4))
                        const levelColors = resolveFlowLineColors(flowLineModeConfig, baseFlowDepth)
                        setCssVars(element, {
                          '--flow-inner-link-color': levelColors.innerLink,
                          '--flow-arrow-color': levelColors.arrow,
                        })
                      }}
                    >
                      {paramRows.map((row) => {
                        const p = row.p
                        const ai = row.argIdx
                        const isEditingParam = editCell && editCell.lineIndex === blk.lineIndex && editCell.paramIdx === ai && !editCell.exprPath
                        const isEditingNestedOfParam = !!(editCell && editCell.lineIndex === blk.lineIndex && editCell.paramIdx === ai && editCell.exprPath)
                        const argVal = argVals[ai] !== undefined ? argVals[ai] : ''
                        const nestedItems = buildExprExpandItems(argVal)
                        const exprKey = `${blk.lineIndex}:${ai}`
                        const isExprExpanded = nestedItems.length > 0 && (expandedParamExprKeys.has(exprKey) || isEditingNestedOfParam)
                        // 焦点在该参数行（或子树已展开/正在编辑子树）时显示 +/- 折叠按钮，由用户手动展开收缩
                        const showExprFold = nestedItems.length > 0 && (isEditingParam || isExprExpanded)
                        const startParamEdit = (e: React.MouseEvent) => {
                          e.stopPropagation()
                          // 点击参数行时提示该参数的信息（可重复参数各行同属一个参数定义，用 defIdx 定位提示）
                          const rawCode = (blk.codeLine || '').replace(FLOW_AUTO_TAG, '')
                          const cmdName = findFirstCommandName(rawCode)
                          if (cmdName) {
                            const ownerAssembly = findOwnerAssemblyName(blk.lineIndex)
                            const hintName = userSubNamesRef.current.has(cmdName) ? `__SUB__:${cmdName}:${ownerAssembly}` : cmdName
                            onCommandClick?.(hintName, row.defIdx)
                          }
                          const valEl = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.eyc-param-expand-val')
                          const valueLeft = valEl?.getBoundingClientRect().left
                          setEditCell({ lineIndex: blk.lineIndex, cellIndex: -2, fieldIdx: -1, sliceField: false, paramIdx: ai })
                          setEditVal(argVals[ai] !== undefined ? argVals[ai] : '')
                          focusParamInputAt(e.clientX, valueLeft)
                        }
                        const isParamRowSelected = !!selectedParamRows && selectedParamRows.lineIndex === blk.lineIndex && selectedParamRows.argIdxs.has(ai)
                        // Ctrl/Cmd+点=切换选中；Shift+点=从锚点连选；普通点=进入编辑（并清参数行选区）
                        const onParamRowClick = (e: React.MouseEvent) => {
                          if (suppressParamClickRef.current) { suppressParamClickRef.current = false; return }
                          if (e.ctrlKey || e.metaKey) {
                            e.stopPropagation()
                            setEditCell(null)
                            setSelectedLines(prev => (prev.size === 0 ? prev : new Set()))
                            setSelectedParamRows(prev => {
                              const base = prev && prev.lineIndex === blk.lineIndex ? new Set(prev.argIdxs) : new Set<number>()
                              if (base.has(ai)) base.delete(ai); else base.add(ai)
                              return base.size ? { lineIndex: blk.lineIndex, argIdxs: base } : null
                            })
                            paramSelAnchorRef.current = ai
                            return
                          }
                          if (e.shiftKey && paramSelAnchorRef.current != null) {
                            e.stopPropagation()
                            setEditCell(null)
                            setSelectedLines(prev => (prev.size === 0 ? prev : new Set()))
                            const lo = Math.min(paramSelAnchorRef.current, ai), hi = Math.max(paramSelAnchorRef.current, ai)
                            const set = new Set<number>()
                            for (let k = lo; k <= hi; k++) set.add(k)
                            setSelectedParamRows({ lineIndex: blk.lineIndex, argIdxs: set })
                            return
                          }
                          setSelectedParamRows(null)
                          setSelectedLines(prev => (prev.size === 0 ? prev : new Set()))
                          paramSelAnchorRef.current = ai
                          startParamEdit(e)
                        }
                        return (
                          <Fragment key={ai}>
                            <div
                              className={`eyc-param-expand-row${isEditingParam ? ' eyc-param-expand-row-editing' : ' eyc-param-expand-row-clickable'}${isExprExpanded ? ' eyc-param-expand-row-parent' : ''}${isParamRowSelected ? ' eyc-param-expand-row-selected' : ''}`}
                              data-param-line={blk.lineIndex}
                              data-param-arg={ai}
                              onMouseDown={(e) => {
                                suppressParamClickRef.current = false  // 清掉上一次拖选可能残留的吞点击标记
                                if (e.ctrlKey || e.metaKey || e.shiftKey) { e.stopPropagation(); e.preventDefault(); return }
                                if (isEditingParam || e.button !== 0) return
                                // 普通左键：阻止冒泡到行 mousedown（否则起整行拖选/乐观进代码行编辑），记录拖选锚点。
                                // stopPropagation 跳过了行 mousedown 的提交、preventDefault 又压掉失焦提交，故此处显式提交活跃编辑。
                                e.stopPropagation(); e.preventDefault()
                                if (editCellRef.current) commitRef.current()
                                paramDragRef.current = { lineIndex: blk.lineIndex, anchorArg: ai, startX: e.clientX, startY: e.clientY, active: false }
                              }}
                              onClick={isEditingParam ? undefined : onParamRowClick}
                            >
                              {showExprFold && (
                                <span
                                  className="eyc-gutter-fold eyc-param-expr-fold"
                                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setExpandedParamExprKeys(prev => {
                                      const next = new Set(prev)
                                      if (next.has(exprKey)) next.delete(exprKey)
                                      else next.add(exprKey)
                                      return next
                                    })
                                  }}
                                >{isExprExpanded ? '−' : '+'}</span>
                              )}
                              <span className="eyc-param-expand-mark">※</span>
                              <span className="eyc-param-expand-name">{p.name}</span>
                              <span className="eyc-param-expand-colon">：</span>
                              {isEditingParam ? (
                                <div className="eyc-inline-edit-sizing eyc-param-inline-edit-sizing">
                                  <span className="eyc-inline-edit-measure">{(editVal || '') + '\u00A0'}</span>
                                  <input
                                    ref={paramInputRef}
                                    className="eyc-param-val-input"
                                    aria-label={`编辑参数 ${p.name}`}
                                    value={editVal}
                                    onChange={e => { const v = e.target.value; setEditVal(v); scheduleLiveUpdate(v); updateCompletion(v, e.currentTarget.selectionStart ?? v.length) }}
                                    onBlur={() => {
                                      if (shouldSuppressBlurCommit()) return
                                      commit()
                                    }}
                                    onKeyDown={e => {
                                      if (handleParamInputCtrlKey(e)) return
                                      if (applyCompletionPopupKey(e.key)) { e.preventDefault(); return }
                                      // 顶层逗号（不在嵌套括号内）= 「新增当前层级参数行」意图，杜绝多值挤进单槽的级联重复
                                      const caret = e.currentTarget.selectionStart ?? editVal.length
                                      const isTopLevelComma = (e.key === ',' || e.key === '，') && isArgParensBalanced(editVal.slice(0, caret))
                                      // 可重复参数：顶层逗号（值非空）→ 追加下一个值行（照易语言逐值一行）
                                      if (row.repeatable && editVal.trim() !== '' && isTopLevelComma) {
                                        e.preventDefault(); appendRepeatParamRow(blk.lineIndex, ai, editVal); return
                                      }
                                      // 其余情形顶层逗号一律吞掉：单个参数槽不容纳多值
                                      if (isTopLevelComma) { e.preventDefault(); return }
                                      if (e.key === 'Enter') {
                                        e.preventDefault()
                                        // 连续回车：本行不是最后一个参数行 → 提交本行并前进到下一参数行继续编辑
                                        const curPos = paramRows.findIndex(r => r.argIdx === ai)
                                        const nextRow = curPos >= 0 ? paramRows[curPos + 1] : undefined
                                        if (nextRow) { advanceParamEdit(blk.lineIndex, ai, editVal, nextRow.argIdx); return }
                                        // 最后一行：可重复参数（值非空）→ 追加下一个值行；否则提交收尾
                                        if (row.repeatable && editVal.trim() !== '') { appendRepeatParamRow(blk.lineIndex, ai, editVal); return }
                                        commit()
                                        return
                                      }
                                      if (e.key === 'Escape') setEditCell(null)
                                    }}
                                    spellCheck={false}
                                  />
                                </div>
                              ) : (
                                <span className={`eyc-param-expand-val${isQuotedTextLiteral(argVal) ? ' eTxtcolor' : ''}`}>{argVal || '\u00A0'}</span>
                              )}
                            </div>
                            {isExprExpanded && renderExprExpandItems(nestedItems, blk.lineIndex, ai, [], 0, `line-${blk.lineIndex}-p-${ai}`, Math.max(0, Math.floor(leadingSpaces / 4)))}
                          </Fragment>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
              {assignDetail && isExpanded && (() => {
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
                  <div
                    className="eyc-param-expand"
                    ref={(element) => setCssVars(element, { '--eyc-param-expand-padding-left': expandPadding })}
                  >
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
                    <span
                      className="eyc-param-expand-arrow"
                      ref={(element) => setCssVars(element, { '--eyc-param-expand-arrow-left': arrowLeftStyle })}
                    />
                    <div className="eyc-param-expand-inner">
                      <div className="eyc-param-expand-row">
                        <span className="eyc-param-expand-mark">※</span>
                        <span className="eyc-param-expand-name">被赋值的变量或变量数组</span>
                        <span className="eyc-param-expand-colon">：</span>
                        <span className="eyc-param-expand-val">{assignDetail.target || '\u00A0'}</span>
                      </div>
                      <div className={`eyc-param-expand-row eyc-param-expand-row-assign-value${isEditingAssignValue ? '' : ' eyc-param-expand-row-clickable'}`} onClick={isEditingAssignValue ? undefined : (e) => {
                        e.stopPropagation()
                        setEditCell({ lineIndex: blk.lineIndex, cellIndex: -2, fieldIdx: -1, sliceField: false, paramIdx: -100 })
                        setEditVal(assignDetail.value || '')
                        setTimeout(() => paramInputRef.current?.focus(), 0)
                      }}>
                        <span className="eyc-param-expand-mark">※</span>
                        <span className="eyc-param-expand-name">用作赋予的值或资源</span>
                        <span className="eyc-param-expand-colon">：</span>
                        {isEditingAssignValue ? (
                          <input
                            ref={paramInputRef}
                            className="eyc-param-val-input"
                            aria-label="编辑赋值内容"
                            value={editVal}
                            onChange={e => { const v = e.target.value; setEditVal(v); scheduleLiveUpdate(v); updateCompletion(v, e.currentTarget.selectionStart ?? v.length) }}
                            onBlur={() => {
                              if (shouldSuppressBlurCommit()) return
                              commit()
                            }}
                            onKeyDown={e => {
                              if (handleParamInputCtrlKey(e)) return
                              if (applyCompletionPopupKey(e.key)) { e.preventDefault(); return }
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
                                className={`eyc-param-expand-row eyc-param-expand-row-secondary${isEditingAssignCmdParam ? '' : ' eyc-param-expand-row-clickable'}`}
                              >
                                <span className="eyc-param-expand-mark">※</span>
                                <span className="eyc-param-expand-name">{p.name}</span>
                                <span className="eyc-param-expand-colon">：</span>
                                {isEditingAssignCmdParam ? (
                                  <input
                                    ref={paramInputRef}
                                    className="eyc-param-val-input"
                                    aria-label={`编辑赋值命令参数 ${p.name}`}
                                    value={editVal}
                                    onChange={e => { const v = e.target.value; setEditVal(v); scheduleLiveUpdate(v); updateCompletion(v, e.currentTarget.selectionStart ?? v.length) }}
                                    onBlur={() => {
                                      if (shouldSuppressBlurCommit()) return
                                      commit()
                                    }}
                                    onKeyDown={e => {
                                      if (handleParamInputCtrlKey(e)) return
                                      if (applyCompletionPopupKey(e.key)) { e.preventDefault(); return }
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
            {(diffDeletedLinesByAnchor.get(blk.lineIndex) || []).map((deletedText, di) => (
              <div key={`code-del-${blk.lineIndex}-${di}`} className="eyc-block-row eyc-block-row-wrap eyc-diff-deleted-placeholder" aria-hidden="true">
                <div className="eyc-line-gutter">
                  <div className="eyc-gutter-cell eyc-diff-deleted-placeholder-gutter">
                    <span className="eyc-breakpoint-dot">●</span>
                    <span className="eyc-gutter-linenum">&nbsp;</span>
                    <span className="eyc-gutter-fold-area" />
                  </div>
                </div>
                <div className="eyc-code-line eyc-diff-deleted-placeholder-line" title={deletedText || undefined}>
                  {deletedText.trim()
                    ? <span className="eyc-code-spans eyc-diff-deleted-text">{deletedText}</span>
                    : <span className="eyc-code-spans">&nbsp;</span>}
                </div>
              </div>
            ))}
            </Fragment>
          )
        })}
        {blockVirtualWindow.trailingSpacerPx > 0 && (
          <div
            aria-hidden="true"
            className="eyc-virtual-spacer"
            ref={(element) => setCssVars(element, { '--eyc-virtual-spacer-height': `${blockVirtualWindow.trailingSpacerPx}px` })}
          />
        )}
      </div>

      {shouldShowMinimapPreview && (
        <div
          className="eyc-minimap"
          role="region"
          aria-label="代码预览缩略图"
          tabIndex={0}
          onKeyDown={handleMinimapKeyDown}
          onWheel={handleMinimapWheel}
        >
          <div
            className="eyc-minimap-track"
            ref={minimapTrackRef}
            onMouseDown={handleMinimapMouseDown}
            aria-hidden="true"
          >
            <div className="eyc-minimap-content" ref={minimapContentRef} aria-hidden="true">
              {minimapPreviewRows.map((row, rowIndex) => (
                row.kind === 'deleted'
                  ? (
                      <div key={`mini-row-${rowIndex}`} className="eyc-minimap-row eyc-minimap-row-deleted">
                        <span className="eyc-minimap-marker eyc-minimap-marker-deleted" />
                        <span className="eyc-minimap-deleted-line" />
                      </div>
                    )
                  : row.kind === 'table'
                  ? (
                      <div key={`mini-row-${rowIndex}`} className={`eyc-minimap-row eyc-minimap-row-table${row.marker === 'error' ? ' eyc-minimap-row-error' : ''}`}>
                        <span className={`eyc-minimap-marker eyc-minimap-marker-${row.marker}`} />
                        {row.cells.map((cell, cellIndex) => (
                          <span key={`mini-cell-${rowIndex}-${cellIndex}`} className={`eyc-minimap-cell ${cell.cls}`}>{cell.text}</span>
                        ))}
                      </div>
                    )
                  : (
                      <div key={`mini-row-${rowIndex}`} className={`eyc-minimap-row eyc-minimap-row-code${row.marker === 'error' ? ' eyc-minimap-row-error' : ''}`}>
                        <span className={`eyc-minimap-marker eyc-minimap-marker-${row.marker}`} />
                        {row.spans.map((span, spanIndex) => (
                          <span key={`mini-span-${rowIndex}-${spanIndex}`} className={span.cls}>{span.text}</span>
                        ))}
                      </div>
                    )
              ))}
            </div>
            <div
              className="eyc-minimap-viewport"
              ref={minimapViewportRef}
            />
          </div>
        </div>
      )}
      <div className="eyc-scrollbar-status-lane eyc-scrollbar-status-lane-vertical" aria-hidden="true">
        {laidOutScrollbarStatusMarkers.map((marker, idx) => (
          <span
            key={`v-marker-${idx}`}
            className={`eyc-scrollbar-status-marker eyc-scrollbar-status-marker-${marker.type} ${marker.type === 'error' ? 'eyc-scrollbar-status-marker-errorlane' : 'eyc-scrollbar-status-marker-difflane'}`}
            ref={(element) => setCssVars(element, {
              '--eyc-scrollbar-marker-top': `${marker.topPx}px`,
              '--eyc-scrollbar-marker-height': `${marker.heightPx}px`,
            })}
          />
        ))}
      </div>
      <div className="eyc-scrollbar-mask eyc-scrollbar-mask-left" aria-hidden="true" />
      <div className="eyc-scrollbar-mask eyc-scrollbar-mask-right" aria-hidden="true" />
      </div>
      {showVarSummaryPanel && !isResourceTableDoc && (varPanelOpen ? (
        <div className="eyc-var-panel">
          <div className="eyc-var-panel-head">
            <input
              className="eyc-var-panel-search"
              value={varPanelQuery}
              onChange={(e) => setVarPanelQuery(e.target.value)}
              placeholder="搜索变量…"
              spellCheck={false}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button type="button" className="eyc-var-panel-toggle" title="收起变量面板" onClick={toggleVarPanel}>»</button>
          </div>
          <div className="eyc-var-panel-body">
            {varPanelGroups.map(group => {
              const collapsed = varPanelCollapsedGroups.has(group.key)
              return (
                <div key={group.key} className="eyc-var-group">
                  <div
                    className={`eyc-var-group-head${group.isCurrentSub ? ' eyc-var-group-head-current' : ''}`}
                    onClick={() => toggleVarPanelGroup(group.key)}
                  >
                    <span className="eyc-var-group-arrow">{collapsed ? '▸' : '▾'}</span>
                    <span className="eyc-var-group-title">{group.title}</span>
                    <span className="eyc-var-group-count">{varPanelQuery.trim() ? `${group.items.length}/${group.total}` : group.total}</span>
                  </div>
                  {!collapsed && group.items.map(item => {
                    const icon = varTypeIconOf(item.typeName)
                    return (
                      <div
                        key={`${group.key}-${item.lineIndex}-${item.name}`}
                        className="eyc-var-item"
                        title={`${item.name}  ${item.typeName}${item.arrayText ? `  ${item.arrayText}` : ''}`}
                        onClick={() => handleVarPanelItemClick(item.lineIndex)}
                      >
                        <span className={`eyc-var-item-icon eyc-var-item-icon-${icon.cls}`}>{icon.char}</span>
                        <span className="eyc-var-item-name">{item.name}</span>
                        <span className="eyc-var-item-type">{item.isParam ? '参数 · ' : ''}{item.typeName}{item.arrayText ? ` · ${item.arrayText}` : ''}</span>
                      </div>
                    )
                  })}
                  {!collapsed && group.items.length === 0 && (
                    <div className="eyc-var-group-empty">{varPanelQuery.trim() ? '无匹配' : '（空）'}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <button type="button" className="eyc-var-panel-collapsed" title="展开变量面板" onClick={toggleVarPanel}>
          <span className="eyc-var-panel-collapsed-arrow">«</span>
          <span className="eyc-var-panel-collapsed-label">变量</span>
        </button>
      ))}
      </div>

      <EycResourcePreview
        preview={resourcePreview}
        previewBusy={resourcePreviewBusy}
        previewSrc={resourcePreviewSrc}
        previewMsg={resourcePreviewMsg}
        previewMeta={resourcePreviewMeta}
        previewMediaMeta={resourcePreviewMediaMeta}
        projectDir={projectDir}
        onClose={() => setResourcePreview(prev => ({ ...prev, visible: false }))}
        onReplace={() => { void handleReplaceResourceFile() }}
        onImageLoaded={(width, height) => setResourcePreviewMediaMeta(prev => ({ ...prev, width, height }))}
        onAudioLoaded={(durationSec) => setResourcePreviewMediaMeta(prev => ({ ...prev, durationSec }))}
        onVideoLoaded={(width, height, durationSec) => setResourcePreviewMediaMeta(prev => ({ ...prev, width, height, durationSec }))}
        inferResourceTypeByFileName={inferResourceTypeByFileName}
      />

      {/* 自动补全弹窗 */}
      {acVisible && acItems.length > 0 && (
        <div
          className="eyc-ac-container"
          ref={(element) => {
            acContainerRef.current = element
            setCssVars(element, {
              '--eyc-ac-left': `${acPos.left}px`,
              '--eyc-ac-top': `${acPos.top}px`,
            })
          }}
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
                  if (p.repeatable) s += '...'
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
                          参数&lt;{pi + 1}&gt;的名称为"{p.name}"，类型为"{p.type}{p.isArray ? '(数组)' : ''}{p.isVariable ? '(参考)' : ''}"{p.optional ? '，可以被省略' : ''}{p.repeatable ? '，可重复追加' : ''}。
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
      {cmdHoverTip && (() => {
        const cmd = cmdHoverTip.cmd
        const sig = cmd.params.map(p => {
          const core = `${p.type} ${p.name}`
          return p.optional ? `［${core}］` : core
        }).join('，')
        // 防右溢出：贴视口右缘回收
        const maxLeft = Math.max(8, window.innerWidth - 560)
        return (
          <div
            className="eyc-cmd-hover-tip"
            ref={(element) => setCssVars(element, {
              '--eyc-cmd-hover-left': `${Math.min(cmdHoverTip.x, maxLeft)}px`,
              '--eyc-cmd-hover-top': `${cmdHoverTip.y}px`,
            })}
          >
            <div className="eyc-cmd-hover-sig">
              {cmd.returnType ? <span className="eyc-cmd-hover-type">&lt;{cmd.returnType}&gt;</span> : null}
              <span className="eyc-cmd-hover-name"> {cmd.name} </span>
              <span>（</span>
              <span className="eyc-cmd-hover-params">{sig}</span>
              <span>）</span>
              {cmd.libraryName ? <span className="eyc-cmd-hover-lib"> - {cmd.libraryName}</span> : null}
            </div>
            {cmd.description && <div className="eyc-cmd-hover-desc">解释：{cmd.description}</div>}
          </div>
        )
      })()}
      {editorContextMenu && (
        <div
          className="eyc-editor-context-menu"
          ref={(element) => setCssVars(element, {
            '--eyc-context-menu-left': `${editorContextMenu.x}px`,
            '--eyc-context-menu-top': `${editorContextMenu.y}px`,
          })}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {docLanguage === 'ell' ? (
            <>
              <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('newDllCommand')}>
                <span className="eyc-editor-context-menu-item-label">N.新DLL命令</span>
              </button>
              <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('newPtrCommand')}>
                <span className="eyc-editor-context-menu-item-label">Z.新指针命令</span>
              </button>
            </>
          ) : (
            <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('newSubprogram')}>
              <span className="eyc-editor-context-menu-item-label">N.新子程序</span>
              <span className="eyc-editor-context-menu-item-shortcut">Ctrl+N</span>
            </button>
          )}
          <div className="eyc-editor-context-menu-sep" />
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('undo')} disabled={!canUndoContextAction}>
            <span className="eyc-editor-context-menu-item-label">U.撤销</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ctrl+Z</span>
          </button>
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('redo')} disabled={!canRedoContextAction}>
            <span className="eyc-editor-context-menu-item-label">Y.重做</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ctrl+Y</span>
          </button>
          <div className="eyc-editor-context-menu-sep" />
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('copy')} disabled={!hasCopySelection}>
            <span className="eyc-editor-context-menu-item-label">C.复制</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ctrl+C</span>
          </button>
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('cut')} disabled={!canCutContextAction}>
            <span className="eyc-editor-context-menu-item-label">T.剪切</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ctrl+X</span>
          </button>
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('paste')} disabled={!contextMenuCanPaste}>
            <span className="eyc-editor-context-menu-item-label">P.粘贴</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ctrl+V</span>
          </button>
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('selectAll')}>
            <span className="eyc-editor-context-menu-item-label">F.全选</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ctrl+A</span>
          </button>
          <div className="eyc-editor-context-menu-sep" />
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('delete')}>
            <span className="eyc-editor-context-menu-item-label">E.删除行</span>
            <span className="eyc-editor-context-menu-item-shortcut">F10</span>
          </button>
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('insertLine')}>
            <span className="eyc-editor-context-menu-item-label">I.插入新行</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ins</span>
          </button>
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('compileLine')}>
            <span className="eyc-editor-context-menu-item-label">K.编译当前行</span>
            <span className="eyc-editor-context-menu-item-shortcut">Shift+Enter</span>
          </button>
          <div className="eyc-editor-context-menu-sep" />
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('block')}>
            <span className="eyc-editor-context-menu-item-label">G.屏蔽</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ctrl+K</span>
          </button>
          <button type="button" className="eyc-editor-context-menu-item" onClick={() => applyEditorContextAction('unblock')}>
            <span className="eyc-editor-context-menu-item-label">B.解除屏蔽</span>
            <span className="eyc-editor-context-menu-item-shortcut">Ctrl+M</span>
          </button>
        </div>
      )}
      {debugHover && (
        <div
          className="eyc-debug-hover-tooltip"
          ref={(element) => setCssVars(element, {
            '--eyc-debug-tooltip-left': `${debugHover.x}px`,
            '--eyc-debug-tooltip-top': `${debugHover.y}px`,
          })}
        >
          <div className="eyc-debug-hover-name">{debugHover.variable.name}</div>
          <div className="eyc-debug-hover-type">{debugHover.variable.type}</div>
          <div className="eyc-debug-hover-value">{debugHover.variable.value || '（空）'}</div>
        </div>
      )}

      {/* 未知标识符回车 → 插入变量提示框（照易语言） */}
      {insertVarPrompt && (
        <div className="eyc-insertvar-overlay" onMouseDown={() => { setInsertVarPrompt(null); focusWrapper() }}>
          <div className="eyc-insertvar-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="eyc-insertvar-text">未知命令“{insertVarPrompt.name}”。是否将“{insertVarPrompt.name}”插入为变量？</div>
            <div className="eyc-insertvar-btns">
              <button type="button" autoFocus onClick={() => applyInsertVariable('local')}>局部变量</button>
              <button type="button" onClick={() => applyInsertVariable('assembly')}>程序集变量</button>
              <button type="button" onClick={() => applyInsertVariable('global')}>全局变量</button>
              <button type="button" onClick={() => { setInsertVarPrompt(null); focusWrapper() }}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

// memo 隔离父组件（App 状态栏 Ln/Col、命令提示面板等顶层状态）重渲染的级联：
// 每次点击/移动光标都会触发 App setState，未隔离时编辑器整表虚拟 DOM 会被连带重建。
// 前提：所有非原始类型 props 必须引用稳定（调用处禁止内联 || [] 兜底与内联箭头回调）。
export default memo(EycTableEditor)
