// 图像流程线渲染后端（设计稿 §11 阶段 4）。
// 与 DOM 后端共用 buildFlowLineSlots 算出的结构（同一套 class 语义），区别只在怎么画：
//   - DOM：每格一个 span + 伪元素 + 若干子 span，靠 CSS 定位（EycTableEditor.css「流程线」一节）；
//   - 图像：按 CSS 里的同样几何把整行流程线画成一张矢量图（SVG），整行只占一个元素（背景图）。
// 同样结构的行（同样的格、class、颜色）只生成一次图像并缓存，滚动时基本只剩取缓存。
// 用矢量图而不是 Canvas 位图：编辑器有 CSS 缩放、行的位置常落在半像素上，位图贴上去会发虚；
// 矢量图由浏览器在最终位置光栅化（crispEdges），线条和 DOM 一样对齐像素。
// 参数展开区的纵向延续很少出现，仍用 DOM 画。

import type { CSSProperties, ReactNode } from 'react'
import type { FlowSegment } from './eycFlow'
import { buildFlowLineSlots, type FlowLineColors, type FlowSegElement, type FlowSlot } from './editorFlowRenderUtils'

/** 流程线格的度量：以 22px 行高为基准的 CSS 像素 */
export interface FlowLineMetrics {
  /** 1ch 的宽度 */
  ch: number
}

const ROW_HEIGHT = 22
const JOIN_GAP = 1.5
const IMAGE_CACHE_LIMIT = 2000

interface LineImage {
  url: string
  width: number
}

const imageCache = new Map<string, LineImage>()

const fmt = (v: number): string => (Math.round(v * 100) / 100).toString()

/** 生成 SVG 图元：线段用 crispEdges 对齐像素，箭头三角形保留抗锯齿（与 CSS 边框三角一致） */
class Painter {
  readonly parts: string[] = []

  private rect(x: number, y: number, w: number, h: number, color: string): void {
    if (w <= 0 || h <= 0) return
    this.parts.push(`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" fill="${color}" shape-rendering="crispEdges"/>`)
  }

  /** 竖向虚线：3px 实 4px 空，从顶端起算（background-size: 1px 7px） */
  vdash(x: number, top: number, bottom: number, color: string): void {
    for (let y = top; y < bottom; y += 7) this.rect(x, y, 1, Math.min(3, bottom - y), color)
  }

  /** 横向虚线：3px 实 3px 空，从左端起算 */
  hdash(left: number, right: number, y: number, color: string): void {
    for (let x = left; x < right; x += 6) this.rect(x, y, Math.min(3, right - x), 1, color)
  }

  private triangle(points: Array<[number, number]>, color: string): void {
    this.parts.push(`<polygon points="${points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ')}" fill="${color}"/>`)
  }

  /** ▶：右端在 right，纵向以 centerY 居中，宽 5 高 8 */
  arrowRight(right: number, centerY: number, color: string): void {
    this.triangle([[right - 5, centerY - 4], [right, centerY], [right - 5, centerY + 4]], color)
  }

  /** ▼：左端在 left，底边贴行底，宽 8 高 5 */
  arrowDown(left: number, color: string): void {
    this.triangle([[left, ROW_HEIGHT - 5], [left + 8, ROW_HEIGHT - 5], [left + 4, ROW_HEIGHT]], color)
  }
}

function drawSegElement(p: Painter, element: FlowSegElement, left: number, slotWidth: number, ch: number, colors: FlowLineColors): void {
  const cls = new Set(element.className.split(/\s+/).filter(Boolean))
  const has = (name: string): boolean => cls.has(`eyc-flow-${name}`)
  const type = has('start') ? 'start' : has('through') ? 'through' : has('branch') ? 'branch' : has('end') ? 'end' : null
  const H = ROW_HEIGHT
  const L = left
  const outerX = L + 4
  const innerX = L + ch + 4
  const lineColor = has('loop') ? colors.loop : colors.main
  const hideDownArrows = has('hide-down-arrows')
  // 分支横线、右箭头、上段横线的右端：默认停在本格 right:1ch，延伸进内层结构时为 right:-3ch
  const rightEnd = L + slotWidth - (has('arrow-into-inner') ? -3 * ch : ch)
  const branchUpper = has('stagger-upper')
  const startTop = has('stagger-lower') ? 0.68 * H : (has('has-prev-end') || has('has-outer-link')) ? 0.7 * H : 0.5 * H

  const drawBefore = (): void => {
    if (!type || has('no-outer')) return
    if (type === 'through') p.vdash(outerX, JOIN_GAP, H - JOIN_GAP, lineColor)
    else if (type === 'start') p.vdash(outerX, startTop, H - JOIN_GAP, lineColor)
    else if (type === 'end') p.vdash(outerX, JOIN_GAP, JOIN_GAP + 0.5 * H, lineColor)
    else {
      const height = branchUpper ? 0.35 * H : has('has-inner-link') ? 0.2 * H : 0.5 * H
      p.vdash(outerX, JOIN_GAP, JOIN_GAP + height, colors.branch)
    }
  }
  const drawAfter = (): void => {
    if (!type || type === 'through' || has('no-outer')) return
    if (type === 'start') p.hdash(outerX, L + slotWidth - ch, startTop, lineColor)
    else if (type === 'end') p.hdash(outerX, L + slotWidth - ch, 0.5 * H, lineColor)
    else {
      const y = branchUpper ? 0.35 * H : has('has-inner-link') ? 0.8 * H : 0.5 * H
      p.hdash(outerX, rightEnd, y, colors.branch)
    }
  }

  drawBefore()
  for (const child of element.children) {
    const c = new Set(child.split(' '))
    if (c.has('eyc-flow-inner-vert')) {
      if (c.has('eyc-flow-inner-end')) p.vdash(innerX, JOIN_GAP, H - 5, colors.innerLink)
      else {
        const top = has('has-inner-link') && !has('inner-from-above') ? 9 : JOIN_GAP
        p.vdash(innerX, top, H - JOIN_GAP, colors.innerLink)
      }
    } else if (c.has('eyc-flow-arrow-down')) {
      if (!hideDownArrows) p.arrowDown(c.has('eyc-flow-inner-arrow-down') ? L + ch : L, colors.arrow)
    } else if (c.has('eyc-flow-arrow-right')) {
      const y = type === 'branch' ? (branchUpper ? 0.35 * H : 0.5 * H) : (has('stagger-lower') ? 0.68 * H : 0.5 * H)
      p.arrowRight(rightEnd, y, colors.arrow)
    } else if (c.has('eyc-flow-outer-resume')) {
      p.vdash(outerX, 0.8 * H, H - JOIN_GAP, lineColor)
    } else if (c.has('eyc-flow-outer-horz')) {
      p.hdash(outerX, rightEnd, 0.2 * H, lineColor)
    } else if (c.has('eyc-flow-outer-arrow')) {
      p.arrowRight(rightEnd, 0.2 * H, colors.arrow)
    } else if (c.has('eyc-flow-link-vert')) {
      p.vdash(c.has('eyc-flow-link-outer') ? outerX : innerX, JOIN_GAP, JOIN_GAP + 0.4 * H, colors.innerLink)
    } else if (c.has('eyc-flow-link-horz')) {
      p.hdash(c.has('eyc-flow-link-outer') ? outerX : innerX, L + slotWidth - ch, 9, colors.innerLink)
    } else if (c.has('eyc-flow-link-arrow')) {
      p.arrowRight(L + slotWidth - ch, 9, colors.arrow)
    } else if (c.has('eyc-flow-inner-link-horz')) {
      p.hdash(innerX, innerX + 11, 9, colors.innerLink)
    }
  }
  drawAfter()
}

function buildLineImage(slots: FlowSlot[], lineMaxDepth: number, metrics: FlowLineMetrics, resolveColors: (depth: number) => FlowLineColors): LineImage {
  const slotWidth = 4 * metrics.ch
  const width = lineMaxDepth * slotWidth
  const painter = new Painter()
  for (const slot of slots) {
    for (const element of slot.elements) {
      if (!element.seg) continue
      drawSegElement(painter, element, slot.depth * slotWidth, slotWidth, metrics.ch, resolveColors(element.seg.depth))
    }
  }
  // 分支箭头延伸进内层格时可能画到本行最后一格之外，图像不裁剪（overflow 可见）
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}" height="${ROW_HEIGHT}" viewBox="0 0 ${fmt(width)} ${ROW_HEIGHT}" overflow="visible">${painter.parts.join('')}</svg>`
  return { url: `data:image/svg+xml,${encodeURIComponent(svg)}`, width }
}

function imageKey(slots: FlowSlot[], lineMaxDepth: number, metrics: FlowLineMetrics, resolveColors: (depth: number) => FlowLineColors): string {
  let key = `${lineMaxDepth}|${metrics.ch.toFixed(3)}`
  for (const slot of slots) {
    for (const element of slot.elements) {
      if (!element.seg) continue
      const c = resolveColors(element.seg.depth)
      key += `|${slot.depth}:${element.className}:${element.children.join(',')}:${c.main},${c.branch},${c.loop},${c.arrow},${c.innerLink}`
    }
  }
  return key
}

export function renderFlowLineImage(params: {
  flowLines: { map: Map<number, FlowSegment[]>; maxDepth: number }
  lineIndex: number
  isExpanded?: boolean
  resolveColors: (depth: number) => FlowLineColors
  metrics?: FlowLineMetrics
  fallback: () => { node: ReactNode; skipTreeLines: number }
}): { node: ReactNode; skipTreeLines: number } {
  const { flowLines, lineIndex, isExpanded, resolveColors, metrics } = params
  // 还没量到字符宽度（首帧）时先用 DOM 画，量到后整表重渲染即切换
  if (!metrics) return params.fallback()
  const model = buildFlowLineSlots(flowLines, lineIndex, isExpanded)
  if (!model) return { node: null, skipTreeLines: 0 }
  const key = imageKey(model.slots, model.lineMaxDepth, metrics, resolveColors)
  let image = imageCache.get(key)
  if (image === undefined) {
    image = buildLineImage(model.slots, model.lineMaxDepth, metrics, resolveColors)
    if (imageCache.size >= IMAGE_CACHE_LIMIT) imageCache.clear()
    imageCache.set(key, image)
  }
  const style: CSSProperties = {
    width: `${model.lineMaxDepth * 4}ch`,
    backgroundImage: `url("${image.url}")`,
    backgroundSize: `${fmt(image.width)}px ${ROW_HEIGHT}px`,
  }
  return {
    node: <span className="eyc-flow-seg eyc-flow-image" style={style} />,
    skipTreeLines: model.lineMaxDepth,
  }
}
