// 【对象成员命令不能当自由命令调】ycmd 里有 24 条 displayName 以「对象.」开头的命令
//（对象.移动 / 对象.获取焦点 / 对象.发送信息 …）。帮助里的「对象．」是**占位符**（=任意对象），
// 不是能写出来的命令名；但 displayName 字面如此，于是它们进了命令表、补全补得出来、
// 写出来还**能编过**——而 impl 收的是「前导对象句柄 + 清单里那几个参数」，清单不含句柄，
// 生成的调用少一个参数，运行时按错位的栈/寄存器取值。
//
// 正确写法是 `控件名.方法名(…)`，走 window-units.json 的绑定派发（那条路不经过这里）。
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs'
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

async function build(lines: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'ycide-objguard-'))
  writeFileSync(join(dir, 'p.epp'), ['ProjectName=g', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
  writeFileSync(join(dir, '程序.eyc'), ['.版本 2', '.程序集 程序集1', '', '.子程序 _启动子程序', ...lines, ''].join('\n'), 'utf-8')
  const before = messages.length
  const r = await compileProject({ projectDir: dir, mode: 'build' })
  const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join(' | ')
  rmSync(dir, { recursive: true, force: true })
  return { r, errs }
}

describe('对象成员命令不能当自由命令调用', () => {
  it.skipIf(!zigAvailable)('语句形态（对象.移动 / 对象.获取焦点）→ 友好报错并指路正确写法', async () => {
    const a = await build(['对象.移动 (1, 2, 3, 4)'])
    expect(a.r.success, '此前这行能编过，然后调 krnln_move(1,2,3,4) 而 impl 收 5 个参数').toBe(false)
    expect(a.errs).toContain('是对象成员命令，不能这样直接调用')
    expect(a.errs, '要指出正确写法').toContain('控件名.移动')

    const b = await build(['对象.获取焦点 ()'])
    expect(b.r.success).toBe(false)
    expect(b.errs).toContain('控件名.获取焦点')
  }, 180000)

  it.skipIf(!zigAvailable)('表达式形态（n ＝ 对象.发送信息(…)）也要拦', async () => {
    const { r, errs } = await build(['.局部变量 n, 整数型', 'n ＝ 对象.发送信息 (1, 2, 3)'])
    expect(r.success).toBe(false)
    expect(errs).toContain('是对象成员命令，不能这样直接调用')
  }, 180000)

  it.skipIf(!zigAvailable)('不误伤：普通命令与「控件名.方法名」两条路都不受影响', async () => {
    // 普通命令：名字里没有「对象.」前缀 → 照常
    const ok = await build(['.局部变量 t, 文本型', 't ＝ 取文本中间 (“甲乙丙”, 2, 1)'])
    expect(ok.r.success, `不该误伤普通命令：\n${ok.errs}`).toBe(true)

    // 控件成员：未绑定的方法仍给「暂不支持在代码中调用」（走 window-units 那条路，不经过本守卫）
    // 注：原样例用「按钮1.移动」，但通用方法「移动」已接入 window-units（beta.18），按钮全走 * 通用绑定已无未接方法；
    // 这里改用编辑框当前尚未接入的方法「取选中文本」（编辑框仅接了「加入文本」）继续验证守卫。
    const dir = mkdtempSync(join(tmpdir(), 'ycide-objguard2-'))
    writeFileSync(join(dir, 'p.epp'), ['# YiCode Project File', 'Version=1', 'ProjectName=g2', 'OutputType=WindowsApp', 'Platform=windows', '', 'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({ name: '_启动窗口', title: 'w', width: 300, height: 200, sourceFile: '_启动窗口.eyc',
      controls: [{ name: '编辑框1', type: '编辑框', left: 10, top: 10, width: 80, height: 30, title: 'b' }] }), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 __启动窗口_创建完毕', '编辑框1.取选中文本 ()', ''].join('\n'), 'utf-8')
    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join(' | ')
    rmSync(dir, { recursive: true, force: true })
    expect(r.success).toBe(false)
    expect(errs, '控件成员那条路的报错不变（真缺口是这些控件方法还没接进 window-units）').toContain('暂不支持在代码中调用')
  }, 180000)
})
