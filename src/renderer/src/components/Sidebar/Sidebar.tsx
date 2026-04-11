import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type { DesignControl, DesignForm, SelectionTarget, LibWindowUnit, LibUnitProperty, LibUnitEvent } from '../Editor/VisualDesigner'
import Icon from '../Icon/Icon'
import '../Icon/Icon.css'
import './Sidebar.css'

type SidebarTab = 'project' | 'library' | 'property'

const TREE_ICON_MAP: Record<string, string> = {
  folder: 'folder-closed',
  'folder-expanded': 'folder-opened',
  module: 'module',
  class: 'class',
  sub: 'method',
  func: 'method',
  field: 'field',
  dll: 'dll',
  constant: 'constant',
  window: 'windows-form',
  resource: 'resource-view',
}

interface SidebarProps {
  width: number
  onResize: (width: number) => void
  selection?: SelectionTarget
  activeTab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  onSelectControl?: (target: SelectionTarget) => void
  onPropertyChange?: (targetKind: 'form' | 'control', controlId: string | null, propName: string, value: string | number | boolean) => void
  projectTree?: TreeNode[]
  onOpenFile?: (fileId: string, fileName: string, targetLine?: number) => void
  activeFileId?: string | null
  projectDir?: string
  onEventNavigate?: (selection: SelectionTarget, eventName: string, eventArgs: Array<{ name: string; description: string; dataType: string; isByRef: boolean }>) => void
  /** 支持库加载或卸载时的回调 */
  onLibraryChange?: () => void
}

interface LibItem {
  name: string
  filePath: string
  loaded: boolean
  libName?: string
  cmdCount?: number
  dtCount?: number
}

export interface TreeNode {
  id: string
  label: string
  type: 'folder' | 'module' | 'class' | 'sub' | 'func' | 'field' | 'dll' | 'constant' | 'window' | 'resource'
  children?: TreeNode[]
  expanded?: boolean
  // 子节点（如子程序）可指向其所属源码文件
  fileId?: string
  fileName?: string
}

function TreeItem({ node, depth = 0, onOpenFile, activeFileId }: { node: TreeNode; depth?: number; onOpenFile?: (fileId: string, fileName: string, targetLine?: number) => void; activeFileId?: string | null }): React.JSX.Element {
  const [expanded, setExpanded] = useState(node.expanded ?? false)
  const hasChildren = node.children && node.children.length > 0
  const declMatch = /^(.+)::(sub|global|const|dtype|dll)::(\d+)$/.exec(node.id)
  const ownerFile = declMatch?.[1]
  const lineIndex = declMatch ? Number.parseInt(declMatch[3], 10) : NaN
  const targetLine = Number.isFinite(lineIndex) ? lineIndex + 1 : undefined
  const openFileId = node.fileId || ownerFile || node.id
  const openFileName = node.fileName || ownerFile || node.label

  return (
    <li role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <div
        className={`tree-item ${hasChildren ? 'tree-branch' : 'tree-leaf'}${!hasChildren && activeFileId && activeFileId === openFileId ? ' tree-item-active' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => hasChildren && setExpanded(!expanded)}
        onDoubleClick={() => {
          if (node.type === 'module' && onOpenFile) {
            onOpenFile(openFileId, openFileName, targetLine)
          } else if (!hasChildren && onOpenFile) {
            onOpenFile(openFileId, openFileName, targetLine)
          }
        }}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (node.type === 'module' && onOpenFile) onOpenFile(openFileId, openFileName, targetLine)
            else if (hasChildren) setExpanded(!expanded)
            else if (onOpenFile) onOpenFile(openFileId, openFileName, targetLine)
          }
        }}
      >
        {hasChildren && (
          <span className={`tree-arrow ${expanded ? 'expanded' : ''}`} aria-hidden="true">▶</span>
        )}
        {!hasChildren && <span className="tree-arrow-placeholder" aria-hidden="true" />}
        <Icon preserveOriginalColors name={(node.type === 'folder' ? (expanded ? TREE_ICON_MAP['folder-expanded'] : TREE_ICON_MAP['folder']) : TREE_ICON_MAP[node.type]) || 'custom-control'} size={16} />
        <span className="tree-label">{node.label}</span>
      </div>
      {hasChildren && expanded && (
        <ul role="group">
          {node.children!.map((child) => (
            <TreeItem key={child.id} node={child} depth={depth + 1} onOpenFile={onOpenFile} activeFileId={activeFileId} />
          ))}
        </ul>
      )}
    </li>
  )
}

interface LibDetail {
  name: string
  version: string
  author: string
  description: string
  commands: Array<{ name: string; category: string; description: string; isHidden: boolean }>
  dataTypes: Array<{ name: string; description: string }>
}

function LibraryPanel(): React.JSX.Element {
  const [libs, setLibs] = useState<LibItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [expandedLibs, setExpandedLibs] = useState<Set<string>>(new Set())
  const [libDetails, setLibDetails] = useState<Record<string, LibDetail>>({})
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!loaded) {
      window.api.library.getList().then((list: LibItem[]) => {
        setLibs(list)
        setLoaded(true)
      })
    }
  }, [loaded])

  const toggleLib = useCallback(async (name: string) => {
    const next = new Set(expandedLibs)
    if (next.has(name)) {
      next.delete(name)
    } else {
      next.add(name)
      // 首次展开时加载详细信息
      if (!libDetails[name]) {
        const info = await window.api.library.getInfo(name)
        if (info) {
          setLibDetails(prev => ({ ...prev, [name]: info }))
        }
      }
    }
    setExpandedLibs(next)
  }, [expandedLibs, libDetails])

  const toggleCat = useCallback((key: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const loadedLibs = useMemo(() => libs.filter(lib => lib.loaded), [libs])

  return (
    <div className="sidebar-panel">
      <ul className="tree" role="tree" aria-label="支持库列表">
        {loadedLibs.map(lib => {
          const isExpanded = expandedLibs.has(lib.name)
          const detail = libDetails[lib.name]
          // 按分类分组命令（排除隐藏命令）
          const catMap: Record<string, LibDetail['commands']> = {}
          if (detail) {
            for (const cmd of detail.commands) {
              if (cmd.isHidden) continue
              const cat = cmd.category || '其他'
              if (!catMap[cat]) catMap[cat] = []
              catMap[cat].push(cmd)
            }
          }
          const catNames = Object.keys(catMap)

          return (
            <li key={lib.name} role="treeitem" aria-expanded={isExpanded}>
              <div
                className="tree-item tree-branch"
                style={{ paddingLeft: 8 }}
                onDoubleClick={() => toggleLib(lib.name)}
              >
                <span
                  className={`tree-arrow ${isExpanded ? 'expanded' : ''}`}
                  aria-hidden="true"
                  onClick={(e) => { e.stopPropagation(); toggleLib(lib.name) }}
                >▶</span>
                <Icon preserveOriginalColors name="library" size={16} />
                <span className="tree-label">{lib.libName || lib.name}</span>
              </div>
              {isExpanded && detail && (
                <ul role="group">
                  {/* 数据类型分组 */}
                  {detail.dataTypes.length > 0 && (() => {
                    const dtKey = `${lib.name}::__dt__`
                    const dtExpanded = expandedCats.has(dtKey)
                    return (
                      <li role="treeitem" aria-expanded={dtExpanded}>
                        <div
                          className="tree-item tree-branch"
                          style={{ paddingLeft: 24 }}
                          onDoubleClick={() => toggleCat(dtKey)}
                        >
                          <span
                            className={`tree-arrow ${dtExpanded ? 'expanded' : ''}`}
                            aria-hidden="true"
                            onClick={(e) => { e.stopPropagation(); toggleCat(dtKey) }}
                          >▶</span>
                          <Icon preserveOriginalColors name="class" size={16} />
                          <span className="tree-label">数据类型</span>
                          <span className="tree-badge">{detail.dataTypes.length}</span>
                        </div>
                        {dtExpanded && (
                          <ul role="group">
                            {detail.dataTypes.map(dt => (
                              <li key={dt.name} role="treeitem">
                                <div className="tree-item tree-leaf" style={{ paddingLeft: 40 }} title={dt.description}>
                                  <span className="tree-arrow-placeholder" aria-hidden="true" />
                                  <Icon preserveOriginalColors name="class" size={16} />
                                  <span className="tree-label">{dt.name}</span>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    )
                  })()}
                  {/* 命令分类 */}
                  {catNames.map(cat => {
                    const catKey = `${lib.name}::${cat}`
                    const catExpanded = expandedCats.has(catKey)
                    const cmds = catMap[cat]
                    return (
                      <li key={cat} role="treeitem" aria-expanded={catExpanded}>
                        <div
                          className="tree-item tree-branch"
                          style={{ paddingLeft: 24 }}
                          onDoubleClick={() => toggleCat(catKey)}
                        >
                          <span
                            className={`tree-arrow ${catExpanded ? 'expanded' : ''}`}
                            aria-hidden="true"
                            onClick={(e) => { e.stopPropagation(); toggleCat(catKey) }}
                          >▶</span>
                          <Icon preserveOriginalColors name="folder-closed" size={16} />
                          <span className="tree-label">{cat}</span>
                          <span className="tree-badge">{cmds.length}</span>
                        </div>
                        {catExpanded && (
                          <ul role="group">
                            {cmds.map(cmd => (
                              <li key={cmd.name} role="treeitem">
                                <div className="tree-item tree-leaf" style={{ paddingLeft: 40 }} title={cmd.description}>
                                  <span className="tree-arrow-placeholder" aria-hidden="true" />
                                  <Icon preserveOriginalColors name="method" size={16} />
                                  <span className="tree-label">{cmd.name}</span>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                  {isExpanded && !detail && (
                    <li className="sidebar-empty">加载中...</li>
                  )}
                </ul>
              )}
            </li>
          )
        })}
        {loadedLibs.length === 0 && (
          <li className="sidebar-empty">暂无已加载支持库</li>
        )}
      </ul>
    </div>
  )
}

/** 从窗口字段获取属性的映射值 */
function getFormFieldValue(propName: string, form: DesignForm): string | number | boolean | undefined {
  switch (propName) {
    case '标题': return form.title
    case '左边': return 0
    case '顶边': return 0
    case '宽度': return form.width
    case '高度': return form.height
    case '可视': return true
    case '禁止': return false
    default: return undefined
  }
}

/** 从控件字段获取属性的映射值（标题→text, 左边→left 等） */
function getControlFieldValue(propName: string, control: DesignControl): string | number | boolean | undefined {
  switch (propName) {
    case '标题': return control.text
    case '内容': return control.text
    case '文本': return control.text
    case '左边': return control.left
    case '顶边': return control.top
    case '宽度': return control.width
    case '高度': return control.height
    case '可视': return control.visible
    case '禁止': return !control.enabled
    default: return undefined
  }
}

/** 获取窗口属性的显示值 */
function resolveFormPropValue(prop: LibUnitProperty, form: DesignForm): string | number | boolean {
  // 优先读动态存储的属性值（用户已修改过的）
  const stored = form.properties?.[prop.name]
  if (stored !== undefined) return stored
  const field = getFormFieldValue(prop.name, form)
  if (field !== undefined) return field
  return getDefaultPropValue(prop)
}

/** 根据属性类型返回默认值 */
function getDefaultPropValue(prop: LibUnitProperty): string | number | boolean {
  if (prop.typeName === '逻辑型') return false
  if (prop.pickOptions.length > 0) return 0
  if (prop.typeName === '整数型' || prop.typeName === '小数型' || prop.typeName === '选择整数' || prop.typeName === '选择特定整数') return 0
  if (prop.typeName === '颜色' || prop.typeName === '颜色(透明)' || prop.typeName === '背景颜色') return 0
  return ''
}

/** 属性值格式化显示 */
function formatPropValue(prop: LibUnitProperty, value: string | number | boolean | undefined): string {
  if (value === undefined) return ''
  if (prop.typeName === '逻辑型') return value ? '真' : '假'
  if (prop.pickOptions.length > 0 && typeof value === 'number') {
    return prop.pickOptions[value] || String(value)
  }
  return String(value)
}

/** 获取控件属性的显示值（优先 properties，再映射字段，最后类型默认值） */
function resolveControlPropValue(prop: LibUnitProperty, control: DesignControl): string | number | boolean {
  const stored = control.properties[prop.name]
  if (stored !== undefined) return stored
  const field = getControlFieldValue(prop.name, control)
  if (field !== undefined) return field
  return getDefaultPropValue(prop)
}

/** 可编辑名称单元格（带重复检查） */
function EditableNameCell({ value, existingNames, onChange }: { value: string; existingNames: string[]; onChange: (v: string) => void }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value); setError('') }, [value])
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  const validate = useCallback((name: string): string => {
    if (!name.trim()) return '名称不能为空'
    if (/^[0-9]/.test(name)) return '名称不能以数字开头'
    if (/^[^\u4e00-\u9fa5a-zA-Z_]/.test(name)) return '名称不能以特殊符号开头'
    if (name !== value && existingNames.includes(name)) return '名称已存在'
    return ''
  }, [value, existingNames])

  const commitEdit = useCallback(() => {
    const err = validate(draft)
    if (err) { setError(err); return }
    setEditing(false)
    setError('')
    if (draft !== value) onChange(draft)
  }, [draft, value, onChange, validate])

  if (editing) {
    return (
      <div>
        <input
          ref={inputRef}
          className={`prop-edit-input ${error ? 'prop-edit-input-error' : ''}`}
          type="text"
          value={draft}
          onChange={e => { setDraft(e.target.value); setError(validate(e.target.value)) }}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setDraft(value); setError(''); setEditing(false) } }}
        />
        {error && <div className="prop-edit-error">{error}</div>}
      </div>
    )
  }
  return <span className="prop-value-text" onClick={() => setEditing(true)}>{value}</span>
}

/** 可编辑整数属性单元格 */
function EditableIntCell({ value, onChange }: { value: number; onChange: (v: number) => void }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(String(value)) }, [value])
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  const commitEdit = useCallback(() => {
    setEditing(false)
    const n = parseInt(draft, 10)
    if (!isNaN(n) && n !== value) onChange(n)
    else setDraft(String(value))
  }, [draft, value, onChange])

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="prop-edit-input"
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setDraft(String(value)); setEditing(false) } }}
      />
    )
  }
  return <span className="prop-value-text" onClick={() => setEditing(true)}>{value}</span>
}

/** 可编辑文本属性单元格 */
function EditableTextCell({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  const commitEdit = useCallback(() => {
    setEditing(false)
    if (draft !== value) onChange(draft)
    else setDraft(value)
  }, [draft, value, onChange])

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="prop-edit-input"
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
      />
    )
  }
  return <span className="prop-value-text" onClick={() => setEditing(true)}>{value || '\u00A0'}</span>
}

/** 可编辑逻辑型属性单元格（下拉选择） */
function EditableBoolCell({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <select
      className="prop-edit-select"
      value={value ? '1' : '0'}
      onChange={e => onChange(e.target.value === '1')}
    >
      <option value="1">真</option>
      <option value="0">假</option>
    </select>
  )
}

/** 可编辑枚举/选择属性单元格（下拉框） */
function EditablePickCell({ value, options, onChange }: { value: number; options: string[]; onChange: (v: number) => void }): React.JSX.Element {
  return (
    <select
      className="prop-edit-select"
      value={value}
      onChange={e => onChange(parseInt(e.target.value, 10))}
    >
      {options.map((opt, i) => (
        <option key={i} value={i}>{opt}</option>
      ))}
    </select>
  )
}

/** 根据属性类型渲染对应的可编辑单元格 */
function renderEditableCell(prop: LibUnitProperty, val: string | number | boolean, onChange: (v: string | number | boolean) => void): React.JSX.Element {
  // 有 pickOptions → 下拉选择
  if (prop.pickOptions.length > 0 && typeof val === 'number') {
    return <EditablePickCell value={val} options={prop.pickOptions} onChange={v => onChange(v)} />
  }
  // 逻辑型 → 单击切换
  if (prop.typeName === '逻辑型') {
    return <EditableBoolCell value={!!val} onChange={v => onChange(v)} />
  }
  // 整数型 / 小数型 / 颜色等数值类型
  if (prop.typeName === '整数型' || prop.typeName === '小数型' || prop.typeName === '选择整数' || prop.typeName === '选择特定整数' || prop.typeName === '颜色' || prop.typeName === '颜色(透明)' || prop.typeName === '背景颜色') {
    return <EditableIntCell value={typeof val === 'number' ? val : 0} onChange={v => onChange(v)} />
  }
  // 文本型及其他 → 文本输入
  return <EditableTextCell value={String(val ?? '')} onChange={v => onChange(v)} />
}

function PropertyPanel({ selection, windowUnits, onSelectControl, onPropertyChange, projectNames }: { selection?: SelectionTarget; windowUnits: LibWindowUnit[]; onSelectControl?: (target: SelectionTarget) => void; onPropertyChange?: (targetKind: 'form' | 'control', controlId: string | null, propName: string, value: string | number | boolean) => void; projectNames?: string[] }): React.JSX.Element {
  // 获取当前窗口数据（从任意选中状态中提取）
  const form = selection?.kind === 'form' ? selection.form
    : selection?.kind === 'control' ? selection.form
    : null

  // 下拉选择框切换
  const handleDropdownChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!form || !onSelectControl) return
    const val = e.target.value
    if (val === '__form__') {
      onSelectControl({ kind: 'form', form })
    } else {
      const ctrl = form.controls.find(c => c.id === val)
      if (ctrl) onSelectControl({ kind: 'control', control: ctrl, form })
    }
  }, [form, onSelectControl])

  // 当前选中的 ID
  const selectedValue = selection?.kind === 'form' ? '__form__'
    : selection?.kind === 'control' ? selection.control.id
    : ''

  // 下拉框渲染
  const renderSelector = (): React.JSX.Element => (
    <div className="prop-header">
      <select
        className="prop-selector"
        value={selectedValue}
        onChange={handleDropdownChange}
      >
        {form && (
          <>
            <option value="__form__">{form.name} - 窗口</option>
            {form.controls.map(c => (
              <option key={c.id} value={c.id}>{c.name} - {c.type}</option>
            ))}
          </>
        )}
        {!form && <option value="">请选择组件</option>}
      </select>
    </div>
  )

  if (!selection) {
    return (
      <div className="sidebar-panel">
        <div className="prop-header">
          <select className="prop-selector" disabled>
            <option>请选择一个控件或窗口</option>
          </select>
        </div>
        <div className="sidebar-empty">请选择一个控件或窗口以查看属性</div>
      </div>
    )
  }

  if (selection.kind === 'form') {
    const f = selection.form
    const windowUnit = windowUnits.find(u => u.name === '窗口')
    const allNames = [f.name, ...f.controls.map(c => c.name)]
    return (
      <div className="sidebar-panel">
        {renderSelector()}
        <table className="prop-table">
          <tbody>
            <tr className="prop-row">
              <td className="prop-name">窗口名称</td>
              <td className="prop-value">
                <EditableNameCell value={f.name} existingNames={projectNames || []} onChange={v => onPropertyChange?.('form', null, '__name__', v)} />
              </td>
            </tr>
            <tr className="prop-row">
              <td className="prop-name">类型</td>
              <td className="prop-value">窗口</td>
            </tr>
            {windowUnit ? (
              windowUnit.properties.filter(p => !p.isReadOnly).map(p => {
                const val = resolveFormPropValue(p, f)
                return (
                  <tr key={p.name} className="prop-row">
                    <td className="prop-name" title={p.description}>{p.name}</td>
                    <td className="prop-value">
                      {renderEditableCell(p, val, v => onPropertyChange?.('form', null, p.name, v))}
                    </td>
                  </tr>
                )
              })
            ) : (
              <>
                <tr className="prop-row"><td className="prop-name">标题</td><td className="prop-value"><EditableTextCell value={f.title} onChange={v => onPropertyChange?.('form', null, '标题', v)} /></td></tr>
                <tr className="prop-row"><td className="prop-name">左边</td><td className="prop-value">0</td></tr>
                <tr className="prop-row"><td className="prop-name">顶边</td><td className="prop-value">0</td></tr>
                <tr className="prop-row"><td className="prop-name">宽度</td><td className="prop-value"><EditableIntCell value={f.width} onChange={v => onPropertyChange?.('form', null, '宽度', v)} /></td></tr>
                <tr className="prop-row"><td className="prop-name">高度</td><td className="prop-value"><EditableIntCell value={f.height} onChange={v => onPropertyChange?.('form', null, '高度', v)} /></td></tr>
                <tr className="prop-row"><td className="prop-name">可视</td><td className="prop-value">真</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    )
  }

  const control = selection.control
  const typeName = control.type
  const unit = windowUnits.find(u => u.name === control.type)
  const allNames = form ? [form.name, ...form.controls.filter(c => c.id !== control.id).map(c => c.name)] : []

  return (
    <div className="sidebar-panel">
      {renderSelector()}
      <table className="prop-table">
        <tbody>
          <tr className="prop-row">
            <td className="prop-name">控件名称</td>
            <td className="prop-value">
              <EditableNameCell value={control.name} existingNames={allNames} onChange={v => onPropertyChange?.('control', control.id, '__name__', v)} />
            </td>
          </tr>
          <tr className="prop-row">
            <td className="prop-name">控件类型</td>
            <td className="prop-value">{typeName}</td>
          </tr>
          {unit ? (
            unit.properties.filter(p => !p.isReadOnly).map(p => {
              const val = resolveControlPropValue(p, control)
              return (
                <tr key={p.name} className="prop-row">
                  <td className="prop-name" title={p.description}>{p.name}</td>
                  <td className="prop-value">
                    {renderEditableCell(p, val, v => onPropertyChange?.('control', control.id, p.name, v))}
                  </td>
                </tr>
              )
            })
          ) : (
            <>
              <tr className="prop-row"><td className="prop-name">标题</td><td className="prop-value"><EditableTextCell value={control.text} onChange={v => onPropertyChange?.('control', control.id, '标题', v)} /></td></tr>
              <tr className="prop-row"><td className="prop-name">左边</td><td className="prop-value"><EditableIntCell value={control.left} onChange={v => onPropertyChange?.('control', control.id, '左边', v)} /></td></tr>
              <tr className="prop-row"><td className="prop-name">顶边</td><td className="prop-value"><EditableIntCell value={control.top} onChange={v => onPropertyChange?.('control', control.id, '顶边', v)} /></td></tr>
              <tr className="prop-row"><td className="prop-name">宽度</td><td className="prop-value"><EditableIntCell value={control.width} onChange={v => onPropertyChange?.('control', control.id, '宽度', v)} /></td></tr>
              <tr className="prop-row"><td className="prop-name">高度</td><td className="prop-value"><EditableIntCell value={control.height} onChange={v => onPropertyChange?.('control', control.id, '高度', v)} /></td></tr>
              <tr className="prop-row"><td className="prop-name">可视</td><td className="prop-value"><EditableBoolCell value={control.visible} onChange={v => onPropertyChange?.('control', control.id, '可视', v)} /></td></tr>
              <tr className="prop-row"><td className="prop-name">禁止</td><td className="prop-value"><EditableBoolCell value={!control.enabled} onChange={v => onPropertyChange?.('control', control.id, '禁止', v)} /></td></tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  )
}

function Sidebar({ width, onResize, selection, activeTab, onTabChange, onSelectControl, onPropertyChange, projectTree, onOpenFile, activeFileId, projectDir, onEventNavigate, onLibraryChange }: SidebarProps): React.JSX.Element {
  const [windowUnits, setWindowUnits] = useState<LibWindowUnit[]>([])
  const [projectNames, setProjectNames] = useState<string[]>([])

  // 从支持库加载窗口组件信息，并在支持库加载后刷新
  const loadWindowUnits = useCallback(() => {
    window.api.library.getWindowUnits().then(setWindowUnits).catch(() => {})
  }, [])

  useEffect(() => {
    loadWindowUnits()
    const handler = () => { loadWindowUnits(); onLibraryChange?.() }
    window.api.on('library:loaded', handler)
    return () => { window.api.off('library:loaded') }
  }, [loadWindowUnits, onLibraryChange])

  // 加载项目中所有 .efw 的窗口名称（用于项目级窗口重名检查，控件只在窗口内检查）
  useEffect(() => {
    if (!projectDir || activeTab !== 'property') { setProjectNames([]); return }
    const currentFormName = selection?.kind === 'form' ? selection.form.name
      : selection?.kind === 'control' ? selection.form.name : null
    let cancelled = false
    ;(async () => {
      const dirFiles = await window.api?.file?.readDir(projectDir)
      if (cancelled || !dirFiles) return
      const names: string[] = []
      for (const f of dirFiles as string[]) {
        if (!f.toLowerCase().endsWith('.efw')) continue
        const content = await window.api?.project?.readFile(projectDir + '\\' + f)
        if (cancelled || !content) continue
        try {
          const efwData = JSON.parse(content)
          const formName = efwData.name || f.replace('.efw', '')
          // 排除当前正在编辑的窗口自身名称
          if (formName !== currentFormName) names.push(formName)
        } catch { /* ignore parse errors */ }
      }
      if (!cancelled) setProjectNames(names)
    })()
    return () => { cancelled = true }
  }, [projectDir, activeTab, selection])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(150, Math.min(500, startWidth + e.clientX - startX))
      onResize(newWidth)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [width, onResize])

  const tabTitle = activeTab === 'project' ? '项目管理器'
    : activeTab === 'library' ? '支持库'
    : '属性'

  // 当前选中组件的事件列表
  const selectedEvents = useMemo<LibUnitEvent[]>(() => {
    if (!selection) return []
    const typeName = selection.kind === 'form' ? '窗口' : selection.control.type
    const unit = windowUnits.find(u => u.name === typeName)
    return unit?.events ?? []
  }, [selection, windowUnits])

  const selectedTypeName = selection ? (selection.kind === 'form' ? '窗口' : selection.control.type) : ''
  const currentForm = selection ? (selection.kind === 'form' ? selection.form : selection.form) : null
  const EVENT_PREFIX_CHECKED = '✓\u00A0'
  const EVENT_PREFIX_EMPTY = '\u00A0\u00A0'
  const currentFormKey = useMemo(() => {
    if (!projectDir || !currentForm) return ''
    const sourceFile = currentForm.sourceFile || `${currentForm.name}.eyc`
    return `${projectDir}::${sourceFile}`
  }, [projectDir, currentForm?.name, currentForm?.sourceFile])

  const getEventSubName = useCallback((sel: Exclude<SelectionTarget, null>, eventName: string): string => {
    if (sel.kind === 'form') {
      return `_${sel.form.name}_${eventName}`
    }
    const normalized = sel.control.name.replace(/^_+/, '')
    return `_${normalized}_${eventName}`
  }, [])

  const [selectedEventIndex, setSelectedEventIndex] = useState('')
  const [existingEventSubs, setExistingEventSubs] = useState<Set<string>>(new Set())
  const eventSubsCacheRef = useRef<Map<string, Set<string>>>(new Map())

  // 读取当前窗口对应 .eyc，解析已存在的 .子程序 名称
  useEffect(() => {
    if (activeTab !== 'property' || !projectDir || !currentForm || !currentFormKey) {
      return
    }

    const cached = eventSubsCacheRef.current.get(currentFormKey)
    if (cached) {
      setExistingEventSubs(new Set(cached))
    }

    let cancelled = false
    ;(async () => {
      const sourceFile = currentForm.sourceFile || `${currentForm.name}.eyc`
      const filePath = projectDir + '\\' + sourceFile
      const content = await window.api?.project?.readFile(filePath)
      if (cancelled || !content) {
        return
      }
      const next = new Set<string>()
      const lines = content.split(/\r?\n/)
      for (const line of lines) {
        const match = /^\s*\.子程序\s+(.+?)(?:\s*,|\s*$)/.exec(line)
        if (match?.[1]) {
          next.add(match[1].trim())
        }
      }

      if (!cancelled) {
        const merged = new Set<string>([...(eventSubsCacheRef.current.get(currentFormKey) || []), ...next])
        eventSubsCacheRef.current.set(currentFormKey, merged)
        setExistingEventSubs(merged)
      }
    })()
    return () => { cancelled = true }
  }, [activeTab, projectDir, currentForm?.name, currentForm?.sourceFile, currentFormKey])

  // 选中变化时，重置为占位项（空值）
  useEffect(() => {
    setSelectedEventIndex('')
  }, [selection, selectedEvents.length, selectedTypeName])

  return (
    <aside className="sidebar" style={{ width: `${width}px` }} role="complementary" aria-label="项目导航">
      <div className="sidebar-header">
        <span>{tabTitle}</span>
      </div>
      <div className="sidebar-content">
        {activeTab === 'project' && (
          projectTree && projectTree.length > 0 ? (
            <ul className="tree" role="tree" aria-label="项目结构">
              {projectTree.map((node) => (
                <TreeItem key={node.id} node={node} onOpenFile={onOpenFile} activeFileId={activeFileId} />
              ))}
            </ul>
          ) : (
            <div className="sidebar-empty">暂无打开的项目</div>
          )
        )}
        {activeTab === 'library' && <LibraryPanel />}
        {activeTab === 'property' && <PropertyPanel selection={selection} windowUnits={windowUnits} onSelectControl={onSelectControl} onPropertyChange={onPropertyChange} projectNames={projectNames} />}
      </div>
      {activeTab === 'property' && (
        <div className="sidebar-event-bar">
          <select
            className="sidebar-event-selector"
            value={selectedEventIndex}
            onChange={(e) => {
              const idx = parseInt(e.target.value, 10)
              setSelectedEventIndex(e.target.value)
              if (e.target.value === '') return
              const ev = Number.isNaN(idx) ? undefined : selectedEvents[idx]
              if (selection && ev && onEventNavigate) {
                onEventNavigate(selection, ev.name, ev.args ?? [])
                const subName = getEventSubName(selection, ev.name)
                setExistingEventSubs(prev => {
                  const next = new Set(prev)
                  next.add(subName)
                  if (currentFormKey) {
                    eventSubsCacheRef.current.set(currentFormKey, new Set(next))
                  }
                  return next
                })
              }
            }}
            disabled={!selection || selectedEvents.length === 0}
          >
            {!selection || selectedEvents.length === 0 ? (
              <option value="">无对应事件</option>
            ) : (
              <>
                <option value="">在此处选择加入事件处理子程序</option>
                {selectedEvents.map((ev, idx) => (
                  <option key={`${ev.name}-${idx}`} value={String(idx)} title={ev.description}>
                    {((selection && existingEventSubs.has(getEventSubName(selection, ev.name))) ? EVENT_PREFIX_CHECKED : EVENT_PREFIX_EMPTY) + ev.name}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>
      )}
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${activeTab === 'library' ? 'active' : ''}`}
          onClick={() => onTabChange('library')}
        >支持库</button>
        <button
          className={`sidebar-tab ${activeTab === 'project' ? 'active' : ''}`}
          onClick={() => onTabChange('project')}
        >项目</button>
        <button
          className={`sidebar-tab ${activeTab === 'property' ? 'active' : ''}`}
          onClick={() => onTabChange('property')}
        >属性</button>
      </div>
      <div className="sidebar-resizer" onMouseDown={handleMouseDown} role="separator" aria-orientation="vertical" />
    </aside>
  )
}

export default Sidebar
