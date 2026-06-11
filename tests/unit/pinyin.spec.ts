import { describe, it, expect } from 'vitest'
import { matchCommand, matchScore, isEnglishMatch } from '@/utils/pinyin'

describe('matchCommand', () => {
  it('中文子串匹配', () => {
    expect(matchCommand('调试', '输出调试文本', 'OutputDebugText')).toBe(true)
  })

  it('英文名前缀匹配（不区分大小写）', () => {
    expect(matchCommand('output', '输出调试文本', 'OutputDebugText')).toBe(true)
  })

  it('拼音首字母匹配', () => {
    expect(matchCommand('ts', '调试输出', '')).toBe(true)
  })

  it('拼音全拼前缀匹配', () => {
    expect(matchCommand('tiao', '调试输出', '')).toBe(true)
  })

  it('中文+拼音混合匹配', () => {
    expect(matchCommand('调s', '调试输出', '')).toBe(true)
  })

  it('不匹配时返回 false', () => {
    expect(matchCommand('xyz', '调试输出', '')).toBe(false)
    expect(matchCommand('', '调试输出', '')).toBe(false)
  })
})

describe('matchScore', () => {
  it('精确匹配 > 前缀匹配 > 子串匹配', () => {
    const exact = matchScore('调试输出', '调试输出', '')
    const prefix = matchScore('调试', '调试输出', '')
    const substr = matchScore('输出', '调试输出', '')
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(substr)
  })

  it('中文匹配得分高于拼音首字母匹配', () => {
    const chinese = matchScore('调试', '调试输出', '')
    const initials = matchScore('tssc', '调试输出', '')
    expect(chinese).toBeGreaterThan(initials)
  })

  it('完全不匹配得 0 分', () => {
    expect(matchScore('xyz', '调试输出', '')).toBe(0)
  })
})

describe('isEnglishMatch', () => {
  it('英文名包含输入即命中', () => {
    expect(isEnglishMatch('debug', 'OutputDebugText')).toBe(true)
    expect(isEnglishMatch('xyz', 'OutputDebugText')).toBe(false)
    expect(isEnglishMatch('debug', '')).toBe(false)
  })
})
