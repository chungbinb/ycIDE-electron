// 插件权限（设计稿 §8）：清单 permissions 声明，宿主在每个插件请求上检查。
//   - 内置插件（随安装包发布、可信目录里的 builtin 插件）隐含全部权限；
//   - 第三方插件只拥有声明过、且用户同意过的权限，越权请求返回 -33001；
//   - 敏感权限（任意路径读写、任意联网、启动程序）以及原生可执行插件，安装 / 启用前必须由用户明确同意。

import type { PluginManifest } from './manifest'

export const PLUGIN_PERMISSIONS: Readonly<Record<string, string>> = {
  'workspace:read': '读取当前项目里的文件和打开的文档',
  'workspace:write': '写入当前项目里的文件',
  'documents:write': '修改编辑器里打开的文档',
  'fs:any': '读写电脑上的任意文件',
  'process:spawn': '启动其他程序',
  terminal: '使用内置终端',
  'secrets:own': '保存和读取自己的密钥（与其他插件隔离）',
  'ai:invoke': '调用 AI 模型（会消耗你的额度）',
  'workbench:commands': '执行 IDE 菜单里的功能（如保存、编译、运行）',
}

/** 可执行文件插件不受进程内权限约束，展示时作为一项「伪权限」 */
export const EXECUTABLE_RUNTIME_PERMISSION = 'runtime:executable'

const DOMAIN_PATTERN = /^(\*|(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+)$/

export function isValidPermission(permission: unknown): permission is string {
  if (typeof permission !== 'string') return false
  if (permission.startsWith('net:')) return DOMAIN_PATTERN.test(permission.slice(4))
  return Object.prototype.hasOwnProperty.call(PLUGIN_PERMISSIONS, permission)
}

export function describePermission(permission: string): string {
  if (permission === EXECUTABLE_RUNTIME_PERMISSION) return '以原生程序运行（不受上述权限限制，相当于普通软件）'
  if (permission === 'net:*') return '访问任意网站'
  if (permission.startsWith('net:')) {
    const domain = permission.slice(4)
    return domain.startsWith('*.') ? `访问 ${domain.slice(2)} 及其子域名` : `访问 ${domain}`
  }
  return PLUGIN_PERMISSIONS[permission] ?? permission
}

/** 需要用户明确同意的权限 */
export function isSensitivePermission(permission: string): boolean {
  return permission === 'fs:any' || permission === 'net:*' || permission === 'process:spawn' || permission === EXECUTABLE_RUNTIME_PERMISSION
}

/** 插件需要用户同意的全部权限：声明的权限 + 可执行文件插件的伪权限，去重排序 */
export function requestedPermissions(manifest: Pick<PluginManifest, 'permissions' | 'runtime'>): string[] {
  const set = new Set((manifest.permissions ?? []).filter(isValidPermission))
  if (manifest.runtime?.type === 'executable') set.add(EXECUTABLE_RUNTIME_PERMISSION)
  return [...set].sort()
}

/** 域名是否被 net 权限允许：net:a.com 允许 a.com；net:*.a.com 允许 a.com 与其子域名；net:* 允许全部 */
export function isHostAllowed(host: string, permissions: readonly string[]): boolean {
  const target = host.toLowerCase().replace(/\.$/, '')
  for (const permission of permissions) {
    if (!permission.startsWith('net:')) continue
    const domain = permission.slice(4)
    if (domain === '*') return true
    if (domain.startsWith('*.')) {
      const base = domain.slice(2)
      if (target === base || target.endsWith(`.${base}`)) return true
    } else if (target === domain) {
      return true
    }
  }
  return false
}

/** 插件是否拥有某项权限（builtin 插件隐含全部权限；granted 为用户同意过的权限） */
export function hasPermission(manifest: Pick<PluginManifest, 'builtin'>, granted: readonly string[], permission: string): boolean {
  if (manifest.builtin) return true
  if (permission.startsWith('net:')) return isHostAllowed(permission.slice(4), granted)
  return granted.includes(permission)
}
