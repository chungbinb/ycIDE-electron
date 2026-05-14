import { useState, useEffect, useCallback, useRef } from 'react'
import './LibraryDialog.css'
import type { Platform, StoreLibraryCard } from '../../../../shared/library-store'

interface LibInfoDetail {
  name: string
  guid: string
  version: string
  description: string
  author: string
  zipCode: string
  address: string
  phone: string
  qq: string
  email: string
  homePage: string
  otherInfo: string
  fileName: string
  commands: Array<{ name: string }>
  dataTypes: Array<{ name: string }>
  constants: Array<{ name: string }>
}

interface LibraryDialogProps {
  open: boolean
  onClose: () => void
  targetPlatform?: Platform
  detachedWindow?: boolean
}

const platformLabelMap: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
}

function LibraryDialog({ open, onClose, targetPlatform = 'windows', detachedWindow = false }: LibraryDialogProps): React.JSX.Element | null {
  const [libs, setLibs] = useState<StoreLibraryCard[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [busyLibId, setBusyLibId] = useState('')
  const [statusText, setStatusText] = useState('')
  const [detailText, setDetailText] = useState('')
  const [selectedLibId, setSelectedLibId] = useState<string>('')
  const headerRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const header = headerRef.current
    const closeButton = closeButtonRef.current
    if (!header || !closeButton) return

    if (detachedWindow) {
      header.style.setProperty('-webkit-app-region', 'drag')
      closeButton.style.setProperty('-webkit-app-region', 'no-drag')
      return () => {
        header.style.removeProperty('-webkit-app-region')
        closeButton.style.removeProperty('-webkit-app-region')
      }
    }

    header.style.removeProperty('-webkit-app-region')
    closeButton.style.removeProperty('-webkit-app-region')
    return undefined
  }, [detachedWindow])

  const isCompatibleWithTargetPlatform = (lib: StoreLibraryCard): boolean => {
    if (lib.isCore) return true
    if (!lib.supportedPlatforms || lib.supportedPlatforms.length === 0) return true
    return lib.supportedPlatforms.includes(targetPlatform)
  }

  const formatLibDetail = (lib: StoreLibraryCard, info: LibInfoDetail | null): string => {
    if (!info) {
      return [
        '支持库标识：',
        lib.id,
        '',
        `在线版本：${lib.remoteVersion || '-'}`,
        `包文件：${lib.packageFileName || '-'}`,
        `状态：${lib.isInstalled ? '已安装' : '未安装'}`,
        lib.lastError ? `最近错误：${lib.lastError}` : '',
        '',
        '未能读取该支持库详细信息。',
      ].filter(Boolean).join('\n')
    }
    return [
      '支持库标识：',
      lib.id,
      '',
      `数字签名：${info.guid || '-'}`,
      `说明： ${info.description || '-'}`,
      `提供了${info.dataTypes.length}种类型定义，${info.commands.length}种命令，${info.constants.length}个常量。`,
      '',
      '----- 支持库的作者信息 -----',
      `作者姓名：${info.author || '-'}`,
      `QQ号码：${info.qq || '-'}`,
      `电子信箱：${info.email || '-'}`,
      `主页地址：${info.homePage || '-'}`,
      `其它信息：${info.otherInfo || '-'}`,
    ].join('\n')
  }

  const refreshList = useCallback(async (preserveStatusText = false) => {
    try {
      const list = await window.api.library.getStoreCards()
      setLibs(list)
      const defaultSelected = new Set<string>(list.filter((lib: StoreLibraryCard) => lib.isLoaded && isCompatibleWithTargetPlatform(lib)).map((lib: StoreLibraryCard) => lib.id))
      setSelected(defaultSelected)
      if (list.length === 0) {
        setSelectedLibId('')
        setDetailText('')
        return
      }
      const preferId = selectedLibId && list.some((lib: StoreLibraryCard) => lib.id === selectedLibId) ? selectedLibId : list[0].id
      const target = list.find((lib: StoreLibraryCard) => lib.id === preferId)
      if (!target) return
      setSelectedLibId(preferId)
      const info = await window.api.library.getInfo(preferId) as LibInfoDetail | null
      setDetailText(formatLibDetail(target, info))
      if (!preserveStatusText) setStatusText('')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatusText(`刷新支持库列表失败：${message}`)
    }
  }, [selectedLibId, targetPlatform])

  useEffect(() => {
    if (open) refreshList()
  }, [open, refreshList])

  useEffect(() => {
    setSelected(prev => new Set([...prev].filter(id => {
      const lib = libs.find(item => item.id === id)
      return !!lib && isCompatibleWithTargetPlatform(lib)
    })))
  }, [libs, targetPlatform])

  const toggleOne = (name: string, checked: boolean): void => {
    setSelected(prev => {
      const next = new Set(prev)
      if (checked) next.add(name)
      else next.delete(name)
      return next
    })
  }

  const selectAll = (): void => {
    setSelected(new Set(libs.filter(lib => lib.isInstalled && isCompatibleWithTargetPlatform(lib)).map(lib => lib.id)))
  }

  const selectNone = (): void => {
    const coreNames = libs.filter(lib => lib.isCore).map(lib => lib.id)
    setSelected(new Set(coreNames))
  }

  const handleApplySelection = async (): Promise<void> => {
    setLoading(true)
    setStatusText('正在同步支持库清单...')
    try {
      const selectedToApply = libs
        .filter(lib => selected.has(lib.id) && isCompatibleWithTargetPlatform(lib))
        .map(lib => lib.id)
      const result = await window.api.library.applySelection(selectedToApply)
      if (result.failed.length > 0) {
        const failText = result.failed.map((f: { name: string; error: string }) => `${f.name}: ${f.error}`).join('；')
        setStatusText(`已完成：加载 ${result.loadedCount} 个，卸载 ${result.unloadedCount} 个；失败 ${result.failed.length} 个（${failText}）`)
      } else {
        setStatusText(`已完成：加载 ${result.loadedCount} 个，卸载 ${result.unloadedCount} 个`)
      }
      await refreshList(true)
    } finally {
      setLoading(false)
    }
  }

  const refreshOnlineList = async (): Promise<void> => {
    setLoading(true)
    setStatusText('正在刷新在线支持库索引...')
    try {
      await refreshList(true)
      setStatusText('在线支持库索引已刷新')
    } finally {
      setLoading(false)
    }
  }

  const handleInstall = async (id: string): Promise<void> => {
    setLoading(true)
    setBusyLibId(id)
    setStatusText(`正在下载并安装 ${id}...`)
    try {
      const result = await window.api.library.installFromRemote(id)
      if (result.ok) {
        setStatusText(`${id} 已安装到本地支持库目录`)
        setSelected(prev => new Set(prev).add(id))
      } else {
        setStatusText(`${id} 安装失败：${result.error}`)
      }
      await refreshList(true)
    } finally {
      setBusyLibId('')
      setLoading(false)
    }
  }

  const handleRemoveInstalled = async (id: string): Promise<void> => {
    setLoading(true)
    setBusyLibId(id)
    setStatusText(`正在移除 ${id} 的本地安装...`)
    try {
      const result = await window.api.library.removeInstalled(id)
      if (result.ok) {
        setStatusText(`${id} 的本地安装已移除`)
        setSelected(prev => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      } else {
        setStatusText(`${id} 移除失败：${result.error}`)
      }
      await refreshList(true)
    } finally {
      setBusyLibId('')
      setLoading(false)
    }
  }

  const showLibDetail = async (id: string): Promise<void> => {
    const lib = libs.find(item => item.id === id)
    if (!lib) return
    setSelectedLibId(id)
    const info = await window.api.library.getInfo(id) as LibInfoDetail | null
    setDetailText(formatLibDetail(lib, info))
    setStatusText('')
  }

  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, id: string): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    void showLibDetail(id)
  }

  if (!open) return null

  return (
    <div className={`lib-dialog-overlay${detachedWindow ? ' detached' : ''}`} onClick={detachedWindow ? undefined : onClose}>
      <div
        className={`lib-dialog${detachedWindow ? ' detached' : ''}`}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-dialog-title"
      >
        <div ref={headerRef} className="lib-dialog-header">
          <h2 id="library-dialog-title" className="lib-dialog-title">支持库管理</h2>
          <button ref={closeButtonRef} className="lib-dialog-close" onClick={onClose} aria-label="关闭支持库管理窗口" title="关闭">×</button>
        </div>

        <div className="lib-dialog-toolbar">
          <button className="lib-btn" onClick={selectAll} disabled={loading || libs.length === 0}>全选</button>
          <button className="lib-btn" onClick={selectNone} disabled={loading || libs.length === 0}>全不选（保留核心）</button>
          <button className="lib-btn" onClick={refreshOnlineList} disabled={loading}>刷新在线列表</button>
          <button className="lib-btn lib-btn-primary" onClick={handleApplySelection} disabled={loading || libs.length === 0}>应用选择</button>
        </div>

        <div className="lib-dialog-list">
          {libs.length === 0 ? (
            <div className="lib-empty">
              未找到支持库清单，请将 *.ycmd.json 文件放入 lib 子目录
            </div>
          ) : (
            <div className="lib-card-grid">
              {libs.map(lib => {
                const targetPlatformDisabled = !isCompatibleWithTargetPlatform(lib)
                return (
                <div
                  key={lib.id}
                  className={`lib-card ${lib.isLoaded && !targetPlatformDisabled ? 'lib-card-loaded' : ''} ${selectedLibId === lib.id ? 'lib-card-selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`查看支持库 ${lib.displayName || lib.id} 说明`}
                  onClick={() => { void showLibDetail(lib.id) }}
                  onKeyDown={(event) => handleCardKeyDown(event, lib.id)}
                >
                  <div className="lib-card-header">
                    <input
                      type="checkbox"
                      className="lib-checkbox"
                      checked={selected.has(lib.id) && !targetPlatformDisabled}
                      disabled={loading || lib.isCore || !lib.isInstalled || targetPlatformDisabled}
                      onChange={e => toggleOne(lib.id, e.target.checked)}
                      aria-label={`${lib.displayName || lib.id} 加载状态`}
                      title={targetPlatformDisabled ? `不支持当前目标平台 ${platformLabelMap[targetPlatform] || targetPlatform}` : undefined}
                    />
                    <button
                      className={`lib-link ${selectedLibId === lib.id ? 'lib-link-active' : ''}`}
                      disabled={loading}
                      onClick={(event) => {
                        event.stopPropagation()
                        void showLibDetail(lib.id)
                      }}
                    >
                      {lib.displayName || lib.id}{lib.isCore ? ' (核心)' : ''}
                    </button>
                  </div>
                  <div className="lib-card-subtitle">{lib.id}</div>
                  <div className="lib-card-version">版本：{lib.version || '-'}</div>
                  <div className="lib-card-platforms">
                    {lib.supportedPlatforms.map(platform => (
                      <span key={`${lib.id}-${platform}`} className="lib-platform-tag">
                        {platformLabelMap[platform] || platform}
                      </span>
                    ))}
                  </div>
                  <div className="lib-card-states">
                    {!lib.isCore ? (
                      <span className={`lib-state-badge ${lib.isDownloaded ? 'lib-state-downloaded' : 'lib-state-missing'}`}>
                        {lib.isDownloaded ? '已下载' : '未下载'}
                      </span>
                    ) : null}
                    <span className={`lib-state-badge ${lib.isInstalled ? 'lib-state-installed' : 'lib-state-missing'}`}>
                      {lib.isInstalled ? '已安装' : '未安装'}
                    </span>
                    {lib.updateAvailable ? (
                      <span className="lib-state-badge lib-state-update">可更新</span>
                    ) : null}
                    {lib.lastError ? (
                      <span className="lib-state-badge lib-state-error">失败</span>
                    ) : null}
                    <span className={`lib-state-badge ${lib.isLoaded ? 'lib-state-loaded' : ''}`}>
                      {lib.isLoaded ? '已加载' : '未加载'}
                    </span>
                    {targetPlatformDisabled ? (
                      <span className="lib-state-badge lib-state-error">当前平台禁用</span>
                    ) : null}
                  </div>
                  <div className="lib-card-actions">
                    {lib.packageUrl ? (
                      <button
                        className="lib-btn lib-btn-sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleInstall(lib.id)
                        }}
                        disabled={loading || busyLibId === lib.id}
                      >
                        {busyLibId === lib.id ? '处理中' : lib.updateAvailable ? '更新' : lib.isInstalled ? '重新下载' : '下载'}
                      </button>
                    ) : null}
                    {lib.isInstalled && lib.source === 'installed' && !lib.isCore ? (
                      <button
                        className="lib-btn lib-btn-sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleRemoveInstalled(lib.id)
                        }}
                        disabled={loading || busyLibId === lib.id}
                      >
                        移除本地
                      </button>
                    ) : null}
                  </div>
                </div>
              )})}
            </div>
          )}
        </div>

        <div className="lib-dialog-status-line" role="status" aria-live="polite">
          {statusText}
        </div>

        <textarea
          className="lib-dialog-status"
          value={detailText}
          readOnly
          spellCheck={false}
          aria-label="所选支持库详情"
        />
      </div>
    </div>
  )
}

export default LibraryDialog
