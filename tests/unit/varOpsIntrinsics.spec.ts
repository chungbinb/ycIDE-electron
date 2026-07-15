// 【变量操作族 · 转译期内建】赋值/连续赋值/交换变量/强制交换变量/数组清零。
//
// 这族的语义是「**按引用**操作变量」，而 krnln 的 void* ABI 不带类型信息、通用型赋值/交换根本
// 表达不了：impl 是 `*(uintptr_t*)目标 = (uintptr_t)值指针`（把指针值当数据写），而通用编组
// 交给它的还是**值的文本形态**，连地址都不是——两头都错。
// 修法不是对齐 ABI，是把这 5 条做成转译期内建：转译期本来就知道每个变量的类型，直接发
// 类型正确的 C++，完全绕开 krnln。
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

function mkProj(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'ycide-varops-'))
  writeFileSync(join(dir, 'p.epp'), ['ProjectName=变量操作', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
  writeFileSync(join(dir, '程序.eyc'), [
    '.版本 2', '.程序集 程序集1', '',
    '.子程序 _启动子程序',
    '.局部变量 a, 整数型', '.局部变量 b, 整数型', '.局部变量 c, 整数型',
    '.局部变量 s, 文本型', '.局部变量 t, 文本型',
    '.局部变量 数, 整数型, , "0"',
    '.局部变量 文, 文本型, , "0"',
    ...lines, '',
  ].join('\n'), 'utf-8')
  return dir
}

async function build(lines: string[]) {
  const dir = mkProj(lines)
  const before = messages.length
  const r = await compileProject({ projectDir: dir, mode: 'build' })
  const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
  const out = r.success ? execFileSync(r.outputFile, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8') : ''
  rmSync(dir, { recursive: true, force: true })
  return { r, errs, out }
}

const say = (label: string, expr: string[]) =>
  `标准输出 (0, “${label}=” ${expr.map(e => `＋ ${e}`).join(' ')} ＋ #换行符)`

describe('变量操作族 · 转译期内建', () => {
  it.skipIf(!zigAvailable)('赋值/连续赋值/交换变量/强制交换变量/数组清零 真的生效', async () => {
    const { r, errs, out } = await build([
      // 赋值(变量, 值)——注意帮助里第 1 参是被赋值的变量
      '赋值 (a, 7)',
      '赋值 (s, “甲”)',
      say('赋值', ['到文本 (a)', '“/”', 's']),
      // 连续赋值(值, 变量1, 变量2…)——参数顺序与 赋值 相反（帮助如此），尾参可重复
      '连续赋值 (5, a, b, c)',
      say('连续赋值', ['到文本 (a)', '“/”', '到文本 (b)', '“/”', '到文本 (c)']),
      // 交换变量 / 强制交换变量
      'a ＝ 1',
      'b ＝ 2',
      '交换变量 (a, b)',
      say('交换变量', ['到文本 (a)', '“/”', '到文本 (b)']),
      's ＝ “甲”',
      't ＝ “乙”',
      '强制交换变量 (s, t)',
      say('强制交换变量', ['s', '“/”', 't']),
      // 数组清零：全部成员置零、不影响成员数
      '加入成员 (数, 11)',
      '加入成员 (数, 22)',
      '数组清零 (数)',
      say('数组清零', ['到文本 (取数组成员数 (数))', '“|”', '到文本 (数 [1])', '“/”', '到文本 (数 [2])']),
    ])
    expect(r.success, `编译失败：\n${errs}`).toBe(true)
    const val = (label: string) => (out.split('\n').find(l => l.startsWith(`${label}=`)) || '').trim().slice(label.length + 1)

    expect(val('赋值'), '赋值(变量, 值) —— 整数与文本都要真写进去').toBe('7/甲')
    expect(val('连续赋值'), '连续赋值(值, 变量…) 尾参可重复，三个变量都得是 5').toBe('5/5/5')
    expect(val('交换变量'), '1↔2').toBe('2/1')
    expect(val('强制交换变量'), '文本也要能交换').toBe('乙/甲')
    expect(val('数组清零'), '成员全置零，成员数不变').toBe('2|0/0')
  }, 180000)

  it.skipIf(!zigAvailable)('按引用的实参必须是变量，不是就友好报错', async () => {
    const a = await build(['交换变量 (1, 2)'])
    expect(a.r.success).toBe(false)
    expect(a.errs).toContain('需要变量作为参数')

    // 数组清零 帮助明说只收「数值数组变量」——文本数组会把指针位模式冲成 0，必须拦
    const b = await build(['加入成员 (文, “甲”)', '数组清零 (文)'])
    expect(b.r.success).toBe(false)
    expect(b.errs).toContain('只支持数值数组')
  }, 180000)
})
