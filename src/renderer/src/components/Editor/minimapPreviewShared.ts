export interface MinimapPreviewRequest {
  id: number
  text: string
  maxRows: number
  maxCharsPerLine: number
}

export interface MinimapPreviewResponse {
  id: number
  previewText: string
}

export function buildMinimapPreviewText(
  text: string,
  maxRows = 260,
  maxCharsPerLine = 84,
): string {
  const sourceLines = text.replace(/\r\n/g, '\n').split('\n')
  const total = Math.max(sourceLines.length, 1)
  const count = Math.max(1, Math.min(total, Math.max(1, maxRows)))
  const maxChars = Math.max(8, maxCharsPerLine)

  const sampledLines = Array.from({ length: count }, (_, i) => {
    const start = Math.floor((i * total) / count)
    const end = Math.max(start + 1, Math.floor(((i + 1) * total) / count))
    const mid = Math.min(Math.max(Math.floor((start + end) / 2), 0), total - 1)
    const raw = (sourceLines[mid] || '').replace(/\t/g, '    ').replace(/\r/g, '')
    const trimmed = raw.trim()
    if (!trimmed) return ' '
    return raw.length > maxChars ? `${raw.slice(0, maxChars)}…` : raw
  })

  return sampledLines.join('\n')
}
