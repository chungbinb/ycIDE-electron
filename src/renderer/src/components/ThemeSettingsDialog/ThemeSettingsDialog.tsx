import './ThemeSettingsDialog.css'

interface ThemeSettingsDialogProps {
  open: boolean
  onClose: () => void
  themes: string[]
  currentTheme: string
  onSelectTheme: (themeId: string) => void
  repairMessage?: string | null
}

function ThemeSettingsDialog({ open, onClose, themes, currentTheme, onSelectTheme, repairMessage = null }: ThemeSettingsDialogProps): React.JSX.Element | null {
  if (!open) return null

  return (
    <div className="theme-settings-overlay" onMouseDown={onClose}>
      <div className="theme-settings-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="theme-settings-header">
          <span className="theme-settings-title">系统配置</span>
          <button className="theme-settings-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="theme-settings-body">
          <div className="theme-settings-section-title">主题</div>
          <div className="theme-settings-options" role="radiogroup" aria-label="主题列表">
            {themes.map(themeId => (
              <button
                key={themeId}
                type="button"
                className={`theme-settings-option ${currentTheme === themeId ? 'active' : ''}`}
                role="radio"
                aria-checked={currentTheme === themeId}
                onClick={() => onSelectTheme(themeId)}
              >
                {themeId}
              </button>
            ))}
          </div>
          {repairMessage && (
            <div className="theme-settings-repair" role="status">
              {repairMessage}
            </div>
          )}
        </div>
        <div className="theme-settings-footer">
          <button type="button" className="theme-settings-btn" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}

export default ThemeSettingsDialog
