/**
 * 输出面板「输出」标签的时间轴/用时格式化。
 *
 * 用时语义（锚点由 App 在消息到达时逐条算好随消息下发）：
 * - 编译阶段：自本次「编译/运行」操作开始；
 * - 运行阶段：自「程序已启动」重新锚定后计。
 */

export type OutputLineType = 'info' | 'success' | 'error' | 'warning'

/** 消息类型 → 中文标签（输出面板最左列的类型标记） */
export const OUTPUT_TYPE_LABELS: Record<OutputLineType, string> = {
  info: '信息',
  success: '成功',
  error: '错误',
  warning: '警告',
}

/** 时刻 → 本地时钟 HH:MM:SS.mmm（时间轴列，固定 12 字符宽保证对齐） */
export function formatClockTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

/** 用时 → 1 秒内显示毫秒（如 128ms），超过 1 秒显示秒（如 1.250s、98.500s） */
export function formatElapsedMs(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0
  if (safe < 1000) return `${Math.round(safe)}ms`
  return `${(safe / 1000).toFixed(3)}s`
}
