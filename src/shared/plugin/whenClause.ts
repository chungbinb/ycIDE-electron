// when 表达式：决定命令是否可用、菜单项是否显示、快捷键是否生效。
// 语法（VS Code 的子集）：
//   标识符                 上下文键为真
//   !表达式                取反
//   a && b、a || b         与、或（&& 优先）
//   键 == 值、键 != 值      比较，值可以是 '字符串'、数字、true / false 或裸标识符
//   ( 表达式 )             分组

export type ContextValue = string | number | boolean | null | undefined
export type ContextLookup = Record<string, ContextValue>

type WhenNode =
  | { kind: 'const'; value: boolean }
  | { kind: 'key'; name: string }
  | { kind: 'not'; operand: WhenNode }
  | { kind: 'and' | 'or'; left: WhenNode; right: WhenNode }
  | { kind: 'eq' | 'ne'; name: string; value: ContextValue }

type Token =
  | { type: 'ident'; text: string }
  | { type: 'string'; text: string }
  | { type: 'number'; value: number }
  | { type: 'op'; text: '!' | '&&' | '||' | '==' | '!=' | '(' | ')' }

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (/\s/.test(ch)) { i++; continue }
    const two = source.slice(i, i + 2)
    if (two === '&&' || two === '||' || two === '==' || two === '!=') {
      tokens.push({ type: 'op', text: two })
      i += 2
      continue
    }
    if (ch === '!' || ch === '(' || ch === ')') {
      tokens.push({ type: 'op', text: ch })
      i++
      continue
    }
    if (ch === '\'' || ch === '"') {
      const end = source.indexOf(ch, i + 1)
      if (end < 0) throw new Error('字符串缺少结束引号')
      tokens.push({ type: 'string', text: source.slice(i + 1, end) })
      i = end + 1
      continue
    }
    const num = /^-?\d+(\.\d+)?/.exec(source.slice(i))
    if (num) {
      tokens.push({ type: 'number', value: Number(num[0]) })
      i += num[0].length
      continue
    }
    const ident = /^[A-Za-z_一-龥][\w.:\-一-龥]*/.exec(source.slice(i))
    if (ident) {
      tokens.push({ type: 'ident', text: ident[0] })
      i += ident[0].length
      continue
    }
    throw new Error(`无法识别的字符「${ch}」`)
  }
  return tokens
}

class Parser {
  private pos = 0
  constructor(private readonly tokens: Token[]) {}

  parse(): WhenNode {
    const node = this.parseOr()
    if (this.pos < this.tokens.length) throw new Error('表达式末尾有多余内容')
    return node
  }

  private peekOp(text: string): boolean {
    const t = this.tokens[this.pos]
    return !!t && t.type === 'op' && t.text === text
  }

  private parseOr(): WhenNode {
    let left = this.parseAnd()
    while (this.peekOp('||')) {
      this.pos++
      left = { kind: 'or', left, right: this.parseAnd() }
    }
    return left
  }

  private parseAnd(): WhenNode {
    let left = this.parseUnary()
    while (this.peekOp('&&')) {
      this.pos++
      left = { kind: 'and', left, right: this.parseUnary() }
    }
    return left
  }

  private parseUnary(): WhenNode {
    if (this.peekOp('!')) {
      this.pos++
      return { kind: 'not', operand: this.parseUnary() }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): WhenNode {
    const t = this.tokens[this.pos]
    if (!t) throw new Error('表达式不完整')
    if (t.type === 'op' && t.text === '(') {
      this.pos++
      const inner = this.parseOr()
      if (!this.peekOp(')')) throw new Error('缺少右括号')
      this.pos++
      return inner
    }
    if (t.type !== 'ident') throw new Error('此处需要上下文键')
    this.pos++
    if (t.text === 'true' || t.text === 'false') return { kind: 'const', value: t.text === 'true' }
    if (this.peekOp('==') || this.peekOp('!=')) {
      const op = (this.tokens[this.pos] as { text: string }).text
      this.pos++
      const v = this.tokens[this.pos]
      if (!v || v.type === 'op') throw new Error('比较运算符后缺少值')
      this.pos++
      let value: ContextValue
      if (v.type === 'number') value = v.value
      else if (v.type === 'string') value = v.text
      else value = v.text === 'true' ? true : v.text === 'false' ? false : v.text
      return { kind: op === '==' ? 'eq' : 'ne', name: t.text, value }
    }
    return { kind: 'key', name: t.text }
  }
}

const parseCache = new Map<string, WhenNode>()

/** 解析 when 表达式，语法错误时抛出异常（清单校验阶段使用） */
export function parseWhenClause(source: string): WhenNode {
  const cached = parseCache.get(source)
  if (cached) return cached
  const node = new Parser(tokenize(source)).parse()
  parseCache.set(source, node)
  return node
}

// 与 VS Code 一致：'1' 与 1 视为相等
function looseEquals(a: ContextValue, b: ContextValue): boolean {
  if (a === b) return true
  if (a === null || a === undefined || b === null || b === undefined) return false
  return String(a) === String(b)
}

function evaluate(node: WhenNode, ctx: ContextLookup): boolean {
  switch (node.kind) {
    case 'const': return node.value
    case 'key': return !!ctx[node.name]
    case 'not': return !evaluate(node.operand, ctx)
    case 'and': return evaluate(node.left, ctx) && evaluate(node.right, ctx)
    case 'or': return evaluate(node.left, ctx) || evaluate(node.right, ctx)
    case 'eq': return looseEquals(ctx[node.name], node.value)
    case 'ne': return !looseEquals(ctx[node.name], node.value)
  }
}

/** 求值 when 表达式；表达式为空表示恒真，语法错误按不满足处理（清单校验阶段已拦截） */
export function evaluateWhenClause(source: string | undefined, ctx: ContextLookup): boolean {
  if (!source || !source.trim()) return true
  try {
    return evaluate(parseWhenClause(source), ctx)
  } catch {
    return false
  }
}
