import { useState, useEffect } from 'react'
import type { MenuItemDef } from './VisualDesigner'
import './MenuEditorDialog.css'

// 编辑期用「扁平 + 层级」表示（仿易语言/VB6 菜单编辑器：一列按缩进显示，↑↓ 移动、←→ 改层级）
interface FlatRow {
  id: string
  name: string
  caption: string
  shortcut: string
  checked: boolean
  disabled: boolean
  visible: boolean
  separator: boolean
  level: number
  nameManual: boolean    // 名称是否被手动改过（false 时名称跟随标题）
  originalName: string   // 打开对话框时的原名称，用于保存时检测「改名」→ 同步源代码引用
}

let menuRowSeq = 1
function newRowId(): string { return `menurow_${menuRowSeq++}` }

function flattenMenu(items: MenuItemDef[] | undefined, level: number, out: FlatRow[]): void {
  for (const it of items || []) {
    out.push({
      id: newRowId(),
      name: it.name || '',
      caption: it.caption || '',
      shortcut: it.shortcut || '',
      checked: !!it.checked,
      disabled: !!it.disabled,
      visible: it.visible !== false,
      separator: !!it.separator,
      level,
      nameManual: true,          // 已存在项：视为手动过，改标题不再覆盖名称
      originalName: it.name || '',
    })
    if (it.children && it.children.length) flattenMenu(it.children, level + 1, out)
  }
}

// 扁平行 + 层级 → 菜单树（用栈按 level 组装，最后清理空 children）
function buildMenuTree(rows: FlatRow[]): MenuItemDef[] {
  const root: MenuItemDef[] = []
  const stack: Array<{ level: number; children: MenuItemDef[] }> = [{ level: -1, children: root }]
  for (const r of rows) {
    const item: MenuItemDef = r.separator
      ? { name: r.name || '', caption: '-', separator: true }
      : { name: r.name || '', caption: r.caption || '' }
    if (!r.separator) {
      if (r.shortcut) item.shortcut = r.shortcut
      if (r.checked) item.checked = true
      if (r.disabled) item.disabled = true
      if (!r.visible) item.visible = false
    }
    while (stack.length > 1 && stack[stack.length - 1].level >= r.level) stack.pop()
    stack[stack.length - 1].children.push(item)
    const kids: MenuItemDef[] = []
    item.children = kids
    stack.push({ level: r.level, children: kids })
  }
  const clean = (arr: MenuItemDef[]): void => {
    for (const it of arr) {
      if (it.children && it.children.length === 0) delete it.children
      else if (it.children) clean(it.children)
    }
  }
  clean(root)
  return root
}

// 名称校验：不能以数字开头（半角/全角）；非分隔条、非空名称之间不能重复。空名称允许（=无事件）。
function validateMenuName(name: string, rows: FlatRow[], selfIndex: number): string {
  const nm = (name || '').trim()
  if (!nm) return '名称不能为空'
  if (/^[0-9０-９]/.test(nm)) return '名称不能以数字开头'
  for (let i = 0; i < rows.length; i++) {
    if (i === selfIndex || rows[i].separator) continue
    if ((rows[i].name || '').trim() === nm) return '名称不能重复'
  }
  return ''
}

// 保存前整体校验，返回第一处错误 { index, error } 或 null
function findFirstMenuNameError(rows: FlatRow[]): { index: number; error: string } | null {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].separator) continue
    const err = validateMenuName(rows[i].name, rows, i)
    if (err) return { index: i, error: `第 ${i + 1} 项「${rows[i].caption || rows[i].name || ''}」：${err}` }
  }
  return null
}

interface MenuEditorDialogProps {
  menu?: MenuItemDef[]
  formName: string
  onSave: (menu: MenuItemDef[], renames: Array<{ oldName: string; newName: string }>) => void
  onClose: () => void
}

export default function MenuEditorDialog({ menu, formName, onSave, onClose }: MenuEditorDialogProps): React.JSX.Element {
  const [rows, setRows] = useState<FlatRow[]>(() => { const out: FlatRow[] = []; flattenMenu(menu, 0, out); return out })
  const [sel, setSel] = useState(0)
  const [saveError, setSaveError] = useState('')
  const selRow: FlatRow | undefined = rows[sel]
  const selNameError = selRow && !selRow.separator ? validateMenuName(selRow.name, rows, sel) : ''

  // Esc 关闭（相当于取消）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const patchSel = (patch: Partial<FlatRow>): void => {
    setSaveError('')
    setRows(prev => prev.map((r, i) => (i === sel ? { ...r, ...patch } : r)))
  }
  // 标题变化：名称未手动改过时跟随标题一起变
  const onCaptionChange = (v: string): void => {
    setSaveError('')
    setRows(prev => prev.map((r, i) => (i === sel ? { ...r, caption: v, name: r.nameManual ? r.name : v } : r)))
  }
  // 名称手动变化：标记为已手动，之后改标题不再覆盖名称
  const onNameChange = (v: string): void => {
    setSaveError('')
    setRows(prev => prev.map((r, i) => (i === sel ? { ...r, name: v, nameManual: true } : r)))
  }
  const insertRow = (): void => {
    const level = selRow ? selRow.level : 0
    const row: FlatRow = { id: newRowId(), name: '新建菜单项', caption: '新建菜单项', shortcut: '', checked: false, disabled: false, visible: true, separator: false, level, nameManual: false, originalName: '' }
    setRows(prev => { const next = [...prev]; next.splice(sel + 1, 0, row); return next })
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
  const promote = (): void => { if (selRow && selRow.level > 0) patchSel({ level: selRow.level - 1 }) }
  const demote = (): void => {
    // 只能比上一行最多深一级（否则出现跳级的非法子菜单）
    if (!selRow || sel === 0) return
    if (selRow.level <= rows[sel - 1].level) patchSel({ level: selRow.level + 1 })
  }
  const save = (): void => {
    const err = findFirstMenuNameError(rows)
    if (err) { setSaveError(err.error); setSel(err.index); return }
    // 检测改名：原名称非空、且与新名称不同 → 需要同步源代码里的 _名_被选择 引用
    const renames: Array<{ oldName: string; newName: string }> = []
    for (const r of rows) {
      if (r.separator) continue
      const oldNm = (r.originalName || '').trim()
      const newNm = (r.name || '').trim()
      if (oldNm && newNm && oldNm !== newNm) renames.push({ oldName: oldNm, newName: newNm })
    }
    onSave(buildMenuTree(rows), renames)
  }

  const canDemote = !!selRow && sel > 0 && selRow.level <= rows[sel - 1].level

  return (
    <div className="menued-overlay" onMouseDown={onClose}>
      <div className="menued-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="menued-header">
          <span className="menued-title">菜单编辑器 — {formName}</span>
          <button type="button" className="menued-x" onClick={onClose} aria-label="关闭">×</button>
        </div>

        {/* 属性栏 */}
        <div className="menued-props">
          <label className="menued-field">
            <span>标题</span>
            <input type="text" value={selRow?.caption ?? ''} disabled={!selRow || selRow.separator}
              onChange={(e) => onCaptionChange(e.target.value)} />
          </label>
          <label className="menued-field">
            <span>名称</span>
            <input type="text" className={selNameError ? 'menued-input-error' : ''} value={selRow?.name ?? ''} disabled={!selRow || selRow.separator}
              onChange={(e) => onNameChange(e.target.value)} />
            {selNameError ? <span className="menued-field-err">{selNameError}</span> : null}
          </label>
          <label className="menued-field">
            <span>快捷键</span>
            <input type="text" value={selRow?.shortcut ?? ''} disabled={!selRow || selRow.separator} placeholder="如 Ctrl+S"
              onChange={(e) => patchSel({ shortcut: e.target.value })} />
          </label>
          <div className="menued-checks">
            <label><input type="checkbox" checked={!!selRow?.separator} disabled={!selRow}
              onChange={(e) => patchSel({ separator: e.target.checked })} />分隔条</label>
            <label><input type="checkbox" checked={!!selRow?.checked} disabled={!selRow || selRow.separator}
              onChange={(e) => patchSel({ checked: e.target.checked })} />选中</label>
            <label><input type="checkbox" checked={!!selRow?.disabled} disabled={!selRow || selRow.separator}
              onChange={(e) => patchSel({ disabled: e.target.checked })} />禁止</label>
            <label><input type="checkbox" checked={selRow ? selRow.visible : true} disabled={!selRow || selRow.separator}
              onChange={(e) => patchSel({ visible: e.target.checked })} />可视</label>
          </div>
        </div>

        {/* 移动/层级工具 */}
        <div className="menued-tools">
          <button type="button" onClick={promote} disabled={!selRow || selRow.level === 0} title="升级">←</button>
          <button type="button" onClick={demote} disabled={!canDemote} title="降为子菜单">→</button>
          <button type="button" onClick={moveUp} disabled={sel <= 0} title="上移">↑</button>
          <button type="button" onClick={moveDown} disabled={sel >= rows.length - 1} title="下移">↓</button>
          <span className="menued-tools-gap" />
          <button type="button" onClick={insertRow}>插入</button>
          <button type="button" onClick={deleteRow} disabled={rows.length === 0}>删除</button>
        </div>

        {/* 菜单项列表（按层级缩进显示） */}
        <div className="menued-list">
          {rows.map((r, i) => (
            <div
              key={r.id}
              className={`menued-row${i === sel ? ' menued-row-sel' : ''}${r.disabled ? ' menued-row-disabled' : ''}`}
              onMouseDown={() => setSel(i)}
            >
              <span className="menued-rowtext">
                {'····'.repeat(r.level)}
                {r.separator ? '——————' : (r.caption || '(未命名)')}
                {!r.separator && r.checked ? ' ✓' : ''}
                {!r.separator && r.visible === false ? ' (隐藏)' : ''}
              </span>
              {!r.separator && r.shortcut ? <span className="menued-rowshortcut">{r.shortcut}</span> : null}
            </div>
          ))}
          {rows.length === 0 && <div className="menued-empty">还没有菜单项，点「插入」添加。</div>}
        </div>

        <div className="menued-footer">
          {saveError ? <span className="menued-saveerr">{saveError}</span> : null}
          <button type="button" className="menued-ok" onClick={save}>确定</button>
          <button type="button" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  )
}
