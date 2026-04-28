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
        </div>
        <div className="settings-group">
          <h4 className="settings-group-title">AI 助手</h4>
          <div className="settings-row">
            <span className="settings-label">AI 助手字体</span>
            <select
              className="settings-input"
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
              value={draft.aiGlmApiKey}
              onChange={(e) => updateDraft('aiGlmApiKey', e.target.value)}
              placeholder="glm-..."
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
