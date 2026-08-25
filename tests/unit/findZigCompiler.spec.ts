import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { findZigCompiler, setCompilerHost } from '../../src/main/compiler'

describe('findZigCompiler', () => {
  let tempDir = ''

  afterEach(() => {
    setCompilerHost({
      emitOutput: () => {},
      requestFocusIdeWindow: () => {},
      notifyProcessExit: () => {},
      openPathExternally: async () => '',
      readCompilerSettings: () => ({ zigPath: '', optimizeLevel: 'O2' }),
    })
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
    tempDir = ''
  })

  it('目录配置解析为目录下的 zig.exe，而不是把目录当可执行文件', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ycide-zig-path-'))
    const zig = join(tempDir, 'zig.exe')
    writeFileSync(zig, '')
    setCompilerHost({
      emitOutput: () => {},
      requestFocusIdeWindow: () => {},
      notifyProcessExit: () => {},
      openPathExternally: async () => '',
      readCompilerSettings: () => ({ zigPath: `${tempDir}/`, optimizeLevel: 'O2' }),
    })

    expect(findZigCompiler()).toBe(zig)
  })

  it('直接配置 zig.exe 时保留文件路径', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ycide-zig-path-'))
    const zig = join(tempDir, 'zig.exe')
    writeFileSync(zig, '')
    setCompilerHost({
      emitOutput: () => {},
      requestFocusIdeWindow: () => {},
      notifyProcessExit: () => {},
      openPathExternally: async () => '',
      readCompilerSettings: () => ({ zigPath: zig, optimizeLevel: 'O2' }),
    })

    expect(findZigCompiler()).toBe(zig)
  })
})
