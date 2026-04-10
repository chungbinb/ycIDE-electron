const { test, expect } = require('@playwright/test')
const {
  getAppRoot,
  launchApp,
  closeApp,
  openThemeSettings,
  openThemeManager,
  setColorTokenByLabel,
  readRootCssVar,
  captureAtomicSnapshot,
  installInvalidImportHook,
  installRoundtripHooks,
  getRoundtripState,
  restoreQualHooks,
} = require('./helpers/theme-qual-fixtures')

test.describe('theme QUAL gate', () => {
  test.describe.configure({ mode: 'serial' })

  test('QUAL-02 D17-01: mandatory path switch between built-in light and dark themes', async () => {
    const app = await launchApp(getAppRoot())
    try {
      await openThemeSettings(app.window)
      await app.window.getByRole('radio', { name: '默认浅色' }).click()
      await expect.poll(() => readRootCssVar(app.window, '--bg-primary')).toBe('#f5f5f5')
      await expect.poll(async () => app.window.evaluate(async () => (await window.api.theme.getCurrent())?.effectiveThemeId || '')).toBe('默认浅色')

      await app.window.getByRole('radio', { name: '默认深色' }).click()
      await expect.poll(() => readRootCssVar(app.window, '--bg-primary')).toBe('#1e1e1e')
      await expect.poll(async () => app.window.evaluate(async () => (await window.api.theme.getCurrent())?.effectiveThemeId || '')).toBe('默认深色')
    } finally {
      await closeApp(app)
    }
  })

  test('QUAL-02 D17-01: mandatory path preview change and undo restore baseline', async () => {
    const app = await launchApp(getAppRoot())
    try {
      await openThemeSettings(app.window)
      const baselineTextPrimary = await readRootCssVar(app.window, '--text-primary')
      const undoButton = app.window.getByRole('button', { name: '撤销上一步' })
      await expect(undoButton).toBeDisabled()

      await setColorTokenByLabel(app.window, '基础文本/背景-主文本', '#234567')
      await expect.poll(() => readRootCssVar(app.window, '--text-primary')).toBe('#234567')
      await expect(undoButton).toBeEnabled()

      await undoButton.click()
      await expect.poll(() => readRootCssVar(app.window, '--text-primary')).toBe(baselineTextPrimary.toLowerCase())
      await expect(undoButton).toBeDisabled()
    } finally {
      await closeApp(app)
    }
  })

  test('QUAL-02 D17-03: mandatory path invalid-import keeps list/current/config atomic unchanged', async () => {
    const app = await launchApp(getAppRoot())
    try {
      await openThemeManager(app.window)
      const before = await captureAtomicSnapshot(app)
      await installInvalidImportHook(app.window)

      await app.window.getByRole('button', { name: '导入主题' }).click()
      await expect(app.window.locator('.theme-manager-diagnostics')).toContainText('theme.colors')
      await expect(app.window.getByRole('button', { name: '确认导入' })).toHaveCount(0)
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
    try {
      await openThemeManager(app.window)
      await installRoundtripHooks(app.window, importedThemeName)

      await app.window.locator('.theme-manager-list-item', { hasText: '默认浅色' }).first().click()
      await app.window.getByRole('button', { name: '导出主题' }).click()
      await expect(app.window.locator('.theme-manager-feedback')).toContainText('默认浅色.ycide-theme.json')

      await app.window.getByRole('button', { name: '导入主题' }).click()
      await expect(app.window.getByRole('button', { name: '确认导入' })).toBeEnabled()
      await app.window.getByRole('button', { name: '确认导入' }).click()
      await expect(app.window.getByRole('button', { name: '立即切换' })).toBeVisible()
      await app.window.getByRole('button', { name: '立即切换' }).click()

      await expect(app.window.locator('.theme-manager-feedback')).toContainText(`立即切换到“${importedThemeName}”`)
      await expect.poll(async () => app.window.evaluate(async () => (await window.api.theme.getCurrent())?.effectiveThemeId || '')).toBe(importedThemeName)
      await expect.poll(async () => app.window.evaluate(async () => (await window.api.theme.getList()) || [])).toContain(importedThemeName)

      const roundtripState = await getRoundtripState(app.window)
      expect(roundtripState?.exportCalls).toEqual(['默认浅色'])
      expect(roundtripState?.importPrepareCalls).toBe(1)
      expect(await readRootCssVar(app.window, '--bg-primary')).toBe('#f5f5f5')
    } finally {
      await restoreQualHooks(app.window)
      await closeApp(app)
    }
  })
})
