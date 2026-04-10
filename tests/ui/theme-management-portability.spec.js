const { test, expect } = require('@playwright/test')
const {
  getAppRoot,
  launchApp,
  closeApp,
  openThemeSettings,
  setColorTokenByLabel,
} = require('./helpers/theme-token-coverage-fixtures')

test.describe('theme management portability', () => {
  test.describe.configure({ mode: 'serial' })

  test('MGMT-01 + D16-02/D16-03/D16-04/D16-01/D16-05: manager open create-from-current draft-indicator built-in-guard previous-builtin-fallback', async () => {
    const app = await launchApp(getAppRoot())
    try {
      await openThemeSettings(app.window)
      await setColorTokenByLabel(app.window, '基础文本/背景-主文本', '#123abc')
      await expect(app.window.getByRole('button', { name: '撤销上一步' })).toBeEnabled()

      await app.window.getByRole('button', { name: '主题管理器' }).click()
      const manager = app.window.locator('.theme-manager-dialog')
      await expect(manager).toBeVisible()
      await expect.poll(async () => app.window.locator('.theme-manager-list-item').count()).toBeGreaterThan(1)

      const draftItem = app.window.locator('.theme-manager-list-item').filter({ hasText: '未保存草稿' }).first()
      await expect(draftItem).toBeVisible()
      await draftItem.click()
      await expect(app.window.locator('.theme-manager-detail-draft')).toContainText('未保存草稿')

      const themeName = `管理主题-${Date.now()}`
      await app.window.getByLabel('从当前主题创建').fill(themeName)
      await app.window.getByRole('button', { name: '从当前创建' }).click()
      await expect(app.window.locator('.theme-manager-list-item').filter({ hasText: themeName })).toBeVisible()

      await app.window.locator('.theme-manager-list-item', { hasText: '默认深色' }).first().click()
      await expect(app.window.getByRole('button', { name: '重命名主题' })).toBeDisabled()
      await expect(app.window.getByRole('button', { name: '删除主题' })).toBeDisabled()

      await app.window.locator('.theme-manager-list-item', { hasText: themeName }).first().click()
      await app.window.getByLabel('删除确认名称').fill(themeName)
      app.window.once('dialog', async (dialog) => {
        await dialog.accept()
      })
      await app.window.getByRole('button', { name: '删除主题' }).click()
      await expect(app.window.locator('.theme-manager-feedback')).toContainText('previous built-in')
    } finally {
      await closeApp(app)
    }
  })
})
