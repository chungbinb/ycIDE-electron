// 语句 AST 端到端测试 —— 验证解析 + 发射生成的 C++ 代码结构正确
import { describe, it, expect } from 'vitest'
import { parseStmtFromLine, emitStmt } from '../../src/main/transpiler/stmtAst'
import type { TranspileContext } from '../../src/main/transpiler/ast'

const ctx: TranspileContext = {}
const wrapCond = (c: string) => c

describe('stmtAst End-to-End', () => {
  describe('if/else 结构', () => {
    it('生成完整的 if-else 结构', () => {
      const ifStmt = parseStmtFromLine('.如果真 (x > 0)', 1, ctx)
      const elseStmt = parseStmtFromLine('.否则', 2, ctx)
      const endIf = parseStmtFromLine('.如果真结束', 3, ctx)

      expect(ifStmt?.kind).toBe('if')
      expect(elseStmt?.kind).toBe('else')
      expect(endIf?.kind).toBe('endif')

      const lines = [
        emitStmt(ifStmt!, ctx, wrapCond, 1),
        emitStmt(elseStmt!, ctx, wrapCond, 1),
        emitStmt(endIf!, ctx, wrapCond, 1),
      ].filter(Boolean)

      expect(lines).toContain('    if (x > 0LL) {')
      expect(lines).toContain('    } else {')
      expect(lines).toContain('    }')
    })
  })

  describe('循环结构', () => {
    it('计次循环生成 for 循环', () => {
      const loopStart = parseStmtFromLine('.计次循环首 (10, i)', 1, ctx)
      const loopEnd = parseStmtFromLine('.计次循环尾', 2, ctx)

      expect(loopStart?.kind).toBe('countLoopStart')
      expect(loopEnd?.kind).toBe('countLoopEnd')

      const lines = [
        emitStmt(loopStart!, ctx, wrapCond, 1),
        emitStmt(loopEnd!, ctx, wrapCond, 1),
      ].filter(Boolean)

      expect(lines).toContain('    for (int64_t i = 1; i <= (10LL); i++) {')
      expect(lines).toContain('    }')
    })

    it('判断循环生成 while 循环', () => {
      const loopStart = parseStmtFromLine('.判断循环首 (cond)', 1, ctx)
      const loopEnd = parseStmtFromLine('.判断循环尾', 2, ctx)

      expect(loopStart?.kind).toBe('judgeLoopStart')
      expect(loopEnd?.kind).toBe('judgeLoopEnd')

      const lines = [
        emitStmt(loopStart!, ctx, wrapCond, 1),
        emitStmt(loopEnd!, ctx, wrapCond, 1),
      ].filter(Boolean)

      expect(lines).toContain('    while cond {')
      expect(lines).toContain('    }')
    })

    it('do-while 循环生成', () => {
      const loopStart = parseStmtFromLine('.循环判断首', 1, ctx)
      const loopEnd = parseStmtFromLine('.循环判断尾 (cond)', 2, ctx)

      expect(loopStart?.kind).toBe('doLoopStart')
      expect(loopEnd?.kind).toBe('doLoopEnd')

      const lines = [
        emitStmt(loopStart!, ctx, wrapCond, 1),
        emitStmt(loopEnd!, ctx, wrapCond, 1),
      ].filter(Boolean)

      expect(lines).toContain('    do {')
      expect(lines).toContain('    } while cond;')
    })
  })

  describe('控制流语句', () => {
    it('返回语句', () => {
      const ret = parseStmtFromLine('.返回 (result)', 1, ctx)
      expect(ret?.kind).toBe('return')
      if (ret?.kind === 'return' && ret.arg) {
        const out = emitStmt(ret, ctx, wrapCond, 1)
        expect(out).toContain('return result;')
      }
    })

    it('break 和 continue', () => {
      const breakStmt = parseStmtFromLine('.跳出循环', 1, ctx)
      const continueStmt = parseStmtFromLine('.到循环尾', 2, ctx)

      expect(breakStmt?.kind).toBe('break')
      expect(continueStmt?.kind).toBe('continue')

      expect(emitStmt(breakStmt!, ctx, wrapCond, 1)).toBe('    break;')
      expect(emitStmt(continueStmt!, ctx, wrapCond, 1)).toBe('    continue;')
    })

    it('结束程序', () => {
      const end = parseStmtFromLine('.结束', 1, ctx)
      expect(end?.kind).toBe('end')
      expect(emitStmt(end!, ctx, wrapCond, 1)).toBe('    ExitProcess(0);')
    })
  })

  describe('注释', () => {
    it('生成 C++ 行注释', () => {
      const comment = parseStmtFromLine("'这是注释", 1, ctx)
      expect(comment?.kind).toBe('comment')
      if (comment?.kind === 'comment') {
        expect(emitStmt(comment, ctx, wrapCond, 1)).toBe('    // 这是注释')
      }
    })
  })
})
