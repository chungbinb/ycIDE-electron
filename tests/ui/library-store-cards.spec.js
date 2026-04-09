const path = require('node:path')
const { test, expect, _electron: electron } = require('@playwright/test')
const { createLibraryStoreFixtures, createLibraryInfoFixture } = require('./helpers/library-store-fixtures')

async function openLibraryDialog(window) {
  await window.getByRole('menuitem', { name: '查看(V)' }).click()
  await window.getByRole('menuitem', { name: '支持库', exact: true }).click()
  await expect(window.getByText('支持库管理')).toBeVisible()
}

test.describe('library store cards', () => {
  test('shows platform tags for windows-only and all-platform cards', async () => {
    const appRoot = path.resolve(__dirname, '..', '..')
    const electronApp = await electron.launch({
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, CI: '1' },
    })

    try {
      const fixtures = createLibraryStoreFixtures()
      const details = createLibraryInfoFixture()
      await electronApp.evaluate(async ({ ipcMain }, { cards, infoMap }) => {
        let currentCards = cards
        ipcMain.removeHandler('library:getStoreCards')
        ipcMain.handle('library:getStoreCards', async () => currentCards)
        ipcMain.removeHandler('library:getInfo')
        ipcMain.handle('library:getInfo', async (_event, id) => infoMap[id] ?? null)
        ipcMain.removeHandler('library:applySelection')
        ipcMain.handle('library:applySelection', async (_event, selectedNames) => {
          currentCards = currentCards.map(card => ({ ...card, isLoaded: selectedNames.includes(card.id) }))
          return { loadedCount: selectedNames.length, unloadedCount: 0, failed: [] }
        })
      }, { cards: [fixtures.windowsOnly, fixtures.allPlatform], infoMap: details })

      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      await openLibraryDialog(window)

      const windowsOnlyCard = window.locator('.lib-card', {
        has: window.locator('.lib-card-subtitle', { hasText: 'windows-only' }),
      })
      await expect(windowsOnlyCard).toBeVisible()
      await expect(windowsOnlyCard.locator('.lib-platform-tag')).toHaveCount(1)
      await expect(windowsOnlyCard.locator('.lib-platform-tag', { hasText: 'Windows' })).toBeVisible()

      const allPlatformCard = window.locator('.lib-card', {
        has: window.locator('.lib-card-subtitle', { hasText: 'all-platform' }),
      })
      await expect(allPlatformCard).toBeVisible()
      await expect(allPlatformCard.locator('.lib-platform-tag', { hasText: 'Windows' })).toBeVisible()
      await expect(allPlatformCard.locator('.lib-platform-tag', { hasText: 'macOS' })).toBeVisible()
      await expect(allPlatformCard.locator('.lib-platform-tag', { hasText: 'Linux' })).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })
})
