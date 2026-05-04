import { basename, extname, join } from 'path'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import type { EProjectImportConflictAction } from '../../shared/eprojectImport'
import type { NativeProjectSnapshot } from './sections'
import {
  classToText,
  constantsToText,
  createNameResolver,
  dllDeclaresToText,
  globalsToText,
  parseNativeProject,
  safeFileName,
  structsToText,
} from './nativeProject'

export type ImportedProjectWriteOptions = {
  eFilePath: string
  projectDir: string
  projectName: string
  conflictAction?: EProjectImportConflictAction
  snapshot: NativeProjectSnapshot
}

function sanitizeFileStem(stem: string): string {
  const normalized = (stem || '').trim().replace(/^\.+/, '')
  const replaced = normalized.replace(/[<>:"/\\|?*]/g, '_')
  return replaced || '模块'
}

function buildImportSummary(options: ImportedProjectWriteOptions): string {
  const sourceName = basename(options.eFilePath)
  const lines = [
    '.版本 2',
    `.程序集 ${sanitizeFileStem(options.projectName)}_导入说明`,
    '',
    `.备注 已从 ${sourceName} 通过 ycIDE 纯 TS/JS 导入服务读取。`,
    `.备注 编译版本: ${options.snapshot.compileVersion || '未知'}`,
    `.备注 原生工程段数量: ${options.snapshot.sections.length}`,
    `.备注 程序段: ${options.snapshot.hasProgramSection ? '已检测到' : '未检测到'}`,
    `.备注 资源段: ${options.snapshot.hasResourceSection ? '已检测到' : '未检测到'}`,
    '',
    '.子程序 _导入占位入口',
    '    返回 ()',
    '',
  ]
  return `${lines.join('\n')}\n`
}

function buildSectionReport(snapshot: NativeProjectSnapshot): string {
  const lines = ['.版本 2', '.备注 原生工程段清单', '']
  snapshot.sections.forEach((section, index) => {
    lines.push(`.备注 ${index + 1}. ${section.name} Key=0x${section.key.toString(16).padStart(8, '0')} Length=${section.dataLength} Optional=${section.optional ? '是' : '否'}`)
  })
  lines.push('')
  return `${lines.join('\n')}\n`
}

function writeTextFile(filePath: string, content: string): void {
  writeFileSync(filePath, content.replace(/\n/g, '\r\n'), 'utf-8')
}

function inferOutputType(snapshot: NativeProjectSnapshot): 'WindowsApp' | 'Console' | 'DynamicLibrary' {
  if (snapshot.fileType === 3) return 'DynamicLibrary'
  if (snapshot.projectType === 2) return 'DynamicLibrary'
  return snapshot.hasResourceSection ? 'WindowsApp' : 'Console'
}

export function writeImportedProject(options: ImportedProjectWriteOptions): { projectDir: string; eppPath: string; warnings: string[] } {
  const warnings: string[] = []
  if (existsSync(options.projectDir)) {
    if (!options.conflictAction) {
      throw new Error('targetConflict')
    }
    if (options.conflictAction === 'overwrite') {
      rmSync(options.projectDir, { recursive: true, force: true })
    }
  }

  mkdirSync(options.projectDir, { recursive: true })
  mkdirSync(join(options.projectDir, 'logs'), { recursive: true })
  mkdirSync(join(options.projectDir, 'output'), { recursive: true })
  mkdirSync(join(options.projectDir, 'temp'), { recursive: true })

  const sourceExt = extname(options.eFilePath).toLowerCase()
  const safeProjectName = sanitizeFileStem(options.projectName)
  const parsedProject = parseNativeProject(options.snapshot, sourceExt === '.ec')
  const resolveName = createNameResolver(parsedProject)
  const files: string[] = []

  for (const klass of parsedProject.classes) {
    const fileName = `${safeFileName(resolveName(klass.id), `程序集_${klass.id.toString(16)}`)}.eyc`
    writeTextFile(join(options.projectDir, fileName), classToText(klass, parsedProject.methods, resolveName, parsedProject.supportLibraries))
    files.push(`File=EYC|${fileName}|1`)
  }

  if (parsedProject.globalVariables.length > 0) {
    const fileName = '全局变量.egv'
    writeTextFile(join(options.projectDir, fileName), globalsToText(parsedProject.globalVariables, resolveName))
    files.push(`File=EGV|${fileName}|1`)
  }

  const constants = parsedProject.constants.filter(constant => !constant.resourceKind)
  if (constants.length > 0) {
    const fileName = '常量.ecs'
    writeTextFile(join(options.projectDir, fileName), constantsToText(constants, resolveName))
    files.push(`File=ECS|${fileName}|1`)
  }

  if (parsedProject.structs.length > 0) {
    const fileName = '自定义数据类型.edt'
    writeTextFile(join(options.projectDir, fileName), structsToText(parsedProject.structs, resolveName))
    files.push(`File=EDT|${fileName}|1`)
  }

  if (parsedProject.dllDeclares.length > 0) {
    const fileName = 'DLL命令.ell'
    writeTextFile(join(options.projectDir, fileName), dllDeclaresToText(parsedProject.dllDeclares, resolveName))
    files.push(`File=ELL|${fileName}|1`)
  }

  for (const resource of parsedProject.constants.filter(constant => constant.resourceKind && constant.resourceBytes)) {
    const resourceKind = resource.resourceKind || 'resource'
    const extension = resourceKind === 'image' ? '.bin' : '.bin'
    const fileName = `资源_${safeFileName(resolveName(resource.id), resourceKind)}${extension}`
    writeFileSync(join(options.projectDir, fileName), Buffer.from(resource.resourceBytes!))
    files.push(`File=RES|${fileName}|0`)
  }

  if (files.length === 0) {
    const summaryFileName = `${safeProjectName}_导入说明.eyc`
    writeTextFile(join(options.projectDir, summaryFileName), buildImportSummary(options))
    files.push(`File=EYC|${summaryFileName}|1`)
    warnings.push('未能从原生工程段解析出可写入的源码结构，已生成导入说明。')
  }

  const reportFileName = '原生工程段清单.erc'
  writeTextFile(join(options.projectDir, reportFileName), buildSectionReport(options.snapshot))
  warnings.push(...parsedProject.warnings)
  warnings.push('已完成纯 TS/JS 原生工程结构与子程序语句导入；暂未识别的支持库命令会以 _LibXCmdY 形式保留。')
  if (sourceExt === '.ec') {
    warnings.push('.ec 模块已按原生段读取导入；模块桥接为完整 .e 源码视图仍需继续移植。')
  }

  const eppPath = join(options.projectDir, `${safeProjectName}.epp`)
  const eppLines = [
    '# YiCode Project File',
    'Version=1',
    `ProjectName=${safeProjectName}`,
    `OutputType=${inferOutputType(options.snapshot)}`,
    'Platform=x64',
    '',
    ...files,
    `File=ERC|${reportFileName}|0`,
  ]
  writeFileSync(eppPath, eppLines.join('\n'), 'utf-8')
  return { projectDir: options.projectDir, eppPath, warnings }
}
