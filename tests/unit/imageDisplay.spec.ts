import { describe, expect, it } from 'vitest'
import { sanitizeImageDisplaySrc, stripPngProfileChunks } from '@/utils/imageDisplay'

// ===== 测试用 PNG 构造 =====

const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function crc32(data: Uint8Array): number {
  let c = ~0
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length, false)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  const body = out.subarray(4, 8 + data.length)
  view.setUint32(8 + data.length, crc32(body), false)
  return out
}

function png(chunks: Uint8Array[]): Uint8Array {
  const parts = [PNG_SIG, ...chunks]
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

const IHDR = chunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]))
const ICCP = chunk('iCCP', new Uint8Array([1, 2, 3, 4, 5]))
const CHRM = chunk('cHRM', new Uint8Array([9, 9, 9, 9]))
const IDAT = chunk('IDAT', new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
const IEND = chunk('IEND', new Uint8Array([]))

function findChunk(bytes: Uint8Array, type: string): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let off = 8
  while (off + 12 <= bytes.length) {
    const len = view.getUint32(off, false)
    const t = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7])
    if (t === type) return true
    if (t === 'IEND') return false
    off += 12 + len
  }
  return false
}

describe('stripPngProfileChunks', () => {
  it('去掉 iCCP/cHRM 块，其余块逐字节保留', () => {
    const src = png([IHDR, ICCP, CHRM, IDAT, IEND])
    const out = stripPngProfileChunks(src)
    expect(findChunk(out, 'iCCP')).toBe(false)
    expect(findChunk(out, 'cHRM')).toBe(false)
    expect(findChunk(out, 'IHDR')).toBe(true)
    expect(findChunk(out, 'IDAT')).toBe(true)
    expect(findChunk(out, 'IEND')).toBe(true)
    // IDAT 数据字节不变（位于 IEND(12) 的 CRC 前：长度4+类型4 之后）：
    // 布局 SIG(8)+IHDR(25)+IDAT(16)+IEND(12)，IDAT 数据 = 61-20 .. 61-16
    const idat = Array.from(out.subarray(out.length - 20, out.length - 16))
    expect(idat).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  it('干净 PNG（无 iCCP/cHRM）原样返回（零拷贝）', () => {
    const src = png([IHDR, IDAT, IEND])
    expect(stripPngProfileChunks(src)).toBe(src)
  })

  it('只有 cHRM 的 PNG 只去掉 cHRM', () => {
    const src = png([IHDR, CHRM, IDAT, IEND])
    const out = stripPngProfileChunks(src)
    expect(findChunk(out, 'cHRM')).toBe(false)
    expect(findChunk(out, 'IDAT')).toBe(true)
  })

  it('非 PNG / 截断数据原样返回', () => {
    const notPng = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(stripPngProfileChunks(notPng)).toBe(notPng)
    const truncated = png([IHDR, ICCP, IDAT, IEND]).subarray(0, 20)
    expect(stripPngProfileChunks(truncated)).toBe(truncated)
  })

  it('块长度字段损坏时原样返回（不死循环）', () => {
    const src = png([IHDR, ICCP, IDAT, IEND])
    // 把 iCCP 的长度改成超大值
    const broken = new Uint8Array(src)
    new DataView(broken.buffer).setUint32(8 + IHDR.length, 0xfffffff0, false)
    expect(stripPngProfileChunks(broken)).toBe(broken)
  })
})

describe('sanitizeImageDisplaySrc', () => {
  const b64 = (bytes: Uint8Array): string => {
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return `data:image/png;base64,${btoa(bin)}`
  }

  it('带冲突块的 PNG data URL 被重建且去掉 iCCP/cHRM', () => {
    const src = b64(png([IHDR, ICCP, CHRM, IDAT, IEND]))
    const out = sanitizeImageDisplaySrc(src)
    expect(out).not.toBe(src)
    expect(out.startsWith('data:image/png;base64,')).toBe(true)
    const bin = atob(out.slice(out.indexOf(',') + 1))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    expect(findChunk(bytes, 'iCCP')).toBe(false)
    expect(findChunk(bytes, 'cHRM')).toBe(false)
    expect(findChunk(bytes, 'IDAT')).toBe(true)
  })

  it('干净 PNG data URL 原样返回', () => {
    const src = b64(png([IHDR, IDAT, IEND]))
    expect(sanitizeImageDisplaySrc(src)).toBe(src)
  })

  it('非 PNG data URL（jpg/svg）原样返回', () => {
    const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
    const svg = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
    expect(sanitizeImageDisplaySrc(jpg)).toBe(jpg)
    expect(sanitizeImageDisplaySrc(svg)).toBe(svg)
  })

  it('非法 base64 原样返回不抛错', () => {
    const bad = 'data:image/png;base64,!!!!not-base64!!!!'
    expect(sanitizeImageDisplaySrc(bad)).toBe(bad)
  })
})
