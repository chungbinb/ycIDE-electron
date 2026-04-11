import { contextBridge, ipcRenderer } from 'electron'
import { normalizeRuntimePlatform } from '../shared/platform'
import { THEME_CONFIG_VERSION } from '../shared/theme'
import type { IDESettings } from '../shared/settings'
import type {
  SaveAsCustomThemeRequest,
  SaveAsCustomThemeResult,
  ThemeImportConflictDecision,
  ThemeImportValidationDiagnostic,
  ThemeConfigV2,
  ThemeDefinition,
  ThemeId,
  ThemeResolutionResult,
  ThemeTokenPayload
} from '../shared/theme'

const runtimePlatform = normalizeRuntimePlatform(process.platform)
void THEME_CONFIG_VERSION
type RecentOpenedItem = { type: 'project' | 'file'; path: string; label: string }
type ThemeMenuState = { themes: string[]; currentTheme: string }
type ThemeLifecycleSyncPayload = {
  config: ThemeConfigV2
  themes: ThemeId[]
  currentTheme: ThemeId
  menuState: ThemeMenuState
}
type ThemeImportPrepareResult =
  | { status: 'canceled' }
  | { status: 'invalid'; diagnostics: ThemeImportValidationDiagnostic[]; sourceFilePath: string | null }
  | { status: 'conflict'; importedTheme: ThemeDefinition; existingThemeId: ThemeId; allowedDecisions: ThemeImportConflictDecision['decision'][]; sourceFilePath: string | null }
  | { status: 'ready'; importedTheme: ThemeDefinition; targetThemeId: ThemeId; sourceFilePath: string | null }
type ThemeImportCommitResult =
  | ({ success: true; importedThemeId: ThemeId; overwritten: boolean } & ThemeLifecycleSyncPayload)
  | ({ success: false; code: 'builtin_readonly' | 'invalid_payload' | 'conflict_decision_required' | 'invalid_conflict_decision' | 'duplicate_name' | 'theme_not_found' | 'commit_failed'; message: string; diagnostics?: ThemeImportValidationDiagnostic[] })

// 向渲染进程安全暴露的 API
const api = {
  // 窗口控制
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    forceClose: () => ipcRenderer.send('window:forceClose')
  },
  // 文件操作
  file: {
    open: (path: string) => ipcRenderer.invoke('file:open', path),
    save: (path: string, content: string) => ipcRenderer.invoke('file:save', path, content),
    readDir: (path: string) => ipcRenderer.invoke('file:readDir', path)
  },
  // 项目管理
  project: {
    getDefaultPath: () => ipcRenderer.invoke('project:getDefaultPath') as Promise<string>,
    selectDirectory: () => ipcRenderer.invoke('project:selectDirectory') as Promise<string | null>,
    create: (info: { name: string; path: string; type: string; platform: string }) =>
      ipcRenderer.invoke('project:create', info) as Promise<{ projectDir: string; eppPath: string }>,
    readFile: (filePath: string) => ipcRenderer.invoke('project:readFile', filePath) as Promise<string | null>,
    parseEpp: (eppPath: string) => ipcRenderer.invoke('project:parseEpp', eppPath) as Promise<{
      projectName: string; outputType: string; platform: string;
      files: Array<{ type: string; fileName: string; flag: number }>;
      projectDir: string;
    } | null>,
    updatePlatform: (projectDir: string, platform: string) => ipcRenderer.invoke('project:updatePlatform', projectDir, platform),
    saveOpenTabs: (projectDir: string, session: { openTabs: string[]; activeTabPath?: string }) => ipcRenderer.invoke('project:saveOpenTabs', projectDir, session),
    loadOpenTabs: (projectDir: string) => ipcRenderer.invoke('project:loadOpenTabs', projectDir) as Promise<{ openTabs: string[]; activeTabPath?: string }>,
    openEpp: () => ipcRenderer.invoke('project:openEpp') as Promise<string | null>,
    addFile: (projectDir: string, fileName: string, fileType: string, content: string) =>
      ipcRenderer.invoke('project:addFile', projectDir, fileName, fileType, content) as Promise<string>,
    addResources: (projectDir: string) =>
      ipcRenderer.invoke('project:addResources', projectDir) as Promise<string[]>,
    importResourceFile: (projectDir: string) =>
      ipcRenderer.invoke('project:importResourceFile', projectDir) as Promise<
        | { success: true; fileName: string }
        | { success: false; canceled: true }
        | { success: false; canceled: false; message: string }
      >,
    replaceResourceFile: (projectDir: string, targetFileName: string) =>
      ipcRenderer.invoke('project:replaceResourceFile', projectDir, targetFileName) as Promise<
        | { success: true; targetFileName: string }
        | { success: false; canceled: true }
        | { success: false; canceled: false; message: string }
      >,
    getResourcePreviewData: (projectDir: string, fileName: string, withContent = true) =>
      ipcRenderer.invoke('project:getResourcePreviewData', projectDir, fileName, withContent) as Promise<
        | { success: true; mime: string; ext: string; filePath: string; sizeBytes: number; modifiedAtMs: number; base64?: string }
        | { success: false; message: string }
      >,
    renameWindow: (projectDir: string, oldName: string, newName: string, openEycPaths: string[]) =>
      ipcRenderer.invoke('project:renameWindow', projectDir, oldName, newName, openEycPaths) as Promise<{ newEfwPath: string; newEycPath: string }>,
    renameClassModule: (projectDir: string, oldFileName: string, newFileName: string, oldClassName: string, newClassName: string, openSourcePaths: string[]) =>
      ipcRenderer.invoke('project:renameClassModule', projectDir, oldFileName, newFileName, oldClassName, newClassName, openSourcePaths) as Promise<
        | { success: true; newClassPath: string }
        | { success: false; reason: 'exists'; newClassPath: string }
        | { success: false; reason: 'error'; message: string; newClassPath: string }
      >,
  },
  // 编译
  compiler: {
    compile: (projectDir: string, editorFiles?: Record<string, string>, arch?: string) =>
      ipcRenderer.invoke('compiler:compile', projectDir, editorFiles, arch),
    run: (
      projectDir: string,
      editorFiles?: Record<string, string>,
      arch?: string,
      debugOptions?: { breakpoints?: Record<string, number[]> },
    ) => ipcRenderer.invoke('compiler:run', projectDir, editorFiles, arch, debugOptions),
    stop: () => ipcRenderer.invoke('compiler:stop'),
    isRunning: () => ipcRenderer.invoke('compiler:isRunning') as Promise<boolean>,
  },
  // 支持库管理
  library: {
    scan: (folder?: string) => ipcRenderer.invoke('library:scan', folder),
    load: (name: string) => ipcRenderer.invoke('library:load', name),
    unload: (name: string) => ipcRenderer.invoke('library:unload', name),
    loadAll: () => ipcRenderer.invoke('library:loadAll'),
    applySelection: (selectedNames: string[]) => ipcRenderer.invoke('library:applySelection', selectedNames),
    getList: () => ipcRenderer.invoke('library:getList'),
    getStoreCards: () => ipcRenderer.invoke('library:getStoreCards'),
    getInfo: (name: string) => ipcRenderer.invoke('library:getInfo', name),
    getAllCommands: () => ipcRenderer.invoke('library:getAllCommands'),
    getAllDataTypes: () => ipcRenderer.invoke('library:getAllDataTypes'),
    getWindowUnits: () => ipcRenderer.invoke('library:getWindowUnits'),
  },
  // 命令元数据（ycmd）
  ycmd: {
    scan: (rootPath?: string) => ipcRenderer.invoke('ycmd:scan', rootPath) as Promise<{
      rootPath: string
      libraries: Array<{
        name: string
        folderPath: string
        manifests: Array<{
          filePath: string
          manifest: unknown
          valid: boolean
          errors: string[]
        }>
      }>
      errors: string[]
    }>,
  },
  // 系统设置
  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<IDESettings>,
    save: (partial: Partial<IDESettings>) => ipcRenderer.invoke('settings:save', partial) as Promise<IDESettings>,
  },
  // 主题管理
  theme: {
    getList: () => ipcRenderer.invoke('theme:getList') as Promise<ThemeId[]>,
    load: (name: ThemeId) => ipcRenderer.invoke('theme:load', name) as Promise<ThemeDefinition | null>,
    getCurrent: () => ipcRenderer.invoke('theme:getCurrent') as Promise<ThemeResolutionResult>,
    saveCurrent: (name: ThemeId, themePayload?: ThemeTokenPayload) =>
      ipcRenderer.invoke('theme:saveCurrent', name, themePayload) as Promise<ThemeConfigV2>,
    setCurrent: (name: ThemeId) => ipcRenderer.invoke('theme:setCurrent', name) as Promise<ThemeConfigV2>,
    saveAsCustom: (request: SaveAsCustomThemeRequest) =>
      ipcRenderer.invoke('theme:saveAsCustom', request) as Promise<SaveAsCustomThemeResult>,
    createFromCurrent: (request: { name: string; themePayload?: ThemeTokenPayload }) =>
      ipcRenderer.invoke('theme:createFromCurrent', request) as Promise<
        | ({ success: true; themeId: ThemeId; sourceThemeId: ThemeId } & ThemeLifecycleSyncPayload)
        | ({ success: false; code: 'invalid_name' | 'duplicate_name' | 'source_theme_missing' | 'save_failed'; message: string })
      >,
    rename: (request: { themeId: ThemeId; newName: string }) =>
      ipcRenderer.invoke('theme:rename', request) as Promise<
        | ({ success: true; oldThemeId: ThemeId; newThemeId: ThemeId } & ThemeLifecycleSyncPayload)
        | ({ success: false; code: 'invalid_name' | 'builtin_readonly' | 'theme_not_found' | 'duplicate_name' | 'rename_failed'; message: string })
      >,
    delete: (request: { themeId: ThemeId; confirmThemeName: string }) =>
      ipcRenderer.invoke('theme:delete', request) as Promise<
        | ({ success: true; deletedThemeId: ThemeId; notice: string | null } & ThemeLifecycleSyncPayload)
        | ({ success: false; code: 'builtin_readonly' | 'theme_not_found' | 'confirm_name_mismatch' | 'delete_failed'; message: string })
      >,
    export: (request: { themeId: ThemeId }) =>
      ipcRenderer.invoke('theme:export', request) as Promise<
        | { success: true; filePath: string; fileName: string; themeId: ThemeId }
        | { success: false; canceled?: true; code?: 'theme_not_found' | 'export_failed'; message?: string }
      >,
    import: (request?: { filePath?: string; fileContent?: string }) =>
      ipcRenderer.invoke('theme:import', request) as Promise<ThemeImportPrepareResult>,
    importCommit: (request: { importedTheme: ThemeDefinition; decision?: ThemeImportConflictDecision }) =>
      ipcRenderer.invoke('theme:importCommit', request) as Promise<ThemeImportCommitResult>,
  },
  // 对话框
  dialog: {
    confirmSaveBeforeClose: (fileLabel: string) =>
      ipcRenderer.invoke('dialog:confirmSaveBeforeClose', fileLabel) as Promise<'save' | 'discard' | 'cancel'>,
    confirmUnsavedThemeDraftClose: (intent: 'close-button' | 'overlay' | 'escape' | 'app-exit') =>
      ipcRenderer.invoke('dialog:confirmUnsavedThemeDraftClose', intent) as Promise<'save' | 'discard' | 'continue'>,
  },
  // 诊断日志
  debug: {
    logRendererError: (payload: { source?: string; message: string; stack?: string; extra?: unknown }) =>
      ipcRenderer.invoke('debug:logRendererError', payload) as Promise<{ success: boolean }>,
    getRendererErrorLogPath: () =>
      ipcRenderer.invoke('debug:getRendererErrorLogPath') as Promise<string>,
    continue: () =>
      ipcRenderer.invoke('debug:continue') as Promise<boolean>,
  },
  // 平台信息
  system: {
    getRuntimePlatform: () => runtimePlatform,
    updateRecentOpened: (items: RecentOpenedItem[]) => ipcRenderer.send('menu:updateRecentOpened', items),
    updateThemes: (state: ThemeMenuState) => ipcRenderer.send('menu:updateThemes', state),
  },
  // 通用 IPC
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
  },
  off: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
