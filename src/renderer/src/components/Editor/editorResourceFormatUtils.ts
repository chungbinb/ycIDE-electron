export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知'
  if (bytes < 1024) return `${bytes} B`

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }
  return `${value.toFixed(value < 10 ? 2 : 1)} ${units[idx]}`
}

export function formatDateTime(tsMs: number): string {
  if (!Number.isFinite(tsMs) || tsMs <= 0) return '未知'
  return new Date(tsMs).toLocaleString('zh-CN', { hour12: false })
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '未知'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
