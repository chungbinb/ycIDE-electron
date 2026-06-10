const { test, expect, _electron: electron } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

// 注：repair_required 的一次性警告由渲染进程消费（自动打开主题管理器修复入口），
// 其 UI 行为由 theme-baseline.spec.js 覆盖。

async function launch(appRoot) {
  const electronApp = await electron.launch({
    args: [appRoot],
    cwd: appRoot,
    env: {
      ...process.env,
      CI: '1',
    },
  })
  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { electronApp, window }
}

test.describe('theme persistence contract', () => {
  test('persists selected theme across restart', async () => {
    const appRoot = path.resolve(__dirname, '..', '..')
    const first = await launch(appRoot)

    try {
      await first.window.evaluate(async () => {
        await window.api.theme.setCurrent('默认深色')
      })
    } finally {
      await first.electronApp.close()
    }

    const second = await launch(appRoot)
    try {
      const current = await second.window.evaluate(async () => window.api.theme.getCurrent())
      expect(current.effectiveThemeId).toBe('默认深色')
      expect(current.warning).toBeNull()
    } finally {
      await second.electronApp.close()
    }
  })

  test('falls back safely when persisted theme id is tampered', async () => {
    const appRoot = path.resolve(__dirname, '..', '..')
    const app = await launch(appRoot)
    const userDataPath = await app.electronApp.evaluate(async ({ app: electronApp }) => electronApp.getPath('userData'))
    await app.electronApp.close()

    const configPath = path.join(userDataPath, 'theme-config.json')
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify({
      version: 2,
      currentThemeId: '损坏主题',
      themePayloads: {},
      lastError: null,
      retainedInvalidTheme: null,
    }, null, 2), 'utf-8')

    const relaunched = await launch(appRoot)
    try {
      // repair_required 警告是一次性的：渲染进程挂载时的首次 getCurrent 消费警告
      // 并回写回退后的配置，因此通过配置文件断言回退结果。
      await expect.poll(() => {
        try {
          return JSON.parse(fs.readFileSync(configPath, 'utf-8')).currentThemeId
        } catch {
          return null
        }
      }).toBe('默认深色')
      // lastError 是瞬态字段（后续 getCurrent 解析成功即清空），retainedInvalidTheme 才是持久信号。
      const repairedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      expect(repairedConfig.retainedInvalidTheme?.themeId).toBe('损坏主题')

      const current = await relaunched.window.evaluate(async () => window.api.theme.getCurrent())
      expect(current.effectiveThemeId).toBe('默认深色')
    } finally {
      await relaunched.electronApp.close()
    }
  })
})
