import { createHash } from 'crypto'
import iconv from 'iconv-lite'

const MAGIC_ENCRYPTED_SOURCE = 1162630231
const MAGIC_ENCRYPTED_SOURCE_TYPE_ESTD = 0x00000001
const MAGIC_ENCRYPTED_SOURCE_TYPE_EC = 0x00020001
const MAGIC_FILE_HEADER_1 = 1415007811
const MAGIC_FILE_HEADER_2 = 1196576837
const ENCRYPTED_SECRET_ID_LENGTH = 32
const CRYPTO_BLOCK_LENGTH = 4096

const EC_DEFAULT_INITIAL_STATUS = Uint8Array.from([
  0xF0, 0x5E, 0x99, 0xA1, 0x88, 0xE3, 0x1E, 0xEE, 0x11, 0x9E, 0xC9, 0x97, 0x1B, 0x90, 0x4F, 0x7C,
  0x52, 0xCB, 0x82, 0xFA, 0x27, 0xDE, 0xF6, 0xA8, 0xDA, 0xD3, 0xB0, 0xCF, 0x56, 0xD6, 0x85, 0x42,
  0x1A, 0x9C, 0xB5, 0x0E, 0xB8, 0xED, 0x10, 0x1C, 0x24, 0x6A, 0x69, 0xCE, 0x87, 0x55, 0x1F, 0x96,
  0x6C, 0x7B, 0xBA, 0x65, 0x14, 0xAA, 0x2C, 0xDD, 0xA3, 0xB6, 0x7D, 0x63, 0xF5, 0xE9, 0x8E, 0x20,
  0x41, 0x23, 0x78, 0x8C, 0xFC, 0x22, 0x9F, 0xA6, 0xB4, 0x6F, 0xA7, 0x77, 0x59, 0xC0, 0xBF, 0x3A,
  0x30, 0xA2, 0x15, 0x2A, 0x53, 0x5D, 0x74, 0x4D, 0x93, 0xFB, 0xF7, 0x40, 0x73, 0x28, 0x6E, 0x76,
  0xD5, 0xB1, 0x2D, 0x95, 0x70, 0xF4, 0x3C, 0x34, 0xE5, 0x4C, 0x5B, 0xBB, 0x5F, 0x50, 0x58, 0x8D,
  0x6B, 0xB7, 0x61, 0x09, 0xF2, 0x48, 0xCA, 0x81, 0x37, 0x45, 0xEF, 0xD0, 0xBE, 0xD9, 0xD4, 0xE7,
  0x9D, 0x33, 0x91, 0x71, 0x2F, 0x3B, 0xE6, 0x0D, 0xFE, 0x79, 0x49, 0x67, 0x19, 0xA5, 0x08, 0xAF,
  0x80, 0xB2, 0xEB, 0x3E, 0xD2, 0xB9, 0xD1, 0x44, 0x57, 0x8F, 0x8A, 0x4B, 0x39, 0xF1, 0x66, 0xEA,
  0xE2, 0xDF, 0xF3, 0x7A, 0x98, 0xCD, 0xAB, 0x8B, 0x04, 0x62, 0x54, 0x16, 0x12, 0x43, 0x02, 0xD8,
  0x36, 0x72, 0x06, 0x7F, 0x25, 0xE0, 0x2E, 0x05, 0x0F, 0xFF, 0xAD, 0x03, 0x07, 0xE1, 0x94, 0x17,
  0xC1, 0x32, 0xC3, 0x51, 0xD7, 0xDB, 0xE8, 0xE4, 0x75, 0x3F, 0x01, 0x26, 0x4A, 0x29, 0x64, 0x47,
  0x86, 0x3D, 0xBD, 0xDC, 0x83, 0x2B, 0x68, 0x1D, 0x46, 0xEC, 0xC4, 0x9A, 0xC8, 0x31, 0x4E, 0xA9,
  0xA4, 0x35, 0x9B, 0xAC, 0x5C, 0x0B, 0x92, 0xCC, 0x0A, 0x84, 0x13, 0x0C, 0x00, 0xA0, 0xB3, 0x60,
  0x18, 0x5A, 0xC5, 0xC6, 0x89, 0x7E, 0x21, 0xF9, 0xC2, 0x6D, 0xBC, 0xC7, 0xAE, 0x38, 0xFD, 0xF8,
])

type EncryptedSourceInfo = {
  encrypted: boolean
  type: number
  cryptEc: boolean
  overtLength: number
  passwordHint?: string
}

export class EProjectCryptoError extends Error {
  constructor(public readonly code: string, message = code, public readonly passwordHint?: string) {
    super(message)
  }
}

class Rc4Crypto {
  private readonly status: Uint8Array
  private i = 0
  private j = 0

  constructor(key: Uint8Array | null, initialStatus: number | Uint8Array) {
    if (typeof initialStatus === 'number') {
      this.status = new Uint8Array(initialStatus)
      for (let index = 0; index < initialStatus; index += 1) this.status[index] = index & 0xff
    } else {
      this.status = new Uint8Array(initialStatus)
    }
    this.emitKey(key)
  }

  state(): Uint8Array {
    return new Uint8Array(this.status)
  }

  fill(length: number): Uint8Array {
    const bytes = new Uint8Array(length)
    this.apply(bytes, 0, length)
    return bytes
  }

  skip(length: number): void {
    for (let offset = 0; offset < length; offset += 1) this.nextByte()
  }

  apply(bytes: Uint8Array, start = 0, length = bytes.length - start): void {
    const end = start + length
    for (let offset = start; offset < end; offset += 1) {
      bytes[offset] ^= this.nextByte()
    }
  }

  private emitKey(key: Uint8Array | null): void {
    if (!key || key.length === 0) return
    let p2 = 0
    for (let p1 = 0; p1 < this.status.length; p1 += 1) {
      p2 = (p2 + this.status[p1] + key[p1 % key.length]) % this.status.length
      const tmp = this.status[p2]
      this.status[p2] = this.status[p1]
      this.status[p1] = tmp
    }
  }

  private nextByte(): number {
    this.i = (this.i + 1) % this.status.length
    this.j = (this.j + this.status[this.i]) % this.status.length
    const tmp = this.status[this.j]
    this.status[this.j] = this.status[this.i]
    this.status[this.i] = tmp
    return this.status[(this.status[this.i] + this.status[this.j]) % this.status.length]
  }
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

function buildReversedMd5Text(hash: Uint8Array): Uint8Array {
  let text = ''
  for (let index = hash.length - 1; index >= 0; index -= 1) {
    text += hash[index].toString(16).padStart(2, '0')
  }
  return Uint8Array.from(Buffer.from(text, 'ascii'))
}

function buildEncryptedSecretId(password: string, cryptEc: boolean): { secretId: Uint8Array; iv: Uint8Array } {
  const passwordBytes = Uint8Array.from(iconv.encode(password, 'gbk'))
  const hash = Uint8Array.from(createHash('md5').update(passwordBytes).digest())
  if (cryptEc) {
    const low4bit7 = hash[7] & 0x0f
    const high4bit7 = hash[7] & 0xf0
    const low4bit8 = hash[8] & 0x0f
    const high4bit8 = hash[8] & 0xf0
    hash[7] = high4bit7 | (high4bit8 >> 4)
    hash[8] = (low4bit7 << 4) | low4bit8
  }
  const ivBuilder = new Rc4Crypto(passwordBytes, cryptEc ? EC_DEFAULT_INITIAL_STATUS : 256)
  return { secretId: buildReversedMd5Text(hash), iv: ivBuilder.state() }
}

export function parseEncryptedSourceInfo(inputBytes: Uint8Array): EncryptedSourceInfo {
  if (inputBytes.length < 8 || readU32(inputBytes, 0) !== MAGIC_ENCRYPTED_SOURCE) {
    return { encrypted: false, type: 0, cryptEc: false, overtLength: 0 }
  }

  const type = readU32(inputBytes, 4)
  if (type === MAGIC_ENCRYPTED_SOURCE_TYPE_ESTD) {
    return { encrypted: true, type, cryptEc: false, overtLength: 8 }
  }
  if (type === MAGIC_ENCRYPTED_SOURCE_TYPE_EC) {
    if (inputBytes.length < 12) throw new EProjectCryptoError('encrypted_source_header_truncated')
    const hintLength = readU32(inputBytes, 8)
    const overtLength = 12 + hintLength
    if (inputBytes.length < overtLength) throw new EProjectCryptoError('encrypted_source_hint_truncated')
    const passwordHint = iconv.decode(Buffer.from(inputBytes.slice(12, overtLength)), 'gbk')
    return { encrypted: true, type, cryptEc: true, overtLength, passwordHint }
  }

  throw new EProjectCryptoError('encrypted_source_type_unsupported', `不支持此类加密文件 [Type=0x${type.toString(16).padStart(8, '0')}]`)
}

function applyEStdTransform(bytes: Uint8Array, overtLength: number, secretId: Uint8Array, iv: Uint8Array): void {
  const keyTable = new Rc4Crypto(null, iv)
  let remainedOvert = overtLength
  let blockIndex = 0
  for (let offset = 0; offset < bytes.length; offset += CRYPTO_BLOCK_LENGTH) {
    const blockLength = Math.min(CRYPTO_BLOCK_LENGTH, bytes.length - offset)
    const blockKey = new Uint8Array(40)
    blockKey.set(keyTable.fill(4), 0)
    const prefix = readU32(blockKey, 0)
    const suffix = (prefix ^ blockIndex) >>> 0
    blockIndex += 1
    blockKey.set(secretId, 4)
    writeU32(blockKey, 36, suffix)
    const blockCrypto = new Rc4Crypto(blockKey, 256)
    blockCrypto.skip(36)
    if (blockLength > remainedOvert) {
      blockCrypto.skip(remainedOvert)
      blockCrypto.apply(bytes, offset + remainedOvert, blockLength - remainedOvert)
      remainedOvert = 0
    } else {
      remainedOvert -= blockLength
    }
  }
}

function applyEcTransform(bytes: Uint8Array, overtLength: number, secretId: Uint8Array, iv: Uint8Array): void {
  const keyTable = new Rc4Crypto(null, iv)
  let remainedOvert = overtLength
  for (let offset = 0; offset < bytes.length; offset += CRYPTO_BLOCK_LENGTH) {
    const blockLength = Math.min(CRYPTO_BLOCK_LENGTH, bytes.length - offset)
    const blockKey = new Uint8Array(40)
    blockKey.set(keyTable.fill(8), 0)
    blockKey.set(secretId, 8)
    const blockCrypto = new Rc4Crypto(blockKey, EC_DEFAULT_INITIAL_STATUS)
    if (blockLength > remainedOvert) {
      blockCrypto.skip(remainedOvert)
      blockCrypto.apply(bytes, offset + remainedOvert, blockLength - remainedOvert)
      remainedOvert = 0
    } else {
      remainedOvert -= blockLength
    }
  }
}

function normalizeEcDecryptedModuleBytes(bytes: Uint8Array): void {
  if (bytes.length < 8 || readU32(bytes, 0) !== MAGIC_FILE_HEADER_1 || readU32(bytes, 4) !== MAGIC_FILE_HEADER_2) {
    throw new EProjectCryptoError('encrypted_source_body_header_invalid')
  }
  let offset = 8
  while (offset < bytes.length) {
    if (bytes.length - offset < 100) throw new EProjectCryptoError('encrypted_source_section_truncated')
    const magic = readU32(bytes, offset)
    if (magic !== 353465113) throw new EProjectCryptoError('encrypted_source_section_header_invalid')
    const dataLengthOffset = offset + 8 + 4 + 30 + 2 + 4 + 4 + 4
    const dataLength = (readU32(bytes, dataLengthOffset) ^ 1) >>> 0
    writeU32(bytes, dataLengthOffset, dataLength)
    const sectionLength = 8 + 92 + dataLength
    if (bytes.length - offset < sectionLength) throw new EProjectCryptoError('encrypted_source_section_body_truncated')
    offset += sectionLength
  }
}

export function decodeEncryptedSourceBytes(inputBytes: Uint8Array, password?: string): Uint8Array {
  const encryptedInfo = parseEncryptedSourceInfo(inputBytes)
  if (!encryptedInfo.encrypted) return inputBytes
  if (!password) {
    throw new EProjectCryptoError('encrypted_source_password_required', '需要输入加密项目密码。', encryptedInfo.passwordHint)
  }

  const { secretId, iv } = buildEncryptedSecretId(password, encryptedInfo.cryptEc)
  const decryptedBytes = new Uint8Array(inputBytes)
  if (encryptedInfo.cryptEc) {
    applyEcTransform(decryptedBytes, encryptedInfo.overtLength, secretId, iv)
  } else {
    applyEStdTransform(decryptedBytes, encryptedInfo.overtLength, secretId, iv)
  }

  const secretOffset = encryptedInfo.overtLength
  if (decryptedBytes.length < secretOffset + ENCRYPTED_SECRET_ID_LENGTH + 8) {
    throw new EProjectCryptoError('encrypted_source_body_too_small')
  }
  for (let index = 0; index < secretId.length; index += 1) {
    if (decryptedBytes[secretOffset + index] !== secretId[index]) {
      throw new EProjectCryptoError('encrypted_source_password_invalid', '密码错误。', encryptedInfo.passwordHint)
    }
  }

  const outBytes = decryptedBytes.slice(secretOffset + ENCRYPTED_SECRET_ID_LENGTH)
  if (encryptedInfo.cryptEc) normalizeEcDecryptedModuleBytes(outBytes)
  if (outBytes.length < 8 || readU32(outBytes, 0) !== MAGIC_FILE_HEADER_1 || readU32(outBytes, 4) !== MAGIC_FILE_HEADER_2) {
    throw new EProjectCryptoError('encrypted_source_body_header_invalid')
  }
  return outBytes
}
