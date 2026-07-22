// 「关于」窗跳官网的外部链接白名单——安全边界，防止被诱导打开 file:// 等危险协议。
import { describe, it, expect } from 'vitest'
import { isSafeExternalUrl } from '../../src/shared/urlSafety'

describe('isSafeExternalUrl', () => {
  it('放行 http / https', () => {
    expect(isSafeExternalUrl('https://ziglang.org')).toBe(true)
    expect(isSafeExternalUrl('http://example.com/path?q=1')).toBe(true)
    expect(isSafeExternalUrl('HTTPS://React.dev')).toBe(true) // 协议大小写不敏感
  })

  it('拦截非 http(s) 协议', () => {
    expect(isSafeExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('ftp://host/x')).toBe(false)
    expect(isSafeExternalUrl('mailto:a@b.com')).toBe(false)
    expect(isSafeExternalUrl('vbscript:msgbox')).toBe(false)
  })

  it('拦截非字符串与空值', () => {
    expect(isSafeExternalUrl(null)).toBe(false)
    expect(isSafeExternalUrl(undefined)).toBe(false)
    expect(isSafeExternalUrl(123)).toBe(false)
    expect(isSafeExternalUrl('')).toBe(false)
    expect(isSafeExternalUrl('  https://x.com')).toBe(false) // 前导空白不放行，避免绕过
  })
})
