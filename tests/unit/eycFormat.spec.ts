import { describe, it, expect } from 'vitest'
import { normalizeEycText } from '@/components/Editor/eycFormat'

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
