import { describe, it, expect } from 'vitest'
import { computeUnusedSubNames } from '../../src/renderer/src/components/Sidebar/unusedSubUtils'

describe('computeUnusedSubNames', () => {
  it('未被任何代码引用的子程序被标记', () => {
    const src = [
      '.子程序 求和, 整数型',
      '.参数 a, 整数型',
      '返回 (a)',
      '',
      '.子程序 孤儿子程序',
      '信息框 ("hi", 0, )',
    ].join('\n')
    const unused = computeUnusedSubNames([src])
    expect(unused.has('孤儿子程序')).toBe(true)
    expect(unused.has('求和')).toBe(true) // 求和也没人调用
  })

  it('被调用即不标记（含跨文件调用与无括号语句调用）', () => {
    const a = ['.子程序 求和, 整数型', '返回 (0)'].join('\n')
    const b = ['.子程序 _按钮1_被单击', '变量 ＝ 求和 ()'].join('\n')
    const unused = computeUnusedSubNames([a, b])
    expect(unused.has('求和')).toBe(false)
  })

  it('_ 开头的事件处理/入口子程序不参与判定', () => {
    const src = ['.子程序 _按钮1_被单击', '.子程序 _启动子程序'].join('\n')
    const unused = computeUnusedSubNames([src])
    expect(unused.size).toBe(0)
  })

  it('分词判定：求和2 的出现不算 求和 被使用', () => {
    const src = [
      '.子程序 求和, 整数型',
      '.子程序 求和2, 整数型',
      '.子程序 _启动子程序',
      '变量 ＝ 求和2 ()',
    ].join('\n')
    const unused = computeUnusedSubNames([src])
    expect(unused.has('求和')).toBe(true)
    expect(unused.has('求和2')).toBe(false)
  })

  it('类方法 对象.方法名 调用可识别', () => {
    const cls = ['.程序集 类1', '.子程序 计算, 整数型, 公开', '返回 (1)'].join('\n')
    const main = ['.子程序 _启动子程序', '结果 ＝ 对象1.计算 ()'].join('\n')
    const unused = computeUnusedSubNames([cls, main])
    expect(unused.has('计算')).toBe(false)
  })

  it('声明行本身不算调用；递归调用自己算已使用', () => {
    const src = [
      '.子程序 递归, 整数型',
      '返回 (递归 ())',
      '.子程序 只声明',
    ].join('\n')
    const unused = computeUnusedSubNames([src])
    expect(unused.has('递归')).toBe(false)
    expect(unused.has('只声明')).toBe(true)
  })

  it('子程序指针作为参数传递算已使用', () => {
    const src = [
      '.子程序 回调函数',
      '.子程序 _启动子程序',
      '注册回调 (&回调函数)',
    ].join('\n')
    const unused = computeUnusedSubNames([src])
    expect(unused.has('回调函数')).toBe(false)
  })

  it('CRLF 行尾正常解析', () => {
    const src = '.子程序 求和, 整数型\r\n.子程序 _启动子程序\r\n变量 ＝ 求和 ()\r\n'
    const unused = computeUnusedSubNames([src])
    expect(unused.has('求和')).toBe(false)
  })
})
