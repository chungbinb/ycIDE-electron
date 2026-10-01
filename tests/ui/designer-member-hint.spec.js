/**
 * 成员属性点击提示的端到端验证（真启动 IDE）。
 *
 * 场景：工程 .eyc 里写 `_启动窗口.底图 ＝ #图1`，打开后点击赋值左值 `_启动窗口.底图`
 * → 提示面板（输出面板「提示」标签）按易语言样式显示成员属性详情：
 *   成员属性“底图”所在数据类型为“窗口”，英文名称为“backImage”，类型为“图片”。
 *   本属性指定显示在窗口背景上的图片。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const zlib = require('node:zlib');
const { test, expect, _electron: electron } = require('@playwright/test');

const appRoot = path.resolve(__dirname, '..', '..');
let projDir = '';

function buildTinyPng() {
  const crc32 = (buf) => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = zlib.deflateSync(Buffer.from([0x00, 0x10, 0x20, 0x30]));
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

test.beforeAll(async () => {
  projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycide-member-hint-'));
  fs.writeFileSync(path.join(projDir, 'windows窗口程序.epp'), 'ProjectName=memberhint\nOutputType=WindowsApp\nPlatform=x64\nFile=EFW|_启动窗口.efw|0\nFile=EYC|_启动窗口.eyc|0\n', 'utf-8');
  fs.writeFileSync(path.join(projDir, '_启动窗口.efw'), JSON.stringify({ name: '_启动窗口', formWidth: 320, formHeight: 240, formTitle: 'hint', properties: {}, controls: [] }), 'utf-8');
  fs.writeFileSync(path.join(projDir, '_启动窗口.eyc'), ['.版本 2', '', '.子程序 __启动窗口_创建完毕', '    _启动窗口.底图 ＝ #图1', '    _启动窗口.底图方式 ＝ 3', ''].join('\n'), 'utf-8');
});

test.afterAll(async () => {
  try { await fs.promises.rm(projDir, { recursive: true, force: true }); } catch { /* 占用中 */ }
});

test('点击赋值左值成员属性 → 提示面板显示成员属性详情', async () => {
  const app = await electron.launch({ args: [appRoot], cwd: appRoot, env: { ...process.env, CI: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.locator('.titlebar').waitFor();

    await app.evaluate(async ({ dialog, BrowserWindow }, p) => {
      BrowserWindow.getAllWindows()[0].focus();
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, path.join(projDir, 'windows窗口程序.epp'));
    await win.getByRole('menuitem', { name: '文件(F)', exact: true }).click();
    await win.getByRole('menuitem', { name: /打开项目/ }).first().click();
    await win.locator('.vd-form-canvas').first().waitFor({ timeout: 12000 });

    // 打开 _启动窗口.eyc：切到侧栏「项目」页 → 双击「程序集」下的代码文件节点。
    // .eyc 节点带事件子节点渲染为 tree-branch（.efw 是 tree-leaf），branch 含 "_启动窗口" 文本的只有它；
    // tree-item 的 textContent 被 SVG 内嵌样式污染，精确文本匹配不可用。单击分支只展开，双击才打开文件。
    await win.locator('.sidebar-tab', { hasText: '项目' }).first().click();
    const codeItem = win.locator('.tree-item.tree-branch', { hasText: '_启动窗口' }).first();
    await expect(codeItem).toBeVisible({ timeout: 8000 });
    await codeItem.dblclick();

    // 表格编辑器出现，赋值左值 token（变量色 Variablescolor）可见
    const assignToken = win.locator('.eyc-code-line .Variablescolor', { hasText: '底图' }).first();
    await expect(assignToken).toBeVisible({ timeout: 8000 });
    await assignToken.click();

    // 提示面板自动切到「提示」并显示成员属性详情（描述取自窗口单元协议）
    const detail = win.locator('.cmd-detail');
    await expect(detail).toBeVisible({ timeout: 8000 });
    await expect(detail).toContainText('成员属性“底图”');
    await expect(detail).toContainText('所在数据类型为“窗口”');
    await expect(detail).toContainText('类型为“图片”');

    // 再点「底图方式」（选择整数型）→ 详情追加 pickOptions 选项列表。
    // 第一次点击已让该行进入编辑态（input 覆盖行内容、拦截第二次点击）。点另一行让编辑态转移退出
    await win.locator('.eyc-code-line').nth(1).click();
    const modeToken = win.locator('.eyc-code-line .Variablescolor', { hasText: '底图方式' }).first();
    await expect(modeToken).toBeVisible({ timeout: 8000 });
    await modeToken.click();
    await expect(detail).toContainText('成员属性“底图方式”', { timeout: 8000 });
    await expect(detail).toContainText('0.图片居左上');
    await expect(detail).toContainText('3.缩放图片');
  } finally {
    await app.close();
  }
});
