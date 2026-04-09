import { useState, useEffect, useCallback } from 'react'
import './LibraryDialog.css'
import type { StoreLibraryCard } from '../../../../shared/library-store'

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
}

const platformLabelMap: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
}

function LibraryDialog({ open, onClose }: LibraryDialogProps): React.JSX.Element | null {
  const [libs, setLibs] = useState<StoreLibraryCard[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [detailText, setDetailText] = useState('')
  const [selectedLibId, setSelectedLibId] = useState<string>('')

  const formatLibDetail = (lib: StoreLibraryCard, info: LibInfoDetail | null): string => {
    if (!info) {
      return `支持库标识：\n${lib.id}\n\n未能读取该支持库详细信息。`
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
      `邮政编码：${info.zipCode || '-'}`,
      `通信地址：${info.address || '-'}`,
      `电话号码：${info.phone || '-'}`,
      `QQ号码：${info.qq || '-'}`,
      `电子信箱：${info.email || '-'}`,
      `主页地址：${info.homePage || '-'}`,
      `其它信息：${info.otherInfo || '-'}`,
    ].join('\n')
  }

  const refreshList = useCallback(async (preserveStatusText = false) => {
    const list = await window.api.library.getStoreCards()
    setLibs(list)
    const defaultSelected = new Set<string>(list.filter((lib: StoreLibraryCard) => lib.isLoaded).map((lib: StoreLibraryCard) => lib.id))
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
  }, [selectedLibId])

  useEffect(() => {
    if (open) refreshList()
  }, [open, refreshList])

  const toggleOne = (name: string, checked: boolean): void => {
    setSelected(prev => {
      const next = new Set(prev)
      if (checked) next.add(name)
      else next.delete(name)
      return next
    })
  }

  const selectAll = (): void => {
    setSelected(new Set(libs.map(lib => lib.id)))
  }

  const selectNone = (): void => {
    const coreNames = libs.filter(lib => lib.isCore).map(lib => lib.id)
    setSelected(new Set(coreNames))
  }

  const handleApplySelection = async (): Promise<void> => {
    setLoading(true)
    setStatusText('正在同步支持库清单...')
    const result = await window.api.library.applySelection(Array.from(selected))
    if (result.failed.length > 0) {
      const failText = result.failed.map((f: { name: string; error: string }) => `${f.name}: ${f.error}`).join('；')
      setStatusText(`已完成：加载 ${result.loadedCount} 个，卸载 ${result.unloadedCount} 个；失败 ${result.failed.length} 个（${failText}）`)
    } else {
      setStatusText(`已完成：加载 ${result.loadedCount} 个，卸载 ${result.unloadedCount} 个`)
    }
    await refreshList(true)
    setLoading(false)
  }

  const showLibDetail = async (id: string): Promise<void> => {
    const lib = libs.find(item => item.id === id)
    if (!lib) return
    setSelectedLibId(id)
    const info = await window.api.library.getInfo(id) as LibInfoDetail | null
    setDetailText(formatLibDetail(lib, info))
    setStatusText('')
  }

  if (!open) return null

  return (
    <div className="lib-dialog-overlay" onClick={onClose}>
      <div className="lib-dialog" onClick={e => e.stopPropagation()}>
        <div className="lib-dialog-header">
          <span className="lib-dialog-title">支持库管理</span>
          <button className="lib-dialog-close" onClick={onClose}>×</button>
        </div>

        <div className="lib-dialog-toolbar">
          <button className="lib-btn" onClick={selectAll} disabled={loading || libs.length === 0}>全选</button>
          <button className="lib-btn" onClick={selectNone} disabled={loading || libs.length === 0}>全不选（保留核心）</button>
          <button className="lib-btn lib-btn-primary" onClick={handleApplySelection} disabled={loading || libs.length === 0}>应用选择</button>
        </div>

        <div className="lib-dialog-list">
          {libs.length === 0 ? (
            <div className="lib-empty">
              未找到支持库清单，请将 *.ycmd.json 文件放入 lib 子目录
            </div>
          ) : (
            <div className="lib-card-grid">
              {libs.map(lib => (
                <div key={lib.id} className={`lib-card ${lib.isLoaded ? 'lib-card-loaded' : ''}`}>
                  <div className="lib-card-header">
                    <input
                      type="checkbox"
                      className="lib-checkbox"
                      checked={selected.has(lib.id)}
                      disabled={loading || lib.isCore}
                      onChange={e => toggleOne(lib.id, e.target.checked)}
                    />
                    <button
                      className={`lib-link ${selectedLibId === lib.id ? 'lib-link-active' : ''}`}
                      disabled={loading}
                      onClick={() => showLibDetail(lib.id)}
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
                    <span className={`lib-state-badge ${lib.isDownloaded ? 'lib-state-downloaded' : 'lib-state-missing'}`}>
                      {lib.isDownloaded ? '已下载' : '未下载'}
                    </span>
                    <span className={`lib-state-badge ${lib.isLoaded ? 'lib-state-loaded' : ''}`}>
                      {lib.isLoaded ? '已加载' : '未加载'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <textarea
          className="lib-dialog-status"
          value={statusText || detailText}
          readOnly
          spellCheck={false}
          aria-label="支持库状态与详情"
        />
      </div>
    </div>
  )
}

export default LibraryDialog
