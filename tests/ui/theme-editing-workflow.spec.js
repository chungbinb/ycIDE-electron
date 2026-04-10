const { test, expect } = require('@playwright/test')
const {
  getAppRoot,
  launchApp,
  closeApp,
  openThemeSettings,
  setColorTokenByLabel,
  readRootCssVar,
} = require('./helpers/theme-token-coverage-fixtures')

test.describe('theme editing workflow', () => {
  test.describe.configure({ mode: 'serial' })

  test('undo history and baseline restore', async () => {
    const app = await launchApp(getAppRoot())
    try {
      await openThemeSettings(app.window)

      const undoButton = app.window.getByRole('button', { name: '撤销上一步' })
      await expect(undoButton).toBeDisabled()
      await expect(undoButton).toHaveAttribute('title', '无可撤销改动')

      await setColorTokenByLabel(app.window, '基础文本/背景-主文本', '#111111')
      await setColorTokenByLabel(app.window, '基础文本/背景-主背景', '#222222')
      await expect.poll(() => readRootCssVar(app.window, '--text-primary')).toBe('#111111')
      await expect.poll(() => readRootCssVar(app.window, '--bg-primary')).toBe('#222222')
      await expect(undoButton).toBeEnabled()

      await undoButton.click()
      await expect.poll(() => readRootCssVar(app.window, '--bg-primary')).toBe('#1e1e1e')
      await expect.poll(() => readRootCssVar(app.window, '--text-primary')).toBe('#111111')

      await app.window.getByRole('button', { name: '恢复会话基线' }).click()
      await expect.poll(() => readRootCssVar(app.window, '--text-primary')).toBe('#cccccc')
      await expect.poll(() => readRootCssVar(app.window, '--bg-primary')).toBe('#1e1e1e')
      await expect(app.window.locator('.theme-settings-dialog')).toBeVisible()
      await expect(undoButton).toBeDisabled()
    } finally {
      await closeApp(app)
    }
  })
})
