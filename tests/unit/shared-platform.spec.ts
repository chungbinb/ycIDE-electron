import { describe, it, expect } from 'vitest'
import { normalizeRuntimePlatform, isDesktopRuntime } from '../../src/shared/platform'

describe('normalizeRuntimePlatform', () => {
  it('映射 Node 平台标识', () => {
    expect(normalizeRuntimePlatform('win32')).toBe('windows')
    expect(normalizeRuntimePlatform('darwin')).toBe('macos')
    expect(normalizeRuntimePlatform('linux')).toBe('linux')
    expect(normalizeRuntimePlatform('harmony')).toBe('harmony')
  })

  it('未知平台回退到 linux', () => {
    expect(normalizeRuntimePlatform('freebsd')).toBe('linux')
  })
})

describe('isDesktopRuntime', () => {
  it('桌面平台返回 true，harmony 返回 false', () => {
    expect(isDesktopRuntime('windows')).toBe(true)
    expect(isDesktopRuntime('macos')).toBe(true)
    expect(isDesktopRuntime('linux')).toBe(true)
    expect(isDesktopRuntime('harmony')).toBe(false)
  })
})
