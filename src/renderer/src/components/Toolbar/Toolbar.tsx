import { useRef } from 'react'
import './Toolbar.css'
import Icon from '../Icon/Icon'
import '../Icon/Icon.css'
import type { AlignAction } from '../Editor/VisualDesigner'
import { getPrimaryModifierLabel, getRedoShortcutLabel, type RuntimePlatform } from '../../utils/shortcuts'

import type { IconColorMode } from '../Icon/Icon'

function ToolbarIcon({ name, colorMode }: { name: string; colorMode?: IconColorMode }): React.JSX.Element {
  return <Icon name={name} className="toolbar-icon-sized" colorMode={colorMode} />
}

interface ToolbarButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  onAction?: () => void
}

function ToolbarButton({ onAction, onMouseDown, disabled, children, ...rest }: ToolbarButtonProps): React.JSX.Element {
  const skipNextMouseClickRef = useRef(false)

  return (
    <button
      {...rest}
      disabled={disabled}
      onMouseDown={(event) => {
        onMouseDown?.(event)
        if (event.defaultPrevented || disabled || event.button !== 0 || !onAction) return
        // Mouse-down executes immediately so first click is not eaten by focus/context cleanup.
        skipNextMouseClickRef.current = true
        event.preventDefault()
        onAction()
      }}
      onClick={(event) => {
        if (!onAction || disabled) return
        if (skipNextMouseClickRef.current && event.detail > 0) {
          skipNextMouseClickRef.current = false
          return
        }
        skipNextMouseClickRef.current = false
        onAction()
      }}
    >
      {children}
    </button>
  )
}

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
  canCompileRun?: boolean
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
  preserveOriginalIconColors?: boolean
}

function getToolbarIconColorMode(preserve: boolean): IconColorMode {
  return preserve ? 'preserve-accent' : 'themed'
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
  canCompileRun,
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
  preserveOriginalIconColors = false,
}: ToolbarProps): React.JSX.Element {
  const mod = getPrimaryModifierLabel(runtimePlatform)
  const redoShortcut = getRedoShortcutLabel(runtimePlatform)
  const runToCursorShortcut = `${mod}+F10`
  const canStartOrContinue = (canCompileRun ?? !!hasProject) && !isCompiling && (!isRunning || isDebugPaused)
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

  const iconMode = getToolbarIconColorMode(preserveOriginalIconColors)
  const runIconMode: IconColorMode = preserveOriginalIconColors && canStartOrContinue ? 'preserve-accent' : 'themed'
  const stopIconMode: IconColorMode = preserveOriginalIconColors && canStop ? 'preserve-accent' : 'themed'

  return (
    <div className="toolbar" role="toolbar" aria-label="工具栏">
      <div className="toolbar-group">
        <ToolbarButton className="toolbar-btn" aria-label="新建文件" title={`新建文件 (${mod}+N)`} onAction={onNew}>
          <ToolbarIcon name="new-document" colorMode={iconMode} />
        </ToolbarButton>
        <ToolbarButton className="toolbar-btn" aria-label="打开文件" title={`打开文件 (${mod}+O)`} onAction={onOpen}>
          <ToolbarIcon name="open-folder" colorMode={iconMode} />
        </ToolbarButton>
        <ToolbarButton className="toolbar-btn" aria-label="保存" title={`保存 (${mod}+S)`} onAction={onSave}>
          <ToolbarIcon name="save" colorMode={iconMode} />
        </ToolbarButton>
      </div>

      <div className="toolbar-separator" aria-hidden="true" />

      <div className="toolbar-group">
        <ToolbarButton className="toolbar-btn" aria-label="撤销" title={`撤销 (${mod}+Z)`} onAction={onUndo}>
          <ToolbarIcon name="undo" colorMode={iconMode} />
        </ToolbarButton>
        <ToolbarButton className="toolbar-btn" aria-label="重做" title={`重做 (${redoShortcut})`} onAction={onRedo}>
          <ToolbarIcon name="redo" colorMode={iconMode} />
        </ToolbarButton>
      </div>

      <div className="toolbar-separator" aria-hidden="true" />

      <div className="toolbar-group">
        <label className="toolbar-select-label" htmlFor="toolbar-platform-select">平台</label>
        <select
          id="toolbar-platform-select"
          className="toolbar-select"
          value={platform}
          onChange={e => onPlatformChange?.(e.target.value)}
          aria-label="目标平台"
          title="目标平台"
        >
          <option value="windows">Windows</option>
          <option value="macos">macOS</option>
          <option value="linux">Linux</option>
        </select>
      </div>

      <div className="toolbar-group">
        <label className="toolbar-select-label" htmlFor="toolbar-arch-select">架构</label>
        <select
          id="toolbar-arch-select"
          className="toolbar-select"
          value={arch}
          onChange={e => onArchChange?.(e.target.value)}
          aria-label="目标架构"
          title="目标架构"
        >
          {archOptions.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div className="toolbar-group">
        <ToolbarButton
          className="toolbar-btn toolbar-btn-run"
          aria-label={isDebugPaused ? '继续运行' : '编译运行'}
          title={isDebugPaused ? '继续运行 (F5)' : '编译运行 (F5)'}
          onAction={onCompileRun}
          disabled={!canStartOrContinue}
        >
          <ToolbarIcon name="run" colorMode={runIconMode} />
        </ToolbarButton>
        <ToolbarButton
          className="toolbar-btn toolbar-btn-stop"
          aria-label="停止"
          title="停止 (Shift+F5)"
          onAction={onStop}
          disabled={!canStop}
        >
          <ToolbarIcon name="stop" colorMode={stopIconMode} />
        </ToolbarButton>
      </div>

      <div className="toolbar-separator" aria-hidden="true" />

      <div className="toolbar-group">
        <ToolbarButton className="toolbar-btn" aria-label="逐过程" title="逐过程 (F10)" disabled={!canStep} onAction={onDebugStepOver}>
          <ToolbarIcon name="step-over" colorMode={iconMode} />
        </ToolbarButton>
        <ToolbarButton className="toolbar-btn" aria-label="逐语句" title="逐语句 (F11)" disabled={!canStep} onAction={onDebugStepInto}>
          <ToolbarIcon name="step-into" colorMode={iconMode} />
        </ToolbarButton>
        <ToolbarButton className="toolbar-btn" aria-label="跳出" title="跳出 (Shift+F11)" disabled={!canStep} onAction={onDebugStepOut}>
          <ToolbarIcon name="step-out" colorMode={iconMode} />
        </ToolbarButton>
        <ToolbarButton className="toolbar-btn" aria-label="运行到光标处" title={`运行到光标处 (${runToCursorShortcut})`} disabled={!canRunToCursor} onAction={onDebugRunToCursor}>
          <ToolbarIcon name="run-to-cursor" colorMode={iconMode} />
        </ToolbarButton>
      </div>

      <div className="toolbar-separator" aria-hidden="true" />

      <div className="toolbar-group">
        <ToolbarButton className="toolbar-btn" aria-label="左对齐" title="左对齐" disabled={!hasControlSelected} onAction={() => onAlign?.('align-left')}>
          <ToolbarIcon name="align-left" colorMode={iconMode} />
        </ToolbarButton>
        <ToolbarButton className="toolbar-btn" aria-label="右对齐" title="右对齐" disabled={!hasControlSelected} onAction={() => onAlign?.('align-right')}>
          <ToolbarIcon name="align-right" colorMode={iconMode} />
        </ToolbarButton>
        <ToolbarButton className="toolbar-btn" aria-label="顶端对齐" title="顶端对齐" disabled={!hasControlSelected} onAction={() => onAlign?.('align-top')}>
          <ToolbarIcon name="align-top" colorMode={iconMode} />
        </ToolbarButton>
        <ToolbarButton className="toolbar-btn" aria-label="底端对齐" title="底端对齐" disabled={!hasControlSelected} onAction={() => onAlign?.('align-bottom')}>
          <ToolbarIcon name="align-bottom" colorMode={iconMode} />
        </ToolbarButton>
        <ToolbarButton className="toolbar-btn" aria-label="水平居中" title="水平居中" disabled={!hasControlSelected} onAction={() => onAlign?.('center-h')}>
          <ToolbarIcon name="center-h" colorMode={iconMode} />
        </ToolbarButton>
        <ToolbarButton className="toolbar-btn" aria-label="垂直居中" title="垂直居中" disabled={!hasControlSelected} onAction={() => onAlign?.('center-v')}>
          <ToolbarIcon name="center-v" colorMode={iconMode} />
        </ToolbarButton>
        <ToolbarButton className="toolbar-btn" aria-label="相同宽度" title="相同宽度" disabled={!hasControlSelected} onAction={() => onAlign?.('same-width')}>
          <ToolbarIcon name="same-width" colorMode={iconMode} />
        </ToolbarButton>
        <ToolbarButton className="toolbar-btn" aria-label="相同高度" title="相同高度" disabled={!hasControlSelected} onAction={() => onAlign?.('same-height')}>
          <ToolbarIcon name="same-height" colorMode={iconMode} />
        </ToolbarButton>
        <ToolbarButton className="toolbar-btn" aria-label="相同大小" title="相同大小" disabled={!hasControlSelected} onAction={() => onAlign?.('same-size')}>
          <ToolbarIcon name="same-size" colorMode={iconMode} />
        </ToolbarButton>
      </div>
    </div>
  )
}

export default Toolbar
