const { test, expect } = require('@playwright/test')
const {
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
} = require('./helpers/theme-token-coverage-fixtures')
const { collectMonacoTokenColors, assertMonacoTokenColorEvidence } = require('./helpers/monaco-token-assertions')

test.describe('theme token coverage', () => {
  test.describe.configure({ mode: 'serial' })

  test('[smoke] grouped token edits update base/table/header surfaces', async () => {
    const app = await launchApp(getAppRoot())
    try {
      await openThemeSettings(app.window)
      await setColorTokenByLabel(app.window, '基础文本/背景-主背景', '#112233')
      await setColorTokenByLabel(app.window, '基础文本/背景-主文本', '#abcdef')
      await setColorTokenByLabel(app.window, '表格与表头-表格背景', '#224466')
      await setColorTokenByLabel(app.window, '表格与表头-表头背景', '#335577')

      await expect.poll(() => readRootCssVar(app.window, '--bg-primary')).toBe('#112233')
      await expect.poll(() => readRootCssVar(app.window, '--text-primary')).toBe('#abcdef')
      await expect.poll(() => readRootCssVar(app.window, '--table-bg')).toBe('#224466')
      await expect.poll(() => readRootCssVar(app.window, '--table-header-bg')).toBe('#335577')
    } finally {
      await closeApp(app)
    }
  })

  test('reset actions apply immediately with required confirmations', async () => {
    const app = await launchApp(getAppRoot())
    try {
      await openThemeSettings(app.window)
      await setColorTokenByLabel(app.window, '基础文本/背景-主文本', '#111111')
      await clickTokenResetByLabel(app.window, '基础文本/背景-主文本')
      await expect.poll(() => readRootCssVar(app.window, '--text-primary')).toBe('#cccccc')

      await setColorTokenByLabel(app.window, '基础文本/背景-主背景', '#222222')
      await acceptNextDialog(app.window, '确定重置该分组令牌吗?')
      await clickGroupResetByTitle(app.window, '基础文本/背景')
      await expect.poll(() => readRootCssVar(app.window, '--bg-primary')).toBe('#1e1e1e')

      await setColorTokenByLabel(app.window, '表格与表头-表格背景', '#333333')
      await acceptNextDialog(app.window, '确定恢复全部主题令牌默认值吗?')
      await clickGlobalReset(app.window)
      await expect.poll(() => readRootCssVar(app.window, '--table-bg')).toBe('#1e1e1e')
    } finally {
      await closeApp(app)
    }
  })

  test('flow-line single and multi mode apply distinct runtime vars', async () => {
    const app = await launchApp(getAppRoot())
    try {
      await saveThemePayload(app.window, '默认深色', {
        mode: 'single',
        single: { mainColor: '#4fc1ff' },
        multi: { mainColor: '#4fc1ff', depthHueStep: 16, depthSaturationStep: -4, depthLightnessStep: 5 },
      })
      await openThemeSettings(app.window)
      await activateThemeFromSettings(app.window, '默认深色')
      await expect.poll(() => readFlowConfigVars(app.window)).toEqual({
        mode: 'single',
        main: '#4fc1ff',
        depthHueStep: '16',
        depthSaturationStep: '-4',
        depthLightnessStep: '5',
      })

      await saveThemePayload(app.window, '默认深色', {
        mode: 'multi',
        single: { mainColor: '#4fc1ff' },
        multi: { mainColor: '#ff8844', depthHueStep: 22, depthSaturationStep: -2, depthLightnessStep: 6 },
      })
      await activateThemeFromSettings(app.window, '默认深色')
      await expect.poll(() => readFlowConfigVars(app.window)).toEqual({
        mode: 'multi',
        main: '#ff8844',
        depthHueStep: '22',
        depthSaturationStep: '-2',
        depthLightnessStep: '6',
      })
    } finally {
      await closeApp(app)
    }
  })

  test('[monaco] syntax token edits expose monaco token color evidence', async () => {
    const app = await launchApp(getAppRoot())
    try {
      await openThemeSettings(app.window)
      await setColorTokenByLabel(app.window, '语法高亮-关键字', '#ff0077')
      await setColorTokenByLabel(app.window, '语法高亮-注释', '#00aa55')
      await setColorTokenByLabel(app.window, '语法高亮-字符串', '#ff8800')
      await setColorTokenByLabel(app.window, '语法高亮-类型', '#44aaff')
      const tokenValues = await app.window.evaluate(async () => {
        const current = await window.api.theme.getCurrent()
        return current?.themePayload?.tokenValues || {}
      })
      const tokenColors = await collectMonacoTokenColors(tokenValues, 'dark')
      assertMonacoTokenColorEvidence(tokenColors, {
        keyword: '#ff0077',
        comment: '#00aa55',
        string: '#ff8800',
        type: '#44aaff',
      })
    } finally {
      await closeApp(app)
    }
  })
})
