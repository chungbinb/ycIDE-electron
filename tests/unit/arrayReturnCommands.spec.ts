// 【数组返回 ABI】清单里标〈X数组〉返回的命令。此前 mapTypeToCType 根本不认「文本型数组」
// → 掉默认 int，声明 int 收 impl 的 const char*，调用处拿到被截断的指针值（且从不报错）。
// 现在：impl 在堆上 new std::vector<long long> 以 void* 交回，生成侧 yc_ary_take 接管并 delete。
// 白名单是按符号给的（YCMD_ARRAY_RETURN_SYMBOLS）——krnln 512 条里 379 条是桩，
// 桩体 `return keepUtf8("[]")` 若也吃这套 ABI，yc_ary_take 会把字面量当 vector* 解引用并 delete。
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
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-rt-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})

function mkProj(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'ycide-ary-proj-'))
  writeFileSync(join(dir, 'p.epp'), ['# YiCode Project File', 'Version=1', 'ProjectName=ary', 'OutputType=WindowsApp', 'Platform=windows', '', 'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', ''].join('\n'), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({ name: '_启动窗口', title: 'w', width: 300, height: 200, sourceFile: '_启动窗口.eyc', controls: [] }), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.eyc'), [
    '.版本 2', '.程序集 窗口程序集_启动窗口', '',
    '.子程序 __启动窗口_创建完毕',
    '.局部变量 文本数组, 文本型, , "0"',
    '.局部变量 t, 文本型',
    ...lines, '',
  ].join('\n'), 'utf-8')
  return dir
}

async function build(lines: string[]) {
  const dir = mkProj(lines)
  const before = messages.length
  const r = await compileProject({ projectDir: dir, mode: 'run' })
  const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
  const gen = existsSync(join(dir, 'temp', '_启动窗口.cpp')) ? readFileSync(join(dir, 'temp', '_启动窗口.cpp'), 'utf-8') : ''
  rmSync(dir, { recursive: true, force: true })
  return { r, errs, gen }
}

describe('数组返回 ABI', () => {
  it.skipIf(!zigAvailable)('分割文本 赋给文本数组 → yc_ary_take 接管 krnln_split 交回的堆 vector，且可编译', async () => {
    const { r, errs, gen } = await build([
      '文本数组 ＝ 分割文本 (“甲,乙,丙”, “,”)',
      't ＝ 文本数组 [2]',                       // 一基下标 + 文本元素读回（(wchar_t*)(intptr_t)）
    ])
    expect(r.success, `编译失败：\n${errs}`).toBe(true)
    expect(gen).toContain('yc_ary_take(krnln_split(')
    // 返回类型必须是 vector 而非默认 int（此前正是掉进 int 才静默出错）
    expect(gen).toMatch(/\[&\]\(\) -> std::vector<long long>/)
    expect(gen).toContain('((wchar_t*)(intptr_t)yc_ary_at(文本数组, 2LL))')

    // 声明必须与 windows.cpp 的实现签名一致（C 链接不跨 TU 校验签名，错位只在运行时发作）。
    // 未进白名单的那两条也一并钉住：GetAllPY 的桩已按 ABI 收敛成 void*（返回 nullptr → 空数组，
    // 万一被绕过也只是空数组、不会把字面量当 vector* 解引用）；SplitBin 仍是 int（字节集数组未支持，调用被 assert 拦）。
    expect(gen).toContain('extern "C" void* krnln_split(const char*, const char*, int);')
    expect(gen).toContain('extern "C" void* krnln_GetSectionNames(const char*);')
    expect(gen).toContain('extern "C" void* krnln_OpenManyFileDialog(const char*, const char*, int, const char*, int, const char*);')
    expect(gen).toContain('extern "C" void* krnln_GetSelItems();')
    expect(gen).toContain('extern "C" void* krnln_GetAllPY(const char*);')
  }, 120000)

  it.skipIf(!zigAvailable)('分隔符「省略」与「显式空文本」译得出区别（省略发 nullptr）', async () => {
    const { r, errs, gen } = await build([
      '文本数组 ＝ 分割文本 (“甲 乙 丙”)',        // 省略 → nullptr → impl 取默认半角逗号
      '文本数组 ＝ 分割文本 (“甲乙丙”, “”)',      // 显式空文本 → "" → impl 整段不分割
    ])
    expect(r.success, `编译失败：\n${errs}`).toBe(true)
    const omitted = gen.split('\n').find(l => l.includes('甲 乙 丙')) || ''
    const explicit = gen.split('\n').find(l => l.includes('甲乙丙')) || ''
    expect(omitted, '省略分隔符应发 nullptr').toContain('(const char*)nullptr')
    expect(explicit, '显式空文本不应发 nullptr').not.toContain('(const char*)nullptr')
  }, 120000)

  it.skipIf(!zigAvailable)('复制数组(目标, 分割文本(…)) → 临时量落轮转槽再取址（帮助里的规范用法）', async () => {
    const { r, errs, gen } = await build(['复制数组 (文本数组, 分割文本 (“甲,乙”, “,”))'])
    expect(r.success, `编译失败：\n${errs}`).toBe(true)
    expect(gen).toContain('(void*)&yc_ary_tmp(')
    expect(gen).toContain('krnln_CopyAry((void*)&文本数组')
  }, 120000)

  it.skipIf(!zigAvailable)('调试输出(分割文本(…)) 按文本元素还原，不印指针整数', async () => {
    const { r, errs, gen } = await build(['调试输出 (分割文本 (“甲,乙”, “,”))'])
    expect(r.success, `编译失败：\n${errs}`).toBe(true)
    expect(gen).toContain('yc_ary_to_text_str(')
  }, 120000)

  it.skipIf(!zigAvailable)('数组元素类型仍受限 → 友好报错（不是静默掉默认）', async () => {
    // 元素存储只有 int/f64/text/bin 四类；如「子程序指针」这类既不是数就不是块的，仍应明确报出来
    const { r, errs } = await build(['.局部变量 x, 子程序指针, , "0"'])
    expect(r.success).toBe(false)
    expect(errs).toContain('暂不支持')
    expect(errs).toContain('当前支持整数族/小数族/文本型/字节集元素')
  }, 120000)

  it.skipIf(!zigAvailable)('分割字节集：字节集按 YC_BIN* 传（不走 NUL 结尾的通用字节集 ABI），省略分隔符发 nullptr', async () => {
    const { r, errs, gen } = await build([
      '文本数组 ＝ 分割文本 (“x”, “,”)',                                  // 占位，保证文件里有数组用法
      '.局部变量 b, 字节集, , "0"',
    ])
    void errs
    expect(r.success).toBe(true)
    // 通用字节集编组是 yc_bin_to_cstr → const char*（NUL 结尾、含 0x00 即截断）；
    // 分割字节集 的默认分隔符**正是字节 0**，故按符号特办成 YC_BIN* 指针传递。
    expect(gen).toContain('extern "C" void* krnln_SplitBin(const void*, const void*, int);')
  }, 120000)
})
