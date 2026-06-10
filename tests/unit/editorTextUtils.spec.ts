import { describe, it, expect } from 'vitest'
import {
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
