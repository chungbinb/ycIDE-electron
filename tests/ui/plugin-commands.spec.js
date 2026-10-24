/**
 * 插件化阶段 0 端到端验证（真启动 IDE）：菜单与快捷键改由内置插件清单生成后，
 * 标题栏菜单、菜单命令、全局快捷键都能正常工作。
 *
 * 只做不改动用户配置的操作（不切换主题、不打开项目）。
 */
const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');

const appRoot = path.resolve(__dirname, '..', '..');

test.describe('插件贡献的菜单与快捷键', () => {
  test('菜单由插件清单生成：顶层菜单齐全、未打开项目文件时保存类命令置灰、菜单命令与快捷键可执行', async () => {
    const app = await electron.launch({ args: [appRoot], cwd: appRoot, env: { ...process.env, CI: '1' } });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await expect(win.locator('.titlebar')).toBeVisible();

      // 顶层菜单：来自 workbench / project / build / debug 四个内置插件，按 order 排列
      const menubar = win.locator('nav.titlebar-menu > .titlebar-menu-item > button');
      await expect(menubar).toHaveText(['文件(F)', '编辑(E)', '查看(V)', '插入(I)', '编译(B)', '调试(D)', '工具(T)', '帮助(H)']);

      // 文件菜单：分组、快捷键显示文字、enablement（未打开项目文件 → 保存置灰）
      await win.getByRole('menuitem', { name: '文件(F)', exact: true }).click();
      const dropdown = win.locator('.titlebar-dropdown');
      await expect(dropdown.getByRole('menuitem', { name: /新建文件\(F\)/ })).toContainText('Ctrl+Alt+N');
      await expect(dropdown.getByRole('menuitem', { name: /^保存\(S\)/ })).toBeDisabled();
      await expect(dropdown.getByRole('menuitem', { name: /最近打开/ })).toBeVisible();
      await expect(dropdown.locator(':scope > .titlebar-dropdown-divider')).toHaveCount(4);
      await win.getByRole('menuitem', { name: '文件(F)', exact: true }).click();
      await expect(win.locator('.titlebar-dropdown')).toHaveCount(0);

      // 菜单命令：工具 → 系统设置（在独立弹出窗口中打开）
      await win.getByRole('menuitem', { name: '工具(T)', exact: true }).click();
      const settingsWindowPromise = app.waitForEvent('window');
      await win.getByRole('menuitem', { name: /系统设置/ }).click();
      const settingsWindow = await settingsWindowPromise;
      await expect(settingsWindow.locator('.settings-dialog')).toBeVisible();
      await settingsWindow.locator('.settings-close').click();

      // 菜单命令：帮助 → 关于
      await win.getByRole('menuitem', { name: '帮助(H)', exact: true }).click();
      await win.getByRole('menuitem', { name: /关于/ }).click();
      await expect(win.locator('.about-dialog')).toBeVisible();
      await win.keyboard.press('Escape');
      await expect(win.locator('.about-dialog')).toHaveCount(0);

      // 全局快捷键：Ctrl+Alt+N → file:newFile，新建未命名文本标签
      await win.locator('.titlebar-title').click();
      await win.keyboard.press('Control+Alt+N');
      await expect(win.locator('.editor-tab', { hasText: '未命名' })).toHaveCount(1);
    } finally {
      await app.close();
    }
  });
});
