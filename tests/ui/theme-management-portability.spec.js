const { test, expect } = require('@playwright/test')
const {
  getAppRoot,
  launchApp,
  closeApp,
  openThemeManager,
  switchThemeFromMenu,
  themeListItem,
  setColorTokenByLabel,
  acceptNextDialog,
  deleteThemesNotIn,
  getThemeList,
} = require('./helpers/theme-token-coverage-fixtures')

async function ensureBuiltinDark(app) {
  await switchThemeFromMenu(app.window, '默认深色')
  await expect.poll(async () => app.window.evaluate(async () => (await window.api.theme.getCurrent())?.effectiveThemeId || '')).toBe('默认深色')
}

// 编辑内置主题令牌触发“自动副本”，返回新生成的主题名。
async function createDraftCopyTheme(app, manager) {
  const before = await getThemeList(app.window)
  await setColorTokenByLabel(manager, '基础文本/背景-主文本', '#123abc')
  let copyName = ''
  await expect.poll(async () => {
    const list = await getThemeList(app.window)
    copyName = list.find((id) => !before.includes(id)) || ''
    return copyName
  }).not.toBe('')
  return copyName
}

async function openThemeContextMenu(manager, themeId) {
  await themeListItem(manager, themeId).first().click({ button: 'right' })
  await expect(manager.locator('.theme-manager-context-menu')).toBeVisible()
}

test.describe('theme management portability', () => {
  test.describe.configure({ mode: 'serial' })

  test('MGMT-01 + D16-01/D16-02/D16-03/D16-04/D16-05: manager open auto-copy draft-indicator built-in-guard previous-builtin-fallback', async () => {
    const app = await launchApp(getAppRoot())
    const themesBefore = await getThemeList(app.window)
    try {
      await ensureBuiltinDark(app)
      const manager = await openThemeManager(app)
      await expect.poll(async () => manager.locator('.theme-manager-list-item').count()).toBeGreaterThan(1)

      // D16-02: 未保存草稿标识（编辑内置主题自动生成可编辑副本草稿）
      const copyName = await createDraftCopyTheme(app, manager)
      const draftItem = manager.locator('.theme-manager-list-item').filter({ hasText: '未保存草稿' }).first()
      await expect(draftItem).toBeVisible()
      await draftItem.click()
      await expect(manager.locator('.theme-manager-detail-draft')).toContainText('未保存草稿')

      // D16-04: 内置主题不可重命名/删除（右键菜单按钮禁用）
      await openThemeContextMenu(manager, '默认深色')
      await expect(manager.getByRole('button', { name: '重命名', exact: true })).toBeDisabled()
      await expect(manager.getByRole('button', { name: '删除主题' })).toBeDisabled()
      await manager.locator('.theme-manager-detail').click({ position: { x: 4, y: 4 } })
      await expect(manager.locator('.theme-manager-context-menu')).toHaveCount(0)

      // 保存草稿，设为当前后删除，验证 previous built-in 回退
      await themeListItem(manager, copyName).first().click()
      await manager.getByRole('button', { name: '保存主题' }).click()
      await expect(manager.locator('.theme-manager-feedback')).toContainText('已保存')
      await manager.getByRole('button', { name: '设为当前' }).click()
      await expect.poll(async () => app.window.evaluate(async () => (await window.api.theme.getCurrent())?.effectiveThemeId || '')).toBe(copyName)

      await openThemeContextMenu(manager, copyName)
      acceptNextDialog(app.window, `确定要删除主题"${copyName}"吗？此操作不可撤销。`)
      await manager.getByRole('button', { name: '删除主题' }).click()
      await expect(manager.locator('.theme-manager-feedback')).toContainText('previous built-in')
      await expect.poll(async () => app.window.evaluate(async () => (await window.api.theme.getCurrent())?.effectiveThemeId || '')).toBe('默认深色')
    } finally {
      await deleteThemesNotIn(app.window, themesBefore)
      await closeApp(app)
    }
  })

  test('MGMT-01/MGMT-02 + D16-06..D16-12: manager rename duplicate-guard active-rename-sync and export', async () => {
    const app = await launchApp(getAppRoot())
    const themesBefore = await getThemeList(app.window)
    try {
      await ensureBuiltinDark(app)
      const manager = await openThemeManager(app)
      const copyName = await createDraftCopyTheme(app, manager)
      await themeListItem(manager, copyName).first().click()
      await manager.getByRole('button', { name: '保存主题' }).click()
      await expect(manager.locator('.theme-manager-feedback')).toContainText('已保存')

      // 重命名为已存在名称 -> 拒绝
      await openThemeContextMenu(manager, copyName)
      await manager.getByRole('button', { name: '重命名', exact: true }).click()
      const renameInput = manager.locator('.theme-manager-list-rename-input')
      await renameInput.fill('默认深色')
      await renameInput.press('Enter')
      await expect(manager.locator('.theme-manager-feedback')).toContainText('不可重复')

      // 重命名成功，当前主题（持久化）同步为新名称
      const themeRenamed = `${copyName}-已重命名`
      await openThemeContextMenu(manager, copyName)
      await manager.getByRole('button', { name: '重命名', exact: true }).click()
      await renameInput.fill(themeRenamed)
      await renameInput.press('Enter')
      await expect(themeListItem(manager, themeRenamed).first()).toBeVisible()
      await expect.poll(async () => app.window.evaluate(async () => (await window.api.theme.getCurrent())?.selectedThemeId || '')).toBe(themeRenamed)

      // 导出（测试钩子安装于主窗口）
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

      await openThemeContextMenu(manager, themeRenamed)
      await manager.getByRole('button', { name: '导出主题' }).click()
      await expect(manager.locator('.theme-manager-feedback')).toContainText(`${themeRenamed}.ycide-theme.json`)
      await expect.poll(async () => app.window.evaluate(() => window.__themeExportCalls || [])).toEqual([themeRenamed])

      // 删除（当前主题被删除时回退 previous built-in）
      await openThemeContextMenu(manager, themeRenamed)
      acceptNextDialog(app.window, `确定要删除主题"${themeRenamed}"吗？此操作不可撤销。`)
      await manager.getByRole('button', { name: '删除主题' }).click()
      await expect(manager.locator('.theme-manager-feedback')).toContainText('已删除')
      await expect.poll(async () => app.window.evaluate(async () => (await window.api.theme.getList()) || [])).not.toContain(themeRenamed)
    } finally {
      await app.window.evaluate(() => {
        if (window.__restoreThemeExport) window.__restoreThemeExport()
      }).catch(() => {})
      await deleteThemesNotIn(app.window, themesBefore)
      await closeApp(app)
    }
  })

  test('MGMT-03/MGMT-04 + D16-13/D16-14/D16-15: invalid import no-write and conflict overwrite-confirm keep-current', async () => {
    const app = await launchApp(getAppRoot())
    try {
      await ensureBuiltinDark(app)
      const manager = await openThemeManager(app)
      const importedThemeName = `导入主题-${Date.now()}`
      await app.window.evaluate((themeName) => {
        window.__importPrepareStep = 0
        window.__importCommitCalls = []
        window.__ycideTestThemeImportPrepare = async () => {
          window.__importPrepareStep += 1
          if (window.__importPrepareStep === 1) {
            return {
              status: 'invalid',
              diagnostics: [
                { path: 'theme.colors', code: 'invalid_value', message: '缺少必要字段' },
              ],
              sourceFilePath: 'C:/mock/import-invalid.json',
            }
          }
          return {
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
          }
        }
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

      await openThemeContextMenu(manager, '默认深色')
      await manager.getByRole('button', { name: '导入主题' }).click()
      await expect(manager.locator('.theme-manager-diagnostics')).toContainText('theme.colors')
      await expect(manager.getByRole('button', { name: '确认导入' })).toHaveCount(0)
      await expect.poll(async () => app.window.evaluate(() => window.__importCommitCalls || [])).toHaveLength(0)

      await openThemeContextMenu(manager, '默认深色')
      await manager.getByRole('button', { name: '导入主题' }).click()
      await expect(manager.getByRole('button', { name: '确认导入' })).toBeDisabled()
      await manager.getByRole('radio', { name: '覆盖现有主题' }).click()
      await expect(manager.getByRole('button', { name: '确认导入' })).toBeDisabled()
      await manager.getByLabel('我确认覆盖现有主题').check()
      await expect(manager.getByRole('button', { name: '确认导入' })).toBeEnabled()
      await manager.getByRole('button', { name: '确认导入' }).click()

      await expect.poll(async () => app.window.evaluate(() => window.__importCommitCalls || [])).toHaveLength(1)
      await expect(manager.getByRole('button', { name: '立即切换' })).toBeVisible()
      await expect(manager.getByRole('button', { name: '保持当前' })).toBeVisible()
      await manager.getByRole('button', { name: '保持当前' }).click()
      await expect(manager.locator('.theme-manager-feedback')).toContainText('已导入')
      await expect(themeListItem(manager, '默认深色').first()).toContainText('当前')
    } finally {
      await app.window.evaluate(() => {
        if (window.__restoreThemeImport) window.__restoreThemeImport()
      }).catch(() => {})
      await closeApp(app)
    }
  })

  test('MGMT-03 + D16-16: import success switch-now previews imported theme immediately', async () => {
    const app = await launchApp(getAppRoot())
    try {
      await ensureBuiltinDark(app)
      const manager = await openThemeManager(app)
      await app.window.evaluate(() => {
        window.__importCommitCalls = []
        window.__ycideTestThemeImportPrepare = async () => ({
          status: 'conflict',
          importedTheme: {
            name: '默认浅色',
            colors: {
              '--bg-primary': '#ffffff',
              '--text-primary': '#111111',
              '--flow-line-main': '#57b2ff',
            },
          },
          existingThemeId: '默认浅色',
          allowedDecisions: ['rename-import', 'overwrite'],
          sourceFilePath: 'C:/mock/import-theme-switch.json',
        })
        window.__ycideTestThemeImportCommit = async (request) => {
          window.__importCommitCalls.push(request)
          return {
            success: true,
            importedThemeId: '默认浅色',
            overwritten: true,
            themes: ['默认深色', '默认浅色'],
            currentTheme: '默认深色',
            menuState: { themes: ['默认深色', '默认浅色'], currentTheme: '默认深色' },
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
      })

      await openThemeContextMenu(manager, '默认深色')
      await manager.getByRole('button', { name: '导入主题' }).click()
      await manager.getByRole('radio', { name: '覆盖现有主题' }).click()
      await manager.getByLabel('我确认覆盖现有主题').check()
      await manager.getByRole('button', { name: '确认导入' }).click()
      await expect(manager.getByRole('button', { name: '立即切换' })).toBeVisible()
      await manager.getByRole('button', { name: '立即切换' }).click()
      await expect(manager.locator('.theme-manager-feedback')).toContainText('立即切换到“默认浅色”')
      // “立即切换”为预览切换：根令牌立即生效（提交为 mock，预览加载真实内置浅色主题文件）
      await expect.poll(async () => app.window.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim().toLowerCase())).toBe('#f5f5f5')
    } finally {
      await app.window.evaluate(() => {
        if (window.__restoreThemeImport) window.__restoreThemeImport()
      }).catch(() => {})
      await app.window.evaluate(async () => { await window.api.theme.setCurrent('默认深色') }).catch(() => {})
      await closeApp(app)
    }
  })
})
