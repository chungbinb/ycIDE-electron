import { useState, useCallback, useEffect, useRef } from 'react'
import TitleBar from './components/TitleBar/TitleBar'
import Toolbar from './components/Toolbar/Toolbar'
import Sidebar from './components/Sidebar/Sidebar'
import type { TreeNode } from './components/Sidebar/Sidebar'
import Icon from './components/Icon/Icon'
import Editor, { type EditorTab, type EditorHandle } from './components/Editor/Editor'
import OutputPanel, { type OutputMessage, type CommandDetail, type FileProblem, type DebugPauseState } from './components/OutputPanel/OutputPanel'
import StatusBar from './components/StatusBar/StatusBar'
import LibraryDialog from './components/LibraryDialog/LibraryDialog'
import NewProjectDialog from './components/NewProjectDialog/NewProjectDialog'
import type { SelectionTarget, AlignAction, DesignForm, DesignControl } from './components/Editor/VisualDesigner'
import { isRedoShortcut, type RuntimePlatform } from './utils/shortcuts'
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

const RECENT_OPENED_KEY = 'ycide.recentOpened.v1'
const MAX_RECENT_OPENED = 10

type TargetPlatform = 'windows' | 'macos' | 'linux'
type TargetArch = 'x64' | 'x86' | 'arm64'

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

function normalizeResourceTableContent(raw: string): string {
  const nonEmptyLines = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => line.replace(/^(\s*)\.常量\b/, '$1.资源'))

  if (nonEmptyLines.length === 0) return '.版本 2\n'

  return `${nonEmptyLines.join('\n')}\n`
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
  const [targetPlatform, setTargetPlatform] = useState<TargetPlatform>('windows')
  const [targetArch, setTargetArch] = useState<TargetArch>('x64')
  const [recentOpened, setRecentOpened] = useState<RecentOpenedItem[]>([])

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
    const name = commandName.includes('.') ? commandName.split('.').pop()! : commandName
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
    const cmd = allCommands.find((c: CommandDetail) => c.name === name)
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
      setCommandDetail({ name, englishName: '', description: '未在已加载的支持库中找到此命令', returnType: '', category: '', libraryName: '', params: [] })
    }
    setShowOutput(true)
  }, [])

  const handleCommandClear = useCallback(() => {
    setCommandDetail(null)
  }, [])

  // 加载主题列表和当前主题
  const applyTheme = useCallback(async (name: string) => {
    const theme = await window.api?.theme?.load(name)
    if (!theme?.colors) return
    const root = document.documentElement
    for (const [key, value] of Object.entries(theme.colors)) {
      root.style.setProperty(key, value as string)
    }
    setCurrentTheme(name)
    window.api?.theme?.setCurrent(name)
  }, [])

  useEffect(() => {
    (async () => {
      const list = await window.api?.theme?.getList()
      if (list) setThemeList(list)
      const saved = await window.api?.theme?.getCurrent()
      if (saved) applyTheme(saved)
    })()
  }, [applyTheme])

  const handleAlignDone = useCallback(() => setAlignAction(null), [])

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
    const hasUnsaved = editorRef.current?.hasModifiedTabs?.() ?? false
    if (hasUnsaved) {
      const action = await window.api?.dialog?.confirmSaveBeforeClose('未保存文件')
      if (action === 'cancel') return
      if (action === 'save') {
        editorRef.current?.saveAll()
      }
    }
    window.api?.window.close()
  }, [])

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
    return true
  }, [buildProjectTreeFromEpp, buildTabFromPath, getBaseName, getDirName, joinPath, pushRecentOpened])

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
      case 'view:library':
      case 'tools:library':
        setShowLibrary(true)
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

  const openUserPanel = useCallback(() => {
    setShowOutput(true)
    setOutputMessages(prev => [...prev, { type: 'info', text: '用户功能正在开发中。' }])
  }, [])

  const toggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed(prev => !prev)
  }, [])

  return (
    <div className="app">
      <TitleBar onMenuAction={handleMenuAction} onWindowClose={() => { void handleAppClose() }} runtimePlatform={runtimePlatform} hasProject={!!currentProjectDir} hasOpenFile={(openProjectFiles?.length ?? 0) > 0} themes={themeList} currentTheme={currentTheme} recentOpened={recentOpened} />
      <Toolbar
        runtimePlatform={runtimePlatform}
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
      <div className="app-body">
        <aside className="activity-bar" aria-label="主活动栏">
          <button
            type="button"
            className="activity-button"
            title={sidebarCollapsed ? '展开侧边栏' : '收缩侧边栏'}
            aria-label={sidebarCollapsed ? '展开侧边栏' : '收缩侧边栏'}
            onClick={toggleSidebarCollapse}
          >
            <Icon name={sidebarCollapsed ? 'expand-right' : 'collapse-left'} size={20} />
          </button>
          <button
            type="button"
            className={`activity-button ${!sidebarCollapsed && sidebarTab === 'project' ? 'active' : ''}`}
            title="资源管理器"
            aria-label="资源管理器"
            onClick={openProjectExplorer}
          >
            <Icon name="resource-view" size={20} />
          </button>
          <button
            type="button"
            className="activity-button"
            title="搜索"
            aria-label="搜索"
            onClick={openSearchPanel}
          >
            <Icon name="search" size={20} />
          </button>
          <button
            type="button"
            className="activity-button"
            title="源代码管理"
            aria-label="源代码管理"
            onClick={openScmPanel}
          >
            <Icon name="source-control" size={20} />
          </button>
          <button
            type="button"
            className={`activity-button ${!sidebarCollapsed && sidebarTab === 'library' ? 'active' : ''}`}
            title="插件"
            aria-label="插件"
            onClick={openLibraryPanel}
          >
            <Icon name="extension" size={20} />
          </button>
          <button
            type="button"
            className="activity-button activity-button-bottom"
            title="用户"
            aria-label="用户"
            onClick={openUserPanel}
          >
            <Icon name="account" size={20} />
          </button>
        </aside>
        <div className="app-content">
          <div className="app-side">
            {!sidebarCollapsed && (
              <Sidebar width={sidebarWidth} onResize={setSidebarWidth} selection={selection} activeTab={sidebarTab} onTabChange={setSidebarTab} onSelectControl={setSelection} onPropertyChange={(kind, ctrlId, prop, val) => editorRef.current?.updateFormProperty(kind, ctrlId, prop, val)} projectTree={projectTree} onOpenFile={handleOpenFile} activeFileId={activeFileId ? activeFileId.replace(/^.*[\\/]/, '') : null} projectDir={currentProjectDir} onEventNavigate={(sel, eventName, eventArgs) => editorRef.current?.navigateToEventSub(sel, eventName, eventArgs)} onLibraryChange={handleLibraryChange} />
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
              />
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
    </div>
  )
}

export default App
