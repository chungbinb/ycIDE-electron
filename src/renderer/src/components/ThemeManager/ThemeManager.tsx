import './ThemeManager.css'
import { useEffect, useMemo, useState } from 'react'

interface ThemeManagerActionResult {
  success: boolean
  message?: string
}

interface ThemeManagerProps {
  open: boolean
  themes: string[]
  currentTheme: string
  draftThemeId?: string | null
  hasUnsavedDraft?: boolean
  onClose: () => void
  onSelectTheme: (themeId: string) => Promise<void> | void
  onCreateFromCurrent: (name: string) => Promise<ThemeManagerActionResult>
  onRenameTheme: (themeId: string, newName: string) => Promise<ThemeManagerActionResult>
  onDeleteTheme: (themeId: string, confirmThemeName: string) => Promise<ThemeManagerActionResult>
  onExportTheme: (themeId: string) => Promise<ThemeManagerActionResult>
}

const BUILTIN_THEME_IDS = ['默认深色', '默认浅色']

function ThemeManager({
  open,
  themes,
  currentTheme,
  draftThemeId = null,
  hasUnsavedDraft = false,
  onClose,
  onSelectTheme,
  onCreateFromCurrent,
  onRenameTheme,
  onDeleteTheme,
  onExportTheme,
}: ThemeManagerProps): React.JSX.Element | null {
  const [selectedThemeId, setSelectedThemeId] = useState('')
  const [createName, setCreateName] = useState('')
  const [renameName, setRenameName] = useState('')
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const defaultTheme = themes.includes(currentTheme) ? currentTheme : (themes[0] || '')
    setSelectedThemeId(defaultTheme)
    setRenameName(defaultTheme)
    setDeleteConfirmName('')
    setCreateName('')
    setFeedback(null)
    setSubmitting(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    if (themes.includes(selectedThemeId)) return
    const fallbackTheme = themes.includes(currentTheme) ? currentTheme : (themes[0] || '')
    setSelectedThemeId(fallbackTheme)
  }, [currentTheme, open, selectedThemeId, themes])

  useEffect(() => {
    if (!selectedThemeId) return
    setRenameName(selectedThemeId)
    setDeleteConfirmName('')
  }, [selectedThemeId])

  const isBuiltinSelected = useMemo(() => BUILTIN_THEME_IDS.includes(selectedThemeId), [selectedThemeId])

  if (!open) return null

  const handleAction = async (
    action: () => Promise<ThemeManagerActionResult>,
    successReset?: () => void
  ) => {
    if (submitting) return
    setSubmitting(true)
    const result = await action()
    if (!result.success) {
      setFeedback(result.message || '操作失败，请重试。')
      setSubmitting(false)
      return
    }
    successReset?.()
    setFeedback(result.message || '操作成功。')
    setSubmitting(false)
  }

  const draftVisible = hasUnsavedDraft && !!draftThemeId

  return (
    <div className="theme-manager-overlay" onMouseDown={onClose}>
      <div className="theme-manager-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header className="theme-manager-header">
          <h2 className="theme-manager-title">主题管理器</h2>
          <button type="button" className="theme-manager-close" onClick={onClose} aria-label="关闭主题管理器">×</button>
        </header>
        <div className="theme-manager-body">
          <section className="theme-manager-list" aria-label="主题列表">
            {themes.map(themeId => {
              const isActive = themeId === currentTheme
              const isBuiltin = BUILTIN_THEME_IDS.includes(themeId)
              const isDraft = draftVisible && themeId === draftThemeId
              return (
                <button
                  key={themeId}
                  type="button"
                  className={`theme-manager-list-item ${selectedThemeId === themeId ? 'active' : ''}`}
                  onClick={() => setSelectedThemeId(themeId)}
                >
                  <span className="theme-manager-list-name">{themeId}</span>
                  <span className="theme-manager-list-tags">
                    {isActive && <span className="theme-manager-tag">当前</span>}
                    <span className="theme-manager-tag">{isBuiltin ? '内置' : '自定义'}</span>
                    {isDraft && <span className="theme-manager-tag theme-manager-tag-warning">未保存草稿</span>}
                  </span>
                </button>
              )
            })}
          </section>
          <section className="theme-manager-detail">
            <div className="theme-manager-detail-row">
              <span className="theme-manager-detail-label">主题名称</span>
              <strong>{selectedThemeId || '-'}</strong>
            </div>
            <div className="theme-manager-detail-row">
              <span className="theme-manager-detail-label">主题类型</span>
              <span>{isBuiltinSelected ? '内置主题（只读）' : '自定义主题'}</span>
            </div>
            {draftVisible && selectedThemeId === draftThemeId && (
              <div className="theme-manager-detail-draft" role="status">
                当前主题存在未保存草稿，请先保存或放弃后再关闭设置。
              </div>
            )}
            <div className="theme-manager-detail-actions">
              <button type="button" className="theme-manager-btn" onClick={() => { void onSelectTheme(selectedThemeId) }} disabled={!selectedThemeId || submitting}>
                设为当前
              </button>
              <button
                type="button"
                className="theme-manager-btn"
                onClick={() => {
                  void handleAction(() => onExportTheme(selectedThemeId))
                }}
                disabled={!selectedThemeId || submitting}
              >
                导出主题
              </button>
            </div>
            <label className="theme-manager-field">
              <span>从当前主题创建</span>
              <input
                type="text"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                className="theme-manager-input"
                aria-label="从当前主题创建"
                placeholder="输入新主题名称"
              />
            </label>
            <button
              type="button"
              className="theme-manager-btn theme-manager-btn-primary"
              onClick={() => {
                void handleAction(
                  () => onCreateFromCurrent(createName),
                  () => setCreateName('')
                )
              }}
              disabled={submitting}
            >
              从当前创建
            </button>
            <label className="theme-manager-field">
              <span>重命名主题</span>
              <input
                type="text"
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
                className="theme-manager-input"
                aria-label="重命名主题名称"
                disabled={isBuiltinSelected}
              />
            </label>
            <button
              type="button"
              className="theme-manager-btn"
              onClick={() => {
                void handleAction(() => onRenameTheme(selectedThemeId, renameName))
              }}
              disabled={!selectedThemeId || isBuiltinSelected || submitting}
            >
              重命名主题
            </button>
            <label className="theme-manager-field">
              <span>删除确认名称</span>
              <input
                type="text"
                value={deleteConfirmName}
                onChange={(event) => setDeleteConfirmName(event.target.value)}
                className="theme-manager-input"
                aria-label="删除确认名称"
                disabled={isBuiltinSelected}
                placeholder="输入完整主题名后删除"
              />
            </label>
            <button
              type="button"
              className="theme-manager-btn theme-manager-btn-danger"
              onClick={() => {
                if (!window.confirm(`确认删除主题“${selectedThemeId}”？该操作不可恢复。`)) return
                void handleAction(
                  () => onDeleteTheme(selectedThemeId, deleteConfirmName),
                  () => setDeleteConfirmName('')
                )
              }}
              disabled={!selectedThemeId || isBuiltinSelected || submitting}
            >
              删除主题
            </button>
          </section>
        </div>
        {feedback && (
          <div className="theme-manager-feedback" role="status">{feedback}</div>
        )}
      </div>
    </div>
  )
}

export default ThemeManager
