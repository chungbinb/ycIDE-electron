import './ThemeSettingsDialog.css'
import { useEffect, useState } from 'react'
import {
  DEFAULT_FLOW_LINE_MODE_CONFIG,
  THEME_TOKEN_GROUPS,
  type FlowLineMode,
  type FlowLineModeConfig,
  type FlowLineMultiConfig,
  type ThemeTokenGroupId
} from '../../../../shared/theme-tokens'

const SYNTAX_EXTRA_LABELS = ['预定义', '常量', '标识符', '分隔符']

interface ThemeSettingsDialogProps {
  open: boolean
  onClose: (intent: 'close-button' | 'overlay' | 'escape') => void
  themes: string[]
  currentTheme: string
  onSelectTheme: (themeId: string) => void
  repairMessage?: string | null
  tokenValues?: Record<string, string>
  onTokenChange?: (tokenKey: string, value: string) => void
  flowLineConfig?: FlowLineModeConfig
  onFlowLineModeChange?: (mode: FlowLineMode) => void
  onFlowLineMainColorChange?: (value: string) => void
  onFlowLineDepthStepChange?: (key: keyof FlowLineMultiConfig, value: number) => void
  onResetToken?: (groupId: ThemeTokenGroupId, tokenKey: string) => void
  onResetGroup?: (groupId: ThemeTokenGroupId) => void
  onResetAll?: () => void
  onSaveAsCustom?: (name: string) => Promise<{ success: boolean; message?: string }>
  saveFeedback?: string | null
  canUndo?: boolean
  onUndo?: () => void
  onRestoreBaseline?: () => void
  onOpenThemeManager?: () => void
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
  flowLineConfig = DEFAULT_FLOW_LINE_MODE_CONFIG,
  onFlowLineModeChange,
  onFlowLineMainColorChange,
  onFlowLineDepthStepChange,
  onResetToken,
  onResetGroup,
  onResetAll,
  onSaveAsCustom,
  saveFeedback = null,
  canUndo = false,
  onUndo,
  onRestoreBaseline,
  onOpenThemeManager,
}: ThemeSettingsDialogProps): React.JSX.Element | null {
  const [customThemeName, setCustomThemeName] = useState('')
  const [savingCustomTheme, setSavingCustomTheme] = useState(false)
  const [localSaveFeedback, setLocalSaveFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setCustomThemeName('')
    setSavingCustomTheme(false)
    setLocalSaveFeedback(null)
  }, [open])

  useEffect(() => {
    setLocalSaveFeedback(saveFeedback)
  }, [saveFeedback])

  useEffect(() => {
    if (!open) return
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose('escape')
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [onClose, open])

  if (!open) return null
  const activeFlowLineMainColor = flowLineConfig.mode === 'multi'
    ? flowLineConfig.multi.mainColor
    : flowLineConfig.single.mainColor
  const handleSaveAsCustom = async () => {
    if (!onSaveAsCustom || savingCustomTheme) return
    setSavingCustomTheme(true)
    const result = await onSaveAsCustom(customThemeName)
    if (result.success) {
      setCustomThemeName('')
      setLocalSaveFeedback(null)
    } else if (result.message) {
      setLocalSaveFeedback(result.message)
    }
    setSavingCustomTheme(false)
  }

  return (
    <div className="theme-settings-overlay" onMouseDown={() => onClose('overlay')}>
      <div className="theme-settings-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="theme-settings-header">
          <span className="theme-settings-title">主题配置</span>
          <button className="theme-settings-close" onClick={() => onClose('close-button')} aria-label="关闭">×</button>
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
          <div className="theme-settings-history-actions" role="group" aria-label="草稿撤销操作">
            <button
              type="button"
              className="theme-settings-btn"
              disabled={!canUndo}
              title={canUndo ? '撤销最近一次改动' : '无可撤销改动'}
              onClick={onUndo}
            >
              撤销上一步
            </button>
            <button
              type="button"
              className="theme-settings-btn"
              disabled={!canUndo}
              title={canUndo ? '恢复到进入设置时状态' : '无可撤销改动'}
              onClick={onRestoreBaseline}
            >
              恢复会话基线
            </button>
            {!canUndo && <span className="theme-settings-history-hint">无可撤销改动</span>}
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
                {group.id === 'flow-line' && (
                  <div className="theme-settings-flow-line-controls">
                    <div className="theme-settings-flow-line-mode" role="radiogroup" aria-label="流程线模式">
                      <button
                        type="button"
                        className={`theme-settings-flow-mode-btn flow-line-mode-single ${flowLineConfig.mode === 'single' ? 'active' : ''}`}
                        role="radio"
                        aria-checked={flowLineConfig.mode === 'single'}
                        onClick={() => onFlowLineModeChange?.('single')}
                      >
                        单色模式
                      </button>
                      <button
                        type="button"
                        className={`theme-settings-flow-mode-btn flow-line-mode-multi ${flowLineConfig.mode === 'multi' ? 'active' : ''}`}
                        role="radio"
                        aria-checked={flowLineConfig.mode === 'multi'}
                        onClick={() => onFlowLineModeChange?.('multi')}
                      >
                        多色模式
                      </button>
                    </div>
                    <label className="theme-settings-flow-line-main">
                      <span className="theme-settings-token-label">当前主色</span>
                      <input
                        type="color"
                        className="theme-settings-color-input"
                        value={activeFlowLineMainColor}
                        aria-label="流程线-当前主色"
                        onChange={(event) => onFlowLineMainColorChange?.(event.target.value)}
                      />
                    </label>
                    <div className="theme-settings-flow-line-depth">
                      <label>
                        色相步进
                        <input
                          type="number"
                          value={flowLineConfig.multi.depthHueStep}
                          onChange={(event) => onFlowLineDepthStepChange?.('depthHueStep', Number(event.target.value))}
                          disabled={flowLineConfig.mode !== 'multi'}
                        />
                      </label>
                      <label>
                        饱和度步进
                        <input
                          type="number"
                          value={flowLineConfig.multi.depthSaturationStep}
                          onChange={(event) => onFlowLineDepthStepChange?.('depthSaturationStep', Number(event.target.value))}
                          disabled={flowLineConfig.mode !== 'multi'}
                        />
                      </label>
                      <label>
                        亮度步进
                        <input
                          type="number"
                          value={flowLineConfig.multi.depthLightnessStep}
                          onChange={(event) => onFlowLineDepthStepChange?.('depthLightnessStep', Number(event.target.value))}
                          disabled={flowLineConfig.mode !== 'multi'}
                        />
                      </label>
                    </div>
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
          <button type="button" className="theme-settings-btn" onClick={() => onOpenThemeManager?.()}>主题管理器</button>
          <button type="button" className="theme-settings-btn" onClick={() => onResetAll?.()}>恢复全部默认</button>
          <label className="theme-settings-save-custom">
            <span className="theme-settings-token-label">自定义主题名称</span>
            <input
              type="text"
              value={customThemeName}
              placeholder="手动输入主题名称"
              className="theme-settings-text-input"
              aria-label="自定义主题名称"
              onChange={(event) => {
                setCustomThemeName(event.target.value)
                if (localSaveFeedback) setLocalSaveFeedback(null)
              }}
            />
          </label>
          <button
            type="button"
            className="theme-settings-btn theme-settings-btn-primary"
            onClick={() => { void handleSaveAsCustom() }}
            disabled={savingCustomTheme}
          >
            保存为自定义主题
          </button>
          <button type="button" className="theme-settings-btn" onClick={() => onClose('close-button')}>关闭</button>
        </div>
        {localSaveFeedback && (
          <div className="theme-settings-save-feedback" role="status">
            {localSaveFeedback}
          </div>
        )}
      </div>
    </div>
  )
}

export default ThemeSettingsDialog
