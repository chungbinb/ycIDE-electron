/**
 * 输出面板「时间轴/类型/用时」列的端到端验证（真启动 IDE）。
 *
 * 从主进程按真实通道（compiler:output）广播三条消息，模拟一次 编译→运行 的时间线：
 * 编译消息 → 程序已启动（用时锚点重锚）→ 运行期调试输出。断言每行最左列的
 * 时间/类型/用时都渲染且格式正确，且运行期消息的用时小于编译期消息（重锚生效）。
 */
const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');

const appRoot = path.resolve(__dirname, '..', '..');

async function launch() {
  return electron.launch({ args: [appRoot], cwd: appRoot, env: { ...process.env, CI: '1' } });
}

// 从主进程按产品自己的 IPC 通道广播一条编译器输出（渲染层 window.api.on 的订阅原样收到）
async function sendOutput(app, msg) {
  await app.evaluate(({ BrowserWindow }, m) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.send('compiler:output', m);
  }, msg);
}

test.describe('输出面板时间轴', () => {
  test('每行最左列显示时间轴/类型/用时，程序启动后用时重新锚定', async () => {
    const app = await launch();
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await expect(win.locator('.titlebar')).toBeVisible();

      // 输出面板默认随启动显示；若被关闭过（持久化/旧会话状态）再点状态栏按钮打开
      if (await win.locator('.output-panel').count() === 0) {
        await win.locator('.statusbar-item').first().click();
      }
      await expect(win.locator('.output-panel')).toBeVisible();

      // ① 编译期消息
      await sendOutput(app, { type: 'info', text: '正在分析项目元数据...' });
      // 与②拉开 800ms：③的用时与①无关地变大，重锚断言才有判定力
      await win.waitForTimeout(800);
      // ② 程序已启动 → 时间轴锚点重锚为程序启动时刻
      await sendOutput(app, { type: 'success', text: '程序已启动 (PID: 1234)' });
      // ③ 运行期调试输出：稍等再发
      await win.waitForTimeout(300);
      await sendOutput(app, { type: 'info', text: '调试输出：123' });

      const lines = win.locator('.output-line');
      await expect(lines).toHaveCount(3);

      // 时间轴列：HH:MM:SS.mmm（本地时钟，固定 12 字符）
      await expect(lines.nth(0).locator('.output-line-time')).toHaveText(/\d{2}:\d{2}:\d{2}\.\d{3}/);
      // 类型列：按消息类型显示中文标签
      await expect(lines.nth(0).locator('.output-line-tag')).toHaveText('信息');
      await expect(lines.nth(1).locator('.output-line-tag')).toHaveText('成功');
      await expect(lines.nth(2).locator('.output-line-tag')).toHaveText('信息');
      // 用时列：+前缀 + ms/s
      await expect(lines.nth(0).locator('.output-line-elapsed')).toHaveText(/^\+\d+(\.\d{3})?(ms|s)$/);
      await expect(lines.nth(2).locator('.output-line-elapsed')).toHaveText(/^\+\d+(\.\d{3})?(ms|s)$/);

      // 重锚生效的判定（与①的数值无关）：①②相隔 800ms、②③相隔 300ms，若未重锚，
      // ③的用时 = ①用时 + ≥1100ms ≥ 1100ms；断言 ③ < 1s 即证明已按「程序已启动」重锚。
      const parseElapsed = (s) => {
        const m = /^\+([\d.]+)(ms|s)$/.exec(s.trim());
        return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
      };
      const runtimeElapsed = parseElapsed(await lines.nth(2).locator('.output-line-elapsed').textContent());
      expect(runtimeElapsed).toBeLessThan(1000);

      // 字体/字号跟随系统设置：元信息列取 --font-family（界面字体）+ --font-size-small（界面字号×0.88），
      // 模拟设置注入自定义值后，元信息列的字体族与字号必须同步（不得写死）
      const readMetaFont = () => win.evaluate(() => {
        const el = document.querySelector('.output-line-meta');
        if (!el) return { family: '', size: '' };
        const cs = getComputedStyle(el);
        return { family: cs.fontFamily, size: cs.fontSize };
      });
      await win.evaluate(() => document.documentElement.style.setProperty('--font-size-small', '16px'));
      await win.evaluate(() => document.documentElement.style.setProperty('--font-family', '"DengXian", serif'));
      const font = await readMetaFont();
      expect(font.size).toBe('16px');
      expect(font.family).toContain('DengXian');
    } finally {
      await app.close();
    }
  });
});
