import './StatusBar.css'

interface StatusBarProps {
  onToggleOutput: () => void
  errorCount?: number
  warningCount?: number
  cursorLine?: number
  cursorColumn?: number
  docType?: string
}

function StatusBar({ onToggleOutput, errorCount = 0, warningCount = 0, cursorLine, cursorColumn, docType }: StatusBarProps): React.JSX.Element {
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
        {cursorLine !== undefined && cursorColumn !== undefined && (
          <span className="statusbar-item">行 {cursorLine}, 列 {cursorColumn}</span>
        )}
        {docType && <span className="statusbar-item">{docType}</span>}
        <span className="statusbar-item">ycIDE v0.0.1.43</span>
      </div>
    </footer>
  )
}

export default StatusBar
