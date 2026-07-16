// 文件命令的中文路径 + 文本编码（用户实测：通用对话框选中桌面「订阅链接狗狗云.txt」后
// 打开文件 返回 0、编辑框无内容）。
// 根因①：krnln_open/krnln_ReadFile/krnln_WriteFile 把编组交来的 UTF-8 路径字节直接喂给
// ANSI 版 _fsopen/ifstream——中文路径/文件名按系统代码页解释必然打不开。修：utf8ToWide + 宽字符 API。
// 根因②：读入文本 把文件内容一律当 UTF-8 交回——记事本「ANSI」(GBK) txt 会整段乱码。
// 修：合法 UTF-8 原样（剥 BOM）；UTF-16 按 BOM 解码；其余按 ANSI 代码页解码。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { execFileSync } from 'child_process'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []
const dirs: string[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-fenc-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})

afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

async function runConsole(eycLines: string[]): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'ycide-fenc-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'p.epp'), ['# YiCode Project File', 'ProjectName=文件编码验证', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
  writeFileSync(join(dir, '程序.eyc'), ['.版本 2', '.程序集 控制台程序集', '', '.子程序 _启动子程序, 整数型', ...eycLines, '.返回 (0)', ''].join('\n'), 'utf-8')
  const before = messages.length
  const r = await compileProject({ projectDir: dir, mode: 'build' })
  const errors = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
  expect(r.success, `编译失败：\n${errors}`).toBe(true)
  return execFileSync(r.outputFile!, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
}

describe('文件命令中文路径 + 文本编码', () => {
  it.skipIf(!zigAvailable)('打开文件/读入文本/关闭文件：中文文件名（用户场景）', async () => {
    const fdir = mkdtempSync(join(tmpdir(), 'ycide-中文目录-'))
    dirs.push(fdir)
    const fpath = join(fdir, '订阅链接狗狗云.txt')
    writeFileSync(fpath, '第一行订阅链接\nhttps://example.com/sub?token=abc\n', 'utf-8')  // UTF-8 无 BOM

    const out = await runConsole([
      '.局部变量 文件号, 整数型',
      `文件号 ＝ 打开文件 (“${fpath}”, , )`,
      '调试输出 (“文件号非零：” ＋ 到文本 (文件号 ≠ 0))',
      '调试输出 (读入文本 (文件号, ))',
      '关闭文件 (文件号)',
    ])
    expect(out).toContain('文件号非零：真')          // 修复前：中文路径 _fsopen 打不开 → 文件号=0
    expect(out).toContain('第一行订阅链接')
    expect(out).toContain('https://example.com/sub?token=abc')
  }, 120000)

  it.skipIf(!zigAvailable)('读入文本：ANSI(GBK)/UTF-8 BOM/UTF-16 BOM 内容都能解码', async () => {
    const fdir = mkdtempSync(join(tmpdir(), 'ycide-enc-'))
    dirs.push(fdir)
    // 「中文内容OK」的 GBK 字节（记事本旧默认 ANSI 编码）
    const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xc4, 0xda, 0xc8, 0xdd, 0x4f, 0x4b])
    writeFileSync(join(fdir, 'gbk.txt'), gbk)
    // UTF-8 带 BOM
    writeFileSync(join(fdir, 'utf8bom.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('带BOM内容', 'utf-8')]))
    // UTF-16 LE 带 BOM（记事本「Unicode」）
    writeFileSync(join(fdir, 'utf16.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('宽字节内容', 'utf16le')]))

    const rd = (f: string) => [
      `文件号 ＝ 打开文件 (“${join(fdir, f)}”, , )`,
      '调试输出 (读入文本 (文件号, ))',
      '关闭文件 (文件号)',
    ]
    const out = await runConsole(['.局部变量 文件号, 整数型', ...rd('gbk.txt'), ...rd('utf8bom.txt'), ...rd('utf16.txt')])
    expect(out).toContain('中文内容OK')     // GBK → ANSI 代码页解码（修复前整段乱码）
    expect(out).toContain('带BOM内容')      // BOM 剥掉、不显示
    expect(out).not.toContain('﻿')
    expect(out).toContain('宽字节内容')     // UTF-16 LE 解码（修复前当 UTF-8 全是乱码）
  }, 120000)

  it.skipIf(!zigAvailable)('写到文件/读入文件：中文路径的字节集往返', async () => {
    const fdir = mkdtempSync(join(tmpdir(), 'ycide-字节集-'))
    dirs.push(fdir)
    const fpath = join(fdir, '数据文件.dat')
    const out = await runConsole([
      '.局部变量 数据, 字节集',
      '.局部变量 结果, 逻辑型',
      `结果 ＝ 写到文件 (“${fpath}”, 到字节集 (“往返内容”))`,
      '调试输出 (“写出：” ＋ 到文本 (结果))',
      `数据 ＝ 读入文件 (“${fpath}”)`,
      '调试输出 (到文本 (数据))',
    ])
    expect(out).toContain('写出：真')       // 修复前：中文路径 ofstream 打不开 → 假
    // 到文本(字节集) 按易语言印字节列表；「往返内容」UTF-8 = 12 字节，逐字节相同即往返无损
    expect(out).toContain('{229,190,128,232,191,148,229,134,133,229,174,185}')
  }, 120000)
})
