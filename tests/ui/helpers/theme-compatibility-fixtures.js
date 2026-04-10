const fs = require('node:fs')
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
  if (await dialog.isVisible().catch(() => false)) return
  await window.getByRole('menuitem', { name: '工具(T)' }).click()
  await window.getByRole('menuitem', { name: '系统配置(O)' }).click()
  await expect(dialog).toBeVisible()
}

async function closeThemeSettings(window) {
  const dialog = window.locator('.theme-settings-dialog')
  if (!(await dialog.isVisible().catch(() => false))) return
  await dialog.locator('.theme-settings-close').click()
  await expect(dialog).toBeHidden()
}

async function chooseThemeFromTitlebar(window, themeId) {
  await closeThemeSettings(window)
  await window.getByRole('menuitem', { name: '查看(V)' }).click()
  const themeMenu = window.getByRole('menuitem', { name: '主题' })
  await themeMenu.hover()
  if (!(await window.getByRole('menuitem', { name: themeId }).isVisible().catch(() => false))) {
    await themeMenu.click()
  }
  await window.getByRole('menuitem', { name: themeId }).click()
}

async function createCompatibilityProject(window, projectName) {
  await closeThemeSettings(window)
  const appRoot = getAppRoot()
  const workspaceRoot = path.join(appRoot, 'test-results', 'theme-compatibility-workspace')
  fs.mkdirSync(workspaceRoot, { recursive: true })
  const targetRoot = path.join(workspaceRoot, `${projectName}-${Date.now()}`)
  fs.mkdirSync(targetRoot, { recursive: true })

  await window.getByRole('menuitem', { name: '文件(F)' }).click()
  await window.getByRole('menuitem', { name: '新建项目(N)' }).click()
  const dialog = window.locator('.np-dialog')
  await expect(dialog).toBeVisible()
  const inputs = dialog.locator('input[type=text]')
  await inputs.nth(0).fill(projectName)
  await inputs.nth(1).fill(targetRoot)
  await dialog.getByRole('button', { name: '确定' }).click()
  await expect(window.locator('.editor-tab')).toHaveCount(1)

  await window.locator('.sidebar-tab').filter({ hasText: '项目' }).click()
  const eycNode = window.locator('.tree-item').filter({ hasText: /\.eyc$/ }).first()
  await expect(eycNode).toBeVisible()
  await eycNode.dblclick()
  await expect(window.locator('.eyc-table-editor')).toBeVisible()
}

async function setColorTokenByLabel(window, label, value) {
  const input = window.getByLabel(label)
  await input.fill((value || '').toLowerCase())
  await input.press('Enter')
}

async function createCustomTheme(window, themeName) {
  await openThemeSettings(window)
  await setColorTokenByLabel(window, '基础文本/背景-主文本', '#33ccaa')
  await window.getByLabel('自定义主题名称').fill(themeName)
  await window.getByRole('button', { name: '保存为自定义主题' }).click()
  const customThemeRadio = window.getByRole('radio', { name: themeName })
  await expect(customThemeRadio).toBeVisible()
  await expect(customThemeRadio).toHaveAttribute('aria-checked', 'true')
  await closeThemeSettings(window)
}

async function ensureThemeSelected(window, themeId) {
  await chooseThemeFromTitlebar(window, themeId)
  await expect.poll(async () => {
    const current = await window.evaluate(async () => window.api.theme.getCurrent())
    return current?.effectiveThemeId || ''
  }).toBe(themeId)
}

async function startJitterSampling(window, scenarioPath) {
  await window.evaluate((scenario) => {
    const selectors = ['.titlebar', '.sidebar', '.editor-tabs', '.theme-settings-dialog']
    const initial = {}
    const max = {}
    for (const selector of selectors) {
      initial[selector] = null
      max[selector] = { x: 0, y: 0, width: 0, height: 0 }
    }
    const state = {
      active: true,
      scenarioPath: scenario,
      selectors,
      sampleCount: 0,
      missingSelectors: [],
      initial,
      maxDelta: max,
    }
    window.__qualJitterState = state

    const sample = () => {
      if (!state.active) return
      state.sampleCount += 1
      for (const selector of selectors) {
        const el = document.querySelector(selector)
        if (!el) {
          if (!state.missingSelectors.includes(selector)) state.missingSelectors.push(selector)
          continue
        }
        const rect = el.getBoundingClientRect()
        const current = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        if (!state.initial[selector]) {
          state.initial[selector] = current
          continue
        }
        const baseline = state.initial[selector]
        state.maxDelta[selector] = {
          x: Math.max(state.maxDelta[selector].x, Math.abs(current.x - baseline.x)),
          y: Math.max(state.maxDelta[selector].y, Math.abs(current.y - baseline.y)),
          width: Math.max(state.maxDelta[selector].width, Math.abs(current.width - baseline.width)),
          height: Math.max(state.maxDelta[selector].height, Math.abs(current.height - baseline.height)),
        }
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }, scenarioPath)
}

async function stopJitterSampling(window) {
  return window.evaluate(() => {
    if (!window.__qualJitterState) return null
    window.__qualJitterState.active = false
    const snapshot = { ...window.__qualJitterState }
    window.__qualJitterState = undefined
    return snapshot
  })
}

async function probeEditorInputAndCursor(window, marker) {
  const { row, input } = await openEditableTableCell(window)
  await input.press('End')
  await input.type(marker)
  const before = await input.evaluate(el => el.selectionStart ?? 0)
  await window.keyboard.press('ArrowLeft')
  const after = await input.evaluate(el => el.selectionStart ?? 0)
  expect(after).toBeLessThan(before)
  await window.keyboard.press('Enter')
  await expect(row).toContainText(marker)
}

async function probeTableEditAndSelection(window, marker) {
  const { row, input } = await openEditableTableCell(window, 1)
  await input.fill(marker)
  await input.dblclick()
  const selection = await input.evaluate(el => ({
    start: el.selectionStart ?? -1,
    end: el.selectionEnd ?? -1,
  }))
  expect(selection.end).toBeGreaterThan(selection.start)
  await input.press('Enter')
  await expect(row).toContainText(marker)
}

async function probeScroll(window) {
  const wrapper = window.locator('.eyc-table-wrapper')
  await expect(wrapper).toBeVisible()
  await wrapper.hover()
  const before = await wrapper.evaluate(el => ({ top: el.scrollTop, scrollable: el.scrollHeight > el.clientHeight }))
  await window.mouse.wheel(0, 360)
  const after = await wrapper.evaluate(el => el.scrollTop)
  if (before.scrollable) {
    expect(after).toBeGreaterThan(before.top)
  }
}

async function probeFocusSwitch(window) {
  await openEditableTableCell(window)
  await expect(window.locator('.eyc-cell-input')).toBeVisible()
  const viewMenu = window.getByRole('menuitem', { name: '查看(V)' })
  await viewMenu.click()
  await expect(viewMenu).toBeVisible()
  await window.keyboard.press('Escape')
  await openEditableTableCell(window)
  await expect(window.locator('.eyc-cell-input')).toBeVisible()
}

async function openEditableTableCell(window, preferredRowIndex = 0) {
  const rows = window.locator('tr.eyc-data-row')
  const rowCount = await rows.count()
  expect(rowCount).toBeGreaterThan(0)
  const input = window.locator('.eyc-cell-input')
  for (let rowOffset = 0; rowOffset < rowCount; rowOffset++) {
    const rowIndex = (preferredRowIndex + rowOffset) % rowCount
    const row = rows.nth(rowIndex)
    const cells = row.locator('td')
    const cellCount = await cells.count()
    for (let ci = 0; ci < cellCount; ci++) {
      await cells.nth(ci).click()
      if (await input.isVisible().catch(() => false)) {
        return { row, input, rowIndex }
      }
    }
  }
  throw new Error('QUAL-01 table probe could not find editable table cell')
}

async function runInteractionProbe(window, stateLabel, marker) {
  await probeEditorInputAndCursor(window, `${marker}-${stateLabel}-editor`)
  await probeTableEditAndSelection(window, `${marker}-${stateLabel}-table`)
  await probeScroll(window)
  await probeFocusSwitch(window)
}

async function runThemeTransitionScenario(window, { scenarioPath, targetThemeId, markerSeed }) {
  await closeThemeSettings(window)
  await startJitterSampling(window, scenarioPath)
  await chooseThemeFromTitlebar(window, targetThemeId)
  await runInteractionProbe(window, 'transition-in-progress', markerSeed)
  await expect.poll(async () => {
    const current = await window.evaluate(async () => window.api.theme.getCurrent())
    return current?.effectiveThemeId || ''
  }).toBe(targetThemeId)
  await runInteractionProbe(window, 'post-transition', markerSeed)
  return await stopJitterSampling(window)
}

function assertJitterFailurePolicy(report, threshold = 0.5) {
  if (!report) {
    throw new Error('QUAL-01 jitter failure: missing jitter sampling report')
  }
  const violations = []
  for (const [selector, delta] of Object.entries(report.maxDelta || {})) {
    for (const axis of ['x', 'y', 'width', 'height']) {
      const value = Number(delta?.[axis] || 0)
      if (value > threshold) {
        violations.push({ selector, axis, value })
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(`QUAL-01 jitter failure at ${report.scenarioPath}: ${JSON.stringify({
      threshold,
      sampleCount: report.sampleCount,
      violations,
      maxDelta: report.maxDelta,
    })}`)
  }
}

module.exports = {
  getAppRoot,
  launchApp,
  closeApp,
  openThemeSettings,
  setColorTokenByLabel,
  createCompatibilityProject,
  createCustomTheme,
  ensureThemeSelected,
  chooseThemeFromTitlebar,
  runThemeTransitionScenario,
  assertJitterFailurePolicy,
}
