const fs = require('node:fs')
const path = require('node:path')
const { expect } = require('@playwright/test')
const {
  launchApp,
  findThemeManagerPage,
  openThemeManager,
  applyThemeFromManager,
  switchThemeFromMenu,
  themeListItem,
  readRootCssVar,
} = require('./theme-token-coverage-fixtures')

const THEME_IDS = {
  dark: '默认深色',
  light: '默认浅色',
  invalid: '损坏主题',
}

const ROOT_BG_PRIMARY = '--bg-primary'

async function launchElectronApp(appRoot) {
  return launchApp(appRoot)
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
    // themePayloads 缺失会被判为 config_parse_failed（不进修复流程），
    // 这里要构造的是“配置结构合法但主题不存在”的 repair_required 场景。
    themePayloads: {},
    lastError: null,
    retainedInvalidTheme: null,
  }
}

async function chooseThemeFromTitlebar(window, themeId) {
  await switchThemeFromMenu(window, themeId)
}

// repair_required 警告会自动打开主题管理器弹窗，等待其出现。
async function waitForThemeManagerPage(app, timeout = 15000) {
  let page = null
  await expect.poll(async () => {
    page = await findThemeManagerPage(app)
    return !!page
  }, { timeout }).toBe(true)
  return page
}

module.exports = {
  launchElectronApp,
  getUserDataPath,
  getThemeConfigPath,
  writeThemeConfig,
  createInvalidThemeConfig,
  chooseThemeFromTitlebar,
  openThemeManager,
  applyThemeFromManager,
  waitForThemeManagerPage,
  themeListItem,
  readRootCssVar,
  THEME_IDS,
  ROOT_BG_PRIMARY,
}
