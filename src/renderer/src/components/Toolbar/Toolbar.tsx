import './Toolbar.css'
import Icon from '../Icon/Icon'
import '../Icon/Icon.css'
import type { AlignAction } from '../Editor/VisualDesigner'
import { getPrimaryModifierLabel, getRedoShortcutLabel, type RuntimePlatform } from '../../utils/shortcuts'

interface ToolbarProps {
  runtimePlatform?: RuntimePlatform
  hasControlSelected?: boolean
  onAlign?: (action: AlignAction) => void
  onCompileRun?: () => void
  onStop?: () => void
  onDebugStepOver?: () => void
  onDebugStepInto?: () => void
  onDebugStepOut?: () => void
  onDebugRunToCursor?: () => void
  hasProject?: boolean
  isCompiling?: boolean
  isRunning?: boolean
  isDebugPaused?: boolean
  platform?: string
  arch?: string
  onPlatformChange?: (platform: string) => void
  onArchChange?: (arch: string) => void
  onNew?: () => void
  onOpen?: () => void
  onSave?: () => void
  onUndo?: () => void
  onRedo?: () => void
}

function Toolbar({
  runtimePlatform = 'windows',
  hasControlSelected = false,
  onAlign,
  onCompileRun,
  onStop,
  onDebugStepOver,
  onDebugStepInto,
  onDebugStepOut,
  onDebugRunToCursor,
  hasProject = false,
  isCompiling = false,
  isRunning = false,
  isDebugPaused = false,
  platform = 'windows',
  arch = 'x64',
  onPlatformChange,
  onArchChange,
  onNew,
  onOpen,
  onSave,
  onUndo,
  onRedo,
}: ToolbarProps): React.JSX.Element {
  const mod = getPrimaryModifierLabel(runtimePlatform)
  const redoShortcut = getRedoShortcutLabel(runtimePlatform)
  const runToCursorShortcut = `${mod}+F10`
  const canStartOrContinue = !!hasProject && !isCompiling && (!isRunning || isDebugPaused)
  const canStop = !!isRunning
  const canStep = !!hasProject && !!isDebugPaused
  const canRunToCursor = !!hasProject && !isCompiling && !isRunning
  const archOptions = platform === 'macos'
    ? [{ value: 'arm64', label: 'arm64' }]
    : [
      { value: 'x64', label: 'x64' },
      { value: 'x86', label: 'x86' },
      { value: 'arm64', label: 'arm64' },
    ]

  return (
    <div className="toolbar" role="toolbar" aria-label="工具栏">
      <div className="toolbar-group">
        <button className="toolbar-btn" aria-label="新建" title={`新建 (${mod}+Shift+N)`} onClick={onNew}>
          <Icon name="new-document" size={16} />
        </button>
        <button className="toolbar-btn" aria-label="打开" title={`打开 (${mod}+Shift+O)`} onClick={onOpen}>
          <Icon name="open-folder" size={16} />
        </button>
        <button className="toolbar-btn" aria-label="保存" title={`保存 (${mod}+S)`} onClick={onSave}>
          <Icon name="save" size={16} />
        </button>
      </div>

      <div className="toolbar-separator" aria-hidden="true" />

      <div className="toolbar-group">
        <button className="toolbar-btn" aria-label="撤销" title={`撤销 (${mod}+Z)`} onClick={onUndo}>
          <Icon name="undo" size={16} />
        </button>
        <button className="toolbar-btn" aria-label="重做" title={`重做 (${redoShortcut})`} onClick={onRedo}>
          <Icon name="redo" size={16} />
        </button>
      </div>

      <div className="toolbar-separator" aria-hidden="true" />

      <div className="toolbar-group">
        <select
          className="toolbar-select"
          value={platform}
          onChange={e => onPlatformChange?.(e.target.value)}
          title="目标平台"
        >
          <option value="windows">Windows</option>
          <option value="macos">macOS</option>
          <option value="linux">Linux</option>
        </select>
      </div>

      <div className="toolbar-group">
        <select
          className="toolbar-select"
          value={arch}
          onChange={e => onArchChange?.(e.target.value)}
          title="目标架构"
        >
          {archOptions.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div className="toolbar-group">
        <button
          className="toolbar-btn toolbar-btn-run"
          aria-label={isDebugPaused ? '继续运行' : '编译运行'}
          title={isDebugPaused ? '继续运行 (F5)' : '编译运行 (F5)'}
          onClick={onCompileRun}
          disabled={!canStartOrContinue}
        >
          <Icon name="run" size={16} />
        </button>
        <button
          className="toolbar-btn toolbar-btn-stop"
          aria-label="停止"
          title="停止 (Shift+F5)"
          onClick={onStop}
          disabled={!canStop}
        >
          <Icon name="stop" size={16} />
        </button>
      </div>

      <div className="toolbar-separator" aria-hidden="true" />

      <div className="toolbar-group">
        <button className="toolbar-btn" aria-label="逐过程" title="逐过程 (F10)" disabled={!canStep} onClick={onDebugStepOver}>
          <Icon name="step-over" size={16} />
        </button>
        <button className="toolbar-btn" aria-label="逐语句" title="逐语句 (F11)" disabled={!canStep} onClick={onDebugStepInto}>
          <Icon name="step-into" size={16} />
        </button>
        <button className="toolbar-btn" aria-label="跳出" title="跳出 (Shift+F11)" disabled={!canStep} onClick={onDebugStepOut}>
          <Icon name="step-out" size={16} />
        </button>
        <button className="toolbar-btn" aria-label="运行到光标处" title={`运行到光标处 (${runToCursorShortcut})`} disabled={!canRunToCursor} onClick={onDebugRunToCursor}>
          <Icon name="run-to-cursor" size={16} />
        </button>
      </div>

      <div className="toolbar-separator" aria-hidden="true" />

      <div className="toolbar-group">
        <button className="toolbar-btn" aria-label="左对齐" title="左对齐" disabled={!hasControlSelected} onClick={() => onAlign?.('align-left')}>
          <Icon name="align-left" size={16} />
        </button>
        <button className="toolbar-btn" aria-label="右对齐" title="右对齐" disabled={!hasControlSelected} onClick={() => onAlign?.('align-right')}>
          <Icon name="align-right" size={16} />
        </button>
        <button className="toolbar-btn" aria-label="顶端对齐" title="顶端对齐" disabled={!hasControlSelected} onClick={() => onAlign?.('align-top')}>
          <Icon name="align-top" size={16} />
        </button>
        <button className="toolbar-btn" aria-label="底端对齐" title="底端对齐" disabled={!hasControlSelected} onClick={() => onAlign?.('align-bottom')}>
          <Icon name="align-bottom" size={16} />
        </button>
        <button className="toolbar-btn" aria-label="水平居中" title="水平居中" disabled={!hasControlSelected} onClick={() => onAlign?.('center-h')}>
          <Icon name="center-h" size={16} />
        </button>
        <button className="toolbar-btn" aria-label="垂直居中" title="垂直居中" disabled={!hasControlSelected} onClick={() => onAlign?.('center-v')}>
          <Icon name="center-v" size={16} />
        </button>
        <button className="toolbar-btn" aria-label="相同宽度" title="相同宽度" disabled={!hasControlSelected} onClick={() => onAlign?.('same-width')}>
          <Icon name="same-width" size={16} />
        </button>
        <button className="toolbar-btn" aria-label="相同高度" title="相同高度" disabled={!hasControlSelected} onClick={() => onAlign?.('same-height')}>
          <Icon name="same-height" size={16} />
        </button>
        <button className="toolbar-btn" aria-label="相同大小" title="相同大小" disabled={!hasControlSelected} onClick={() => onAlign?.('same-size')}>
          <Icon name="same-size" size={16} />
        </button>
      </div>
    </div>
  )
}

export default Toolbar
