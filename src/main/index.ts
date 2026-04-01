import { app, BrowserWindow, Menu, dialog, ipcMain, shell, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions } from 'electron'
import { join, dirname, basename, extname } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, appendFileSync, copyFileSync, statSync } from 'fs'
import { libraryManager } from './libraryManager'
import { compileProject, runExecutable, stopExecutable, isRunning, continueDebugExecutable } from './compiler'
import { normalizeRuntimePlatform } from '../shared/platform'
import { getActionAccelerator } from '../shared/shortcut-config'
import { scanYcmdRegistry } from './ycmd-registry'

const isDev = !app.isPackaged
const runtimePlatform = normalizeRuntimePlatform(process.platform)
const APP_DISPLAY_NAME = 'ycIDE'

type RecentOpenedItem = {
  type: 'project' | 'file'
  path: string
  label: string
}

type ThemeMenuState = {
  themes: string[]
  currentTheme: string
}

let recentOpenedItems: RecentOpenedItem[] = []
let themeMenuState: ThemeMenuState = { themes: [], currentTheme: '' }

app.setName(APP_DISPLAY_NAME)

function getRendererErrorLogPath(): string {
  const logDir = join(app.getPath('userData'), 'logs')
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
  return join(logDir, 'renderer-errors.log')
}

function appendRendererErrorLog(payload: { source?: string; message: string; stack?: string; extra?: unknown }): void {
  const now = new Date().toISOString()
  const source = payload.source || 'renderer'
  const stack = payload.stack ? `\n${payload.stack}` : ''
  const extra = payload.extra === undefined ? '' : `\nextra=${JSON.stringify(payload.extra)}`
  const line = `[${now}] [${source}] ${payload.message}${stack}${extra}\n\n`
  appendFileSync(getRendererErrorLogPath(), line, 'utf-8')
}

function createWindow(): void {
  const chromeOptions: Pick<BrowserWindowConstructorOptions, 'frame' | 'titleBarStyle'> = runtimePlatform === 'macos'
    ? {
      frame: true,
      titleBarStyle: 'hiddenInset',
    }
    : {
      frame: false,
      titleBarStyle: 'hidden',
    }

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    ...chromeOptions,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 外部链接在系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 开发模式加载 dev server，生产模式加载打包文件
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function emitMenuAction(action: string): void {
  const targetWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  targetWindow?.webContents.send('menu:action', action)
}

function setupNativeMenu(): void {
  if (runtimePlatform !== 'macos') {
    return
  }

  const actionItem = (label: string, action: string, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => emitMenuAction(action),
  })

  const recentSubmenu: MenuItemConstructorOptions[] = recentOpenedItems.length > 0
    ? recentOpenedItems.slice(0, 10).map(item => ({
      label: `${item.type === 'project' ? '项目' : '文件'}: ${item.label}`,
      click: () => emitMenuAction(`file:openRecent:${encodeURIComponent(JSON.stringify({ type: item.type, path: item.path }))}`),
    }))
    : [{ label: '(空)', enabled: false }]

  const themeSubmenu: MenuItemConstructorOptions[] = themeMenuState.themes.length > 0
    ? themeMenuState.themes.map(themeName => ({
      label: themeName,
      type: 'radio',
      checked: themeName === themeMenuState.currentTheme,
      click: () => emitMenuAction(`theme:${themeName}`),
    }))
    : [{ label: '(空)', enabled: false }]

  const template: MenuItemConstructorOptions[] = [
    {
      label: APP_DISPLAY_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ]
    },
    {
      label: '文件',
      submenu: [
        actionItem('新建项目', 'file:newProject', getActionAccelerator('file:newProject')),
        actionItem('打开项目', 'file:openProject', getActionAccelerator('file:openProject')),
        { label: '最近打开', submenu: recentSubmenu },
        { type: 'separator' },
        actionItem('保存', 'file:save', getActionAccelerator('file:save')),
        actionItem('保存全部', 'file:saveAll', getActionAccelerator('file:saveAll')),
        { type: 'separator' },
        actionItem('关闭文件', 'file:closeFile', getActionAccelerator('file:closeFile')),
        actionItem('关闭项目', 'file:closeProject'),
        { type: 'separator' },
        actionItem('退出', 'file:exit', getActionAccelerator('file:exit')),
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
        actionItem('查找', 'edit:find', getActionAccelerator('edit:find')),
        actionItem('替换', 'edit:replace', getActionAccelerator('edit:replace')),
      ]
    },
    {
      label: '查看',
      submenu: [
        actionItem('属性面板', 'view:property'),
        actionItem('输出面板', 'view:output'),
        actionItem('支持库', 'view:library'),
        { type: 'separator' },
        actionItem('项目管理器', 'view:project'),
        { type: 'separator' },
        { label: '主题', submenu: themeSubmenu },
      ]
    },
    {
      label: '插入',
      submenu: [
        actionItem('全局变量', 'insert:globalVar'),
        actionItem('常量', 'insert:constant'),
        actionItem('自定义数据类型', 'insert:dataType'),
        actionItem('DLL命令', 'insert:dllCmd'),
        { type: 'separator' },
        actionItem('类模块', 'insert:classModule'),
        actionItem('程序集', 'insert:module'),
        actionItem('子程序', 'insert:sub'),
        { type: 'separator' },
        actionItem('窗口', 'insert:window'),
        actionItem('资源', 'insert:resource'),
      ]
    },
    {
      label: '编译',
      submenu: [
        actionItem('普通编译', 'build:compile', getActionAccelerator('build:compile')),
        { type: 'separator' },
        actionItem('编译运行', 'build:run', 'F5'),
      ]
    },
    {
      label: '调试',
      submenu: [
        actionItem('运行', 'debug:run', 'F5'),
        actionItem('停止', 'debug:stop', 'Shift+F5'),
        { type: 'separator' },
        actionItem('逐过程', 'debug:stepOver', 'F10'),
        actionItem('逐语句', 'debug:stepInto', 'F11'),
        actionItem('跳出', 'debug:stepOut', 'Shift+F11'),
        actionItem('运行到光标处', 'debug:runToCursor', getActionAccelerator('debug:runToCursor')),
        { type: 'separator' },
        actionItem('切换断点', 'debug:toggleBreakpoint', 'F9'),
        actionItem('清除所有断点', 'debug:clearBreakpoints'),
      ]
    },
    {
      label: '工具',
      submenu: [
        actionItem('支持库配置', 'tools:library'),
        actionItem('系统配置', 'tools:settings'),
      ]
    },
    {
      label: '帮助',
      submenu: [
        actionItem('帮助主题', 'help:topics', 'F1'),
        { type: 'separator' },
        actionItem('关于', 'help:about'),
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  setupNativeMenu()

  ipcMain.on('menu:updateRecentOpened', (_event, items: unknown) => {
    if (!Array.isArray(items)) return
    recentOpenedItems = items
      .filter((item): item is RecentOpenedItem => !!item
        && typeof item === 'object'
        && ((item as RecentOpenedItem).type === 'project' || (item as RecentOpenedItem).type === 'file')
        && typeof (item as RecentOpenedItem).path === 'string'
        && typeof (item as RecentOpenedItem).label === 'string')
      .slice(0, 10)

    if (runtimePlatform === 'macos') {
      setupNativeMenu()
    }
  })

  ipcMain.on('menu:updateThemes', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const state = payload as { themes?: unknown; currentTheme?: unknown }
    const themes = Array.isArray(state.themes)
      ? state.themes.filter((item): item is string => typeof item === 'string')
      : []
    const currentTheme = typeof state.currentTheme === 'string' ? state.currentTheme : ''

    themeMenuState = { themes, currentTheme }

    if (runtimePlatform === 'macos') {
      setupNativeMenu()
    }
  })

  // 窗口控制 IPC
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.isMaximized() ? win.unmaximize() : win.maximize()
    }
  })
  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('dialog:confirmSaveBeforeClose', async (event, fileLabel: string) => {
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow()
    if (!win) return 'cancel'
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      title: '未保存更改',
      message: `文件“${fileLabel}”已修改。`,
      detail: '是否在关闭前保存更改？',
      buttons: ['保存', '不保存', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    })
    if (result.response === 0) return 'save'
    if (result.response === 1) return 'discard'
    return 'cancel'
  })

  // 项目管理 IPC
  ipcMain.handle('project:getDefaultPath', () => {
    const docs = app.getPath('documents')
    return join(docs, 'ycIDE Projects')
  })

  ipcMain.handle('project:selectDirectory', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: '选择项目保存位置',
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('project:create', (_event, info: { name: string; path: string; type: string; platform: string }) => {
    const projectDir = join(info.path, info.name)
    // 创建项目目录结构
    mkdirSync(projectDir, { recursive: true })
    mkdirSync(join(projectDir, 'logs'), { recursive: true })
    mkdirSync(join(projectDir, 'output'), { recursive: true })
    mkdirSync(join(projectDir, 'temp'), { recursive: true })

    // 生成 OutputType
    const outputTypeMap: Record<string, string> = {
      'windows-app': 'WindowsApp',
      'console': 'Console',
      'dll': 'DynamicLibrary',
    }
    const outputType = outputTypeMap[info.type] || 'WindowsApp'

    // 生成文件列表
    const files: string[] = []
    const isWindowsApp = info.type === 'windows-app'

    if (isWindowsApp) {
      // 窗口程序：创建窗口文件 + 代码文件
      const efwData = JSON.stringify({
        type: 'window',
        name: '_启动窗口',
        title: info.name,
        width: 592,
        height: 384,
        sourceFile: '_启动窗口.eyc',
        controls: []
      }, null, 2)
      writeFileSync(join(projectDir, '_启动窗口.efw'), efwData, 'utf-8')

      const eycData = '.\u7248\u672c 2\n.\u7a0b\u5e8f\u96c6 \u7a97\u53e3\u7a0b\u5e8f\u96c6_\u542f\u52a8\u7a97\u53e3\n\n'
      writeFileSync(join(projectDir, '_启动窗口.eyc'), eycData, 'utf-8')

      files.push('File=EFW|_启动窗口.efw|1')
      files.push('File=EYC|_启动窗口.eyc|0')
    } else {
      // 控制台/DLL：只创建代码文件
      const eycData = '.\u7248\u672c 2\n.\u7a0b\u5e8f\u96c6 \u7a0b\u5e8f\u96c6\n\n.\u5b50\u7a0b\u5e8f _\u542f\u52a8\u5b50\u7a0b\u5e8f\n\n'
      writeFileSync(join(projectDir, `${info.name}.eyc`), eycData, 'utf-8')
      files.push(`File=EYC|${info.name}.eyc|1`)
    }

    // 生成 .epp 项目文件
    const eppLines = [
      '# YiCode Project File',
      'Version=1',
      `ProjectName=${info.name}`,
      `OutputType=${outputType}`,
      `Platform=${info.platform}`,
      '',
      ...files
    ]
    const eppPath = join(projectDir, `${info.name}.epp`)
    writeFileSync(eppPath, eppLines.join('\n'), 'utf-8')

    return { projectDir, eppPath }
  })

  ipcMain.handle('project:readFile', (_event, filePath: string) => {
    if (!existsSync(filePath)) return null
    return readFileSync(filePath, 'utf-8')
  })

  // 解析 epp 项目文件，返回项目信息和关联文件列表
  ipcMain.handle('project:parseEpp', (_event, eppPath: string) => {
    if (!existsSync(eppPath)) return null
    const content = readFileSync(eppPath, 'utf-8')
    const lines = content.split('\n').map(l => l.trim())
    const info: Record<string, string> = {}
    const files: Array<{ type: string; fileName: string; flag: number }> = []
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
    const projectDir = join(eppPath, '..')
    return { projectName: info['ProjectName'] || '', outputType: info['OutputType'] || '', platform: info['Platform'] || '', files, projectDir }
  })

  // 更新项目文件中的平台架构
  ipcMain.handle('project:updatePlatform', (_event, projectDir: string, platform: string) => {
    const files = readdirSync(projectDir)
    const eppFile = files.find(f => f.endsWith('.epp'))
    if (!eppFile) return
    const eppPath = join(projectDir, eppFile)
    let content = readFileSync(eppPath, 'utf-8')
    if (content.match(/^Platform=.*/m)) {
      content = content.replace(/^Platform=.*/m, `Platform=${platform}`)
    } else {
      // 在 OutputType 行之后插入
      content = content.replace(/^(OutputType=.*)$/m, `$1\nPlatform=${platform}`)
    }
    writeFileSync(eppPath, content, 'utf-8')
  })

  // 保存打开的标签页会话到项目目录
  ipcMain.handle('project:saveOpenTabs', (_event, projectDir: string, session: { openTabs: string[]; activeTabPath?: string }) => {
    const sessionPath = join(projectDir, '.ycide-session.json')
    writeFileSync(sessionPath, JSON.stringify({ openTabs: session.openTabs || [], activeTabPath: session.activeTabPath || undefined }, null, 2), 'utf-8')
  })

  // 读取保存的标签页会话（兼容旧格式：string[]）
  ipcMain.handle('project:loadOpenTabs', (_event, projectDir: string) => {
    const sessionPath = join(projectDir, '.ycide-session.json')
    if (!existsSync(sessionPath)) return { openTabs: [] }
    try {
      const data = JSON.parse(readFileSync(sessionPath, 'utf-8'))
      if (Array.isArray(data)) {
        return { openTabs: data }
      }
      if (data && Array.isArray(data.openTabs)) {
        return {
          openTabs: data.openTabs,
          activeTabPath: typeof data.activeTabPath === 'string' ? data.activeTabPath : undefined,
        }
      }
      return { openTabs: [] }
    } catch {
      return { openTabs: [] }
    }
  })

  // 打开项目文件对话框（选择 .epp 文件）
  ipcMain.handle('project:openEpp', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: '打开项目',
      filters: [{ name: '易语言项目', extensions: ['epp'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // 保存文件内容
  ipcMain.handle('file:save', (_event, filePath: string, content: string) => {
    writeFileSync(filePath, content, 'utf-8')
    return true
  })

  // 读取目录内容
  ipcMain.handle('file:readDir', (_event, dirPath: string) => {
    if (!existsSync(dirPath)) return []
    return readdirSync(dirPath)
  })

  // 窗口重命名：重命名文件、更新 .epp、更新所有 .eyc 内容引用
  ipcMain.handle('project:renameWindow', (_event, projectDir: string, oldName: string, newName: string, openEycPaths: string[]) => {
    const oldEfw = join(projectDir, oldName + '.efw')
    const newEfw = join(projectDir, newName + '.efw')
    const oldEyc = join(projectDir, oldName + '.eyc')
    const newEyc = join(projectDir, newName + '.eyc')
    const openSet = new Set(openEycPaths)

    // 1. 重命名 .efw 文件
    if (existsSync(oldEfw)) renameSync(oldEfw, newEfw)

    // 2. 重命名 .eyc 文件
    if (existsSync(oldEyc)) renameSync(oldEyc, newEyc)

    // 3. 更新 .epp 项目文件中的文件引用
    const eppFiles = readdirSync(projectDir).filter(f => f.endsWith('.epp'))
    if (eppFiles.length > 0) {
      const eppPath = join(projectDir, eppFiles[0])
      let eppContent = readFileSync(eppPath, 'utf-8')
      eppContent = eppContent.split(oldName + '.efw').join(newName + '.efw')
      eppContent = eppContent.split(oldName + '.eyc').join(newName + '.eyc')
      writeFileSync(eppPath, eppContent, 'utf-8')
    }

    // 4. 更新 .efw 中的 sourceFile 引用
    if (existsSync(newEfw)) {
      try {
        const efwData = JSON.parse(readFileSync(newEfw, 'utf-8'))
        if (efwData.sourceFile === oldName + '.eyc') {
          efwData.sourceFile = newName + '.eyc'
          writeFileSync(newEfw, JSON.stringify(efwData, null, 2), 'utf-8')
        }
      } catch { /* ignore */ }
    }

    // 5. 更新磁盘上所有 .eyc 文件的内容引用（跳过已在编辑器中打开的）
    const eycFiles = readdirSync(projectDir).filter(f => f.toLowerCase().endsWith('.eyc'))
    const escapedOldName = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const ownAssemblyLineRe = new RegExp(
      '^(\\s*\\.程序集\\s+)(窗口程序集_' + escapedOldName + '|' + escapedOldName + ')(?=\\s|,|$)',
      'm'
    )
    for (const fileName of eycFiles) {
      const filePath = join(projectDir, fileName)
      if (openSet.has(filePath)) continue
      let content = readFileSync(filePath, 'utf-8')
      const isOwnRenamedSource = filePath.toLowerCase() === newEyc.toLowerCase()
      if (!content.includes(oldName) && !isOwnRenamedSource) continue
      // 更新程序集名：窗口程序集_旧名 → 窗口程序集_新名
      content = content.split('窗口程序集_' + oldName).join('窗口程序集_' + newName)
      if (isOwnRenamedSource) {
        content = content.replace(ownAssemblyLineRe, '$1窗口程序集_' + newName)
      }
      // 更新事件引用：_旧名_ → _新名_
      content = content.split('_' + oldName + '_').join('_' + newName + '_')
      // 更新跨窗口引用：旧名. → 新名.  (如 窗口1.按钮1.禁止)
      content = content.split(oldName + '.').join(newName + '.')
      writeFileSync(filePath, content, 'utf-8')
    }

    return { newEfwPath: newEfw, newEycPath: newEyc }
  })

  // 类模块重命名：重命名 .ecc、更新 .epp、更新项目源码中的类名引用
  ipcMain.handle('project:renameClassModule', (_event, projectDir: string, oldFileName: string, newFileName: string, oldClassName: string, newClassName: string, openSourcePaths: string[]) => {
    const oldClassPath = join(projectDir, oldFileName)
    const newClassPath = join(projectDir, newFileName)
    const openSet = new Set(openSourcePaths.map(p => p.toLowerCase()))

    if (oldClassPath.toLowerCase() !== newClassPath.toLowerCase() && existsSync(newClassPath)) {
      return { success: false as const, reason: 'exists' as const, newClassPath }
    }

    try {
      // 1. 重命名 .ecc 文件
      if (existsSync(oldClassPath) && oldClassPath.toLowerCase() !== newClassPath.toLowerCase()) {
        renameSync(oldClassPath, newClassPath)
      }

      // 2. 更新 .epp 项目文件中的文件引用
      const eppFiles = readdirSync(projectDir).filter(f => f.endsWith('.epp'))
      if (eppFiles.length > 0) {
        const eppPath = join(projectDir, eppFiles[0])
        let eppContent = readFileSync(eppPath, 'utf-8')
        eppContent = eppContent.split(oldFileName).join(newFileName)
        writeFileSync(eppPath, eppContent, 'utf-8')
      }

      // 3. 更新磁盘上未打开源码文件中的类名引用
      const escaped = oldClassName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const classNameRegex = new RegExp(
        '(?<=[^\\u4e00-\\u9fa5A-Za-z0-9_.]|^)' + escaped + '(?=[^\\u4e00-\\u9fa5A-Za-z0-9_.]|$)',
        'g'
      )
      const sourceFiles = readdirSync(projectDir).filter(f => /\.(eyc|ecc|egv|ecs|edt|ell)$/i.test(f))
      for (const fileName of sourceFiles) {
        const filePath = join(projectDir, fileName)
        if (openSet.has(filePath.toLowerCase())) continue
        const content = readFileSync(filePath, 'utf-8')
        if (!content.includes(oldClassName)) continue
        const next = content.replace(classNameRegex, newClassName)
        if (next !== content) writeFileSync(filePath, next, 'utf-8')
      }

      return { success: true as const, newClassPath }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false as const, reason: 'error' as const, message, newClassPath }
    }
  })

  // 向项目添加文件（创建文件 + 更新 .epp）
  ipcMain.handle('project:addFile', (_event, projectDir: string, fileName: string, fileType: string, content: string) => {
    const filePath = join(projectDir, fileName)
    writeFileSync(filePath, content, 'utf-8')
    // 更新 .epp 文件
    const eppFiles = readdirSync(projectDir).filter(f => f.endsWith('.epp'))
    if (eppFiles.length > 0) {
      const eppPath = join(projectDir, eppFiles[0])
      const eppContent = readFileSync(eppPath, 'utf-8')
      const flag = fileType === 'EFW' ? '1' : '0'
      const newLine = `File=${fileType}|${fileName}|${flag}`
      const escapedFileName = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const existed = new RegExp(`^File=[^|]+\\|${escapedFileName}\\|\\d+$`, 'm').test(eppContent)
      if (!existed) {
        writeFileSync(eppPath, eppContent.trimEnd() + '\n' + newLine + '\n', 'utf-8')
      }
    }
    return filePath
  })

  // 导入资源文件到项目目录并写入 .epp
  ipcMain.handle('project:addResources', async (_event, projectDir: string) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win || !existsSync(projectDir)) return []

    const result = await dialog.showOpenDialog(win, {
      title: '选择资源文件',
      properties: ['openFile', 'multiSelections'],
    })
    if (result.canceled || result.filePaths.length === 0) return []

    const eppFiles = readdirSync(projectDir).filter(f => f.endsWith('.epp'))
    const eppPath = eppFiles.length > 0 ? join(projectDir, eppFiles[0]) : ''
    let eppContent = eppPath && existsSync(eppPath) ? readFileSync(eppPath, 'utf-8') : ''
    const imported: string[] = []
    const resourceDir = join(projectDir, 'rc')
    if (!existsSync(resourceDir)) {
      mkdirSync(resourceDir, { recursive: true })
    }
    const resourceTableFileName = '资源表.erc'
    const resourceTablePath = join(projectDir, resourceTableFileName)
    const inferResourceType = (name: string): string => {
      const ext = (extname(name) || '').toLowerCase().replace('.', '')
      const imageExt = new Set(['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'svg', 'ico', 'tif', 'tiff'])
      const audioExt = new Set(['wav', 'mp3', 'ogg', 'wma', 'aac', 'flac', 'm4a', 'mid', 'midi'])
      const videoExt = new Set(['mp4', 'avi', 'mov', 'wmv', 'mkv', 'webm', 'flv', 'm4v', 'mpeg', 'mpg'])
      if (imageExt.has(ext)) return '图片'
      if (audioExt.has(ext)) return '声音'
      if (videoExt.has(ext)) return '视频'
      return '其它'
    }

    const ensureEppLine = (fileType: string, fileName: string): void => {
      if (!eppPath) return
      const escapedFileName = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const existed = new RegExp(`^File=[^|]+\\|${escapedFileName}\\|\\d+$`, 'm').test(eppContent)
      if (!existed) {
        const newLine = `File=${fileType}|${fileName}|0`
        eppContent = eppContent.trimEnd() + '\n' + newLine + '\n'
      }
    }

    const ensureUniqueName = (name: string): string => {
      const ext = extname(name)
      const stem = ext ? name.slice(0, -ext.length) : name
      let candidate = name
      let idx = 1
      while (existsSync(join(resourceDir, candidate))) {
        candidate = `${stem}_${idx}${ext}`
        idx++
      }
      return candidate
    }

    for (const srcPath of result.filePaths) {
      const srcName = basename(srcPath)
      const targetName = ensureUniqueName(srcName)
      const targetPath = join(resourceDir, targetName)
      copyFileSync(srcPath, targetPath)
      imported.push(targetName)
      ensureEppLine('RES', targetName)
    }

    // 将资源记录写入 资源表.erc（资源表风格）
    let tableContent = existsSync(resourceTablePath)
      ? readFileSync(resourceTablePath, 'utf-8')
      : '.版本 2\n\n'

    const existingResNames = new Set<string>()
    let maxResourceIndex = 0
    const rowRe = /^\s*\.(?:资源|常量)\s+([^,\s]+)\s*,\s*["“]([^"”]+)["”]/gm
    let m: RegExpExecArray | null
    while ((m = rowRe.exec(tableContent)) !== null) {
      const resName = (m[1] || '').trim()
      const fileName = (m[2] || '').trim()
      if (fileName) existingResNames.add(fileName)
      const idxMatch = /^资源(\d+)$/.exec(resName)
      if (idxMatch) maxResourceIndex = Math.max(maxResourceIndex, parseInt(idxMatch[1], 10))
    }

    for (const fileName of imported) {
      if (existingResNames.has(fileName)) continue
      maxResourceIndex += 1
      const resourceType = inferResourceType(fileName)
      tableContent = tableContent.trimEnd() + `\n.资源 资源${maxResourceIndex}, "${fileName}", ${resourceType}\n`
      existingResNames.add(fileName)
    }

    writeFileSync(resourceTablePath, tableContent.endsWith('\n') ? tableContent : tableContent + '\n', 'utf-8')
    ensureEppLine('ERC', resourceTableFileName)

    if (eppPath) {
      writeFileSync(eppPath, eppContent, 'utf-8')
    }

    return imported
  })

  // 替换项目中的现有资源文件内容（保持资源文件名不变）
  ipcMain.handle('project:replaceResourceFile', async (_event, projectDir: string, targetFileName: string) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win || !existsSync(projectDir) || !targetFileName) {
      return { success: false as const, canceled: false as const, message: '无效参数' }
    }

    const targetPath = (() => {
      const rcPath = join(projectDir, 'rc', targetFileName)
      if (existsSync(rcPath)) return rcPath
      const legacyPath = join(projectDir, targetFileName)
      if (existsSync(legacyPath)) return legacyPath
      return rcPath
    })()
    const result = await dialog.showOpenDialog(win, {
      title: `替换资源文件：${targetFileName}`,
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false as const, canceled: true as const }
    }

    try {
      copyFileSync(result.filePaths[0], targetPath)
      return { success: true as const, targetFileName }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false as const, canceled: false as const, message }
    }
  })

  // 导入单个资源文件到项目目录（不改资源表），返回导入后的文件名
  ipcMain.handle('project:importResourceFile', async (_event, projectDir: string) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win || !existsSync(projectDir)) {
      return { success: false as const, canceled: false as const, message: '无效参数' }
    }

    const result = await dialog.showOpenDialog(win, {
      title: '选择资源文件',
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false as const, canceled: true as const }
    }

    const resourceDir = join(projectDir, 'rc')
    if (!existsSync(resourceDir)) {
      mkdirSync(resourceDir, { recursive: true })
    }

    const srcPath = result.filePaths[0]
    const srcName = basename(srcPath)
    const ext = extname(srcName)
    const stem = ext ? srcName.slice(0, -ext.length) : srcName
    let targetName = srcName
    let idx = 1
    while (existsSync(join(resourceDir, targetName))) {
      targetName = `${stem}_${idx}${ext}`
      idx++
    }

    try {
      const targetPath = join(resourceDir, targetName)
      copyFileSync(srcPath, targetPath)

      const eppFiles = readdirSync(projectDir).filter(f => f.endsWith('.epp'))
      if (eppFiles.length > 0) {
        const eppPath = join(projectDir, eppFiles[0])
        let eppContent = readFileSync(eppPath, 'utf-8')
        const escaped = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const existed = new RegExp(`^File=[^|]+\\|${escaped}\\|\\d+$`, 'm').test(eppContent)
        if (!existed) {
          eppContent = eppContent.trimEnd() + `\nFile=RES|${targetName}|0\n`
          writeFileSync(eppPath, eppContent, 'utf-8')
        }
      }

      return { success: true as const, fileName: targetName }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false as const, canceled: false as const, message }
    }
  })

  // 获取资源预览数据（可选 base64），避免渲染进程直接 file:// 读取失败
  ipcMain.handle('project:getResourcePreviewData', (_event, projectDir: string, fileName: string, withContent = true) => {
    if (!projectDir || !fileName) {
      return { success: false as const, message: '无效参数' }
    }

    const filePath = (() => {
      const rcPath = join(projectDir, 'rc', fileName)
      if (existsSync(rcPath)) return rcPath
      const legacyPath = join(projectDir, fileName)
      if (existsSync(legacyPath)) return legacyPath
      return ''
    })()

    if (!filePath) {
      return { success: false as const, message: '资源文件不存在' }
    }

    let stat
    try {
      stat = statSync(filePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false as const, message }
    }

    const ext = (extname(fileName) || '').toLowerCase().replace('.', '')
    const mimeMap: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
      mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac', m4a: 'audio/mp4', flac: 'audio/flac',
      mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
    }
    const mime = mimeMap[ext] || 'application/octet-stream'

    if (!withContent) {
      return {
        success: true as const,
        mime,
        ext,
        filePath,
        sizeBytes: stat.size,
        modifiedAtMs: stat.mtimeMs,
      }
    }

    try {
      const buf = readFileSync(filePath)
      return {
        success: true as const,
        mime,
        ext,
        filePath,
        sizeBytes: stat.size,
        modifiedAtMs: stat.mtimeMs,
        base64: buf.toString('base64'),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false as const, message }
    }
  })

  // 支持库 IPC
  ipcMain.handle('library:scan', (_event, folder?: string) => {
    return libraryManager.scan(folder)
  })
  ipcMain.handle('library:load', async (_event, name: string) => {
    const result = libraryManager.load(name)
    if (result.success) {
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('library:loaded'))
    }
    return result
  })
  ipcMain.handle('library:unload', (_event, name: string) => {
    const result = libraryManager.unload(name)
    if (result.success) {
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('library:loaded'))
    }
    return result
  })
  ipcMain.handle('library:loadAll', async () => {
    const result = libraryManager.loadAll()
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('library:loaded'))
    return result
  })
  ipcMain.handle('library:applySelection', async (_event, selectedNames: string[]) => {
    const result = libraryManager.applySelection(selectedNames)
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('library:loaded'))
    return result
  })
  ipcMain.handle('library:getList', () => {
    return libraryManager.getList()
  })
  ipcMain.handle('library:getInfo', (_event, name: string) => {
    return libraryManager.getLibInfo(name)
  })
  ipcMain.handle('library:getAllCommands', () => {
    return libraryManager.getAllCommands()
  })
  ipcMain.handle('library:getAllDataTypes', () => {
    return libraryManager.getAllDataTypes()
  })
  ipcMain.handle('library:getWindowUnits', () => {
    return libraryManager.getAllWindowUnits()
  })

  ipcMain.handle('ycmd:scan', (_event, rootPath?: string) => {
    return scanYcmdRegistry(rootPath)
  })

  // 主题 IPC
  ipcMain.handle('theme:getList', () => {
    const themesDir = isDev ? join(app.getAppPath(), 'themes') : join(dirname(process.execPath), 'themes')
    if (!existsSync(themesDir)) return []
    try {
      return readdirSync(themesDir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''))
    } catch { return [] }
  })

  ipcMain.handle('theme:load', (_event, name: string) => {
    const themesDir = isDev ? join(app.getAppPath(), 'themes') : join(dirname(process.execPath), 'themes')
    const filePath = join(themesDir, `${name}.json`)
    if (!existsSync(filePath)) return null
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch { return null }
  })

  ipcMain.handle('theme:getCurrent', () => {
    const configPath = join(app.getPath('userData'), 'theme-config.json')
    if (!existsSync(configPath)) return '默认深色'
    try {
      const data = JSON.parse(readFileSync(configPath, 'utf-8'))
      return data.currentTheme || '默认深色'
    } catch { return '默认深色' }
  })

  ipcMain.handle('theme:setCurrent', (_event, name: string) => {
    const configPath = join(app.getPath('userData'), 'theme-config.json')
    writeFileSync(configPath, JSON.stringify({ currentTheme: name }), 'utf-8')
  })

  // 编译器 IPC
  ipcMain.handle('compiler:compile', async (_event, projectDir: string, editorFilesObj?: Record<string, string>, arch?: string) => {
    const editorFiles = editorFilesObj ? new Map(Object.entries(editorFilesObj)) : undefined
    return compileProject({ projectDir, debug: true, arch, mode: 'compile' }, editorFiles)
  })

  ipcMain.handle('compiler:run', async (_event, projectDir: string, editorFilesObj?: Record<string, string>, arch?: string, debugOptions?: { breakpoints?: Record<string, number[]> }) => {
    const editorFiles = editorFilesObj ? new Map(Object.entries(editorFilesObj)) : undefined
    const result = await compileProject({ projectDir, debug: true, arch, mode: 'run', breakpoints: debugOptions?.breakpoints || {} }, editorFiles)
    if (result.success && result.outputFile) {
      runExecutable(result.outputFile)
    }
    return result
  })

  ipcMain.handle('compiler:stop', () => {
    return stopExecutable()
  })

  ipcMain.handle('compiler:isRunning', () => {
    return isRunning()
  })

  // 渲染进程诊断日志
  ipcMain.handle('debug:logRendererError', (_event, payload: { source?: string; message: string; stack?: string; extra?: unknown }) => {
    try {
      appendRendererErrorLog(payload)
      console.error('[renderer-error]', payload)
      return { success: true }
    } catch (error) {
      console.error('[renderer-error] failed to persist log', error)
      return { success: false }
    }
  })

  ipcMain.handle('debug:getRendererErrorLogPath', () => {
    return getRendererErrorLogPath()
  })

  ipcMain.handle('debug:continue', () => {
    return continueDebugExecutable()
  })

  // 启动时自动扫描并加载上次已加载的支持库
  libraryManager.scanAndAutoLoad()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
