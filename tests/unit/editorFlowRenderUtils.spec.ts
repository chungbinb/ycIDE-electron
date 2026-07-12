import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, Fragment } from 'react'
import { renderFlowSegsLine, type FlowLineColors } from '@/components/Editor/editorFlowRenderUtils'
import type { FlowSegment } from '@/components/Editor/eycFlow'

const colors: FlowLineColors = { main: '#4fc1ff', branch: '#4fc1ff', loop: '#4fc1ff', arrow: '#4fc1ff', innerLink: '#4fc1ff' }
const resolveColors = (): FlowLineColors => colors

function renderLine(segs: FlowSegment[]): string {
  const map = new Map<number, FlowSegment[]>([[0, segs]])
  const { node } = renderFlowSegsLine({
    flowLines: { map, maxDepth: Math.max(...segs.map(s => s.depth)) + 1 },
    lineIndex: 0,
    resolveColors,
  })
  return renderToStaticMarkup(createElement(Fragment, null, node))
}

describe('renderFlowSegsLine：分支箭头延伸到同行内层结构（arrow-into-inner）', () => {
  it('分支格右侧紧邻内层 start（否则体首行是嵌套如果）→ 加 eyc-flow-arrow-into-inner', () => {
    const html = renderLine([
      { depth: 0, type: 'branch', isLoop: false, flowKind: 'if' },
      { depth: 1, type: 'start', isLoop: false, flowKind: 'if' },
    ] as FlowSegment[])
    expect(html).toContain('eyc-flow-arrow-into-inner')
    expect(html).toContain('eyc-flow-stagger-upper')
  })

  it('分支格同行无内层结构（普通正文行）→ 不加，箭头保持原位', () => {
    const html = renderLine([
      { depth: 0, type: 'branch', isLoop: false, flowKind: 'if' },
    ] as FlowSegment[])
    expect(html).not.toContain('eyc-flow-arrow-into-inner')
  })

  it('同深度 branch+start 重叠（判断 case 行，走 overlap-slot 路径）→ 不加', () => {
    const html = renderLine([
      { depth: 0, type: 'branch', isLoop: false, flowKind: 'judge' },
      { depth: 0, type: 'start', isLoop: false, flowKind: 'judge' },
    ] as FlowSegment[])
    expect(html).toContain('eyc-flow-overlap-slot')
    expect(html).not.toContain('eyc-flow-arrow-into-inner')
  })

  it('内层 start 不紧邻（隔一格 through）→ 不加（只对紧邻内层做延伸）', () => {
    const html = renderLine([
      { depth: 0, type: 'branch', isLoop: false, flowKind: 'if' },
      { depth: 1, type: 'through', isLoop: false, flowKind: 'if' },
      { depth: 2, type: 'start', isLoop: false, flowKind: 'if' },
    ] as FlowSegment[])
    expect(html).not.toContain('eyc-flow-arrow-into-inner')
  })
})
