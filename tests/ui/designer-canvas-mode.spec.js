/**
 * 可视化设计器「画布模式」设置的端到端验证（真启动 IDE）。
 *
 * 覆盖：系统设置 →「可视化设计器 → 画布模式」两种取值的行为差异与持久化。
 *   center（默认）：窗体居中于画布可视区，画布左缘距可视区左缘很远；
 *   topleft（易语言风格）：窗体钉在画布左上角（留白 16px），视图滚动归零；
 *   设置保存后重新打开窗口，取值保持 topleft（走真实保存链路）。
 *
 * 项目搭建方式与 designer-bgimage.spec.js 相同：临时目录造 .epp+.efw，mock 打开项目对话框。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { test, expect, _electron: electron } = require('@playwright/test');

const appRoot = path.resolve(__dirname, '..', '..');
const TOPLEFT_MARGIN = 16;

let projDir = '';
let eppPath = '';

test.beforeAll(async () => {
  projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycide-canvas-mode-'));
  eppPath = path.join(projDir, 'windows窗口程序.epp');
  fs.writeFileSync(eppPath, 'ProjectName=canvastest\nOutputType=WindowsApp\nPlatform=x64\nFile=EFW|_启动窗口.efw|0\nFile=EYC|_启动窗口.eyc|0\n', 'utf-8');
  fs.writeFileSync(path.join(projDir, '_启动窗口.efw'), JSON.stringify({ name: '_启动窗口', formWidth: 592, formHeight: 384, formTitle: 'canvas', properties: {}, controls: [] }), 'utf-8');
  fs.writeFileSync(path.join(projDir, '_启动窗口.eyc'), ['.版本 2', '', '.子程序 __启动窗口_创建完毕', ''].join('\n'), 'utf-8');
});

test.afterAll(async () => {
  try { await fs.promises.rm(projDir, { recursive: true, force: true }); } catch { /* 占用中 */ }
});

/** 画布（窗体）左缘相对滚动视口左缘的内容偏移：offset = canvasRect.left - hostRect.left + host.scrollLeft */
async function measureCanvasOffsetLeft(win) {
  return win.evaluate(() => {
    const host = document.querySelector('.vd-canvas-scroll');
    const canvas = document.querySelector('.vd-form-canvas');
    if (!host || !canvas) return null;
    const hostRect = host.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return {
      offsetLeft: canvasRect.left - hostRect.left + host.scrollLeft,
      scrollLeft: host.scrollLeft,
      scrollTop: host.scrollTop,
    };
  });
}

/** 对齐工具条相对画布可视区的纵向位置：≈0=贴顶，≈1=贴底 */
async function measureAlignBarVPos(win) {
  return win.evaluate(() => {
    const host = document.querySelector('.vd-canvas-scroll');
    const bar = document.querySelector('.vd-align-bar');
    if (!host || !bar) return null;
    const hostRect = host.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    return (barRect.top - hostRect.top) / hostRect.height;
  });
}

async function openProject(win, app) {
  // project:openEpp 期望对话框返回 .epp 文件（非目录），且要求主窗口处于聚焦状态
  await app.evaluate(async ({ dialog, BrowserWindow }, p) => {
    BrowserWindow.getAllWindows()[0].focus();
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, eppPath);
  await win.getByRole('menuitem', { name: '文件(F)', exact: true }).click();
  await win.getByRole('menuitem', { name: /打开项目/ }).first().click();
  await win.locator('.vd-form-canvas').first().waitFor({ timeout: 12000 });
}

/** 打开 系统设置 独立窗口，返回其 Playwright 页面。
 * 必须先挂 window 事件监听再点菜单：window.open 的事件可能在点击返回前就发出，后挂监听会永远等不到。 */
async function openSettings(win, app) {
  const settingsPromise = app.waitForEvent('window', { timeout: 15000 });
  await win.getByRole('menuitem', { name: '工具(T)', exact: true }).click();
  await win.getByRole('menuitem', { name: '系统设置(S)', exact: true }).click();
  const settingsWin = await settingsPromise;
  await settingsWin.waitForLoadState('domcontentloaded');
  await expect(settingsWin.locator('.settings-dialog')).toBeVisible();
  return settingsWin;
}

function canvasModeSelect(settingsWin) {
  return settingsWin.locator('.settings-row', { hasText: '画布模式' }).locator('select');
}

test('画布模式 center：窗体居中；切到 topleft：窗体钉在左上角且设置持久化', async () => {
  const app = await electron.launch({ args: [appRoot], cwd: appRoot, env: { ...process.env, CI: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.locator('.titlebar').waitFor();
    await openProject(win, app);

    // 幂等归零：设置存的是真实 userData，先经设置界面把画布模式归为 center，
    // 避免（此前运行残留的）topleft 让“默认居中”断言失真
    {
      const s = await openSettings(win, app);
      await canvasModeSelect(s).selectOption('center');
      await s.locator('.settings-btn-primary').click();
      await expect.poll(async () => app.windows().length, { timeout: 10000 }).toBe(1);
    }

    // center：窗体居中，内容偏移远大于左上角留白；对齐工具条在画布顶部
    const centerView = await measureCanvasOffsetLeft(win);
    expect(centerView).not.toBeNull();
    expect(centerView.offsetLeft).toBeGreaterThan(100);
    expect(await measureAlignBarVPos(win)).toBeLessThan(0.3);

    // 切换到 左上角固定
    const settingsWin = await openSettings(win, app);
    const modeSelect = canvasModeSelect(settingsWin);
    await expect(modeSelect).toHaveValue('center');
    await modeSelect.selectOption('topleft');
    await settingsWin.locator('.settings-btn-primary').click();
    await expect.poll(async () => app.windows().length, { timeout: 10000 }).toBe(1);

    // topleft 生效：滚动归零，窗体左缘 ≈ 留白 16px
    await expect.poll(async () => {
      const view = await measureCanvasOffsetLeft(win);
      return view ? view.scrollLeft : -1;
    }, { timeout: 8000 }).toBe(0);
    const topleftView = await measureCanvasOffsetLeft(win);
    expect(topleftView.offsetLeft).toBeGreaterThanOrEqual(TOPLEFT_MARGIN - 4);
    expect(topleftView.offsetLeft).toBeLessThanOrEqual(TOPLEFT_MARGIN + 24);
    // 对齐工具条让位到画布底部，不再与左上角的窗体重叠
    expect(await measureAlignBarVPos(win)).toBeGreaterThan(0.5);

    // 重新打开设置：取值保持 topleft（走真实保存/加载链路）
    const settingsWin2 = await openSettings(win, app);
    await expect(canvasModeSelect(settingsWin2)).toHaveValue('topleft');
    await settingsWin2.locator('.settings-close').click();
    await expect.poll(async () => app.windows().length, { timeout: 10000 }).toBe(1);

    // 收尾：恢复 center 默认值，不污染本机真实 userData
    {
      const s = await openSettings(win, app);
      await canvasModeSelect(s).selectOption('center');
      await s.locator('.settings-btn-primary').click();
      await expect.poll(async () => app.windows().length, { timeout: 10000 }).toBe(1);
    }
  } finally {
    await app.close();
  }
});
