/**
 * 表格编辑器行多选：从单元格拖动、Shift / Ctrl+单击、Shift+↑↓、点表头整组选中。
 * 选区按画布上鼠标实际到达的行来定；点「DLL命令名」表头选整个命令，删除声明行时连同参数一起删。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test, expect } = require('@playwright/test')
const { launchIsolatedApp } = require('./helpers/launch-app')
const { closeAppDiscardingChanges } = require('./helpers/close-app')

function writeProject(fileType, fileName, source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycide-multiselect-'))
  fs.writeFileSync(path.join(dir, 'p.epp'), ['# YiCode Project File', 'Version=1', 'ProjectName=多选', 'OutputType=WindowsConsole', 'Platform=windows', '', `File=${fileType}|${fileName}|0`, ''].join('\n'), 'utf-8')
  fs.writeFileSync(path.join(dir, fileName), source, 'utf-8')
  return { dir, file: path.join(dir, fileName) }
}

async function openInIde(app, win, dir, file) {
  const send = (p) => app.evaluate(({ BrowserWindow }, p) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:action', { command: 'file:openRecent', args: [p] })
  }, p)
  await send({ type: 'project', path: path.join(dir, 'p.epp') })
  await expect(win.locator('#sidebar-panel-project .tree-item').first()).toContainText('多选')
  await send({ type: 'file', path: file })
}

/** 某源码行被高亮的可见行数（DLL 命令声明一行源码画成命令名 / 库文件名 / 对应命令名 3 个可见行） */
function highlightedRowsOfLine(win, lineIndex, cls = 'eyc-line-selected') {
  return win.locator(`.eyc-table-editor tr.eyc-data-row.${cls}[data-line-index="${lineIndex}"]`).count()
}

/** 选中的数据行（按源码行号去重排序；空行不显示在表格里，不会出现在这里） */
function selectedLines(win) {
  return win.evaluate(() => [...new Set([...document.querySelectorAll('.eyc-table-editor .eyc-line-selected[data-line-index]')]
    .map(r => Number(r.dataset.lineIndex)))].sort((a, b) => a - b))
}

test('DLL 命令编辑器：多选与整块选中', async () => {
  test.setTimeout(120000)
  const src = ['.版本 2', '']
  for (let i = 1; i <= 4; i++) src.push(`.DLL命令 API${i}, 整数型, "user32.dll", "Func${i}", , 备注${i}`, '    .参数 参数A, 整数型', '    .参数 参数B, 文本型', '')
  // 行号：API1=2(参数3,4) API2=6(7,8) API3=10(11,12) API4=14(15,16)
  const { dir, file } = writeProject('ELL', 'DLL命令.ell', src.join('\n'))
  const { app } = await launchIsolatedApp()
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await openInIde(app, win, dir, file)
    const cell = (t) => win.locator('.eyc-table-editor td').filter({ hasText: new RegExp(`^${t}$`) }).first()
    await expect(cell('API1')).toBeVisible()
    const reset = async () => {
      await cell('备注4').click()
      await win.keyboard.press('Escape')
      await win.waitForTimeout(300)
      await win.evaluate(() => { document.querySelector('.eyc-table-wrapper').scrollTop = 0 })
      await expect.poll(() => win.evaluate(() => document.querySelector('.eyc-table-wrapper').scrollTop)).toBe(0)
      await win.waitForTimeout(100)
    }

    // 在「DLL库文件名」格里按下、在同一可见行里晃动：不转行多选，松手进入编辑
    const lib = await cell('user32.dll').boundingBox()
    await win.mouse.move(lib.x + 20, lib.y + lib.height / 2)
    await win.mouse.down()
    await win.mouse.move(lib.x + 60, lib.y + lib.height / 2 + 3, { steps: 6 })
    expect(await selectedLines(win)).toEqual([])
    await win.mouse.up()
    expect(await selectedLines(win)).toEqual([])
    // 进入编辑后只有库文件名这一可见行显示编辑背景，命令名、对应命令名两行不亮
    expect(await highlightedRowsOfLine(win, 2, 'eyc-line-editing')).toBe(1)
    expect(await win.locator('.eyc-table-editor tr.eyc-line-editing').first()).toContainText('user32.dll')
    await reset()

    // 从「DLL库文件名」拖到本命令的第一个参数：只选到鼠标到达的行（声明 + 参数A），不自动带上参数B
    const lib2 = await cell('user32.dll').boundingBox()
    const paramA = await win.locator('.eyc-table-editor tr[data-line-index="3"]').first().boundingBox()
    await win.mouse.move(lib2.x + 20, lib2.y + lib2.height / 2)
    await win.mouse.down()
    await win.mouse.move(paramA.x + 20, paramA.y + paramA.height / 2, { steps: 10 })
    await win.mouse.up()
    expect(await selectedLines(win)).toEqual([2, 3])
    // 声明行只亮鼠标经过的库文件名、对应命令名两个可见行，命令名那一行不亮
    expect(await highlightedRowsOfLine(win, 2)).toBe(2)
    await reset()

    // 从单元格按住拖到另一个命令的命令名行：选到那一行为止，不进入编辑
    // （拖到 API2 而不是更远：拖近编辑器下边缘会自动滚动，鼠标所到的行跟着变）
    const a = await cell('API1').boundingBox()
    const b = await cell('API2').boundingBox()
    await win.mouse.move(a.x + 20, a.y + a.height / 2)
    await win.mouse.down()
    await win.mouse.move(b.x + 20, b.y + b.height / 2, { steps: 12 })
    await win.mouse.up()
    expect(await selectedLines(win)).toEqual([2, 3, 4, 6])
    expect(await win.locator('.eyc-table-editor td input').count()).toBe(0)
    // 只亮鼠标经过的可见行：API1 从命令名行起（其上的「DLL命令名」表头不亮，库文件名、对应命令名、参数表头亮），
    // API2 只到命令名行（上面的「DLL命令名」表头亮，库文件名等不亮）
    expect(await win.locator('.eyc-table-editor tr.eyc-hdr-row.eyc-line-selected').count()).toBe(4)
    expect(await highlightedRowsOfLine(win, 2)).toBe(3)
    expect(await highlightedRowsOfLine(win, 6)).toBe(1)
    await reset()

    // Shift+单击
    await cell('API1').click()
    await cell('API3').click({ modifiers: ['Shift'] })
    expect(await selectedLines(win)).toEqual([2, 3, 4, 6, 7, 8, 10])
    expect(await highlightedRowsOfLine(win, 10)).toBe(1)
    await reset()

    // Ctrl+单击：编辑 API1 时 Ctrl 点 API3 得到这两行；再 Ctrl 点 API3 取消
    await cell('API1').click()
    await cell('API3').click({ modifiers: ['Control'] })
    expect(await selectedLines(win)).toEqual([2, 10])
    expect(await highlightedRowsOfLine(win, 2)).toBe(1)
    expect(await highlightedRowsOfLine(win, 10)).toBe(1)
    // 再 Ctrl 点 API1 的库文件名：同一条声明多亮一个可见行
    await cell('user32.dll').click({ modifiers: ['Control'] })
    expect(await highlightedRowsOfLine(win, 2)).toBe(2)
    await cell('user32.dll').click({ modifiers: ['Control'] })
    await cell('API3').click({ modifiers: ['Control'] })
    expect(await selectedLines(win)).toEqual([2])
    await reset()

    // Shift+↓ / ↑：从编辑中的命令开始逐行扩、缩
    await cell('API2').click()
    await win.keyboard.press('Shift+ArrowDown')
    expect(await selectedLines(win)).toEqual([6, 7])
    for (let i = 0; i < 3; i++) await win.keyboard.press('Shift+ArrowDown')
    expect(await selectedLines(win)).toEqual([6, 7, 8, 10])
    for (let i = 0; i < 3; i++) await win.keyboard.press('Shift+ArrowUp')
    expect(await selectedLines(win)).toEqual([6, 7])
    await reset()

    // 点「DLL命令名」表头选中整个命令（连同参数）；点「DLL库文件名：」标签行只选声明行
    await win.locator('.eyc-table-editor tr.eyc-hdr-row').filter({ hasText: 'DLL命令名' }).nth(1).locator('td').first().click()
    expect(await selectedLines(win)).toEqual([6, 7, 8])
    await win.locator('.eyc-table-editor tr.eyc-hdr-row').filter({ hasText: 'DLL库文件名' }).nth(1).locator('td').first().click()
    expect(await selectedLines(win)).toEqual([6])
    expect(await highlightedRowsOfLine(win, 6)).toBe(1)

    // 单击普通单元格：清掉选区、进入编辑
    await cell('API4').click()
    expect(await selectedLines(win)).toEqual([])
    expect(await win.locator('.eyc-table-editor td input').count()).toBe(1)

    // Shift 从 API1 选到 API2 的命令名行后 Delete：API1 整条（三行都选中）连同参数删掉；
    // API2 只选中了命令名那一可见行，不删命令，只清空这一行的格子（命令名保留）
    await cell('API1').click()
    await cell('API2').click({ modifiers: ['Shift'] })
    expect(await selectedLines(win)).toEqual([2, 3, 4, 6])
    await win.keyboard.press('Delete')
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu:action', { command: 'file:save', args: [] })
    })
    await expect.poll(() => fs.readFileSync(file, 'utf-8')).not.toContain('API1')
    const saved = fs.readFileSync(file, 'utf-8')
    expect(saved).toMatch(/^\.DLL命令 API2, , "user32\.dll", "Func2"$/m)
    expect(saved).toContain('API3')
    expect((saved.match(/\.参数/g) || []).length).toBe(6)

    // 右键单元格仍弹出菜单
    await cell('API3').click({ button: 'right' })
    await expect(win.getByText('N.新DLL命令')).toBeVisible()
    await win.keyboard.press('Escape')

    // 把库文件名改成别的：保存后带引号
    // （单元格编辑框里 Ctrl+A 是编辑器的「全选所有行」，这里直接填值）
    await cell('user32.dll').click()
    const libInput = win.locator('.eyc-table-editor td input').first()
    await expect(libInput).toHaveValue('user32.dll')
    await libInput.fill('kernel32.dll')
    await libInput.press('Enter')
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu:action', { command: 'file:save', args: [] })
    })
    await expect.poll(() => fs.readFileSync(file, 'utf-8')).toContain('"kernel32.dll"')
    expect(fs.readFileSync(file, 'utf-8')).not.toMatch(/, kernel32\.dll/)
  } finally {
    await closeAppDiscardingChanges(app)
  }
})

test('DLL 命令编辑器：从下方空白处往上拖选起点是按下的位置；单元格编辑态也能拖选多行', async () => {
  test.setTimeout(120000)
  const src = ['.版本 2', '']
  for (let i = 1; i <= 2; i++) src.push(`.DLL命令 API${i}, 整数型, "user32.dll", "Func${i}", , 备注${i}`, '    .参数 参数A, 整数型', '    .参数 参数B, 文本型', '')
  // 行号：API1=2(参数3,4) API2=6(7,8)
  const { dir, file } = writeProject('ELL', 'DLL命令.ell', src.join('\n'))
  const { app } = await launchIsolatedApp()
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await openInIde(app, win, dir, file)
    const cell = (t) => win.locator('.eyc-table-editor td').filter({ hasText: new RegExp(`^${t}$`) }).first()
    await expect(cell('API1')).toBeVisible()

    for (const focusText of ['API1', 'user32.dll']) {
      // 先点上面的单元格（命令名 / 库文件名），让它成为上一次的焦点
      await cell(focusText).click()
      const wrapper = await win.locator('.eyc-table-wrapper').boundingBox()
      const blankY = wrapper.y + wrapper.height - 40
      // 在下方空白处按下：此时不应有任何选中
      await win.mouse.move(wrapper.x + 300, blankY)
      await win.mouse.down()
      await win.mouse.move(wrapper.x + 302, blankY - 2)
      expect(await selectedLines(win)).toEqual([])
      // 往上拖到 API2 的库文件名行：只亮从这里到下方空白之间的可见行
      const lib2 = await win.locator('.eyc-table-editor td').filter({ hasText: /^user32\.dll$/ }).nth(1).boundingBox()
      await win.mouse.move(lib2.x + 20, lib2.y + lib2.height / 2, { steps: 12 })
      await win.mouse.up()
      expect(await selectedLines(win)).toEqual([6, 7, 8])
      expect(await highlightedRowsOfLine(win, 6)).toBe(2)
      expect(await highlightedRowsOfLine(win, 2)).toBe(0)
      await win.keyboard.press('Escape')
    }

    // 点单元格文字中间：光标落在点击处（「user32|.dll」），而不是末尾
    const caretX = await win.evaluate(() => {
      const td = [...document.querySelectorAll('.eyc-table-editor td')].find(el => el.textContent === 'user32.dll')
      const textNode = [...td.querySelectorAll('*'), td].flatMap(el => [...el.childNodes]).find(n => n.nodeType === 3 && n.textContent.includes('user32'))
      const range = document.createRange()
      const start = textNode.textContent.indexOf('user32')
      range.setStart(textNode, start + 6)
      range.setEnd(textNode, start + 6)
      const r = range.getBoundingClientRect()
      return { x: r.left, y: r.top + r.height / 2 }
    })
    await win.mouse.click(caretX.x + 1, caretX.y)
    const caretInput = win.locator('.eyc-table-editor td input').first()
    await expect(caretInput).toHaveValue('user32.dll')
    await expect.poll(() => caretInput.evaluate(el => el.selectionStart)).toBe(6)
    await win.keyboard.press('Escape')
    // 中文：点在「备注|1」之间
    const cjkX = await win.evaluate(() => {
      const td = [...document.querySelectorAll('.eyc-table-editor td')].find(el => el.textContent === '备注1')
      const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node && !node.textContent.includes('备注')) node = walker.nextNode()
      const range = document.createRange()
      const at = node.textContent.indexOf('备注') + 2
      range.setStart(node, at)
      range.setEnd(node, at)
      const r = range.getBoundingClientRect()
      return { x: r.left, y: r.top + r.height / 2 }
    })
    await win.mouse.click(cjkX.x + 1, cjkX.y)
    const cjkInput = win.locator('.eyc-table-editor td input').first()
    await expect(cjkInput).toHaveValue('备注1')
    await expect.poll(() => cjkInput.evaluate(el => el.selectionStart)).toBe(2)
    await win.keyboard.press('Escape')

    // 单元格编辑态：在编辑框里左右拖仍是选文字，不转行多选
    await cell('API1').click()
    const input = win.locator('.eyc-table-editor td input').first()
    await expect(input).toBeVisible()
    const ib = await input.boundingBox()
    await win.mouse.move(ib.x + 3, ib.y + ib.height / 2)
    await win.mouse.down()
    await win.mouse.move(ib.x + ib.width + 40, ib.y + ib.height / 2, { steps: 6 })
    expect(await selectedLines(win)).toEqual([])
    await win.mouse.up()
    expect(await win.locator('.eyc-table-editor td input').count()).toBe(1)

    // 单元格编辑态：从编辑框里按下往下拖到 API2 的命令名行，转成行多选。
    // 上一步已在编辑框里选中了文字：在选中的文字上按下拖动，浏览器默认会改成拖放文字、收不到后续移动
    const ib2 = await win.locator('.eyc-table-editor td input').first().boundingBox()
    const api2 = await cell('API2').boundingBox()
    await win.mouse.move(ib2.x + 5, ib2.y + ib2.height / 2)
    await win.mouse.down()
    await win.mouse.move(api2.x + 20, api2.y + api2.height / 2, { steps: 12 })
    await win.mouse.up()
    expect(await selectedLines(win)).toEqual([2, 3, 4, 6])
    expect(await highlightedRowsOfLine(win, 2)).toBe(3)
    expect(await highlightedRowsOfLine(win, 6)).toBe(1)
    expect(await win.locator('.eyc-table-editor td input').count()).toBe(0)
    await win.keyboard.press('Escape')

    // 点进 API2 的库文件名格、不改动按 Esc 离开：保存后引号还在（此前会被去掉、文件变成已修改）
    await win.locator('.eyc-table-editor td').filter({ hasText: /^user32\.dll$/ }).nth(1).click()
    await expect(win.locator('.eyc-table-editor td input').first()).toHaveValue('user32.dll')
    await win.keyboard.press('Escape')
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu:action', { command: 'file:save', args: [] })
    })
    await win.waitForTimeout(500)
    expect(fs.readFileSync(file, 'utf-8')).toContain('.DLL命令 API2, 整数型, "user32.dll", "Func2", , 备注2')

    // 点行号「3」（API1 的库文件名那一行）：只选这一可见行，不是整条声明
    await win.locator('.eyc-table-editor .eyc-gutter-cell').filter({ has: win.locator('.eyc-gutter-linenum', { hasText: /^3$/ }) }).first().click()
    expect(await selectedLines(win)).toEqual([2])
    expect(await highlightedRowsOfLine(win, 2)).toBe(1)
    await expect(win.locator('.eyc-table-editor tr.eyc-data-row.eyc-line-selected').first()).toContainText('user32.dll')

    // 选中 API1 的「DLL库文件名：」标签行和库文件名格后 Delete：只清空库文件名，命令和参数都还在
    await win.locator('.eyc-table-editor tr.eyc-hdr-row').filter({ hasText: 'DLL库文件名' }).first().locator('td').first().click()
    expect(await highlightedRowsOfLine(win, 2)).toBe(1)
    await win.keyboard.press('Delete')
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu:action', { command: 'file:save', args: [] })
    })
    await expect.poll(() => fs.readFileSync(file, 'utf-8')).toContain('.DLL命令 API1, 整数型, "", "Func1", , 备注1')
    const afterClear = fs.readFileSync(file, 'utf-8')
    expect((afterClear.match(/\.参数/g) || []).length).toBe(4)
    expect(afterClear).toContain('.DLL命令 API2, 整数型, "user32.dll", "Func2", , 备注2')

    // 从 API2 的库文件名拖到对应命令名（同一条声明的两行）后 Delete：清空这两格
    const lib2b = await win.locator('.eyc-table-editor td').filter({ hasText: /^user32\.dll$/ }).first().boundingBox()
    const cmd2 = await cell('Func2').boundingBox()
    await win.mouse.move(lib2b.x + 20, lib2b.y + lib2b.height / 2)
    await win.mouse.down()
    await win.mouse.move(cmd2.x + 20, cmd2.y + cmd2.height / 2, { steps: 8 })
    await win.mouse.up()
    expect(await highlightedRowsOfLine(win, 6)).toBe(2)
    await win.keyboard.press('Delete')
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu:action', { command: 'file:save', args: [] })
    })
    await expect.poll(() => fs.readFileSync(file, 'utf-8')).toContain('.DLL命令 API2, 整数型, "", "", , 备注2')
  } finally {
    await closeAppDiscardingChanges(app)
  }
})

test('程序集编辑器：代码行与局部变量表多选', async () => {
  test.setTimeout(120000)
  const { dir, file } = writeProject('EYC', '主程序.eyc', [
    '.版本 2', '.程序集 程序集1', '', '.子程序 _启动子程序, 整数型', '.局部变量 甲, 整数型', '.局部变量 乙, 整数型', '',
    '甲 ＝ 1', '乙 ＝ 2', '甲 ＝ 甲 ＋ 乙', '返回 (0)', '',
  ].join('\n'))
  const { app } = await launchIsolatedApp()
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await openInIde(app, win, dir, file)
    const varCell = (t) => win.locator('.eyc-table-editor td').filter({ hasText: new RegExp(`^${t}$`) }).first()
    await expect(varCell('甲')).toBeVisible()
    const code = (i) => win.locator(`.eyc-table-editor [data-line-index="${i}"]`).first()

    // 代码行拖选
    const a = await code(7).boundingBox()
    const b = await code(9).boundingBox()
    await win.mouse.move(a.x + 60, a.y + a.height / 2)
    await win.mouse.down()
    await win.mouse.move(b.x + 60, b.y + b.height / 2, { steps: 10 })
    await win.mouse.up()
    expect(await selectedLines(win)).toEqual([7, 8, 9])

    // 代码行编辑态：从编辑框里按下往下拖，转成行多选
    await code(7).click()
    const codeInput = await win.locator('.eyc-table-editor input.eyc-inline-input').first().boundingBox()
    const line9 = await code(9).boundingBox()
    await win.mouse.move(codeInput.x + 5, codeInput.y + codeInput.height / 2)
    await win.mouse.down()
    await win.mouse.move(line9.x + 60, line9.y + line9.height / 2, { steps: 10 })
    await win.mouse.up()
    expect(await selectedLines(win)).toEqual([7, 8, 9])

    // 单击代码行进入编辑、选区清空；再 Shift+单击扩选
    await code(10).click()
    expect(await selectedLines(win)).toEqual([])
    await code(7).click({ modifiers: ['Shift'] })
    expect(await selectedLines(win)).toEqual([7, 8, 9, 10])

    // 局部变量表头 → 全部局部变量
    await win.locator('.eyc-table-editor tr.eyc-hdr-row').filter({ hasText: '变量名' }).first().locator('td').first().click()
    expect(await selectedLines(win)).toEqual([4, 5])

    // 拖局部变量单元格多选；单击单元格仍进入编辑
    const c1 = await varCell('甲').boundingBox()
    const c2 = await varCell('乙').boundingBox()
    await win.mouse.move(c1.x + 10, c1.y + c1.height / 2)
    await win.mouse.down()
    await win.mouse.move(c2.x + 10, c2.y + c2.height / 2, { steps: 8 })
    await win.mouse.up()
    expect(await selectedLines(win)).toEqual([4, 5])
    await varCell('乙').click()
    expect(await win.locator('.eyc-table-editor td input').count()).toBe(1)
  } finally {
    await closeAppDiscardingChanges(app)
  }
})
