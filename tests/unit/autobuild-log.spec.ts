// AutoBuild 日志（--log）测试。
//
// 关注点：日志必须是**完整记录**，而不是只剩编译消息。
// 背景：Windows 上 Electron 属 GUI 子系统，stdout 未必可见，日志是兜底手段；
// 若 banner / 项目清单 / 汇总表不进日志，这个兜底就形同虚设。
// 同时防止「print 统一落盘」改造后 emit() 里残留 appendLog 造成重复行。
import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AutoBuild, type AutoBuildRequest } from '../../src/main/autoBuild'

const workDir = mkdtempSync(join(tmpdir(), 'ycide-log-'))
/** 必然不存在的目录：run() 会在扫描前以用法错误收场，从而不会真的编译。 */
const MISSING_DIR = join(workDir, '__no_such_project_dir__')

afterAll(() => {
  try {
    rmSync(workDir, { recursive: true, force: true })
  } catch {
    // 沙箱下删除可能较慢/失败，不影响测试结论
  }
})

function makeAutoBuild(logFile: string): { instance: AutoBuild; lines: string[] } {
  const lines: string[] = []
  const request: AutoBuildRequest = {
    projectDir: MISSING_DIR,
    run: false,
    debug: false,
    encoding: 'utf8',
    json: false,
    logFile,
  }
  const instance = new AutoBuild(request, {
    appPath: process.cwd(),
    print: (line) => { lines.push(line) },
    writeRaw: (text) => { lines.push(text) },
    exitProcess: () => { /* 不真的退出 */ },
  })
  return { instance, lines }
}

describe('AutoBuild --log 完整记录', () => {
  it('banner / 警告 / 错误 / 收尾都写进日志', async () => {
    const logFile = join(workDir, 'nested', 'run.log') // 子目录不存在，顺带验证会自动创建
    const { instance } = makeAutoBuild(logFile)
    await instance.execute()

    expect(existsSync(logFile)).toBe(true)
    const log = readFileSync(logFile, 'utf-8')

    expect(log).toContain('ycIDE AutoBuild')          // banner（走 print）
    expect(log).toContain('当前处于 autobuild 模式')   // 看门狗警告（走 print）
    expect(log).toContain('[错误] 目录不存在')          // 错误消息（走 emit → print）
    expect(log).toContain('[autobuild] 结束于')        // 收尾摘要
  })

  it('错误行不重复（print 落盘后 emit 不应再写一次）', async () => {
    const logFile = join(workDir, 'dedup.log')
    const { instance } = makeAutoBuild(logFile)
    await instance.execute()

    const log = readFileSync(logFile, 'utf-8')
    const hits = log.split('\n').filter(line => line.includes('[错误] 目录不存在'))
    expect(hits.length).toBe(1)
  })

  it('日志行与终端输出一致（同一份内容两个去处）', async () => {
    const logFile = join(workDir, 'same.log')
    const { instance, lines } = makeAutoBuild(logFile)
    await instance.execute()

    const logLines = readFileSync(logFile, 'utf-8').split('\n')
    // 终端打印过的每一行（非空）都应当能在日志里找到
    for (const line of lines) {
      if (!line.trim()) continue
      expect(logLines).toContain(line)
    }
  })
})
