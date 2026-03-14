import { useState, useEffect } from 'react'
import './NewProjectDialog.css'

interface ProjectType {
  id: string
  name: string
  description: string
  icon: string
}

const PROJECT_TYPES: ProjectType[] = [
  { id: 'windows-app', name: '窗口程序', description: '创建一个标准的窗口应用程序', icon: '🪟' },
  { id: 'console', name: '控制台程序', description: '创建一个控制台应用程序', icon: '⬛' },
  { id: 'dll', name: '动态链接库', description: '创建一个动态链接库(.dll / .so / .dylib)', icon: '📦' },
]

interface PlatformDef {
  id: string
  name: string
  icon: string
}

const PLATFORMS: PlatformDef[] = [
  { id: 'windows', name: 'Windows', icon: '🪟' },
  { id: 'linux', name: 'Linux', icon: '🐧' },
  { id: 'macos', name: 'macOS', icon: '🍎' },
]

interface NewProjectDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (info: { name: string; path: string; type: string; platform: string }) => void
}

function NewProjectDialog({ open, onClose, onConfirm }: NewProjectDialogProps): React.JSX.Element | null {
  const [projectName, setProjectName] = useState('新项目1')
  const [projectPath, setProjectPath] = useState('')
  const [selectedType, setSelectedType] = useState('windows-app')
  const [selectedPlatform, setSelectedPlatform] = useState('windows')

  // 打开时获取默认项目路径
  useEffect(() => {
    if (open && !projectPath) {
      window.api?.project?.getDefaultPath?.().then((p: string) => {
        if (p) setProjectPath(p)
      })
    }
  }, [open])

  if (!open) return null

  const handleBrowse = async (): Promise<void> => {
    try {
      const result = await window.api?.project?.selectDirectory?.()
      if (result) setProjectPath(result)
    } catch {
      // 如果 API 不可用，忽略
    }
  }

  const handleConfirm = (): void => {
    if (!projectName.trim()) return
    onConfirm({ name: projectName.trim(), path: projectPath, type: selectedType, platform: selectedPlatform })
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter') handleConfirm()
  }

  return (
    <div className="np-dialog-overlay" onMouseDown={onClose}>
      <div className="np-dialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="np-dialog-header">
          <span className="np-dialog-title">新建项目</span>
          <button className="np-dialog-close" onClick={onClose} aria-label="关闭">&times;</button>
        </div>

        <div className="np-dialog-body">
          {/* 目标平台 */}
          <div className="np-field">
            <label>目标平台：</label>
            <div className="np-platform-row">
              {PLATFORMS.map(p => (
                <button
                  key={p.id}
                  className={`np-platform-btn ${selectedPlatform === p.id ? 'selected' : ''}`}
                  onClick={() => setSelectedPlatform(p.id)}
                >
                  <span>{p.icon}</span>
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 项目类型 */}
          <div className="np-field">
            <label>项目类型：</label>
            <div className="np-type-list">
              {PROJECT_TYPES.map(t => (
                <button
                  key={t.id}
                  className={`np-type-item ${selectedType === t.id ? 'selected' : ''}`}
                  onClick={() => setSelectedType(t.id)}
                >
                  <span className="np-type-icon">{t.icon}</span>
                  <span className="np-type-info">
                    <span className="np-type-name">{t.name}</span>
                    <span className="np-type-desc">{t.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 项目名称 */}
          <div className="np-field">
            <label>项目名称：</label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              autoFocus
              spellCheck={false}
            />
          </div>

          {/* 项目路径 */}
          <div className="np-field">
            <label>项目路径：</label>
            <div className="np-path-row">
              <input
                type="text"
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder="选择项目保存位置..."
                spellCheck={false}
              />
              <button onClick={handleBrowse}>浏览...</button>
            </div>
          </div>
        </div>

        <div className="np-dialog-footer">
          <button className="np-btn np-btn-primary" onClick={handleConfirm} disabled={!projectName.trim()}>
            确定
          </button>
          <button className="np-btn np-btn-secondary" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

export default NewProjectDialog
