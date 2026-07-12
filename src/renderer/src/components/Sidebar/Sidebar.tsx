import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { DesignControl, DesignForm, SelectionTarget, LibWindowUnit, LibUnitProperty, LibUnitEvent } from '../Editor/VisualDesigner'
import { parseFontSpec, stringifyFontSpec, formatFontSummary, fontSpecToCss, colorrefToHex, hexToColorref, COMMON_FONT_FAMILIES, DEFAULT_FONT_NAME, DEFAULT_FONT_SIZE, type FontSpec } from '../Editor/fontSpec'
import Icon, { resolveUnitIconName } from '../Icon/Icon'
import ChildTabEditorDialog from '../Editor/ChildTabEditorDialog'
import '../Icon/Icon.css'
import './Sidebar.css'

const MOUSE_POINTER_PICK_OPTIONS = [
  '0.默认型',
  '1.标准箭头型',
  '2.十字型',
  '3.文本编辑型',
  '4.沙漏型',
  '5.箭头问号型',
  '6.箭头及沙漏型',
  '7.禁止符型',
  '8.四向箭头型',
  '9.北向箭头型',
  '10.北<->南箭头型',
  '11.东<->西箭头型',
  '12.西北<->东南箭头型',
  '13.东北<->西南箭头型',
  '14.手型',
  '15.自定义型',
]

type SidebarTab = 'project' | 'library' | 'property'
type SidebarTabsPlacement = 'top' | 'bottom'

const SIDEBAR_TABS_PLACEMENT_KEY = 'ycide.sidebar.tabs.placement'

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

const FILE_ICON_BY_EXT: Record<string, string> = {
  c: 'class',
  cc: 'class',
  cpp: 'class',
  cxx: 'class',
  h: 'field',
  hh: 'field',
  hpp: 'field',
  hxx: 'field',
  ts: 'method',
  js: 'method',
  json: 'property',
  xml: 'property',
  yml: 'property',
  yaml: 'property',
  md: 'edit',
  txt: 'edit',
}

function getWorkspaceFileIconName(node: TreeNode): string {
  const fileName = (node.fileName || node.label || '').toLowerCase()
  const ext = fileName.includes('.') ? fileName.split('.').pop() || '' : ''
  if (ext && FILE_ICON_BY_EXT[ext]) return FILE_ICON_BY_EXT[ext]
  return 'module'
}

function getTreeNodeIconName(node: TreeNode, expanded: boolean): string {
  if (node.type === 'folder') {
    return expanded ? TREE_ICON_MAP['folder-expanded'] : TREE_ICON_MAP.folder
  }
  // 普通文件夹工作区文件：按扩展名给占位语言图标。
  if (node.id.startsWith('ws:file:')) {
    return getWorkspaceFileIconName(node)
  }
  return TREE_ICON_MAP[node.type] || 'custom-control'
}

const setCssVars = (element: HTMLElement | null, vars: Record<string, string>): void => {
  if (!element) return
  for (const [name, value] of Object.entries(vars)) {
    element.style.setProperty(name, value)
  }
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
  onOpenFile?: (fileId: string, fileName: string, targetLine?: number, targetType?: TreeNode['type'], targetLabel?: string) => void
  activeFileId?: string | null
  projectDir?: string
  openTabs?: Array<{ id: string; filePath?: string; language: string; value: string; savedValue?: string; formData?: DesignForm; aiModified?: boolean }>
  onEventNavigate?: (selection: SelectionTarget, eventName: string, eventArgs: Array<{ name: string; description: string; dataType: string; isByRef: boolean }>) => void
  onSaveProject?: (projectDir: string) => void
  onCloseProject?: (projectDir: string) => void
  /** 支持库加载或卸载时的回调 */
  onLibraryChange?: () => void
  /** 支持库树选中项提示回调（写入全局提示面板） */
  onLibraryHint?: (hint: { title: string; lines: string[] }) => void
  /** 项目树节点右键操作（程序集分类/程序集/类模块） */
  onProjectNodeAction?: (action: ProjectNodeAction, node: { id: string; label: string }) => void
  /** 是否有已复制的窗口可粘贴（窗口节点右键菜单“粘贴窗口”的可用性） */
  canPasteWindow?: boolean
}

export type ProjectNodeAction = 'newAssembly' | 'newClassModule' | 'newSub' | 'deleteModule' | 'newWindow' | 'newGlobalVar' | 'newConstant' | 'newDataType' | 'newDllCmd' | 'newPtrCmd' | 'copyWindow' | 'pasteWindow' | 'deleteWindow'

// 项目树各分类节点右键的「新建」菜单项（分类 id → 菜单项；动作复用插入菜单同款逻辑）
const CATEGORY_CONTEXT_MENU_ITEMS: Record<string, Array<{ action: ProjectNodeAction; label: string }>> = {
  _cat_windows: [{ action: 'newWindow', label: '新建窗口' }],
  _cat_sources: [
    { action: 'newAssembly', label: '新建程序集' },
    { action: 'newClassModule', label: '新建类模块' },
  ],
  _cat_globals: [{ action: 'newGlobalVar', label: '新建全局变量' }],
  _cat_constants: [{ action: 'newConstant', label: '新建常量' }],
  _cat_datatypes: [{ action: 'newDataType', label: '新建自定义数据类型' }],
  _cat_dllcmds: [
    { action: 'newDllCmd', label: '新建DLL命令' },
    { action: 'newPtrCmd', label: '新建指针命令' },
  ],
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
  projectDir?: string
  // 子程序节点：全项目内未被任何代码调用（事件处理/_前缀子程序不参与判定）
  unused?: boolean
}

function resolveNodeFileKey(node: TreeNode): string {
  const declMatch = /^(.+)::(sub|global|const|dtype|dll)::(\d+)$/.exec(node.id)
  const ownerFile = declMatch?.[1]
  const openFileId = node.fileId || ownerFile || node.id
  const openFileName = node.fileName || ownerFile || node.label
  return (openFileId || openFileName || '').replace(/^.*[\\/]/, '').toLowerCase()
}

function hasModifiedDescendant(node: TreeNode, modifiedFileKeys?: Set<string>): boolean {
  if (!modifiedFileKeys || modifiedFileKeys.size === 0) return false
  const isFileNode = node.type === 'module' || node.type === 'window' || node.type === 'resource'
  if (isFileNode) {
    const fileKey = resolveNodeFileKey(node)
    if (fileKey && modifiedFileKeys.has(fileKey)) return true
  }
  if (!node.children || node.children.length === 0) return false
  return node.children.some(child => hasModifiedDescendant(child, modifiedFileKeys))
}

function TreeItem({
  node,
  depth = 0,
  onOpenFile,
  activeFileId,
  focusedItemId,
  onFocusItem,
  modifiedFileKeys,
  aiModifiedFileKeys,
  onProjectContextMenu,
  onNodeContextMenu,
}: {
  node: TreeNode
  depth?: number
  onOpenFile?: (fileId: string, fileName: string, targetLine?: number, targetType?: TreeNode['type'], targetLabel?: string) => void
  activeFileId?: string | null
  focusedItemId?: string | null
  onFocusItem?: (id: string) => void
  modifiedFileKeys?: Set<string>
  aiModifiedFileKeys?: Set<string>
  onProjectContextMenu?: (event: React.MouseEvent<HTMLElement>, projectDir: string, projectName: string) => void
  onNodeContextMenu?: (event: React.MouseEvent<HTMLElement>, node: TreeNode) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(node.expanded ?? false)
  const hasChildren = node.children && node.children.length > 0
  const declMatch = /^(.+)::(sub|global|const|dtype|dll)::(\d+)$/.exec(node.id)
  const ownerFile = declMatch?.[1]
  const lineIndex = declMatch ? Number.parseInt(declMatch[3], 10) : NaN
  const targetLine = Number.isFinite(lineIndex) ? lineIndex + 1 : undefined
  const isFileNode = node.type === 'module' || node.type === 'window' || node.type === 'resource'
  const openFileId = node.fileId || ownerFile || node.id
  const openFileName = node.fileName || ownerFile || (isFileNode ? node.id : node.label)
  const isActiveLeaf = !hasChildren && !!activeFileId && activeFileId === openFileId
  const fileKey = resolveNodeFileKey(node)
  const isModifiedFile = isFileNode && !!fileKey && !!modifiedFileKeys?.has(fileKey)
  const isModifiedCategory = node.type === 'folder' && depth > 0 && hasModifiedDescendant(node, modifiedFileKeys)
  const shouldShowModifiedDot = isModifiedFile || isModifiedCategory
  // AI 修改的文件：圆点外包圆角矩形；分类聚合点不区分来源
  const isAiModifiedFile = isModifiedFile && !!fileKey && !!aiModifiedFileKeys?.has(fileKey)
  const isProjectRoot = depth === 0 && node.type === 'folder' && !!node.projectDir
  const isRovingFocused = focusedItemId ? focusedItemId === node.id : depth === 0
  const childrenCount = node.children?.length || 0
  const treeItemAriaLabel = hasChildren
    ? `${TREE_TYPE_LABEL[node.type] || '节点'} ${node.label}，${expanded ? '已展开' : '已折叠'}，包含 ${childrenCount} 项`
    : `${TREE_TYPE_LABEL[node.type] || '节点'} ${node.label}${node.unused ? '，未被调用' : ''}${isActiveLeaf ? '，当前已选中' : ''}`

  const focusAdjacentTreeItem = (currentItem: HTMLElement, direction: 'up' | 'down' | 'home' | 'end'): void => {
    const treeRoot = currentItem.closest('.tree')
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
    const parentLi = currentItem.parentElement?.parentElement?.closest('.tree-node')
    if (!parentLi) return
    const parentItem = parentLi.firstElementChild
    if (parentItem instanceof HTMLElement && parentItem.classList.contains('tree-item')) {
      parentItem.focus()
    }
  }

  return (
    <li className="tree-node">
      <div
        className={`tree-item ${hasChildren ? 'tree-branch' : 'tree-leaf'}${isActiveLeaf ? ' tree-item-active' : ''}`}
        data-level={depth + 1}
        aria-label={treeItemAriaLabel}
        aria-current={isActiveLeaf ? 'page' : undefined}
        ref={(element) => setCssVars(element, {
          '--tree-item-padding-left': `calc(${depth} * var(--tree-indent-step, 16px) + var(--tree-indent-base, 8px))`,
        })}
        onClick={() => hasChildren && setExpanded(!expanded)}
        onContextMenu={(event) => {
          if (isProjectRoot && node.projectDir) {
            event.preventDefault()
            event.stopPropagation()
            onProjectContextMenu?.(event, node.projectDir, node.label)
            return
          }
          onNodeContextMenu?.(event, node)
        }}
        onDoubleClick={() => {
          if (isFileNode && onOpenFile) {
            onOpenFile(openFileId, openFileName, targetLine, node.type, node.label)
          } else if (!hasChildren && node.type !== 'folder' && onOpenFile) {
            onOpenFile(openFileId, openFileName, targetLine, node.type, node.label)
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
            if (isFileNode && onOpenFile) onOpenFile(openFileId, openFileName, targetLine, node.type, node.label)
            else if (hasChildren) setExpanded(!expanded)
            else if (node.type !== 'folder' && onOpenFile) onOpenFile(openFileId, openFileName, targetLine, node.type, node.label)
          }
        }}
      >
        {hasChildren && (
          <span className={`tree-arrow ${expanded ? 'expanded' : ''}`} aria-hidden="true">▶</span>
        )}
        {!hasChildren && <span className="tree-arrow-placeholder" aria-hidden="true" />}
        <Icon preserveOriginalColors name={getTreeNodeIconName(node, expanded)} size={16} />
        <span
          className={`tree-label${node.unused ? ' tree-label-unused' : ''}`}
          title={node.unused ? '该子程序未被任何代码调用' : undefined}
        >
          {node.label}
        </span>
        {shouldShowModifiedDot && (
          <span
            className={`tree-item-modified-dot${isAiModifiedFile ? ' tree-item-modified-dot-ai' : ''}`}
            title={isAiModifiedFile ? '未保存更改（AI 修改）' : '未保存更改'}
            aria-label={isAiModifiedFile ? '未保存更改（AI 修改）' : '未保存更改'}
          >●</span>
        )}
      </div>
      {hasChildren && expanded && (
        <ul>
          {node.children!.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              activeFileId={activeFileId}
              focusedItemId={focusedItemId}
              onFocusItem={onFocusItem}
              modifiedFileKeys={modifiedFileKeys}
              aiModifiedFileKeys={aiModifiedFileKeys}
              onProjectContextMenu={onProjectContextMenu}
              onNodeContextMenu={onNodeContextMenu}
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
  commands: Array<{
    name: string
    englishName?: string
    category: string
    description: string
    returnType?: string
    supportedPlatforms?: string[]
    params?: Array<{
      name: string
      type: string
      description?: string
      optional?: boolean
      isVariable?: boolean
      isArray?: boolean
    }>
    isHidden: boolean
  }>
  dataTypes: Array<{ name: string; description: string }>
  windowUnits: LibWindowUnit[]
}

interface LibraryHintInfo {
  title: string
  lines: string[]
}

const TYPE_ENGLISH_MAP: Record<string, string> = {
  '整数型': 'int',
  '短整数型': 'short',
  '长整数型': 'long',
  '小数型': 'float',
  '双精度小数型': 'double',
  '逻辑型': 'bool',
  '文本型': 'text',
  '字节型': 'byte',
  '日期时间型': 'datetime',
  '字节集': 'bin',
  '子程序指针': 'subptr',
  '通用型': 'all',
}

function toDisplayEnglishCommandName(englishName: string | undefined, commandName: string): string {
  const raw = (englishName || '').trim()
  if (!raw) return commandName
  const dot = raw.lastIndexOf('.')
  if (dot < 0) return raw
  return raw.slice(dot + 1) || raw
}

function getCommandLongDescription(command: {
  name: string
  englishName?: string
  description: string
}): string {
  return command.description?.trim() || '暂无说明。'
}

function formatPlatformLabel(platform: string): string {
  const key = platform.toLowerCase()
  if (key === 'windows') return 'Windows'
  if (key === 'linux') return 'Linux'
  if (key === 'macos') return 'macOS'
  if (key === 'android') return 'Android'
  if (key === 'ios') return 'iOS'
  if (key === 'harmony') return 'HarmonyOS'
  return platform
}

function getOperatingSystemSupportText(platforms: string[] | undefined): string {
  const normalized = Array.from(new Set((platforms || []).map(formatPlatformLabel)))
  if (normalized.length === 0) return '暂无说明。'
  return normalized.join('、')
}

function buildCommandHint(
  command: {
    name: string
    englishName?: string
    category: string
    description: string
    returnType?: string
    supportedPlatforms?: string[]
    params?: Array<{
      name: string
      type: string
      description?: string
      optional?: boolean
      repeatable?: boolean
      isVariable?: boolean
      isArray?: boolean
    }>
  },
  libraryDisplayName: string,
  categoryName: string,
): LibraryHintInfo {
  const commandParams = command.params || []
  const retLabel = command.returnType ? `〈${command.returnType}〉` : '〈无返回值〉'
  const paramSig = commandParams.length > 0
    ? commandParams.map(param => {
        let text = ''
        if (param.optional) text += '［'
        text += `${param.type}${param.isArray ? '数组' : ''} ${param.name}`
        if (param.repeatable) text += '...'
        if (param.optional) text += '］'
        return text
      }).join('，')
    : ''
  const source = `${libraryDisplayName}->${categoryName}`
  const englishName = toDisplayEnglishCommandName(command.englishName, command.name)
  const lines: string[] = [
    `英文名称：${englishName}`,
    getCommandLongDescription(command),
  ]

  commandParams.forEach((param, index) => {
    const englishType = TYPE_ENGLISH_MAP[param.type]
    const typeLabel = englishType ? `${param.type}（${englishType}）` : param.type
    lines.push(`参数<${index + 1}>的名称为“${param.name}”，类型为“${typeLabel}”${param.repeatable ? '，可重复追加' : ''}。${param.description || ''}`.trim())
  })

  lines.push('')
  lines.push(`操作系统支持： ${getOperatingSystemSupportText(command.supportedPlatforms)}`)

  return {
    title: `调用格式： ${retLabel} ${command.name} （${paramSig}） - ${source}`,
    lines,
  }
}

function LibraryPanel({ onHint }: { onHint?: (hint: LibraryHintInfo) => void }): React.JSX.Element {
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

      const windowUnits = detail.windowUnits || []
      const windowUnitMap = new Map(windowUnits.map(unit => [unit.name, unit]))
      const plainDataTypes = detail.dataTypes.filter(dt => !windowUnitMap.has(dt.name))

      if (windowUnits.length > 0 || plainDataTypes.length > 0) {
        const dtGroupId = getLibraryItemId('dt-group', lib.name)
        ids.push(dtGroupId)
        const dtKey = `${lib.name}::__dt__`
        if (expandedCats.has(dtKey)) {
          for (const unit of windowUnits) {
            const unitId = getLibraryItemId('dt-unit', lib.name, unit.name)
            ids.push(unitId)
            const unitKey = `${lib.name}::__dtunit__::${unit.name}`
            if (!expandedCats.has(unitKey)) continue

            if (unit.properties.length > 0) {
              const propGroupId = getLibraryItemId('dt-unit-prop-group', lib.name, unit.name)
              ids.push(propGroupId)
              const propKey = `${lib.name}::__dtunitprop__::${unit.name}`
              if (expandedCats.has(propKey)) {
                for (const prop of unit.properties) {
                  ids.push(getLibraryItemId('dt-unit-prop', lib.name, unit.name, prop.name))
                }
              }
            }

            if (unit.events.length > 0) {
              const eventGroupId = getLibraryItemId('dt-unit-event-group', lib.name, unit.name)
              ids.push(eventGroupId)
              const eventKey = `${lib.name}::__dtunitevent__::${unit.name}`
              if (expandedCats.has(eventKey)) {
                for (const event of unit.events) {
                  ids.push(getLibraryItemId('dt-unit-event', lib.name, unit.name, event.name))
                }
              }
            }
          }

          for (const dt of plainDataTypes) {
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
    const treeRoot = currentItem.closest('.tree')
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
    const parentLi = currentItem.parentElement?.parentElement?.closest('.tree-node')
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

  const applyLibrarySelection = useCallback((itemId: string, hintInfo: LibraryHintInfo) => {
    setFocusedLibraryItemId(itemId)
    onHint?.(hintInfo)
  }, [onHint])

  return (
    <div className="sidebar-panel">
      <div className="library-tree-wrap">
        <ul className="tree" aria-label="支持库列表">
        {loadedLibs.map(lib => {
          const isExpanded = expandedLibs.has(lib.name)
          const detail = libDetails[lib.name]
          const windowUnits = detail?.windowUnits || []
          const windowUnitMap = new Map(windowUnits.map(unit => [unit.name, unit]))
          const plainDataTypes = detail ? detail.dataTypes.filter(dt => !windowUnitMap.has(dt.name)) : []
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
            <li key={lib.name} className="tree-node">
              {(() => {
                const libItemId = getLibraryItemId('lib', lib.name)
                const isRovingFocused = focusedLibraryItemId ? focusedLibraryItemId === libItemId : visibleLibraryItemIds[0] === libItemId
                return (
              <div
                className="tree-item tree-branch"
                data-library-item="true"
                aria-label={`支持库 ${lib.libName || lib.name}，${isExpanded ? '已展开' : '已折叠'}`}
                ref={(element) => setCssVars(element, {
                  '--tree-item-padding-left': 'var(--tree-indent-base, 8px)',
                })}
                tabIndex={isRovingFocused ? 0 : -1}
                onFocus={() => setFocusedLibraryItemId(libItemId)}
                onClick={() => {
                  applyLibrarySelection(libItemId, {
                    title: `支持库：${lib.libName || lib.name}`,
                    lines: [
                      detail?.description || '暂无说明。',
                      `版本：${detail?.version || '未知'}，作者：${detail?.author || '未知'}`,
                    ],
                  })
                  void toggleLib(lib.name)
                }}
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
                <ul>
                  {/* 数据类型分组 */}
                  {(windowUnits.length > 0 || plainDataTypes.length > 0) && (() => {
                    const dtKey = `${lib.name}::__dt__`
                    const dtExpanded = expandedCats.has(dtKey)
                    const dtGroupItemId = getLibraryItemId('dt-group', lib.name)
                    const isDtGroupFocused = focusedLibraryItemId ? focusedLibraryItemId === dtGroupItemId : visibleLibraryItemIds[0] === dtGroupItemId
                    return (
                      <li className="tree-node">
                        <div
                          className="tree-item tree-branch"
                          data-library-item="true"
                          aria-label={`数据类型分组，${dtExpanded ? '已展开' : '已折叠'}，共 ${detail.dataTypes.length} 项`}
                          ref={(element) => setCssVars(element, {
                            '--tree-item-padding-left': 'calc(var(--tree-indent-base, 8px) + var(--tree-indent-step, 16px))',
                          })}
                          tabIndex={isDtGroupFocused ? 0 : -1}
                          onFocus={() => setFocusedLibraryItemId(dtGroupItemId)}
                          onClick={() => {
                            applyLibrarySelection(dtGroupItemId, {
                              title: `数据类型：${lib.libName || lib.name}`,
                              lines: [
                                `共 ${windowUnits.length + plainDataTypes.length} 项。`,
                              ],
                            })
                            toggleCat(dtKey)
                          }}
                          onKeyDown={(event) => handleLibraryItemKeyDown(event, { hasChildren: true, expanded: dtExpanded, onToggle: () => toggleCat(dtKey) })}
                        >
                          <span
                            className={`tree-arrow ${dtExpanded ? 'expanded' : ''}`}
                            aria-hidden="true"
                            onClick={(e) => { e.stopPropagation(); toggleCat(dtKey) }}
                          >▶</span>
                          <Icon preserveOriginalColors name="class" size={16} />
                          <span className="tree-label">数据类型</span>
                          <span className="tree-badge">{windowUnits.length + plainDataTypes.length}</span>
                        </div>
                        {dtExpanded && (
                          <ul>
                            {windowUnits.map(unit => {
                              const unitKey = `${lib.name}::__dtunit__::${unit.name}`
                              const unitExpanded = expandedCats.has(unitKey)
                              const unitItemId = getLibraryItemId('dt-unit', lib.name, unit.name)
                              const isUnitFocused = focusedLibraryItemId ? focusedLibraryItemId === unitItemId : visibleLibraryItemIds[0] === unitItemId
                              const hasUnitChildren = unit.properties.length > 0 || unit.events.length > 0
                              const unitIcon = resolveUnitIconName(unit.name, unit.iconFileName, unit.libraryName)

                              return (
                                <li key={unit.name} className="tree-node">
                                  <div
                                    className={`tree-item ${hasUnitChildren ? 'tree-branch' : 'tree-leaf'}`}
                                    data-library-item="true"
                                    aria-label={`窗口组件 ${unit.name}，${hasUnitChildren ? (unitExpanded ? '已展开' : '已折叠') : '无子项'}`}
                                    ref={(element) => setCssVars(element, {
                                      '--tree-item-padding-left': 'calc(var(--tree-indent-base, 8px) + var(--tree-indent-step, 16px) * 2)',
                                    })}
                                    tabIndex={isUnitFocused ? 0 : -1}
                                    onFocus={() => setFocusedLibraryItemId(unitItemId)}
                                    onClick={() => {
                                      applyLibrarySelection(unitItemId, {
                                        title: `组件名称：${unit.name}`,
                                        lines: [
                                          unit.description || '暂无说明。',
                                          `属性 ${unit.properties.length} 项，事件 ${unit.events.length} 项。`,
                                        ],
                                      })
                                      if (hasUnitChildren) toggleCat(unitKey)
                                    }}
                                    onKeyDown={(event) => handleLibraryItemKeyDown(event, {
                                      hasChildren: hasUnitChildren,
                                      expanded: unitExpanded,
                                      onToggle: hasUnitChildren ? () => toggleCat(unitKey) : undefined,
                                    })}
                                  >
                                    {hasUnitChildren
                                      ? (
                                        <span
                                          className={`tree-arrow ${unitExpanded ? 'expanded' : ''}`}
                                          aria-hidden="true"
                                          onClick={(e) => { e.stopPropagation(); toggleCat(unitKey) }}
                                        >▶</span>
                                        )
                                      : <span className="tree-arrow-placeholder" aria-hidden="true" />}
                                    <Icon preserveOriginalColors name={unitIcon} size={16} />
                                    <span className="tree-label">{unit.name}</span>
                                  </div>

                                  {hasUnitChildren && unitExpanded && (
                                    <ul>
                                      {unit.properties.length > 0 && (() => {
                                        const propKey = `${lib.name}::__dtunitprop__::${unit.name}`
                                        const propExpanded = expandedCats.has(propKey)
                                        const propGroupItemId = getLibraryItemId('dt-unit-prop-group', lib.name, unit.name)
                                        const isPropGroupFocused = focusedLibraryItemId ? focusedLibraryItemId === propGroupItemId : visibleLibraryItemIds[0] === propGroupItemId
                                        return (
                                          <li className="tree-node">
                                            <div
                                              className="tree-item tree-branch"
                                              data-library-item="true"
                                              aria-label={`属性分组，${propExpanded ? '已展开' : '已折叠'}，共 ${unit.properties.length} 项`}
                                              ref={(element) => setCssVars(element, {
                                                '--tree-item-padding-left': 'calc(var(--tree-indent-base, 8px) + var(--tree-indent-step, 16px) * 3)',
                                              })}
                                              tabIndex={isPropGroupFocused ? 0 : -1}
                                              onFocus={() => setFocusedLibraryItemId(propGroupItemId)}
                                              onClick={() => {
                                                applyLibrarySelection(propGroupItemId, {
                                                  title: `属性分组：${unit.name}`,
                                                  lines: [
                                                    `该组件共 ${unit.properties.length} 个属性。`,
                                                  ],
                                                })
                                                toggleCat(propKey)
                                              }}
                                              onKeyDown={(event) => handleLibraryItemKeyDown(event, { hasChildren: true, expanded: propExpanded, onToggle: () => toggleCat(propKey) })}
                                            >
                                              <span
                                                className={`tree-arrow ${propExpanded ? 'expanded' : ''}`}
                                                aria-hidden="true"
                                                onClick={(e) => { e.stopPropagation(); toggleCat(propKey) }}
                                              >▶</span>
                                              <Icon preserveOriginalColors name="property" size={16} />
                                              <span className="tree-label">属性</span>
                                              <span className="tree-badge">{unit.properties.length}</span>
                                            </div>
                                            {propExpanded && (
                                              <ul>
                                                {unit.properties.map(prop => {
                                                  const propItemId = getLibraryItemId('dt-unit-prop', lib.name, unit.name, prop.name)
                                                  const isPropFocused = focusedLibraryItemId ? focusedLibraryItemId === propItemId : visibleLibraryItemIds[0] === propItemId
                                                  return (
                                                    <li key={prop.name} className="tree-node">
                                                      <div
                                                        className="tree-item tree-leaf"
                                                        data-library-item="true"
                                                        aria-label={`属性 ${prop.name}${prop.typeName ? `，${prop.typeName}` : ''}`}
                                                        ref={(element) => setCssVars(element, {
                                                          '--tree-item-padding-left': 'calc(var(--tree-indent-base, 8px) + var(--tree-indent-step, 16px) * 4)',
                                                        })}
                                                        title={prop.description || prop.typeName}
                                                        tabIndex={isPropFocused ? 0 : -1}
                                                        onFocus={() => setFocusedLibraryItemId(propItemId)}
                                                        onClick={() => applyLibrarySelection(propItemId, {
                                                          title: `属性名称：${prop.name}`,
                                                          lines: [
                                                            prop.description || '暂无说明。',
                                                            `属性类型：${prop.typeName || '未知'}${prop.isReadOnly ? '（只读）' : ''}`,
                                                          ],
                                                        })}
                                                        onKeyDown={(event) => handleLibraryItemKeyDown(event, { hasChildren: false })}
                                                      >
                                                        <span className="tree-arrow-placeholder" aria-hidden="true" />
                                                        <Icon preserveOriginalColors name="property" size={16} />
                                                        <span className="tree-label">{prop.name}</span>
                                                      </div>
                                                    </li>
                                                  )
                                                })}
                                              </ul>
                                            )}
                                          </li>
                                        )
                                      })()}

                                      {unit.events.length > 0 && (() => {
                                        const eventKey = `${lib.name}::__dtunitevent__::${unit.name}`
                                        const eventExpanded = expandedCats.has(eventKey)
                                        const eventGroupItemId = getLibraryItemId('dt-unit-event-group', lib.name, unit.name)
                                        const isEventGroupFocused = focusedLibraryItemId ? focusedLibraryItemId === eventGroupItemId : visibleLibraryItemIds[0] === eventGroupItemId
                                        return (
                                          <li className="tree-node">
                                            <div
                                              className="tree-item tree-branch"
                                              data-library-item="true"
                                              aria-label={`事件分组，${eventExpanded ? '已展开' : '已折叠'}，共 ${unit.events.length} 项`}
                                              ref={(element) => setCssVars(element, {
                                                '--tree-item-padding-left': 'calc(var(--tree-indent-base, 8px) + var(--tree-indent-step, 16px) * 3)',
                                              })}
                                              tabIndex={isEventGroupFocused ? 0 : -1}
                                              onFocus={() => setFocusedLibraryItemId(eventGroupItemId)}
                                              onClick={() => {
                                                applyLibrarySelection(eventGroupItemId, {
                                                  title: `事件分组：${unit.name}`,
                                                  lines: [
                                                    `该组件共 ${unit.events.length} 个事件。`,
                                                  ],
                                                })
                                                toggleCat(eventKey)
                                              }}
                                              onKeyDown={(event) => handleLibraryItemKeyDown(event, { hasChildren: true, expanded: eventExpanded, onToggle: () => toggleCat(eventKey) })}
                                            >
                                              <span
                                                className={`tree-arrow ${eventExpanded ? 'expanded' : ''}`}
                                                aria-hidden="true"
                                                onClick={(e) => { e.stopPropagation(); toggleCat(eventKey) }}
                                              >▶</span>
                                              <Icon preserveOriginalColors name="event" size={16} />
                                              <span className="tree-label">事件</span>
                                              <span className="tree-badge">{unit.events.length}</span>
                                            </div>
                                            {eventExpanded && (
                                              <ul>
                                                {unit.events.map(evt => {
                                                  const eventItemId = getLibraryItemId('dt-unit-event', lib.name, unit.name, evt.name)
                                                  const isEventFocused = focusedLibraryItemId ? focusedLibraryItemId === eventItemId : visibleLibraryItemIds[0] === eventItemId
                                                  return (
                                                    <li key={evt.name} className="tree-node">
                                                      <div
                                                        className="tree-item tree-leaf"
                                                        data-library-item="true"
                                                        aria-label={`事件 ${evt.name}${evt.args.length > 0 ? `，参数 ${evt.args.length} 个` : ''}`}
                                                        ref={(element) => setCssVars(element, {
                                                          '--tree-item-padding-left': 'calc(var(--tree-indent-base, 8px) + var(--tree-indent-step, 16px) * 4)',
                                                        })}
                                                        title={evt.description}
                                                        tabIndex={isEventFocused ? 0 : -1}
                                                        onFocus={() => setFocusedLibraryItemId(eventItemId)}
                                                        onClick={() => {
                                                          const eventLines = [
                                                            evt.description || '暂无说明。',
                                                          ]
                                                          if (evt.args.length > 0) {
                                                            eventLines.push(`事件参数：${evt.args.map(arg => arg.name).join('、')}`)
                                                          }
                                                          applyLibrarySelection(eventItemId, {
                                                            title: `事件名称：${evt.name}`,
                                                            lines: eventLines,
                                                          })
                                                        }}
                                                        onKeyDown={(event) => handleLibraryItemKeyDown(event, { hasChildren: false })}
                                                      >
                                                        <span className="tree-arrow-placeholder" aria-hidden="true" />
                                                        <Icon preserveOriginalColors name="event" size={16} />
                                                        <span className="tree-label">{evt.name}</span>
                                                      </div>
                                                    </li>
                                                  )
                                                })}
                                              </ul>
                                            )}
                                          </li>
                                        )
                                      })()}
                                    </ul>
                                  )}
                                </li>
                              )
                            })}

                            {plainDataTypes.map(dt => (
                              <li key={dt.name} className="tree-node">
                                <div className="tree-item tree-leaf" data-library-item="true" aria-label={`数据类型 ${dt.name}${dt.description ? `，${dt.description}` : ''}`}
                                  ref={(element) => setCssVars(element, {
                                    '--tree-item-padding-left': 'calc(var(--tree-indent-base, 8px) + var(--tree-indent-step, 16px) * 2)',
                                  })}
                                  title={dt.description}
                                  tabIndex={(focusedLibraryItemId ? focusedLibraryItemId === getLibraryItemId('dt', lib.name, dt.name) : visibleLibraryItemIds[0] === getLibraryItemId('dt', lib.name, dt.name)) ? 0 : -1}
                                  onFocus={() => setFocusedLibraryItemId(getLibraryItemId('dt', lib.name, dt.name))}
                                  onClick={() => applyLibrarySelection(getLibraryItemId('dt', lib.name, dt.name), {
                                    title: `数据类型：${dt.name}`,
                                    lines: [
                                      dt.description || '暂无说明。',
                                      `所属支持库：${lib.libName || lib.name}`,
                                    ],
                                  })}
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
                      <li key={cat} className="tree-node">
                        <div
                          className="tree-item tree-branch"
                          data-library-item="true"
                          aria-label={`命令分类 ${cat}，${catExpanded ? '已展开' : '已折叠'}，共 ${cmds.length} 项`}
                          ref={(element) => setCssVars(element, {
                            '--tree-item-padding-left': 'calc(var(--tree-indent-base, 8px) + var(--tree-indent-step, 16px))',
                          })}
                          tabIndex={isCatFocused ? 0 : -1}
                          onFocus={() => setFocusedLibraryItemId(catItemId)}
                          onClick={() => {
                            applyLibrarySelection(catItemId, {
                              title: `命令分类：${cat}`,
                              lines: [
                                `该分类共 ${cmds.length} 条命令。`,
                                `所属支持库：${lib.libName || lib.name}`,
                              ],
                            })
                            toggleCat(catKey)
                          }}
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
                          <ul>
                            {cmds.map(cmd => (
                              <li key={cmd.name} className="tree-node">
                                <div className="tree-item tree-leaf" data-library-item="true" aria-label={`命令 ${cmd.name}${cmd.description ? `，${cmd.description}` : ''}`}
                                  ref={(element) => setCssVars(element, {
                                    '--tree-item-padding-left': 'calc(var(--tree-indent-base, 8px) + var(--tree-indent-step, 16px) * 2)',
                                  })}
                                  title={cmd.description}
                                  tabIndex={(focusedLibraryItemId ? focusedLibraryItemId === getLibraryItemId('cmd', lib.name, cat, cmd.name) : visibleLibraryItemIds[0] === getLibraryItemId('cmd', lib.name, cat, cmd.name)) ? 0 : -1}
                                  onFocus={() => setFocusedLibraryItemId(getLibraryItemId('cmd', lib.name, cat, cmd.name))}
                                  onClick={() => applyLibrarySelection(
                                    getLibraryItemId('cmd', lib.name, cat, cmd.name),
                                    buildCommandHint(
                                      cmd,
                                      lib.name === 'krnln' ? '系统核心支持库' : (lib.libName || lib.name),
                                      cat,
                                    ),
                                  )}
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
  if (prop.defaultValue !== undefined) return prop.defaultValue
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
function EditableIntCell({ value, onChange, ariaLabel = '数值', disabled = false }: { value: number; onChange: (v: number) => void; ariaLabel?: string; disabled?: boolean }): React.JSX.Element {
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

  // 禁用（如非圆角矩形时的圆角半径）：灰显只读；须置于所有 Hook 之后，避免 Hook 数量随 disabled 变化
  if (disabled) {
    return <span className="prop-value-text prop-value-disabled" aria-label={buildEditableAriaLabel(ariaLabel, String(value))}>{value}</span>
  }

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

/** 常用颜色值的中文名（与易语言属性面板显示一致） */
const COMMON_COLOR_NAMES: Record<number, string> = {
  0x000000: '黑色',
  0xffffff: '白色',
  0x0000ff: '红色',
  0x00ff00: '绿色',
  0xff0000: '蓝色',
  0x00ffff: '黄色',
  0xffff00: '青色',
  0xff00ff: '紫红色',
  0x808080: '灰色',
}

// COLORREF(0xBBGGRR) → #RRGGBB
function colorrefToHexStr(n: number): string {
  const c = Number.isFinite(n) ? (Math.max(0, Math.trunc(n)) & 0xffffff) : 0
  const r = c & 0xff, g = (c >> 8) & 0xff, b = (c >> 16) & 0xff
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}
// #RRGGBB（可含或不含 #、大小写不限）→ COLORREF；无效返回 null
function hexStrToColorref(text: string): number | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(text.trim())
  if (!m) return null
  const v = Number.parseInt(m[1], 16)
  return ((v >> 16) & 0xff) | (((v >> 8) & 0xff) << 8) | ((v & 0xff) << 16)
}

/** 可编辑颜色属性单元格：色块弹系统取色器 + 可直接输入/粘贴/复制 #RRGGBB；存储 COLORREF（0xBBGGRR） */
function EditableColorCell({ value, onChange, ariaLabel = '颜色' }: { value: number; onChange: (v: number) => void; ariaLabel?: string }): React.JSX.Element {
  const n = Number.isFinite(value) ? (Math.max(0, Math.trunc(value)) & 0xffffff) : 0
  const hex = colorrefToHexStr(n)
  const [draft, setDraft] = useState(hex)
  useEffect(() => { setDraft(hex) }, [hex])
  // 颜色选择器按住滑动会连发大量 onChange；每次都触发整窗体 setTabs + 撤销栈的全量 JSON.stringify 比较，
  // 高频（叠加窗体里的底图/图片 base64）会拖垮渲染进程直至崩溃。故节流到 ~90ms 提交一次（滑块本地即时预览），
  // 并保证最后一个值一定被提交（尾随 flush + blur flush）。
  const pendingRef = useRef<number | null>(null)
  const lastTimeRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flush = (): void => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (pendingRef.current !== null) { const v = pendingRef.current; pendingRef.current = null; lastTimeRef.current = Date.now(); onChange(v) }
  }
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  const throttledCommit = (cr: number): void => {
    pendingRef.current = cr
    if (Date.now() - lastTimeRef.current >= 90) flush()
    else if (!timerRef.current) timerRef.current = setTimeout(flush, 90)
  }
  const commitHex = (): void => {
    const cr = hexStrToColorref(draft)
    if (cr !== null) onChange(cr)
    else setDraft(hex)  // 无效回退
  }
  const swatchHex = /^#[0-9a-fA-F]{6}$/.test(draft) ? draft : hex
  return (
    <span className="prop-color-cell">
      <input
        className="prop-color-input"
        type="color"
        aria-label={buildEditableAriaLabel(ariaLabel, hex)}
        value={swatchHex}
        onChange={e => { setDraft(e.target.value); throttledCommit(hexStrToColorref(e.target.value) ?? n) }}
        onBlur={flush}
      />
      <input
        className="prop-color-hex"
        type="text"
        aria-label={`${ariaLabel} 十六进制值，可粘贴 #RRGGBB`}
        value={draft}
        spellCheck={false}
        onChange={e => setDraft(e.target.value)}
        onBlur={commitHex}
        onKeyDown={e => { if (e.key === 'Enter') { commitHex(); (e.target as HTMLInputElement).blur() } }}
      />
    </span>
  )
}

/** 可编辑图片属性单元格（文件选择 → base64 data URL） */
function EditableImageCell({ value, onChange, ariaLabel = '图片' }: { value: string; onChange: (v: string) => void; ariaLabel?: string }): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const hasImage = typeof value === 'string' && value.startsWith('data:image')
  const pickFile = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      if (result) onChange(result)
    }
    reader.readAsDataURL(file)
    // 允许再次选择同一文件
    e.target.value = ''
  }
  return (
    <div className="prop-image-cell">
      <input
        ref={inputRef}
        className="prop-image-input"
        type="file"
        accept="image/*"
        aria-label={buildEditableAriaLabel(ariaLabel)}
        onChange={pickFile}
      />
      {hasImage && <img className="prop-image-thumb" src={value} alt="" />}
      <button type="button" className="prop-image-btn" onClick={() => inputRef.current?.click()}>
        {hasImage ? '更换' : '选择...'}
      </button>
      {hasImage && (
        <button type="button" className="prop-image-btn prop-image-clear" onClick={() => onChange('')}>清除</button>
      )}
    </div>
  )
}

/** 子夹表单元格：点「编辑…」打开子夹管理弹窗（值=换行分隔的子夹标题） */
function EditableTabListCell({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const titles = String(value || '').split('\n').map(t => t.trim()).filter(Boolean)
  const summary = titles.length ? `${titles.length} 个：${titles.join('/').slice(0, 20)}` : '（无子夹）'
  return (
    <span className="prop-font-cell">
      <button type="button" className="prop-font-btn" aria-label="子夹管理" onClick={() => setOpen(true)}>{summary} · 编辑…</button>
      {open && (
        <ChildTabEditorDialog
          titles={String(value || '')}
          controlName="选择夹"
          onSave={(t) => { onChange(t); setOpen(false) }}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  )
}

/** 可编辑字体属性单元格（点击弹出可拖动的浮动字体对话框，避免被侧栏裁剪；值以 JSON 字符串存） */
function EditableFontCell({ value, onChange, ariaLabel = '字体' }: { value: string; onChange: (v: string) => void; ariaLabel?: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const spec = parseFontSpec(value)
  const cur: FontSpec = spec || { name: DEFAULT_FONT_NAME, size: DEFAULT_FONT_SIZE }
  const update = (patch: Partial<FontSpec>): void => onChange(stringifyFontSpec({ ...cur, ...patch }))
  // 文本颜色滑动同样会连发 → 节流提交（与 EditableColorCell 同因：高频全窗体更新+撤销栈 JSON.stringify 会崩渲染进程）。
  const colorPendRef = useRef<number | null>(null)
  const colorLastRef = useRef(0)
  const colorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushColor = (): void => {
    if (colorTimerRef.current) { clearTimeout(colorTimerRef.current); colorTimerRef.current = null }
    if (colorPendRef.current !== null) { const c = colorPendRef.current; colorPendRef.current = null; colorLastRef.current = Date.now(); update({ color: c }) }
  }
  const throttleColor = (cr: number): void => {
    colorPendRef.current = cr
    if (Date.now() - colorLastRef.current >= 90) flushColor()
    else if (!colorTimerRef.current) colorTimerRef.current = setTimeout(flushColor, 90)
  }
  useEffect(() => () => { if (colorTimerRef.current) clearTimeout(colorTimerRef.current) }, [])
  // 打开时居中，关闭时清位置
  useEffect(() => {
    if (open && pos === null) setPos({ x: Math.max(8, Math.round(window.innerWidth / 2 - 140)), y: Math.max(8, Math.round(window.innerHeight / 2 - 140)) })
    if (!open) setPos(null)
  }, [open, pos])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  // 标题栏拖动
  const startDrag = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX, startY = e.clientY
    const orig = pos || { x: 0, y: 0 }
    const onMove = (ev: MouseEvent): void => {
      const nx = Math.min(Math.max(0, orig.x + (ev.clientX - startX)), window.innerWidth - 120)
      const ny = Math.min(Math.max(0, orig.y + (ev.clientY - startY)), window.innerHeight - 36)
      setPos({ x: nx, y: ny })
    }
    const onUp = (): void => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }
  const previewStyle = fontSpecToCss(cur) as React.CSSProperties
  return (
    <div className="prop-font-cell">
      <button type="button" className="prop-font-btn" aria-label={buildEditableAriaLabel(ariaLabel)} onClick={() => setOpen(true)}>
        {formatFontSummary(spec)}
      </button>
      {open && pos && createPortal(
        <div className="prop-font-dialog" role="dialog" aria-label="字体" style={{ left: `${pos.x}px`, top: `${pos.y}px` }}>
          <div className="prop-font-dialog-title" onMouseDown={startDrag}>
            <span>字体</span>
            <button type="button" className="prop-font-close" aria-label="关闭" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="prop-font-body">
            <label className="prop-font-row">字体
              <select value={cur.name} onChange={e => update({ name: e.target.value })}>
                {(COMMON_FONT_FAMILIES.includes(cur.name) ? COMMON_FONT_FAMILIES : [cur.name, ...COMMON_FONT_FAMILIES]).map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="prop-font-row">大小
              <input type="number" min={1} max={200} value={cur.size} onChange={e => update({ size: Number(e.target.value) || DEFAULT_FONT_SIZE })} />
            </label>
            <div className="prop-font-styles">
              <label><input type="checkbox" checked={!!cur.bold} onChange={e => update({ bold: e.target.checked })} />粗体</label>
              <label><input type="checkbox" checked={!!cur.italic} onChange={e => update({ italic: e.target.checked })} />斜体</label>
              <label><input type="checkbox" checked={!!cur.underline} onChange={e => update({ underline: e.target.checked })} />下划线</label>
              <label><input type="checkbox" checked={!!cur.strikeout} onChange={e => update({ strikeout: e.target.checked })} />删除线</label>
            </div>
            <label className="prop-font-row">文本颜色
              <span className="prop-font-color">
                <input type="color" value={colorrefToHex(cur.color ?? 0)} onChange={e => throttleColor(hexToColorref(e.target.value))} onBlur={flushColor} />
                <input
                  className="prop-font-color-hex"
                  type="text"
                  spellCheck={false}
                  aria-label="文本颜色十六进制值，可粘贴 #RRGGBB"
                  value={cur.color !== undefined ? colorrefToHex(cur.color) : ''}
                  placeholder="#RRGGBB"
                  onChange={e => { const cr = hexStrToColorref(e.target.value); if (cr !== null) update({ color: cr }) }}
                />
                {cur.color !== undefined && <button type="button" className="prop-font-color-reset" onClick={() => update({ color: undefined })}>默认</button>}
              </span>
            </label>
            <div className="prop-font-preview" style={previewStyle}>字体示例 AaBbCc 你好 123</div>
            <div className="prop-font-actions">
              <button type="button" className="prop-font-reset" onClick={() => { onChange(''); setOpen(false) }}>清除（用默认字体）</button>
              <button type="button" className="prop-font-ok" onClick={() => setOpen(false)}>完成</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

/** 可编辑逻辑型属性单元格（下拉选择） */
function EditableBoolCell({ value, onChange, ariaLabel = '布尔值', disabled = false }: { value: boolean; onChange: (v: boolean) => void; ariaLabel?: string; disabled?: boolean }): React.JSX.Element {
  return (
    <select
      className="prop-edit-select"
      aria-label={buildEditableAriaLabel(ariaLabel)}
      value={value ? '1' : '0'}
      disabled={disabled}
      onChange={e => onChange(e.target.value === '1')}
    >
      <option value="1">真</option>
      <option value="0">假</option>
    </select>
  )
}

/** 可编辑枚举/选择属性单元格（下拉框） */
function EditablePickCell({ value, options, onChange, ariaLabel = '选项', disabled = false }: { value: number; options: string[]; onChange: (v: number) => void; ariaLabel?: string; disabled?: boolean }): React.JSX.Element {
  return (
    <select
      className="prop-edit-select"
      aria-label={buildEditableAriaLabel(ariaLabel)}
      value={value}
      disabled={disabled}
      onChange={e => onChange(parseInt(e.target.value, 10))}
    >
      {options.map((opt, i) => (
        <option key={i} value={i}>{opt}</option>
      ))}
    </select>
  )
}

/** 根据属性类型渲染对应的可编辑单元格 */
function renderEditableCell(prop: LibUnitProperty, val: string | number | boolean, onChange: (v: string | number | boolean) => void, disabled = false): React.JSX.Element {
  // 有 pickOptions → 下拉选择
  if (prop.pickOptions.length > 0 && typeof val === 'number') {
    return <EditablePickCell value={val} options={prop.pickOptions} ariaLabel={prop.name} disabled={disabled} onChange={v => onChange(v)} />
  }
  // 逻辑型 → 单击切换
  if (prop.typeName === '逻辑型') {
    return <EditableBoolCell value={!!val} ariaLabel={prop.name} disabled={disabled} onChange={v => onChange(v)} />
  }
  // 颜色类型 → 色块 + 系统颜色选择器
  if (prop.typeName === '颜色' || prop.typeName === '颜色(透明)' || prop.typeName === '背景颜色') {
    return <EditableColorCell value={typeof val === 'number' ? val : Number(val) || 0} ariaLabel={prop.name} onChange={v => onChange(v)} />
  }
  // 图片类型 → 文件选择器（存 base64 data URL）
  if (prop.typeName === '图片') {
    return <EditableImageCell value={typeof val === 'string' ? val : ''} ariaLabel={prop.name} onChange={v => onChange(v)} />
  }
  // 字体类型 → 自绘字体选择器（值以 JSON 字符串存）
  if (prop.typeName === '字体') {
    return <EditableFontCell value={typeof val === 'string' ? val : ''} ariaLabel={prop.name} onChange={v => onChange(v)} />
  }
  // 子夹表 → 打开子夹管理弹窗（值=换行分隔的子夹标题）
  if (prop.typeName === '子夹表') {
    return <EditableTabListCell value={typeof val === 'string' ? val : ''} onChange={v => onChange(v)} />
  }
  // 整数型 / 小数型等数值类型
  if (prop.typeName === '整数型' || prop.typeName === '小数型' || prop.typeName === '选择整数' || prop.typeName === '选择特定整数') {
    return <EditableIntCell value={typeof val === 'number' ? val : 0} ariaLabel={prop.name} disabled={disabled} onChange={v => onChange(v)} />
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
              (() => {
                // 无边框时无标题栏 → 控制按钮及其下级（最大化/最小化按钮）全禁用；
                // 控制按钮为假时，其下级选项禁用（照易语言，与编译器 border===0 忽略这些位一致）
                const borderProp = windowUnit.properties.find(p => p.name === '边框')
                const borderVal = borderProp ? Number(resolveFormPropValue(borderProp, f)) : 2
                const borderIsNone = borderVal === 0
                const controlBoxOn = f.properties?.['控制按钮'] !== false
                // 外形=圆角矩形(1) 时其下级「圆角半径」可编辑；矩形/椭圆时禁用（椭圆由窗口尺寸决定曲率，无可调半径）
                const shapeProp = windowUnit.properties.find(p => p.name === '外形')
                const shapeVal = shapeProp ? Number(resolveFormPropValue(shapeProp, f)) : 0
                // 有底图时其下级「底图方式」可切换，无底图时禁用
                const hasBackImage = typeof f.properties?.['底图'] === 'string' && (f.properties['底图'] as string).startsWith('data:image')
                return windowUnit.properties.filter(p => !p.isReadOnly).map(p => {
                  const val = resolveFormPropValue(p, f)
                  const isControlBox = p.name === '控制按钮'
                  const isSubOfControlBox = p.name === '最大化按钮' || p.name === '最小化按钮'
                  const isCornerRadius = p.name === '圆角半径'
                  const isBgMode = p.name === '底图方式'
                  const isSubOption = isSubOfControlBox || isCornerRadius || isBgMode
                  const disabled = (isControlBox && borderIsNone)
                    || (isSubOfControlBox && (borderIsNone || !controlBoxOn))
                    || (isCornerRadius && shapeVal !== 1)
                    || (isBgMode && !hasBackImage)
                  return (
                    <tr key={p.name} className="prop-row">
                      <th className={`prop-name${isSubOption ? ' prop-name-sub' : ''}`} scope="row" title={p.description}>{p.name}</th>
                      <td className="prop-value">
                        {renderEditableCell(p, val, v => onPropertyChange?.('form', null, p.name, v), disabled)}
                      </td>
                    </tr>
                  )
                })
              })()
            ) : (
              <>
                <tr className="prop-row"><th className="prop-name" scope="row">标题</th><td className="prop-value"><EditableTextCell value={f.title} ariaLabel="标题" onChange={v => onPropertyChange?.('form', null, '标题', v)} /></td></tr>
                <tr className="prop-row"><th className="prop-name" scope="row">左边</th><td className="prop-value">0</td></tr>
                <tr className="prop-row"><th className="prop-name" scope="row">顶边</th><td className="prop-value">0</td></tr>
                <tr className="prop-row"><th className="prop-name" scope="row">宽度</th><td className="prop-value"><EditableIntCell value={f.width} ariaLabel="宽度" onChange={v => onPropertyChange?.('form', null, '宽度', v)} /></td></tr>
                <tr className="prop-row"><th className="prop-name" scope="row">高度</th><td className="prop-value"><EditableIntCell value={f.height} ariaLabel="高度" onChange={v => onPropertyChange?.('form', null, '高度', v)} /></td></tr>
                <tr className="prop-row"><th className="prop-name" scope="row">标记</th><td className="prop-value"><EditableTextCell value={String(f.properties?.['标记'] ?? '')} ariaLabel="标记" onChange={v => onPropertyChange?.('form', null, '标记', v)} /></td></tr>
                <tr className="prop-row"><th className="prop-name" scope="row">可视</th><td className="prop-value"><EditableBoolCell value={Boolean(f.properties?.['可视'] ?? true)} ariaLabel="可视" onChange={v => onPropertyChange?.('form', null, '可视', v)} /></td></tr>
                <tr className="prop-row"><th className="prop-name" scope="row">禁止</th><td className="prop-value"><EditableBoolCell value={Boolean(f.properties?.['禁止'] ?? false)} ariaLabel="禁止" onChange={v => onPropertyChange?.('form', null, '禁止', v)} /></td></tr>
                <tr className="prop-row"><th className="prop-name" scope="row">鼠标指针</th><td className="prop-value"><EditablePickCell value={Number(f.properties?.['鼠标指针'] ?? 0)} options={MOUSE_POINTER_PICK_OPTIONS} ariaLabel="鼠标指针" onChange={v => onPropertyChange?.('form', null, '鼠标指针', v)} /></td></tr>
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
            (() => {
              // 可停留焦点为假时，其下级「停留顺序」禁用（Tab 停不到就无所谓顺序）
              const canFocusOn = control.properties['可停留焦点'] !== false
              // 调节器上限值/底限值：仅「自动调节器(1)」时可编辑；无调节器(0)/手动调节器(2) 均禁用
              const spinModeProp = unit.properties.find(p => p.name === '调节器方式')
              const spinModeVal = spinModeProp ? Number(resolveControlPropValue(spinModeProp, control)) : 0
              return unit.properties.filter(p => !p.isReadOnly).map(p => {
                const val = resolveControlPropValue(p, control)
                const isTabOrder = p.name === '停留顺序'
                const isSpinLimit = p.name === '调节器上限值' || p.name === '调节器底限值'
                const isSubOption = isTabOrder || isSpinLimit
                const disabled = (isTabOrder && !canFocusOn) || (isSpinLimit && spinModeVal !== 1)
                return (
                  <tr key={p.name} className="prop-row">
                    <th className={`prop-name${isSubOption ? ' prop-name-sub' : ''}`} scope="row" title={p.description}>{p.name}</th>
                    <td className="prop-value">
                      {renderEditableCell(p, val, v => onPropertyChange?.('control', control.id, p.name, v), disabled)}
                    </td>
                  </tr>
                )
              })
            })()
          ) : (
            <>
              <tr className="prop-row"><th className="prop-name" scope="row">标题</th><td className="prop-value"><EditableTextCell value={control.text} ariaLabel="标题" onChange={v => onPropertyChange?.('control', control.id, '标题', v)} /></td></tr>
              <tr className="prop-row"><th className="prop-name" scope="row">左边</th><td className="prop-value"><EditableIntCell value={control.left} ariaLabel="左边" onChange={v => onPropertyChange?.('control', control.id, '左边', v)} /></td></tr>
              <tr className="prop-row"><th className="prop-name" scope="row">顶边</th><td className="prop-value"><EditableIntCell value={control.top} ariaLabel="顶边" onChange={v => onPropertyChange?.('control', control.id, '顶边', v)} /></td></tr>
              <tr className="prop-row"><th className="prop-name" scope="row">宽度</th><td className="prop-value"><EditableIntCell value={control.width} ariaLabel="宽度" onChange={v => onPropertyChange?.('control', control.id, '宽度', v)} /></td></tr>
              <tr className="prop-row"><th className="prop-name" scope="row">高度</th><td className="prop-value"><EditableIntCell value={control.height} ariaLabel="高度" onChange={v => onPropertyChange?.('control', control.id, '高度', v)} /></td></tr>
              <tr className="prop-row"><th className="prop-name" scope="row">标记</th><td className="prop-value"><EditableTextCell value={String(control.properties['标记'] ?? '')} ariaLabel="标记" onChange={v => onPropertyChange?.('control', control.id, '标记', v)} /></td></tr>
              <tr className="prop-row"><th className="prop-name" scope="row">可视</th><td className="prop-value"><EditableBoolCell value={control.visible} ariaLabel="可视" onChange={v => onPropertyChange?.('control', control.id, '可视', v)} /></td></tr>
              <tr className="prop-row"><th className="prop-name" scope="row">禁止</th><td className="prop-value"><EditableBoolCell value={!control.enabled} ariaLabel="禁止" onChange={v => onPropertyChange?.('control', control.id, '禁止', v)} /></td></tr>
              <tr className="prop-row"><th className="prop-name" scope="row">鼠标指针</th><td className="prop-value"><EditablePickCell value={Number(control.properties['鼠标指针'] ?? 0)} options={MOUSE_POINTER_PICK_OPTIONS} ariaLabel="鼠标指针" onChange={v => onPropertyChange?.('control', control.id, '鼠标指针', v)} /></td></tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  )
}

function Sidebar({ width, onResize, placement = 'left', selection, activeTab, onTabChange, onSelectControl, onPropertyChange, projectTree, onOpenFile, activeFileId, projectDir, openTabs = [], onEventNavigate, onSaveProject, onCloseProject, onLibraryChange, onLibraryHint, onProjectNodeAction, canPasteWindow = false }: SidebarProps): React.JSX.Element {
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
    const dispose = window.api.on('library:loaded', handler)
    return () => { dispose() }
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
  const [tabsPlacement, setTabsPlacement] = useState<SidebarTabsPlacement>(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_TABS_PLACEMENT_KEY)
      return raw === 'top' ? 'top' : 'bottom'
    } catch {
      return 'bottom'
    }
  })
  const [tabsContextMenu, setTabsContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [projectContextMenu, setProjectContextMenu] = useState<{ x: number; y: number; projectDir: string; projectName: string } | null>(null)
  const [nodeContextMenu, setNodeContextMenu] = useState<{ x: number; y: number; nodeId: string; nodeLabel: string; kind: 'category' | 'module' | 'window'; isClassModule: boolean; categoryId: string } | null>(null)

  const { modifiedFileKeys, aiModifiedFileKeys } = useMemo(() => {
    const keys = new Set<string>()
    const aiKeys = new Set<string>()
    for (const tab of openTabs) {
      if (typeof tab.savedValue !== 'string') continue
      const persistedValue = tab.language === 'efw' && tab.formData
        ? JSON.stringify(tab.formData, null, 2)
        : tab.value
      if (persistedValue === tab.savedValue) continue
      const tabPath = tab.filePath || tab.id
      const fileKey = (tabPath || '').replace(/^.*[\\/]/, '').toLowerCase()
      if (!fileKey) continue
      keys.add(fileKey)
      if (tab.aiModified) aiKeys.add(fileKey)
    }
    return { modifiedFileKeys: keys, aiModifiedFileKeys: aiKeys }
  }, [openTabs])
  const eventSubsCacheRef = useRef<Map<string, Set<string>>>(new Map())
  const sidebarTabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const sidebarRef = useRef<HTMLElement>(null)

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

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_TABS_PLACEMENT_KEY, tabsPlacement)
    } catch {
      // ignore
    }
  }, [tabsPlacement])

  useEffect(() => {
    sidebarRef.current?.style.setProperty('--sidebar-width', `${width}px`)
  }, [width])

  useEffect(() => {
    if (!tabsContextMenu) return
    const close = (): void => setTabsContextMenu(null)
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [tabsContextMenu])

  useEffect(() => {
    if (!projectContextMenu) return
    const close = (): void => setProjectContextMenu(null)
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [projectContextMenu])

  useEffect(() => {
    if (!nodeContextMenu) return
    const close = (): void => setNodeContextMenu(null)
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [nodeContextMenu])

  const handleTabsContextMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 220
    const menuX = Math.min(event.clientX, window.innerWidth - menuWidth - 8)
    setTabsContextMenu({ x: Math.max(0, menuX), y: event.clientY })
  }, [])

  const toggleTabsPlacementFromMenu = useCallback(() => {
    setTabsPlacement(prev => (prev === 'top' ? 'bottom' : 'top'))
    setTabsContextMenu(null)
  }, [])

  const handleProjectContextMenu = useCallback((event: React.MouseEvent<HTMLElement>, targetProjectDir: string, targetProjectName: string) => {
    const menuWidth = 260
    const menuX = Math.min(event.clientX, window.innerWidth - menuWidth - 8)
    setProjectContextMenu({
      x: Math.max(0, menuX),
      y: event.clientY,
      projectDir: targetProjectDir,
      projectName: targetProjectName,
    })
  }, [])

  // 分类节点（窗口/程序集/全局变量/常量表/数据类型/DLL命令）、程序集/类模块、窗口 节点的右键菜单
  const handleNodeContextMenu = useCallback((event: React.MouseEvent<HTMLElement>, node: TreeNode) => {
    if (!onProjectNodeAction) return
    const isMenuCategory = node.type === 'folder' && node.id in CATEGORY_CONTEXT_MENU_ITEMS
    const isSourceModule = node.type === 'module' && /\.(eyc|ecc)$/i.test(node.id)
    const isWindowNode = node.type === 'window' && /\.efw$/i.test(node.id)
    if (!isMenuCategory && !isSourceModule && !isWindowNode) return
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 240
    const menuX = Math.min(event.clientX, window.innerWidth - menuWidth - 8)
    setNodeContextMenu({
      x: Math.max(0, menuX),
      y: event.clientY,
      nodeId: node.id,
      nodeLabel: node.label,
      kind: isMenuCategory ? 'category' : isWindowNode ? 'window' : 'module',
      isClassModule: /\.ecc$/i.test(node.id),
      categoryId: isMenuCategory ? node.id : '',
    })
  }, [onProjectNodeAction])

  const fireNodeAction = useCallback((action: ProjectNodeAction) => {
    if (nodeContextMenu) {
      onProjectNodeAction?.(action, { id: nodeContextMenu.nodeId, label: nodeContextMenu.nodeLabel })
    }
    setNodeContextMenu(null)
  }, [nodeContextMenu, onProjectNodeAction])

  const tabsNode = (
    <div
      className={`sidebar-tabs ${tabsPlacement === 'top' ? 'sidebar-tabs-top' : 'sidebar-tabs-bottom'}`}
      role="tablist"
      aria-label="侧边栏面板"
      onContextMenu={handleTabsContextMenu}
    >
      {sidebarTabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(element) => { sidebarTabRefs.current[index] = element }}
          id={`sidebar-tab-${tab.id}`}
          className={`sidebar-tab ${activeTab === tab.id ? 'active' : ''}`}
          role="tab"
          aria-selected={activeTab === tab.id}
          tabIndex={activeTab === tab.id ? 0 : -1}
          onClick={() => onTabChange(tab.id)}
          onKeyDown={(event) => handleSidebarTabKeyDown(event, tab.id)}
          onContextMenu={handleTabsContextMenu}
        >{tab.label}</button>
      ))}
    </div>
  )

  const headerNode = (
    <div className="sidebar-header">
      <span>{tabTitle}</span>
    </div>
  )

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
      const sourceFileName = sourceFile.replace(/^.*[\\/]/, '')
      const liveTab = openTabs.find(tab => {
        if (tab.language !== 'eyc') return false
        const tabFileName = (tab.filePath || tab.id || '').replace(/^.*[\\/]/, '')
        return tabFileName === sourceFileName
      })
      const content = liveTab?.value ?? await window.api?.project?.readFile(projectDir + '\\' + sourceFile)
      const next = new Set<string>()
      if (content) {
        const lines = content.split(/\r?\n/)
        for (const line of lines) {
          const match = /^\s*\.子程序\s+(.+?)(?:\s*,|\s*$)/.exec(line)
          if (match?.[1]) {
            next.add(match[1].trim())
          }
        }
      }

      if (!cancelled) {
        eventSubsCacheRef.current.set(currentFormKey, next)
        setExistingEventSubs(next)
      }
    })()
    return () => { cancelled = true }
  }, [activeTab, projectDir, currentForm?.name, currentForm?.sourceFile, currentFormKey, openTabs])

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
    <aside ref={sidebarRef} className={`sidebar ${placement === 'right' ? 'sidebar-right' : ''}`} role="complementary" aria-label="项目导航">
      {headerNode}
      {tabsPlacement === 'top' && tabsNode}
      <div className="sidebar-content">
        {activeTab === 'project' && (
          <div id="sidebar-panel-project">
            {projectTree && projectTree.length > 0 ? (
              <ul className="tree" aria-label="项目结构">
                {projectTree.map((node) => (
                  <TreeItem
                    key={node.id}
                    node={node}
                    onOpenFile={onOpenFile}
                    activeFileId={activeFileId}
                    focusedItemId={focusedProjectItemId}
                    onFocusItem={setFocusedProjectItemId}
                    modifiedFileKeys={modifiedFileKeys}
              aiModifiedFileKeys={aiModifiedFileKeys}
                    onProjectContextMenu={handleProjectContextMenu}
                    onNodeContextMenu={handleNodeContextMenu}
                  />
                ))}
              </ul>
            ) : (
              <div className="sidebar-empty">暂无打开的项目</div>
            )}
          </div>
        )}
        {activeTab === 'library' && (
          <div id="sidebar-panel-library">
            <LibraryPanel onHint={onLibraryHint} />
          </div>
        )}
        {activeTab === 'property' && (
          <div id="sidebar-panel-property">
            <PropertyPanel selection={selection} windowUnits={windowUnits} onSelectControl={onSelectControl} onPropertyChange={onPropertyChange} projectNames={projectNames} />
          </div>
        )}
      </div>
      {activeTab === 'property' && (
        <div className="sidebar-event-bar">
          <select
            className="sidebar-event-selector"
            title="选择并加入事件处理子程序"
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
      {tabsPlacement === 'bottom' && tabsNode}
      {tabsContextMenu && (
        <div
          className="sidebar-tabs-context-menu"
          ref={(element) => setCssVars(element, {
            '--sidebar-menu-x': `${tabsContextMenu.x}px`,
            '--sidebar-menu-y': `${tabsContextMenu.y}px`,
          })}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            className="sidebar-tabs-context-menu-item"
            onClick={toggleTabsPlacementFromMenu}
          >
            {tabsPlacement === 'top' ? '将“支持库/项目/属性”按钮移到底部' : '将“支持库/项目/属性”按钮移到顶部'}
          </button>
        </div>
      )}
      {projectContextMenu && (
        <div
          className="sidebar-tabs-context-menu"
          ref={(element) => setCssVars(element, {
            '--sidebar-menu-x': `${projectContextMenu.x}px`,
            '--sidebar-menu-y': `${projectContextMenu.y}px`,
          })}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            className="sidebar-tabs-context-menu-item"
            onClick={() => {
              onSaveProject?.(projectContextMenu.projectDir)
              setProjectContextMenu(null)
            }}
          >
            保存该项目全部文件（{projectContextMenu.projectName}）
          </button>
          <button
            type="button"
            role="menuitem"
            className="sidebar-tabs-context-menu-item"
            onClick={() => {
              onCloseProject?.(projectContextMenu.projectDir)
              setProjectContextMenu(null)
            }}
          >
            关闭该项目（{projectContextMenu.projectName}）
          </button>
        </div>
      )}
      {nodeContextMenu && (
        <div
          className="sidebar-tabs-context-menu"
          ref={(element) => setCssVars(element, {
            '--sidebar-menu-x': `${nodeContextMenu.x}px`,
            '--sidebar-menu-y': `${nodeContextMenu.y}px`,
          })}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {nodeContextMenu.kind === 'category' ? (
            <>
              {(CATEGORY_CONTEXT_MENU_ITEMS[nodeContextMenu.categoryId] || []).map(item => (
                <button
                  key={item.action}
                  type="button"
                  role="menuitem"
                  className="sidebar-tabs-context-menu-item"
                  onClick={() => fireNodeAction(item.action)}
                >
                  {item.label}
                </button>
              ))}
            </>
          ) : nodeContextMenu.kind === 'window' ? (
            <>
              <button
                type="button"
                role="menuitem"
                className="sidebar-tabs-context-menu-item"
                onClick={() => fireNodeAction('copyWindow')}
              >
                复制窗口（{nodeContextMenu.nodeLabel}）
              </button>
              <button
                type="button"
                role="menuitem"
                className="sidebar-tabs-context-menu-item"
                disabled={!canPasteWindow}
                title={canPasteWindow ? undefined : '先复制一个窗口后才能粘贴'}
                onClick={() => fireNodeAction('pasteWindow')}
              >
                粘贴窗口
              </button>
              <button
                type="button"
                role="menuitem"
                className="sidebar-tabs-context-menu-item"
                disabled={nodeContextMenu.nodeId.replace(/\.efw$/i, '') === '_启动窗口'}
                title={nodeContextMenu.nodeId.replace(/\.efw$/i, '') === '_启动窗口' ? '启动窗口不能删除' : undefined}
                onClick={() => fireNodeAction('deleteWindow')}
              >
                删除窗口（{nodeContextMenu.nodeLabel}）
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                className="sidebar-tabs-context-menu-item"
                onClick={() => fireNodeAction('newSub')}
              >
                新建子程序（{nodeContextMenu.nodeLabel}）
              </button>
              <button
                type="button"
                role="menuitem"
                className="sidebar-tabs-context-menu-item"
                onClick={() => fireNodeAction('newAssembly')}
              >
                新建程序集
              </button>
              <button
                type="button"
                role="menuitem"
                className="sidebar-tabs-context-menu-item"
                onClick={() => fireNodeAction('newClassModule')}
              >
                新建类模块
              </button>
              <button
                type="button"
                role="menuitem"
                className="sidebar-tabs-context-menu-item"
                onClick={() => fireNodeAction('deleteModule')}
              >
                {nodeContextMenu.isClassModule ? `删除类（${nodeContextMenu.nodeLabel}）` : `删除程序集（${nodeContextMenu.nodeLabel}）`}
              </button>
            </>
          )}
        </div>
      )}
      <div
        className="sidebar-resizer"
        onMouseDown={handleMouseDown}
        onKeyDown={handleResizerKeyDown}
        role="separator"
        aria-label="调整侧栏宽度"
        aria-orientation="vertical"
        aria-valuenow={Math.round(width)}
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        tabIndex={0}
      />
    </aside>
  )
}

export default Sidebar
