import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import TitleBar from './components/TitleBar/TitleBar'
import Toolbar from './components/Toolbar/Toolbar'
import Sidebar from './components/Sidebar/Sidebar'
import type { TreeNode } from './components/Sidebar/Sidebar'
import Icon from './components/Icon/Icon'
import Editor, { type EditorTab, type EditorHandle, type DiffLineInfo } from './components/Editor/Editor'
import OutputPanel, { type OutputMessage, type CommandDetail, type FileProblem, type DebugPauseState } from './components/OutputPanel/OutputPanel'
import StatusBar from './components/StatusBar/StatusBar'
import LibraryDialog from './components/LibraryDialog/LibraryDialog'
import NewProjectDialog from './components/NewProjectDialog/NewProjectDialog'
import ThemeSettingsDialog from './components/ThemeSettingsDialog/ThemeSettingsDialog'
import ThemeManager from './components/ThemeManager/ThemeManager'
import SettingsDialog from './components/SettingsDialog/SettingsDialog'
import AIAssistantPanel from './components/AIAssistantPanel/AIAssistantPanel'
import type { SelectionTarget, AlignAction, DesignForm, DesignControl } from './components/Editor/VisualDesigner'
import { parseLines } from './components/Editor/eycBlocks'
import { isRedoShortcut, type RuntimePlatform } from './utils/shortcuts'
import {
  BUILTIN_DARK_THEME_ID,
  createDefaultThemeTokenPayload,
  resolveThemeTokenPayload,
  validateCustomThemeName,
  type SaveAsCustomThemeResult,
  type ThemeDefinition,
  type ThemeImportConflictDecision,
  type ThemeImportValidationDiagnostic,
  type ThemeConfigV2,
  type ThemeTokenPayload
} from '../../shared/theme'
import { createThemeDraftSession, type ThemeDraftSession } from '../../shared/theme-draft'
import { THEME_TOKEN_GROUPS, type FlowLineMode, type FlowLineMultiConfig, type ThemeTokenGroupId } from '../../shared/theme-tokens'
import { DEFAULT_IDE_SETTINGS, resolveIDESettings, type IDESettings } from '../../shared/settings'
import type { AIChatMessage, AIEditResult, AISupportedModel } from '../../shared/ai'
import './App.css'

type ProjectSessionState = {
  openTabs: string[]
  activeTabPath?: string
}

type RecentOpenedItem = {
  type: 'project' | 'file'
  path: string
  label: string
}

type DebugBreakAccumulator = {
  file: string
  line: number
  variables: DebugPauseState['variables']
}

type ThemeDraftCloseIntent = 'close-button' | 'overlay' | 'escape' | 'app-exit'
type ThemeDraftCloseDecision = 'save' | 'discard' | 'continue'
type ThemeLifecycleSyncPayload = {
  config: ThemeConfigV2
  themes: string[]
  currentTheme: string
}
type ThemeManagerImportPrepareResult =
  | { status: 'canceled' }
  | { status: 'invalid'; diagnostics: ThemeImportValidationDiagnostic[] }
  | { status: 'conflict'; importedTheme: ThemeDefinition; existingThemeId: string; allowedDecisions: ThemeImportConflictDecision['decision'][] }
  | { status: 'ready'; importedTheme: ThemeDefinition; targetThemeId: string }

const RECENT_OPENED_KEY = 'ycide.recentOpened.v1'
const ACTIVITY_BAR_SIDE_KEY = 'ycide.activityBar.side.v1'
const AI_PANEL_OPEN_KEY = 'ycide.aiPanel.open.v1'
const LAST_PROJECT_EPP_KEY = 'ycide.lastProject.epp.v1'
const MAX_RECENT_OPENED = 10
const REQUIRED_THEME_COLOR_KEYS = [
  '--bg-primary',
  '--bg-secondary',
  '--bg-tertiary',
  '--bg-input',
  '--border-color',
  '--text-primary',
  '--text-secondary',
  '--accent',
  '--titlebar-bg',
  '--statusbar-bg',
]

const BUILTIN_LIGHT_THEME_ID = '默认浅色'

function isBuiltinThemeId(themeId: string): boolean {
  return themeId === BUILTIN_LIGHT_THEME_ID || themeId === BUILTIN_DARK_THEME_ID
}

const DEFAULT_THEME_TOKEN_PAYLOAD = createDefaultThemeTokenPayload()
const FLOW_LINE_TOKEN_KEYS = (THEME_TOKEN_GROUPS.find(group => group.id === 'flow-line')?.items || []).map(item => item.tokenKey)

type TargetPlatform = 'windows' | 'macos' | 'linux'
type TargetArch = 'x64' | 'x86' | 'arm64'
type ActivityBarSide = 'left' | 'right'

function normalizeTargetPlatform(value?: string | null): TargetPlatform {
  const normalized = (value || '').trim().toLowerCase()
  if (normalized === 'macos' || normalized === 'darwin' || normalized === 'mac' || normalized === 'osx') return 'macos'
  if (normalized === 'linux') return 'linux'
  if (normalized === 'windows' || normalized === 'win32') return 'windows'
  if (normalized === 'x64' || normalized === 'x86' || normalized === 'arm64') return 'windows'
  return 'windows'
}

function normalizeTargetArch(value?: string | null): TargetArch {
  const normalized = (value || '').trim().toLowerCase()
  if (normalized === 'x86') return 'x86'
  if (normalized === 'arm64') return 'arm64'
  return 'x64'
}

function coerceArchByPlatform(platform: TargetPlatform, arch: TargetArch): TargetArch {
  if (platform === 'macos') return 'arm64'
  return arch
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function inferAIEditableLanguage(filePath: string): EditorTab['language'] | null {
  const ext = (filePath.split('.').pop() || '').toLowerCase()
  if (ext === 'ecc') return 'eyc'
  if (ext === 'eyc' || ext === 'egv' || ext === 'ecs' || ext === 'edt' || ext === 'ell' || ext === 'erc') return ext
  return null
}

function isAIEditableFile(filePath: string): boolean {
  return inferAIEditableLanguage(filePath) !== null
}

/** 计算两文本之间的 diff 行信息，用于编辑器高亮 */
function computeDiffLineInfo(original: string, proposed: string): DiffLineInfo {
  const oldLines = original.replace(/\r\n/g, '\n').split('\n')
  const newLines = proposed.replace(/\r\n/g, '\n').split('\n')

  // 简单的 LCS (最长公共子序列) Myers diff
  const n = oldLines.length
  const m = newLines.length
  const max = n + m
  const v = new Int32Array(2 * max + 1)
  const trace: Int32Array[] = []

  // Forward pass
  outer:
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max])) {
        x = v[k + 1 + max]
      } else {
        x = v[k - 1 + max] + 1
      }
      let y = x - k
      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x++
        y++
      }
      v[k + max] = x
      if (x >= n && y >= m) break outer
    }
  }

  // Backtrack to get edit script
  type Edit = { type: 'keep' | 'delete' | 'insert'; oldIdx?: number; newIdx?: number }
  const edits: Edit[] = []
  let cx = n
  let cy = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const vp = trace[d]
    const k = cx - cy
    let prevK: number
    if (k === -d || (k !== d && vp[k - 1 + max] < vp[k + 1 + max])) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }
    const prevX = vp[prevK + max]
    const prevY = prevX - prevK

    // diagonal (equal lines)
    while (cx > prevX && cy > prevY) {
      cx--
      cy--
      edits.push({ type: 'keep', oldIdx: cx, newIdx: cy })
    }
    if (d > 0) {
      if (cx === prevX) {
        // insert
        cy--
        edits.push({ type: 'insert', newIdx: cy })
      } else {
        // delete
        cx--
        edits.push({ type: 'delete', oldIdx: cx })
      }
    }
  }

  edits.reverse()

  const addedLines: number[] = []
  const deletedGroups: Array<{ afterLine: number; text: string }> = []

  let newLineCounter = 0
  let pendingDeleted: string[] = []
  let lastNewLine = 0

  for (const edit of edits) {
    if (edit.type === 'keep') {
      if (pendingDeleted.length > 0) {
        deletedGroups.push({ afterLine: lastNewLine, text: pendingDeleted.join('\n') })
        pendingDeleted = []
      }
      newLineCounter++
      lastNewLine = newLineCounter
    } else if (edit.type === 'insert') {
      if (pendingDeleted.length > 0) {
        deletedGroups.push({ afterLine: lastNewLine, text: pendingDeleted.join('\n') })
        pendingDeleted = []
      }
      newLineCounter++
      lastNewLine = newLineCounter
      addedLines.push(newLineCounter)
    } else if (edit.type === 'delete') {
      pendingDeleted.push(oldLines[edit.oldIdx!])
    }
  }

  if (pendingDeleted.length > 0) {
    deletedGroups.push({ afterLine: lastNewLine, text: pendingDeleted.join('\n') })
  }

  return { addedLines, deletedGroups }
}

function computeTitlebarHeight(menuFontSize: number): number {
  const lineHeight = Math.ceil(menuFontSize * 1.35)
  return Math.round(clampNumber(lineHeight + 14, 30, 64))
}

function computeToolbarHeight(iconSize: number): number {
  return Math.round(clampNumber(iconSize * 1.5 + 12, 30, 68))
}

function normalizeResourceTableContent(raw: string): string {
  const nonEmptyLines = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => line.replace(/^(\s*)\.常量\b/, '$1.资源'))

  if (nonEmptyLines.length === 0) return '.版本 2\n'

  return `${nonEmptyLines.join('\n')}\n`
}

const DLL_DECL_PREFIX = '.DLL\u547D\u4EE4 '
const PARAM_DECL_PREFIX = '.\u53C2\u6570 '
const FLAG_OPTIONAL = '\u53EF\u7A7A'
const FLAG_BYREF = '\u4F20\u5740'
const FLAG_ARRAY = '\u6570\u7EC4'
const CATEGORY_DLL = 'DLL\u547D\u4EE4'
const LIB_CURRENT_PROJECT = '\u5F53\u524D\u9879\u76EE'
const DLL_DESC_BASE = 'DLL\u547D\u4EE4'
const NOT_FOUND_DESC = '\u672A\u5728\u5DF2\u52A0\u8F7D\u7684\u652F\u6301\u5E93\u4E2D\u627E\u5230\u6B64\u547D\u4EE4'

type ProjectDllCommandHint = {
  name: string
  returnType: string
  description: string
  params: CommandDetail['params']
}

function splitDeclCsv(text: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuote) {
      cur += ch
      if (ch === '"' || ch === '\u201d') inQuote = false
      continue
    }
    if (ch === '"' || ch === '\u201c') {
      inQuote = true
      cur += ch
      continue
    }
    if (ch === ',' || ch === '\uFF0C') {
      result.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  result.push(cur.trim())
  return result
}

function unquoteDeclField(value: string): string {
  const trimmed = (value || '').trim()
  if (!trimmed) return ''
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\u201c') && trimmed.endsWith('\u201d'))) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

function normalizeLookupCommandName(raw: string): string {
  let name = (raw || '').replace(/[\u200B\u200C\u200D\u2060]/g, '').trim()
  if (!name) return ''
  const fullParen = name.indexOf('\uFF08')
  if (fullParen >= 0) name = name.slice(0, fullParen).trim()
  const asciiParen = name.indexOf('(')
  if (asciiParen >= 0) name = name.slice(0, asciiParen).trim()
  if (name.includes('\u3002')) name = name.split('\u3002').pop() || name
  if (name.includes('.')) name = name.split('.').pop() || name
  return name.trim()
}

function parseProjectDllCommands(content: string, out: Map<string, ProjectDllCommandHint>, overwrite: boolean): void {
  const lines = (content || '').replace(/\r\n/g, '\n').split('\n')
  let currentName = ''

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '').trim()
    if (!line || line.startsWith("'") || line.startsWith('//')) continue

    if (line.startsWith(DLL_DECL_PREFIX)) {
      const fields = splitDeclCsv(line.slice(DLL_DECL_PREFIX.length))
      const name = normalizeLookupCommandName(fields[0] || '')
      if (!name) {
        currentName = ''
        continue
      }

      if (!out.has(name) || overwrite) {
        out.set(name, {
          name,
          returnType: (fields[1] || '').trim(),
          description: unquoteDeclField(fields.length > 5 ? fields.slice(5).join(',').trim() : ''),
          params: [],
        })
      }
      currentName = name
      continue
    }

    if (line.startsWith(PARAM_DECL_PREFIX)) {
      if (!currentName) continue
      const target = out.get(currentName)
      if (!target) continue

      const fields = splitDeclCsv(line.slice(PARAM_DECL_PREFIX.length))
      const paramName = (fields[0] || '').trim()
      if (!paramName) continue

      const flags = (fields[2] || '').trim()
      target.params.push({
        name: paramName,
        type: (fields[1] || '').trim(),
        description: unquoteDeclField(fields.length > 3 ? fields.slice(3).join(',').trim() : ''),
        optional: flags.includes(FLAG_OPTIONAL),
        isVariable: flags.includes(FLAG_BYREF),
        isArray: flags.includes(FLAG_ARRAY),
      })
      continue
    }

    // 允许 DLL 声明与参数之间插入“.版本 2”分隔行
    if (line.startsWith('.\u7248\u672C ')) continue
    if (line.startsWith('.')) currentName = ''
  }
}

function parseProjectDllCommandsByParsedLines(content: string, out: Map<string, ProjectDllCommandHint>, overwrite: boolean): void {
  const parsed = parseLines(content || '')
  let currentName = ''

  for (const ln of parsed) {
    if (ln.type === 'dll') {
      const name = normalizeLookupCommandName((ln.fields[0] || '').trim())
      if (!name) {
        currentName = ''
        continue
      }

      if (!out.has(name) || overwrite) {
        out.set(name, {
          name,
          returnType: (ln.fields[1] || '').trim(),
          description: unquoteDeclField(ln.fields.length > 5 ? ln.fields.slice(5).join(',').trim() : ''),
          params: [],
        })
      }
      currentName = name
      continue
    }

    if (ln.type === 'subParam') {
      if (!currentName) continue
      const target = out.get(currentName)
      if (!target) continue

      const paramName = (ln.fields[0] || '').trim()
      if (!paramName) continue
      const flags = (ln.fields[2] || '').trim()
      target.params.push({
        name: paramName,
        type: (ln.fields[1] || '').trim(),
        description: unquoteDeclField(ln.fields.length > 3 ? ln.fields.slice(3).join(',').trim() : ''),
        optional: flags.includes(FLAG_OPTIONAL),
        isVariable: flags.includes(FLAG_BYREF),
        isArray: flags.includes(FLAG_ARRAY),
      })
      continue
    }

    if (ln.type === 'version' || ln.type === 'supportLib') continue
    if (ln.type !== 'blank' && ln.type !== 'comment' && ln.type !== 'code') currentName = ''
  }
}

async function findProjectDllDetail(
  lookupName: string,
  projectDir: string,
  tabs: EditorTab[],
  joinPath: (dir: string, fileName: string) => string,
): Promise<CommandDetail | null> {
  const dllMap = new Map<string, ProjectDllCommandHint>()

  for (const tab of tabs) {
    if (!tab?.value) continue
    if (tab.language === 'ell' || tab.language === 'eyc' || tab.language === 'egv' || tab.language === 'ecs' || tab.language === 'edt' || tab.language === 'erc') {
      parseProjectDllCommandsByParsedLines(tab.value, dllMap, true)
      parseProjectDllCommands(tab.value, dllMap, true)
    }
  }

  if (projectDir) {
    const openedPaths = new Set(
      tabs
        .filter(t => !!t.filePath)
        .map(t => (t.filePath || '').replace(/\//g, '\\').toLowerCase()),
    )

    const files = await window.api?.file?.readDir(projectDir) as string[] | undefined
    if (files) {
      for (const f of files) {
        if (!f.toLowerCase().endsWith('.ell')) continue
        const fp = joinPath(projectDir, f)
        if (openedPaths.has(fp.replace(/\//g, '\\').toLowerCase())) continue
        const content = await window.api?.project?.readFile(fp)
        if (!content) continue
        parseProjectDllCommandsByParsedLines(content, dllMap, false)
        parseProjectDllCommands(content, dllMap, false)
      }
    }
  }

  const dll = dllMap.get(lookupName)
  if (!dll) return null

  return {
    name: dll.name,
    englishName: '',
    description: dll.description || (dll.returnType ? `${DLL_DESC_BASE}\uFF08\u8FD4\u56DE\uFF1A${dll.returnType}\uFF09` : DLL_DESC_BASE),
    returnType: dll.returnType || '',
    category: CATEGORY_DLL,
    libraryName: LIB_CURRENT_PROJECT,
    params: dll.params,
  }
}

function App(): React.JSX.Element {
  const runtimePlatform = (window.api?.system?.getRuntimePlatform?.() ?? 'windows') as RuntimePlatform
  const pathSeparator = runtimePlatform === 'windows' ? '\\' : '/'
  const joinPath = (dir: string, fileName: string): string => {
    const normalizedDir = (dir || '').replace(/[\\/]+$/, '')
    const normalizedFileName = (fileName || '').replace(/^[\\/]+/, '')
    return `${normalizedDir}${pathSeparator}${normalizedFileName}`
  }
  const getBaseName = (filePath: string): string => {
    const parts = (filePath || '').split(/[\\/]/)
    return parts[parts.length - 1] || filePath
  }
  const getDirName = (filePath: string): string => {
    const normalized = (filePath || '').replace(/[\\/]+$/, '')
    const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
    return idx >= 0 ? normalized.slice(0, idx) : ''
  }
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [outputHeight, setOutputHeight] = useState(200)
  const [showOutput, setShowOutput] = useState(true)
  const [showLibrary, setShowLibrary] = useState(false)
  const [showNewProject, setShowNewProject] = useState(false)
  const [showThemeSettings, setShowThemeSettings] = useState(false)
  const [showThemeManager, setShowThemeManager] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showAIPanel, setShowAIPanel] = useState(() => {
    try { return localStorage.getItem(AI_PANEL_OPEN_KEY) === 'true' } catch { return false }
  })
  const [ideSettings, setIdeSettings] = useState<IDESettings>(DEFAULT_IDE_SETTINGS)
  const themeManagerWindowRef = useRef<Window | null>(null)
  const [themeManagerPortalRoot, setThemeManagerPortalRoot] = useState<HTMLElement | null>(null)
  const settingsWindowRef = useRef<Window | null>(null)
  const [settingsPortalRoot, setSettingsPortalRoot] = useState<HTMLElement | null>(null)
  const settingsBaselineRef = useRef<IDESettings>(DEFAULT_IDE_SETTINGS)
  const [themeRepairMessage, setThemeRepairMessage] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selection, setSelection] = useState<SelectionTarget>(null)
  const [sidebarTab, setSidebarTab] = useState<'project' | 'library' | 'property'>('project')
  const [alignAction, setAlignAction] = useState<AlignAction>(null)
  const [multiSelectCount, setMultiSelectCount] = useState(0)
  const [openProjectFiles, setOpenProjectFiles] = useState<EditorTab[]>()
  const [projectTree, setProjectTree] = useState<TreeNode[]>([])
  const [currentProjectDir, setCurrentProjectDir] = useState<string>('')
  const currentProjectDirRef = useRef('')
  const editorRef = useRef<EditorHandle>(null)
  const [themeList, setThemeList] = useState<string[]>([])
  const [currentTheme, setCurrentTheme] = useState<string>('')
  const [themeManagerCommittedThemeId, setThemeManagerCommittedThemeId] = useState<string | null>(null)
  const [themeTokenValues, setThemeTokenValues] = useState<Record<string, string>>({ ...DEFAULT_THEME_TOKEN_PAYLOAD.tokenValues })
  const [themeFlowLine, setThemeFlowLine] = useState<ThemeTokenPayload['flowLine']>({ ...DEFAULT_THEME_TOKEN_PAYLOAD.flowLine })
  const [themeIconConfig, setThemeIconConfig] = useState<ThemeTokenPayload['icon']>({ ...DEFAULT_THEME_TOKEN_PAYLOAD.icon })
  const [themeDraftSession, setThemeDraftSession] = useState<ThemeDraftSession | null>(null)
  const [themeSaveFeedback, setThemeSaveFeedback] = useState<string | null>(null)
  const [activeFileId, setActiveFileId] = useState<string | null>(null)
  const [outputMessages, setOutputMessages] = useState<OutputMessage[]>([])
  const [debugPause, setDebugPause] = useState<DebugPauseState | null>(null)
  const [debugDisplayLine, setDebugDisplayLine] = useState<number | null>(null)
  const [debugResumePending, setDebugResumePending] = useState(false)
  const [commandDetail, setCommandDetail] = useState<CommandDetail | null>(null)
  const commandCacheRef = useRef<Map<string, CommandDetail | null>>(new Map())
  const [fileProblems, setFileProblems] = useState<FileProblem[]>([])
  const [designProblems, setDesignProblems] = useState<FileProblem[]>([])
  const openTabsRef = useRef<EditorTab[]>([])
  const activeFileIdRef = useRef<string | null>(null)
  const [cursorLine, setCursorLine] = useState<number | undefined>(undefined)
  const [cursorSourceLine, setCursorSourceLine] = useState<number | undefined>(undefined)
  const [cursorColumn, setCursorColumn] = useState<number | undefined>(undefined)
  const [docType, setDocType] = useState('')
  const [isCompiling, setIsCompiling] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [forceOutputTab, setForceOutputTab] = useState<'compile' | 'problems' | 'debug' | null>(null)
  const [breakpointsByFile, setBreakpointsByFile] = useState<Record<string, number[]>>({})
  const debugBreakAccumRef = useRef<DebugBreakAccumulator | null>(null)
  const openFileByPathRef = useRef<(filePath: string, targetLine?: number) => Promise<boolean>>(async () => false)
  const themeNoticeKeysRef = useRef<Set<string>>(new Set())
  const [targetPlatform, setTargetPlatform] = useState<TargetPlatform>('windows')
  const [targetArch, setTargetArch] = useState<TargetArch>('x64')
  const [recentOpened, setRecentOpened] = useState<RecentOpenedItem[]>([])
  const [activityBarSide, setActivityBarSide] = useState<ActivityBarSide>(() => {
    try {
      const raw = localStorage.getItem(ACTIVITY_BAR_SIDE_KEY)
      return raw === 'right' ? 'right' : 'left'
    } catch {
      return 'left'
    }
  })
  const [activityBarContextMenu, setActivityBarContextMenu] = useState<{ x: number; y: number } | null>(null)
  const isWorkspaceEmpty = !currentProjectDir && (openProjectFiles?.length ?? 0) === 0

  const pushRecentOpened = useCallback((item: RecentOpenedItem) => {
    setRecentOpened(prev => {
      const lowerPath = item.path.toLowerCase()
      const next = [
        item,
        ...prev.filter(p => !(p.type === item.type && p.path.toLowerCase() === lowerPath)),
      ].slice(0, MAX_RECENT_OPENED)
      try {
        localStorage.setItem(RECENT_OPENED_KEY, JSON.stringify(next))
      } catch {
        // 忽略持久化异常
      }
      return next
    })
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_OPENED_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return
      const normalized = parsed
        .filter((x): x is RecentOpenedItem => !!x && typeof x === 'object'
          && (x as RecentOpenedItem).type !== undefined
          && ((x as RecentOpenedItem).type === 'project' || (x as RecentOpenedItem).type === 'file')
          && typeof (x as RecentOpenedItem).path === 'string'
          && typeof (x as RecentOpenedItem).label === 'string')
        .slice(0, MAX_RECENT_OPENED)
      setRecentOpened(normalized)
    } catch {
      // 忽略无效缓存
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVITY_BAR_SIDE_KEY, activityBarSide)
    } catch {
      // 忽略持久化异常
    }
  }, [activityBarSide])

  useEffect(() => {
    if (!activityBarContextMenu) return
    const close = (): void => setActivityBarContextMenu(null)
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
  }, [activityBarContextMenu])

  // 加载系统设置
  useEffect(() => {
    void (async () => {
      try {
        const saved = await window.api?.settings?.get()
        if (saved) setIdeSettings(resolveIDESettings(saved))
      } catch { /* ignore */ }
    })()
  }, [])

  // 应用系统设置到 CSS 变量
  useEffect(() => {
    const root = document.documentElement
    const uiScale = clampNumber(ideSettings.fontSize / 13, 0.75, 2)
    const fontSizeSmall = Math.round(clampNumber(ideSettings.fontSize * 0.88, 10, 22))
    const spacingXs = Math.max(1, Math.round(2 * uiScale))
    const spacingSm = Math.max(2, Math.round(4 * uiScale))
    const spacingMd = Math.max(4, Math.round(8 * uiScale))
    const spacingLg = Math.max(6, Math.round(12 * uiScale))
    const spacingXl = Math.max(8, Math.round(16 * uiScale))
    const statusbarHeight = Math.round(clampNumber(fontSizeSmall + 12, 22, 40))
    const sidebarHeaderHeight = Math.round(clampNumber(fontSizeSmall + 16, 26, 44))
    const treeRowHeight = Math.round(clampNumber(ideSettings.fontSize + 10, 22, 42))
    const panelControlHeight = Math.round(clampNumber(ideSettings.fontSize + 10, 22, 40))
    const outputHeaderHeight = Math.round(clampNumber(fontSizeSmall + 16, 26, 42))
    const outputIconButtonSize = Math.round(clampNumber(fontSizeSmall + 10, 20, 36))
    const treeIndentBase = spacingMd
    const treeIndentStep = Math.round(clampNumber(16 * uiScale, 12, 28))
    const activityIconSize = ideSettings.toolbarIconSize
    const activityButtonSize = Math.round(clampNumber(activityIconSize + 14, 28, 54))
    const activityBarWidth = Math.round(activityButtonSize + 10)

    const titlebarHeight = computeTitlebarHeight(ideSettings.titlebarMenuFontSize)
    const toolbarHeight = computeToolbarHeight(ideSettings.toolbarIconSize)
    const toolbarButtonSize = Math.round(Math.max(24, toolbarHeight - 8))
    const toolbarSelectHeight = Math.round(Math.max(22, toolbarHeight - 14))
    const editorLineHeight = Math.max(ideSettings.editorLineHeight, ideSettings.editorFontSize + 2)

    root.style.setProperty('--titlebar-height', `${titlebarHeight}px`)
    root.style.setProperty('--toolbar-height', `${toolbarHeight}px`)
    root.style.setProperty('--toolbar-button-size', `${toolbarButtonSize}px`)
    root.style.setProperty('--toolbar-select-height', `${toolbarSelectHeight}px`)
    root.style.setProperty('--toolbar-icon-size', `${ideSettings.toolbarIconSize}px`)
    root.style.setProperty('--titlebar-menu-font-family', ideSettings.titlebarMenuFontFamily)
    root.style.setProperty('--titlebar-menu-font-size', `${ideSettings.titlebarMenuFontSize}px`)
    root.style.setProperty('--font-family', ideSettings.fontFamily)
    root.style.setProperty('--font-size', `${ideSettings.fontSize}px`)
    root.style.setProperty('--font-size-small', `${fontSizeSmall}px`)
    root.style.setProperty('--spacing-xs', `${spacingXs}px`)
    root.style.setProperty('--spacing-sm', `${spacingSm}px`)
    root.style.setProperty('--spacing-md', `${spacingMd}px`)
    root.style.setProperty('--spacing-lg', `${spacingLg}px`)
    root.style.setProperty('--spacing-xl', `${spacingXl}px`)
    root.style.setProperty('--statusbar-height', `${statusbarHeight}px`)
    root.style.setProperty('--sidebar-header-height', `${sidebarHeaderHeight}px`)
    root.style.setProperty('--tree-row-height', `${treeRowHeight}px`)
    root.style.setProperty('--panel-control-height', `${panelControlHeight}px`)
    root.style.setProperty('--sidebar-tab-font-size', `${ideSettings.fontSize}px`)
    root.style.setProperty('--output-header-height', `${outputHeaderHeight}px`)
    root.style.setProperty('--output-icon-button-size', `${outputIconButtonSize}px`)
    root.style.setProperty('--tree-indent-base', `${treeIndentBase}px`)
    root.style.setProperty('--tree-indent-step', `${treeIndentStep}px`)
    root.style.setProperty('--activity-icon-size', `${activityIconSize}px`)
    root.style.setProperty('--activity-button-size', `${activityButtonSize}px`)
    root.style.setProperty('--activity-bar-width', `${activityBarWidth}px`)
    root.style.setProperty('--editor-font-family', ideSettings.editorFontFamily)
    root.style.setProperty('--editor-font-size', `${ideSettings.editorFontSize}px`)
    root.style.setProperty('--editor-line-height', `${editorLineHeight}px`)
  }, [ideSettings])

  useEffect(() => {
    if (runtimePlatform !== 'macos') return
    window.api?.system?.updateRecentOpened?.(recentOpened)
  }, [recentOpened, runtimePlatform])

  useEffect(() => {
    if (runtimePlatform !== 'macos') return
    window.api?.system?.updateThemes?.({ themes: themeList, currentTheme })
  }, [themeList, currentTheme, runtimePlatform])

  const toggleBreakpoint = useCallback((tabId?: string | null, line?: number) => {
    const fileId = tabId || activeFileIdRef.current
    if (!fileId || !line || line <= 0) return
    const fileKey = getBaseName(fileId)
    const editorFiles = editorRef.current?.getEditorFiles?.() || {}
    const content = editorFiles[fileKey]
    const normalizedLine = (() => {
      if (!content) return line
      const lines = content.replace(/\r\n/g, '\n').split('\n')
      const normalizeLineText = (raw: string) => raw.replace(/[\u200B\u200C\u200D\u2060]/g, '').trim()
      const startIndex = Math.max(0, Math.min(lines.length - 1, line - 1))
      for (let i = startIndex; i < lines.length; i++) {
        if (normalizeLineText(lines[i]) !== '') return i + 1
      }
      for (let i = startIndex - 1; i >= 0; i--) {
        if (normalizeLineText(lines[i]) !== '') return i + 1
      }
      return line
    })()
    setBreakpointsByFile(prev => {
      const current = prev[fileKey] || []
      const exists = current.includes(normalizedLine)
      const nextLines = exists ? current.filter(v => v !== normalizedLine) : [...current, normalizedLine].sort((a, b) => a - b)
      const next = { ...prev }
      if (nextLines.length > 0) next[fileKey] = nextLines
      else delete next[fileKey]
      return next
    })
  }, [])

  const continueDebugRun = useCallback(async () => {
    const ok = await window.api.debug.continue()
    if (ok) {
      setDebugResumePending(true)
      setShowOutput(true)
    }
  }, [])

  const syncDebugDisplayLine = useCallback((sourceLine: number) => {
    if (!sourceLine || sourceLine <= 0) {
      setDebugDisplayLine(null)
      return
    }
    const update = () => {
      const visibleLine = editorRef.current?.getVisibleLineForSourceLine(sourceLine) ?? sourceLine
      setDebugDisplayLine(visibleLine)
    }
    update()
    window.setTimeout(update, 80)
    window.setTimeout(update, 180)
  }, [])

  // 监听编译器输出
  useEffect(() => {
    const handleOutput = (msg: OutputMessage) => {
      const text = msg.text || ''
      if (text.startsWith('__YCDBG_BREAK_BEGIN__|')) {
        const [, file = '', lineText = '0'] = text.split('|')
        setDebugResumePending(true)
        debugBreakAccumRef.current = {
          file,
          line: Number.parseInt(lineText, 10) || 0,
          variables: [],
        }
        return
      }
      if (text.startsWith('__YCDBG_VAR__|')) {
        const current = debugBreakAccumRef.current
        if (current) {
          const [, name = '', type = '', ...rest] = text.split('|')
          current.variables.push({ name, type, value: rest.join('|') })
        }
        return
      }
      if (text === '__YCDBG_BREAK_END__') {
        const current = debugBreakAccumRef.current
        if (current) {
          debugBreakAccumRef.current = null
          const pauseState: DebugPauseState = {
            file: current.file,
            line: current.line,
            variables: current.variables,
          }
          setDebugResumePending(false)
          setDebugPause(pauseState)
          setShowOutput(true)
          const projectDir = currentProjectDirRef.current
          if (projectDir && current.file) {
            void openFileByPathRef.current(joinPath(projectDir, current.file), current.line)
          }
          syncDebugDisplayLine(current.line)
        }
        return
      }
      setOutputMessages(prev => [...prev, msg])
    }
    window.api.on('compiler:output', handleOutput)
    return () => { window.api.off('compiler:output') }
  }, [joinPath, syncDebugDisplayLine])

  // 监听程序退出
  useEffect(() => {
    const handleExit = () => {
      setIsRunning(false)
      setDebugDisplayLine(null)
      setDebugResumePending(false)
      setDebugPause(null)
      debugBreakAccumRef.current = null
    }
    window.api.on('compiler:processExit', handleExit)
    return () => { window.api.off('compiler:processExit') }
  }, [])

  useEffect(() => {
    if (!debugPause || !activeFileId) return
    if (getBaseName(activeFileId).toLowerCase() !== debugPause.file.toLowerCase()) return
    syncDebugDisplayLine(debugPause.line)
  }, [activeFileId, debugPause, syncDebugDisplayLine])

  // 检查设计时诊断：扫描所有 efw 标签页中的控件类型，找出依赖库未加载的
  const checkDesignProblems = useCallback(async (tabs: EditorTab[]) => {
    try {
      const units = await window.api.library.getWindowUnits() as Array<{ name: string; englishName?: string }>
      const knownTypes = new Set<string>(
        units.flatMap(u => [u.name, u.englishName].filter((n): n is string => !!n))
      )
      const problems: FileProblem[] = []
      for (const tab of tabs) {
        if (tab.language !== 'efw' || !tab.formData) continue
        for (const ctrl of tab.formData.controls) {
          if (!knownTypes.has(ctrl.type)) {
            problems.push({
              line: 0,
              column: 0,
              severity: 'error',
              file: tab.label,
              message: `窗口“${tab.formData.name}”中的控件“${ctrl.name}”(${ctrl.type})所依赖的支持库未加载`,
            })
          }
        }
      }
      setDesignProblems(problems)
    } catch {
      // 无法获取窗口单元列表时忽略
    }
  }, [])

  // 硬件加载或卸载时重新检查
  const handleLibraryChange = useCallback(() => {
    commandCacheRef.current.clear()
    checkDesignProblems(openTabsRef.current)
  }, [checkDesignProblems])

  // 编译运行
  const handleCompileRun = useCallback(async () => {
    if (!currentProjectDir || isCompiling) return
    if (debugPause) {
      await continueDebugRun()
      return
    }
    // 有无效命令时阻断运行，切换到问题面板
    if (fileProblems.length > 0 || designProblems.length > 0) {
      setShowOutput(true)
      setForceOutputTab('problems')
      setTimeout(() => setForceOutputTab(null), 100)
      return
    }
    setIsCompiling(true)
    editorRef.current?.save()
    setOutputMessages([])
    setShowOutput(true)
    setForceOutputTab('compile')
    setDebugResumePending(false)
    setDebugDisplayLine(null)
    setDebugPause(null)
    debugBreakAccumRef.current = null
    const editorFiles = editorRef.current?.getEditorFiles()
    const result = await window.api.compiler.run(currentProjectDir, editorFiles, targetArch, { breakpoints: breakpointsByFile })
    setIsCompiling(false)
    setForceOutputTab(null)
    if (result?.success) setIsRunning(true)
  }, [currentProjectDir, isCompiling, targetArch, fileProblems, designProblems, debugPause, continueDebugRun, breakpointsByFile])

  // 普通编译
  const handleCompile = useCallback(async () => {
    if (!currentProjectDir || isCompiling) return
    if (fileProblems.length > 0 || designProblems.length > 0) {
      setShowOutput(true)
      setForceOutputTab('problems')
      setTimeout(() => setForceOutputTab(null), 100)
      return
    }
    setIsCompiling(true)
    editorRef.current?.save()
    setOutputMessages([])
    setShowOutput(true)
    setForceOutputTab('compile')
    const editorFiles = editorRef.current?.getEditorFiles()
    await window.api.compiler.compile(currentProjectDir, editorFiles, targetArch)
    setIsCompiling(false)
    setForceOutputTab(null)
  }, [currentProjectDir, isCompiling, targetArch, fileProblems, designProblems])

  // 停止运行
  const handleStop = useCallback(() => {
    window.api.compiler.stop()
    setIsRunning(false)
    setDebugResumePending(false)
    setDebugDisplayLine(null)
    setDebugPause(null)
    debugBreakAccumRef.current = null
  }, [])

  // 命令点击：查找命令详情
  const [highlightParamIndex, setHighlightParamIndex] = useState<number | undefined>(undefined)

  const handleCommandClick = useCallback(async (commandName: string, paramIndex?: number) => {
    const builtinTypeDescriptions: Record<string, string> = {
      '字节型': '可容纳 0 到 255 之间的数值。',
      '短整数型': '可容纳 -32768 到 32767 之间的数值。',
      '整数型': '可容纳 -2147483648 到 2147483647 之间的数值。',
      '长整数型': '可容纳更大范围的整数值（64位）。',
      '小数型': '单精度浮点数。',
      '双精度小数型': '双精度浮点数。',
      '逻辑型': '布尔值，仅可为真或假。',
      '文本型': '文本字符串类型。',
      '日期时间型': '日期与时间类型。',
      '字节集': '可变长二进制字节数据。',
      '子程序指针': '可指向子程序以便间接调用。',
      '通用型': '可承载多种类型的值。',
    }

    if (commandName.startsWith('__TYPE__:')) {
      const typeName = commandName.slice('__TYPE__:'.length).trim()
      if (!typeName) return
      setHighlightParamIndex(undefined)
      setCommandDetail({
        name: typeName,
        englishName: '',
        description: builtinTypeDescriptions[typeName] || `数据类型“${typeName}”`,
        returnType: '',
        category: '数据类型',
        libraryName: '项目/基础类型',
        params: [],
      })
      setShowOutput(true)
      return
    }

    if (commandName.startsWith('__PARAM__:')) {
      const payload = commandName.slice('__PARAM__:'.length)
      const [paramName = '', paramType = '', ownerSub = ''] = payload.split(':')
      if (!paramName) return
      setHighlightParamIndex(undefined)
      const desc = ownerSub
        ? `参数“${paramName}”的数据类型为“${paramType || '通用型'}”，所属子程序“${ownerSub}”。`
        : `参数“${paramName}”的数据类型为“${paramType || '通用型'}”。`
      setCommandDetail({
        name: paramName,
        englishName: '',
        description: desc,
        returnType: paramType || '',
        category: '参数',
        libraryName: '当前源码',
        params: [],
      })
      setShowOutput(true)
      return
    }

    if (commandName.startsWith('__SUBDECL__:')) {
      const payload = commandName.slice('__SUBDECL__:'.length)
      const sep = payload.indexOf(':')
      const subName = (sep >= 0 ? payload.slice(0, sep) : payload).trim()
      const assemblyName = (sep >= 0 ? payload.slice(sep + 1) : '').trim()
      if (!subName) return

      const parseEventSub = (name: string): { targetName: string; eventName: string } | null => {
        if (!name.startsWith('_')) return null
        const last = name.lastIndexOf('_')
        if (last <= 1 || last >= name.length - 1) return null
        return {
          targetName: name.slice(1, last).trim(),
          eventName: name.slice(last + 1).trim(),
        }
      }

      const normalize = (v: string): string => (v || '').replace(/^_+/, '').trim()
      const parsedEvent = parseEventSub(subName)
      let eventDescription = ''
      if (parsedEvent) {
        const tabs = openTabsRef.current || []
        const efwTabs = tabs.filter(t => t.language === 'efw' && t.formData)
        const formTab = efwTabs.find(t => {
          const formName = t.formData?.name || ''
          if (!assemblyName) return normalize(formName) === normalize(parsedEvent.targetName)
          return assemblyName.includes(formName) || assemblyName.includes(normalize(formName))
        })
        const formData = formTab?.formData
        if (formData) {
          const control = formData.controls.find(c => normalize(c.name) === normalize(parsedEvent.targetName))
          const targetType = control ? control.type : '窗口'
          try {
            const windowUnits = await window.api.library.getWindowUnits() as Array<{
              name: string
              englishName?: string
              events?: Array<{ name: string; description?: string }>
            }>
            const unit = windowUnits.find((u) => u.name === targetType || u.englishName === targetType)
            const ev = unit?.events?.find((e) => e.name === parsedEvent.eventName)
            eventDescription = ev?.description || ''
          } catch {
            // 忽略描述解析失败，回退到通用提示
          }
        }
      }

      setHighlightParamIndex(paramIndex)
      setCommandDetail({
        name: subName,
        englishName: '',
        description: '',
        returnType: '',
        category: '子程序',
        libraryName: '当前源码',
        assemblyName,
        isEventSubroutine: !!eventDescription,
        eventDescription,
        params: [],
      })
      setShowOutput(true)
      return
    }

    if (commandName.startsWith('__SUB__:')) {
      const payload = commandName.slice('__SUB__:'.length)
      const sep = payload.indexOf(':')
      const subName = (sep >= 0 ? payload.slice(0, sep) : payload).trim()
      const assemblyName = (sep >= 0 ? payload.slice(sep + 1) : '').trim()
      if (!subName) return
      setHighlightParamIndex(paramIndex)
      setCommandDetail({
        name: subName,
        englishName: '',
        description: '',
        returnType: '',
        category: '子程序',
        libraryName: '当前源码',
        assemblyName,
        isEventSubroutine: false,
        eventDescription: '',
        params: [],
      })
      setShowOutput(true)
      return
    }

    // 对象.方法 形式，取方法名
    const name = normalizeLookupCommandName(commandName)
    if (!name) return
    setHighlightParamIndex(paramIndex)

    // 先查缓存
    if (commandCacheRef.current.has(name)) {
      const cached = commandCacheRef.current.get(name)!
      setCommandDetail(cached)
      setShowOutput(true)
      return
    }

    // 从支持库加载全部命令并查找
    const allCommands = await window.api.library.getAllCommands()
    const cmd = allCommands.find((c: CommandDetail) => c.name === name || (c.englishName || '').trim() === name)
    if (cmd) {
      const detail: CommandDetail = {
        name: cmd.name,
        englishName: cmd.englishName,
        description: cmd.description,
        returnType: cmd.returnType,
        category: cmd.category,
        libraryName: cmd.libraryName || '',
        params: cmd.params,
      }
      commandCacheRef.current.set(name, detail)
      setCommandDetail(detail)
    } else {
      const projectDllDetail = await findProjectDllDetail(name, currentProjectDirRef.current, openTabsRef.current || [], joinPath)
      if (projectDllDetail) {
        setCommandDetail(projectDllDetail)
      } else {
        setCommandDetail({ name, englishName: '', description: NOT_FOUND_DESC, returnType: '', category: '', libraryName: '', params: [] })
      }
    }
    setShowOutput(true)
  }, [])

  const handleCommandClear = useCallback(() => {
    setCommandDetail(null)
  }, [])

  const pushThemeNotice = useCallback((key: string, text: string, type: OutputMessage['type'] = 'warning', once = true) => {
    if (once && themeNoticeKeysRef.current.has(key)) return
    if (once) themeNoticeKeysRef.current.add(key)
    setOutputMessages(prev => [...prev, { type, text }])
    setShowOutput(true)
  }, [])

  const handleThemeWarning = useCallback((warning: { code: string; message: string }) => {
    pushThemeNotice(`theme-warning:${warning.code}`, `[主题] ${warning.message}`, warning.code === 'legacy_migrated' ? 'info' : 'warning')
    if (warning.code === 'repair_required') {
      setThemeDraftSession(null)
      setThemeSaveFeedback(null)
      setThemeRepairMessage(warning.message)
      setShowThemeManager(true)
    }
  }, [pushThemeNotice])

  const renameThemeInDraftSession = useCallback((oldThemeId: string, newThemeId: string) => {
    setThemeDraftSession(prev => {
      if (!prev) return prev
      const matchWorking = prev.workingThemeId === oldThemeId
      const matchEntry = prev.entrySnapshot.themeId === oldThemeId
      const hasHistoryMatch = prev.history.some(item => item.themeId === oldThemeId)
      if (!matchWorking && !matchEntry && !hasHistoryMatch) return prev
      return {
        ...prev,
        workingThemeId: matchWorking ? newThemeId : prev.workingThemeId,
        entrySnapshot: matchEntry
          ? { ...prev.entrySnapshot, themeId: newThemeId }
          : prev.entrySnapshot,
        history: prev.history.map(item => (
          item.themeId === oldThemeId
            ? { ...item, themeId: newThemeId }
            : item
        )),
      }
    })
  }, [])

  const persistCurrentThemePayload = useCallback(async (themeId: string, payload: ThemeTokenPayload) => {
    try {
      await window.api?.theme?.saveCurrent(themeId, payload)
    } catch {
      pushThemeNotice('theme-persist-failed', '[主题] 当前主题配置未能写入，建议重启应用后重试。')
    }
  }, [pushThemeNotice])

  const getDefaultThemePayload = useCallback(async (themeId: string): Promise<ThemeTokenPayload> => {
    const loaded = await window.api?.theme?.load(themeId)
    return createDefaultThemeTokenPayload(loaded?.colors || themeTokenValues)
  }, [themeTokenValues])

  const applyThemeTokenValuesToRoot = useCallback((tokenValues: Record<string, string>) => {
    const root = document.documentElement
    for (const [key, value] of Object.entries(tokenValues)) {
      try {
        root.style.setProperty(key, value)
      } catch {
        // 保持部分应用，后续给出提示
      }
    }
  }, [])

  const applyFlowLineConfigToRoot = useCallback((flowLine: ThemeTokenPayload['flowLine']) => {
    const root = document.documentElement
    const mode = flowLine.mode === 'multi' ? 'multi' : 'single'
    const activeMainColor = mode === 'multi' ? flowLine.multi.mainColor : flowLine.single.mainColor
    root.style.setProperty('--flow-line-mode', mode)
    root.style.setProperty('--flow-line-main', activeMainColor)
    root.style.setProperty('--flow-line-depth-hue-step', String(flowLine.multi.depthHueStep))
    root.style.setProperty('--flow-line-depth-saturation-step', String(flowLine.multi.depthSaturationStep))
    root.style.setProperty('--flow-line-depth-lightness-step', String(flowLine.multi.depthLightnessStep))
  }, [])

  // 加载主题列表和当前主题
  const applyTheme = useCallback(async (name: string, persist = true, incomingPayload?: ThemeTokenPayload | null): Promise<ThemeTokenPayload | null> => {
    const theme = await window.api?.theme?.load(name)
    if (!theme?.colors) {
      pushThemeNotice('theme-apply-load-failed', '[主题] 主题未能完整加载，当前状态可能不完整。建议重启应用后重试。')
      return null
    }

    let payload = resolveThemeTokenPayload(incomingPayload, theme.colors)
    if (persist) {
      try {
        await window.api?.theme?.setCurrent(name)
        const current = await window.api?.theme?.getCurrent()
        if (current?.effectiveThemeId === name && !isBuiltinThemeId(name)) {
          payload = resolveThemeTokenPayload(current.themePayload, theme.colors)
        }
      } catch {
        pushThemeNotice('theme-persist-failed', '[主题] 当前主题未能写入配置，建议重启应用后重试。')
      }
    } else if (!incomingPayload) {
      // 预览模式下也需要从已持久化的 payload 中读取 icon 等配置
      try {
        const current = await window.api?.theme?.getCurrent()
        const savedPayload = current?.config?.themePayloads?.[name]
        if (savedPayload) {
          payload = resolveThemeTokenPayload(savedPayload, theme.colors)
        }
      } catch { /* ignore */ }
    }

    // 内置主题始终以主题文件色值为准，避免历史 payload 覆盖标题栏等关键令牌。
    if (isBuiltinThemeId(name)) {
      payload = resolveThemeTokenPayload({ tokenValues: theme.colors, flowLine: payload.flowLine, icon: payload.icon }, theme.colors)
    }

    const root = document.documentElement
    let appliedCount = 0
    for (const [key, value] of Object.entries(theme.colors)) {
      try {
        root.style.setProperty(key, value as string)
        appliedCount++
      } catch {
        // 保持部分应用，后续给出重启建议
      }
    }
    applyThemeTokenValuesToRoot(payload.tokenValues)
    applyFlowLineConfigToRoot(payload.flowLine)
    setThemeTokenValues(payload.tokenValues)
    setThemeFlowLine(payload.flowLine)
    setThemeIconConfig(payload.icon)
    setCurrentTheme(name)

    const missingRequired = REQUIRED_THEME_COLOR_KEYS.filter(key => !(key in theme.colors))
    if (appliedCount === 0 || missingRequired.length > 0) {
      pushThemeNotice('theme-partial-apply', `[主题] 主题“${name}”仅部分生效，建议重启应用以完成应用。${missingRequired.length > 0 ? `缺失变量：${missingRequired.join(', ')}` : ''}`)
    }
    if (persist) {
      await persistCurrentThemePayload(name, payload)
    }
    if (themeRepairMessage) setThemeRepairMessage(null)
    return payload
  }, [applyFlowLineConfigToRoot, applyThemeTokenValuesToRoot, persistCurrentThemePayload, pushThemeNotice, themeRepairMessage])

  const syncThemeLifecycleState = useCallback(async (
    payload: ThemeLifecycleSyncPayload,
    notice?: string | null
  ): Promise<ThemeTokenPayload | null> => {
    setThemeList(payload.themes || [])
    const nextPayload = payload.config?.themePayloads?.[payload.currentTheme]
    const applied = await applyTheme(payload.currentTheme, false, nextPayload)
    if (notice) {
      pushThemeNotice(`theme-manager-notice:${payload.currentTheme}`, `[主题] ${notice}`, 'info', false)
    }
    return applied
  }, [applyTheme, pushThemeNotice])

  const applyThemeDraftChange = useCallback((nextThemePayload: ThemeTokenPayload, targetThemeId?: string) => {
    const workingThemeId = targetThemeId || currentTheme
    if (!workingThemeId) return
    const payload = resolveThemeTokenPayload({ tokenValues: themeTokenValues, flowLine: themeFlowLine, icon: themeIconConfig }, themeTokenValues)
    if (!themeDraftSession) {
      setThemeDraftSession(createThemeDraftSession(workingThemeId, payload))
    }
    const nextPayload = resolveThemeTokenPayload(nextThemePayload, nextThemePayload.tokenValues)
    applyThemeTokenValuesToRoot(nextPayload.tokenValues)
    applyFlowLineConfigToRoot(nextPayload.flowLine)
    setThemeTokenValues(nextPayload.tokenValues)
    setThemeFlowLine(nextPayload.flowLine)
    setThemeIconConfig(nextPayload.icon)
    setThemeDraftSession(prev => {
      const baseSession = prev ?? createThemeDraftSession(workingThemeId, payload)
      const nextHistory = baseSession.history
        .slice(0, baseSession.historyCursor + 1)
        .concat([{ themeId: workingThemeId, payload: nextPayload }])
      return {
        ...baseSession,
        workingThemeId,
        workingPayload: nextPayload,
        dirty: true,
        history: nextHistory,
        historyCursor: nextHistory.length - 1,
      }
    })
  }, [applyFlowLineConfigToRoot, applyThemeTokenValuesToRoot, currentTheme, themeDraftSession, themeFlowLine, themeIconConfig, themeTokenValues])

  const buildAutoCopiedThemeName = useCallback((baseThemeId: string): string => {
    const normalizedBase = `${baseThemeId}-副本`
    const existing = new Set(themeList)
    if (!existing.has(normalizedBase)) return normalizedBase
    let suffix = 2
    while (existing.has(`${normalizedBase}-${suffix}`)) {
      suffix++
    }
    return `${normalizedBase}-${suffix}`
  }, [themeList])

  const ensureEditableThemeId = useCallback(async (): Promise<string | null> => {
    if (!currentTheme) return null
    if (!isBuiltinThemeId(currentTheme)) return currentTheme

    const autoThemeName = buildAutoCopiedThemeName(currentTheme)
    const saveResult = await window.api?.theme?.saveAsCustom({
      name: autoThemeName,
      sourceThemeId: currentTheme,
      themePayload: resolveThemeTokenPayload({ tokenValues: themeTokenValues, flowLine: themeFlowLine, icon: themeIconConfig }, themeTokenValues),
    }) as SaveAsCustomThemeResult | undefined
    if (!saveResult) {
      setThemeSaveFeedback('创建内置主题副本失败，请稍后重试。')
      return null
    }
    if (!saveResult.success) {
      setThemeSaveFeedback(saveResult.message || '创建内置主题副本失败，请稍后重试。')
      return null
    }

    const payload = await applyTheme(saveResult.themeId, false, saveResult.themePayload)
    if (!payload) {
      setThemeSaveFeedback(`主题“${saveResult.themeId}”创建成功，但激活失败，请重新选择该主题。`)
      return null
    }

    setThemeList(prev => prev.includes(saveResult.themeId) ? prev : [...prev, saveResult.themeId])
    setThemeDraftSession(createThemeDraftSession(saveResult.themeId, payload))
    setThemeSaveFeedback(`已自动基于“${currentTheme}”创建可编辑副本“${saveResult.themeId}”。`)
    return saveResult.themeId
  }, [applyTheme, buildAutoCopiedThemeName, currentTheme, themeFlowLine, themeIconConfig, themeTokenValues])

  const canUndoThemeDraft = (themeDraftSession?.historyCursor ?? 0) > 0

  const handleThemeDraftUndo = useCallback(async () => {
    if (!themeDraftSession) return
    if (themeDraftSession.historyCursor <= 0) return
    const nextCursor = themeDraftSession.historyCursor - 1
    const snapshot = themeDraftSession.history[nextCursor]
    if (!snapshot) return
    const restoredPayload = await applyTheme(snapshot.themeId, false, snapshot.payload)
    if (!restoredPayload) return
    setThemeDraftSession(prev => {
      if (!prev) return prev
      return {
        ...prev,
        workingThemeId: snapshot.themeId,
        workingPayload: restoredPayload,
        dirty: nextCursor > 0,
        historyCursor: nextCursor,
      }
    })
  }, [applyTheme, themeDraftSession])

  const handleThemeDraftRestoreBaseline = useCallback(async () => {
    if (!themeDraftSession) return
    const baselineSnapshot = themeDraftSession.entrySnapshot
    const restoredPayload = await applyTheme(baselineSnapshot.themeId, false, baselineSnapshot.payload)
    if (!restoredPayload) return
    setThemeDraftSession(prev => {
      if (!prev) return prev
      return {
        ...prev,
        workingThemeId: baselineSnapshot.themeId,
        workingPayload: restoredPayload,
        dirty: false,
        historyCursor: 0,
      }
    })
  }, [applyTheme, themeDraftSession])

  const handleThemeTokenChange = useCallback((tokenKey: string, value: string) => {
    void (async () => {
      const editableThemeId = await ensureEditableThemeId()
      if (!editableThemeId) return
      const nextTokenValues = { ...themeTokenValues, [tokenKey]: value }
      const payload = resolveThemeTokenPayload({ tokenValues: nextTokenValues, flowLine: themeFlowLine, icon: themeIconConfig }, nextTokenValues)
      applyThemeDraftChange(payload, editableThemeId)
    })()
  }, [applyThemeDraftChange, ensureEditableThemeId, themeFlowLine, themeIconConfig, themeTokenValues])

  const handleThemeFlowLineModeChange = useCallback((mode: FlowLineMode) => {
    void (async () => {
      const editableThemeId = await ensureEditableThemeId()
      if (!editableThemeId) return
      const currentMainColor = themeFlowLine.mode === 'multi'
        ? themeFlowLine.multi.mainColor
        : themeFlowLine.single.mainColor
      const nextFlowLine = mode === 'multi'
        ? { ...themeFlowLine, mode, multi: { ...themeFlowLine.multi, mainColor: currentMainColor } }
        : { ...themeFlowLine, mode, single: { ...themeFlowLine.single, mainColor: currentMainColor } }
      const nextTokenValues = { ...themeTokenValues }
      for (const tokenKey of FLOW_LINE_TOKEN_KEYS) {
        nextTokenValues[tokenKey] = currentMainColor
      }
      const payload = resolveThemeTokenPayload({ tokenValues: nextTokenValues, flowLine: nextFlowLine, icon: themeIconConfig }, nextTokenValues)
      applyThemeDraftChange(payload, editableThemeId)
    })()
  }, [applyThemeDraftChange, ensureEditableThemeId, themeFlowLine, themeIconConfig, themeTokenValues])

  const handleThemeFlowLineMainColorChange = useCallback((value: string) => {
    void (async () => {
      const editableThemeId = await ensureEditableThemeId()
      if (!editableThemeId) return
      const nextFlowLine = themeFlowLine.mode === 'multi'
        ? { ...themeFlowLine, multi: { ...themeFlowLine.multi, mainColor: value } }
        : { ...themeFlowLine, single: { ...themeFlowLine.single, mainColor: value } }
      const nextTokenValues = { ...themeTokenValues }
      for (const tokenKey of FLOW_LINE_TOKEN_KEYS) {
        nextTokenValues[tokenKey] = value
      }
      const payload = resolveThemeTokenPayload({ tokenValues: nextTokenValues, flowLine: nextFlowLine, icon: themeIconConfig }, nextTokenValues)
      applyThemeDraftChange(payload, editableThemeId)
    })()
  }, [applyThemeDraftChange, ensureEditableThemeId, themeFlowLine, themeIconConfig, themeTokenValues])

  const handleThemeFlowLineDepthStepChange = useCallback((key: keyof FlowLineMultiConfig, value: number) => {
    if (!Number.isFinite(value)) return
    void (async () => {
      const editableThemeId = await ensureEditableThemeId()
      if (!editableThemeId) return
      const nextFlowLine = {
        ...themeFlowLine,
        multi: {
          ...themeFlowLine.multi,
          [key]: value,
        },
      }
      const payload = resolveThemeTokenPayload({ tokenValues: themeTokenValues, flowLine: nextFlowLine, icon: themeIconConfig }, themeTokenValues)
      applyThemeDraftChange(payload, editableThemeId)
    })()
  }, [applyThemeDraftChange, ensureEditableThemeId, themeFlowLine, themeIconConfig, themeTokenValues])

  const handlePreserveToolbarIconOriginalColorsChange = useCallback((value: boolean) => {
    void (async () => {
      const editableThemeId = await ensureEditableThemeId()
      if (!editableThemeId) return
      const payload = resolveThemeTokenPayload(
        {
          tokenValues: themeTokenValues,
          flowLine: themeFlowLine,
          icon: {
            ...themeIconConfig,
            preserveToolbarIconOriginalColors: value,
          },
        },
        themeTokenValues
      )
      applyThemeDraftChange(payload, editableThemeId)
    })()
  }, [applyThemeDraftChange, ensureEditableThemeId, themeFlowLine, themeIconConfig, themeTokenValues])

  const handleThemeTokenResetItem = useCallback(async (_groupId: ThemeTokenGroupId, tokenKey: string) => {
    const editableThemeId = await ensureEditableThemeId()
    if (!editableThemeId) return
    const defaults = await getDefaultThemePayload(editableThemeId)
    const resetValue = defaults.tokenValues[tokenKey] || themeTokenValues[tokenKey] || '#000000'
    const nextTokenValues = { ...themeTokenValues, [tokenKey]: resetValue }
    const payload = resolveThemeTokenPayload({ tokenValues: nextTokenValues, flowLine: themeFlowLine, icon: themeIconConfig }, nextTokenValues)
    applyThemeDraftChange(payload, editableThemeId)
  }, [applyThemeDraftChange, ensureEditableThemeId, getDefaultThemePayload, themeFlowLine, themeIconConfig, themeTokenValues])

  const handleThemeTokenResetGroup = useCallback(async (groupId: ThemeTokenGroupId) => {
    if (!window.confirm('确定重置该分组令牌吗?')) return
    const editableThemeId = await ensureEditableThemeId()
    if (!editableThemeId) return

    const defaults = await getDefaultThemePayload(editableThemeId)
    const nextTokenValues = { ...themeTokenValues }
    let nextFlowLine = { ...themeFlowLine }

    if (groupId === 'flow-line') {
      if (themeFlowLine.mode === 'multi') {
        nextFlowLine = { ...themeFlowLine, multi: { ...defaults.flowLine.multi } }
      }
      if (themeFlowLine.mode === 'single') {
        nextFlowLine = { ...themeFlowLine, single: { ...defaults.flowLine.single } }
      }
      const flowLineMainColor = themeFlowLine.mode === 'multi'
        ? nextFlowLine.multi.mainColor
        : nextFlowLine.single.mainColor
      for (const tokenKey of FLOW_LINE_TOKEN_KEYS) {
        nextTokenValues[tokenKey] = flowLineMainColor
      }
    } else {
      const group = THEME_TOKEN_GROUPS.find(item => item.id === groupId)
      for (const item of group?.items || []) {
        nextTokenValues[item.tokenKey] = defaults.tokenValues[item.tokenKey]
      }
    }

    const payload = resolveThemeTokenPayload({ tokenValues: nextTokenValues, flowLine: nextFlowLine, icon: themeIconConfig }, nextTokenValues)
    applyThemeDraftChange(payload, editableThemeId)
  }, [applyThemeDraftChange, ensureEditableThemeId, getDefaultThemePayload, themeFlowLine, themeIconConfig, themeTokenValues])

  const handleThemeTokenResetAll = useCallback(async () => {
    if (!window.confirm('确定恢复全部主题令牌默认值吗?')) return
    const editableThemeId = await ensureEditableThemeId()
    if (!editableThemeId) return
    const defaults = await getDefaultThemePayload(editableThemeId)
    applyThemeDraftChange(defaults, editableThemeId)
  }, [applyThemeDraftChange, ensureEditableThemeId, getDefaultThemePayload])

  const handleThemeSelect = useCallback(async (themeId: string) => {
    const hadDraft = !!themeDraftSession
    if (hadDraft) {
      setThemeDraftSession(null)
    }
    const payload = await applyTheme(themeId)
    if (!payload || !hadDraft) return
    const nextDraft = createThemeDraftSession(themeId, payload)
    setThemeDraftSession(nextDraft)
  }, [applyTheme, themeDraftSession])

  const handleThemeManagerPreviewTheme = useCallback(async (themeId: string) => {
    await applyTheme(themeId, false)
  }, [applyTheme])

  const handleThemeManagerApplyTheme = useCallback(async (themeId: string) => {
    await handleThemeSelect(themeId)
    setThemeManagerCommittedThemeId(themeId)
  }, [handleThemeSelect])

  const getCurrentThemePayloadForManager = useCallback(() => (
    resolveThemeTokenPayload({ tokenValues: themeTokenValues, flowLine: themeFlowLine, icon: themeIconConfig }, themeTokenValues)
  ), [themeFlowLine, themeIconConfig, themeTokenValues])

  const handleThemeManagerCreateFromCurrent = useCallback(async (name: string): Promise<{ success: boolean; message?: string }> => {
    const validation = validateCustomThemeName(name)
    if (!validation.valid) {
      return { success: false, message: validation.message || '主题名称无效。' }
    }
    const result = await window.api?.theme?.createFromCurrent({
      name: validation.normalizedName,
      themePayload: getCurrentThemePayloadForManager(),
    })
    if (!result) {
      return { success: false, message: '创建主题失败，请稍后重试。' }
    }
    if (!result.success) {
      return { success: false, message: result.message || '创建主题失败，请更换名称后重试。' }
    }

    const payload = await syncThemeLifecycleState(result)
    if (payload) {
      setThemeDraftSession(createThemeDraftSession(result.themeId, payload))
    } else {
      setThemeDraftSession(null)
    }
    return { success: true, message: `主题“${result.themeId}”已创建并激活。` }
  }, [getCurrentThemePayloadForManager, syncThemeLifecycleState])

  const handleThemeManagerRename = useCallback(async (themeId: string, newName: string): Promise<{ success: boolean; message?: string }> => {
    if (!themeId) return { success: false, message: '请选择要重命名的主题。' }
    const result = await window.api?.theme?.rename({ themeId, newName })
    if (!result) {
      return { success: false, message: '重命名主题失败，请稍后重试。' }
    }
    if (!result.success) {
      return { success: false, message: result.message || '重命名失败。' }
    }

    await syncThemeLifecycleState(result)
    renameThemeInDraftSession(result.oldThemeId, result.newThemeId)
    return { success: true, message: `主题已重命名为“${result.newThemeId}”。` }
  }, [renameThemeInDraftSession, syncThemeLifecycleState])

  const handleThemeManagerDelete = useCallback(async (themeId: string, confirmThemeName: string): Promise<{ success: boolean; message?: string }> => {
    if (!themeId) return { success: false, message: '请选择要删除的主题。' }
    const result = await window.api?.theme?.delete({ themeId, confirmThemeName })
    if (!result) {
      return { success: false, message: '删除主题失败，请稍后重试。' }
    }
    if (!result.success) {
      return { success: false, message: result.message || '删除主题失败。' }
    }
    await syncThemeLifecycleState(result, result.notice)
    if (result.deletedThemeId === themeDraftSession?.workingThemeId) {
      setThemeDraftSession(null)
      setThemeSaveFeedback(null)
    }
    return { success: true, message: result.notice || `主题“${result.deletedThemeId}”已删除。` }
  }, [syncThemeLifecycleState, themeDraftSession?.workingThemeId])

  const handleSettingsSave = useCallback(async (next: IDESettings) => {
    try {
      const saved = await window.api?.settings?.save(next)
      if (saved) setIdeSettings(resolveIDESettings(saved))
      else setIdeSettings(resolveIDESettings(next))
    } catch {
      setIdeSettings(resolveIDESettings(next))
    }
  }, [])

  const handleThemeManagerExport = useCallback(async (themeId: string): Promise<{ success: boolean; message?: string }> => {
    if (!themeId) return { success: false, message: '请选择要导出的主题。' }
    const testExport = (window as Window & {
      __ycideTestThemeExport?: (theme: string) => Promise<
        | { success: true; filePath: string; fileName: string; themeId: string }
        | { success: false; canceled?: true; code?: string; message?: string }
      >
    }).__ycideTestThemeExport
    const result = testExport
      ? await testExport(themeId)
      : await window.api?.theme?.export({ themeId })
    if (!result) {
      return { success: false, message: '导出主题失败，请稍后重试。' }
    }
    if (!result.success) {
      if (result.canceled) {
        return { success: false, message: '已取消导出。' }
      }
      return { success: false, message: result.message || '导出主题失败。' }
    }
    return { success: true, message: `已导出：${result.fileName}` }
  }, [])

  const handleThemeManagerSaveTheme = useCallback(async (themeId: string): Promise<{ success: boolean; message?: string }> => {
    if (!themeId) return { success: false, message: '请选择要保存的主题。' }
    if (themeId === '默认深色' || themeId === '默认浅色') {
      return { success: false, message: '内置主题不支持直接保存，请使用“另存为”。' }
    }
    if (themeId !== currentTheme) {
      return { success: false, message: '请先将该主题设为当前，再进行保存。' }
    }
    const payload = resolveThemeTokenPayload({ tokenValues: themeTokenValues, flowLine: themeFlowLine, icon: themeIconConfig }, themeTokenValues)
    const config = await window.api?.theme?.saveCurrent(themeId, payload)
    if (!config) {
      return { success: false, message: '保存主题失败，请稍后重试。' }
    }
    setThemeDraftSession(createThemeDraftSession(themeId, payload))
    setThemeSaveFeedback(null)
    return { success: true, message: `主题“${themeId}”已保存。` }
  }, [currentTheme, themeFlowLine, themeIconConfig, themeTokenValues])

  const handleThemeManagerSaveAsTheme = useCallback(async (sourceThemeId: string, name: string): Promise<{ success: boolean; message?: string }> => {
    if (!sourceThemeId) return { success: false, message: '请选择要另存为的主题。' }
    if (sourceThemeId !== currentTheme) {
      return { success: false, message: '请先将该主题设为当前，再进行另存为。' }
    }
    const validation = validateCustomThemeName(name)
    if (!validation.valid) {
      const message = validation.message || '主题名称无效。'
      setThemeSaveFeedback(message)
      return { success: false, message }
    }

    const saveResult = await window.api?.theme?.saveAsCustom({
      name: validation.normalizedName,
      sourceThemeId,
      themePayload: resolveThemeTokenPayload({ tokenValues: themeTokenValues, flowLine: themeFlowLine, icon: themeIconConfig }, themeTokenValues),
    }) as SaveAsCustomThemeResult | undefined
    if (!saveResult) {
      const message = '保存主题失败，请稍后重试。'
      setThemeSaveFeedback(message)
      return { success: false, message }
    }
    if (!saveResult.success) {
      const message = saveResult.message || '保存主题失败，请更换名称后重试。'
      setThemeSaveFeedback(message)
      return { success: false, message }
    }

    const payload = await applyTheme(saveResult.themeId, false, saveResult.themePayload)
    if (!payload) {
      const message = `主题“${saveResult.themeId}”保存成功，但激活失败，请重新选择该主题。`
      setThemeSaveFeedback(message)
      return { success: false, message }
    }

    setThemeList(prev => prev.includes(saveResult.themeId) ? prev : [...prev, saveResult.themeId])
    setThemeDraftSession(createThemeDraftSession(saveResult.themeId, payload))
    setThemeSaveFeedback(null)
    return { success: true, message: `已另存为“${saveResult.themeId}”。` }
  }, [applyTheme, currentTheme, themeFlowLine, themeIconConfig, themeTokenValues])

  const handleThemeManagerImportPrepare = useCallback(async (): Promise<ThemeManagerImportPrepareResult> => {
    const testImportPrepare = (window as Window & {
      __ycideTestThemeImportPrepare?: () => Promise<ThemeManagerImportPrepareResult>
    }).__ycideTestThemeImportPrepare
    const result = testImportPrepare
      ? await testImportPrepare()
      : await window.api?.theme?.import()
    if (!result) {
      return {
        status: 'invalid',
        diagnostics: [{ path: '$', code: 'invalid_value', message: '导入失败，请稍后重试。' }],
      }
    }
    if (result.status === 'invalid') {
      return {
        status: 'invalid',
        diagnostics: result.diagnostics || [],
      }
    }
    if (result.status === 'conflict') {
      return {
        status: 'conflict',
        importedTheme: result.importedTheme,
        existingThemeId: result.existingThemeId,
        allowedDecisions: result.allowedDecisions,
      }
    }
    if (result.status === 'ready') {
      return {
        status: 'ready',
        importedTheme: result.importedTheme,
        targetThemeId: result.targetThemeId,
      }
    }
    return { status: 'canceled' }
  }, [])

  const handleThemeManagerImportCommit = useCallback(async (
    request: { importedTheme: ThemeDefinition; decision?: ThemeImportConflictDecision }
  ): Promise<{ success: boolean; importedThemeId?: string; message?: string }> => {
    const testImportCommit = (window as Window & {
      __ycideTestThemeImportCommit?: (payload: { importedTheme: ThemeDefinition; decision?: ThemeImportConflictDecision }) => Promise<{
        success: boolean
        importedThemeId?: string
      } & ThemeLifecycleSyncPayload>
    }).__ycideTestThemeImportCommit
    const result = testImportCommit
      ? await testImportCommit(request)
      : await window.api?.theme?.importCommit(request)
    if (!result) {
      return { success: false, message: '导入提交失败，请稍后重试。' }
    }
    if (!result.success) {
      if (result.code === 'conflict_decision_required') {
        return { success: false, message: '请先选择冲突处理策略。' }
      }
      if (result.code === 'invalid_conflict_decision') {
        return { success: false, message: '覆盖导入必须进行二次确认。' }
      }
      if (result.code === 'invalid_payload' && result.diagnostics?.length) {
        return { success: false, message: result.diagnostics.map((item: ThemeImportValidationDiagnostic) => `${item.path}: ${item.message}`).join('\n') }
      }
      return { success: false, message: result.message || '导入提交失败。' }
    }
    await syncThemeLifecycleState(result)
    return { success: true, importedThemeId: result.importedThemeId, message: `已导入：${result.importedThemeId}` }
  }, [syncThemeLifecycleState])

  const handleSaveAsCustomTheme = useCallback(async (name: string): Promise<{ success: boolean; message?: string }> => {
    if (!currentTheme) {
      return { success: false, message: '当前主题不可用，请重新打开设置后重试。' }
    }
    const validation = validateCustomThemeName(name)
    if (!validation.valid) {
      const message = validation.message || '主题名称无效。'
      setThemeSaveFeedback(message)
      return { success: false, message }
    }

    const saveResult = await window.api?.theme?.saveAsCustom({
      name: validation.normalizedName,
      sourceThemeId: currentTheme,
      themePayload: resolveThemeTokenPayload({ tokenValues: themeTokenValues, flowLine: themeFlowLine, icon: themeIconConfig }, themeTokenValues),
    }) as SaveAsCustomThemeResult | undefined
    if (!saveResult) {
      const message = '保存主题失败，请稍后重试。'
      setThemeSaveFeedback(message)
      return { success: false, message }
    }
    if (!saveResult.success) {
      const message = saveResult.message || '保存主题失败，请更换名称后重试。'
      setThemeSaveFeedback(message)
      return { success: false, message }
    }

    const payload = await applyTheme(saveResult.themeId, false, saveResult.themePayload)
    if (!payload) {
      const message = `主题“${saveResult.themeId}”保存成功，但激活失败，请重新选择该主题。`
      setThemeSaveFeedback(message)
      return { success: false, message }
    }

    setThemeList(prev => prev.includes(saveResult.themeId) ? prev : [...prev, saveResult.themeId])
    setThemeDraftSession(createThemeDraftSession(saveResult.themeId, payload))
    setThemeSaveFeedback(null)
    return { success: true }
  }, [applyTheme, currentTheme, themeFlowLine, themeIconConfig, themeTokenValues])

  const handleThemeSettingsClose = useCallback(() => {
    setThemeDraftSession(null)
    setThemeSaveFeedback(null)
    setShowThemeSettings(false)
  }, [])

  const handleThemeDraftCloseIntent = useCallback(async (intent: ThemeDraftCloseIntent): Promise<boolean> => {
    if (!themeDraftSession?.dirty) {
      if (intent !== 'app-exit') {
        handleThemeSettingsClose()
      }
      return true
    }
    const testCloseDecision = (window as Window & {
      __ycideTestThemeDraftCloseDecision?: ((closeIntent: ThemeDraftCloseIntent) => ThemeDraftCloseDecision | Promise<ThemeDraftCloseDecision>)
    }).__ycideTestThemeDraftCloseDecision
    const action = testCloseDecision
      ? await testCloseDecision(intent)
      : await window.api?.dialog?.confirmUnsavedThemeDraftClose(intent) as ThemeDraftCloseDecision | undefined
    if (action === 'continue') return false
    if (action === 'discard') {
      if (intent !== 'app-exit') {
        handleThemeSettingsClose()
      }
      return true
    }
    const draftThemeId = themeDraftSession?.workingThemeId
    if (!draftThemeId) {
      setShowThemeManager(true)
      setThemeSaveFeedback('未找到可保存的主题草稿，请重试。')
      return false
    }

    const saveResult = await handleThemeManagerSaveTheme(draftThemeId)
    if (!saveResult.success) {
      setShowThemeManager(true)
      setThemeSaveFeedback(saveResult.message || '保存主题失败，请重试。')
      return false
    }

    if (intent !== 'app-exit') {
      handleThemeSettingsClose()
    }
    return true
  }, [handleThemeManagerSaveTheme, handleThemeSettingsClose, themeDraftSession])

  useEffect(() => {
    (async () => {
      const list = await window.api?.theme?.getList()
      if (list) setThemeList(list)
      const saved = await window.api?.theme?.getCurrent()
      if (!saved?.effectiveThemeId) return
      await applyTheme(saved.effectiveThemeId, false, saved.themePayload)
      if (saved.warning) {
        handleThemeWarning(saved.warning)
      }
    })()
  }, [applyTheme, handleThemeWarning])

  const handleAlignDone = useCallback(() => setAlignAction(null), [])

  useEffect(() => {
    if (!showThemeManager) {
      if (themeManagerCommittedThemeId !== null) {
        setThemeManagerCommittedThemeId(null)
      }
      return
    }
    if (!themeManagerCommittedThemeId && currentTheme) {
      setThemeManagerCommittedThemeId(currentTheme)
    }
  }, [showThemeManager, themeManagerCommittedThemeId, currentTheme])

  useEffect(() => {
    if (!showThemeManager) {
      if (themeManagerWindowRef.current && !themeManagerWindowRef.current.closed) {
        themeManagerWindowRef.current.close()
      }
      themeManagerWindowRef.current = null
      setThemeManagerPortalRoot(null)
      return
    }

    if (!themeManagerWindowRef.current || themeManagerWindowRef.current.closed) {
      const popup = window.open('about:blank', 'ycIDE-theme-manager', 'popup=yes,width=1080,height=820,left=120,top=80')
      if (!popup) {
        pushThemeNotice('theme-manager-popup-blocked', '[主题] 无法打开独立主题管理窗口，请检查系统拦截设置。')
        setShowThemeManager(false)
        return
      }
      popup.document.title = '主题管理器 - ycIDE'
      popup.document.body.innerHTML = ''
      popup.document.body.style.margin = '0'
      popup.document.body.style.overflow = 'hidden'

      const root = popup.document.createElement('div')
      root.id = 'theme-manager-root'
      root.style.width = '100%'
      root.style.height = '100%'
      popup.document.body.appendChild(root)

      popup.document.head.innerHTML = ''
      document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
        popup.document.head.appendChild(node.cloneNode(true))
      })
      popup.document.documentElement.style.cssText = document.documentElement.style.cssText

      const handlePopupClosed = () => {
        themeManagerWindowRef.current = null
        setThemeManagerPortalRoot(null)
        setShowThemeManager(false)
      }
      popup.addEventListener('beforeunload', handlePopupClosed)

      themeManagerWindowRef.current = popup
      setThemeManagerPortalRoot(root)
    } else {
      const popup = themeManagerWindowRef.current
      popup.document.documentElement.style.cssText = document.documentElement.style.cssText
      popup.focus()
      const root = popup.document.getElementById('theme-manager-root') as HTMLElement | null
      setThemeManagerPortalRoot(root)
    }
  }, [showThemeManager, pushThemeNotice])

  useEffect(() => {
    const popup = themeManagerWindowRef.current
    if (!popup || popup.closed) return
    popup.document.documentElement.style.cssText = document.documentElement.style.cssText
  }, [themeTokenValues, themeFlowLine, currentTheme])

  useEffect(() => () => {
    if (themeManagerWindowRef.current && !themeManagerWindowRef.current.closed) {
      themeManagerWindowRef.current.close()
    }
  }, [])

  // ── 系统设置独立窗口 ──
  useEffect(() => {
    if (!showSettings) {
      if (settingsWindowRef.current && !settingsWindowRef.current.closed) {
        settingsWindowRef.current.close()
      }
      settingsWindowRef.current = null
      setSettingsPortalRoot(null)
      return
    }

    settingsBaselineRef.current = { ...ideSettings }

    if (!settingsWindowRef.current || settingsWindowRef.current.closed) {
      const popup = window.open('about:blank', 'ycIDE-settings', 'popup=yes,width=520,height=620,left=200,top=120')
      if (!popup) {
        setShowSettings(false)
        return
      }
      popup.document.title = '系统设置 - ycIDE'
      popup.document.body.innerHTML = ''
      popup.document.body.style.margin = '0'
      popup.document.body.style.overflow = 'hidden'

      const root = popup.document.createElement('div')
      root.id = 'settings-root'
      root.style.width = '100%'
      root.style.height = '100%'
      popup.document.body.appendChild(root)

      popup.document.head.innerHTML = ''
      document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
        popup.document.head.appendChild(node.cloneNode(true))
      })
      popup.document.documentElement.style.cssText = document.documentElement.style.cssText

      const handlePopupClosed = (): void => {
        setIdeSettings(resolveIDESettings(settingsBaselineRef.current))
        settingsWindowRef.current = null
        setSettingsPortalRoot(null)
        setShowSettings(false)
      }
      popup.addEventListener('beforeunload', handlePopupClosed)

      settingsWindowRef.current = popup
      setSettingsPortalRoot(root)
    } else {
      const popup = settingsWindowRef.current
      popup.document.documentElement.style.cssText = document.documentElement.style.cssText
      popup.focus()
      const root = popup.document.getElementById('settings-root') as HTMLElement | null
      setSettingsPortalRoot(root)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings])

  useEffect(() => {
    const popup = settingsWindowRef.current
    if (!popup || popup.closed) return
    popup.document.documentElement.style.cssText = document.documentElement.style.cssText
  }, [ideSettings])

  useEffect(() => () => {
    if (settingsWindowRef.current && !settingsWindowRef.current.closed) {
      settingsWindowRef.current.close()
    }
  }, [])

  const handleSettingsPreviewChange = useCallback((draft: IDESettings) => {
    setIdeSettings(resolveIDESettings(draft))
  }, [])

  const handleSettingsCancel = useCallback(() => {
    setIdeSettings(resolveIDESettings(settingsBaselineRef.current))
    setShowSettings(false)
  }, [])

  const handleSettingsSaveAndClose = useCallback(async (next: IDESettings) => {
    await handleSettingsSave(next)
    setShowSettings(false)
  }, [handleSettingsSave])

  const extractSubroutineNodes = useCallback((content: string, fileName: string): TreeNode[] => {
    const nodes: TreeNode[] = []
    const lines = (content || '').replace(/\r\n/g, '\n').split('\n')
    const re = /^\s*\.子程序\s+([^,\s]+)/
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i])
      if (!m) continue
      const subName = (m[1] || '').trim()
      if (!subName) continue
      nodes.push({
        id: `${fileName}::sub::${i}`,
        label: subName,
        type: 'sub',
        fileId: fileName,
        fileName,
      })
    }
    return nodes
  }, [])

  const extractGlobalVarNodes = useCallback((content: string, fileName: string): TreeNode[] => {
    const nodes: TreeNode[] = []
    const lines = (content || '').replace(/\r\n/g, '\n').split('\n')
    const re = /^\s*\.全局变量\s+([^,\s]+)/
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i])
      if (!m) continue
      const name = (m[1] || '').trim()
      if (!name) continue
      nodes.push({
        id: `${fileName}::global::${i}`,
        label: name,
        type: 'field',
        fileId: fileName,
        fileName,
      })
    }
    return nodes
  }, [])

  const extractConstantNodes = useCallback((content: string, fileName: string): TreeNode[] => {
    const nodes: TreeNode[] = []
    const lines = (content || '').replace(/\r\n/g, '\n').split('\n')
    const re = /^\s*\.常量\s+([^,\s]+)/
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i])
      if (!m) continue
      const name = (m[1] || '').trim()
      if (!name) continue
      nodes.push({
        id: `${fileName}::const::${i}`,
        label: name,
        type: 'constant',
        fileId: fileName,
        fileName,
      })
    }
    return nodes
  }, [])

  const extractDataTypeNodes = useCallback((content: string, fileName: string): TreeNode[] => {
    const nodes: TreeNode[] = []
    const lines = (content || '').replace(/\r\n/g, '\n').split('\n')
    const re = /^\s*\.数据类型\s+([^,\s]+)/
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i])
      if (!m) continue
      const name = (m[1] || '').trim()
      if (!name) continue
      nodes.push({
        id: `${fileName}::dtype::${i}`,
        label: name,
        type: 'class',
        fileId: fileName,
        fileName,
      })
    }
    return nodes
  }, [])

  const extractDllCommandNodes = useCallback((content: string, fileName: string): TreeNode[] => {
    const nodes: TreeNode[] = []
    const lines = (content || '').replace(/\r\n/g, '\n').split('\n')
    const re = /^\s*\.DLL命令\s+([^,\s]+)/
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i])
      if (!m) continue
      const name = (m[1] || '').trim()
      if (!name) continue
      nodes.push({
        id: `${fileName}::dll::${i}`,
        label: name,
        type: 'dll',
        fileId: fileName,
        fileName,
      })
    }
    return nodes
  }, [])

  const extractResourceNodes = useCallback((content: string, tableFileName: string): TreeNode[] => {
    const nodes: TreeNode[] = []
    const lines = (content || '').replace(/\r\n/g, '\n').split('\n')
    const re = /^\s*\.(?:资源|常量)\s+([^,\s]+)(?:\s*,\s*(?:["“]([^"”]*)["”]|([^,\s]*)))?/
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i])
      if (!m) continue
      const resourceName = (m[1] || '').trim()
      const fileName = ((m[2] || m[3]) || '').trim()
      nodes.push({
        id: `${tableFileName}::const::${i}`,
        label: resourceName || fileName || `资源${i + 1}`,
        type: 'resource',
        fileId: tableFileName,
        fileName: tableFileName,
      })
    }
    return nodes
  }, [])

  // 从 epp 文件列表构建项目树，按类别分组
  const buildProjectTreeFromEpp = useCallback(async (projectName: string, files: Array<{ type: string; fileName: string; flag: number }>, projectDir: string): Promise<TreeNode[]> => {
    const windowFiles: TreeNode[] = []
    const sourceFiles: TreeNode[] = []
    const globalVarFiles: TreeNode[] = []
    const constantFiles: TreeNode[] = []
    const dataTypeFiles: TreeNode[] = []
    const dllCmdFiles: TreeNode[] = []
    const resourceFiles: TreeNode[] = []

    for (const f of files) {
      if (f.type === 'EFW') {
        windowFiles.push({ id: f.fileName, label: f.fileName, type: 'window' })
      } else if (f.type === 'EYC') {
        const filePath = joinPath(projectDir, f.fileName)
        const content = await window.api?.project?.readFile(filePath)
        const subNodes = extractSubroutineNodes(content || '', f.fileName)
        sourceFiles.push({ id: f.fileName, label: f.fileName, type: 'module', children: subNodes, expanded: false })
      } else if (f.type === 'EGV') {
        const filePath = joinPath(projectDir, f.fileName)
        const content = await window.api?.project?.readFile(filePath)
        const varNodes = extractGlobalVarNodes(content || '', f.fileName)
        globalVarFiles.push({ id: f.fileName, label: f.fileName, type: 'module', children: varNodes, expanded: false })
      } else if (f.type === 'ECS') {
        const filePath = joinPath(projectDir, f.fileName)
        const content = await window.api?.project?.readFile(filePath)
        const constNodes = extractConstantNodes(content || '', f.fileName)
        constantFiles.push({ id: f.fileName, label: f.fileName, type: 'module', children: constNodes, expanded: false })
      } else if (f.type === 'EDT') {
        const filePath = joinPath(projectDir, f.fileName)
        const content = await window.api?.project?.readFile(filePath)
        const dtNodes = extractDataTypeNodes(content || '', f.fileName)
        dataTypeFiles.push({ id: f.fileName, label: f.fileName, type: 'module', children: dtNodes, expanded: false })
      } else if (f.type === 'ELL') {
        const filePath = joinPath(projectDir, f.fileName)
        const content = await window.api?.project?.readFile(filePath)
        const dllNodes = extractDllCommandNodes(content || '', f.fileName)
        dllCmdFiles.push({ id: f.fileName, label: f.fileName, type: 'module', children: dllNodes, expanded: false })
      } else if (f.type === 'ERC') {
        const filePath = joinPath(projectDir, f.fileName)
        const content = await window.api?.project?.readFile(filePath)
        const resNodes = extractResourceNodes(content || '', f.fileName)
        resourceFiles.push({ id: f.fileName, label: f.fileName, type: 'module', children: resNodes, expanded: false })
      } else {
        if (f.type === 'RES') continue
        resourceFiles.push({ id: f.fileName, label: f.fileName, type: 'resource' })
      }
    }

    const categories: TreeNode[] = []
    categories.push({ id: '_cat_windows', label: '窗口', type: 'folder', expanded: true, children: windowFiles })
    categories.push({ id: '_cat_sources', label: '程序集', type: 'folder', expanded: true, children: sourceFiles })
    categories.push({ id: '_cat_globals', label: '全局变量', type: 'folder', expanded: true, children: globalVarFiles })
    categories.push({ id: '_cat_constants', label: '常量表', type: 'folder', expanded: true, children: constantFiles })
    categories.push({ id: '_cat_datatypes', label: '自定义数据类型', type: 'folder', expanded: true, children: dataTypeFiles })
    categories.push({ id: '_cat_dllcmds', label: 'DLL命令', type: 'folder', expanded: true, children: dllCmdFiles })
    categories.push({ id: '_cat_resources', label: '资源', type: 'folder', expanded: false, children: resourceFiles })

    return [{ id: 'root', label: projectName, type: 'folder', expanded: true, children: categories }]
  }, [extractSubroutineNodes, extractGlobalVarNodes, extractConstantNodes, extractDataTypeNodes, extractDllCommandNodes, extractResourceNodes, joinPath])

  // 标签页变化时保存到项目目录，并重新检查设计时诊断
  const handleOpenTabsChange = useCallback((tabs: EditorTab[]) => {
    openTabsRef.current = tabs
    commandCacheRef.current.clear()
    const dir = currentProjectDirRef.current
    if (dir) {
      const session: ProjectSessionState = {
        openTabs: tabs.filter(t => t.filePath).map(t => t.filePath!),
        activeTabPath: activeFileIdRef.current ?? undefined,
      }
      window.api?.project?.saveOpenTabs(dir, session)
    }
    checkDesignProblems(tabs)
  }, [checkDesignProblems])

  // 刷新项目树（窗口重命名后调用）
  const refreshProjectTree = useCallback(async () => {
    const dir = currentProjectDirRef.current
    if (!dir) return
    const dirFiles = await window.api?.file?.readDir(dir) as string[] | undefined
    if (!dirFiles) return
    const eppFile = dirFiles.find(f => f.endsWith('.epp'))
    if (!eppFile) return
    const eppInfo = await window.api?.project?.parseEpp(joinPath(dir, eppFile))
    if (eppInfo) {
      setProjectTree(await buildProjectTreeFromEpp(eppInfo.projectName, eppInfo.files, dir))
    }
  }, [buildProjectTreeFromEpp, joinPath])

  // 同步 ref
  useEffect(() => {
    currentProjectDirRef.current = currentProjectDir
  }, [currentProjectDir])

  useEffect(() => {
    activeFileIdRef.current = activeFileId
  }, [activeFileId])

  // 切换活动标签时也同步会话，确保下次打开优先恢复到上次标签
  useEffect(() => {
    const dir = currentProjectDirRef.current
    if (!dir) return
    const session: ProjectSessionState = {
      openTabs: openTabsRef.current.filter(t => t.filePath).map(t => t.filePath!),
      activeTabPath: activeFileId ?? undefined,
    }
    window.api?.project?.saveOpenTabs(dir, session)
  }, [activeFileId])

  const handleAppClose = useCallback(async () => {
    const allowExit = await handleThemeDraftCloseIntent('app-exit')
    if (!allowExit) return
    const hasUnsaved = editorRef.current?.hasModifiedTabs?.() ?? false
    if (hasUnsaved) {
      const action = await window.api?.dialog?.confirmSaveBeforeClose('未保存文件')
      if (action === 'cancel') return
      if (action === 'save') {
        editorRef.current?.saveAll()
      }
    }
    window.api?.window.forceClose()
  }, [handleThemeDraftCloseIntent])

  const buildTabFromPath = useCallback(async (fp: string): Promise<EditorTab | null> => {
    const fileName = getBaseName(fp)
    const ext = fileName.split('.').pop()?.toLowerCase()
    const content = await window.api?.project?.readFile(fp)
    if (content === null || content === undefined) return null

    if (ext === 'efw') {
      const efwData = JSON.parse(content)
      const formData: DesignForm = {
        name: efwData.name || fileName.replace('.efw', ''),
        title: efwData.title || '',
        width: efwData.width || 592,
        height: efwData.height || 384,
        sourceFile: efwData.sourceFile,
        properties: efwData.properties || undefined,
        controls: (efwData.controls || []).map((c: any) => ({
          id: c.id, type: c.type, name: c.name,
          left: c.x ?? c.left ?? 0, top: c.y ?? c.top ?? 0,
          width: c.width ?? 100, height: c.height ?? 30,
          text: c.properties?.['标题'] ?? c.properties?.['内容'] ?? c.properties?.['文本'] ?? c.text ?? c.name ?? '',
          visible: c.visible ?? true, enabled: c.enabled ?? true, properties: c.properties || {},
        })),
      }
      return { id: fp, label: fileName, language: 'efw', value: '', savedValue: JSON.stringify(formData, null, 2), filePath: fp, formData }
    }

    if (ext === 'eyc' || ext === 'ecc' || ext === 'egv' || ext === 'ecs' || ext === 'edt' || ext === 'ell' || ext === 'erc') {
      const normalized = ext === 'erc'
        ? normalizeResourceTableContent(content)
        : content
      return { id: fp, label: fileName, language: ext === 'ecc' ? 'eyc' : ext, value: normalized, savedValue: normalized, filePath: fp }
    }

    return null
  }, [])

  const openProjectByEppPath = useCallback(async (eppPath: string) => {
    const eppInfo = await window.api?.project?.parseEpp(eppPath)
    if (!eppInfo) return false
    const dir = getDirName(eppPath)
    setCurrentProjectDir(dir)
    const normalizedPlatform = normalizeTargetPlatform(eppInfo.platform)
    setTargetPlatform(normalizedPlatform)
    setTargetArch(prev => coerceArchByPlatform(normalizedPlatform, normalizeTargetArch(eppInfo.platform) || prev))
    setProjectTree(await buildProjectTreeFromEpp(eppInfo.projectName, eppInfo.files, dir))

    const session = await window.api?.project?.loadOpenTabs(dir)
    const savedPaths = session?.openTabs || []
    const restoredTabs: EditorTab[] = []
    if (savedPaths && savedPaths.length > 0) {
      for (const fp of savedPaths) {
        const tab = await buildTabFromPath(fp)
        if (tab) restoredTabs.push(tab)
      }
    }

    if (session?.activeTabPath && restoredTabs.length > 1) {
      const activeIndex = restoredTabs.findIndex(t => t.filePath?.toLowerCase() === session.activeTabPath?.toLowerCase())
      if (activeIndex > 0) {
        const [activeTab] = restoredTabs.splice(activeIndex, 1)
        restoredTabs.unshift(activeTab)
      }
    }

    if (restoredTabs.length === 0) {
      const mainFile = eppInfo.files.find((f: { type: string; fileName: string; flag: number }) => f.flag === 1)
        || eppInfo.files.find((f: { type: string; fileName: string; flag: number }) => f.type === 'EFW')
        || eppInfo.files[0]
      if (mainFile) {
        const mainTab = await buildTabFromPath(joinPath(dir, mainFile.fileName))
        if (mainTab) restoredTabs.push(mainTab)
      }
    }

    if (restoredTabs.length > 0) setOpenProjectFiles(restoredTabs)
    pushRecentOpened({
      type: 'project',
      path: eppPath,
      label: eppInfo.projectName || (getBaseName(eppPath) || eppPath),
    })
    try { localStorage.setItem(LAST_PROJECT_EPP_KEY, eppPath) } catch {}
    return true
  }, [buildProjectTreeFromEpp, buildTabFromPath, getBaseName, getDirName, joinPath, pushRecentOpened])

  // 启动时自动恢复上次打开的项目
  const startupRestoredRef = useRef(false)
  useEffect(() => {
    if (startupRestoredRef.current) return
    startupRestoredRef.current = true
    try {
      const lastEpp = localStorage.getItem(LAST_PROJECT_EPP_KEY)
      if (lastEpp) {
        void openProjectByEppPath(lastEpp)
      }
    } catch {}
  }, [openProjectByEppPath])

  const openFileByPath = useCallback(async (filePath: string, targetLine?: number) => {
    const ext = filePath.split('.').pop()?.toLowerCase()
    if (ext === 'epp') {
      return openProjectByEppPath(filePath)
    }

    const tab = await buildTabFromPath(filePath)
    if (!tab) return false
    editorRef.current?.openFile(tab)
    if (targetLine && targetLine > 0) {
      setTimeout(() => {
        editorRef.current?.navigateToLine(targetLine)
      }, 80)
    }
    const label = getBaseName(filePath) || filePath
    pushRecentOpened({ type: 'file', path: filePath, label })
    return true
  }, [buildTabFromPath, getBaseName, openProjectByEppPath, pushRecentOpened])

  useEffect(() => {
    openFileByPathRef.current = openFileByPath
  }, [openFileByPath])

  const handleMenuAction = useCallback(async (action: string) => {
    if (action.startsWith('file:openRecent:')) {
      const encoded = action.substring('file:openRecent:'.length)
      try {
        const payload = JSON.parse(decodeURIComponent(encoded)) as { type: 'project' | 'file'; path: string }
        if (!payload?.path) return
        if (payload.type === 'project') {
          await openProjectByEppPath(payload.path)
        } else {
          await openFileByPath(payload.path)
        }
      } catch {
        // 忽略无效最近打开项
      }
      return
    }

    switch (action) {
      // 文件菜单
      case 'file:newProject':
        setShowNewProject(true)
        break
      case 'file:openProject': {
        const eppPath = await window.api?.project?.openEpp()
        if (!eppPath) return
        await openProjectByEppPath(eppPath)
        break
      }
      case 'file:save':
        editorRef.current?.save()
        break
      case 'file:saveAll':
        editorRef.current?.saveAll()
        break
      case 'file:closeFile':
        editorRef.current?.closeActiveTab()
        break
      case 'file:closeProject':
        {
          const hasUnsaved = editorRef.current?.hasModifiedTabs?.() ?? false
          if (hasUnsaved) {
            const action = await window.api?.dialog?.confirmSaveBeforeClose('未保存文件')
            if (action === 'cancel') break
            if (action === 'save') {
              editorRef.current?.saveAll()
            }
          }
        }
        editorRef.current?.clearAllTabs()
        setOpenProjectFiles([])
        setProjectTree([])
        setCurrentProjectDir('')
        setSelection(null)
        setSidebarTab('project')
        try { localStorage.removeItem(LAST_PROJECT_EPP_KEY) } catch {}
        break
      case 'file:exit':
        await handleAppClose()
        break

      // 编辑菜单
      case 'edit:undo':
      case 'edit:redo':
      case 'edit:cut':
      case 'edit:copy':
      case 'edit:paste':
      case 'edit:delete':
      case 'edit:selectAll':
      case 'edit:find':
      case 'edit:replace':
        editorRef.current?.editorAction(action.split(':')[1])
        break
      case 'build:run':
        handleCompileRun()
        break

      // 调试菜单
      case 'debug:run':
        handleCompileRun()
        break
      case 'debug:stop':
        handleStop()
        break
      case 'debug:toggleBreakpoint':
        toggleBreakpoint(activeFileIdRef.current, cursorSourceLine ?? cursorLine)
        break
      case 'debug:clearBreakpoints':
        setBreakpointsByFile({})
        break
      case 'debug:runToCursor':
        if (!currentProjectDir || !(cursorSourceLine || cursorLine)) break
        {
          const fileId = activeFileIdRef.current
          if (!fileId) break
          const fileKey = getBaseName(fileId)
          const requestedLine = cursorSourceLine ?? cursorLine!
          const editorFiles = editorRef.current?.getEditorFiles?.() || {}
          const content = editorFiles[fileKey]
          const targetLine = (() => {
            if (!content) return requestedLine
            const lines = content.replace(/\r\n/g, '\n').split('\n')
            const normalizeLineText = (raw: string) => raw.replace(/[\u200B\u200C\u200D\u2060]/g, '').trim()
            const startIndex = Math.max(0, Math.min(lines.length - 1, requestedLine - 1))
            for (let i = startIndex; i < lines.length; i++) {
              if (normalizeLineText(lines[i]) !== '') return i + 1
            }
            for (let i = startIndex - 1; i >= 0; i--) {
              if (normalizeLineText(lines[i]) !== '') return i + 1
            }
            return requestedLine
          })()
          const mergedBreakpoints: Record<string, number[]> = { ...breakpointsByFile }
          const current = new Set(mergedBreakpoints[fileKey] || [])
          current.add(targetLine)
          mergedBreakpoints[fileKey] = Array.from(current).sort((a, b) => a - b)
          setIsCompiling(true)
          editorRef.current?.save()
          setOutputMessages([])
          setShowOutput(true)
          setForceOutputTab('compile')
          setDebugResumePending(false)
          setDebugDisplayLine(null)
          setDebugPause(null)
          debugBreakAccumRef.current = null
          const freshEditorFiles = editorRef.current?.getEditorFiles()
          const result = await window.api.compiler.run(currentProjectDir, freshEditorFiles, targetArch, { breakpoints: mergedBreakpoints })
          setIsCompiling(false)
          setForceOutputTab(null)
          if (result?.success) setIsRunning(true)
        }
        break
      case 'debug:stepOver':
      case 'debug:stepInto':
      case 'debug:stepOut':
        await continueDebugRun()
        break

      // 查看/工具菜单
      case 'view:output':
        setShowOutput(prev => !prev)
        break
      case 'view:library':
      case 'tools:library':
        setShowLibrary(true)
        break
      case 'tools:settings':
        setShowSettings(true)
        break
      case 'tools:themeManager':
        setShowThemeManager(true)
        break

      // 插入菜单
      case 'insert:sub':
        editorRef.current?.insertDeclaration()
        break
      case 'insert:localVar':
        editorRef.current?.insertLocalVariable()
        break
      case 'insert:module': {
        const dir = currentProjectDirRef.current
        if (!dir) break
        // 生成不重复的文件名
        const existingFiles = projectTree[0]?.children
          ?.find(c => c.id === '_cat_sources')?.children?.map(c => c.label) || []
        let n = 1
        while (existingFiles.includes('程序集' + n + '.eyc')) n++
        const newFileName = '程序集' + n + '.eyc'
        const assemblyName = '程序集' + n
        const content = '.版本 2\n.程序集 ' + assemblyName + '\n\n.子程序 子程序1\n\n'
        await window.api?.project?.addFile(dir, newFileName, 'EYC', content)
        // 更新项目树：添加新文件到程序集分类
        setProjectTree(prev => prev.map(root => ({
          ...root,
          children: root.children?.map(cat =>
            cat.id === '_cat_sources'
              ? { ...cat, children: [...(cat.children || []), { id: newFileName, label: newFileName, type: 'module' as const, children: extractSubroutineNodes(content, newFileName), expanded: false }] }
              : cat
          )
        })))
        // 打开新文件
        const filePath = joinPath(dir, newFileName)
        editorRef.current?.openFile({ id: filePath, label: newFileName, language: 'eyc', value: content, savedValue: content, filePath })
        break
      }
      case 'insert:classModule': {
        const dir = currentProjectDirRef.current
        if (!dir) break
        // 生成不重复的文件名（放在程序集分类下）
        const existingFiles = projectTree[0]?.children
          ?.find(c => c.id === '_cat_sources')?.children?.map(c => c.label) || []
        let n = 1
        while (existingFiles.includes('类模块' + n + '.ecc')) n++
        const newFileName = '类模块' + n + '.ecc'
        const className = '类' + n
        const content =
          '.版本 2\n\n' +
          '.程序集 ' + className + ', , , \n\n' +
          '.子程序 _初始化, , , , 当基于本类的对象被创建后，此方法会被自动调用\n\n\n\n' +
          '.子程序 _销毁, , , , 当基于本类的对象被销毁前，此方法会被自动调用\n\n'
        await window.api?.project?.addFile(dir, newFileName, 'EYC', content)
        // 更新项目树：添加新文件到程序集分类
        setProjectTree(prev => prev.map(root => ({
          ...root,
          children: root.children?.map(cat =>
            cat.id === '_cat_sources'
              ? { ...cat, children: [...(cat.children || []), { id: newFileName, label: newFileName, type: 'module' as const, children: extractSubroutineNodes(content, newFileName), expanded: false }] }
              : cat
          )
        })))
        // 打开新文件（使用 EYC 编辑体验）
        const filePath = joinPath(dir, newFileName)
        editorRef.current?.openFile({ id: filePath, label: newFileName, language: 'eyc', value: content, savedValue: content, filePath })
        break
      }
      case 'insert:globalVar':
      {
        const dir = currentProjectDirRef.current
        if (!dir) break
        const existingFiles = projectTree[0]?.children
          ?.find(c => c.id === '_cat_globals')?.children?.map(c => c.label) || []
        const globalFileName = '全局变量.egv'
        const filePath = joinPath(dir, globalFileName)

        // 优先使用编辑器中的最新内容（含未保存修改），再回退到磁盘内容
        const editorFiles = editorRef.current?.getEditorFiles()
        const fromEditor = editorFiles?.[globalFileName]
        const fromDisk = fromEditor === undefined ? await window.api?.project?.readFile(filePath) : undefined
        const baseContent = (fromEditor ?? fromDisk ?? '.版本 2\n\n').replace(/\r\n/g, '\n')

        let n = 1
        while (new RegExp('^\\.全局变量\\s+全局变量' + n + '(?:,|\\s|$)', 'm').test(baseContent)) n++
        const varName = '全局变量' + n
        const appendLine = '.全局变量 ' + varName + ', 整数型'
        const content = baseContent.trimEnd() + '\n' + appendLine + '\n\n'

        if (!existingFiles.includes(globalFileName)) {
          await window.api?.project?.addFile(dir, globalFileName, 'EGV', content)
          setProjectTree(prev => prev.map(root => ({
            ...root,
            children: root.children?.map(cat =>
              cat.id === '_cat_globals'
                ? { ...cat, children: [...(cat.children || []), { id: globalFileName, label: globalFileName, type: 'module' as const, children: extractGlobalVarNodes(content, globalFileName), expanded: false }] }
                : cat
            )
          })))
        } else {
          await window.api?.file?.save(filePath, content)
        }

        editorRef.current?.upsertFile({ id: filePath, label: globalFileName, language: 'egv', value: content, savedValue: content, filePath })
        break
      }
      case 'insert:constant':
      {
        const dir = currentProjectDirRef.current
        if (!dir) break
        const existingFiles = projectTree[0]?.children
          ?.find(c => c.id === '_cat_constants')?.children?.map(c => c.label) || []
        const constantFileName = '常量.ecs'
        const filePath = joinPath(dir, constantFileName)

        // 优先使用编辑器中的最新内容（含未保存修改），再回退到磁盘内容
        const editorFiles = editorRef.current?.getEditorFiles()
        const fromEditor = editorFiles?.[constantFileName]
        const fromDisk = fromEditor === undefined ? await window.api?.project?.readFile(filePath) : undefined
        const baseContent = (fromEditor ?? fromDisk ?? '.版本 2\n\n').replace(/\r\n/g, '\n')

        let n = 1
        while (new RegExp('^\\.常量\\s+常量' + n + '(?:,|\\s|$)', 'm').test(baseContent)) n++
        const constName = '常量' + n
        const appendLine = '.常量 ' + constName + ', 0'
        const content = baseContent.trimEnd() + '\n' + appendLine + '\n\n'

        if (!existingFiles.includes(constantFileName)) {
          await window.api?.project?.addFile(dir, constantFileName, 'ECS', content)
          setProjectTree(prev => prev.map(root => ({
            ...root,
            children: root.children?.map(cat =>
              cat.id === '_cat_constants'
                ? { ...cat, children: [...(cat.children || []), { id: constantFileName, label: constantFileName, type: 'module' as const, children: extractConstantNodes(content, constantFileName), expanded: false }] }
                : cat
            )
          })))
        } else {
          await window.api?.file?.save(filePath, content)
        }

        editorRef.current?.upsertFile({ id: filePath, label: constantFileName, language: 'ecs', value: content, savedValue: content, filePath })
        break
      }
      case 'insert:dataType':
      {
        const dir = currentProjectDirRef.current
        if (!dir) break
        const existingFiles = projectTree[0]?.children
          ?.find(c => c.id === '_cat_datatypes')?.children?.map(c => c.label) || []
        const dataTypeFileName = '自定义数据类型.edt'
        const filePath = joinPath(dir, dataTypeFileName)

        // 优先使用编辑器中的最新内容（含未保存修改），再回退到磁盘内容
        const editorFiles = editorRef.current?.getEditorFiles()
        const fromEditor = editorFiles?.[dataTypeFileName]
        const fromDisk = fromEditor === undefined ? await window.api?.project?.readFile(filePath) : undefined
        const baseContent = (fromEditor ?? fromDisk ?? '.版本 2\n\n').replace(/\r\n/g, '\n')

        let n = 1
        while (new RegExp('^\\.数据类型\\s+数据类型' + n + '(?:,|\\s|$)', 'm').test(baseContent)) n++
        const dataTypeName = '数据类型' + n
        const appendBlock = '.数据类型 ' + dataTypeName + '\n    .成员 成员1, 整数型'
        const content = baseContent.trimEnd() + '\n' + appendBlock + '\n\n'

        if (!existingFiles.includes(dataTypeFileName)) {
          await window.api?.project?.addFile(dir, dataTypeFileName, 'EDT', content)
          setProjectTree(prev => prev.map(root => ({
            ...root,
            children: root.children?.map(cat =>
              cat.id === '_cat_datatypes'
                ? { ...cat, children: [...(cat.children || []), { id: dataTypeFileName, label: dataTypeFileName, type: 'module' as const, children: extractDataTypeNodes(content, dataTypeFileName), expanded: false }] }
                : cat
            )
          })))
        } else {
          await window.api?.file?.save(filePath, content)
        }

        editorRef.current?.upsertFile({ id: filePath, label: dataTypeFileName, language: 'edt', value: content, savedValue: content, filePath })
        break
      }
      case 'insert:dllCmd':
      {
        const dir = currentProjectDirRef.current
        if (!dir) break
        const existingFiles = projectTree[0]?.children
          ?.find(c => c.id === '_cat_dllcmds')?.children?.map(c => c.label) || []
        const dllFileName = 'DLL命令.ell'
        const filePath = joinPath(dir, dllFileName)

        // 优先使用编辑器中的最新内容（含未保存修改），再回退到磁盘内容
        const editorFiles = editorRef.current?.getEditorFiles()
        const fromEditor = editorFiles?.[dllFileName]
        const fromDisk = fromEditor === undefined ? await window.api?.project?.readFile(filePath) : undefined
        const baseContent = (fromEditor ?? fromDisk ?? '.版本 2\n\n').replace(/\r\n/g, '\n')

        let n = 1
        while (new RegExp('^\\.DLL命令\\s+DLL命令' + n + '(?:,|\\s|$)', 'm').test(baseContent)) n++
        const dllName = 'DLL命令' + n
        const appendLine = '.DLL命令 ' + dllName + ', , "", ""'
        const content = baseContent.trimEnd() + '\n' + appendLine + '\n\n'

        if (!existingFiles.includes(dllFileName)) {
          await window.api?.project?.addFile(dir, dllFileName, 'ELL', content)
          setProjectTree(prev => prev.map(root => ({
            ...root,
            children: root.children?.map(cat =>
              cat.id === '_cat_dllcmds'
                ? { ...cat, children: [...(cat.children || []), { id: dllFileName, label: dllFileName, type: 'module' as const, children: extractDllCommandNodes(content, dllFileName), expanded: false }] }
                : cat
            )
          })))
        } else {
          await window.api?.file?.save(filePath, content)
        }

        editorRef.current?.upsertFile({ id: filePath, label: dllFileName, language: 'ell', value: content, savedValue: content, filePath })
        break
      }
      case 'insert:window':
      {
        const dir = currentProjectDirRef.current
        if (!dir) break

        const existingWindowFiles = projectTree[0]?.children
          ?.find(c => c.id === '_cat_windows')?.children?.map(c => c.label) || []

        let n = 1
        while (existingWindowFiles.includes('窗口' + n + '.efw')) n++

        const windowName = '窗口' + n
        const efwFileName = windowName + '.efw'
        const eycFileName = windowName + '.eyc'

        const efwData = JSON.stringify({
          type: 'window',
          name: windowName,
          title: windowName,
          width: 592,
          height: 384,
          sourceFile: eycFileName,
          controls: [],
        }, null, 2)

        const eycContent = '.版本 2\n.程序集 窗口程序集_' + windowName + '\n\n'

        await window.api?.project?.addFile(dir, efwFileName, 'EFW', efwData)
        await window.api?.project?.addFile(dir, eycFileName, 'EYC', eycContent)

        setProjectTree(prev => prev.map(root => ({
          ...root,
          children: root.children?.map(cat => {
            if (cat.id === '_cat_windows') {
              return {
                ...cat,
                children: [...(cat.children || []), { id: efwFileName, label: efwFileName, type: 'window' as const }],
              }
            }
            if (cat.id === '_cat_sources') {
              return {
                ...cat,
                children: [...(cat.children || []), {
                  id: eycFileName,
                  label: eycFileName,
                  type: 'module' as const,
                  children: extractSubroutineNodes(eycContent, eycFileName),
                  expanded: false,
                }],
              }
            }
            return cat
          }),
        })))

        await openFileByPath(joinPath(dir, efwFileName))
        break
      }
      case 'insert:resource':
      {
        const dir = currentProjectDirRef.current
        if (!dir) break

        const resourceFileName = '资源表.erc'
        const resourceTablePath = joinPath(dir, resourceFileName)
        const editorFiles = editorRef.current?.getEditorFiles?.() || {}

        let content = ''
        let fileExists = false
        if (typeof editorFiles[resourceFileName] === 'string') {
          content = editorFiles[resourceFileName]
          fileExists = true
        } else {
          const diskContent = await window.api?.project?.readFile(resourceTablePath)
          if (typeof diskContent === 'string') {
            content = diskContent
            fileExists = true
          }
        }

        if (!fileExists) {
          content = '.版本 2\n'
        }

        content = normalizeResourceTableContent(content)

        const lines = content.replace(/\r\n/g, '\n').split('\n')
        let nextIndex = 1
        for (const line of lines) {
          const match = /^\s*\.(?:资源|常量)\s+资源(\d+)\b/.exec(line)
          if (!match) continue
          const n = Number(match[1])
          if (Number.isFinite(n) && n >= nextIndex) nextIndex = n + 1
        }

        const newRow = `.资源 资源${nextIndex}, "", 其它`
        let normalized = content.replace(/\r\n/g, '\n')
        if (normalized.length > 0 && !normalized.endsWith('\n')) {
          normalized += '\n'
        }
        const nextContent = `${normalized}${newRow}\n`

        if (fileExists) {
          await window.api?.file?.save(resourceTablePath, nextContent)
        } else {
          const addResult = await window.api?.project?.addFile(dir, resourceFileName, 'ERC', nextContent)
          if (typeof addResult !== 'string' || addResult.length === 0) {
            setOutputMessages(prev => [...prev, { type: 'error', text: '创建资源表失败: addFile 返回无效结果' }])
            break
          }
        }

        setOutputMessages(prev => [...prev, { type: 'info', text: `已在 ${resourceFileName} 插入空资源: 资源${nextIndex}` }])
        editorRef.current?.upsertFile({
          id: resourceTablePath,
          label: resourceFileName,
          language: 'erc',
          value: nextContent,
          savedValue: nextContent,
          filePath: resourceTablePath,
        })
        await refreshProjectTree()
        setSidebarTab('project')
        break
      }

      // 主题切换
      default:
        if (action.startsWith('theme:')) {
          const themeName = action.substring(6)
          applyTheme(themeName)
        }
        break
    }
  }, [openProjectByEppPath, openFileByPath, extractSubroutineNodes, extractGlobalVarNodes, extractConstantNodes, extractDataTypeNodes, extractDllCommandNodes, applyTheme, handleCompile, handleCompileRun, handleStop, handleAppClose, joinPath, projectTree, refreshProjectTree, toggleBreakpoint, cursorLine, cursorSourceLine, currentProjectDir, breakpointsByFile, targetArch, continueDebugRun, getBaseName])

  useEffect(() => {
    const handleNativeMenuAction = (action: unknown) => {
      if (typeof action !== 'string') return
      void handleMenuAction(action)
    }

    window.api.on('menu:action', handleNativeMenuAction)
    return () => {
      window.api.off('menu:action')
    }
  }, [handleMenuAction])

  useEffect(() => {
    const handleWindowCloseRequest = () => {
      void handleAppClose()
    }
    window.api.on('app:requestClose', handleWindowCloseRequest)
    return () => {
      window.api.off('app:requestClose')
    }
  }, [handleAppClose])

  // 双击资源管理器文件时打开
  const handleOpenFile = useCallback(async (fileId: string, fileName: string, targetLine?: number) => {
    const dir = currentProjectDirRef.current
    if (!dir) return
    const filePath = joinPath(dir, fileName)
    await openFileByPath(filePath, targetLine)
  }, [joinPath, openFileByPath])

  const handleNewProjectConfirm = useCallback(async (info: { name: string; path: string; type: string; platform: string }) => {
    try {
      const result = await window.api?.project?.create(info)
      if (!result) return

      setCurrentProjectDir(result.projectDir)
      const normalizedPlatform = normalizeTargetPlatform(info.platform)
      setTargetPlatform(normalizedPlatform)
      setTargetArch(coerceArchByPlatform(normalizedPlatform, normalizeTargetArch(info.platform)))

      // 通过解析 epp 文件获取所有关联文件并构建项目树
      const eppInfo = await window.api?.project?.parseEpp(result.eppPath)
      if (eppInfo) {
        setProjectTree(await buildProjectTreeFromEpp(eppInfo.projectName, eppInfo.files, result.projectDir))
      }

      // 窗口程序：仅打开 efw 窗口文件
      if (info.type === 'windows-app') {
        const efwPath = joinPath(result.projectDir, '_启动窗口.efw')
        const efwContent = await window.api?.project?.readFile(efwPath)
        if (efwContent) {
          const efwData = JSON.parse(efwContent)
          const formData: DesignForm = {
            name: efwData.name || '_启动窗口',
            title: efwData.title || info.name,
            width: efwData.width || 592,
            height: efwData.height || 384,
            sourceFile: efwData.sourceFile,
            properties: efwData.properties || undefined,
            controls: (efwData.controls || []).map((c: any) => ({
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
            }))
          }
          setOpenProjectFiles([{
            id: efwPath,
            label: '_启动窗口.efw',
            language: 'efw',
            value: '',
            savedValue: JSON.stringify(formData, null, 2),
            filePath: efwPath,
            formData,
          }])
        }
      }
      // 控制台/DLL：打开 eyc 文件
      else {
        const eycPath = joinPath(result.projectDir, `${info.name}.eyc`)
        const eycContent = await window.api?.project?.readFile(eycPath)
        if (eycContent) {
          setOpenProjectFiles([{
            id: eycPath,
            label: `${info.name}.eyc`,
            language: 'eyc',
            value: eycContent,
            savedValue: eycContent,
            filePath: eycPath,
          }])
        }
      }
      pushRecentOpened({
        type: 'project',
        path: result.eppPath,
        label: info.name,
      })
    } catch (err) {
      console.error('创建项目失败:', err)
    }
  }, [buildProjectTreeFromEpp, joinPath, pushRecentOpened])

  // 全局快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // 已被子组件处理
      if (e.defaultPrevented) return
      // 弹窗打开时不处理快捷键
      if (showLibrary || showNewProject) return

      const ctrl = e.ctrlKey || e.metaKey
      const shift = e.shiftKey
      const code = e.code
      const key = e.key

      let action: string | null = null

      // 文件菜单
      if (ctrl && shift && code === 'KeyN') action = 'file:newProject'
      else if (ctrl && shift && code === 'KeyO') action = 'file:openProject'
      else if (ctrl && shift && code === 'KeyS') action = 'file:saveAll'
      else if (ctrl && !shift && code === 'KeyS') action = 'file:save'
      else if (ctrl && !shift && code === 'KeyW') action = 'file:closeFile'
      // 编辑菜单
      else if (ctrl && !shift && code === 'KeyZ') action = 'edit:undo'
      else if (isRedoShortcut(e, runtimePlatform)) action = 'edit:redo'
      else if (ctrl && !shift && code === 'KeyX') action = 'edit:cut'
      else if (ctrl && !shift && code === 'KeyC') action = 'edit:copy'
      else if (ctrl && !shift && code === 'KeyV') action = 'edit:paste'
      else if (ctrl && !shift && code === 'KeyF') action = 'edit:find'
      else if (ctrl && !shift && code === 'KeyH') action = 'edit:replace'
      // 编译菜单
      else if (ctrl && !shift && key === 'F7') action = 'build:compile'
      else if (!ctrl && !shift && key === 'F7') action = 'build:build'
      // 调试菜单
      else if (!ctrl && !shift && key === 'F5') action = 'build:run'
      else if (!ctrl && shift && key === 'F5') action = 'debug:stop'
      else if (!ctrl && !shift && key === 'F9') action = 'debug:toggleBreakpoint'
      else if (!ctrl && !shift && key === 'F10') action = 'debug:stepOver'
      else if (ctrl && !shift && key === 'F10') action = 'debug:runToCursor'
      else if (!ctrl && !shift && key === 'F11') action = 'debug:stepInto'
      else if (!ctrl && shift && key === 'F11') action = 'debug:stepOut'
      // 帮助
      // 插入菜单
      else if (ctrl && !shift && code === 'KeyL') action = 'insert:localVar'
      else if (!ctrl && !shift && key === 'F1') action = 'help:topics'

      if (action) {
        // 编辑类快捷键在原生输入框中时让浏览器处理
        const tag = (document.activeElement as HTMLElement)?.tagName
        if (action.startsWith('edit:') && action !== 'edit:find' && action !== 'edit:replace'
          && (tag === 'INPUT' || tag === 'TEXTAREA')) return
        // 有浏览器原生文本选中时，让浏览器处理复制/剪切/全选
        if ((action === 'edit:copy' || action === 'edit:cut' || action === 'edit:selectAll') && window.getSelection()?.toString()) return
        e.preventDefault()
        handleMenuAction(action)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleMenuAction, runtimePlatform, showLibrary, showNewProject])

  const openProjectExplorer = useCallback(() => {
    setSidebarCollapsed(false)
    setSidebarTab('project')
  }, [])

  const openLibraryPanel = useCallback(() => {
    setSidebarCollapsed(false)
    setSidebarTab('project')
    setShowOutput(true)
    setOutputMessages(prev => [...prev, { type: 'info', text: '插件功能正在开发中。' }])
  }, [])

  const openScmPanel = useCallback(() => {
    setSidebarCollapsed(false)
    setSidebarTab('project')
    setShowOutput(true)
    setOutputMessages(prev => [...prev, { type: 'info', text: '源代码管理功能正在开发中。' }])
  }, [])

  const openSearchPanel = useCallback(() => {
    setSidebarCollapsed(false)
    setSidebarTab('project')
    setShowOutput(true)
    setOutputMessages(prev => [...prev, { type: 'info', text: '搜索功能正在开发中。' }])
  }, [])

  const openAIPanel = useCallback(() => {
    setShowAIPanel(prev => {
      const next = !prev
      try { localStorage.setItem(AI_PANEL_OPEN_KEY, String(next)) } catch {}
      return next
    })
  }, [])

  const openUserPanel = useCallback(() => {
    setShowOutput(true)
    setOutputMessages(prev => [...prev, { type: 'info', text: '用户功能正在开发中。' }])
  }, [])

  const getActiveEditorTab = useCallback((): EditorTab | null => {
    const activeId = activeFileIdRef.current
    if (!activeId) return null
    return openTabsRef.current.find(item => item.id === activeId) || null
  }, [])

  const getActiveTextTab = useCallback((): EditorTab | null => {
    const activeTab = getActiveEditorTab()
    if (!activeTab) return null
    if (activeTab.language === 'efw') return null
    return activeTab
  }, [getActiveEditorTab])

  const getTextTabByPath = useCallback((targetPath: string): EditorTab | null => {
    if (!targetPath) return null
    const normalized = targetPath.toLowerCase()
    const tab = openTabsRef.current.find(item => {
      if (item.language === 'efw') return false
      const itemPath = (item.filePath || item.label).toLowerCase()
      return itemPath === normalized
    })
    return tab || null
  }, [])

  const activeAIFilePath = (() => {
    const activeTab = openTabsRef.current.find(item => item.id === activeFileId) || null
    if (!activeTab) return null
    const candidatePath = activeTab.filePath || activeTab.label
    if (!candidatePath || !isAIEditableFile(candidatePath)) return null
    return candidatePath
  })()

  const activeAIFileLabel = (() => {
    const activeTab = openTabsRef.current.find(item => item.id === activeFileId) || null
    if (!activeTab) return null
    return activeTab.filePath || activeTab.label
  })()

  const aiIdeContext = useMemo(() => {
    const lines: string[] = [
      `IDE: ycIDE v0.0.2.48（易承语言集成开发环境）`,
      `运行平台: ${runtimePlatform}`,
      `编译目标: ${targetPlatform} / ${targetArch}`,
    ]
    if (currentProjectDir) {
      const projectName = currentProjectDir.replace(/^.*[\\/]/, '')
      lines.push(`当前项目: ${projectName}`)
      lines.push(`项目路径: ${currentProjectDir}`)
    }
    const tabs = openTabsRef.current
    if (tabs.length > 0) {
      lines.push(`已打开的文件: ${tabs.map(t => t.filePath?.replace(/^.*[\\/]/, '') || t.label).join(', ')}`)
    }
    if (activeAIFileLabel) {
      lines.push(`当前编辑文件: ${activeAIFileLabel}`)
    }
    const allProblems = [...fileProblems, ...designProblems]
    const errorCount = allProblems.filter(p => p.severity === 'error').length
    const warningCount = allProblems.filter(p => p.severity === 'warning').length
    if (errorCount > 0 || warningCount > 0) {
      lines.push(`问题面板: ${errorCount} 个错误, ${warningCount} 个警告`)
    }
    return lines.join('\n')
  }, [runtimePlatform, targetPlatform, targetArch, currentProjectDir, activeAIFileLabel, fileProblems, designProblems])

  const handleAIModelChange = useCallback(async (model: AISupportedModel, persist = true) => {
    const next = resolveIDESettings({ ...ideSettings, aiModel: model })
    setIdeSettings(next)
    if (!persist) return
    try {
      const saved = await window.api?.settings?.save({ aiModel: model })
      if (saved) setIdeSettings(resolveIDESettings(saved))
    } catch {
      // 保持本地变更
    }
  }, [ideSettings])

  const handleAIChat = useCallback(async (messages: AIChatMessage[]) => {
    const result = await window.api?.ai?.chat({ model: ideSettings.aiModel, messages })
    if (!result) {
      return { ok: false, message: '', error: 'AI 服务暂不可用。' }
    }
    return result
  }, [ideSettings.aiModel])

  const handleAIChatStream = useCallback(async (
    messages: AIChatMessage[],
    onDelta: (delta: string) => void,
  ) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const channel = 'ai:chatStream:chunk'

    const handleChunk = (payload: unknown): void => {
      if (!payload || typeof payload !== 'object') return
      const data = payload as { requestId?: string; delta?: string; done?: boolean }
      if (data.requestId !== requestId) return
      if (typeof data.delta === 'string' && data.delta) {
        onDelta(data.delta)
      }
    }

    window.api.on(channel, handleChunk)
    try {
      const result = await window.api?.ai?.chatStream({ model: ideSettings.aiModel, messages }, requestId)
      if (!result) {
        return { ok: false, message: '', error: 'AI 服务暂不可用。' }
      }
      return result
    } finally {
      window.api.off(channel)
    }
  }, [ideSettings.aiModel])

  const handleAIRequestEdit = useCallback(async (instruction: string, targetFilePath: string): Promise<AIEditResult> => {
    const tab = getTextTabByPath(targetFilePath)
    const language = inferAIEditableLanguage(targetFilePath)
    if (!language) {
      return {
        ok: false,
        filePath: targetFilePath,
        summary: '',
        diff: '',
        originalContent: '',
        proposedContent: '',
        error: '请选择一个可编辑的源码文件。',
      }
    }

    let currentContent = ''
    if (tab) {
      const fileKey = tab.filePath?.replace(/^.*[\\/]/, '') || tab.label
      const editorFiles = editorRef.current?.getEditorFiles() || {}
      currentContent = editorFiles[fileKey] ?? tab.value
    } else {
      const fromDisk = await window.api?.project?.readFile(targetFilePath)
      if (typeof fromDisk !== 'string') {
        return {
          ok: false,
          filePath: targetFilePath,
          summary: '',
          diff: '',
          originalContent: '',
          proposedContent: '',
          error: '无法读取目标文件，请确认文件存在且可访问。',
        }
      }
      currentContent = fromDisk
    }

    const filePath = targetFilePath
    const result = await window.api?.ai?.proposeEdit({
      model: ideSettings.aiModel,
      instruction,
      filePath,
      fileContent: currentContent,
      problems: [...fileProblems, ...designProblems].map(p => ({
        line: p.line,
        column: p.column,
        message: p.message,
        severity: p.severity,
        file: p.file,
      })),
      ideContext: aiIdeContext,
    })

    if (!result) {
      return {
        ok: false,
        filePath,
        summary: '',
        diff: '',
        originalContent: currentContent,
        proposedContent: '',
        error: 'AI 编辑服务暂不可用。',
      }
    }

    return result
  }, [getTextTabByPath, ideSettings.aiModel, fileProblems, designProblems, aiIdeContext])

  const handleAIRequestEditStream = useCallback(async (
    instruction: string,
    targetFilePath: string,
    onDelta: (delta: string) => void,
    onReasoning?: (delta: string) => void,
  ): Promise<AIEditResult> => {
    const tab = getTextTabByPath(targetFilePath)
    const language = inferAIEditableLanguage(targetFilePath)
    if (!language) {
      return {
        ok: false,
        filePath: targetFilePath,
        summary: '',
        diff: '',
        originalContent: '',
        proposedContent: '',
        error: '请选择一个可编辑的源码文件。',
      }
    }

    let currentContent = ''
    if (tab) {
      const fileKey = tab.filePath?.replace(/^.*[\\/]/, '') || tab.label
      const editorFiles = editorRef.current?.getEditorFiles() || {}
      currentContent = editorFiles[fileKey] ?? tab.value
    } else {
      const fromDisk = await window.api?.project?.readFile(targetFilePath)
      if (typeof fromDisk !== 'string') {
        return {
          ok: false,
          filePath: targetFilePath,
          summary: '',
          diff: '',
          originalContent: '',
          proposedContent: '',
          error: '无法读取目标文件，请确认文件存在且可访问。',
        }
      }
      currentContent = fromDisk
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const channel = 'ai:proposeEditStream:chunk'
    const handleChunk = (payload: unknown): void => {
      if (!payload || typeof payload !== 'object') return
      const data = payload as { requestId?: string; delta?: string; type?: string }
      if (data.requestId !== requestId) return
      if (typeof data.delta === 'string' && data.delta) {
        if (data.type === 'reasoning' && onReasoning) {
          onReasoning(data.delta)
        } else {
          onDelta(data.delta)
        }
      }
    }

    window.api.on(channel, handleChunk)
    try {
      const result = await window.api?.ai?.proposeEditStream({
        model: ideSettings.aiModel,
        instruction,
        filePath: targetFilePath,
        fileContent: currentContent,
        problems: [...fileProblems, ...designProblems].map(p => ({
          line: p.line,
          column: p.column,
          message: p.message,
          severity: p.severity,
          file: p.file,
        })),
        ideContext: aiIdeContext,
      }, requestId)

      if (!result) {
        return {
          ok: false,
          filePath: targetFilePath,
          summary: '',
          diff: '',
          originalContent: currentContent,
          proposedContent: '',
          error: 'AI 编辑服务暂不可用。',
        }
      }
      return result
    } finally {
      window.api.off(channel)
    }
  }, [getTextTabByPath, ideSettings.aiModel, fileProblems, designProblems, aiIdeContext])

  const handleAIApplyEdit = useCallback(async (result: AIEditResult, overrideContent?: string): Promise<boolean> => {
    const nextContent = typeof overrideContent === 'string' ? overrideContent : result.proposedContent
    if (!result.ok || !nextContent) return false
    const language = inferAIEditableLanguage(result.filePath)
    if (!language) return false

    const originalContent = result.originalContent || ''

    const tab = getTextTabByPath(result.filePath)
    if (tab) {
      editorRef.current?.upsertFile({
        ...tab,
        value: nextContent,
        savedValue: tab.savedValue,
      })
    } else {
      const diskContent = await window.api?.project?.readFile(result.filePath)
      if (typeof diskContent !== 'string') return false
      const label = getBaseName(result.filePath)
      editorRef.current?.upsertFile({
        id: result.filePath,
        label,
        language,
        value: nextContent,
        savedValue: diskContent,
        filePath: result.filePath,
      })
    }

    // 计算 diff 行信息并高亮
    const diffInfo = computeDiffLineInfo(originalContent, nextContent)
    if (diffInfo.addedLines.length > 0 || diffInfo.deletedGroups.length > 0) {
      editorRef.current?.applyDiffHighlight(result.filePath, diffInfo)
    }

    setShowOutput(true)
    setOutputMessages(prev => [...prev, { type: 'info', text: `已应用 AI 编辑建议到 ${result.filePath}` }])
    return true
  }, [getTextTabByPath, getBaseName])

  const handleAIUndoEdit = useCallback(async (result: AIEditResult): Promise<boolean> => {
    if (!result.ok || !result.originalContent) return false
    const language = inferAIEditableLanguage(result.filePath)
    if (!language) return false

    editorRef.current?.clearDiffHighlight()

    const tab = getTextTabByPath(result.filePath)
    if (tab) {
      editorRef.current?.upsertFile({
        ...tab,
        value: result.originalContent,
        savedValue: tab.savedValue,
      })
    } else {
      const diskContent = await window.api?.project?.readFile(result.filePath)
      if (typeof diskContent !== 'string') return false
      const label = getBaseName(result.filePath)
      editorRef.current?.upsertFile({
        id: result.filePath,
        label,
        language,
        value: result.originalContent,
        savedValue: diskContent,
        filePath: result.filePath,
      })
    }

    setOutputMessages(prev => [...prev, { type: 'info', text: `已撤销 AI 编辑：${result.filePath}` }])
    return true
  }, [getTextTabByPath, getBaseName])

  const handleAIKeepEdit = useCallback(() => {
    editorRef.current?.clearDiffHighlight()
  }, [])

  const toggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed(prev => !prev)
  }, [])

  const handleActivityBarContextMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const menuWidth = 200
    const menuX = Math.min(e.clientX, window.innerWidth - menuWidth - 8)
    setActivityBarContextMenu({ x: Math.max(0, menuX), y: e.clientY })
  }, [])

  const toggleActivityBarSide = useCallback(() => {
    setActivityBarSide((prev) => (prev === 'left' ? 'right' : 'left'))
  }, [])

  const toggleActivityBarSideFromMenu = useCallback(() => {
    toggleActivityBarSide()
    setActivityBarContextMenu(null)
  }, [toggleActivityBarSide])

  return (
    <div className={`app${isWorkspaceEmpty ? ' app-empty-workspace' : ''}`}>
      <TitleBar onMenuAction={handleMenuAction} onWindowClose={() => { void handleAppClose() }} runtimePlatform={runtimePlatform} hasProject={!!currentProjectDir} hasOpenFile={(openProjectFiles?.length ?? 0) > 0} themes={themeList} currentTheme={currentTheme} recentOpened={recentOpened} />
      <Toolbar
        runtimePlatform={runtimePlatform}
        preserveOriginalIconColors={themeIconConfig.preserveToolbarIconOriginalColors}
        hasControlSelected={multiSelectCount >= 2}
        onAlign={setAlignAction}
        onCompileRun={handleCompileRun}
        onStop={handleStop}
        onDebugStepOver={() => { void handleMenuAction('debug:stepOver') }}
        onDebugStepInto={() => { void handleMenuAction('debug:stepInto') }}
        onDebugStepOut={() => { void handleMenuAction('debug:stepOut') }}
        onDebugRunToCursor={() => { void handleMenuAction('debug:runToCursor') }}
        hasProject={!!currentProjectDir}
        isCompiling={isCompiling}
        isRunning={isRunning}
        isDebugPaused={!!debugPause && !debugResumePending}
        platform={targetPlatform}
        arch={targetArch}
        onPlatformChange={(platform: string) => {
          const normalizedPlatform = normalizeTargetPlatform(platform)
          setTargetPlatform(normalizedPlatform)
          setTargetArch(prev => coerceArchByPlatform(normalizedPlatform, prev))
          if (currentProjectDir) window.api?.project?.updatePlatform(currentProjectDir, normalizedPlatform)
        }}
        onArchChange={(arch: string) => {
          const normalizedArch = normalizeTargetArch(arch)
          const coercedArch = coerceArchByPlatform(targetPlatform, normalizedArch)
          setTargetArch(coercedArch)
        }}
        onNew={() => handleMenuAction('file:newProject')}
        onOpen={() => handleMenuAction('file:openProject')}
        onSave={() => handleMenuAction('file:save')}
        onUndo={() => handleMenuAction('edit:undo')}
        onRedo={() => handleMenuAction('edit:redo')}
      />
      <div className={`app-body${isWorkspaceEmpty ? ' app-body-empty-workspace' : ''}${activityBarSide === 'right' ? ' app-body-right' : ''}`}>
        <aside className={`activity-bar${activityBarSide === 'right' ? ' activity-bar-right' : ''}`} role="navigation" aria-label="主活动栏" onContextMenu={handleActivityBarContextMenu}>
          <button
            type="button"
            className="activity-button"
            title={sidebarCollapsed ? '展开侧边栏' : '收缩侧边栏'}
            aria-label={sidebarCollapsed ? '展开侧边栏' : '收缩侧边栏'}
            onClick={toggleSidebarCollapse}
          >
            <Icon preserveOriginalColors className="activity-icon-original" name={sidebarCollapsed ? 'expand-right' : 'collapse-left'} size={ideSettings.toolbarIconSize} />
          </button>
          <button
            type="button"
            className={`activity-button ${!sidebarCollapsed && sidebarTab === 'project' ? 'active' : ''}`}
            title="资源管理器"
            aria-label="资源管理器"
            onClick={openProjectExplorer}
          >
            <Icon preserveOriginalColors className="activity-icon-original" name="resource-view" size={ideSettings.toolbarIconSize} />
          </button>
          <button
            type="button"
            className="activity-button"
            title="搜索"
            aria-label="搜索"
            onClick={openSearchPanel}
          >
            <Icon preserveOriginalColors className="activity-icon-original" name="search" size={ideSettings.toolbarIconSize} />
          </button>
          <button
            type="button"
            className="activity-button"
            title="源代码管理"
            aria-label="源代码管理"
            onClick={openScmPanel}
          >
            <Icon preserveOriginalColors className="activity-icon-original" name="source-control" size={ideSettings.toolbarIconSize} />
          </button>
          <button
            type="button"
            className={`activity-button ${!sidebarCollapsed && sidebarTab === 'library' ? 'active' : ''}`}
            title="插件"
            aria-label="插件"
            onClick={openLibraryPanel}
          >
            <Icon preserveOriginalColors className="activity-icon-original" name="extension" size={ideSettings.toolbarIconSize} />
          </button>
          <button
            type="button"
            className={`activity-button ${showAIPanel ? 'active' : ''}`}
            title="AI 助手"
            aria-label="AI 助手"
            onClick={openAIPanel}
          >
            <Icon preserveOriginalColors className="activity-icon-original" name="spy" size={ideSettings.toolbarIconSize} />
          </button>
          <button
            type="button"
            className="activity-button activity-button-bottom"
            title="用户"
            aria-label="用户"
            onClick={openUserPanel}
          >
            <Icon preserveOriginalColors className="activity-icon-original" name="account" size={ideSettings.toolbarIconSize} />
          </button>
        </aside>
        {activityBarContextMenu && (
          <div
            className="activity-context-menu"
            style={{ left: activityBarContextMenu.x, top: activityBarContextMenu.y }}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              type="button"
              className="activity-context-menu-item"
              onClick={toggleActivityBarSideFromMenu}
            >
              {activityBarSide === 'right' ? '将主活动栏切换到左侧' : '将主活动栏切换到右侧'}
            </button>
          </div>
        )}
        <div className="app-content">
          <div className="app-workspace">
            <div className={`app-side${activityBarSide === 'right' ? ' app-side-right' : ''}`}>
              {!sidebarCollapsed && (
                <Sidebar width={sidebarWidth} onResize={setSidebarWidth} placement={activityBarSide} selection={selection} activeTab={sidebarTab} onTabChange={setSidebarTab} onSelectControl={setSelection} onPropertyChange={(kind, ctrlId, prop, val) => editorRef.current?.updateFormProperty(kind, ctrlId, prop, val)} projectTree={projectTree} onOpenFile={handleOpenFile} activeFileId={activeFileId ? activeFileId.replace(/^.*[\\/]/, '') : null} projectDir={currentProjectDir} onEventNavigate={(sel, eventName, eventArgs) => editorRef.current?.navigateToEventSub(sel, eventName, eventArgs)} onLibraryChange={handleLibraryChange} />
              )}
              <div className="app-main">
                <Editor
                  ref={editorRef}
                  onSelectControl={setSelection}
                  onSidebarTab={setSidebarTab}
                  selection={selection}
                  alignAction={alignAction}
                  onAlignDone={handleAlignDone}
                  onMultiSelectChange={setMultiSelectCount}
                  openProjectFiles={openProjectFiles}
                  onOpenTabsChange={handleOpenTabsChange}
                  onActiveTabChange={setActiveFileId}
                  onCommandClick={handleCommandClick}
                  onCommandClear={handleCommandClear}
                  onProblemsChange={setFileProblems}
                  onCursorChange={(line, col, sourceLine) => { setCursorLine(line); setCursorColumn(col); setCursorSourceLine(sourceLine) }}
                  onDocTypeChange={setDocType}
                  projectDir={currentProjectDir}
                  onProjectTreeRefresh={refreshProjectTree}
                  breakpointsByFile={breakpointsByFile}
                  debugLocation={debugPause ? { file: debugPause.file, line: debugPause.line } : null}
                  debugVariables={debugPause?.variables || []}
                  currentTheme={currentTheme}
                  themeTokenValues={themeTokenValues}
                  editorFontFamily={ideSettings.editorFontFamily}
                  editorFontSize={ideSettings.editorFontSize}
                  editorLineHeight={ideSettings.editorLineHeight}
                />
              </div>
            </div>
          </div>
          {showOutput && (
            <OutputPanel
              height={outputHeight}
              onResize={setOutputHeight}
              onClose={() => setShowOutput(false)}
              messages={outputMessages}
              commandDetail={commandDetail}
              highlightParamIndex={highlightParamIndex}
              problems={[...fileProblems, ...designProblems]}
              debugPause={debugPause ? { ...debugPause, line: debugDisplayLine ?? debugPause.line } : null}
              isDebugPaused={!!debugPause && !debugResumePending}
              onDebugContinue={() => { void continueDebugRun() }}
              forceTab={forceOutputTab}
              onProblemClick={(p) => editorRef.current?.navigateToLine(p.line)}
            />
          )}
        </div>
        {showAIPanel && (
          <AIAssistantPanel
            model={ideSettings.aiModel}
            customModels={ideSettings.aiCustomModels}
            activeFilePath={activeAIFilePath}
            activeFileLabel={activeAIFileLabel}
            problems={[...fileProblems, ...designProblems]}
            placement={activityBarSide === 'right' ? 'left' : 'right'}
            ideContext={aiIdeContext}
            aiFontFamily={ideSettings.aiFontFamily}
            aiFontSize={ideSettings.aiFontSize}
            onModelChange={(model, persist) => { void handleAIModelChange(model, persist) }}
            onChat={handleAIChat}
            onChatStream={handleAIChatStream}
            onRequestEdit={handleAIRequestEdit}
            onRequestEditStream={handleAIRequestEditStream}
            onApplyEdit={handleAIApplyEdit}
            onUndoEdit={handleAIUndoEdit}
            onKeepEdit={handleAIKeepEdit}
          />
        )}
      </div>
      <StatusBar
        onToggleOutput={() => setShowOutput(!showOutput)}
        errorCount={[...fileProblems, ...designProblems].filter(p => p.severity === 'error').length}
        warningCount={[...fileProblems, ...designProblems].filter(p => p.severity === 'warning').length}
        cursorLine={cursorLine}
        cursorColumn={cursorColumn}
        docType={docType}
      />
      <LibraryDialog open={showLibrary} onClose={() => setShowLibrary(false)} />
      <NewProjectDialog open={showNewProject} onClose={() => setShowNewProject(false)} onConfirm={handleNewProjectConfirm} />
      {showSettings && settingsPortalRoot && createPortal(
        <SettingsDialog
          settings={ideSettings}
          onClose={handleSettingsCancel}
          onSave={(s) => { void handleSettingsSaveAndClose(s) }}
          onChange={handleSettingsPreviewChange}
        />,
        settingsPortalRoot,
      )}
      <ThemeSettingsDialog
        open={showThemeSettings}
        onClose={(intent) => { void handleThemeDraftCloseIntent(intent) }}
        themes={themeList}
        currentTheme={currentTheme}
        onSelectTheme={(themeId) => { void handleThemeSelect(themeId) }}
        tokenValues={themeTokenValues}
        onTokenChange={handleThemeTokenChange}
        flowLineConfig={themeFlowLine}
        onFlowLineModeChange={handleThemeFlowLineModeChange}
        onFlowLineMainColorChange={handleThemeFlowLineMainColorChange}
        onFlowLineDepthStepChange={handleThemeFlowLineDepthStepChange}
        onResetToken={handleThemeTokenResetItem}
        onResetGroup={handleThemeTokenResetGroup}
        onResetAll={handleThemeTokenResetAll}
        onSaveAsCustom={handleSaveAsCustomTheme}
        saveFeedback={themeSaveFeedback}
        canUndo={canUndoThemeDraft}
        onUndo={() => { void handleThemeDraftUndo() }}
        onRestoreBaseline={() => { void handleThemeDraftRestoreBaseline() }}
        onOpenThemeManager={() => setShowThemeManager(true)}
        repairMessage={themeRepairMessage}
      />
      {showThemeManager && themeManagerPortalRoot && createPortal(
        <ThemeManager
        open={showThemeManager}
        detachedWindow={true}
        themes={themeList}
        currentTheme={themeManagerCommittedThemeId || currentTheme}
        draftThemeId={themeDraftSession?.workingThemeId || null}
        hasUnsavedDraft={!!themeDraftSession?.dirty}
        tokenValues={themeTokenValues}
        flowLineConfig={themeFlowLine}
        preserveToolbarIconOriginalColors={themeIconConfig.preserveToolbarIconOriginalColors}
        canUndo={canUndoThemeDraft}
        onClose={() => {
          void (async () => {
            const canClose = await handleThemeDraftCloseIntent('close-button')
            if (canClose) {
              if (themeManagerCommittedThemeId && currentTheme !== themeManagerCommittedThemeId) {
                await applyTheme(themeManagerCommittedThemeId, false)
              }
              setShowThemeManager(false)
            }
          })()
        }}
        onSelectTheme={async (themeId) => { await handleThemeManagerPreviewTheme(themeId) }}
        onApplyTheme={async (themeId) => { await handleThemeManagerApplyTheme(themeId) }}
        onTokenChange={handleThemeTokenChange}
        onFlowLineModeChange={handleThemeFlowLineModeChange}
        onFlowLineMainColorChange={handleThemeFlowLineMainColorChange}
        onFlowLineDepthStepChange={handleThemeFlowLineDepthStepChange}
        onPreserveToolbarIconOriginalColorsChange={handlePreserveToolbarIconOriginalColorsChange}
        onResetToken={handleThemeTokenResetItem}
        onResetGroup={handleThemeTokenResetGroup}
        onResetAll={handleThemeTokenResetAll}
        onUndo={() => { void handleThemeDraftUndo() }}
        onRestoreBaseline={() => { void handleThemeDraftRestoreBaseline() }}
        onExportTheme={handleThemeManagerExport}
        onDeleteTheme={handleThemeManagerDelete}
        onSaveTheme={handleThemeManagerSaveTheme}
        onSaveAsTheme={handleThemeManagerSaveAsTheme}
        onRenameTheme={handleThemeManagerRename}
        onImportThemePrepare={handleThemeManagerImportPrepare}
        onImportThemeCommit={handleThemeManagerImportCommit}
      />,
        themeManagerPortalRoot
      )}
    </div>
  )
}

export default App
