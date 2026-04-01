import { contextBridge, ipcRenderer } from 'electron'
import { normalizeRuntimePlatform } from '../shared/platform'

const runtimePlatform = normalizeRuntimePlatform(process.platform)
type RecentOpenedItem = { type: 'project' | 'file'; path: string; label: string }
type ThemeMenuState = { themes: string[]; currentTheme: string }

// 向渲染进程安全暴露的 API
const api = {
  // 窗口控制
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close')
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
  // 主题管理
  theme: {
    getList: () => ipcRenderer.invoke('theme:getList') as Promise<string[]>,
    load: (name: string) => ipcRenderer.invoke('theme:load', name) as Promise<{ name: string; colors: Record<string, string> } | null>,
    getCurrent: () => ipcRenderer.invoke('theme:getCurrent') as Promise<string>,
    setCurrent: (name: string) => ipcRenderer.invoke('theme:setCurrent', name),
  },
  // 对话框
  dialog: {
    confirmSaveBeforeClose: (fileLabel: string) =>
      ipcRenderer.invoke('dialog:confirmSaveBeforeClose', fileLabel) as Promise<'save' | 'discard' | 'cancel'>,
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
