// 赋值表达式 AST 测试
import { describe, it, expect } from 'vitest'
import {
  parseAssignStmt,
  emitAssignStmt,
  simpleVarAssign,
  controlPropAssign,
  arrayIndexAssign,
  fontSubpropAssign,
  assignStmt,
  type AssignStmt,
} from '../../src/main/transpiler/assignAst'
import { varRef, numberLiteral } from '../../src/main/transpiler/ast'
import type { TranspileContext } from '../../src/main/transpiler/ast'

const ctx: TranspileContext = {}

describe('assignAst', () => {
  describe('解析', () => {
    it('简单变量赋值', () => {
      const stmt = parseAssignStmt('a = 1', 1, ctx)
      expect(stmt?.kind).toBe('assign')
      if (stmt?.kind === 'assign') {
        expect(stmt.target.kind).toBe('simpleVar')
        if (stmt.target.kind === 'simpleVar') {
          expect(stmt.target.varName).toBe('a')
        }
      }
    })

    it('控件属性赋值', () => {
      // 使用简单的控件名（无空格）
      const stmt = parseAssignStmt('Label1.Text = hello', 2, ctx)
      expect(stmt?.kind).toBe('assign')
      if (stmt?.kind === 'assign') {
        expect(stmt.target.kind).toBe('controlProp')
        if (stmt.target.kind === 'controlProp') {
          expect(stmt.target.controlName).toBe('Label1')
          expect(stmt.target.propName).toBe('Text')
        }
      }
    })

    it('数组下标赋值', () => {
      const stmt = parseAssignStmt('数组[i] = 1', 3, ctx)
      expect(stmt?.kind).toBe('assign')
      if (stmt?.kind === 'assign') {
        expect(stmt.target.kind).toBe('arrayIndex')
        if (stmt.target.kind === 'arrayIndex') {
          expect(stmt.target.arrayName).toBe('数组')
        }
      }
    })

    it('字体子属性赋值', () => {
      const stmt = parseAssignStmt('标签.字体.字体大小 = 8', 4, ctx)
      expect(stmt?.kind).toBe('assign')
      if (stmt?.kind === 'assign') {
        expect(stmt.target.kind).toBe('fontSubprop')
        if (stmt.target.kind === 'fontSubprop') {
          expect(stmt.target.controlName).toBe('标签')
          expect(stmt.target.subpropName).toBe('字体大小')
        }
      }
    })
  })

  describe('发射', () => {
    it('简单变量赋值发射', () => {
      const varRefExpr = varRef('x')
      const numExpr = numberLiteral(42n, false, '42')
      const target = simpleVarAssign('x', 1)
      const stmt = assignStmt(target, numExpr, 1)
      const out = emitAssignStmt(stmt, ctx)
      expect(out).toContain('x = ')
      expect(out).toContain('42')
    })

    it('控件属性赋值发射', () => {
      const textExpr = { kind: 'text', value: 'hello' }
      const target = controlPropAssign('按钮 1', '标题', 2)
      const stmt = assignStmt(target, textExpr as any, 2)
      const out = emitAssignStmt(stmt, ctx)
      expect(out).toContain('按钮 1.标题')
      expect(out).toContain('hello')
    })

    it('数组下标赋值发射', () => {
      const varRefExpr = varRef('i')
      const numExpr = numberLiteral(1n, false, '1')
      const target = arrayIndexAssign('数组', [varRefExpr], 3)
      const stmt = assignStmt(target, numExpr, 3)
      const out = emitAssignStmt(stmt, ctx)
      expect(out).toContain('yc_ary_at(数组, ')
      expect(out).toContain('i')
      expect(out).toContain('1LL')
    })
  })

  describe('边界条件', () => {
    it('非赋值行返回 null', () => {
      expect(parseAssignStmt('返回 ()', 1, ctx)).toBeNull()
      expect(parseAssignStmt('.如果真 (x > 0)', 2, ctx)).toBeNull()
    })
  })
})
