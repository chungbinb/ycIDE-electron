// 解压商店下载的压缩包时的安全检查：防路径穿越、防解压炸弹（支持库与插件安装共用）。

import AdmZip from 'adm-zip'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, normalize, resolve, sep } from 'node:path'

export const MAX_ZIP_ENTRIES = 5000
export const MAX_ZIP_TOTAL_BYTES = 200 * 1024 * 1024

export function assertSafeZipEntry(entryName: string): string {
  const normalized = normalize(entryName.replace(/\\/g, '/')).replace(/\\/g, '/')
  if (!normalized || normalized === '.' || isAbsolute(normalized) || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`zip 内含不安全路径: ${entryName}`)
  }
  return normalized
}

/** 把 zip 解压到 targetDir（应为新建的空目录），返回解压出的相对路径列表 */
export function extractZipSafely(buffer: Buffer, targetDir: string): string[] {
  const zip = new AdmZip(buffer)
  const entries = zip.getEntries()
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error(`zip 条目过多（${entries.length} > ${MAX_ZIP_ENTRIES}），疑似恶意压缩包`)
  }
  const root = resolve(targetDir)
  const files: string[] = []
  let total = 0
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const relativePath = assertSafeZipEntry(entry.entryName)
    const outputPath = resolve(root, relativePath)
    if (!outputPath.startsWith(root + sep)) throw new Error(`zip 内含越界路径: ${entry.entryName}`)
    const data = entry.getData()
    total += data.length
    if (total > MAX_ZIP_TOTAL_BYTES) {
      throw new Error(`zip 解压总大小超过限制（${Math.round(MAX_ZIP_TOTAL_BYTES / 1024 / 1024)}MB），疑似恶意压缩包`)
    }
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, data)
    files.push(relativePath)
  }
  return files.sort((a, b) => a.localeCompare(b))
}
