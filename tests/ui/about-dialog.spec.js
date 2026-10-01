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
// 版本号从 package.json 动态读取，避免每次发版都要改断言
const APP_VERSION = require(path.join(appRoot, 'package.json')).version;

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
      await expect(win.locator('.about-version')).toContainText(`v${APP_VERSION}`);

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

      // 点组件行用系统浏览器打开对应官网
      // 点 Electron 行 → electronjs.org（aria name 前缀锚定，排除 V8 行）
      await win.getByRole('button', { name: /^Electron\b/ }).click();
      // 点 Zig 行 → ziglang.org
      await win.getByRole('button', { name: /^Zig\b/ }).click();
      // 点开源地址 GDI 版 → github.com/chungbinb/ycIDE
      await win.locator('.about-link', { hasText: 'GDI 版' }).click();
      // 点引用的开源项目行 → 各自上游仓库
      await win.locator('.about-link', { hasText: 'e-packager' }).click();
      await win.locator('.about-link', { hasText: 'EProjectFile' }).click();

      // IPC 异步，轮询到五个 url 都到位
      await expect.poll(async () => app.evaluate(() => globalThis.__openedUrls || []), { timeout: 10000 })
        .toEqual(expect.arrayContaining([
          'https://www.electronjs.org',
          'https://ziglang.org',
          'https://github.com/chungbinb/ycIDE',
          'https://github.com/aiqinxuancai/e-packager',
          'https://github.com/OpenEpl/EProjectFile',
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

  test('拖标题栏可移动窗口，且不会被拖出主窗口', async () => {
    const app = await launch();
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await expect(win.locator('.titlebar')).toBeVisible();
      await openAbout(win);

      const dialog = win.locator('.about-dialog');
      const header = win.locator('.about-header');
      const before = await dialog.boundingBox();

      // 按住标题栏拖动 → 对话框跟随移动相同距离
      // 位移量按窗口剩余空间动态取值（对话框较高时垂直余量可能不足 80px，会被边缘钳制截断）
      const preDragViewport = await win.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      const dragX = 120;
      const dragY = Math.min(80, Math.floor((preDragViewport.height - before.y - before.height) / 2));
      const headerBox = await header.boundingBox();
      const startX = headerBox.x + headerBox.width / 2;
      const startY = headerBox.y + headerBox.height / 2;
      await win.mouse.move(startX, startY);
      await win.mouse.down();
      await win.mouse.move(startX + dragX, startY + dragY, { steps: 5 });
      await win.mouse.up();
      const after = await dialog.boundingBox();
      expect(after.x).toBeCloseTo(before.x + dragX, 0);
      expect(after.y).toBeCloseTo(before.y + dragY, 0);

      // 朝右下角极限拖拽 → 仍完全在窗口可视范围内
      await win.mouse.move(startX + dragX, startY + dragY);
      await win.mouse.down();
      await win.mouse.move(startX + 4000, startY + 4000, { steps: 5 });
      await win.mouse.up();
      const clamped = await dialog.boundingBox();
      // Electron 下 page.viewportSize() 返回 null，改用页面真实内容尺寸
      const viewport = await win.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      expect(clamped.x).toBeGreaterThanOrEqual(0);
      expect(clamped.y).toBeGreaterThanOrEqual(0);
      expect(clamped.x + clamped.width).toBeLessThanOrEqual(viewport.width);
      expect(clamped.y + clamped.height).toBeLessThanOrEqual(viewport.height);
    } finally {
      await app.close();
    }
  });
});
