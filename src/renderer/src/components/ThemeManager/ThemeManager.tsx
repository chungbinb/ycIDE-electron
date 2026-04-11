import './ThemeManager.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ThemeDefinition,
  ThemeImportConflictDecision,
  ThemeImportValidationDiagnostic
} from '../../../../shared/theme'
import {
  DEFAULT_FLOW_LINE_MODE_CONFIG,
  THEME_TOKEN_GROUPS,
  type FlowLineMode,
  type FlowLineModeConfig,
  type FlowLineMultiConfig,
  type ThemeTokenGroupId,
} from '../../../../shared/theme-tokens'

interface ThemeManagerActionResult {
  success: boolean
  message?: string
}

interface ThemeManagerProps {
  open: boolean
  detachedWindow?: boolean
  themes: string[]
  currentTheme: string
  draftThemeId?: string | null
  hasUnsavedDraft?: boolean
  tokenValues?: Record<string, string>
  flowLineConfig?: FlowLineModeConfig
  preserveToolbarIconOriginalColors?: boolean
  canUndo?: boolean
  onClose: () => void
  onSelectTheme: (themeId: string) => Promise<void> | void
  onApplyTheme: (themeId: string) => Promise<void> | void
  onTokenChange?: (tokenKey: string, value: string) => void
  onFlowLineModeChange?: (mode: FlowLineMode) => void
  onFlowLineMainColorChange?: (value: string) => void
  onFlowLineDepthStepChange?: (key: keyof FlowLineMultiConfig, value: number) => void
  onPreserveToolbarIconOriginalColorsChange?: (value: boolean) => void
  onResetToken?: (groupId: ThemeTokenGroupId, tokenKey: string) => void
  onResetGroup?: (groupId: ThemeTokenGroupId) => void
  onResetAll?: () => void
  onUndo?: () => void
  onRestoreBaseline?: () => void
  onDeleteTheme: (themeId: string, confirmThemeName: string) => Promise<ThemeManagerActionResult>
  onExportTheme: (themeId: string) => Promise<ThemeManagerActionResult>
  onSaveTheme: (themeId: string) => Promise<ThemeManagerActionResult>
  onSaveAsTheme: (sourceThemeId: string, name: string) => Promise<ThemeManagerActionResult>
  onRenameTheme: (themeId: string, newName: string) => Promise<ThemeManagerActionResult>
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
  detachedWindow = false,
  themes,
  currentTheme,
  draftThemeId = null,
  hasUnsavedDraft = false,
  tokenValues = {},
  flowLineConfig = DEFAULT_FLOW_LINE_MODE_CONFIG,
  preserveToolbarIconOriginalColors = false,
  canUndo = false,
  onClose,
  onSelectTheme,
  onApplyTheme,
  onTokenChange,
  onFlowLineModeChange,
  onFlowLineMainColorChange,
  onFlowLineDepthStepChange,
  onPreserveToolbarIconOriginalColorsChange,
  onResetToken,
  onResetGroup,
  onResetAll,
  onUndo,
  onRestoreBaseline,
  onExportTheme,
  onDeleteTheme,
  onSaveTheme,
  onSaveAsTheme,
  onRenameTheme,
  onImportThemePrepare,
  onImportThemeCommit,
}: ThemeManagerProps): React.JSX.Element | null {
  const TOOLBAR_ICON_TOKEN_KEYS = new Set(['--toolbar-icon-color', '--toolbar-icon-disabled-color'])
  const [selectedThemeId, setSelectedThemeId] = useState('')
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
  const [nameDialogMode, setNameDialogMode] = useState<'save' | null>(null)
  const [nameDialogValue, setNameDialogValue] = useState('')
  const [themeContextMenu, setThemeContextMenu] = useState<{ themeId: string; left: number; top: number } | null>(null)
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null)
  const [editingThemeName, setEditingThemeName] = useState('')
  const [dialogPosition, setDialogPosition] = useState<{ left: number; top: number } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const themeContextMenuRef = useRef<HTMLDivElement>(null)
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const defaultTheme = themes.includes(currentTheme) ? currentTheme : (themes[0] || '')
    setSelectedThemeId(defaultTheme)
    setFeedback(null)
    setSubmitting(false)
    setImportPreview(null)
    setImportDecision('')
    setImportRenameName('')
    setOverwriteConfirmed(false)
    setSwitchNowThemeId(null)
    setNameDialogMode(null)
    setNameDialogValue('')
    setThemeContextMenu(null)
    setEditingThemeId(null)
    setEditingThemeName('')
    setDialogPosition(null)
  }, [open, currentTheme, themes])

  useEffect(() => {
    if (!themeContextMenu) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && themeContextMenuRef.current?.contains(target)) return
      setThemeContextMenu(null)
    }
    const ownerDocument = dialogRef.current?.ownerDocument || document
    ownerDocument.addEventListener('mousedown', handlePointerDown, true)
    return () => ownerDocument.removeEventListener('mousedown', handlePointerDown, true)
  }, [themeContextMenu])

  useEffect(() => {
    if (!open) return
    if (selectedThemeId && themes.includes(selectedThemeId)) return
    const fallbackTheme = themes.includes(currentTheme) ? currentTheme : (themes[0] || '')
    if (selectedThemeId !== fallbackTheme) {
      setSelectedThemeId(fallbackTheme)
    }
  }, [currentTheme, open, selectedThemeId, themes])

  const isBuiltinSelected = useMemo(() => BUILTIN_THEME_IDS.includes(selectedThemeId), [selectedThemeId])
  const builtinThemes = useMemo(
    () => BUILTIN_THEME_IDS.filter(themeId => themes.includes(themeId)),
    [themes]
  )
  const customThemes = useMemo(
    () => themes.filter(themeId => !BUILTIN_THEME_IDS.includes(themeId)),
    [themes]
  )
  const orderedThemes = useMemo(
    () => [...builtinThemes, ...customThemes],
    [builtinThemes, customThemes]
  )

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
    if (!canSubmitImport || !importPreview || submitting) return
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

  const handleHeaderMouseDown = (event: React.MouseEvent<HTMLElement>) => {
    if (detachedWindow) return
    if ((event.target as HTMLElement).closest('.theme-manager-close')) return
    if (!dialogRef.current) return
    const rect = dialogRef.current.getBoundingClientRect()
    dragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
    const handleMove = (moveEvent: MouseEvent) => {
      const offset = dragOffsetRef.current
      if (!offset) return
      setDialogPosition({
        left: Math.max(12, moveEvent.clientX - offset.x),
        top: Math.max(12, moveEvent.clientY - offset.y),
      })
    }
    const handleUp = () => {
      dragOffsetRef.current = null
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }

  const openNameDialog = (mode: 'save') => {
    if (!selectedThemeId) {
      setFeedback('请先选择主题。')
      return
    }
    setNameDialogMode(mode)
    setNameDialogValue(selectedThemeId)
  }

  const handleNameDialogConfirm = async () => {
    const name = nameDialogValue.trim()
    if (!name) {
      setFeedback('请输入主题名称。')
      return
    }
    await handleAction(
      () => onSaveAsTheme(selectedThemeId, name),
      () => {
        setNameDialogMode(null)
        setNameDialogValue('')
      }
    )
  }

  const handleSaveThemeClick = () => {
    if (!selectedThemeId) {
      setFeedback('请先选择主题。')
      return
    }
    if (BUILTIN_THEME_IDS.includes(selectedThemeId)) {
      openNameDialog('save')
      return
    }
    void handleAction(() => onSaveTheme(selectedThemeId))
  }

  const handleThemeContextMenu = (event: React.MouseEvent, themeId: string) => {
    event.preventDefault()
    if (themeId) setSelectedThemeId(themeId)
    setThemeContextMenu({
      themeId,
      left: event.clientX,
      top: event.clientY,
    })
  }

  const openRenameEditor = (themeId: string) => {
    if (BUILTIN_THEME_IDS.includes(themeId)) {
      setFeedback('内置主题不可重命名。')
      setThemeContextMenu(null)
      return
    }
    setThemeContextMenu(null)
    setEditingThemeId(themeId)
    setEditingThemeName(themeId)
  }

  const handleContextImportTheme = async () => {
    setThemeContextMenu(null)
    await handleImportPrepare()
  }

  const handleContextExportTheme = () => {
    if (!themeContextMenu?.themeId) return
    const targetThemeId = themeContextMenu.themeId
    setThemeContextMenu(null)
    void handleAction(() => onExportTheme(targetThemeId))
  }

  const handleContextDeleteTheme = async () => {
    if (!themeContextMenu?.themeId) return
    const targetThemeId = themeContextMenu.themeId
    setThemeContextMenu(null)
    if (BUILTIN_THEME_IDS.includes(targetThemeId)) {
      setFeedback('内置主题不可删除。')
      return
    }
    const confirmed = window.confirm(`确定要删除主题"${targetThemeId}"吗？此操作不可撤销。`)
    if (!confirmed) return
    await handleAction(async () => {
      const result = await onDeleteTheme(targetThemeId, targetThemeId)
      if (result.success && selectedThemeId === targetThemeId) {
        setSelectedThemeId(currentTheme)
      }
      return result
    })
  }

  const cancelRenameEditor = () => {
    setEditingThemeId(null)
    setEditingThemeName('')
  }

  const commitRenameEditor = async () => {
    if (submitting) return
    if (!editingThemeId) return
    const sourceThemeId = editingThemeId
    const nextThemeId = editingThemeName.trim()

    if (!nextThemeId) {
      setFeedback('主题名称不能为空。')
      cancelRenameEditor()
      return
    }
    if (BUILTIN_THEME_IDS.includes(sourceThemeId)) {
      setFeedback('内置主题不可重命名。')
      cancelRenameEditor()
      return
    }
    if (nextThemeId === sourceThemeId) {
      cancelRenameEditor()
      return
    }
    if (themes.includes(nextThemeId)) {
      setFeedback('主题名称不可重复。')
      cancelRenameEditor()
      return
    }

    setSubmitting(true)
    const result = await onRenameTheme(sourceThemeId, nextThemeId)
    if (!result.success) {
      setFeedback(result.message || '重命名失败，请重试。')
      setSubmitting(false)
      cancelRenameEditor()
      return
    }
    setFeedback(result.message || '重命名成功。')
    setSelectedThemeId(nextThemeId)
    setSubmitting(false)
    cancelRenameEditor()
  }

  const activeFlowLineMainColor = flowLineConfig.mode === 'multi'
    ? flowLineConfig.multi.mainColor
    : flowLineConfig.single.mainColor

  return (
    <div
      className={`theme-manager-overlay${detachedWindow ? ' detached' : ''}`}
      onMouseDown={() => setThemeContextMenu(null)}
    >
      <div
        ref={dialogRef}
        className={`theme-manager-dialog${detachedWindow ? ' detached' : ''}`}
        onMouseDown={(event) => event.stopPropagation()}
        style={dialogPosition && !detachedWindow ? { left: `${dialogPosition.left}px`, top: `${dialogPosition.top}px`, position: 'fixed' } : undefined}
      >
        <header className="theme-manager-header" onMouseDown={handleHeaderMouseDown}>
          <h2 className="theme-manager-title">主题管理器</h2>
          <button type="button" className="theme-manager-close" onClick={onClose} aria-label="关闭主题管理器">×</button>
        </header>
        <div className="theme-manager-body">
          <section className="theme-manager-list" aria-label="主题列表" onContextMenu={(event) => { if (event.target === event.currentTarget) handleThemeContextMenu(event, '') }}>
            {orderedThemes.map((themeId, index) => {
              const isActive = themeId === currentTheme
              const isBuiltin = BUILTIN_THEME_IDS.includes(themeId)
              const isDraft = draftVisible && themeId === draftThemeId
              const isEditing = editingThemeId === themeId
              const showDivider = index === builtinThemes.length && customThemes.length > 0
              if (isEditing) {
                return (
                  <div key={themeId}>
                    {showDivider && <div className="theme-manager-list-divider" aria-hidden>---------</div>}
                    <div
                      className={`theme-manager-list-item editing ${selectedThemeId === themeId ? 'active' : ''}`}
                    >
                      <input
                        className="theme-manager-list-rename-input"
                        value={editingThemeName}
                        onChange={(event) => setEditingThemeName(event.target.value)}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={() => { void commitRenameEditor() }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            event.currentTarget.blur()
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            cancelRenameEditor()
                          }
                        }}
                        autoFocus
                      />
                      <span className="theme-manager-list-tags">
                        {isActive && <span className="theme-manager-tag">当前</span>}
                        <span className="theme-manager-tag">{isBuiltin ? '内置' : '自定义'}</span>
                        {isDraft && <span className="theme-manager-tag theme-manager-tag-warning">未保存草稿</span>}
                      </span>
                    </div>
                  </div>
                )
              }
              return (
                <div key={themeId}>
                  {showDivider && <div className="theme-manager-list-divider" aria-hidden>---------</div>}
                  <button
                    type="button"
                    className={`theme-manager-list-item ${selectedThemeId === themeId ? 'active' : ''}`}
                    onClick={() => {
                      setThemeContextMenu(null)
                      setSelectedThemeId(themeId)
                      void onSelectTheme(themeId)
                    }}
                    onContextMenu={(event) => handleThemeContextMenu(event, themeId)}
                  >
                    <span className="theme-manager-list-name">{themeId}</span>
                    <span className="theme-manager-list-tags">
                      {isActive && <span className="theme-manager-tag">当前</span>}
                      <span className="theme-manager-tag">{isBuiltin ? '内置' : '自定义'}</span>
                      {isDraft && <span className="theme-manager-tag theme-manager-tag-warning">未保存草稿</span>}
                    </span>
                  </button>
                </div>
              )
            })}
            {themeContextMenu && (
              <div
                ref={themeContextMenuRef}
                className="theme-manager-context-menu"
                style={{ left: `${themeContextMenu.left}px`, top: `${themeContextMenu.top}px` }}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="theme-manager-context-menu-item"
                  onClick={() => { void handleContextImportTheme() }}
                  disabled={submitting}
                >
                  导入主题
                </button>
                <button
                  type="button"
                  className="theme-manager-context-menu-item"
                  onClick={handleContextExportTheme}
                  disabled={!themeContextMenu.themeId || submitting}
                >
                  导出主题
                </button>
                <button
                  type="button"
                  className="theme-manager-context-menu-item"
                  onClick={() => openRenameEditor(themeContextMenu.themeId)}
                  disabled={!themeContextMenu.themeId || BUILTIN_THEME_IDS.includes(themeContextMenu.themeId) || submitting}
                >
                  重命名
                </button>
                <button
                  type="button"
                  className="theme-manager-context-menu-item"
                  onClick={() => { void handleContextDeleteTheme() }}
                  disabled={!themeContextMenu.themeId || BUILTIN_THEME_IDS.includes(themeContextMenu.themeId) || submitting}
                >
                  删除主题
                </button>
              </div>
            )}
          </section>
          <section className="theme-manager-detail">
            <div className="theme-manager-detail-row">
              <span className="theme-manager-detail-label">主题名称</span>
              <strong>{selectedThemeId || '-'}</strong>
            </div>
            <div className="theme-manager-detail-row">
              <span className="theme-manager-detail-label">主题类型</span>
              <span>{isBuiltinSelected ? '内置主题（修改时自动复制）' : '自定义主题'}</span>
            </div>
            {draftVisible && selectedThemeId === draftThemeId && (
              <div className="theme-manager-detail-draft" role="status">
                当前主题存在未保存草稿，请先保存或放弃后再关闭设置。
              </div>
            )}
            <div className="theme-manager-detail-actions">
              <button type="button" className="theme-manager-btn" onClick={() => { void onApplyTheme(selectedThemeId) }} disabled={!selectedThemeId || submitting}>
                设为当前
              </button>
              <button
                type="button"
                className="theme-manager-btn"
                onClick={handleSaveThemeClick}
                disabled={!selectedThemeId || submitting}
              >
                保存主题
              </button>
              <button type="button" className="theme-manager-btn" disabled={!canUndo} onClick={onUndo}>撤销上一步</button>
              <button type="button" className="theme-manager-btn" disabled={!canUndo} onClick={onRestoreBaseline}>恢复会话基线</button>
              <button type="button" className="theme-manager-btn" onClick={onResetAll}>恢复全部默认</button>
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
            <div className="theme-manager-editor" role="region" aria-label="主题配色编辑">
              {THEME_TOKEN_GROUPS.map(group => (
                <section key={group.id} className="theme-manager-group">
                  <header className="theme-manager-group-header">
                    <h3 className="theme-manager-group-title">{group.label}</h3>
                    <button type="button" className="theme-manager-btn" onClick={() => onResetGroup?.(group.id)}>重置本组</button>
                  </header>
                  {group.id === 'flow-line' && (
                    <div className="theme-manager-flow-controls">
                      <div className="theme-manager-detail-actions">
                        <button
                          type="button"
                          className={`theme-manager-btn ${flowLineConfig.mode === 'single' ? 'theme-manager-btn-primary' : ''}`}
                          onClick={() => onFlowLineModeChange?.('single')}
                        >
                          单色
                        </button>
                        <button
                          type="button"
                          className={`theme-manager-btn ${flowLineConfig.mode === 'multi' ? 'theme-manager-btn-primary' : ''}`}
                          onClick={() => onFlowLineModeChange?.('multi')}
                        >
                          多色
                        </button>
                      </div>
                      <div className="theme-manager-flow-row">
                        <span>主色</span>
                        <input type="color" value={activeFlowLineMainColor} onChange={(event) => onFlowLineMainColorChange?.(event.target.value)} />
                        <span>色相步进</span>
                        <input type="number" value={flowLineConfig.multi.depthHueStep} onChange={(event) => onFlowLineDepthStepChange?.('depthHueStep', Number(event.target.value))} disabled={flowLineConfig.mode !== 'multi'} />
                        <span>饱和度步进</span>
                        <input type="number" value={flowLineConfig.multi.depthSaturationStep} onChange={(event) => onFlowLineDepthStepChange?.('depthSaturationStep', Number(event.target.value))} disabled={flowLineConfig.mode !== 'multi'} />
                        <span>亮度步进</span>
                        <input type="number" value={flowLineConfig.multi.depthLightnessStep} onChange={(event) => onFlowLineDepthStepChange?.('depthLightnessStep', Number(event.target.value))} disabled={flowLineConfig.mode !== 'multi'} />
                      </div>
                    </div>
                  )}
                  {group.id !== 'flow-line' && (
                    <div className="theme-manager-token-list">
                      {group.id === 'base' && (
                        <label className="theme-manager-checkbox">
                          <input
                            type="checkbox"
                            checked={preserveToolbarIconOriginalColors}
                            onChange={(event) => onPreserveToolbarIconOriginalColorsChange?.(event.target.checked)}
                          />
                          保留原图标彩色（启用后禁用工具栏图标自定义颜色）
                        </label>
                      )}
                      {group.items.map(item => (
                        <div
                          key={item.id}
                          className={`theme-manager-token-row${group.id === 'base' && TOOLBAR_ICON_TOKEN_KEYS.has(item.tokenKey) && preserveToolbarIconOriginalColors ? ' theme-manager-token-row-disabled' : ''}`}
                        >
                          <span className="theme-manager-token-label">{item.label}</span>
                          <span className="theme-manager-preview-chip" style={{ backgroundColor: tokenValues[item.tokenKey] || '#000000' }} aria-hidden />
                          <input
                            type="color"
                            value={tokenValues[item.tokenKey] || '#000000'}
                            aria-label={`${group.label}-${item.label}`}
                            onChange={(event) => onTokenChange?.(item.tokenKey, event.target.value)}
                            disabled={group.id === 'base' && TOOLBAR_ICON_TOKEN_KEYS.has(item.tokenKey) && preserveToolbarIconOriginalColors}
                          />
                          <button
                            type="button"
                            className="theme-manager-btn"
                            onClick={() => onResetToken?.(group.id, item.tokenKey)}
                            disabled={group.id === 'base' && TOOLBAR_ICON_TOKEN_KEYS.has(item.tokenKey) && preserveToolbarIconOriginalColors}
                          >
                            重置
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>

            {nameDialogMode && (
              <div className="theme-manager-import-panel">
                <div className="theme-manager-import-title">
                  保存主题
                </div>
                <label className="theme-manager-field">
                  <span>主题名称</span>
                  <input
                    type="text"
                    value={nameDialogValue}
                    onChange={(event) => setNameDialogValue(event.target.value)}
                    className="theme-manager-input"
                    placeholder="请输入主题名称"
                    autoFocus
                  />
                </label>
                <div className="theme-manager-detail-actions">
                  <button
                    type="button"
                    className="theme-manager-btn theme-manager-btn-primary"
                    onClick={() => { void handleNameDialogConfirm() }}
                    disabled={submitting || !selectedThemeId}
                  >
                    确认保存
                  </button>
                  <button
                    type="button"
                    className="theme-manager-btn"
                    onClick={() => { setNameDialogMode(null); setNameDialogValue('') }}
                    disabled={submitting}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
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
