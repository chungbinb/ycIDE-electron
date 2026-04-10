import './ThemeSettingsDialog.css'
import { THEME_TOKEN_GROUPS, type ThemeTokenGroupId } from '../../../../shared/theme-tokens'

const SYNTAX_EXTRA_LABELS = ['预定义', '常量', '标识符', '分隔符']

interface ThemeSettingsDialogProps {
  open: boolean
  onClose: () => void
  themes: string[]
  currentTheme: string
  onSelectTheme: (themeId: string) => void
  repairMessage?: string | null
  tokenValues?: Record<string, string>
  onTokenChange?: (tokenKey: string, value: string) => void
  onResetToken?: (groupId: ThemeTokenGroupId, tokenKey: string) => void
  onResetGroup?: (groupId: ThemeTokenGroupId) => void
  onResetAll?: () => void
}

function ThemeSettingsDialog({
  open,
  onClose,
  themes,
  currentTheme,
  onSelectTheme,
  repairMessage = null,
  tokenValues = {},
  onTokenChange,
  onResetToken,
  onResetGroup,
  onResetAll,
}: ThemeSettingsDialogProps): React.JSX.Element | null {
  if (!open) return null

  return (
    <div className="theme-settings-overlay" onMouseDown={onClose}>
      <div className="theme-settings-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="theme-settings-header">
          <span className="theme-settings-title">系统配置</span>
          <button className="theme-settings-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="theme-settings-body">
          <div className="theme-settings-section-title">主题方案</div>
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
          <div className="theme-settings-groups" role="region" aria-label="主题令牌分组">
            {THEME_TOKEN_GROUPS.map(group => (
              <section key={group.id} className="theme-settings-group">
                <header className="theme-settings-group-header">
                  <h3 className="theme-settings-group-title">{group.label}</h3>
                  <button
                    type="button"
                    className="theme-settings-reset-btn"
                    onClick={() => onResetGroup?.(group.id)}
                  >
                    重置本组
                  </button>
                </header>
                {group.id === 'syntax' && (
                  <div className="theme-settings-syntax-hint">
                    关键字 · 注释 · 字符串 · 类型 · {SYNTAX_EXTRA_LABELS.join(' · ')} · 运算符
                  </div>
                )}
                <div className="theme-settings-token-list">
                  {group.items.map(item => (
                    <div key={item.id} className="theme-settings-token-row">
                      <span className="theme-settings-token-label">{item.label}</span>
                      <span
                        className="theme-settings-preview-chip"
                        style={{ backgroundColor: tokenValues[item.tokenKey] || '#000000' }}
                        aria-hidden
                      />
                      <input
                        type="color"
                        className="theme-settings-color-input"
                        value={tokenValues[item.tokenKey] || '#000000'}
                        aria-label={`${group.label}-${item.label}`}
                        onChange={(event) => onTokenChange?.(item.tokenKey, event.target.value)}
                      />
                      <button
                        type="button"
                        className="theme-settings-reset-btn"
                        onClick={() => onResetToken?.(group.id, item.tokenKey)}
                      >
                        重置
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
          {repairMessage && (
            <div className="theme-settings-repair" role="status">
              {repairMessage}
            </div>
          )}
        </div>
        <div className="theme-settings-footer">
          <button type="button" className="theme-settings-btn" onClick={() => onResetAll?.()}>恢复全部默认</button>
          <button type="button" className="theme-settings-btn" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}

export default ThemeSettingsDialog
