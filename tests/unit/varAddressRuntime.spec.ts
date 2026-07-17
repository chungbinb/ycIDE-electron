// 【取变量地址/取变量数据地址（spec 库）+ 指针到* 防护 · 运行时】真编译控制台 exe、真跑、读 stdout。
//
// 此前 spec 库这两条命令**只有元数据没有实现**——通用编组按「通用型」发出 const char* 调用，
// 链接期 undefined symbol: spec_GetVarAddress / spec_GetVarDataAddr（用户字节集测试程序暴露）。
// 即便实现了，通用编组给的也是「值的文本形态」，连变量地址都不是——必须按引用编组
// （YCMD_VARREF_EXPRS：变量地址 + yc_vt_of 类型标签，krnln_set 一族的既有契约）。
//
// x64 适配：地址 32 位装不下，返回类型定为 长整数型（与 指针到整数/指针到字节集 收
// 长整数型 指针的约定对齐；32 位易语言移植代码用 整数型 接地址会截断成垃圾指针——
// 指针到* 家族已加 VirtualQuery 可读性防护，读垃圾地址返回零值/空而不是崩掉整个程序）。
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-rt-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})

describe('取变量地址/取变量数据地址 · 运行时', () => {
  it.skipIf(!zigAvailable)('地址经 指针到整数/指针到字节集 往返一致；空字节集数据地址为 0；垃圾指针不崩', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-addr-'))
    const say = (label: string, expr: string[]) =>
      `标准输出 (0, “${label}=” ${expr.map(e => `＋ ${e}`).join(' ')} ＋ #换行符)`
    writeFileSync(join(dir, 'p.epp'), ['ProjectName=变量地址', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '程序.eyc'), [
      '.版本 2', '.程序集 程序集1', '',
      '.子程序 _启动子程序',
      '.局部变量 整数数据, 整数型',
      '.局部变量 双精度数据, 双精度小数型',
      '.局部变量 字节数据, 字节集',
      '.局部变量 空字节集, 字节集',
      '.局部变量 地址, 长整数型',
      '',
      // ① 取变量地址(整数) → 指针到整数 读回原值
      '整数数据 ＝ 12345',
      '地址 ＝ 取变量地址 (整数数据)',
      say('整数往返', ['到文本 (指针到整数 (地址))']),
      // ② 取变量地址(双精度) → 指针到双精度小数 读回
      '双精度数据 ＝ 2.718281828',
      '地址 ＝ 取变量地址 (双精度数据)',
      say('双精度往返', ['到文本 (指针到双精度小数 (地址))']),
      // ③ 取变量数据地址(字节集) → 指针到字节集 按长度读回缓冲区（到文本 解码 UTF-8）
      '字节数据 ＝ 到字节集 (“Hello, 世界! 123”)',
      '地址 ＝ 取变量数据地址 (字节数据)',
      say('字节集往返', ['到文本 (指针到字节集 (地址, 取字节集长度 (字节数据)))']),
      // ④ 空字节集：帮助明说长度为 0 时返回 0
      say('空字节集地址', ['到文本 (取变量数据地址 (空字节集))']),
      // ⑤ 非缓冲类型：取变量数据地址 与 取变量地址 相同
      say('数值型两者一致', ['到文本 (取变量数据地址 (整数数据) ＝ 取变量地址 (整数数据))']),
      // ⑥ 指针到* 的可读性防护：截断/垃圾地址返回零值与空，不崩（32 位移植代码用整数型接地址的典型踩法）
      say('垃圾指针整数', ['到文本 (指针到整数 (305419896))']),
      say('垃圾指针字节集长度', ['到文本 (取字节集长度 (指针到字节集 (305419896, 16)))']),
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)

    const out = execFileSync(r.outputFile, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
    const val = (label: string) => (out.split('\n').find(l => l.startsWith(`${label}=`)) || '').trim().slice(label.length + 1)

    expect(val('整数往返'), '取变量地址 → 指针到整数 读回原值').toBe('12345')
    expect(val('双精度往返'), '取变量地址 → 指针到双精度小数 读回原值').toBe('2.718281828')
    expect(val('字节集往返'), '取变量数据地址 → 指针到字节集 读回缓冲区内容').toBe('Hello, 世界! 123')
    expect(val('空字节集地址'), '长度为 0 的字节集数据地址照帮助返回 0').toBe('0')
    expect(val('数值型两者一致'), '非缓冲类型两命令返回相同地址').toBe('真')
    expect(val('垃圾指针整数'), '不可读地址返回 0 而不是崩').toBe('0')
    expect(val('垃圾指针字节集长度'), '不可读地址返回空字节集而不是崩').toBe('0')

    rmSync(dir, { recursive: true, force: true })
  }, 180000)

  // 转译期硬拦截：地址赋给 整数型 直接编译失败并给出改 长整数型 的指引（编辑器问题面板有同款诊断）。
  // 32 位易语言老代码习惯用 整数型 接地址，x64 下截断后再当指针用全是垃圾地址——宁可编不过也不让它跑。
  it('地址赋给整数型变量 → 转译期友好报错，不生成截断代码', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-addr-narrow-'))
    writeFileSync(join(dir, 'p.epp'), ['ProjectName=地址截断拦截', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '程序.eyc'), [
      '.版本 2', '.程序集 程序集1', '',
      '.子程序 _启动子程序',
      '.局部变量 整数数据, 整数型',
      '.局部变量 指针, 整数型',
      '指针 ＝ 取变量地址 (整数数据)',
      '',
    ].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    expect(r.success, '整数型接地址必须编不过').toBe(false)
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(errs).toContain('长整数型')
    expect(errs).toContain('截断')
    expect(errs).toContain('指针')

    rmSync(dir, { recursive: true, force: true })
  }, 120000)
})
