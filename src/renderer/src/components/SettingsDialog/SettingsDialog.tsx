import './SettingsDialog.css'
import { useEffect, useState, useCallback } from 'react'
import { DEFAULT_IDE_SETTINGS, type IDESettings } from '../../../../shared/settings'

interface SettingsDialogProps {
  settings: IDESettings
  onClose: () => void
  onSave: (settings: IDESettings) => void
  onChange: (settings: IDESettings) => void
}

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
            <span className="settings-label">标题栏高度</span>
            <input
              type="number"
              className="settings-input settings-input-number"
              min={24}
              max={60}
              value={draft.titlebarHeight}
              onChange={(e) => handleNumberChange('titlebarHeight', e.target.value)}
            />
            <span className="settings-unit">px</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">工具栏高度</span>
            <input
              type="number"
              className="settings-input settings-input-number"
              min={24}
              max={60}
              value={draft.toolbarHeight}
              onChange={(e) => handleNumberChange('toolbarHeight', e.target.value)}
            />
            <span className="settings-unit">px</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">工具栏图标大小</span>
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
            <input
              type="text"
              className="settings-input"
              value={draft.fontFamily}
              onChange={(e) => updateDraft('fontFamily', e.target.value)}
            />
          </div>
          <div className="settings-row">
            <span className="settings-label">界面字号</span>
            <input
              type="number"
              className="settings-input settings-input-number"
              min={10}
              max={24}
              value={draft.fontSize}
              onChange={(e) => handleNumberChange('fontSize', e.target.value)}
            />
            <span className="settings-unit">px</span>
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
