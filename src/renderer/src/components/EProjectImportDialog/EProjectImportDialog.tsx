import { useEffect, useId, useRef, useState } from 'react'
import type { EProjectImportConflictAction } from '../../../../shared/eprojectImport'
import './EProjectImportDialog.css'

export type EProjectImportDialogSubmit = {
  password?: string
  conflictAction?: EProjectImportConflictAction
}

type EProjectImportDialogProps = {
  open: boolean
  projectName: string
  targetDir: string
  targetExists: boolean
  needsPassword: boolean
  passwordInvalid: boolean
  passwordHint?: string
  busy: boolean
  error?: string
  onSubmit: (value: EProjectImportDialogSubmit) => void
  onCancel: () => void
}

function EProjectImportDialog({
  open,
  projectName,
  targetDir,
  targetExists,
  needsPassword,
  passwordInvalid,
  passwordHint,
  busy,
  error,
  onSubmit,
  onCancel,
}: EProjectImportDialogProps): React.JSX.Element | null {
  const [password, setPassword] = useState('')
  const [conflictAction, setConflictAction] = useState<EProjectImportConflictAction>('reuse')
  const dialogRef = useRef<HTMLDivElement>(null)
  const lastFocusedRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  const passwordId = useId()

  useEffect(() => {
    if (!open) return
    setPassword('')
    setConflictAction('reuse')
    lastFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    window.setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>('input, button:not([disabled])')
      first?.focus()
    }, 0)
    return () => {
      lastFocusedRef.current?.focus()
    }
  }, [open, projectName, targetDir])

  if (!open) return null

  const canSubmit = !busy && (!needsPassword || password.length > 0)
  const submit = (): void => {
    if (!canSubmit) return
    onSubmit({
      password: needsPassword ? password : undefined,
      conflictAction: targetExists ? conflictAction : undefined,
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!busy) onCancel()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
      return
    }
    if (event.key !== 'Tab') return
    const root = dialogRef.current
    if (!root) return
    const focusable = root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const current = document.activeElement
    if (event.shiftKey && current === first) {
      event.preventDefault()
      last.focus()
      return
    }
    if (!event.shiftKey && current === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="eimport-overlay" onMouseDown={() => { if (!busy) onCancel() }}>
      <div
        ref={dialogRef}
        className="eimport-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="eimport-header">
          <span id={titleId} className="eimport-title">导入易语言项目</span>
          <button type="button" className="eimport-close" onClick={onCancel} disabled={busy} aria-label="取消导入">&times;</button>
        </div>
        <div className="eimport-body">
          <p id={descriptionId} className="eimport-text">{projectName}</p>
          <div className="eimport-path" title={targetDir}>{targetDir}</div>

          {targetExists && (
            <div className="eimport-section">
              <span className="eimport-label">目标目录已存在</span>
              <div className="eimport-choice-row" aria-label="导入目录处理方式">
                <button
                  type="button"
                  className={`eimport-choice ${conflictAction === 'reuse' ? 'selected' : ''}`}
                  aria-label="复用现有导入目录"
                  onClick={() => setConflictAction('reuse')}
                  disabled={busy}
                >复用</button>
                <button
                  type="button"
                  className={`eimport-choice ${conflictAction === 'overwrite' ? 'selected' : ''}`}
                  aria-label="覆盖现有导入目录"
                  onClick={() => setConflictAction('overwrite')}
                  disabled={busy}
                >覆盖</button>
              </div>
            </div>
          )}

          {needsPassword && (
            <div className="eimport-section">
              <label className="eimport-label" htmlFor={passwordId}>项目密码</label>
              {passwordHint && <div className="eimport-hint">提示：{passwordHint}</div>}
              <input
                id={passwordId}
                className="eimport-input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby={passwordInvalid ? `${passwordId}-error` : undefined}
                disabled={busy}
              />
              {passwordInvalid && <div id={`${passwordId}-error`} className="eimport-alert" role="alert">密码不正确，请重新输入。</div>}
            </div>
          )}

          {error && <div className="eimport-alert" role="alert">{error}</div>}
        </div>
        <div className="eimport-footer">
          <button type="button" className="eimport-btn eimport-btn-primary" onClick={submit} disabled={!canSubmit} aria-label="开始导入">
            {busy ? '导入中...' : '导入'}
          </button>
          <button type="button" className="eimport-btn eimport-btn-secondary" onClick={onCancel} disabled={busy} aria-label="取消导入">取消</button>
        </div>
      </div>
    </div>
  )
}

export default EProjectImportDialog
