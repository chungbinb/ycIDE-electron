/**
 * 表格编辑器性能测量（设计稿 §11 阶段 4：开工前录制基线，切换渲染后端后对比）。
 * 不在常规测试里跑：npx playwright test --config tests/perf/playwright.perf.config.js
 *
 * 生成一个带多层嵌套流程的大文件，在真实 IDE 里测：
 *   - 打开耗时：从发出打开命令到表格可见
 *   - 滚动：逐步滚到底，统计每帧耗时（rAF 间隔）的中位数、P95、最大值与长任务
 *   - 输入：在代码行里连续输入字符，统计「按键 → 下一帧」的延迟
 *   - CPU 剖析：滚动和输入期间 JS 自身耗时最高的函数（判断瓶颈在 React 还是布局 / 绘制）
 * 结果写到 test-results/table-editor-perf-<渲染后端>-x<降速>-<子程序数>.json，并打印摘要。
 * 环境变量：YCIDE_TABLE_RENDERER（渲染后端 ID，默认 ycide.dom）、YCIDE_PERF_CPU_THROTTLE、YCIDE_PERF_SUBS、YCIDE_PERF_INJECT_CSS。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test, expect, _electron: electron } = require('@playwright/test')

const appRoot = path.resolve(__dirname, '..', '..')
const RENDERER = process.env.YCIDE_TABLE_RENDERER || 'ycide.dom'
// 模拟较慢的机器：CPU 降速倍数（1 = 不降速）；文件规模：子程序数 × 每个子程序的流程块数
const CPU_THROTTLE = Number(process.env.YCIDE_PERF_CPU_THROTTLE || 1)
const SUB_COUNT = Number(process.env.YCIDE_PERF_SUBS || 25)
// 诊断用：注入一段 CSS（如隐藏流程线），看某部分界面占多少渲染开销
const INJECT_CSS = process.env.YCIDE_PERF_INJECT_CSS || ''

function makeLargeSource(subCount, statementsPerSub) {
  const lines = ['.版本 2', '.程序集 性能测试', '']
  for (let s = 0; s < subCount; s++) {
    lines.push(`.子程序 子程序${s}, 整数型`, '.局部变量 i, 整数型', '.局部变量 j, 整数型', '.局部变量 文本, 文本型', '')
    for (let k = 0; k < statementsPerSub; k++) {
      lines.push('.计次循环首 (10, i)')
      lines.push('    .如果 (i ＞ 5)')
      lines.push('        .判断循环首 (j ＜ 3)')
      lines.push('            文本 ＝ 到文本 (i ＋ j)')
      lines.push('            .如果真 (取文本长度 (文本) ＞ 1)')
      lines.push('                j ＝ j ＋ 1')
      lines.push('            .如果真结束')
      lines.push('        .判断循环尾 ()')
      lines.push('    .否则')
      lines.push('        信息框 (“测试” ＋ 到文本 (i), 0, , )')
      lines.push('    .如果结束')
      lines.push('.计次循环尾 ()')
    }
    lines.push('返回 (0)', '')
  }
  return lines.join('\r\n')
}

function percentile(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

function summarizeProfile(profile, top = 15) {
  const self = new Map()
  const nodes = new Map(profile.nodes.map(n => [n.id, n]))
  const dt = profile.timeDeltas
  for (let i = 0; i < profile.samples.length; i++) {
    const node = nodes.get(profile.samples[i])
    const fn = node.callFrame
    const key = `${fn.functionName || '(anonymous)'} ${path.basename(fn.url || '')}:${fn.lineNumber}`
    self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000)
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0)
  return {
    totalMs: Math.round(total),
    top: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => `${v.toFixed(1)}ms ${k}`),
  }
}

test(`表格编辑器性能（渲染后端：${RENDERER}）`, async () => {
  test.setTimeout(300000)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycide-perf-'))
  const source = makeLargeSource(SUB_COUNT, 10)
  fs.writeFileSync(path.join(dir, 'p.epp'), ['# YiCode Project File', 'Version=1', 'ProjectName=性能测试', 'OutputType=WindowsConsole', 'Platform=windows', '', 'File=EYC|性能测试.eyc|0', ''].join('\n'), 'utf-8')
  fs.writeFileSync(path.join(dir, '性能测试.eyc'), source, 'utf-8')
  const app = await electron.launch({ args: [appRoot], cwd: appRoot, env: { ...process.env, CI: '1', YCIDE_TABLE_RENDERER: RENDERER } })
  const result = { renderer: RENDERER, sourceLines: source.split('\r\n').length }
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await win.setViewportSize({ width: 1600, height: 1000 }).catch(() => {})
    const send = (payload) => app.evaluate(({ BrowserWindow }, p) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu:action', { command: 'file:openRecent', args: [p] })
    }, payload)
    await send({ type: 'project', path: path.join(dir, 'p.epp') })
    await expect(win.getByText('性能测试').first()).toBeVisible()

    const t0 = Date.now()
    await send({ type: 'file', path: path.join(dir, '性能测试.eyc') })
    await expect(win.locator('.eyc-table-editor')).toBeVisible()
    await win.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    result.openMs = Date.now() - t0
    if (INJECT_CSS) await win.addStyleTag({ content: INJECT_CSS })
    await win.waitForTimeout(1500)

    const cdp = await win.context().newCDPSession(win)
    if (CPU_THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 })

    // 滚动：每帧滚动 120px，滚到底
    await cdp.send('Performance.enable')
    const metricsOf = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
    const before = await metricsOf()
    await cdp.send('Profiler.start')
    result.scroll = await win.evaluate(async () => {
      const wrapper = document.querySelector('.eyc-table-wrapper')
      const frames = []
      const longTasks = []
      // 空白帧：视口上下边缘落在虚拟化占位块（或滚动容器本身）上，说明行还没渲染出来
      let blankFrames = 0
      const rect = wrapper.getBoundingClientRect()
      const isBlank = (y) => {
        const el = document.elementFromPoint(rect.left + 120, y)
        return !el || el === wrapper || el.classList.contains('eyc-virtual-spacer') || !!el.closest('.eyc-virtual-spacer')
      }
      const obs = new PerformanceObserver(list => { for (const e of list.getEntries()) longTasks.push(e.duration) })
      try { obs.observe({ entryTypes: ['longtask'] }) } catch { /* 不支持 */ }
      let last = performance.now()
      const max = wrapper.scrollHeight - wrapper.clientHeight
      while (wrapper.scrollTop < max - 1) {
        wrapper.scrollTop = Math.min(max, wrapper.scrollTop + 120)
        await new Promise(r => requestAnimationFrame(r))
        const now = performance.now()
        frames.push(now - last)
        last = now
        if (isBlank(rect.top + 30) || isBlank(rect.bottom - 30)) blankFrames++
      }
      obs.disconnect()
      return { frames, longTasks, blankFrames, scrollHeight: wrapper.scrollHeight }
    })
    result.scrollProfile = summarizeProfile((await cdp.send('Profiler.stop')).profile)
    // 滚动期间浏览器各类工作的耗时（秒→毫秒）与布局、样式计算次数
    const after = await metricsOf()
    result.scrollMetrics = Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount', 'Nodes']
      .map(k => [k, k.endsWith('Duration') ? Math.round((after[k] - before[k]) * 1000) : k === 'Nodes' ? after[k] : after[k] - before[k]]))

    // 输入：回到顶部，进入第一行可编辑代码，逐字输入
    await win.evaluate(() => { document.querySelector('.eyc-table-wrapper').scrollTop = 0 })
    await win.waitForTimeout(500)
    const codeCell = win.locator('.eyc-table-wrapper .eyc-code-line').filter({ hasText: '到文本 (i ＋ j)' }).first()
    await codeCell.click()
    await win.waitForTimeout(300)
    await cdp.send('Profiler.start')
    const typing = []
    for (let i = 0; i < 20; i++) {
      const ms = await win.evaluate(() => new Promise(resolve => {
        const start = performance.now()
        const target = document.activeElement
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
        if (target && 'value' in target) {
          const el = target
          const proto = Object.getPrototypeOf(el)
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
          setter?.call(el, el.value + 'a')
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)))
      }))
      typing.push(ms)
    }
    result.typingProfile = summarizeProfile((await cdp.send('Profiler.stop')).profile)
    result.typing = typing
    result.focusTag = await win.evaluate(() => document.activeElement?.tagName)

    const frames = result.scroll.frames
    result.summary = {
      openMs: result.openMs,
      scrollFrames: frames.length,
      scrollFrameMedianMs: +percentile(frames, 0.5).toFixed(1),
      scrollFrameP95Ms: +percentile(frames, 0.95).toFixed(1),
      scrollFrameMaxMs: +Math.max(...frames).toFixed(1),
      scrollLongTasks: result.scroll.longTasks.length,
      scrollBlankFrames: result.scroll.blankFrames,
      typingMedianMs: +percentile(typing, 0.5).toFixed(1),
      typingP95Ms: +percentile(typing, 0.95).toFixed(1),
    }
    const out = path.join(appRoot, 'test-results', `table-editor-perf-${RENDERER}-x${CPU_THROTTLE}-${SUB_COUNT}.json`)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, JSON.stringify(result, null, 2))
    console.log('SUMMARY', JSON.stringify(result.summary))
    console.log('SCROLL_METRICS', JSON.stringify(result.scrollMetrics))
    console.log('SCROLL_PROFILE', JSON.stringify(result.scrollProfile, null, 1))
    console.log('TYPING_PROFILE', JSON.stringify(result.typingProfile, null, 1))
    console.log('FOCUS', result.focusTag)
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {})
    await app.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
