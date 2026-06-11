const fs = require('node:fs')
const path = require('node:path')
const { expect } = require('@playwright/test')
const {
  getAppRoot,
  launchApp,
  closeApp,
  findThemeManagerPage,
  openThemeManager,
  switchThemeFromMenu,
  themeListItem,
  setColorTokenByLabel,
  getThemeList,
  deleteThemesNotIn,
} = require('./theme-token-coverage-fixtures')

async function chooseThemeFromTitlebar(window, themeId) {
  await switchThemeFromMenu(window, themeId)
}

async function closeThemeManager(app) {
  const page = await findThemeManagerPage(app)
  if (!page) return
  await page.getByRole('button', { name: '关闭主题管理器' }).click()
  await expect.poll(async () => (await findThemeManagerPage(app)) === null).toBe(true)
}

async function createCompatibilityProject(window, projectName) {
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
  await dialog.getByRole('button', { name: '确认创建项目' }).click()
  await expect(window.locator('.editor-tab').first()).toBeVisible()

  // 新建窗口程序项目默认打开可视化设计器；表格编辑器需双击程序集节点打开。
  await window.locator('.sidebar-tab').filter({ hasText: '项目' }).click()
  const assemblyNode = window.locator('.tree-item').filter({ hasText: '窗口程序集' }).first()
  await expect(assemblyNode).toBeVisible()
  await assemblyNode.dblclick()
  await expect(window.locator('.eyc-table-editor')).toBeVisible()
}

// 通过主题管理器创建指定名称的自定义主题：
// 编辑内置主题令牌会自动生成“-副本”主题，保存后经右键菜单重命名为期望名称。
async function createCustomTheme(app, themeName) {
  await switchThemeFromMenu(app.window, '默认深色')
  await expect.poll(async () => app.window.evaluate(async () => (await window.api.theme.getCurrent())?.effectiveThemeId || '')).toBe('默认深色')

  const manager = await openThemeManager(app)
  const before = await getThemeList(app.window)
  await setColorTokenByLabel(manager, '基础文本/背景-主文本', '#33ccaa')

  let copyName = ''
  await expect.poll(async () => {
    const list = await getThemeList(app.window)
    copyName = list.find((id) => !before.includes(id)) || ''
    return copyName
  }).not.toBe('')

  await themeListItem(manager, copyName).first().click()
  await manager.getByRole('button', { name: '保存主题' }).click()
  await expect(manager.locator('.theme-manager-feedback')).toContainText('已保存')

  await themeListItem(manager, copyName).first().click({ button: 'right' })
  await expect(manager.locator('.theme-manager-context-menu')).toBeVisible()
  await manager.getByRole('button', { name: '重命名', exact: true }).click()
  const renameInput = manager.locator('.theme-manager-list-rename-input')
  await renameInput.fill(themeName)
  await renameInput.press('Enter')
  await expect(themeListItem(manager, themeName).first()).toBeVisible()
  await closeThemeManager(app)
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
    const selectors = ['.titlebar', '.sidebar', '.editor-tabs']
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
  openThemeManager,
  closeThemeManager,
  setColorTokenByLabel,
  createCompatibilityProject,
  createCustomTheme,
  ensureThemeSelected,
  chooseThemeFromTitlebar,
  runThemeTransitionScenario,
  assertJitterFailurePolicy,
  getThemeList,
  deleteThemesNotIn,
}
