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
  hasProject?: boolean
  isCompiling?: boolean
  isRunning?: boolean
  arch?: string
  onArchChange?: (arch: string) => void
  onNew?: () => void
  onOpen?: () => void
  onSave?: () => void
  onUndo?: () => void
  onRedo?: () => void
}

function Toolbar({ runtimePlatform = 'windows', hasControlSelected = false, onAlign, onCompileRun, onStop, hasProject = false, isCompiling = false, isRunning = false, arch = 'x64', onArchChange, onNew, onOpen, onSave, onUndo, onRedo }: ToolbarProps): React.JSX.Element {
  const mod = getPrimaryModifierLabel(runtimePlatform)
  const redoShortcut = getRedoShortcutLabel(runtimePlatform)
  const runToCursorShortcut = `${mod}+F10`

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
          value={arch}
          onChange={e => onArchChange?.(e.target.value)}
          title="目标架构"
        >
          <option value="x64">x64</option>
          <option value="x86">x86</option>
          <option value="arm64">arm64</option>
        </select>
      </div>

      <div className="toolbar-group">
        <button className="toolbar-btn toolbar-btn-run" aria-label="编译运行" title="编译运行 (F5)" onClick={onCompileRun} disabled={!hasProject || isCompiling || isRunning}>
          <Icon name="run" size={16} />
        </button>
        <button className="toolbar-btn toolbar-btn-stop" aria-label="停止" title="停止" onClick={onStop} disabled={!isRunning}>
          <Icon name="stop" size={16} />
        </button>
      </div>

      <div className="toolbar-separator" aria-hidden="true" />

      <div className="toolbar-group">
        <button className="toolbar-btn" aria-label="单步" title="单步 (F10)" disabled={!hasProject || !isRunning}>
          <Icon name="step-over" size={16} />
        </button>
        <button className="toolbar-btn" aria-label="跟踪" title="跟踪 (F11)" disabled={!hasProject || !isRunning}>
          <Icon name="step-into" size={16} />
        </button>
        <button className="toolbar-btn" aria-label="跟踪返回" title="跟踪返回 (Shift+F11)" disabled={!hasProject || !isRunning}>
          <Icon name="step-out" size={16} />
        </button>
        <button className="toolbar-btn" aria-label="运行到光标处" title={`运行到光标处 (${runToCursorShortcut})`} disabled={!hasProject || !isRunning}>
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
