// 网页版（在线编辑器）的 window.api 实现：替代 Electron 预加载脚本。
// - 文件读写落在浏览器内的虚拟文件系统（localStorage 持久化，只在当前浏览器里）
// - 支持库元数据来自构建时生成的 snapshot.json（scripts/web/generate-snapshot.mjs），运行时加载
// - 编译、运行、调试、终端、AI 等依赖桌面环境的功能一律返回“网页版不支持”
import { DEFAULT_IDE_SETTINGS, resolveIDESettings, type IDESettings } from '../shared/settings'
import {
  BUILTIN_DARK_THEME_ID,
  createDefaultThemeConfig,
  createDefaultThemeTokenPayload,
  resolveThemeTokenPayload,
  type ThemeConfigV2,
  type ThemeDefinition,
  type ThemeTokenPayload,
} from '../shared/theme'
import { THEME_TOKEN_GROUPS } from '../shared/theme-tokens'
import { DEMO_EPP, DEMO_FILES, DEMO_ROOT } from './demoProject'

const WEB_NOTICE = '网页版仅用于体验编辑器，编译、运行和调试请下载 ycIDE 桌面版：https://ycide.dev/'
const VFS_KEY = 'ycide.web.vfs.v1'
const SETTINGS_KEY = 'ycide.web.settings.v1'
const THEME_KEY = 'ycide.web.theme.v1'
const SESSION_KEY = 'ycide.web.sessions.v1'
const LAST_PROJECT_EPP_KEY = 'ycide.lastProject.epp.v1'

// ---------- 存储 ----------
const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown): void {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 存储满或被禁用：仅本次会话有效 */ }
  },
}

// ---------- 虚拟文件系统 ----------
const norm = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
const files = new Map<string, { path: string; content: string }>()

const persistVfs = (): void => {
  store.set(VFS_KEY, [...files.values()].map(f => [f.path, f.content]))
}
const writeVfs = (path: string, content: string): void => {
  files.set(norm(path), { path: path.replace(/\//g, '\\'), content })
  persistVfs()
}
const readVfs = (path: string): string | null => files.get(norm(path))?.content ?? null
const removeVfs = (path: string): boolean => {
  const ok = files.delete(norm(path))
  if (ok) persistVfs()
  return ok
}
const listDir = (dir: string): string[] | null => {
  const prefix = `${norm(dir)}\\`
  const names = new Set<string>()
  for (const { path } of files.values()) {
    if (norm(path).startsWith(prefix)) names.add(path.slice(prefix.length).split('\\')[0])
  }
  return names.size ? [...names] : null
}

const saved = store.get<Array<[string, string]>>(VFS_KEY, [])
if (saved.length) {
  for (const [p, c] of saved) files.set(norm(p), { path: p, content: c })
} else {
  for (const [p, c] of Object.entries(DEMO_FILES)) files.set(norm(p), { path: p, content: c })
  persistVfs()
}

/** 恢复示例项目（页面上的“重置示例”按钮调用） */
export function resetDemoProject(): void {
  try {
    localStorage.removeItem(VFS_KEY)
    localStorage.removeItem(SESSION_KEY)
    localStorage.setItem(LAST_PROJECT_EPP_KEY, DEMO_EPP)
  } catch { /* ignore */ }
  location.reload()
}

// 首次进入自动打开示例项目（App 启动时会读取这个键恢复上次的项目）
try {
  const last = localStorage.getItem(LAST_PROJECT_EPP_KEY)
  if (!last || readVfs(last) === null) localStorage.setItem(LAST_PROJECT_EPP_KEY, DEMO_EPP)
} catch { /* ignore */ }

// ---------- 事件 ----------
const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
const emit = (channel: string, ...args: unknown[]): void => {
  listeners.get(channel)?.forEach(cb => { try { cb(...args) } catch (e) { console.error(e) } })
}

// ---------- 主题 ----------
const themeModules = import.meta.glob<ThemeDefinition>(
  ['../../themes/默认*.json', '!../../themes/*副本*.json', '../../plugins/*/themes/*.json'],
  { eager: true, import: 'default' },
)
const themes = new Map<string, ThemeDefinition>()
for (const [path, def] of Object.entries(themeModules)) {
  const id = path.split('/').pop()!.replace(/\.json$/, '')
  if (def && typeof def === 'object' && def.colors) themes.set(id, def)
}
const themeSource = (id: string): 'builtin' | 'plugin' =>
  id.startsWith('默认') ? 'builtin' : 'plugin'
const themeDefaults = (id: string): Record<string, string> => {
  const def = themes.get(id)
  const out: Record<string, string> = {}
  if (!def) return out
  for (const item of THEME_TOKEN_GROUPS.flatMap(g => g.items)) {
    const v = def.colors[item.tokenKey]
    if (typeof v === 'string') out[item.tokenKey] = v
  }
  return out
}
const payloadFor = (id: string, payload?: ThemeTokenPayload): ThemeTokenPayload =>
  payload ? resolveThemeTokenPayload(payload, themeDefaults(id)) : createDefaultThemeTokenPayload(themeDefaults(id))

let themeConfig: ThemeConfigV2 = store.get<ThemeConfigV2 | null>(THEME_KEY, null)
  ?? createDefaultThemeConfig(BUILTIN_DARK_THEME_ID, payloadFor(BUILTIN_DARK_THEME_ID))
if (!themes.has(themeConfig.currentThemeId)) {
  themeConfig = createDefaultThemeConfig(BUILTIN_DARK_THEME_ID, payloadFor(BUILTIN_DARK_THEME_ID))
}
const setTheme = (id: string, payload?: ThemeTokenPayload): ThemeConfigV2 => {
  themeConfig = {
    ...themeConfig,
    currentThemeId: id,
    themePayloads: { ...themeConfig.themePayloads, [id]: payloadFor(id, payload ?? themeConfig.themePayloads[id]) },
  }
  store.set(THEME_KEY, themeConfig)
  return themeConfig
}
const themeSync = () => ({
  config: themeConfig,
  themes: [...themes.keys()],
  currentTheme: themeConfig.currentThemeId,
  menuState: { themes: [...themes.keys()], currentTheme: themeConfig.currentThemeId },
})
const readonlyThemeFail = { success: false as const, code: 'save_failed' as const, message: '网页版不支持自定义主题' }

// ---------- 插件（内置插件清单，只读） ----------
const pluginManifests = Object.values(import.meta.glob<Record<string, unknown>>(
  '../../plugins/*/plugin.json', { eager: true, import: 'default' },
))
const pluginState = {
  plugins: pluginManifests.map(m => ({
    id: String(m.id),
    displayName: String(m.displayName ?? m.id),
    version: String(m.version ?? ''),
    status: 'enabled' as const,
    source: 'builtin',
    publisher: String(m.publisher ?? 'ycide'),
    builtin: true,
    active: true,
    canDisable: false,
    permissions: [],
    needsConsent: false,
    processKind: 'trusted' as const,
    removable: false,
    dev: false,
  })),
  manifests: pluginManifests,
}

// ---------- 支持库 ----------
type Snapshot = {
  list: unknown[]
  infos: Record<string, unknown>
  byPlatform: Record<string, { commands: unknown[]; dataTypes: unknown[]; windowUnits: unknown[] }>
}
// 构建时由 scripts/web/generate-snapshot.mjs 生成到 src/web/public/snapshot.json，运行时按需加载一次
let snapPromise: Promise<Snapshot> | null = null
const loadSnap = (): Promise<Snapshot> => {
  snapPromise ??= fetch(`./snapshot.json?v=${__APP_VERSION__}`).then(r => {
    if (!r.ok) throw new Error(`加载支持库数据失败：${r.status}`)
    return r.json() as Promise<Snapshot>
  }).catch((e) => { snapPromise = null; throw e })
  return snapPromise
}
const libData = async () => (await loadSnap()).byPlatform.windows

// ---------- 设置 ----------
let settings: IDESettings = resolveIDESettings({ ...DEFAULT_IDE_SETTINGS, ...store.get<Partial<IDESettings>>(SETTINGS_KEY, {}) })

// ---------- 其它 ----------
const sessions = store.get<Record<string, { openTabs: string[]; activeTabPath?: string }>>(SESSION_KEY, {})
const notSupported = async () => ({ success: false, ok: false, canceled: true, message: WEB_NOTICE, error: WEB_NOTICE })
const showNotice = (): void => { window.alert(WEB_NOTICE) }
const dirOf = (p: string): string => p.replace(/[\\/][^\\/]*$/, '')

const api = {
  window: {
    minimize: () => {},
    maximize: () => {},
    close: () => {},
    forceClose: () => {},
    setOpacity: () => {},
  },
  compilerEnv: {
    getWarmupState: async () => ({ phase: 'no-compiler' as const, message: '网页版不支持编译' }),
    ensureWarm: async () => ({ phase: 'no-compiler' as const, message: '网页版不支持编译' }),
    onWarmupState: () => () => {},
  },
  clipboard: { restoreEycLongTexts: async () => null },
  about: {
    getInfo: async () => ({
      appVersion: `${__APP_VERSION__} (网页版)`,
      author: 'chungbinb',
      license: 'MIT',
      runtime: { electron: '-', chromium: navigator.userAgent, node: '-', v8: '-' },
      zig: '-',
      libs: { react: '19', monaco: '-', xterm: '-', nodePty: '-', vite: '-', typescript: '-' },
    }),
    openExternal: async (url: string) => {
      if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
      return true
    },
  },
  file: {
    openDialog: async () => null,
    saveDialog: async () => null,
    open: async (path: string) => readVfs(path),
    save: async (path: string, content: string) => { writeVfs(path, content); return true },
    readDir: async (path: string) => listDir(path),
  },
  project: {
    getDefaultPath: async () => 'C:\\ycIDE',
    selectDirectory: async () => 'C:\\ycIDE',
    checkCreateTarget: async (info: { name: string; path: string }) => {
      const projectDir = `${info.path}\\${info.name}`
      return { projectDir, exists: listDir(projectDir) !== null }
    },
    create: async (info: { name: string; path: string; type: string; platform: string; overwrite?: boolean }) => {
      const projectDir = `${info.path}\\${info.name}`
      if (listDir(projectDir) && !info.overwrite) return { status: 'exists' as const, projectDir }
      const isWindowApp = info.type === 'windows-app' || info.type === 'mobile-app'
      const fileLines: string[] = []
      if (isWindowApp) {
        writeVfs(`${projectDir}\\_启动窗口.efw`, JSON.stringify({
          type: 'window', name: '_启动窗口', title: info.name, width: 592, height: 384, sourceFile: '_启动窗口.eyc', controls: [],
        }, null, 2))
        writeVfs(`${projectDir}\\_启动窗口.eyc`, '.版本 2\n.程序集 窗口程序集_启动窗口\n\n')
        fileLines.push('File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0')
      } else {
        writeVfs(`${projectDir}\\${info.name}.eyc`, '.版本 2\n.程序集 程序集\n\n.子程序 _启动子程序\n\n')
        fileLines.push(`File=EYC|${info.name}.eyc|1`)
      }
      const outputType = ({ 'windows-app': 'WindowsApp', console: 'Console', dll: 'DynamicLibrary' } as Record<string, string>)[info.type] || 'WindowsApp'
      const eppPath = `${projectDir}\\${info.name}.epp`
      writeVfs(eppPath, ['# YiCode Project File', 'Version=1', `ProjectName=${info.name}`, `OutputType=${outputType}`, `Platform=${info.platform}`, '', ...fileLines].join('\n'))
      return { status: 'created' as const, projectDir, eppPath }
    },
    readFile: async (path: string) => readVfs(path),
    readFileWithEncoding: async (path: string) => {
      const content = readVfs(path)
      return content === null ? null : { content, encoding: 'UTF-8' }
    },
    parseEpp: async (eppPath: string) => {
      const content = readVfs(eppPath)
      if (content === null) return null
      const info: Record<string, string> = {}
      const list: Array<{ type: string; fileName: string; flag: number }> = []
      for (const raw of content.split('\n')) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        if (line.startsWith('File=')) {
          const [type, fileName, flag] = line.slice(5).split('|')
          if (type && fileName) list.push({ type, fileName, flag: flag ? parseInt(flag, 10) : 0 })
        } else {
          const i = line.indexOf('=')
          if (i > 0) info[line.slice(0, i)] = line.slice(i + 1)
        }
      }
      return { projectName: info.ProjectName || '', outputType: info.OutputType || '', platform: info.Platform || '', files: list, projectDir: dirOf(eppPath) }
    },
    updatePlatform: async () => true,
    saveOpenTabs: async (projectDir: string, session: { openTabs: string[]; activeTabPath?: string }) => {
      sessions[norm(projectDir)] = session
      store.set(SESSION_KEY, sessions)
    },
    loadOpenTabs: async (projectDir: string) => sessions[norm(projectDir)] ?? { openTabs: [] },
    saveAiChat: async () => true,
    loadAiChat: async () => null,
    openEpp: async () => { showNotice(); return { canceled: true } },
    openWorkspaceFolder: async () => { showNotice(); return { canceled: true } },
    importEFile: notSupported,
    addFile: async (projectDir: string, fileName: string, fileType: string, content: string) => {
      const filePath = `${projectDir}\\${fileName}`
      writeVfs(filePath, content)
      const eppName = listDir(projectDir)?.find(n => n.toLowerCase().endsWith('.epp'))
      if (eppName) {
        const eppPath = `${projectDir}\\${eppName}`
        const epp = readVfs(eppPath) || ''
        if (!epp.toLowerCase().includes(`|${fileName.toLowerCase()}|`)) {
          writeVfs(eppPath, `${epp.replace(/\n*$/, '')}\nFile=${fileType}|${fileName}|0\n`)
        }
      }
      return filePath
    },
    removeFile: async (projectDir: string, fileName: string) => {
      const eppName = listDir(projectDir)?.find(n => n.toLowerCase().endsWith('.epp'))
      if (eppName) {
        const eppPath = `${projectDir}\\${eppName}`
        const epp = (readVfs(eppPath) || '').split('\n').filter(l => !l.toLowerCase().includes(`|${fileName.toLowerCase()}|`))
        writeVfs(eppPath, epp.join('\n'))
      }
      return removeVfs(`${projectDir}\\${fileName}`)
    },
    addResources: async () => { showNotice(); return [] },
    importResourceFile: async () => ({ success: false as const, canceled: true as const }),
    replaceResourceFile: async () => ({ success: false as const, canceled: true as const }),
    getResourcePreviewData: async () => ({ success: false as const, message: WEB_NOTICE }),
    renameWindow: async (projectDir: string, oldName: string, newName: string) => {
      for (const ext of ['efw', 'eyc']) {
        const content = readVfs(`${projectDir}\\${oldName}.${ext}`)
        if (content !== null) {
          writeVfs(`${projectDir}\\${newName}.${ext}`, content)
          removeVfs(`${projectDir}\\${oldName}.${ext}`)
        }
      }
      return { newEfwPath: `${projectDir}\\${newName}.efw`, newEycPath: `${projectDir}\\${newName}.eyc` }
    },
    renameClassModule: async (projectDir: string, oldFileName: string, newFileName: string) => {
      const newClassPath = `${projectDir}\\${newFileName}`
      if (readVfs(newClassPath) !== null) return { success: false as const, reason: 'exists' as const, newClassPath }
      writeVfs(newClassPath, readVfs(`${projectDir}\\${oldFileName}`) || '')
      removeVfs(`${projectDir}\\${oldFileName}`)
      return { success: true as const, newClassPath }
    },
  },
  compiler: {
    compile: async () => { showNotice(); return { success: false, message: WEB_NOTICE } },
    run: async () => { showNotice(); return { success: false, message: WEB_NOTICE } },
    stop: async () => true,
    isRunning: async () => false,
  },
  terminal: {
    start: async () => ({ running: false, output: [WEB_NOTICE], commands: [], lastCommand: '', seq: 0 }),
    send: async () => ({ ok: false, error: WEB_NOTICE }),
    input: () => {},
    resize: () => {},
    interrupt: async () => ({ ok: true }),
    getSnapshot: async () => ({ running: false, output: [WEB_NOTICE], commands: [], lastCommand: '', seq: 0 }),
    getLastCommand: async () => '',
  },
  library: {
    scan: async () => (await loadSnap()).list,
    load: async (name: string) => ({ success: true, info: (await loadSnap()).infos[name] ?? null }),
    unload: async () => ({ success: false, error: '网页版不支持卸载支持库' }),
    loadAll: async () => (await loadSnap()).list.length,
    applySelection: async () => ({ success: true }),
    getList: async () => (await loadSnap()).list,
    getStoreCards: async () => ({ ok: false, error: WEB_NOTICE, cards: [] }),
    getRemoteIndex: async () => ({ ok: false, error: WEB_NOTICE }),
    installFromRemote: notSupported,
    removeInstalled: notSupported,
    getInfo: async (name: string) => (await loadSnap()).infos[name] ?? null,
    getAllCommands: async () => (await libData()).commands,
    getAllDataTypes: async () => (await libData()).dataTypes,
    getWindowUnits: async () => (await libData()).windowUnits,
  },
  ycmd: {
    scan: async () => ({ rootPath: '', libraries: [], errors: [] }),
  },
  plugins: {
    getState: async () => pluginState,
    executeCommand: async () => { showNotice(); return null },
    setEnabled: async () => pluginState,
    reload: async () => pluginState,
    grantPermissions: async () => pluginState,
    revokePermissions: async () => pluginState,
    storeList: async () => ({ ok: false as const, error: WEB_NOTICE }),
    storeInstall: async () => ({ ok: false as const, error: WEB_NOTICE }),
    uninstall: async () => ({ ok: false as const, error: WEB_NOTICE }),
    sendRendererCommandResult: () => {},
  },
  settings: {
    get: async () => settings,
    save: async (partial: Partial<IDESettings>) => {
      settings = resolveIDESettings({ ...settings, ...partial })
      store.set(SETTINGS_KEY, settings)
      return settings
    },
  },
  appearance: {
    pickBackgroundImage: async () => null,
    loadBackgroundImage: async () => null,
  },
  ai: {
    chat: async () => ({ ok: false, error: WEB_NOTICE }),
    chatWithTools: async () => ({ ok: false, error: WEB_NOTICE }),
    chatStream: async () => ({ ok: false, error: WEB_NOTICE }),
    proposeEdit: async () => ({ ok: false, error: WEB_NOTICE }),
    proposeEditStream: async () => ({ ok: false, error: WEB_NOTICE }),
  },
  theme: {
    getList: async () => [...themes.keys()],
    getSources: async () => Object.fromEntries([...themes.keys()].map(id => [id, themeSource(id)])),
    load: async (name: string) => themes.get(name) ?? null,
    getCurrent: async () => ({
      selectedThemeId: themeConfig.currentThemeId,
      effectiveThemeId: themeConfig.currentThemeId,
      themePayload: payloadFor(themeConfig.currentThemeId, themeConfig.themePayloads[themeConfig.currentThemeId]),
      warning: null,
      config: themeConfig,
    }),
    saveCurrent: async (name: string, payload?: ThemeTokenPayload) => setTheme(name, payload),
    setCurrent: async (name: string) => setTheme(name),
    saveAsCustom: async () => readonlyThemeFail,
    createFromCurrent: async () => readonlyThemeFail,
    rename: async () => ({ success: false as const, code: 'builtin_readonly' as const, message: '网页版不支持修改主题' }),
    delete: async () => ({ success: false as const, code: 'builtin_readonly' as const, message: '网页版不支持删除主题' }),
    export: async () => ({ success: false as const, canceled: true as const }),
    import: async () => ({ status: 'canceled' as const }),
    importCommit: async () => ({ success: false as const, code: 'commit_failed' as const, message: '网页版不支持导入主题' }),
  },
  dialog: {
    confirmSaveBeforeClose: async (label: string) =>
      window.confirm(`「${label}」有未保存的修改，是否保存？`) ? 'save' as const : 'discard' as const,
    confirmProjectOverwrite: async () => (window.confirm('项目已存在，是否覆盖？') ? 'overwrite' as const : 'cancel' as const),
    confirmUnsavedThemeDraftClose: async () => 'discard' as const,
  },
  debug: {
    logRendererError: async (payload: unknown) => { console.error('[ycIDE]', payload); return { success: true } },
    getRendererErrorLogPath: async () => '',
    logRendererEvent: async () => ({ success: true }),
    getRendererDebugLogPath: async () => '',
    continue: async () => false,
  },
  system: {
    getRuntimePlatform: () => 'windows' as const,
    updateRecentOpened: () => {},
    updateThemes: () => {},
  },
  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set())
    listeners.get(channel)!.add(callback)
    return () => { listeners.get(channel)?.delete(callback) }
  },
  off: (channel: string) => { listeners.delete(channel) },
}

void themeSync
void DEMO_ROOT
;(window as unknown as { api: typeof api }).api = api
;(window as unknown as { __ycideWeb: unknown }).__ycideWeb = { emit, resetDemoProject, notice: WEB_NOTICE }
