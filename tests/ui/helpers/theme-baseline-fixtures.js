const fs = require('node:fs')
const path = require('node:path')
const { _electron: electron, expect } = require('@playwright/test')

const THEME_IDS = {
  dark: '默认深色',
  light: '默认浅色',
  invalid: '损坏主题',
}

const ROOT_BG_PRIMARY = '--bg-primary'

async function launchElectronApp(appRoot) {
  const electronApp = await electron.launch({
    args: [appRoot],
    cwd: appRoot,
    env: {
      ...process.env,
      CI: '1',
    },
  })

  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await expect(window.locator('.titlebar')).toBeVisible()
  return { electronApp, window }
}

async function getUserDataPath(electronApp) {
  return electronApp.evaluate(async ({ app }) => app.getPath('userData'))
}

function getThemeConfigPath(userDataPath) {
  return path.join(userDataPath, 'theme-config.json')
}

function writeThemeConfig(configPath, config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

function createInvalidThemeConfig() {
  return {
    version: 2,
    currentThemeId: THEME_IDS.invalid,
    lastError: null,
    retainedInvalidTheme: null,
  }
}

async function chooseThemeFromTitlebar(window, themeId) {
  await window.getByRole('menuitem', { name: '查看(V)' }).click()
  await window.getByRole('menuitem', { name: '主题' }).hover()
  await window.getByRole('menuitem', { name: themeId }).click()
}

async function openThemeSettings(window) {
  await window.getByRole('menuitem', { name: '工具(T)' }).click()
  await window.getByRole('menuitem', { name: '系统配置(O)' }).click()
  await expect(window.locator('.theme-settings-dialog')).toBeVisible()
}

async function chooseThemeFromSettings(window, themeId) {
  await window.getByRole('radio', { name: themeId }).click()
}

async function readRootCssVar(window, variableName) {
  return window.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), variableName)
}

module.exports = {
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
}
