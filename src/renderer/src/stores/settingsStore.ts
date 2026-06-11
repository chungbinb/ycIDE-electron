import { create } from 'zustand'
import { DEFAULT_IDE_SETTINGS, type IDESettings } from '../../../shared/settings'

/**
 * IDE 设置全局状态（从 App.tsx 迁出）。
 *
 * 仅承载设置值本体；设置对话框的草稿/基线/保存流程仍在 App 中编排。
 * setter 兼容 React setState 的「值或更新函数」签名。
 */

type Updater<T> = T | ((prev: T) => T)

export interface SettingsState {
  ideSettings: IDESettings
  setIdeSettings: (next: Updater<IDESettings>) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ideSettings: DEFAULT_IDE_SETTINGS,
  setIdeSettings: (next) => set(s => ({
    ideSettings: typeof next === 'function' ? next(s.ideSettings) : next,
  })),
}))
