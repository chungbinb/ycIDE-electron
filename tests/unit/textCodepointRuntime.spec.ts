// 【文本命令按码点 · 运行时】阶段0：文本族从「按 UTF-8 字节」改「按 Unicode 码点」，使中文/emoji 的
// 长度、切分、位置跨平台一致（此前 krnln_len=strlen 让 取文本长度("中")=3，left/mid 按字节切会切坏中文）。
// 控制台程序真编译真跑读 stdout——码点边界只有真跑起来读回中文才证得了。见 [[ycide-text-encoding-direction]]。
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
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-cp-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})
afterAll(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 占用中，交给系统清理 */ } } })

const say = (label: string, expr: string[]) =>
  `标准输出 (0, “${label}=” ${expr.map(e => `＋ ${e}`).join(' ')} ＋ #换行符)`

async function runConsole(dir: string, lines: string[]): Promise<(label: string) => string> {
  writeFileSync(join(dir, 'p.epp'), ['ProjectName=码点', 'OutputType=Console', 'Platform=x64', 'File=EYC|程序.eyc|0', ''].join('\n'), 'utf-8')
  writeFileSync(join(dir, '程序.eyc'), ['.版本 2', '.程序集 程序集1', '', '.子程序 _启动子程序', ...lines, ''].join('\n'), 'utf-8')
  const before = messages.length
  const r = await compileProject({ projectDir: dir, mode: 'build' })
  const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
  expect(r.success, `编译失败：\n${errs}`).toBe(true)
  const out = execFileSync(r.outputFile, [], { encoding: 'buffer', timeout: 30000 }).toString('utf-8')
  return (label: string) => (out.split('\n').find(l => l.startsWith(`${label}=`)) || '').trim().slice(label.length + 1)
}

describe('文本命令按码点', () => {
  it.skipIf(!zigAvailable)('长度/左/右/中 按码点数中文而非 UTF-8 字节', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-cp-lens-')); tmpDirs.push(dir)
    const val = await runConsole(dir, [
      '.局部变量 s, 文本型',
      's ＝ “中文Ab”',                                 // 4 个码点：中·文·A·b（此前 UTF-8 字节数 = 3+3+1+1 = 8）
      say('长度混合', ['到文本 (取文本长度 (s))']),
      say('长度单中', ['到文本 (取文本长度 (“中”))']),     // 1（此前 3）
      say('长度空', ['到文本 (取文本长度 (“”))']),
      say('左2', ['取文本左边 (s, 2)']),                  // 中文（此前按 2 字节切半个"中"→乱码）
      say('右2', ['取文本右边 (s, 2)']),                  // Ab
      say('右3', ['取文本右边 (s, 3)']),                  // 文Ab
      say('中间', ['取文本中间 (“甲乙丙丁”, 2, 2)']),      // 乙丙
      say('左超长', ['取文本左边 (“abc”, 9)']),           // abc
      say('右超长', ['取文本右边 (“中”, 9)']),            // 中
      say('中间超界', ['取文本中间 (“甲乙”, 5, 2)']),      // 空
      say('纯英文', ['取文本中间 (“hello”, 2, 3)']),      // ell（ASCII 不受影响）
    ])
    expect(val('长度混合'), '中文Ab = 4 码点（此前 strlen = 8 字节）').toBe('4')
    expect(val('长度单中'), '"中" = 1 码点（此前 3）').toBe('1')
    expect(val('长度空')).toBe('0')
    expect(val('左2'), '前 2 码点 = 中文（此前切半个中乱码）').toBe('中文')
    expect(val('右2'), '后 2 码点 = Ab').toBe('Ab')
    expect(val('右3'), '后 3 码点 = 文Ab').toBe('文Ab')
    expect(val('中间'), '第 2 起 2 码点 = 乙丙').toBe('乙丙')
    expect(val('左超长'), '超长取全').toBe('abc')
    expect(val('右超长'), '超长取全').toBe('中')
    expect(val('中间超界'), '起始超界 = 空').toBe('')
    expect(val('纯英文'), 'ASCII 行为不变').toBe('ell')
  }, 180000)

  it.skipIf(!zigAvailable)('字符/取代码 按 Unicode 码点（含补充平面 emoji 与往返）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-cp-chr-')); tmpDirs.push(dir)
    const val = await runConsole(dir, [
      say('字符中', ['字符 (20013)']),                    // U+4E2D 中（此前 20013 截断成字节 45="-"）
      say('字符A', ['字符 (65)']),                        // A（ASCII 不变）
      say('字符emoji', ['字符 (128512)']),                // U+1F600 😀（补充平面，字节型根本装不下）
      say('取代码中', ['到文本 (取代码 (“中”))']),          // 20013（此前返回首字节 0xE4=228）
      say('取代码A', ['到文本 (取代码 (“A”))']),            // 65
      say('取代码第2', ['到文本 (取代码 (“中文”, 2))']),     // 文 U+6587 = 25991
      say('往返', ['字符 (取代码 (“文”))']),                // chr(asc("文"))="文"
    ])
    expect(val('字符中'), '字符(20013)=中，不再字节截断').toBe('中')
    expect(val('字符A')).toBe('A')
    expect(val('字符emoji'), '字符(128512)=😀，字节型装不下的补充平面').toBe('😀')
    expect(val('取代码中'), '取代码("中")=20013 码点，不再返回首字节').toBe('20013')
    expect(val('取代码A')).toBe('65')
    expect(val('取代码第2'), '第 2 码点"文"=U+6587').toBe('25991')
    expect(val('往返'), 'chr∘asc 往返一致').toBe('文')
  }, 180000)

  it.skipIf(!zigAvailable)('寻找/倒找/文本替换/子文本替换 按码点位置', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-cp-pos-')); tmpDirs.push(dir)
    const val = await runConsole(dir, [
      say('寻找', ['到文本 (寻找文本 (“甲乙丙丁”, “丙”, , 假))']),        // 3（码点位置，此前字节 7）
      say('寻找起始', ['到文本 (寻找文本 (“甲乙甲乙”, “甲”, 2, 假))']),   // 3（从第 2 码点起下一个甲）
      say('找不到', ['到文本 (寻找文本 (“甲乙”, “丙”, , 假))']),          // -1
      say('倒找', ['到文本 (倒找文本 (“甲乙甲乙”, “甲”, , 假))']),        // 3（最后一个甲）
      say('文本替换', ['文本替换 (“甲乙丙丁”, 2, 2, “XY”)']),            // 甲XY丁（码点 2 起替换 2 码点=乙丙）
      say('子替换全', ['子文本替换 (“甲乙甲乙”, “甲”, “Z”, , , 假)']),    // Z乙Z乙
      say('子替换起始', ['子文本替换 (“甲乙甲乙”, “甲”, “Z”, 2, , 假)']), // 甲乙Z乙（码点 2 起，只后一个甲）
    ])
    expect(val('寻找'), '"丙"在第 3 码点（此前返回字节位 7）').toBe('3')
    expect(val('寻找起始'), '从第 2 码点起找"甲"→第 3 码点').toBe('3')
    expect(val('找不到')).toBe('-1')
    expect(val('倒找'), '最后一个"甲"在第 3 码点').toBe('3')
    expect(val('文本替换'), '码点 2 起替换 2 码点(乙丙)→XY').toBe('甲XY丁')
    expect(val('子替换全'), '全部"甲"→Z').toBe('Z乙Z乙')
    expect(val('子替换起始'), '码点 2 起，只替换后一个"甲"').toBe('甲乙Z乙')
  }, 180000)

  it.skipIf(!zigAvailable)('选择(iif) 返回文本而非指针整数（用户场景：透明标签显示"共N种解"）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-cp-iif-')); tmpDirs.push(dir)
    const val = await runConsole(dir, [
      say('真取一', ['选择 (真, “无解”, “共5种解”)']),                        // 无解（条件真取项一）
      say('假取二', ['选择 (假, “无解”, “共5种解”)']),                        // 共5种解
      say('比较条件', ['选择 (3 ＝ 0, “零”, “非零”)']),                       // 非零
      say('文本连接项', ['选择 (假, “x”, “共 ” ＋ 到文本 (5) ＋ “ 种解”)']),   // 共 5 种解（此前返回文本指针整数）
    ])
    expect(val('真取一'), '条件真取项一').toBe('无解')
    expect(val('假取二'), '条件假取项二').toBe('共5种解')
    expect(val('比较条件'), '3≠0 → 非零').toBe('非零')
    expect(val('文本连接项'), '选择项含 ＋文本连接，返回文本不是指针地址整数').toBe('共 5 种解')
  }, 180000)
})
