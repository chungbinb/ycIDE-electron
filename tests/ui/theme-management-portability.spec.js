const { test, expect } = require('@playwright/test')
const {
  getAppRoot,
  launchApp,
  closeApp,
  openThemeSettings,
  setColorTokenByLabel,
} = require('./helpers/theme-token-coverage-fixtures')

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

  test('MGMT-01/MGMT-02 + D16-07/D16-06/D16-09/D16-11: manager crud and export', async () => {
    const app = await launchApp(getAppRoot())
    try {
      await openThemeManager(app.window)

      const themeA = `管理冲突A-${Date.now()}`
      const themeB = `管理冲突B-${Date.now()}`
      await app.window.getByLabel('从当前主题创建').fill(themeA)
      await app.window.getByRole('button', { name: '从当前创建' }).click()
      await expect(app.window.locator('.theme-manager-list-item', { hasText: themeA })).toBeVisible()

      await app.window.getByLabel('从当前主题创建').fill(themeB)
      await app.window.getByRole('button', { name: '从当前创建' }).click()
      await expect(app.window.locator('.theme-manager-list-item', { hasText: themeB })).toBeVisible()

      await app.window.locator('.theme-manager-list-item', { hasText: themeA }).first().click()
      await app.window.getByLabel('重命名主题名称').fill(themeB)
      await app.window.getByRole('button', { name: '重命名主题' }).click()
      await expect(app.window.locator('.theme-manager-feedback')).toContainText('已存在')

      await app.window.getByLabel('删除确认名称').fill(`${themeA}-错误`)
      app.window.once('dialog', async (dialog) => {
        await dialog.accept()
      })
      await app.window.getByRole('button', { name: '删除主题' }).click()
      await expect(app.window.locator('.theme-manager-feedback')).toContainText('确认名称不匹配')

      await app.window.getByLabel('删除确认名称').fill(themeA)
      app.window.once('dialog', async (dialog) => {
        await dialog.accept()
      })
      await app.window.getByRole('button', { name: '删除主题' }).click()
      await expect(app.window.locator('.theme-manager-feedback')).toContainText('已删除')

      await app.window.evaluate(() => {
        window.__themeExportCalls = []
        window.__ycideTestThemeExport = async (themeId) => {
          window.__themeExportCalls.push(themeId)
          return {
            success: true,
            filePath: `C:/mock/${themeId}.ycide-theme.json`,
            fileName: `${themeId}.ycide-theme.json`,
            themeId,
          }
        }
        window.__restoreThemeExport = () => { window.__ycideTestThemeExport = undefined }
      })

      await app.window.locator('.theme-manager-list-item', { hasText: themeB }).first().click()
      await app.window.getByRole('button', { name: '导出主题' }).click()
      await expect(app.window.locator('.theme-manager-feedback')).toContainText(`${themeB}.ycide-theme.json`)
      await expect.poll(async () => app.window.evaluate(() => window.__themeExportCalls || [])).toEqual([themeB])
    } finally {
      await app.window.evaluate(() => {
        if (window.__restoreThemeExport) window.__restoreThemeExport()
      }).catch(() => {})
      await closeApp(app)
    }
  })

  test('MGMT-03/MGMT-04 + D16-13/D16-14/D16-15/D16-16: import conflict overwrite and switch-now', async () => {
    const app = await launchApp(getAppRoot())
    try {
      await openThemeManager(app.window)
      const importedThemeName = `导入主题-${Date.now()}`
      await app.window.evaluate((themeName) => {
        window.__importCommitCalls = []
        window.__ycideTestThemeImportPrepare = async () => ({
          status: 'conflict',
          importedTheme: {
            name: themeName,
            colors: {
              '--bg-primary': '#1e1e1e',
              '--text-primary': '#ffffff',
              '--flow-line-main': '#4fc1ff',
            },
          },
          existingThemeId: '默认深色',
          allowedDecisions: ['rename-import', 'overwrite'],
          sourceFilePath: 'C:/mock/import-theme.json',
        })
        window.__ycideTestThemeImportCommit = async (request) => {
          window.__importCommitCalls.push(request)
          return {
            success: true,
            importedThemeId: themeName,
            overwritten: request?.decision?.decision === 'overwrite',
            themes: ['默认深色', '默认浅色', themeName],
            currentTheme: '默认深色',
            menuState: { themes: ['默认深色', '默认浅色', themeName], currentTheme: '默认深色' },
            config: {
              version: 2,
              currentThemeId: '默认深色',
              themePayloads: {
                默认深色: {
                  tokenValues: {
                    '--bg-primary': '#1e1e1e',
                    '--text-primary': '#ffffff',
                    '--flow-line-main': '#4fc1ff',
                  },
                  flowLine: {
                    mode: 'single',
                    single: { mainColor: '#4fc1ff' },
                    multi: {
                      mainColor: '#4fc1ff',
                      depthHueStep: 6,
                      depthSaturationStep: 4,
                      depthLightnessStep: 6,
                    },
                  },
                },
              },
              lastError: null,
              retainedInvalidTheme: null,
            },
          }
        }
        window.__restoreThemeImport = () => {
          window.__ycideTestThemeImportPrepare = undefined
          window.__ycideTestThemeImportCommit = undefined
        }
      }, importedThemeName)

      await app.window.getByRole('button', { name: '导入主题' }).click()
      await expect(app.window.getByRole('button', { name: '确认导入' })).toBeDisabled()
      await app.window.getByRole('radio', { name: '覆盖现有主题' }).click()
      await expect(app.window.getByRole('button', { name: '确认导入' })).toBeDisabled()
      await app.window.getByLabel('我确认覆盖现有主题').check()
      await expect(app.window.getByRole('button', { name: '确认导入' })).toBeEnabled()
      await app.window.getByRole('button', { name: '确认导入' }).click()

      await expect.poll(async () => app.window.evaluate(() => window.__importCommitCalls || [])).toHaveLength(1)
      await expect(app.window.getByText('立即切换')).toBeVisible()
      await expect(app.window.getByText('保持当前')).toBeVisible()
      await app.window.getByRole('button', { name: '保持当前' }).click()
      await expect(app.window.locator('.theme-manager-feedback')).toContainText('已导入')
    } finally {
      await app.window.evaluate(() => {
        if (window.__restoreThemeImport) window.__restoreThemeImport()
      }).catch(() => {})
      await closeApp(app)
    }
  })
})
