const fs = require('node:fs')
const path = require('node:path')
const { test, expect } = require('@playwright/test')
const {
  launchElectronApp,
  getUserDataPath,
  getThemeConfigPath,
  writeThemeConfig,
  createInvalidThemeConfig,
  chooseThemeFromTitlebar,
  openThemeSettings,
  chooseThemeFromSettings,
  readRootCssVar,
  THEME_IDS,
  ROOT_BG_PRIMARY,
} = require('./helpers/theme-baseline-fixtures')

// Requirement trace:
// THME-01 -> title bar switch path
// THME-02 -> settings persistence + invalid-config fallback/repair flow
// THME-03 -> readable outcomes validated by 13-COVERAGE-CHECKLIST + 13-CONTRAST-LOG

test.describe('theme baseline validation', () => {
  test.describe.configure({ mode: 'serial' })

  test('switches built-in themes from title bar entry point', async () => {
    const appRoot = path.resolve(__dirname, '..', '..')
    const { electronApp, window } = await launchElectronApp(appRoot)

    try {
      await chooseThemeFromTitlebar(window, THEME_IDS.light)
      await expect.poll(() => readRootCssVar(window, ROOT_BG_PRIMARY)).toBe('#f5f5f5')

      await chooseThemeFromTitlebar(window, THEME_IDS.dark)
      await expect.poll(() => readRootCssVar(window, ROOT_BG_PRIMARY)).toBe('#1e1e1e')
    } finally {
      await electronApp.close()
    }
  })

  test('switches from settings entry and persists after restart', async () => {
    const appRoot = path.resolve(__dirname, '..', '..')

    const first = await launchElectronApp(appRoot)
    try {
      await openThemeSettings(first.window)
      await chooseThemeFromSettings(first.window, THEME_IDS.light)
      await expect(first.window.getByRole('radio', { name: THEME_IDS.light })).toHaveAttribute('aria-checked', 'true')
    } finally {
      await first.electronApp.close()
    }

    const second = await launchElectronApp(appRoot)
    try {
      const current = await second.window.evaluate(async () => window.api.theme.getCurrent())
      expect(current.selectedThemeId).toBe(THEME_IDS.light)
      expect(current.effectiveThemeId).toBe(THEME_IDS.light)
      expect(current.warning).toBeNull()
      await expect.poll(() => readRootCssVar(second.window, ROOT_BG_PRIMARY)).toBe('#f5f5f5')
    } finally {
      await second.electronApp.close()
    }
  })

  test('falls back for invalid persisted theme and shows repair prompt path', async () => {
    const appRoot = path.resolve(__dirname, '..', '..')

    const probe = await launchElectronApp(appRoot)
    const userDataPath = await getUserDataPath(probe.electronApp)
    await probe.electronApp.close()

    writeThemeConfig(getThemeConfigPath(userDataPath), createInvalidThemeConfig())

    const relaunched = await launchElectronApp(appRoot)
    try {
      await expect(relaunched.window.locator('.theme-settings-dialog')).toBeVisible()
      await expect(relaunched.window.getByRole('status')).toContainText('已回退到默认深色主题')

      const current = await relaunched.window.evaluate(async () => window.api.theme.getCurrent())
      expect(current.selectedThemeId).toBe(THEME_IDS.dark)
      expect(current.effectiveThemeId).toBe(THEME_IDS.dark)

      const fallbackConfig = JSON.parse(fs.readFileSync(getThemeConfigPath(userDataPath), 'utf-8'))
      expect(fallbackConfig.currentThemeId).toBe(THEME_IDS.dark)
      expect(fallbackConfig.retainedInvalidTheme?.themeId).toBe(THEME_IDS.invalid)

      await chooseThemeFromSettings(relaunched.window, THEME_IDS.light)
      const repaired = await relaunched.window.evaluate(async () => window.api.theme.getCurrent())
      expect(repaired.selectedThemeId).toBe(THEME_IDS.light)
      expect(repaired.effectiveThemeId).toBe(THEME_IDS.light)
      await expect(relaunched.window.getByRole('status')).toHaveCount(0)
    } finally {
      await relaunched.electronApp.close()
    }

    const persistedConfig = JSON.parse(fs.readFileSync(getThemeConfigPath(userDataPath), 'utf-8'))
    expect(persistedConfig.currentThemeId).toBe(THEME_IDS.light)
    expect(persistedConfig.retainedInvalidTheme).toBeNull()
  })
})
