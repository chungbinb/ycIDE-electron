const { test, expect } = require('@playwright/test')
const {
  getAppRoot,
  launchApp,
  closeApp,
  openThemeManager,
  switchThemeFromMenu,
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
} = require('./helpers/theme-token-coverage-fixtures')
const { collectMonacoTokenColors, assertMonacoTokenColorEvidence } = require('./helpers/monaco-token-assertions')

async function ensureBuiltinDark(app) {
  await switchThemeFromMenu(app.window, '默认深色')
  await expect.poll(async () => app.window.evaluate(async () => (await window.api.theme.getCurrent())?.effectiveThemeId || '')).toBe('默认深色')
}

test.describe('theme token coverage', () => {
  test.describe.configure({ mode: 'serial' })

  test('[smoke] grouped token edits update base/table/header surfaces', async () => {
    const app = await launchApp(getAppRoot())
    const themesBefore = await getThemeList(app.window)
    try {
      await ensureBuiltinDark(app)
      const manager = await openThemeManager(app)
      // 逐项设置并等待生效，避免首次编辑触发的“自动副本”流程与后续编辑竞态。
      await setColorTokenByLabel(manager, '基础文本/背景-主背景', '#112233')
      await expect.poll(() => readRootCssVar(app.window, '--bg-primary')).toBe('#112233')
      await setColorTokenByLabel(manager, '基础文本/背景-主文本', '#abcdef')
      await expect.poll(() => readRootCssVar(app.window, '--text-primary')).toBe('#abcdef')
      await setColorTokenByLabel(manager, '表格与表头-编辑器背景', '#224466')
      await expect.poll(() => readRootCssVar(app.window, '--table-bg')).toBe('#224466')
      await setColorTokenByLabel(manager, '表格与表头-表头背景', '#335577')
      await expect.poll(() => readRootCssVar(app.window, '--table-header-bg')).toBe('#335577')
    } finally {
      await deleteThemesNotIn(app.window, themesBefore)
      await closeApp(app)
    }
  })

  test('reset actions apply immediately with required confirmations', async () => {
    const app = await launchApp(getAppRoot())
    const themesBefore = await getThemeList(app.window)
    try {
      await ensureBuiltinDark(app)
      const manager = await openThemeManager(app)
      await setColorTokenByLabel(manager, '基础文本/背景-主文本', '#111111')
      await expect.poll(() => readRootCssVar(app.window, '--text-primary')).toBe('#111111')
      await clickTokenResetByLabel(manager, '基础文本/背景-主文本')
      await expect.poll(() => readRootCssVar(app.window, '--text-primary')).toBe('#cccccc')

      await setColorTokenByLabel(manager, '基础文本/背景-主背景', '#222222')
      await expect.poll(() => readRootCssVar(app.window, '--bg-primary')).toBe('#222222')
      // window.confirm 由主窗口上下文发起，监听要挂在主窗口。
      acceptNextDialog(app.window, '确定重置该分组令牌吗?')
      await clickGroupResetByTitle(manager, '基础文本/背景')
      await expect.poll(() => readRootCssVar(app.window, '--bg-primary')).toBe('#1e1e1e')

      await setColorTokenByLabel(manager, '表格与表头-编辑器背景', '#333333')
      await expect.poll(() => readRootCssVar(app.window, '--table-bg')).toBe('#333333')
      acceptNextDialog(app.window, '确定恢复全部主题令牌默认值吗?')
      await clickGlobalReset(manager)
      await expect.poll(() => readRootCssVar(app.window, '--table-bg')).toBe('#1e1e1e')
    } finally {
      await deleteThemesNotIn(app.window, themesBefore)
      await closeApp(app)
    }
  })

  test('flow-line single and multi mode apply distinct runtime vars', async () => {
    const app = await launchApp(getAppRoot())
    const themesBefore = await getThemeList(app.window)
    try {
      await ensureBuiltinDark(app)
      const manager = await openThemeManager(app)
      // 内置主题激活时始终回落到主题文件默认 flow-line 配置，
      // 自定义 flow-line 须在自定义主题上验证：先触发自动副本。
      // 注意取值须不同于默认值，否则 onChange 不触发。
      await setColorTokenByLabel(manager, '基础文本/背景-主文本', '#cbcbcb')
      let customThemeId = ''
      await expect.poll(async () => {
        const list = await getThemeList(app.window)
        customThemeId = list.find((id) => !themesBefore.includes(id)) || ''
        return customThemeId
      }).not.toBe('')

      await saveThemePayload(app.window, customThemeId, {
        mode: 'single',
        single: { mainColor: '#4fc1ff' },
        multi: { mainColor: '#4fc1ff', depthHueStep: 16, depthSaturationStep: -4, depthLightnessStep: 5 },
      })
      await applyThemeFromManager(manager, customThemeId)
      await expect.poll(() => readFlowConfigVars(app.window)).toEqual({
        mode: 'single',
        main: '#4fc1ff',
        depthHueStep: '16',
        depthSaturationStep: '-4',
        depthLightnessStep: '5',
      })

      await saveThemePayload(app.window, customThemeId, {
        mode: 'multi',
        single: { mainColor: '#4fc1ff' },
        multi: { mainColor: '#ff8844', depthHueStep: 22, depthSaturationStep: -2, depthLightnessStep: 6 },
      })
      await applyThemeFromManager(manager, customThemeId)
      await expect.poll(() => readFlowConfigVars(app.window)).toEqual({
        mode: 'multi',
        main: '#ff8844',
        depthHueStep: '22',
        depthSaturationStep: '-2',
        depthLightnessStep: '6',
      })
    } finally {
      await app.window.evaluate(async () => { await window.api.theme.setCurrent('默认深色') }).catch(() => {})
      await deleteThemesNotIn(app.window, themesBefore)
      await closeApp(app)
    }
  })

  test('[monaco] syntax token edits expose monaco token color evidence', async () => {
    const app = await launchApp(getAppRoot())
    const themesBefore = await getThemeList(app.window)
    try {
      await ensureBuiltinDark(app)
      const manager = await openThemeManager(app)
      await setColorTokenByLabel(manager, '语法高亮-关键字', '#ff0077')
      await expect.poll(() => readRootCssVar(app.window, '--syntax-keyword')).toBe('#ff0077')
      await setColorTokenByLabel(manager, '语法高亮-注释', '#00aa55')
      await expect.poll(() => readRootCssVar(app.window, '--syntax-comment')).toBe('#00aa55')
      await setColorTokenByLabel(manager, '语法高亮-字符串', '#ff8800')
      await expect.poll(() => readRootCssVar(app.window, '--syntax-string')).toBe('#ff8800')
      await setColorTokenByLabel(manager, '语法高亮-类型', '#44aaff')
      await expect.poll(() => readRootCssVar(app.window, '--syntax-type')).toBe('#44aaff')
      const tokenValues = await app.window.evaluate(() => {
        const style = getComputedStyle(document.documentElement)
        return {
          '--syntax-keyword': style.getPropertyValue('--syntax-keyword').trim(),
          '--syntax-comment': style.getPropertyValue('--syntax-comment').trim(),
          '--syntax-string': style.getPropertyValue('--syntax-string').trim(),
          '--syntax-type': style.getPropertyValue('--syntax-type').trim(),
        }
      })
      const tokenColors = await collectMonacoTokenColors(tokenValues, 'dark')
      assertMonacoTokenColorEvidence(tokenColors, {
        keyword: '#ff0077',
        comment: '#00aa55',
        string: '#ff8800',
        type: '#44aaff',
      })
    } finally {
      await deleteThemesNotIn(app.window, themesBefore)
      await closeApp(app)
    }
  })
})
