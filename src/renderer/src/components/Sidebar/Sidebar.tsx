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

const TREE_TYPE_LABEL: Record<TreeNode['type'], string> = {
  folder: '文件夹',
  module: '模块文件',
  class: '类',
  sub: '子程序',
  func: '函数',
  field: '成员',
  dll: 'DLL命令',
  constant: '常量',
  window: '窗口',
  resource: '资源',
}

interface SidebarProps {
  width: number
  onResize: (width: number) => void
  placement?: 'left' | 'right'
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

function TreeItem({
  node,
  depth = 0,
  onOpenFile,
  activeFileId,
  focusedItemId,
  onFocusItem,
}: {
  node: TreeNode
  depth?: number
  onOpenFile?: (fileId: string, fileName: string, targetLine?: number) => void
  activeFileId?: string | null
  focusedItemId?: string | null
  onFocusItem?: (id: string) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(node.expanded ?? false)
  const hasChildren = node.children && node.children.length > 0
  const declMatch = /^(.+)::(sub|global|const|dtype|dll)::(\d+)$/.exec(node.id)
  const ownerFile = declMatch?.[1]
  const lineIndex = declMatch ? Number.parseInt(declMatch[3], 10) : NaN
  const targetLine = Number.isFinite(lineIndex) ? lineIndex + 1 : undefined
  const openFileId = node.fileId || ownerFile || node.id
  const openFileName = node.fileName || ownerFile || node.label
  const isActiveLeaf = !hasChildren && !!activeFileId && activeFileId === openFileId
  const isRovingFocused = focusedItemId ? focusedItemId === node.id : depth === 0
  const childrenCount = node.children?.length || 0
  const treeItemAriaLabel = hasChildren
    ? `${TREE_TYPE_LABEL[node.type] || '节点'} ${node.label}，${expanded ? '已展开' : '已折叠'}，包含 ${childrenCount} 项`
    : `${TREE_TYPE_LABEL[node.type] || '节点'} ${node.label}${isActiveLeaf ? '，当前已选中' : ''}`

  const focusAdjacentTreeItem = (currentItem: HTMLElement, direction: 'up' | 'down' | 'home' | 'end'): void => {
    const treeRoot = currentItem.closest('[role="tree"]')
    if (!treeRoot) return
    const items = Array.from(treeRoot.querySelectorAll<HTMLElement>('.tree-item'))
    const currentIndex = items.indexOf(currentItem)
    if (currentIndex < 0) return

    if (direction === 'home') {
      items[0]?.focus()
      return
    }

    if (direction === 'end') {
      items[items.length - 1]?.focus()
      return
    }

    const nextIndex = direction === 'down' ? currentIndex + 1 : currentIndex - 1
    if (nextIndex >= 0 && nextIndex < items.length) {
      items[nextIndex]?.focus()
    }
  }

  const focusParentTreeItem = (currentItem: HTMLElement): void => {
    const parentLi = currentItem.parentElement?.parentElement?.closest('li[role="treeitem"]')
    if (!parentLi) return
    const parentItem = parentLi.firstElementChild
    if (parentItem instanceof HTMLElement && parentItem.classList.contains('tree-item')) {
      parentItem.focus()
    }
  }

  return (
    <li role="treeitem" aria-level={depth + 1} aria-expanded={hasChildren ? expanded : undefined}>
      <div
        className={`tree-item ${hasChildren ? 'tree-branch' : 'tree-leaf'}${isActiveLeaf ? ' tree-item-active' : ''}`}
        data-level={depth + 1}
        aria-label={treeItemAriaLabel}
        aria-selected={isActiveLeaf}
        id={`project-tree-item-${node.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`}
        style={{ paddingLeft: `calc(${depth} * var(--tree-indent-step, 16px) + var(--tree-indent-base, 8px))` }}
        onClick={() => hasChildren && setExpanded(!expanded)}
        onDoubleClick={() => {
          if (node.type === 'module' && onOpenFile) {
            onOpenFile(openFileId, openFileName, targetLine)
          } else if (!hasChildren && onOpenFile) {
            onOpenFile(openFileId, openFileName, targetLine)
          }
        }}
        tabIndex={isRovingFocused ? 0 : -1}
        onFocus={() => onFocusItem?.(node.id)}
        onKeyDown={(e) => {
          const currentItem = e.currentTarget as HTMLElement

          if (e.key === 'ArrowDown') {
            e.preventDefault()
            focusAdjacentTreeItem(currentItem, 'down')
            return
          }

          if (e.key === 'ArrowUp') {
            e.preventDefault()
            focusAdjacentTreeItem(currentItem, 'up')
            return
          }

          if (e.key === 'Home') {
            e.preventDefault()
            focusAdjacentTreeItem(currentItem, 'home')
            return
          }

          if (e.key === 'End') {
            e.preventDefault()
            focusAdjacentTreeItem(currentItem, 'end')
            return
          }

          if (e.key === 'ArrowRight') {
            e.preventDefault()
            if (hasChildren && !expanded) {
              setExpanded(true)
            } else {
              focusAdjacentTreeItem(currentItem, 'down')
            }
            return
          }

          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            if (hasChildren && expanded) {
              setExpanded(false)
            } else {
              focusParentTreeItem(currentItem)
            }
            return
          }

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
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              activeFileId={activeFileId}
              focusedItemId={focusedItemId}
              onFocusItem={onFocusItem}
            />
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
  const [focusedLibraryItemId, setFocusedLibraryItemId] = useState<string | null>(null)

  const getLibraryItemId = useCallback((kind: string, ...parts: string[]) => [kind, ...parts].join('::'), [])

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

  const visibleLibraryItemIds = useMemo(() => {
    const ids: string[] = []
    for (const lib of loadedLibs) {
      const libId = getLibraryItemId('lib', lib.name)
      ids.push(libId)
      const isExpanded = expandedLibs.has(lib.name)
      const detail = libDetails[lib.name]
      if (!isExpanded || !detail) continue

      if (detail.dataTypes.length > 0) {
        const dtGroupId = getLibraryItemId('dt-group', lib.name)
        ids.push(dtGroupId)
        const dtKey = `${lib.name}::__dt__`
        if (expandedCats.has(dtKey)) {
          for (const dt of detail.dataTypes) {
            ids.push(getLibraryItemId('dt', lib.name, dt.name))
          }
        }
      }

      const catMap: Record<string, LibDetail['commands']> = {}
      for (const cmd of detail.commands) {
        if (cmd.isHidden) continue
        const cat = cmd.category || '其他'
        if (!catMap[cat]) catMap[cat] = []
        catMap[cat].push(cmd)
      }

      for (const cat of Object.keys(catMap)) {
        ids.push(getLibraryItemId('cat', lib.name, cat))
        const catKey = `${lib.name}::${cat}`
        if (expandedCats.has(catKey)) {
          for (const cmd of catMap[cat]) {
            ids.push(getLibraryItemId('cmd', lib.name, cat, cmd.name))
          }
        }
      }
    }
    return ids
  }, [loadedLibs, expandedLibs, libDetails, expandedCats, getLibraryItemId])

  useEffect(() => {
    setFocusedLibraryItemId(prev => {
      if (prev && visibleLibraryItemIds.includes(prev)) return prev
      return visibleLibraryItemIds[0] ?? null
    })
  }, [visibleLibraryItemIds])

  const focusAdjacentLibraryItem = useCallback((currentItem: HTMLElement, direction: 'up' | 'down' | 'home' | 'end') => {
    const treeRoot = currentItem.closest('[role="tree"]')
    if (!treeRoot) return
    const items = Array.from(treeRoot.querySelectorAll<HTMLElement>('.tree-item[data-library-item="true"]'))
    const currentIndex = items.indexOf(currentItem)
    if (currentIndex < 0) return

    if (direction === 'home') {
      items[0]?.focus()
      return
    }

    if (direction === 'end') {
      items[items.length - 1]?.focus()
      return
    }

    const nextIndex = direction === 'down' ? currentIndex + 1 : currentIndex - 1
    if (nextIndex >= 0 && nextIndex < items.length) {
      items[nextIndex]?.focus()
    }
  }, [])

  const focusParentLibraryItem = useCallback((currentItem: HTMLElement) => {
    const parentLi = currentItem.parentElement?.parentElement?.closest('li[role="treeitem"]')
    if (!parentLi) return
    const parentItem = parentLi.firstElementChild
    if (parentItem instanceof HTMLElement && parentItem.classList.contains('tree-item')) {
      parentItem.focus()
    }
  }, [])

  const handleLibraryItemKeyDown = useCallback((
    event: React.KeyboardEvent<HTMLElement>,
    options: { hasChildren: boolean; expanded?: boolean; onToggle?: () => void }
  ) => {
    const currentItem = event.currentTarget

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusAdjacentLibraryItem(currentItem, 'down')
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusAdjacentLibraryItem(currentItem, 'up')
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      focusAdjacentLibraryItem(currentItem, 'home')
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      focusAdjacentLibraryItem(currentItem, 'end')
      return
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      if (options.hasChildren && !options.expanded) options.onToggle?.()
      else focusAdjacentLibraryItem(currentItem, 'down')
      return
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (options.hasChildren && options.expanded) options.onToggle?.()
      else focusParentLibraryItem(currentItem)
      return
    }

    if ((event.key === 'Enter' || event.key === ' ') && options.hasChildren) {
      event.preventDefault()
      options.onToggle?.()
    }
  }, [focusAdjacentLibraryItem, focusParentLibraryItem])

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
              {(() => {
                const libItemId = getLibraryItemId('lib', lib.name)
                const isRovingFocused = focusedLibraryItemId ? focusedLibraryItemId === libItemId : visibleLibraryItemIds[0] === libItemId
                return (
              <div
                className="tree-item tree-branch"
                data-library-item="true"
                aria-label={`支持库 ${lib.libName || lib.name}，${isExpanded ? '已展开' : '已折叠'}`}
                style={{ paddingLeft: 'var(--tree-indent-base, 8px)' }}
                tabIndex={isRovingFocused ? 0 : -1}
                onFocus={() => setFocusedLibraryItemId(libItemId)}
                onClick={() => { setFocusedLibraryItemId(libItemId); void toggleLib(lib.name) }}
                onKeyDown={(event) => handleLibraryItemKeyDown(event, { hasChildren: true, expanded: isExpanded, onToggle: () => { void toggleLib(lib.name) } })}
              >
                <span
                  className={`tree-arrow ${isExpanded ? 'expanded' : ''}`}
                  aria-hidden="true"
                  onClick={(e) => { e.stopPropagation(); void toggleLib(lib.name) }}
                >▶</span>
                <Icon preserveOriginalColors name="library" size={16} />
                <span className="tree-label">{lib.libName || lib.name}</span>
              </div>
                )
              })()}
              {isExpanded && detail && (
                <ul role="group">
                  {/* 数据类型分组 */}
                  {detail.dataTypes.length > 0 && (() => {
                    const dtKey = `${lib.name}::__dt__`
                    const dtExpanded = expandedCats.has(dtKey)
                    const dtGroupItemId = getLibraryItemId('dt-group', lib.name)
                    const isDtGroupFocused = focusedLibraryItemId ? focusedLibraryItemId === dtGroupItemId : visibleLibraryItemIds[0] === dtGroupItemId
                    return (
                      <li role="treeitem" aria-expanded={dtExpanded}>
                        <div
                          className="tree-item tree-branch"
                          data-library-item="true"
                          aria-label={`数据类型分组，${dtExpanded ? '已展开' : '已折叠'}，共 ${detail.dataTypes.length} 项`}
                          style={{ paddingLeft: 'calc(var(--tree-indent-base, 8px) + var(--tree-indent-step, 16px))' }}
                          tabIndex={isDtGroupFocused ? 0 : -1}
                          onFocus={() => setFocusedLibraryItemId(dtGroupItemId)}
                          onClick={() => { setFocusedLibraryItemId(dtGroupItemId); toggleCat(dtKey) }}
                          onKeyDown={(event) => handleLibraryItemKeyDown(event, { hasChildren: true, expanded: dtExpanded, onToggle: () => toggleCat(dtKey) })}
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
                              <li key={dt.name} role="treeitem" aria-selected={focusedLibraryItemId === getLibraryItemId('dt', lib.name, dt.name)}>
                                <div className="tree-item tree-leaf" data-library-item="true" aria-label={`数据类型 ${dt.name}${dt.description ? `，${dt.description}` : ''}`} style={{ paddingLeft: 'calc(var(--tree-indent-base, 8px) + var(--tree-indent-step, 16px) * 2)' }} title={dt.description}
                                  tabIndex={(focusedLibraryItemId ? focusedLibraryItemId === getLibraryItemId('dt', lib.name, dt.name) : visibleLibraryItemIds[0] === getLibraryItemId('dt', lib.name, dt.name)) ? 0 : -1}
                                  onFocus={() => setFocusedLibraryItemId(getLibraryItemId('dt', lib.name, dt.name))}
                                  onClick={() => setFocusedLibraryItemId(getLibraryItemId('dt', lib.name, dt.name))}
                                  onKeyDown={(event) => handleLibraryItemKeyDown(event, { hasChildren: false })}
                                >
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
                    const catItemId = getLibraryItemId('cat', lib.name, cat)
                    const isCatFocused = focusedLibraryItemId ? focusedLibraryItemId === catItemId : visibleLibraryItemIds[0] === catItemId
                    return (
                      <li key={cat} role="treeitem" aria-expanded={catExpanded}>
                        <div
                          className="tree-item tree-branch"
                          data-library-item="true"
                          aria-label={`命令分类 ${cat}，${catExpanded ? '已展开' : '已折叠'}，共 ${cmds.length} 项`}
                          style={{ paddingLeft: 'calc(var(--tree-indent-base, 8px) + var(--tree-indent-step, 16px))' }}
                          tabIndex={isCatFocused ? 0 : -1}
                          onFocus={() => setFocusedLibraryItemId(catItemId)}
                          onClick={() => { setFocusedLibraryItemId(catItemId); toggleCat(catKey) }}
                          onKeyDown={(event) => handleLibraryItemKeyDown(event, { hasChildren: true, expanded: catExpanded, onToggle: () => toggleCat(catKey) })}
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
                              <li key={cmd.name} role="treeitem" aria-selected={focusedLibraryItemId === getLibraryItemId('cmd', lib.name, cat, cmd.name)}>
                                <div className="tree-item tree-leaf" data-library-item="true" aria-label={`命令 ${cmd.name}${cmd.description ? `，${cmd.description}` : ''}`} style={{ paddingLeft: 'calc(var(--tree-indent-base, 8px) + var(--tree-indent-step, 16px) * 2)' }} title={cmd.description}
                                  tabIndex={(focusedLibraryItemId ? focusedLibraryItemId === getLibraryItemId('cmd', lib.name, cat, cmd.name) : visibleLibraryItemIds[0] === getLibraryItemId('cmd', lib.name, cat, cmd.name)) ? 0 : -1}
                                  onFocus={() => setFocusedLibraryItemId(getLibraryItemId('cmd', lib.name, cat, cmd.name))}
                                  onClick={() => setFocusedLibraryItemId(getLibraryItemId('cmd', lib.name, cat, cmd.name))}
                                  onKeyDown={(event) => handleLibraryItemKeyDown(event, { hasChildren: false })}
                                >
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

function buildEditableAriaLabel(label: string, currentValue?: string): string {
  if (typeof currentValue === 'string') {
    return `编辑${label}，当前值 ${currentValue}`
  }
  return `编辑${label}`
}

function buildEditLiveMessage(action: 'enter' | 'exit' | 'cancel', label: string): string {
  if (action === 'enter') return `进入${label}编辑`
  if (action === 'cancel') return `已取消${label}编辑`
  return `已退出${label}编辑`
}

/** 可编辑名称单元格（带重复检查） */
function EditableNameCell({ value, existingNames, onChange, ariaLabel = '名称' }: { value: string; existingNames: string[]; onChange: (v: string) => void; ariaLabel?: string }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState('')
  const [liveMessage, setLiveMessage] = useState('')
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
    setLiveMessage('已退出名称编辑')
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
          aria-label={buildEditableAriaLabel(ariaLabel)}
          value={draft}
          onChange={e => { setDraft(e.target.value); setError(validate(e.target.value)) }}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setDraft(value); setError(''); setEditing(false); setLiveMessage(buildEditLiveMessage('cancel', '名称')) } }}
        />
        {error && <div className="prop-edit-error">{error}</div>}
      </div>
    )
  }
  return (
    <>
      <span
        className="prop-value-text"
        role="button"
        tabIndex={0}
        aria-label={buildEditableAriaLabel(ariaLabel, value)}
        onClick={() => { setEditing(true); setLiveMessage(buildEditLiveMessage('enter', '名称')) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setEditing(true)
            setLiveMessage(buildEditLiveMessage('enter', '名称'))
          }
        }}
      >{value}</span>
      <span className="sr-only" role="status" aria-live="polite">{liveMessage}</span>
    </>
  )
}

/** 可编辑整数属性单元格 */
function EditableIntCell({ value, onChange, ariaLabel = '数值' }: { value: number; onChange: (v: number) => void; ariaLabel?: string }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const [liveMessage, setLiveMessage] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(String(value)) }, [value])
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  const commitEdit = useCallback(() => {
    setEditing(false)
    setLiveMessage(buildEditLiveMessage('exit', '数值'))
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
        aria-label={buildEditableAriaLabel(ariaLabel)}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setDraft(String(value)); setEditing(false); setLiveMessage(buildEditLiveMessage('cancel', '数值')) } }}
      />
    )
  }
  return (
    <>
      <span
        className="prop-value-text"
        role="button"
        tabIndex={0}
        aria-label={buildEditableAriaLabel(ariaLabel, String(value))}
        onClick={() => { setEditing(true); setLiveMessage(buildEditLiveMessage('enter', '数值')) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setEditing(true)
            setLiveMessage(buildEditLiveMessage('enter', '数值'))
          }
        }}
      >{value}</span>
      <span className="sr-only" role="status" aria-live="polite">{liveMessage}</span>
    </>
  )
}

/** 可编辑文本属性单元格 */
function EditableTextCell({ value, onChange, ariaLabel = '文本' }: { value: string; onChange: (v: string) => void; ariaLabel?: string }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [liveMessage, setLiveMessage] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  const commitEdit = useCallback(() => {
    setEditing(false)
    setLiveMessage(buildEditLiveMessage('exit', '文本'))
    if (draft !== value) onChange(draft)
    else setDraft(value)
  }, [draft, value, onChange])

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="prop-edit-input"
        type="text"
        aria-label={buildEditableAriaLabel(ariaLabel)}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setDraft(value); setEditing(false); setLiveMessage(buildEditLiveMessage('cancel', '文本')) } }}
      />
    )
  }
  return (
    <>
      <span
        className="prop-value-text"
        role="button"
        tabIndex={0}
        aria-label={buildEditableAriaLabel(ariaLabel, value || '空')}
        onClick={() => { setEditing(true); setLiveMessage(buildEditLiveMessage('enter', '文本')) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setEditing(true)
            setLiveMessage(buildEditLiveMessage('enter', '文本'))
          }
        }}
      >{value || '\u00A0'}</span>
      <span className="sr-only" role="status" aria-live="polite">{liveMessage}</span>
    </>
  )
}

/** 可编辑逻辑型属性单元格（下拉选择） */
function EditableBoolCell({ value, onChange, ariaLabel = '布尔值' }: { value: boolean; onChange: (v: boolean) => void; ariaLabel?: string }): React.JSX.Element {
  return (
    <select
      className="prop-edit-select"
      aria-label={buildEditableAriaLabel(ariaLabel)}
      value={value ? '1' : '0'}
      onChange={e => onChange(e.target.value === '1')}
    >
      <option value="1">真</option>
      <option value="0">假</option>
    </select>
  )
}

/** 可编辑枚举/选择属性单元格（下拉框） */
function EditablePickCell({ value, options, onChange, ariaLabel = '选项' }: { value: number; options: string[]; onChange: (v: number) => void; ariaLabel?: string }): React.JSX.Element {
  return (
    <select
      className="prop-edit-select"
      aria-label={buildEditableAriaLabel(ariaLabel)}
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
    return <EditablePickCell value={val} options={prop.pickOptions} ariaLabel={prop.name} onChange={v => onChange(v)} />
  }
  // 逻辑型 → 单击切换
  if (prop.typeName === '逻辑型') {
    return <EditableBoolCell value={!!val} ariaLabel={prop.name} onChange={v => onChange(v)} />
  }
  // 整数型 / 小数型 / 颜色等数值类型
  if (prop.typeName === '整数型' || prop.typeName === '小数型' || prop.typeName === '选择整数' || prop.typeName === '选择特定整数' || prop.typeName === '颜色' || prop.typeName === '颜色(透明)' || prop.typeName === '背景颜色') {
    return <EditableIntCell value={typeof val === 'number' ? val : 0} ariaLabel={prop.name} onChange={v => onChange(v)} />
  }
  // 文本型及其他 → 文本输入
  return <EditableTextCell value={String(val ?? '')} ariaLabel={prop.name} onChange={v => onChange(v)} />
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
        aria-label="属性面板对象选择"
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
          <select className="prop-selector" aria-label="属性面板对象选择" disabled>
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
        <table className="prop-table" aria-label="窗口属性列表">
          <thead className="sr-only">
            <tr>
              <th scope="col">属性名</th>
              <th scope="col">属性值</th>
            </tr>
          </thead>
          <tbody>
            <tr className="prop-row">
              <th className="prop-name" scope="row">窗口名称</th>
              <td className="prop-value">
                <EditableNameCell value={f.name} existingNames={projectNames || []} ariaLabel="窗口名称" onChange={v => onPropertyChange?.('form', null, '__name__', v)} />
              </td>
            </tr>
            <tr className="prop-row">
              <th className="prop-name" scope="row">类型</th>
              <td className="prop-value">窗口</td>
            </tr>
            {windowUnit ? (
              windowUnit.properties.filter(p => !p.isReadOnly).map(p => {
                const val = resolveFormPropValue(p, f)
                return (
                  <tr key={p.name} className="prop-row">
                    <th className="prop-name" scope="row" title={p.description}>{p.name}</th>
                    <td className="prop-value">
                      {renderEditableCell(p, val, v => onPropertyChange?.('form', null, p.name, v))}
                    </td>
                  </tr>
                )
              })
            ) : (
              <>
                <tr className="prop-row"><th className="prop-name" scope="row">标题</th><td className="prop-value"><EditableTextCell value={f.title} ariaLabel="标题" onChange={v => onPropertyChange?.('form', null, '标题', v)} /></td></tr>
                <tr className="prop-row"><th className="prop-name" scope="row">左边</th><td className="prop-value">0</td></tr>
                <tr className="prop-row"><th className="prop-name" scope="row">顶边</th><td className="prop-value">0</td></tr>
                <tr className="prop-row"><th className="prop-name" scope="row">宽度</th><td className="prop-value"><EditableIntCell value={f.width} ariaLabel="宽度" onChange={v => onPropertyChange?.('form', null, '宽度', v)} /></td></tr>
                <tr className="prop-row"><th className="prop-name" scope="row">高度</th><td className="prop-value"><EditableIntCell value={f.height} ariaLabel="高度" onChange={v => onPropertyChange?.('form', null, '高度', v)} /></td></tr>
                <tr className="prop-row"><th className="prop-name" scope="row">可视</th><td className="prop-value">真</td></tr>
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
      <table className="prop-table" aria-label="控件属性列表">
        <thead className="sr-only">
          <tr>
            <th scope="col">属性名</th>
            <th scope="col">属性值</th>
          </tr>
        </thead>
        <tbody>
          <tr className="prop-row">
            <th className="prop-name" scope="row">控件名称</th>
            <td className="prop-value">
              <EditableNameCell value={control.name} existingNames={allNames} ariaLabel="控件名称" onChange={v => onPropertyChange?.('control', control.id, '__name__', v)} />
            </td>
          </tr>
          <tr className="prop-row">
            <th className="prop-name" scope="row">控件类型</th>
            <td className="prop-value">{typeName}</td>
          </tr>
          {unit ? (
            unit.properties.filter(p => !p.isReadOnly).map(p => {
              const val = resolveControlPropValue(p, control)
              return (
                <tr key={p.name} className="prop-row">
                  <th className="prop-name" scope="row" title={p.description}>{p.name}</th>
                  <td className="prop-value">
                    {renderEditableCell(p, val, v => onPropertyChange?.('control', control.id, p.name, v))}
                  </td>
                </tr>
              )
            })
          ) : (
            <>
              <tr className="prop-row"><th className="prop-name" scope="row">标题</th><td className="prop-value"><EditableTextCell value={control.text} ariaLabel="标题" onChange={v => onPropertyChange?.('control', control.id, '标题', v)} /></td></tr>
              <tr className="prop-row"><th className="prop-name" scope="row">左边</th><td className="prop-value"><EditableIntCell value={control.left} ariaLabel="左边" onChange={v => onPropertyChange?.('control', control.id, '左边', v)} /></td></tr>
              <tr className="prop-row"><th className="prop-name" scope="row">顶边</th><td className="prop-value"><EditableIntCell value={control.top} ariaLabel="顶边" onChange={v => onPropertyChange?.('control', control.id, '顶边', v)} /></td></tr>
              <tr className="prop-row"><th className="prop-name" scope="row">宽度</th><td className="prop-value"><EditableIntCell value={control.width} ariaLabel="宽度" onChange={v => onPropertyChange?.('control', control.id, '宽度', v)} /></td></tr>
              <tr className="prop-row"><th className="prop-name" scope="row">高度</th><td className="prop-value"><EditableIntCell value={control.height} ariaLabel="高度" onChange={v => onPropertyChange?.('control', control.id, '高度', v)} /></td></tr>
              <tr className="prop-row"><th className="prop-name" scope="row">可视</th><td className="prop-value"><EditableBoolCell value={control.visible} ariaLabel="可视" onChange={v => onPropertyChange?.('control', control.id, '可视', v)} /></td></tr>
              <tr className="prop-row"><th className="prop-name" scope="row">禁止</th><td className="prop-value"><EditableBoolCell value={!control.enabled} ariaLabel="禁止" onChange={v => onPropertyChange?.('control', control.id, '禁止', v)} /></td></tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  )
}

function Sidebar({ width, onResize, placement = 'left', selection, activeTab, onTabChange, onSelectControl, onPropertyChange, projectTree, onOpenFile, activeFileId, projectDir, onEventNavigate, onLibraryChange }: SidebarProps): React.JSX.Element {
  const SIDEBAR_MIN_WIDTH = 150
  const SIDEBAR_MAX_WIDTH = 500
  const SIDEBAR_RESIZE_STEP = 16
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
      const delta = e.clientX - startX
      const nextWidth = placement === 'right' ? startWidth - delta : startWidth + delta
      const newWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, nextWidth))
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
  }, [width, onResize, placement, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH])

  const handleResizerKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      const next = placement === 'right'
        ? Math.min(SIDEBAR_MAX_WIDTH, width + SIDEBAR_RESIZE_STEP)
        : Math.max(SIDEBAR_MIN_WIDTH, width - SIDEBAR_RESIZE_STEP)
      onResize(next)
      return
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      const next = placement === 'right'
        ? Math.max(SIDEBAR_MIN_WIDTH, width - SIDEBAR_RESIZE_STEP)
        : Math.min(SIDEBAR_MAX_WIDTH, width + SIDEBAR_RESIZE_STEP)
      onResize(next)
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      onResize(SIDEBAR_MIN_WIDTH)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      onResize(SIDEBAR_MAX_WIDTH)
    }
  }, [onResize, width, placement, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_RESIZE_STEP])

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
  const [focusedProjectItemId, setFocusedProjectItemId] = useState<string | null>(null)
  const eventSubsCacheRef = useRef<Map<string, Set<string>>>(new Map())
  const sidebarTabRefs = useRef<Array<HTMLButtonElement | null>>([])

  const sidebarTabs: Array<{ id: SidebarTab; label: string }> = [
    { id: 'library', label: '支持库' },
    { id: 'project', label: '项目' },
    { id: 'property', label: '属性' },
  ]

  const handleSidebarTabKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>, tabId: SidebarTab) => {
    const currentIndex = sidebarTabs.findIndex(tab => tab.id === tabId)
    if (currentIndex < 0) return

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      const nextIndex = (currentIndex + 1) % sidebarTabs.length
      onTabChange(sidebarTabs[nextIndex].id)
      sidebarTabRefs.current[nextIndex]?.focus()
      return
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      const prevIndex = (currentIndex - 1 + sidebarTabs.length) % sidebarTabs.length
      onTabChange(sidebarTabs[prevIndex].id)
      sidebarTabRefs.current[prevIndex]?.focus()
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      onTabChange(sidebarTabs[0].id)
      sidebarTabRefs.current[0]?.focus()
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      const lastIndex = sidebarTabs.length - 1
      onTabChange(sidebarTabs[lastIndex].id)
      sidebarTabRefs.current[lastIndex]?.focus()
    }
  }, [onTabChange, sidebarTabs])

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

  useEffect(() => {
    if (activeTab !== 'project') return
    if (!projectTree || projectTree.length === 0) {
      setFocusedProjectItemId(null)
      return
    }

    const collectIds = (nodes: TreeNode[]): string[] => {
      const ids: string[] = []
      for (const node of nodes) {
        ids.push(node.id)
        if (node.children?.length) ids.push(...collectIds(node.children))
      }
      return ids
    }

    const allIds = collectIds(projectTree)
    setFocusedProjectItemId(prev => {
      if (prev && allIds.includes(prev)) return prev
      return projectTree[0].id
    })
  }, [activeTab, projectTree])

  return (
    <aside className={`sidebar ${placement === 'right' ? 'sidebar-right' : ''}`} style={{ width: `${width}px` }} role="complementary" aria-label="项目导航">
      <div className="sidebar-header">
        <span>{tabTitle}</span>
      </div>
      <div className="sidebar-content">
        {activeTab === 'project' && (
          <div id="sidebar-panel-project" role="tabpanel" aria-labelledby="sidebar-tab-project">
            {projectTree && projectTree.length > 0 ? (
              <ul className="tree" role="tree" aria-label="项目结构">
                {projectTree.map((node) => (
                  <TreeItem
                    key={node.id}
                    node={node}
                    onOpenFile={onOpenFile}
                    activeFileId={activeFileId}
                    focusedItemId={focusedProjectItemId}
                    onFocusItem={setFocusedProjectItemId}
                  />
                ))}
              </ul>
            ) : (
              <div className="sidebar-empty">暂无打开的项目</div>
            )}
          </div>
        )}
        {activeTab === 'library' && (
          <div id="sidebar-panel-library" role="tabpanel" aria-labelledby="sidebar-tab-library">
            <LibraryPanel />
          </div>
        )}
        {activeTab === 'property' && (
          <div id="sidebar-panel-property" role="tabpanel" aria-labelledby="sidebar-tab-property">
            <PropertyPanel selection={selection} windowUnits={windowUnits} onSelectControl={onSelectControl} onPropertyChange={onPropertyChange} projectNames={projectNames} />
          </div>
        )}
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
      <div className="sidebar-tabs" role="tablist" aria-label="侧栏标签">
        {sidebarTabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => { sidebarTabRefs.current[index] = element }}
            id={`sidebar-tab-${tab.id}`}
            className={`sidebar-tab ${activeTab === tab.id ? 'active' : ''}`}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`sidebar-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(event) => handleSidebarTabKeyDown(event, tab.id)}
          >{tab.label}</button>
        ))}
      </div>
      <div
        className="sidebar-resizer"
        onMouseDown={handleMouseDown}
        onKeyDown={handleResizerKeyDown}
        role="separator"
        aria-label="调整侧栏宽度"
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
      />
    </aside>
  )
}

export default Sidebar
