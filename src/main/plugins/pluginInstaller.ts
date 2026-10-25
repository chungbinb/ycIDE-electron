// 从商店安装插件 / 主题（设计稿 §8.2、§13.1 第 4 条：与支持库共用同一个索引，条目用 kind 区分）。
// 安装流程：下载 → sha256 校验 → 发布者签名校验（Ed25519，公钥首次见到后固定在本机）→ 安全解压 →
// 校验包里的 plugin.json（ID、发布者、主题包不能带代码、申请的权限不能超出用户确认的范围）→
// 放进用户插件目录 → 记录用户同意的权限 → 重新扫描插件。
// 不直接依赖 Electron，便于测试。

import { createHash, createPublicKey, verify } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LibraryPackageEntry, LibraryRemoteIndex, LibraryRemoteIndexResult, Platform } from '../../shared/library-store'
import { validatePluginManifest } from '../../shared/plugin/manifest'
import { requestedPermissions } from '../../shared/plugin/permissions'
import { extractZipSafely } from '../security/safeZip'
import type { PluginService } from './pluginService'

export type StorePluginKind = 'plugin' | 'theme'

export interface StorePluginCard {
  id: string
  kind: StorePluginKind
  displayName: string
  version: string
  publisher: string
  summary?: string
  size?: number
  supportedPlatforms: Platform[]
  /** 索引里声明的权限（安装前展示） */
  permissions: string[]
  /** 带发布者签名，且索引里有该发布者的公钥 */
  signed: boolean
  /** 本机已安装的版本；未安装为 undefined */
  installedVersion?: string
}

export interface InstallConsent {
  /** 用户在确认框里看到并同意的权限 */
  permissions: string[]
  /** 用户明确同意安装未签名的包 */
  allowUnsigned?: boolean
}

export type InstallResult = { ok: true; id: string; permissions: string[] } | { ok: false; error: string }

export interface PluginInstallerOptions {
  /** 用户插件目录（<userData>/plugins） */
  userPluginsDir: string
  /** 固定下来的发布者公钥（<userData>/plugin-publishers.json） */
  publishersFile: string
  service: Pick<PluginService, 'getState' | 'recordGrant' | 'rescan' | 'releasePlugin' | 'forgetPlugin'>
  fetchIndex(indexUrl: string): Promise<LibraryRemoteIndexResult>
  download(url: string): Promise<Buffer>
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/** 校验 Ed25519 签名：被签的内容是包的 sha256 十六进制字符串 */
export function verifyPackageSignature(packageSha256: string, signatureBase64: string, publicKeyBase64: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), format: 'der', type: 'spki' })
    if (key.asymmetricKeyType !== 'ed25519') return false
    return verify(null, Buffer.from(packageSha256, 'utf-8'), key, Buffer.from(signatureBase64, 'base64'))
  } catch {
    return false
  }
}

function isStorePluginEntry(entry: LibraryPackageEntry): entry is LibraryPackageEntry & { kind: StorePluginKind } {
  return entry.kind === 'plugin' || entry.kind === 'theme'
}

export class PluginInstaller {
  constructor(private readonly options: PluginInstallerOptions) {}

  private loadPinnedKeys(): Record<string, string> {
    try {
      const raw = JSON.parse(readFileSync(this.options.publishersFile, 'utf-8')) as unknown
      return raw && typeof raw === 'object' ? raw as Record<string, string> : {}
    } catch {
      return {}
    }
  }

  private pinKey(publisher: string, key: string): void {
    const pinned = this.loadPinnedKeys()
    if (pinned[publisher] === key) return
    pinned[publisher] = key
    mkdirSync(dirname(this.options.publishersFile), { recursive: true })
    writeFileSync(this.options.publishersFile, JSON.stringify(pinned, null, 2), 'utf-8')
  }

  async listStore(indexUrl: string): Promise<{ ok: true; cards: StorePluginCard[] } | { ok: false; error: string }> {
    const result = await this.options.fetchIndex(indexUrl)
    if (!result.ok) return result
    const installed = new Map(this.options.service.getState().plugins.map(p => [p.id, p.version]))
    const cards = result.index.libraries.filter(isStorePluginEntry).map((entry): StorePluginCard => ({
      id: entry.id,
      kind: entry.kind,
      displayName: entry.displayName,
      version: entry.version,
      publisher: entry.publisher ?? entry.id.split('.')[0],
      summary: entry.summary,
      size: entry.size,
      supportedPlatforms: entry.supportedPlatforms,
      permissions: [...(entry.permissions ?? [])].sort(),
      signed: !!entry.signature && !!result.index.publishers?.[entry.publisher ?? entry.id.split('.')[0]],
      installedVersion: installed.get(entry.id),
    }))
    return { ok: true, cards }
  }

  async install(indexUrl: string, id: string, consent: InstallConsent): Promise<InstallResult> {
    const result = await this.options.fetchIndex(indexUrl)
    if (!result.ok) return result
    const entry = result.index.libraries.find(e => e.id === id && isStorePluginEntry(e))
    if (!entry) return { ok: false, error: `商店里没有插件 ${id}` }
    let buffer: Buffer
    try {
      buffer = await this.options.download(entry.packageUrl)
    } catch (err) {
      return { ok: false, error: `下载 ${entry.displayName} 失败：${err instanceof Error ? err.message : String(err)}` }
    }
    return this.installPackage(entry, buffer, result.index, consent)
  }

  /** 校验并安装已下载的包（拆出来便于测试） */
  async installPackage(entry: LibraryPackageEntry, buffer: Buffer, index: Pick<LibraryRemoteIndex, 'publishers'>, consent: InstallConsent): Promise<InstallResult> {
    if (!isStorePluginEntry(entry)) return { ok: false, error: `${entry.id} 不是插件或主题` }
    const publisher = entry.publisher ?? entry.id.split('.')[0]
    const actualHash = sha256(buffer)
    if (!entry.packageSha256) return { ok: false, error: '商店条目缺少 sha256，拒绝安装' }
    if (actualHash !== entry.packageSha256.toLowerCase()) return { ok: false, error: `插件包校验失败（sha256 为 ${actualHash}）` }

    if (entry.signature) {
      const key = index.publishers?.[publisher]
      if (!key) return { ok: false, error: `商店索引里没有发布者 ${publisher} 的公钥，无法校验签名` }
      const pinned = this.loadPinnedKeys()[publisher]
      if (pinned && pinned !== key) {
        return { ok: false, error: `发布者 ${publisher} 的公钥与本机之前记录的不一致，可能被冒充，已拒绝安装` }
      }
      if (!verifyPackageSignature(actualHash, entry.signature, key)) return { ok: false, error: `发布者 ${publisher} 的签名校验失败` }
    } else if (!consent.allowUnsigned) {
      return { ok: false, error: '插件包没有发布者签名，需要你明确同意后才能安装' }
    }

    const { userPluginsDir } = this.options
    mkdirSync(userPluginsDir, { recursive: true })
    const tempDir = join(userPluginsDir, `.install-${entry.id}-${Date.now()}`)
    const targetDir = join(userPluginsDir, entry.id)
    try {
      mkdirSync(tempDir)
      extractZipSafely(buffer, tempDir)
      const manifestPath = join(tempDir, 'plugin.json')
      if (!existsSync(manifestPath)) throw new Error('插件包根目录没有 plugin.json')
      let raw: Record<string, unknown>
      try {
        raw = JSON.parse(readFileSync(manifestPath, 'utf-8').replace(/^﻿/, '')) as Record<string, unknown>
      } catch (err) {
        throw new Error(`plugin.json 不是合法 JSON：${(err as Error).message}`)
      }
      delete raw.builtin
      const validation = validatePluginManifest(raw)
      if (!validation.ok) throw new Error(`plugin.json 无效：${validation.errors.join('；')}`)
      const manifest = validation.manifest
      if (manifest.id !== entry.id) throw new Error(`包里的插件 ID（${manifest.id}）与商店条目（${entry.id}）不一致`)
      if (manifest.publisher !== publisher) throw new Error(`包里的发布者（${manifest.publisher}）与商店条目（${publisher}）不一致`)
      if (entry.kind === 'theme') {
        if (manifest.runtime && manifest.runtime.type !== 'none') throw new Error('主题包不能带代码')
        if (!(manifest.contributes?.themes?.length)) throw new Error('主题包里没有声明主题')
      }
      const requested = requestedPermissions(manifest)
      const notConsented = requested.filter(p => !consent.permissions.includes(p))
      if (notConsented.length > 0) throw new Error(`插件申请了未经你确认的权限：${notConsented.join('、')}`)

      // 替换旧版本：先把插件从进程里卸下，释放对目录的占用
      if (existsSync(targetDir)) {
        await this.options.service.releasePlugin(entry.id)
        rmSync(targetDir, { recursive: true, force: true })
      }
      renameSync(tempDir, targetDir)
      if (entry.signature) this.pinKey(publisher, index.publishers![publisher])
      this.options.service.recordGrant(entry.id, requested)
      await this.options.service.rescan()
      return { ok: true, id: entry.id, permissions: requested }
    } catch (err) {
      rmSync(tempDir, { recursive: true, force: true })
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 卸载商店安装的插件（只能卸载用户插件目录里的） */
  async uninstall(id: string): Promise<InstallResult> {
    const info = this.options.service.getState().plugins.find(p => p.id === id)
    if (!info) return { ok: false, error: `插件 ${id} 不存在` }
    if (!info.removable) return { ok: false, error: `插件 ${id} 不是从商店安装的，不能在这里卸载` }
    const dir = join(this.options.userPluginsDir, id)
    if (info.source !== dir) return { ok: false, error: `插件 ${id} 的目录与预期不符：${info.source}` }
    await this.options.service.releasePlugin(id)
    rmSync(dir, { recursive: true, force: true })
    this.options.service.forgetPlugin(id)
    await this.options.service.rescan()
    return { ok: true, id, permissions: [] }
  }
}
