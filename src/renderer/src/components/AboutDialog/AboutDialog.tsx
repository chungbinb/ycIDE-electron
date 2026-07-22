import { useEffect, useId, useRef, useState } from 'react'
import './AboutDialog.css'

type AboutInfo = {
  appVersion: string
  author: string
  license: string
  runtime: { electron: string; chromium: string; node: string; v8: string }
  zig: string
  libs: { react: string; monaco: string; xterm: string; nodePty: string; vite: string; typescript: string }
}

type AboutDialogProps = {
  open: boolean
  onClose: () => void
}

// 每个组件的显示名 + 官网。点击组件行用系统浏览器打开对应官网。
const COMPONENT_META: Record<string, { name: string; url: string }> = {
  electron: { name: 'Electron', url: 'https://www.electronjs.org' },
  chromium: { name: 'Chromium', url: 'https://www.chromium.org/Home/' },
  node: { name: 'Node.js', url: 'https://nodejs.org' },
  v8: { name: 'V8', url: 'https://v8.dev' },
  zig: { name: 'Zig', url: 'https://ziglang.org' },
  react: { name: 'React', url: 'https://react.dev' },
  monaco: { name: 'Monaco Editor', url: 'https://microsoft.github.io/monaco-editor/' },
  xterm: { name: 'xterm.js', url: 'https://xtermjs.org' },
  nodePty: { name: 'node-pty', url: 'https://github.com/microsoft/node-pty' },
  vite: { name: 'Vite', url: 'https://vite.dev' },
  typescript: { name: 'TypeScript', url: 'https://www.typescriptlang.org' },
}

const REPO_GDI = 'https://github.com/chungbinb/ycIDE'
const REPO_HTML = 'https://github.com/chungbinb/ycIDE-electron'

function openExternal(url: string): void {
  void window.api?.about?.openExternal?.(url)
}

/** 一行组件：名称 + 版本，整行可点击跳官网 */
function ComponentRow({ metaKey, version }: { metaKey: string; version: string }): React.JSX.Element {
  const meta = COMPONENT_META[metaKey]
  return (
    <button
      type="button"
      className="about-comp"
      title={`访问 ${meta.name} 官网`}
      onClick={() => openExternal(meta.url)}
    >
      <span className="about-comp-name">{meta.name}</span>
      <span className="about-comp-ver">{version || '—'}</span>
      <span className="about-comp-link" aria-hidden="true">↗</span>
    </button>
  )
}

function AboutDialog({ open, onClose }: AboutDialogProps): React.JSX.Element | null {
  const [info, setInfo] = useState<AboutInfo | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const lastFocusedRef = useRef<HTMLElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    let alive = true
    void window.api?.about?.getInfo?.().then((data: AboutInfo) => { if (alive && data) setInfo(data) }).catch(() => {})
    lastFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
    }, 0)
    return () => {
      alive = false
      lastFocusedRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div className="about-overlay" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="about-header">
          <span id={titleId} className="about-title">关于 ycIDE</span>
          <button type="button" className="about-close" onClick={onClose} aria-label="关闭">&times;</button>
        </div>

        <div className="about-body">
          {/* 品牌区 */}
          <div className="about-brand">
            <div className="about-logo" aria-hidden="true">yc</div>
            <div className="about-brand-text">
              <div className="about-name">ycIDE <span className="about-version">v{info?.appVersion ?? '…'}</span></div>
              <div className="about-tagline">易承语言集成开发环境 · 将易语言/易承语言转译为 C++ 再用 Zig 编译</div>
            </div>
          </div>

          {/* 版本区 */}
          <div className="about-section">
            <div className="about-section-title">运行时</div>
            <div className="about-comp-grid">
              <ComponentRow metaKey="electron" version={info?.runtime.electron ?? ''} />
              <ComponentRow metaKey="chromium" version={info?.runtime.chromium ?? ''} />
              <ComponentRow metaKey="node" version={info?.runtime.node ?? ''} />
              <ComponentRow metaKey="v8" version={info?.runtime.v8 ?? ''} />
            </div>
          </div>

          <div className="about-section">
            <div className="about-section-title">编译器</div>
            <div className="about-comp-grid">
              <ComponentRow metaKey="zig" version={info?.zig ?? ''} />
            </div>
          </div>

          <div className="about-section">
            <div className="about-section-title">框架与库</div>
            <div className="about-comp-grid">
              <ComponentRow metaKey="react" version={info?.libs.react ?? ''} />
              <ComponentRow metaKey="monaco" version={info?.libs.monaco ?? ''} />
              <ComponentRow metaKey="xterm" version={info?.libs.xterm ?? ''} />
              <ComponentRow metaKey="nodePty" version={info?.libs.nodePty ?? ''} />
              <ComponentRow metaKey="vite" version={info?.libs.vite ?? ''} />
              <ComponentRow metaKey="typescript" version={info?.libs.typescript ?? ''} />
            </div>
          </div>

          {/* 说明区 */}
          <div className="about-section">
            <div className="about-section-title">开源地址</div>
            <div className="about-links">
              <button type="button" className="about-link" onClick={() => openExternal(REPO_GDI)} title={REPO_GDI}>
                GitHub · GDI 版 <span className="about-comp-link" aria-hidden="true">↗</span>
              </button>
              <button type="button" className="about-link" onClick={() => openExternal(REPO_HTML)} title={REPO_HTML}>
                GitHub · html 版（当前）<span className="about-comp-link" aria-hidden="true">↗</span>
              </button>
            </div>
          </div>

          <div className="about-meta">
            <div className="about-meta-row"><span className="about-meta-key">交流群</span><span>QQ 767523155（ycIDE 易承语言交流群）</span></div>
            <div className="about-meta-row"><span className="about-meta-key">作者</span><span>{info?.author ?? 'chungbinb'}</span></div>
            <div className="about-meta-row"><span className="about-meta-key">版权</span><span>© {info?.author ?? 'chungbinb'} · 基于 {info?.license ?? 'MIT'} 协议开源</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AboutDialog
