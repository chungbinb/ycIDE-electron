import './SettingsDialog.css'
import { useEffect, useState, useCallback } from 'react'
import { DEFAULT_IDE_SETTINGS, type IDESettings } from '../../../../shared/settings'
import type { AISupportedModel } from '../../../../shared/ai'

interface SettingsDialogProps {
  settings: IDESettings
  onClose: () => void
  onSave: (settings: IDESettings) => void
  onChange: (settings: IDESettings) => void
}

const UI_FONT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '微软雅黑', value: '"Microsoft YaHei UI", "Segoe UI", system-ui, -apple-system, sans-serif' },
  { label: '等线', value: '"DengXian", "Microsoft YaHei UI", "Segoe UI", sans-serif' },
  { label: '宋体', value: '"SimSun", "Microsoft YaHei UI", sans-serif' },
  { label: 'Segoe UI', value: '"Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif' },
]

const EDITOR_FONT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'Cascadia Code', value: '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace' },
  { label: 'Consolas', value: 'Consolas, "Cascadia Code", "JetBrains Mono", "Courier New", monospace' },
  { label: 'Fira Code', value: '"Fira Code", "Cascadia Code", Consolas, "Courier New", monospace' },
]

const UI_FONT_SIZE_OPTIONS = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24]
const TITLEBAR_FONT_SIZE_OPTIONS = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24]
const EDITOR_FONT_SIZE_OPTIONS = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 30]
const EDITOR_LINE_HEIGHT_OPTIONS = [14, 16, 18, 20, 22, 24, 26, 28, 30, 34, 38, 42, 48, 54]
const AI_FONT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '微软雅黑', value: '"Microsoft YaHei UI", "Segoe UI", system-ui, -apple-system, sans-serif' },
  { label: '等线', value: '"DengXian", "Microsoft YaHei UI", "Segoe UI", sans-serif' },
  { label: 'Cascadia Code', value: '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace' },
  { label: 'Consolas', value: 'Consolas, "Cascadia Code", "JetBrains Mono", "Courier New", monospace' },
]
const AI_FONT_SIZE_OPTIONS = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24]
const AI_MODEL_OPTIONS: Array<{ label: string; value: AISupportedModel }> = [
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'GLM', value: 'glm' },
]
const ANDROID_EMULATOR_OPTIONS: Array<{ label: string; value: IDESettings['androidEmulatorKind'] }> = [
  { label: '雷电模拟器', value: 'ldplayer' },
  { label: 'Android Studio Emulator', value: 'android-studio' },
  { label: '自定义', value: 'custom' },
]

function SettingsDialog({ settings, onClose, onSave, onChange }: SettingsDialogProps): React.JSX.Element {
  const [draft, setDraft] = useState<IDESettings>({ ...settings })
  const [baseline] = useState<IDESettings>({ ...settings })

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onChange(baseline)
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [baseline, onChange, onClose])

  const updateDraft = useCallback(<K extends keyof IDESettings>(key: K, value: IDESettings[K]) => {
    setDraft(prev => {
      const next = { ...prev, [key]: value }
      onChange(next)
      return next
    })
  }, [onChange])

  /** 浏览选择 zig 可执行文件（绿色版解压到任意目录，手填路径易错） */
  const pickCompilerPath = useCallback(async () => {
    const picked = await window.api?.file?.openDialog?.()
    if (picked) updateDraft('compilerZigPath', picked)
  }, [updateDraft])

  const handleNumberChange = (key: keyof IDESettings, raw: string): void => {
    const n = parseInt(raw, 10)
    if (!Number.isNaN(n)) updateDraft(key, n as IDESettings[typeof key])
  }

  const handleSubmit = (): void => {
    onSave(draft)
    onClose()
  }

  const handleCancel = (): void => {
    onChange(baseline)
    onClose()
  }

  const handleReset = (): void => {
    const def = { ...DEFAULT_IDE_SETTINGS }
    setDraft(def)
    onChange(def)
  }

  return (
    <div className="settings-dialog">
      <header className="settings-header settings-drag-region">
        <span className="settings-title">系统设置</span>
        <button type="button" className="settings-close" onClick={handleCancel}>×</button>
      </header>
      <div className="settings-body">
        <div className="settings-group">
          <h4 className="settings-group-title">布局</h4>
          <div className="settings-row">
            <span className="settings-label">标题栏菜单字体</span>
            <select
              className="settings-input"
              title="标题栏菜单字体"
              value={draft.titlebarMenuFontFamily}
              onChange={(e) => updateDraft('titlebarMenuFontFamily', e.target.value)}
            >
              {UI_FONT_OPTIONS.map((item) => (
                <option key={item.label} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <span className="settings-label">标题栏菜单字号</span>
            <select
              className="settings-input settings-input-number"
              title="标题栏菜单字号"
              value={draft.titlebarMenuFontSize}
              onChange={(e) => handleNumberChange('titlebarMenuFontSize', e.target.value)}
            >
              {TITLEBAR_FONT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <span className="settings-unit">px</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">工具栏图标大小（高度自动适配）</span>
            <input
              type="number"
              className="settings-input settings-input-number"
              title="工具栏图标大小"
              min={12}
              max={32}
              value={draft.toolbarIconSize}
              onChange={(e) => handleNumberChange('toolbarIconSize', e.target.value)}
            />
            <span className="settings-unit">px</span>
          </div>
        </div>
        <div className="settings-group">
          <h4 className="settings-group-title">字体</h4>
          <div className="settings-row">
            <span className="settings-label">界面字体</span>
            <select
              className="settings-input"
              title="界面字体"
              value={draft.fontFamily}
              onChange={(e) => updateDraft('fontFamily', e.target.value)}
            >
              {UI_FONT_OPTIONS.map((item) => (
                <option key={item.label} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <span className="settings-label">界面字号</span>
            <select
              className="settings-input settings-input-number"
              title="界面字号"
              value={draft.fontSize}
              onChange={(e) => handleNumberChange('fontSize', e.target.value)}
            >
              {UI_FONT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <span className="settings-unit">px</span>
          </div>
        </div>
        <div className="settings-group">
          <h4 className="settings-group-title">编辑器</h4>
          <div className="settings-row">
            <span className="settings-label">编辑器字体</span>
            <select
              className="settings-input"
              title="编辑器字体"
              value={draft.editorFontFamily}
              onChange={(e) => updateDraft('editorFontFamily', e.target.value)}
            >
              {EDITOR_FONT_OPTIONS.map((item) => (
                <option key={item.label} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <span className="settings-label">编辑器字号</span>
            <select
              className="settings-input settings-input-number"
              title="编辑器字号"
              value={draft.editorFontSize}
              onChange={(e) => handleNumberChange('editorFontSize', e.target.value)}
            >
              {EDITOR_FONT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <span className="settings-unit">px</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">编辑器行高</span>
            <select
              className="settings-input settings-input-number"
              title="编辑器行高"
              value={draft.editorLineHeight}
              onChange={(e) => handleNumberChange('editorLineHeight', e.target.value)}
            >
              {EDITOR_LINE_HEIGHT_OPTIONS.map((height) => (
                <option key={height} value={height}>{height}</option>
              ))}
            </select>
            <span className="settings-unit">px</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">子程序表头冻结（实验功能）</span>
            <label className="settings-switch" aria-label="子程序表头冻结">
              <input
                type="checkbox"
                className="settings-switch-input"
                checked={draft.editorFreezeSubTableHeader}
                onChange={(e) => updateDraft('editorFreezeSubTableHeader', e.target.checked)}
              />
              <span className="settings-switch-track" aria-hidden="true" />
            </label>
            <span className="settings-unit" />
          </div>
          <div className="settings-row">
            <span className="settings-label">代码预览区（缩略图）</span>
            <label className="settings-switch" aria-label="代码预览区">
              <input
                type="checkbox"
                className="settings-switch-input"
                checked={draft.editorShowMinimapPreview}
                onChange={(e) => updateDraft('editorShowMinimapPreview', e.target.checked)}
              />
              <span className="settings-switch-track" aria-hidden="true" />
            </label>
            <span className="settings-unit" />
          </div>
          <div className="settings-row">
            <span className="settings-label">变量汇总面板</span>
            <label className="settings-switch" aria-label="变量汇总面板">
              <input
                type="checkbox"
                className="settings-switch-input"
                checked={draft.editorShowVarSummaryPanel}
                onChange={(e) => updateDraft('editorShowVarSummaryPanel', e.target.checked)}
              />
              <span className="settings-switch-track" aria-hidden="true" />
            </label>
            <span className="settings-unit" />
          </div>
        </div>
        <div className="settings-group">
          <h4 className="settings-group-title">AI 助手</h4>
          <div className="settings-row">
            <span className="settings-label">AI 助手字体</span>
            <select
              className="settings-input"
              title="AI 助手字体"
              value={draft.aiFontFamily}
              onChange={(e) => updateDraft('aiFontFamily', e.target.value)}
            >
              {AI_FONT_OPTIONS.map((item) => (
                <option key={item.label} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <span className="settings-label">AI 助手字号</span>
            <select
              className="settings-input settings-input-number"
              title="AI 助手字号"
              value={draft.aiFontSize}
              onChange={(e) => handleNumberChange('aiFontSize', e.target.value)}
            >
              {AI_FONT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <span className="settings-unit">px</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">默认模型</span>
            <select
              className="settings-input"
              title="默认模型"
              value={draft.aiModel}
              onChange={(e) => updateDraft('aiModel', e.target.value as IDESettings['aiModel'])}
            >
              {AI_MODEL_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <span className="settings-unit" />
          </div>
          <div className="settings-row">
            <span className="settings-label">DeepSeek API Key</span>
            <input
              type="password"
              className="settings-input"
              title="DeepSeek API Key"
              value={draft.aiDeepseekApiKey}
              onChange={(e) => updateDraft('aiDeepseekApiKey', e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
            />
            <span className="settings-unit" />
          </div>
          <div className="settings-row">
            <span className="settings-label">GLM API Key</span>
            <input
              type="password"
              className="settings-input"
              title="GLM API Key"
              value={draft.aiGlmApiKey}
              onChange={(e) => updateDraft('aiGlmApiKey', e.target.value)}
              placeholder="glm-..."
              autoComplete="off"
            />
            <span className="settings-unit" />
          </div>
        </div>
        <div className="settings-group">
          <h4 className="settings-group-title">编译</h4>
          <div className="settings-row">
            <span className="settings-label">编译器路径</span>
            <input
              type="text"
              className="settings-input"
              title="Zig 编译器路径（zig.exe 或其所在目录）"
              value={draft.compilerZigPath}
              onChange={(e) => updateDraft('compilerZigPath', e.target.value)}
              placeholder="留空自动查找 IDE 目录下 compiler\zig"
              autoComplete="off"
            />
            <button
              type="button"
              className="settings-browse-btn"
              onClick={() => { void pickCompilerPath() }}
            >浏览…</button>
          </div>
          <div className="settings-row">
            <span className="settings-label">优化级别</span>
            <select
              className="settings-input"
              title="编译（生成可执行文件）时的优化级别；运行/调试始终用 O0 保证响应速度"
              value={draft.compilerOptimizeLevel}
              onChange={(e) => updateDraft('compilerOptimizeLevel', e.target.value as IDESettings['compilerOptimizeLevel'])}
            >
              <option value="O0">O0（不优化，编译最快）</option>
              <option value="O1">O1（轻度优化）</option>
              <option value="O2">O2（发布推荐）</option>
              <option value="Os">Os（优化体积）</option>
            </select>
            <span className="settings-unit" />
          </div>
        </div>

        <div className="settings-group">
          <h4 className="settings-group-title">Android 运行</h4>
          <div className="settings-row">
            <span className="settings-label">模拟器类型</span>
            <select
              className="settings-input"
              title="Android 模拟器类型"
              value={draft.androidEmulatorKind}
              onChange={(e) => updateDraft('androidEmulatorKind', e.target.value as IDESettings['androidEmulatorKind'])}
            >
              {ANDROID_EMULATOR_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <span className="settings-unit" />
          </div>
          <div className="settings-row">
            <span className="settings-label">Android SDK 路径</span>
            <input type="text" className="settings-input" title="Android SDK 路径" value={draft.androidSdkPath} onChange={(e) => updateDraft('androidSdkPath', e.target.value)} placeholder="C:\Users\用户名\AppData\Local\Android\Sdk" autoComplete="off" />
            <span className="settings-unit" />
          </div>
          <div className="settings-row">
            <span className="settings-label">ADB 路径</span>
            <input type="text" className="settings-input" title="ADB 路径" value={draft.androidAdbPath} onChange={(e) => updateDraft('androidAdbPath', e.target.value)} placeholder="留空则使用 SDK\\platform-tools\\adb.exe 或 PATH" autoComplete="off" />
            <span className="settings-unit" />
          </div>
          <div className="settings-row">
            <span className="settings-label">Gradle 路径</span>
            <input type="text" className="settings-input" title="Gradle 路径" value={draft.androidGradlePath} onChange={(e) => updateDraft('androidGradlePath', e.target.value)} placeholder="gradle 或 gradle.bat" autoComplete="off" />
            <span className="settings-unit" />
          </div>
          <div className="settings-row">
            <span className="settings-label">雷电启动程序</span>
            <input type="text" className="settings-input" title="雷电模拟器启动程序路径" value={draft.androidEmulatorExePath} onChange={(e) => updateDraft('androidEmulatorExePath', e.target.value)} placeholder="dnplayer.exe 或 dnconsole.exe" autoComplete="off" />
            <span className="settings-unit" />
          </div>
          <div className="settings-row">
            <span className="settings-label">启动参数</span>
            <input type="text" className="settings-input" title="模拟器启动参数" value={draft.androidEmulatorLaunchArgs} onChange={(e) => updateDraft('androidEmulatorLaunchArgs', e.target.value)} placeholder="可留空" autoComplete="off" />
            <span className="settings-unit" />
          </div>
          <div className="settings-row">
            <span className="settings-label">ADB 连接地址</span>
            <input type="text" className="settings-input" title="ADB 连接地址" value={draft.androidAdbConnectAddress} onChange={(e) => updateDraft('androidAdbConnectAddress', e.target.value)} placeholder="127.0.0.1:5555，可留空" autoComplete="off" />
            <span className="settings-unit" />
          </div>
          <div className="settings-row">
            <span className="settings-label">ADB 设备 ID</span>
            <input type="text" className="settings-input" title="ADB 设备 ID" value={draft.androidAdbDeviceId} onChange={(e) => updateDraft('androidAdbDeviceId', e.target.value)} placeholder="留空则自动选择第一个在线设备" autoComplete="off" />
            <span className="settings-unit" />
          </div>
          <div className="settings-row">
            <span className="settings-label">包名前缀</span>
            <input type="text" className="settings-input" title="Android 包名前缀" value={draft.androidPackagePrefix} onChange={(e) => updateDraft('androidPackagePrefix', e.target.value)} placeholder="com.ycide.app" autoComplete="off" />
            <span className="settings-unit" />
          </div>
          <div className="settings-row">
            <span className="settings-label">compileSdk</span>
            <input type="number" className="settings-input settings-input-number" title="compileSdk" min={23} max={99} value={draft.androidCompileSdk} onChange={(e) => handleNumberChange('androidCompileSdk', e.target.value)} />
            <span className="settings-unit" />
          </div>
          <div className="settings-row">
            <span className="settings-label">AGP 版本</span>
            <input type="text" className="settings-input" title="Android Gradle Plugin 版本" value={draft.androidGradlePluginVersion} onChange={(e) => updateDraft('androidGradlePluginVersion', e.target.value)} placeholder="8.5.2" autoComplete="off" />
            <span className="settings-unit" />
          </div>
          <div className="settings-row">
            <span className="settings-label">自动启动模拟器</span>
            <label className="settings-switch" aria-label="自动启动 Android 模拟器">
              <input type="checkbox" className="settings-switch-input" checked={draft.androidAutoStartEmulator} onChange={(e) => updateDraft('androidAutoStartEmulator', e.target.checked)} />
              <span className="settings-switch-track" aria-hidden="true" />
            </label>
            <span className="settings-unit" />
          </div>
        </div>
        <div className="settings-group">
          <h4 className="settings-group-title">支持库</h4>
          <div className="settings-row">
            <span className="settings-label">在线索引地址</span>
            <input
              type="url"
              className="settings-input"
              title="在线索引地址"
              value={draft.libraryStoreIndexUrl}
              onChange={(e) => updateDraft('libraryStoreIndexUrl', e.target.value)}
              placeholder="https://ycide.dev/libraries/index.json"
              autoComplete="off"
            />
            <span className="settings-unit" />
          </div>
        </div>
      </div>
      <footer className="settings-footer">
        <button type="button" className="settings-btn" onClick={handleReset}>恢复默认</button>
        <button type="button" className="settings-btn" onClick={handleCancel}>取消</button>
        <button type="button" className="settings-btn settings-btn-primary" onClick={handleSubmit}>确定</button>
      </footer>
    </div>
  )
}

export default SettingsDialog
