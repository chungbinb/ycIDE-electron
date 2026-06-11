const { test, expect } = require('@playwright/test')
const {
  getAppRoot,
  launchApp,
  closeApp,
  openThemeManager,
  switchThemeFromMenu,
  themeListItem,
  openThemeContextMenu,
  setColorTokenByLabel,
  readRootCssVar,
  captureAtomicSnapshot,
  installInvalidImportHook,
  installRoundtripHooks,
  getRoundtripState,
  restoreQualHooks,
  deleteThemesNotIn,
  getThemeList,
} = require('./helpers/theme-qual-fixtures')

test.describe('theme QUAL gate', () => {
  test.describe.configure({ mode: 'serial' })

  test('QUAL-02 D17-01: mandatory path switch between built-in light and dark themes', async () => {
    const app = await launchApp(getAppRoot())
    try {
      await switchThemeFromMenu(app.window, '默认浅色')
      await expect.poll(() => readRootCssVar(app.window, '--bg-primary')).toBe('#f5f5f5')
      await expect.poll(async () => app.window.evaluate(async () => (await window.api.theme.getCurrent())?.effectiveThemeId || '')).toBe('默认浅色')

      await switchThemeFromMenu(app.window, '默认深色')
      await expect.poll(() => readRootCssVar(app.window, '--bg-primary')).toBe('#1e1e1e')
      await expect.poll(async () => app.window.evaluate(async () => (await window.api.theme.getCurrent())?.effectiveThemeId || '')).toBe('默认深色')
    } finally {
      await closeApp(app)
    }
  })

  test('QUAL-02 D17-01: mandatory path preview change and undo restore baseline', async () => {
    const app = await launchApp(getAppRoot())
    const themesBefore = await getThemeList(app.window)
    try {
      const manager = await openThemeManager(app)
      const baselineTextPrimary = await readRootCssVar(app.window, '--text-primary')
      const undoButton = manager.getByRole('button', { name: '撤销上一步' })
      await expect(undoButton).toBeDisabled()

      await setColorTokenByLabel(manager, '基础文本/背景-主文本', '#234567')
      await expect.poll(() => readRootCssVar(app.window, '--text-primary')).toBe('#234567')
      await expect(undoButton).toBeEnabled()

      await undoButton.click()
      await expect.poll(() => readRootCssVar(app.window, '--text-primary')).toBe(baselineTextPrimary)
      await expect(undoButton).toBeDisabled()
    } finally {
      // 内置主题编辑令牌会自动生成“-副本”主题，清理避免跨用例/跨运行污染。
      await deleteThemesNotIn(app.window, themesBefore)
      await closeApp(app)
    }
  })

  test('QUAL-02 D17-03: mandatory path invalid-import keeps list/current/config atomic unchanged', async () => {
    const app = await launchApp(getAppRoot())
    try {
      const manager = await openThemeManager(app)
      const before = await captureAtomicSnapshot(app)
      await installInvalidImportHook(app.window)

      await openThemeContextMenu(manager, '默认浅色')
      await manager.getByRole('button', { name: '导入主题' }).click()
      await expect(manager.locator('.theme-manager-diagnostics')).toContainText('theme.colors')
      await expect(manager.getByRole('button', { name: '确认导入' })).toHaveCount(0)
      await expect.poll(async () => app.window.evaluate(() => window.__qualImportCommitCalls || [])).toHaveLength(0)

      const after = await captureAtomicSnapshot(app)
      expect(after.themeList).toEqual(before.themeList)
      expect(after.currentTheme).toBe(before.currentTheme)
      expect(after.configSnapshot).toBe(before.configSnapshot)
    } finally {
      await restoreQualHooks(app.window)
      await closeApp(app)
    }
  })

  test('QUAL-02 D17-02: mandatory path export-import roundtrip keeps payload usable after import', async () => {
    const app = await launchApp(getAppRoot())
    const importedThemeName = `QUAL-02-roundtrip-${Date.now()}`
    const themesBefore = await getThemeList(app.window)
    const initialTheme = await app.window.evaluate(async () => (await window.api.theme.getCurrent())?.effectiveThemeId || '默认深色')
    try {
      const manager = await openThemeManager(app)
      await installRoundtripHooks(app.window, importedThemeName)

      await openThemeContextMenu(manager, '默认浅色')
      await manager.getByRole('button', { name: '导出主题' }).click()
      await expect(manager.locator('.theme-manager-feedback')).toContainText('默认浅色.ycide-theme.json')

      await openThemeContextMenu(manager, '默认浅色')
      await manager.getByRole('button', { name: '导入主题' }).click()
      await expect(manager.getByRole('button', { name: '确认导入' })).toBeEnabled()
      await manager.getByRole('button', { name: '确认导入' }).click()
      await expect(manager.getByRole('button', { name: '立即切换' })).toBeVisible()
      await manager.getByRole('button', { name: '立即切换' }).click()

      await expect(manager.locator('.theme-manager-feedback')).toContainText(`立即切换到“${importedThemeName}”`)
      await expect.poll(async () => app.window.evaluate(async () => (await window.api.theme.getList()) || [])).toContain(importedThemeName)
      await expect.poll(() => readRootCssVar(app.window, '--bg-primary')).toBe('#f5f5f5')

      // “立即切换”仅为预览；通过“设为当前”验证导入产物可正式启用并持久化。
      await themeListItem(manager, importedThemeName).first().click()
      await manager.getByRole('button', { name: '设为当前' }).click()
      await expect.poll(async () => app.window.evaluate(async () => (await window.api.theme.getCurrent())?.effectiveThemeId || '')).toBe(importedThemeName)

      const roundtripState = await getRoundtripState(app.window)
      expect(roundtripState?.exportCalls).toEqual(['默认浅色'])
      expect(roundtripState?.importPrepareCalls).toBe(1)
      expect(await readRootCssVar(app.window, '--bg-primary')).toBe('#f5f5f5')
    } finally {
      await restoreQualHooks(app.window)
      await app.window.evaluate(async (themeId) => {
        await window.api.theme.setCurrent(themeId)
      }, initialTheme).catch(() => {})
      await deleteThemesNotIn(app.window, themesBefore)
      await closeApp(app)
    }
  })
})
