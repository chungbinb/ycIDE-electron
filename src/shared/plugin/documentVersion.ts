// 文档版本号（设计稿 §5.1）：由文档内容算出，内容变了版本号就变。
// 插件读文档时拿到 version，提交修改时带上；文档在此期间被改过（版本不符）返回 -33002，插件重新读取后再改。

/** 版本过期错误码（设计稿 §4.3） */
export const DOCUMENT_VERSION_STALE = -33002

/** FNV-1a 32 位哈希 + 长度：足以发现两次读取之间的修改，不需要密码学强度 */
export function documentVersion(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${text.length.toString(36)}-${hash.toString(36)}`
}
