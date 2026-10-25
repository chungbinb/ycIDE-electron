// Ed25519 签名校验（商店插件包、商店索引共用；设计稿 §8.2）。
// 公钥格式：SPKI DER 的 base64（scripts/plugin-pack.mjs keygen 生成）。

import { createPublicKey, verify } from 'node:crypto'

/**
 * 官方商店索引公钥。官方商店上线时把公钥填在这里（同时可在设置里追加自建商店的公钥）；
 * 列表为空且设置里也没填时不校验索引签名，索引完整性只靠 HTTPS。
 */
export const OFFICIAL_STORE_INDEX_KEYS: readonly string[] = []

export function verifyEd25519(data: Buffer, signatureBase64: string, publicKeyBase64: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyBase64.trim(), 'base64'), format: 'der', type: 'spki' })
    if (key.asymmetricKeyType !== 'ed25519') return false
    return verify(null, data, key, Buffer.from(signatureBase64.trim(), 'base64'))
  } catch {
    return false
  }
}
