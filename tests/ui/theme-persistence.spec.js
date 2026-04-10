const { test, expect, _electron: electron } = require('@playwright/test')
const path = require('node:path')

test.describe('theme persistence contract', () => {
  test('returns legacy current theme string shape (RED)', async () => {
    const appRoot = path.resolve(__dirname, '..', '..')
    const electronApp = await electron.launch({
      args: [appRoot],
      cwd: appRoot,
      env: {
        ...process.env,
        CI: '1',
      },
    })

    try {
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      const current = await window.evaluate(async () => window.api.theme.getCurrent())
      expect(typeof current).toBe('string')
    } finally {
      await electronApp.close()
    }
  })
})
