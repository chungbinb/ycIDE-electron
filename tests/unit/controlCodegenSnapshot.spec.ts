// 控件代码生成快照：组件的 Win32 样式位、创建后消息等由核心支持库的代码生成脚本（lib/krnln/codegen）产出。
// 用覆盖全部标准组件的窗口工程（每种组件：默认属性 + 两组非默认属性），在 编译 / 运行 / 预览 三种模式下
// 生成 C++，与 tests/fixtures/control-codegen-snapshot.json 逐字节比较。
// 有意改动代码生成后，用 YCIDE_UPDATE_CODEGEN_SNAPSHOT=1 重新生成快照，并在评审时检查快照差异。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const snapshotPath = join(repoRoot, 'tests', 'fixtures', 'control-codegen-snapshot.json')
const tmpDirs: string[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-cg-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: () => {}, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})
afterAll(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 占用中 */ } } })

// 每种组件三组属性：默认、非默认 A、非默认 B（覆盖代码生成函数里的各个分支）
const FONT = '{"name":"宋体","size":12,"bold":true,"italic":true,"underline":true,"color":255}'
const VARIANTS: Record<string, Array<Record<string, unknown>>> = {
  编辑框: [{ 停留顺序: 5 }, { 边框: 5, 是否允许多行: true, 滚动条: 3, 对齐方式: 1, 输入方式: 2, 密码遮盖字符: '#', 转换方式: 2, 隐藏选择: false, 可停留焦点: false, 最大允许长度: 20, 起始选择位置: 1, 被选择字符数: 2, 文本颜色: 255, 背景颜色: 0 },
    { 边框: 3, 滚动条: 1, 对齐方式: 2, 输入方式: 7, 转换方式: 1, 调节器方式: 1, 调节器底限值: -5, 调节器上限值: 50 }],
  标签: [{}, { 横向对齐方式: 1, 纵向对齐方式: 1, 边框: 6, 效果: 4, 文本颜色: 255, 背景颜色: -1, 是否自动折行: true }, { 横向对齐方式: 2, 边框: 5, 背景颜色: 0 },
    { 渐变背景方式: 2, 渐变背景颜色1: 255, 渐变背景颜色2: 65280, 渐变背景颜色3: 16711680, 底图方式: 1 }],
  选择框: [{}, { 横向对齐方式: 1, 纵向对齐方式: 1, 按钮形式: true, 平面: true, 标题居左: true, 选中: true, 文本颜色: 255, 背景颜色: -1 }, { 横向对齐方式: 2, 纵向对齐方式: 2 }],
  单选框: [{}, { 选中: true, 平面: true }, { 横向对齐方式: 2, 背景颜色: 0 }],
  分组框: [{}, { 对齐方式: 1, 文本颜色: 255 }, { 对齐方式: 2, 背景颜色: -1 }],
  图片框: [{}, { 边框: 5, 显示方式: 2, 背景颜色: 0 }, { 边框: 2, 显示方式: 1 }],
  进度条: [{}, { 方向: 1, 显示方式: 1, 边框: 5, 最小位置: 10, 最大位置: 50, 位置: 20 }, { 边框: 0, 位置: 3 }],
  画板: [{}, { 边框: 5 }, { 边框: 2 }, { 画笔类型: 2, 画笔粗细: 3, 画笔颜色: 255, 画出方式: 7, 刷子类型: 0, 刷子颜色: 255, 文本颜色: 255, 文本背景颜色: 0, 绘画单位: 1, 自动重画: true, 画板背景色: 0, 底图方式: 2 }],
  滑块条: [{}, { 方向: 1, 刻度类型: 0, 允许选择: true, 首选择位置: 2, 选择长度: 5, 边框: 5 }, { 刻度类型: 3, 单位刻度值: 5, 页改变值: 10, 行改变值: 2, 最小位置: 5, 最大位置: 60, 位置: 30, 允许选择: true }],
  横向滚动条: [{}, { 最小位置: 5, 最大位置: 200, 页改变值: 20, 位置: 50 }, { 页改变值: -3, 行改变值: 3 }],
  纵向滚动条: [{}, { 最大位置: 10, 位置: 9 }, { 最小位置: -10 }],
  日期框: [{}, { 允许编辑: true, 附件类型: 1, 边框: 5, 今天: '2024年1月2日', 最小日期: '2020年1月1日', 最大日期: '2030年12月31日' }, { 最大日期: '2030年1月1日' }],
  月历: [{}, { 边框: 5, 不显示今天: true, 不圈注今天: true, 显示星期序号: true, 允许选择多天: true, 开始星期首日: 2, 滚动月数: 3, 最多选择天数: 7, 文本颜色: 255, 标题背景颜色: 65280, 首选择日: '2024年1月2日', 尾选择日: '2024年1月5日' },
    { 今天: '2024年3月4日', 最小日期: '2020年1月1日', 首选择日: '2024年3月4日', 内背景颜色: 0 }],
  组合框: [{}, { 类型: 0, 自动排序: true, 最大文本长度: 10, 现行选中项: 1, 内容: '默认文本', 文本颜色: 255 }, { 类型: 1, 内容: '下拉', 背景颜色: 0 }],
  列表框: [{}, { 边框: 5, 自动排序: true, 多列: true, 允许选择多项: true, 行间距: 4, 文本颜色: 255 }, { 边框: 0, 现行选中项: 2, 背景颜色: 0 }],
  选择列表框: [{}, { 自动排序: true, 行间距: 3, 现行选中项: 0 }, { 边框: 5, 背景颜色: 0 }],
  按钮: [{}, { 类型: 1, 横向对齐方式: 0, 纵向对齐方式: 2, 可停留焦点: false }, { 横向对齐方式: 2, 纵向对齐方式: 0, 文本颜色: 255 }, { 底色: 255, 字体: FONT },
    // 放在选择夹第 2 页上
    { 所属选择夹: '选择夹2', 所属子夹: 1, 停留顺序: 2 }],
  // 其余可视组件：默认属性 + 通用属性（底色、字体、外形、禁止、选中）
  选择夹: [{}, { 底色: 255, 字体: FONT, 禁止: true, 子夹标题: '甲\n乙\n丙', 现行子夹: 1, 隐藏自身: true }],
  图形按钮: [{}, { 选中: true, 底色: 65280, 类型: 1, 透明颜色: 255 }],
  外形框: [{}, { 外形: 2, 底色: 255 }, { 外形: 3, 线条效果: 1, 线型: 2, 线宽: 3, 线条颜色: 255, 填充颜色: 0, 背景颜色: 0 }],
  驱动器框: [{}, { 字体: FONT }],
  目录框: [{}, { 禁止: true }],
  文件框: [{}, { 底色: 255 }],
  颜色选择器: [{}],
  超级链接框: [{}, { 字体: FONT }, { 类型: 1, 电子邮件地址: 'a@b.c', Internet地址: 'https://example.com' }],
  调节器: [{}],
  通用对话框: [{}],
  时钟: [{}, { 时钟周期: 500 }],
}


// 组件方法调用：画板绘图、选择列表框、选择夹、超级链接框（含省略参数的分支）
const METHOD_CALLS = [
  '画板1.清除 ()', '画板1.清除 (1, 2, 3, 4)', '画板1.画点 (1, 2, 255)', '画板1.画直线 (1, 2, 3, 4)', '画板1.画椭圆 (1, 2, 3, 4)',
  '画板1.画弧线 (1, 2, 3, 4, 5, 6, 7, 8)', '画板1.画弦 (1, 2, 3, 4, 5, 6, 7, 8)', '画板1.画饼 (1, 2, 3, 4, 5, 6, 7, 8)',
  '画板1.画矩形 (1, 2, 3, 4)', '画板1.画渐变矩形 (1, 2, 3, 4, 255, 0)', '画板1.画渐变矩形 (1, 2, 3, 4, 1, 255, 0)', '画板1.填充矩形 (1, 2, 3, 4)',
  '画板1.画圆角矩形 (1, 2, 3, 4, 5)', '画板1.画圆角矩形 (1, 2, 3, 4, 5, 6)', '画板1.翻转矩形区 (1, 2, 3, 4)',
  '画板1.置写出位置 ()', '画板1.置写出位置 (5, 6)', '画板1.写文本行 (“行”)', '画板1.滚动写行 (“行”)', '画板1.写出 (1)', '画板1.定位写出 (1, 2, “文”)',
  '画板1.取宽度 (“宽”)', '画板1.取高度 (“高”)', '画板1.复制 ()', '画板1.取设备句柄 ()', '画板1.取点 (1, 2)',
  '选择列表框1.选中项目 (0)', '选择列表框1.选中项目 (0, 假)', '选择列表框1.是否被选中 (0)', '选择列表框1.允许 (1)', '选择列表框1.是否被允许 (1)',
  '选择夹1.取子夹数目 ()', '选择夹1.取子夹名称 (0)', '选择夹1.置子夹名称 (0, “页”)', '超级链接框1.跳转 ()',
]

function buildControls(): unknown[] {
  const controls: unknown[] = []
  let n = 0
  for (const [type, variants] of Object.entries(VARIANTS)) {
    variants.forEach((properties, i) => {
      n++
      controls.push({
        id: `c${n}`, type, name: `${type}${i + 1}`, left: 10 + (n % 6) * 90, top: 10 + Math.floor(n / 6) * 40, width: 80, height: 30,
        text: '', visible: true, enabled: true, properties,
      })
    })
  }
  return controls
}

function writeProject(dir: string): void {
  writeFileSync(join(dir, 'p.epp'), ['# YiCode Project File', 'Version=1', 'ProjectName=控件代码生成快照', 'OutputType=WindowsApp', 'Platform=windows', '',
    'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', ''].join('\n'), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
    name: '_启动窗口', title: '窗口', width: 800, height: 600, sourceFile: '_启动窗口.eyc', controls: buildControls(),
    // 窗口属性：每个都设成非默认值
    properties: {
      可视: true, 禁止: false, 边框: 3, 最大化按钮: false, 最小化按鈕: false, 控制按钮: false, 总在最前: true, 位置: 2, 左边: 30, 顶边: 40,
      底色: 16711680, 鼠标指针: 3, 可否移动: false, 回车下移焦点: true, Esc键关闭: true, 在任务条中显示: false, 随意移动: true, 保持标题条激活: true,
      窗口类名: ' MyWndClass ', 外形: 1, 圆角半径: 12, 底图方式: 4,
    },
  }), 'utf-8')
  writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 __启动窗口_创建完毕', ...METHOD_CALLS, ''].join('\n'), 'utf-8')
}

async function generate(mode: 'compile' | 'run' | 'preview'): Promise<Record<string, string>> {
  const dir = mkdtempSync(join(tmpdir(), 'ycide-cg-'))
  tmpDirs.push(dir)
  writeProject(dir)
  await compileProject(mode === 'preview' ? { projectDir: dir, mode: 'run', previewWindow: '_启动窗口' } : { projectDir: dir, mode })
  const out: Record<string, string> = {}
  for (const name of readdirSync(join(dir, 'temp')).filter(f => f.endsWith('.cpp') || f.endsWith('.h')).sort()) {
    // 工程目录每次不同，统一替换掉
    out[name] = readFileSync(join(dir, 'temp', name), 'utf-8').split(dir).join('<工程目录>').split(dir.replace(/\\/g, '\\\\')).join('<工程目录>')
  }
  return out
}

describe('控件代码生成快照', () => {
  it.skipIf(!zigAvailable)('编译 / 运行 / 预览三种模式生成的 C++ 与快照逐字节一致', async () => {
    const actual = { compile: await generate('compile'), run: await generate('run'), preview: await generate('preview') }
    if (process.env.YCIDE_UPDATE_CODEGEN_SNAPSHOT === '1' || !existsSync(snapshotPath)) {
      writeFileSync(snapshotPath, JSON.stringify(actual, null, 1), 'utf-8')
    }
    const expected = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as typeof actual
    for (const mode of ['compile', 'run', 'preview'] as const) {
      expect(Object.keys(actual[mode]), mode).toEqual(Object.keys(expected[mode]))
      for (const file of Object.keys(expected[mode])) {
        expect(actual[mode][file] === expected[mode][file], `${mode}/${file} 与快照不一致`).toBe(true)
      }
    }
  }, 600000)
})
