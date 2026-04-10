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

  test('save as custom name validation and activation', async () => {
    const app = await launchApp(getAppRoot())
    try {
      await openThemeSettings(app.window)
      const nameInput = app.window.getByLabel('自定义主题名称')
      const saveButton = app.window.getByRole('button', { name: '保存为自定义主题' })
      const feedback = app.window.locator('.theme-settings-save-feedback')

      await saveButton.click()
      await expect(feedback).toContainText('不能为空')

      await nameInput.fill('x'.repeat(33))
      await saveButton.click()
      await expect(feedback).toContainText('不能超过32')

      await nameInput.fill('非法:名称')
      await saveButton.click()
      await expect(feedback).toContainText('非法字符')

      await nameInput.fill('默认深色')
      await saveButton.click()
      await expect(feedback).toContainText('已存在')

      await setColorTokenByLabel(app.window, '基础文本/背景-主文本', '#123456')
      await expect.poll(() => readRootCssVar(app.window, '--text-primary')).toBe('#123456')

      const customThemeName = `自动主题-${Date.now()}`
      await nameInput.fill(customThemeName)
      await saveButton.click()

      const customThemeRadio = app.window.getByRole('radio', { name: customThemeName })
      await expect(customThemeRadio).toBeVisible()
      await expect(customThemeRadio).toHaveAttribute('aria-checked', 'true')
      await expect.poll(async () => app.window.evaluate(async () => {
        const current = await window.api.theme.getCurrent()
        return current?.effectiveThemeId || ''
      })).toBe(customThemeName)
    } finally {
      await closeApp(app)
    }
  })
})
