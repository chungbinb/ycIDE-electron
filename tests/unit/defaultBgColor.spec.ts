// 融入型控件（标签/选择框/单选框/分组框）创建时背景默认改为白色（beta.6，用户反馈）。
// 此前默认 -1「融入窗口底色」——面板显示「默认」、色块白，但运行时随窗口色（窗口红→标签红）。
// 改为默认 16777215=白：新建即进颜色表填白，不再随窗口色；透明仍由「效果=透明」属性单独驱动。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []
const tmpDirs: string[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-bg-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })

describe('融入型控件背景默认白色', () => {
  it.skipIf(!zigAvailable)('新建标签（空属性）→ 进颜色表填白 16777215，不随窗口色', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-bg-')); tmpDirs.push(dir)
    writeFileSync(join(dir, 'p.epp'), ['# YiCode Project File', 'Version=1', 'ProjectName=默认背景白', 'OutputType=WindowsApp', 'Platform=windows', '', 'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', ''].join('\n'), 'utf-8')
    // 窗口红底 + 一个「刚创建」的标签（properties 为空，等同 addControl 产物）
    writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
      name: '_启动窗口', title: '窗口', width: 400, height: 300, sourceFile: '_启动窗口.eyc',
      properties: { '底色': 255 },  // 窗口底色红(COLORREF 0x0000FF)
      controls: [{ id: 'c1', type: '标签', name: '标签1', left: 10, top: 10, width: 120, height: 24, text: '文本', visible: true, enabled: true, properties: {} }],
    }), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 __启动窗口_创建完毕', ''].join('\n'), 'utf-8')

    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, `编译失败：\n${errs}`).toBe(true)
    const mainGen = readFileSync(join(dir, 'temp', 'main.cpp'), 'utf-8')
    // 空属性标签的颜色表条目：backColor 白 16777215（此前默认 -1 时该标签根本不进表→融入窗口红）
    expect(mainGen).toContain('IDC_标签1')
    expect(mainGen).toMatch(/IDC_标签1,\s*\(COLORREF\)0,\s*\(COLORREF\)16777215/)  // {id, textColor 0, backColor 白}
  }, 120000)
})
