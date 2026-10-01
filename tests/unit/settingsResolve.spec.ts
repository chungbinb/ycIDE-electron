import { describe, expect, it } from 'vitest'
import { DEFAULT_IDE_SETTINGS, resolveIDESettings } from '../../src/shared/settings'

describe('resolveIDESettings.designerVc6Style', () => {
  it('默认启用 VC6 现代样式', () => {
    expect(DEFAULT_IDE_SETTINGS.designerVc6Style).toBe(true)
    expect(resolveIDESettings(null).designerVc6Style).toBe(true)
    expect(resolveIDESettings({}).designerVc6Style).toBe(true)
  })

  it('接受显式布尔值，非布尔回落默认', () => {
    expect(resolveIDESettings({ designerVc6Style: false }).designerVc6Style).toBe(false)
    expect(resolveIDESettings({ designerVc6Style: true }).designerVc6Style).toBe(true)
    expect(resolveIDESettings({ designerVc6Style: 'yes' }).designerVc6Style).toBe(true)
  })
})

describe('resolveIDESettings.designerCanvasMode', () => {
  it('默认为居中模式 center', () => {
    expect(DEFAULT_IDE_SETTINGS.designerCanvasMode).toBe('center')
    expect(resolveIDESettings(null).designerCanvasMode).toBe('center')
    expect(resolveIDESettings({}).designerCanvasMode).toBe('center')
  })

  it('接受白名单值 center / topleft', () => {
    expect(resolveIDESettings({ designerCanvasMode: 'center' }).designerCanvasMode).toBe('center')
    expect(resolveIDESettings({ designerCanvasMode: 'topleft' }).designerCanvasMode).toBe('topleft')
  })

  it('非法值回落默认 center（脏配置不进设计器）', () => {
    expect(resolveIDESettings({ designerCanvasMode: 'free' }).designerCanvasMode).toBe('center')
    expect(resolveIDESettings({ designerCanvasMode: '' }).designerCanvasMode).toBe('center')
    expect(resolveIDESettings({ designerCanvasMode: 123 }).designerCanvasMode).toBe('center')
  })
})
