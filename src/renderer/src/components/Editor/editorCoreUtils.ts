import { splitCSV } from './eycBlocks'
import { FLOW_KW } from './eycFlow'

export interface Span { text: string; cls: string }

export interface CompletionParam {
  name: string
  type: string
  description: string
  optional: boolean
  isVariable: boolean
  isArray: boolean
}

export interface CompletionItem {
  name: string
  englishName: string
  description: string
  returnType: string
  category: string
  libraryName: string
  isMember: boolean
  ownerTypeName: string
  params: CompletionParam[]
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export const MEMBER_DELIMITER_REGEX = /[。．]/g
export const MEMBER_DELIMITERS = new Set(['.', '。', '．'])

export const WINDOW_METHOD_WHITELIST = new Set([
  '取窗口句柄', '销毁', '获取焦点', '可有焦点',
  '取用户区宽度', '取用户区高度', '禁止重画', '允许重画',
  '重画', '部分重画', '取消重画', '刷新显示',
  '移动', '调整层次', '弹出菜单', '发送信息',
  '投递信息', '取标记组件', '置外形图片', '激活',
  '置托盘图标', '弹出托盘菜单', '置父窗口',
])

const NUMERIC_TYPE_COMMON_NOTE = '字节型、短整数型、整数型、长整数型、小数型、双精度小数型统称为数值型，彼此可转换；编程时需注意溢出与精度丢失（例如 257 转字节型后为 1）。'

export const BUILTIN_TYPE_ITEMS: Array<{ name: string; englishName: string; description: string }> = [
  { name: '字节型', englishName: 'byte', description: '可容纳 0 到 255 之间的数值。' + NUMERIC_TYPE_COMMON_NOTE },
  { name: '短整数型', englishName: 'short', description: '可容纳 -32,768 到 32,767 之间的数值，尺寸为 2 个字节。' + NUMERIC_TYPE_COMMON_NOTE },
  { name: '整数型', englishName: 'int', description: '可容纳 -2,147,483,648 到 2,147,483,647 之间的数值，尺寸为 4 个字节。' + NUMERIC_TYPE_COMMON_NOTE },
  { name: '长整数型', englishName: 'int64', description: '可容纳 -9,223,372,036,854,775,808 到 9,223,372,036,854,775,807 之间的数值，尺寸为 8 个字节。' + NUMERIC_TYPE_COMMON_NOTE },
  { name: '小数型', englishName: 'float', description: '可容纳 3.4E +/- 38（7位小数）之间的数值，尺寸为 4 个字节。' + NUMERIC_TYPE_COMMON_NOTE },
  { name: '双精度小数型', englishName: 'double', description: '可容纳 1.7E +/- 308（15位小数）之间的数值，尺寸为 8 个字节。' + NUMERIC_TYPE_COMMON_NOTE },
  { name: '逻辑型', englishName: 'bool', description: '值只可能为“真”或“假”，尺寸为 2 个字节。“真”和“假”为系统预定义常量，其对应的英文常量名称为“true”和“false”。' },
  { name: '日期时间型', englishName: 'datetime', description: '用作记录日期及时间，尺寸为 8 个字节。' },
  { name: '文本型', englishName: 'text', description: '用作记录一段文本，文本由以字节 0 结束的一系列字符组成。' },
  { name: '字节集', englishName: 'bin', description: '用作记录一段字节型数据。字节集与字节数组之间可以互相转换，在程序中允许使用字节数组的地方也可以使用字节集，或者相反。字节数组的使用方法，譬如用中括号对“[]”加索引数值引用字节成员，使用数组型数值数据进行赋值等等，都可以被字节集所使用。两者之间唯一的不同是字节集可以变长，因此可把字节集看作可变长的字节数组。' },
  { name: '子程序指针', englishName: 'subptr', description: '用作指向一个子程序，尺寸为 4 个字节。具有此数据类型的容器可以用来间接调用子程序。参见例程 sample.e 中的相应部分。' },
  { name: '通用型', englishName: 'any', description: '可存放不同类型的数据，适用于需要接收多种类型值的场景。' },
]

export const BUILTIN_LITERAL_COMPLETION_ITEMS: CompletionItem[] = [
  {
    name: '真',
    englishName: 'true',
    description: '逻辑真常量',
    returnType: '逻辑型',
    category: '常量',
    libraryName: '系统核心支持库',
    isMember: false,
    ownerTypeName: '',
    params: [],
  },
  {
    name: '假',
    englishName: 'false',
    description: '逻辑假常量',
    returnType: '逻辑型',
    category: '常量',
    libraryName: '系统核心支持库',
    isMember: false,
    ownerTypeName: '',
    params: [],
  },
  {
    name: '空',
    englishName: 'null',
    description: '空常量',
    returnType: '',
    category: '常量',
    libraryName: '系统核心支持库',
    isMember: false,
    ownerTypeName: '',
    params: [],
  },
]

export const AC_PAGE_SIZE = 30

export function formatOps(val: string): string {
  // 先替换为中文引号，再用占位符保护字符串字面量，避免后续运算符替换污染字符串内容。
  val = val.replace(/"([^"\r\n]*)"/g, '“$1”')
  const strPlaceholders: string[] = []
  let s = val.replace(/["“](.*?)["”]/g, (m) => {
    strPlaceholders.push(m)
    return `\x00STR${strPlaceholders.length - 1}\x00`
  })
  s = s.replace(/(<>|!=)/g, ' ≠ ')
  s = s.replace(/<=/g, ' ≤ ')
  s = s.replace(/>=/g, ' ≥ ')
  s = s.replace(/＝/g, ' ＝ ')
  s = s.replace(/(?<!=)=(?!=)/g, ' ＝ ')
  s = s.replace(/</g, ' ＜ ')
  s = s.replace(/>/g, ' ＞ ')
  s = s.replace(/\+/g, ' ＋ ')
  s = s.replace(/(?<!\x00)-/g, ' － ')
  s = s.replace(/\*/g, ' × ')
  s = s.replace(/\//g, ' ÷ ')
  // 收敛多余空格，保证失焦后的表达式展示稳定。
  s = s.replace(/ {2,}/g, ' ').trim()
  s = s.replace(/\x00STR(\d+)\x00/g, (_, idx) => strPlaceholders[parseInt(idx)])
  return s
}

export function colorize(raw: string): Span[] {
  const trimmed = raw.replace(/[\r\t]/g, '')
  let stripped = trimmed.replace(/^ +/, '')
  const indent = trimmed.length - stripped.length
  // 流程标记行首可能带零宽字符，着色时先剥离再按普通语法处理。
  if (stripped.startsWith('\u200C') || stripped.startsWith('\u200D') || stripped.startsWith('\u2060')) {
    stripped = stripped.slice(1)
  }
  if (!stripped) return [{ text: '', cls: '' }]

  if (stripped.startsWith("'")) {
    return [
      ...(indent > 0 ? [{ text: '\u00A0'.repeat(indent), cls: '' }] : []),
      { text: stripped, cls: 'Remarkscolor' },
    ]
  }

  let code = stripped
  let remark = ''
  const ri = findRemark(stripped)
  if (ri >= 0) {
    code = stripped.slice(0, ri).trimEnd()
    remark = stripped.slice(ri)
  }

  const spans: Span[] = []

  if (indent > 0) {
    const lvl = Math.floor(indent / 4)
    for (let l = 0; l < lvl; l++) spans.push({ text: '\u2502\u00A0\u00A0\u00A0', cls: 'eTreeLine' })
    const ex = indent % 4
    if (ex > 0) spans.push({ text: '\u00A0'.repeat(ex), cls: '' })
  }

  if (code.startsWith('.')) {
    const kw = code.split(/[\s(（]/)[0]
    if (FLOW_KW.has(kw.slice(1))) {
      spans.push({ text: kw, cls: 'comecolor' })
      if (code.length > kw.length) spans.push(...colorExpr(code.slice(kw.length)))
    } else {
      spans.push(...colorExpr(code))
    }
  } else {
    const exprSpans = colorExpr(code)
    // 非 . 开头行在易语言里通常是命令调用；这里补齐“无括号调用”的着色判定。
    if (exprSpans.length > 0 && exprSpans[0].cls === '') {
      const firstText = exprSpans[0].text
      const m = firstText.match(/^([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*)(.*)/)
      if (m) {
        const ident = m[1]
        const rest = m[2]
        const nextText = exprSpans.length > 1 ? (exprSpans[1].text || '') : ''
        const isAssignTargetByRest = /^\s*[=＝]/.test(rest)
        const isAssignTargetByNext = /^\s*$/.test(rest) && /^\s*[=＝]/.test(nextText)
        if (isAssignTargetByRest || isAssignTargetByNext) {
          exprSpans.splice(0, 1, { text: ident, cls: 'assignTarget' }, ...(rest ? colorExpr(rest) : []))
        } else {
          exprSpans.splice(0, 1, { text: ident, cls: ident.includes('.') ? 'cometwolr' : 'funccolor' }, ...(rest ? colorExpr(rest) : []))
        }
      }
    }
    spans.push(...exprSpans)
  }

  if (remark) {
    spans.push({ text: ' ', cls: '' })
    spans.push({ text: remark, cls: 'Remarkscolor' })
  }
  return spans
}

function findRemark(s: string): number {
  let inS = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inS) {
      if (c === '"' || c === '\u201d') inS = false
      continue
    }
    if (c === '"' || c === '\u201c') {
      inS = true
      continue
    }
    if (c === "'" && i > 0) return i
  }
  return -1
}

function colorExpr(expr: string): Span[] {
  const out: Span[] = []
  let r = expr
  while (r.length > 0) {
    const ws = r.match(/^\s+/)
    if (ws) {
      out.push({ text: ws[0], cls: '' })
      r = r.slice(ws[0].length)
      continue
    }

    const op = r.match(/^(<>|!=|<=|>=|=|＝|<|>|\+|-|\*|\/|,|，)/)
    if (op) {
      out.push({ text: op[0], cls: 'conscolor' })
      r = r.slice(op[0].length)
      continue
    }

    const sm = r.match(/^([""\u201c])(.*?)([""\u201d])/)
    if (sm && r.startsWith(sm[1])) {
      out.push({ text: sm[0], cls: 'eTxtcolor' })
      r = r.slice(sm[0].length)
      continue
    }

    if (r.startsWith('#')) {
      const end = r.slice(1).search(/[\s(（），=＝<>+\-*\/]/)
      const cn = end >= 0 ? r.slice(0, end + 1) : r
      out.push({ text: cn, cls: 'conscolor' })
      r = r.slice(cn.length)
      continue
    }

    const bm = r.match(/^(真|假)(?=[\s(（），=＝]|$)/)
    if (bm) {
      out.push({ text: bm[0], cls: 'conscolor' })
      r = r.slice(bm[0].length)
      continue
    }

    const lm = r.match(/^(且|或)(?=[\s(（），]|$)/)
    if (lm) {
      out.push({ text: lm[0], cls: 'funccolor' })
      r = r.slice(lm[0].length)
      continue
    }

    if ('()（）{}[]'.includes(r[0])) {
      out.push({ text: r[0], cls: 'conscolor' })
      r = r.slice(1)
      continue
    }

    // 仅在“标识符后紧跟括号”时按函数/成员调用着色。
    const fm = r.match(/^([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*)\s*(?=[(\uff08])/)
    if (fm) {
      const name = fm[1]
      if (name.includes('.')) out.push({ text: name, cls: 'cometwolr' })
      else if (FLOW_KW.has(name)) out.push({ text: name, cls: 'comecolor' })
      else out.push({ text: name, cls: 'funccolor' })
      r = r.slice(name.length)
      continue
    }

    const pm = r.match(/^[^""\u201c#(（），=＝<>+\-*\/]+/)
    if (pm) {
      out.push({ text: pm[0], cls: '' })
      r = r.slice(pm[0].length)
      continue
    }

    out.push({ text: r[0], cls: '' })
    r = r.slice(1)
  }

  return out
}

export function getMissingAssignmentRhsTarget(rawLine: string): string | null {
  const trimmed = rawLine.replace(/[\r\t]/g, '').trim()
  const m = /^([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*)\s*(?:=|＝)\s*$/.exec(trimmed)
  return m ? m[1] : null
}

export function isKnownAssignmentTarget(target: string, knownVars: Set<string>): boolean {
  const normalized = (target || '').trim().replace(MEMBER_DELIMITER_REGEX, '.')
  if (!normalized) return false
  const base = normalized.split('.')[0]?.trim() || ''
  if (!base) return false
  return knownVars.has(base)
}

export function isValidVariableLikeName(name: string): boolean {
  return /^[\u4e00-\u9fa5A-Za-z_]/.test(name.trim())
}

export function normalizeMemberTypeName(s: string): string {
  const t = (s || '').trim()
  if (!t) return ''
  const parts = t.split(/[.:]/).map(p => p.trim()).filter(Boolean)
  return (parts.length > 0 ? parts[parts.length - 1] : t).toLowerCase()
}

export function splitDebugRenderableText(text: string): Array<{ text: string; token?: string }> {
  if (!text) return [{ text }]
  const parts: Array<{ text: string; token?: string }> = []
  const regex = /([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ text: text.slice(lastIndex, match.index) })
    parts.push({ text: match[0], token: match[0] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex) })
  return parts.length > 0 ? parts : [{ text }]
}

const DECL_PREFIXES = [
  '.程序集变量 ', '.程序集 ', '.子程序 ', '.局部变量 ',
  '.全局变量 ', '.常量 ', '.资源 ', '.数据类型 ', '.DLL命令 ',
  '.图片 ', '.声音 ', '.参数 ', '.成员 ',
]

export function rebuildLineField(rawLine: string, fieldIdx: number, newValue: string, isSlice: boolean): string {
  const line = rawLine.replace(/\r/g, '')
  const stripped = line.replace(/^ +/, '')
  const indent = line.length - stripped.length

  for (const pf of DECL_PREFIXES) {
    if (stripped.startsWith(pf)) {
      const fieldsStr = stripped.slice(pf.length)
      const fields = splitCSV(fieldsStr)

      if (isSlice) {
        // slice 模式用于“从某字段起整体替换”，常见于参数串重建。
        fields.splice(fieldIdx, fields.length - fieldIdx, newValue)
      } else {
        while (fields.length <= fieldIdx) fields.push('')
        fields[fieldIdx] = newValue
      }

      while (fields.length > 0 && fields[fields.length - 1] === '') fields.pop()

      return ' '.repeat(indent) + pf + fields.join(', ')
    }
  }

  return rawLine
}

function parseFlagFieldTokens(rawValue: string): string[] {
  return (rawValue || '')
    .split(/[,\s]+/)
    .map(token => token.trim())
    .filter(Boolean)
}

export function rebuildLineFlagField(rawLine: string, fieldIdx: number, flag: string): string {
  const line = rawLine.replace(/\r/g, '')
  const stripped = line.replace(/^ +/, '')
  const indent = line.length - stripped.length

  for (const pf of DECL_PREFIXES) {
    if (!stripped.startsWith(pf)) continue
    const fieldsStr = stripped.slice(pf.length)
    const fields = splitCSV(fieldsStr)
    while (fields.length <= fieldIdx) fields.push('')
    const tokens = parseFlagFieldTokens(fields[fieldIdx] || '')
    const nextTokens = tokens.includes(flag)
      ? tokens.filter(token => token !== flag)
      : [...tokens, flag]
    fields[fieldIdx] = nextTokens.join(' ')
    while (fields.length > 0 && fields[fields.length - 1] === '') fields.pop()
    return ' '.repeat(indent) + pf + fields.join(', ')
  }

  return rawLine
}
