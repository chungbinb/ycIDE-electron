import './ThemeManager.css'
import { useEffect, useMemo, useState } from 'react'
import type {
  ThemeDefinition,
  ThemeImportConflictDecision,
  ThemeImportValidationDiagnostic
} from '../../../../shared/theme'

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
  onImportThemePrepare: () => Promise<
    | { status: 'canceled' }
    | { status: 'invalid'; diagnostics: ThemeImportValidationDiagnostic[] }
    | { status: 'conflict'; importedTheme: ThemeDefinition; existingThemeId: string; allowedDecisions: ThemeImportConflictDecision['decision'][] }
    | { status: 'ready'; importedTheme: ThemeDefinition; targetThemeId: string }
  >
  onImportThemeCommit: (request: { importedTheme: ThemeDefinition; decision?: ThemeImportConflictDecision }) => Promise<{
    success: boolean
    importedThemeId?: string
    message?: string
  }>
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
  onImportThemePrepare,
  onImportThemeCommit,
}: ThemeManagerProps): React.JSX.Element | null {
  const [selectedThemeId, setSelectedThemeId] = useState('')
  const [createName, setCreateName] = useState('')
  const [renameName, setRenameName] = useState('')
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [importPreview, setImportPreview] = useState<
    | null
    | { status: 'invalid'; diagnostics: ThemeImportValidationDiagnostic[] }
    | { status: 'conflict'; importedTheme: ThemeDefinition; existingThemeId: string; allowedDecisions: ThemeImportConflictDecision['decision'][] }
    | { status: 'ready'; importedTheme: ThemeDefinition; targetThemeId: string }
  >(null)
  const [importDecision, setImportDecision] = useState<ThemeImportConflictDecision['decision'] | ''>('')
  const [importRenameName, setImportRenameName] = useState('')
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false)
  const [switchNowThemeId, setSwitchNowThemeId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const defaultTheme = themes.includes(currentTheme) ? currentTheme : (themes[0] || '')
    setSelectedThemeId(defaultTheme)
    setRenameName(defaultTheme)
    setDeleteConfirmName('')
    setCreateName('')
    setFeedback(null)
    setSubmitting(false)
    setImportPreview(null)
    setImportDecision('')
    setImportRenameName('')
    setOverwriteConfirmed(false)
    setSwitchNowThemeId(null)
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
  const canSubmitImport = !!importPreview
    && importPreview.status !== 'invalid'
    && (
      importPreview.status === 'ready'
      || (
        importPreview.status === 'conflict'
        && (
          (importDecision === 'rename-import' && !!importRenameName.trim())
          || (importDecision === 'overwrite' && overwriteConfirmed)
        )
      )
    )

  const handleImportPrepare = async () => {
    if (submitting) return
    setSubmitting(true)
    const result = await onImportThemePrepare()
    if (result.status === 'canceled') {
      setFeedback('已取消导入。')
      setImportPreview(null)
      setImportDecision('')
      setImportRenameName('')
      setOverwriteConfirmed(false)
      setSubmitting(false)
      return
    }
    if (result.status === 'invalid') {
      setImportPreview(result)
      setFeedback('导入失败：存在无效字段，请修复后重试。')
      setImportDecision('')
      setImportRenameName('')
      setOverwriteConfirmed(false)
      setSubmitting(false)
      return
    }
    if (result.status === 'conflict') {
      setImportPreview(result)
      setFeedback(`检测到同名主题“${result.existingThemeId}”，请选择处理策略。`)
      setImportDecision('')
      setImportRenameName(result.importedTheme.name)
      setOverwriteConfirmed(false)
      setSubmitting(false)
      return
    }
    setImportPreview(result)
    setFeedback(`已就绪：将导入主题“${result.targetThemeId}”。`)
    setImportDecision('')
    setImportRenameName(result.targetThemeId)
    setOverwriteConfirmed(false)
    setSubmitting(false)
  }

  const handleImportCommit = async () => {
    if (!canSubmitImport || !importPreview || importPreview.status === 'invalid' || submitting) return
    const request: { importedTheme: ThemeDefinition; decision?: ThemeImportConflictDecision } = {
      importedTheme: importPreview.importedTheme,
    }
    if (importPreview.status === 'conflict') {
      if (importDecision === 'rename-import') {
        request.decision = {
          decision: 'rename-import',
          newThemeName: importRenameName.trim(),
        }
      }
      if (importDecision === 'overwrite') {
        request.decision = {
          decision: 'overwrite',
          overwriteThemeId: importPreview.existingThemeId,
          overwriteConfirmed: true,
        }
      }
    }
    setSubmitting(true)
    const result = await onImportThemeCommit(request)
    if (!result.success || !result.importedThemeId) {
      setFeedback(result.message || '导入提交失败。')
      setSubmitting(false)
      return
    }
    setFeedback(result.message || `主题“${result.importedThemeId}”已导入。`)
    setImportPreview(null)
    setImportDecision('')
    setImportRenameName('')
    setOverwriteConfirmed(false)
    setSwitchNowThemeId(result.importedThemeId)
    setSubmitting(false)
  }

  const handleSwitchNowChoice = async (switchNow: boolean) => {
    const targetThemeId = switchNowThemeId
    if (!targetThemeId) return
    if (switchNow) {
      await onSelectTheme(targetThemeId)
      setFeedback(`已导入并立即切换到“${targetThemeId}”。`)
    } else {
      setFeedback(`已导入主题“${targetThemeId}”，保持当前主题不变。`)
    }
    setSwitchNowThemeId(null)
  }

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
                onClick={() => { void handleImportPrepare() }}
                disabled={submitting}
              >
                导入主题
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
            {importPreview?.status === 'invalid' && (
              <div className="theme-manager-import-panel">
                <div className="theme-manager-import-title">导入错误明细</div>
                <ul className="theme-manager-diagnostics">
                  {importPreview.diagnostics.map((item, index) => (
                    <li key={`${item.path}-${index}`}>{item.path}: {item.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {(importPreview?.status === 'conflict' || importPreview?.status === 'ready') && (
              <div className="theme-manager-import-panel">
                <div className="theme-manager-import-title">导入提交确认</div>
                {importPreview.status === 'conflict' && (
                  <>
                    <label className="theme-manager-radio">
                      <input
                        type="radio"
                        name="theme-import-decision"
                        checked={importDecision === 'rename-import'}
                        onChange={() => setImportDecision('rename-import')}
                      />
                      重命名导入
                    </label>
                    <label className="theme-manager-radio">
                      <input
                        type="radio"
                        name="theme-import-decision"
                        checked={importDecision === 'overwrite'}
                        onChange={() => setImportDecision('overwrite')}
                      />
                      覆盖现有主题
                    </label>
                    {importDecision === 'rename-import' && (
                      <label className="theme-manager-field">
                        <span>新主题名称</span>
                        <input
                          type="text"
                          value={importRenameName}
                          onChange={(event) => setImportRenameName(event.target.value)}
                          className="theme-manager-input"
                        />
                      </label>
                    )}
                    {importDecision === 'overwrite' && (
                      <label className="theme-manager-checkbox">
                        <input
                          type="checkbox"
                          checked={overwriteConfirmed}
                          onChange={(event) => setOverwriteConfirmed(event.target.checked)}
                        />
                        我确认覆盖现有主题
                      </label>
                    )}
                  </>
                )}
                <button
                  type="button"
                  className="theme-manager-btn theme-manager-btn-primary"
                  onClick={() => { void handleImportCommit() }}
                  disabled={!canSubmitImport || submitting}
                >
                  确认导入
                </button>
              </div>
            )}
            {switchNowThemeId && (
              <div className="theme-manager-import-panel">
                <div className="theme-manager-import-title">导入成功，是否立即切换？</div>
                <div className="theme-manager-detail-actions">
                  <button type="button" className="theme-manager-btn theme-manager-btn-primary" onClick={() => { void handleSwitchNowChoice(true) }}>
                    立即切换
                  </button>
                  <button type="button" className="theme-manager-btn" onClick={() => { void handleSwitchNowChoice(false) }}>
                    保持当前
                  </button>
                </div>
              </div>
            )}
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
