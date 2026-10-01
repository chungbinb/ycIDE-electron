// VC6 现代样式开关（designerVc6Style → 编译注入）。
//
// 用户反馈：编译出的 Windows 程序控件是经典 Win32 灰样式。机制：mingw(gnu) 目标下
// 加载器可能不自动应用内嵌的 comctl32 v6 清单（实测 GetCurrentActCtx 为空），
// 故启用时除嵌入清单外，还在 WinMain 生成显式建立/激活上下文的代码（YC_VC6_STYLE 宏）。
//
// 这里从**真实 zig 命令行**（诊断日志「zig 命令行参数」行）与产物二进制内容坐实：
//   启用（默认）→ WindowsApp 命令行带 -DYC_VC6_STYLE=1，exe 内嵌 Common-Controls 清单；
//   关闭        → 不带宏、exe 无清单（经典样式）；Console 程序两种情况都无宏。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage, type CompileOptions } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []
const tmpDirs: string[] = []
let vc6Style = true

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-vc6-userdata-')), appVersion: 'test' })
  setCompilerHost({
    emitOutput: (m) => { messages.push(m) },
    requestFocusIdeWindow: () => {},
    notifyProcessExit: () => {},
    openPathExternally: async () => '',
    readCompilerSettings: () => ({ zigPath: '', optimizeLevel: 'O2', vc6Style }),
  })
})
afterAll(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 占用中 */ } } })

interface Vc6Probe {
  success: boolean
  zigCmdLine: string
  exeHasManifest: boolean
}

/** 编译一个 WindowsApp 项目（最简窗体），返回真实 zig 命令行与产物是否嵌清单 */
async function compileWindowsApp(): Promise<Vc6Probe> {
  const dir = mkdtempSync(join(tmpdir(), 'ycide-vc6-'))
  tmpDirs.push(dir)
  writeFileSync(join(dir, 'p.epp'), ['ProjectName=vc6-style', 'OutputType=WindowsApp', 'Platform=x64', 'File=EFW|_启动窗口.efw|0', 'File=EYC|_启动窗口.eyc|0', ''].join('\n'), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({ name: '_启动窗口', formWidth: 320, formHeight: 240, formTitle: 'vc6', properties: {}, controls: [] }), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '', '.子程序 __启动窗口_创建完毕', ''].join('\n'), 'utf-8')
  const before = messages.length
  const opts: CompileOptions = { projectDir: dir, mode: 'compile' }
  const r = await compileProject(opts)
  const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
  expect(r.success, `编译失败：\n${errs}`).toBe(true)
  const diagPath = join(dir, 'temp', '编译诊断日志.log')
  const diag = existsSync(diagPath) ? readFileSync(diagPath, 'utf-8') : ''
  const zigCmdLine = (diag.split('\n').find(l => l.includes('zig 命令行参数')) || '').trim()
  const exeBytes = readFileSync(r.outputFile)
  return { success: r.success, zigCmdLine, exeHasManifest: exeBytes.includes('Microsoft.Windows.Common-Controls') }
}

describe('VC6 现代样式开关', () => {
  it.skipIf(!zigAvailable)('默认启用：WindowsApp 命令行带 -DYC_VC6_STYLE=1，产物嵌入 v6 清单', async () => {
    vc6Style = true
    const p = await compileWindowsApp()
    expect(p.zigCmdLine, '真实 zig 命令行应含 -DYC_VC6_STYLE=1').toMatch(/-DYC_VC6_STYLE=1/)
    expect(p.exeHasManifest, '产物应嵌入 Common-Controls 清单').toBe(true)
  }, 240000)

  it.skipIf(!zigAvailable)('关闭：WindowsApp 不带宏，产物无清单（经典样式）', async () => {
    vc6Style = false
    const p = await compileWindowsApp()
    expect(p.zigCmdLine, '关闭后命令行不应含 -DYC_VC6_STYLE').not.toMatch(/-DYC_VC6_STYLE/)
    expect(p.exeHasManifest, '关闭后产物不应嵌入清单').toBe(false)
  }, 240000)

  it.skipIf(!zigAvailable)('开关切换后产物缓存按新设置重建（指纹含 vc6Style）', async () => {
    // 连续两次编译同项目：关闭→开启，第二次必须真的重编（产物从无清单变为有清单）
    vc6Style = false
    const off = await compileWindowsApp()
    expect(off.exeHasManifest).toBe(false)
    vc6Style = true
    const on = await compileWindowsApp()
    expect(on.exeHasManifest).toBe(true)
  }, 240000)
})
