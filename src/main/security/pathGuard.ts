import { resolve, relative, isAbsolute, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'

/**
 * IPC 路径白名单守卫。
 *
 * 渲染进程通过 IPC 传入的文件路径必须落在已授权目录内：
 * - 静态根：userData、默认项目目录、themes 目录（应用启动时注册）
 * - 动态根：用户通过系统对话框选择的目录（选择时注册，并持久化到 userData，
 *   保证重启后「最近打开」恢复项目的流程不被白名单误伤）
 *
 * 这是面向未来插件系统的纵深防御：当前渲染层是第一方代码，
 * 但插件落地后渲染进程不再完全可信，路径校验必须由主进程兜底。
 */

const MAX_PERSISTED_ROOTS = 100

let staticRoots: string[] = []
let dynamicRoots: string[] = []
let persistFilePath: string | null = null

function normalizeRoot(p: string): string {
  return resolve(p)
}

/** Windows 路径比较不区分大小写 */
function sameOrInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  if (rel === '') return true
  return !rel.startsWith('..') && !isAbsolute(rel)
}

function loadPersistedRoots(): string[] {
  if (!persistFilePath || !existsSync(persistFilePath)) return []
  try {
    const raw = JSON.parse(readFileSync(persistFilePath, 'utf-8'))
    if (!Array.isArray(raw)) return []
    return raw.filter((item): item is string => typeof item === 'string' && item.length > 0).map(normalizeRoot)
  } catch {
    return []
  }
}

function persistDynamicRoots(): void {
  if (!persistFilePath) return
  try {
    writeFileSync(persistFilePath, JSON.stringify(dynamicRoots, null, 2), 'utf-8')
  } catch {
    // 持久化失败不影响本次会话的授权
  }
}

/** 应用启动时调用一次。persistFile 传 userData 下的 JSON 路径。 */
export function initPathGuard(roots: string[], persistFile?: string): void {
  staticRoots = roots.filter(Boolean).map(normalizeRoot)
  persistFilePath = persistFile || null
  dynamicRoots = loadPersistedRoots()
}

/** 用户通过系统对话框选择了路径时调用：授权该目录（文件则授权其父目录）。 */
export function authorizeRoot(dirOrFilePath: string, kind: 'dir' | 'file' = 'dir'): void {
  if (!dirOrFilePath || typeof dirOrFilePath !== 'string') return
  const root = normalizeRoot(kind === 'file' ? dirname(dirOrFilePath) : dirOrFilePath)
  if (staticRoots.some(r => sameOrInside(r, root))) return
  const existingIdx = dynamicRoots.findIndex(r => r.toLowerCase() === root.toLowerCase())
  if (existingIdx >= 0) {
    // LRU：移到末尾
    dynamicRoots.splice(existingIdx, 1)
  }
  dynamicRoots.push(root)
  if (dynamicRoots.length > MAX_PERSISTED_ROOTS) {
    dynamicRoots = dynamicRoots.slice(-MAX_PERSISTED_ROOTS)
  }
  persistDynamicRoots()
}

export function isPathAuthorized(p: string): boolean {
  if (!p || typeof p !== 'string') return false
  if (p.includes('\0')) return false
  const target = resolve(p)
  return staticRoots.some(r => sameOrInside(r, target))
    || dynamicRoots.some(r => sameOrInside(r, target))
}

/**
 * 校验渲染进程传入的路径，通过则返回规范化后的绝对路径，否则抛错。
 * 在所有接收路径参数的 IPC handler 入口调用。
 */
export function validatePath(p: string): string {
  if (!p || typeof p !== 'string' || p.includes('\0')) {
    throw new Error('无效的文件路径。')
  }
  const target = resolve(p)
  if (!isPathAuthorized(target)) {
    throw new Error(`路径不在已授权目录内：${target}`)
  }
  return target
}

/** 仅用于单元测试：重置内部状态。 */
export function resetPathGuardForTest(): void {
  staticRoots = []
  dynamicRoots = []
  persistFilePath = null
}
