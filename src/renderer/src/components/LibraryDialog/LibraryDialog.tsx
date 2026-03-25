import { useState, useEffect, useCallback } from 'react'
import './LibraryDialog.css'

interface LibItem {
  name: string
  filePath: string
  loaded: boolean
  isCore: boolean
  libName?: string
  version?: string
  cmdCount?: number
  dtCount?: number
}

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

function LibraryDialog({ open, onClose }: LibraryDialogProps): React.JSX.Element | null {
  const runtimePlatform = window.api?.system?.getRuntimePlatform?.() ?? 'windows'
  const canLoadFneLibraries = runtimePlatform === 'windows'
  const [libs, setLibs] = useState<LibItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [detailText, setDetailText] = useState('')
  const [selectedLibName, setSelectedLibName] = useState<string>('')

  const formatLibDetail = (lib: LibItem, info: LibInfoDetail | null): string => {
    if (!info) {
      return `相关文件：\n${lib.filePath}\n\n未能读取该支持库详细信息。`
    }
    const relatedDir = lib.filePath.replace(/\.fne$/i, '')
    return [
      '相关文件：',
      lib.filePath,
      '相关目录：',
      relatedDir,
      '',
      `数字签名：${info.guid || '-'}`,
      `说明： ${info.description || '-'}`,
      `提供了${info.dataTypes.length}种数据类型，${info.commands.length}种命令，${info.constants.length}个常量。`,
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
    const list = await window.api.library.getList()
    setLibs(list)
    const defaultSelected = new Set(list.filter((lib: LibItem) => lib.loaded).map((lib: LibItem) => lib.name))
    setSelected(defaultSelected)
    if (list.length === 0) {
      setSelectedLibName('')
      setDetailText('')
      return
    }
    const preferName = selectedLibName && list.some((lib: LibItem) => lib.name === selectedLibName) ? selectedLibName : list[0].name
    const target = list.find((lib: LibItem) => lib.name === preferName)
    if (!target) return
    setSelectedLibName(preferName)
    const info = await window.api.library.getInfo(preferName) as LibInfoDetail | null
    setDetailText(formatLibDetail(target, info))
    if (!preserveStatusText) setStatusText('')
  }, [selectedLibName])

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
    setSelected(new Set(libs.map(lib => lib.name)))
  }

  const selectNone = (): void => {
    const coreNames = libs.filter(lib => lib.isCore).map(lib => lib.name)
    setSelected(new Set(coreNames))
  }

  const handleApplySelection = async (): Promise<void> => {
    if (!canLoadFneLibraries) {
      setStatusText('当前平台暂不支持加载 .fne 支持库（仅 Windows 可用）。请在 Windows 端执行支持库加载与调试。')
      return
    }
    setLoading(true)
    setStatusText('正在应用支持库选择...')
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

  const showLibDetail = async (name: string): Promise<void> => {
    const lib = libs.find(item => item.name === name)
    if (!lib) return
    setSelectedLibName(name)
    const info = await window.api.library.getInfo(name) as LibInfoDetail | null
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

        {!canLoadFneLibraries && (
          <div className="lib-dialog-tip" role="note">
            当前为 {runtimePlatform} 平台：.fne 支持库仅能在 Windows 下加载，当前页面仅支持查看信息。
          </div>
        )}

        <div className="lib-dialog-list">
          <table className="lib-table">
            <thead>
              <tr>
                <th className="lib-col-check">选择</th>
                <th>文件名</th>
                <th>支持库名称</th>
                <th>版本</th>
                <th>命令数</th>
                <th>数据类型</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {libs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="lib-empty">
                    未找到支持库，请将 .fne 文件放入 lib 文件夹
                  </td>
                </tr>
              ) : (
                libs.map(lib => (
                  <tr key={lib.name} className={lib.loaded ? 'lib-loaded' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        className="lib-checkbox"
                        checked={selected.has(lib.name)}
                        disabled={loading || lib.isCore}
                        onChange={e => toggleOne(lib.name, e.target.checked)}
                      />
                    </td>
                    <td>
                      <button
                        className={`lib-link ${selectedLibName === lib.name ? 'lib-link-active' : ''}`}
                        disabled={loading}
                        onClick={() => showLibDetail(lib.name)}
                      >
                        {lib.name}.fne
                      </button>
                    </td>
                    <td>
                      <button
                        className={`lib-link ${selectedLibName === lib.name ? 'lib-link-active' : ''}`}
                        disabled={loading}
                        onClick={() => showLibDetail(lib.name)}
                      >
                        {lib.libName || '-'}{lib.isCore ? ' (核心)' : ''}
                      </button>
                    </td>
                    <td>{lib.version || '-'}</td>
                    <td>{lib.cmdCount ?? '-'}</td>
                    <td>{lib.dtCount ?? '-'}</td>
                    <td>
                      <span className={`lib-status ${lib.loaded ? 'lib-status-ok' : ''}`}>
                        {lib.loaded ? '已加载' : '未加载'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
