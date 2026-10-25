/**
 * 插件化阶段 5 端到端验证（真启动 IDE，独立的用户数据目录，不碰本机配置）：
 *   1. 用户插件目录里申请了权限的第三方插件先「等待授权」，在插件管理里确认权限后才启用；
 *   2. 它运行在受限进程里：只能读自己的目录、只能写自己的存储目录、不能启动程序、拿不到 IDE 的环境变量，
 *      只能访问清单里声明的域名，不能执行未授权的内置命令；
 *   3. 商店里带发布者签名的主题包：确认后安装、主题可用、可以卸载。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const AdmZip = require('adm-zip')
const { test, expect, _electron: electron } = require('@playwright/test')

const appRoot = path.resolve(__dirname, '..', '..')
const fixtures = path.join(appRoot, 'tests', 'fixtures', 'plugins-phase5')

function zipDir(dir) {
  const zip = new AdmZip()
  zip.addLocalFolder(dir)
  return zip.toBuffer()
}

test('第三方插件：授权后启用、受限进程拦下越权操作；商店签名主题包安装与卸载', async () => {
  test.setTimeout(180000)
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ycide-phase5-userdata-'))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ycide-phase5-outside-'))
  const outsideFile = path.join(outside, 'secret.txt')
  fs.writeFileSync(outsideFile, '机密', 'utf-8')
  fs.cpSync(path.join(fixtures, 'acme.sandbox'), path.join(userData, 'plugins', 'acme.sandbox'), { recursive: true })

  // 本地商店：索引 + 签名的主题包；另有一个供插件联网测试的接口
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const themeZip = zipDir(path.join(fixtures, 'acme.night-theme'))
  const themeSha = crypto.createHash('sha256').update(themeZip).digest('hex')
  const server = http.createServer((req, res) => {
    if (req.url === '/ping') return res.end('pong')
    if (req.url === '/night.zip') return res.end(themeZip)
    if (req.url === '/index.json') {
      return res.end(JSON.stringify({
        schemaVersion: '1.0',
        publishers: { acme: publicKey.export({ format: 'der', type: 'spki' }).toString('base64') },
        libraries: [{
          id: 'acme.night-theme', kind: 'theme', displayName: '午夜主题（测试）', version: '1.0.0', publisher: 'acme',
          packageFileName: 'night.zip', packageUrl: `http://127.0.0.1:${server.address().port}/night.zip`, packageSha256: themeSha,
          signature: crypto.sign(null, Buffer.from(themeSha), privateKey).toString('base64'), supportedPlatforms: ['windows', 'linux', 'macos'],
          summary: '测试用主题包',
        }],
      }))
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  fs.writeFileSync(path.join(userData, 'ide-settings.json'), JSON.stringify({ libraryStoreIndexUrl: `http://127.0.0.1:${port}/index.json` }), 'utf-8')

  const app = await electron.launch({
    args: [appRoot, `--user-data-dir=${userData}`],
    cwd: appRoot,
    env: { ...process.env, CI: '1', YCIDE_TEST_SECRET: 'ide-only' },
  })
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await expect(win.locator('.titlebar')).toBeVisible()

    // 1. 插件管理里等待授权 → 确认权限 → 启用
    await win.getByRole('menuitem', { name: '工具(T)', exact: true }).click()
    await win.getByRole('menuitem', { name: /插件管理/ }).click()
    const dialog = win.getByRole('dialog', { name: '插件管理' })
    const item = dialog.locator('[data-plugin-id="acme.sandbox"]')
    await expect(item.locator('.pm-status')).toHaveText('等待授权')
    await expect(item).toContainText('访问 127.0.0.1')
    await item.getByRole('button', { name: '授权并启用' }).click()
    const consent = win.getByRole('alertdialog', { name: '确认权限' })
    await expect(consent).toContainText('net:127.0.0.1')
    await consent.getByRole('button', { name: '同意并启用' }).click()
    await expect(item.locator('.pm-status')).toHaveText('已启用')
    await expect(item).toContainText('受限进程')

    // 2. 受限进程里的越权操作被拦下
    const result = await win.evaluate(args => window.api.plugins.executeCommand('sandbox:probe', [args]), {
      outsideFile,
      outsideDir: outside,
      allowedUrl: `http://127.0.0.1:${port}/ping`,
      deniedUrl: `http://localhost:${port}/ping`,
    })
    expect(result).toMatchObject({
      readOwn: true,
      readOutside: 'DENIED:ERR_ACCESS_DENIED',
      writeStorage: 'ok',
      writeOutside: 'DENIED:ERR_ACCESS_DENIED',
      spawn: 'DENIED:ERR_ACCESS_DENIED',
      envSecret: 'absent',
      fetchAllowed: 'pong',
      fetchDenied: 'DENIED:ERR_ACCESS_DENIED',
      workbench: 'DENIED:-33001',
      udpAllowed: 'sent',
      udpDenied: 'DENIED:ERR_ACCESS_DENIED',
      dnsDenied: 'DENIED:ERR_ACCESS_DENIED',
    })
    expect(fs.existsSync(path.join(outside, 'probe.txt'))).toBe(false)
    expect(fs.readFileSync(path.join(userData, 'plugin-storage', 'acme.sandbox', 'probe.txt'), 'utf-8')).toBe('ok')

    // 3. 商店：签名主题包 → 确认 → 安装 → 主题可用 → 卸载
    await dialog.getByRole('tab', { name: '商店' }).click()
    const card = dialog.locator('[data-store-id="acme.night-theme"]')
    await expect(card).toContainText('已签名')
    await card.getByRole('button', { name: '安装' }).click()
    await win.getByRole('alertdialog', { name: '确认权限' }).getByRole('button', { name: '同意并安装' }).click()
    await expect(dialog.locator('.pm-message')).toHaveText('已安装 午夜主题（测试）')
    await expect.poll(() => win.evaluate(async () => Object.entries(await window.api.theme.getSources()).filter(([, src]) => src === 'plugin').map(([id]) => id))).toContain('午夜测试')
    await dialog.getByRole('tab', { name: '已安装' }).click()
    const installed = dialog.locator('[data-plugin-id="acme.night-theme"]')
    await installed.getByRole('button', { name: '卸载' }).click()
    await expect(dialog.locator('.pm-message')).toHaveText('已卸载 午夜主题（测试）')
    await expect(installed).toHaveCount(0)
    expect(fs.existsSync(path.join(userData, 'plugins', 'acme.night-theme'))).toBe(false)
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {})
    await app.close()
    server.close()
    fs.rmSync(outside, { recursive: true, force: true })
    fs.rmSync(userData, { recursive: true, force: true })
  }
})

test('开发中的插件改了代码自动重新加载（YCIDE_EXTRA_PLUGIN_DIRS）', async () => {
  test.setTimeout(120000)
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ycide-phase5-userdata-'))
  const devDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycide-phase5-dev-'))
  const pluginDir = path.join(devDir, 'acme.hot')
  fs.mkdirSync(pluginDir)
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
    id: 'acme.hot', displayName: '热重载', version: '1.0.0', publisher: 'acme',
    runtime: { type: 'node', main: 'main.js' },
    contributes: { commands: [{ id: 'hot:version', title: '版本' }] },
  }))
  const writeMain = version => fs.writeFileSync(path.join(pluginDir, 'main.js'),
    `exports.activate = (c, y) => { c.subscriptions.push(y.commands.registerCommand('hot:version', () => '${version}')) }\n`)
  writeMain('第一版')
  const app = await electron.launch({
    args: [appRoot, `--user-data-dir=${userData}`],
    cwd: appRoot,
    env: { ...process.env, CI: '1', YCIDE_EXTRA_PLUGIN_DIRS: devDir },
  })
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    // 重新加载的瞬间插件进程在重启，这时的调用会失败，轮询下一次即可
    const run = () => win.evaluate(() => window.api.plugins.executeCommand('hot:version', []).catch(() => '重新加载中'))
    await expect.poll(run).toBe('第一版')
    writeMain('第二版')
    await expect.poll(run, { timeout: 15000 }).toBe('第二版')
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {})
    await app.close()
    fs.rmSync(devDir, { recursive: true, force: true })
    fs.rmSync(userData, { recursive: true, force: true })
  }
})

test('插件经命令使用易语言语言服务：块结构与流程线、项目符号、诊断', async () => {
  test.setTimeout(120000)
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ycide-phase5-userdata-'))
  const devDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycide-phase5-dev-'))
  const pluginDir = path.join(devDir, 'acme.lang')
  fs.mkdirSync(pluginDir)
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
    id: 'acme.lang', displayName: '语言服务调用', version: '1.0.0', publisher: 'acme',
    runtime: { type: 'node', main: 'main.js' }, permissions: ['workspace:read'],
    contributes: { commands: [{ id: 'lang:probe', title: 'probe' }] },
  }))
  fs.writeFileSync(path.join(pluginDir, 'main.js'), `
exports.activate = (c, y) => { c.subscriptions.push(y.commands.registerCommand('lang:probe', async (text) => {
  const parsed = await y.commands.executeCommand('eyc:parseBlocks', text)
  const symbols = await y.commands.executeCommand('eyc:getProjectSymbols')
  const diagnostics = await y.commands.executeCommand('eyc:getDiagnostics')
  return { blocks: parsed.blocks.length, flowMaxDepth: parsed.flowMaxDepth, flowLines: parsed.flowLines.length, symbolKeys: Object.keys(symbols).sort(), diagnostics: Array.isArray(diagnostics) }
})) }
`)
  const app = await electron.launch({
    args: [appRoot, `--user-data-dir=${userData}`],
    cwd: appRoot,
    env: { ...process.env, CI: '1', YCIDE_EXTRA_PLUGIN_DIRS: devDir, YCIDE_PLUGIN_HOT_RELOAD: '0' },
  })
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await expect(win.locator('.titlebar')).toBeVisible()
    const source = ['.版本 2', '.程序集 程序集1', '', '.子程序 子程序1', '.如果真 (真)', '    .计次循环首 (3, )', '    .计次循环尾 ()', '.如果真结束', ''].join('\n')
    const result = await win.evaluate(text => window.api.plugins.executeCommand('lang:probe', [text]), source)
    expect(result).toMatchObject({ flowMaxDepth: 2, diagnostics: true, symbolKeys: ['classNames', 'constants', 'dataTypes', 'dllCommands', 'globalVars', 'windows'] })
    expect(result.blocks).toBeGreaterThan(2)
    expect(result.flowLines).toBeGreaterThanOrEqual(4)
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {})
    await app.close()
    fs.rmSync(devDir, { recursive: true, force: true })
    fs.rmSync(userData, { recursive: true, force: true })
  }
})
