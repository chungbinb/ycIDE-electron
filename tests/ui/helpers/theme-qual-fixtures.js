const fs = require('node:fs')
const path = require('node:path')
const { expect } = require('@playwright/test')
const {
  getAppRoot,
  launchApp,
  closeApp,
  openThemeManager,
  switchThemeFromMenu,
  themeListItem,
  setColorTokenByLabel,
  readRootCssVar,
  deleteThemesNotIn,
  getThemeList,
} = require('./theme-token-coverage-fixtures')

// 主题管理器的导入/导出入口在主题列表的右键菜单中。
async function openThemeContextMenu(managerPage, themeId) {
  await themeListItem(managerPage, themeId).first().click({ button: 'right' })
  await expect(managerPage.locator('.theme-manager-context-menu')).toBeVisible()
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

// 测试钩子安装在主窗口：App.tsx 的导入/导出处理器运行于主窗口 JS 上下文，
// 即便 UI 呈现在主题管理器弹窗中。
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
}
