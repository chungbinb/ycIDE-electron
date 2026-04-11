export type ThemeTokenGroupId = 'base' | 'syntax' | 'table-header' | 'flow-line'
export type ThemeTokenPreviewType = 'color-chip'

export interface ThemeTokenItem {
  id: string
  label: string
  preview: ThemeTokenPreviewType
  tokenKey: string
}

export interface ThemeTokenGroup {
  id: ThemeTokenGroupId
  label: string
  items: ThemeTokenItem[]
}

export const THEME_TOKEN_GROUPS: ThemeTokenGroup[] = [
  {
    id: 'base',
    label: '基础文本/背景',
    items: [
      { id: 'text-primary', label: '主文本', preview: 'color-chip', tokenKey: '--text-primary' },
      { id: 'text-secondary', label: '次文本', preview: 'color-chip', tokenKey: '--text-secondary' },
      { id: 'bg-secondary', label: '主背景', preview: 'color-chip', tokenKey: '--bg-secondary' },
      { id: 'bg-primary', label: '次背景', preview: 'color-chip', tokenKey: '--bg-primary' },
      { id: 'bg-tertiary', label: '弱背景', preview: 'color-chip', tokenKey: '--bg-tertiary' },
      { id: 'titlebar-bg', label: '标题栏背景', preview: 'color-chip', tokenKey: '--titlebar-bg' },
      { id: 'statusbar-bg', label: '状态栏背景', preview: 'color-chip', tokenKey: '--statusbar-bg' },
      { id: 'statusbar-text', label: '状态栏文本', preview: 'color-chip', tokenKey: '--statusbar-text' },
      { id: 'toolbar-icon-color', label: '工具栏图标', preview: 'color-chip', tokenKey: '--toolbar-icon-color' },
      { id: 'toolbar-icon-disabled-color', label: '工具栏禁用图标', preview: 'color-chip', tokenKey: '--toolbar-icon-disabled-color' },
    ],
  },
  {
    id: 'syntax',
    label: '语法高亮',
    items: [
      { id: 'syntax-keyword', label: '关键字', preview: 'color-chip', tokenKey: '--syntax-keyword' },
      { id: 'syntax-string', label: '字符串', preview: 'color-chip', tokenKey: '--syntax-string' },
      { id: 'syntax-number', label: '数字', preview: 'color-chip', tokenKey: '--syntax-number' },
      { id: 'syntax-comment', label: '注释', preview: 'color-chip', tokenKey: '--syntax-comment' },
      { id: 'syntax-function', label: '函数', preview: 'color-chip', tokenKey: '--syntax-function' },
      { id: 'syntax-type', label: '类型', preview: 'color-chip', tokenKey: '--syntax-type' },
      { id: 'syntax-variable', label: '变量', preview: 'color-chip', tokenKey: '--syntax-variable' },
      { id: 'syntax-operator', label: '运算符', preview: 'color-chip', tokenKey: '--syntax-operator' },
    ],
  },
  {
    id: 'table-header',
    label: '表格与表头',
    items: [
      { id: 'table-bg', label: '编辑器背景', preview: 'color-chip', tokenKey: '--table-bg' },
      { id: 'table-text', label: '编辑器文本', preview: 'color-chip', tokenKey: '--table-text' },
      { id: 'table-border', label: '表格边框', preview: 'color-chip', tokenKey: '--table-border' },
      { id: 'table-header-bg', label: '表头背景', preview: 'color-chip', tokenKey: '--table-header-bg' },
      { id: 'table-header-text', label: '表头文本', preview: 'color-chip', tokenKey: '--table-header-text' },
      { id: 'table-row-hover-bg', label: '行悬浮', preview: 'color-chip', tokenKey: '--table-row-hover-bg' },
      { id: 'table-selection-bg', label: '行选中', preview: 'color-chip', tokenKey: '--table-selection-bg' },
    ],
  },
  {
    id: 'flow-line',
    label: '流程线',
    items: [
      { id: 'flow-line-main', label: '主流程线', preview: 'color-chip', tokenKey: '--flow-line-main' },
      { id: 'flow-line-branch', label: '分支流程线', preview: 'color-chip', tokenKey: '--flow-line-branch' },
      { id: 'flow-line-loop', label: '循环流程线', preview: 'color-chip', tokenKey: '--flow-line-loop' },
      { id: 'flow-line-arrow', label: '箭头', preview: 'color-chip', tokenKey: '--flow-line-arrow' },
      { id: 'flow-line-inner-link', label: '内联连接', preview: 'color-chip', tokenKey: '--flow-line-inner-link' },
    ],
  },
]

export const THEME_TOKEN_UI_GROUPS = THEME_TOKEN_GROUPS.map(group => ({
  id: group.id,
  label: group.label,
  items: group.items.map(item => ({
    id: item.id,
    label: item.label,
    preview: item.preview,
  })),
}))

export type FlowLineMode = 'single' | 'multi'
export type FlowLineResetScope = 'active-mode'

export interface FlowLineSingleConfig {
  mainColor: string
}

export interface FlowLineMultiConfig {
  mainColor: string
  depthHueStep: number
  depthSaturationStep: number
  depthLightnessStep: number
}

export interface FlowLineModeConfig {
  mode: FlowLineMode
  single: FlowLineSingleConfig
  multi: FlowLineMultiConfig
}

export const DEFAULT_FLOW_LINE_MODE_CONFIG: FlowLineModeConfig = {
  mode: 'single',
  single: {
    mainColor: '#4fc1ff',
  },
  multi: {
    mainColor: '#4fc1ff',
    depthHueStep: 16,
    depthSaturationStep: -4,
    depthLightnessStep: 5,
  },
}
