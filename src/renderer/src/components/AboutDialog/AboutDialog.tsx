import { useEffect, useId, useRef, useState } from 'react'
import './AboutDialog.css'
import ycideLogo from '../../assets/icons/YcideLogo.png'
import { COMPONENT_LOGOS } from './componentLogos'

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

/** 随仓库附带/引用的开源项目（关于页致谢用） */
const REFERENCED_PROJECTS: Array<{ name: string; desc: string; url: string }> = [
  { name: 'e-packager', desc: '易语言 .e/.ec 解包 / 回包工具（MIT · aiqinxuancai）', url: 'https://github.com/aiqinxuancai/e-packager' },
  { name: 'EProjectFile', desc: '易语言项目文件读写库（公共领域 · QIQI/OpenEpl）', url: 'https://github.com/OpenEpl/EProjectFile' },
]

type DragOffset = { x: number; y: number }

/** 计算未位移时的对话框盒模型（getBoundingClientRect 含 transform，需扣除当前偏移） */
function getBaseBox(el: HTMLElement, offset: DragOffset): { left: number; top: number; right: number; bottom: number } {
  const rect = el.getBoundingClientRect()
  return {
    left: rect.left - offset.x,
    top: rect.top - offset.y,
    right: rect.right - offset.x,
    bottom: rect.bottom - offset.y,
  }
}

/** 把偏移钳制在「对话框完全位于窗口内」的范围内 */
function clampOffset(box: { left: number; top: number; right: number; bottom: number }, offset: DragOffset): DragOffset {
  return {
    x: Math.min(Math.max(offset.x, -box.left), window.innerWidth - box.right),
    y: Math.min(Math.max(offset.y, -box.top), window.innerHeight - box.bottom),
  }
}

function applyDragTransform(el: HTMLElement, offset: DragOffset): void {
  el.style.transform = offset.x === 0 && offset.y === 0 ? '' : `translate(${offset.x}px, ${offset.y}px)`
}

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
      <span className="about-comp-icon" aria-hidden="true">{COMPONENT_LOGOS[metaKey]}</span>
      <span className="about-comp-name">{meta.name}</span>
      <span className="about-comp-ver">{version || '—'}</span>
      <span className="about-comp-link" aria-hidden="true">↗</span>
    </button>
  )
}

function AboutDialog({ open, onClose }: AboutDialogProps): React.JSX.Element | null {
  const [info, setInfo] = useState<AboutInfo | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const dragOffsetRef = useRef<DragOffset>({ x: 0, y: 0 })
  const lastFocusedRef = useRef<HTMLElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    // 每次打开都从居中位置开始，不保留上次的拖拽偏移
    dragOffsetRef.current = { x: 0, y: 0 }
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

  // 主窗口尺寸变化时，把已移出的对话框拉回可视范围
  useEffect(() => {
    if (!open) return
    const handleResize = (): void => {
      const el = dialogRef.current
      if (!el) return
      const clamped = clampOffset(getBaseBox(el, dragOffsetRef.current), dragOffsetRef.current)
      dragOffsetRef.current = clamped
      applyDragTransform(el, clamped)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [open])

  if (!open) return null

  const handleHeaderPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    // 标题栏上的关闭按钮不作为拖拽把手
    if (event.target instanceof Element && event.target.closest('button')) return
    const el = dialogRef.current
    if (!el) return
    event.preventDefault()
    el.setPointerCapture(event.pointerId)
    const startPointerX = event.clientX
    const startPointerY = event.clientY
    const startOffset = { ...dragOffsetRef.current }
    const baseBox = getBaseBox(el, startOffset)

    const handleMove = (moveEvent: PointerEvent): void => {
      const next = clampOffset(baseBox, {
        x: startOffset.x + moveEvent.clientX - startPointerX,
        y: startOffset.y + moveEvent.clientY - startPointerY,
      })
      dragOffsetRef.current = next
      applyDragTransform(el, next)
    }
    const stopDrag = (): void => {
      el.removeEventListener('pointermove', handleMove)
      el.removeEventListener('pointerup', stopDrag)
      el.removeEventListener('pointercancel', stopDrag)
    }
    el.addEventListener('pointermove', handleMove)
    el.addEventListener('pointerup', stopDrag)
    el.addEventListener('pointercancel', stopDrag)
  }

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
        <div className="about-header" onPointerDown={handleHeaderPointerDown}>
          <span id={titleId} className="about-title">关于 ycIDE</span>
          <button type="button" className="about-close" onClick={onClose} aria-label="关闭">&times;</button>
        </div>

        <div className="about-body">
          {/* 品牌区 */}
          <div className="about-brand">
            <img className="about-logo" src={ycideLogo} alt="ycIDE" draggable={false} />
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

          {/* 引用的开源项目 */}
          <div className="about-section">
            <div className="about-section-title">引用的开源项目</div>
            <div className="about-links">
              {REFERENCED_PROJECTS.map((project) => (
                <button
                  key={project.name}
                  type="button"
                  className="about-link about-link-project"
                  onClick={() => openExternal(project.url)}
                  title={project.url}
                >
                  <span className="about-link-main">
                    {project.name} <span className="about-comp-link" aria-hidden="true">↗</span>
                  </span>
                  <span className="about-link-sub">{project.desc}</span>
                </button>
              ))}
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
