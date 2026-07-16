import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { parseFontSpec, fontSpecToCss } from './fontSpec'
import Icon, { resolveUnitIconName } from '../Icon/Icon'
import '../Icon/Icon.css'
import './VisualDesigner.css'
import MenuEditorDialog from './MenuEditorDialog'

// ========== 类型定义 ==========

/** 窗口组件属性（来自支持库） */
export interface LibUnitProperty {
  name: string
  englishName: string
  description: string
  type: number
  typeName: string
  isReadOnly: boolean
  pickOptions: string[]
  defaultValue?: string | number | boolean
}

/** 窗口组件事件（来自支持库） */
export interface LibUnitEvent {
  name: string
  description: string
  args: Array<{ name: string; description: string; dataType: string; isByRef: boolean }>
}

/** 窗口组件信息（来自支持库） */
export interface LibWindowUnit {
  name: string
  englishName: string
  description: string
  libraryName: string
  iconFileName?: string
  properties: LibUnitProperty[]
  events: LibUnitEvent[]
  /** 组件箱分类（工具箱分组显示），缺省"通用Win32" */
  toolboxCategory?: string
}

/** 控件实例 */
export interface DesignControl {
  id: string
  type: string          // 窗口组件名（如 "按钮"、"编辑框"，来自支持库）
  name: string
  left: number
  top: number
  width: number
  height: number
  text: string
  visible: boolean
  enabled: boolean
  locked?: boolean      // 设计器中锁定：可选中（便于解锁）但不可拖动/缩放
  properties: Record<string, string | number | boolean>  // 支持库属性值
}

/** 窗口属性 */
/** 窗口菜单项（菜单编辑器）：一棵树，separator=true 表示分隔条，children 表示子菜单 */
export interface MenuItemDef {
  name: string          // 名称（生成 _名_被选择 事件用）
  caption: string       // 标题（显示文本；分隔条忽略）
  shortcut?: string     // 快捷键（如 "Ctrl+S"）
  checked?: boolean     // 选中标记
  disabled?: boolean    // 禁止
  visible?: boolean      // 可视（缺省 true）
  separator?: boolean   // 分隔条
  children?: MenuItemDef[]
}

export interface DesignForm {
  name: string
  title: string
  width: number
  height: number
  sourceFile?: string  // 关联的 .eyc 源代码文件名
  controls: DesignControl[]
  menu?: MenuItemDef[]  // 窗口菜单栏（顶级菜单数组）
  properties?: Record<string, string | number | boolean>  // 支持库属性值
}

/** 选中目标：控件 或 窗口自身 */
export type SelectionTarget =
  | { kind: 'control'; control: DesignControl; form: DesignForm }
  | { kind: 'form'; form: DesignForm }
  | null

/** 对齐操作类型 */
export type AlignAction = 'align-left' | 'align-right' | 'align-top' | 'align-bottom'
  | 'center-h' | 'center-v' | 'same-width' | 'same-height' | 'same-size' | null

// 设计器标尺下方的对齐工具条按钮（原先在顶部工具栏，现独立到可视化设计器内、只在设计窗口时显示）
const VD_ALIGN_BUTTONS: { action: Exclude<AlignAction, null>; icon: string; title: string }[] = [
  { action: 'align-left', icon: 'align-left', title: '左对齐' },
  { action: 'align-right', icon: 'align-right', title: '右对齐' },
  { action: 'align-top', icon: 'align-top', title: '顶端对齐' },
  { action: 'align-bottom', icon: 'align-bottom', title: '底端对齐' },
  { action: 'center-h', icon: 'center-h', title: '水平居中' },
  { action: 'center-v', icon: 'center-v', title: '垂直居中' },
  { action: 'same-width', icon: 'same-width', title: '相同宽度' },
  { action: 'same-height', icon: 'same-height', title: '相同高度' },
  { action: 'same-size', icon: 'same-size', title: '相同大小' },
]

interface VisualDesignerProps {
  form: DesignForm
  onChange: (form: DesignForm) => void
  onSelectControl: (target: SelectionTarget) => void
  windowUnits?: LibWindowUnit[]
  externalSelectedId?: string
  onMultiSelectChange?: (count: number) => void
  onControlDoubleClick?: (control: DesignControl, defaultEvent: LibUnitEvent | null) => void
  onFormDoubleClick?: (form: DesignForm, defaultEvent: LibUnitEvent | null) => void
  onUndo?: () => void  // 右键菜单「撤销」→ 外层全局撤销栈
  onOpenWindowSource?: () => void       // 「到对应窗口程序集」→ 打开该窗体的 .eyc 代码
  onNavigateBack?: () => void           // 「跳回先前位置」→ 导航历史回跳
  onCanNavigateBack?: () => boolean     // 是否有可回跳的历史（渲染菜单时查询）
  onPreviewWindow?: () => void          // 「预览」→ 编译运行该窗口(不编译源代码)
  onMenuItemActivate?: (itemName: string) => void  // 单击设计器菜单栏的菜单项 → 生成/跳转 _名_被选择 事件
  onMenuItemRenames?: (renames: Array<{ oldName: string; newName: string }>) => void  // 菜单项改名 → 同步源代码引用
}

// ========== 内置默认尺寸 ==========
const DEFAULT_SIZES: Record<string, [number, number]> = {
  '按钮': [75, 28], '编辑框': [120, 24], '标签': [80, 20], '图片框': [100, 80],
  '列表框': [120, 100], '组合框': [120, 24], '选择框': [80, 20], '单选框': [80, 20],
  '分组框': [160, 120], '进度条': [150, 20], '时钟': [32, 32], '图片组': [32, 32], '通用对话框': [32, 32],
  '选择夹': [220, 150], '月历': [200, 160], '滑块条': [150, 30], '画板': [200, 150],
}
const DEFAULT_SIZE: [number, number] = [100, 30]

// ========== 拖拽句柄方向 ==========
type HandleDir = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se'

const HANDLES: HandleDir[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']

// 网格吸附
const GRID = 4
const ALIGN_SNAP_TOLERANCE = 6
const FORM_TITLEBAR_HEIGHT = 32
const TOOL_TITLEBAR_HEIGHT = 22
// 设计器菜单栏条（.vd-fmenu-bar，border-box 含底边框）高度——有菜单时位于标题栏与客户区之间；
// 客户区坐标↔工作区/标尺坐标的换算必须把它与标题栏高度一并计入，否则纵向标尺高亮/游标上移一条菜单栏
const FORM_MENUBAR_HEIGHT = 22

// 底图方式 → 画布背景图 CSS（图片层，网格层恒定）
const BACK_IMAGE_MODE_CSS: Record<number, { size: string; repeat: string; position: string }> = {
  0: { size: 'auto', repeat: 'repeat', position: '0 0' },          // 平铺
  1: { size: 'auto', repeat: 'no-repeat', position: 'left top' },  // 居左上
  2: { size: 'auto', repeat: 'no-repeat', position: 'center' },    // 居中
  3: { size: 'auto', repeat: 'no-repeat', position: 'right bottom' }, // 居右下
  4: { size: '100% 100%', repeat: 'no-repeat', position: '0 0' },  // 缩放
}
const FORM_MIN_WIDTH = 180
const FORM_MIN_HEIGHT = 80
const MIN_ZOOM = 0.25
const MAX_ZOOM = 10
const ZOOM_STEP = 0.1
const RULER_SIZE = 24
const WORKSPACE_MARGIN = 640
const TOOLBOX_DOCK_LIST_MIN_WIDTH = 130
const TOOLBOX_ICON_MIN_WIDTH = 86
const TOOLBOX_DOCK_MAX_WIDTH = 420
const TOOLBOX_FLOAT_LIST_MIN_WIDTH = 130
const TOOLBOX_FLOAT_MIN_HEIGHT = 220
const TOOLBOX_STATE_STORAGE_KEY = 'ycide.visual-designer.toolbox-state.v1'
const TOOLBOX_DEFAULT_CATEGORY = '通用Win32'

function snap(v: number): number {
  return Math.round(v / GRID) * GRID
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function computeWorkspaceSpan(contentSize: number, viewportSize: number): number {
  return Math.max(contentSize + WORKSPACE_MARGIN * 2, viewportSize + WORKSPACE_MARGIN * 2)
}

function computeNiceIntegerStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 1) return 1
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const normalized = raw / magnitude
  if (normalized <= 1) return magnitude
  if (normalized <= 2) return 2 * magnitude
  if (normalized <= 5) return 5 * magnitude
  return 10 * magnitude
}

function isPointWithinRect(x: number, y: number, rect: DOMRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

function setCssVars(element: HTMLElement | null, vars: Record<string, string>): void {
  if (!element) return
  for (const [name, value] of Object.entries(vars)) {
    element.style.setProperty(name, value)
  }
}

function getToolboxMinWidth(viewMode: 'icon' | 'list'): number {
  return viewMode === 'icon' ? TOOLBOX_ICON_MIN_WIDTH : TOOLBOX_DOCK_LIST_MIN_WIDTH
}

function computeToolboxVisualScale(width: number, viewMode: 'icon' | 'list'): number {
  const base = viewMode === 'icon' ? 130 : 160
  return clamp(width / base, 0.82, 1.4)
}

function computeToolboxListColumns(width: number): number {
  return clamp(Math.floor(width / 130), 2, 6)
}

type AxisSnapResult = { pos: number; guide: number } | null

interface FormVisualColors {
  titleBg: string
  titleText: string
  canvasBg: string
  border: string
  grid: string
}

function colorFromNumber(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null
  const n = Math.floor(value) & 0xffffff
  const r = n & 0xff
  const g = (n >> 8) & 0xff
  const b = (n >> 16) & 0xff
  return `rgb(${r}, ${g}, ${b})`
}

function normalizeColor(value: string | number | boolean | undefined): string | null {
  if (typeof value === 'number') return colorFromNumber(value)
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  if (/^#|^rgb\(|^rgba\(|^hsl\(|^hsla\(/i.test(raw)) return raw
  if (/^0x[0-9a-f]+$/i.test(raw)) return colorFromNumber(Number.parseInt(raw, 16))
  if (/^\d+$/.test(raw)) return colorFromNumber(Number.parseInt(raw, 10))
  return null
}

function readColorProperty(
  properties: Record<string, string | number | boolean> | undefined,
  names: string[],
): string | null {
  if (!properties) return null
  for (const name of names) {
    const normalized = normalizeColor(properties[name])
    if (normalized) return normalized
  }
  return null
}

function resolveFormVisualColors(form: DesignForm): FormVisualColors {
  const titleBg = readColorProperty(form.properties, ['标题栏背景色', '标题栏背景颜色', '标题栏颜色']) || '#e9edf2'
  const titleText = readColorProperty(form.properties, ['标题栏文本色', '标题栏文字颜色', '前景颜色', '前景色']) || '#111827'
  // 「底色」是窗口单元属性（COLORREF），0 表示默认底色须回落，不能进 readColorProperty（0 会被当黑色）
  const backColorRaw = form.properties?.['底色']
  const backColor = typeof backColorRaw === 'number' && backColorRaw !== 0 ? colorFromNumber(backColorRaw) : null
  const canvasBg = backColor || readColorProperty(form.properties, ['背景颜色', '背景色', '客户区背景色']) || '#f4f6f8'
  const border = readColorProperty(form.properties, ['边框颜色', '边框色']) || '#9ca3af'
  const grid = readColorProperty(form.properties, ['网格颜色', '网格色']) || '#c5c9d1'
  return { titleBg, titleText, canvasBg, border, grid }
}

// 边框样式（窗口「边框」属性 0~5）对应的设计器窗体外观参数
interface FormChromeStyle {
  hasTitlebar: boolean
  isToolWindow: boolean
  titlebarHeight: number
}

function resolveFormChromeStyle(form: DesignForm): { borderStyle: number } & FormChromeStyle {
  const raw = form.properties?.['边框']
  const borderStyle = typeof raw === 'number' && raw >= 0 && raw <= 5 ? raw : 2
  const hasTitlebar = borderStyle !== 0
  const isToolWindow = borderStyle === 4 || borderStyle === 5
  const titlebarHeight = !hasTitlebar ? 0 : isToolWindow ? TOOL_TITLEBAR_HEIGHT : FORM_TITLEBAR_HEIGHT
  return { borderStyle, hasTitlebar, isToolWindow, titlebarHeight }
}

interface ControlVisualColors {
  bg: string
  text: string
  border: string
}

function resolveControlVisualColors(ctrl: DesignControl): ControlVisualColors {
  const bg = readColorProperty(ctrl.properties, ['背景颜色', '背景色', '背景']) || '#f2f2f2'
  const text = readColorProperty(ctrl.properties, ['前景颜色', '前景色', '文字颜色', '文本颜色']) || '#111827'
  const border = readColorProperty(ctrl.properties, ['边框颜色', '边框色']) || '#b2b8c2'
  return { bg, text, border }
}

function resolveAxisSnap(basePos: number, size: number, references: number[]): AxisSnapResult {
  const anchors = [0, size / 2, size]
  let bestDiff = Number.POSITIVE_INFINITY
  let bestGuide: number | null = null

  for (const ref of references) {
    for (const anchor of anchors) {
      const current = basePos + anchor
      const diff = ref - current
      const dist = Math.abs(diff)
      if (dist <= ALIGN_SNAP_TOLERANCE && dist < bestDiff) {
        bestDiff = dist
        bestGuide = ref
      }
    }
  }

  if (bestGuide === null) return null

  for (const anchor of anchors) {
    const current = basePos + anchor
    const diff = bestGuide - current
    if (Math.abs(diff) === bestDiff) {
      return { pos: basePos + diff, guide: bestGuide }
    }
  }

  return null
}

function buildReferenceLines(
  controls: DesignControl[],
  excludedIds: Set<string>,
  formWidth: number,
  formHeight: number,
): { x: number[]; y: number[] } {
  const x = new Set<number>([0, formWidth / 2, formWidth])
  const y = new Set<number>([0, formHeight / 2, formHeight])

  for (const c of controls) {
    if (excludedIds.has(c.id)) continue
    x.add(c.left)
    x.add(c.left + c.width / 2)
    x.add(c.left + c.width)
    y.add(c.top)
    y.add(c.top + c.height / 2)
    y.add(c.top + c.height)
  }

  return {
    x: [...x],
    y: [...y],
  }
}

function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

let nextControlId = 1
// 控件剪贴板（模块级，跨窗体/标签页保留，语义类似系统剪贴板）
let vdControlClipboard: DesignControl[] = []

// ========== 组件 ==========

// 记住上次选中的 id（跨重渲染保持）
let lastSelectedId: string = '__form__'

function VisualDesigner({ form, onChange, onSelectControl, windowUnits = [], externalSelectedId, onMultiSelectChange, onControlDoubleClick, onFormDoubleClick, onUndo, onOpenWindowSource, onNavigateBack, onCanNavigateBack, onPreviewWindow, onMenuItemActivate, onMenuItemRenames }: VisualDesignerProps): React.JSX.Element {
  // '__form__' 表示选中窗口自身，null 表示无选中
  const [selectedId, setSelectedId] = useState<string | null>(lastSelectedId)
  // 多选支持
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeTool, setActiveTool] = useState<string | null>(null)
  // 右键菜单：位置(视口坐标) + 是否右键在控件上；null 表示未打开
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; onControl: boolean } | null>(null)
  // 「位置及尺寸」子菜单是否展开
  const [ctxSubmenuOpen, setCtxSubmenuOpen] = useState(false)
  // 「查看数据类型定义」弹框：要展示的控件类型（支持库单元）信息；null 表示未打开
  const [typeInfoUnit, setTypeInfoUnit] = useState<LibWindowUnit | null>(null)
  // 「菜单编辑器」对话框是否打开
  const [menuEditorOpen, setMenuEditorOpen] = useState(false)
  // 设计器菜单栏：当前展开的顶级菜单下标（null 表示未展开）
  const [menuBarOpenTop, setMenuBarOpenTop] = useState<number | null>(null)
  const [toolboxFloat, setToolboxFloat] = useState(false)
  const [toolboxDockSide, setToolboxDockSide] = useState<'left' | 'right'>('right')
  const [toolboxDockWidth, setToolboxDockWidth] = useState(160)
  const [toolboxViewMode, setToolboxViewMode] = useState<'icon' | 'list'>('list')
  const [toolboxListMultiColumn, setToolboxListMultiColumn] = useState(false)
  const [toolboxSearch, setToolboxSearch] = useState('')
  const [toolboxCategory, setToolboxCategory] = useState(TOOLBOX_DEFAULT_CATEGORY)
  const [toolboxPos, setToolboxPos] = useState({ x: 80, y: 40 })
  const [toolboxSize, setToolboxSize] = useState({ w: 160, h: 400 })
  const [alignGuides, setAlignGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  const [zoom, setZoom] = useState(1)
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false)
  const zoomControlRef = useRef<HTMLDivElement>(null)
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [isPanningView, setIsPanningView] = useState(false)
  const [hoveredControlId, setHoveredControlId] = useState<string | null>(null)
  // 选择夹当前显示页（设计器 WYSIWYG）：key=选择夹控件名，value=页索引。缺省取该选择夹「现行子夹」。
  const [activeTabPage, setActiveTabPage] = useState<Record<string, number>>({})
  const getActivePage = (tabName: string): number => {
    if (tabName in activeTabPage) return activeTabPage[tabName]
    const tab = form.controls.find(c => c.name === tabName && (c.type === '选择夹' || c.type === 'Tab'))
    return tab ? Number(tab.properties?.['现行子夹'] ?? 0) : 0
  }
  // 拖动/新增回调是 [] useCallback，闭包会读到旧 activeTabPage，故镜像到 ref 供回调取新值。
  const activeTabPageRef = useRef<Record<string, number>>(activeTabPage)
  activeTabPageRef.current = activeTabPage
  // 单控件几何归属计算（供 addControl/拖动共用）：中心点落入某选择夹「体区」（去顶部 22px 标签条）→ 写归属，否则清除。
  const ownershipForRect = (ctrl: DesignControl, tabs: DesignControl[]): { owner: string; page: number } | null => {
    if (ctrl.type === '选择夹' || ctrl.type === 'Tab') return null
    const cx = ctrl.left + ctrl.width / 2, cy = ctrl.top + ctrl.height / 2
    for (const t of tabs) {
      if (t.id === ctrl.id) continue
      if (cx >= t.left && cx <= t.left + t.width && cy >= t.top + 22 && cy <= t.top + t.height) {
        const page = t.name in activeTabPageRef.current ? activeTabPageRef.current[t.name] : Number(t.properties?.['现行子夹'] ?? 0)
        return { owner: t.name, page }
      }
    }
    return null
  }
  // 拖动结束后按落点重指派归属（读 formRef 最新态），有变更才提交。
  const reassignTabOwnership = (movedIds: string[]): void => {
    const latest = formRef.current
    const tabs = latest.controls.filter(c => c.type === '选择夹' || c.type === 'Tab')
    if (tabs.length === 0) return
    let changed = false
    const controls = latest.controls.map(c => {
      if (!movedIds.includes(c.id)) return c
      const own = ownershipForRect(c, tabs)
      const curOwner = typeof c.properties?.['所属选择夹'] === 'string' ? c.properties['所属选择夹'] as string : ''
      const curPage = Number(c.properties?.['所属子夹'] ?? 0)
      if (own) {
        if (curOwner === own.owner && curPage === own.page) return c
        changed = true
        return { ...c, properties: { ...c.properties, '所属选择夹': own.owner, '所属子夹': own.page } }
      }
      if (!curOwner) return c
      changed = true
      const p = { ...c.properties }; delete p['所属选择夹']; delete p['所属子夹']
      return { ...c, properties: p }
    })
    if (changed) onChangeRef.current({ ...latest, controls })
  }
  const formVisualColors = resolveFormVisualColors(form)
  const designerRootRef = useRef<HTMLDivElement>(null)
  const canvasRegionRef = useRef<HTMLDivElement>(null)
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(zoom)
  const isSpacePressedRef = useRef(false)
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null)
  const initializedCenterRef = useRef(false)
  const viewStateHydratedRef = useRef(false)
  const [toolboxStateReady, setToolboxStateReady] = useState(false)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [scrollPos, setScrollPos] = useState({ left: 0, top: 0 })
  const [drawRect, setDrawRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [mouseRulerPos, setMouseRulerPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{
    mode: 'move' | 'resize' | 'create'
    controlId: string
    handle?: HandleDir
    startX: number
    startY: number
    origLeft: number
    origTop: number
    origWidth: number
    origHeight: number
  } | null>(null)
  // 保持最新 form/onChange 引用，供原生事件回调使用（避免闭包捕获过时值）
  const formRef = useRef(form)
  formRef.current = form
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // 跟踪刚创建控件的 ID，防止 onSelectControl 因渲染间隙发送 null
  const pendingNewIdRef = useRef<string | null>(null)

  const selectedControl = selectedId && selectedId !== '__form__'
    ? form.controls.find(c => c.id === selectedId) || null
    : null
  const visualFormWidth = Math.max(form.width, FORM_MIN_WIDTH)
  const visualFormHeight = Math.max(form.height, FORM_MIN_HEIGHT)
  const formChrome = resolveFormChromeStyle(form)
  const formTitlebarHeight = formChrome.titlebarHeight
  // 窗口铬高度 = 标题栏 + 菜单栏（有可见顶级菜单时 renderFormMenuBar 渲染 22px 条）——几何换算统一用它，
  // 判定条件须与 renderFormMenuBar 的过滤一致（menu 数组存在且至少一个 visible !== false 的顶级项）
  const formMenuBarHeight = Array.isArray(form.menu) && form.menu.some(n => n && n.visible !== false) ? FORM_MENUBAR_HEIGHT : 0
  const formChromeHeight = formTitlebarHeight + formMenuBarHeight
  const formControlBox = form.properties?.['控制按钮'] !== false
  const formMinButton = form.properties?.['最小化按钮'] !== false
  const formMaxButton = form.properties?.['最大化按钮'] !== false
  // 外形（0 矩形 / 1 圆角矩形 / 2 椭圆形）与底图（base64 data URL）
  const formShapeRaw = form.properties?.['外形']
  const formShape = typeof formShapeRaw === 'number' && formShapeRaw >= 0 && formShapeRaw <= 2 ? formShapeRaw : 0
  // 圆角半径（仅圆角矩形用），默认 20，夹取到非负
  const formCornerRadiusRaw = form.properties?.['圆角半径']
  const formCornerRadius = typeof formCornerRadiusRaw === 'number' && formCornerRadiusRaw >= 0 ? formCornerRadiusRaw : 20
  const formBackImage = typeof form.properties?.['底图'] === 'string' && (form.properties['底图'] as string).startsWith('data:image')
    ? (form.properties['底图'] as string)
    : ''
  // 底图方式 0平铺 / 1居左上 / 2居中 / 3居右下 / 4缩放
  const formBackImageModeRaw = form.properties?.['底图方式']
  const formBackImageMode = typeof formBackImageModeRaw === 'number' && formBackImageModeRaw >= 0 && formBackImageModeRaw <= 4 ? formBackImageModeRaw : 0
  const backImageCss = BACK_IMAGE_MODE_CSS[formBackImageMode] || BACK_IMAGE_MODE_CSS[0]
  // 图标（base64 data URL）：标题栏左上角图标
  const formIcon = typeof form.properties?.['图标'] === 'string' && (form.properties['图标'] as string).startsWith('data:image')
    ? (form.properties['图标'] as string)
    : ''
  const viewStateStorageKey = useMemo(() => {
    const rawId = (form.sourceFile || form.name || 'untitled-form').trim()
    const safeId = rawId.replace(/[^\w.-]+/g, '_').toLowerCase()
    return `ycide.visual-designer.view-state.${safeId}`
  }, [form.name, form.sourceFile])
  const scaledFormWidth = visualFormWidth * zoom
  const scaledFormHeight = (visualFormHeight + formChromeHeight) * zoom
  const workspaceWidth = computeWorkspaceSpan(scaledFormWidth, viewportSize.width)
  const workspaceHeight = computeWorkspaceSpan(scaledFormHeight, viewportSize.height)
  const formOffsetLeft = (workspaceWidth - scaledFormWidth) / 2
  const formOffsetTop = (workspaceHeight - scaledFormHeight) / 2
  const rulerMinorStep = useMemo(() => computeNiceIntegerStep(12 / Math.max(zoom, 0.01)), [zoom])
  const rulerMidStep = rulerMinorStep * 5
  const rulerMajorStep = rulerMinorStep * 10

  const rulerTicksX = useMemo(() => {
    if (viewportSize.width <= 0) return [] as Array<{ id: string; pos: number; level: 'minor' | 'mid' | 'major'; label: string }>
    const startUnit = (scrollPos.left - formOffsetLeft) / zoom
    const endUnit = (scrollPos.left + viewportSize.width - formOffsetLeft) / zoom
    const first = Math.floor(startUnit / rulerMinorStep) * rulerMinorStep - rulerMinorStep
    const last = Math.ceil(endUnit / rulerMinorStep) * rulerMinorStep + rulerMinorStep
    const ticks: Array<{ id: string; pos: number; level: 'minor' | 'mid' | 'major'; label: string }> = []
    for (let unit = first; unit <= last; unit += rulerMinorStep) {
      const pos = formOffsetLeft + unit * zoom - scrollPos.left
      if (pos < -32 || pos > viewportSize.width + 32) continue
      const level: 'minor' | 'mid' | 'major' = unit % rulerMajorStep === 0 ? 'major' : (unit % rulerMidStep === 0 ? 'mid' : 'minor')
      ticks.push({ id: `x-${unit}`, pos, level, label: level === 'major' ? String(unit) : '' })
    }
    return ticks
  }, [formOffsetLeft, rulerMajorStep, rulerMidStep, rulerMinorStep, scrollPos.left, viewportSize.width, zoom])

  const rulerTicksY = useMemo(() => {
    if (viewportSize.height <= 0) return [] as Array<{ id: string; pos: number; level: 'minor' | 'mid' | 'major'; label: string }>
    const startUnit = (scrollPos.top - formOffsetTop) / zoom
    const endUnit = (scrollPos.top + viewportSize.height - formOffsetTop) / zoom
    const first = Math.floor(startUnit / rulerMinorStep) * rulerMinorStep - rulerMinorStep
    const last = Math.ceil(endUnit / rulerMinorStep) * rulerMinorStep + rulerMinorStep
    const ticks: Array<{ id: string; pos: number; level: 'minor' | 'mid' | 'major'; label: string }> = []
    for (let unit = first; unit <= last; unit += rulerMinorStep) {
      const pos = formOffsetTop + unit * zoom - scrollPos.top
      if (pos < -32 || pos > viewportSize.height + 32) continue
      const level: 'minor' | 'mid' | 'major' = unit % rulerMajorStep === 0 ? 'major' : (unit % rulerMidStep === 0 ? 'mid' : 'minor')
      ticks.push({ id: `y-${unit}`, pos, level, label: level === 'major' ? String(unit) : '' })
    }
    return ticks
  }, [formOffsetTop, rulerMajorStep, rulerMidStep, rulerMinorStep, scrollPos.top, viewportSize.height, zoom])

  const selectedRulerHighlight = useMemo(() => {
    const ids = selectedIds.size > 0
      ? selectedIds
      : (selectedControl ? new Set([selectedControl.id]) : new Set<string>())
    if (ids.size === 0) return null
    const selected = form.controls.filter(control => ids.has(control.id))
    if (selected.length === 0) return null
    const minLeft = Math.min(...selected.map(control => control.left))
    const maxRight = Math.max(...selected.map(control => control.left + control.width))
    const minTop = Math.min(...selected.map(control => control.top))
    const maxBottom = Math.max(...selected.map(control => control.top + control.height))
    const x1 = formOffsetLeft + minLeft * zoom - scrollPos.left
    const x2 = formOffsetLeft + maxRight * zoom - scrollPos.left
    const y1 = formOffsetTop + (formChromeHeight + minTop) * zoom - scrollPos.top
    const y2 = formOffsetTop + (formChromeHeight + maxBottom) * zoom - scrollPos.top
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    }
  }, [form.controls, formOffsetLeft, formOffsetTop, formChromeHeight, scrollPos.left, scrollPos.top, selectedControl, selectedIds, zoom])

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => {
    isSpacePressedRef.current = isSpacePressed
  }, [isSpacePressed])

  useEffect(() => {
    initializedCenterRef.current = false
    viewStateHydratedRef.current = false
    pendingScrollRef.current = null

    let restoredZoom = 1
    let restoredScroll: { left: number; top: number } | null = null

    try {
      const raw = localStorage.getItem(viewStateStorageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as {
          zoom?: number
          scrollLeft?: number
          scrollTop?: number
        }
        if (typeof parsed.zoom === 'number' && Number.isFinite(parsed.zoom)) {
          restoredZoom = clamp(parsed.zoom, MIN_ZOOM, MAX_ZOOM)
        }
        if (
          typeof parsed.scrollLeft === 'number'
          && Number.isFinite(parsed.scrollLeft)
          && typeof parsed.scrollTop === 'number'
          && Number.isFinite(parsed.scrollTop)
        ) {
          restoredScroll = {
            left: Math.max(0, parsed.scrollLeft),
            top: Math.max(0, parsed.scrollTop),
          }
        }
      }
    } catch {
      // Ignore corrupt local view-state payloads.
    }

    pendingScrollRef.current = restoredScroll
    setZoom(restoredZoom)
    setScrollPos({ left: 0, top: 0 })
  }, [viewStateStorageKey])

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      return target.isContentEditable
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Space') return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      setIsSpacePressed(true)
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== 'Space') return
      if (!isTypingTarget(event.target)) {
        event.preventDefault()
        event.stopPropagation()
      }
      setIsSpacePressed(false)
    }

    const onWindowBlur = (): void => {
      setIsSpacePressed(false)
      setIsPanningView(false)
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onWindowBlur)

    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [])

  useEffect(() => {
    const host = canvasAreaRef.current
    if (!host) return

    const updateSize = (): void => {
      setViewportSize({ width: host.clientWidth, height: host.clientHeight })
    }

    updateSize()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }

    const observer = new ResizeObserver(() => updateSize())
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const host = canvasAreaRef.current
    if (!host) return
    if (viewportSize.width <= 0 || viewportSize.height <= 0) return

    const maxLeft = Math.max(0, workspaceWidth - host.clientWidth)
    const maxTop = Math.max(0, workspaceHeight - host.clientHeight)

    if (pendingScrollRef.current) {
      const nextLeft = clamp(pendingScrollRef.current.left, 0, maxLeft)
      const nextTop = clamp(pendingScrollRef.current.top, 0, maxTop)
      host.scrollLeft = nextLeft
      host.scrollTop = nextTop
      setScrollPos({ left: nextLeft, top: nextTop })
      pendingScrollRef.current = null
      initializedCenterRef.current = true
      viewStateHydratedRef.current = true
      return
    }

    if (!initializedCenterRef.current) {
      const centerLeft = (workspaceWidth - host.clientWidth) / 2
      const centerTop = (workspaceHeight - host.clientHeight) / 2
      host.scrollLeft = centerLeft
      host.scrollTop = centerTop
      setScrollPos({ left: centerLeft, top: centerTop })
      initializedCenterRef.current = true
      viewStateHydratedRef.current = true
    }
  }, [workspaceWidth, workspaceHeight, viewportSize.width, viewportSize.height])

  useEffect(() => {
    if (!viewStateHydratedRef.current) return
    try {
      localStorage.setItem(viewStateStorageKey, JSON.stringify({
        zoom,
        scrollLeft: scrollPos.left,
        scrollTop: scrollPos.top,
      }))
    } catch {
      // Ignore storage quota/security failures.
    }
  }, [scrollPos.left, scrollPos.top, viewStateStorageKey, zoom])

  const getCanvasPoint = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const currentZoom = zoomRef.current || 1
    return {
      x: (clientX - rect.left) / currentZoom,
      y: (clientY - rect.top) / currentZoom,
    }
  }, [])

  const updateMouseRulerPos = useCallback((clientX: number, clientY: number): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (!isPointWithinRect(clientX, clientY, rect)) {
      setMouseRulerPos(null)
      return
    }
    const point = getCanvasPoint(clientX, clientY)
    setMouseRulerPos({
      x: formOffsetLeft + point.x * zoom - scrollPos.left,
      y: formOffsetTop + (formChromeHeight + point.y) * zoom - scrollPos.top,
    })
  }, [formOffsetLeft, formOffsetTop, formChromeHeight, getCanvasPoint, scrollPos.left, scrollPos.top, zoom])

  const zoomTo = useCallback((nextZoom: number, anchorClientPoint?: { x: number; y: number }) => {
    const host = canvasAreaRef.current
    const currentZoom = zoomRef.current || 1
    const targetZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
    if (!host || Math.abs(targetZoom - currentZoom) < 1e-6) return

    const rect = host.getBoundingClientRect()
    const hasAnchor = !!anchorClientPoint && isPointWithinRect(anchorClientPoint.x, anchorClientPoint.y, rect)
    const anchorX = hasAnchor ? anchorClientPoint!.x : rect.left + rect.width / 2
    const anchorY = hasAnchor ? anchorClientPoint!.y : rect.top + rect.height / 2
    const viewportX = anchorX - rect.left
    const viewportY = anchorY - rect.top

    const oldScaledW = visualFormWidth * currentZoom
    const oldScaledH = (visualFormHeight + formChromeHeight) * currentZoom
    const oldWorkspaceW = computeWorkspaceSpan(oldScaledW, host.clientWidth)
    const oldWorkspaceH = computeWorkspaceSpan(oldScaledH, host.clientHeight)
    const oldOffsetX = (oldWorkspaceW - oldScaledW) / 2
    const oldOffsetY = (oldWorkspaceH - oldScaledH) / 2

    const worldX = host.scrollLeft + viewportX
    const worldY = host.scrollTop + viewportY
    const formX = (worldX - oldOffsetX) / currentZoom
    const formY = (worldY - oldOffsetY) / currentZoom

    const newScaledW = visualFormWidth * targetZoom
    const newScaledH = (visualFormHeight + formChromeHeight) * targetZoom
    const newWorkspaceW = computeWorkspaceSpan(newScaledW, host.clientWidth)
    const newWorkspaceH = computeWorkspaceSpan(newScaledH, host.clientHeight)
    const newOffsetX = (newWorkspaceW - newScaledW) / 2
    const newOffsetY = (newWorkspaceH - newScaledH) / 2
    const newWorldX = newOffsetX + formX * targetZoom
    const newWorldY = newOffsetY + formY * targetZoom

    pendingScrollRef.current = {
      left: newWorldX - viewportX,
      top: newWorldY - viewportY,
    }

    setZoom(targetZoom)
  }, [visualFormWidth, visualFormHeight, formChromeHeight])

  const stepZoom = useCallback((direction: 1 | -1, anchorClientPoint?: { x: number; y: number }) => {
    const currentZoom = zoomRef.current || 1
    zoomTo(currentZoom + direction * ZOOM_STEP, anchorClientPoint)
  }, [zoomTo])

  // 倍率预设菜单：点击控件外部关闭
  useEffect(() => {
    if (!zoomMenuOpen) return
    const onMouseDown = (e: MouseEvent): void => {
      if (zoomControlRef.current && !zoomControlRef.current.contains(e.target as Node)) {
        setZoomMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown, true)
    return () => document.removeEventListener('mousedown', onMouseDown, true)
  }, [zoomMenuOpen])

  // 缩放到指定倍率并把窗体居中显示（适应窗口/预设档位用；拖动条缩放不居中）
  const zoomToCentered = useCallback((targetZoomRaw: number) => {
    const host = canvasAreaRef.current
    if (!host) return
    const targetZoom = clamp(targetZoomRaw, MIN_ZOOM, MAX_ZOOM)
    const currentZoom = zoomRef.current || 1

    // 窗体居中于工作区，滚动到工作区中心即窗体居中
    const scaledW = visualFormWidth * targetZoom
    const scaledH = (visualFormHeight + formChromeHeight) * targetZoom
    const targetWorkspaceW = computeWorkspaceSpan(scaledW, host.clientWidth)
    const targetWorkspaceH = computeWorkspaceSpan(scaledH, host.clientHeight)
    const centerScroll = {
      left: Math.max(0, (targetWorkspaceW - host.clientWidth) / 2),
      top: Math.max(0, (targetWorkspaceH - host.clientHeight) / 2),
    }

    if (Math.abs(targetZoom - currentZoom) < 1e-6) {
      // 倍率不变：直接居中滚动
      host.scrollLeft = centerScroll.left
      host.scrollTop = centerScroll.top
      setScrollPos({ left: host.scrollLeft, top: host.scrollTop })
      return
    }
    zoomTo(targetZoom)
    // 覆盖 zoomTo 的锚点保持滚动，改为居中
    pendingScrollRef.current = centerScroll
    // 兜底：pendingScrollRef 由"工作区尺寸变化"的副作用消费，倍率变化很小时
    // 工作区尺寸可能不变、副作用不触发，渲染后若仍未消费则直接应用居中滚动
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (pendingScrollRef.current !== centerScroll) return
      pendingScrollRef.current = null
      const hostNow = canvasAreaRef.current
      if (!hostNow) return
      hostNow.scrollLeft = centerScroll.left
      hostNow.scrollTop = centerScroll.top
      setScrollPos({ left: hostNow.scrollLeft, top: hostNow.scrollTop })
    }))
  }, [visualFormWidth, visualFormHeight, formChromeHeight, zoomTo])

  // 缩放到适应窗口：窗体完整可见、尽量铺满画布可视区域，并居中显示
  const fitZoomToViewport = useCallback(() => {
    const host = canvasAreaRef.current
    if (!host) return
    const padding = 24
    const availableWidth = Math.max(host.clientWidth - padding, 50)
    const availableHeight = Math.max(host.clientHeight - padding, 50)
    const fit = Math.min(
      availableWidth / Math.max(visualFormWidth, 1),
      availableHeight / Math.max(visualFormHeight + formChromeHeight, 1),
    )
    zoomToCentered(fit)
  }, [visualFormWidth, visualFormHeight, formChromeHeight, zoomToCentered])

  // 倍率预设：首项为实际最小倍率，其余固定档位（超出范围的剔除）
  const zoomPresetPercents = (() => {
    const minPercent = Math.round(MIN_ZOOM * 100)
    const maxPercent = Math.round(MAX_ZOOM * 100)
    const fixed = [30, 50, 80, 100, 150, 200, 300, 500, 1000].filter(p => p > minPercent && p <= maxPercent)
    return [minPercent, ...fixed]
  })()

  const handleCanvasScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const host = e.currentTarget
    setScrollPos({ left: host.scrollLeft, top: host.scrollTop })
  }, [])

  const handleCanvasPanMouseDownCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    canvasRegionRef.current?.focus({ preventScroll: true })
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== canvasRegionRef.current && active.tagName === 'BUTTON') {
      active.blur()
    }

    if (e.button !== 0) return
    if (!isSpacePressedRef.current) return
    const host = canvasAreaRef.current
    if (!host) return

    e.preventDefault()
    e.stopPropagation()

    const startX = e.clientX
    const startY = e.clientY
    const startLeft = host.scrollLeft
    const startTop = host.scrollTop
    setIsPanningView(true)

    const handleMouseMove = (ev: MouseEvent): void => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      host.scrollLeft = startLeft - dx
      host.scrollTop = startTop - dy
      setScrollPos({ left: host.scrollLeft, top: host.scrollTop })
    }

    const handleMouseUp = (): void => {
      setIsPanningView(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [])

  const handleCanvasAreaWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const isZoomGesture = e.ctrlKey || e.metaKey
    if (!isZoomGesture) return
    e.preventDefault()
    const direction = Math.sign(-e.deltaY)
    if (direction > 0) stepZoom(1, { x: e.clientX, y: e.clientY })
    else if (direction < 0) stepZoom(-1, { x: e.clientX, y: e.clientY })
  }, [stepZoom])

  const handleCanvasAreaKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.code === 'Space') {
      e.preventDefault()
      return
    }
    if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      stepZoom(1)
      return
    }
    if (e.key === '-' || e.key === '_') {
      e.preventDefault()
      stepZoom(-1)
      return
    }
    if (e.key === '0') {
      e.preventDefault()
      setZoom(1)
    }
  }, [stepZoom])

  // 同步 lastSelectedId
  useEffect(() => {
    if (selectedId) lastSelectedId = selectedId
  }, [selectedId])

  // 外部选中同步（属性面板下拉框切换）
  useEffect(() => {
    if (externalSelectedId !== undefined && externalSelectedId !== selectedId) {
      setSelectedId(externalSelectedId)
    }
  }, [externalSelectedId])

  // 通知父组件选中状态变化
  useEffect(() => {
    if (selectedId === '__form__') {
      onSelectControl({ kind: 'form', form })
    } else if (selectedControl) {
      pendingNewIdRef.current = null
      onSelectControl({ kind: 'control', control: selectedControl, form })
    } else if (!pendingNewIdRef.current) {
      // 仅在非新建控件等待期间才发送 null（避免 addControl 后渲染间隙闪烁）
      onSelectControl(null)
    }
  }, [selectedId, selectedControl, form, onSelectControl])

  const updateControl = useCallback((id: string, patch: Partial<DesignControl>) => {
    const latestForm = formRef.current
    onChangeRef.current({
      ...latestForm,
      controls: latestForm.controls.map(c => c.id === id ? { ...c, ...patch } : c),
    })
  }, [])

  const addControl = useCallback((unitName: string, x: number, y: number, w?: number, h?: number) => {
    const latestForm = formRef.current
    const sizes = DEFAULT_SIZES[unitName] || DEFAULT_SIZE
    // 确保 ID 不与现有控件冲突
    const existingIds = new Set(latestForm.controls.map(c => c.id))
    let id: string
    do {
      id = `ctrl_${nextControlId++}`
    } while (existingIds.has(id))
    const count = latestForm.controls.filter(c => c.type === unitName).length + 1
    // 某些组件默认带文字
    const hasText = ['按钮', '标签', '选择框', '单选框', '分组框'].includes(unitName)
    const newCtrl: DesignControl = {
      id,
      type: unitName,
      name: `${unitName}${count}`,
      left: snap(x),
      top: snap(y),
      width: w ?? sizes[0],
      height: h ?? sizes[1],
      text: hasText ? `${unitName}${count}` : '',
      visible: true,
      enabled: true,
      properties: {},
    }
    // 拖入选择夹体区 → 归属当前显示页（几何 + 当前页）
    const tabsNow = latestForm.controls.filter(c => c.type === '选择夹' || c.type === 'Tab')
    const own = ownershipForRect(newCtrl, tabsNow)
    if (own) { newCtrl.properties['所属选择夹'] = own.owner; newCtrl.properties['所属子夹'] = own.page }
    pendingNewIdRef.current = id
    onChangeRef.current({ ...latestForm, controls: [...latestForm.controls, newCtrl] })
    setSelectedId(id)
    setSelectedIds(new Set())
    setActiveTool(null)
  }, [])

  const deleteSelected = useCallback(() => {
    const latestForm = formRef.current
    if (selectedIds.size > 0) {
      onChangeRef.current({ ...latestForm, controls: latestForm.controls.filter(c => !selectedIds.has(c.id)) })
      setSelectedIds(new Set())
      setSelectedId(null)
      return
    }
    if (!selectedId) return
    onChangeRef.current({ ...latestForm, controls: latestForm.controls.filter(c => c.id !== selectedId) })
    setSelectedId(null)
  }, [selectedId, selectedIds])

  // ===== 右键菜单动作：复制/剪切/粘贴/层级/锁定，均作用于当前选中控件 =====
  const getSelectedControlIds = useCallback((): string[] => {
    if (selectedIds.size > 0) return [...selectedIds]
    if (selectedId && selectedId !== '__form__') return [selectedId]
    return []
  }, [selectedIds, selectedId])

  const copySelected = useCallback(() => {
    const ids = new Set(getSelectedControlIds())
    if (ids.size === 0) return
    vdControlClipboard = formRef.current.controls
      .filter(c => ids.has(c.id))
      .map(c => ({ ...c, properties: { ...c.properties } }))
  }, [getSelectedControlIds])

  const pasteControls = useCallback(() => {
    if (vdControlClipboard.length === 0) return
    const latestForm = formRef.current
    const existingIds = new Set(latestForm.controls.map(c => c.id))
    const newControls: DesignControl[] = []
    for (const src of vdControlClipboard) {
      let id: string
      do { id = `ctrl_${nextControlId++}` } while (existingIds.has(id))
      existingIds.add(id)
      // 生成唯一名字：类型 + 最小可用序号
      const usedNames = new Set([...latestForm.controls, ...newControls].map(c => c.name))
      let n = 1
      let name = `${src.type}${n}`
      while (usedNames.has(name)) { n++; name = `${src.type}${n}` }
      newControls.push({ ...src, id, name, left: src.left + 8, top: src.top + 8, properties: { ...src.properties } })
    }
    onChangeRef.current({ ...latestForm, controls: [...latestForm.controls, ...newControls] })
    if (newControls.length > 1) {
      setSelectedIds(new Set(newControls.map(c => c.id)))
      setSelectedId(newControls[newControls.length - 1].id)
    } else {
      setSelectedIds(new Set())
      setSelectedId(newControls[0]?.id ?? null)
    }
  }, [])

  const cutSelected = useCallback(() => {
    copySelected()
    deleteSelected()
  }, [copySelected, deleteSelected])

  const bringToFront = useCallback(() => {
    const ids = new Set(getSelectedControlIds())
    if (ids.size === 0) return
    const latestForm = formRef.current
    const kept = latestForm.controls.filter(c => !ids.has(c.id))
    const moved = latestForm.controls.filter(c => ids.has(c.id))
    onChangeRef.current({ ...latestForm, controls: [...kept, ...moved] })
  }, [getSelectedControlIds])

  const sendToBack = useCallback(() => {
    const ids = new Set(getSelectedControlIds())
    if (ids.size === 0) return
    const latestForm = formRef.current
    const moved = latestForm.controls.filter(c => ids.has(c.id))
    const kept = latestForm.controls.filter(c => !ids.has(c.id))
    onChangeRef.current({ ...latestForm, controls: [...moved, ...kept] })
  }, [getSelectedControlIds])

  const setLockSelected = useCallback((locked: boolean) => {
    const ids = new Set(getSelectedControlIds())
    if (ids.size === 0) return
    const latestForm = formRef.current
    onChangeRef.current({ ...latestForm, controls: latestForm.controls.map(c => ids.has(c.id) ? { ...c, locked } : c) })
  }, [getSelectedControlIds])

  // 打开右键菜单：右键控件时若它不在多选集合内，则单选它
  const openContextMenu = useCallback((e: React.MouseEvent, ctrl?: DesignControl) => {
    e.preventDefault()
    e.stopPropagation()
    if (ctrl && !selectedIds.has(ctrl.id)) {
      setSelectedIds(new Set())
      setSelectedId(ctrl.id)
    }
    setCtxSubmenuOpen(false)
    setContextMenu({ x: e.clientX, y: e.clientY, onControl: !!ctrl })
  }, [selectedIds])

  const runVdMenuAction = useCallback((action: string) => {
    setContextMenu(null)
    switch (action) {
      case 'undo': onUndo?.(); break
      case 'delete': deleteSelected(); break
      case 'copy': copySelected(); break
      case 'cut': cutSelected(); break
      case 'paste': pasteControls(); break
      case 'toFront': bringToFront(); break
      case 'toBack': sendToBack(); break
      case 'lock': setLockSelected(true); break
      case 'unlock': setLockSelected(false); break
      case 'openSource': onOpenWindowSource?.(); break
      case 'navBack': onNavigateBack?.(); break
      case 'preview': onPreviewWindow?.(); break
      case 'menuEditor': setMenuEditorOpen(true); break
      case 'viewType': {
        const ctrl = formRef.current.controls.find(c => c.id === getSelectedControlIds()[0])
        if (ctrl) {
          const unit = windowUnits.find(u => u.name === ctrl.type)
          setTypeInfoUnit(unit ?? { name: ctrl.type, englishName: '', description: '（未在支持库中找到该类型的定义信息）', libraryName: '', properties: [], events: [] })
        }
        break
      }
    }
  }, [onUndo, deleteSelected, copySelected, cutSelected, pasteControls, bringToFront, sendToBack, setLockSelected, onOpenWindowSource, onNavigateBack, onPreviewWindow, getSelectedControlIds, windowUnits])

  // 右键菜单：点击别处 / 按 Esc 关闭（延迟一帧再挂监听，避免开菜单那次 mousedown 立即关掉）
  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    const onKey = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') { ev.stopPropagation(); setContextMenu(null) } }
    const t = window.setTimeout(() => {
      document.addEventListener('mousedown', close)
      window.addEventListener('keydown', onKey, true)
    }, 0)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [contextMenu])

  // 设计器菜单栏下拉：点别处 / Esc 关闭
  useEffect(() => {
    if (menuBarOpenTop === null) return
    const close = (): void => setMenuBarOpenTop(null)
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setMenuBarOpenTop(null) }
    const t = window.setTimeout(() => {
      document.addEventListener('mousedown', close)
      window.addEventListener('keydown', onKey, true)
    }, 0)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [menuBarOpenTop])

  // 「查看数据类型定义」弹框：Esc 关闭
  useEffect(() => {
    if (!typeInfoUnit) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); setTypeInfoUnit(null) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [typeInfoUnit])

  // 通知父组件多选数量变化
  useEffect(() => {
    onMultiSelectChange?.(selectedIds.size)
  }, [selectedIds.size, onMultiSelectChange])

  // 执行对齐操作（由设计器标尺下方的对齐工具条直接调用；需选中 ≥2 个控件）
  const applyAlign = useCallback((action: AlignAction): void => {
    if (!action) return
    // 收集所有选中的控件（多选 + 单选）
    const ids = selectedIds.size > 0 ? selectedIds : (selectedId && selectedId !== '__form__' ? new Set([selectedId]) : new Set<string>())
    const selected = form.controls.filter(c => ids.has(c.id))
    if (selected.length < 2) return

    // 以最边缘的控件为基准
    const minLeft = Math.min(...selected.map(c => c.left))
    const maxRight = Math.max(...selected.map(c => c.left + c.width))
    const minTop = Math.min(...selected.map(c => c.top))
    const maxBottom = Math.max(...selected.map(c => c.top + c.height))
    // 找最宽和最高的控件用于同大小操作
    const maxW = Math.max(...selected.map(c => c.width))
    const maxH = Math.max(...selected.map(c => c.height))

    const updated = form.controls.map(c => {
      if (!ids.has(c.id)) return c
      switch (action) {
        case 'align-left': return { ...c, left: minLeft }
        case 'align-right': return { ...c, left: maxRight - c.width }
        case 'align-top': return { ...c, top: minTop }
        case 'align-bottom': return { ...c, top: maxBottom - c.height }
        case 'center-h': { const cx = Math.round((minLeft + maxRight) / 2); return { ...c, left: cx - Math.round(c.width / 2) } }
        case 'center-v': { const cy = Math.round((minTop + maxBottom) / 2); return { ...c, top: cy - Math.round(c.height / 2) } }
        case 'same-width': return { ...c, width: maxW }
        case 'same-height': return { ...c, height: maxH }
        case 'same-size': return { ...c, width: maxW, height: maxH }
        default: return c
      }
    })
    onChange({ ...form, controls: updated })
  }, [selectedIds, selectedId, form, onChange])

  // 键盘事件
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Delete' && selectedId) {
        e.preventDefault()
        deleteSelected()
      }
      if (e.key === 'Escape') {
        setActiveTool(null)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedId, deleteSelected])

  // 设计器编辑快捷键（Ctrl+C/X/V 复制剪切粘贴、Ctrl+T 置顶）。用「捕获阶段」抢在 App 全局
  // 快捷键之前处理并阻断：否则 App 的 edit:paste 对 efw 会触发命令粘贴，与控件粘贴冲突。
  // 仅在真正有可操作对象时才拦截（否则放行，交给 App/浏览器）。
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      const tgt = e.target
      if (tgt instanceof HTMLElement && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return
      const hasSel = getSelectedControlIds().length > 0
      let done = false
      switch (e.key.toLowerCase()) {
        case 'c': if (hasSel) { copySelected(); done = true } break
        case 'x': if (hasSel) { cutSelected(); done = true } break
        case 'v': if (vdControlClipboard.length > 0) { pasteControls(); done = true } break
        case 't': if (hasSel) { bringToFront(); done = true } break
        case 'u': if (onOpenWindowSource) { onOpenWindowSource(); done = true } break
        case 'j': if (onNavigateBack && onCanNavigateBack?.()) { onNavigateBack(); done = true } break
        case 'enter': if (onPreviewWindow) { onPreviewWindow(); done = true } break // Ctrl+Enter 预览
        case 'e': setMenuEditorOpen(true); done = true; break // Ctrl+E 菜单编辑器
      }
      if (done) { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [getSelectedControlIds, copySelected, cutSelected, pasteControls, bringToFront, onOpenWindowSource, onNavigateBack, onCanNavigateBack, onPreviewWindow])

  // 画布鼠标按下 — 开始创建控件或选中窗口
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    if (isSpacePressedRef.current) {
      e.preventDefault()
      return
    }
    const start = getCanvasPoint(e.clientX, e.clientY)
    const startX = start.x
    const startY = start.y

    if (activeTool) {
      // 拖拽绘制控件：按住鼠标拖动定义大小
      const tool = activeTool
      setDrawRect({ x: snap(startX), y: snap(startY), w: 0, h: 0 })

      const handleMouseMove = (ev: MouseEvent): void => {
        const p = getCanvasPoint(ev.clientX, ev.clientY)
        const mx = p.x
        const my = p.y
        const x1 = Math.min(startX, mx)
        const y1 = Math.min(startY, my)
        const x2 = Math.max(startX, mx)
        const y2 = Math.max(startY, my)
        setDrawRect({ x: snap(x1), y: snap(y1), w: snap(x2 - x1), h: snap(y2 - y1) })
      }

      const handleMouseUp = (ev: MouseEvent): void => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        const p = getCanvasPoint(ev.clientX, ev.clientY)
        const mx = p.x
        const my = p.y
        const x1 = Math.min(startX, mx)
        const y1 = Math.min(startY, my)
        const drawW = snap(Math.abs(mx - startX))
        const drawH = snap(Math.abs(my - startY))
        setDrawRect(null)
        // 拖拽距离足够则使用拖拽大小，否则使用默认大小
        if (drawW >= 8 && drawH >= 8) {
          addControl(tool, x1, y1, drawW, drawH)
        } else {
          addControl(tool, snap(startX), snap(startY))
        }
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    } else {
      // 点击空白选中窗口自身
      const handleMouseMove = (ev: MouseEvent): void => {
        const p = getCanvasPoint(ev.clientX, ev.clientY)
        const x1 = Math.min(startX, p.x)
        const y1 = Math.min(startY, p.y)
        const x2 = Math.max(startX, p.x)
        const y2 = Math.max(startY, p.y)
        const w = snap(x2 - x1)
        const h = snap(y2 - y1)
        if (w >= 4 || h >= 4) {
          setMarqueeRect({ x: snap(x1), y: snap(y1), w, h })
        }
      }

      const handleMouseUp = (ev: MouseEvent): void => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        const p = getCanvasPoint(ev.clientX, ev.clientY)
        const x1 = Math.min(startX, p.x)
        const y1 = Math.min(startY, p.y)
        const x2 = Math.max(startX, p.x)
        const y2 = Math.max(startY, p.y)
        setMarqueeRect(null)

        if (Math.abs(x2 - startX) < 4 && Math.abs(y2 - startY) < 4) {
          setSelectedId('__form__')
          setSelectedIds(new Set())
          return
        }

        const selectionBox = { left: x1, top: y1, right: x2, bottom: y2 }
        const nextIds = formRef.current.controls
          .filter(control => rectsIntersect(selectionBox, {
            left: control.left,
            top: control.top,
            right: control.left + control.width,
            bottom: control.top + control.height,
          }))
          .map(control => control.id)

        if (nextIds.length === 0) {
          setSelectedId('__form__')
          setSelectedIds(new Set())
          return
        }

        setSelectedIds(new Set(nextIds))
        setSelectedId(nextIds[0])
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }
  }, [activeTool, addControl, getCanvasPoint])

  // 窗口标题栏点击 — 选中窗口
  const handleFormTitleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedId('__form__')
    setSelectedIds(new Set())
  }, [])

  // 窗口句柄拖拽 — 调整窗口大小
  const handleFormResizeMouseDown = useCallback((e: React.MouseEvent, handle: 'e' | 's' | 'se') => {
    e.stopPropagation()
    if (e.button !== 0) return
    const startX = e.clientX
    const startY = e.clientY
    const origW = form.width
    const origH = form.height

    const handleMouseMove = (ev: MouseEvent): void => {
      const currentZoom = zoomRef.current || 1
      const dx = (ev.clientX - startX) / currentZoom
      const dy = (ev.clientY - startY) / currentZoom
      let w = origW, h = origH
      if (handle.includes('e')) w = Math.max(FORM_MIN_WIDTH, origW + dx)
      if (handle.includes('s')) h = Math.max(FORM_MIN_HEIGHT, origH + dy)
      onChangeRef.current({ ...formRef.current, width: snap(w), height: snap(h) })
    }

    const handleMouseUp = (): void => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
    }

    const cursorMap = { e: 'e-resize', s: 's-resize', se: 'se-resize' }
    document.body.style.cursor = cursorMap[handle]
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [form])

  // 控件双击 — 跳转到默认事件子程序
  const handleControlDblClick = useCallback((e: React.MouseEvent, ctrl: DesignControl) => {
    e.stopPropagation()
    e.preventDefault()
    const unitInfo = windowUnits.find(u => u.name === ctrl.type)
    const defaultEvent = unitInfo?.events?.[0] ?? null
    onControlDoubleClick?.(ctrl, defaultEvent)
  }, [windowUnits, onControlDoubleClick])

  // 窗口双击（标题栏或空白客户区）— 跳转到窗口默认事件子程序
  const handleFormDblClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const formUnit = windowUnits.find(u => u.name === '窗口')
    const defaultEvent = formUnit?.events?.[0] ?? null
    onFormDoubleClick?.(form, defaultEvent)
  }, [windowUnits, onFormDoubleClick, form])

  useEffect(() => {
    const minW = getToolboxMinWidth(toolboxViewMode)
    if (!toolboxFloat && toolboxDockWidth < minW) {
      setToolboxDockWidth(minW)
    }
    if (toolboxFloat && toolboxSize.w < minW) {
      setToolboxSize(prev => ({ ...prev, w: minW }))
    }
  }, [toolboxDockWidth, toolboxFloat, toolboxSize.w, toolboxViewMode])

  const clampFloatingToolboxRect = useCallback((x: number, y: number, w: number, h: number) => {
    const hostRect = designerRootRef.current?.getBoundingClientRect()
    if (!hostRect) return { x, y, w, h }

    const minWidth = getToolboxMinWidth(toolboxViewMode)
    const maxWidth = Math.max(minWidth, Math.floor(hostRect.width))
    const maxHeight = Math.max(TOOLBOX_FLOAT_MIN_HEIGHT, Math.floor(hostRect.height))
    const nextW = clamp(Math.round(w), minWidth, maxWidth)
    const nextH = clamp(Math.round(h), TOOLBOX_FLOAT_MIN_HEIGHT, maxHeight)

    const minX = hostRect.left
    const maxX = Math.max(minX, hostRect.right - nextW)
    const minY = hostRect.top
    const maxY = Math.max(minY, hostRect.bottom - nextH)

    return {
      x: clamp(Math.round(x), minX, maxX),
      y: clamp(Math.round(y), minY, maxY),
      w: nextW,
      h: nextH,
    }
  }, [toolboxViewMode])

  const toggleToolboxFloat = useCallback(() => {
    if (toolboxFloat) {
      setToolboxFloat(false)
      return
    }
    const hostRect = designerRootRef.current?.getBoundingClientRect()
    const desiredX = hostRect
      ? (toolboxDockSide === 'right' ? hostRect.right - toolboxSize.w - 8 : hostRect.left + 8)
      : toolboxPos.x
    const desiredY = hostRect ? hostRect.top + 40 : toolboxPos.y
    const next = clampFloatingToolboxRect(desiredX, desiredY, toolboxSize.w, toolboxSize.h)
    setToolboxPos({ x: next.x, y: next.y })
    setToolboxSize({ w: next.w, h: next.h })
    setToolboxFloat(true)
  }, [clampFloatingToolboxRect, toolboxDockSide, toolboxFloat, toolboxPos.x, toolboxPos.y, toolboxSize.h, toolboxSize.w])

  const handleDockResizeStart = useCallback((e: React.MouseEvent) => {
    if (toolboxFloat) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = toolboxDockWidth
    const side = toolboxDockSide
    const minW = getToolboxMinWidth(toolboxViewMode)

    const handleMouseMove = (ev: MouseEvent): void => {
      const dx = ev.clientX - startX
      const raw = side === 'right' ? startW - dx : startW + dx
      setToolboxDockWidth(clamp(Math.round(raw), minW, TOOLBOX_DOCK_MAX_WIDTH))
    }

    const handleMouseUp = (): void => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
    }

    document.body.style.cursor = 'ew-resize'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [toolboxDockSide, toolboxDockWidth, toolboxFloat, toolboxViewMode])

  const handleFloatResizeStart = useCallback((e: React.MouseEvent) => {
    if (!toolboxFloat) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const startW = toolboxSize.w
    const startH = toolboxSize.h
    const startPos = toolboxPos

    const handleMouseMove = (ev: MouseEvent): void => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      const next = clampFloatingToolboxRect(startPos.x, startPos.y, startW + dx, startH + dy)
      setToolboxPos({ x: next.x, y: next.y })
      setToolboxSize({ w: next.w, h: next.h })
    }

    const handleMouseUp = (): void => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
    }

    document.body.style.cursor = 'nwse-resize'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [clampFloatingToolboxRect, toolboxFloat, toolboxPos, toolboxSize.h, toolboxSize.w])

  useEffect(() => {
    if (!toolboxFloat) return

    const clampNow = (): void => {
      const next = clampFloatingToolboxRect(toolboxPos.x, toolboxPos.y, toolboxSize.w, toolboxSize.h)
      if (next.x !== toolboxPos.x || next.y !== toolboxPos.y) {
        setToolboxPos({ x: next.x, y: next.y })
      }
      if (next.w !== toolboxSize.w || next.h !== toolboxSize.h) {
        setToolboxSize({ w: next.w, h: next.h })
      }
    }

    clampNow()

    if (typeof ResizeObserver === 'undefined' || !designerRootRef.current) return
    const observer = new ResizeObserver(() => clampNow())
    observer.observe(designerRootRef.current)
    return () => observer.disconnect()
  }, [clampFloatingToolboxRect, toolboxFloat, toolboxPos.x, toolboxPos.y, toolboxSize.h, toolboxSize.w])

  // 控件鼠标按下 — 开始移动（支持 Shift 多选）
  const handleControlMouseDown = useCallback((e: React.MouseEvent, ctrl: DesignControl) => {
    e.stopPropagation()
    if (e.button !== 0) return

    if (e.shiftKey) {
      // Shift+点击：切换多选
      setSelectedIds(prev => {
        const next = new Set(prev)
        if (next.has(ctrl.id)) {
          next.delete(ctrl.id)
        } else {
          next.add(ctrl.id)
          // 把当前单选的也加入多选集合
          if (selectedId && selectedId !== '__form__' && !next.has(selectedId)) {
            next.add(selectedId)
          }
        }
        return next
      })
      setSelectedId(ctrl.id)
      return // Shift+click 不启动拖拽
    }

    // 判断是否属于多选集合
    const isInMultiSelect = selectedIds.has(ctrl.id)

    if (!isInMultiSelect) {
      // 普通点击不在多选中的控件：清除多选，单选此控件
      setSelectedIds(new Set())
      setSelectedId(ctrl.id)
    }

    // 锁定的控件：允许选中（便于在右键菜单里解锁），但不启动拖动
    if (ctrl.locked) return

    if (isInMultiSelect && selectedIds.size >= 2) {
      // 多选拖拽：记录所有选中控件的初始位置
      const origPositions = new Map<string, { left: number; top: number }>()
      for (const id of selectedIds) {
        const c = form.controls.find(cc => cc.id === id)
        if (c) origPositions.set(id, { left: c.left, top: c.top })
      }
      const selectedControls = form.controls.filter(c => selectedIds.has(c.id))
      const minLeft = Math.min(...selectedControls.map(c => c.left))
      const minTop = Math.min(...selectedControls.map(c => c.top))
      const maxRight = Math.max(...selectedControls.map(c => c.left + c.width))
      const maxBottom = Math.max(...selectedControls.map(c => c.top + c.height))
      const groupWidth = maxRight - minLeft
      const groupHeight = maxBottom - minTop
      const refs = buildReferenceLines(form.controls, selectedIds, form.width, form.height)
      const start = getCanvasPoint(e.clientX, e.clientY)
      const startX = start.x
      const startY = start.y

      const handleMouseMove = (ev: MouseEvent): void => {
        const p = getCanvasPoint(ev.clientX, ev.clientY)
        const mx = p.x
        const my = p.y
        let dx = snap(mx - startX)
        let dy = snap(my - startY)

        let snappedLeft = minLeft + dx
        let snappedTop = minTop + dy

        const xSnap = resolveAxisSnap(snappedLeft, groupWidth, refs.x)
        const ySnap = resolveAxisSnap(snappedTop, groupHeight, refs.y)

        if (xSnap) snappedLeft = xSnap.pos
        if (ySnap) snappedTop = ySnap.pos

        snappedLeft = Math.max(0, snappedLeft)
        snappedTop = Math.max(0, snappedTop)

        dx = snappedLeft - minLeft
        dy = snappedTop - minTop

        setAlignGuides({
          x: xSnap ? [xSnap.guide] : [],
          y: ySnap ? [ySnap.guide] : [],
        })

        const latestForm = formRef.current
        onChangeRef.current({
          ...latestForm,
          controls: latestForm.controls.map(c => {
            const orig = origPositions.get(c.id)
            if (!orig) return c
            return { ...c, left: Math.max(0, orig.left + dx), top: Math.max(0, orig.top + dy) }
          }),
        })
      }

      const handleMouseUp = (): void => {
        setAlignGuides({ x: [], y: [] })
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        reassignTabOwnership([...origPositions.keys()])  // 落点重指派子夹归属
      }

      document.body.style.cursor = 'move'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    } else {
      // 单控件拖拽
      dragRef.current = {
        mode: 'move',
        controlId: ctrl.id,
        startX: getCanvasPoint(e.clientX, e.clientY).x,
        startY: getCanvasPoint(e.clientX, e.clientY).y,
        origLeft: ctrl.left,
        origTop: ctrl.top,
        origWidth: ctrl.width,
        origHeight: ctrl.height,
      }

      const handleMouseMove = (ev: MouseEvent): void => {
        const d = dragRef.current
        if (!d) return
        const p = getCanvasPoint(ev.clientX, ev.clientY)
        const mx = p.x
        const my = p.y
        const dx = snap(mx - d.startX)
        const dy = snap(my - d.startY)

        let nextLeft = Math.max(0, d.origLeft + dx)
        let nextTop = Math.max(0, d.origTop + dy)

        const refs = buildReferenceLines(formRef.current.controls, new Set([d.controlId]), formRef.current.width, formRef.current.height)
        const xSnap = resolveAxisSnap(nextLeft, d.origWidth, refs.x)
        const ySnap = resolveAxisSnap(nextTop, d.origHeight, refs.y)

        if (xSnap) nextLeft = Math.max(0, xSnap.pos)
        if (ySnap) nextTop = Math.max(0, ySnap.pos)

        setAlignGuides({
          x: xSnap ? [xSnap.guide] : [],
          y: ySnap ? [ySnap.guide] : [],
        })

        updateControl(d.controlId, {
          left: nextLeft,
          top: nextTop,
        })
      }

      const handleMouseUp = (): void => {
        dragRef.current = null
        setAlignGuides({ x: [], y: [] })
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        reassignTabOwnership([ctrl.id])  // 落点重指派子夹归属
      }

      document.body.style.cursor = 'move'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }
  }, [updateControl, selectedIds, selectedId, form.controls, form.width, form.height, getCanvasPoint])

  // 句柄鼠标按下 — 开始缩放
  const handleResizeMouseDown = useCallback((e: React.MouseEvent, ctrl: DesignControl, handle: HandleDir) => {
    e.stopPropagation()
    if (e.button !== 0) return

    const start = getCanvasPoint(e.clientX, e.clientY)
    dragRef.current = {
      mode: 'resize',
      controlId: ctrl.id,
      handle,
      startX: start.x,
      startY: start.y,
      origLeft: ctrl.left,
      origTop: ctrl.top,
      origWidth: ctrl.width,
      origHeight: ctrl.height,
    }

    const handleMouseMove = (ev: MouseEvent): void => {
      const d = dragRef.current
      if (!d || !d.handle) return
      const p = getCanvasPoint(ev.clientX, ev.clientY)
      const mx = p.x
      const my = p.y
      const dx = mx - d.startX
      const dy = my - d.startY

      let { origLeft: l, origTop: t, origWidth: w, origHeight: h } = d
      const dir = d.handle

      if (dir.includes('e')) w = Math.max(16, w + dx)
      if (dir.includes('w')) { w = Math.max(16, w - dx); l += d.origWidth - w }
      if (dir.includes('s')) h = Math.max(16, h + dy)
      if (dir.includes('n')) { h = Math.max(16, h - dy); t += d.origHeight - h }

      updateControl(d.controlId, {
        left: snap(Math.max(0, l)),
        top: snap(Math.max(0, t)),
        width: snap(w),
        height: snap(h),
      })
    }

    const handleMouseUp = (): void => {
      dragRef.current = null
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
    }

    const cursorMap: Record<HandleDir, string> = {
      nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
      w: 'w-resize', e: 'e-resize',
      sw: 'sw-resize', s: 's-resize', se: 'se-resize',
    }
    document.body.style.cursor = cursorMap[handle]
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [updateControl, getCanvasPoint])

  // 渲染单个控件的预览外观
  const renderControlPreview = (ctrl: DesignControl): React.JSX.Element => {
    const controlColors = resolveControlVisualColors(ctrl)
    const unitInfo = windowUnits.find(u => u.name === ctrl.type)

    switch (ctrl.type) {
      case '按钮': {
        const props = ctrl.properties || {}
        const btnStyle = Number(props['类型'] ?? 0)        // 0通常 1默认
        const hAlign = Number(props['横向对齐方式'] ?? 1)   // 0左 1中 2右
        const vAlign = Number(props['纵向对齐方式'] ?? 1)   // 0顶 1中 2底
        const btnImage = typeof props['图片'] === 'string' && (props['图片'] as string).startsWith('data:image')
          ? (props['图片'] as string)
          : ''
        const toFlex = (n: number): string => n === 1 ? 'center' : n === 2 ? 'flex-end' : 'flex-start'
        // 底色（COLORREF，0=默认）
        const btnBackRaw = props['底色']
        const btnBackColor = typeof btnBackRaw === 'number' && btnBackRaw !== 0 ? (colorFromNumber(btnBackRaw) || controlColors.bg) : controlColors.bg
        return (
          <div
            className={`vd-preview vd-preview-button${btnStyle === 1 ? ' vd-preview-button-default' : ''}`}
            ref={(element) => setCssVars(element, {
              '--vd-preview-bg': btnBackColor,
              '--vd-preview-border': controlColors.border,
              '--vd-preview-text': controlColors.text,
              '--vd-preview-justify': toFlex(hAlign),
              '--vd-preview-align-items': toFlex(vAlign),
            })}
          >
            {btnImage ? <img className="vd-preview-button-img" src={btnImage} alt="" /> : ctrl.text}
          </div>
        )
      }
      case '编辑框':
      case '超级编辑框': {
        const props = ctrl.properties || {}
        const isMultiline = props['是否允许多行'] === true || props['是否允许多行'] === '真'
        const inputMode = Number(props['输入方式'] ?? 0)
        const isPassword = inputMode === 2
        const maskChar = String(props['密码遮盖字符'] ?? '*').charAt(0) || '*'
        const align = Number(props['对齐方式'] ?? 0)
        const borderMode = Number(props['边框'] ?? 2)
        const spinMode = Number(props['调节器方式'] ?? 0)
        const displayText = isPassword ? maskChar.repeat((ctrl.text || '').length) : ctrl.text
        return (
          <div
            className={`vd-preview vd-preview-input${isMultiline ? ' vd-preview-input-multiline' : ''}${borderMode === 0 ? ' vd-preview-input-borderless' : ''}${borderMode === 2 ? ' vd-preview-input-sunken' : ''}${spinMode !== 0 ? ' vd-preview-input-spin' : ''}`}
            ref={(element) => setCssVars(element, {
              '--vd-preview-bg': readColorProperty(ctrl.properties, ['背景颜色', '背景色', '背景']) || '#ffffff',
              '--vd-preview-border': controlColors.border,
              '--vd-preview-text': readColorProperty(ctrl.properties, ['文本颜色', '前景颜色', '前景色', '文字颜色']) || controlColors.text,
              '--vd-preview-align': align === 1 ? 'center' : align === 2 ? 'right' : 'left',
            })}
          >
            <span className="vd-preview-input-text">{displayText}</span>
            {spinMode !== 0 && (
              <span className="vd-preview-spin" aria-hidden="true">
                <span className="vd-preview-spin-btn">▴</span>
                <span className="vd-preview-spin-btn">▾</span>
              </span>
            )}
          </div>
        )
      }
      case '浏览框':
      case 'WebView': {
        const rawUrl = String(ctrl.properties?.['地址'] ?? ctrl.text ?? '').trim()
        const previewUrl = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : (rawUrl ? `https://${rawUrl}` : '')
        return (
          <div className="vd-preview vd-preview-webview">
            {previewUrl ? (
              <iframe
                className="vd-preview-webview-frame"
                src={previewUrl}
                title={`${ctrl.name} 网页预览`}
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            ) : (
              <div className="vd-preview-webview-placeholder">浏览框：在属性面板设置“地址”后预览网页</div>
            )}
            {previewUrl && <div className="vd-preview-webview-url">{previewUrl}</div>}
          </div>
        )
      }
      case '网页按钮':
      case 'WebButton':
        // 样式与 lib/webview2/impl/windows.cpp buildButtonHtml 模板保持一致（所见即所得）
        return (
          <div className="vd-preview vd-preview-webbutton">{ctrl.text}</div>
        )
      case '网页编辑框':
      case 'WebEdit':
        // 样式与 lib/webview2/impl/windows.cpp buildEditHtml 模板保持一致（所见即所得）
        return (
          <div className="vd-preview vd-preview-webedit">{ctrl.text}</div>
        )
      case '标签': {
        const props = ctrl.properties || {}
        const hAlign = Number(props['横向对齐方式'] ?? 0)  // 0左 1中 2右
        const vAlign = Number(props['纵向对齐方式'] ?? 0)  // 0顶 1中 2底
        const border = Number(props['边框'] ?? 0)          // 0无 1凹入 2凸出 3浅凹 4镜框 5单线 6渐变镜框
        const transparent = Number(props['效果'] ?? 0) === 4
        // 底图（data URL）+ 底图方式（0居左上/1平铺/2居中/3缩放）——与运行时 YcLblBgProc 绘制一致
        const lblBgImg = typeof props['底图'] === 'string' && (props['底图'] as string).startsWith('data:image') ? (props['底图'] as string) : ''
        const lblBgMode = Number(props['底图方式'] ?? 0)
        // 渐变背景（未设底图时生效，与运行时 LinearGradientBrush 3 色一致）：方式 0无/1上下/2左右/3-4-7-8对角/5-6反向
        const lblGradMode = Number(props['渐变背景方式'] ?? 0)
        const gradDir = (m: number): string => m === 1 ? 'to bottom' : m === 2 ? 'to right' : m === 3 ? 'to bottom right'
          : m === 4 ? 'to bottom left' : m === 5 ? 'to top' : m === 6 ? 'to left' : m === 7 ? 'to top left' : 'to top right'
        const gc = (v: unknown): string => colorFromNumber(typeof v === 'number' ? v : 0) || 'rgb(0,0,0)'
        const lblGradCss = (!lblBgImg && lblGradMode !== 0)
          ? `linear-gradient(${gradDir(lblGradMode)}, ${gc(props['渐变背景颜色1'])}, ${gc(props['渐变背景颜色2'])}, ${gc(props['渐变背景颜色3'])})`
          : ''
        // 背景颜色默认 16777215=白（创建即白底，与运行时进颜色表填白一致）；-1 兼容旧工程=融入窗口；0 是纯黑合法色非哨兵；显式白/黑=真白/真黑。透明只由「效果=透明」驱动
        const bgNum = typeof props['背景颜色'] === 'number' ? (props['背景颜色'] as number) : 16777215
        const textNum = typeof props['文本颜色'] === 'number' ? (props['文本颜色'] as number) : 0
        const toFlex = (n: number): string => n === 1 ? 'center' : n === 2 ? 'flex-end' : 'flex-start'
        const borderCls = border === 1 || border === 3 ? ' vd-preview-label-sunken'
          : border === 2 ? ' vd-preview-label-raised'
          : border === 4 || border === 5 || border === 6 ? ' vd-preview-label-bordered' : ''
        return (
          <div
            className={`vd-preview vd-preview-label${borderCls}`}
            style={lblBgImg ? {
              backgroundImage: `url("${lblBgImg}")`,
              backgroundRepeat: lblBgMode === 1 ? 'repeat' : 'no-repeat',
              backgroundPosition: lblBgMode === 2 ? 'center' : '0 0',
              backgroundSize: lblBgMode === 3 ? '100% 100%' : 'auto',
            } : lblGradCss ? { backgroundImage: lblGradCss } : undefined}
            ref={(element) => setCssVars(element, {
              '--vd-preview-bg': transparent || bgNum < 0 ? 'transparent' : (colorFromNumber(bgNum) || 'transparent'),
              '--vd-preview-text': colorFromNumber(textNum) || controlColors.text,
              '--vd-preview-justify': toFlex(hAlign),
              '--vd-preview-align-items': vAlign === 0 ? 'flex-start' : vAlign === 2 ? 'flex-end' : 'center',
            })}
          >{ctrl.text}</div>
        )
      }
      case '图片框':
      case '影像框': {
        const props = ctrl.properties || {}
        const pic = typeof props['图片'] === 'string' && (props['图片'] as string).startsWith('data:image') ? (props['图片'] as string) : ''
        const border = Number(props['边框'] ?? 0)
        const drawMode = Number(props['显示方式'] ?? 0)  // 0居左上 1缩放 2居中
        const bgNum = typeof props['背景颜色'] === 'number' ? (props['背景颜色'] as number) : 16777215
        const borderCls = border === 1 || border === 3 ? ' vd-preview-label-sunken'
          : border === 2 ? ' vd-preview-label-raised'
          : border === 4 || border === 5 ? ' vd-preview-label-bordered' : ''
        const fit = drawMode === 1 ? 'fill' : 'none'
        const objPos = drawMode === 2 ? 'center' : 'left top'
        return (
          <div
            className={`vd-preview vd-preview-image${borderCls}`}
            // 图片框是实底控件（非透明标签）：背景色恒显示，白色即白（不当透明）。
            ref={(element) => setCssVars(element, { '--vd-preview-bg': colorFromNumber(bgNum) || '#ffffff' })}
          >
            {pic
              ? <img src={pic} alt="" style={{ width: '100%', height: '100%', objectFit: fit as React.CSSProperties['objectFit'], objectPosition: objPos }} />
              : <span className="vd-preview-image-label">{ctrl.type}</span>}
          </div>
        )
      }
      case '画板': {
        const props = ctrl.properties || {}
        const border = Number(props['边框'] ?? 0)
        const bgNum = typeof props['画板背景色'] === 'number' ? (props['画板背景色'] as number) : 16777215
        const pic = typeof props['底图'] === 'string' && (props['底图'] as string).startsWith('data:image') ? (props['底图'] as string) : ''
        const picMode = Number(props['底图方式'] ?? 0) // 0居左上 1平铺 2居中 3缩放
        const borderCls = border === 1 || border === 3 ? ' vd-preview-label-sunken'
          : border === 2 ? ' vd-preview-label-raised'
          : border === 4 || border === 5 ? ' vd-preview-label-bordered' : ''
        return (
          <div
            className={`vd-preview vd-preview-drawpanel${borderCls}`}
            // 画板是自绘画布：背景色恒显示，可选底图（平铺/居中/居左上/缩放）；设计期只画背景不画运行时绘图内容。
            ref={(element) => setCssVars(element, {
              '--vd-preview-bg': colorFromNumber(bgNum) || '#ffffff',
              '--vd-preview-bgimg': pic ? `url(${pic})` : 'none',
              '--vd-preview-bgrepeat': picMode === 1 ? 'repeat' : 'no-repeat',
              '--vd-preview-bgpos': picMode === 2 ? 'center' : 'left top',
              '--vd-preview-bgsize': picMode === 3 ? '100% 100%' : 'auto',
            })}
          >
            <span className="vd-preview-drawpanel-label">{ctrl.name}</span>
          </div>
        )
      }
      case '选择列表框':
      case '超级列表框':
        return (
          <div className="vd-preview vd-preview-list" />
        )
      case '组合框': {
        const props = ctrl.properties || {}
        const kind = Number(props['类型'] ?? 2)
        const items = String(props['列表项目'] ?? '').split('\n').filter(Boolean)
        const curSel = Number(props['现行选中项'] ?? -1)
        const displayText = kind === 2
          ? (curSel >= 0 && items[curSel] ? items[curSel] : (items[0] || ctrl.text))
          : (String(props['内容'] ?? '') || ctrl.text)
        const bgNum = typeof props['背景颜色'] === 'number' ? (props['背景颜色'] as number) : 16777215
        const textNum = typeof props['文本颜色'] === 'number' ? (props['文本颜色'] as number) : 0
        return (
          <div
            className="vd-preview vd-preview-combo"
            ref={(el) => setCssVars(el, {
              '--vd-preview-bg': bgNum === 16777215 ? '#ffffff' : (colorFromNumber(bgNum) || '#ffffff'),
              '--vd-preview-text': colorFromNumber(textNum) || controlColors.text,
            })}
          >
            <span className="vd-preview-combo-text">{displayText}</span>
            <span className="vd-preview-combo-arrow">▾</span>
          </div>
        )
      }
      case '选择框':
      case '单选框': {
        const props = ctrl.properties || {}
        const isRadio = ctrl.type === '单选框'
        const checked = props['选中'] === true || props['选中'] === '真'
        const leftText = props['标题居左'] === true || props['标题居左'] === '真'
        const textNum = typeof props['文本颜色'] === 'number' ? (props['文本颜色'] as number) : 0
        const bgNum = typeof props['背景颜色'] === 'number' ? (props['背景颜色'] as number) : 16777215
        return (
          <div
            className={`vd-preview vd-preview-check-like${leftText ? ' vd-preview-check-leftcap' : ''}`}
            ref={(element) => setCssVars(element, {
              '--vd-preview-text': colorFromNumber(textNum) || controlColors.text,
              '--vd-preview-bg': bgNum < 0 ? 'transparent' : (colorFromNumber(bgNum) || 'transparent'),
            })}
          >
            <span className={`${isRadio ? 'vd-preview-radio' : 'vd-preview-checkbox'}${checked ? ' vd-preview-check-on' : ''}`} />
            <span className="vd-preview-check-text">{ctrl.text}</span>
          </div>
        )
      }
      case '分组框': {
        const props = ctrl.properties || {}
        const hAlign = Number(props['对齐方式'] ?? 0)
        const textNum = typeof props['文本颜色'] === 'number' ? (props['文本颜色'] as number) : 0
        const bgNum = typeof props['背景颜色'] === 'number' ? (props['背景颜色'] as number) : 16777215
        return (
          <div
            className="vd-preview vd-preview-group"
            ref={(element) => setCssVars(element, {
              '--vd-preview-bg': bgNum < 0 ? 'transparent' : (colorFromNumber(bgNum) || 'transparent'),
              '--vd-preview-group-textalign': hAlign === 1 ? 'center' : hAlign === 2 ? 'right' : 'left',
            })}
          >
            <span className="vd-preview-group-title" ref={(el) => { if (el) el.style.color = colorFromNumber(textNum) || '' }}>{ctrl.text}</span>
          </div>
        )
      }
      case 'ycUI按钮': {
        const isPrimary = ctrl.properties['主色模式'] === true || ctrl.properties['主色模式'] === '真'
        const radius = typeof ctrl.properties['圆角半径'] === 'number'
          ? ctrl.properties['圆角半径']
          : 4
        const primaryBg = readColorProperty(ctrl.properties, ['主色', '主色颜色']) || '#1677ff'
        const bg = isPrimary ? primaryBg : controlColors.bg
        const textColor = controlColors.text
        const borderColor = isPrimary ? primaryBg : controlColors.border
        return (
          <div
            className="vd-preview vd-preview-ycui-button"
            ref={(element) => setCssVars(element, {
              '--vd-preview-bg': bg,
              '--vd-preview-border': borderColor,
              '--vd-preview-text': textColor,
              '--vd-preview-radius': `${radius}px`,
            })}
          >
            {ctrl.text}
          </div>
        )
      }
      case '进度条': {
        const props = ctrl.properties || {}
        const vert = Number(props['方向'] ?? 0) === 1
        const blocks = Number(props['显示方式'] ?? 0) === 0
        const min = Number(props['最小位置'] ?? 0), max = Number(props['最大位置'] ?? 100), pos = Number(props['位置'] ?? 0)
        const frac = Math.max(0, Math.min(1, (pos - min) / ((max - min) || 1)))
        return (
          <div
            className={`vd-preview vd-preview-progress${vert ? ' vd-preview-progress-vert' : ''}`}
            ref={(el) => setCssVars(el, { '--vd-preview-fill': `${frac * 100}%` })}
          >
            <div className={`vd-preview-progress-fill${blocks ? ' vd-preview-progress-fill-blocks' : ''}`} />
          </div>
        )
      }
      case '时钟':
      case '图片组':
      case '通用对话框':
        return (
          <div className="vd-preview vd-preview-compact">
            <Icon name={resolveUnitIconName(ctrl.type, unitInfo?.iconFileName, unitInfo?.libraryName)} size={12} />
          </div>
        )
      case '外形框': {
        const props = ctrl.properties || {}
        const shape = Number(props['外形'] ?? 0)          // 0矩形 1正方形 2椭圆 3圆 4圆角矩形 5圆角正方形 6横线 7纵线
        const lineStyle = Number(props['线型'] ?? 1)       // 0无 1直线 2划线 3点线 4点划线 5双点划线
        const lineWidth = Math.max(1, Number(props['线宽'] ?? 1))
        const lineColor = colorFromNumber(typeof props['线条颜色'] === 'number' ? (props['线条颜色'] as number) : 0) || '#000'
        const fillColor = colorFromNumber(typeof props['填充颜色'] === 'number' ? (props['填充颜色'] as number) : 16777215) || 'transparent'
        const bgNum = typeof props['背景颜色'] === 'number' ? (props['背景颜色'] as number) : 16777215
        const dash = lineStyle === 2 ? '5,3' : lineStyle === 3 ? '1,3' : lineStyle === 4 ? '5,3,1,3' : lineStyle === 5 ? '5,3,1,3,1,3' : undefined
        const stroke = lineStyle === 0 ? 'none' : lineColor
        const w = ctrl.width, h = ctrl.height, sq = Math.min(w, h)
        let shapeEl: React.JSX.Element
        if (shape === 2 || shape === 3) shapeEl = <ellipse cx={(shape === 3 ? sq : w) / 2} cy={(shape === 3 ? sq : h) / 2} rx={(shape === 3 ? sq : w) / 2 - lineWidth} ry={(shape === 3 ? sq : h) / 2 - lineWidth} fill={fillColor} stroke={stroke} strokeWidth={lineWidth} strokeDasharray={dash} />
        else if (shape === 4 || shape === 5) shapeEl = <rect x={lineWidth / 2} y={lineWidth / 2} width={(shape === 5 ? sq : w) - lineWidth} height={(shape === 5 ? sq : h) - lineWidth} rx={Math.min(w, h) / 4} fill={fillColor} stroke={stroke} strokeWidth={lineWidth} strokeDasharray={dash} />
        else if (shape === 6) shapeEl = <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={stroke} strokeWidth={lineWidth} strokeDasharray={dash} />
        else if (shape === 7) shapeEl = <line x1={w / 2} y1={0} x2={w / 2} y2={h} stroke={stroke} strokeWidth={lineWidth} strokeDasharray={dash} />
        else shapeEl = <rect x={lineWidth / 2} y={lineWidth / 2} width={(shape === 1 ? sq : w) - lineWidth} height={(shape === 1 ? sq : h) - lineWidth} fill={fillColor} stroke={stroke} strokeWidth={lineWidth} strokeDasharray={dash} />
        return (
          <div className="vd-preview vd-preview-shape" style={{ background: colorFromNumber(bgNum) || '#ffffff' }}>
            <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>{shapeEl}</svg>
          </div>
        )
      }
      case '滑块条': {
        const props = ctrl.properties || {}
        const vert = Number(props['方向'] ?? 0) === 1
        const min = Number(props['最小位置'] ?? 0), max = Number(props['最大位置'] ?? 100), pos = Number(props['位置'] ?? 0)
        const frac = Math.max(0, Math.min(1, (pos - min) / ((max - min) || 1)))
        const w = ctrl.width, h = ctrl.height
        return (
          <div className="vd-preview vd-preview-slider">
            <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
              {vert
                ? <>
                  <line x1={w / 2} y1={4} x2={w / 2} y2={h - 4} stroke={controlColors.border} strokeWidth={3} strokeLinecap="round" />
                  <rect x={w / 2 - 7} y={4 + frac * (h - 8) - 3} width={14} height={6} rx={2} fill={controlColors.text} />
                </>
                : <>
                  <line x1={4} y1={h / 2} x2={w - 4} y2={h / 2} stroke={controlColors.border} strokeWidth={3} strokeLinecap="round" />
                  <rect x={4 + frac * (w - 8) - 3} y={h / 2 - 7} width={6} height={14} rx={2} fill={controlColors.text} />
                </>}
            </svg>
          </div>
        )
      }
      case '横向滚动条':
      case '纵向滚动条': {
        const props = ctrl.properties || {}
        const vert = ctrl.type === '纵向滚动条'
        const min = Number(props['最小位置'] ?? 0), max = Number(props['最大位置'] ?? 100), pos = Number(props['位置'] ?? 0)
        const page = Number(props['页改变值'] ?? 10)
        const range = max - min
        const thumbFrac = (range + page) > 0 ? Math.max(0.15, Math.min(1, page / (range + page))) : 1
        const trackFrac = range > 0 ? Math.max(0, Math.min(1, (pos - min) / range)) * (1 - thumbFrac) : 0
        return (
          <div
            className={`vd-preview vd-preview-scrollbar${vert ? ' vd-preview-scrollbar-vert' : ''}`}
            ref={(el) => setCssVars(el, { '--vd-preview-thumb-size': `${thumbFrac * 100}%`, '--vd-preview-thumb-pos': `${trackFrac * 100}%` })}
          >
            <span className="vd-preview-scrollbar-btn">{vert ? '▲' : '◀'}</span>
            <span className="vd-preview-scrollbar-track"><span className="vd-preview-scrollbar-thumb" /></span>
            <span className="vd-preview-scrollbar-btn">{vert ? '▼' : '▶'}</span>
          </div>
        )
      }
      case '日期框': {
        const props = ctrl.properties || {}
        const kind = Number(props['附件类型'] ?? 0)
        return (
          <div
            className="vd-preview vd-preview-input"
            ref={(el) => setCssVars(el, { '--vd-preview-bg': '#ffffff', '--vd-preview-border': controlColors.border, '--vd-preview-text': controlColors.text, '--vd-preview-align': 'left' })}
          >
            <span className="vd-preview-input-text">{String(props['今天'] || '') || '2026/07/11'}</span>
            {kind === 1
              ? <span className="vd-preview-spin" aria-hidden="true"><span className="vd-preview-spin-btn">▴</span><span className="vd-preview-spin-btn">▾</span></span>
              : <span className="vd-preview-combo-arrow">▾</span>}
          </div>
        )
      }
      case '月历': {
        const props = ctrl.properties || {}
        const firstDay = Number(props['开始星期首日'] ?? 0)
        const week = ['一', '二', '三', '四', '五', '六', '日']
        const rot = week.slice(firstDay).concat(week.slice(0, firstDay))
        return (
          <div className="vd-preview vd-preview-monthcal">
            <div className="vd-preview-monthcal-title">2026 年 7 月</div>
            <div className="vd-preview-monthcal-grid">
              {rot.map((d) => <span key={`h${d}`} className="vd-preview-monthcal-head">{d}</span>)}
              {Array.from({ length: 31 }, (_, i) => <span key={i} className={`vd-preview-monthcal-day${i + 1 === 11 ? ' vd-preview-monthcal-today' : ''}`}>{i + 1}</span>)}
            </div>
          </div>
        )
      }
      case '列表框': {
        const props = ctrl.properties || {}
        const items = String(props['列表项目'] ?? '').split('\n').filter(Boolean)
        const rows = items.length ? items : ['列表项目 1', '列表项目 2', '列表项目 3']
        const curSel = Number(props['现行选中项'] ?? -1)
        const bgNum = typeof props['背景颜色'] === 'number' ? (props['背景颜色'] as number) : 16777215
        const textNum = typeof props['文本颜色'] === 'number' ? (props['文本颜色'] as number) : 0
        return (
          <div
            className="vd-preview vd-preview-listbox"
            ref={(el) => setCssVars(el, {
              '--vd-preview-bg': bgNum === 16777215 ? '#ffffff' : (colorFromNumber(bgNum) || '#ffffff'),
              '--vd-preview-text': colorFromNumber(textNum) || controlColors.text,
              '--vd-preview-border': controlColors.border,
            })}
          >
            {rows.slice(0, 6).map((r, i) => <span key={i} className={`vd-preview-listbox-item${i === curSel ? ' vd-preview-listbox-item-sel' : ''}`}>{r}</span>)}
          </div>
        )
      }
      case '超级链接框': {
        const props = ctrl.properties || {}
        const textNum = typeof props['文本颜色'] === 'number' ? (props['文本颜色'] as number) : 0
        return (
          <div className="vd-preview vd-preview-label" style={{ color: colorFromNumber(textNum) || '#0a68d8' }}>
            <span style={{ textDecoration: 'underline', cursor: 'pointer' }}>{ctrl.text}</span>
          </div>
        )
      }
      case '选择夹': {
        const props = ctrl.properties || {}
        const names = String(props['子夹标题'] ?? props['列表项目'] ?? '').split('\n').map(t => t.trim()).filter(Boolean)
        const tabs = names.length ? names : ['选项夹一', '选项夹二']
        const active = getActivePage(ctrl.name)
        return (
          <div className="vd-preview vd-preview-tab">
            <div className="vd-preview-tab-headers">
              {tabs.map((t, i) => (
                <span
                  key={i}
                  className={`vd-preview-tab-header${i === active ? ' vd-preview-tab-header-active' : ''}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setActiveTabPage(prev => ({ ...prev, [ctrl.name]: i })) }}
                >{t}</span>
              ))}
            </div>
            <div className="vd-preview-tab-body" />
          </div>
        )
      }
      default:
        // 通用外观：显示组件名称
        return (
          <div className="vd-preview vd-preview-default">{ctrl.text || ctrl.type}</div>
        )
    }
  }

  // 浮动工具箱拖动
  const handleToolboxDragStart = useCallback((e: React.MouseEvent) => {
    if (!toolboxFloat) return
    e.preventDefault()
    e.stopPropagation()
    const startMouseX = e.clientX
    const startMouseY = e.clientY
    const startPos = toolboxPos

    const handleMouseMove = (ev: MouseEvent): void => {
      const rawX = startPos.x + (ev.clientX - startMouseX)
      const rawY = startPos.y + (ev.clientY - startMouseY)
      const next = clampFloatingToolboxRect(rawX, rawY, toolboxSize.w, toolboxSize.h)
      setToolboxPos({ x: next.x, y: next.y })
    }
    const handleMouseUp = (): void => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [clampFloatingToolboxRect, toolboxFloat, toolboxPos, toolboxSize.h, toolboxSize.w])

  // 过滤工具箱项（使用支持库的窗口组件）
  const toolboxItems = windowUnits.length > 0
    ? windowUnits.filter(u => u.name !== '窗口') // 窗口自身不在工具箱中
    : [] // 如果没有加载支持库则为空
  const resolveUnitCategory = (unit: LibWindowUnit): string => (unit.toolboxCategory || '').trim() || TOOLBOX_DEFAULT_CATEGORY
  // 分类列表："通用Win32"固定最前，其余按出现顺序
  const toolboxCategories = (() => {
    const categories = [TOOLBOX_DEFAULT_CATEGORY]
    for (const unit of toolboxItems) {
      const category = resolveUnitCategory(unit)
      if (!categories.includes(category)) categories.push(category)
    }
    return categories
  })()
  // 所选分类失效（如支持库被卸载）时回退默认分类
  const activeToolboxCategory = toolboxCategories.includes(toolboxCategory) ? toolboxCategory : TOOLBOX_DEFAULT_CATEGORY
  const filteredTools = toolboxItems.filter(unit => {
    if (resolveUnitCategory(unit) !== activeToolboxCategory) return false
    if (!toolboxSearch) return true
    return unit.name.includes(toolboxSearch) || unit.englishName.toLowerCase().includes(toolboxSearch.toLowerCase())
  })
  const isListMultiColumn = toolboxViewMode === 'list' && toolboxListMultiColumn

  useEffect(() => {
    setToolboxStateReady(false)
    try {
      const raw = localStorage.getItem(TOOLBOX_STATE_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as {
          float?: boolean
          dockSide?: string
          dockWidth?: number
          viewMode?: string
          listMultiColumn?: boolean
          posX?: number
          posY?: number
          sizeW?: number
          sizeH?: number
          category?: string
        }
        const parsedViewMode: 'icon' | 'list' = parsed.viewMode === 'icon' ? 'icon' : 'list'
        const minW = getToolboxMinWidth(parsedViewMode)

        if (typeof parsed.float === 'boolean') setToolboxFloat(parsed.float)
        if (parsed.dockSide === 'left' || parsed.dockSide === 'right') {
          setToolboxDockSide(parsed.dockSide)
        }
        if (typeof parsed.dockWidth === 'number' && Number.isFinite(parsed.dockWidth)) {
          setToolboxDockWidth(clamp(Math.round(parsed.dockWidth), minW, TOOLBOX_DOCK_MAX_WIDTH))
        }
        setToolboxViewMode(parsedViewMode)
        if (typeof parsed.listMultiColumn === 'boolean') {
          setToolboxListMultiColumn(parsed.listMultiColumn)
        }
        if (typeof parsed.category === 'string' && parsed.category.trim()) {
          setToolboxCategory(parsed.category.trim())
        }

        if (
          typeof parsed.posX === 'number' && Number.isFinite(parsed.posX)
          && typeof parsed.posY === 'number' && Number.isFinite(parsed.posY)
        ) {
          setToolboxPos({ x: Math.round(parsed.posX), y: Math.round(parsed.posY) })
        }
        if (
          typeof parsed.sizeW === 'number' && Number.isFinite(parsed.sizeW)
          && typeof parsed.sizeH === 'number' && Number.isFinite(parsed.sizeH)
        ) {
          setToolboxSize({
            w: Math.max(minW, Math.round(parsed.sizeW)),
            h: Math.max(TOOLBOX_FLOAT_MIN_HEIGHT, Math.round(parsed.sizeH)),
          })
        }
      }
    } catch {
      // Ignore invalid toolbox state payload.
    }
    setToolboxStateReady(true)
  }, [])

  useEffect(() => {
    if (!toolboxStateReady) return
    try {
      localStorage.setItem(TOOLBOX_STATE_STORAGE_KEY, JSON.stringify({
        float: toolboxFloat,
        dockSide: toolboxDockSide,
        dockWidth: toolboxDockWidth,
        viewMode: toolboxViewMode,
        listMultiColumn: toolboxListMultiColumn,
        posX: toolboxPos.x,
        posY: toolboxPos.y,
        sizeW: toolboxSize.w,
        sizeH: toolboxSize.h,
        category: toolboxCategory,
      }))
    } catch {
      // Ignore storage quota/security failures.
    }
  }, [toolboxCategory, toolboxDockSide, toolboxDockWidth, toolboxFloat, toolboxListMultiColumn, toolboxPos.x, toolboxPos.y, toolboxSize.h, toolboxSize.w, toolboxStateReady, toolboxViewMode])

  // 工具箱渲染
  const renderToolbox = (): React.JSX.Element => (
    <div
      className={`vd-toolbox ${toolboxFloat ? 'vd-toolbox-float' : `vd-toolbox-docked vd-toolbox-docked-${toolboxDockSide}`} ${toolboxViewMode === 'icon' ? 'vd-toolbox-icon-mode' : ''}`}
      ref={(element) => {
        if (!element) return
        const widthForScale = toolboxFloat ? toolboxSize.w : toolboxDockWidth
        const visualScale = computeToolboxVisualScale(widthForScale, toolboxViewMode)
        const tileSize = Math.max(30, Math.round(34 * visualScale))
        const listColumns = computeToolboxListColumns(widthForScale)
        if (!toolboxFloat) {
          setCssVars(element, {
            '--vd-toolbox-dock-width': `${toolboxDockWidth}px`,
            '--vd-toolbox-scale': `${visualScale}`,
            '--vd-toolbox-tile-size': `${tileSize}px`,
            '--vd-toolbox-list-columns': `${listColumns}`,
          })
          return
        }
        setCssVars(element, {
          '--vd-toolbox-left': `${toolboxPos.x}px`,
          '--vd-toolbox-top': `${toolboxPos.y}px`,
          '--vd-toolbox-width': `${toolboxSize.w}px`,
          '--vd-toolbox-height': `${toolboxSize.h}px`,
          '--vd-toolbox-scale': `${visualScale}`,
          '--vd-toolbox-tile-size': `${tileSize}px`,
          '--vd-toolbox-list-columns': `${listColumns}`,
        })
      }}
    >
      <div className="vd-toolbox-header" onMouseDown={handleToolboxDragStart}>
        <span className="vd-toolbox-title">控件工具箱</span>
        <div className="vd-toolbox-actions">
          {!toolboxFloat && (
            <button
              className="vd-toolbox-btn"
              title={toolboxDockSide === 'right' ? '停靠到左侧' : '停靠到右侧'}
              onClick={() => setToolboxDockSide(prev => prev === 'right' ? 'left' : 'right')}
            >{toolboxDockSide === 'right' ? '⇤' : '⇥'}</button>
          )}
          <button
            className="vd-toolbox-btn"
            title={toolboxViewMode === 'list' ? '图标视图' : '列表视图'}
            onClick={() => setToolboxViewMode(toolboxViewMode === 'list' ? 'icon' : 'list')}
          >{toolboxViewMode === 'list' ? '▦' : '☰'}</button>
          {toolboxViewMode === 'list' && (
            <button
              className="vd-toolbox-btn"
              title={toolboxListMultiColumn ? '切换为列表单列' : '切换为列表多列'}
              onClick={() => setToolboxListMultiColumn(prev => !prev)}
            >{toolboxListMultiColumn ? '◫' : '☷'}</button>
          )}
          <button
            className="vd-toolbox-btn"
            title={toolboxFloat ? '固定' : '浮动'}
            onClick={toggleToolboxFloat}
          >{toolboxFloat ? '📌' : '🔓'}</button>
        </div>
      </div>
      <div className="vd-toolbox-category">
        <select
          className="vd-toolbox-category-select"
          aria-label="组件分类"
          value={activeToolboxCategory}
          onChange={e => setToolboxCategory(e.target.value)}
        >
          {toolboxCategories.map(category => (
            <option key={category} value={category}>{category}</option>
          ))}
        </select>
      </div>
      <div className="vd-toolbox-search">
        <input
          type="text"
          placeholder="搜索组件..."
          value={toolboxSearch}
          onChange={e => setToolboxSearch(e.target.value)}
          className="vd-toolbox-search-input"
        />
      </div>
      <div className={`vd-toolbox-list ${isListMultiColumn ? 'vd-toolbox-list-multi' : ''}`}>
        <button
          className={`vd-tool-item ${activeTool === null ? 'active' : ''}`}
          onClick={() => setActiveTool(null)}
          title="选择工具"
        >
          <span className="vd-tool-icon"><Icon name="cursor" size={16} /></span>
          {toolboxViewMode === 'list' && <span className="vd-tool-label">选择</span>}
        </button>
        {filteredTools.map(unit => (
          <button
            key={unit.name}
            className={`vd-tool-item ${activeTool === unit.name ? 'active' : ''}`}
            onClick={() => setActiveTool(activeTool === unit.name ? null : unit.name)}
            title={`${unit.name} (${unit.libraryName})`}
          >
            <span className="vd-tool-icon"><Icon name={resolveUnitIconName(unit.name, unit.iconFileName, unit.libraryName)} size={16} /></span>
            {toolboxViewMode === 'list' && <span className="vd-tool-label">{unit.name}</span>}
          </button>
        ))}
        {toolboxItems.length === 0 && (
          <div className="vd-toolbox-empty">请先加载支持库</div>
        )}
      </div>
      {!toolboxFloat && (
        <div
          className={`vd-toolbox-resizer vd-toolbox-resizer-docked vd-toolbox-resizer-${toolboxDockSide}`}
          onMouseDown={handleDockResizeStart}
          title="拖拽调整工具箱宽度"
        />
      )}
      {toolboxFloat && (
        <div
          className="vd-toolbox-resizer vd-toolbox-resizer-float"
          onMouseDown={handleFloatResizeStart}
          title="拖拽调整工具箱大小"
        />
      )}
    </div>
  )

  // 右键菜单渲染（照易语言窗体设计器：字母助记键 + 快捷键 + 分隔线 + 子菜单 + 灰显占位项）
  const renderContextMenu = (): React.JSX.Element | null => {
    if (!contextMenu) return null
    const selIds = getSelectedControlIds()
    const hasSel = selIds.length > 0
    const canAlign = selIds.length >= 2
    const canPaste = vdControlClipboard.length > 0
    const allLocked = hasSel && selIds.every(id => form.controls.find(c => c.id === id)?.locked)
    const anyLocked = hasSel && selIds.some(id => form.controls.find(c => c.id === id)?.locked)
    const menuW = 236, menuH = 408
    const x = Math.max(4, Math.min(contextMenu.x, window.innerWidth - menuW - 4))
    const y = Math.max(4, Math.min(contextMenu.y, window.innerHeight - menuH - 4))
    const alignItems: { label: string; action: Exclude<AlignAction, null> }[] = [
      { label: '左对齐', action: 'align-left' },
      { label: '右对齐', action: 'align-right' },
      { label: '顶对齐', action: 'align-top' },
      { label: '底对齐', action: 'align-bottom' },
      { label: '水平居中', action: 'center-h' },
      { label: '垂直居中', action: 'center-v' },
      { label: '相同宽度', action: 'same-width' },
      { label: '相同高度', action: 'same-height' },
      { label: '相同大小', action: 'same-size' },
    ]
    const mkItem = (accel: string, label: string, action: string | null, shortcut?: string, disabled?: boolean): React.JSX.Element => (
      <button
        type="button"
        className="vd-ctx-item"
        disabled={disabled || !action}
        onClick={action ? () => runVdMenuAction(action) : undefined}
      >
        <span className="vd-ctx-accel">{accel}.</span>
        <span className="vd-ctx-label">{label}</span>
        {shortcut ? <span className="vd-ctx-shortcut">{shortcut}</span> : null}
      </button>
    )
    return (
      <div
        className="vd-ctx-menu"
        ref={(el) => setCssVars(el, { '--vd-ctx-left': `${x}px`, '--vd-ctx-top': `${y}px` })}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {mkItem('A', '查看数据类型定义', 'viewType', undefined, !hasSel)}
        <div className="vd-ctx-sep" />
        {mkItem('U', '撤销', 'undo', 'Ctrl+Z')}
        {mkItem('D', '删除', 'delete', 'Del', !hasSel)}
        <div className="vd-ctx-sep" />
        {mkItem('C', '复制', 'copy', 'Ctrl+C', !hasSel)}
        {mkItem('T', '剪切', 'cut', 'Ctrl+X', !hasSel)}
        {mkItem('P', '粘贴', 'paste', 'Ctrl+V', !canPaste)}
        <div className="vd-ctx-sep" />
        <div
          className="vd-ctx-subwrap"
          onMouseEnter={() => setCtxSubmenuOpen(true)}
          onMouseLeave={() => setCtxSubmenuOpen(false)}
        >
          <button type="button" className="vd-ctx-item vd-ctx-item-sub" disabled={!canAlign}>
            <span className="vd-ctx-accel">W.</span>
            <span className="vd-ctx-label">位置及尺寸</span>
            <span className="vd-ctx-arrow">▶</span>
          </button>
          {ctxSubmenuOpen && canAlign ? (
            <div className="vd-ctx-submenu">
              {alignItems.map(a => (
                <button
                  key={a.action}
                  type="button"
                  className="vd-ctx-item"
                  onClick={() => { setContextMenu(null); applyAlign(a.action) }}
                >
                  <span className="vd-ctx-label">{a.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {mkItem('T', '到最顶层', 'toFront', 'Ctrl+T', !hasSel)}
        {mkItem('B', '到最底层', 'toBack', undefined, !hasSel)}
        <div className="vd-ctx-sep" />
        {mkItem('L', '锁定', 'lock', undefined, !hasSel || allLocked)}
        {mkItem('K', '解除锁定', 'unlock', undefined, !anyLocked)}
        <div className="vd-ctx-sep" />
        {mkItem('M', '菜单编辑器', 'menuEditor', 'Ctrl+E')}
        {mkItem('V', '预览', 'preview', 'Ctrl+Enter')}
        {mkItem('Z', '跳回先前位置', 'navBack', 'Ctrl+J', !onCanNavigateBack?.())}
        {mkItem('J', '到对应窗口程序集', 'openSource', 'Ctrl+U')}
      </div>
    )
  }

  // 「查看数据类型定义」弹框：展示该控件类型（支持库单元）的属性/事件
  const renderTypeInfoDialog = (): React.JSX.Element | null => {
    if (!typeInfoUnit) return null
    const u = typeInfoUnit
    return (
      <div className="vd-typeinfo-overlay" onMouseDown={() => setTypeInfoUnit(null)}>
        <div className="vd-typeinfo-dialog" onMouseDown={(e) => e.stopPropagation()}>
          <div className="vd-typeinfo-header">
            <span className="vd-typeinfo-title">{u.name}{u.englishName ? `（${u.englishName}）` : ''}</span>
            <button type="button" className="vd-typeinfo-close" onClick={() => setTypeInfoUnit(null)} aria-label="关闭">×</button>
          </div>
          {(u.libraryName || u.description) && (
            <div className="vd-typeinfo-meta">
              {u.libraryName ? <div>支持库：{u.libraryName}</div> : null}
              {u.description ? <div className="vd-typeinfo-desc">{u.description}</div> : null}
            </div>
          )}
          <div className="vd-typeinfo-body">
            <div className="vd-typeinfo-section-title">属性（{u.properties.length}）</div>
            {u.properties.length > 0 ? (
              <table className="vd-typeinfo-table">
                <thead><tr><th>名称</th><th>类型</th><th>说明</th></tr></thead>
                <tbody>
                  {u.properties.map(p => (
                    <tr key={p.name}>
                      <td>{p.name}{p.isReadOnly ? ' (只读)' : ''}</td>
                      <td>{p.typeName}</td>
                      <td>{p.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="vd-typeinfo-empty">无</div>}
            <div className="vd-typeinfo-section-title">事件（{u.events.length}）</div>
            {u.events.length > 0 ? (
              <table className="vd-typeinfo-table">
                <thead><tr><th>名称</th><th>说明</th></tr></thead>
                <tbody>
                  {u.events.map(ev => (
                    <tr key={ev.name}>
                      <td>{ev.name}</td>
                      <td>{ev.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="vd-typeinfo-empty">无</div>}
          </div>
        </div>
      </div>
    )
  }

  // 设计器菜单栏：递归渲染下拉（叶子双击生成 _名_被选择 事件；有子项 CSS :hover 展开子菜单）
  const renderMenuNodes = (nodes: MenuItemDef[]): React.JSX.Element => (
    <div className="vd-fmenu-dropdown">
      {nodes.filter(n => n && n.visible !== false).map((n, i) => {
        if (n.separator) return <div key={`sep-${i}`} className="vd-fmenu-sep" />
        const kids = Array.isArray(n.children) ? n.children.filter(Boolean) : []
        return (
          <div
            key={n.name || `it-${i}`}
            className={`vd-fmenu-item${n.disabled ? ' vd-fmenu-disabled' : ''}`}
            onMouseDown={(e) => { e.stopPropagation(); if (kids.length === 0 && n.name) { setMenuBarOpenTop(null); onMenuItemActivate?.(n.name) } }}
          >
            <span className="vd-fmenu-caption">{n.checked ? '✓ ' : ''}{n.caption || '(未命名)'}</span>
            {n.shortcut ? <span className="vd-fmenu-shortcut">{n.shortcut}</span> : null}
            {kids.length > 0 ? <span className="vd-fmenu-arrow">▶</span> : null}
            {kids.length > 0 ? renderMenuNodes(kids) : null}
          </div>
        )
      })}
    </div>
  )

  const renderFormMenuBar = (): React.JSX.Element | null => {
    const tops = Array.isArray(form.menu) ? form.menu.filter(n => n && n.visible !== false) : []
    if (tops.length === 0) return null
    return (
      <div className="vd-fmenu-bar" onMouseDown={(e) => e.stopPropagation()}>
        {tops.map((top, i) => {
          const kids = Array.isArray(top.children) ? top.children.filter(Boolean) : []
          return (
            <div
              key={top.name || `top-${i}`}
              className={`vd-fmenu-top${menuBarOpenTop === i ? ' vd-fmenu-top-open' : ''}${top.disabled ? ' vd-fmenu-disabled' : ''}`}
              onMouseDown={(e) => {
                e.stopPropagation()
                // 有子菜单：单击展开/收起下拉；无子菜单（顶级命令项）：单击直接生成/跳转事件
                if (kids.length > 0) setMenuBarOpenTop(prev => (prev === i ? null : i))
                else if (top.name) { setMenuBarOpenTop(null); onMenuItemActivate?.(top.name) }
              }}
              onMouseEnter={() => { if (menuBarOpenTop !== null) setMenuBarOpenTop(i) }}
            >
              <span className="vd-fmenu-topcap">{top.caption || '(未命名)'}</span>
              {menuBarOpenTop === i && kids.length > 0 ? renderMenuNodes(kids) : null}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="vd" ref={designerRootRef}>
      {/* 画布区域 */}
      <div
        className="vd-canvas-area"
        ref={canvasRegionRef}
        onKeyDown={handleCanvasAreaKeyDown}
        tabIndex={0}
        role="region"
        aria-label="可视化设计器画布。按住Ctrl键后滚轮可按鼠标焦点缩放；按住空格并左键拖拽可平移画布；按加号和减号缩放，按0重置比例。"
      >
        <div className="vd-ruler-corner" aria-hidden="true" />
        <div className="vd-ruler vd-ruler-top" aria-hidden="true">
          {mouseRulerPos && (
            <div
              className="vd-ruler-cursor vd-ruler-cursor-x"
              ref={(element) => setCssVars(element, { '--vd-ruler-cursor-pos': `${mouseRulerPos.x}px` })}
            />
          )}
          {selectedRulerHighlight && selectedRulerHighlight.w > 0 && (
            <div
              className="vd-ruler-selection vd-ruler-selection-x"
              ref={(element) => setCssVars(element, {
                '--vd-ruler-selection-start': `${selectedRulerHighlight.x}px`,
                '--vd-ruler-selection-size': `${selectedRulerHighlight.w}px`,
              })}
            />
          )}
          {rulerTicksX.map(tick => (
            <div
              key={tick.id}
              className={`vd-ruler-tick vd-ruler-tick-x ${tick.level}`}
              ref={(element) => setCssVars(element, { '--vd-ruler-tick-pos': `${tick.pos}px` })}
            >
              {tick.level === 'major' && <span className="vd-ruler-label">{tick.label}</span>}
            </div>
          ))}
        </div>
        <div className="vd-ruler vd-ruler-left" aria-hidden="true">
          {mouseRulerPos && (
            <div
              className="vd-ruler-cursor vd-ruler-cursor-y"
              ref={(element) => setCssVars(element, { '--vd-ruler-cursor-pos': `${mouseRulerPos.y}px` })}
            />
          )}
          {selectedRulerHighlight && selectedRulerHighlight.h > 0 && (
            <div
              className="vd-ruler-selection vd-ruler-selection-y"
              ref={(element) => setCssVars(element, {
                '--vd-ruler-selection-start': `${selectedRulerHighlight.y}px`,
                '--vd-ruler-selection-size': `${selectedRulerHighlight.h}px`,
              })}
            />
          )}
          {rulerTicksY.map(tick => (
            <div
              key={tick.id}
              className={`vd-ruler-tick vd-ruler-tick-y ${tick.level}`}
              ref={(element) => setCssVars(element, { '--vd-ruler-tick-pos': `${tick.pos}px` })}
            >
              {tick.level === 'major' && <span className="vd-ruler-label">{tick.label}</span>}
            </div>
          ))}
        </div>

        {/* 对齐工具条：独立于顶部工具栏，只在可视化设计器内、标尺下方显示；选中 ≥2 个控件时可用 */}
        <div className="vd-align-bar" role="toolbar" aria-label="对齐">
          {VD_ALIGN_BUTTONS.map(b => (
            <button
              key={b.action}
              type="button"
              className="vd-align-btn"
              title={b.title}
              aria-label={b.title}
              disabled={selectedIds.size < 2}
              onClick={() => applyAlign(b.action)}
            >
              <Icon name={b.icon} size={16} />
            </button>
          ))}
        </div>

        <div
          className={`vd-canvas-scroll ${isSpacePressed ? 'vd-canvas-scroll-pan-ready' : ''} ${isPanningView ? 'vd-canvas-scroll-pan-active' : ''}`}
          ref={canvasAreaRef}
          onScroll={handleCanvasScroll}
          onWheel={handleCanvasAreaWheel}
          onMouseDownCapture={handleCanvasPanMouseDownCapture}
        >
          <div
            className="vd-canvas-workspace"
            ref={(element) => setCssVars(element, {
              '--vd-workspace-width': `${workspaceWidth}px`,
              '--vd-workspace-height': `${workspaceHeight}px`,
            })}
          >
        <div
          className="vd-form-zoom-shell"
          ref={(element) => setCssVars(element, {
            '--vd-zoom': `${zoom}`,
            '--vd-shell-width': `${visualFormWidth * zoom}px`,
            '--vd-shell-height': `${(visualFormHeight + formChromeHeight) * zoom}px`,
            '--vd-shell-left': `${formOffsetLeft}px`,
            '--vd-shell-top': `${formOffsetTop}px`,
          })}
        >

        {/* 窗口外壳 */}
        <div
          className={`vd-form-wrapper vd-form-border-${formChrome.borderStyle} vd-form-shape-${formShape} ${selectedId === '__form__' ? 'vd-form-wrapper-selected' : ''}`}
          ref={(element) => setCssVars(element, {
            '--vd-form-title-bg': formVisualColors.titleBg,
            '--vd-form-title-text': formVisualColors.titleText,
            '--vd-form-canvas-bg': formVisualColors.canvasBg,
            '--vd-form-border': formVisualColors.border,
            '--vd-form-grid': formVisualColors.grid,
            '--vd-form-corner-radius': `${formCornerRadius}px`,
          })}
        >
          {/* 窗口本体（标题栏+客户区）：外形裁剪作用于此层，让调整句柄留在外部不被裁掉 */}
          <div className={`vd-form-body vd-form-shape-${formShape}`}>
          {formChrome.hasTitlebar && (
            <div className={`vd-form-titlebar${formChrome.isToolWindow ? ' vd-form-titlebar-tool' : ''}`} onMouseDown={handleFormTitleClick} onDoubleClick={handleFormDblClick}>
              {!formChrome.isToolWindow && <span className="vd-form-titlebar-icon">{formIcon ? <img className="vd-form-titlebar-icon-img" src={formIcon} alt="" /> : <Icon name="windows-form" size={14} />}</span>}
              <span className="vd-form-titlebar-text">{form.title || form.name}</span>
              {formControlBox && (
                <span className="vd-form-titlebar-btns">
                  {/* 工具窗标题栏只有关闭钮；最小化/最大化都关时按钮组不显示，只关一个则灰显（Win32 行为） */}
                  {!formChrome.isToolWindow && (formMinButton || formMaxButton) && (
                    <>
                      <span className={`vd-form-btn${formMinButton ? '' : ' vd-form-btn-off'}`}>─</span>
                      <span className={`vd-form-btn${formMaxButton ? '' : ' vd-form-btn-off'}`}>🗖️</span>
                    </>
                  )}
                  <span className="vd-form-btn vd-form-btn-close">✕</span>
                </span>
              )}
            </div>
          )}

          {/* 菜单栏（有菜单时显示，双击菜单项生成事件） */}
          {renderFormMenuBar()}

          {/* 窗口客户区 */}
          <div
            className={`vd-form-canvas ${activeTool ? 'vd-crosshair' : ''} ${selectedId === '__form__' ? 'vd-form-selected' : ''}${formBackImage ? ' vd-form-canvas-bgimage' : ''}`}
            ref={(element) => {
              canvasRef.current = element
              setCssVars(element, {
                '--vd-form-width': `${visualFormWidth}px`,
                '--vd-form-height': `${visualFormHeight}px`,
                '--vd-form-bg-image': formBackImage ? `url("${formBackImage}")` : 'none',
                '--vd-form-bg-size': backImageCss.size,
                '--vd-form-bg-repeat': backImageCss.repeat,
                '--vd-form-bg-position': backImageCss.position,
              })
            }}
            onMouseDown={handleCanvasMouseDown}
            onContextMenu={(e) => openContextMenu(e)}
            onMouseMove={(e) => updateMouseRulerPos(e.clientX, e.clientY)}
            onMouseLeave={() => setMouseRulerPos(null)}
            onDoubleClick={handleFormDblClick}
          >
            {alignGuides.x.map(x => (
              <div
                key={`guide-x-${x}`}
                className="vd-align-guide vd-align-guide-v"
                ref={(element) => setCssVars(element, { '--vd-guide-x': `${x}px` })}
              />
            ))}
            {alignGuides.y.map(y => (
              <div
                key={`guide-y-${y}`}
                className="vd-align-guide vd-align-guide-h"
                ref={(element) => setCssVars(element, { '--vd-guide-y': `${y}px` })}
              />
            ))}

            {/* 拖拽绘制预览 — 直接显示组件外观 */}
            {marqueeRect && (
              <div
                className="vd-marquee-selection"
                ref={(element) => setCssVars(element, {
                  '--vd-marquee-left': `${marqueeRect.x}px`,
                  '--vd-marquee-top': `${marqueeRect.y}px`,
                  '--vd-marquee-width': `${marqueeRect.w}px`,
                  '--vd-marquee-height': `${marqueeRect.h}px`,
                })}
              />
            )}

            {drawRect && drawRect.w > 0 && drawRect.h > 0 && activeTool && (
              <div
                className="vd-draw-preview"
                ref={(element) => setCssVars(element, {
                  '--vd-draw-left': `${drawRect.x}px`,
                  '--vd-draw-top': `${drawRect.y}px`,
                  '--vd-draw-width': `${drawRect.w}px`,
                  '--vd-draw-height': `${drawRect.h}px`,
                })}
              >
                {renderControlPreview({
                  id: '__preview__',
                  type: activeTool,
                  name: activeTool,
                  left: 0, top: 0,
                  width: drawRect.w,
                  height: drawRect.h,
                  text: ['按钮', '标签', '选择框', '单选框', '分组框'].includes(activeTool) ? activeTool : '',
                  visible: true,
                  enabled: true,
                  properties: {},
                })}
              </div>
            )}
            {form.controls.map(ctrl => {
              // 属于某选择夹某页的子控件：仅当该页为当前显示页才渲染（否则视为在别页，隐藏且不可选/拖）。
              const tabOwner = typeof ctrl.properties?.['所属选择夹'] === 'string' ? ctrl.properties['所属选择夹'] as string : ''
              if (tabOwner && Number(ctrl.properties?.['所属子夹'] ?? 0) !== getActivePage(tabOwner)) return null
              const isSelected = ctrl.id === selectedId
              const isMultiSelected = selectedIds.has(ctrl.id)
              const isHovered = hoveredControlId === ctrl.id && !isSelected && !isMultiSelected
              return (
                <div
                  key={ctrl.id}
                  className={`vd-control ${isSelected ? 'vd-control-selected' : ''} ${isMultiSelected ? 'vd-control-multi-selected' : ''} ${isHovered ? 'vd-control-hovered' : ''} ${ctrl.locked ? 'vd-control-locked' : ''}`}
                  ref={(element) => {
                    const fontCss = fontSpecToCss(parseFontSpec(ctrl.properties?.['字体']))
                    setCssVars(element, {
                      '--vd-control-left': `${ctrl.left}px`,
                      '--vd-control-top': `${ctrl.top}px`,
                      '--vd-control-width': `${ctrl.width}px`,
                      '--vd-control-height': `${ctrl.height}px`,
                      '--vd-control-font-family': fontCss.fontFamily || 'inherit',
                      '--vd-control-font-size': fontCss.fontSize || '12px',
                      '--vd-control-font-weight': fontCss.fontWeight || 'normal',
                      '--vd-control-font-style': fontCss.fontStyle || 'normal',
                      '--vd-control-font-deco': fontCss.textDecoration || 'none',
                      '--vd-control-color': fontCss.color || 'inherit',
                    })
                  }}
                  onMouseEnter={() => setHoveredControlId(ctrl.id)}
                  onMouseLeave={() => setHoveredControlId(prev => prev === ctrl.id ? null : prev)}
                  onMouseDown={(e) => handleControlMouseDown(e, ctrl)}
                  onDoubleClick={(e) => handleControlDblClick(e, ctrl)}
                  onContextMenu={(e) => openContextMenu(e, ctrl)}
                >
                  {renderControlPreview(ctrl)}

                  {/* 选中句柄（锁定控件不显示，禁止缩放） */}
                  {(isSelected || isMultiSelected) && !ctrl.locked && HANDLES.map(h => (
                    <div
                      key={h}
                      className={`vd-handle vd-handle-${h}`}
                      onMouseDown={(e) => handleResizeMouseDown(e, ctrl, h)}
                    />
                  ))}
                </div>
              )
            })}
          </div>
          </div>{/* vd-form-body 结束 */}

          {/* 窗口选中时显示调整大小句柄 */}
          {selectedId === '__form__' && (
            <>
              <div className="vd-handle vd-form-handle-e" onMouseDown={(e) => handleFormResizeMouseDown(e, 'e')} />
              <div className="vd-handle vd-form-handle-s" onMouseDown={(e) => handleFormResizeMouseDown(e, 's')} />
              <div className="vd-handle vd-form-handle-se" onMouseDown={(e) => handleFormResizeMouseDown(e, 'se')} />
            </>
          )}
        </div>
        </div>
          </div>
        </div>

        {/* 右下角缩放控件：适应窗口 / 1% 步进拖动条 / 倍率预设菜单（固定于画布区域，不随滚动） */}
        <div className="vd-zoom-control" ref={zoomControlRef}>
          <button
            className="vd-zoom-fit-btn"
            title="缩放到适应窗口"
            aria-label="缩放到适应窗口"
            onClick={fitZoomToViewport}
          >⛶</button>
          <button
            className="vd-zoom-step-btn"
            title="缩小 10%"
            aria-label="缩小 10%"
            onClick={() => zoomTo((zoomRef.current || 1) - 0.1)}
          >−</button>
          <input
            type="range"
            className="vd-zoom-slider"
            aria-label="缩放倍率"
            min={Math.round(MIN_ZOOM * 100)}
            max={Math.round(MAX_ZOOM * 100)}
            step={1}
            value={Math.round(zoom * 100)}
            onChange={e => zoomTo(Number(e.target.value) / 100)}
          />
          <button
            className="vd-zoom-step-btn"
            title="放大 10%"
            aria-label="放大 10%"
            onClick={() => zoomTo((zoomRef.current || 1) + 0.1)}
          >+</button>
          <button
            className="vd-zoom-value-btn"
            title="选择缩放倍率"
            aria-haspopup="menu"
            aria-expanded={zoomMenuOpen}
            onClick={() => setZoomMenuOpen(open => !open)}
          >{Math.round(zoom * 100)}%</button>
          {zoomMenuOpen && (
            <div className="vd-zoom-menu" role="menu">
              {zoomPresetPercents.map(percent => (
                <button
                  key={percent}
                  role="menuitem"
                  className={`vd-zoom-menu-item${Math.round(zoom * 100) === percent ? ' active' : ''}`}
                  onClick={() => { zoomToCentered(percent / 100); setZoomMenuOpen(false) }}
                >{percent}%</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 工具箱：固定模式在右侧渲染，浮动模式悬浮在整个设计器上方 */}
      {renderToolbox()}

      {/* 右键菜单 */}
      {renderContextMenu()}

      {/* 「查看数据类型定义」弹框 */}
      {renderTypeInfoDialog()}

      {/* 「菜单编辑器」对话框 */}
      {menuEditorOpen && (
        <MenuEditorDialog
          menu={form.menu}
          formName={form.title || form.name}
          onClose={() => setMenuEditorOpen(false)}
          onSave={(menu, renames) => {
            onChange({ ...form, menu })
            if (renames.length) onMenuItemRenames?.(renames)
            setMenuEditorOpen(false)
          }}
        />
      )}
    </div>
  )
}

export default VisualDesigner
