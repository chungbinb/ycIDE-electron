// 【易语言剪贴板互操作】EClipFormat 私有格式解析 + 占位还原。
// 易语言复制长文本常量时文本形态只给 `<文本长度: N>` 占位（有损），真值在私有格式里（GBK 明文）。
import { describe, it, expect } from 'vitest'
import iconv from 'iconv-lite'
import { parseEClipLongTextConstants, restoreLongTextConstantsInPastedText } from '../../src/main/eclipClipboard'

/** 按逆向出的布局造一份 EClipFormat：魔数 + N 条 [0x10 0x00|名称|0x00|0x00 0x1A|u32 len|正文|0x00] */
function buildEClip(entries: Array<{ name: string; text: string }>, opts: { magic?: string } = {}): Buffer {
  const parts: Buffer[] = [Buffer.from(opts.magic ?? 'CNWTEPRG', 'latin1'), Buffer.alloc(8)]
  for (const { name, text } of entries) {
    const nameBuf = iconv.encode(name, 'gbk')
    const bodyBuf = iconv.encode(text, 'gbk')
    const lenBuf = Buffer.alloc(4)
    lenBuf.writeUInt32LE(bodyBuf.length + 1)
    parts.push(Buffer.from([0x10, 0x00]), nameBuf, Buffer.from([0x00, 0x00, 0x1a]), lenBuf, bodyBuf, Buffer.from([0x00]))
  }
  return Buffer.concat(parts)
}

describe('EClipFormat 解析', () => {
  it('提取长文本常量名与真实内容（含多行/中文/引号）', () => {
    const text = "const s = \"hello, world\"\r\n第二行中文\r\n路径 C:\\dir"
    const buf = buildEClip([{ name: '长文', text }, { name: '空文', text: '' }])
    const got = parseEClipLongTextConstants(buf)
    expect(got['长文']).toBe(text)
    expect(got['空文']).toBe('')
  })

  it('魔数不符时不解析（防误认其它应用的剪贴板数据）', () => {
    const buf = buildEClip([{ name: 'X', text: 'abc' }], { magic: 'OTHERFMT' })
    expect(Object.keys(parseEClipLongTextConstants(buf))).toHaveLength(0)
  })
})

describe('占位还原', () => {
  const longTexts = { 常量2: 'a,b\nc"d', 常量1: '' }

  it('把 .常量 占位还原成 .长文本常量 并转义（长度匹配才替换）', () => {
    const pasted = [
      '.版本 2',
      '',
      '.常量 常量2, "<文本长度: 7>"',
      '.常量 常量1, "<文本长度: 0>"',
      '.常量 普通, "1"',
    ].join('\n')
    const r = restoreLongTextConstantsInPastedText(pasted, longTexts)
    expect(r).not.toBeNull()
    expect(r!.restored).toBe(2)
    const lines = r!.text.split('\n')
    expect(lines[2]).toBe('.长文本常量 常量2, "a,b\\nc\\"d"')
    expect(lines[3]).toBe('.长文本常量 常量1, ""')
    expect(lines[4], '普通常量不动').toBe('.常量 普通, "1"')
  })

  it('长度与声明不符时保留占位（模式撞噪声的安全网）', () => {
    const pasted = '.常量 常量2, "<文本长度: 999>"'
    expect(restoreLongTextConstantsInPastedText(pasted, longTexts)).toBeNull()
  })

  it('私有格式为空时返回 null（按普通文本粘贴）', () => {
    expect(restoreLongTextConstantsInPastedText('.常量 常量2, "<文本长度: 7>"', {})).toBeNull()
  })
})
