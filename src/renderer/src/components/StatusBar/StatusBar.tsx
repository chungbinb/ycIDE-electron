import { useEffect, useRef, useState } from 'react'
import './StatusBar.css'

interface StatusBarProps {
  onToggleOutput: () => void
  errorCount?: number
  warningCount?: number
  cursorLine?: number
  cursorColumn?: number
  docType?: string
  workspaceModeLabel?: string
  fileEncodingLabel?: string
  encodingOptions?: string[]
  onReopenWithEncoding?: (encoding: string) => void
}

function StatusBar({
  onToggleOutput,
  errorCount = 0,
  warningCount = 0,
  cursorLine,
  cursorColumn,
  docType,
  workspaceModeLabel,
  fileEncodingLabel,
  encodingOptions = [],
  onReopenWithEncoding,
}: StatusBarProps): React.JSX.Element {
  const [showEncodingMenu, setShowEncodingMenu] = useState(false)
  const encodingMenuRef = useRef<HTMLDivElement | null>(null)
  const canReopenWithEncoding = !!fileEncodingLabel && !!onReopenWithEncoding && encodingOptions.length > 0

  useEffect(() => {
    if (!showEncodingMenu) return

    const handlePointerDown = (event: MouseEvent): void => {
      if (!encodingMenuRef.current?.contains(event.target as Node)) {
        setShowEncodingMenu(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setShowEncodingMenu(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showEncodingMenu])

  return (
    <footer className="statusbar" role="contentinfo" aria-label="状态栏">
      <div className="statusbar-left">
        <button className="statusbar-item" onClick={onToggleOutput}>
          <span aria-hidden="true">⚡</span> 就绪
        </button>
        <span className={`statusbar-item${errorCount > 0 ? ' statusbar-error' : ''}`}>
          <span aria-hidden="true">⚠</span> {errorCount} 错误, {warningCount} 警告
        </span>
      </div>
      <div className="statusbar-right">
        {workspaceModeLabel && <span className="statusbar-item statusbar-mode">{workspaceModeLabel}</span>}
        {fileEncodingLabel && (
          <div className="statusbar-encoding" ref={encodingMenuRef}>
            <button
              type="button"
              className="statusbar-item statusbar-encoding-button"
              title={canReopenWithEncoding ? '点击使用其它编码重新打开当前文件' : '当前活动文件编码'}
              aria-label={`当前文件编码 ${fileEncodingLabel}`}
              onClick={() => {
                if (!canReopenWithEncoding) return
                setShowEncodingMenu(prev => !prev)
              }}
            >
              {fileEncodingLabel}
            </button>
            {canReopenWithEncoding && showEncodingMenu && (
              <div className="statusbar-encoding-menu" role="menu" aria-label="选择编码重新打开">
                {encodingOptions.map((encoding) => {
                  const active = encoding.toLowerCase() === fileEncodingLabel.toLowerCase()
                  return (
                    <button
                      key={encoding}
                      type="button"
                      role="menuitem"
                      className={`statusbar-encoding-option${active ? ' is-active' : ''}`}
                      onClick={() => {
                        onReopenWithEncoding?.(encoding)
                        setShowEncodingMenu(false)
                      }}
                    >
                      {encoding}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
        {cursorLine !== undefined && cursorColumn !== undefined && (
          <span className="statusbar-item">行 {cursorLine}, 列 {cursorColumn}</span>
        )}
        {docType && <span className="statusbar-item">{docType}</span>}
        <span className="statusbar-item">ycIDE v0.0.3-beta.54</span>
      </div>
    </footer>
  )
}

export default StatusBar
