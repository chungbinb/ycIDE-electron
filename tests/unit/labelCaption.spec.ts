import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const tempDirs: string[] = []
const messages: CompileMessage[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-label-caption-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: m => messages.push(m), requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

describe('标签标题与控件名称', () => {
  it.skipIf(!zigAvailable)('明确为空的标题不应回退为控件名称，缺失标题字段的旧工程仍兼容回退', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-label-caption-'))
    tempDirs.push(dir)
    writeFileSync(join(dir, 'p.epp'), [
      '# YiCode Project File', 'Version=1', 'ProjectName=标签标题', 'OutputType=WindowsApp', 'Platform=windows', '',
      'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', '',
    ].join('\n'), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
      name: '_启动窗口', title: '窗口', width: 320, height: 180,
      controls: [
        { id: 'empty', type: '标签', name: '空标题标签', left: 10, top: 10, width: 100, height: 24, text: '', visible: true, enabled: true, properties: {} },
        { id: 'legacy', type: '标签', name: '旧标签', left: 10, top: 50, width: 100, height: 24, visible: true, enabled: true, properties: {} },
      ],
    }), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.eyc'), '.版本 2\n.程序集 窗口程序集_启动窗口\n', 'utf-8')

    const before = messages.length
    const result = await compileProject({ projectDir: dir, mode: 'run' })
    const errors = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(result.success, errors).toBe(true)

    const generated = readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8')
    expect(generated).toMatch(/CreateWindowExW\([^\n]*L"STATIC", L""/)
    expect(generated).toMatch(/CreateWindowExW\([^\n]*L"STATIC", L"旧标签"/)
  })
})
