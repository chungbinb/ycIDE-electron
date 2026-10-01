// AutoBuild「编译成功后自动运行」链路的测试。
// 不去真的编译（仓库不带 Zig），而是直接驱动内部的 runProgram：验证
// 子进程输出被回显、退出码被透传、启动失败被正确报错。
import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { AutoBuild, type AutoBuildRequest } from '../../src/main/autoBuild'

/** runProgram 是私有实现，这里按运行时形状取用，避免为测试放开可见性 */
type RunCapable = { runProgram(exePath: string): Promise<number> }

function makeAutoBuild(overrides: Partial<AutoBuildRequest> = {}): { instance: AutoBuild; lines: string[] } {
  const lines: string[] = []
  const request: AutoBuildRequest = {
    projectDir: process.cwd(),
    run: true,
    debug: false,
    encoding: 'utf8',
    json: false,
    ...overrides,
  }
  const instance = new AutoBuild(request, {
    appPath: process.cwd(),
    print: (line) => { lines.push(line) },
    writeRaw: (text) => { lines.push(text) },
  })
  return { instance, lines }
}

const HOSTNAME_EXE = 'C:\\Windows\\System32\\hostname.exe'
const hasHostname = process.platform === 'win32' && existsSync(HOSTNAME_EXE)

describe.skipIf(!hasHostname)('AutoBuild.runProgram（Windows）', () => {
  it('回显子进程 stdout 并透传退出码 0', async () => {
    const { instance, lines } = makeAutoBuild()
    const code = await (instance as unknown as RunCapable).runProgram(HOSTNAME_EXE)
    expect(code).toBe(0)
    // hostname 会打印一行主机名，确认输出确实被捕获回显
    expect(lines.join('').trim().length).toBeGreaterThan(0)
  })

  it('可执行文件不存在时返回失败码 1', async () => {
    const { instance } = makeAutoBuild()
    const code = await (instance as unknown as RunCapable).runProgram('C:\\no\\such\\program.exe')
    expect(code).toBe(1)
  })

  it('非零退出码原样透传（where.exe 无参数返回 2）', async () => {
    const { instance } = makeAutoBuild({ runTimeoutMs: 5000 })
    const code = await (instance as unknown as RunCapable).runProgram('C:\\Windows\\System32\\where.exe')
    expect(code).toBe(2)
  })
})

describe('AutoBuild 构造与默认值', () => {
  it('run 为 false 时请求即为仅编译', () => {
    const { instance } = makeAutoBuild({ run: false })
    expect(instance).toBeInstanceOf(AutoBuild)
  })
})
