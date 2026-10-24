/**
 * 插件化阶段 3 端到端验证：表格编辑器不再经 props 接收项目语义，改由 ycide.lang-eyc 语言服务提供。
 * 打开真实项目：代码引用全局变量；全局变量已声明时没有「未定义变量」错误，未声明时有——
 * 证明语言服务索引的项目符号确实送到了表格编辑器的诊断。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test, expect, _electron: electron } = require('@playwright/test')

const appRoot = path.resolve(__dirname, '..', '..')

function makeProject(declareGlobal) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycide-langsvc-'))
  fs.writeFileSync(path.join(dir, 'p.epp'), [
    '# YiCode Project File', 'Version=1', 'ProjectName=语言服务验证', 'OutputType=WindowsConsole', 'Platform=windows', '',
    'File=EYC|程序集1.eyc|0', 'File=EGV|全局变量.egv|0', '',
  ].join('\n'), 'utf-8')
  fs.writeFileSync(path.join(dir, '全局变量.egv'), ['.版本 2', '', declareGlobal ? '.全局变量 计数器, 整数型' : '', ''].join('\n'), 'utf-8')
  fs.writeFileSync(path.join(dir, '程序集1.eyc'), [
    '.版本 2', '.程序集 程序集1', '', '.子程序 _启动子程序, 整数型', '', '计数器 ＝ 计数器 ＋ 1', '返回 (0)', '',
  ].join('\n'), 'utf-8')
  return dir
}

async function openProjectAndFile(app, win, dir) {
  // 经「最近打开」命令打开项目与文件（与菜单走同一条命令路径）
  const send = (args) => app.evaluate(({ BrowserWindow }, payload) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:action', { command: 'file:openRecent', args: [payload] })
  }, args)
  await send({ type: 'project', path: path.join(dir, 'p.epp') })
  await expect(win.getByText('语言服务验证').first()).toBeVisible()
  await send({ type: 'file', path: path.join(dir, '程序集1.eyc') })
  await expect(win.locator('.eyc-table-editor')).toBeVisible()
}

for (const declared of [true, false]) {
  test(`全局变量${declared ? '已声明：没有未定义变量错误' : '未声明：报未定义变量'}`, async () => {
    const dir = makeProject(declared)
    const app = await electron.launch({ args: [appRoot], cwd: appRoot, env: { ...process.env, CI: '1' } })
    try {
      const win = await app.firstWindow()
      await win.waitForLoadState('domcontentloaded')
      await openProjectAndFile(app, win, dir)
      const status = win.locator('.statusbar')
      if (declared) {
        // 语言服务索引完成（含 300ms 防抖与读盘）后仍为 0 错误
        await win.waitForTimeout(1500)
        await expect(status).toContainText('0 错误')
      } else {
        await expect(status).not.toContainText(' 0 错误', { timeout: 10000 })
        await win.getByRole('tab', { name: /问题/ }).click().catch(() => {})
        await expect(win.getByText(/未定义变量"计数器"/).first()).toBeVisible()
      }
    } finally {
      await app.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
}
