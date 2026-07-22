/**
 * 编译环境预热的端到端验证（真启动 IDE）。
 *
 * 盯两件事：
 *   1. 预热跑完后按钮必须恢复可用——这条逻辑写错的后果是「运行按钮永久灰着」；
 *   2. 未就绪期间按钮确实被禁用，且 tooltip 讲清了原因（不能只是灰着不说话）。
 *
 * 第 2 条在本机跑不出真实冷启动（缓存早就热了），所以用主进程广播伪造 warming 状态来验证渲染侧门禁。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test, expect, _electron: electron } = require('@playwright/test');

const appRoot = path.resolve(__dirname, '..', '..');

async function launch() {
  return electron.launch({
    args: [appRoot],
    cwd: appRoot,
    env: { ...process.env, CI: '1' },
  });
}

test.describe('编译环境预热', () => {
  test('预热完成后运行按钮可用，状态栏不残留进度条', async () => {
    const app = await launch();
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await expect(win.locator('.titlebar')).toBeVisible();

      // 主进程启动 1.2s 后才触发预热，给足时间走到终态
      // 主进程是打包后的 bundle，evaluate 里 require 不可用；走产品自己的 IPC 查询
      await expect
        .poll(async () => win.evaluate(async () => {
          const s = await window.api?.compilerEnv?.getWarmupState?.();
          return s?.phase;
        }), { timeout: 120000, intervals: [500] })
        .toBe('ready');

      // 终态下渲染侧不该再显示预热进度
      await expect(win.locator('.statusbar-warmup')).toHaveCount(0);

      // 运行按钮必须可用（本机已有项目上下文时 hasProject 可能为假，
      // 这里只断言「不是被预热挡住的」——tooltip 里不该出现预热原因）
      const runTitle = await win.locator('.toolbar-btn-run').getAttribute('title');
      expect(runTitle).not.toContain('编译环境');
      expect(runTitle).not.toContain('准备');
    } finally {
      await app.close();
    }
  });

  test('warming 期间运行按钮禁用，tooltip 说明原因，状态栏显示进度', async () => {
    const app = await launch();
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await expect(win.locator('.titlebar')).toBeVisible();

      // 从主进程按真实通道广播 warming——走的就是产品代码那条 IPC
      await app.evaluate(async ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        w.webContents.send('compiler:warmupState', {
          phase: 'warming',
          message: '首次使用需准备编译环境（约 1 分钟，仅此一次）…',
          elapsedMs: 7000,
        });
      });

      const warmup = win.locator('.statusbar-warmup');
      await expect(warmup).toHaveCount(1);
      await expect(warmup).toContainText('首次使用需准备编译环境');
      await expect(warmup).toContainText('7s');

      const runBtn = win.locator('.toolbar-btn-run');
      await expect(runBtn).toBeDisabled();
      expect(await runBtn.getAttribute('title')).toContain('首次使用需准备编译环境');

      const cursorBtn = win.locator('.toolbar-btn[aria-label="运行到光标处"]');
      await expect(cursorBtn).toBeDisabled();

      // 其它功能照常：新建/打开/保存不受预热影响
      await expect(win.locator('.toolbar-btn[aria-label="新建文件"]')).toBeEnabled();
      await expect(win.locator('.toolbar-btn[aria-label="打开文件"]')).toBeEnabled();

      // 回到 ready 后按钮解禁、进度条消失
      await app.evaluate(async ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        w.webContents.send('compiler:warmupState', { phase: 'ready', message: '编译环境就绪' });
      });
      await expect(win.locator('.statusbar-warmup')).toHaveCount(0);
      expect(await runBtn.getAttribute('title')).not.toContain('首次使用');
    } finally {
      await app.close();
    }
  });

  test('未检测到编译器时自动弹出设置窗并聚焦编译器路径', async () => {
    const app = await launch();
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await expect(win.locator('.titlebar')).toBeVisible();

      await app.evaluate(async ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        w.webContents.send('compiler:warmupState', {
          phase: 'no-compiler',
          message: '未配置编译器，请在设置中指定 Zig 编译器路径',
        });
      });

      // 系统设置是独立的 window.open 弹窗，不在主窗口 DOM 里
      const settingsWin = await app.waitForEvent('window', { timeout: 15000 });
      await settingsWin.waitForLoadState('domcontentloaded');

      const hint = settingsWin.locator('.settings-hint-warning');
      await expect(hint).toBeVisible({ timeout: 10000 });
      await expect(hint).toContainText('未检测到编译器');

      // 引导语紧邻的编译器路径输入框应已聚焦，用户直接就能粘路径
      await expect(settingsWin.locator('input.settings-input:focus'))
        .toHaveAttribute('title', /Zig 编译器路径/);

      // 方案甲：允许关闭，不是强制模态
      await settingsWin.keyboard.press('Escape');
      await expect.poll(async () => app.windows().length, { timeout: 10000 }).toBe(1);
    } finally {
      await app.close();
    }
  });
});
