// 【多音字补全匹配】旧实现逐字只取「常用音」（pinyin(ch)[0]），多音字只认一个读法：
// `#换行符` 的「行」常用音是 xíng → 只有 hxf 能搜到；可这个词里「行」实际读 háng，
// 用户敲正确读法 hhf 反而搜不到（用户实际反馈）。
//
// 扫描 925 个中文名（命令/常量/控件成员）后确认：**18 个名字的首字母算错**，元凶是
// 行(xíng/háng)、重(zhòng/chóng)、奇(qí/jī)、调(tiáo/diào)。
// 修法：取全部读音，**任一读音命中即算命中**——补全匹配要的是宽容，两种读法都该搜得到。
import { describe, it, expect } from 'vitest'
import { matchCommand, matchScore } from '@/utils/pinyin'

/** 两种读法都要能搜到，且分数一致（不该因为选了哪个读音而排序不同） */
function bothMatch(name: string, a: string, b: string) {
  expect(matchCommand(a, name, ''), `${a} 应匹配「${name}」`).toBe(true)
  expect(matchCommand(b, name, ''), `${b} 应匹配「${name}」`).toBe(true)
  expect(matchScore(a, name, ''), `${a}/${b} 对「${name}」应同分`).toBe(matchScore(b, name, ''))
}

describe('多音字补全匹配', () => {
  it('用户反馈：#换行符 的「行」读 háng，hhf 必须能搜到（此前只认 hxf）', () => {
    bothMatch('换行符', 'hxf', 'hhf')
    // 全拼两种读法也都要中
    expect(matchCommand('huanhang', '换行符', '')).toBe(true)
    expect(matchCommand('huanxing', '换行符', '')).toBe(true)
  })

  it('行 xíng/háng —— 扫描出的全部受影响名字', () => {
    bothMatch('插入文本行', 'crwbx', 'crwbh')
    bothMatch('插入行', 'crx', 'crh')
    bothMatch('读入一行', 'dryx', 'dryh')
    bothMatch('加入行', 'jrx', 'jrh')
    bothMatch('取行高', 'qxg', 'qhg')
    bothMatch('写文本行', 'xwbx', 'xwbh')
    bothMatch('置行高', 'zxg', 'zhg')
    bothMatch('是否允许多行', 'sfyxdx', 'sfyxdh')
    bothMatch('允许多行表头', 'yxdxbt', 'yxdhbt')
  })

  it('重 zhòng/chóng', () => {
    bothMatch('重试钮', 'zsn', 'csn')
    bothMatch('重试取消钮', 'zsqxn', 'csqxn')
    bothMatch('放弃重试忽略钮', 'fqzshln', 'fqcshln')
    bothMatch('取重复文本', 'qzfwb', 'qcfwb')
    bothMatch('取重复字节集', 'qzfzjj', 'qcfzjj')
    bothMatch('重新查询', 'zxcx', 'cxcx')
  })

  it('奇 qí/jī、调 tiáo/diào', () => {
    bothMatch('仅打印奇数页', 'jdyqsy', 'jdyjsy')
    bothMatch('DLL命令调用转向', 'DLLmltyzx'.toLowerCase(), 'DLLmldyzx'.toLowerCase())
  })

  it('不误伤：单音字命令照旧，无关输入仍不匹配', () => {
    expect(matchCommand('ts', '调试输出', '')).toBe(true)
    expect(matchCommand('tiao', '调试输出', '')).toBe(true)
    expect(matchCommand('调s', '调试输出', '')).toBe(true)
    expect(matchCommand('xyz', '调试输出', '')).toBe(false)
    expect(matchScore('xyz', '调试输出', '')).toBe(0)
    // 多音字放开后也不能变成「什么都匹配」：换行符 没有 x 开头的字
    expect(matchCommand('xxx', '换行符', '')).toBe(false)
  })

  it('中文精确/前缀匹配仍优先于拼音', () => {
    expect(matchScore('换行符', '换行符', '')).toBeGreaterThan(matchScore('hhf', '换行符', ''))
    expect(matchScore('调试', '调试输出', '')).toBeGreaterThan(matchScore('ts', '调试输出', ''))
  })
})
