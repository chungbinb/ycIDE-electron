const path = require('node:path')
const { _electron: electron, expect } = require('@playwright/test')

function getAppRoot() {
  return path.resolve(__dirname, '..', '..', '..')
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
  await app.electronApp.close()
}

async function openThemeSettings(window) {
  const dialog = window.locator('.theme-settings-dialog')
  if (await dialog.isVisible().catch(() => false)) {
    return
  }
  await window.getByRole('menuitem', { name: '工具(T)' }).click()
  await window.getByRole('menuitem', { name: '系统配置(O)' }).click()
  await expect(dialog).toBeVisible()
}

async function setColorTokenByLabel(window, label, value) {
  const normalized = value.toLowerCase()
  const input = window.getByLabel(label)
  await input.fill(normalized)
  await input.press('Enter')
}

async function readRootCssVar(window, variableName) {
  return window.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim().toLowerCase(), variableName)
}

async function clickTokenResetByLabel(window, label) {
  const input = window.getByLabel(label)
  const row = input.locator('xpath=ancestor::div[contains(@class,"theme-settings-token-row")]').first()
  await row.getByRole('button', { name: '重置' }).click()
}

async function clickGroupResetByTitle(window, title) {
  const group = window.locator('.theme-settings-group').filter({ has: window.getByRole('heading', { name: title }) }).first()
  await group.getByRole('button', { name: '重置本组' }).click()
}

async function clickGlobalReset(window) {
  await window.getByRole('button', { name: '恢复全部默认' }).click()
}

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

async function activateThemeFromSettings(window, themeId) {
  await window.getByRole('radio', { name: themeId }).click()
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

module.exports = {
  getAppRoot,
  launchApp,
  closeApp,
  openThemeSettings,
  setColorTokenByLabel,
  readRootCssVar,
  clickTokenResetByLabel,
  clickGroupResetByTitle,
  clickGlobalReset,
  acceptNextDialog,
  saveThemePayload,
  activateThemeFromSettings,
  readFlowConfigVars,
}
