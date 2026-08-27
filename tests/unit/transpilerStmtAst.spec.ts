// 语句级 AST 测试
import { describe, it, expect } from 'vitest'
import {
  parseStmtFromLine,
  emitStmt,
  type EycStmt,
  ifStmt,
  elseStmt,
  endifStmt,
  countLoopStart,
  countLoopEnd,
  returnStmt,
  commentStmt,
} from '../../src/main/transpiler/stmtAst'
import { varRef, numberLiteral, boolLiteral } from '../../src/main/transpiler/ast'
import type { TranspileContext } from '../../src/main/transpiler/ast'

const ctx: TranspileContext = {}
const wrapCond = (c: string) => c

describe('stmtAst', () => {
  describe('解析', () => {
    it('如果真 (a > 0) → IfStmt', () => {
      const stmt = parseStmtFromLine('.如果真 (a > 0)', 1, ctx)
      expect(stmt?.kind).toBe('if')
      if (stmt?.kind === 'if') {
        expect(stmt.cond.kind).toBe('binop')
        if (stmt.cond.kind === 'binop') {
          expect(stmt.cond.operator).toBe('>')
        }
      }
    })

    it('返回 变量 → ReturnStmt', () => {
      const stmt = parseStmtFromLine('.返回 (myVar)', 5, ctx)
      expect(stmt?.kind).toBe('return')
      if (stmt?.kind === 'return' && stmt.arg) {
        expect(stmt.arg.kind).toBe('var')
      }
    })

    it('注释行 → CommentStmt', () => {
      const stmt = parseStmtFromLine("'这是注释", 3, ctx)
      expect(stmt?.kind).toBe('comment')
      if (stmt?.kind === 'comment') {
        expect(stmt.text).toBe('这是注释')
      }
    })
  })

  describe('发射', () => {
    it('IfStmt → if (...) {', () => {
      const cond = varRef('x')
      const stmt = ifStmt(cond, 1)
      const out = emitStmt(stmt, ctx, wrapCond, 1)
      expect(out).toContain('if')
      expect(out).toContain('{')
    })

    it('ElseStmt → } else {', () => {
      const stmt = elseStmt(2)
      expect(emitStmt(stmt, ctx, wrapCond, 1)).toBe('    } else {')
    })

    it('EndIfStmt → }', () => {
      const stmt = endifStmt(3)
      expect(emitStmt(stmt, ctx, wrapCond, 1)).toBe('    }')
    })

    it('CountLoopStart → for (...; ... <= (...); ...) {', () => {
      const stmt = countLoopStart(numberLiteral(10n, false, '10'), 'i', 4)
      const out = emitStmt(stmt, ctx, wrapCond, 1)
      expect(out).toContain('for')
      expect(out).toContain('int64_t i = 1')
    })

    it('CountLoopEnd → }', () => {
      const stmt = countLoopEnd(5)
      expect(emitStmt(stmt, ctx, wrapCond, 1)).toBe('    }')
    })

    it('ReturnStmt with arg → return xxx;', () => {
      const stmt = returnStmt(6, varRef('result'))
      const out = emitStmt(stmt, ctx, wrapCond, 1)
      expect(out).toContain('return result;')
    })

    it('ReturnStmt without arg → return;', () => {
      const stmt = returnStmt(7)
      const out = emitStmt(stmt, ctx, wrapCond, 1)
      expect(out).toContain('return;')
    })

    it('CommentStmt → // text', () => {
      const stmt = commentStmt('hello', 8)
      expect(emitStmt(stmt, ctx, wrapCond, 1)).toBe('    // hello')
    })
  })
})
