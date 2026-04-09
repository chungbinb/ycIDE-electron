const path = require('node:path')
const { test, expect, _electron: electron } = require('@playwright/test')

test.describe('library store cards', () => {
  test('shows platform tags for windows-only and all-platform cards', async () => {
    const appRoot = path.resolve(__dirname, '..', '..')
    const electronApp = await electron.launch({
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, CI: '1' },
    })

    try {
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await window.evaluate(() => {
        const cards = [
          {
            id: 'windows-only-lib',
            displayName: 'Windows Only',
            version: '1.0.0',
            supportedPlatforms: ['windows'],
            isDownloaded: true,
            isLoaded: false,
            isCore: false,
          },
          {
            id: 'all-platform-lib',
            displayName: 'All Platform',
            version: '1.0.0',
            supportedPlatforms: ['windows', 'macos', 'linux'],
            isDownloaded: true,
            isLoaded: true,
            isCore: false,
          },
        ]
        const original = window.api.library
        window.api.library = {
          ...original,
          getStoreCards: async () => cards,
          getInfo: async id => ({ name: id, guid: '', version: '1.0.0', description: '', author: '', zipCode: '', address: '', phone: '', qq: '', email: '', homePage: '', otherInfo: '', fileName: '', commands: [], dataTypes: [], constants: [] }),
          applySelection: async () => ({ loadedCount: 0, unloadedCount: 0, failed: [] }),
        }
      })

      await window.getByRole('menuitem', { name: '查看(V)' }).click()
      await window.getByRole('menuitem', { name: '支持库' }).click()

      await expect(window.locator('[data-testid="windows-only-card"] [data-testid="platform-windows"]')).toBeVisible()
      await expect(window.locator('[data-testid="all-platform-card"] [data-testid="platform-windows"]')).toBeVisible()
      await expect(window.locator('[data-testid="all-platform-card"] [data-testid="platform-macos"]')).toBeVisible()
      await expect(window.locator('[data-testid="all-platform-card"] [data-testid="platform-linux"]')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })
})
