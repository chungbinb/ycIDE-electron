import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join, dirname } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, appendFileSync } from 'fs'
import { libraryManager } from './library-manager'
import { compileProject, runExecutable, stopExecutable, isRunning } from './compiler'

const isDev = !app.isPackaged

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
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false, // 无边框，使用自定义标题栏
    titleBarStyle: 'hidden',
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

app.whenReady().then(() => {
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

  // 保存打开的标签页列表到项目目录
  ipcMain.handle('project:saveOpenTabs', (_event, projectDir: string, tabPaths: string[]) => {
    const sessionPath = join(projectDir, '.ycide-session.json')
    writeFileSync(sessionPath, JSON.stringify({ openTabs: tabPaths }, null, 2), 'utf-8')
  })

  // 读取保存的标签页列表
  ipcMain.handle('project:loadOpenTabs', (_event, projectDir: string) => {
    const sessionPath = join(projectDir, '.ycide-session.json')
    if (!existsSync(sessionPath)) return []
    try {
      const data = JSON.parse(readFileSync(sessionPath, 'utf-8'))
      return data.openTabs || []
    } catch { return [] }
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
    for (const fileName of eycFiles) {
      const filePath = join(projectDir, fileName)
      if (openSet.has(filePath)) continue
      let content = readFileSync(filePath, 'utf-8')
      if (!content.includes(oldName)) continue
      // 更新程序集名：窗口程序集_旧名 → 窗口程序集_新名
      content = content.split('窗口程序集_' + oldName).join('窗口程序集_' + newName)
      // 更新事件引用：_旧名_ → _新名_
      content = content.split('_' + oldName + '_').join('_' + newName + '_')
      // 更新跨窗口引用：旧名. → 新名.  (如 窗口1.按钮1.禁止)
      content = content.split(oldName + '.').join(newName + '.')
      writeFileSync(filePath, content, 'utf-8')
    }

    return { newEfwPath: newEfw, newEycPath: newEyc }
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
      writeFileSync(eppPath, eppContent.trimEnd() + '\n' + newLine + '\n', 'utf-8')
    }
    return filePath
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
  ipcMain.handle('compiler:compile', async (_event, projectDir: string, editorFilesObj?: Record<string, string>, linkMode?: 'static' | 'normal', arch?: string) => {
    const editorFiles = editorFilesObj ? new Map(Object.entries(editorFilesObj)) : undefined
    return compileProject({ projectDir, debug: true, linkMode: linkMode || 'normal', arch }, editorFiles)
  })

  ipcMain.handle('compiler:run', async (_event, projectDir: string, editorFilesObj?: Record<string, string>, arch?: string) => {
    const editorFiles = editorFilesObj ? new Map(Object.entries(editorFilesObj)) : undefined
    const result = await compileProject({ projectDir, debug: true, arch }, editorFiles)
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
