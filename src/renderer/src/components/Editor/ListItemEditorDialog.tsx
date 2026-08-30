import { useState, useEffect, useCallback } from 'react'
import './MenuEditorDialog.css'

interface ListItemRow { id: string; text: string }
let listItemRowSeq = 1
function newListItemRowId(): string { return `lirow_${listItemRowSeq++}` }

interface ListItemEditorDialogProps {
  mode: 'items' | 'values'
  value: string
  controlName: string
  controlType: string
  onSave: (value: string) => void
  onClose: () => void
}

/** 编辑选择列表框的“列表项目”或“项目数值”；两项独立保存。 */
export default function ListItemEditorDialog({ mode, value, controlName, controlType, onSave, onClose }: ListItemEditorDialogProps): React.JSX.Element {
  const isValues = mode === 'values'
  const [rows, setRows] = useState<ListItemRow[]>(() => {
    const parts = (value || '').split('\n').map(s => s.trim())
    const result: ListItemRow[] = []
    for (let i = 0; i < parts.length; i++) {
      if (i === parts.length - 1 && parts[i] === '') continue
      result.push({ id: newListItemRowId(), text: parts[i] })
    }
    return result
  })
  const [sel, setSel] = useState(0)
  const selRow = rows[sel]

  const insertBefore = useCallback((): void => {
    const row = { id: newListItemRowId(), text: '' }
    setRows(prev => { const next = [...prev]; next.splice(sel, 0, row); return next })
  }, [sel])
  const insertAfter = useCallback((): void => {
    const row = { id: newListItemRowId(), text: '' }
    setRows(prev => { const next = [...prev]; next.splice(sel + 1, 0, row); return next })
    setSel(current => current + 1)
  }, [sel])
  const deleteCurrent = useCallback((): void => {
    if (!rows.length) return
    setRows(prev => prev.filter((_, index) => index !== sel))
    setSel(current => Math.max(0, Math.min(current, rows.length - 2)))
  }, [rows.length, sel])
  const save = useCallback((): void => {
    onSave(rows.filter(row => row.text.trim() !== '').map(row => row.text.trim()).join('\n'))
  }, [onSave, rows])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const onTextChange = (text: string): void => setRows(prev => prev.map((row, index) => index === sel ? { ...row, text } : row))
  const title = isValues ? '项目数值' : '列表项目'
  const editLabel = `在此修改第 ${rows.length === 0 ? 0 : sel + 1} 项的${isValues ? '数值' : '内容'}：`

  return (
    <div className="menued-overlay" onMouseDown={onClose}>
      <div className="menued-dialog menued-dialog-list" onMouseDown={(event) => event.stopPropagation()}>
        <div className="menued-header">
          <span className="menued-title">{title} — {controlName}（{controlType}）</span>
          <button type="button" className="menued-x" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="menued-main">
          <div className="menued-list" tabIndex={0} aria-label={`${controlName}（${controlType}）的${title}`}>
            {rows.map((row, index) => (
              <div key={row.id} className={`menued-row${index === sel ? ' menued-row-sel' : ''}`} onMouseDown={(event) => { event.preventDefault(); setSel(index) }} title={row.text}>
                <span className="menued-rowtext">{index + 1}. {row.text || '(空)'}</span>
              </div>
            ))}
            {rows.length === 0 && <div className="menued-empty">还没有项目，点右侧按钮插入。</div>}
          </div>
          <div className="menued-sidebtns">
            <button type="button" className="menued-sidebtn menued-ok" onClick={save}>确定</button>
            <button type="button" className="menued-sidebtn" onClick={onClose}>取消</button>
            <div className="menued-sidebtns-gap" />
            <button type="button" className="menued-sidebtn" onClick={insertBefore}>向前插入空项目</button>
            <button type="button" className="menued-sidebtn" onClick={insertAfter}>向后插入空项目</button>
            <button type="button" className="menued-sidebtn" onClick={deleteCurrent} disabled={!rows.length}>删除当前项目</button>
          </div>
        </div>
        <div className="menued-props menued-listedit">
          <label className="menued-field">
            <span>{editLabel}</span>
            <input className="menued-listinput" type={isValues ? 'number' : 'text'} value={selRow?.text ?? ''} disabled={!selRow} onChange={(event) => onTextChange(event.target.value)} placeholder={isValues ? '数值' : '项目文本'} spellCheck={false} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); save() } }} />
          </label>
        </div>
      </div>
    </div>
  )
}
