// AutoBuild 命令行参数解析的单元测试。
// 只覆盖纯解析逻辑（不触发真实编译），保证 CLI 契约稳定、不误吞正常启动参数。
import { describe, it, expect } from 'vitest'
import { normalize, resolve } from 'path'
import { AutoBuild, defaultUserDataPath } from '../../src/main/autoBuild'

/** 路径断言：比较归一化后的绝对路径，避免 '/' 与 '\' 的写法差异造成误报 */
function expectPath(actual: string | undefined, expected = 'D:/proj'): void {
  expect(actual ? normalize(actual) : actual).toBe(normalize(resolve(expected)))
}

describe('AutoBuild.parse', () => {
  it('识别 build 命令并解析项目路径', () => {
    const parsed = AutoBuild.parse(['build', 'D:/proj'])
    expect(parsed.error).toBeNull()
    expectPath(parsed.request?.projectDir)
    expect(parsed.request?.run).toBe(false)
  })

  it('autobuild 命令 + --run 打开自动运行', () => {
    const parsed = AutoBuild.parse(['autobuild', 'D:/proj', '--run'])
    expect(parsed.request?.run).toBe(true)
    expectPath(parsed.request?.projectDir)
  })

  it('动作词 run 也等价于 --run', () => {
    const parsed = AutoBuild.parse(['build', 'run', 'D:/proj'])
    expect(parsed.request?.run).toBe(true)
    expectPath(parsed.request?.projectDir)
  })

  it('--debug 只影响编译方式，不隐含运行', () => {
    const parsed = AutoBuild.parse(['build', 'D:/proj', '--debug'])
    expect(parsed.request?.debug).toBe(true)
    expect(parsed.request?.run).toBe(false)
  })

  it('动作词 debug 等价于 --debug 并隐含运行', () => {
    const parsed = AutoBuild.parse(['build', 'debug', 'D:/proj'])
    expect(parsed.request?.debug).toBe(true)
    expect(parsed.request?.run).toBe(true)
  })

  it('解析 --arch / --run-timeout / --encoding / --json / --log', () => {
    const parsed = AutoBuild.parse([
      'build', 'D:/proj',
      '--arch', 'x64',
      '--run-timeout', '3000',
      '--encoding', 'gbk',
      '--json',
      '--log', 'D:/out.log',
    ])
    expect(parsed.request?.arch).toBe('x64')
    expect(parsed.request?.runTimeoutMs).toBe(3000)
    expect(parsed.request?.encoding).toBe('gbk')
    expect(parsed.request?.json).toBe(true)
    expect(parsed.request?.logFile).toBe('D:/out.log')
  })

  it('--project / -p 显式指定项目路径', () => {
    expectPath(AutoBuild.parse(['build', '--project', 'D:/proj']).request?.projectDir)
    expectPath(AutoBuild.parse(['build', '-p', 'D:/proj']).request?.projectDir)
  })

  it('缺少目录路径时报错', () => {
    const parsed = AutoBuild.parse(['build'])
    expect(parsed.request).toBeNull()
    expect(parsed.error).toMatch(/缺少目录路径/)
  })

  it('多个目录路径时报错', () => {
    const parsed = AutoBuild.parse(['build', 'D:/a', 'D:/b'])
    expect(parsed.request).toBeNull()
    expect(parsed.error).toMatch(/只能指定一个目录/)
  })

  it('解析批量扫描相关开关 --depth / --list / --fail-fast', () => {
    const parsed = AutoBuild.parse(['build', 'D:/root', '--depth', '3', '--fail-fast'])
    expect(parsed.request?.maxDepth).toBe(3)
    expect(parsed.request?.failFast).toBe(true)
    expect(parsed.request?.listOnly).toBe(false)

    expect(AutoBuild.parse(['build', 'D:/root', '--list']).request?.listOnly).toBe(true)
    expect(AutoBuild.parse(['build', 'D:/root', '--dry-run']).request?.listOnly).toBe(true)
  })

  it('--depth 非数字时报错', () => {
    expect(AutoBuild.parse(['build', 'D:/root', '--depth', '-1']).error).toMatch(/--depth/)
    expect(AutoBuild.parse(['build', 'D:/root', '--depth', 'abc']).error).toMatch(/--depth/)
  })

  it('未知参数报错', () => {
    const parsed = AutoBuild.parse(['build', 'D:/proj', '--nope'])
    expect(parsed.request).toBeNull()
    expect(parsed.error).toMatch(/未知参数/)
  })

  it('--arch 缺少取值时报错', () => {
    expect(AutoBuild.parse(['build', 'D:/proj', '--arch']).error).toMatch(/--arch/)
  })

  it('--run-timeout 非数字时报错', () => {
    expect(AutoBuild.parse(['build', 'D:/proj', '--run-timeout', 'abc']).error).toMatch(/--run-timeout/)
  })

  it('--help 请求帮助', () => {
    expect(AutoBuild.parse(['--help']).help).toBe(true)
    expect(AutoBuild.parse(['build', '-h']).help).toBe(true)
  })

  it('无命令词时不算 CLI 调用（应继续正常 GUI 启动）', () => {
    const parsed = AutoBuild.parse(['--inspect=5858', 'some-file.eyc'])
    expect(parsed.request).toBeNull()
    expect(parsed.error).toBeNull()
    expect(parsed.help).toBe(false)
  })

  it('isInvocation 与 parse 保持一致', () => {
    expect(AutoBuild.isInvocation(['build', 'D:/proj'])).toBe(true)
    expect(AutoBuild.isInvocation(['--autobuild', 'D:/proj'])).toBe(true)
    expect(AutoBuild.isInvocation(['--some-flag'])).toBe(false)
  })
})

describe('AutoBuild.detectFromElectronArgv', () => {
  it('命中显式开关时返回请求（可忽略 Electron 自身参数）', () => {
    const parsed = AutoBuild.detectFromElectronArgv(['C:/ycIDE/ycIDE.exe', '--autobuild', 'D:/proj', '--run'])
    expectPath(parsed?.request?.projectDir)
    expect(parsed?.request?.run).toBe(true)
  })

  it('--ycide-build 也是显式开关', () => {
    const parsed = AutoBuild.detectFromElectronArgv(['ycIDE.exe', '--ycide-build', 'D:/proj'])
    expect(parsed?.request).not.toBeNull()
    expectPath(parsed?.request?.projectDir)
  })

  it('普通启动参数不触发 CLI 模式', () => {
    expect(AutoBuild.detectFromElectronArgv(['ycIDE.exe'])).toBeNull()
    expect(AutoBuild.detectFromElectronArgv(['electron', '.'])).toBeNull()
    // --build 只在独立 CLI 里作为命令词，不作为 Electron 的触发开关（避免误吞系统参数）
    expect(AutoBuild.detectFromElectronArgv(['ycIDE.exe', '--build', 'D:/proj'])).toBeNull()
  })
})

describe('defaultUserDataPath', () => {
  it('按平台约定推导出以应用名结尾的目录', () => {
    expect(defaultUserDataPath('ycIDE').endsWith('ycIDE')).toBe(true)
  })
})
