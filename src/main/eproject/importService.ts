import { basename, dirname, extname, join, resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import type { EProjectImportRequest, EProjectImportResult } from '../../shared/eprojectImport'
import { decodeEncryptedSourceBytes, EProjectCryptoError } from './crypto'
import { parseNativeProjectSnapshot } from './sections'
import { writeImportedProject } from './ycProjectWriter'

export function getEProjectImportTarget(eFilePath: string): { projectName: string; targetDir: string; targetExists: boolean } {
  // basename(path, ext) 的扩展名剥离区分大小写：对 "工程.E" 传小写 ".e" 剥不掉，
  // projectName 会带上扩展名，导致 targetDir 恰好等于源文件本身（覆盖导入时删源文件）。
  const rawBase = basename(eFilePath)
  const sourceExt = extname(eFilePath)
  const projectName = sourceExt ? rawBase.slice(0, -sourceExt.length) : rawBase
  const targetDir = join(dirname(eFilePath), projectName)
  return { projectName, targetDir, targetExists: existsSync(targetDir) }
}

export function importEProjectFile(request: EProjectImportRequest): EProjectImportResult {
  const sourceExt = extname(request.eFilePath).toLowerCase()
  if (sourceExt !== '.e' && sourceExt !== '.ec') {
    return { status: 'error', code: 'invalidProjectFile', message: '仅支持导入 .e 或 .ec 文件。' }
  }

  const target = getEProjectImportTarget(request.eFilePath)
  // 双保险：目标目录绝不允许与源文件重合（覆盖导入会先递归删除目标）
  if (resolve(target.targetDir) === resolve(request.eFilePath)) {
    return { status: 'error', code: 'invalidProjectFile', message: '导入目标目录与源文件路径重合，已中止以保护源文件。' }
  }
  if (target.targetExists && !request.conflictAction) {
    return { status: 'targetConflict', eFilePath: request.eFilePath, projectName: target.projectName, targetDir: target.targetDir }
  }

  try {
    const rawBytes = Uint8Array.from(readFileSync(request.eFilePath))
    const decodedBytes = decodeEncryptedSourceBytes(rawBytes, request.password)
    const snapshot = parseNativeProjectSnapshot(decodedBytes)
    const written = writeImportedProject({
      eFilePath: request.eFilePath,
      projectDir: target.targetDir,
      projectName: target.projectName,
      conflictAction: request.conflictAction,
      snapshot,
    })
    return { status: 'success', ...written }
  } catch (error) {
    if (error instanceof EProjectCryptoError) {
      if (error.code === 'encrypted_source_password_required') {
        return { status: 'passwordRequired', passwordHint: error.passwordHint }
      }
      if (error.code === 'encrypted_source_password_invalid') {
        return { status: 'passwordInvalid', passwordHint: error.passwordHint }
      }
      if (error.code === 'encrypted_source_type_unsupported') {
        return { status: 'error', code: 'unsupportedEncryptedType', message: error.message }
      }
      return { status: 'error', code: 'invalidProjectFile', message: error.message }
    }
    if (error instanceof Error && error.message === 'targetConflict') {
      return { status: 'targetConflict', eFilePath: request.eFilePath, projectName: target.projectName, targetDir: target.targetDir }
    }
    return { status: 'error', code: 'conversionFailed', message: error instanceof Error ? error.message : String(error) }
  }
}
