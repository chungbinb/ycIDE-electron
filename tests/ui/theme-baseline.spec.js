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
  openThemeManager,
  applyThemeFromManager,
  waitForThemeManagerPage,
  readRootCssVar,
  THEME_IDS,
  ROOT_BG_PRIMARY,
} = require('./helpers/theme-baseline-fixtures')

// Requirement trace:
// THME-01 -> title bar switch path (查看 -> 主题 子菜单)
// THME-02 -> manager persistence + invalid-config fallback/repair flow
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

  test('switches from theme manager entry and persists after restart', async () => {
    const appRoot = path.resolve(__dirname, '..', '..')

    const first = await launchElectronApp(appRoot)
    try {
      const manager = await openThemeManager(first)
      await applyThemeFromManager(manager, THEME_IDS.light)
      await expect.poll(async () => first.window.evaluate(async () => (await window.api.theme.getCurrent())?.effectiveThemeId || '')).toBe(THEME_IDS.light)
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
      // repair_required 警告自动打开主题管理器弹窗，并在输出面板提示回退信息。
      const manager = await waitForThemeManagerPage(relaunched)
      await expect(manager.locator('.theme-manager-dialog')).toBeVisible()
      await expect(relaunched.window.locator('.output-panel')).toContainText('已回退到默认深色主题')

      const current = await relaunched.window.evaluate(async () => window.api.theme.getCurrent())
      expect(current.selectedThemeId).toBe(THEME_IDS.dark)
      expect(current.effectiveThemeId).toBe(THEME_IDS.dark)

      const fallbackConfig = JSON.parse(fs.readFileSync(getThemeConfigPath(userDataPath), 'utf-8'))
      expect(fallbackConfig.currentThemeId).toBe(THEME_IDS.dark)
      expect(fallbackConfig.retainedInvalidTheme?.themeId).toBe(THEME_IDS.invalid)

      await applyThemeFromManager(manager, THEME_IDS.light)
      await expect.poll(async () => relaunched.window.evaluate(async () => (await window.api.theme.getCurrent())?.selectedThemeId || '')).toBe(THEME_IDS.light)
      const repaired = await relaunched.window.evaluate(async () => window.api.theme.getCurrent())
      expect(repaired.selectedThemeId).toBe(THEME_IDS.light)
      expect(repaired.effectiveThemeId).toBe(THEME_IDS.light)
    } finally {
      await relaunched.electronApp.close()
    }

    const persistedConfig = JSON.parse(fs.readFileSync(getThemeConfigPath(userDataPath), 'utf-8'))
    expect(persistedConfig.currentThemeId).toBe(THEME_IDS.light)
    // retainedInvalidTheme 仅在切换到同名主题（即修复该主题本身）时清除，切换到其他主题时保留。
    expect(persistedConfig.retainedInvalidTheme?.themeId).toBe(THEME_IDS.invalid)
  })
})
