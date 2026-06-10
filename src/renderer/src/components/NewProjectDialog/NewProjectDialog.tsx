import { useState, useEffect, useId, useRef } from 'react'
import './NewProjectDialog.css'

type ProjectPlatformGroup = 'desktop' | 'mobile'

interface ProjectType {
  id: string
  name: string
  description: string
  icon: string
}

const DESKTOP_PROJECT_TYPES: ProjectType[] = [
  { id: 'windows-app', name: '窗口程序', description: '创建一个标准的窗口应用程序', icon: '🪟' },
  { id: 'console', name: '控制台程序', description: '创建一个控制台应用程序', icon: '⬛' },
  { id: 'dll', name: '动态链接库', description: '创建一个动态链接库(.dll / .so / .dylib)', icon: '📦' },
]

const MOBILE_PROJECT_TYPES: ProjectType[] = [
  { id: 'mobile-app', name: '移动应用', description: '创建一个面向移动端的应用项目', icon: 'APP' },
  { id: 'mobile-native-module', name: '原生模块', description: '创建一个可被移动应用调用的原生功能模块', icon: 'MOD' },
  { id: 'mobile-shared-library', name: '共享库', description: '创建一个移动端共享库项目', icon: 'LIB' },
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
  { id: 'android', name: 'Android', icon: 'A' },
  { id: 'ios', name: 'iOS', icon: 'iOS' },
  { id: 'harmony', name: 'HarmonyOS', icon: 'H' },
]

function getPlatformGroup(platform: string): ProjectPlatformGroup {
  return platform === 'android' || platform === 'ios' || platform === 'harmony' ? 'mobile' : 'desktop'
}

function getProjectTypes(platform: string): ProjectType[] {
  return getPlatformGroup(platform) === 'mobile' ? MOBILE_PROJECT_TYPES : DESKTOP_PROJECT_TYPES
}

const PROJECT_TYPE_NAME_PART: Record<string, string> = {
  'windows-app': '窗口程序',
  console: '控制台程序',
  dll: '动态链接库',
  'mobile-app': '移动应用',
  'mobile-native-module': '原生模块',
  'mobile-shared-library': '共享库',
}

function buildDefaultProjectNameBase(platform: string, type: string): string {
  return `${platform}${PROJECT_TYPE_NAME_PART[type] || '项目'}-新项目`
}

async function resolveDefaultProjectName(platform: string, type: string, path: string): Promise<string> {
  const baseName = buildDefaultProjectNameBase(platform, type)
  for (let index = 1; index <= 999; index++) {
    const candidate = `${baseName}${index}`
    if (!path || !window.api?.project?.checkCreateTarget) return candidate
    try {
      const target = await window.api.project.checkCreateTarget({ name: candidate, path })
      if (!target?.exists) return candidate
    } catch {
      return candidate
    }
  }
  return `${baseName}${Date.now()}`
}

interface NewProjectDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (info: { name: string; path: string; type: string; platform: string }) => void | boolean | Promise<void | boolean>
}

function NewProjectDialog({ open, onClose, onConfirm }: NewProjectDialogProps): React.JSX.Element | null {
  const [projectName, setProjectName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [selectedType, setSelectedType] = useState('windows-app')
  const [selectedPlatform, setSelectedPlatform] = useState('windows')
  const projectTypes = getProjectTypes(selectedPlatform)
  const dialogRef = useRef<HTMLDivElement>(null)
  const lastFocusedRef = useRef<HTMLElement | null>(null)
  const autoProjectNameRef = useRef(true)
  const defaultNameRequestRef = useRef(0)
  const wasOpenRef = useRef(false)
  const titleId = useId()
  const descriptionId = useId()
  const nameInputId = useId()
  const pathInputId = useId()

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      autoProjectNameRef.current = true
      setProjectName('')
    }
    wasOpenRef.current = open
  }, [open])

  // 打开时获取默认项目路径
  useEffect(() => {
    if (open && !projectPath) {
      window.api?.project?.getDefaultPath?.().then((p: string) => {
        if (p) setProjectPath(p)
      })
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    lastFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      lastFocusedRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    const nextTypes = getProjectTypes(selectedPlatform)
    if (!nextTypes.some(type => type.id === selectedType)) {
      setSelectedType(nextTypes[0]?.id || 'windows-app')
    }
  }, [selectedPlatform, selectedType])

  useEffect(() => {
    if (!open || !autoProjectNameRef.current) return
    const requestId = ++defaultNameRequestRef.current
    let cancelled = false

    resolveDefaultProjectName(selectedPlatform, selectedType, projectPath).then((name) => {
      if (cancelled || requestId !== defaultNameRequestRef.current || !autoProjectNameRef.current) return
      setProjectName(name)
    })

    return () => {
      cancelled = true
    }
  }, [open, selectedPlatform, selectedType, projectPath])

  if (!open) return null

  const handleBrowse = async (): Promise<void> => {
    try {
      const result = await window.api?.project?.selectDirectory?.()
      if (result) setProjectPath(result)
    } catch {
      // 如果 API 不可用，忽略
    }
  }

  const handleConfirm = async (): Promise<void> => {
    if (!projectName.trim()) return
    const result = await onConfirm({ name: projectName.trim(), path: projectPath, type: selectedType, platform: selectedPlatform })
    if (result !== false) onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      onClose()
      return
    }

    if (e.key === 'Enter') {
      handleConfirm()
      return
    }

    if (e.key !== 'Tab') return
    const root = dialogRef.current
    if (!root) return
    const focusable = root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )
    if (!focusable.length) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const current = document.activeElement

    if (e.shiftKey && current === first) {
      e.preventDefault()
      last.focus()
      return
    }

    if (!e.shiftKey && current === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="np-dialog-overlay" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="np-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="np-dialog-header">
          <span id={titleId} className="np-dialog-title">新建项目</span>
          <button className="np-dialog-close" onClick={onClose} aria-label="关闭">&times;</button>
        </div>

        <div className="np-dialog-body">
          <p id={descriptionId} className="sr-only">设置项目平台、类型、名称和保存路径，然后确认创建项目。</p>
          {/* 目标平台 */}
          <div className="np-field">
            <span className="np-field-label">目标平台：</span>
            <div className="np-platform-row" aria-label="目标平台">
              {PLATFORMS.map(p => (
                <button
                  key={p.id}
                  type="button"
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
            <span className="np-field-label">项目类型：</span>
            <div className="np-type-list" aria-label="项目类型">
              {projectTypes.map(t => (
                <button
                  key={t.id}
                  type="button"
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
            <label htmlFor={nameInputId}>项目名称：</label>
            <input
              id={nameInputId}
              type="text"
              value={projectName}
              onChange={(e) => {
                autoProjectNameRef.current = false
                setProjectName(e.target.value)
              }}
              autoFocus
              spellCheck={false}
            />
          </div>

          {/* 项目路径 */}
          <div className="np-field">
            <label htmlFor={pathInputId}>项目路径：</label>
            <div className="np-path-row">
              <input
                id={pathInputId}
                type="text"
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder="选择项目保存位置..."
                spellCheck={false}
              />
              <button type="button" onClick={handleBrowse} aria-label="浏览项目保存位置">浏览...</button>
            </div>
          </div>
        </div>

        <div className="np-dialog-footer">
          <button type="button" className="np-btn np-btn-primary" onClick={handleConfirm} disabled={!projectName.trim()} aria-label="确认创建项目">
            确定
          </button>
          <button type="button" className="np-btn np-btn-secondary" onClick={onClose} aria-label="取消创建项目">
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

export default NewProjectDialog
