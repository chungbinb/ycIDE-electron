const path = require('node:path')
const { test, expect, _electron: electron } = require('@playwright/test')

test.describe('library store status', () => {
  test('updates downloaded and loaded status after apply selection', async () => {
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
        let cards = [
          {
            id: 'status-lib',
            displayName: 'Status Library',
            version: '1.0.0',
            supportedPlatforms: ['windows'],
            isDownloaded: true,
            isLoaded: false,
            isCore: false,
          },
        ]
        const original = window.api.library
        window.api.library = {
          ...original,
          getStoreCards: async () => cards,
          getInfo: async id => ({ name: id, guid: '', version: '1.0.0', description: '', author: '', zipCode: '', address: '', phone: '', qq: '', email: '', homePage: '', otherInfo: '', fileName: '', commands: [], dataTypes: [], constants: [] }),
          applySelection: async selectedNames => {
            cards = cards.map(card => ({ ...card, isLoaded: selectedNames.includes(card.id) }))
            return { loadedCount: selectedNames.length, unloadedCount: 0, failed: [] }
          },
        }
      })

      await window.getByRole('menuitem', { name: '查看(V)' }).click()
      await window.getByRole('menuitem', { name: '支持库' }).click()

      const card = window.locator('[data-testid="status-card"]')
      await expect(card.getByText('已下载')).toBeVisible()
      await expect(card.getByText('未加载')).toBeVisible()

      await card.locator('input[type="checkbox"]').check()
      await window.getByRole('button', { name: '应用选择' }).click()

      await expect(card.getByText('已加载')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })
})
