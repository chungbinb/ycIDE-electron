import { create } from 'zustand'

/**
 * IDE 布局与弹窗开关状态。
 *
 * 从 App.tsx 迁出的第一批全局状态：这些状态无跨 IPC 副作用、消费方明确，
 * 出错最多是 UI 抖动。setter 兼容 React setState 的「值或更新函数」签名，
 * 以便调用方机械替换。localStorage 持久化（活动栏方向 / AI 面板开关）收敛在本 store。
 */

export type ActivityBarSide = 'left' | 'right'
export type SidebarTab = 'project' | 'library' | 'property'

const ACTIVITY_BAR_SIDE_KEY = 'ycide.activityBar.side.v1'
const AI_PANEL_OPEN_KEY = 'ycide.aiPanel.open.v1'

type Updater<T> = T | ((prev: T) => T)

function applyUpdater<T>(prev: T, updater: Updater<T>): T {
  return typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater
}

function readInitialActivityBarSide(): ActivityBarSide {
  try {
    return localStorage.getItem(ACTIVITY_BAR_SIDE_KEY) === 'right' ? 'right' : 'left'
  } catch {
    return 'left'
  }
}

function readInitialAIPanelOpen(): boolean {
  try {
    return localStorage.getItem(AI_PANEL_OPEN_KEY) === 'true'
  } catch {
    return false
  }
}

export interface UiLayoutState {
  sidebarWidth: number
  outputHeight: number
  showOutput: boolean
  sidebarCollapsed: boolean
  sidebarTab: SidebarTab
  activityBarSide: ActivityBarSide
  activityBarContextMenu: { x: number; y: number } | null
  showLibrary: boolean
  showNewProject: boolean
  showThemeManager: boolean
  showSettings: boolean
  showAIPanel: boolean

  setSidebarWidth: (next: Updater<number>) => void
  setOutputHeight: (next: Updater<number>) => void
  setShowOutput: (next: Updater<boolean>) => void
  setSidebarCollapsed: (next: Updater<boolean>) => void
  setSidebarTab: (next: Updater<SidebarTab>) => void
  setActivityBarSide: (next: Updater<ActivityBarSide>) => void
  setActivityBarContextMenu: (next: Updater<{ x: number; y: number } | null>) => void
  setShowLibrary: (next: Updater<boolean>) => void
  setShowNewProject: (next: Updater<boolean>) => void
  setShowThemeManager: (next: Updater<boolean>) => void
  setShowSettings: (next: Updater<boolean>) => void
  setShowAIPanel: (next: Updater<boolean>) => void
  /** 切换 AI 面板并持久化开关状态 */
  toggleAIPanel: () => void
}

export const useUiLayoutStore = create<UiLayoutState>((set) => ({
  sidebarWidth: 260,
  outputHeight: 200,
  showOutput: true,
  sidebarCollapsed: false,
  sidebarTab: 'project',
  activityBarSide: readInitialActivityBarSide(),
  activityBarContextMenu: null,
  showLibrary: false,
  showNewProject: false,
  showThemeManager: false,
  showSettings: false,
  showAIPanel: readInitialAIPanelOpen(),

  setSidebarWidth: (next) => set(s => ({ sidebarWidth: applyUpdater(s.sidebarWidth, next) })),
  setOutputHeight: (next) => set(s => ({ outputHeight: applyUpdater(s.outputHeight, next) })),
  setShowOutput: (next) => set(s => ({ showOutput: applyUpdater(s.showOutput, next) })),
  setSidebarCollapsed: (next) => set(s => ({ sidebarCollapsed: applyUpdater(s.sidebarCollapsed, next) })),
  setSidebarTab: (next) => set(s => ({ sidebarTab: applyUpdater(s.sidebarTab, next) })),
  setActivityBarSide: (next) => set(s => {
    const value = applyUpdater(s.activityBarSide, next)
    try {
      localStorage.setItem(ACTIVITY_BAR_SIDE_KEY, value)
    } catch {
      // 忽略持久化异常
    }
    return { activityBarSide: value }
  }),
  setActivityBarContextMenu: (next) => set(s => ({ activityBarContextMenu: applyUpdater(s.activityBarContextMenu, next) })),
  setShowLibrary: (next) => set(s => ({ showLibrary: applyUpdater(s.showLibrary, next) })),
  setShowNewProject: (next) => set(s => ({ showNewProject: applyUpdater(s.showNewProject, next) })),
  setShowThemeManager: (next) => set(s => ({ showThemeManager: applyUpdater(s.showThemeManager, next) })),
  setShowSettings: (next) => set(s => ({ showSettings: applyUpdater(s.showSettings, next) })),
  setShowAIPanel: (next) => set(s => ({ showAIPanel: applyUpdater(s.showAIPanel, next) })),
  toggleAIPanel: () => set(s => {
    const next = !s.showAIPanel
    try {
      localStorage.setItem(AI_PANEL_OPEN_KEY, String(next))
    } catch {
      // 忽略持久化异常
    }
    return { showAIPanel: next }
  }),
}))
