const path = require('node:path')
const { _electron: electron, expect } = require('@playwright/test')

function getAppRoot() {
  return path.resolve(__dirname, '..', '..', '..')
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function launchApp(appRoot) {
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

async function closeApp(app) {
  // 脏主题草稿或未保存编辑器标签会让优雅退出弹原生确认框、永久挂起测试；
  // 断言均在关闭前完成，测试退出一律强制结束进程。
  await app.window.evaluate(() => {
    window.__ycideTestThemeDraftCloseDecision = async () => 'discard'
  }).catch(() => {})
  await app.electronApp.evaluate(({ app: electronApp }) => {
    setTimeout(() => electronApp.exit(0), 0)
  }).catch(() => {})
  await app.electronApp.close().catch(() => {})
}

async function findThemeManagerPage(app) {
  for (const page of app.electronApp.windows()) {
    if (page === app.window) continue
    if (page.isClosed()) continue
    if (await page.locator('.theme-manager-dialog').isVisible().catch(() => false)) {
      return page
    }
  }
  return null
}

// 主题管理器现以 window.open 独立弹窗呈现（App.tsx themeManagerWindowRef），
// 通过菜单栏 工具(T) -> 主题管理器(M) 打开，并返回弹窗 Page。
async function openThemeManager(app) {
  const existing = await findThemeManagerPage(app)
  if (existing) return existing
  const popupPromise = app.electronApp.waitForEvent('window')
  await app.window.getByRole('menuitem', { name: '工具(T)' }).click()
  await app.window.getByRole('menuitem', { name: '主题管理器(M)' }).click()
  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded')
  await expect(popup.locator('.theme-manager-dialog')).toBeVisible()
  return popup
}

// 菜单栏 查看(V) -> 主题 子菜单切换主题（当前主题带“✓ ”前缀）。
async function switchThemeFromMenu(window, themeId) {
  const item = window.getByRole('menuitem', { name: new RegExp(`^(✓\\s*)?${escapeRegExp(themeId)}$`) })
  await expect(async () => {
    // 子菜单父项的可访问名包含展开箭头（“主题 ▶”）；菜单按钮是 toggle，
    // 仅在下拉未展开时点击，避免把已展开的菜单关掉。
    const themeParent = window.getByRole('menuitem', { name: /^主题\s*▶?$/ })
    if (!(await themeParent.isVisible().catch(() => false))) {
      await window.getByRole('menuitem', { name: '查看(V)' }).click()
    }
    await themeParent.hover()
    await expect(item).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15000 })
  await item.click()
}

function themeListItem(managerPage, themeId) {
  return managerPage
    .locator('.theme-manager-list-item')
    .filter({ has: managerPage.locator('.theme-manager-list-name').filter({ hasText: new RegExp(`^${escapeRegExp(themeId)}$`) }) })
}

// 令牌编辑现为 <input type="color">，fill 不可用，走原生 setter + input 事件。
async function setColorTokenByLabel(managerPage, label, value) {
  const normalized = (value || '').toLowerCase()
  const input = managerPage.getByLabel(label, { exact: true })
  await expect(input).toBeAttached()
  await input.evaluate((el, next) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, next)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, normalized)
}

async function readRootCssVar(window, variableName) {
  return window.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim().toLowerCase(), variableName)
}

async function clickTokenResetByLabel(managerPage, label) {
  const input = managerPage.getByLabel(label, { exact: true })
  const row = input.locator('xpath=ancestor::div[contains(@class,"theme-manager-token-row")]').first()
  await row.getByRole('button', { name: '重置' }).click()
}

async function clickGroupResetByTitle(managerPage, title) {
  const group = managerPage.locator('.theme-manager-group').filter({ has: managerPage.getByRole('heading', { name: title }) }).first()
  await group.getByRole('button', { name: '重置本组' }).click()
}

async function clickGlobalReset(managerPage) {
  await managerPage.getByRole('button', { name: '恢复全部默认' }).click()
}

// 注意：window.confirm 由主窗口 JS 上下文发起（组件代码运行于主窗口 realm），
// 因此 dialog 监听要挂在主窗口 Page 上。
function acceptNextDialog(window, expectedMessage) {
  window.once('dialog', async (dialog) => {
    if (expectedMessage && dialog.message() !== expectedMessage) {
      throw new Error(`Unexpected dialog: ${dialog.message()}`)
    }
    await dialog.accept()
  })
}

async function saveThemePayload(window, themeId, flowLine) {
  const current = await window.evaluate(async () => window.api.theme.getCurrent())
  const tokenValues = current?.themePayload?.tokenValues || {}
  await window.evaluate(async ({ id, payload }) => {
    await window.api.theme.saveCurrent(id, payload)
  }, {
    id: themeId,
    payload: {
      tokenValues,
      flowLine,
    },
  })
}

// 在主题管理器中选中主题并点击“设为当前”（持久化切换）。
async function applyThemeFromManager(managerPage, themeId) {
  await themeListItem(managerPage, themeId).first().click()
  await managerPage.getByRole('button', { name: '设为当前' }).click()
}

async function readFlowConfigVars(window) {
  return window.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return {
      mode: style.getPropertyValue('--flow-line-mode').trim(),
      main: style.getPropertyValue('--flow-line-main').trim().toLowerCase(),
      depthHueStep: style.getPropertyValue('--flow-line-depth-hue-step').trim(),
      depthSaturationStep: style.getPropertyValue('--flow-line-depth-saturation-step').trim(),
      depthLightnessStep: style.getPropertyValue('--flow-line-depth-lightness-step').trim(),
    }
  })
}

// 清理测试期间新建的主题（内置主题编辑会自动生成“-副本”主题）。
async function deleteThemesNotIn(window, keepList) {
  await window.evaluate(async (keep) => {
    const list = (await window.api.theme.getList()) || []
    for (const themeId of list) {
      if (!keep.includes(themeId)) {
        try {
          await window.api.theme.delete({ themeId, confirmThemeName: themeId })
        } catch {
          // best-effort cleanup
        }
      }
    }
  }, keepList).catch(() => {})
}

async function getThemeList(window) {
  return window.evaluate(async () => (await window.api.theme.getList()) || [])
}

module.exports = {
  getAppRoot,
  escapeRegExp,
  launchApp,
  closeApp,
  findThemeManagerPage,
  openThemeManager,
  switchThemeFromMenu,
  themeListItem,
  setColorTokenByLabel,
  readRootCssVar,
  clickTokenResetByLabel,
  clickGroupResetByTitle,
  clickGlobalReset,
  acceptNextDialog,
  saveThemePayload,
  applyThemeFromManager,
  readFlowConfigVars,
  deleteThemesNotIn,
  getThemeList,
}
