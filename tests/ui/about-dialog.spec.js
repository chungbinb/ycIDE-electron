/**
 * 「关于」窗口端到端验证（真启动 IDE）。
 *
 * 覆盖：帮助菜单→关于打开窗口、版本信息真实渲染、点组件行调用 openExternal 带正确官网 URL、
 * 点开源地址跳 GitHub、Esc / 点遮罩关闭。
 *
 * openExternal 在渲染层被 mock（避免真弹系统浏览器），只验证「点击→带正确 url 调用」这段链路；
 * 主进程的 http/https 白名单由 tests/unit/urlSafety.spec.ts 覆盖。
 */
const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');

const appRoot = path.resolve(__dirname, '..', '..');

async function launch() {
  return electron.launch({ args: [appRoot], cwd: appRoot, env: { ...process.env, CI: '1' } });
}

// 在主进程拦截 shell.openExternal：记录 url 而不真正弹系统浏览器。
// 走主进程而非渲染层——window.api 是 contextBridge 暴露的冻结对象，渲染层改不了它的方法；
// 且这样验证的是「渲染→preload→IPC→主进程 handler→shell」完整链路（含 http/https 白名单）。
async function installExternalSpy(app) {
  await app.evaluate(({ shell }) => {
    globalThis.__openedUrls = [];
    shell.openExternal = (url) => { globalThis.__openedUrls.push(url); return Promise.resolve(); };
  });
}

async function openAbout(win) {
  await win.getByRole('menuitem', { name: '帮助(H)', exact: true }).click();
  await win.getByRole('menuitem', { name: /关于/ }).click();
  await expect(win.locator('.about-dialog')).toBeVisible();
}

test.describe('关于窗口', () => {
  test('帮助→关于打开窗口，展示 ycIDE 版本与真实运行时版本', async () => {
    const app = await launch();
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await expect(win.locator('.titlebar')).toBeVisible();

      await openAbout(win);

      // 品牌区：名称 + 版本
      await expect(win.locator('.about-name')).toContainText('ycIDE');
      await expect(win.locator('.about-version')).toContainText('v0.0.5-beta.25');

      // 运行时四项都在，且 Electron / Chromium / Node 版本是真实版本号（形如 43.x.y）
      const grids = win.locator('.about-comp-grid').first();
      await expect(grids).toContainText('Electron');
      await expect(grids).toContainText('Chromium');
      await expect(grids).toContainText('Node.js');
      await expect(grids).toContainText('V8');
      // Electron 行版本非占位（用 aria name 前缀锚定，避免撞上 V8 行的「…-electron.0」）
      const electronRow = win.getByRole('button', { name: /^Electron\b/ });
      await expect(electronRow.locator('.about-comp-ver')).toHaveText(/\d+\.\d+/);

      // 框架库分组齐全
      const dialog = win.locator('.about-dialog');
      for (const name of ['React', 'Monaco Editor', 'xterm.js', 'node-pty', 'Vite', 'TypeScript']) {
        await expect(dialog).toContainText(name);
      }
    } finally {
      await app.close();
    }
  });

  test('点组件行用系统浏览器打开对应官网', async () => {
    const app = await launch();
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await expect(win.locator('.titlebar')).toBeVisible();
      await openAbout(win);
      await installExternalSpy(app);

      // 点 Electron 行 → electronjs.org（aria name 前缀锚定，排除 V8 行）
      await win.getByRole('button', { name: /^Electron\b/ }).click();
      // 点 Zig 行 → ziglang.org
      await win.getByRole('button', { name: /^Zig\b/ }).click();
      // 点开源地址 GDI 版 → github.com/chungbinb/ycIDE
      await win.locator('.about-link', { hasText: 'GDI 版' }).click();

      // IPC 异步，轮询到三个 url 都到位
      await expect.poll(async () => app.evaluate(() => globalThis.__openedUrls || []), { timeout: 10000 })
        .toEqual(expect.arrayContaining([
          'https://www.electronjs.org',
          'https://ziglang.org',
          'https://github.com/chungbinb/ycIDE',
        ]));
    } finally {
      await app.close();
    }
  });

  test('Esc 关闭 / 点遮罩关闭', async () => {
    const app = await launch();
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await expect(win.locator('.titlebar')).toBeVisible();

      // Esc 关闭
      await openAbout(win);
      await win.locator('.about-dialog').press('Escape');
      await expect(win.locator('.about-dialog')).toHaveCount(0);

      // 点遮罩关闭（点对话框本体不关）
      await openAbout(win);
      await win.locator('.about-dialog').click();
      await expect(win.locator('.about-dialog')).toBeVisible();
      await win.locator('.about-overlay').click({ position: { x: 5, y: 5 } });
      await expect(win.locator('.about-dialog')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});
