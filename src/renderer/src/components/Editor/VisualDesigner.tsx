import { useState, useRef, useCallback, useEffect } from 'react'
import Icon, { UNIT_ICON_MAP } from '../Icon/Icon'
import '../Icon/Icon.css'
import './VisualDesigner.css'

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
  properties: LibUnitProperty[]
  events: LibUnitEvent[]
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
  properties: Record<string, string | number | boolean>  // 支持库属性值
}

/** 窗口属性 */
export interface DesignForm {
  name: string
  title: string
  width: number
  height: number
  sourceFile?: string  // 关联的 .eyc 源代码文件名
  controls: DesignControl[]
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

interface VisualDesignerProps {
  form: DesignForm
  onChange: (form: DesignForm) => void
  onSelectControl: (target: SelectionTarget) => void
  windowUnits?: LibWindowUnit[]
  externalSelectedId?: string
  alignAction?: AlignAction
  onAlignDone?: () => void
  onMultiSelectChange?: (count: number) => void
  onControlDoubleClick?: (control: DesignControl, defaultEvent: LibUnitEvent | null) => void
  onFormDoubleClick?: (form: DesignForm, defaultEvent: LibUnitEvent | null) => void
}

// ========== 内置默认尺寸 ==========
const DEFAULT_SIZES: Record<string, [number, number]> = {
  '按钮': [75, 28], '编辑框': [120, 24], '标签': [80, 20], '图片框': [100, 80],
  '列表框': [120, 100], '组合框': [120, 24], '选择框': [80, 20], '单选框': [80, 20],
  '分组框': [160, 120], '进度条': [150, 20], '时钟': [32, 32], '图片组': [32, 32],
}
const DEFAULT_SIZE: [number, number] = [100, 30]

// ========== 拖拽句柄方向 ==========
type HandleDir = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se'

const HANDLES: HandleDir[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']

// 网格吸附
const GRID = 4
const ALIGN_SNAP_TOLERANCE = 6

function snap(v: number): number {
  return Math.round(v / GRID) * GRID
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
  const canvasBg = readColorProperty(form.properties, ['背景颜色', '背景色', '客户区背景色']) || '#f4f6f8'
  const border = readColorProperty(form.properties, ['边框颜色', '边框色']) || '#9ca3af'
  const grid = readColorProperty(form.properties, ['网格颜色', '网格色']) || '#c5c9d1'
  return { titleBg, titleText, canvasBg, border, grid }
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

let nextControlId = 1

// ========== 组件 ==========

// 记住上次选中的 id（跨重渲染保持）
let lastSelectedId: string = '__form__'

function VisualDesigner({ form, onChange, onSelectControl, windowUnits = [], externalSelectedId, alignAction, onAlignDone, onMultiSelectChange, onControlDoubleClick, onFormDoubleClick }: VisualDesignerProps): React.JSX.Element {
  // '__form__' 表示选中窗口自身，null 表示无选中
  const [selectedId, setSelectedId] = useState<string | null>(lastSelectedId)
  // 多选支持
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [toolboxFloat, setToolboxFloat] = useState(false)
  const [toolboxViewMode, setToolboxViewMode] = useState<'icon' | 'list'>('list')
  const [toolboxSearch, setToolboxSearch] = useState('')
  const [toolboxPos, setToolboxPos] = useState({ x: 80, y: 40 })
  const [toolboxSize, setToolboxSize] = useState({ w: 160, h: 400 })
  const [alignGuides, setAlignGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  const formVisualColors = resolveFormVisualColors(form)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [drawRect, setDrawRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
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

  // 通知父组件多选数量变化
  useEffect(() => {
    onMultiSelectChange?.(selectedIds.size)
  }, [selectedIds.size, onMultiSelectChange])

  // 执行对齐操作
  useEffect(() => {
    if (!alignAction) return
    // 收集所有选中的控件（多选 + 单选）
    const ids = selectedIds.size > 0 ? selectedIds : (selectedId && selectedId !== '__form__' ? new Set([selectedId]) : new Set<string>())
    const selected = form.controls.filter(c => ids.has(c.id))
    if (selected.length < 1) { onAlignDone?.(); return }

    if (selected.length < 2) { onAlignDone?.(); return }

    // 以最边缘的控件为基准
    const minLeft = Math.min(...selected.map(c => c.left))
    const maxRight = Math.max(...selected.map(c => c.left + c.width))
    const minTop = Math.min(...selected.map(c => c.top))
    const maxBottom = Math.max(...selected.map(c => c.top + c.height))
    // 找最宽和最高的控件用于同大小操作
    const maxW = Math.max(...selected.map(c => c.width))
    const maxH = Math.max(...selected.map(c => c.height))

    let updated = form.controls.map(c => {
      if (!ids.has(c.id)) return c
      switch (alignAction) {
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
    onAlignDone?.()
  }, [alignAction])

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

  // 画布鼠标按下 — 开始创建控件或选中窗口
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const bx = canvas.clientLeft
    const by = canvas.clientTop
    const startX = e.clientX - rect.left - bx
    const startY = e.clientY - rect.top - by

    if (activeTool) {
      // 拖拽绘制控件：按住鼠标拖动定义大小
      const tool = activeTool
      setDrawRect({ x: snap(startX), y: snap(startY), w: 0, h: 0 })

      const handleMouseMove = (ev: MouseEvent): void => {
        const mx = ev.clientX - rect.left - bx
        const my = ev.clientY - rect.top - by
        const x1 = Math.min(startX, mx)
        const y1 = Math.min(startY, my)
        const x2 = Math.max(startX, mx)
        const y2 = Math.max(startY, my)
        setDrawRect({ x: snap(x1), y: snap(y1), w: snap(x2 - x1), h: snap(y2 - y1) })
      }

      const handleMouseUp = (ev: MouseEvent): void => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        const mx = ev.clientX - rect.left - bx
        const my = ev.clientY - rect.top - by
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
      setSelectedId('__form__')
      setSelectedIds(new Set())
    }
  }, [activeTool, addControl])

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
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      let w = origW, h = origH
      if (handle.includes('e')) w = Math.max(80, origW + dx)
      if (handle.includes('s')) h = Math.max(60, origH + dy)
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

    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const bx = canvas.clientLeft
    const by = canvas.clientTop

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
      const startX = e.clientX - rect.left - bx
      const startY = e.clientY - rect.top - by

      const handleMouseMove = (ev: MouseEvent): void => {
        const mx = ev.clientX - rect.left - bx
        const my = ev.clientY - rect.top - by
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
      }

      document.body.style.cursor = 'move'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    } else {
      // 单控件拖拽
      dragRef.current = {
        mode: 'move',
        controlId: ctrl.id,
        startX: e.clientX - rect.left - bx,
        startY: e.clientY - rect.top - by,
        origLeft: ctrl.left,
        origTop: ctrl.top,
        origWidth: ctrl.width,
        origHeight: ctrl.height,
      }

      const handleMouseMove = (ev: MouseEvent): void => {
        const d = dragRef.current
        if (!d) return
        const mx = ev.clientX - rect.left - bx
        const my = ev.clientY - rect.top - by
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
      }

      document.body.style.cursor = 'move'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }
  }, [updateControl, selectedIds, selectedId, form.controls, form.width, form.height])

  // 句柄鼠标按下 — 开始缩放
  const handleResizeMouseDown = useCallback((e: React.MouseEvent, ctrl: DesignControl, handle: HandleDir) => {
    e.stopPropagation()
    if (e.button !== 0) return

    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const bx = canvas.clientLeft
    const by = canvas.clientTop
    dragRef.current = {
      mode: 'resize',
      controlId: ctrl.id,
      handle,
      startX: e.clientX - rect.left - bx,
      startY: e.clientY - rect.top - by,
      origLeft: ctrl.left,
      origTop: ctrl.top,
      origWidth: ctrl.width,
      origHeight: ctrl.height,
    }

    const handleMouseMove = (ev: MouseEvent): void => {
      const d = dragRef.current
      if (!d || !d.handle) return
      const mx = ev.clientX - rect.left - bx
      const my = ev.clientY - rect.top - by
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
  }, [updateControl])

  // 渲染单个控件的预览外观
  const renderControlPreview = (ctrl: DesignControl): React.JSX.Element => {
    const common: React.CSSProperties = {
      width: '100%', height: '100%',
      boxSizing: 'border-box',
      fontSize: 12,
      fontFamily: 'var(--font-family)',
      overflow: 'hidden',
    }
    const controlColors = resolveControlVisualColors(ctrl)

    switch (ctrl.type) {
      case '按钮':
        return (
          <div style={{
            ...common,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: controlColors.bg,
            border: `1px solid ${controlColors.border}`,
            borderRadius: 3,
            color: controlColors.text,
            cursor: 'default',
          }}>{ctrl.text}</div>
        )
      case '编辑框':
      case '超级编辑框':
        return (
          <div style={{
            ...common,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            padding: '2px 4px',
            color: 'var(--text-primary)',
          }}>{ctrl.text}</div>
        )
      case '标签':
        return (
          <div style={{
            ...common,
            display: 'flex', alignItems: 'center',
            color: 'var(--text-primary)',
            background: 'transparent',
          }}>{ctrl.text}</div>
        )
      case '图片框':
      case '影像框':
        return (
          <div style={{
            ...common,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-disabled)',
          }}>{ctrl.type}</div>
        )
      case '列表框':
      case '选择列表框':
      case '超级列表框':
        return (
          <div style={{
            ...common,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-primary)',
          }} />
        )
      case '组合框':
        return (
          <div style={{
            ...common,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center',
            paddingLeft: 4,
            color: 'var(--text-primary)',
          }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{ctrl.text}</span>
            <span style={{ width: 18, textAlign: 'center', borderLeft: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>▾</span>
          </div>
        )
      case '选择框':
        return (
          <div style={{
            ...common,
            display: 'flex', alignItems: 'center', gap: 4,
            color: 'var(--text-primary)', background: 'transparent',
          }}>
            <span style={{ width: 13, height: 13, border: '1px solid var(--border-color)', background: 'var(--bg-primary)', flexShrink: 0 }} />
            {ctrl.text}
          </div>
        )
      case '单选框':
        return (
          <div style={{
            ...common,
            display: 'flex', alignItems: 'center', gap: 4,
            color: 'var(--text-primary)', background: 'transparent',
          }}>
            <span style={{ width: 13, height: 13, border: '1px solid var(--border-color)', borderRadius: '50%', background: 'var(--bg-primary)', flexShrink: 0 }} />
            {ctrl.text}
          </div>
        )
      case '分组框':
        return (
          <div style={{
            ...common,
            border: '1px solid var(--button-secondary-border)',
            borderRadius: 3,
            paddingTop: 14,
            position: 'relative',
            background: 'transparent',
          }}>
            <span style={{
              position: 'absolute', top: -8, left: 8,
              background: 'var(--bg-primary)', padding: '0 4px',
              color: 'var(--text-primary)', fontSize: 12,
            }}>{ctrl.text}</span>
          </div>
        )
      case 'ycUI按钮': {
        const isPrimary = ctrl.properties['主色模式'] === true || ctrl.properties['主色模式'] === '真'
        const radius = typeof ctrl.properties['圆角半径'] === 'number'
          ? ctrl.properties['圆角半径']
          : 4
        const primaryBg = readColorProperty(ctrl.properties, ['主色', '主色颜色']) || '#1677ff'
        const bg = isPrimary ? primaryBg : controlColors.bg
        const textColor = controlColors.text
        const border = `1px solid ${isPrimary ? primaryBg : controlColors.border}`
        return (
          <div style={{
            ...common,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: bg,
            border,
            borderRadius: radius,
            color: textColor,
            cursor: 'default',
            userSelect: 'none',
          }}>{ctrl.text}</div>
        )
      }
      case '进度条':
        return (
          <div style={{
            ...common,
            background: 'var(--bg-hover)',
            border: '1px solid var(--button-secondary-border)',
          }}>
            <div style={{
              width: '40%', height: '100%',
              background: 'linear-gradient(180deg, var(--success) 0%, color-mix(in srgb, var(--success) 85%, var(--bg-primary)) 100%)',
            }} />
          </div>
        )
      case '时钟':
      case '图片组':
        return (
          <div style={{
            ...common,
            background: 'var(--bg-input)',
            border: '1px dashed var(--border-color)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-disabled)', fontSize: 10,
          }}>{UNIT_ICON_MAP[ctrl.type] ? <Icon name={UNIT_ICON_MAP[ctrl.type]} size={12} /> : '?'}</div>
        )
      default:
        // 通用外观：显示组件名称
        return (
          <div style={{
            ...common,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-secondary)', fontSize: 10,
          }}>{ctrl.text || ctrl.type}</div>
        )
    }
  }

  // 浮动工具箱拖动
  const handleToolboxDragStart = useCallback((e: React.MouseEvent) => {
    if (!toolboxFloat) return
    e.preventDefault()
    const startX = e.clientX - toolboxPos.x
    const startY = e.clientY - toolboxPos.y

    const handleMouseMove = (ev: MouseEvent): void => {
      setToolboxPos({ x: ev.clientX - startX, y: ev.clientY - startY })
    }
    const handleMouseUp = (): void => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [toolboxFloat, toolboxPos])

  // 过滤工具箱项（使用支持库的窗口组件）
  const toolboxItems = windowUnits.length > 0
    ? windowUnits.filter(u => u.name !== '窗口') // 窗口自身不在工具箱中
    : [] // 如果没有加载支持库则为空
  const filteredTools = toolboxSearch
    ? toolboxItems.filter(u => u.name.includes(toolboxSearch) || u.englishName.toLowerCase().includes(toolboxSearch.toLowerCase()))
    : toolboxItems

  // 工具箱渲染
  const renderToolbox = (): React.JSX.Element => (
    <div className={`vd-toolbox ${toolboxFloat ? 'vd-toolbox-float' : ''} ${toolboxViewMode === 'icon' ? 'vd-toolbox-icon-mode' : ''}`}
      style={toolboxFloat ? { left: toolboxPos.x, top: toolboxPos.y, width: toolboxSize.w, height: toolboxSize.h } : undefined}
    >
      <div className="vd-toolbox-header" onMouseDown={handleToolboxDragStart}>
        <span className="vd-toolbox-title">控件工具箱</span>
        <div className="vd-toolbox-actions">
          <button
            className="vd-toolbox-btn"
            title={toolboxViewMode === 'list' ? '图标视图' : '列表视图'}
            onClick={() => setToolboxViewMode(toolboxViewMode === 'list' ? 'icon' : 'list')}
          >{toolboxViewMode === 'list' ? '▦' : '☰'}</button>
          <button
            className="vd-toolbox-btn"
            title={toolboxFloat ? '固定' : '浮动'}
            onClick={() => setToolboxFloat(!toolboxFloat)}
          >{toolboxFloat ? '📌' : '🔓'}</button>
        </div>
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
      <div className="vd-toolbox-list">
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
            <span className="vd-tool-icon">{UNIT_ICON_MAP[unit.name] ? <Icon name={UNIT_ICON_MAP[unit.name]} size={16} /> : unit.name.charAt(0)}</span>
            {toolboxViewMode === 'list' && <span className="vd-tool-label">{unit.name}</span>}
          </button>
        ))}
        {toolboxItems.length === 0 && (
          <div className="vd-toolbox-empty">请先加载支持库</div>
        )}
      </div>
    </div>
  )

  return (
    <div className="vd">
      {/* 画布区域 */}
      <div className="vd-canvas-area">

        {/* 窗口外壳 */}
        <div
          className={`vd-form-wrapper ${selectedId === '__form__' ? 'vd-form-wrapper-selected' : ''}`}
          style={{
            '--vd-form-title-bg': formVisualColors.titleBg,
            '--vd-form-title-text': formVisualColors.titleText,
            '--vd-form-canvas-bg': formVisualColors.canvasBg,
            '--vd-form-border': formVisualColors.border,
            '--vd-form-grid': formVisualColors.grid,
          } as React.CSSProperties}
        >
          <div className="vd-form-titlebar" onMouseDown={handleFormTitleClick} onDoubleClick={handleFormDblClick}>
            <span className="vd-form-titlebar-icon"><Icon name="windows-form" size={14} /></span>
            <span className="vd-form-titlebar-text">{form.title || form.name}</span>
            <span className="vd-form-titlebar-btns">
              <span className="vd-form-btn">─</span>
              <span className="vd-form-btn">🗖️</span>
              <span className="vd-form-btn vd-form-btn-close">✕</span>
            </span>
          </div>

          {/* 窗口客户区 */}
          <div
            ref={canvasRef}
            className={`vd-form-canvas ${activeTool ? 'vd-crosshair' : ''} ${selectedId === '__form__' ? 'vd-form-selected' : ''}`}
            style={{ width: form.width, height: form.height }}
            onMouseDown={handleCanvasMouseDown}
            onDoubleClick={handleFormDblClick}
          >
            {alignGuides.x.map(x => (
              <div
                key={`guide-x-${x}`}
                className="vd-align-guide vd-align-guide-v"
                style={{ left: x }}
              />
            ))}
            {alignGuides.y.map(y => (
              <div
                key={`guide-y-${y}`}
                className="vd-align-guide vd-align-guide-h"
                style={{ top: y }}
              />
            ))}

            {/* 拖拽绘制预览 — 直接显示组件外观 */}
            {drawRect && drawRect.w > 0 && drawRect.h > 0 && activeTool && (
              <div
                className="vd-draw-preview"
                style={{
                  left: drawRect.x,
                  top: drawRect.y,
                  width: drawRect.w,
                  height: drawRect.h,
                }}
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
              const isSelected = ctrl.id === selectedId
              const isMultiSelected = selectedIds.has(ctrl.id)
              return (
                <div
                  key={ctrl.id}
                  className={`vd-control ${isSelected ? 'vd-control-selected' : ''} ${isMultiSelected ? 'vd-control-multi-selected' : ''}`}
                  style={{
                    left: ctrl.left,
                    top: ctrl.top,
                    width: ctrl.width,
                    height: ctrl.height,
                  }}
                  onMouseDown={(e) => handleControlMouseDown(e, ctrl)}
                  onDoubleClick={(e) => handleControlDblClick(e, ctrl)}
                >
                  {renderControlPreview(ctrl)}

                  {/* 控件名标注 */}
                  <div className="vd-control-name">{ctrl.name}</div>

                  {/* 选中句柄 */}
                  {(isSelected || isMultiSelected) && HANDLES.map(h => (
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

      {/* 工具箱：固定模式在右侧渲染，浮动模式悬浮在整个设计器上方 */}
      {renderToolbox()}
    </div>
  )
}

export default VisualDesigner
