// 【长文本常量】`.长文本常量 名, "含 \n \" \\ 的转义值"`：多行文本存进单行、值含逗号/引号不被字段切分截断，
// 编译期与 C++ 字符串字面量转义一致直接透传 #define。控制台真编译真跑读 stdout 才证得了往返无损。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []
const tmpDirs: string[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-lc-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})
afterAll(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 占用中，交给系统清理 */ } } })

describe('长文本常量', () => {
  it.skipIf(!zigAvailable)('多行 + 含逗号/引号/反斜杠的值编译后原样输出', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-longconst-'))
    tmpDirs.push(dir)
    // 存储形态（单行）：真实内容 = 「甲, 乙」/「他说："你好"」/「路径 C:\dir」三行
    writeFileSync(join(dir, '常量表.ecs'), [
      '.版本 2',
      '.常量 短文, "对照"',
      '.长文本常量 长文, "甲, 乙\\n他说：\\"你好\\"\\n路径 C:\\\\dir"',
      '',
    ].join('\n'), 'utf-8')
    writeFileSync(join(dir, '程序.eyc'), [
      '.版本 2', '.程序集 程序集1', '',
      '.子程序 _启动子程序',
      '标准输出 (0, #短文)',
      '标准输出 (0, #长文)',
      '',
    ].join('\n'), 'utf-8')
    writeFileSync(join(dir, 'p.epp'), [
      'ProjectName=长文本常量', 'OutputType=Console', 'Platform=x64',
      'File=ECS|常量表.ecs|0', 'File=EYC|程序.eyc|0', '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)
    const out = execFileSync(r.outputFile, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
    expect(out, '普通文本常量也不再输出「真」').toContain('对照')
    expect(out, '逗号未被字段切分截断').toContain('甲, 乙')
    expect(out, '转义引号还原').toContain('他说：\"你好\"')
    expect(out, '反斜杠还原').toContain('路径 C:\\dir')
    expect(out.split('\n').filter(l => l.trim()).length, '应输出 3 行（\\n 生效）').toBeGreaterThanOrEqual(3)
  }, 180000)
})
