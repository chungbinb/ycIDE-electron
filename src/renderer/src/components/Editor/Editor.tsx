import { useState, useRef, useCallback, useEffect, useMemo, useImperativeHandle, forwardRef, Component, type ErrorInfo, type ReactNode } from 'react'
import './monaco-setup' // 必须在 @monaco-editor/react 首次 init 前：用本地 monaco 替代 CDN（离线可用）
import MonacoEditor, { OnMount, OnChange, type Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import EycTableEditor, { type EycTableEditorHandle, type FileProblem } from './EycTableEditor'
import { useEditorDiagnosticsProblems } from './editorDiagnostics'
import type { EditorDiagnosticsProblem } from './editorDiagnosticsShared'
import { sweepFileDiagnostics, type SweepWindowControl } from './projectDiagnosticsSweep'
import { buildCompletionCatalog } from './editorCompletionCatalogUtils'
import VisualDesigner, { type DesignForm, type DesignControl, type SelectionTarget, type LibWindowUnit, type LibUnitEvent } from './VisualDesigner'
import { eycToInternalFormat, eycToYiFormat, sanitizePastedTextForCurrent, extractAssemblyVarLinesFromPasted, extractRoutedDeclarationLinesFromPasted } from './eycFormat'
import { parseLines } from './eycBlocks'
import { buildMultiLinePasteResult } from './editorPasteUtils'
import { buildMonacoThemeTokens } from './monacoThemeTokens'
import { parseFontSpec, stringifyFontSpec } from './fontSpec'
import Icon from '../Icon/Icon'
import '../Icon/Icon.css'
import './Editor.css'

// 同时具备「字体」与独立「文本颜色」属性的控件类型：这两处文本色需双向同步（见 updateFormProperty）。
// 与 lib/krnln/window-units.json 中「字体+文本颜色」并存的 10 个单元一致；控件 type 存中文名（.efw/addControl 均用中文），故只列中文。
const FONT_TEXTCOLOR_SYNC_TYPES = new Set([
  '标签', '编辑框', '选择框', '单选框', '列表框', '组合框', '分组框', '画板', '月历', '超级链接框',
])

/** 注册 eyc 语言到 Monaco Editor */
function registerEycLanguage(monaco: Monaco): void {
  // 避免重复注册
  if (monaco.languages.getLanguages().some((lang: { id: string }) => lang.id === 'eyc')) return

  // 注册语言
  monaco.languages.register({
    id: 'eyc',
      extensions: ['.eyc', '.egv', '.ecs', '.edt', '.ell', '.erc'],
    aliases: ['易语言源码', 'EYC', 'eyc'],
  })

  // 语法高亮规则 (Monarch tokenizer)
  monaco.languages.setMonarchTokensProvider('eyc', {
    defaultToken: '',
    ignoreCase: false,

    // 易语言关键字
    keywords: [
      '如果', '如果真', '否则', '如果结束', '如果真结束',
      '判断', '判断结束', '默认',
      '计次循环首', '计次循环尾', '循环判断首', '循环判断尾',
      '变量循环首', '变量循环尾', '到循环尾', '跳出循环',
      '返回', '结束',
      '等待', '延时',
    ],

    // 声明关键字（以 . 开头）
    declarations: [
      '版本', '支持库', '程序集', '子程序', '局部变量', '参数',
      '全局变量', '程序集变量', '常量', '数据类型', '自定义数据类型',
      'DLL命令', '指针命令', '模块引用',
    ],

    // 数据类型
    typeKeywords: [
      '整数型', '小数型', '双精度小数型', '文本型', '字节型',
      '短整数型', '长整数型', '逻辑型', '日期时间型', '子程序指针',
      '字节集', '通用型',
    ],

    // 内置命令
    builtins: [
      '信息框', '输入框', '标题', '输出调试文本', '到文本', '到数值',
      '取文本长度', '取文本左边', '取文本右边', '取文本中间',
      '寻找文本', '替换文本', '删全部空', '文本替换',
      '取数组成员数', '加入成员', '删除成员', '清除数组',
      '写到文件', '读入文件', '文件是否存在', '创建目录',
      '取现行时间', '时间到文本', '是否为空',
      '取随机数', '置随机数种子',
      '载入', '销毁', '可视', '宽度', '高度', '左边', '顶边',
    ],

    // 逻辑常量
    constants: ['真', '假', '空'],

    // 运算符
    operators: ['＝', '≠', '＞', '＜', '≥', '≤', '＋', '－', '×', '÷', '且', '或', '非'],

    // 符号
    symbols: /[=><!~?:&|+\-*\/\^%]+/,

    tokenizer: {
      root: [
        // 以 . 开头的声明关键字
        [/\.([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_]*)/, {
          cases: {
            '$1@declarations': 'keyword.declaration',
            '@default': 'keyword.declaration',
          }
        }],

        // 行注释 (以 ' 开头 或 // 开头)
        [/\/\/.*$/, 'comment'],
        [/'.*$/, 'comment'],

        // 字符串
        [/"([^"]*)"/, 'string'],
        [/\u201c([^\u201d]*)\u201d/, 'string'],

        // 中文括号
        [/\uff08/, 'delimiter.parenthesis'],
        [/\uff09/, 'delimiter.parenthesis'],

        // 数字
        [/\d+\.\d*/, 'number.float'],
        [/\d+/, 'number'],

        // 标识符匹配
        [/[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_]*/, {
          cases: {
            '@keywords': 'keyword',
            '@typeKeywords': 'type',
            '@builtins': 'predefined',
            '@constants': 'constant',
            '@operators': 'operator',
            '@default': 'identifier',
          },
        }],

        // 空白
        [/[ \t\r\n]+/, 'white'],

        // 标点
        [/[{}()\[\]，,。；;：:]/, 'delimiter'],
      ],
    },
  })

  // 语言配置（括号匹配、注释等）
  monaco.languages.setLanguageConfiguration('eyc', {
    comments: {
      lineComment: "'",
    },
    brackets: [
      ['\uff08', '\uff09'],
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ],
    autoClosingPairs: [
      { open: '\uff08', close: '\uff09' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: '\u201c', close: '\u201d' },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
    ],
    surroundingPairs: [
      { open: '\uff08', close: '\uff09' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: '\u201c', close: '\u201d' },
    ],
    indentationRules: {
      increaseIndentPattern: /^\s*\.(子程序|如果|否则|判断开始|判断|计次循环首|循环判断首|变量循环首)/,
      decreaseIndentPattern: /^\s*\.(如果结束|如果真结束|否则|判断结束|计次循环尾|循环判断尾|变量循环尾)/,
    },
  })

  // 代码补全
  monaco.languages.registerCompletionItemProvider('eyc', {
    provideCompletionItems: (model: editor.ITextModel, position: { lineNumber: number; column: number }) => {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }

      const suggestions = [
        { label: '.子程序', kind: monaco.languages.CompletionItemKind.Keyword, insertText: '.子程序 ${1:子程序名}\n.参数 ${2:参数名}, ${3:整数型}\n\n    $0', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: '定义子程序', range },
        { label: '.局部变量', kind: monaco.languages.CompletionItemKind.Keyword, insertText: '.局部变量 ${1:变量名}, ${2:整数型}', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: '声明局部变量', range },
        { label: '.如果', kind: monaco.languages.CompletionItemKind.Keyword, insertText: '.如果 (${1:条件})\n    $0\n.如果结束', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: '条件判断', range },

        { label: '计次循环首', kind: monaco.languages.CompletionItemKind.Keyword, insertText: '计次循环首 (${1:次数}, ${2:计数变量})\n    $0\n计次循环尾 ()', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: '计次循环', range },
        { label: '信息框', kind: monaco.languages.CompletionItemKind.Function, insertText: '信息框 (${1:"内容"}, ${2:0}, ${3:"标题"}, )', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: '弹出信息框', range },
        { label: '输出调试文本', kind: monaco.languages.CompletionItemKind.Function, insertText: '输出调试文本 (${1:内容})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: '输出调试信息', range },
        { label: '到文本', kind: monaco.languages.CompletionItemKind.Function, insertText: '到文本 (${1:数值})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: '数值转文本', range },
        { label: '标题', kind: monaco.languages.CompletionItemKind.Function, insertText: '标题 (${1:"窗口标题"})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: '设置窗口标题', range },
        { label: '返回', kind: monaco.languages.CompletionItemKind.Keyword, insertText: '返回 (${1:值})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: '返回值', range },
      ]

      return { suggestions }
    },
  })
}

function registerEditorThemes(monaco: Monaco, themeTokenValues: Record<string, string> = {}): void {
  const darkTokens = buildMonacoThemeTokens('dark', themeTokenValues)
  monaco.editor.defineTheme('ycide-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: darkTokens.rules,
    colors: darkTokens.colors,
  })

  const lightTokens = buildMonacoThemeTokens('light', themeTokenValues)
  monaco.editor.defineTheme('ycide-light', {
    base: 'vs',
    inherit: true,
    rules: lightTokens.rules,
    colors: lightTokens.colors,
  })
}

function createMonacoEditorOptions(
  editorFontFamily: string,
  editorFontSize: number,
  editorLineHeight: number,
): editor.IStandaloneEditorConstructionOptions {
  return {
    fontSize: editorFontSize,
    fontFamily: editorFontFamily,
    lineHeight: editorLineHeight,
    fontLigatures: true,
    minimap: { enabled: true, scale: 1 },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    renderLineHighlight: 'all',
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true },
    autoIndent: 'full',
    formatOnPaste: true,
    wordWrap: 'off',
    lineNumbers: 'on',
    glyphMargin: true,
    folding: true,
    foldingStrategy: 'indentation',
    links: true,
    contextmenu: true,
    mouseWheelZoom: true,
    padding: { top: 8, bottom: 8 },
    suggest: {
      showKeywords: true,
      showSnippets: true,
      preview: true,
    },
    tabSize: 4,
    insertSpaces: true,
    automaticLayout: true,
  }
}

// 打开的文件标签页
export interface EditorTab {
  id: string
  label: string
  language: string
  value: string
  savedValue: string  // 用于判断是否有未保存更改
  filePath?: string   // 实际文件路径
  formData?: DesignForm // 可视化设计器的窗口数据
  aiModified?: boolean // 未保存更改来自 AI 编辑（人工再编辑即清除，回归人工修改样式）
}

export interface DiffLineInfo {
  /** 1-based line numbers in the new (proposed) content that are additions */
  addedLines: number[]
  /** Deleted line groups: each with afterLine (1-based in new content, the line AFTER which deleted text appears) and text */
  deletedGroups: Array<{ afterLine: number; text: string }>
}

export interface EditorHandle {
  save: () => void
  saveAs: () => void
  saveAll: () => void
  saveProject: (projectDir: string) => void
  closeActiveTab: () => void
  closeProjectTabs: (projectDir: string) => void
  closeFileTab: (fileIdOrPath: string) => void
  clearAllTabs: () => void
  hasModifiedTabs: () => boolean
  editorAction: (action: string) => void
  getEditorFiles: () => Record<string, string>
  sweepProjectDiagnostics: () => Promise<Array<{ file: string; problems: EditorDiagnosticsProblem[] }>>
  openFile: (tab: EditorTab) => void
  upsertFile: (tab: EditorTab) => void
  applyDiffHighlight: (tabId: string, diffInfo: DiffLineInfo) => void
  clearDiffHighlight: () => void
  insertDeclaration: () => void
  insertLocalVariable: () => void
  insertConstant: () => void
  navigateToLine: (line: number) => void
  navigateToSubprogram: (subName: string, fallbackLine?: number) => void
  getVisibleLineForSourceLine: (line: number) => number
  updateFormProperty: (targetKind: 'form' | 'control', controlId: string | null, propName: string, value: string | number | boolean) => void
  navigateToEventSub: (sel: SelectionTarget, eventName: string, eventArgs: Array<{ name: string; description: string; dataType: string; isByRef: boolean }>) => void
}

function joinPathByBaseDir(baseDir: string, fileName: string): string {
  const separator = baseDir.includes('/') ? '/' : '\\'
  const normalizedBaseDir = (baseDir || '').replace(/[\\/]+$/, '')
  const normalizedFileName = (fileName || '').replace(/^[\\/]+/, '')
  return `${normalizedBaseDir}${separator}${normalizedFileName}`
}

function isFileInProjectDir(filePath: string | undefined, projectDir: string): boolean {
  if (!filePath || !projectDir) return false
  const normalize = (text: string) => text.replace(/\//g, '\\').replace(/[\\]+$/, '').toLowerCase()
  const normalizedPath = normalize(filePath)
  const normalizedDir = normalize(projectDir)
  return normalizedPath === normalizedDir || normalizedPath.startsWith(`${normalizedDir}\\`)
}

function extractAssemblyLabel(content: string): string | null {
  const lines = (content || '').replace(/\r\n/g, '\n').split('\n')
  for (const line of lines) {
    const match = /^\s*\.程序集\s+([^,\s，]+)/.exec(line)
    if (!match) continue
    const name = (match[1] || '').trim()
    if (name) return name
  }
  return null
}

function stripFileExtension(fileName: string): string {
  const name = (fileName || '').trim()
  if (!name) return name
  const idx = name.lastIndexOf('.')
  if (idx <= 0) return name
  return name.slice(0, idx)
}

function getFileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

function resolveEycTabLabel(filePath: string, content: string): string {
  const assembly = extractAssemblyLabel(content)
  if (assembly) return assembly
  const fileName = filePath.split(/[\\/]/).pop() || filePath
  return stripFileExtension(fileName)
}

const MONACO_DIAGNOSTICS_OWNER = 'ycide-eyc-diagnostics'

interface ProjectDllParam {
  name: string
  type: string
  description: string
  optional: boolean
  isVariable: boolean
  isArray: boolean
}

interface ProjectDllCommand {
  name: string
  returnType: string
  description: string
  params: ProjectDllParam[]
  // .指针命令：通过函数地址间接调用，第一个参数固定为函数地址
  isIndirect?: boolean
}

type RoutedDeclLanguage = 'ell' | 'egv' | 'ecs' | 'edt'

const ROUTED_DECL_DEFAULTS: Record<RoutedDeclLanguage, { label: string; language: RoutedDeclLanguage }> = {
  ell: { label: 'DLL命令.ell', language: 'ell' },
  egv: { label: '全局变量.egv', language: 'egv' },
  ecs: { label: '常量.ecs', language: 'ecs' },
  edt: { label: '自定义数据类型.edt', language: 'edt' },
}

type TabBarPosition = 'top' | 'bottom'
type EycEditorMode = 'table' | 'text'
type PendingSubNavigation =
  | { kind: 'create-or-open'; subName: string; params: Array<{ name: string; dataType: string; isByRef: boolean }> }
  | { kind: 'navigate'; subName: string; fallbackLine?: number }
const EDITOR_TAB_BAR_POS_KEY = 'ycide.editor.tabbar.position'

// EycTableEditor 已用 memo 隔离重渲染，空值兜底必须用稳定引用，禁止内联 || []
const EMPTY_BREAKPOINT_LINES: number[] = []
const EMPTY_DEBUG_VARIABLES: Array<{ name: string; type: string; value: string }> = []

function isEycSourceLanguage(language?: string): boolean {
  return language === 'eyc'
    || language === 'egv'
    || language === 'ecs'
    || language === 'edt'
    || language === 'ell'
    || language === 'erc'
}

interface EycEditorErrorBoundaryProps {
  tabId: string
  onError: (tabId: string, error: Error, info: ErrorInfo) => void
  children: ReactNode
}

interface EycEditorErrorBoundaryState {
  hasError: boolean
}

class EycEditorErrorBoundary extends Component<EycEditorErrorBoundaryProps, EycEditorErrorBoundaryState> {
  state: EycEditorErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): EycEditorErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError(this.props.tabId, error, info)
  }

  componentDidUpdate(prevProps: EycEditorErrorBoundaryProps): void {
    if (prevProps.tabId !== this.props.tabId && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  render(): ReactNode {
    if (this.state.hasError) return null
    return this.props.children
  }
}

const Editor = forwardRef<EditorHandle, { onSelectControl?: (target: SelectionTarget) => void; onSidebarTab?: (tab: 'project' | 'library' | 'property') => void; selection?: SelectionTarget; onMultiSelectChange?: (count: number) => void; openProjectFiles?: EditorTab[]; onOpenTabsChange?: (tabs: EditorTab[]) => void; onActiveTabChange?: (tabId: string | null) => void; onCommandClick?: (commandName: string, paramIndex?: number) => void; onCommandClear?: () => void; onProblemsChange?: (problems: FileProblem[]) => void; onCursorChange?: (line: number, column: number, sourceLine?: number) => void; onDocTypeChange?: (docType: string) => void; projectDir?: string; onProjectTreeRefresh?: () => void; breakpointsByFile?: Record<string, number[]>; debugLocation?: { file: string; line: number } | null; debugVariables?: Array<{ name: string; type: string; value: string }>; currentTheme?: string; themeTokenValues?: Record<string, string>; editorFontFamily?: string; editorFontSize?: number; editorLineHeight?: number; editorFreezeSubTableHeader?: boolean; editorShowMinimapPreview?: boolean; editorShowVarSummaryPanel?: boolean; targetPlatform?: string; readFileForExternalCheck?: (filePath: string) => Promise<string | null>; resolveFileEncoding?: (filePath: string) => string | undefined; onPreviewWindow?: (efwFileName: string) => void }>(function Editor({ onSelectControl, onSidebarTab, selection, onMultiSelectChange, openProjectFiles, onOpenTabsChange, onActiveTabChange, onCommandClick, onCommandClear, onProblemsChange, onCursorChange, onDocTypeChange, projectDir, onProjectTreeRefresh, breakpointsByFile = {}, debugLocation = null, debugVariables = [], currentTheme = '', themeTokenValues = {}, editorFontFamily = '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace', editorFontSize = 14, editorLineHeight = 20, editorFreezeSubTableHeader = false, editorShowMinimapPreview = true, editorShowVarSummaryPanel = true, targetPlatform = 'windows', readFileForExternalCheck, resolveFileEncoding, onPreviewWindow }, ref) {
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  // 防抖版 tabs：项目元数据收集（全局变量/常量/数据类型/DLL命令/类）依赖它而非 tabs，
  // 避免每次按键都重跑 5 遍全文解析 + readDir + 逐个 readFile（这些声明不随普通代码行输入变化）。
  const [debouncedTabs, setDebouncedTabs] = useState<EditorTab[]>([])
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedTabs(tabs), 300)
    return () => window.clearTimeout(timer)
  }, [tabs])
  const [tabBarPosition, setTabBarPosition] = useState<TabBarPosition>(() => {
    try {
      const saved = localStorage.getItem(EDITOR_TAB_BAR_POS_KEY)
      return saved === 'top' ? 'top' : 'bottom'
    } catch {
      return 'bottom'
    }
  })
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tabId: string | null } | null>(null)
  const [eycFallbackTabs, setEycFallbackTabs] = useState<Record<string, true>>({})
  const [eycEditorModeTabs, setEycEditorModeTabs] = useState<Record<string, EycEditorMode>>({})
  const [projectGlobalVars, setProjectGlobalVars] = useState<Array<{ name: string; type: string }>>([])
  const [projectConstants, setProjectConstants] = useState<Array<{ name: string; value: string; kind?: 'constant' | 'resource' }>>([])
  const [projectDllCommands, setProjectDllCommands] = useState<ProjectDllCommand[]>([])
  const [projectDataTypes, setProjectDataTypes] = useState<Array<{ name: string; fields: Array<{ name: string; type: string }> }>>([])
  const [projectClassNames, setProjectClassNames] = useState<Array<{ name: string; methods?: Array<{ name: string; returnType: string; description: string; params: Array<{ name: string; type: string }> }> }>>([])
  const [externalChangePrompt, setExternalChangePrompt] = useState<{
    tabId: string
    filePath: string
    externalContent: string
  } | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const eycEditorRef = useRef<EycTableEditorHandle | null>(null)
  const diffDecorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null)
  const diffViewZoneIdsRef = useRef<string[]>([])
  const [eycDiffHighlightLines, setEycDiffHighlightLines] = useState<Set<number>>(new Set())
  const [eycDiffAddedLines, setEycDiffAddedLines] = useState<Set<number>>(new Set())
  const [eycDiffEditedLines, setEycDiffEditedLines] = useState<Set<number>>(new Set())
  const [eycDiffDeletedAfterLines, setEycDiffDeletedAfterLines] = useState<Set<number>>(new Set())
  // 锚点行(0-based) → 被删除的原文，供表格编辑器在红色删除占位行里显示删了什么
  const [eycDiffDeletedTextAfterLines, setEycDiffDeletedTextAfterLines] = useState<Map<number, string>>(new Map())
  const [windowUnits, setWindowUnits] = useState<LibWindowUnit[]>([])
  const pendingNavigateRef = useRef<PendingSubNavigation | null>(null)
  const tabsRef = useRef<EditorTab[]>([])
  const activeTabIdRef = useRef<string | null>(null)

  // ===== 全局撤销/重做：跨「代码表格编辑器」与「可视化设计器」，按动作时间顺序记录 =====
  // 每条记录 = 某个标签页的一次可撤销改动（content=代码文本 / formData=设计器窗体）。
  // 两个编辑器的 onChange 都写进同一个栈；撤销时回退对应标签页内容并自动切到该标签页，
  // 于是「先撤设计器移动控件、再撤代码修改」按真实时间顺序发生。
  type GlobalUndoKind = 'content' | 'formData'
  // 普通快照条目：回退某标签页的 content(代码文本) / formData(设计器窗体)
  interface GlobalUndoSnapshotEntry { kind: GlobalUndoKind; tabId: string; before: string | DesignForm; after: string | DesignForm }
  // 改名条目：窗口/控件改名牵连磁盘文件重命名，撤销=反向改名（复用 updateFormProperty 的完整改名机制）
  interface GlobalUndoRenameEntry { kind: 'rename'; targetKind: 'form' | 'control'; controlId: string | null; formName: string; oldName: string; newName: string }
  type GlobalUndoEntry = GlobalUndoSnapshotEntry | GlobalUndoRenameEntry
  const undoStackRef = useRef<GlobalUndoEntry[]>([])
  const redoStackRef = useRef<GlobalUndoEntry[]>([])
  const undoLastRef = useRef<{ tabId: string; kind: GlobalUndoKind; time: number } | null>(null)
  // 撤销/重做把旧值回灌给子编辑器时，子编辑器可能再次触发 onChange（回声），用它跳过一次以免污染栈
  const undoEchoRef = useRef<{ tabId: string; kind: GlobalUndoKind; value: string | DesignForm } | null>(null)
  // 撤销/重做改名时会反向调用 updateFormProperty，用它抑制那次调用再产生新的撤销记录
  const isApplyingUndoRef = useRef(false)
  // 打破声明顺序环：applyRename 需调用 updateFormProperty，但后者定义在后面，用 ref 中转
  const updateFormPropertyRef = useRef<((targetKind: 'form' | 'control', controlId: string | null, propName: string, value: string | number | boolean, forTabId?: string) => void) | null>(null)
  // 同理：命令式 editorAction('navBack')(供 App 全局 Ctrl+J)需要 navigateBack，但后者定义在后面
  const navigateBackRef = useRef<(() => void) | null>(null)

  const recordUndo = useCallback((tabId: string, kind: GlobalUndoKind, before: string | DesignForm, after: string | DesignForm) => {
    if (isApplyingUndoRef.current) return
    const eq = (a: string | DesignForm, b: string | DesignForm): boolean =>
      (typeof a === 'string' || typeof b === 'string') ? a === b : JSON.stringify(a) === JSON.stringify(b)
    const echo = undoEchoRef.current
    if (echo && echo.tabId === tabId && echo.kind === kind && eq(echo.value, after)) {
      undoEchoRef.current = null
      return
    }
    undoEchoRef.current = null
    if (eq(before, after)) return
    const now = Date.now()
    const stack = undoStackRef.current
    const last = stack[stack.length - 1]
    const lastMeta = undoLastRef.current
    // 同一标签页、同类型、且 600ms 内的连续改动（拖动控件、连续输入）合并为一条撤销
    if (last && last.kind !== 'rename' && lastMeta && last.tabId === tabId && last.kind === kind && (now - lastMeta.time) < 600) {
      last.after = after
      lastMeta.time = now
    } else {
      stack.push({ kind, tabId, before, after })
      undoLastRef.current = { tabId, kind, time: now }
      if (stack.length > 300) stack.shift()
    }
    redoStackRef.current = []
  }, [])

  const recordRename = useCallback((entry: Omit<GlobalUndoRenameEntry, 'kind'>) => {
    if (isApplyingUndoRef.current) return
    const stack = undoStackRef.current
    stack.push({ kind: 'rename', ...entry })
    if (stack.length > 300) stack.shift()
    undoLastRef.current = null
    redoStackRef.current = []
  }, [])

  const applyUndoEntry = useCallback((entry: GlobalUndoSnapshotEntry, target: 'before' | 'after') => {
    const value = target === 'before' ? entry.before : entry.after
    undoEchoRef.current = { tabId: entry.tabId, kind: entry.kind, value }
    setActiveTabId(entry.tabId)
    setTabs(prev => {
      const next = prev.map(t => {
        if (t.id !== entry.tabId) return t
        return entry.kind === 'content'
          ? { ...t, value: value as string, aiModified: undefined }
          : { ...t, formData: value as DesignForm, aiModified: undefined }
      })
      onOpenTabsChange?.(next)
      return next
    })
  }, [onOpenTabsChange])

  // 改名撤销/重做：反向再改一次名（undo→改回旧名，redo→改成新名）。复用 updateFormProperty
  // 的完整改名机制（同步更新标签内容/路径 + 异步磁盘文件重命名 + .epp + 项目树），
  // 因 renameWindow 是对称的（交换新旧名即可完全反向）。isApplyingUndoRef 抑制其再记录撤销。
  const applyRename = useCallback((entry: GlobalUndoRenameEntry, direction: 'undo' | 'redo') => {
    const targetName = direction === 'undo' ? entry.oldName : entry.newName
    // 定位承载该窗体的 .efw 标签页：改窗口名时窗口名会变，按当前应有的名字找；
    // 改控件名时窗口名不变，按 formName 找。
    const expectedFormName = entry.targetKind === 'form'
      ? (direction === 'undo' ? entry.newName : entry.oldName)
      : entry.formName
    const efwTab = tabsRef.current.find(t => t.language === 'efw' && t.formData?.name === expectedFormName)
    if (!efwTab) return
    setActiveTabId(efwTab.id) // 切到该窗体标签页，让改名回退可见（改窗口名时 updateFormProperty 内部还会再切到新路径）
    isApplyingUndoRef.current = true
    try {
      updateFormPropertyRef.current?.(entry.targetKind, entry.controlId, '__name__', targetName, efwTab.id)
    } finally {
      isApplyingUndoRef.current = false
    }
  }, [])

  const globalUndo = useCallback(() => {
    const stack = undoStackRef.current
    let entry: GlobalUndoEntry | undefined
    while (stack.length > 0) {
      const e = stack.pop()!
      if (e.kind === 'rename') { entry = e; break }
      if (tabsRef.current.some(t => t.id === e.tabId)) { entry = e; break }
      // 该标签页已关闭：丢弃这条撤销记录，继续找上一条
    }
    if (!entry) return
    redoStackRef.current.push(entry)
    undoLastRef.current = null
    if (entry.kind === 'rename') applyRename(entry, 'undo')
    else applyUndoEntry(entry, 'before')
  }, [applyUndoEntry, applyRename])

  const globalRedo = useCallback(() => {
    const stack = redoStackRef.current
    let entry: GlobalUndoEntry | undefined
    while (stack.length > 0) {
      const e = stack.pop()!
      if (e.kind === 'rename') { entry = e; break }
      if (tabsRef.current.some(t => t.id === e.tabId)) { entry = e; break }
    }
    if (!entry) return
    undoStackRef.current.push(entry)
    undoLastRef.current = null
    if (entry.kind === 'rename') applyRename(entry, 'redo')
    else applyUndoEntry(entry, 'after')
  }, [applyUndoEntry, applyRename])

  const monacoThemeId = currentTheme === '默认浅色' ? 'ycide-light' : 'ycide-dark'
  const monacoEditorOptions = useMemo(
    () => createMonacoEditorOptions(editorFontFamily, editorFontSize, editorLineHeight),
    [editorFontFamily, editorFontSize, editorLineHeight],
  )

  useEffect(() => {
    editorRef.current?.updateOptions(monacoEditorOptions)
  }, [monacoEditorOptions])

  const buildEventSubName = useCallback((targetName: string, eventName: string): string => {
    const normalized = targetName.replace(/^_+/, '')
    return `_${normalized}_${eventName}`
  }, [])

  // 统一计算标签页的实际保存内容（efw 使用 formData 序列化结果）
  const getTabPersistContent = (tab: EditorTab): string => {
    if (tab.language === 'efw' && tab.formData) {
      return JSON.stringify(tab.formData, null, 2)
    }
    return tab.value
  }

  const getTabSaveContent = (tab: EditorTab): string => {
    if (tab.language === 'eyc' || tab.language === 'egv' || tab.language === 'ecs' || tab.language === 'edt' || tab.language === 'ell' || tab.language === 'erc') return eycToYiFormat(tab.value)
    return getTabPersistContent(tab)
  }

  const saveTabToDisk = useCallback(async (tab: EditorTab, filePathOverride?: string): Promise<void> => {
    const targetFilePath = filePathOverride || tab.filePath
    if (!targetFilePath) return
    const content = getTabSaveContent(tab)
    const encoding = resolveFileEncoding?.(targetFilePath)
    await window.api?.file?.save(targetFilePath, content, encoding)
  }, [resolveFileEncoding])

  const getTabSavedDiskContent = (tab: EditorTab): string => {
    if (isEycSourceLanguage(tab.language)) return eycToYiFormat(tab.savedValue)
    return tab.savedValue
  }

  const normalizeExternalDiskContentForCompare = (tab: EditorTab, diskContent: string): string => {
    if (tab.language !== 'efw') return diskContent
    try {
      const data = JSON.parse(diskContent)
      const formData: DesignForm = {
        name: data.name || data.formName || getFileNameFromPath(tab.filePath || tab.label).replace(/\.efw$/i, ''),
        title: data.title || '',
        width: data.width || 592,
        height: data.height || 384,
        sourceFile: data.sourceFile,
        properties: data.properties || undefined,
        menu: Array.isArray(data.menu) ? data.menu : undefined,
        controls: (Array.isArray(data.controls) ? data.controls : []).map((c: any) => ({
          id: c.id,
          type: c.type,
          name: c.name,
          left: c.x ?? c.left ?? 0,
          top: c.y ?? c.top ?? 0,
          width: c.width ?? 100,
          height: c.height ?? 30,
          text: c.properties?.['标题'] ?? c.properties?.['内容'] ?? c.properties?.['文本'] ?? c.text ?? c.name ?? '',
          visible: c.visible ?? true,
          enabled: c.enabled ?? true,
          properties: c.properties || {},
        })),
      }
      return JSON.stringify(formData, null, 2)
    } catch {
      return diskContent
    }
  }

  const syncSidebarByLanguage = useCallback((language?: string) => {
    if (!language) return
    if (language === 'efw') onSidebarTab?.('property')
    else onSidebarTab?.('project')
  }, [onSidebarTab])

  const normalizeIncomingTab = (tab: EditorTab): EditorTab => {
    if (!isEycSourceLanguage(tab.language)) return tab
    return {
      ...tab,
      value: eycToInternalFormat(tab.value),
      savedValue: eycToInternalFormat(tab.savedValue),
    }
  }

  const isTabModified = (tab: EditorTab): boolean => getTabPersistContent(tab) !== tab.savedValue

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  const saveTabAs = useCallback(async (tabId: string): Promise<string | null> => {
    const tab = tabsRef.current.find(t => t.id === tabId)
    if (!tab) return null

    const defaultFileName = tab.filePath ? getFileNameFromPath(tab.filePath) : tab.label
    const savedPath = await window.api?.file?.saveDialog?.(defaultFileName)
    if (!savedPath) return null

    await saveTabToDisk(tab, savedPath)

    const nextTabId = savedPath
    setTabs(prev => {
      const nextTabs = prev.map(t => {
        if (t.id !== tabId) return t
        const nextLabel = t.language === 'eyc'
          ? resolveEycTabLabel(savedPath, t.value)
          : getFileNameFromPath(savedPath)
        const nextTab = {
          ...t,
          id: nextTabId,
          filePath: savedPath,
          label: nextLabel,
        }
        return { ...nextTab, savedValue: getTabPersistContent(nextTab) }
      })
      onOpenTabsChange?.(nextTabs)
      return nextTabs
    })
    if (activeTabIdRef.current === tabId) {
      setActiveTabId(nextTabId)
    }

    return nextTabId
  }, [onOpenTabsChange, saveTabToDisk])

  // 保存当前文件
  const saveCurrentFile = useCallback(() => {
    void (async () => {
      const currentId = activeTabIdRef.current
      if (!currentId) return
      const tab = tabsRef.current.find(t => t.id === currentId)
      if (!tab) return
      if (!tab.filePath) {
        await saveTabAs(currentId)
        return
      }

      await saveTabToDisk(tab)
      setTabs(prev => {
        const nextTabs = prev.map(t => t.id === currentId ? { ...t, savedValue: getTabPersistContent(t) } : t)
        onOpenTabsChange?.(nextTabs)
        return nextTabs
      })
    })()
  }, [onOpenTabsChange, saveTabAs, saveTabToDisk])

  // 保存所有文件
  const saveAllFiles = useCallback(() => {
    setTabs(prev =>
      prev.map(t => {
        if (t.filePath && isTabModified(t)) {
          void saveTabToDisk(t)
          return { ...t, savedValue: getTabPersistContent(t) }
        }
        return t
      })
    )
  }, [saveTabToDisk])

  const saveProjectFiles = useCallback((projectDir: string) => {
    if (!projectDir) return
    setTabs(prev =>
      prev.map(t => {
        if (!isFileInProjectDir(t.filePath, projectDir) || !isTabModified(t)) return t
        void saveTabToDisk(t)
        return { ...t, savedValue: getTabPersistContent(t) }
      })
    )
  }, [saveTabToDisk])

  const applyExternalFileContent = useCallback(() => {
    setTabs(prev => {
      if (!externalChangePrompt) return prev
      const nextTabs = prev.map(t => {
        if (t.id !== externalChangePrompt.tabId) return t
        if (isEycSourceLanguage(t.language)) {
          const normalized = normalizeIncomingTab({
            ...t,
            value: externalChangePrompt.externalContent,
            savedValue: externalChangePrompt.externalContent,
          })
          return {
            ...t,
            value: normalized.value,
            savedValue: normalized.savedValue,
          }
        }
        if (t.language === 'efw') {
          let parsedForm: DesignForm | undefined = t.formData
          try {
            parsedForm = JSON.parse(externalChangePrompt.externalContent) as DesignForm
          } catch {
            // keep previous formData when external JSON is invalid
          }
          return {
            ...t,
            value: externalChangePrompt.externalContent,
            savedValue: externalChangePrompt.externalContent,
            formData: parsedForm,
          }
        }
        return {
          ...t,
          value: externalChangePrompt.externalContent,
          savedValue: externalChangePrompt.externalContent,
        }
      })
      onOpenTabsChange?.(nextTabs)
      return nextTabs
    })
    setExternalChangePrompt(null)
  }, [externalChangePrompt, onOpenTabsChange])

  const keepIdeContentAndOverwriteExternal = useCallback(async () => {
    const prompt = externalChangePrompt
    if (!prompt) return
    const currentTab = tabsRef.current.find(t => t.id === prompt.tabId)
    if (!currentTab?.filePath) {
      setExternalChangePrompt(null)
      return
    }
    await saveTabToDisk(currentTab)
    setTabs(prev => {
      const nextTabs = prev.map(t => t.id === prompt.tabId ? { ...t, savedValue: getTabPersistContent(t) } : t)
      onOpenTabsChange?.(nextTabs)
      return nextTabs
    })
    setExternalChangePrompt(null)
  }, [externalChangePrompt, onOpenTabsChange, saveTabToDisk])

  // 统一关闭标签逻辑：有改动时先提示保存（保存/不保存/取消）
  const closeTabWithPrompt = useCallback(async (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId)
    if (!tab) return

    let closingTabId = tabId

    if (isTabModified(tab)) {
      const action = await window.api?.dialog?.confirmSaveBeforeClose(tab.label)
      if (action === 'cancel') return
      if (action === 'save') {
        if (tab.filePath) {
          await saveTabToDisk(tab)
        } else {
          const savedTabId = await saveTabAs(tab.id)
          if (!savedTabId) return
          closingTabId = savedTabId
        }
      }
    }

    setTabs(prev => {
      const closingTab = prev.find(t => t.id === closingTabId)
      const updatedPrev = (closingTab && isTabModified(closingTab))
        ? prev.map(t => {
          if (t.id !== closingTabId) return t
          return { ...t, savedValue: getTabPersistContent(t) }
        })
        : prev

      const newTabs = updatedPrev.filter(t => t.id !== closingTabId)
      if (newTabs.length === 0) {
        setActiveTabId(null)
      } else if (activeTabId === closingTabId) {
        const idx = updatedPrev.findIndex(t => t.id === closingTabId)
        const newActive = newTabs[Math.min(idx, newTabs.length - 1)]
        setActiveTabId(newActive.id)
      }
      onOpenTabsChange?.(newTabs)
      setEycFallbackTabs(prevFallback => {
        if (!prevFallback[closingTabId]) return prevFallback
        const next = { ...prevFallback }
        delete next[closingTabId]
        return next
      })
      setEycEditorModeTabs(prevModes => {
        if (!prevModes[closingTabId]) return prevModes
        const next = { ...prevModes }
        delete next[closingTabId]
        return next
      })
      return newTabs
    })
  }, [tabs, activeTabId, onOpenTabsChange, saveTabAs, saveTabToDisk])

  // 关闭当前标签页
  const closeActiveFile = useCallback(() => {
    if (!activeTabId) return
    void closeTabWithPrompt(activeTabId)
  }, [activeTabId, closeTabWithPrompt])

  // 清空全部标签（用于关闭项目）
  const clearAllTabs = useCallback(() => {
    setTabs([])
    setActiveTabId(null)
    setEycFallbackTabs({})
    setEycEditorModeTabs({})
    onOpenTabsChange?.([])
  }, [onOpenTabsChange])

  const closeProjectTabs = useCallback((projectDir: string) => {
    if (!projectDir) return
    setTabs(prev => {
      const filtered = prev.filter(t => !isFileInProjectDir(t.filePath, projectDir))
      onOpenTabsChange?.(filtered)
      setEycFallbackTabs(prevFallback => {
        const next: Record<string, true> = {}
        for (const [tabId, enabled] of Object.entries(prevFallback)) {
          const tab = filtered.find(item => item.id === tabId)
          if (!tab || !enabled) continue
          next[tabId] = true
        }
        return next
      })
      setEycEditorModeTabs(prevModes => {
        const next: Record<string, EycEditorMode> = {}
        for (const [tabId, mode] of Object.entries(prevModes)) {
          if (!filtered.some(item => item.id === tabId)) continue
          next[tabId] = mode
        }
        return next
      })

      if (filtered.length === 0) {
        setActiveTabId(null)
      } else if (activeTabId && !filtered.some(t => t.id === activeTabId)) {
        setActiveTabId(filtered[0].id)
      }

      return filtered
    })
  }, [activeTabId, onOpenTabsChange])

  // 磁盘级重命名：更新项目中未打开的 .eyc 文件
  // 磁盘级重命名：更新项目中未打开的 .eyc 文件（仅控件改名使用）
  const renameDiskFiles = useCallback(async (openFilePaths: Set<string>, pattern: string, replacement: string) => {
    if (!projectDir) return
    const dirFiles = await window.api?.file?.readDir(projectDir)
    if (!dirFiles) return
    const eycFiles = (dirFiles as string[]).filter(f => f.toLowerCase().endsWith('.eyc'))
    for (const fileName of eycFiles) {
      const filePath = projectDir + '\\' + fileName
      if (openFilePaths.has(filePath)) continue // 已在标签页中修改过
      const content = await window.api?.project?.readFile(filePath)
      if (!content || !content.includes(pattern)) continue
      const newContent = content.split(pattern).join(replacement)
      await window.api?.file?.save(filePath, newContent)
    }
  }, [projectDir])

  // 窗口重命名：更新 .eyc 内容中所有引用模式。
  // 命名约定（与编译器/双击窗体生成一致）：**程序集名**用剥前导下划线的核心名（_启动窗口 →
  // 窗口程序集_启动窗口，前导下划线兼作分隔符，直接拼原名会得到双下划线匹配不上）；
  // **窗口事件名**用原始名（_启动窗口 的事件是「__启动窗口_创建完毕」，双下划线合法）；
  // 跨窗口成员引用（旧名.）用原始名。与 App 粘贴窗口、主进程 renameWindow 的规则一致。
  const applyWindowRenameToContent = (content: string, oldName: string, newName: string, forceAssemblyName = false): string => {
    const oldCore = oldName.replace(/^_+/, '')
    const newCore = newName.replace(/^_+/, '')
    let result = content
    // 程序集名：窗口程序集_旧核心名 → 窗口程序集_新核心名
    result = result.split('窗口程序集_' + oldCore).join('窗口程序集_' + newCore)
    // 兼容旧规则：若程序集名仍是“旧窗口名”，迁移为“窗口程序集_新窗口名”
    if (forceAssemblyName) {
      const escapedOldName = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const escapedOldCore = oldCore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const assemblyLineRe = new RegExp(
        '^(\\s*\\.程序集\\s+)(窗口程序集_' + escapedOldCore + '|' + escapedOldName + ')(?=\\s|,|$)',
        'm'
      )
      result = result.replace(assemblyLineRe, '$1窗口程序集_' + newCore)
    }
    // 事件引用：_原始旧名_ → _原始新名_（_启动窗口 → __启动窗口_创建完毕 的双下划线由此而来）
    result = result.split('_' + oldName + '_').join('_' + newName + '_')
    // 跨窗口引用：旧名.控件名.属性 或 旧名._事件
    result = result.split(oldName + '.').join(newName + '.')
    return result
  }

  // 类名重命名：按标识符边界替换项目源码中的类名引用
  const applyClassRenameToContent = useCallback((content: string, oldName: string, newName: string): string => {
    if (!content.includes(oldName)) return content
    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(
      '(?<=[^\\u4e00-\\u9fa5A-Za-z0-9_.]|^)' + escaped + '(?=[^\\u4e00-\\u9fa5A-Za-z0-9_.]|$)',
      'g'
    )
    return content.replace(regex, newName)
  }, [])

  // 类模块名重命名：同步更新标签、文件名、项目引用
  const handleClassModuleNameRename = useCallback((oldName: string, newName: string) => {
    setTabs(prev => {
      if (!projectDir) return prev
      const current = prev.find(t => t.id === activeTabId)
      if (!current || !current.filePath || !current.label.toLowerCase().endsWith('.ecc')) return prev
      const oldFilePath = current.filePath
      const oldFileName = oldFilePath.split(/[\\/]/).pop() || ''
      const expectedOldFileName = oldName + '.ecc'
      if (oldFileName.toLowerCase() !== expectedOldFileName.toLowerCase()) return prev
      const newFileName = newName + '.ecc'
      if (!newName || newFileName.toLowerCase() === oldFileName.toLowerCase()) return prev
      const dir = oldFilePath.replace(/[\\/][^\\/]+$/, '')
      const newFilePath = (dir ? dir + '\\' : '') + newFileName

      const sourceLangSet = new Set(['eyc', 'egv', 'ecs', 'edt', 'ell', 'erc'])
      const openSourcePaths: string[] = []

      const updatedTabs = prev.map(t => {
        let next = t
        const isSource = sourceLangSet.has(t.language)
        if (isSource && t.filePath) openSourcePaths.push(t.filePath)
        if (isSource && t.value.includes(oldName)) {
          const replaced = applyClassRenameToContent(t.value, oldName, newName)
          if (replaced !== t.value) next = { ...next, value: replaced }
        }
        if (t.filePath && t.filePath.toLowerCase() === oldFilePath.toLowerCase()) {
          next = { ...next, id: newFilePath, label: newFileName, filePath: newFilePath }
        }
        return next
      })

      setTimeout(() => {
        setActiveTabId(newFilePath)
        onOpenTabsChange?.(updatedTabs)
      }, 0)

      const prevTabs = prev
      const openPathsForIpc = openSourcePaths.map(p => p.toLowerCase() === oldFilePath.toLowerCase() ? newFilePath : p)
      ;(async () => {
        try {
          const result = await window.api?.project?.renameClassModule(projectDir, oldFileName, newFileName, oldName, newName, openPathsForIpc)
          if (!result || !result.success) {
            setTabs(prevTabs)
            setActiveTabId(oldFilePath)
            onOpenTabsChange?.(prevTabs)
            if (result?.reason === 'exists') {
              window.alert('类模块重命名失败：目标文件“' + newFileName + '”已存在，请使用其他类名。')
            } else {
              const msg = result && 'message' in result ? result.message : '未知错误'
              window.alert('类模块重命名失败，已回滚：' + msg)
            }
            return
          }
          onProjectTreeRefresh?.()
        } catch (error) {
          setTabs(prevTabs)
          setActiveTabId(oldFilePath)
          onOpenTabsChange?.(prevTabs)
          const msg = error instanceof Error ? error.message : String(error)
          window.alert('类模块重命名失败，已回滚：' + msg)
        }
      })()

      return updatedTabs
    })
  }, [activeTabId, applyClassRenameToContent, onOpenTabsChange, onProjectTreeRefresh, projectDir])

  // 属性面板修改属性值 → 更新 formData 和 selection
  const updateFormProperty = useCallback((targetKind: 'form' | 'control', controlId: string | null, propName: string, value: string | number | boolean, forTabId?: string) => {
    const activeId = forTabId ?? activeTabId
    // 改名（__name__）记入全局撤销栈：撤销=反向改名（见 applyRename）。放在 setTabs 外，
    // 从 tabsRef 取当前旧名，避免在 reducer 里读状态。
    if (propName === '__name__' && !isApplyingUndoRef.current && activeId) {
      const curForm = tabsRef.current.find(t => t.id === activeId)?.formData
      if (curForm) {
        const oldNm = targetKind === 'form' ? curForm.name : (curForm.controls.find(c => c.id === controlId)?.name ?? '')
        const newNm = String(value)
        if (oldNm && oldNm !== newNm) {
          recordRename({ targetKind, controlId, formName: curForm.name, oldName: oldNm, newName: newNm })
        }
      }
    }
    setTabs(prev => {
      const tab = prev.find(t => t.id === activeId)
      if (!tab || !tab.formData) return prev
      const form = tab.formData

      let newForm: DesignForm
      let updatedTabs = prev

      if (targetKind === 'form') {
        if (propName === '__name__') {
          const oldName = form.name
          const newName = String(value)
          const newSourceFile = newName + '.eyc'
          newForm = { ...form, name: newName, sourceFile: newSourceFile }

          // 计算新旧文件路径
          const oldEfwPath = tab.filePath
          const efwDir = oldEfwPath ? oldEfwPath.replace(/[/\\][^/\\]+$/, '') : projectDir
          const newEfwPath = efwDir ? joinPathByBaseDir(efwDir, newName + '.efw') : undefined
          const oldEycPath = efwDir
            ? joinPathByBaseDir(efwDir, form.sourceFile || oldName + '.eyc')
            : undefined
          const newEycPath = efwDir ? joinPathByBaseDir(efwDir, newName + '.eyc') : undefined

          // 更新所有 .eyc 标签页中的内容引用
          const openEycPaths: string[] = []
          updatedTabs = prev.map(t => {
            if (t.language === 'eyc') {
              if (t.filePath) openEycPaths.push(t.filePath)
              if (t.value.includes(oldName)) {
                const newValue = applyWindowRenameToContent(t.value, oldName, newName, !!oldEycPath && !!t.filePath && t.filePath === oldEycPath)
                // 若是当前窗口关联的 .eyc 标签页，同时更新路径
                if (oldEycPath && t.filePath === oldEycPath && newEycPath) {
                  return { ...t, id: newEycPath, label: resolveEycTabLabel(newEycPath, newValue), filePath: newEycPath, value: newValue }
                }
                return { ...t, value: newValue }
              }
              // 即使内容未命中旧名，也要确保当前窗口关联 .eyc 的程序集名规则迁移并更新路径
              if (oldEycPath && t.filePath === oldEycPath && newEycPath) {
                const normalizedValue = applyWindowRenameToContent(t.value, oldName, newName, true)
                return { ...t, id: newEycPath, label: resolveEycTabLabel(newEycPath, normalizedValue), filePath: newEycPath, value: normalizedValue }
              }
            }
            return t
          })

          // 更新当前 .efw 标签页的路径和标签
          if (newEfwPath) {
            updatedTabs = updatedTabs.map(t =>
              t.id === activeId
                ? { ...t, id: newEfwPath, label: newName + '.efw', filePath: newEfwPath, formData: newForm }
                : t
            )
            // 更新 activeTabId（异步，在 setTabs 后执行）
            setTimeout(() => setActiveTabId(newEfwPath), 0)
          }

          // 异步：磁盘文件重命名 + 更新未打开的 .eyc + 更新 .epp + 刷新项目树
          if (projectDir) {
            // 通知标签变化以保存新路径
            setTimeout(() => onOpenTabsChange?.(updatedTabs), 0)
            ;(async () => {
              await window.api?.project?.renameWindow(projectDir, oldName, newName, openEycPaths)
              onProjectTreeRefresh?.()
            })()
          }
        } else {
          const fieldMap: Record<string, string> = { '宽度': 'width', '高度': 'height', '标题': 'title' }
          const field = fieldMap[propName]
          if (field) {
            newForm = { ...form, [field]: value }
          } else {
            // 其他属性（如逻辑型、枚举型等）存入 properties
            newForm = { ...form, properties: { ...form.properties, [propName]: value } }
          }
        }
        onSelectControl?.({ kind: 'form', form: newForm })
      } else {
        const fieldMap: Record<string, string> = {
          '左边': 'left',
          '顶边': 'top',
          '宽度': 'width',
          '高度': 'height',
          '标题': 'text',
          '内容': 'text',
          '文本': 'text',
        }
        const boolMap: Record<string, { field: string; invert?: boolean }> = {
          '可视': { field: 'visible' },
          '禁止': { field: 'enabled', invert: true },
        }
        const field = fieldMap[propName]
        const boolDef = boolMap[propName]
        newForm = {
          ...form,
          controls: form.controls.map(c => {
            if (c.id !== controlId) return c
            if (propName === '__name__') {
              return { ...c, name: String(value) }
            }
            if (field) {
              return { ...c, [field]: value }
            }
            if (boolDef) {
              return { ...c, [boolDef.field]: boolDef.invert ? !value : value }
            }
            // 「字体」内的文本颜色 ↔ 独立「文本颜色」属性双向同步（二者代表同一文本色；运行时多数控件用独立
            // 「文本颜色」上色而字体对话框只显示 font.color——不同步则所见≠所得）。仅同时具备两者的控件类型生效。
            if (FONT_TEXTCOLOR_SYNC_TYPES.has(c.type) && (propName === '字体' || propName === '文本颜色')) {
              const next = { ...c.properties, [propName]: value }
              if (propName === '字体') {
                const newFont = parseFontSpec(typeof value === 'string' ? value : '')
                // 清除整个字体（值为空/不可解析）不改文本颜色（清字体≠清颜色，避免抹掉用户独立设的文本色）。
                if (newFont) {
                  // 仅当 font.color 相对旧值真的变了才镜像（改字族/字号/粗体不应重置文本颜色）。
                  const oldFc = parseFontSpec(typeof c.properties['字体'] === 'string' ? (c.properties['字体'] as string) : '')?.color
                  if (newFont.color !== oldFc) next['文本颜色'] = typeof newFont.color === 'number' ? newFont.color : 0  // undefined=默认→0(黑)
                }
              } else {
                // 独立文本颜色变了 → 写回已有字体的 font.color（0=默认→undefined，非 0=显式色）。
                // 无字体的控件不凭空建字体（避免把系统默认字体锁成宋体9改变外观）——此时独立文本颜色即权威，codegen 也读它。
                const curFont = parseFontSpec(typeof c.properties['字体'] === 'string' ? (c.properties['字体'] as string) : '')
                if (curFont) {
                  const tc = Number(value)
                  next['字体'] = stringifyFontSpec({ ...curFont, color: tc === 0 ? undefined : tc })
                }
              }
              return { ...c, properties: next }
            }
            return { ...c, properties: { ...c.properties, [propName]: value } }
          })
        }
        // 控件改名：更新 .eyc 标签页中的引用
        if (propName === '__name__') {
          const oldCtrl = form.controls.find(c => c.id === controlId)
          if (oldCtrl) {
            const oldName = oldCtrl.name
            const newName = String(value)
            const openEycPaths = new Set<string>()
            updatedTabs = prev.map(t => {
              if (t.language === 'eyc') {
                if (t.filePath) openEycPaths.add(t.filePath)
                if (t.value.includes(oldName)) {
                  const newValue = t.value.split(oldName + '_').join(newName + '_')
                  return { ...t, value: newValue }
                }
              }
              return t
            })
            // 异步更新磁盘上未打开的 .eyc 文件
            renameDiskFiles(openEycPaths, oldName + '_', newName + '_')
          }
        }
        const updatedCtrl = newForm.controls.find(c => c.id === controlId)
        if (updatedCtrl) onSelectControl?.({ kind: 'control', control: updatedCtrl, form: newForm })
      }

      // 对窗口改名的情况，formData 已在上面处理过，不再覆盖
      if (targetKind === 'form' && propName === '__name__') {
        return updatedTabs
      }
      // 记入全局撤销栈：属性面板的普通属性改动一并可撤销；改名（__name__）已在函数开头
      // 用 recordRename 记为「反向改名」型撤销，这里不再重复记录。
      if (activeId && propName !== '__name__') {
        recordUndo(activeId, 'formData', form, newForm)
      }
      return updatedTabs.map(t => t.id === activeId ? { ...t, formData: newForm } : t)
    })
  }, [activeTabId, onSelectControl, renameDiskFiles, projectDir, onProjectTreeRefresh, onOpenTabsChange, recordUndo, recordRename])
  // 把最新的 updateFormProperty 暴露给 applyRename（打破声明顺序环，见上方 updateFormPropertyRef）
  updateFormPropertyRef.current = updateFormProperty

  // 属性面板事件栏 → 跳转到或创建指定事件的子程序
  const navigateToEventSub = useCallback(async (
    sel: SelectionTarget,
    eventName: string,
    eventArgs: Array<{ name: string; description: string; dataType: string; isByRef: boolean }>
  ) => {
    if (!sel) return
    const form = sel.form
    const efwTab = tabs.find(t => t.language === 'efw' && t.formData?.name === form.name)
    if (!efwTab || !efwTab.filePath) return
    const efwDir = efwTab.filePath.replace(/[/\\][^/\\]+$/, '')
    const eycPath = form.sourceFile
      ? joinPathByBaseDir(efwDir, form.sourceFile)
      : efwTab.filePath.replace(/\.efw$/i, '.eyc')
    let subName: string
    if (sel.kind === 'form') {
      subName = `_${form.name}_${eventName}`
    } else {
      subName = buildEventSubName(sel.control.name, eventName)
    }
    const params = eventArgs.map(arg => ({
      name: arg.name || 'param',
      dataType: arg.dataType || '整数型',
      isByRef: arg.isByRef ?? false,
    }))
    const existingTab = tabs.find(t => t.filePath === eycPath)
    if (existingTab) {
      if (existingTab.id === activeTabId) {
        eycEditorRef.current?.navigateOrCreateSub(subName, params)
      } else {
        pendingNavigateRef.current = { kind: 'create-or-open', subName, params }
        setActiveTabId(existingTab.id)
      }
    } else {
      const content = await window.api?.project?.readFile(eycPath)
      if (content === null || content === undefined) return
      const newTab: EditorTab = {
        id: eycPath, label: resolveEycTabLabel(eycPath, content), language: 'eyc',
        value: content, savedValue: content, filePath: eycPath,
      }
      setTabs(prev => {
        const merged = [...prev, newTab]
        onOpenTabsChange?.(merged)
        return merged
      })
      pendingNavigateRef.current = { kind: 'create-or-open', subName, params }
      setActiveTabId(eycPath)
    }
  }, [tabs, activeTabId, buildEventSubName, onOpenTabsChange])

  // 清除 diff 高亮装饰
  const clearDiffDecorations = useCallback(() => {
    if (diffDecorationsRef.current) {
      diffDecorationsRef.current.clear()
      diffDecorationsRef.current = null
    }
    const ed = editorRef.current
    if (ed && diffViewZoneIdsRef.current.length > 0) {
      ed.changeViewZones((accessor) => {
        for (const id of diffViewZoneIdsRef.current) {
          accessor.removeZone(id)
        }
      })
      diffViewZoneIdsRef.current = []
    }
  }, [])

  // 应用 diff 高亮装饰（绿色新增行 + 红色删除行 ViewZone）
  const applyDiffDecorations = useCallback((diffInfo: DiffLineInfo) => {
    clearDiffDecorations()
    const ed = editorRef.current
    const monaco = monacoRef.current
    if (!ed || !monaco) return

    // 新增行装饰（绿色背景）
    const decorations: editor.IModelDeltaDecoration[] = diffInfo.addedLines.map((lineNum) => ({
      range: new monaco.Range(lineNum, 1, lineNum, 1),
      options: {
        isWholeLine: true,
        className: 'ai-diff-added-line',
        glyphMarginClassName: 'ai-diff-added-glyph',
        overviewRuler: {
          color: 'rgba(40, 167, 69, 0.6)',
          position: monaco.editor.OverviewRulerLane.Left,
        },
      },
    }))

    diffDecorationsRef.current = ed.createDecorationsCollection(decorations)

    // 删除行 ViewZone（红色背景区域）
    if (diffInfo.deletedGroups.length > 0) {
      ed.changeViewZones((accessor) => {
        const ids: string[] = []
        for (const group of diffInfo.deletedGroups) {
          const deletedLines = group.text.split('\n')
          const domNode = document.createElement('div')
          domNode.className = 'ai-diff-deleted-zone'
          for (const line of deletedLines) {
            const lineDiv = document.createElement('div')
            lineDiv.className = 'ai-diff-deleted-line'
            lineDiv.textContent = line || '\u00a0'
            domNode.appendChild(lineDiv)
          }
          const id = accessor.addZone({
            afterLineNumber: group.afterLine,
            heightInLines: deletedLines.length,
            domNode,
          })
          ids.push(id)
        }
        diffViewZoneIdsRef.current = ids
      })
    }

    // 滚动到第一个变更位置
    const firstChanged = diffInfo.addedLines[0] ?? diffInfo.deletedGroups[0]?.afterLine
    if (firstChanged) {
      ed.revealLineInCenter(firstChanged)
    }
  }, [clearDiffDecorations])

  // 追加 diff 装饰（不清除已有的）
  const appendDiffDecorations = useCallback((diffInfo: DiffLineInfo) => {
    const ed = editorRef.current
    const monaco = monacoRef.current
    if (!ed || !monaco) return

    const decorations: editor.IModelDeltaDecoration[] = diffInfo.addedLines.map((lineNum) => ({
      range: new monaco.Range(lineNum, 1, lineNum, 1),
      options: {
        isWholeLine: true,
        className: 'ai-diff-added-line',
        glyphMarginClassName: 'ai-diff-added-glyph',
        overviewRuler: {
          color: 'rgba(40, 167, 69, 0.6)',
          position: monaco.editor.OverviewRulerLane.Left,
        },
      },
    }))

    const newCollection = ed.createDecorationsCollection(decorations)
    // 合并旧 collection 和新 collection：取旧的 ranges 重新创建统一 collection
    if (diffDecorationsRef.current) {
      const oldRanges = diffDecorationsRef.current.getRanges()
      const oldDecorations: editor.IModelDeltaDecoration[] = oldRanges.map((r) => ({
        range: r,
        options: {
          isWholeLine: true,
          className: 'ai-diff-added-line',
          glyphMarginClassName: 'ai-diff-added-glyph',
          overviewRuler: {
            color: 'rgba(40, 167, 69, 0.6)',
            position: monaco.editor.OverviewRulerLane.Left,
          },
        },
      }))
      diffDecorationsRef.current.clear()
      newCollection.clear()
      diffDecorationsRef.current = ed.createDecorationsCollection([...oldDecorations, ...decorations])
    } else {
      diffDecorationsRef.current = newCollection
    }

    // 追加 ViewZone
    if (diffInfo.deletedGroups.length > 0) {
      ed.changeViewZones((accessor) => {
        const ids: string[] = [...diffViewZoneIdsRef.current]
        for (const group of diffInfo.deletedGroups) {
          const deletedLines = group.text.split('\n')
          const domNode = document.createElement('div')
          domNode.className = 'ai-diff-deleted-zone'
          for (const line of deletedLines) {
            const lineDiv = document.createElement('div')
            lineDiv.className = 'ai-diff-deleted-line'
            lineDiv.textContent = line || '\u00a0'
            domNode.appendChild(lineDiv)
          }
          const id = accessor.addZone({
            afterLineNumber: group.afterLine,
            heightInLines: deletedLines.length,
            domNode,
          })
          ids.push(id)
        }
        diffViewZoneIdsRef.current = ids
      })
    }

    const firstChanged = diffInfo.addedLines[0] ?? diffInfo.deletedGroups[0]?.afterLine
    if (firstChanged) {
      ed.revealLineInCenter(firstChanged)
    }
  }, [])

  // 编辑器内容变化时自动清除 diff 高亮
  useEffect(() => {
    const ed = editorRef.current
    if (!ed) return
    const disposable = ed.onDidChangeModelContent(() => {
      clearDiffDecorations()
    })
    return () => disposable.dispose()
  }, [clearDiffDecorations, activeTabId])

  // 暴露给父组件的方法
  useImperativeHandle(ref, () => ({
    save: saveCurrentFile,
    saveAs: () => {
      const currentId = activeTabIdRef.current
      if (!currentId) return
      void saveTabAs(currentId)
    },
    saveAll: saveAllFiles,
    saveProject: saveProjectFiles,
    closeActiveTab: closeActiveFile,
    closeProjectTabs,
    closeFileTab: (fileIdOrPath: string) => {
      const normalize = (text: string): string => (text || '').replace(/\//g, '\\').toLowerCase()
      const target = normalize(fileIdOrPath)
      if (!target) return
      setTabs(prev => {
        const filtered = prev.filter(t => normalize(t.id) !== target && normalize(t.filePath || '') !== target)
        if (filtered.length === prev.length) return prev
        onOpenTabsChange?.(filtered)
        if (filtered.length === 0) {
          setActiveTabId(null)
        } else if (activeTabId && !filtered.some(t => t.id === activeTabId)) {
          setActiveTabId(filtered[0].id)
        }
        return filtered
      })
    },
    clearAllTabs,
    hasModifiedTabs: () => tabs.some(t => isTabModified(t)),
    editorAction: (action: string) => {
      if (action === 'navBack') { navigateBackRef.current?.(); return } // 「跳回先前位置」(Ctrl+J)，全局可用
      const active = tabs.find(t => t.id === activeTabId)
      const activeIsEycSource = !!active && isEycSourceLanguage(active.language)
      const activeIsTableMode = !!active && activeIsEycSource
        && (eycEditorModeTabs[active.id] || 'table') === 'table'
        && !eycFallbackTabs[active.id]

      // 撤销/重做：表格代码编辑器与可视化设计器统一走全局栈（Monaco 文本模式仍用自身 undo）
      if (action === 'undo' || action === 'redo') {
        const activeIsDesigner = active?.language === 'efw'
        if (activeIsTableMode || activeIsDesigner) {
          if (action === 'undo') globalUndo()
          else globalRedo()
          return
        }
      }

      if (activeIsTableMode) {
        eycEditorRef.current?.editorAction(action)
        return
      }

      if (action === 'paste' && (activeIsEycSource || active?.language === 'efw')) {
        void handleCommandPaste()
        return
      }

      const ed = editorRef.current
      if (!ed) return
      switch (action) {
        case 'undo': ed.trigger('menu', 'undo', null); break
        case 'redo': ed.trigger('menu', 'redo', null); break
        case 'cut': ed.trigger('menu', 'editor.action.clipboardCutAction', null); break
        case 'copy': ed.trigger('menu', 'editor.action.clipboardCopyAction', null); break
        case 'paste': ed.trigger('menu', 'editor.action.clipboardPasteAction', null); break
        case 'delete': ed.trigger('menu', 'deleteRight', null); break
        case 'selectAll': ed.trigger('menu', 'editor.action.selectAll', null); break
        case 'find': ed.trigger('menu', 'actions.find', null); break
        case 'replace': ed.trigger('menu', 'editor.action.startFindReplaceAction', null); break
      }
    },
    getEditorFiles: () => {
      const files: Record<string, string> = {}
      for (const t of tabs) {
        const fileName = t.filePath?.replace(/^.*[\\/]/, '') || t.label
        if (t.language === 'efw' && t.formData) {
          files[fileName] = JSON.stringify(t.formData, null, 2)
        } else if (t.language === 'eyc' || t.language === 'egv' || t.language === 'ecs' || t.language === 'edt' || t.language === 'ell' || t.language === 'erc') {
          files[fileName] = eycToYiFormat(t.value)
        } else {
          files[fileName] = t.value
        }
      }
      return files
    },
    sweepProjectDiagnostics: async () => {
      // 编译前全项目诊断扫描：项目全部源文件（含未打开的）跑问题面板同款诊断。
      // 打开的文件用标签页最新内容（含未保存修改），未打开的读盘；关联窗口控件
      // 同样按「打开的 efw 用最新 formData、未打开的读盘解析」取得。
      if (!projectDir) return []
      try {
        const dirFiles = (await window.api?.file?.readDir(projectDir)) as string[] | undefined
        const eppFile = dirFiles?.find(f => f.toLowerCase().endsWith('.epp'))
        if (!eppFile) return []
        const eppInfo = await window.api?.project?.parseEpp(joinPathByBaseDir(projectDir, eppFile)) as
          { files?: Array<{ type: string; fileName: string }> } | null
        if (!eppInfo?.files?.length) return []

        const rawCmds = await window.api.library.getAllCommands(targetPlatform).catch(() => [])
        const { independentItems } = buildCompletionCatalog(rawCmds || [])

        const tabByName = new Map<string, EditorTab>()
        for (const t of tabs) {
          const base = ((t.filePath?.split(/[\\/]/).pop()) || t.label || '').toLowerCase()
          if (base && !tabByName.has(base)) tabByName.set(base, t)
        }
        const readDiskText = async (fileName: string): Promise<string> =>
          (await window.api?.project?.readFile(joinPathByBaseDir(projectDir, fileName))) || ''

        const forms: Array<{ sourceFile: string; controls: SweepWindowControl[] }> = []
        for (const f of eppInfo.files) {
          if (f.type !== 'EFW') continue
          const tab = tabByName.get(f.fileName.toLowerCase())
          let fd = tab?.formData || null
          if (!fd) {
            try { fd = JSON.parse(await readDiskText(f.fileName)) as typeof fd } catch { fd = null }
          }
          if (!fd?.name) continue
          forms.push({
            sourceFile: (fd.sourceFile || `${fd.name}.eyc`).toLowerCase(),
            controls: [
              { name: fd.name, type: '窗口' },
              ...(fd.controls || []).map(c => ({ name: c.name, type: c.type, properties: c.properties })),
            ],
          })
        }

        const globalNames = projectGlobalVars.map(v => v.name)
        const dllItems = projectDllCommands.map(c => ({
          name: c.name,
          returnType: c.returnType,
          params: (c.params || []).map(p => ({ name: p.name, type: p.type, optional: p.optional, isArray: p.isArray })),
        }))

        const out: Array<{ file: string; problems: EditorDiagnosticsProblem[] }> = []
        for (const f of eppInfo.files) {
          if (f.type !== 'EYC' && f.type !== 'EGV' && f.type !== 'ECS' && f.type !== 'EDT' && f.type !== 'ELL') continue
          const tab = tabByName.get(f.fileName.toLowerCase())
          // 未打开的文件读盘后按打开同款转换成编辑器内部格式，保证诊断输入与面板一致
          const text = tab ? tab.value : eycToInternalFormat(await readDiskText(f.fileName))
          if (!text) continue
          const form = forms.find(fm => fm.sourceFile === f.fileName.toLowerCase())
          const problems = sweepFileDiagnostics({
            text,
            catalogCommands: independentItems,
            dllCommands: dllItems,
            projectGlobalVarNames: globalNames,
            windowControls: form?.controls || [],
            windowUnits,
          }).filter(p => p.severity === 'error')
          if (problems.length) out.push({ file: f.fileName, problems })
        }
        return out
      } catch {
        return []
      }
    },
    openFile: (tab: EditorTab) => {
      const incoming = normalizeIncomingTab(tab)
      setTabs(prev => {
        if (prev.some(t => t.id === incoming.id)) {
          setActiveTabId(incoming.id)
          return prev
        }
        const merged = [...prev, incoming]
        onOpenTabsChange?.(merged)
        setActiveTabId(incoming.id)
        return merged
      })
      syncSidebarByLanguage(incoming.language)
    },
    upsertFile: (tab: EditorTab) => {
      const incoming = normalizeIncomingTab(tab)
      setTabs(prev => {
        const idx = prev.findIndex(t => t.id === incoming.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = {
            ...next[idx],
            ...incoming,
          }
          onOpenTabsChange?.(next)
          setActiveTabId(incoming.id)
          return next
        }
        const merged = [...prev, incoming]
        onOpenTabsChange?.(merged)
        setActiveTabId(incoming.id)
        return merged
      })
      syncSidebarByLanguage(incoming.language)
    },
    applyDiffHighlight: (_tabId: string, diffInfo: DiffLineInfo) => {
      const active = tabs.find(t => t.id === activeTabId)
      const isEycLang = active && ['eyc', 'egv', 'ecs', 'edt', 'ell', 'erc'].includes(active.language)
      if (isEycLang) {
        // EycTableEditor: split diff markers into added/edited/deleted lanes for minimap rendering.
        const incomingAdded = new Set<number>(diffInfo.addedLines.map(l => l - 1))
        const incomingDeletedAfter = new Set<number>(
          diffInfo.deletedGroups
            .map(g => Math.max(g.afterLine - 1, 0))
            .filter(line => Number.isInteger(line) && line >= 0),
        )
        // 在同一次 hunk 内，若新增行与删除锚点相邻（|Δ|≤1）视为"变更"而非"新增"。
        // 但 applyDiffHighlight 是按 hunk 流式下发的，add 与 delete 可能分多次到达，
        // 因此在 setter 内以累计状态（prev + incoming）交叉判定，并在 added 与 edited 之间迁移。
        const NEAR = 1
        const isNear = (a: number, b: number): boolean => Math.abs(a - b) <= NEAR

        setTimeout(() => {
          // 先合并 deletedAfter，并拿到合并后的完整集合（用于判定 added 是否应改为 edited）
          let mergedDeletedAfter: Set<number> = new Set(incomingDeletedAfter)
          setEycDiffDeletedAfterLines(prev => {
            mergedDeletedAfter = new Set(prev)
            for (const line of incomingDeletedAfter) mergedDeletedAfter.add(line)
            return mergedDeletedAfter
          })
          // 记录各锚点被删除的原文（同锚点分多个 hunk 到达时拼接）
          setEycDiffDeletedTextAfterLines(prev => {
            const merged = new Map(prev)
            for (const group of diffInfo.deletedGroups) {
              const anchor = Math.max(group.afterLine - 1, 0)
              if (!Number.isInteger(anchor) || anchor < 0) continue
              const text = group.text || ''
              if (!text) continue
              const existing = merged.get(anchor)
              merged.set(anchor, existing ? `${existing}\n${text}` : text)
            }
            return merged
          })
          // 再据此计算 added 的最终集合：排除相邻 deletedAnchor 的行
          const promotedFromAdded = new Set<number>()
          setEycDiffAddedLines(prev => {
            const next = new Set<number>()
            // a) 旧 added 中与本次或历史 deletedAnchor 相邻的，迁出到 edited
            for (const a of prev) {
              let near = false
              for (const d of mergedDeletedAfter) { if (isNear(a, d)) { near = true; break } }
              if (near) promotedFromAdded.add(a)
              else next.add(a)
            }
            // b) 本次 incomingAdded：相邻任何（历史或本次）deletedAnchor 则走 edited
            for (const a of incomingAdded) {
              let near = false
              for (const d of mergedDeletedAfter) { if (isNear(a, d)) { near = true; break } }
              if (near) promotedFromAdded.add(a)
              else next.add(a)
            }
            return next
          })
          setEycDiffEditedLines(prev => {
            const merged = new Set(prev)
            for (const line of promotedFromAdded) merged.add(line)
            return merged
          })
          setEycDiffHighlightLines(prev => {
            const merged = new Set(prev)
            for (const line of incomingAdded) merged.add(line)
            for (const line of promotedFromAdded) merged.add(line)
            return merged
          })
        }, 60)
      } else {
        // Monaco: append decorations to existing ones
        setTimeout(() => appendDiffDecorations(diffInfo), 60)
      }
    },
    clearDiffHighlight: () => {
      clearDiffDecorations()
      setEycDiffHighlightLines(new Set())
      setEycDiffAddedLines(new Set())
      setEycDiffEditedLines(new Set())
      setEycDiffDeletedAfterLines(new Set())
      setEycDiffDeletedTextAfterLines(new Map())
    },
    insertDeclaration: () => {
      eycEditorRef.current?.insertSubroutine()
    },
    insertLocalVariable: () => {
      eycEditorRef.current?.insertLocalVariable()
    },
    insertConstant: () => {
      eycEditorRef.current?.insertConstant()
    },
    navigateToLine: (line: number) => {
      eycEditorRef.current?.navigateToLine(line)
    },
    navigateToSubprogram: (subName: string, fallbackLine?: number) => {
      const active = tabs.find(t => t.id === activeTabId)
      const activeIsSource = !!active && isEycSourceLanguage(active.language)
      const activeMode: EycEditorMode = active ? (eycEditorModeTabs[active.id] || 'table') : 'table'
      const fallbackTextMode = !!(active && eycFallbackTabs[active.id])
      const useTextMode = activeMode === 'text' || fallbackTextMode

      if (activeIsSource && !useTextMode && eycEditorRef.current) {
        eycEditorRef.current.navigateToSubprogram(subName, fallbackLine)
        return
      }

      pendingNavigateRef.current = { kind: 'navigate', subName, fallbackLine }

      if (active && activeIsSource && activeMode === 'text' && !fallbackTextMode) {
        setEycEditorModeTabs(prev => {
          if (!prev[active.id]) return prev
          const next = { ...prev }
          delete next[active.id]
          return next
        })
      }
    },
    getVisibleLineForSourceLine: (line: number) => {
      return eycEditorRef.current?.getVisibleLineForSourceLine(line) ?? line
    },
    updateFormProperty,
    navigateToEventSub,
  }), [saveCurrentFile, saveTabAs, saveAllFiles, saveProjectFiles, closeActiveFile, closeProjectTabs, clearAllTabs, tabs, activeTabId, onOpenTabsChange, syncSidebarByLanguage, updateFormProperty, navigateToEventSub, appendDiffDecorations, clearDiffDecorations, setEycDiffHighlightLines, eycEditorModeTabs, eycFallbackTabs, globalUndo, globalRedo, projectDir, targetPlatform, projectGlobalVars, projectDllCommands, windowUnits])

  // 接收外部打开的项目文件
  useEffect(() => {
    if (openProjectFiles && openProjectFiles.length > 0) {
      const normalizedIncoming = openProjectFiles.map(normalizeIncomingTab)
      setTabs(prev => {
        const existingIds = new Set(prev.map(t => t.id))
        const newTabs = normalizedIncoming.filter(t => !existingIds.has(t.id))
        const merged = [...prev, ...newTabs]
        onOpenTabsChange?.(merged)
        return merged
      })
      // 激活第一个新文件
      setActiveTabId(normalizedIncoming[0].id)
      syncSidebarByLanguage(normalizedIncoming[0].language)
    }
  }, [openProjectFiles, syncSidebarByLanguage])

  // 从支持库加载窗口组件信息，并在支持库加载后刷新
  const loadWindowUnits = useCallback(() => {
    window.api.library.getWindowUnits(targetPlatform).then(setWindowUnits).catch(() => {})
  }, [targetPlatform])

  useEffect(() => {
    loadWindowUnits()
    const dispose = window.api.on('library:loaded', loadWindowUnits)
    return () => { dispose() }
  }, [loadWindowUnits])

  useEffect(() => {
    onActiveTabChange?.(activeTabId)
    const activeTab = tabs.find(t => t.id === activeTabId)
    if (activeTab) {
      const langMap: Record<string, string> = { eyc: '易语言源码', egv: '全局变量', ecs: '常量表', edt: '自定义数据类型', ell: 'DLL命令', erc: '资源表', efw: '窗口设计', typescript: 'TypeScript', javascript: 'JavaScript', html: 'HTML', css: 'CSS', json: 'JSON', python: 'Python', plaintext: '纯文本' }
      onDocTypeChange?.(langMap[activeTab.language] || activeTab.language)
    } else {
      onDocTypeChange?.('')
    }
  }, [activeTabId])

  useEffect(() => {
    if (!activeTabId) {
      setExternalChangePrompt(null)
      return
    }
    // 用 ref 读取当前标签，避免把 tabs 放进依赖——否则每次按键都会重建 2s 轮询并立即读盘一次。
    const active = tabsRef.current.find(t => t.id === activeTabId)
    if (!active?.filePath) {
      setExternalChangePrompt(null)
      return
    }

    let disposed = false
    const checkExternalChange = async (): Promise<void> => {
      const latestActiveTabId = activeTabIdRef.current
      if (!latestActiveTabId) return
      const latestTab = tabsRef.current.find(t => t.id === latestActiveTabId)
      if (!latestTab?.filePath) return
      const diskContent = readFileForExternalCheck
        ? await readFileForExternalCheck(latestTab.filePath)
        : await window.api?.project?.readFile(latestTab.filePath)
      if (disposed || diskContent == null) return

      const savedDiskContent = getTabSavedDiskContent(latestTab)
      const comparableDiskContent = normalizeExternalDiskContentForCompare(latestTab, diskContent)
      if (comparableDiskContent !== savedDiskContent) {
        setExternalChangePrompt(prev => {
          if (prev && prev.tabId === latestTab.id && prev.externalContent === diskContent) return prev
          return {
            tabId: latestTab.id,
            filePath: latestTab.filePath!,
            externalContent: diskContent,
          }
        })
      } else {
        setExternalChangePrompt(prev => (prev && prev.tabId === latestTab.id ? null : prev))
      }
    }

    void checkExternalChange()
    const timer = window.setInterval(() => {
      void checkExternalChange()
    }, 2000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [activeTabId, readFileForExternalCheck])

  // 收集项目内全局变量（.egv + 已打开标签页），用于 EYC 补全
  useEffect(() => {
    let cancelled = false

      const parseGlobalVars = (content: string, out: Map<string, string>) => {
      const re = /^\s*\.全局变量\s+([^,\s]+)(?:\s*,\s*([^,\s]+))?/gm
      let m: RegExpExecArray | null
      while ((m = re.exec(content)) !== null) {
        const name = (m[1] || '').trim()
        const type = (m[2] || '').trim()
        if (name && !out.has(name)) out.set(name, type)
      }
    }

    ;(async () => {
      if (!projectDir) {
        if (!cancelled) setProjectGlobalVars([])
        return
      }

      const vars = new Map<string, string>()

      // 优先使用已打开标签页中的最新内容（含未保存修改）
      for (const t of debouncedTabs) {
        if ((t.language === 'egv' || t.language === 'eyc' || t.language === 'ecs' || t.language === 'edt' || t.language === 'ell' || t.language === 'erc') && t.value) {
          parseGlobalVars(eycToYiFormat(t.value), vars)
        }
      }

      // 读取磁盘上的 .egv 文件，补齐未打开文件中的全局变量
      const openedPaths = new Set(tabs.filter(t => t.filePath).map(t => t.filePath!))
      const files = await window.api?.file?.readDir(projectDir)
      if (files) {
        for (const f of files as string[]) {
          if (!f.toLowerCase().endsWith('.egv')) continue
          const fp = projectDir + '\\' + f
          if (openedPaths.has(fp)) continue
          const content = await window.api?.project?.readFile(fp)
          if (content) parseGlobalVars(content, vars)
        }
      }

      if (!cancelled) {
        setProjectGlobalVars([...vars.entries()].map(([name, type]) => ({ name, type })))
      }
    })()

    return () => { cancelled = true }
  }, [projectDir, debouncedTabs])

  // 收集项目内 DLL 命令（.ell + 已打开标签页），用于 .eyc 代码补全
  useEffect(() => {
    let cancelled = false

    const splitCSV = (text: string): string[] => {
      const result: string[] = []
      let cur = ''
      let inQ = false
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (inQ) { cur += ch; if (ch === '"' || ch === '\u201d') inQ = false; continue }
        if (ch === '"' || ch === '\u201c') { inQ = true; cur += ch; continue }
        // \u884c\u5c3e\u88f8\u9017\u53f7\u4e5f\u89c6\u4e3a\u5206\u9694\u7b26\uff0c\u907f\u514d\u201c\u540d\u79f0,\u201d\u88ab\u5e76\u5165\u5b57\u6bb5
        if (ch === ',' && (i + 1 === text.length || text[i + 1] === ' ')) {
          result.push(cur)
          cur = ''
          i++
          continue
        }
        cur += ch
      }
      result.push(cur)
      return result
    }

    const unquote = (s: string): string => {
      if (!s) return ''
      if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('\u201c') && s.endsWith('\u201d'))) return s.slice(1, -1)
      return s
    }

    const parseDllCommands = (content: string, out: Map<string, ProjectDllCommand>) => {
      const lines = content.split('\n')
      let current: ProjectDllCommand | null = null

      for (const raw of lines) {
        const t = raw.replace(/[\r\t]/g, '').trim()
        if (!t || t.startsWith("'")) continue

        if (t.startsWith('.DLL命令 ')) {
          const fields = splitCSV(t.slice('.DLL命令 '.length))
          const name = (fields[0] || '').trim()
          if (!name) {
            current = null
            continue
          }
          if (!out.has(name)) {
            out.set(name, {
              name,
              returnType: (fields[1] || '').trim(),
              description: fields.length > 5 ? fields.slice(5).join(', ').trim() : '',
              params: [],
            })
          }
          current = out.get(name) || null
          continue
        }

        if (t.startsWith('.指针命令 ')) {
          const fields = splitCSV(t.slice('.指针命令 '.length))
          const name = (fields[0] || '').trim()
          if (!name) {
            current = null
            continue
          }
          if (!out.has(name)) {
            out.set(name, {
              name,
              returnType: (fields[1] || '').trim(),
              description: fields.length > 3 ? fields.slice(3).join(', ').trim() : '',
              params: [{
                name: '函数地址',
                type: '长整数型',
                description: '要调用的函数指针地址（如 指针到长整数 从函数表中读出的值）',
                optional: false,
                isVariable: false,
                isArray: false,
              }],
              isIndirect: true,
            })
          }
          current = out.get(name) || null
          continue
        }

        if (t.startsWith('.参数 ') || t.startsWith('    .参数 ')) {
          if (!current) continue
          const fields = splitCSV(t.replace(/^\s*\.参数\s+/, ''))
          const paramName = (fields[0] || '').trim()
          if (!paramName) continue
          const flags = (fields[2] || '').trim()
          current.params.push({
            name: paramName,
            type: (fields[1] || '').trim(),
            description: fields.length > 3 ? fields.slice(3).join(', ').trim() : '',
            optional: flags.includes('可空'),
            isVariable: flags.includes('传址'),
            isArray: flags.includes('数组'),
          })
          continue
        }

        // 命令参数区结束
        if (t.startsWith('.\u7248\u672C ')) continue
        if (t.startsWith('.')) current = null
      }
    }

    ;(async () => {
      if (!projectDir) {
        if (!cancelled) setProjectDllCommands([])
        return
      }

      const commands = new Map<string, ProjectDllCommand>()

      // 优先使用已打开标签页中的最新内容（含未保存修改）
      for (const t of debouncedTabs) {
        if ((t.language === 'ell' || t.language === 'eyc' || t.language === 'egv' || t.language === 'ecs' || t.language === 'edt' || t.language === 'erc') && t.value) {
          parseDllCommands(eycToYiFormat(t.value), commands)
        }
      }

      // 读取磁盘上的 .ell 文件，补齐未打开文件中的 DLL 命令
      const openedPaths = new Set(tabs.filter(t => t.filePath).map(t => t.filePath!))
      const files = await window.api?.file?.readDir(projectDir)
      if (files) {
        for (const f of files as string[]) {
          if (!f.toLowerCase().endsWith('.ell')) continue
          const fp = projectDir + '\\' + f
          if (openedPaths.has(fp)) continue
          const content = await window.api?.project?.readFile(fp)
          if (content) parseDllCommands(content, commands)
        }
      }

      if (!cancelled) {
        setProjectDllCommands([...commands.values()])
      }
    })()

    return () => { cancelled = true }
  }, [projectDir, debouncedTabs])

  // 收集项目内常量与资源名（.ecs/.erc + 已打开标签页），用于 #补全
  useEffect(() => {
    let cancelled = false

    const parseConstants = (content: string, out: Map<string, { value: string; kind: 'constant' | 'resource' }>) => {
      const re = /^\s*\.常量\s+([^,\s]+)(?:\s*,\s*([^,\s]+))?/gm
      let m: RegExpExecArray | null
      while ((m = re.exec(content)) !== null) {
        const name = (m[1] || '').trim()
        const value = (m[2] || '').trim()
        if (name && !out.has(name)) out.set(name, { value, kind: 'constant' })
      }
    }

    const parseResources = (content: string, out: Map<string, { value: string; kind: 'constant' | 'resource' }>) => {
      const re = /^\s*\.资源\s+([^,\s]+)(?:\s*,\s*([^,\s]+))?/gm
      let m: RegExpExecArray | null
      while ((m = re.exec(content)) !== null) {
        const name = (m[1] || '').trim()
        const file = (m[2] || '').trim()
        if (name && !out.has(name)) out.set(name, { value: file, kind: 'resource' })
      }
    }

    ;(async () => {
      if (!projectDir) {
        if (!cancelled) setProjectConstants([])
        return
      }

      const constants = new Map<string, { value: string; kind: 'constant' | 'resource' }>()

      // 优先使用已打开标签页中的最新内容（含未保存修改）
      for (const t of debouncedTabs) {
        if ((t.language === 'ecs' || t.language === 'eyc' || t.language === 'egv' || t.language === 'erc') && t.value) {
          const yi = eycToYiFormat(t.value)
          parseConstants(yi, constants)
          parseResources(yi, constants)
        }
      }

      // 读取磁盘上的 .ecs/.erc 文件，补齐未打开文件中的常量与资源名
      const openedPaths = new Set(tabs.filter(t => t.filePath).map(t => t.filePath!))
      const files = await window.api?.file?.readDir(projectDir)
      if (files) {
        for (const f of files as string[]) {
          const lower = f.toLowerCase()
          if (!lower.endsWith('.ecs') && !lower.endsWith('.erc')) continue
          const fp = projectDir + '\\' + f
          if (openedPaths.has(fp)) continue
          const content = await window.api?.project?.readFile(fp)
          if (content) {
            parseConstants(content, constants)
            parseResources(content, constants)
          }
        }
      }

      if (!cancelled) {
        setProjectConstants([...constants.entries()].map(([name, info]) => ({ name, value: info.value, kind: info.kind })))
      }
    })()

    return () => { cancelled = true }
  }, [projectDir, debouncedTabs])

  // 收集项目内自定义数据类型（.edt + 已打开标签页），用于类型补全
  useEffect(() => {
    let cancelled = false

    const parseDataTypes = (
      content: string,
      out: Map<string, { name: string; fields: Array<{ name: string; type: string }> }>,
    ) => {
      const parsed = parseLines(content)
      let currentTypeName = ''
      for (const ln of parsed) {
        if (ln.type === 'dataType') {
          currentTypeName = (ln.fields[0] || '').trim()
          if (!currentTypeName) continue
          if (!out.has(currentTypeName)) {
            out.set(currentTypeName, { name: currentTypeName, fields: [] })
          }
          continue
        }
        if (ln.type === 'dataTypeMember') {
          if (!currentTypeName) continue
          const fieldName = (ln.fields[0] || '').trim()
          const fieldType = (ln.fields[1] || '').trim()
          if (!fieldName) continue
          const item = out.get(currentTypeName)
          if (!item) continue
          if (!item.fields.some(field => field.name === fieldName)) {
            item.fields.push({ name: fieldName, type: fieldType })
          }
          continue
        }
        if (ln.type !== 'blank' && ln.type !== 'comment') {
          currentTypeName = ''
        }
      }
    }

    ;(async () => {
      if (!projectDir) {
        if (!cancelled) setProjectDataTypes([])
        return
      }

      const dataTypeMap = new Map<string, { name: string; fields: Array<{ name: string; type: string }> }>()

      // 优先使用已打开标签页中的最新内容（含未保存修改）
      for (const t of debouncedTabs) {
        if ((t.language === 'edt' || t.language === 'eyc') && t.value) {
          parseDataTypes(eycToYiFormat(t.value), dataTypeMap)
        }
      }

      // 读取磁盘上的 .edt 文件，补齐未打开文件中的数据类型
      const openedPaths = new Set(tabs.filter(t => t.filePath).map(t => t.filePath!))
      const files = await window.api?.file?.readDir(projectDir)
      if (files) {
        for (const f of files as string[]) {
          if (!f.toLowerCase().endsWith('.edt')) continue
          const fp = projectDir + '\\' + f
          if (openedPaths.has(fp)) continue
          const content = await window.api?.project?.readFile(fp)
          if (content) parseDataTypes(content, dataTypeMap)
        }
      }

      if (!cancelled) {
        setProjectDataTypes([...dataTypeMap.values()])
      }
    })()

    return () => { cancelled = true }
  }, [projectDir, debouncedTabs])

  // 收集项目内类名与公开方法（.ecc + 已打开标签页），用于类模块继承补全与成员补全
  useEffect(() => {
    let cancelled = false

    type ClassMethodInfo = { name: string; returnType: string; description: string; params: Array<{ name: string; type: string }> }

    const parseClassModules = (content: string, out: Map<string, ClassMethodInfo[]>) => {
      const lines = content.replace(/\r\n/g, '\n').split('\n')
      let currentClass = ''
      let currentMethod: ClassMethodInfo | null = null
      for (const rawLine of lines) {
        const t = rawLine.replace(/[\r\t]/g, '').trim()
        const asmMatch = /^\.程序集\s+(.+)$/.exec(t)
        if (asmMatch) {
          currentClass = (asmMatch[1].split(/[,，]/)[0] || '').trim()
          if (currentClass && !out.has(currentClass)) out.set(currentClass, [])
          currentMethod = null
          continue
        }
        const subMatch = /^\.子程序\s+(.+)$/.exec(t)
        if (subMatch) {
          const fields = subMatch[1].split(/[,，]/).map(f => f.trim())
          const subName = fields[0] || ''
          const isPublic = (fields[2] || '').includes('公开')
          currentMethod = null
          if (subName && currentClass && isPublic) {
            currentMethod = { name: subName, returnType: fields[1] || '', description: fields[3] || '', params: [] }
            out.get(currentClass)!.push(currentMethod)
          }
          continue
        }
        const paramMatch = /^\.参数\s+(.+)$/.exec(t)
        if (paramMatch && currentMethod) {
          const fields = paramMatch[1].split(/[,，]/).map(f => f.trim())
          if (fields[0]) currentMethod.params.push({ name: fields[0], type: fields[1] || '' })
          continue
        }
        // 离开声明区（局部变量行不中断参数收集语境，但其后不会再有 .参数）
        if (t && !t.startsWith('.局部变量')) currentMethod = null
      }
    }

    ;(async () => {
      if (!projectDir) {
        if (!cancelled) setProjectClassNames([])
        return
      }

      const classMap = new Map<string, Array<{ name: string; returnType: string; description: string; params: Array<{ name: string; type: string }> }>>()

      // 优先使用已打开标签页中的最新内容（含未保存修改）
      // 注意：类模块标签页的 label 是类名（不带扩展名），必须按 filePath 判断
      for (const t of debouncedTabs) {
        const tabFileName = (t.filePath || t.label || '').toLowerCase()
        if (tabFileName.endsWith('.ecc') && t.value) {
          parseClassModules(eycToYiFormat(t.value), classMap)
        }
      }

      // 读取磁盘上的 .ecc 文件，补齐未打开文件中的类名
      const openedPaths = new Set(tabs.filter(t => t.filePath).map(t => t.filePath!))
      const files = await window.api?.file?.readDir(projectDir)
      if (files) {
        for (const f of files as string[]) {
          if (!f.toLowerCase().endsWith('.ecc')) continue
          const fp = projectDir + '\\' + f
          if (openedPaths.has(fp)) continue
          const content = await window.api?.project?.readFile(fp)
          if (content) parseClassModules(content, classMap)
        }
      }

      if (!cancelled) {
        setProjectClassNames([...classMap].map(([name, methods]) => ({ name, methods })))
      }
    })()

    return () => { cancelled = true }
  }, [projectDir, debouncedTabs])

  // 设计器双击/属性事件跳转创建子程序后，仅刷新项目树，不自动保存。
  // 保持标签页 dirty 状态，避免“先变更后瞬间变已保存”的误导行为。
  const syncProjectTreeAfterEventSubChange = useCallback(() => {
    setTimeout(() => {
      onProjectTreeRefresh?.()
    }, 180)
  }, [onProjectTreeRefresh])

  // 双击可视化设计器控件 → 跳转到 .eyc 文件并定位/创建事件子程序
  // 导航历史（「跳回先前位置」）：跳转前记录当前标签页，供回跳
  const navBackStackRef = useRef<Array<{ tabId: string }>>([])
  const pushNavLocation = useCallback(() => {
    const id = activeTabIdRef.current
    if (!id) return
    const stack = navBackStackRef.current
    if (stack[stack.length - 1]?.tabId === id) return // 连续同一位置不重复记录
    stack.push({ tabId: id })
    if (stack.length > 50) stack.shift()
  }, [])
  const navigateBack = useCallback(() => {
    const stack = navBackStackRef.current
    while (stack.length > 0) {
      const loc = stack.pop()!
      if (loc.tabId !== activeTabIdRef.current && tabsRef.current.some(t => t.id === loc.tabId)) {
        setActiveTabId(loc.tabId)
        return
      }
    }
  }, [])
  const canNavigateBack = useCallback(
    () => navBackStackRef.current.some(l => l.tabId !== activeTabIdRef.current && tabsRef.current.some(t => t.id === l.tabId)),
    [],
  )
  navigateBackRef.current = navigateBack // 暴露给命令式 editorAction('navBack')

  // 「到对应窗口程序集」：从设计器打开/切到该窗体关联的 .eyc 代码文件
  const handleOpenWindowSource = useCallback(async () => {
    const activeT = tabsRef.current.find(t => t.id === activeTabIdRef.current)
    if (!activeT || activeT.language !== 'efw' || !activeT.filePath) return
    const efwDir = activeT.filePath.replace(/[/\\][^/\\]+$/, '')
    const sourceFileName = activeT.formData?.sourceFile
    const eycPath = sourceFileName
      ? joinPathByBaseDir(efwDir, sourceFileName)
      : activeT.filePath.replace(/\.efw$/i, '.eyc')
    pushNavLocation()
    const existingTab = tabsRef.current.find(t => t.filePath === eycPath)
    if (existingTab) {
      onSidebarTab?.('project')
      setActiveTabId(existingTab.id)
      return
    }
    const content = await window.api?.project?.readFile(eycPath)
    if (content === null || content === undefined) return
    const newTab: EditorTab = {
      id: eycPath, label: resolveEycTabLabel(eycPath, content), language: 'eyc',
      value: content, savedValue: content, filePath: eycPath,
    }
    setTabs(prev => {
      const merged = [...prev, newTab]
      onOpenTabsChange?.(merged)
      return merged
    })
    onSidebarTab?.('project')
    setActiveTabId(eycPath)
  }, [onOpenTabsChange, onSidebarTab, pushNavLocation])

  const handleControlDblClick = useCallback(async (ctrl: DesignControl, defaultEvent: LibUnitEvent | null) => {
    const activeT = tabs.find(t => t.id === activeTabId)
    if (!activeT || activeT.language !== 'efw' || !activeT.filePath) return
    pushNavLocation()

    // 优先使用 .efw 中定义的 sourceFile，否则回退到文件名替换
    const efwDir = activeT.filePath.replace(/[/\\][^/\\]+$/, '')
    const sourceFileName = activeT.formData?.sourceFile
    const eycPath = sourceFileName
      ? joinPathByBaseDir(efwDir, sourceFileName)
      : activeT.filePath.replace(/\.efw$/i, '.eyc')
    const eventName = defaultEvent?.name || '被单击'
    const subName = buildEventSubName(ctrl.name, eventName)
    const params = (defaultEvent?.args || []).map(arg => ({
      name: arg.name || 'param',
      dataType: arg.dataType || '整数型',
      isByRef: arg.isByRef ?? false,
    }))

    const existingTab = tabs.find(t => t.filePath === eycPath)
    if (existingTab) {
      if (existingTab.id === activeTabId) {
        // 已在该标签页上，直接导航
        eycEditorRef.current?.navigateOrCreateSub(subName, params)
        syncProjectTreeAfterEventSubChange()
      } else {
        onSidebarTab?.('project')
        pendingNavigateRef.current = { kind: 'create-or-open', subName, params }
        setActiveTabId(existingTab.id)
      }
    } else {
      // 读取并打开 .eyc 文件
      const content = await window.api?.project?.readFile(eycPath)
      if (content === null || content === undefined) return
      const newTab: EditorTab = {
        id: eycPath, label: resolveEycTabLabel(eycPath, content), language: 'eyc',
        value: content, savedValue: content, filePath: eycPath,
      }
      setTabs(prev => {
        const merged = [...prev, newTab]
        onOpenTabsChange?.(merged)
        return merged
      })
      onSidebarTab?.('project')
      pendingNavigateRef.current = { kind: 'create-or-open', subName, params }
      setActiveTabId(eycPath)
    }
  }, [tabs, activeTabId, onOpenTabsChange, buildEventSubName, onSidebarTab, syncProjectTreeAfterEventSubChange, pushNavLocation])

  // 双击可视化设计器窗口 → 跳转到 .eyc 文件并定位/创建窗口默认事件子程序
  const handleFormDblClick = useCallback(async (formData: DesignForm, defaultEvent: LibUnitEvent | null) => {
    const activeT = tabs.find(t => t.id === activeTabId)
    if (!activeT || activeT.language !== 'efw' || !activeT.filePath) return
    pushNavLocation()

    const efwDir = activeT.filePath.replace(/[/\\][^/\\]+$/, '')
    const sourceFileName = activeT.formData?.sourceFile
    const eycPath = sourceFileName
      ? joinPathByBaseDir(efwDir, sourceFileName)
      : activeT.filePath.replace(/\.efw$/i, '.eyc')
    const eventName = defaultEvent?.name || '被创建完毕'
    const subName = `_${formData.name}_${eventName}`
    const params = (defaultEvent?.args || []).map(arg => ({
      name: arg.name || 'param',
      dataType: arg.dataType || '整数型',
      isByRef: arg.isByRef ?? false,
    }))

    const existingTab = tabs.find(t => t.filePath === eycPath)
    if (existingTab) {
      if (existingTab.id === activeTabId) {
        eycEditorRef.current?.navigateOrCreateSub(subName, params)
        syncProjectTreeAfterEventSubChange()
      } else {
        pendingNavigateRef.current = { kind: 'create-or-open', subName, params }
        setActiveTabId(existingTab.id)
      }
    } else {
      const content = await window.api?.project?.readFile(eycPath)
      if (content === null || content === undefined) return
      const newTab: EditorTab = {
        id: eycPath, label: resolveEycTabLabel(eycPath, content), language: 'eyc',
        value: content, savedValue: content, filePath: eycPath,
      }
      setTabs(prev => {
        const merged = [...prev, newTab]
        onOpenTabsChange?.(merged)
        return merged
      })
      pendingNavigateRef.current = { kind: 'create-or-open', subName, params }
      setActiveTabId(eycPath)
    }
  }, [tabs, activeTabId, onOpenTabsChange, buildEventSubName, syncProjectTreeAfterEventSubChange, pushNavLocation])

  // 单击设计器菜单栏里的菜单项 → 跳转/创建该菜单项的 _名_被选择 事件子程序
  const handleMenuItemActivate = useCallback(async (itemName: string) => {
    const activeT = tabs.find(t => t.id === activeTabId)
    if (!activeT || activeT.language !== 'efw' || !activeT.filePath || !itemName) return
    const efwDir = activeT.filePath.replace(/[/\\][^/\\]+$/, '')
    const sourceFileName = activeT.formData?.sourceFile
    const eycPath = sourceFileName
      ? joinPathByBaseDir(efwDir, sourceFileName)
      : activeT.filePath.replace(/\.efw$/i, '.eyc')
    const subName = buildEventSubName(itemName, '被选择')
    const params: Array<{ name: string; dataType: string; isByRef: boolean }> = []
    pushNavLocation()
    const existingTab = tabs.find(t => t.filePath === eycPath)
    if (existingTab) {
      if (existingTab.id === activeTabId) {
        eycEditorRef.current?.navigateOrCreateSub(subName, params)
        syncProjectTreeAfterEventSubChange()
      } else {
        onSidebarTab?.('project')
        pendingNavigateRef.current = { kind: 'create-or-open', subName, params }
        setActiveTabId(existingTab.id)
      }
    } else {
      const content = await window.api?.project?.readFile(eycPath)
      if (content === null || content === undefined) return
      const newTab: EditorTab = {
        id: eycPath, label: resolveEycTabLabel(eycPath, content), language: 'eyc',
        value: content, savedValue: content, filePath: eycPath,
      }
      setTabs(prev => { const merged = [...prev, newTab]; onOpenTabsChange?.(merged); return merged })
      onSidebarTab?.('project')
      pendingNavigateRef.current = { kind: 'create-or-open', subName, params }
      setActiveTabId(eycPath)
    }
  }, [tabs, activeTabId, onOpenTabsChange, buildEventSubName, onSidebarTab, syncProjectTreeAfterEventSubChange, pushNavLocation])

  // 菜单项改名 → 同步源代码里的事件引用：_旧名_被选择 → _新名_被选择（打开的 .eyc 标签 + 磁盘未打开的）。
  // 事件名拼法与编译器一致：剥掉菜单项名的前导下划线（`_${name.replace(/^_+/,'')}_被选择`）。
  const handleMenuItemRenames = useCallback((renames: Array<{ oldName: string; newName: string }>) => {
    if (!renames.length) return
    const openEycPaths = new Set<string>()
    for (const t of tabsRef.current) {
      if (t.language === 'eyc' && t.filePath) openEycPaths.add(t.filePath)
    }
    const subNameOf = (name: string): string => `_${name.replace(/^_+/, '')}_被选择`
    setTabs(prev => {
      const next = prev.map(t => {
        if (t.language !== 'eyc') return t
        let val = t.value
        for (const r of renames) {
          const oldSub = subNameOf(r.oldName)
          if (val.includes(oldSub)) val = val.split(oldSub).join(subNameOf(r.newName))
        }
        return val === t.value ? t : { ...t, value: val }
      })
      onOpenTabsChange?.(next)
      return next
    })
    for (const r of renames) {
      renameDiskFiles(openEycPaths, subNameOf(r.oldName), subNameOf(r.newName))
    }
  }, [onOpenTabsChange, renameDiskFiles])

  // 标签切换后执行挂起的子程序导航
  useEffect(() => {
    if (!pendingNavigateRef.current) return
    const activeT = tabs.find(t => t.id === activeTabId)
    if (!activeT || activeT.language !== 'eyc') return

    const tabMode: EycEditorMode = eycEditorModeTabs[activeT.id] || 'table'
    const fallbackTextMode = !!eycFallbackTabs[activeT.id]
    const useTextMode = tabMode === 'text' || fallbackTextMode

    // 手动文本模式下先切回表格，再执行跳转，避免先在文本态产生视觉定位。
    if (useTextMode) {
      if (!fallbackTextMode) {
        setEycEditorModeTabs(prev => {
          if (!prev[activeT.id]) return prev
          const next = { ...prev }
          delete next[activeT.id]
          return next
        })
      }
      return
    }

    if (!eycEditorRef.current) return
    const pending = pendingNavigateRef.current
    pendingNavigateRef.current = null
    setTimeout(() => {
      if (!eycEditorRef.current) return
      if (pending.kind === 'create-or-open') {
        eycEditorRef.current.navigateOrCreateSub(pending.subName, pending.params)
        syncProjectTreeAfterEventSubChange()
        return
      }
      eycEditorRef.current.navigateToSubprogram(pending.subName, pending.fallbackLine)
    }, 100)
  }, [activeTabId, tabs, eycEditorModeTabs, eycFallbackTabs, syncProjectTreeAfterEventSubChange])

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0] || null
  const activeTabEycMode: EycEditorMode = activeTab ? (eycEditorModeTabs[activeTab.id] || 'table') : 'table'
  const activeTabFallbackTextMode = !!(activeTab && eycFallbackTabs[activeTab.id])
  const activeTabForceTableForPendingNavigation = !!(
    activeTab
    && isEycSourceLanguage(activeTab.language)
    && pendingNavigateRef.current
    && activeTabEycMode === 'text'
    && !activeTabFallbackTextMode
  )
  const activeTabUseTextMode = (activeTabEycMode === 'text' || activeTabFallbackTextMode)
    && !activeTabForceTableForPendingNavigation
  const activeTabTextModeValue = useMemo(() => {
    if (!activeTab || !isEycSourceLanguage(activeTab.language)) return ''
    return eycToYiFormat(activeTab.value)
  }, [activeTab])
  // 项目内所有窗口的控件表+子程序（读盘）：供「.eyc 代码打开但对应 .efw 未打开」时解析窗口成员，
  // 以及「在任意窗口代码里引用另一个窗口名」的跨窗口成员补全。
  type WinControlEntry = { name: string; controls: Array<{ name: string; type: string; properties?: Record<string, string | number | boolean> }>; subs: string[] }
  const [projectWindowControlsMap, setProjectWindowControlsMap] = useState<Map<string, WinControlEntry>>(new Map())
  const [projectWindows, setProjectWindows] = useState<WinControlEntry[]>([])
  useEffect(() => {
    if (!projectDir) { setProjectWindowControlsMap(new Map()); setProjectWindows([]); return }
    let cancelled = false
    ;(async () => {
      const map = new Map<string, WinControlEntry>()
      const list: WinControlEntry[] = []
      const files = await window.api?.file?.readDir(projectDir)
      if (files) {
        for (const f of files as string[]) {
          if (!f.toLowerCase().endsWith('.efw')) continue
          const content = await window.api?.project?.readFile(projectDir + '\\' + f)
          if (!content) continue
          try {
            const data = JSON.parse(content)
            const name = (data.name || data.formName || f.replace(/\.efw$/i, '')).trim()
            if (!name) continue
            const controls = (Array.isArray(data.controls) ? data.controls : [])
              .map((c: { name?: string; type?: string; properties?: Record<string, string | number | boolean> }) => ({ name: (c.name || '').trim(), type: (c.type || '').trim(), properties: c.properties }))
              .filter((c: { name: string }) => c.name)
            // 关联 .eyc 里提取子程序名（`.子程序 名, ...`）
            const eycName = (data.sourceFile || `${name}.eyc`)
            const subs: string[] = []
            const eycContent = await window.api?.project?.readFile(projectDir + '\\' + eycName)
            if (eycContent) {
              for (const rawLine of eycContent.split(/\r?\n/)) {
                const m = /^\s*\.子程序\s+([^,，\n]+)/.exec(rawLine)
                if (m) { const sn = m[1].trim(); if (sn) subs.push(sn) }
              }
            }
            const entry: WinControlEntry = { name, controls, subs }
            list.push(entry)
            map.set((data.sourceFile || `${name}.eyc`).toLowerCase(), entry)
            map.set(`${name}.eyc`.toLowerCase(), entry)  // 名字兜底
            map.set(f.toLowerCase().replace(/\.efw$/i, '.eyc'), entry)  // 文件名兜底
          } catch { /* 跳过无法解析的 .efw */ }
        }
      }
      if (!cancelled) { setProjectWindowControlsMap(map); setProjectWindows(list) }
    })()
    return () => { cancelled = true }
  }, [projectDir, debouncedTabs])

  const activeWindowControls = useMemo(() => {
    if (!activeTab) return [] as Array<{ name: string; type: string; properties?: Record<string, string | number | boolean> }>
    const isSourceTab = isEycSourceLanguage(activeTab.language)
    if (!isSourceTab) return [] as Array<{ name: string; type: string; properties?: Record<string, string | number | boolean> }>

    const sourceFileName = (activeTab.filePath?.split(/[\\/]/).pop() || activeTab.label).toLowerCase()

    const items: Array<{ name: string; type: string; properties?: Record<string, string | number | boolean> }> = []
    const seen = new Set<string>()
    const add = (name: string, type: string, properties?: Record<string, string | number | boolean>): void => {
      const n = (name || '').trim()
      const t = (type || '').trim()
      if (!n || seen.has(n)) return
      seen.add(n)
      items.push({ name: n, type: t, properties })
    }
    const buildFrom = (winName: string, controls: Array<{ name: string; type: string; properties?: Record<string, string | number | boolean> }>): typeof items => {
      add(winName, '窗口')
      for (const control of controls) add(control.name, control.type, control.properties)
      return items
    }

    // 1) 优先用已打开的 .efw 标签页（含未落盘的实时编辑）。
    const matchedFormTab = tabs.find(t => {
      if (t.language !== 'efw' || !t.formData) return false
      const linkedSource = (t.formData.sourceFile || `${t.formData.name}.eyc`).toLowerCase()
      return linkedSource === sourceFileName
    })
    if (matchedFormTab?.formData) {
      return buildFrom(matchedFormTab.formData.name, matchedFormTab.formData.controls)
    }

    // 2) .efw 未打开：从读盘的项目窗口控件表按关联源文件名解析（用户即使不开设计器也能补全窗口成员）。
    const diskEntry = projectWindowControlsMap.get(sourceFileName)
    if (diskEntry) return buildFrom(diskEntry.name, diskEntry.controls)

    return items
  }, [activeTab, tabs, projectWindowControlsMap])

  const activeWindowControlNames = useMemo(() => {
    return activeWindowControls.map(c => c.name)
  }, [activeWindowControls])

  const textModeValidCommandNames = useMemo(() => new Set<string>(), [])
  const textModeAllKnownVarNames = useMemo(() => new Set<string>(), [])
  const textModeReservedNameSet = useMemo(() => new Set<string>(), [])
  const textModeDiagnosticsProblems = useEditorDiagnosticsProblems({
    text: activeTabTextModeValue,
    hasCommandCatalog: false,
    validCommandNames: textModeValidCommandNames,
    allKnownVarNames: textModeAllKnownVarNames,
    reservedNameSet: textModeReservedNameSet,
  })

  useEffect(() => {
    const monaco = monacoRef.current
    const ed = editorRef.current
    if (!monaco || !ed) return
    const model = ed.getModel()
    if (!model) return

    const isSourceTextMode = !!activeTab && isEycSourceLanguage(activeTab.language) && activeTabUseTextMode
    if (!isSourceTextMode) {
      monaco.editor.setModelMarkers(model, MONACO_DIAGNOSTICS_OWNER, [])
      return
    }

    const markers: editor.IMarkerData[] = textModeDiagnosticsProblems.map(problem => {
      const startLineNumber = Math.max(1, Math.floor(problem.line || 1))
      const startColumn = Math.max(1, Math.floor(problem.column || 1))
      return {
        startLineNumber,
        startColumn,
        endLineNumber: startLineNumber,
        endColumn: startColumn + 1,
        message: problem.message,
        severity: problem.severity === 'error'
          ? monaco.MarkerSeverity.Error
          : monaco.MarkerSeverity.Warning,
      }
    })

    monaco.editor.setModelMarkers(model, MONACO_DIAGNOSTICS_OWNER, markers)
    onProblemsChange?.(textModeDiagnosticsProblems as FileProblem[])
  }, [activeTab, activeTabUseTextMode, onProblemsChange, textModeDiagnosticsProblems])

  const handleEditorMount: OnMount = useCallback((editorInstance, monaco) => {
    editorRef.current = editorInstance
    monacoRef.current = monaco

    // 注册 Ctrl+S 保存
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      setTabs(prev =>
        prev.map(t => {
          if (t.id !== activeTabId) return t
          return { ...t, savedValue: getTabPersistContent(t) }
        })
      )
    })

    // 光标位置变化通知
    editorInstance.onDidChangeCursorPosition((e) => {
      onCursorChange?.(e.position.lineNumber, e.position.column)
    })

    // 编辑器获取焦点
    editorInstance.focus()
  }, [activeTabId, onCursorChange])

  useEffect(() => {
    if (!monacoRef.current) return
    registerEditorThemes(monacoRef.current, themeTokenValues)
  }, [currentTheme, themeTokenValues])

  const handleEditorChange: OnChange = useCallback((value) => {
    if (value === undefined) return
    setTabs(prev => {
      const next = prev.map(t =>
        t.id === activeTabId ? { ...t, value, aiModified: undefined } : t
      )
      onOpenTabsChange?.(next)
      return next
    })
  }, [activeTabId, onOpenTabsChange])

  const handleEycTextEditorChange: OnChange = useCallback((value) => {
    if (value === undefined) return
    const internal = eycToInternalFormat(value)
    setTabs(prev => {
      const next = prev.map(t =>
        t.id === activeTabId ? { ...t, value: internal, aiModified: undefined } : t
      )
      onOpenTabsChange?.(next)
      return next
    })
  }, [activeTabId, onOpenTabsChange])

  // 直接接收 string 的 onChange（给 EycTableEditor 用）
  const handleEycChange = useCallback((value: string) => {
    if (activeTabId) {
      const before = tabsRef.current.find(t => t.id === activeTabId)?.value
      if (before !== undefined) recordUndo(activeTabId, 'content', before, value)
    }
    setTabs(prev => {
      const next = prev.map(t =>
        t.id === activeTabId ? { ...t, value, aiModified: undefined } : t
      )
      onOpenTabsChange?.(next)
      return next
    })
  }, [activeTabId, onOpenTabsChange, recordUndo])

  const handleRouteDeclarationPaste = useCallback((routes: Array<{ language: RoutedDeclLanguage; lines: string[] }>) => {
    if (!routes || routes.length === 0) return
    const persistedTargets: Array<{ id: string; language: RoutedDeclLanguage; filePath?: string; content: string }> = []
    setTabs(prev => {
      let next = [...prev]

      for (const route of routes) {
        const lines = route.lines.filter(line => line.trim().length > 0)
        if (lines.length === 0) continue

        let targetIndex = next.findIndex(t => t.language === route.language)
        if (targetIndex < 0) {
          const meta = ROUTED_DECL_DEFAULTS[route.language]
          const id = projectDir ? joinPathByBaseDir(projectDir, meta.label) : `__auto__/${meta.label}`
          const created: EditorTab = normalizeIncomingTab({
            id,
            label: meta.label,
            language: meta.language,
            value: '',
            savedValue: '',
            filePath: projectDir ? id : undefined,
          })
          next = [...next, created]
          targetIndex = next.length - 1
        }

        const target = next[targetIndex]
        const current = target.value || ''
        const appended = current.trim().length > 0
          ? `${current.replace(/\n+$/, '')}\n${lines.join('\n')}`
          : lines.join('\n')
        next[targetIndex] = { ...target, value: appended }
        persistedTargets.push({ id: next[targetIndex].id, language: route.language, filePath: next[targetIndex].filePath, content: appended })
      }

      onOpenTabsChange?.(next)
      return next
    })

    // 将自动路由到声明文档的内容立即落盘，确保文件被项目树识别。
    // 对应标签同时更新 savedValue，避免显示为未保存脏状态。
    void (async () => {
      if (!projectDir || persistedTargets.length === 0) return
      const unique = new Map<string, { id: string; language: RoutedDeclLanguage; filePath?: string; content: string }>()
      for (const item of persistedTargets) unique.set(item.id, item)
      let wroteAny = false

      for (const target of unique.values()) {
        if (!target.filePath) continue
        const fileName = target.filePath.replace(/^.*[\\/]/, '')
        const fileType = target.language.toUpperCase()
        // addFile 同时负责写盘与将文件注册进 .epp；若已存在会跳过重复注册。
        await window.api?.project?.addFile(projectDir, fileName, fileType, target.content)
        wroteAny = true
      }

      if (wroteAny) {
        setTabs(prev => prev.map(t => {
          const target = unique.get(t.id)
          if (!target) return t
          return { ...t, savedValue: target.content }
        }))
        onProjectTreeRefresh?.()
      }
    })()
  }, [onOpenTabsChange, onProjectTreeRefresh, projectDir])

  const handleEditorContentPasteCapture = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!activeTab) return
    const clipText = e.clipboardData?.getData('text/plain') || ''
    if (!clipText || clipText.trim().length === 0) return

    const sourceLanguage = isEycSourceLanguage(activeTab.language)
    const tableModeSource = sourceLanguage && !activeTabUseTextMode

    // 表格模式由 EycTableEditor 内部统一处理，避免重复拦截。
    if (tableModeSource) return

    if (sourceLanguage && activeTabUseTextMode) {
      const cursorLine = Math.max(0, (editorRef.current?.getPosition()?.lineNumber || 1) - 1)
      const result = buildMultiLinePasteResult({
        currentText: activeTab.value || '',
        clipText,
        cursorLine,
        sanitizePastedText: sanitizePastedTextForCurrent,
        extractAssemblyVarLines: extractAssemblyVarLinesFromPasted,
        extractRoutedDeclarationLines: extractRoutedDeclarationLinesFromPasted,
      })
      if (!result) return

      e.preventDefault()
      e.stopPropagation()

      if (result.routedDeclarations.length > 0) {
        handleRouteDeclarationPaste(result.routedDeclarations)
      }

      setTabs(prev => prev.map(t => {
        if (t.id !== activeTab.id) return t
        return { ...t, value: result.nextText }
      }))
      return
    }

    // 可视化设计器或其它编辑器：若粘贴内容中包含声明，则执行跨文档路由。
    const routed = extractRoutedDeclarationLinesFromPasted(clipText, '')
    if (routed.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    handleRouteDeclarationPaste(routed)
  }, [activeTab, activeTabUseTextMode, handleRouteDeclarationPaste])

  const handleCommandPaste = useCallback(async () => {
    if (!activeTab) return
    let clipText = ''
    try {
      clipText = await navigator.clipboard.readText()
    } catch {
      return
    }
    if (!clipText || clipText.trim().length === 0) return

    const sourceLanguage = isEycSourceLanguage(activeTab.language)
    if (sourceLanguage && activeTabUseTextMode) {
      const cursorLine = Math.max(0, (editorRef.current?.getPosition()?.lineNumber || 1) - 1)
      const result = buildMultiLinePasteResult({
        currentText: activeTab.value || '',
        clipText,
        cursorLine,
        sanitizePastedText: sanitizePastedTextForCurrent,
        extractAssemblyVarLines: extractAssemblyVarLinesFromPasted,
        extractRoutedDeclarationLines: extractRoutedDeclarationLinesFromPasted,
      })
      if (!result) return

      if (result.routedDeclarations.length > 0) {
        handleRouteDeclarationPaste(result.routedDeclarations)
      }

      setTabs(prev => prev.map(t => {
        if (t.id !== activeTab.id) return t
        return { ...t, value: result.nextText }
      }))
      return
    }

    const routed = extractRoutedDeclarationLinesFromPasted(clipText, sourceLanguage ? (activeTab.value || '') : '')
    if (routed.length > 0) {
      handleRouteDeclarationPaste(routed)
    }
  }, [activeTab, activeTabUseTextMode, handleRouteDeclarationPaste])

  // 可视化设计器 form 改变
  const handleFormChange = useCallback((form: DesignForm) => {
    if (activeTabId) {
      const before = tabsRef.current.find(t => t.id === activeTabId)?.formData
      if (before) recordUndo(activeTabId, 'formData', before, form)
    }
    setTabs(prev => {
      const next = prev.map(t =>
        t.id === activeTabId ? { ...t, formData: form, aiModified: undefined } : t
      )
      onOpenTabsChange?.(next)
      return next
    })
  }, [activeTabId, onOpenTabsChange, recordUndo])

  // 可视化设计器选中控件变化
  const handleSelectControl = useCallback((target: SelectionTarget) => {
    onSelectControl?.(target)
  }, [onSelectControl])

  const closeTab = useCallback((e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    void closeTabWithPrompt(tabId)
  }, [closeTabWithPrompt])

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId)
    const tab = tabs.find(t => t.id === tabId)
    syncSidebarByLanguage(tab?.language)
    // 切换后聚焦编辑器
    setTimeout(() => editorRef.current?.focus(), 0)
  }, [tabs, syncSidebarByLanguage])

  const isModified = (tab: EditorTab) => isTabModified(tab)

  useEffect(() => {
    try {
      localStorage.setItem(EDITOR_TAB_BAR_POS_KEY, tabBarPosition)
    } catch {
      // ignore storage failures
    }
  }, [tabBarPosition])

  useEffect(() => {
    if (!tabContextMenu) return
    document.documentElement.style.setProperty('--editor-tab-context-menu-x', `${tabContextMenu.x}px`)
    document.documentElement.style.setProperty('--editor-tab-context-menu-y', `${tabContextMenu.y}px`)
    const close = (): void => setTabContextMenu(null)
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [tabContextMenu])

  const handleTabContextMenu = useCallback((e: React.MouseEvent, tabId: string | null = null) => {
    e.preventDefault()
    e.stopPropagation()
    setTabContextMenu({ x: e.clientX, y: e.clientY, tabId })
  }, [])

  const toggleTabBarPosition = useCallback(() => {
    setTabBarPosition(prev => prev === 'bottom' ? 'top' : 'bottom')
    setTabContextMenu(null)
  }, [])

  const contextMenuTab = tabContextMenu
    ? tabs.find(t => t.id === (tabContextMenu.tabId ?? activeTabId)) || null
    : null
  const contextMenuTabIsEyc = isEycSourceLanguage(contextMenuTab?.language)
  const contextMenuTabMode: EycEditorMode = contextMenuTab ? (eycEditorModeTabs[contextMenuTab.id] || 'table') : 'table'
  const contextMenuTabFallbackTextMode = !!(contextMenuTab && eycFallbackTabs[contextMenuTab.id])
  const contextMenuTabUseTextMode = contextMenuTabMode === 'text' || contextMenuTabFallbackTextMode

  const toggleContextMenuTabEditorMode = useCallback(() => {
    const targetTabId = tabContextMenu?.tabId ?? activeTabId
    if (!targetTabId) {
      setTabContextMenu(null)
      return
    }
    const targetTab = tabs.find(t => t.id === targetTabId)
    if (!targetTab || !isEycSourceLanguage(targetTab.language)) {
      setTabContextMenu(null)
      return
    }
    const mode = eycEditorModeTabs[targetTabId] || 'table'
    const fallbackTextMode = !!eycFallbackTabs[targetTabId]
    const useTextMode = mode === 'text' || fallbackTextMode
    const nextMode: EycEditorMode = useTextMode ? 'table' : 'text'
    setEycEditorModeTabs(prev => {
      const next = { ...prev }
      if (nextMode === 'table') delete next[targetTabId]
      else next[targetTabId] = 'text'
      return next
    })
    if (nextMode === 'table') {
      setEycFallbackTabs(prev => {
        if (!prev[targetTabId]) return prev
        const next = { ...prev }
        delete next[targetTabId]
        return next
      })
    }
    setTabContextMenu(null)
  }, [tabContextMenu, activeTabId, tabs, eycEditorModeTabs, eycFallbackTabs])

  return (
    <div className={`editor ${tabBarPosition === 'top' ? 'editor-tabs-top' : 'editor-tabs-bottom'}`} role="main" aria-label="代码编辑器">
      {externalChangePrompt && activeTab && externalChangePrompt.tabId === activeTab.id && (
        <div className="editor-external-change-banner" role="alert">
          <span className="editor-external-change-text">
            文件已被外部修改
          </span>
          <div className="editor-external-change-actions">
            <button type="button" className="editor-external-change-btn" onClick={applyExternalFileContent}>更新为外部内容</button>
            <button type="button" className="editor-external-change-btn primary" onClick={() => { void keepIdeContentAndOverwriteExternal() }}>保留 IDE 当前内容</button>
          </div>
        </div>
      )}
      {/* 编辑区 */}
      <div className="editor-content" onPasteCapture={handleEditorContentPasteCapture}>
        {!activeTab ? (
          <div className="editor-empty">
            <div className="editor-empty-text">没有打开的文件</div>
            <div className="editor-empty-hint">通过 文件 → 新建项目 或 文件 → 打开项目 开始</div>
          </div>
        ) : activeTab.language === 'efw' && activeTab.formData ? (
          <VisualDesigner
            form={activeTab.formData}
            onChange={handleFormChange}
            onSelectControl={handleSelectControl}
            windowUnits={windowUnits}
            externalSelectedId={selection?.kind === 'form' ? '__form__' : selection?.kind === 'control' ? selection.control.id : undefined}
            onMultiSelectChange={onMultiSelectChange}
            onControlDoubleClick={handleControlDblClick}
            onFormDoubleClick={handleFormDblClick}
            onUndo={globalUndo}
            onOpenWindowSource={handleOpenWindowSource}
            onNavigateBack={navigateBack}
            onCanNavigateBack={canNavigateBack}
            onPreviewWindow={() => {
              const activeT = tabsRef.current.find(t => t.id === activeTabIdRef.current)
              if (activeT?.language === 'efw' && activeT.filePath) {
                onPreviewWindow?.(activeT.filePath.replace(/^.*[\\/]/, ''))
              }
            }}
            onMenuItemActivate={handleMenuItemActivate}
            onMenuItemRenames={handleMenuItemRenames}
          />
        ) : isEycSourceLanguage(activeTab.language) ? (
          activeTabUseTextMode ? (
            <div className="editor-eyc-textmode-shell">
              {activeTabFallbackTextMode && (
                <div className="editor-eyc-fallback-banner" role="alert">
                  <span className="editor-eyc-fallback-text">表格模式异常，已临时切换到文本模式</span>
                  <button
                    type="button"
                    className="editor-eyc-fallback-btn"
                    onClick={() => {
                      setEycFallbackTabs(prev => {
                        const next = { ...prev }
                        delete next[activeTab.id]
                        return next
                      })
                    }}
                  >
                    重试表格模式
                  </button>
                </div>
              )}
              <div className="editor-eyc-textmode-main">
                <MonacoEditor
                  key={activeTab.id}
                  language="eyc"
                  value={activeTabTextModeValue}
                  theme={monacoThemeId}
                  onChange={handleEycTextEditorChange}
                  onMount={handleEditorMount}
                  beforeMount={(monaco) => {
                    registerEycLanguage(monaco)
                    registerEditorThemes(monaco, themeTokenValues)
                  }}
                  options={monacoEditorOptions}
                  loading={
                    <div className="editor-loading">
                      <span>编辑器加载中...</span>
                    </div>
                  }
                />
              </div>
            </div>
          ) : (
            <EycEditorErrorBoundary
              tabId={activeTab.id}
              onError={(tabId, error, info) => {
                console.error('[Editor] EycTableEditor render failed, fallback to Monaco', { tabId, error, info })
                void window.api?.debug?.logRendererError({
                  source: 'EycEditorErrorBoundary',
                  message: error.message || 'EycTableEditor render failed',
                  stack: error.stack,
                  extra: {
                    tabId,
                    componentStack: info.componentStack,
                  },
                })
                setEycFallbackTabs(prev => ({ ...prev, [tabId]: true }))
              }}
            >
              <EycTableEditor
                ref={eycEditorRef}
                value={activeTab.value}
                docLanguage={activeTab.language}
                editorFontFamily={editorFontFamily}
                editorFontSize={editorFontSize}
                editorLineHeight={editorLineHeight}
                freezeSubTableHeader={editorFreezeSubTableHeader}
                showMinimapPreview={editorShowMinimapPreview}
                showVarSummaryPanel={editorShowVarSummaryPanel}
                projectDir={projectDir}
                targetPlatform={targetPlatform}
                isClassModule={activeTab.label.toLowerCase().endsWith('.ecc')}
                projectGlobalVars={projectGlobalVars}
                windowControlNames={activeWindowControlNames}
                windowControlTypes={activeWindowControls}
                projectWindows={projectWindows}
                windowUnits={windowUnits}
                projectConstants={projectConstants}
                projectDllCommands={projectDllCommands}
                projectDataTypes={projectDataTypes}
                projectClassNames={projectClassNames}
                onClassNameRename={handleClassModuleNameRename}
                onChange={handleEycChange}
                onGlobalUndo={globalUndo}
                onGlobalRedo={globalRedo}
                onCommandClick={onCommandClick}
                onCommandClear={onCommandClear}
                onProblemsChange={onProblemsChange}
                onCursorChange={onCursorChange}
                onRouteDeclarationPaste={handleRouteDeclarationPaste}
                breakpointLines={breakpointsByFile[activeTab.label] || EMPTY_BREAKPOINT_LINES}
                debugSourceLine={debugLocation?.file === activeTab.label ? debugLocation.line : undefined}
                debugVariables={debugLocation?.file === activeTab.label ? debugVariables : EMPTY_DEBUG_VARIABLES}
                diffHighlightLines={eycDiffHighlightLines}
                diffAddedLines={eycDiffAddedLines}
                diffEditedLines={eycDiffEditedLines}
                diffDeletedAfterLines={eycDiffDeletedAfterLines}
                diffDeletedTextAfterLines={eycDiffDeletedTextAfterLines}
              />
            </EycEditorErrorBoundary>
          )
        ) : (
          <MonacoEditor
          key={activeTab.id}
          language={activeTab.language}
          value={activeTab.value}
          theme={monacoThemeId}
          onChange={handleEditorChange}
          onMount={handleEditorMount}
          beforeMount={(monaco) => {
            // 注册 eyc 易语言
            registerEycLanguage(monaco)
            registerEditorThemes(monaco, themeTokenValues)
          }}
          options={monacoEditorOptions}
          loading={
            <div className="editor-loading">
              <span>编辑器加载中...</span>
            </div>
          }
        />
        )}
      </div>

      {/* 标签页 */}
      <div
        className="editor-tabs"
        role="tablist"
        aria-label="打开的文件"
        onContextMenu={(e) => handleTabContextMenu(e, activeTabId)}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`editor-tab ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={() => switchTab(tab.id)}
            onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
            title={tab.filePath || tab.label}
          >
            <span className="editor-tab-icon">
              {getFileIcon(tab.language)}
            </span>
            <span className={`editor-tab-label ${getTabLabelClass(tab.language)}`}>{tab.label}</span>
            {isModified(tab) && (
              <span
                className={`editor-tab-modified${tab.aiModified ? ' editor-tab-modified-ai' : ''}`}
                title={tab.aiModified ? '未保存更改（AI 修改）' : '未保存更改'}
              >●</span>
            )}
            <span
              className="editor-tab-close"
              aria-label={`关闭 ${tab.label}`}
              onClick={(e) => closeTab(e, tab.id)}
            >×</span>
          </button>
        ))}
      </div>

      {tabContextMenu && (
        <div
          className="editor-tab-context-menu"
          onClick={e => e.stopPropagation()}
          onContextMenu={e => e.preventDefault()}
        >
          <button
            type="button"
            className="editor-tab-context-item"
            onClick={toggleTabBarPosition}
          >
            {tabBarPosition === 'bottom' ? '将文件标签移到编辑器上边' : '将文件标签移到编辑器下边'}
          </button>
          {contextMenuTabIsEyc && (
            <button
              type="button"
              className="editor-tab-context-item"
              onClick={toggleContextMenuTabEditorMode}
            >
              {contextMenuTabUseTextMode ? '切换为表格模式' : '切换为文本模式'}
            </button>
          )}
        </div>
      )}
    </div>
  )
})

/** 根据语言返回文件图标 */
function getFileIcon(language: string): ReactNode {
  const iconNameMap: Record<string, string> = {
    eyc: 'edit',
    eyw: 'windows-form',
    erc: 'resource-view',
  }
  const iconName = iconNameMap[language]
  if (iconName) return <Icon name={iconName} size={14} />
  const textIcons: Record<string, string> = {
    typescript: 'TS',
    javascript: 'JS',
    html: '◇',
    css: '#',
    json: '{}',
    python: 'Py',
    plaintext: '📄',
  }
  return textIcons[language] || '📄'
}

function getTabLabelClass(language: string): string {
  const classMap: Record<string, string> = {
    eyc: 'tab-label-eyc',
    egv: 'tab-label-egv',
    ecs: 'tab-label-ecs',
    edt: 'tab-label-edt',
    ell: 'tab-label-ell',
    erc: 'tab-label-resource',
    efw: 'tab-label-efw',
    typescript: 'tab-label-ts',
    javascript: 'tab-label-js',
    html: 'tab-label-html',
    css: 'tab-label-css',
    json: 'tab-label-json',
    python: 'tab-label-python',
  }
  return classMap[language] || 'tab-label-default'
}

export default Editor
