const { test, expect } = require('@playwright/test')
const {
  getAppRoot,
  launchApp,
  closeApp,
  openThemeSettings,
  createCompatibilityProject,
  createCustomTheme,
  ensureThemeSelected,
  runThemeTransitionScenario,
  assertJitterFailurePolicy,
} = require('./helpers/theme-compatibility-fixtures')

const BUILTIN_DARK = '默认深色'
const BUILTIN_LIGHT = '默认浅色'

test.describe('theme compatibility', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(300000)

  test('QUAL-01: editor/table interactions stay usable during transition-in-progress and post-transition for built-in + custom themes', async () => {
    const app = await launchApp(getAppRoot())
    try {
      await createCompatibilityProject(app.window, 'QUAL01兼容性')
      await openThemeSettings(app.window)
      const customTheme = `QUAL-01-自定义-${Date.now()}`
      await createCustomTheme(app.window, customTheme)

      const scenarios = [
        { source: BUILTIN_LIGHT, target: BUILTIN_DARK },
        { source: BUILTIN_DARK, target: BUILTIN_LIGHT },
        { source: BUILTIN_DARK, target: customTheme },
      ]

      for (const scenario of scenarios) {
        await ensureThemeSelected(app.window, scenario.source)
        await runThemeTransitionScenario(app.window, {
          scenarioPath: `QUAL-01/${scenario.source}->${scenario.target}/interaction`,
          targetThemeId: scenario.target,
          markerSeed: `${scenario.source}-to-${scenario.target}`,
        })
      }
    } finally {
      await closeApp(app)
    }
  })

  test('QUAL-01 jitter: collect per-scenario jitter samples for transition paths', async () => {
    const app = await launchApp(getAppRoot())
    try {
      await createCompatibilityProject(app.window, 'QUAL01抖动采样')
      await openThemeSettings(app.window)
      const customTheme = `QUAL-01-抖动-${Date.now()}`
      await createCustomTheme(app.window, customTheme)
      const scenarios = [
        { source: BUILTIN_LIGHT, target: BUILTIN_DARK },
        { source: BUILTIN_DARK, target: BUILTIN_LIGHT },
        { source: BUILTIN_DARK, target: customTheme },
      ]
      const reports = []
      for (const scenario of scenarios) {
        await ensureThemeSelected(app.window, scenario.source)
        const report = await runThemeTransitionScenario(app.window, {
          scenarioPath: `QUAL-01/${scenario.source}->${scenario.target}/jitter`,
          targetThemeId: scenario.target,
          markerSeed: `jitter-${scenario.source}-to-${scenario.target}`,
        })
        reports.push(report)
        assertJitterFailurePolicy(report, 0.5)
      }
      expect(reports).toHaveLength(3)
      for (const report of reports) {
        expect(report?.sampleCount ?? 0).toBeGreaterThan(0)
      }
    } finally {
      await closeApp(app)
    }
  })
})
