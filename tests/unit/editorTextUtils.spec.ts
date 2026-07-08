import { describe, it, expect } from 'vitest'
import {
  balanceArgParens,
  isArgParensBalanced,
  parseAssignmentDetail,
  parseAssignmentLineParts,
  isQuotedTextLiteral,
  parseCallArgs,
  replaceCallArg,
} from '@/components/Editor/editorTextUtils'

describe('parseAssignmentDetail', () => {
  it('解析普通赋值', () => {
    expect(parseAssignmentDetail('计数 = 1 + 2')).toEqual({ target: '计数', value: '1 + 2' })
  })

  it('支持全角等号', () => {
    expect(parseAssignmentDetail('结果 ＝ 取整(3.5)')).toEqual({ target: '结果', value: '取整(3.5)' })
  })

  it('支持成员访问目标', () => {
    expect(parseAssignmentDetail('窗口1.标题 = "你好"')).toEqual({ target: '窗口1.标题', value: '"你好"' })
  })

  it('声明行（以点开头）返回 null', () => {
    expect(parseAssignmentDetail('.局部变量 计数, 整数型')).toBeNull()
  })

  it('空行与非赋值行返回 null', () => {
    expect(parseAssignmentDetail('')).toBeNull()
    expect(parseAssignmentDetail('输出调试文本 ("ok")')).toBeNull()
  })
})

describe('parseAssignmentLineParts', () => {
  it('保留缩进并拆出左右两侧', () => {
    expect(parseAssignmentLineParts('    计数 = 1')).toEqual({ indent: '    ', lhs: '计数', rhs: '1' })
  })

  it('右侧可以为空（编辑中状态）', () => {
    expect(parseAssignmentLineParts('计数 = ')).toEqual({ indent: '', lhs: '计数', rhs: '' })
  })
})

describe('isQuotedTextLiteral', () => {
  it('识别半角与全角引号字面量', () => {
    expect(isQuotedTextLiteral('"你好"')).toBe(true)
    expect(isQuotedTextLiteral('“你好”')).toBe(true)
  })

  it('非字面量返回 false', () => {
    expect(isQuotedTextLiteral('你好')).toBe(false)
    expect(isQuotedTextLiteral('')).toBe(false)
  })
})

describe('parseCallArgs', () => {
  it('解析普通调用参数', () => {
    expect(parseCallArgs('信息框 ("提示", 0, "标题")')).toEqual(['"提示"', '0', '"标题"'])
  })

  it('支持全角括号与全角逗号', () => {
    expect(parseCallArgs('信息框 （"提示"，0）')).toEqual(['"提示"', '0'])
  })

  it('嵌套调用不拆分内层逗号', () => {
    expect(parseCallArgs('外层 (内层(1, 2), 3)')).toEqual(['内层(1, 2)', '3'])
  })

  it('字符串中的逗号不拆分', () => {
    expect(parseCallArgs('输出 ("a,b", 1)')).toEqual(['"a,b"', '1'])
  })

  it('无括号返回空数组', () => {
    expect(parseCallArgs('返回')).toEqual([])
  })
})

describe('replaceCallArg', () => {
  it('替换已有参数（替换范围含分隔符后的空格）', () => {
    expect(replaceCallArg('信息框 ("提示", 0)', 1, '1')).toBe('信息框 ("提示",1)')
    expect(replaceCallArg('信息框 ("提示", 0)', 0, '"新提示"')).toBe('信息框 ("新提示", 0)')
  })

  it('索引超出时补齐分隔符', () => {
    expect(replaceCallArg('信息框 ("提示")', 2, '"标题"')).toBe('信息框 ("提示",,"标题")')
  })

  it('无括号时原样返回', () => {
    expect(replaceCallArg('返回', 0, 'x')).toBe('返回')
  })
})

describe('isArgParensBalanced（展开参数实时写回守卫）', () => {
  it('配平的值', () => {
    expect(isArgParensBalanced('到字节集()')).toBe(true)
    expect(isArgParensBalanced('到字节集 (1, 2)')).toBe(true)
    expect(isArgParensBalanced('到字节集（“a”）')).toBe(true)
    expect(isArgParensBalanced('1.txt')).toBe(true)
    expect(isArgParensBalanced('')).toBe(true)
  })

  it('未配平：开括号多（正敲「到字节集(」的中间态）', () => {
    expect(isArgParensBalanced('到字节集(')).toBe(false)
    expect(isArgParensBalanced('到字节集（')).toBe(false)
    expect(isArgParensBalanced('取文本长度(取文本(')).toBe(false)
  })

  it('未配平：右括号多 / 引号未闭合', () => {
    expect(isArgParensBalanced('到字节集)')).toBe(false)
    expect(isArgParensBalanced('“未闭合')).toBe(false)
  })

  it('字符串字面量里的括号不计', () => {
    expect(isArgParensBalanced('“文本(”')).toBe(true)
    expect(isArgParensBalanced('"(("')).toBe(true)
  })
})

describe('balanceArgParens（提交时补齐右括号/引号）', () => {
  it('补齐缺失的右括号（按半/全角匹配）', () => {
    expect(balanceArgParens('到字节集(')).toBe('到字节集()')
    expect(balanceArgParens('到字节集（')).toBe('到字节集（）')
    expect(balanceArgParens('取文本长度(取文本(')).toBe('取文本长度(取文本())')
  })

  it('补齐未闭合引号', () => {
    expect(balanceArgParens('“未闭合')).toBe('“未闭合”')
    expect(balanceArgParens('"abc')).toBe('"abc"')
  })

  it('已配平/深度为负时原样返回', () => {
    expect(balanceArgParens('到字节集()')).toBe('到字节集()')
    expect(balanceArgParens('到字节集)')).toBe('到字节集)')
  })

  it('字符串字面量里的括号不参与补齐', () => {
    expect(balanceArgParens('“(”')).toBe('“(”')
  })
})

describe('回归：未配平参数值实时写回导致重复追加（写到文件+到字节集 级联损坏）', () => {
  it('未配平值一旦写回，下一次 replaceCallArg 会走追加分支产生重复（旧 bug 机制验证）', () => {
    // 旧行为链：val=「到字节集(」写回 → 外层右括号被吞 → 再写回时找不到参数边界 → 追加重复
    const broken = replaceCallArg('写到文件 (1.txt,到字节集)', 1, '到字节集(')
    expect(broken).toBe('写到文件 (1.txt,到字节集()') // 外层调用失去闭括号
    const cascade = replaceCallArg(broken, 1, '到字节集()')
    expect(cascade).toContain(',到字节集(),') // 追加而非替换 → 重复组出现（即截图现象）
  })

  it('新守卫链路：中间态不写回、提交时补平后写回，行保持正确', () => {
    // liveUpdate 被 isArgParensBalanced 挡住 → 行保持「到字节集」；提交时 balanceArgParens 补平
    expect(isArgParensBalanced('到字节集(')).toBe(false) // 中间态不写回
    const committed = replaceCallArg('写到文件 (1.txt,到字节集)', 1, balanceArgParens('到字节集('))
    expect(committed).toBe('写到文件 (1.txt,到字节集())')
    expect(parseCallArgs(committed)).toEqual(['1.txt', '到字节集()'])
  })
})
