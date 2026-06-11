// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useUiLayoutStore } from '@/stores/uiLayoutStore'
import { useSettingsStore } from '@/stores/settingsStore'

describe('uiLayoutStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useUiLayoutStore.setState({
      sidebarWidth: 260,
      outputHeight: 200,
      showOutput: true,
      sidebarCollapsed: false,
      sidebarTab: 'project',
      activityBarSide: 'left',
      activityBarContextMenu: null,
      showAIPanel: false,
    })
  })

  it('setter 支持直接值与函数式更新', () => {
    const s = useUiLayoutStore.getState()
    s.setSidebarWidth(300)
    expect(useUiLayoutStore.getState().sidebarWidth).toBe(300)
    s.setSidebarWidth(prev => prev + 10)
    expect(useUiLayoutStore.getState().sidebarWidth).toBe(310)
    s.setShowOutput(prev => !prev)
    expect(useUiLayoutStore.getState().showOutput).toBe(false)
  })

  it('setActivityBarSide 持久化到 localStorage', () => {
    useUiLayoutStore.getState().setActivityBarSide('right')
    expect(useUiLayoutStore.getState().activityBarSide).toBe('right')
    expect(localStorage.getItem('ycide.activityBar.side.v1')).toBe('right')
  })

  it('toggleAIPanel 切换并持久化开关', () => {
    useUiLayoutStore.getState().toggleAIPanel()
    expect(useUiLayoutStore.getState().showAIPanel).toBe(true)
    expect(localStorage.getItem('ycide.aiPanel.open.v1')).toBe('true')
    useUiLayoutStore.getState().toggleAIPanel()
    expect(useUiLayoutStore.getState().showAIPanel).toBe(false)
    expect(localStorage.getItem('ycide.aiPanel.open.v1')).toBe('false')
  })
})

describe('settingsStore', () => {
  it('setIdeSettings 支持整体替换与函数式合并', () => {
    const base = useSettingsStore.getState().ideSettings
    useSettingsStore.getState().setIdeSettings({ ...base, editorFontSize: 18 })
    expect(useSettingsStore.getState().ideSettings.editorFontSize).toBe(18)
    useSettingsStore.getState().setIdeSettings(prev => ({ ...prev, editorFontSize: prev.editorFontSize + 2 }))
    expect(useSettingsStore.getState().ideSettings.editorFontSize).toBe(20)
  })
})
