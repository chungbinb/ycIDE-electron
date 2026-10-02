// AutoBuild 目录扫描的测试：验证「一个总目录 → 找出全部 .epp 项目」的规则。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { scanProjects } from '../../src/main/autoBuild'

let root = ''

/** 归一化路径分隔符，避免 Windows 反斜杠影响断言 */
const norm = (p: string): string => p.replace(/\\/g, '/')

function touch(relPath: string): void {
  const full = join(root, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, '', 'utf-8')
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ycide-scan-'))
  touch('root.epp')                          // 扫描根本身就是一个项目
  touch('test1/projA/projA.epp')             // 一层子目录里的项目
  touch('test1/projB/projB.epp')
  touch('test1/nested/projC/projC.epp')      // 更深一层
  touch('test1/node_modules/pkg/pkg.epp')    // 依赖目录：应跳过
  touch('test1/output/out.epp')              // 构建产物：应跳过
  touch('test1/temp/tmp.epp')                // 临时目录：应跳过
  touch('test1/.hidden/hid.epp')             // 隐藏目录：应跳过
})

// 清理是「尽力而为」：某些环境（安全删除 shim / 杀软占用）下删除会卡住甚至超时，
// 不能因为清理失败就把整个套件判红，因此吞掉异常并给足超时。
function safeRemove(target: string): void {
  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 2 })
  } catch {
    /* 交给系统临时目录清理 */
  }
}

afterAll(() => {
  if (root) safeRemove(root)
}, 30000)

function labels(maxDepth: number): string[] {
  return scanProjects(root, maxDepth).map(p => norm(p.label)).sort()
}

describe('scanProjects', () => {
  it('depth=0 只看传入目录本身', () => {
    expect(labels(0)).toEqual(['.'])
  })

  it('depth=1 不含下一层子目录里的项目', () => {
    expect(labels(1)).toEqual(['.'])
  })

  it('depth=2 找到一层子目录里的项目', () => {
    expect(labels(2)).toEqual(['.', 'test1/projA', 'test1/projB'])
  })

  it('depth=3 找到嵌套更深一层的项目', () => {
    expect(labels(3)).toEqual(['.', 'test1/nested/projC', 'test1/projA', 'test1/projB'])
  })

  it('默认深度足以覆盖常规的「总目录 → 子项目」结构', () => {
    expect(labels(8)).toEqual(labels(3))
  })

  it('跳过 node_modules / output / temp / 隐藏目录', () => {
    const all = scanProjects(root, 8).map(p => norm(p.dir))
    expect(all.some(d => d.includes('node_modules'))).toBe(false)
    expect(all.some(d => d.includes('/output'))).toBe(false)
    expect(all.some(d => d.includes('/temp'))).toBe(false)
    expect(all.some(d => d.includes('.hidden'))).toBe(false)
  })

  it('每个结果都带 .epp 绝对路径，且 eppPath 落在 dir 内', () => {
    for (const project of scanProjects(root, 8)) {
      expect(project.eppPath.toLowerCase().endsWith('.epp')).toBe(true)
      expect(norm(project.eppPath).startsWith(norm(project.dir))).toBe(true)
    }
  })

  it('结果顺序稳定（可复现）', () => {
    const a = scanProjects(root, 8).map(p => norm(p.label))
    const b = scanProjects(root, 8).map(p => norm(p.label))
    expect(a).toEqual(b)
  })

  it('空目录返回空清单', () => {
    const empty = mkdtempSync(join(tmpdir(), 'ycide-empty-'))
    try {
      expect(scanProjects(empty, 8)).toEqual([])
    } finally {
      safeRemove(empty)
    }
  })

  it('不存在的目录返回空清单而不抛异常', () => {
    expect(scanProjects(join(root, '__no_such_dir__'), 8)).toEqual([])
  })
})
