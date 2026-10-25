// 插件管理（设计稿 §8、§11 阶段 5）：已安装插件的启用 / 停用 / 授权 / 卸载，以及从商店安装插件与主题。
// 安装、授权前都把插件申请的权限逐条列出，敏感权限标红，用户确认后才执行。

import { useCallback, useEffect, useState } from 'react'
import { describePermission, isSensitivePermission } from '../../../../shared/plugin/permissions'
import './PluginManagerDialog.css'

type PluginState = Awaited<ReturnType<typeof window.api.plugins.getState>>
type PluginInfo = PluginState['plugins'][number]
type StoreListResult = Awaited<ReturnType<typeof window.api.plugins.storeList>>
type StoreCard = Extract<StoreListResult, { ok: true }>['cards'][number]

interface PluginManagerDialogProps {
  open: boolean
  onClose: () => void
  storeIndexUrl: string
}

interface ConsentRequest {
  kind: 'grant' | 'install'
  id: string
  name: string
  permissions: string[]
  /** 商店安装：包是否有发布者签名 */
  signed?: boolean
}

const STATUS_LABEL: Record<PluginInfo['status'], string> = {
  enabled: '已启用',
  disabled: '已停用',
  unavailable: '不可用',
  error: '出错',
}

const PROCESS_LABEL: Record<NonNullable<PluginInfo['processKind']>, string> = {
  trusted: '内置插件进程',
  sandboxed: '受限进程（按发布者隔离）',
  executable: '原生程序',
}

function PermissionList({ permissions }: { permissions: string[] }): React.JSX.Element {
  if (permissions.length === 0) return <div className="pm-perm-none">不需要任何权限</div>
  return (
    <ul className="pm-perm-list">
      {permissions.map(p => (
        <li key={p} className={isSensitivePermission(p) ? 'pm-perm pm-perm-sensitive' : 'pm-perm'}>
          <span className="pm-perm-text">{describePermission(p)}</span>
          <code className="pm-perm-id">{p}</code>
        </li>
      ))}
    </ul>
  )
}

function PluginManagerDialog({ open, onClose, storeIndexUrl }: PluginManagerDialogProps): React.JSX.Element | null {
  const [tab, setTab] = useState<'installed' | 'store'>('installed')
  const [state, setState] = useState<PluginState | null>(null)
  const [store, setStore] = useState<StoreCard[] | null>(null)
  const [storeError, setStoreError] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState<{ type: 'info' | 'error'; text: string } | null>(null)
  const [consent, setConsent] = useState<ConsentRequest | null>(null)
  const [allowUnsigned, setAllowUnsigned] = useState(false)

  const refresh = useCallback(async () => {
    setState(await window.api.plugins.getState())
  }, [])

  const loadStore = useCallback(async () => {
    setStoreError('')
    setStore(null)
    const result = await window.api.plugins.storeList(storeIndexUrl)
    if (result.ok) setStore(result.cards)
    else setStoreError(result.error)
  }, [storeIndexUrl])

  useEffect(() => {
    if (!open) return
    void refresh()
    const off = window.api.on('plugins:changed', () => { void refresh() })
    return () => { off?.() }
  }, [open, refresh])

  useEffect(() => {
    if (open && tab === 'store' && store === null && !storeError) void loadStore()
  }, [open, tab, store, storeError, loadStore])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (consent) setConsent(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, consent, onClose])

  const run = useCallback(async (id: string, action: () => Promise<unknown>, done?: string) => {
    setBusy(id)
    setMessage(null)
    try {
      await action()
      if (done) setMessage({ type: 'info', text: done })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy('')
      await refresh()
    }
  }, [refresh])

  const confirmConsent = useCallback(async () => {
    if (!consent) return
    const request = consent
    setConsent(null)
    if (request.kind === 'grant') {
      await run(request.id, () => window.api.plugins.grantPermissions(request.id), `已授权并启用 ${request.name}`)
      return
    }
    await run(request.id, async () => {
      const result = await window.api.plugins.storeInstall(storeIndexUrl, request.id, { permissions: request.permissions, allowUnsigned })
      if (!result.ok) throw new Error(result.error)
    }, `已安装 ${request.name}`)
    await loadStore()
  }, [consent, run, storeIndexUrl, allowUnsigned, loadStore])

  if (!open) return null
  const plugins = state?.plugins ?? []
  const thirdParty = plugins.filter(p => !p.builtin)
  const builtin = plugins.filter(p => p.builtin)

  const renderPlugin = (p: PluginInfo): React.JSX.Element => (
    <div key={`${p.id}@${p.source}`} className="pm-item" data-plugin-id={p.id}>
      <div className="pm-item-head">
        <span className="pm-item-name">{p.displayName}</span>
        <span className="pm-item-meta">{p.id} · {p.version}{p.dev ? ' · 开发中' : ''}</span>
        <span className={`pm-status pm-status-${p.needsConsent ? 'consent' : p.status}`}>
          {p.needsConsent ? '等待授权' : STATUS_LABEL[p.status]}
        </span>
      </div>
      {p.reason && !p.needsConsent && p.status !== 'enabled' && <div className="pm-item-reason">{p.reason}</div>}
      {p.processKind && <div className="pm-item-process">运行在：{PROCESS_LABEL[p.processKind]}{p.active ? '（已激活）' : ''}</div>}
      {!p.builtin && p.permissions.length > 0 && <PermissionList permissions={p.permissions} />}
      <div className="pm-item-actions">
        {p.needsConsent && (
          <button type="button" className="pm-btn pm-btn-primary" disabled={!!busy}
            onClick={() => setConsent({ kind: 'grant', id: p.id, name: p.displayName, permissions: p.permissions })}>
            授权并启用
          </button>
        )}
        {!p.needsConsent && p.canDisable && (p.status === 'enabled' || p.status === 'disabled') && (
          <button type="button" className="pm-btn" disabled={!!busy}
            onClick={() => void run(p.id, () => window.api.plugins.setEnabled(p.id, p.status !== 'enabled'))}>
            {p.status === 'enabled' ? '停用' : '启用'}
          </button>
        )}
        {!p.builtin && !p.dev && !p.needsConsent && p.permissions.length > 0 && (
          <button type="button" className="pm-btn" disabled={!!busy}
            onClick={() => void run(p.id, () => window.api.plugins.revokePermissions(p.id), `已收回 ${p.displayName} 的权限`)}>
            收回授权
          </button>
        )}
        {p.removable && (
          <button type="button" className="pm-btn pm-btn-danger" disabled={!!busy}
            onClick={() => void run(p.id, async () => {
              const result = await window.api.plugins.uninstall(p.id)
              if (!result.ok) throw new Error(result.error)
            }, `已卸载 ${p.displayName}`)}>
            卸载
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="pm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="pm-dialog" role="dialog" aria-label="插件管理">
        <div className="pm-header">
          <span className="pm-title">插件管理</span>
          <div className="pm-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'installed'} className={tab === 'installed' ? 'pm-tab active' : 'pm-tab'} onClick={() => setTab('installed')}>已安装</button>
            <button type="button" role="tab" aria-selected={tab === 'store'} className={tab === 'store' ? 'pm-tab active' : 'pm-tab'} onClick={() => setTab('store')}>商店</button>
          </div>
          <button type="button" className="pm-btn" disabled={!!busy} onClick={() => void run('reload', () => window.api.plugins.reload(), '已重新加载插件')}>重新加载</button>
          <button type="button" className="pm-close" aria-label="关闭插件管理" onClick={onClose}>×</button>
        </div>
        {message && <div className={`pm-message pm-message-${message.type}`}>{message.text}</div>}
        <div className="pm-body">
          {tab === 'installed' ? (
            <>
              <div className="pm-section-title">第三方插件（{thirdParty.length}）</div>
              {thirdParty.length === 0 ? <div className="pm-empty">还没有安装第三方插件，可以到「商店」里安装。</div> : thirdParty.map(renderPlugin)}
              <div className="pm-section-title">内置插件（{builtin.length}）</div>
              {builtin.map(renderPlugin)}
            </>
          ) : storeError ? (
            <div className="pm-empty">
              读取商店失败：{storeError}
              <button type="button" className="pm-btn" onClick={() => void loadStore()}>重试</button>
            </div>
          ) : store === null ? (
            <div className="pm-empty">正在读取商店……</div>
          ) : store.length === 0 ? (
            <div className="pm-empty">商店里暂时没有插件和主题。</div>
          ) : store.map(card => (
            <div key={card.id} className="pm-item" data-store-id={card.id}>
              <div className="pm-item-head">
                <span className="pm-item-name">{card.displayName}</span>
                <span className="pm-item-meta">{card.kind === 'theme' ? '主题' : '插件'} · {card.publisher} · {card.version}</span>
                <span className={card.signed ? 'pm-status pm-status-enabled' : 'pm-status pm-status-error'}>{card.signed ? '已签名' : '未签名'}</span>
              </div>
              {card.summary && <div className="pm-item-reason">{card.summary}</div>}
              {card.kind === 'plugin' && <PermissionList permissions={card.permissions} />}
              <div className="pm-item-actions">
                <button type="button" className="pm-btn pm-btn-primary" disabled={!!busy || card.installedVersion === card.version}
                  onClick={() => { setAllowUnsigned(false); setConsent({ kind: 'install', id: card.id, name: card.displayName, permissions: card.permissions, signed: card.signed }) }}>
                  {card.installedVersion === card.version ? '已安装' : card.installedVersion ? `更新（当前 ${card.installedVersion}）` : '安装'}
                </button>
              </div>
            </div>
          ))}
        </div>
        {consent && (
          <div className="pm-consent" role="alertdialog" aria-label="确认权限">
            <div className="pm-consent-title">
              {consent.kind === 'install' ? `安装「${consent.name}」` : `授权「${consent.name}」`}
            </div>
            <div className="pm-consent-text">它将获得以下权限：</div>
            <PermissionList permissions={consent.permissions} />
            {consent.kind === 'install' && consent.signed === false && (
              <label className="pm-consent-unsigned">
                <input type="checkbox" checked={allowUnsigned} onChange={e => setAllowUnsigned(e.target.checked)} />
                这个包没有发布者签名，无法确认来源。我了解风险，仍要安装。
              </label>
            )}
            <div className="pm-item-actions">
              <button type="button" className="pm-btn" onClick={() => setConsent(null)}>取消</button>
              <button type="button" className="pm-btn pm-btn-primary"
                disabled={consent.kind === 'install' && consent.signed === false && !allowUnsigned}
                onClick={() => void confirmConsent()}>
                {consent.kind === 'install' ? '同意并安装' : '同意并启用'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default PluginManagerDialog
