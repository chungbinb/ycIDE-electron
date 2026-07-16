// 打开文件（krnln.open）：ycmd 元数据曾被生成器按英文名 open 撞名，挂成了「外部数据库.打开(ODBC)」的说明/参数
//（返回逻辑型、参数 ODBC数据源连接文本/是否只读/…），与帮助「〈整数型〉打开文件(文件名,［打开方式］,［共享方式］)」
// 和 impl 完全不符。此处守住元数据 + 打开方式/共享方式 常量语义。
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-open-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})

describe('打开文件 命令定义', () => {
  it('ycmd 元数据与帮助一致（不再是 ODBC 那套）', () => {
    const j = JSON.parse(readFileSync(join(repoRoot, 'lib/krnln/krnln.commands.ycmd.json'), 'utf-8'))
    const c = j.commands.find((x: { commandId: string }) => x.commandId === 'krnln.open')
    expect(c).toBeTruthy()
    expect(c.displayName).toBe('打开文件')
    expect(c.returnType, '成功返回文件号 → 整数型').toBe('整数型')
    expect(c.category).toBe('文件读写')
    expect(c.params.map((p: { name: string }) => p.name)).toEqual(['欲打开的文件名称', '打开方式', '共享方式'])
    expect(c.params.map((p: { type: string }) => p.type)).toEqual(['文本型', '整数型', '整数型'])
    expect(c.params[0].optional, '文件名必填').toBe(false)
    expect(c.params[1].optional && c.params[2].optional, '打开方式/共享方式 可省略').toBe(true)
    // 不得再残留 ODBC 那套
    expect(JSON.stringify(c)).not.toContain('ODBC')
  })

  it('打开方式/共享方式 常量齐全且与帮助编号一致', () => {
    const j = JSON.parse(readFileSync(join(repoRoot, 'lib/krnln/krnln.constants.json'), 'utf-8'))
    const v = (n: string) => j.constants.find((c: { name: string }) => c.name === n)?.value
    expect([v('#读入'), v('#写出'), v('#读写'), v('#重写'), v('#改写'), v('#改读')]).toEqual(['1', '2', '3', '4', '5', '6'])
    expect([v('#无限制'), v('#禁止读'), v('#禁止写'), v('#禁止读写')]).toEqual(['1', '2', '3', '4'])
  })

  it.skipIf(!zigAvailable)('可编译：文件号是整数型、常量可直接传（含 _fsopen 共享方式）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-open-proj-'))
    writeFileSync(join(dir, 'p.epp'), ['# YiCode Project File', 'Version=1', 'ProjectName=open', 'OutputType=WindowsApp', 'Platform=windows', '', 'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({ name: '_启动窗口', title: 'w', width: 300, height: 200, sourceFile: '_启动窗口.eyc', controls: [] }), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.eyc'), [
      '.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 __启动窗口_创建完毕',
      '.局部变量 f, 整数型',
      'f ＝ 打开文件 (“t.txt”, #重写, #禁止写)',
      'f ＝ 打开文件 (“t.txt”)',              // 打开方式/共享方式 可省略
      '写出文本 (f, “甲”, “乙”)',
      '关闭文件 (f)',
      '',
    ].join('\n'), 'utf-8')
    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'run' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)
    const gen = readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8')
    // 声明须与 impl 一致：int krnln_open(const char*, int, int)
    expect(gen).toContain('extern "C" int krnln_open(const char*, int, int);')
    rmSync(dir, { recursive: true, force: true })
  }, 120000)
})
