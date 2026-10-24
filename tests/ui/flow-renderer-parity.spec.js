/**
 * 流程线渲染后端一致性（设计稿 §11 阶段 4）：同一个文件分别用 DOM 后端和 图像后端打开，
 * 截取表格编辑器的流程线区域逐像素比较。两者共用同一套结构（buildFlowLineSlots），
 * 图像后端按 CSS 的几何生成矢量图，差异应只来自抗锯齿。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test, expect, _electron: electron } = require('@playwright/test')

const appRoot = path.resolve(__dirname, '..', '..')

// 覆盖各种流程线形态：如果/否则、如果真、判断多分支（分支与起始同格重叠）、各种循环、嵌套、紧邻的流程块
const SOURCE = [
  '.版本 2',
  '.程序集 流程线',
  '',
  '.子程序 流程线样例, 整数型',
  '.局部变量 i, 整数型',
  '.局部变量 j, 整数型',
  '',
  '.如果 (i ＞ 1)',
  '    i ＝ 1',
  '.否则',
  '    .如果 (j ＞ 2)',
  '        j ＝ 2',
  '    .否则',
  '        j ＝ 3',
  '    .如果结束',
  '.如果结束',
  '.如果真 (i ＝ 0)',
  '    i ＝ 5',
  '.如果真结束',
  '.判断开始 (i ＝ 1)',
  '    j ＝ 1',
  '.判断 (i ＝ 2)',
  '    .判断开始 (j ＝ 1)',
  '        j ＝ 4',
  '    .默认',
  '        j ＝ 5',
  '    .判断结束',
  '.默认',
  '    j ＝ 6',
  '.判断结束',
  '.计次循环首 (10, i)',
  '    .判断循环首 (j ＜ 3)',
  '        j ＝ j ＋ 1',
  '        .如果真 (j ＝ 2)',
  '            跳出循环 ()',
  '        .如果真结束',
  '    .判断循环尾 ()',
  '    .循环判断首 ()',
  '        j ＝ j － 1',
  '    .循环判断尾 (j ＞ 0)',
  '.计次循环尾 ()',
  '.变量循环首 (1, 10, 1, i)',
  '    .如果 (i ＝ 3)',
  '        到循环尾 ()',
  '    .否则',
  '        .计次循环首 (2, j)',
  '            j ＝ j ＋ i',
  '        .计次循环尾 ()',
  '    .如果结束',
  '.变量循环尾 ()',
  '返回 (0)',
  '',
].join('\r\n')

async function captureFlowArea(renderer, dir) {
  const app = await electron.launch({ args: [appRoot], cwd: appRoot, env: { ...process.env, CI: '1', YCIDE_TABLE_RENDERER: renderer } })
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await win.setViewportSize({ width: 1400, height: 1400 }).catch(() => {})
    const send = (payload) => app.evaluate(({ BrowserWindow }, p) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu:action', { command: 'file:openRecent', args: [p] })
    }, payload)
    await send({ type: 'file', path: path.join(dir, '流程线.eyc') })
    await expect(win.locator('.eyc-table-editor')).toBeVisible()
    await expect(win.locator('.eyc-flow-seg').first()).toBeVisible()
    await win.waitForTimeout(800)
    const kinds = await win.evaluate(() => ({
      image: document.querySelectorAll('.eyc-flow-image').length,
      dom: document.querySelectorAll('.eyc-flow-seg:not(.eyc-flow-image)').length,
    }))
    // 只比较流程线：把代码文字、行号、背景等都隐藏掉
    await win.addStyleTag({ content: `
      .eyc-code-spans > span:not(.eyc-flow-seg):not(.eyc-flow-overlap-slot) { visibility: hidden !important; }
      .eyc-line-gutter, .eyc-gutter-cell, .eyc-table-header, .eyc-minimap-preview, .eyc-var-summary-panel { visibility: hidden !important; }
      .eyc-code-line, .eyc-block-row-wrap { background: #000 !important; }
      .eyc-table-wrapper { background: #000 !important; }
      .eyc-inline-edit-sizing, input { visibility: hidden !important; }
    ` })
    await win.waitForTimeout(300)
    // 只截流程线所在的区域（所有流程线元素的外接矩形，左右各留出箭头可能伸出的余量）
    const clip = await win.evaluate(() => {
      const rects = [...document.querySelectorAll('.eyc-flow-seg, .eyc-flow-overlap-slot')].map(el => el.getBoundingClientRect()).filter(r => r.width > 0)
      const left = Math.min(...rects.map(r => r.left)) - 4
      const top = Math.min(...rects.map(r => r.top)) - 2
      const right = Math.max(...rects.map(r => r.right)) + 40
      const bottom = Math.max(...rects.map(r => r.bottom)) + 2
      return { x: Math.floor(left), y: Math.floor(top), width: Math.ceil(right - left), height: Math.ceil(bottom - top) }
    })
    const png = await win.screenshot({ clip })
    return { png, kinds }
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {})
    await app.close()
  }
}

test('流程线：图像后端与 DOM 后端画出的结果一致', async () => {
  test.setTimeout(180000)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycide-flowparity-'))
  fs.writeFileSync(path.join(dir, '流程线.eyc'), SOURCE, 'utf-8')
  try {
    const dom = await captureFlowArea('ycide.dom', dir)
    const image = await captureFlowArea('ycide.image', dir)
    expect(dom.kinds.image).toBe(0)
    expect(dom.kinds.dom).toBeGreaterThan(20)
    expect(image.kinds.image).toBeGreaterThan(20)

    const outDir = path.join(appRoot, 'test-results', 'flow-renderer-parity')
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'dom.png'), dom.png)
    fs.writeFileSync(path.join(outDir, 'image.png'), image.png)

    // 在一个空白 Electron 窗口里逐像素比较（不额外依赖图像库）
    const app = await electron.launch({ args: [appRoot], cwd: appRoot, env: { ...process.env, CI: '1' } })
    try {
      const win = await app.firstWindow()
      const result = await win.evaluate(async ([a, b]) => {
        const load = (b64) => new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(img); img.src = `data:image/png;base64,${b64}` })
        const [ia, ib] = await Promise.all([load(a), load(b)])
        const w = Math.min(ia.width, ib.width)
        const h = Math.min(ia.height, ib.height)
        const pixels = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data }
        const pa = pixels(ia)
        const pb = pixels(ib)
        const diffCanvas = document.createElement('canvas'); diffCanvas.width = w; diffCanvas.height = h
        const dctx = diffCanvas.getContext('2d')
        const diff = dctx.createImageData(w, h)
        // 「亮」= 有流程线颜色；比较时允许 1px 偏差：一边亮的像素，另一边 1px 范围内也要有亮像素
        const litA = new Uint8Array(w * h)
        const litB = new Uint8Array(w * h)
        for (let i = 0, p = 0; i < pa.length; i += 4, p++) {
          litA[p] = pa[i] + pa[i + 1] + pa[i + 2] > 150 ? 1 : 0
          litB[p] = pb[i] + pb[i + 1] + pb[i + 2] > 150 ? 1 : 0
        }
        const near = (lit, x, y) => {
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx; const ny = y + dy
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && lit[ny * w + nx]) return true
          }
          return false
        }
        let lit = 0; let differ = 0
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const p = y * w + x; const i = p * 4
          if (litA[p]) lit++
          const miss = (litA[p] && !near(litB, x, y)) || (litB[p] && !near(litA, x, y))
          if (miss) { differ++; diff.data[i] = 255 } else if (litA[p] || litB[p]) diff.data[i + 1] = 110
          diff.data[i + 3] = 255
        }
        dctx.putImageData(diff, 0, 0)
        return { w, h, sizeA: [ia.width, ia.height], sizeB: [ib.width, ib.height], lit, differ, diffPng: diffCanvas.toDataURL('image/png').split(',')[1] }
      }, [dom.png.toString('base64'), image.png.toString('base64')])
      fs.writeFileSync(path.join(outDir, 'diff.png'), Buffer.from(result.diffPng, 'base64'))
      console.log('PARITY', JSON.stringify({ ...result, diffPng: undefined }))
      expect(result.sizeA).toEqual(result.sizeB)
      expect(result.lit).toBeGreaterThan(500)
      // 抗锯齿差异已由 1px 容差吸收；剩下的差异意味着少画或多画了线段、箭头
      expect(result.differ).toBeLessThan(10)
    } finally {
      await app.close()
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
