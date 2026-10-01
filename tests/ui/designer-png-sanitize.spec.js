/**
 * 设计器底图「显示副本清洗」回归。
 *
 * 背景：部分 PNG 带 iCCP/cHRM（或 sRGB+cHRM）冲突块，Chromium libpng 解码时向进程
 * stderr 打 `libpng warning: iCCP: cHRM chunk does not match sRGB`（终端启动 IDE 可见，纯噪音）。
 * 修复：设计器显示底图时先剥掉这两个块再建 Blob URL（存储数据不动）。
 *
 * 本测试把一张构造的脏 PNG（IHDR+iCCP+cHRM+IDAT+IEND）直接写进 .efw 底图属性，
 * 打开设计器后读画布 CSS 变量里的 blob URL，fetch 回字节断言 iCCP/cHRM 已被剥除、
 * IDAT 原样保留——即清洗确实发生在显示链路上（清理逻辑本身由 tests/unit/imageDisplay.spec.ts 覆盖）。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const zlib = require('node:zlib');
const { test, expect, _electron: electron } = require('@playwright/test');

const appRoot = path.resolve(__dirname, '..', '..');
let projDir = '';

// ===== 构造带冲突块的合法 1x1 PNG =====
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function buildDirtyPng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  const raw = Buffer.from([0x00, 0x10, 0x20, 0x30]); // filter 0 + 1px RGB
  const idat = zlib.deflateSync(raw);
  const iccp = Buffer.concat([Buffer.from('bad\0', 'ascii'), Buffer.from([0]), Buffer.from('junk-profile-bytes-junk-profile-bytes', 'ascii')]);
  const chrm = Buffer.alloc(32); // 全 0 的 xy 值（与 sRGB 必然不一致）
  const png = Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('iCCP', iccp),
    chunk('cHRM', chrm),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png;
}

test.beforeAll(async () => {
  projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycide-png-clean-'));
  fs.writeFileSync(path.join(projDir, 'windows窗口程序.epp'), 'ProjectName=pngclean\nOutputType=WindowsApp\nPlatform=x64\nFile=EFW|_启动窗口.efw|0\nFile=EYC|_启动窗口.eyc|0\n', 'utf-8');
  const dirtyDataUrl = `data:image/png;base64,${buildDirtyPng().toString('base64')}`;
  const form = { name: '_启动窗口', formWidth: 320, formHeight: 240, formTitle: 'clean', properties: { '底图': dirtyDataUrl, '底图方式': 0 }, controls: [] };
  fs.writeFileSync(path.join(projDir, '_启动窗口.efw'), JSON.stringify(form), 'utf-8');
  fs.writeFileSync(path.join(projDir, '_启动窗口.eyc'), ['.版本 2', '', '.子程序 __启动窗口_创建完毕', ''].join('\n'), 'utf-8');
});

test.afterAll(async () => {
  try { await fs.promises.rm(projDir, { recursive: true, force: true }); } catch { /* 占用中 */ }
});

test('脏 PNG 底图：显示副本已剥除 iCCP/cHRM（存储数据不动），libpng 不再有警告源', async () => {
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

    // 画布 CSS 变量应挂 blob URL（清洗后的显示副本）
    const bgVar = await win.evaluate(() => {
      const el = document.querySelector('.vd-form-canvas');
      return el ? getComputedStyle(el).getPropertyValue('--vd-form-bg-image').trim() : '';
    });
    expect(bgVar).toMatch(/^url\(["']?blob:/);

    // fetch 显示副本 → 字节里不应再有 iCCP/cHRM，IDAT 保留
    const chunkTypes = await win.evaluate(async (cssVar) => {
      const m = /^url\(["']?(blob:[^"')]+)["']?\)$/.exec(cssVar);
      if (!m) return null;
      const res = await fetch(m[1]);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const view = new DataView(bytes.buffer);
      const types = [];
      let off = 8;
      while (off + 12 <= bytes.length) {
        const len = view.getUint32(off, false);
        types.push(String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]));
        off += 12 + len;
        if (types[types.length - 1] === 'IEND') break;
      }
      return types;
    }, bgVar);
    expect(chunkTypes).not.toBeNull();
    expect(chunkTypes).toContain('IHDR');
    expect(chunkTypes).toContain('IDAT');
    expect(chunkTypes).toContain('IEND');
    expect(chunkTypes).not.toContain('iCCP');
    expect(chunkTypes).not.toContain('cHRM');
  } finally {
    await app.close();
  }
});
