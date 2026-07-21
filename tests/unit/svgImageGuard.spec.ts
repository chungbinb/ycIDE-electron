// 【SVG 图片】运行时 GDI+ 不支持 SVG。新选的图在设计器侧已光栅化成 PNG；
// 历史工程里存量的 svg+xml 由编译期兜底：给出可行动告警且不嵌入（而非静默产出「运行后没图」）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []
const tmpDirs: string[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-svg-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})
afterAll(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 占用中 */ } } })

describe('SVG 图片兜底', () => {
  it.skipIf(!zigAvailable)('存量 svg+xml 图片给出告警且编译不中断', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-svg-'))
    tmpDirs.push(dir)
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>', 'utf-8').toString('base64')
    writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
      name: '_启动窗口', title: '窗口', width: 400, height: 300, sourceFile: '_启动窗口.eyc',
      properties: {},
      controls: [{
        id: 1, name: '图片框1', type: '图片框', left: 10, top: 10, width: 100, height: 60,
        text: '', visible: true, enabled: true,
        properties: { 图片: `data:image/svg+xml;base64,${svg}` },
      }],
    }), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 __启动窗口_创建完毕', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, 'p.epp'), [
      'ProjectName=svg守卫', 'OutputType=WindowsApp', 'Platform=x64',
      'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const fresh = messages.slice(before)
    expect(r.success, `编译不应因 SVG 中断：\n${fresh.filter(m => m.type === 'error').map(m => m.text).join('\n')}`).toBe(true)
    const warned = fresh.some(m => m.type === 'warning' && m.text.includes('SVG') && m.text.includes('不支持'))
    expect(warned, '应给出 SVG 不受支持的告警').toBe(true)
  }, 180000)
})
