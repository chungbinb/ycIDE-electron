// 窗口.底图 代码赋值（_启动窗口.底图 ＝ #资源N）。
//
// 用户实测：代码里给窗口属性赋底图报「暂不支持在代码中赋值」。实现：
//   协议绑定 窗口.底图 set → yc_win_set_back_image(窗口名, 字节集)（生成于 main.cpp）；
//   预扫描 .eyc 命中赋值 → 开启 GDI+、生成主/副窗底图状态与绘制块（工程可以完全无设计底图）。
//
// 这里用真实 zig 编译坐实：带资源的工程代码赋值可编译、生成物含运行时函数与绘制块、
// 且对「无任何设计图片」的工程同样生效（预扫描门控）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage, type CompileOptions } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []
const tmpDirs: string[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-bgassign-userdata-')), appVersion: 'test' })
  setCompilerHost({
    emitOutput: (m) => { messages.push(m) },
    requestFocusIdeWindow: () => {},
    notifyProcessExit: () => {},
    openPathExternally: async () => '',
    readCompilerSettings: () => ({ zigPath: '', optimizeLevel: 'O2', vc6Style: true }),
  })
})
afterAll(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 占用中 */ } } })

/** 造一张合法 1x1 PNG（zlib 手工封装，无需 sharp） */
function buildTinyPng(): Buffer {
  const zlib = require('zlib') as typeof import('zlib')
  const crc32 = (buf: Buffer): number => {
    let c = ~0
    for (const byte of buf) {
      c ^= byte
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const typeBuf = Buffer.from(type, 'ascii')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
    return Buffer.concat([len, typeBuf, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const idat = zlib.deflateSync(Buffer.from([0x00, 0x10, 0x20, 0x30]))
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

interface AssignProbe {
  success: boolean
  mainCpp: string
  winCpp: string
  errors: string
}

/** 工程：无任何设计图片，.erc 带 PNG 资源，创建完毕里代码赋值窗口底图 */
async function compileWithBackImageAssign(): Promise<AssignProbe> {
  const dir = mkdtempSync(join(tmpdir(), 'ycide-bgassign-'))
  tmpDirs.push(dir)
  writeFileSync(join(dir, 'p.epp'), [
    'ProjectName=bgassign',
    'OutputType=WindowsApp',
    'Platform=x64',
    'File=ERC|图片资源.erc|0',
    'File=EFW|_启动窗口.efw|0',
    'File=EYC|_启动窗口.eyc|0',
    '',
  ].join('\n'), 'utf-8')
  writeFileSync(join(dir, '图片资源.erc'), ['.资源 图1,"pic.png",图片', ''].join('\n'), 'utf-8')
  mkdirSync(join(dir, 'rc'), { recursive: true })
  writeFileSync(join(dir, 'rc', 'pic.png'), buildTinyPng())
  // 窗体：不设任何底图属性（验证纯代码赋值的门控）
  writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({ name: '_启动窗口', formWidth: 320, formHeight: 240, formTitle: 'bg', properties: {}, controls: [] }), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '', '.子程序 __启动窗口_创建完毕', '    _启动窗口.底图 ＝ #图1', ''].join('\n'), 'utf-8')

  const before = messages.length
  const opts: CompileOptions = { projectDir: dir, mode: 'compile' }
  const r = await compileProject(opts)
  const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
  expect(r.success, `编译失败：\n${errs}`).toBe(true)
  const mainCpp = readFileSync(join(dir, 'temp', 'main.cpp'), 'utf-8')
  // 调用点在转译出的窗口代码文件里，定义在 main.cpp
  const winCpp = readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8')
  return { success: r.success, mainCpp, winCpp, errors: errs }
}

describe('窗口.底图 代码赋值', () => {
  it.skipIf(!zigAvailable)('带 #资源 赋值可编译：生成 setter 调用、GDI+ 门控与主窗绘制块', async () => {
    const p = await compileWithBackImageAssign()
    expect(p.winCpp, '转译文件应含 setter 调用').toContain('yc_win_set_back_image(L"_启动窗口"')
    expect(p.mainCpp, 'main.cpp 应含 setter 定义').toContain('void yc_win_set_back_image(const wchar_t* name, std::vector<unsigned char> data)')
    expect(p.mainCpp).toContain('static Gdiplus::Image* yc_decode_image_bytes')
    // 门控：无设计图片的工程也要启动 GDI+ 并发绘制块（底图方式缺省 0=居左上 → default 分支原尺寸绘制）
    expect(p.mainCpp).toContain('static ULONG_PTR g_gdiplusToken = 0;')
    expect(p.mainCpp).toContain('Gdiplus::GdiplusStartup(&g_gdiplusToken')
    expect(p.mainCpp).toContain('static Gdiplus::Image* g_backImage = NULL;')
    expect(p.mainCpp).toContain('if (g_backImage) {')
    expect(p.mainCpp).toContain('graphics.DrawImage(g_backImage, 0, 0, iw, ih)')
  }, 240000)

  it.skipIf(!zigAvailable)('绘制的缩放模式来自窗体底图方式属性（设计期方式 3=缩放）', async () => {
    // 单独工程：底图方式=4 但无底图 → 代码赋值后按缩放绘制
    const dir = mkdtempSync(join(tmpdir(), 'ycide-bgassign-mode-'))
    tmpDirs.push(dir)
    writeFileSync(join(dir, 'p.epp'), [
      'ProjectName=bgassign2',
      'OutputType=WindowsApp',
      'Platform=x64',
      'File=ERC|图片资源.erc|0',
      'File=EFW|_启动窗口.efw|0',
      'File=EYC|_启动窗口.eyc|0',
      '',
    ].join('\n'), 'utf-8')
    writeFileSync(join(dir, '图片资源.erc'), ['.资源 图1,"pic.png",图片', ''].join('\n'), 'utf-8')
    mkdirSync(join(dir, 'rc'), { recursive: true })
    writeFileSync(join(dir, 'rc', 'pic.png'), buildTinyPng())
    writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({ name: '_启动窗口', formWidth: 320, formHeight: 240, formTitle: 'bg', properties: { '底图方式': 3 }, controls: [] }), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '', '.子程序 __启动窗口_创建完毕', '    _启动窗口.底图 ＝ #图1', ''].join('\n'), 'utf-8')
    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'compile' } as CompileOptions)
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)
    const mainCpp = readFileSync(join(dir, 'temp', 'main.cpp'), 'utf-8')
    // 方式 4 → HighQualityBicubic 缩放绘制
    expect(mainCpp).toContain('InterpolationModeHighQualityBicubic')
  }, 240000)

  it.skipIf(!zigAvailable)('底图方式代码赋值可编译：生成方式 setter 与运行时分派绘制块', async () => {
    // 工程：无任何图片资源，仅代码赋值 底图方式 → 门控生效、设计值 0 作 g_backImageMode 初值
    const dir = mkdtempSync(join(tmpdir(), 'ycide-bgmassign-'))
    tmpDirs.push(dir)
    writeFileSync(join(dir, 'p.epp'), [
      'ProjectName=bgmassign',
      'OutputType=WindowsApp',
      'Platform=x64',
      'File=EFW|_启动窗口.efw|0',
      'File=EYC|_启动窗口.eyc|0',
      '',
    ].join('\n'), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({ name: '_启动窗口', formWidth: 320, formHeight: 240, formTitle: 'bg', properties: {}, controls: [] }), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '', '.子程序 __启动窗口_创建完毕', '    _启动窗口.底图方式 ＝ 3', ''].join('\n'), 'utf-8')
    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'compile' } as CompileOptions)
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)
    const mainCpp = readFileSync(join(dir, 'temp', 'main.cpp'), 'utf-8')
    // 设计值作初值 + setter 定义存在
    expect(mainCpp).toContain('static int g_backImageMode = 0;')
    expect(mainCpp).toContain('void yc_win_set_back_image_mode(const wchar_t* name, long long mode)')
    // 绘制块按运行时变量分派（缩放 case 在位）
    expect(mainCpp).toContain('switch (g_backImageMode)')
    expect(mainCpp).toContain('InterpolationModeHighQualityBicubic')
    // 调用点在转译文件里
    const winCpp = readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8')
    expect(winCpp).toContain('yc_win_set_back_image_mode(L"_启动窗口"')
  }, 240000)

  it.skipIf(!zigAvailable)('底图+底图方式组合赋值：两个 setter 与门控齐备，初值取设计值', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-bgcombo-'))
    tmpDirs.push(dir)
    writeFileSync(join(dir, 'p.epp'), [
      'ProjectName=bgcombo',
      'OutputType=WindowsApp',
      'Platform=x64',
      'File=EFW|_启动窗口.efw|0',
      'File=EYC|_启动窗口.eyc|0',
      '',
    ].join('\n'), 'utf-8')
    // 设计期方式 2（居中）→ g_backImageMode 初值 2；代码先改方式再设图
    writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({ name: '_启动窗口', formWidth: 320, formHeight: 240, formTitle: 'bg', properties: { '底图方式': 2 }, controls: [] }), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '', '.子程序 __启动窗口_创建完毕', '    _启动窗口.底图方式 ＝ 0', '    _启动窗口.底图 ＝ { 1, 2, 3 }', ''].join('\n'), 'utf-8')
    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'compile' } as CompileOptions)
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)
    const mainCpp = readFileSync(join(dir, 'temp', 'main.cpp'), 'utf-8')
    expect(mainCpp).toContain('static int g_backImageMode = 2;')
    expect(mainCpp).toContain('void yc_win_set_back_image(const wchar_t* name, std::vector<unsigned char> data)')
    expect(mainCpp).toContain('void yc_win_set_back_image_mode(const wchar_t* name, long long mode)')
    const winCpp = readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8')
    expect(winCpp).toContain('yc_win_set_back_image_mode(L"_启动窗口"')
    expect(winCpp).toContain('yc_win_set_back_image(L"_启动窗口"')
  }, 240000)
})
