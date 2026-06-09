import { execFile, execFileSync, spawn } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import { tmpdir } from 'os'
import { BrowserWindow } from 'electron'
import type { IDESettings } from '../shared/settings'

export interface AndroidRunResult {
  success: boolean
  outputFile: string
  errorCount: number
  warningCount: number
  elapsedMs: number
}

interface ProjectFileEntry {
  type: string
  fileName: string
  flag: number
}

interface ProjectInfo {
  projectName: string
  outputType: string
  platform: string
  files: ProjectFileEntry[]
  projectDir: string
}

interface DesignControl {
  type?: string
  name?: string
  text?: string
  left?: number
  top?: number
  x?: number
  y?: number
  width?: number
  height?: number
  properties?: Record<string, unknown>
}

interface DesignForm {
  name?: string
  title?: string
  width?: number
  height?: number
  controls?: DesignControl[]
}

function sendMessage(type: 'info' | 'warning' | 'error' | 'success', text: string): void {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('compiler:output', { type, text })
  })
}

export function readProjectInfo(projectDir: string): ProjectInfo | null {
  const eppPath = findEppPath(projectDir)
  if (!eppPath) return null
  try {
    const content = readFileSync(eppPath, 'utf-8')
    const info: Record<string, string> = {}
    const files: ProjectFileEntry[] = []
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      if (line.startsWith('File=')) {
        const parts = line.slice(5).split('|')
        files.push({
          type: parts[0] || '',
          fileName: parts[1] || '',
          flag: Number.parseInt(parts[2] || '0', 10) || 0,
        })
        continue
      }
      const eq = line.indexOf('=')
      if (eq > 0) info[line.slice(0, eq)] = line.slice(eq + 1)
    }
    return {
      projectName: info.ProjectName || basename(projectDir),
      outputType: info.OutputType || '',
      platform: (info.Platform || '').toLowerCase(),
      files,
      projectDir,
    }
  } catch {
    return null
  }
}

export function shouldRunAsAndroid(projectDir: string): boolean {
  const project = readProjectInfo(projectDir)
  return project?.platform === 'android' && project.outputType === 'WindowsApp'
}

export async function buildAndRunAndroidProject(
  projectDir: string,
  settings: IDESettings,
  editorFiles?: Map<string, string>,
): Promise<AndroidRunResult> {
  const startTime = Date.now()
  const result: AndroidRunResult = {
    success: false,
    outputFile: '',
    errorCount: 0,
    warningCount: 0,
    elapsedMs: 0,
  }

  const project = readProjectInfo(projectDir)
  if (!project) {
    result.errorCount++
    sendMessage('error', '错误: 找不到项目 .epp 文件。')
    return finish(result, startTime)
  }
  if (project.platform !== 'android') {
    result.errorCount++
    sendMessage('error', `错误: 当前 Android 运行器不支持目标平台 ${project.platform || '-'}`)
    return finish(result, startTime)
  }

  const gradleCommand = resolveGradleCommand(settings)
  const adbCommand = resolveAdbCommand(settings)
  if (!gradleCommand) {
    result.errorCount++
    sendMessage('error', '错误: 找不到 Gradle。请在“系统设置 > Android 运行 > Gradle 路径”填写 gradle.bat 的完整路径，或把 Gradle 加入 PATH。')
    sendMessage('info', '提示: 路径示例 C:\\Gradle\\gradle-8.9\\bin\\gradle.bat')
    return finish(result, startTime)
  }
  if (!adbCommand) {
    result.errorCount++
    sendMessage('error', '错误: 找不到 ADB。请在“系统设置 > Android 运行”填写 Android SDK 路径，或填写 adb.exe 的完整路径。')
    sendMessage('info', '提示: ADB 通常位于 Android SDK\\platform-tools\\adb.exe')
    return finish(result, startTime)
  }

  const packageName = buildPackageName(settings.androidPackagePrefix, project.projectName)
  const buildRoot = join(tmpdir(), 'ycide-android-build', packageName)
  const form = readDesignForm(project, editorFiles)
  const sdkPath = resolveAndroidSdkPath(settings, adbCommand)

  sendMessage('info', 'Android: 正在生成 Gradle WebView 工程...')
  writeAndroidProject(buildRoot, project, form, packageName, settings, sdkPath)

  if (settings.androidAutoStartEmulator && settings.androidEmulatorExePath) {
    launchEmulator(settings)
  }

  sendMessage('info', `Android: 正在构建 APK (${gradleCommand})...`)
  const buildOk = await runLoggedCommand(gradleCommand, [':app:assembleDebug'], buildRoot)
  if (!buildOk) {
    result.errorCount++
    return finish(result, startTime)
  }

  const apkPath = join(buildRoot, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
  result.outputFile = apkPath
  if (!existsSync(apkPath)) {
    result.errorCount++
    sendMessage('error', `错误: Gradle 构建完成，但没有找到 APK: ${apkPath}`)
    return finish(result, startTime)
  }

  const deviceId = await prepareAdbDevice(adbCommand, settings)
  if (!deviceId) {
    result.errorCount++
    sendMessage('error', '错误: ADB 没有发现在线设备，请确认雷电模拟器已启动并允许 ADB 连接。')
    return finish(result, startTime)
  }

  sendMessage('info', `Android: 正在安装到设备 ${deviceId}...`)
  if (!await runLoggedCommand(adbCommand, ['-s', deviceId, 'install', '-r', apkPath], projectDir)) {
    result.errorCount++
    return finish(result, startTime)
  }

  sendMessage('info', 'Android: 正在启动应用...')
  if (!await runLoggedCommand(adbCommand, ['-s', deviceId, 'shell', 'am', 'start', '-n', `${packageName}/.MainActivity`], projectDir)) {
    result.errorCount++
    return finish(result, startTime)
  }

  result.success = true
  sendMessage('success', `Android: 已安装并启动 ${packageName}`)
  return finish(result, startTime)
}

function finish(result: AndroidRunResult, startTime: number): AndroidRunResult {
  result.elapsedMs = Date.now() - startTime
  return result
}

function findEppPath(projectDir: string): string | null {
  try {
    const files = readdirSync(projectDir)
    const epp = files.find(file => file.toLowerCase().endsWith('.epp'))
    return epp ? join(projectDir, epp) : null
  } catch {
    return null
  }
}

function resolveGradleCommand(settings: IDESettings): string | null {
  const configured = resolveConfiguredCommand(settings.androidGradlePath)
  if (configured) return configured
  return findCommandInPath(process.platform === 'win32' ? ['gradle.bat', 'gradle.cmd', 'gradle.exe', 'gradle'] : ['gradle'])
    || findGradleWrapperDistribution()
}

function resolveAdbCommand(settings: IDESettings): string | null {
  const configured = resolveConfiguredCommand(settings.androidAdbPath)
  if (configured) return configured
  if (settings.androidSdkPath) {
    const adb = join(settings.androidSdkPath, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
    if (existsSync(adb)) return adb
  }
  return findCommandInPath(process.platform === 'win32' ? ['adb.exe', 'adb'] : ['adb'])
}

function resolveConfiguredCommand(value: string): string | null {
  const trimmed = (value || '').trim()
  if (!trimmed) return null
  if (/[\\/]/.test(trimmed)) return existsSync(trimmed) ? trimmed : null
  return findCommandInPath([trimmed])
}

function findCommandInPath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      const output = process.platform === 'win32'
        ? execFileSync('where.exe', [candidate], { encoding: 'utf-8', windowsHide: true })
        : execFileSync('which', [candidate], { encoding: 'utf-8' })
      const first = output.split(/\r?\n/).map(line => line.trim()).find(Boolean)
      if (first) return first
    } catch {
      continue
    }
  }
  return null
}

function findGradleWrapperDistribution(): string | null {
  const wrapperRoot = join(process.env.USERPROFILE || '', '.gradle', 'wrapper', 'dists')
  if (!wrapperRoot || !existsSync(wrapperRoot)) return null
  const found: Array<{ version: number[]; filePath: string }> = []
  const commandName = process.platform === 'win32' ? 'gradle.bat' : 'gradle'
  collectFiles(wrapperRoot, commandName, found)
  found.sort((a, b) => compareVersions(b.version, a.version))
  return found[0]?.filePath || null
}

function collectFiles(root: string, fileName: string, out: Array<{ version: number[]; filePath: string }>): void {
  let entries: string[] = []
  try {
    entries = readdirSync(root)
  } catch {
    return
  }
  for (const entry of entries) {
    const filePath = join(root, entry)
    try {
      if (existsSync(filePath) && readdirSync(filePath)) {
        collectFiles(filePath, fileName, out)
      }
    } catch {
      if (entry.toLowerCase() === fileName.toLowerCase()) {
        out.push({ version: parseVersionFromPath(filePath), filePath })
      }
    }
  }
}

function parseVersionFromPath(filePath: string): number[] {
  const match = filePath.match(/gradle-(\d+(?:\.\d+)*)/i)
  return match ? match[1].split('.').map(part => Number.parseInt(part, 10) || 0) : [0]
}

function compareVersions(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const diff = (a[i] || 0) - (b[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

function resolveAndroidSdkPath(settings: IDESettings, adbCommand: string): string {
  if (settings.androidSdkPath && existsSync(settings.androidSdkPath)) return settings.androidSdkPath
  const normalized = adbCommand.replace(/\\/g, '/')
  const marker = '/platform-tools/'
  const index = normalized.toLowerCase().lastIndexOf(marker)
  if (index > 0) return adbCommand.slice(0, index)
  if (process.env.ANDROID_HOME && existsSync(process.env.ANDROID_HOME)) return process.env.ANDROID_HOME
  if (process.env.ANDROID_SDK_ROOT && existsSync(process.env.ANDROID_SDK_ROOT)) return process.env.ANDROID_SDK_ROOT
  return ''
}

function launchEmulator(settings: IDESettings): void {
  try {
    const args = splitArgs(settings.androidEmulatorLaunchArgs)
    const child = spawn(settings.androidEmulatorExePath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
    sendMessage('info', `Android: 已请求启动模拟器 ${settings.androidEmulatorKind}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendMessage('warning', `警告: 启动模拟器失败: ${message}`)
  }
}

async function prepareAdbDevice(adbCommand: string, settings: IDESettings): Promise<string | null> {
  if (settings.androidAdbConnectAddress) {
    await runLoggedCommand(adbCommand, ['connect', settings.androidAdbConnectAddress], dirname(adbCommand))
  }
  if (settings.androidAdbDeviceId) return settings.androidAdbDeviceId

  const output = await captureCommand(adbCommand, ['devices'])
  const lines = output.split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/^(\S+)\s+device$/)
    if (match) return match[1]
  }
  return null
}

function readDesignForm(project: ProjectInfo, editorFiles?: Map<string, string>): DesignForm {
  const efw = project.files.find(file => file.type.toUpperCase() === 'EFW' && file.flag === 1)
    || project.files.find(file => file.type.toUpperCase() === 'EFW')
  const fallback: DesignForm = { title: project.projectName, width: 360, height: 800, controls: [] }
  if (!efw) return fallback
  const filePath = join(project.projectDir, efw.fileName)
  const content = editorFiles?.get(filePath)
    || editorFiles?.get(efw.fileName)
    || readFileIfExists(filePath)
  if (!content) return fallback
  try {
    const parsed = JSON.parse(content)
    return normalizeDesignForm(parsed, fallback)
  } catch {
    return fallback
  }
}

function readFileIfExists(filePath: string): string | null {
  try {
    return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null
  } catch {
    return null
  }
}

function normalizeDesignForm(raw: unknown, fallback: DesignForm): DesignForm {
  if (!raw || typeof raw !== 'object') return fallback
  const input = raw as DesignForm
  return {
    name: input.name || fallback.name,
    title: input.title || fallback.title,
    width: positiveNumber(input.width, fallback.width || 360),
    height: positiveNumber(input.height, fallback.height || 800),
    controls: Array.isArray(input.controls) ? input.controls : [],
  }
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}

function writeAndroidProject(root: string, project: ProjectInfo, form: DesignForm, packageName: string, settings: IDESettings, sdkPath: string): void {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, 'app', 'src', 'main', 'java', ...packageName.split('.')), { recursive: true })
  mkdirSync(join(root, 'app', 'src', 'main', 'assets'), { recursive: true })

  if (sdkPath) {
    writeFileSync(join(root, 'local.properties'), `sdk.dir=${escapePropertiesPath(resolve(sdkPath))}\n`, 'utf-8')
  }
  writeFileSync(join(root, 'gradle.properties'), 'android.overridePathCheck=true\norg.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8\n', 'utf-8')
  writeFileSync(join(root, 'settings.gradle.kts'), 'pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }\nrootProject.name = "ycide-android"\ninclude(":app")\n', 'utf-8')
  writeFileSync(join(root, 'build.gradle.kts'), `plugins {\n    id("com.android.application") version "${settings.androidGradlePluginVersion}" apply false\n}\n`, 'utf-8')
  writeFileSync(join(root, 'app', 'build.gradle.kts'), `plugins { id("com.android.application") }\n\nandroid {\n    namespace = "${packageName}"\n    compileSdk = ${settings.androidCompileSdk}\n\n    defaultConfig {\n        applicationId = "${packageName}"\n        minSdk = ${settings.androidMinSdk}\n        targetSdk = ${settings.androidTargetSdk}\n        versionCode = 1\n        versionName = "1.0"\n    }\n}\n`, 'utf-8')
  writeFileSync(join(root, 'app', 'src', 'main', 'AndroidManifest.xml'), `<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <application android:theme="@style/AppTheme" android:label="${escapeXml(project.projectName)}" android:usesCleartextTraffic="true">\n    <activity android:name=".MainActivity" android:screenOrientation="portrait" android:exported="true">\n      <intent-filter>\n        <action android:name="android.intent.action.MAIN" />\n        <category android:name="android.intent.category.LAUNCHER" />\n      </intent-filter>\n    </activity>\n  </application>\n</manifest>\n`, 'utf-8')
  mkdirSync(join(root, 'app', 'src', 'main', 'res', 'values'), { recursive: true })
  writeFileSync(join(root, 'app', 'src', 'main', 'res', 'values', 'styles.xml'), '<resources>\n  <style name="AppTheme" parent="android:style/Theme.Material.Light.NoActionBar">\n    <item name="android:windowNoTitle">true</item>\n    <item name="android:windowActionBar">false</item>\n  </style>\n</resources>\n', 'utf-8')
  writeFileSync(join(root, 'app', 'src', 'main', 'java', ...packageName.split('.'), 'MainActivity.java'), `package ${packageName};\n\nimport android.app.Activity;\nimport android.os.Bundle;\nimport android.webkit.WebSettings;\nimport android.webkit.WebView;\n\npublic class MainActivity extends Activity {\n    @Override\n    protected void onCreate(Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n        WebView webView = new WebView(this);\n        WebSettings settings = webView.getSettings();\n        settings.setJavaScriptEnabled(true);\n        settings.setDomStorageEnabled(true);\n        setContentView(webView);\n        webView.loadUrl("file:///android_asset/index.html");\n    }\n}\n`, 'utf-8')
  writeFileSync(join(root, 'app', 'src', 'main', 'assets', 'index.html'), renderFormHtml(form, project.projectName), 'utf-8')
}

function renderFormHtml(form: DesignForm, projectName: string): string {
  const width = positiveNumber(form.width, 360)
  const height = positiveNumber(form.height, 800)
  const title = form.title || projectName
  const controls = (form.controls || []).map(renderControlHtml).join('\n')
  return `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">\n<title>${escapeHtml(title)}</title>\n<style>\nhtml,body{margin:0;width:100%;height:100%;background:#f5f7fb;font-family:system-ui,-apple-system,Segoe UI,sans-serif;overflow:hidden;color:#1f2937}.stage{position:fixed;inset:0;display:flex;align-items:flex-start;justify-content:center;background:#eef2f7}.screen{position:relative;width:${width}px;height:${height}px;background:#fff;box-shadow:0 0 0 1px rgba(15,23,42,.12);transform-origin:top center}.control{position:absolute;box-sizing:border-box;border:1px solid #cbd5e1;background:#fff;border-radius:4px;padding:6px 8px;font-size:14px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.button{display:flex;align-items:center;justify-content:center;background:#2563eb;color:white;border-color:#2563eb}.label{border-color:transparent;background:transparent}.input{background:#fff}.panel{background:#f8fafc}\n</style>\n</head>\n<body>\n<div class="stage"><div id="screen" class="screen">${controls}</div></div>\n<script>\nfunction fit(){const s=document.getElementById('screen');const scale=Math.min(window.innerWidth/${width},window.innerHeight/${height});s.style.transform='scale('+scale+')'}\nwindow.addEventListener('resize',fit);fit();\n</script>\n</body>\n</html>\n`
}

function renderControlHtml(control: DesignControl): string {
  const left = positiveNumber(control.left ?? control.x, 0)
  const top = positiveNumber(control.top ?? control.y, 0)
  const width = positiveNumber(control.width, 100)
  const height = positiveNumber(control.height, 32)
  const text = String(control.properties?.['标题'] ?? control.properties?.['内容'] ?? control.properties?.['文本'] ?? control.text ?? control.name ?? '')
  const kind = String(control.type || '').toLowerCase()
  const cls = kind.includes('button') || kind.includes('按钮') ? 'button'
    : kind.includes('edit') || kind.includes('input') || kind.includes('编辑') ? 'input'
      : kind.includes('label') || kind.includes('标签') ? 'label'
        : 'panel'
  return `<div class="control ${cls}" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px">${escapeHtml(text)}</div>`
}

function buildPackageName(prefix: string, projectName: string): string {
  const cleanPrefix = (prefix || 'com.ycide.app').replace(/[^a-z0-9_.]/g, '').replace(/\.+/g, '.').replace(/^\.|\.$/g, '')
  const hash = createHash('sha1').update(projectName).digest('hex').slice(0, 8)
  return `${cleanPrefix || 'com.ycide.app'}.p${hash}`
}

function runLoggedCommand(command: string, args: string[], cwd: string): Promise<boolean> {
  return new Promise(resolveRun => {
    const child = execFile(command, args, { cwd, windowsHide: true, shell: shouldUseShell(command) }, (error, stdout, stderr) => {
      for (const line of splitOutput(stdout)) sendMessage('info', line)
      for (const line of splitOutput(stderr)) sendMessage(error ? 'error' : 'warning', line)
      resolveRun(!error)
    })
    child.on('error', error => {
      sendMessage('error', `${command}: ${error.message}`)
      resolveRun(false)
    })
  })
}

function captureCommand(command: string, args: string[]): Promise<string> {
  return new Promise(resolveCapture => {
    execFile(command, args, { windowsHide: true, shell: shouldUseShell(command) }, (_error, stdout, stderr) => {
      resolveCapture(`${stdout || ''}\n${stderr || ''}`)
    })
  })
}

function shouldUseShell(command: string): boolean {
  return process.platform === 'win32' && (!/[\\/]/.test(command) || /\.(?:bat|cmd)$/i.test(command))
}

function splitOutput(text: string | Buffer | undefined): string[] {
  return String(text || '').replace(/\r\n/g, '\n').split('\n').map(line => line.trimEnd()).filter(Boolean)
}

function splitArgs(text: string): string[] {
  if (!text.trim()) return []
  const matches = text.match(/"[^"]*"|\S+/g) || []
  return matches.map(item => item.replace(/^"|"$/g, ''))
}

function escapePropertiesPath(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:')
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeXml(value: string): string {
  return escapeHtml(value).replace(/'/g, '&apos;')
}
