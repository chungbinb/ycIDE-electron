// 网页版顶部提示条：说明能力边界，提供“重置示例”和“下载桌面版”入口。
const banner = document.createElement('div')
banner.id = 'ycide-web-banner'
banner.innerHTML = `
  <span>在线体验版 · 修改只保存在本浏览器 · 编译运行请用桌面版</span>
  <span class="ycide-web-actions">
    <button type="button" data-action="reset">重置示例</button>
    <a href="https://ycide.dev/#changelog" target="_blank" rel="noopener noreferrer">下载桌面版</a>
    <button type="button" data-action="close" aria-label="关闭提示">×</button>
  </span>`

const style = document.createElement('style')
style.textContent = `
  #ycide-web-banner {
    position: fixed; right: 12px; bottom: 30px; z-index: 99999;
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end;
    max-width: calc(100vw - 24px); padding: 4px 6px 4px 12px; border-radius: 8px;
    font: 12px/1.5 "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif;
    color: #fff; background: rgba(13, 95, 153, 0.94); box-shadow: 0 8px 24px rgba(0,0,0,.25);
  }
  #ycide-web-banner .ycide-web-actions { display: inline-flex; gap: 8px; align-items: center; }
  #ycide-web-banner button, #ycide-web-banner a {
    font: inherit; color: #fff; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.35);
    border-radius: 5px; padding: 1px 8px; cursor: pointer; text-decoration: none;
  }
  #ycide-web-banner button:hover, #ycide-web-banner a:hover { background: rgba(255,255,255,.28); }
  #ycide-web-banner [data-action="close"] { padding: 2px 8px; }
`

banner.addEventListener('click', (event) => {
  const action = (event.target as HTMLElement).closest('[data-action]')?.getAttribute('data-action')
  if (action === 'close') banner.remove()
  if (action === 'reset' && window.confirm('恢复示例项目会清除你在网页版里做的所有修改，确定吗？')) {
    ;(window as unknown as { __ycideWeb: { resetDemoProject: () => void } }).__ycideWeb.resetDemoProject()
  }
})

const mount = (): void => {
  document.head.appendChild(style)
  document.body.appendChild(banner)
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
else mount()
