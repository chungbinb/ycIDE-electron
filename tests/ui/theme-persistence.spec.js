const { test, expect, _electron: electron } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

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
      lastError: null,
      retainedInvalidTheme: null,
    }, null, 2), 'utf-8')

    const relaunched = await launch(appRoot)
    try {
      const current = await relaunched.window.evaluate(async () => window.api.theme.getCurrent())
      expect(current.effectiveThemeId).toBe('默认深色')
      expect(current.selectedThemeId).toBe('损坏主题')
      expect(current.warning?.code).toBe('repair_required')
    } finally {
      await relaunched.electronApp.close()
    }
  })
})
