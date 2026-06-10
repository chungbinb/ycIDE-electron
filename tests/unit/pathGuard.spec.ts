import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join, sep } from 'path'
import {
  initPathGuard,
  authorizeRoot,
  isPathAuthorized,
  validatePath,
  resetPathGuardForTest,
} from '../../src/main/security/pathGuard'

const isWindows = process.platform === 'win32'

describe('pathGuard', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pathguard-'))
    resetPathGuardForTest()
  })

  afterEach(() => {
    resetPathGuardForTest()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('静态根内的路径通过校验并返回规范化路径', () => {
    initPathGuard([tempDir])
    const target = join(tempDir, 'project', 'main.eyc')
    expect(validatePath(target)).toBe(target)
    expect(isPathAuthorized(tempDir)).toBe(true)
  })

  it('拒绝 .. 路径穿越', () => {
    const root = join(tempDir, 'projects')
    initPathGuard([root])
    expect(() => validatePath(join(root, '..', 'secrets.txt'))).toThrow('路径不在已授权目录内')
    expect(isPathAuthorized(join(root, '..', '..'))).toBe(false)
  })

  it('拒绝前缀相似但不同的目录（projects vs projects-evil）', () => {
    const root = join(tempDir, 'projects')
    initPathGuard([root])
    expect(isPathAuthorized(root + '-evil' + sep + 'a.txt')).toBe(false)
  })

  it('拒绝空路径与 NUL 字符', () => {
    initPathGuard([tempDir])
    expect(() => validatePath('')).toThrow('无效的文件路径')
    expect(() => validatePath(join(tempDir, 'a\0b'))).toThrow('无效的文件路径')
  })

  it('未授权的盘符/根目录被拒绝', () => {
    initPathGuard([join(tempDir, 'projects')])
    const outside = isWindows ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/passwd'
    expect(isPathAuthorized(outside)).toBe(false)
  })

  if (isWindows) {
    it('Windows 下路径比较不区分大小写', () => {
      const root = join(tempDir, 'Projects')
      initPathGuard([root])
      expect(isPathAuthorized(join(tempDir, 'PROJECTS', 'a.txt'))).toBe(true)
    })
  }

  it('动态授权目录后路径可通过，文件模式授权父目录', () => {
    initPathGuard([])
    const picked = join(tempDir, 'workspace')
    expect(isPathAuthorized(join(picked, 'a.eyc'))).toBe(false)
    authorizeRoot(picked)
    expect(isPathAuthorized(join(picked, 'a.eyc'))).toBe(true)

    const pickedFile = join(tempDir, 'other', 'demo.epp')
    authorizeRoot(pickedFile, 'file')
    expect(isPathAuthorized(join(tempDir, 'other', 'demo.eyc'))).toBe(true)
  })

  it('动态根持久化并在重新初始化后恢复', () => {
    const persistFile = join(tempDir, 'authorized-roots.json')
    initPathGuard([], persistFile)
    const picked = join(tempDir, 'workspace')
    authorizeRoot(picked)
    expect(existsSync(persistFile)).toBe(true)
    expect(JSON.parse(readFileSync(persistFile, 'utf-8'))).toContain(picked)

    // 模拟应用重启
    resetPathGuardForTest()
    initPathGuard([], persistFile)
    expect(isPathAuthorized(join(picked, 'a.eyc'))).toBe(true)
  })

  it('持久化文件损坏时静默回退为空列表', () => {
    const persistFile = join(tempDir, 'authorized-roots.json')
    initPathGuard([], persistFile)
    authorizeRoot(join(tempDir, 'w1'))
    resetPathGuardForTest()
    // 写入损坏内容
    writeFileSync(persistFile, '{not json', 'utf-8')
    initPathGuard([], persistFile)
    expect(isPathAuthorized(join(tempDir, 'w1', 'a.txt'))).toBe(false)
  })
})
