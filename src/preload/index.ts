import { contextBridge, ipcRenderer } from 'electron'

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
    saveOpenTabs: (projectDir: string, tabPaths: string[]) => ipcRenderer.invoke('project:saveOpenTabs', projectDir, tabPaths),
    loadOpenTabs: (projectDir: string) => ipcRenderer.invoke('project:loadOpenTabs', projectDir) as Promise<string[]>,
    openEpp: () => ipcRenderer.invoke('project:openEpp') as Promise<string | null>,
    addFile: (projectDir: string, fileName: string, fileType: string, content: string) =>
      ipcRenderer.invoke('project:addFile', projectDir, fileName, fileType, content) as Promise<string>,
    renameWindow: (projectDir: string, oldName: string, newName: string, openEycPaths: string[]) =>
      ipcRenderer.invoke('project:renameWindow', projectDir, oldName, newName, openEycPaths) as Promise<{ newEfwPath: string; newEycPath: string }>,
  },
  // 编译
  compiler: {
    compile: (projectDir: string, editorFiles?: Record<string, string>, linkMode?: 'static' | 'normal', arch?: string) =>
      ipcRenderer.invoke('compiler:compile', projectDir, editorFiles, linkMode, arch),
    run: (projectDir: string, editorFiles?: Record<string, string>, arch?: string) =>
      ipcRenderer.invoke('compiler:run', projectDir, editorFiles, arch),
    stop: () => ipcRenderer.invoke('compiler:stop'),
    isRunning: () => ipcRenderer.invoke('compiler:isRunning') as Promise<boolean>,
  },
  // 支持库管理
  library: {
    scan: (folder?: string) => ipcRenderer.invoke('library:scan', folder),
    load: (name: string) => ipcRenderer.invoke('library:load', name),
    unload: (name: string) => ipcRenderer.invoke('library:unload', name),
    loadAll: () => ipcRenderer.invoke('library:loadAll'),
    getList: () => ipcRenderer.invoke('library:getList'),
    getInfo: (name: string) => ipcRenderer.invoke('library:getInfo', name),
    getAllCommands: () => ipcRenderer.invoke('library:getAllCommands'),
    getAllDataTypes: () => ipcRenderer.invoke('library:getAllDataTypes'),
    getWindowUnits: () => ipcRenderer.invoke('library:getWindowUnits'),
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
