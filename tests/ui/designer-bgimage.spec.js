/**
 * 设计器窗口底图渲染回归。
 *
 * 背景：大图（数 MB）底图曾导致设计器画布不显示底图、且在 dev 模式（StrictMode）下疯狂重渲染卡死。
 * 根因是把 MB 级 data URL 直接塞进 inline style 的 CSS 变量，每次重渲染反复序列化解析巨型 style，
 * 背景图迟迟画不出来。修复：底图 data URL 一次性转 Blob URL（短字符串），inline style 永远轻量。
 *
 * 本测试造一个 ~3MB 的 JPEG 底图，经属性面板选入，断言：
 *   ①画布确实挂上底图（vd-form-canvas-bgimage）；
 *   ②CSS 变量 --vd-form-bg-image 用的是 blob:URL 而非 data:URL（即修复生效，未回退）。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { test, expect, _electron: electron } = require('@playwright/test');

const appRoot = path.resolve(__dirname, '..', '..');
let projDir = '';
let bigJpg = '';

test.beforeAll(async () => {
  const sharp = require('sharp');
  projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycide-bgimg-'));
  const raw = Buffer.alloc(2000 * 2000 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) & 0xff; // 高频噪点保证体积大（~3MB）
  const jpg = await sharp(raw, { raw: { width: 2000, height: 2000, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  bigJpg = path.join(projDir, 'big.jpg');
  fs.writeFileSync(bigJpg, jpg);
  fs.writeFileSync(path.join(projDir, 'windows窗口程序.epp'), 'ProjectName=bgtest\nOutputType=WindowsApp\nPlatform=x64\nFile=EFW|_启动窗口.efw|0\nFile=EYC|_启动窗口.eyc|0\n', 'utf-8');
  fs.writeFileSync(path.join(projDir, '_启动窗口.efw'), JSON.stringify({ name: '_启动窗口', formWidth: 592, formHeight: 384, formTitle: 'bg', properties: {}, controls: [] }), 'utf-8');
  fs.writeFileSync(path.join(projDir, '_启动窗口.eyc'), ['.版本 2', '', '.子程序 __启动窗口_创建完毕', ''].join('\n'), 'utf-8');
});

test.afterAll(() => { try { fs.rmSync(projDir, { recursive: true, force: true }); } catch { /* 占用中 */ } });

test('大图底图经属性面板选入后：画布显示底图，且用 Blob URL 而非塞 data URL', async () => {
  const app = await electron.launch({ args: [appRoot], cwd: appRoot, env: { ...process.env, CI: '1' } });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.locator('.titlebar').waitFor();

    await app.evaluate(async ({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, projDir);

    // 打开项目 → 等窗口设计器画布出现
    await win.getByRole('menuitem', { name: '文件(F)', exact: true }).click();
    await win.getByRole('menuitem', { name: /打开项目/ }).first().click();
    await win.locator('.vd-form-canvas').first().waitFor({ timeout: 12000 });

    // 属性面板「底图」行的文件选择 input（EditableImageCell）
    const fileInput = win.locator('input.prop-image-input').first();
    await expect(fileInput).toHaveCount(1);
    await fileInput.setInputFiles(bigJpg);

    // 画布挂上底图
    await expect(win.locator('.vd-form-canvas-bgimage')).toHaveCount(1, { timeout: 8000 });

    // CSS 变量应是 blob:URL（修复生效）——不是 MB 级 data:URL
    const bgVar = await win.evaluate(() => {
      const el = document.querySelector('.vd-form-canvas');
      return el ? getComputedStyle(el).getPropertyValue('--vd-form-bg-image').trim() : '';
    });
    expect(bgVar).toMatch(/^url\(["']?blob:/);
    expect(bgVar).not.toContain('data:image');
  } finally {
    await app.close();
  }
});
