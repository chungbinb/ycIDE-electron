import { useState, useEffect } from 'react'
import './MenuEditorDialog.css'

// 子夹（选项卡页）标题编辑器：扁平列表，插入/删除/上移/下移/改名。仿菜单编辑器但去掉层级。
// 值以换行分隔的标题字符串进出（与画布预览 props['子夹标题'] 及编译器一致）。
interface TabRow { id: string; title: string }
let tabRowSeq = 1
function newTabRowId(): string { return `tabrow_${tabRowSeq++}` }

interface ChildTabEditorDialogProps {
  titles: string
  controlName: string
  onSave: (titles: string) => void
  onClose: () => void
}

export default function ChildTabEditorDialog({ titles, controlName, onSave, onClose }: ChildTabEditorDialogProps): React.JSX.Element {
  const [rows, setRows] = useState<TabRow[]>(() =>
    (titles || '').split('\n').map(t => t.trim()).filter(Boolean).map(t => ({ id: newTabRowId(), title: t })))
  const [sel, setSel] = useState(0)
  const selRow: TabRow | undefined = rows[sel]

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const onTitleChange = (v: string): void => setRows(prev => prev.map((r, i) => (i === sel ? { ...r, title: v } : r)))
  const insertRow = (): void => {
    const row: TabRow = { id: newTabRowId(), title: `子夹${rows.length + 1}` }
    setRows(prev => { const n = [...prev]; n.splice(sel + 1, 0, row); return n })
    setSel(s => Math.min(s + 1, rows.length))
  }
  const deleteRow = (): void => {
    if (rows.length === 0) return
    setRows(prev => prev.filter((_, i) => i !== sel))
    setSel(s => Math.max(0, Math.min(s, rows.length - 2)))
  }
  const moveUp = (): void => {
    if (sel <= 0) return
    setRows(prev => { const n = [...prev];[n[sel - 1], n[sel]] = [n[sel], n[sel - 1]]; return n })
    setSel(s => s - 1)
  }
  const moveDown = (): void => {
    if (sel >= rows.length - 1) return
    setRows(prev => { const n = [...prev];[n[sel + 1], n[sel]] = [n[sel], n[sel + 1]]; return n })
    setSel(s => s + 1)
  }
  const save = (): void => onSave(rows.map(r => r.title.trim()).filter(Boolean).join('\n'))

  return (
    <div className="menued-overlay" onMouseDown={onClose}>
      <div className="menued-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="menued-header">
          <span className="menued-title">子夹管理 — {controlName}</span>
          <button type="button" className="menued-x" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="menued-props">
          <label className="menued-field">
            <span>子夹标题</span>
            <input type="text" value={selRow?.title ?? ''} disabled={!selRow}
              onChange={(e) => onTitleChange(e.target.value)} />
          </label>
        </div>

        <div className="menued-tools">
          <button type="button" onClick={moveUp} disabled={sel <= 0} title="上移">↑</button>
          <button type="button" onClick={moveDown} disabled={sel >= rows.length - 1} title="下移">↓</button>
          <span className="menued-tools-gap" />
          <button type="button" onClick={insertRow}>插入</button>
          <button type="button" onClick={deleteRow} disabled={rows.length === 0}>删除</button>
        </div>

        <div className="menued-list">
          {rows.map((r, i) => (
            <div
              key={r.id}
              className={`menued-row${i === sel ? ' menued-row-sel' : ''}`}
              onMouseDown={() => setSel(i)}
            >
              <span className="menued-rowtext">{i + 1}. {r.title || '(未命名)'}</span>
            </div>
          ))}
          {rows.length === 0 && <div className="menued-empty">还没有子夹，点「插入」添加。</div>}
        </div>

        <div className="menued-footer">
          <button type="button" className="menued-ok" onClick={save}>确定</button>
          <button type="button" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  )
}
