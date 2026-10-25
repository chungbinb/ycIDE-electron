// 组件代码生成迁到支持库脚本（lib/krnln/codegen/controls.cjs）之后：
//  - 编译器源码里不再有各组件的 Win32 样式位与创建后消息；
//  - 只加载随安装包发布的内置支持库目录里的脚本，用户安装的支持库带的脚本不会被执行；
//  - 停用核心支持库后没有组件代码生成，编译含组件的窗口会给出明确提示。
import { describe, it, expect, afterEach } from 'vitest'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { libraryManager } from '../../src/main/libraryManager'

const repoRoot = resolve(__dirname, '..', '..')
const roots: string[] = []
afterEach(() => {
  libraryManager.setDisabledLibraries([])
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-cgs-ud-')), appVersion: 'test' })
  libraryManager.scan()
})

describe('组件代码生成脚本', () => {
  it('编译器里不再有组件的代码生成细节', () => {
    const compiler = readFileSync(join(repoRoot, 'src', 'main', 'compiler.ts'), 'utf-8')
    expect(compiler).not.toMatch(/function buildStd\w*Codegen/)
    for (const token of ['ES_PASSWORD', 'TBS_AUTOTICKS', 'MCS_WEEKNUMBERS', 'LBS_MULTICOLUMN', 'CBS_DROPDOWNLIST', 'PBS_SMOOTH', 'DTS_UPDOWN', 'BS_PUSHLIKE']) {
      expect(compiler, token).not.toContain(token)
    }
    // 核心库组件的中文属性名、事件名也都在脚本里（流程关键字、类型名属于语言本身，留在编译器）
    // 去掉注释（整行注释、行尾注释、生成的 C++ 里的 /* */ 注释文字）
    const code = compiler.split(/\r?\n/)
      .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .map(line => line.replace(/\/\*.*?\*\//g, '').replace(/\s\/\/.*$/, ''))
      .join('\n')
    for (const name of ['底色', '外形', '子夹标题', '所属选择夹', '时钟周期', '电子邮件地址', '被单击', '被销毁', '创建完毕', '某键被放开', '窗口尺寸被改变', '被选择', '鼠标左键被按下', '滚轮被滚动', '画饼', '取子夹数目', '最大化按钮']) {
      expect(code, name).not.toContain(name)
    }
  })

  it('核心支持库提供全部组件的代码生成；用户安装的支持库里的脚本不加载；停用核心库后没有', () => {
    const appPath = mkdtempSync(join(tmpdir(), 'ycide-cgs-'))
    const userDataPath = mkdtempSync(join(tmpdir(), 'ycide-cgs-ud-'))
    roots.push(appPath, userDataPath)
    cpSync(join(repoRoot, 'lib'), join(appPath, 'lib'), { recursive: true })
    setRuntimeEnv({ appPath, isPackaged: false, userDataPath, appVersion: 'test' })
    // 用户安装一个带代码生成脚本的支持库：脚本一旦被执行就会留下标记文件
    const marker = join(userDataPath, 'executed.txt')
    const installed = join(libraryManager.getInstalledLibrariesRoot(), 'evil')
    cpSync(join(repoRoot, 'lib', 'spec'), installed, { recursive: true })
    for (const f of ['spec.commands.ycmd.json', 'spec.library.json', 'spec.protocol.json']) {
      const from = join(installed, f)
      if (existsSync(from)) writeFileSync(join(installed, f.replace('spec.', 'evil.')), readFileSync(from, 'utf-8').replace(/"spec"/g, '"evil"').replace(/spec\./g, 'evil.'))
      rmSync(from, { force: true })
    }
    mkdirSync(join(installed, 'codegen'), { recursive: true })
    writeFileSync(join(installed, 'codegen', 'evil.cjs'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); exports.controlCodegen = { evil: () => 1 }`)

    libraryManager.scan()
    expect(libraryManager.getList().some(l => l.name === 'evil')).toBe(true)
    const codegen = libraryManager.getControlCodegen()
    expect(Object.keys(codegen).sort()).toEqual([
      // 核心库 codegen/controls.cjs：各组件的样式位与创建后消息
      'button', 'captionText', 'checkable', 'comboBox', 'commandNotifyCode', 'controlMethodCall', 'datePicker', 'drawPanel', 'edit', 'eventNames',
      'groupBox', 'label', 'listBox', 'monthCal', 'mousePointerCursor', 'notifyCode', 'picBox', 'progress', 'props', 'scriptComponentProps',
      'scrollBar', 'scrollMessage', 'slider', 'windowProperties',
    ])
    expect(existsSync(marker)).toBe(false)
    expect((codegen.edit({ 输入方式: 2 }) as { style: string }).style).toContain('ES_PASSWORD')

    // 停用核心库后只剩脚本支持库自己的（脚本组件属性）
    libraryManager.setDisabledLibraries(['krnln'])
    expect(Object.keys(libraryManager.getControlCodegen())).toEqual(['scriptComponentProps'])
  })
})
