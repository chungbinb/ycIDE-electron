/**
 * 易语言剪贴板私有格式 EClipFormat 的长文本常量提取。
 *
 * 背景：易语言把长文本常量的**真实内容**存在 .ec 二进制里，复制到剪贴板时——
 * 文本格式(CF_UNICODETEXT)只给占位 `.常量 名, "<文本长度: N>"`（有损），
 * 真值走 `RegisterClipboardFormat("EClipFormat")` 注册的私有格式（明文，GBK 编码）。
 * 直接粘贴文本形态会丢内容，故在此解析私有格式补回。
 *
 * 记录布局（逆向自易语言 v5 样本，魔数 CNWTEPRG）：
 *   0x10 0x00 | 名称(GBK) | 0x00 | 0x00 0x1A | u32 字节数(含结尾NUL) | 正文(GBK) | 0x00
 *                                      ↑ 0x1A = 长文本类型标记
 *
 * 稳健性：逆向仅基于有限样本，故**必须**由调用方用文本形态里的 `<文本长度: N>` 交叉校验
 * 字符数，不匹配即丢弃该条——即使模式撞上噪声也不会污染用户代码。
 */
import iconv from 'iconv-lite'

const ECLIP_MAGIC = Buffer.from('CNWTEPRG', 'latin1')
const RECORD_MARK_LO = 0x10
const RECORD_MARK_HI = 0x00
const TYPE_LONG_TEXT = 0x1a
const MAX_NAME_BYTES = 128
const MAX_BODY_BYTES = 64 * 1024 * 1024

/** 从 EClipFormat 原始字节提取「长文本常量名 → 真实内容」 */
export function parseEClipLongTextConstants(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {}
  if (!buf || buf.length < 16 || !buf.subarray(0, 8).equals(ECLIP_MAGIC)) return out

  for (let i = 0; i + 12 < buf.length; i++) {
    if (buf[i] !== RECORD_MARK_LO || buf[i + 1] !== RECORD_MARK_HI) continue
    const nameStart = i + 2
    const nameEnd = buf.indexOf(0, nameStart)
    if (nameEnd < 0 || nameEnd === nameStart || nameEnd - nameStart > MAX_NAME_BYTES) continue
    // 名称 NUL 之后必须是类型标记 0x00 0x1A（长文本），否则不是长文本常量记录
    if (buf[nameEnd + 1] !== 0x00 || buf[nameEnd + 2] !== TYPE_LONG_TEXT) continue
    const lenPos = nameEnd + 3
    if (lenPos + 4 > buf.length) continue
    const byteLen = buf.readUInt32LE(lenPos)
    if (byteLen < 1 || byteLen > MAX_BODY_BYTES) continue
    const bodyStart = lenPos + 4
    const bodyLen = byteLen - 1
    if (bodyStart + bodyLen > buf.length) continue

    const name = iconv.decode(buf.subarray(nameStart, nameEnd), 'gbk').trim()
    if (!name) continue
    out[name] = bodyLen > 0 ? iconv.decode(buf.subarray(bodyStart, bodyStart + bodyLen), 'gbk') : ''
  }
  return out
}

/** 长文本常量值的行内转义（与 renderer/eycBlocks 的 escapeLongTextValue 保持一致） */
function escapeLongText(text: string): string {
  return (text || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
}

/**
 * 把易语言粘贴文本里的占位 `.常量 名, "<文本长度: N>"` 还原成 ycIDE 的
 * `.长文本常量 名, "转义真值"`。仅当私有格式里有同名条目**且字符数与 N 相等**才替换。
 * 返回 null 表示无可还原内容（调用方按普通文本粘贴）。
 */
export function restoreLongTextConstantsInPastedText(
  pastedText: string,
  longTexts: Record<string, string>,
): { text: string; restored: number } | null {
  if (!pastedText || !longTexts || Object.keys(longTexts).length === 0) return null
  const placeholder = /^(\s*)\.常量\s+([^,，]+)[,，]\s*["“]<文本长度:\s*(\d+)>["”]\s*(.*)$/
  let restored = 0
  const lines = pastedText.split('\n').map(line => {
    const m = line.replace(/\r$/, '').match(placeholder)
    if (!m) return line
    const [, indent, rawName, lenStr, tail] = m
    const name = rawName.trim()
    const real = longTexts[name]
    if (real === undefined || real.length !== Number(lenStr)) return line   // 长度不符：不替换，宁可保留占位
    restored++
    const suffix = tail.trim() ? `, ${tail.trim()}` : ''
    return `${indent}.长文本常量 ${name}, "${escapeLongText(real)}"${suffix}`
  })
  return restored > 0 ? { text: lines.join('\n'), restored } : null
}
