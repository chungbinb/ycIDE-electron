import { describe, it, expect } from 'vitest'
import { normalizeEycText, extractRoutedDeclarationLinesFromPasted } from '@/components/Editor/eycFormat'

// eycFormat 的流程线转换与粘贴清洗逻辑已由 tests/contract/editor-helper-utils-contract.spec.mjs 覆盖，
// 这里只补基础规范化函数的单测。
describe('normalizeEycText', () => {
  it('统一 CRLF / CR 为 LF', () => {
    expect(normalizeEycText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })

  it('剥离开头的 UTF-8 BOM', () => {
    expect(normalizeEycText('﻿.版本 2')).toBe('.版本 2')
  })

  it('普通文本原样返回', () => {
    expect(normalizeEycText('输出调试文本 ("ok")')).toBe('输出调试文本 ("ok")')
  })
})

describe('声明行跨文档路由', () => {
  it('长文本常量与普通常量同路由到 .ecs（否则 .长文本常量 行滞留在代码文件里）', () => {
    const pasted = [
      '.常量 普通, "1"',
      '.长文本常量 长文, "第一行\n第二行"',
      '.全局变量 变量甲, 整数型',
      '调试输出 (1)',
    ].join('\n')
    const routed = extractRoutedDeclarationLinesFromPasted(pasted, '')
    const ecs = routed.find(r => r.language === 'ecs')
    expect(ecs, '应有 ecs 路由').toBeTruthy()
    expect(ecs!.lines.some(l => l.includes('.常量 普通'))).toBe(true)
    expect(ecs!.lines.some(l => l.includes('.长文本常量 长文')), '长文本常量须一并路由').toBe(true)
    // 全局变量走自己的桶，不串到常量表
    expect(routed.find(r => r.language === 'egv')?.lines.some(l => l.includes('变量甲'))).toBe(true)
  })
})
