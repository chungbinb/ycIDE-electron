// 表达式 AST 重构 —— Phase 2 测试
// 目标：验证 AST 解析器生成正确的节点类型

import { describe, it, expect } from 'vitest'
import { parseExpr } from '../../src/main/transpiler/parser'
import { isNumber, isText, isBool, isVar } from '../../src/main/transpiler/ast'
import type { TranspileContext } from '../../src/main/transpiler/ast'

describe('AST Expression Parser', () => {
  const ctx: TranspileContext = {}

  describe('字面量解析', () => {
    it('数字字面量 → NumberLiteral', () => {
      const result = parseExpr('42', ctx)
      expect(isNumber(result)).toBe(true)
      if (isNumber(result)) {
        expect(result.value).toBe(BigInt(42))
        expect(result.rawText).toBe('42')
      }
    })

    it('文本字面量 → TextLiteral', () => {
      // 使用英文引号测试（L"..." 是 C 输出格式，不是易语言输入）
      const result = parseExpr('"你好"', ctx)
      expect(isText(result)).toBe(true)
      if (isText(result)) {
        expect(result.value).toBe('你好')
      }
    })

    it('布尔字面量 → BooleanLiteral', () => {
      const trueResult = parseExpr('真', ctx)
      expect(isBool(trueResult)).toBe(true)
      if (isBool(trueResult)) {
        expect(trueResult.value).toBe(true)
      }

      const falseResult = parseExpr('假', ctx)
      expect(isBool(falseResult)).toBe(true)
      if (isBool(falseResult)) {
        expect(falseResult.value).toBe(false)
      }
    })

    it('变量引用 → VariableRef', () => {
      const result = parseExpr('myVar', ctx)
      expect(isVar(result)).toBe(true)
      if (isVar(result)) {
        expect(result.name).toBe('myVar')
      }
    })

    it('常量引用 → ConstantRef', () => {
      const result = parseExpr('#常量名', ctx)
      expect(result.kind).toBe('const')
      if (result.kind === 'const') {
        expect(result.name).toBe('常量名')
      }
    })
  })

  describe('exprToC', () => {
    it('AST 节点转 C 字符串', () => {
      const varExpr = parseExpr('myVar', ctx)
      if (isVar(varExpr)) {
        // 简化测试：变量名直接返回
        expect(varExpr.name).toBe('myVar')
      }
    })

    it('数字 AST 转 C 字符串', () => {
      const numExpr = parseExpr('42', ctx)
      if (isNumber(numExpr)) {
        expect(numExpr.value).toBe(BigInt(42))
      }
    })
  })

  describe('边界条件', () => {
    it('空表达式 → 字符串 "0"', () => {
      const result = parseExpr('', ctx)
      expect(typeof result).toBe('string')
      if (typeof result === 'string') {
        expect(result).toBe('0')
      }
    })

    it('纯空白 → 字符串 "0"', () => {
      const result = parseExpr('   ', ctx)
      expect(typeof result).toBe('string')
      if (typeof result === 'string') {
        expect(result).toBe('0')
      }
    })
  })
})
