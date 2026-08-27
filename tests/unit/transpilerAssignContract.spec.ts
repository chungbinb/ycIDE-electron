// 赋值语句 AST 契约测试 —— 守护现有 compiler.ts 赋值逻辑的行为不变
//
// 本测试文件验证：
// 1. assignAst.parseAssignStmt() 能正确解析常见赋值模式
// 2. assignAst.emitAssignStmt() 生成的代码与预期一致
// 3. 与 compiler.ts 现有行为的兼容性

import { describe, it, expect } from 'vitest'
import { parseAssignStmt, emitAssignStmt } from '../../src/main/transpiler/assignAst'
import type { TranspileContext } from '../../src/main/transpiler/ast'

const ctx: TranspileContext = {}

describe('assignAst Contract Tests', () => {
  describe('解析兼容性', () => {
    it('简单变量赋值 a = 1', () => {
      const stmt = parseAssignStmt('a = 1', 1, ctx)
      expect(stmt).not.toBeNull()
      expect(stmt?.kind).toBe('assign')
    })

    it('中文变量赋值 结果 = 42', () => {
      const stmt = parseAssignStmt('结果 = 42', 2, ctx)
      expect(stmt).not.toBeNull()
      expect(stmt?.kind).toBe('assign')
    })

    it('文本赋值 a = hello', () => {
      const stmt = parseAssignStmt('a = hello', 3, ctx)
      expect(stmt).not.toBeNull()
      expect(stmt?.kind).toBe('assign')
    })

    it('表达式赋值 a = b + c', () => {
      const stmt = parseAssignStmt('a = b + c', 4, ctx)
      expect(stmt).not.toBeNull()
      expect(stmt?.kind).toBe('assign')
    })
  })

  describe('发射兼容性', () => {
    it('简单变量发射生成有效 C++', () => {
      const stmt = parseAssignStmt('x = 1', 1, ctx)
      expect(stmt).not.toBeNull()
      const out = emitAssignStmt(stmt!, ctx)
      expect(out).toContain('=')
      expect(out).toContain(';')
    })

    it('文本赋值发射生成有效 C++', () => {
      const stmt = parseAssignStmt('text = hello', 2, ctx)
      expect(stmt).not.toBeNull()
      const out = emitAssignStmt(stmt!, ctx)
      expect(out).toContain('text')
      expect(out).toContain('hello')
    })
  })

  describe('边界情况', () => {
    it('非赋值行返回 null', () => {
      expect(parseAssignStmt('返回 ()', 1, ctx)).toBeNull()
      expect(parseAssignStmt('.如果真 (x > 0)', 2, ctx)).toBeNull()
      expect(parseAssignStmt('.局部变量 a, 整数型', 3, ctx)).toBeNull()
    })

    it('空行返回 null', () => {
      expect(parseAssignStmt('', 1, ctx)).toBeNull()
    })
  })
})
