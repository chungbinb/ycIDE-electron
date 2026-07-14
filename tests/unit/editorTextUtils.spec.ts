import { formatOps } from '@/components/Editor/editorCoreUtils'
import { describe, it, expect } from 'vitest'
import {
  balanceArgParens,
  insertCallArgAfter,
  removeCallArgs,
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

  it('空值写入尚不存在的尾参：原样返回（不追加空尾参）', () => {
    // 展开参数行连续回车走到空的可选尾参再回车/失焦时，不应凭空多出一个空实参
    expect(replaceCallArg('信息框 ("你好", 0, "标题")', 3, '')).toBe('信息框 ("你好", 0, "标题")')
    expect(replaceCallArg('信息框 ()', 2, '')).toBe('信息框 ()')
    // 尾参写入非空值仍照常补齐分隔符
    expect(replaceCallArg('信息框 ("你好", 0, "标题")', 3, '父窗口')).toBe('信息框 ("你好", 0, "标题",父窗口)')
  })

  it('无括号时原样返回', () => {
    expect(replaceCallArg('返回', 0, 'x')).toBe('返回')
  })
})

describe('insertCallArgAfter（展开参数行「新增当前层级参数行」）', () => {
  it('在指定参数之后插入空槽（半/全角分隔符跟随括号）', () => {
    expect(insertCallArgAfter('调试输出(a)', 0, '')).toBe('调试输出(a,)')
    expect(insertCallArgAfter('调试输出（a）', 0, '')).toBe('调试输出（a，）')
  })

  it('中间插入：不动其后已有参数', () => {
    expect(insertCallArgAfter('调试输出(a,b,c)', 0, 'x')).toBe('调试输出(a,x,b,c)')
    expect(insertCallArgAfter('调试输出(a,b,c)', 1, 'x')).toBe('调试输出(a,b,x,c)')
  })

  it('空调用：首个插入直接落进括号内、不加前导分隔符', () => {
    expect(insertCallArgAfter('调试输出()', 0, '')).toBe('调试输出()')
    expect(insertCallArgAfter('调试输出()', 0, 'v')).toBe('调试输出(v)')
  })

  it('越界索引：追加到末参之后', () => {
    expect(insertCallArgAfter('调试输出(a)', 5, 'z')).toBe('调试输出(a,z)')
  })

  it('嵌套调用内的逗号不误当参数边界', () => {
    expect(insertCallArgAfter('调试输出(到文本(1,2))', 0, 'x')).toBe('调试输出(到文本(1,2),x)')
  })

  it('无括号时原样返回', () => {
    expect(insertCallArgAfter('返回', 0, 'x')).toBe('返回')
  })

  // 回归：逐值一行（replaceCallArg 写回本槽 + insertCallArgAfter 追加空槽）不产生尾部级联重复。
  // 旧 bug：在单个展开参数行里连打多个逗号值，replaceCallArg 反复把含逗号的整串写回单槽，
  // 重解析后尾部旧实参残留，行括号内堆出大量重复参数（用户报告的「多出不少重复的参数」）。
  it('回归：逐值追加不出现重复参数（模拟 appendRepeatParamRow）', () => {
    let line = '调试输出()'
    // 逐个值：写回当前槽 → 其后插入空槽 → 焦点到新槽
    let argIdx = 0
    for (const val of ['1', '变量', 'bian1']) {
      line = replaceCallArg(line, argIdx, val)
      line = insertCallArgAfter(line, argIdx, '')
      argIdx += 1
    }
    // 三个值各一槽 + 末尾一个待输入空槽，无任何重复
    expect(parseCallArgs(line)).toEqual(['1', '变量', 'bian1', ''])
    expect(line).toBe('调试输出(1,变量,bian1,)')
  })
})

describe('removeCallArgs（展开参数行多选删除）', () => {
  it('删除中间参数：其余按分隔符重连', () => {
    expect(removeCallArgs('调试输出(a,b,c)', [1])).toBe('调试输出(a,c)')
    expect(removeCallArgs('调试输出(a,b,c,d)', [1, 2])).toBe('调试输出(a,d)')
  })

  it('删首/删尾', () => {
    expect(removeCallArgs('调试输出(a,b,c)', [0])).toBe('调试输出(b,c)')
    expect(removeCallArgs('调试输出(a,b,c)', [2])).toBe('调试输出(a,b)')
  })

  it('删光所有参数 → 留空括号', () => {
    expect(removeCallArgs('调试输出(a,b,c)', [0, 1, 2])).toBe('调试输出()')
  })

  it('全角括号用全角分隔符重连', () => {
    expect(removeCallArgs('调试输出（a，b，c）', [1])).toBe('调试输出（a，c）')
  })

  it('嵌套调用内的逗号不误当边界', () => {
    expect(removeCallArgs('调试输出(到文本(1,2),b)', [1])).toBe('调试输出(到文本(1,2))')
    expect(removeCallArgs('调试输出(到文本(1,2),b)', [0])).toBe('调试输出(b)')
  })

  it('越界/空下标忽略；无括号原样返回', () => {
    expect(removeCallArgs('调试输出(a,b)', [5])).toBe('调试输出(a,b)')
    expect(removeCallArgs('调试输出(a,b)', [])).toBe('调试输出(a,b)')
    expect(removeCallArgs('返回', [0])).toBe('返回')
  })

  // 回归：清理旧 bug 堆出的重复参数（用户实测场景）
  it('回归：从一堆重复参数里多选删除', () => {
    const line = '调试输出(1,变量,变量,bianl,bian,bia,bi,b)'
    expect(removeCallArgs(line, [2, 3, 4, 5, 6, 7])).toBe('调试输出(1,变量)')
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

describe('数组字面量 { } 的参数切分与配平', () => {
  it('parseCallArgs：{ 1, 2, 3 } 是一个参数（花括号内逗号不切）', () => {
    expect(parseCallArgs('调试输出 ({ 1, 2, 3 })')).toEqual(['{ 1, 2, 3 }'])
    expect(parseCallArgs('调试输出 ({ 1, 2 }, 甲)')).toEqual(['{ 1, 2 }', '甲'])
  })

  it('replaceCallArg：替换含字面量的参数不撕裂', () => {
    expect(replaceCallArg('调试输出 ({ 1, 2, 3 }, 甲)', 1, '乙')).toBe('调试输出 ({ 1, 2, 3 },乙)')
    expect(replaceCallArg('调试输出 ({ 1, 2, 3 })', 0, '{ 4, 5 }')).toBe('调试输出 ({ 4, 5 })')
  })

  it('isArgParensBalanced/balanceArgParens：花括号计配平', () => {
    expect(isArgParensBalanced('{ 1, 2 }')).toBe(true)
    expect(isArgParensBalanced('{ 1')).toBe(false)
    expect(balanceArgParens('{ 1, 2')).toBe('{ 1, 2}')
  })
})

describe('formatOps 数组字面量间距（照易语言）', () => {
  it('赋值右值：{“文本1”,“文本2”} → { “文本1”, “文本2” }', () => {
    expect(formatOps('变量 = {“文本1”,“文本2”}')).toBe('变量 ＝ { “文本1”, “文本2” }')
    expect(formatOps('变量2={1,2}')).toBe('变量2 ＝ { 1, 2 }')
  })

  it('字符串内的花括号与逗号不受影响', () => {
    expect(formatOps('变量 = “a{1,2}b”')).toBe('变量 ＝ “a{1,2}b”')
  })

  it('参数区逗号统一为逗号+空格', () => {
    expect(formatOps('1,2, 3 ,4')).toBe('1, 2, 3, 4')
  })
})
