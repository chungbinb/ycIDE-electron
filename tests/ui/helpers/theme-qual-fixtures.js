const fs = require('node:fs')
const path = require('node:path')
const { expect } = require('@playwright/test')
const {
  getAppRoot,
  launchApp,
  closeApp,
  openThemeSettings,
  setColorTokenByLabel,
  readRootCssVar,
} = require('./theme-token-coverage-fixtures')

async function openThemeManager(window) {
  const manager = window.locator('.theme-manager-dialog')
  if (await manager.isVisible().catch(() => false)) return
  const settingsDialog = window.locator('.theme-settings-dialog')
  if (await settingsDialog.isVisible().catch(() => false)) {
    await window.getByRole('button', { name: '主题管理器' }).click()
    await expect(manager).toBeVisible()
    return
  }
  await window.getByRole('menuitem', { name: '工具(T)' }).click()
  await window.getByRole('menuitem', { name: '主题管理器(M)' }).click()
  await expect(manager).toBeVisible()
}

async function readThemeConfigSnapshot(app) {
  const userDataPath = await app.electronApp.evaluate(async ({ app }) => app.getPath('userData'))
  const configPath = path.join(userDataPath, 'theme-config.json')
  if (!fs.existsSync(configPath)) {
    return null
  }
  return fs.readFileSync(configPath, 'utf-8')
}

async function captureAtomicSnapshot(app) {
  return {
    themeList: await app.window.evaluate(async () => (await window.api.theme.getList()) || []),
    currentTheme: await app.window.evaluate(async () => (await window.api.theme.getCurrent())?.effectiveThemeId || ''),
    configSnapshot: await readThemeConfigSnapshot(app),
  }
}

async function installInvalidImportHook(window) {
  await window.evaluate(() => {
    window.__qualImportCommitCalls = []
    window.__ycideTestThemeImportPrepare = async () => ({
      status: 'invalid',
      diagnostics: [
        { path: 'theme.colors', code: 'invalid_value', message: '缺少必要字段' },
      ],
      sourceFilePath: 'C:/mock/qual-invalid-import.json',
    })
    window.__ycideTestThemeImportCommit = async (request) => {
      window.__qualImportCommitCalls.push(request)
      return { success: false, message: 'invalid flow should never commit' }
    }
  })
}

async function installRoundtripHooks(window, importThemeName) {
  await window.evaluate((themeName) => {
    window.__qualRoundtripState = {
      exportCalls: [],
      importPrepareCalls: 0,
      exportedTheme: null,
      importedThemeName: themeName,
    }
    window.__ycideTestThemeExport = async (themeId) => {
      const theme = await window.api.theme.load(themeId)
      if (!theme) {
        return { success: false, message: `主题“${themeId}”不存在。` }
      }
      window.__qualRoundtripState.exportCalls.push(themeId)
      window.__qualRoundtripState.exportedTheme = {
        schemaVersion: 1,
        theme,
      }
      return {
        success: true,
        filePath: `C:/mock/${themeId}.ycide-theme.json`,
        fileName: `${themeId}.ycide-theme.json`,
        themeId,
      }
    }
    window.__ycideTestThemeImportPrepare = async () => {
      window.__qualRoundtripState.importPrepareCalls += 1
      const exported = window.__qualRoundtripState.exportedTheme
      if (!exported?.theme) {
        return {
          status: 'invalid',
          diagnostics: [{ path: '$', code: 'invalid_value', message: 'roundtrip payload missing' }],
          sourceFilePath: 'C:/mock/roundtrip-missing.json',
        }
      }
      return {
        status: 'ready',
        importedTheme: {
          name: window.__qualRoundtripState.importedThemeName,
          colors: { ...exported.theme.colors },
        },
        targetThemeId: window.__qualRoundtripState.importedThemeName,
        sourceFilePath: 'C:/mock/roundtrip-export.ycide-theme.json',
      }
    }
  }, importThemeName)
}

async function getRoundtripState(window) {
  return window.evaluate(() => window.__qualRoundtripState || null)
}

async function restoreQualHooks(window) {
  await window.evaluate(() => {
    window.__ycideTestThemeImportPrepare = undefined
    window.__ycideTestThemeImportCommit = undefined
    window.__ycideTestThemeExport = undefined
    window.__qualRoundtripState = undefined
    window.__qualImportCommitCalls = undefined
  }).catch(() => {})
}

module.exports = {
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
}
