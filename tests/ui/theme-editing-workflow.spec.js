const { test, expect } = require('@playwright/test')
const {
  getAppRoot,
  launchApp,
  closeApp,
  openThemeManager,
  switchThemeFromMenu,
  setColorTokenByLabel,
  readRootCssVar,
  deleteThemesNotIn,
  getThemeList,
} = require('./helpers/theme-token-coverage-fixtures')

async function ensureBuiltinDark(app) {
  await switchThemeFromMenu(app.window, '默认深色')
  await expect.poll(async () => app.window.evaluate(async () => (await window.api.theme.getCurrent())?.effectiveThemeId || '')).toBe('默认深色')
}

test.describe('theme editing workflow', () => {
  test.describe.configure({ mode: 'serial' })

  test('FLOW-02 + D15-05/D15-06/D15-07/D15-08: undo history and baseline restore', async () => {
    const app = await launchApp(getAppRoot())
    const themesBefore = await getThemeList(app.window)
    try {
      await ensureBuiltinDark(app)
      const manager = await openThemeManager(app)
      const baselineTextPrimary = await readRootCssVar(app.window, '--text-primary')
      const baselineBgPrimary = await readRootCssVar(app.window, '--bg-primary')

      const undoButton = manager.getByRole('button', { name: '撤销上一步' })
      await expect(undoButton).toBeDisabled()

      await setColorTokenByLabel(manager, '基础文本/背景-主文本', '#111111')
      await expect.poll(() => readRootCssVar(app.window, '--text-primary')).toBe('#111111')
      await setColorTokenByLabel(manager, '基础文本/背景-主背景', '#222222')
      await expect.poll(() => readRootCssVar(app.window, '--bg-primary')).toBe('#222222')
      await expect(undoButton).toBeEnabled()

      await undoButton.click()
      await expect.poll(() => readRootCssVar(app.window, '--bg-primary')).toBe(baselineBgPrimary)
      await expect.poll(() => readRootCssVar(app.window, '--text-primary')).toBe('#111111')

      await manager.getByRole('button', { name: '恢复会话基线' }).click()
      await expect.poll(() => readRootCssVar(app.window, '--text-primary')).toBe(baselineTextPrimary)
      await expect.poll(() => readRootCssVar(app.window, '--bg-primary')).toBe(baselineBgPrimary)
      await expect(manager.locator('.theme-manager-dialog')).toBeVisible()
      await expect(undoButton).toBeDisabled()
    } finally {
      await deleteThemesNotIn(app.window, themesBefore)
      await closeApp(app)
    }
  })

  test('FLOW-03 + D15-09/D15-10/D15-11/D15-12: save as custom validates name and activates theme', async () => {
    const app = await launchApp(getAppRoot())
    const themesBefore = await getThemeList(app.window)
    try {
      await ensureBuiltinDark(app)
      const manager = await openThemeManager(app)
      const feedback = manager.locator('.theme-manager-feedback')

      // 选中内置主题后“保存主题”进入另存为命名对话
      await manager.getByRole('button', { name: '保存主题' }).click()
      const nameInput = manager.locator('.theme-manager-input')
      await expect(nameInput).toBeVisible()
      const confirmButton = manager.getByRole('button', { name: '确认保存' })

      await nameInput.fill('')
      await confirmButton.click()
      await expect(feedback).toContainText('请输入主题名称')

      await nameInput.fill('x'.repeat(33))
      await confirmButton.click()
      await expect(feedback).toContainText('不能超过32')

      await nameInput.fill('非法:名称')
      await confirmButton.click()
      await expect(feedback).toContainText('非法字符')

      await nameInput.fill('默认深色')
      await confirmButton.click()
      await expect(feedback).toContainText('已存在')

      const customThemeName = `自动主题-${Date.now()}`
      await nameInput.fill(`  ${customThemeName}  `)
      await confirmButton.click()
      await expect(feedback).toContainText(`已另存为“${customThemeName}”`)
      await expect.poll(async () => app.window.evaluate(async () => {
        const current = await window.api.theme.getCurrent()
        return current?.effectiveThemeId || ''
      })).toBe(customThemeName)
    } finally {
      await app.window.evaluate(async () => { await window.api.theme.setCurrent('默认深色') }).catch(() => {})
      await deleteThemesNotIn(app.window, themesBefore)
      await closeApp(app)
    }
  })

  test('FLOW-01 + D15-01..D15-04 + D15-13/D15-15/D15-16: unsaved draft close parity and app exit', async () => {
    const app = await launchApp(getAppRoot())
    const themesBefore = await getThemeList(app.window)
    try {
      await ensureBuiltinDark(app)
      const manager = await openThemeManager(app)
      await setColorTokenByLabel(manager, '基础文本/背景-主文本', '#345678')
      await expect.poll(() => readRootCssVar(app.window, '--text-primary')).toBe('#345678')
      await expect(manager.getByRole('button', { name: '撤销上一步' })).toBeEnabled()

      // 关闭决策钩子运行于主窗口上下文
      await app.window.evaluate(() => {
        window.__draftCloseIntents = []
        window.__ycideTestThemeDraftCloseDecision = async (intent) => {
          window.__draftCloseIntents.push(intent)
          return 'continue'
        }
      })

      // 独立窗口形态下仅保留两条关闭路径：关闭按钮 + 应用退出
      await manager.getByRole('button', { name: '关闭主题管理器' }).click()
      await expect(manager.locator('.theme-manager-dialog')).toBeVisible()

      await app.window.evaluate(() => window.api.window.close())
      await expect(manager.locator('.theme-manager-dialog')).toBeVisible()
      await expect(app.window.locator('.titlebar')).toBeVisible()

      const intents = await app.window.evaluate(() => window.__draftCloseIntents || [])
      expect(intents).toEqual(['close-button', 'app-exit'])
    } finally {
      await app.window.evaluate(() => {
        window.__ycideTestThemeDraftCloseDecision = async () => 'discard'
      }).catch(() => {})
      await deleteThemesNotIn(app.window, themesBefore)
      await closeApp(app)
    }
  })
})
