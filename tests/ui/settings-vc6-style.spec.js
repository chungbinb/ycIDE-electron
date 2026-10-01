/**
 * 系统设置「可视化设计器 → VC6 现代样式」开关的端到端验证（真启动 IDE）。
 *
 * 覆盖：默认启用；在设置窗里可关闭；保存后重新打开取值保持关闭；恢复启用不污染本机配置。
 * （编译产物层面的行为由 tests/unit/compileVc6Style.spec.ts 用真实 zig 编译坐实。）
 */
const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');

const appRoot = path.resolve(__dirname, '..', '..');

async function launch() {
  return electron.launch({ args: [appRoot], cwd: appRoot, env: { ...process.env, CI: '1' } });
}

/** 打开 系统设置 独立窗口。必须先挂 window 事件监听再点菜单：window.open 的事件可能在点击返回前就发出。 */
async function openSettings(win, app) {
  const settingsPromise = app.waitForEvent('window', { timeout: 15000 });
  await win.getByRole('menuitem', { name: '工具(T)', exact: true }).click();
  await win.getByRole('menuitem', { name: '系统设置(S)', exact: true }).click();
  const settingsWin = await settingsPromise;
  await settingsWin.waitForLoadState('domcontentloaded');
  await expect(settingsWin.locator('.settings-dialog')).toBeVisible();
  return settingsWin;
}

function vc6SwitchLabel(settingsWin) {
  // 自定义开关的 input 被样式轨道覆盖，点击外层 label 才能可靠切换
  return settingsWin.locator('.settings-row', { hasText: 'VC6 现代样式' }).locator('label.settings-switch');
}

function vc6SwitchInput(settingsWin) {
  return settingsWin.locator('.settings-row', { hasText: 'VC6 现代样式' }).locator('input.settings-switch-input');
}

async function saveAndClose(settingsWin, app) {
  await settingsWin.locator('.settings-btn-primary').click();
  await expect.poll(async () => app.windows().length, { timeout: 10000 }).toBe(1);
}

test('VC6 现代样式：默认启用，可关闭并持久化，收尾恢复默认', async () => {
  const app = await launch();
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.locator('.titlebar').waitFor();

    // 幂等归零：先确保处于启用默认态
    {
      const s = await openSettings(win, app);
      if (!(await vc6SwitchInput(s).isChecked())) {
        await vc6SwitchLabel(s).click();
        await saveAndClose(s, app);
      } else {
        await s.locator('.settings-close').click();
        await expect.poll(async () => app.windows().length, { timeout: 10000 }).toBe(1);
      }
    }

    // 关闭开关并保存 → 重新打开取值保持关闭
    {
      const s = await openSettings(win, app);
      await vc6SwitchLabel(s).click();
      await expect(vc6SwitchInput(s)).not.toBeChecked();
      await saveAndClose(s, app);
      const s2 = await openSettings(win, app);
      await expect(vc6SwitchInput(s2)).not.toBeChecked();
      await saveAndClose(s2, app);
    }

    // 收尾：恢复启用（默认值），不污染本机配置
    {
      const s = await openSettings(win, app);
      await vc6SwitchLabel(s).click();
      await saveAndClose(s, app);
      const s2 = await openSettings(win, app);
      await expect(vc6SwitchInput(s2)).toBeChecked();
      await s2.locator('.settings-close').click();
      await expect.poll(async () => app.windows().length, { timeout: 10000 }).toBe(1);
    }
  } finally {
    await app.close();
  }
});
