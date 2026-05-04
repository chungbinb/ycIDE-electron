import iconv from 'iconv-lite'

const MAGIC_FILE_HEADER_1 = 1415007811
const MAGIC_FILE_HEADER_2 = 1196576837
const MAGIC_SECTION = 353465113
const SECTION_INFO_LENGTH = 92
const END_SECTION_KEY = 0x07007319

export type NativeSectionSnapshot = {
  key: number
  name: string
  optional: boolean
  dataLength: number
  data: Uint8Array
}

export type NativeProjectSnapshot = {
  sections: NativeSectionSnapshot[]
  hasProgramSection: boolean
  hasResourceSection: boolean
  compileVersion?: string
  fileType?: number
  projectType?: number
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

function readI32(bytes: Uint8Array, offset: number): number {
  return readU32(bytes, offset) | 0
}

function readI16(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset] | (bytes[offset + 1] << 8)
  return value & 0x8000 ? value - 0x10000 : value
}

function decodeSectionName(key: number, encodedName: Uint8Array): string {
  const nameBytes = new Uint8Array(encodedName)
  if (key !== END_SECTION_KEY) {
    const keyBytes = Uint8Array.from([key & 0xff, (key >>> 8) & 0xff, (key >>> 16) & 0xff, (key >>> 24) & 0xff])
    for (let index = 0; index < nameBytes.length; index += 1) {
      nameBytes[index] ^= keyBytes[(index + 1) % 4]
    }
  }
  const nullIndex = nameBytes.indexOf(0)
  const sliced = nullIndex >= 0 ? nameBytes.slice(0, nullIndex) : nameBytes
  return iconv.decode(Buffer.from(sliced), 'gbk').trim()
}

export function parseNativeProjectSnapshot(bytes: Uint8Array): NativeProjectSnapshot {
  if (bytes.length < 8 || readU32(bytes, 0) !== MAGIC_FILE_HEADER_1 || readU32(bytes, 4) !== MAGIC_FILE_HEADER_2) {
    throw new Error('不是有效的易语言工程文件。')
  }

  const sections: NativeSectionSnapshot[] = []
  let hasProgramSection = false
  let hasResourceSection = false
  let compileVersion: string | undefined
  let fileType: number | undefined
  let projectType: number | undefined
  let offset = 8
  while (offset < bytes.length) {
    if (bytes.length - offset < 8 + SECTION_INFO_LENGTH) break
    const magic = readU32(bytes, offset)
    if (magic !== MAGIC_SECTION) throw new Error('工程段 Magic 错误。')
    const infoOffset = offset + 8
    const key = readU32(bytes, infoOffset)
    const name = decodeSectionName(key, bytes.slice(infoOffset + 4, infoOffset + 34))
    const optional = readI32(bytes, infoOffset + 40) !== 0
    const dataLength = readI32(bytes, infoOffset + 48)
    if (dataLength < 0) throw new Error('工程段长度无效。')
    const dataOffset = infoOffset + SECTION_INFO_LENGTH
    if (bytes.length - dataOffset < dataLength) throw new Error('工程段数据不完整。')
    if (key === END_SECTION_KEY) break

    if (name === '系统信息段' && dataLength >= 4) {
      compileVersion = `${readI16(bytes, dataOffset)}.${readI16(bytes, dataOffset + 2)}`
      if (dataLength >= 28) {
        fileType = readI32(bytes, dataOffset + 16)
        projectType = readI32(bytes, dataOffset + 24)
      }
    }
    if (name === '程序段') hasProgramSection = true
    if (name === '程序资源段') hasResourceSection = true
    sections.push({ key, name, optional, dataLength, data: bytes.slice(dataOffset, dataOffset + dataLength) })
    offset = dataOffset + dataLength
  }

  if (sections.length === 0) throw new Error('未找到可读取的易语言工程段。')
  return { sections, hasProgramSection, hasResourceSection, compileVersion, fileType, projectType }
}
