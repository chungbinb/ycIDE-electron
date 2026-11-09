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

describe('resolveIDESettings 背景与透明度', () => {
  it('默认无背景图、前景 85%、窗口不透明', () => {
    const s = resolveIDESettings(null)
    expect(s.backgroundImagePath).toBe('')
    expect(s.backgroundImageFit).toBe('cover')
    expect(s.backgroundFrostedGlass).toBe(false)
    expect(s.backgroundFrostedBlur).toBe(8)
    expect(s.backgroundForegroundOpacity).toBe(85)
    expect(s.windowOpacity).toBe(100)
  })

  it('透明度按上下限钳制，非法填充方式回落默认', () => {
    const s = resolveIDESettings({
      backgroundImagePath: '  C:\bg.png  ',
      backgroundImageFit: 'zoom' as never,
      backgroundForegroundOpacity: 5,
      windowOpacity: 150,
    })
    expect(s.backgroundImagePath).toBe('C:\bg.png')
    expect(s.backgroundImageFit).toBe('cover')
    expect(s.backgroundForegroundOpacity).toBe(20)
    expect(s.windowOpacity).toBe(100)
    expect(resolveIDESettings({ windowOpacity: 10 }).windowOpacity).toBe(30)
    expect(resolveIDESettings({ backgroundImageFit: 'tile' }).backgroundImageFit).toBe('tile')
    expect(resolveIDESettings({ backgroundFrostedGlass: true }).backgroundFrostedGlass).toBe(true)
    expect(resolveIDESettings({ backgroundFrostedGlass: 'yes' as never }).backgroundFrostedGlass).toBe(false)
    expect(resolveIDESettings({ backgroundFrostedBlur: 0 }).backgroundFrostedBlur).toBe(1)
    expect(resolveIDESettings({ backgroundFrostedBlur: 99 }).backgroundFrostedBlur).toBe(40)
  })
})
