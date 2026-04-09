const path = require('node:path')
const { test, expect, _electron: electron } = require('@playwright/test')
const { createLibraryStoreFixtures, createLibraryInfoFixture } = require('./helpers/library-store-fixtures')

async function openLibraryDialog(window) {
  await window.getByRole('menuitem', { name: '查看(V)' }).click()
  await window.getByRole('menuitem', { name: '支持库', exact: true }).click()
  await expect(window.getByText('支持库管理')).toBeVisible()
}

test.describe('library store status', () => {
  test('keeps not-downloaded badge while loaded status updates after apply selection', async () => {
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
      }, { cards: [fixtures.notDownloaded], infoMap: details })

      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      await openLibraryDialog(window)

      const card = window.locator('.lib-card', {
        has: window.locator('.lib-card-subtitle', { hasText: 'missing-library' }),
      })
      await expect(card).toBeVisible()
      await expect(card.getByText('未下载')).toBeVisible()
      await expect(card.getByText('未加载')).toBeVisible()

      await card.locator('input[type="checkbox"]').check()
      await window.getByRole('button', { name: '应用选择' }).click()

      await expect(card.getByText('已加载')).toBeVisible()
      await expect(card.getByText('未下载')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })
})
