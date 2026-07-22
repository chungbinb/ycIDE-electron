/**
 * 应用图标生成：从「图标文件/其它logo/」的两张原图生成全套图标。
 *
 *   桌面/exe/任务栏图标 ← 微信图片…115.png（深蓝圆角），去水印 + 白角转透明重建圆角
 *     → resources/icon.png / icon.ico / icon.icns（窗口图标经 resolveWindowIconPath 自动跟随 icon.ico）
 *   软件 logo（标题栏 + 关于页）← C8192…PNG（白底代码符号），去水印 + 抠白底转透明
 *     → src/renderer/src/assets/icons/YcideLogo.png
 *
 * 两张原图右下角带 AI 生成水印：白底那张盖白无损；深蓝那张盖深蓝后由圆角遮罩兜住越界残留。
 * 依赖 sharp（缩放/像素处理）+ png2icons（ico/icns 封装），均为 devDependencies。
 * 换图后重跑：node scripts/gen-app-icons.mjs
 */
import sharp from 'sharp'
import png2icons from 'png2icons'
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_DESK = join(root, '图标文件/其它logo/微信图片_20260722093550_115_18.png')
const SRC_LOGO = join(root, '图标文件/其它logo/C8192D76-50A3-4DAC-B00A-379951273327..PNG')

/** 桌面图标：盖水印 + 圆角遮罩（四角透明），返回 2048² 无损 PNG buffer */
async function buildDesktopIcon() {
  const SIZE = 2048
  const R = 150 // 与原图深蓝圆角半径吻合
  // 1) 深蓝色块盖住右下角水印（采样自水印区周边深蓝 [5,23,58]），越界部分交给圆角遮罩兜住
  const cover = await sharp({ create: { width: 460, height: 160, channels: 4, background: { r: 5, g: 23, b: 58, alpha: 1 } } }).png().toBuffer()
  const covered = await sharp(SRC_DESK)
    .composite([{ input: cover, left: SIZE - 460, top: SIZE - 160 }])
    .png().toBuffer()
  // 2) 圆角遮罩 dest-in：圆角外（原白角 + 盖色越界）全部透明，得到原生深蓝圆角
  const mask = Buffer.from(`<svg width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" rx="${R}" ry="${R}" fill="#fff"/></svg>`)
  return sharp(covered).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
}

/**
 * 抠白底转透明：把「彩色前景 over 白底」反解出前景 + alpha。
 * a = 255 - min(r,g,b)（白→0 全透明、纯色→高不透明、边缘抗锯齿→半透明，柔和不留白边）；
 * 再按 a 反预乘还原前景色，避免符号整体发灰。
 */
async function whiteToTransparent(srcPng) {
  const { data, info } = await sharp(srcPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const out = Buffer.alloc(data.length)
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const a = 255 - Math.min(r, g, b)
    if (a <= 0) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0
    } else {
      // c_fg = (c - (255 - a)) / (a/255)：从 over-白 反解前景
      const k = 255 / a
      out[i] = Math.max(0, Math.min(255, Math.round((r - (255 - a)) * k)))
      out[i + 1] = Math.max(0, Math.min(255, Math.round((g - (255 - a)) * k)))
      out[i + 2] = Math.max(0, Math.min(255, Math.round((b - (255 - a)) * k)))
      out[i + 3] = a
    }
  }
  return sharp(out, { raw: { width, height, channels } }).png().toBuffer()
}

/** 软件 logo：盖白去水印（纯白底无损）+ 抠白底透明，返回 2048² 透明 PNG buffer */
async function buildLogo() {
  const SIZE = 2048
  // 右下角盖白覆盖水印（背景纯白，盖白无副作用，符号集中在中部不受影响）
  const white = await sharp({ create: { width: 700, height: 260, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer()
  const covered = await sharp(SRC_LOGO)
    .composite([{ input: white, left: SIZE - 700, top: SIZE - 260 }])
    .png().toBuffer()
  return whiteToTransparent(covered)
}

async function main() {
  const desk = await buildDesktopIcon()
  const logo = await buildLogo()

  // 桌面图标：png（Linux/预览）、ico（Win，多尺寸）、icns（mac）
  const deskPng512 = await sharp(desk).resize(512, 512).png().toBuffer()
  writeFileSync(join(root, 'resources/icon.png'), deskPng512)
  // png2icons 从一张高清 PNG 自动生成多尺寸；用 1024 源保证 256 档清晰
  const deskPng1024 = await sharp(desk).resize(1024, 1024).png().toBuffer()
  writeFileSync(join(root, 'resources/icon.ico'), png2icons.createICO(deskPng1024, png2icons.BILINEAR, 0, false))
  writeFileSync(join(root, 'resources/icon.icns'), png2icons.createICNS(deskPng1024, png2icons.BILINEAR, 0))

  // 软件 logo：透明 PNG，标题栏与关于页共用
  const logoPng = await sharp(logo).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
  writeFileSync(join(root, 'src/renderer/src/assets/icons/YcideLogo.png'), logoPng)

  console.log('图标生成完成：resources/icon.{png,ico,icns} + assets/icons/YcideLogo.png')
}

main().catch(e => { console.error(e); process.exit(1) })
