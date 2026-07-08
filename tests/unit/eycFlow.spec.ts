import { describe, it, expect } from 'vitest'
import { appendMissingFlowEnds, computeFlowLines } from '../../src/renderer/src/components/Editor/eycFlow'
import type { RenderBlock } from '../../src/renderer/src/components/Editor/eycTableModel'

function codeBlocks(lines: string[]): RenderBlock[] {
  return lines.map((codeLine, i) => ({ kind: 'codeline', rows: [], codeLine, lineIndex: i } as RenderBlock))
}

function segTypesAt(map: Map<number, { depth: number; type: string }[]>, li: number): string[] {
  return (map.get(li) || []).map(s => `${s.depth}:${s.type}`).sort()
}

describe('computeFlowLines 配对与隐式闭合', () => {
  it('标准如果/否则/如果结束正常配对', () => {
    const { map } = computeFlowLines(codeBlocks([
      '.如果 (a)', '    b ()', '.否则', '    c ()', '.如果结束',
    ]))
    expect(segTypesAt(map, 0)).toEqual(['0:start'])
    expect(segTypesAt(map, 2)).toEqual(['0:branch'])
    expect(segTypesAt(map, 4)).toEqual(['0:end'])
  })

  it('结束行缩进错位时回退就近配对（整块流程线不再消失）', () => {
    const { map } = computeFlowLines(codeBlocks([
      '.如果 (a)', '    b ()', '.否则', '    c ()', '    .如果结束',
    ]))
    expect(segTypesAt(map, 0)).toEqual(['0:start'])
    expect(segTypesAt(map, 4)).toEqual(['0:end'])
  })

  it('漏写内层如果结束：内层隐式闭合，且不跨越外层否则边界', () => {
    const { map } = computeFlowLines(codeBlocks([
      '.如果 (a)', '    .如果 (b)', '        c ()', '.否则', '    d ()', '.如果结束',
    ]))
    // 内层块 start=1，隐式闭合到否则前一行（行2），不得延伸到否则分支正文（行4）
    expect(segTypesAt(map, 1)).toContain('1:start')
    expect(segTypesAt(map, 2)).toContain('1:end')
    expect(segTypesAt(map, 4)).toEqual(['0:through'])
  })

  it('文末未闭合结构隐式闭合到最后一行', () => {
    const { map } = computeFlowLines(codeBlocks([
      '.如果 (a)', '    b ()', '    c ()',
    ]))
    expect(segTypesAt(map, 0)).toEqual(['0:start'])
    expect(segTypesAt(map, 2)).toContain('0:end')
  })

  it('孤立的如果结束不产生任何流程段', () => {
    const { map } = computeFlowLines(codeBlocks([
      'a ()', '.如果结束', 'b ()',
    ]))
    expect(map.size).toBe(0)
  })

  it('如果真里误写否则：否则行不产生 branch 段（保持可见由编辑器负责）', () => {
    const { map } = computeFlowLines(codeBlocks([
      '.如果真 (a)', '    b ()', '.否则', '    c ()', '.如果真结束',
    ]))
    expect((map.get(2) || []).some(s => s.type === 'branch')).toBe(false)
  })

  it('嵌套判断的分支归属内层，不并入外层', () => {
    const { map } = computeFlowLines(codeBlocks([
      '.判断开始 (a)', '    .判断开始 (b)', '        c ()', '    .判断 (d)', '        e ()', '    .判断结束', '.判断 (f)', '    g ()', '.判断结束',
    ]))
    // 内层 .判断 (d)（行3）应是 depth1 的 branch+start（外层块的 0:through 穿越属正常）；
    // 外层 .判断 (f)（行6）是 depth0，不得混入 depth1 段
    const at3 = segTypesAt(map, 3)
    expect(at3).toContain('1:branch')
    expect(at3).toContain('1:start')
    expect(at3.some(s => s.startsWith('0:') && s !== '0:through')).toBe(false)
    expect(segTypesAt(map, 6)).toEqual(['0:branch', '0:start'])
  })

  it('R1: 与外层对齐的 .判断 分支优先精确同缩进归属，不被外退启发式误吞进未闭合内层判断块', () => {
    const { map } = computeFlowLines(codeBlocks([
      '.判断开始 (a)', '    .判断开始 (b)', '        x ()', '.判断 (c)', '    y ()', '.判断结束', '.判断结束',
    ]))
    // .判断 (c)（行3，indent0，与外层 a 对齐）归外层 a(depth0)，非内层 b(depth1)
    expect(segTypesAt(map, 3)).toEqual(['0:branch', '0:start'])
    // 内层 b 在 x()（行2）被隐式闭合
    expect(segTypesAt(map, 2)).toContain('1:end')
  })

  it('R2: .判断 分支归属非栈顶判断块时隐式闭合其上未闭合内层结构，内层线不跨越分支行', () => {
    const { map } = computeFlowLines(codeBlocks([
      '.判断开始 (o)', '    .如果 (inner)', '        m ()', '.判断 (b)', '    n ()', '.判断结束',
    ]))
    // 内层如果在 m()（行2）闭合，不延伸到 .判断 分支行
    expect(segTypesAt(map, 2)).toContain('1:end')
    // .判断 分支行（行3）干净：只有外层 depth0 的 branch+start，无 depth1 through 穿越
    expect(segTypesAt(map, 3)).toEqual(['0:branch', '0:start'])
  })

  it('R3: 桥接只在 判断结束→判断 之间产生；如果结束/循环尾→判断 不桥接', () => {
    const ifThenJudge = computeFlowLines(codeBlocks([
      '.如果 (a)', '    m ()', '.如果结束', '.判断开始 (b)', '    n ()', '.判断结束',
    ])).map
    expect((ifThenJudge.get(2) || []).some(s => s.hasNextFlow)).toBe(false)
    expect((ifThenJudge.get(3) || []).some(s => s.hasPrevFlowEnd)).toBe(false)

    const loopThenJudge = computeFlowLines(codeBlocks([
      '.计次循环首 (3)', '    m ()', '.计次循环尾', '.判断开始 (b)', '    n ()', '.判断结束',
    ])).map
    expect((loopThenJudge.get(2) || []).some(s => s.hasNextFlow)).toBe(false)
    expect((loopThenJudge.get(3) || []).some(s => s.hasPrevFlowEnd)).toBe(false)

    // 合法桥接保留：判断结束 → 判断开始
    const judgeThenJudge = computeFlowLines(codeBlocks([
      '.判断开始 (a)', '    m ()', '.判断结束', '.判断开始 (b)', '    n ()', '.判断结束',
    ])).map
    expect((judgeThenJudge.get(2) || []).some(s => s.hasNextFlow)).toBe(true)
    expect((judgeThenJudge.get(3) || []).some(s => s.hasPrevFlowEnd)).toBe(true)
  })

  it('连续如果真同类桥接（如果真结束→如果真），跨类型不桥接', () => {
    // 如果真 → 如果真：桥接（前块结束 hasNextFlow、后块起始 hasPrevFlowEnd）
    const ifTrueChain = computeFlowLines(codeBlocks([
      '.如果真 (a)', '    m ()', '.如果真结束', '.如果真 (b)', '    n ()', '.如果真结束',
    ])).map
    expect((ifTrueChain.get(2) || []).some(s => s.hasNextFlow)).toBe(true)
    expect((ifTrueChain.get(3) || []).some(s => s.hasPrevFlowEnd)).toBe(true)

    // 跨类型不桥接：如果真结束 → 判断开始
    const ifTrueThenJudge = computeFlowLines(codeBlocks([
      '.如果真 (a)', '    m ()', '.如果真结束', '.判断开始 (b)', '    n ()', '.判断结束',
    ])).map
    expect((ifTrueThenJudge.get(2) || []).some(s => s.hasNextFlow)).toBe(false)
    expect((ifTrueThenJudge.get(3) || []).some(s => s.hasPrevFlowEnd)).toBe(false)

    // 跨类型不桥接：判断结束 → 如果真
    const judgeThenIfTrue = computeFlowLines(codeBlocks([
      '.判断开始 (a)', '    m ()', '.判断结束', '.如果真 (b)', '    n ()', '.如果真结束',
    ])).map
    expect((judgeThenIfTrue.get(2) || []).some(s => s.hasNextFlow)).toBe(false)
    expect((judgeThenIfTrue.get(3) || []).some(s => s.hasPrevFlowEnd)).toBe(false)
  })
})

describe('appendMissingFlowEnds（复制/粘贴补齐流程结束行）', () => {
  it('判断开始+case+默认 缺判断结束 → 末尾补判断结束（用户场景）', () => {
    const out = appendMissingFlowEnds(['.判断开始 (a ＝ 1)', '    调试输出 (1)', '.判断 (a ＝ 2)', '    调试输出 (2)', '.默认', '    调试输出 (9)'])
    expect(out[out.length - 1]).toBe('.判断结束')
    expect(out).toHaveLength(7)
  })

  it('如果+否则 缺如果结束 → 补如果结束；已配平的片段原样返回', () => {
    const out = appendMissingFlowEnds(['.如果 (a ＝ 1)', '    调试输出 (1)', '.否则', '    调试输出 (2)'])
    expect(out[out.length - 1]).toBe('.如果结束')
    const balanced = ['.如果 (a ＝ 1)', '    调试输出 (1)', '.如果结束']
    expect(appendMissingFlowEnds(balanced)).toEqual(balanced)
  })

  it('嵌套双头都缺尾 → 按 LIFO 先补内层再补外层，缩进/点号沿用头行', () => {
    const out = appendMissingFlowEnds(['.如果 (a ＝ 1)', '    .判断开始 (b ＝ 2)', '        调试输出 (1)'])
    expect(out.slice(-2)).toEqual(['    .判断结束', '.如果结束'])
  })

  it('循环头缺尾 → 补带空括号的循环尾', () => {
    const out = appendMissingFlowEnds(['.计次循环首 (10, i)', '    调试输出 (i)'])
    expect(out[out.length - 1]).toBe('.计次循环尾 ()')
  })

  it('裸「判断」不视为可闭合头：单独的 case 片段原样返回；判断开始下的 case 不重复补', () => {
    const caseOnly = ['.判断 (a ＝ 2)', '    调试输出 (2)']
    expect(appendMissingFlowEnds(caseOnly)).toEqual(caseOnly)
    const withHead = appendMissingFlowEnds(['.判断开始 (a ＝ 1)', '.判断 (a ＝ 2)', '    调试输出 (2)'])
    expect(withHead.filter(l => l.includes('判断结束'))).toHaveLength(1)
  })

  it('内层未闭合但外层结束在场 → 内层视为隐式闭合、不补（与 implicitClose 一致）；孤立结束行原样', () => {
    const crossed = ['.如果 (a ＝ 1)', '    .计次循环首 (10, i)', '.如果结束']
    expect(appendMissingFlowEnds(crossed)).toEqual(crossed)
    const strayEnd = ['    调试输出 (1)', '.如果结束']
    expect(appendMissingFlowEnds(strayEnd)).toEqual(strayEnd)
  })
})
