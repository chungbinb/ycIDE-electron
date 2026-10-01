import { describe, expect, it } from 'vitest'
import { formatClockTime, formatElapsedMs, OUTPUT_TYPE_LABELS } from '@/utils/outputFormat'

describe('formatClockTime', () => {
  it('按本地时钟输出 HH:MM:SS.mmm 并补零', () => {
    // 本地时区无关：用本地时间构造 Date 再断言，避免 CI 时区差异
    const ts = new Date(2026, 9, 1, 7, 5, 3, 42).getTime()
    expect(formatClockTime(ts)).toBe('07:05:03.042')
  })

  it('毫秒固定三位宽度', () => {
    const ts = new Date(2026, 0, 1, 23, 59, 59, 999).getTime()
    expect(formatClockTime(ts)).toBe('23:59:59.999')
  })
})

describe('formatElapsedMs', () => {
  it('1 秒内显示整毫秒', () => {
    expect(formatElapsedMs(0)).toBe('0ms')
    expect(formatElapsedMs(128)).toBe('128ms')
    expect(formatElapsedMs(999.4)).toBe('999ms')
  })

  it('1 秒及以上显示秒并保留三位小数', () => {
    expect(formatElapsedMs(1000)).toBe('1.000s')
    expect(formatElapsedMs(1250)).toBe('1.250s')
    expect(formatElapsedMs(98500)).toBe('98.500s')
  })

  it('负值/非有限值回落为 0ms（时钟回拨等异常不打断渲染）', () => {
    expect(formatElapsedMs(-5)).toBe('0ms')
    expect(formatElapsedMs(Number.NaN)).toBe('0ms')
  })
})

describe('OUTPUT_TYPE_LABELS', () => {
  it('四种消息类型都有中文标签', () => {
    expect(OUTPUT_TYPE_LABELS.info).toBe('信息')
    expect(OUTPUT_TYPE_LABELS.success).toBe('成功')
    expect(OUTPUT_TYPE_LABELS.error).toBe('错误')
    expect(OUTPUT_TYPE_LABELS.warning).toBe('警告')
  })
})
