/**
 * 插件化阶段 3 端到端验证：编辑器提供者与插件网页编辑器。
 * 示例插件 demo.upper-editor 为文本文件提供一个网页编辑器（沙箱 iframe，ycide-plugin:// 协议加载），
 * 经标签页右键「打开方式」切换过去，在编辑器里修改内容，修改经 postMessage 回到宿主文档；再切回文本编辑器能看到修改。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test, expect, _electron: electron } = require('@playwright/test')

const appRoot = path.resolve(__dirname, '..', '..')

test('插件网页编辑器：打开方式切换、编辑内容回到文档、沙箱隔离', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycide-webeditor-'))
  const file = path.join(dir, '说明.txt')
  fs.writeFileSync(file, 'hello plugin editor', 'utf-8')
  const app = await electron.launch({
    args: [appRoot],
    cwd: appRoot,
    env: { ...process.env, CI: '1', YCIDE_EXTRA_PLUGIN_DIRS: path.join(appRoot, 'tests', 'fixtures', 'plugins') },
  })
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu:action', { command: 'file:openRecent', args: [{ type: 'file', path: filePath }] })
    }, file)
    const tab = win.locator('.editor-tab', { hasText: '说明' })
    await expect(tab).toBeVisible()

    // 右键「打开方式」：内置文本编辑器 + 插件提供的大写编辑器
    await tab.click({ button: 'right' })
    const menu = win.locator('.editor-tab-context-menu')
    await expect(menu.getByText('✓ 打开方式：文本编辑器')).toBeVisible()
    await menu.getByText('打开方式：大写编辑器（示例）').click()

    const frame = win.frameLocator('iframe.plugin-web-editor')
    await expect(frame.locator('#label')).toHaveText('说明.txt')
    await expect(frame.locator('#text')).toHaveValue('hello plugin editor')
    // 沙箱：插件页面拿不到宿主页面
    const frameEl = win.locator('iframe.plugin-web-editor')
    await expect(frameEl).toHaveAttribute('sandbox', 'allow-scripts')
    await expect(frameEl).toHaveAttribute('src', /^ycide-plugin:\/\/demo\.upper-editor\/ui\/editor\.html$/)

    await frame.getByRole('button', { name: '转大写' }).click()
    await expect(tab.locator('.editor-tab-modified')).toBeVisible()

    // 切回文本编辑器，能看到插件编辑器改过的内容
    await tab.click({ button: 'right' })
    await win.locator('.editor-tab-context-menu').getByText('打开方式：文本编辑器').click()
    await expect(win.locator('.monaco-editor .view-lines')).toContainText('HELLO PLUGIN EDITOR')

    // 崩溃回退：编辑器报告出错 → 自动改用文本编辑器并提示，可以重试
    await tab.click({ button: 'right' })
    await win.locator('.editor-tab-context-menu').getByText('打开方式：会出错的编辑器（示例）').click()
    const banner = win.locator('.editor-eyc-fallback-banner')
    await expect(banner).toContainText('「会出错的编辑器（示例）」出错（初始化失败（测试））')
    await expect(win.locator('.monaco-editor .view-lines')).toContainText('HELLO PLUGIN EDITOR')
    await banner.getByRole('button', { name: '重试' }).click()
    await expect(banner).toContainText('出错')
  } finally {
    // 文档有未保存修改：直接销毁窗口，避免「是否保存」原生对话框挡住关闭
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {})
    await app.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
