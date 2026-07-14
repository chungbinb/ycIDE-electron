// 图片框「显示方式=缩放图片」回归：此前用 SS_BITMAP 会把控件放大到图片原始尺寸（运行后异常变大），
// 缩放模式从未实现。修复=SS_REALSIZECONTROL(控件守设计尺寸) + STM_SETIMAGE 前把位图拉伸到客户区。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []

// 1x1 PNG（有效，GDI+ 可解码；缩放到任意尺寸都成立）
const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-pic-userdata-')), appVersion: 'test' })
  setCompilerHost({
    emitOutput: (msg) => { messages.push(msg) },
    requestFocusIdeWindow: () => {},
    notifyProcessExit: () => {},
    openPathExternally: async () => '',
  })
})

afterAll(() => {})

function mkPicProject(drawMode: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'ycide-picbox-'))
  writeFileSync(join(dir, 'p.epp'), [
    '# YiCode Project File', 'Version=1', 'ProjectName=图片框缩放验证',
    'OutputType=WindowsApp', 'Platform=windows', '',
    'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', '',
  ].join('\n'), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
    name: '_启动窗口', title: '窗口', width: 400, height: 300, sourceFile: '_启动窗口.eyc',
    controls: [
      { id: 'c1', type: '图片框', name: '图片框1', left: 20, top: 20, width: 200, height: 92, text: '', visible: true, enabled: true, properties: { '图片': PNG_1X1, '显示方式': drawMode } },
    ],
  }), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 __启动窗口_创建完毕', ''].join('\n'), 'utf-8')
  return dir
}

describe('图片框显示方式', () => {
  it.skipIf(!zigAvailable)('缩放图片：SS_REALSIZECONTROL 守尺寸 + 位图拉伸到客户区，且可编译', async () => {
    const dir = mkPicProject(1)  // 1=缩放
    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    const errors = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, `编译失败：\n${errors}`).toBe(true)
    expect(existsSync(result.outputFile)).toBe(true)

    const mainCpp = readFileSync(join(dir, 'temp', 'main.cpp'), 'utf-8')
    expect(mainCpp).toContain('SS_REALSIZECONTROL')                 // 控件不随位图放大
    expect(mainCpp).toContain('Gdiplus::Bitmap _scaledPic')          // 缩放：新建目标尺寸位图
    expect(mainCpp).toContain('_gPic.DrawImage(pPicBmp, 0, 0')       // 拉伸绘制到客户区
    rmSync(dir, { recursive: true, force: true })
  }, 120000)

  it.skipIf(!zigAvailable)('居左上(非缩放)：仍 SS_REALSIZECONTROL 守尺寸，但不生成缩放代码', async () => {
    const dir = mkPicProject(0)  // 0=居左上
    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    const errors = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, `编译失败：\n${errors}`).toBe(true)

    const mainCpp = readFileSync(join(dir, 'temp', 'main.cpp'), 'utf-8')
    expect(mainCpp).toContain('SS_REALSIZECONTROL')       // 守尺寸对所有模式生效
    expect(mainCpp).not.toContain('Gdiplus::Bitmap _scaledPic')  // 非缩放模式不拉伸
    rmSync(dir, { recursive: true, force: true })
  }, 120000)
})
