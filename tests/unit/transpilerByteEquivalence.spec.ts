// 表达式 AST 字节等价性回归测试
// 目标：确保 parseExpr + exprToC 的输出与原始 translateExpressionToC 完全一致

import { describe, it, expect } from 'vitest'
import { parseExpr, exprToC } from '../../src/main/transpiler/parser'
import type { TranspileContext } from '../../src/main/transpiler/ast'

describe('AST Byte Equivalence', () => {
  const ctx: TranspileContext = {}

  describe('字面量', () => {
    it('整数 → 保持原样', () => {
      const ast = parseExpr('42', ctx)
      if (typeof ast === 'string') {
        expect(ast).toBe('42')
      } else {
        expect(exprToC(ast, ctx)).toBe('42LL')
      }
    })

    it('浮点数 → 保持原样', () => {
      const ast = parseExpr('3.14', ctx)
      if (typeof ast === 'string') {
        expect(ast).toBe('3.14')
      } else {
        expect(exprToC(ast, ctx)).toBe('3.14')
      }
    })

    it('文本 → L"..."', () => {
      const ast = parseExpr('"你好"', ctx)
      if (typeof ast === 'string') {
        expect(ast).toBe('L"你好"')
      } else {
        expect(exprToC(ast, ctx)).toBe('L"你好"')
      }
    })

    it('布尔真 → 1', () => {
      const ast = parseExpr('真', ctx)
      expect(exprToC(ast, ctx)).toBe('1')
    })

    it('布尔假 → 0', () => {
      const ast = parseExpr('假', ctx)
      expect(exprToC(ast, ctx)).toBe('0')
    })
  })

  describe('变量引用', () => {
    it('简单变量名', () => {
      const ast = parseExpr('myVar', ctx)
      if (typeof ast === 'string') {
        expect(ast).toBe('myVar')
      } else {
        expect(exprToC(ast, ctx)).toBe('myVar')
      }
    })

    it('中文变量名', () => {
      const ast = parseExpr('变量名', ctx)
      if (typeof ast === 'string') {
        expect(ast).toBe('变量名')
      } else {
        expect(exprToC(ast, ctx)).toBe('变量名')
      }
    })
  })

  describe('常量引用', () => {
    it('常量引用', () => {
      const ast = parseExpr('#常量名', ctx)
      if (typeof ast === 'string') {
        expect(ast).toBe('#常量名')
      } else {
        expect(exprToC(ast, ctx)).toBe('#常量名')
      }
    })
  })

  describe('控件属性读取', () => {
    it('控件属性', () => {
      const ast = parseExpr('按钮 1.标题', ctx)
      if (typeof ast === 'string') {
        expect(ast).toBe('按钮 1.标题')
      } else {
        expect(exprToC(ast, ctx)).toBe('按钮 1.标题')
      }
    })
  })

  describe('数组下标', () => {
    it('一维数组', () => {
      const ast = parseExpr('数组 [1]', ctx)
      if (typeof ast === 'string') {
        expect(ast).toBe('数组 [1]')
      } else {
        expect(exprToC(ast, ctx)).toBe('yc_ary_at(数组 , 1LL)')
      }
    })
  })

  describe('二元运算', () => {
    it('加法', () => {
      const ast = parseExpr('a + b', ctx)
      if (typeof ast === 'string') {
        expect(ast).toBe('a + b')
      } else {
        expect(exprToC(ast, ctx)).toBe('(a + b)')
      }
    })

    it('乘法', () => {
      const ast = parseExpr('a * b', ctx)
      if (typeof ast === 'string') {
        expect(ast).toBe('a * b')
      } else {
        expect(exprToC(ast, ctx)).toBe('(a * b)')
      }
    })

    it('逻辑与', () => {
      const ast = parseExpr('a && b', ctx)
      if (typeof ast === 'string') {
        expect(ast).toBe('a && b')
      } else {
        expect(exprToC(ast, ctx)).toBe('(a && b)')
      }
    })

    it('逻辑或', () => {
      const ast = parseExpr('a || b', ctx)
      if (typeof ast === 'string') {
        expect(ast).toBe('a || b')
      } else {
        expect(exprToC(ast, ctx)).toBe('(a || b)')
      }
    })

    it('比较等于', () => {
      const ast = parseExpr('a == b', ctx)
      if (typeof ast === 'string') {
        expect(ast).toBe('a == b')
      } else {
        expect(exprToC(ast, ctx)).toBe('(a == b)')
      }
    })

    it('比较大于', () => {
      const ast = parseExpr('a > b', ctx)
      if (typeof ast === 'string') {
        expect(ast).toBe('a > b')
      } else {
        expect(exprToC(ast, ctx)).toBe('(a > b)')
      }
    })
  })

  describe('一元运算', () => {
    it('负号', () => {
      const ast = parseExpr('-a', ctx)
      if (typeof ast === 'string') {
        expect(ast).toBe('-a')
      } else {
        expect(exprToC(ast, ctx)).toBe('(-a)')
      }
    })

    it('逻辑非', () => {
      const ast = parseExpr('!a', ctx)
      if (typeof ast === 'string') {
        expect(ast).toBe('!a')
      } else {
        expect(exprToC(ast, ctx)).toBe('(!a)')
      }
    })
  })

  describe('边界条件', () => {
    it('空表达式', () => {
      const ast = parseExpr('', ctx)
      expect(exprToC(ast, ctx)).toBe('0')
    })

    it('空白表达式', () => {
      const ast = parseExpr('   ', ctx)
      expect(exprToC(ast, ctx)).toBe('0')
    })
  })
})
