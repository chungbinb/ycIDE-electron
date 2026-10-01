/**
 * 设计器/面板「显示用」图片清洗。
 *
 * 背景：部分工具导出的 PNG 同时带 iCCP 与 cHRM（或 sRGB + cHRM）且两者不一致，
 * Chromium 内置 libpng 解码时会向进程 stderr 打
 *   `libpng warning: iCCP: cHRM chunk does not match sRGB`
 * 从终端启动 IDE 时可见，纯属噪音（显示效果不受影响——Chromium 反正按 sRGB 渲染）。
 *
 * 这里只清洗「交给 Chromium 显示的副本」，不改动用户存储在工程里的原始数据：
 * 去掉 PNG 的 iCCP / cHRM 块即可让整族警告消失；其余块（含图像数据）逐字节保留，
 * 无这些块的 PNG 零拷贝原样返回。编译产物用 GDI+ 解码、无 libpng，不受此问题影响。
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false
  }
  return true
}

/**
 * 去掉 PNG 的 iCCP / cHRM 块（这两个块与显示无关，仅色彩元数据）。
 * 输入不是合法 PNG、结构损坏或没有这两块时，原样返回入参（零拷贝）。
 */
export function stripPngProfileChunks(bytes: Uint8Array): Uint8Array {
  if (!isPng(bytes)) return bytes
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  const readChunkAt = (off: number): { type: string; dataEnd: number; next: number } | null => {
    // 每个块：4 字节长度 + 4 字节类型 + 数据 + 4 字节 CRC
    if (off + 12 > bytes.length) return null
    const len = view.getUint32(off, false)
    if (off + 12 + len > bytes.length) return null
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7])
    return { type, dataEnd: off + 8 + len, next: off + 12 + len }
  }

  // 快路径：先扫一遍，没有目标块就不复制
  let dirty = false
  for (let off = 8; off + 12 <= bytes.length;) {
    const chunk = readChunkAt(off)
    if (!chunk) return bytes
    if (chunk.type === 'iCCP' || chunk.type === 'cHRM') dirty = true
    if (chunk.type === 'IEND') break
    off = chunk.next
  }
  if (!dirty) return bytes

  const parts: Uint8Array[] = [bytes.subarray(0, 8)]
  for (let off = 8; off + 12 <= bytes.length;) {
    const chunk = readChunkAt(off)
    if (!chunk) return bytes // 不可能：与第一遍相同路径，防御性兜底
    if (chunk.type !== 'iCCP' && chunk.type !== 'cHRM') {
      parts.push(bytes.subarray(off, chunk.next))
    }
    if (chunk.type === 'IEND') break
    off = chunk.next
  }
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let written = 0
  for (const p of parts) {
    out.set(p, written)
    written += p.length
  }
  return out
}

/** data URL（base64）→ 字节；解析失败返回 null */
function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  try {
    const bin = atob(dataUrl.slice(comma + 1))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

function bytesToPngDataUrl(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

/**
 * 清洗用于显示的图片 data URL：仅当它是带 iCCP/cHRM 块的 PNG 时重建，
 * 其余（JPG/SVG/干净 PNG/非法串）原样返回。只影响显示，不改存储数据。
 */
export function sanitizeImageDisplaySrc(src: string): string {
  if (!src.startsWith('data:image/png;base64,')) return src
  const bytes = dataUrlToBytes(src)
  if (!bytes) return src
  const cleaned = stripPngProfileChunks(bytes)
  if (cleaned === bytes) return src
  try {
    return bytesToPngDataUrl(cleaned)
  } catch {
    return src
  }
}
