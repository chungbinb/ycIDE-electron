import { useState, useCallback, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react'
import { matchScore, isEnglishMatch } from '../../utils/pinyin'
import { eycToYiFormat, sanitizePastedTextForCurrent, normalizeEycText } from './eycFormat'
import './EycTableEditor.css'

// ========== 数据结构 ==========

type DeclType =
  | 'assembly' | 'assemblyVar' | 'sub' | 'subParam' | 'localVar'
  | 'globalVar' | 'constant' | 'dataType' | 'dataTypeMember'
  | 'dll' | 'image' | 'sound'

interface ParsedLine {
  type: DeclType | 'version' | 'supportLib' | 'blank' | 'comment' | 'code'
  raw: string
  fields: string[]
}

interface RenderBlock {
  kind: 'table' | 'codeline'
  tableType?: string
  rows: TblRow[]
  codeLine?: string
  lineIndex: number
  isVirtual?: boolean  // 自动生成的空代码行（子程序下保底行）
}

interface TblRow {
  cells: CellData[]
  lineIndex: number
  isHeader?: boolean
}

interface CellData {
  text: string
  cls: string
  colSpan?: number
  align?: string
  fieldIdx?: number    // 对应源码字段索引，undefined 表示不可编辑
  sliceField?: boolean // true 表示该字段取源码 fields[fieldIdx:] 拼接
}

// ========== 运算符格式化 ==========

function formatOps(val: string): string {
  const strPlaceholders: string[] = []
  let s = val.replace(/["“](.*?)["”]/g, (m) => {
    strPlaceholders.push(m)
    return `\x00STR${strPlaceholders.length - 1}\x00`
  })
  s = s.replace(/(<>|!=)/g, ' ≠ ')
  s = s.replace(/<=/g, ' ≤ ')
  s = s.replace(/>=/g, ' ≥ ')
  s = s.replace(/(?<!=)=(?!=)/g, ' ＝ ')
  s = s.replace(/</g, ' ＜ ')
  s = s.replace(/>/g, ' ＞ ')
  s = s.replace(/\+/g, ' ＋ ')
  s = s.replace(/(?<!\x00)-/g, ' － ')
  s = s.replace(/\*/g, ' × ')
  s = s.replace(/\//g, ' ÷ ')
  s = s.replace(/ {2,}/g, ' ').trim()
  s = s.replace(/\x00STR(\d+)\x00/g, (_, idx) => strPlaceholders[parseInt(idx)])
  return s
}

// ========== 解析 ==========

function splitCSV(text: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) { cur += ch; if (ch === '"' || ch === '\u201d') inQ = false; continue }
    if (ch === '"' || ch === '\u201c') { inQ = true; cur += ch; continue }
    if (ch === ',' && i + 1 < text.length && text[i + 1] === ' ') {
      result.push(cur); cur = ''; i++; continue
    }
    cur += ch
  }
  result.push(cur)
  return result
}

function unquote(s: string): string {
  if (!s) return ''
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('\u201c') && s.endsWith('\u201d')))
    return s.slice(1, -1)
  return s
}

function parseLines(text: string): ParsedLine[] {
  return text.split('\n').map(line => {
    const t = line.replace(/[\r\t]/g, '').trim()
    if (!t) return { type: 'blank' as const, raw: line, fields: [] }
    if (t.startsWith('.版本 ')) return { type: 'version' as const, raw: line, fields: [] }
    if (t.startsWith('.支持库 ')) return { type: 'supportLib' as const, raw: line, fields: [t.slice(5)] }
    if (t.startsWith("'")) return { type: 'comment' as const, raw: line, fields: [t.slice(1)] }

    const lt = line.replace(/[\r\t]/g, '')
    const decls: [DeclType, string][] = [
      ['assembly', '.程序集 '], ['assemblyVar', '.程序集变量 '],
      ['sub', '.子程序 '], ['localVar', '.局部变量 '],
      ['globalVar', '.全局变量 '], ['constant', '.常量 '],
      ['dataType', '.数据类型 '], ['dll', '.DLL命令 '],
      ['image', '.图片 '], ['sound', '.声音 '],
    ]
    for (const [dt, pf] of decls) {
      if (t.startsWith(pf)) return { type: dt, raw: line, fields: splitCSV(t.slice(pf.length)) }
    }
    if (lt.startsWith('    .成员 ') || t.startsWith('.成员 ')) {
      const pf = lt.startsWith('    .成员 ') ? '    .成员 ' : '.成员 '
      return { type: 'dataTypeMember' as DeclType, raw: line, fields: splitCSV((lt.startsWith('    .成员 ') ? lt : t).slice(pf.length)) }
    }
    if (lt.startsWith('    .参数 ') || t.startsWith('.参数 ')) {
      const pf = lt.startsWith('    .参数 ') ? '    .参数 ' : '.参数 '
      return { type: 'subParam' as DeclType, raw: line, fields: splitCSV((lt.startsWith('    .参数 ') ? lt : t).slice(pf.length)) }
    }
    return { type: 'code' as const, raw: line, fields: [] }
  })
}

// ========== 构建渲染块 ==========

function buildBlocks(text: string): RenderBlock[] {
  const lines = parseLines(text)
  const blocks: RenderBlock[] = []
  let tbl: RenderBlock | null = null
  let he = 0

  const flush = (): void => { if (tbl) { blocks.push(tbl); tbl = null } }
  const newTbl = (type: string, hdr: string[], li: number, hdrCls = 'eHeadercolor'): void => {
    tbl = { kind: 'table', tableType: type, rows: [], lineIndex: li }
    tbl.rows.push({ cells: hdr.map(h => ({ text: h, cls: hdrCls })), lineIndex: li, isHeader: true })
  }
  const addHdr = (hdr: string[], li: number, hdrCls = 'eHeadercolor'): void => {
    if (tbl) tbl.rows.push({ cells: hdr.map(h => ({ text: h, cls: hdrCls })), lineIndex: li, isHeader: true })
  }
  const pushRow = (li: number, cells: CellData[]): void => {
    if (tbl) tbl.rows.push({ lineIndex: li, cells })
  }
  const pushHdrRow = (li: number, cells: CellData[]): void => {
    if (tbl) tbl.rows.push({ lineIndex: li, cells, isHeader: true })
  }

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    const f = ln.fields

    if (ln.type === 'version' || ln.type === 'supportLib') continue

    if (ln.type === 'blank') {
      // 子程序声明区后的空行：视为代码区域过渡
      if (he === 1 || he === 2 || he === 11) { flush(); he = 0 }
      if (he === 0) blocks.push({ kind: 'codeline', rows: [], codeLine: '', lineIndex: i })
      continue
    }

    if (ln.type === 'comment') {
      if (he !== 0) { flush(); he = 0 }
      blocks.push({ kind: 'codeline', rows: [], codeLine: ln.raw, lineIndex: i })
      continue
    }

    // 程序集
    if (ln.type === 'assembly') {
      flush()
      const rest = ln.raw.replace(/[\r\t]/g, '').trim().slice('.程序集 '.length)
      const parts = rest.split(', , , ')
      const name = parts[0] || ''
      const remark = parts[1] || ''
      newTbl('assembly', ['窗口程序集名', '保 留\u00A0\u00A0', '保 留', '备 注'], i, 'eAssemblycolor')
      pushRow(i, [
        { text: name, cls: 'eProcolor', fieldIdx: 0 },
        { text: '\u00A0', cls: '' },
        { text: '\u00A0', cls: '' },
        { text: remark, cls: 'Remarkscolor', fieldIdx: 3, sliceField: true },
      ])
      he = 3; continue
    }

    // 程序集变量
    if (ln.type === 'assemblyVar') {
      if (he !== 3 && he !== 10) {
        flush()
        newTbl('assembly', ['窗口程序集名', '保 留\u00A0\u00A0', '保 留', '备 注'], i, 'eAssemblycolor')
        pushRow(i, [
          { text: '(未填写程序集名)', cls: 'Wrongcolor' },
          { text: '\u00A0', cls: '' }, { text: '\u00A0', cls: '' }, { text: '\u00A0', cls: '' },
        ])
      }
      if (he !== 10) {
        addHdr(['变量名', '类 型', '数组', '备 注 '], i, 'eAssemblycolor')
      }
      pushRow(i, [
        { text: f[0] || '', cls: 'Variablescolor', fieldIdx: 0 },
        { text: f[1] || '\u00A0', cls: 'eTypecolor', fieldIdx: 1 },
        { text: f.length > 3 ? unquote(f[3]) : '\u00A0', cls: 'eArraycolor', fieldIdx: 3 },
        { text: f.length > 4 ? f.slice(4).join(', ') : '\u00A0', cls: 'Remarkscolor', fieldIdx: 4, sliceField: true },
      ])
      he = 10; continue
    }

    // 子程序
    if (ln.type === 'sub') {
      flush()
      tbl = { kind: 'table', tableType: 'sub', rows: [], lineIndex: i }
      tbl.rows.push({ lineIndex: i, isHeader: true, cells: [
        { text: '子程序名', cls: 'eHeadercolor' },
        { text: '返回值类型', cls: 'eHeadercolor' },
        { text: '公开', cls: 'eHeadercolor' },
        { text: '备 注', cls: 'eHeadercolor', colSpan: 3 },
      ]})
      tbl.rows.push({ lineIndex: i, cells: [
        { text: f[0] || '', cls: 'eProcolor', fieldIdx: 0 },
        { text: f[1] || '\u00A0', cls: 'eTypecolor', fieldIdx: 1 },
        { text: f[2] === '公开' ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
        { text: f.length > 3 ? f.slice(3).join(', ') : '', cls: 'Remarkscolor', colSpan: 3, fieldIdx: 3, sliceField: true },
      ]})
      he = 1; continue
    }

    // 参数
    if (ln.type === 'subParam') {
      if (he === 4) {
        // DLL 参数
        const flags = f[2] || ''
        pushRow(i, [
          { text: f[0] || '', cls: 'Variablescolor', fieldIdx: 0 },
          { text: f[1] || '\u00A0', cls: 'eTypecolor', fieldIdx: 1 },
          { text: flags.includes('传址') ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
          { text: flags.includes('数组') ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
          { text: f.length > 3 ? f.slice(3).join(', ') : '', cls: 'Remarkscolor', fieldIdx: 3, sliceField: true },
        ])
        continue
      }
      if (he !== 1 && he !== 11) {
        flush()
        tbl = { kind: 'table', tableType: 'sub', rows: [], lineIndex: i }
        tbl.rows.push({ lineIndex: i, isHeader: true, cells: [
          { text: '子程序名', cls: 'eHeadercolor' },
          { text: '返回值类型', cls: 'eHeadercolor' },
          { text: '公开', cls: 'eHeadercolor' },
          { text: '备 注', cls: 'eHeadercolor', colSpan: 3 },
        ]})
        tbl.rows.push({ lineIndex: i, cells: [
          { text: '(未填写子程序名)', cls: 'Wrongcolor' },
          { text: '\u00A0', cls: '' }, { text: '\u00A0', cls: '' }, { text: '\u00A0', cls: '', colSpan: 3 },
        ]})
      }
      if (he !== 11) {
        addHdr(['参数名', '类 型', '参考', '可空', '数组', '备 注'], i)
      }
      const flags = f[2] || ''
      pushRow(i, [
        { text: f[0] || '', cls: 'Variablescolor', fieldIdx: 0 },
        { text: f[1] || '\u00A0', cls: 'eTypecolor', fieldIdx: 1 },
        { text: flags.includes('参考') ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
        { text: flags.includes('可空') ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
        { text: flags.includes('数组') ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
        { text: f.length > 3 ? f.slice(3).join(', ') : '', cls: 'Remarkscolor', fieldIdx: 3, sliceField: true },
      ])
      he = 11; continue
    }

    // 局部变量
    if (ln.type === 'localVar') {
      if (he !== 2) {
        if (he !== 1 && he !== 11 && he !== 2) { flush() }
        if (!tbl) {
          newTbl('localVar', ['变量名', '类 型', '静态', '数组', '备 注'], i, 'eVariableheadcolor')
        } else {
          addHdr(['变量名', '类 型', '静态', '数组', '备 注'], i, 'eVariableheadcolor')
        }
      }
      pushRow(i, [
        { text: f[0] || '', cls: 'Variablescolor', fieldIdx: 0 },
        { text: f[1] || '\u00A0', cls: 'eTypecolor', fieldIdx: 1 },
        { text: f[2] === '静态' ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
        { text: f.length > 3 ? unquote(f[3]) : '\u00A0', cls: 'eArraycolor', fieldIdx: 3 },
        { text: f.length > 4 ? f.slice(4).join(', ') : '', cls: 'Remarkscolor', fieldIdx: 4, sliceField: true },
      ])
      he = 2; continue
    }

    // 全局变量
    if (ln.type === 'globalVar') {
      if (he !== 6) {
        flush()
        newTbl('globalVar', ['全局变量名', '类 型', '数组', '公开', '备 注'], i)
      }
      pushRow(i, [
        { text: f[0] || '', cls: 'Variablescolor', fieldIdx: 0 },
        { text: f[1] || '\u00A0', cls: 'eTypecolor', fieldIdx: 1 },
        { text: f.length > 3 ? unquote(f[3]) : '\u00A0', cls: 'eArraycolor', fieldIdx: 3 },
        { text: f[2]?.includes('公开') ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
        { text: f.length > 4 ? f.slice(4).join(', ') : '', cls: 'Remarkscolor', fieldIdx: 4, sliceField: true },
      ])
      he = 6; continue
    }

    // 常量
    if (ln.type === 'constant') {
      if (he !== 9) {
        flush()
        newTbl('constant', ['常量名称', '常量值', '公 开', '备 注'], i)
      }
      pushRow(i, [
        { text: f[0] || '', cls: 'eOthercolor', fieldIdx: 0 },
        { text: f.length > 1 ? unquote(f[1]) : '\u00A0', cls: 'Constanttext', fieldIdx: 1 },
        { text: f[2] === '公开' ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
        { text: f.length > 3 ? f.slice(3).join(', ') : '', cls: 'Remarkscolor', fieldIdx: 3, sliceField: true },
      ])
      he = 9; continue
    }

    // 数据类型
    if (ln.type === 'dataType') {
      flush()
      newTbl('dataType', ['数据类型名', '公开', '备 注'], i)
      pushRow(i, [
        { text: f[0] || '', cls: 'eProcolor', fieldIdx: 0 },
        { text: f[1]?.includes('公开') ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
        { text: f.length > 2 ? f.slice(2).join(', ') : '', cls: 'Remarkscolor', fieldIdx: 2, sliceField: true },
      ])
      addHdr(['成员名', '类 型', '传址', '数组', '备 注 '], i)
      he = 8; continue
    }

    // 数据类型成员
    if (ln.type === 'dataTypeMember') {
      if (he !== 8) {
        flush()
        newTbl('dataType', ['数据类型名', '公开', '备 注'], i)
        pushRow(i, [
          { text: '(未定义数据类型名)', cls: 'Wrongcolor' },
          { text: '\u00A0', cls: '' }, { text: '\u00A0', cls: '' },
        ])
        addHdr(['成员名', '类 型', '传址', '数组', '备 注 '], i)
      }
      pushRow(i, [
        { text: f[0] || '', cls: 'Variablescolor', fieldIdx: 0 },
        { text: f[1] || '\u00A0', cls: 'eTypecolor', fieldIdx: 1 },
        { text: f[2] === '传址' ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
        { text: f.length > 3 ? unquote(f[3]) : '\u00A0', cls: 'eArraycolor', fieldIdx: 3 },
        { text: f.length > 4 ? f.slice(4).join(', ') : '', cls: 'Remarkscolor', fieldIdx: 4, sliceField: true },
      ])
      he = 8; continue
    }

    // DLL 命令
    if (ln.type === 'dll') {
      flush()
      newTbl('dll', ['DLL命令名', '返回值类型', '公开', '备 注'], i)
      pushRow(i, [
        { text: f[0] || '', cls: 'eProcolor', fieldIdx: 0 },
        { text: f[1] || '\u00A0', cls: 'eTypecolor', fieldIdx: 1 },
        { text: f[4] === '公开' ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
        { text: f.length > 5 ? f.slice(5).join(', ') : '', cls: 'Remarkscolor', fieldIdx: 5, sliceField: true },
      ])
      {
        const libFile = f[2] ? unquote(f[2]) : ''
        const cmdName = f[3] ? unquote(f[3]) : ''
        pushHdrRow(i, [{ text: 'DLL库文件名:', cls: 'eHeadercolor', colSpan: 5 }])
        pushRow(i, [{ text: libFile || '(未填写库文件名)', cls: libFile ? 'eAPIcolor' : 'Wrongcolor', colSpan: 5, fieldIdx: 2 }])
        pushHdrRow(i, [{ text: '在DLL库中对应命令名:', cls: 'eHeadercolor', colSpan: 5 }])
        pushRow(i, [{ text: cmdName || '(未填写命令名)', cls: cmdName ? 'eAPIcolor' : 'Wrongcolor', colSpan: 5, fieldIdx: 3 }])
      }
      addHdr(['参数名', '类 型', '传址', '数组', '备 注 '], i)
      he = 4; continue
    }

    // 图片
    if (ln.type === 'image') {
      if (he !== 5) { flush(); newTbl('image', ['图片或图片组名称', '内容', '公开', '备 注'], i) }
      pushRow(i, [
        { text: f[0] || '', cls: 'eOthercolor', fieldIdx: 0 },
        { text: '\u00A0\u00A0\u00A0\u00A0', cls: '' },
        { text: f[1]?.includes('公开') ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
        { text: f.length > 2 ? f.slice(2).join(', ') : '', cls: 'Remarkscolor', fieldIdx: 2, sliceField: true },
      ])
      he = 5; continue
    }

    // 声音
    if (ln.type === 'sound') {
      if (he !== 7) { flush(); newTbl('sound', ['声音名称', '内容', '公开', '备 注'], i) }
      pushRow(i, [
        { text: f[0] || '', cls: 'eOthercolor', fieldIdx: 0 },
        { text: '\u00A0\u00A0\u00A0\u00A0', cls: '' },
        { text: f[1]?.includes('公开') ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
        { text: f.length > 2 ? f.slice(2).join(', ') : '', cls: 'Remarkscolor', fieldIdx: 2, sliceField: true },
      ])
      he = 7; continue
    }

    // 代码行
    if (ln.type === 'code') {
      if (he !== 0) { flush(); he = 0 }
      blocks.push({ kind: 'codeline', rows: [], codeLine: ln.raw, lineIndex: i })
      continue
    }
  }

  flush()

  // 后处理：确保每个子程序表格后至少有一个代码行
  const processed: RenderBlock[] = []
  for (let i = 0; i < blocks.length; i++) {
    processed.push(blocks[i])
    if (blocks[i].kind === 'table' && blocks[i].tableType === 'sub') {
      const next = blocks[i + 1]
      if (!next || next.kind !== 'codeline') {
        // 找到子程序表格最后一行的 lineIndex
        const lastRow = blocks[i].rows[blocks[i].rows.length - 1]
        const afterLine = lastRow ? lastRow.lineIndex : blocks[i].lineIndex
        processed.push({
          kind: 'codeline',
          rows: [],
          codeLine: '',
          lineIndex: afterLine,
          isVirtual: true,
        })
      }
    }
  }
  return processed
}

// ========== 流程线计算 ==========

interface FlowSegment { depth: number; type: 'start' | 'end' | 'branch' | 'through'; isLoop: boolean; isMarker?: boolean; markerInnerVert?: boolean; hasInnerVert?: boolean; hasExtraEnds?: boolean; isInnerThrough?: boolean; isInnerEnd?: boolean; hasNextFlow?: boolean; hasPrevFlowEnd?: boolean; hasInnerLink?: boolean; hasOuterLink?: boolean; outerHidden?: boolean; isStraightEnd?: boolean }

interface FlowBlock { startLine: number; endLine: number; branchLines: number[]; depth: number; isLoop: boolean; keyword?: string; extraEndLines?: number[]; extraBranchLines?: number[] }

/** 从代码行提取流程关键词（处理可能的 . 前缀和自动标记） */
function extractFlowKw(codeLine: string): string | null {
  const trimmed = codeLine.replace(/^ +/, '')
  // 检查流程标记零宽字符（优先检查）
  if (trimmed.startsWith('\u200C')) return '\u200C'
  if (trimmed.startsWith('\u200D')) return '\u200D'
  if (trimmed.startsWith('\u2060')) return '\u2060'
  let stripped = trimmed.replace(/[\r\t\u200B]/g, '')
  if (stripped.startsWith('.')) stripped = stripped.slice(1)
  // 先检查长的再检查短的，避免前缀匹配错误
  const allKw = [
    '如果真结束', '如果结束', '判断结束',
    '判断循环首', '判断循环尾', '循环判断首', '循环判断尾',
    '计次循环首', '计次循环尾', '变量循环首', '变量循环尾',
    '如果真', '如果', '判断', '否则', '默认',
  ]
  for (const kw of allKw) {
    if (stripped === kw || stripped.startsWith(kw + ' ') || stripped.startsWith(kw + '(') || stripped.startsWith(kw + '（')) {
      return kw
    }
  }
  return null
}

const FLOW_START: Record<string, string> = {
  '如果': '如果结束', '如果真': '如果真结束',
  '判断': '判断结束',
  '判断循环首': '判断循环尾', '循环判断首': '循环判断尾',
  '计次循环首': '计次循环尾', '变量循环首': '变量循环尾',
}
const FLOW_LOOP_KW = new Set(['判断循环首', '循环判断首', '计次循环首', '变量循环首'])
const FLOW_LINK_COMMANDS = new Set(['如果', '如果真', '判断'])
const FLOW_BRANCH_KW = new Set(['否则', '默认', '\u200C'])
const FLOW_END_KW = new Set([...Object.values(FLOW_START), '\u200D', '\u2060'])

/** 流程控制命令自动补齐：开始关键词 → 需要插入的后续行（null 表示普通空行） */
const FLOW_AUTO_COMPLETE: Record<string, (string | null)[]> = {
  '如果': ['\u200C', '\u200D', null],
  '如果真': ['\u200D', null],
  '判断': ['\u200C', '\u2060', null],
  '判断循环首': ['判断循环尾'],
  '循环判断首': ['循环判断尾'],
  '计次循环首': ['计次循环尾'],
  '变量循环首': ['变量循环尾'],
}

/** 自动补齐的结束/分支行标记 */
const FLOW_AUTO_TAG = '\u200B'
/** 条件达成分支标记（零宽不连字） */
const FLOW_TRUE_MARK = '\u200C'
/** 否则/结束分支标记（零宽连字） */
const FLOW_ELSE_MARK = '\u200D'
/** 判断命令专用结束标记（零宽词连接符） */
const FLOW_JUDGE_END_MARK = '\u2060'

/** 检查一行是否为流程控制结构标记行（\u200C/\u200D/\u2060） */
function isFlowMarkerLine(lineText: string): boolean {
  const trimmed = lineText.replace(/^ +/, '')
  return trimmed.startsWith('\u200C') || trimmed.startsWith('\u200D') || trimmed.startsWith('\u2060')
}

/** 向上查找流程标记行对应的流程命令起始行索引 */
function findFlowStartLine(allLines: string[], markerLineIndex: number): number {
  const markerIndent = allLines[markerLineIndex].length - allLines[markerLineIndex].replace(/^ +/, '').length
  for (let i = markerLineIndex - 1; i >= 0; i--) {
    const line = allLines[i]
    const indent = line.length - line.replace(/^ +/, '').length
    if (indent !== markerIndent) continue
    const kw = extractFlowKw(line)
    if (kw && FLOW_START[kw]) return i
  }
  return -1
}

/** 流程结构区段信息 */
interface FlowSection {
  char: string | null  // '\u200C'/'\u200D'/'\u2060' 或 null（普通空行段）
  startLine: number
  endLine: number       // inclusive
  count: number
}

/**
 * 判断某行是否属于一个流程控制结构（如果/如果真/判断），
 * 返回该结构的命令行索引、各区段信息、以及当前行所在区段索引。
 * 仅对含标记+尾空行的流程命令生效（循环类不含标记行）。
 */
function getFlowStructureAround(
  allLines: string[],
  lineIndex: number
): { cmdLine: number; sections: FlowSection[]; sectionIdx: number } | null {
  // 从 lineIndex 向上扫描，跳过空行和标记行，找到流程命令行
  let cmdLine = -1
  for (let i = lineIndex; i >= 0; i--) {
    const line = allLines[i]
    const trimmed = line.replace(/^ +/, '')
    if (isFlowMarkerLine(line) || trimmed === '') continue
    const kw = extractFlowKw(line)
    if (kw && FLOW_AUTO_COMPLETE[kw]) {
      // 仅对含标记行的命令（如果/如果真/判断）进行结构保护
      const pattern = FLOW_AUTO_COMPLETE[kw]
      if (pattern.some(p => p === '\u200C' || p === '\u200D' || p === '\u2060')) {
        cmdLine = i
      }
    }
    break
  }
  if (cmdLine < 0) return null

  const kw = extractFlowKw(allLines[cmdLine])!
  const pattern = FLOW_AUTO_COMPLETE[kw]!

  // 从 cmdLine + 1 开始，按 pattern 顺序映射各区段
  const sections: FlowSection[] = []
  let pos = cmdLine + 1
  for (const p of pattern) {
    const start = pos
    if (p === null) {
      // 普通空行区段
      while (pos < allLines.length && allLines[pos].replace(/^ +/, '') === '') pos++
    } else {
      // 标记行区段
      while (pos < allLines.length && allLines[pos].replace(/^ +/, '').startsWith(p)) pos++
    }
    if (pos > start) {
      sections.push({ char: p, startLine: start, endLine: pos - 1, count: pos - start })
    }
  }

  // 检查 lineIndex 是否在结构范围内（cmdLine+1 到最后一个区段的 endLine）
  const structEnd = sections.length > 0 ? sections[sections.length - 1].endLine : cmdLine
  if (lineIndex <= cmdLine || lineIndex > structEnd) return null

  // 确定 lineIndex 所在区段
  let sectionIdx = -1
  for (let s = 0; s < sections.length; s++) {
    if (lineIndex >= sections[s].startLine && lineIndex <= sections[s].endLine) {
      sectionIdx = s
      break
    }
  }
  if (sectionIdx < 0) return null

  return { cmdLine, sections, sectionIdx }
}

function computeFlowLines(blocks: RenderBlock[]): { map: Map<number, FlowSegment[]>; maxDepth: number } {
  const stack: { keyword: string; lineIndex: number; isLoop: boolean; depth: number; branches: number[] }[] = []
  const flowBlocks: FlowBlock[] = []

  // Pass 1: match flow block pairs
  const markerLines = new Set<number>()
  // 收集代码行块用于前瞻，记录子程序/程序集边界
  const codeBlocks: RenderBlock[] = []
  const boundaryIndices = new Set<number>()  // codeBlocks 中的边界位置
  for (const blk of blocks) {
    if (blk.kind === 'table' && (blk.tableType === 'sub' || blk.tableType === 'assembly')) {
      boundaryIndices.add(codeBlocks.length)  // 下一个代码块开始新的子程序
    }
    if (blk.kind === 'codeline' && blk.codeLine) codeBlocks.push(blk)
  }
  const skipIndices = new Set<number>()
  for (let ci = 0; ci < codeBlocks.length; ci++) {
    if (skipIndices.has(ci)) continue
    // 遇到子程序/程序集边界时清空栈，防止流程线穿越子程序
    if (boundaryIndices.has(ci)) {
      stack.length = 0
    }
    const blk = codeBlocks[ci]
    const kw = extractFlowKw(blk.codeLine!)
    if (!kw) continue

    if (kw === FLOW_TRUE_MARK || kw === FLOW_ELSE_MARK || kw === FLOW_JUDGE_END_MARK) {
      markerLines.add(blk.lineIndex)
    }

    if (FLOW_START[kw]) {
      // 判断命令同缩进合并：第二个判断作为第一个判断块的分支（同层级兄弟）
      let merged = false
      if (kw === '判断' && stack.length > 0 && stack[stack.length - 1].keyword === '判断') {
        const curIndent = blk.codeLine!.length - blk.codeLine!.replace(/^ +/, '').length
        const topBlk = codeBlocks.find(cb => cb.lineIndex === stack[stack.length - 1].lineIndex)
        const topIndent = topBlk ? topBlk.codeLine!.length - topBlk.codeLine!.replace(/^ +/, '').length : -1
        if (curIndent === topIndent) {
          stack[stack.length - 1].branches.push(blk.lineIndex)
          merged = true
        }
      }
      if (!merged) {
        stack.push({ keyword: kw, lineIndex: blk.lineIndex, isLoop: FLOW_LOOP_KW.has(kw), depth: stack.length, branches: [] })
      }
    } else if (FLOW_BRANCH_KW.has(kw)) {
      if (stack.length > 0) {
        // 按缩进查找匹配的流程开始命令（防止标记行误匹配到不相关的栈条目，如循环命令）
        const branchIndent = blk.codeLine!.length - blk.codeLine!.replace(/^ +/, '').length
        let targetIdx = stack.length - 1
        for (let si = stack.length - 1; si >= 0; si--) {
          const entry = stack[si]
          const entryBlk = codeBlocks.find(cb => cb.lineIndex === entry.lineIndex)
          const entryIndent = entryBlk ? entryBlk.codeLine!.length - entryBlk.codeLine!.replace(/^ +/, '').length : -1
          if (entryIndent !== branchIndent) continue
          if (kw === FLOW_TRUE_MARK && (entry.keyword === '如果' || entry.keyword === '如果真' || entry.keyword === '判断')) { targetIdx = si; break }
          if (kw === '否则' && entry.keyword === '如果') { targetIdx = si; break }
          if (kw === '默认' && entry.keyword === '判断') { targetIdx = si; break }
        }
        // 对 \u200C 前瞻找到连续的同缩进标记行，只取最后一个作为分支
        if (kw === FLOW_TRUE_MARK) {
          const extraLines: number[] = []
          let lastBranchCi = ci
          for (let j = ci + 1; j < codeBlocks.length; j++) {
            const nextKw = extractFlowKw(codeBlocks[j].codeLine!)
            if (nextKw !== FLOW_TRUE_MARK) break
            const nextIndent = codeBlocks[j].codeLine!.length - codeBlocks[j].codeLine!.replace(/^ +/, '').length
            if (nextIndent !== branchIndent) break
            markerLines.add(codeBlocks[j].lineIndex)
            extraLines.push(blk.lineIndex)  // 当前行变成 extra
            lastBranchCi = j
            skipIndices.add(j)
            // 更新 blk 引用到最后一个
          }
          if (extraLines.length > 0) {
            // 前面的 \u200C 行作为 extraBranchLines
            const entry = stack[targetIdx]
            if (!(entry as any)._extraBranch) (entry as any)._extraBranch = []
            ;(entry as any)._extraBranch.push(...extraLines)
            // 最后一个 \u200C 作为实际分支
            stack[targetIdx].branches.push(codeBlocks[lastBranchCi].lineIndex)
          } else {
            stack[targetIdx].branches.push(blk.lineIndex)
          }
        } else {
          stack[targetIdx].branches.push(blk.lineIndex)
        }
      }
    } else if (FLOW_END_KW.has(kw)) {
      // 按缩进搜索栈中匹配的流程开始命令（防止不完整的嵌套结构阻塞匹配）
      const endIndent = blk.codeLine!.length - blk.codeLine!.replace(/^ +/, '').length
      let matchIdx = -1
      for (let si = stack.length - 1; si >= 0; si--) {
        const entry = stack[si]
        const entryBlk = codeBlocks.find(cb => cb.lineIndex === entry.lineIndex)
        const entryIndent = entryBlk ? entryBlk.codeLine!.length - entryBlk.codeLine!.replace(/^ +/, '').length : -1
        if (entryIndent !== endIndent) continue
        if (FLOW_START[entry.keyword] === kw) { matchIdx = si; break }
        if (kw === FLOW_ELSE_MARK && (entry.keyword === '如果' || entry.keyword === '如果真')) { matchIdx = si; break }
        if (kw === FLOW_JUDGE_END_MARK && entry.keyword === '判断') { matchIdx = si; break }
      }
      if (matchIdx >= 0) {
        // 弹出未匹配的中间项（用户正在编辑的不完整流程结构）
        while (stack.length > matchIdx + 1) stack.pop()
        // 对 \u200D/\u2060 前瞻找到连续的同缩进标记行
        const extraEndLines: number[] = []
        if (kw === FLOW_ELSE_MARK || kw === FLOW_JUDGE_END_MARK) {
          for (let j = ci + 1; j < codeBlocks.length; j++) {
            const nextKw = extractFlowKw(codeBlocks[j].codeLine!)
            if (nextKw !== kw) break
            const nextIndent = codeBlocks[j].codeLine!.length - codeBlocks[j].codeLine!.replace(/^ +/, '').length
            if (nextIndent !== endIndent) break
            markerLines.add(codeBlocks[j].lineIndex)
            extraEndLines.push(codeBlocks[j].lineIndex)
            skipIndices.add(j)
          }
        }
        const entry = stack.pop()!
        const extraBranch: number[] = (entry as any)._extraBranch || []
        flowBlocks.push({ startLine: entry.lineIndex, endLine: blk.lineIndex, branchLines: entry.branches, depth: entry.depth, isLoop: entry.isLoop, keyword: entry.keyword, extraEndLines: extraEndLines.length > 0 ? extraEndLines : undefined, extraBranchLines: extraBranch.length > 0 ? extraBranch : undefined })
      }
    }
  }

  // Post-processing: 如果/如果真 块中可能存在多个不连续的 \u200C 标记分支（如嵌套流程命令将连续 \u200C 序列打断），
  // 只保留最后一个 \u200C 作为真正的标记分支，前面的移为 extraBranch（through），
  // 避免中间的 \u200C 绘制多余的横向分支线和提前开始内侧竖线。
  for (const fb of flowBlocks) {
    if (fb.keyword !== '如果' && fb.keyword !== '如果真') continue
    const trueBranches = fb.branchLines.filter(bl => markerLines.has(bl))
    if (trueBranches.length <= 1) continue
    trueBranches.sort((a, b) => a - b)
    const lastTrue = trueBranches[trueBranches.length - 1]
    for (const bl of trueBranches) {
      if (bl === lastTrue) continue
      const idx = fb.branchLines.indexOf(bl)
      if (idx >= 0) fb.branchLines.splice(idx, 1)
      if (!fb.extraBranchLines) fb.extraBranchLines = []
      fb.extraBranchLines.push(bl)
    }
  }

  // Pass 2: build per-line segments
  const map = new Map<number, FlowSegment[]>()
  let maxDepth = 0
  const addSeg = (li: number, seg: FlowSegment) => {
    if (!map.has(li)) map.set(li, [])
    map.get(li)!.push(seg)
    if (seg.depth + 1 > maxDepth) maxDepth = seg.depth + 1
  }

  // Collect all rendered lineIndices
  const renderedLines = new Set<number>()
  for (const blk of blocks) {
    if (blk.kind === 'codeline') renderedLines.add(blk.lineIndex)
    else for (const row of blk.rows) renderedLines.add(row.lineIndex)
  }

  for (const fb of flowBlocks) {
    addSeg(fb.startLine, { depth: fb.depth, type: 'start', isLoop: fb.isLoop })

    // 找标记分支行
    const markerBranches = fb.branchLines.filter(bl => markerLines.has(bl))
    const lastMarkerBranch = markerBranches.length > 0 ? markerBranches[markerBranches.length - 1] : undefined

    // 结束线段（只有存在标记分支时才绘制内侧流程线，如果真等无分支命令只绘制外侧）
    const hasExtras = fb.extraEndLines && fb.extraEndLines.length > 0
    // 无标记分支但结束行是标记行（如如果真的 \u200D）：直线到底+向下箭头，无横线
    const isStraight = markerBranches.length === 0 && markerLines.has(fb.endLine)
    addSeg(fb.endLine, { depth: fb.depth, type: 'end', isLoop: fb.isLoop, isMarker: markerBranches.length > 0 && markerLines.has(fb.endLine), hasExtraEnds: hasExtras || undefined, isStraightEnd: isStraight || undefined })

    // 所有标记分支都绘制横线
    for (const bl of fb.branchLines) {
      if (markerLines.has(bl)) {
        addSeg(bl, { depth: fb.depth, type: 'branch', isLoop: fb.isLoop, isMarker: true, markerInnerVert: bl === lastMarkerBranch || undefined })
      } else {
        addSeg(bl, { depth: fb.depth, type: 'branch', isLoop: fb.isLoop })
      }
    }

    // 额外结束行（\u200D 后续行）
    if (fb.extraEndLines) {
      for (let k = 0; k < fb.extraEndLines.length; k++) {
        const el = fb.extraEndLines[k]
        const isLast = k === fb.extraEndLines.length - 1
        addSeg(el, { depth: fb.depth, type: 'through', isLoop: fb.isLoop, isInnerThrough: !isLast || undefined, isInnerEnd: isLast || undefined })
      }
    }

    // 额外分支行（\u200C 前序行，不绘制横线和内侧竖线）
    const extraBranchSet = new Set(fb.extraBranchLines || [])
    if (fb.extraBranchLines) {
      for (const el of fb.extraBranchLines) {
        addSeg(el, { depth: fb.depth, type: 'through', isLoop: fb.isLoop })
      }
    }

    // 穿过线段（含内部竖线判断）
    const markerEndLine = markerLines.has(fb.endLine) ? fb.endLine : undefined
    const lastExtraEnd = fb.extraEndLines ? fb.extraEndLines[fb.extraEndLines.length - 1] : undefined
    const innerVertEnd = lastExtraEnd ?? markerEndLine
    const firstMarkerBranch = markerBranches.length > 0 ? markerBranches[0] : undefined
    for (let li = fb.startLine + 1; li < fb.endLine; li++) {
      if (renderedLines.has(li) && !fb.branchLines.includes(li) && !extraBranchSet.has(li)) {
        const needInnerVert = firstMarkerBranch !== undefined && innerVertEnd !== undefined && li > firstMarkerBranch && li < innerVertEnd
        addSeg(li, { depth: fb.depth, type: 'through', isLoop: fb.isLoop, hasInnerVert: needInnerVert || undefined })
      }
    }
    // 非标记分支在内部竖线区域内也需要内部竖线（如判断链中的第二个判断）
    // 同时标记下一个标记分支需要下移腾出空间
    if (firstMarkerBranch !== undefined && innerVertEnd !== undefined) {
      for (const bl of fb.branchLines) {
        if (!markerLines.has(bl) && bl > firstMarkerBranch && bl < innerVertEnd) {
          const segs = map.get(bl)
          if (segs) {
            const seg = segs.find(s => s.type === 'branch' && s.depth === fb.depth)
            if (seg) {
              seg.hasInnerVert = true
              seg.hasInnerLink = true
              // 查找紧随其后的标记分支，标记为需要下移
              const nextMarker = fb.branchLines.find(b => b > bl && markerLines.has(b))
              if (nextMarker !== undefined) {
                const nextSegs = map.get(nextMarker)
                if (nextSegs) {
                  const nextSeg = nextSegs.find(s => s.type === 'branch' && s.depth === fb.depth && s.isMarker)
                  if (nextSeg) nextSeg.hasOuterLink = true
                }
              }
            }
          }
        }
      }
    }
  }

  // 检测 \u200C 标记分支后紧跟嵌套流程命令的连接
  for (const fb of flowBlocks) {
    const markerBranches = fb.branchLines.filter(bl => markerLines.has(bl))
    const lastMB = markerBranches.length > 0 ? markerBranches[markerBranches.length - 1] : undefined
    if (lastMB === undefined) continue
    const nextLine = lastMB + 1
    const nestedFb = flowBlocks.find(b => b.startLine === nextLine && b.depth > fb.depth)
    if (!nestedFb) continue
    // 在外层 through 段标记 hasInnerLink
    const throughSegs = map.get(nextLine)
    if (throughSegs) {
      const seg = throughSegs.find(s => s.type === 'through' && s.depth === fb.depth && s.hasInnerVert)
      if (seg) {
        seg.hasInnerLink = true
        seg.hasInnerVert = undefined
      }
    }
    // 在内层 start 段标记 hasOuterLink（只下移位置，不画额外连接线）
    const startSegs = map.get(nextLine)
    if (startSegs) {
      const seg = startSegs.find(s => s.type === 'start' && s.depth === nestedFb.depth)
      if (seg) seg.hasOuterLink = true
    }
    // 外层左侧竖线在 hasInnerLink 行终止，后续行和结束行隐藏外层竖线
    for (let li = nextLine + 1; li <= fb.endLine; li++) {
      const lineSegs = map.get(li)
      if (!lineSegs) continue
      const seg = lineSegs.find(s => s.depth === fb.depth)
      if (seg) {
        seg.outerHidden = true
        seg.hasInnerVert = undefined
      }
    }
    // 额外结束行也隐藏外层竖线
    if (fb.extraEndLines) {
      for (const el of fb.extraEndLines) {
        const lineSegs = map.get(el)
        if (!lineSegs) continue
        const seg = lineSegs.find(s => s.depth === fb.depth)
        if (seg) {
          seg.outerHidden = true
          seg.hasInnerVert = undefined
        }
      }
    }
  }

  // 检测 \u200D 结束标记后紧跟流程命令的连接
  for (const fb of flowBlocks) {
    if (!markerLines.has(fb.endLine)) continue
    const lastBlockLine = (fb.extraEndLines && fb.extraEndLines.length > 0)
      ? fb.extraEndLines[fb.extraEndLines.length - 1]
      : fb.endLine
    let nextLineIndex = -1
    let nextCodeLine: string | null = null
    for (const cb of codeBlocks) {
      if (cb.lineIndex > lastBlockLine) {
        nextLineIndex = cb.lineIndex
        nextCodeLine = cb.codeLine!
        break
      }
    }
    if (!nextCodeLine || nextLineIndex < 0) continue
    const nextKw = extractFlowKw(nextCodeLine)
    if (!nextKw || !FLOW_LINK_COMMANDS.has(nextKw)) continue
    // 必须紧挨着：下一个流程命令行号必须紧跟在结束标记后（中间不允许有任何代码行）
    if (nextLineIndex !== lastBlockLine + 1) continue
    // 确保下一个流程块与当前块同深度
    const nextFb = flowBlocks.find(b => b.startLine === nextLineIndex)
    if (!nextFb || nextFb.depth !== fb.depth) continue

    if (fb.extraEndLines && fb.extraEndLines.length > 0) {
      // 有额外结束行：将最后一个额外结束行的内部竖线改为穿过
      const lastExtra = fb.extraEndLines[fb.extraEndLines.length - 1]
      const extraSegs = map.get(lastExtra)
      if (extraSegs) {
        const seg = extraSegs.find(s => s.isInnerEnd && s.depth === fb.depth)
        if (seg) { seg.isInnerEnd = undefined; seg.isInnerThrough = true; seg.hasNextFlow = true }
      }
    } else {
      // 无额外结束行：标记结束段内部竖线穿过
      const endSegs = map.get(fb.endLine)
      if (endSegs) {
        const seg = endSegs.find(s => s.type === 'end' && s.depth === fb.depth && s.isMarker)
        if (seg) seg.hasNextFlow = true
      }
    }
    // 标记下一个流程块起始段
    const startSegs = map.get(nextLineIndex)
    if (startSegs) {
      const seg = startSegs.find(s => s.type === 'start' && s.depth === fb.depth)
      if (seg) seg.hasPrevFlowEnd = true
    }
  }

  return { map, maxDepth }
}

// ========== 代码行着色 ==========

interface Span { text: string; cls: string }

interface CompletionParam { name: string; type: string; description: string; optional: boolean; isVariable: boolean; isArray: boolean }
interface CompletionItem { name: string; englishName: string; description: string; returnType: string; category: string; libraryName: string; isMember: boolean; ownerTypeName: string; params: CompletionParam[] }

const FLOW_KW = new Set([
  '如果真', '如果真结束', '判断', '判断结束', '默认', '否则',
  '如果', '返回', '结束', '到循环尾', '跳出循环',
  '循环判断首', '循环判断尾', '判断循环首', '判断循环尾',
  '计次循环首', '计次循环尾', '变量循环首', '变量循环尾', '如果结束',
])

function colorize(raw: string): Span[] {
  const trimmed = raw.replace(/[\r\t]/g, '')
  let stripped = trimmed.replace(/^ +/, '')
  const indent = trimmed.length - stripped.length
  // 剥离流程标记零宽字符
  if (stripped.startsWith('\u200C') || stripped.startsWith('\u200D') || stripped.startsWith('\u2060')) {
    stripped = stripped.slice(1)
  }
  if (!stripped) return [{ text: '', cls: '' }]

  // 注释
  if (stripped.startsWith("'")) {
    return [
      ...(indent > 0 ? [{ text: '\u00A0'.repeat(indent), cls: '' }] : []),
      { text: stripped, cls: 'Remarkscolor' },
    ]
  }

  // 提取备注
  let code = stripped, remark = ''
  const ri = findRemark(stripped)
  if (ri >= 0) { code = stripped.slice(0, ri).trimEnd(); remark = stripped.slice(ri) }

  const spans: Span[] = []

  // 缩进树线
  if (indent > 0) {
    const lvl = Math.floor(indent / 4)
    for (let l = 0; l < lvl; l++) spans.push({ text: '\u2502\u00A0\u00A0\u00A0', cls: 'eTreeLine' })
    const ex = indent % 4
    if (ex > 0) spans.push({ text: '\u00A0'.repeat(ex), cls: '' })
  }

  // 流程控制以.开头
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
    // 易语言中，非 . 开头的代码行首标识符视为命令调用
    // colorExpr 只在后面有括号时才标记 funccolor，这里补充处理无括号的情况
    if (exprSpans.length > 0 && exprSpans[0].cls === '') {
      const firstText = exprSpans[0].text
      const m = firstText.match(/^([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*)(.*)/)
      if (m) {
        const ident = m[1]
        const rest = m[2]
        // 后面紧跟 = 或 ＝ 的是赋值目标，不是命令调用
        if (/^\s*[=＝]/.test(rest)) {
          // 赋值目标：标记为 assignTarget，后续由渲染层检查有效性
          exprSpans.splice(0, 1,
            { text: ident, cls: 'assignTarget' },
            ...(rest ? [{ text: rest, cls: '' }] : [])
          )
        } else {
          exprSpans.splice(0, 1,
            { text: ident, cls: ident.includes('.') ? 'cometwolr' : 'funccolor' },
            ...(rest ? [{ text: rest, cls: '' }] : [])
          )
        }
      }
    }
    spans.push(...exprSpans)
  }

  if (remark) { spans.push({ text: ' ', cls: '' }); spans.push({ text: remark, cls: 'Remarkscolor' }) }
  return spans
}

function findRemark(s: string): number {
  let inS = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inS) { if (c === '"' || c === '\u201d') inS = false; continue }
    if (c === '"' || c === '\u201c') { inS = true; continue }
    if (c === "'" && i > 0) return i
  }
  return -1
}

function colorExpr(expr: string): Span[] {
  const out: Span[] = []
  let r = expr
  while (r.length > 0) {
    // 字符串
    const sm = r.match(/^([""\u201c])(.*?)([""\u201d])/)
    if (sm && r.startsWith(sm[1])) { out.push({ text: sm[0], cls: 'eTxtcolor' }); r = r.slice(sm[0].length); continue }

    // 常量 #
    if (r.startsWith('#')) {
      const end = r.slice(1).search(/[\s(（)）,，+＋\-－×÷=＝>＞<＜≥≤≈≠;：]/)
      const cn = end >= 0 ? r.slice(0, end + 1) : r
      out.push({ text: cn, cls: 'conscolor' }); r = r.slice(cn.length); continue
    }

    // 真/假
    const bm = r.match(/^(真|假)(?=[\s(（)）,，=＝]|$)/)
    if (bm) { out.push({ text: bm[0], cls: 'conscolor' }); r = r.slice(bm[0].length); continue }

    // 且/或
    const lm = r.match(/^(且|或)(?=[\s(（)）,，]|$)/)
    if (lm) { out.push({ text: lm[0], cls: 'funccolor' }); r = r.slice(lm[0].length); continue }

    // 括号
    if ('()（）{}[]'.includes(r[0])) { out.push({ text: r[0], cls: 'conscolor' }); r = r.slice(1); continue }

    // 函数调用（名字后面紧跟括号）
    const fm = r.match(/^([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*)\s*(?=[(\uff08])/)
    if (fm) {
      const name = fm[1]
      if (name.includes('.')) { out.push({ text: name, cls: 'cometwolr' }) }
      else if (FLOW_KW.has(name)) { out.push({ text: name, cls: 'comecolor' }) }
      else { out.push({ text: name, cls: 'funccolor' }) }
      r = r.slice(name.length); continue
    }

    // 普通文本
    const pm = r.match(/^[^""\u201c#(（)）{}\[\]]+/)
    if (pm) { out.push({ text: pm[0], cls: '' }); r = r.slice(pm[0].length); continue }
    out.push({ text: r[0], cls: '' }); r = r.slice(1)
  }
  return out
}

// ========== 行重建 ==========

const DECL_PREFIXES = [
  '.程序集变量 ', '.程序集 ', '.子程序 ', '.局部变量 ',
  '.全局变量 ', '.常量 ', '.数据类型 ', '.DLL命令 ',
  '.图片 ', '.声音 ', '.参数 ', '.成员 ',
]

function rebuildLineField(rawLine: string, fieldIdx: number, newValue: string, isSlice: boolean): string {
  const line = rawLine.replace(/\r/g, '')
  const stripped = line.replace(/^ +/, '')
  const indent = line.length - stripped.length

  for (const pf of DECL_PREFIXES) {
    if (stripped.startsWith(pf)) {
      const fieldsStr = stripped.slice(pf.length)
      const fields = splitCSV(fieldsStr)

      if (isSlice) {
        fields.splice(fieldIdx, fields.length - fieldIdx, newValue)
      } else {
        while (fields.length <= fieldIdx) fields.push('')
        fields[fieldIdx] = newValue
      }

      // 去除尾部空字段，避免产生多余逗号
      while (fields.length > 0 && fields[fields.length - 1] === '') fields.pop()

      return ' '.repeat(indent) + pf + fields.join(', ')
    }
  }

  return rawLine
}

// ========== 组件 ==========

export interface EycTableEditorHandle {
  insertSubroutine: () => void
  insertLocalVariable: () => void
  navigateOrCreateSub: (subName: string, params: Array<{ name: string; dataType: string; isByRef: boolean }>) => void
  navigateToLine: (line: number) => void
  editorAction: (action: string) => void
}

interface EycTableEditorProps {
  value: string
  onChange: (value: string) => void
  onCommandClick?: (commandName: string, paramIndex?: number) => void
  onCommandClear?: () => void
  onProblemsChange?: (problems: FileProblem[]) => void
  onCursorChange?: (line: number, column: number) => void
}

export interface FileProblem {
  line: number
  column: number
  message: string
  severity: 'error' | 'warning'
}

interface EditState {
  lineIndex: number
  cellIndex: number
  fieldIdx: number    // -1 表示无字段映射（代码行编辑整行）
  sliceField: boolean
  isVirtual?: boolean // 虚拟代码行（编辑时插入而非替换）
  paramIdx?: number   // 展开参数编辑：第几个参数 (0-based)
}

/** 根据命令类别返回图标字符 */
function getCmdIconLabel(category: string): string {
  const cat = category.toLowerCase()
  if (cat.includes('窗口') || cat.includes('组件') || cat.includes('控件')) return '◻'
  if (cat.includes('事件')) return '⚡'
  if (cat.includes('属性')) return '◆'
  if (cat.includes('方法') || cat.includes('成员')) return 'ƒ'
  if (cat.includes('常量')) return 'C'
  if (cat.includes('数据') || cat.includes('类型')) return 'T'
  if (cat.includes('流程') || cat.includes('控制')) return '⇥'
  if (cat.includes('文件') || cat.includes('磁盘')) return '📄'
  if (cat.includes('网络') || cat.includes('通信')) return '🌐'
  if (cat.includes('系统') || cat.includes('环境')) return '⚙'
  if (cat.includes('算') || cat.includes('数学')) return '∑'
  if (cat.includes('文本') || cat.includes('字符')) return 'S'
  if (cat.includes('时间') || cat.includes('日期')) return '⏱'
  if (cat.includes('数组')) return '[]'
  if (cat.includes('绘图') || cat.includes('图形')) return '🖌'
  return 'ƒ'
}

/** 根据命令类别返回图标CSS类 */
function getCmdIconClass(category: string): string {
  const cat = category.toLowerCase()
  if (cat.includes('窗口') || cat.includes('组件') || cat.includes('控件')) return 'eyc-ac-icon-widget'
  if (cat.includes('事件')) return 'eyc-ac-icon-event'
  if (cat.includes('属性')) return 'eyc-ac-icon-prop'
  if (cat.includes('常量')) return 'eyc-ac-icon-const'
  if (cat.includes('数据') || cat.includes('类型')) return 'eyc-ac-icon-type'
  if (cat.includes('流程') || cat.includes('控制')) return 'eyc-ac-icon-flow'
  return 'eyc-ac-icon-func'
}

/** 找到文本中最外层括号的位置范围 (start=开括号位置, end=闭括号位置) */
function getOuterParenRange(text: string): { start: number; end: number } | null {
  const openIdx = text.search(/[(（]/)
  if (openIdx < 0) return null
  let depth = 0
  let inStr = false
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i]
    if (inStr) { if (ch === '"' || ch === '\u201d') inStr = false; continue }
    if (ch === '"' || ch === '\u201c') { inStr = true; continue }
    if (ch === '(' || ch === '（') depth++
    else if (ch === ')' || ch === '）') {
      depth--
      if (depth === 0) return { start: openIdx, end: i }
    }
  }
  return null
}

const EycTableEditor = forwardRef<EycTableEditorHandle, EycTableEditorProps>(function EycTableEditor({ value, onChange, onCommandClick, onCommandClear, onProblemsChange, onCursorChange }, ref) {
  const [editCell, setEditCell] = useState<EditState | null>(null)
  const [editVal, setEditVal] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const paramInputRef = useRef<HTMLInputElement>(null)
  const prevRef = useRef(value)
  const [currentText, setCurrentText] = useState(value)
  const lastFocusedLine = useRef<number>(-1)
  const flowMarkRef = useRef<string>('')
  const flowIndentRef = useRef<string>('')
  const userVarNamesRef = useRef<Set<string>>(new Set())
  const wasFlowStartRef = useRef(false) // 编辑行是否为流程起始行（用于防止流程命令缩进翻倍）
  const commitGuardRef = useRef(false) // 防止 commit 被重复调用（mousedown + blur-on-unmount）
  const editCellOrigValRef = useRef<string>('') // 表格单元格编辑前的原始值（liveUpdate 会实时更新 lines，需保存原始值用于重命名比较）
  const [expandedLines, setExpandedLines] = useState<Set<number>>(new Set())

  // ===== 行选择状态 =====
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set())
  const dragAnchor = useRef<number | null>(null)  // 拖选起点行号
  const isDragging = useRef(false)
  const dragStartPos = useRef<{ x: number; y: number } | null>(null)
  const wasDragSelect = useRef(false)
  const pendingInputDragRef = useRef<{ lineIndex: number; x: number; y: number } | null>(null)

  // ===== 撤销/重做栈 =====
  const undoStack = useRef<string[]>([])
  const redoStack = useRef<string[]>([])
  const pushUndo = useCallback((oldText: string) => {
    undoStack.current.push(oldText)
    if (undoStack.current.length > 200) undoStack.current.shift()
    redoStack.current = []
  }, [])

  // ===== 行选择：拖选逻辑 =====
  // 从行号到实际元素的映射（用于鼠标位置判定）
  const wrapperRef = useRef<HTMLDivElement>(null)

  /** 根据鼠标 Y 坐标找到对应的行号 */
  const findLineAtY = useCallback((clientY: number): number => {
    if (!wrapperRef.current) return -1
    const rows = wrapperRef.current.querySelectorAll<HTMLElement>('[data-line-index]')
    let closest = -1
    for (const el of rows) {
      const li = parseInt(el.dataset.lineIndex!, 10)
      const rect = el.getBoundingClientRect()
      if (clientY >= rect.top && clientY < rect.bottom) return li
      if (clientY >= rect.top) closest = li
    }
    return closest
  }, [])

  /** 计算 anchor 到 end 之间的行集合 */
  const rangeSet = useCallback((a: number, b: number): Set<number> => {
    const lo = Math.min(a, b), hi = Math.max(a, b)
    const s = new Set<number>()
    for (let i = lo; i <= hi; i++) s.add(i)
    return s
  }, [])

  const handleLineMouseDown = useCallback((e: React.MouseEvent, lineIndex: number) => {
    // 正在编辑的输入框中不处理
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    // 命令点击不触发选择
    if ((e.target as HTMLElement).classList.contains('eyc-cmd-clickable')) return

    e.preventDefault()
    // 如果有活跃编辑，先提交当前编辑（含自动补全上屏）
    if (editCellRef.current) {
      commitRef.current()
    }
    dragStartPos.current = { x: e.clientX, y: e.clientY }
    wasDragSelect.current = false
    if (e.shiftKey && dragAnchor.current !== null) {
      // Shift+点击: 扩展选择到当前行
      setSelectedLines(rangeSet(dragAnchor.current, lineIndex))
    } else {
      dragAnchor.current = lineIndex
      // 普通单击不立即标记行选中，避免蓝色闪烁；只有实际拖动时才设置
    }
    isDragging.current = true
    // 聚焦 wrapper 以便接收键盘事件（Delete等）
    wrapperRef.current?.focus()
  }, [rangeSet])

  // mousemove 和 mouseup 全局监听
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!isDragging.current && pendingInputDragRef.current) {
        const p = pendingInputDragRef.current
        // 判断鼠标是否已离开 input 元素边界
        const inputEl = inputRef.current
        if (inputEl) {
          const rect = inputEl.getBoundingClientRect()
          const outside = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom
          if (outside) {
            if (editCellRef.current) commitRef.current()
            dragStartPos.current = { x: p.x, y: p.y }
            dragAnchor.current = p.lineIndex
            setSelectedLines(new Set([p.lineIndex]))
            isDragging.current = true
            wasDragSelect.current = true
            wrapperRef.current?.focus()
          }
        }
      }
      if (!isDragging.current || dragAnchor.current === null) return
      if (dragStartPos.current) {
        const dx = e.clientX - dragStartPos.current.x
        const dy = e.clientY - dragStartPos.current.y
        if (dx * dx + dy * dy > 25) wasDragSelect.current = true
      }
      // 只有确认是拖动后才更新行选中，避免普通点击时也出现蓝色高亮
      if (!wasDragSelect.current) return
      const li = findLineAtY(e.clientY)
      if (li >= 0) {
        // 确保锚点行也被选中（首次拖入超过阈值时）
        setSelectedLines(rangeSet(dragAnchor.current, li))
      }
    }
    const onUp = (): void => {
      isDragging.current = false
      pendingInputDragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [findLineAtY, rangeSet])

  // 全局键盘处理（选择状态下 Ctrl+C 复制、Delete 删除；Ctrl+A 全选）
  useEffect(() => {
    const getFirstDeclarationLine = (ls: string[]): number => {
      const parsed = parseLines(ls.join('\n'))
      for (let i = 0; i < parsed.length; i++) {
        const tp = parsed[i].type
        if (tp !== 'blank' && tp !== 'comment' && tp !== 'code' && tp !== 'version' && tp !== 'supportLib') return i
      }
      return -1
    }

    const getDeletableSelection = (ls: string[], selection: Set<number>): { protectedLine: number; deletable: Set<number>; sorted: number[] } => {
      const protectedLine = getFirstDeclarationLine(ls)
      const deletable = new Set<number>()
      for (const i of selection) {
        if (i < 0 || i >= ls.length) continue
        if (i === protectedLine) continue
        deletable.add(i)
      }
      return { protectedLine, deletable, sorted: [...deletable].sort((a, b) => a - b) }
    }

    const handler = (e: KeyboardEvent): void => {
      // 正在编辑输入框时不处理（交给 onKey）
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      // 检查焦点是否在本编辑器区域内
      const inEditor = wrapperRef.current?.contains(document.activeElement as Node)
        || document.activeElement === wrapperRef.current
        || document.activeElement === document.body
        || wrapperRef.current?.closest('.eyc-table-editor')?.contains(document.activeElement as Node)

      const ctrl = e.ctrlKey || e.metaKey

      // Ctrl+A：全选所有行（只要焦点在编辑器区域）
      if (ctrl && e.key === 'a' && inEditor) {
        e.preventDefault()
        const ls = currentText.split('\n')
        const all = new Set<number>()
        for (let i = 0; i < ls.length; i++) all.add(i)
        setSelectedLines(all)
        dragAnchor.current = 0
        return
      }

      // Ctrl+Z / Ctrl+Y：撤销/重做（编辑器区域内）
      if (ctrl && e.key === 'z' && inEditor) {
        e.preventDefault()
        if (undoStack.current.length > 0) {
          const prev = undoStack.current.pop()!
          redoStack.current.push(currentText)
          setCurrentText(prev); prevRef.current = prev; onChange(prev)
        }
        return
      }
      if (ctrl && e.key === 'y' && inEditor) {
        e.preventDefault()
        if (redoStack.current.length > 0) {
          const next = redoStack.current.pop()!
          undoStack.current.push(currentText)
          setCurrentText(next); prevRef.current = next; onChange(next)
        }
        return
      }

      // Ctrl+V：粘贴多行内容
      if (ctrl && e.key === 'v' && inEditor) {
        e.preventDefault()
        navigator.clipboard.readText().then(clipText => {
          if (!clipText) return
          const sanitized = sanitizePastedTextForCurrent(clipText, currentText)
          const pastedLines = sanitized.split('\n').map(l => l.replace(/\r$/, ''))
          const ls = currentText.split('\n')
          pushUndo(currentText)
          if (selectedLines.size > 0) {
            // 有选中行：在第一个选中行位置替换选中行
            const { protectedLine, deletable, sorted } = getDeletableSelection(ls, selectedLines)
            const insertAt = sorted.length > 0
              ? sorted[0]
              : (protectedLine >= 0 ? Math.min(protectedLine + 1, ls.length) : ls.length)
            const nl = ls.filter((_, i) => !deletable.has(i))
            nl.splice(insertAt, 0, ...pastedLines)
            const nt = nl.join('\n')
            setCurrentText(nt); prevRef.current = nt; onChange(nt)
            // 选中粘贴后的行
            const newSel = new Set<number>()
            for (let i = 0; i < pastedLines.length; i++) newSel.add(insertAt + i)
            setSelectedLines(newSel)
          } else {
            // 无选中行：追加到末尾
            const nl = [...ls, ...pastedLines]
            const nt = nl.join('\n')
            setCurrentText(nt); prevRef.current = nt; onChange(nt)
            const newSel = new Set<number>()
            for (let i = 0; i < pastedLines.length; i++) newSel.add(ls.length + i)
            setSelectedLines(newSel)
          }
        })
        return
      }

      // 以下操作需要有选中行且焦点在编辑器内
      if (selectedLines.size === 0 || !inEditor) return

      if (ctrl && e.key === 'c') {
        e.preventDefault()
        const sorted = [...selectedLines].sort((a, b) => a - b)
        const ls = currentText.split('\n')
        const selectedText = eycToYiFormat(sorted.filter(i => i < ls.length).map(i => ls[i]).join('\n'))
        navigator.clipboard.writeText(selectedText)
        return
      }
      if (ctrl && e.key === 'x') {
        e.preventDefault()
        const ls = currentText.split('\n')
        const { deletable, sorted } = getDeletableSelection(ls, selectedLines)
        if (sorted.length === 0) return
        const selectedText = eycToYiFormat(sorted.map(i => ls[i]).join('\n'))
        navigator.clipboard.writeText(selectedText)
        // 检查删除后是否会破坏流程结构（各区段最少保留1行）
        const checkedCmds = new Set<number>()
        const wouldBreak = sorted.some(i => {
          if (i >= ls.length) return false
          const st = getFlowStructureAround(ls, i)
          if (!st || checkedCmds.has(st.cmdLine)) return false
          checkedCmds.add(st.cmdLine)
          if (deletable.has(st.cmdLine)) return false // 命令行也选中，允许整体删除
          return st.sections.some(sec => {
            let remaining = 0
            for (let j = sec.startLine; j <= sec.endLine; j++) { if (!deletable.has(j)) remaining++ }
            return remaining < 1
          })
        })
        if (wouldBreak) return
        // 删除选中行
        pushUndo(currentText)
        const nl = ls.filter((_, i) => !deletable.has(i))
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt)
        setSelectedLines(new Set())
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        const ls = currentText.split('\n')
        // 检查删除后是否会破坏流程结构（各区段最少保留1行）
        const { deletable, sorted: sortedSel } = getDeletableSelection(ls, selectedLines)
        if (sortedSel.length === 0) return
        const checkedCmds2 = new Set<number>()
        const wouldBreak2 = sortedSel.some(i => {
          if (i >= ls.length) return false
          const st = getFlowStructureAround(ls, i)
          if (!st || checkedCmds2.has(st.cmdLine)) return false
          checkedCmds2.add(st.cmdLine)
          if (deletable.has(st.cmdLine)) return false
          return st.sections.some(sec => {
            let remaining = 0
            for (let j = sec.startLine; j <= sec.endLine; j++) { if (!deletable.has(j)) remaining++ }
            return remaining < 1
          })
        })
        if (wouldBreak2) return
        pushUndo(currentText)
        const nl = ls.filter((_, i) => !deletable.has(i))
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt)
        setSelectedLines(new Set())
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedLines, currentText, onChange, pushUndo])

  // ===== 自动补全状态 =====
  interface AcDisplayItem { cmd: CompletionItem; engMatch: boolean }
  const [acItems, setAcItems] = useState<AcDisplayItem[]>([])
  const [acIndex, setAcIndex] = useState(0)
  const [acVisible, setAcVisible] = useState(false)
  const [acPos, setAcPos] = useState({ left: 0, top: 0 })
  const allCommandsRef = useRef<CompletionItem[]>([])
  const memberCommandsRef = useRef<CompletionItem[]>([])
  const [cmdLoadId, setCmdLoadId] = useState(0) // 触发重新验证
  const acWordStartRef = useRef(0) // 当前补全词在 editVal 中的起始位置
  const acListRef = useRef<HTMLDivElement>(null)
  // 用 ref 跟踪最新值，以便在 useCallback 闭包中访问（避免依赖项膨胀）
  const editCellRef = useRef(editCell)
  editCellRef.current = editCell
  const acVisibleRef = useRef(false)
  acVisibleRef.current = acVisible
  const acItemsRef = useRef<AcDisplayItem[]>([])
  acItemsRef.current = acItems
  const userVarCompletionItemsRef = useRef<CompletionItem[]>([])

  // 加载所有命令（用于补全），含流程关键字
  const reloadCommands = useCallback(() => {
    window.api.library.getAllCommands().then((cmds: CompletionItem[]) => {
      const seen = new Set<string>()
      const mapCmd = (c: CompletionItem) => ({
        name: c.name,
        englishName: c.englishName || '',
        description: c.description || '',
        returnType: c.returnType || '',
        category: c.category || '',
        libraryName: (c as CompletionItem & { libraryName?: string }).libraryName || '',
        isMember: !!(c as CompletionItem & { isMember?: boolean }).isMember,
        ownerTypeName: (c as CompletionItem & { ownerTypeName?: string }).ownerTypeName || '',
        params: (c.params || []).map((p: CompletionParam) => ({ name: p.name, type: p.type, description: p.description || '', optional: !!p.optional, isVariable: !!p.isVariable, isArray: !!p.isArray })),
      })
      // 独立函数命令（排除成员命令）
      const independentItems: CompletionItem[] = cmds
        .filter((c: CompletionItem & { isHidden?: boolean; isMember?: boolean }) => !c.isHidden && !c.isMember)
        .map(mapCmd)
        .filter(c => { if (seen.has(c.name)) return false; seen.add(c.name); return true })
      allCommandsRef.current = independentItems
      // 成员命令（属于组件/数据类型）
      const memberItems: CompletionItem[] = cmds
        .filter((c: CompletionItem & { isHidden?: boolean; isMember?: boolean }) => !c.isHidden && c.isMember)
        .map(mapCmd)
      memberCommandsRef.current = memberItems
      setCmdLoadId(n => n + 1)
    }).catch(() => {})
  }, [])

  // 初始加载 + 支持库变更时重新加载命令
  useEffect(() => {
    reloadCommands()
    window.api.on('library:loaded', reloadCommands)
    return () => { window.api.off('library:loaded') }
  }, [reloadCommands])

  // 确保选中项始终可见
  useEffect(() => {
    if (acVisible && acListRef.current) {
      const selected = acListRef.current.children[acIndex] as HTMLElement | undefined
      selected?.scrollIntoView({ block: 'nearest' })
    }
  }, [acIndex, acVisible])

  /** 根据光标位置的"词"更新补全列表 */
  const updateCompletion = useCallback((val: string, cursorPos: number) => {
    // 仅在代码行编辑模式下触发补全
    if (!editCell || editCell.cellIndex >= 0) { setAcVisible(false); return }

    // 向前找当前输入词的起始位置（中文/英文/下划线连续字符）
    let wordStart = cursorPos
    while (wordStart > 0 && /[\u4e00-\u9fa5A-Za-z0-9_]/.test(val[wordStart - 1])) wordStart--
    const word = val.slice(wordStart, cursorPos)

    if (word.length === 0) { setAcVisible(false); return }

    acWordStartRef.current = wordStart

    // 检查是否在"组件名."后面 → 显示成员命令
    let sourceList: CompletionItem[] = [...userVarCompletionItemsRef.current, ...allCommandsRef.current]
    if (wordStart > 0 && val[wordStart - 1] === '.') {
      // 提取点号前的组件名
      let objEnd = wordStart - 1
      let objStart = objEnd
      while (objStart > 0 && /[\u4e00-\u9fa5A-Za-z0-9_]/.test(val[objStart - 1])) objStart--
      const objName = val.slice(objStart, objEnd)
      if (objName.length > 0) {
        // 过滤出属于该数据类型的成员命令
        const memberCmds = memberCommandsRef.current.filter(c => c.ownerTypeName === objName)
        if (memberCmds.length > 0) {
          sourceList = memberCmds
        }
      }
    }

    // 过滤并排序
    const matches = sourceList
      .map(cmd => ({ cmd, score: matchScore(word, cmd.name, cmd.englishName) }))
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score || a.cmd.name.length - b.cmd.name.length)
      .slice(0, 30)
      .map(m => ({ cmd: m.cmd, engMatch: isEnglishMatch(word, m.cmd.englishName) && !m.cmd.name.includes(word) }))

    if (matches.length === 0) { setAcVisible(false); return }

    // 计算弹窗位置
    if (inputRef.current) {
      const input = inputRef.current
      const rect = input.getBoundingClientRect()
      // 用 canvas 估算光标像素位置
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      let leftOffset = 0
      if (ctx) {
        ctx.font = getComputedStyle(input).font || '13px Consolas, "Microsoft YaHei", monospace'
        leftOffset = ctx.measureText(val.slice(0, wordStart)).width
      }
      setAcPos({
        left: rect.left + leftOffset,
        top: rect.bottom + 2,
      })
    }

    setAcItems(matches)
    setAcIndex(0)
    setAcVisible(true)
  }, [editCell])

  /** 应用补全项：替换当前输入词为命令名 */
  const applyCompletion = useCallback((displayItem: AcDisplayItem) => {
    const item = displayItem.cmd
    const wordStart = acWordStartRef.current
    const cursorPos = inputRef.current?.selectionStart ?? editVal.length
    const before = editVal.slice(0, wordStart)
    const after = editVal.slice(cursorPos)
    const newVal = before + item.name + after
    setEditVal(newVal)
    setAcVisible(false)
    setTimeout(() => {
      if (inputRef.current) {
        const newPos = wordStart + item.name.length
        inputRef.current.selectionStart = newPos
        inputRef.current.selectionEnd = newPos
        inputRef.current.focus()
      }
    }, 0)
  }, [editVal])

  /** 代码行编辑结束时自动补全括号（格式化命令），返回 [主行, ...需要插入的后续行] */
  const formatCommandLine = useCallback((val: string): string[] => {
    const trimmed = val.trimStart()
    if (!trimmed || trimmed.startsWith("'")) return [val]

    // 赋值表达式：identifier = expr → 格式化运算符
    const assignM = trimmed.match(/^([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*)\s*(?:=(?!=)|＝)/)
    if (assignM && userVarNamesRef.current.has(assignM[1])) {
      const indentLen = val.length - trimmed.length
      return [val.slice(0, indentLen) + formatOps(trimmed)]
    }

    const indent = val.length - trimmed.length
    const prefix = val.slice(0, indent)

    // 提取命令名（支持“命令名”或“命令名 (...)”两种输入）
    const cmdName = trimmed.split(/[\s(（]/)[0]
    if (!/^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*$/.test(cmdName)) return [val]

    // 流程控制命令自动补齐后续行
    const autoLines = FLOW_AUTO_COMPLETE[cmdName]
    if (autoLines) {
      const cmd = allCommandsRef.current.find(c => c.name === cmdName)
      // 命令本身和内部代码行都缩进4空格（两个汉字宽度）给流程线留空间
      const innerPrefix = prefix + '    '
      let mainLine: string
      const parenRange = getOuterParenRange(trimmed)
      if (parenRange) {
        // 已输入括号时尽量保留用户输入参数内容，再做流程补齐
        const argText = trimmed.slice(parenRange.start + 1, parenRange.end).trim()
        mainLine = innerPrefix + cmdName + ' (' + argText + ')'
      } else if (cmd && cmd.params.length > 0) {
        const paramSlots = cmd.params.map(p => p.optional ? '' : '').join(', ')
        mainLine = innerPrefix + cmdName + ' (' + paramSlots + ')'
      } else {
        mainLine = innerPrefix + cmdName + ' ()'
      }
      // 自动插入的分支/结束行
      const extra = autoLines.map(kw => {
        if (kw === null) return ''
        if (kw === FLOW_TRUE_MARK || kw === FLOW_ELSE_MARK || kw === FLOW_JUDGE_END_MARK) return innerPrefix + kw
        // 流程尾命令也需要括号（如 计次循环尾）
        const tailCmd = allCommandsRef.current.find(c => c.name === kw)
        if (tailCmd && tailCmd.params.length > 0) {
          const tailSlots = tailCmd.params.map(p => p.optional ? '' : '').join(', ')
          return innerPrefix + FLOW_AUTO_TAG + kw + ' (' + tailSlots + ')'
        }
        return innerPrefix + FLOW_AUTO_TAG + kw + ' ()'
      })
      return [mainLine, ...extra]
    }

    // 普通命令：仅对“裸命令名”自动补括号
    const m = trimmed.match(/^([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*)\s*$/)
    if (!m) return [val]

    if (trimmed.startsWith('.')) return [val]
    const cmd = allCommandsRef.current.find(c => c.name === cmdName)
    if (!cmd) return [val]

    if (cmd.params.length === 0) {
      return [prefix + cmdName + ' ()']
    }
    const paramSlots = cmd.params.map(p => p.optional ? '' : '').join(', ')
    return [prefix + cmdName + ' (' + paramSlots + ')']
  }, [])

  useEffect(() => {
    if (value !== prevRef.current) { setCurrentText(value); prevRef.current = value }
  }, [value])

  const lines = useMemo(() => currentText.split('\n'), [currentText])
  const blocks = useMemo<RenderBlock[]>(() => {
    try {
      return buildBlocks(currentText)
    } catch (error) {
      console.error('[EycTableEditor] buildBlocks failed, fallback to line blocks', error)
      return currentText.split('\n').map((line, idx): RenderBlock => ({
        kind: 'codeline' as const,
        rows: [],
        codeLine: line,
        lineIndex: idx,
        isVirtual: false,
      }))
    }
  }, [currentText])
  const flowLines = useMemo(() => {
    try {
      return computeFlowLines(blocks)
    } catch (error) {
      console.error('[EycTableEditor] computeFlowLines failed, disable flow rendering for current content', error)
      return { map: new Map<number, FlowSegment[]>(), maxDepth: 0 }
    }
  }, [blocks])

  // 只对实际渲染的可见行按顺序分配连续行号（跳过 isHeader / isVirtual）
  const lineNumMap = useMemo<Map<number, number>>(() => {
    const map = new Map<number, number>()
    let display = 0
    for (const blk of blocks) {
      if (blk.kind === 'table') {
        for (const row of blk.rows) {
          if (!row.isHeader && !map.has(row.lineIndex)) {
            display++
            map.set(row.lineIndex, display)
          }
        }
      } else {
        if (!blk.isVirtual && !map.has(blk.lineIndex)) {
          display++
          map.set(blk.lineIndex, display)
        }
      }
    }
    return map
  }, [blocks])

  const getSelectedSourceText = useCallback((): string => {
    const sorted = [...selectedLines].sort((a, b) => a - b)
    const ls = currentText.split('\n')
    const raw = sorted.filter(i => i >= 0 && i < ls.length).map(i => ls[i]).join('\n')
    return eycToYiFormat(raw)
  }, [selectedLines, currentText])

  // 收集用户定义的子程序名和变量名
  const { userSubNames, userVarNames } = useMemo(() => {
    const subs = new Set<string>()
    const vars = new Set<string>()
    const parsed = parseLines(currentText)
    for (const ln of parsed) {
      if (ln.type === 'sub' && ln.fields[0]) subs.add(ln.fields[0])
      if ((ln.type === 'localVar' || ln.type === 'subParam' || ln.type === 'assemblyVar' || ln.type === 'globalVar') && ln.fields[0]) vars.add(ln.fields[0])
    }
    return { userSubNames: subs, userVarNames: vars }
  }, [currentText])
  useEffect(() => { userVarNamesRef.current = userVarNames }, [userVarNames])

  // 生成用于补全的用户变量项（局部/参数按当前子程序作用域）
  const userVarCompletionItems = useMemo<CompletionItem[]>(() => {
    const parsed = parseLines(currentText)
    const cursorLine = editCell?.lineIndex ?? -1

    let subStart = -1
    let subEnd = parsed.length
    if (cursorLine >= 0 && cursorLine < parsed.length) {
      for (let i = cursorLine; i >= 0; i--) {
        const t = parsed[i].type
        if (t === 'sub') { subStart = i; break }
        if (t === 'assembly') break
      }
      if (subStart >= 0) {
        for (let i = subStart + 1; i < parsed.length; i++) {
          const t = parsed[i].type
          if (t === 'sub' || t === 'assembly') { subEnd = i; break }
        }
      }
    }

    const items: CompletionItem[] = []
    const seen = new Set<string>()
    const addVar = (name: string, varType: string, category: string): void => {
      const nm = (name || '').trim()
      if (!nm || seen.has(nm)) return
      seen.add(nm)
      items.push({
        name: nm,
        englishName: '',
        description: varType ? `${category}（${varType}）` : category,
        returnType: varType || '',
        category,
        libraryName: '用户定义',
        isMember: false,
        ownerTypeName: '',
        params: [],
      })
    }

    // 当前子程序的参数/局部变量优先（更贴近当前输入上下文）
    if (subStart >= 0) {
      for (let i = subStart + 1; i < subEnd; i++) {
        const ln = parsed[i]
        if ((ln.type === 'subParam' || ln.type === 'localVar') && ln.fields[0]) {
          addVar(ln.fields[0], (ln.fields[1] || '').trim(), ln.type === 'subParam' ? '参数' : '局部变量')
        }
      }
    }

    // 程序集变量
    for (const ln of parsed) {
      if (ln.type === 'assemblyVar' && ln.fields[0]) {
        addVar(ln.fields[0], (ln.fields[1] || '').trim(), '程序集变量')
      }
    }

    // 全局变量
    for (const ln of parsed) {
      if (ln.type === 'globalVar' && ln.fields[0]) {
        addVar(ln.fields[0], (ln.fields[1] || '').trim(), '全局变量')
      }
    }

    return items
  }, [currentText, editCell?.lineIndex])
  useEffect(() => {
    userVarCompletionItemsRef.current = userVarCompletionItems
  }, [userVarCompletionItems])

  // 有效命令名集合（支持库命令 + 用户子程序 + 流程关键字 + 变量名）
  const validCommandNames = useMemo(() => {
    const s = new Set<string>()
    for (const c of allCommandsRef.current) s.add(c.name)
    for (const n of userSubNames) s.add(n)
    for (const n of userVarNames) s.add(n)
    for (const k of FLOW_KW) s.add(k)
    return s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSubNames, userVarNames, cmdLoadId])

  // 计算问题列表（无效命令 + 变量名冲突）
  useEffect(() => {
    if (!onProblemsChange) return
    const problems: FileProblem[] = []

    // 无效命令检查
    if (allCommandsRef.current.length > 0) {
      for (const blk of blocks) {
        if (blk.kind !== 'codeline' || !blk.codeLine) continue
        const spans = colorize(blk.codeLine)
        let col = 1
        for (const s of spans) {
          if (s.cls === 'funccolor' && !validCommandNames.has(s.text)) {
            problems.push({ line: blk.lineIndex + 1, column: col, message: `未知命令"${s.text}"`, severity: 'error' })
          }
          if (s.cls === 'assignTarget' && !userVarNames.has(s.text)) {
            problems.push({ line: blk.lineIndex + 1, column: col, message: `未知变量"${s.text}"`, severity: 'error' })
          }
          col += s.text.length
        }
      }
    }

    // 变量名冲突检查
    const parsedLines = parseLines(currentText)
    const assemblyVars = new Map<string, number>()
    const globalVars = new Map<string, number>()
    let localVarsByName = new Map<string, number[]>()
    let inSub = false

    const checkLocalVars = (): void => {
      if (!inSub) return
      for (const [name, lineIndices] of localVarsByName) {
        if (lineIndices.length > 1) {
          for (let k = 1; k < lineIndices.length; k++) {
            problems.push({ line: lineIndices[k] + 1, column: 1, message: `局部变量"${name}"在当前子程序中重复定义`, severity: 'error' })
          }
        }
        if (assemblyVars.has(name)) {
          for (const li of lineIndices) {
            problems.push({ line: li + 1, column: 1, message: `局部变量"${name}"与程序集变量同名`, severity: 'error' })
          }
        }
        if (globalVars.has(name)) {
          for (const li of lineIndices) {
            problems.push({ line: li + 1, column: 1, message: `局部变量"${name}"与全局变量同名`, severity: 'error' })
          }
        }
      }
      localVarsByName = new Map()
    }

    for (let i = 0; i < parsedLines.length; i++) {
      const ln = parsedLines[i]
      if (ln.type === 'assemblyVar') {
        const name = ln.fields[0]
        if (name) {
          if (assemblyVars.has(name)) {
            problems.push({ line: i + 1, column: 1, message: `程序集变量"${name}"重复定义`, severity: 'error' })
          } else {
            assemblyVars.set(name, i)
          }
        }
      } else if (ln.type === 'globalVar') {
        const name = ln.fields[0]
        if (name) {
          if (globalVars.has(name)) {
            problems.push({ line: i + 1, column: 1, message: `全局变量"${name}"重复定义`, severity: 'error' })
          } else {
            globalVars.set(name, i)
          }
        }
      } else if (ln.type === 'sub') {
        checkLocalVars()
        inSub = true
      } else if (ln.type === 'assembly') {
        checkLocalVars()
        inSub = false
      } else if (ln.type === 'localVar') {
        const name = ln.fields[0]
        if (name) {
          const arr = localVarsByName.get(name)
          if (arr) arr.push(i)
          else localVarsByName.set(name, [i])
        }
      }
    }
    checkLocalVars()

    onProblemsChange(problems)
  }, [blocks, validCommandNames, userVarNames, onProblemsChange, currentText])

  const commit = useCallback((overrideVal?: string) => {
    if (!editCell || commitGuardRef.current) return
    commitGuardRef.current = true
    setAcVisible(false)

    // 如果补全弹窗可见且输入词完全匹配命令名，自动上屏
    let effectiveVal = overrideVal !== undefined ? overrideVal : editVal
    if (overrideVal === undefined && acVisibleRef.current && acItemsRef.current.length > 0) {
      const item = acItemsRef.current[0].cmd
      const wordStart = acWordStartRef.current
      const cursorPos = inputRef.current?.selectionStart ?? effectiveVal.length
      const typedWord = effectiveVal.slice(wordStart, cursorPos)
      if (typedWord === item.name) {
        const before = effectiveVal.slice(0, wordStart)
        const after = effectiveVal.slice(cursorPos)
        effectiveVal = before + item.name + after
      }
    }

    // 参数值编辑
    if (editCell.paramIdx !== undefined && editCell.paramIdx >= 0) {
      const codeLine = lines[editCell.lineIndex]
      const formattedVal = formatParamOperators(effectiveVal)
      const newLine = replaceCallArg(codeLine, editCell.paramIdx, formattedVal)
      const nl = [...lines]; nl[editCell.lineIndex] = newLine
      const nt = nl.join('\n')
      setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
      return
    }

    if (editCell.cellIndex < 0) {
      // 流程标记行：检查是否输入了流程命令（嵌套流程控制）
      if (flowMarkRef.current) {
        const markerChar = flowMarkRef.current.trimStart().charAt(0) // '\u200C' or '\u200D' or '\u2060'
        const markerIndent = flowMarkRef.current.slice(0, flowMarkRef.current.length - 1) // 缩进（去掉末尾标记字符）
        const trimmedVal = effectiveVal.trim()
        const cmdCheckName = trimmedVal.startsWith('.') ? trimmedVal : trimmedVal.split(/[\s(（]/)[0]
        if (trimmedVal && FLOW_AUTO_COMPLETE[cmdCheckName]) {
          if (markerChar === '\u2060' && cmdCheckName === '判断') {
            const parentPrefix = markerIndent.length >= 4 ? markerIndent.slice(0, -4) : ''
            let formattedLines = formatCommandLine(parentPrefix + effectiveVal)
            if (formattedLines.length > 0 && formattedLines[formattedLines.length - 1].trim() === '') {
              formattedLines = formattedLines.slice(0, -1)
            }
            const nl = [...lines]
            // 替换当前 \u2060 标记行为格式化的命令
            nl.splice(editCell.lineIndex, 1, ...formattedLines)
            const nt = nl.join('\n')
            setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
            flowMarkRef.current = ''
            return
          }
          // 标记行上输入流程命令 → 嵌套流程控制
          // 使用标记行的缩进作为流程命令缩进基础
          let formattedLines = formatCommandLine(markerIndent + effectiveVal)
          // 内层不需要尾部普通空行，去掉
          if (formattedLines.length > 0 && formattedLines[formattedLines.length - 1].trim() === '') {
            formattedLines = formattedLines.slice(0, -1)
          }
          const nl = [...lines]
          // 替换当前标记行为格式化的命令（不保留原标记行）
          nl.splice(editCell.lineIndex, 1, ...formattedLines)
          // 在内层块结束后追加外层标记行
          const insertPos = editCell.lineIndex + formattedLines.length
          nl.splice(insertPos, 0, flowMarkRef.current)
          const nt = nl.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
          flowMarkRef.current = ''
          return
        }
        // 非流程命令：格式化后保存（自动补全括号和参数）
        const fmtLines = formatCommandLine(markerIndent + effectiveVal)
        const nl = [...lines]; nl[editCell.lineIndex] = flowMarkRef.current + fmtLines[0].slice(markerIndent.length)
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
        flowMarkRef.current = ''
        return
      }
      // formatCommandLine 会为流程命令额外加4空格，若 flowIndent 已包含流程缩进则需减去以避免翻倍
      let baseIndent = flowIndentRef.current
      const trimmedCmd = effectiveVal.trim()
      const cmdCheckName = trimmedCmd.startsWith('.') ? trimmedCmd : trimmedCmd.split(/[\s(（]/)[0]
      const isBareCmd = /^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*\s*$/.test(trimmedCmd)
      const isParenCmd = /^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*\s*[\(（].*[\)）]\s*$/.test(trimmedCmd)
      if ((isBareCmd || isParenCmd) && trimmedCmd && FLOW_AUTO_COMPLETE[cmdCheckName] && baseIndent.length >= 4) {
        baseIndent = baseIndent.slice(0, baseIndent.length - 4)
      }
      const formattedLines = formatCommandLine(baseIndent + effectiveVal)
      flowIndentRef.current = ''
      const mainLine = formattedLines[0]
      // 检查是否需要插入自动补齐的后续行（只在新输入时插入，已有匹配结束标记时不重复插入）
      let extraLines = formattedLines.slice(1)
      if (extraLines.length > 0) {
        // 检查后续行是否已存在对应的结束/分支关键词（只在新输入时插入，已有匹配结束标记时不重复插入）
        // 只在当前子程序范围内检查（遇到 .子程序/.程序集 停止）
        const afterIdx = editCell.isVirtual ? editCell.lineIndex + 2 : editCell.lineIndex + 1
        const remainingLines: string[] = []
        for (let ri = afterIdx; ri < lines.length; ri++) {
          const rl = lines[ri].replace(/[\r\t]/g, '').trim()
          if (rl.startsWith('.子程序 ') || rl.startsWith('.程序集 ')) break
          remainingLines.push(lines[ri])
        }
        const kwLines = extraLines.filter(el => {
          const t = el.trim()
          return el.includes(FLOW_AUTO_TAG) || t === FLOW_TRUE_MARK || t === FLOW_ELSE_MARK || t === FLOW_JUDGE_END_MARK
        })
        const hasEnding = kwLines.length > 0 && kwLines.every(el => {
          const t = el.trim()
          const rawKw = (t === FLOW_TRUE_MARK || t === FLOW_ELSE_MARK || t === FLOW_JUDGE_END_MARK) ? t : el.replace(FLOW_AUTO_TAG, '').trim()
          // 提取纯关键词名（去掉括号和参数部分）
          const kw = rawKw.split(/[\s(（]/)[0] || rawKw
          return remainingLines.some(rl => extractFlowKw(rl) === kw)
        })
        if (hasEnding) extraLines = []
      }
      if (editCell.isVirtual) {
        // 虚拟代码行：插入新行而非替换
        const nl = [...lines]
        nl.splice(editCell.lineIndex + 1, 0, mainLine, ...extraLines)
        const nt = nl.join('\n')
        setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
        return
      }
      // 代码行编辑：替换当前行并插入后续自动补齐行
      const nl = [...lines]
      nl.splice(editCell.lineIndex, 1, mainLine, ...extraLines)
      const nt = nl.join('\n')
      setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
      return
    }
    if (editCell.fieldIdx < 0) {
      // 无字段映射（如 tick 单元格），不修改
      setEditCell(null)
      return
    }
    // 表格单元格编辑：重建字段
    const rawLine = lines[editCell.lineIndex]
    const newLine = rebuildLineField(rawLine, editCell.fieldIdx, effectiveVal, editCell.sliceField)
    const nl = [...lines]; nl[editCell.lineIndex] = newLine

    // 变量名重命名同步：fieldIdx === 0 且为变量声明行时，替换代码中的引用
    if (editCell.fieldIdx === 0) {
      const trimmedRaw = rawLine.replace(/[\r\t]/g, '').trim()
      const varPrefixes = ['.局部变量 ', '.参数 ', '.程序集变量 ', '.全局变量 ']
      const matchedPrefix = varPrefixes.find(pf => trimmedRaw.startsWith(pf))
      if (matchedPrefix) {
        // 使用编辑前保存的原始值作为旧名（liveUpdate 会实时更新 lines，导致 rawLine 已是新值）
        const oldName = editCellOrigValRef.current.trim()
        const newName = effectiveVal.trim()
        if (oldName && newName && oldName !== newName) {
          // 确定作用域范围
          const li = editCell.lineIndex
          let scopeStart = 0
          let scopeEnd = nl.length
          const isLocal = matchedPrefix === '.局部变量 ' || matchedPrefix === '.参数 '
          const isAssembly = matchedPrefix === '.程序集变量 '
          // 全局变量：整个文件
          if (isLocal) {
            // 局部变量/参数：从上方最近的 .子程序 到下方最近的 .子程序/.程序集
            for (let i = li - 1; i >= 0; i--) {
              const t = nl[i].replace(/[\r\t]/g, '').trim()
              if (t.startsWith('.子程序 ')) { scopeStart = i; break }
              if (t.startsWith('.程序集 ')) { scopeStart = i; break }
            }
            for (let i = li + 1; i < nl.length; i++) {
              const t = nl[i].replace(/[\r\t]/g, '').trim()
              if (t.startsWith('.子程序 ') || t.startsWith('.程序集 ')) { scopeEnd = i; break }
            }
          } else if (isAssembly) {
            // 程序集变量：从上方最近的 .程序集 到下方最近的 .程序集
            for (let i = li - 1; i >= 0; i--) {
              const t = nl[i].replace(/[\r\t]/g, '').trim()
              if (t.startsWith('.程序集 ')) { scopeStart = i; break }
            }
            for (let i = li + 1; i < nl.length; i++) {
              const t = nl[i].replace(/[\r\t]/g, '').trim()
              if (t.startsWith('.程序集 ')) { scopeEnd = i; break }
            }
          }
          // 在作用域内的代码行中替换变量名（不替换声明行和注释行）
          const nameRegex = new RegExp(
            '(?<=[^\\u4e00-\\u9fa5A-Za-z0-9_.]|^)' + oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[^\\u4e00-\\u9fa5A-Za-z0-9_.]|$)',
            'g'
          )
          for (let i = scopeStart; i < scopeEnd; i++) {
            if (i === editCell.lineIndex) continue // 跳过声明行本身
            const t = nl[i].replace(/[\r\t]/g, '').trim()
            if (!t || t.startsWith("'") || t.startsWith('.')) continue // 跳过空行、注释、声明
            nl[i] = nl[i].replace(nameRegex, newName)
          }
        }
      }
    }

    const nt = nl.join('\n')
    setCurrentText(nt); prevRef.current = nt; onChange(nt); setEditCell(null)
  }, [editCell, editVal, lines, onChange])

  // 每次渲染后重置 commitGuard，允许下一次合法的 commit 调用
  useEffect(() => { commitGuardRef.current = false })

  // 光标位置变化通知
  useEffect(() => {
    if (editCell && editCell.lineIndex >= 0) {
      const col = inputRef.current?.selectionStart ?? 1
      onCursorChange?.(editCell.lineIndex + 1, col + 1)
    }
  }, [editCell, onCursorChange])

  // commitRef: 始终指向最新的 commit 函数，供 mouseDown 等闭包调用
  const commitRef = useRef<(overrideVal?: string) => void>(commit)
  commitRef.current = commit

  // 窗口失焦兜底提交：处理 Win 键/Alt+Tab 打断编辑导致的未格式化状态
  useEffect(() => {
    const flushEditing = (): void => {
      if (editCellRef.current) {
        commitRef.current()
      }
    }

    const onWindowBlur = (): void => {
      flushEditing()
    }

    const onVisibilityChange = (): void => {
      if (document.hidden) flushEditing()
    }

    window.addEventListener('blur', onWindowBlur)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('blur', onWindowBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const startEditCell = useCallback((li: number, ci: number, cellText: string, fieldIdx?: number, sliceField?: boolean) => {
    if (fieldIdx === undefined) return // 无字段映射（tick 单元格等），不可编辑
    setSelectedLines(new Set())
    pushUndo(prevRef.current)
    lastFocusedLine.current = li
    setEditCell({ lineIndex: li, cellIndex: ci, fieldIdx, sliceField: sliceField || false })
    // 将占位符 \u00A0 视为空值
    const initVal = cellText === '\u00A0' ? '' : (cellText || '')
    editCellOrigValRef.current = initVal
    setEditVal(initVal)
    setTimeout(() => { inputRef.current?.focus() }, 0)
  }, [pushUndo])

  const startEditLine = useCallback((li: number, clientX?: number, containerLeft?: number, isVirtual?: boolean) => {
    // 使用 prevRef 获取最新行数据，防止 commit 修改文本后 React 尚未重渲染导致闭包中 lines 过时
    const latestText = prevRef.current
    const latestLines = latestText.split('\n')
    let text = isVirtual ? '' : (latestLines[li] || '')
    // 剥离流程标记零宽字符和对应的缩进前缀，编辑时不显示
    const stripped = text.replace(/^ +/, '')
    let flowMark = ''
    if (stripped.startsWith('\u200C') || stripped.startsWith('\u200D') || stripped.startsWith('\u2060')) {
      flowMark = text.slice(0, text.length - stripped.length + 1) // 保留缩进 + 标记字符
      text = stripped.slice(1) // 实际可编辑内容
    }
    // 对于有流程线的普通行，剥离被流程线覆盖的前导空格
    let flowIndent = ''
    if (!flowMark && !isVirtual) {
      // 若 commit 刚修改了文本但尚未重渲染，flowLines 可能过时，需重新计算
      const currentFlowLines = (latestText === currentText) ? flowLines : computeFlowLines(buildBlocks(latestText))
      const segs = currentFlowLines.map.get(li) || []
      if (segs.length > 0) {
        const lineMaxDepth = Math.max(...segs.map(s => s.depth)) + 1
        const stripCount = lineMaxDepth * 4
        const leadingSpaces = text.match(/^ */)?.[0] || ''
        const actualStrip = Math.min(stripCount, leadingSpaces.length)
        // 已有内容的行使用真实剥离的缩进，避免嵌套流程起始行在反复点击后重复右移；
        // 只有空行/无足够前导空格时才回退到流程深度占位，保证新输入命令仍能落在正确层级。
        flowIndent = ' '.repeat(actualStrip > 0 ? actualStrip : stripCount)
        if (actualStrip > 0) {
          text = text.slice(actualStrip)
        }
        wasFlowStartRef.current = segs.some(s => s.type === 'start')
      } else {
        wasFlowStartRef.current = false
      }
    }
    pushUndo(latestText)
    setSelectedLines(new Set())
    lastFocusedLine.current = li
    flowMarkRef.current = flowMark
    flowIndentRef.current = flowIndent
    setEditCell({ lineIndex: li, cellIndex: -1, fieldIdx: -1, sliceField: false, isVirtual }); setEditVal(text)
    setTimeout(() => {
      if (!inputRef.current) return
      inputRef.current.focus()
      if (clientX !== undefined && containerLeft !== undefined) {
        let relX = clientX - containerLeft // 相对于代码行内容区域
        // 减去流程线段占用的宽度，使光标定位到输入框内正确位置
        const currentFlowLines2 = (latestText === currentText) ? flowLines : computeFlowLines(buildBlocks(latestText))
        const segs2 = currentFlowLines2.map.get(li) || []
        if (segs2.length > 0) {
          const lineMaxDepth2 = Math.max(...segs2.map(s => s.depth)) + 1
          // 每个流程段宽度为 4ch，用 canvas 测量实际像素宽度
          const canvas2 = document.createElement('canvas')
          const ctx2 = canvas2.getContext('2d')
          if (ctx2) {
            ctx2.font = '13px Consolas, "Microsoft YaHei", monospace'
            const segWidth = ctx2.measureText('    '.repeat(lineMaxDepth2)).width
            relX -= segWidth
            if (relX < 0) relX = 0
          }
        }
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.font = '13px Consolas, "Microsoft YaHei", monospace'
          let pos = text.length
          for (let i = 1; i <= text.length; i++) {
            const w = ctx.measureText(text.slice(0, i)).width
            if (w > relX) {
              const wPrev = ctx.measureText(text.slice(0, i - 1)).width
              pos = (relX - wPrev < w - relX) ? i - 1 : i
              break
            }
          }
          inputRef.current.selectionStart = pos
          inputRef.current.selectionEnd = pos
        }
      }
    }, 0)
  }, [currentText, pushUndo, flowLines])

  const onKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // ===== 补全弹窗键盘处理 =====
    if (acVisible && acItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAcIndex(i => (i + 1) % acItems.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAcIndex(i => (i - 1 + acItems.length) % acItems.length)
        return
      }
      if (e.key === ' ') {
        // 空格键：选中当前补全项上屏
        e.preventDefault()
        applyCompletion(acItems[acIndex])
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        applyCompletion(acItems[acIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setAcVisible(false)
        return
      }
    }

    // ===== Ctrl 快捷键 =====
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && e.key === 'z') {
      e.preventDefault()
      if (undoStack.current.length > 0) {
        const prev = undoStack.current.pop()!
        redoStack.current.push(currentText)
        setCurrentText(prev); prevRef.current = prev; onChange(prev)
      }
      return
    }
    if (ctrl && e.key === 'y') {
      e.preventDefault()
      if (redoStack.current.length > 0) {
        const next = redoStack.current.pop()!
        undoStack.current.push(currentText)
        setCurrentText(next); prevRef.current = next; onChange(next)
      }
      return
    }
    if (ctrl && e.key === 'a') {
      e.preventDefault()
      const ls = prevRef.current.split('\n')
      const all = new Set<number>()
      for (let i = 0; i < ls.length; i++) all.add(i)
      setSelectedLines(all)
      dragAnchor.current = 0
      setAcVisible(false)
      setEditCell(null)
      wrapperRef.current?.focus()
      return
    }

    // ===== 命令行括号保护：已格式化的命令行只允许在括号内编辑参数 =====
    if (editCell && editCell.cellIndex < 0 && editCell.paramIdx === undefined) {
      const parenRange = getOuterParenRange(editVal)
      if (parenRange) {
        const cur = e.currentTarget.selectionStart ?? 0
        const selE = e.currentTarget.selectionEnd ?? cur
        const pS = parenRange.start + 1  // 开括号后的第一个可编辑位置
        const pE = parenRange.end        // 闭括号位置（不可编辑）
        const hasSel = cur !== selE
        const selInRange = cur >= pS && selE <= pE

        // Enter：光标在最前面时在上方插入空行（命令整体下移），否则在下方插入空行
        if (e.key === 'Enter') {
          e.preventDefault()
          setAcVisible(false)
          const cursorAtStart = cur === 0
          // commit 会清除 flowMarkRef，需提前保存
          const savedFlowMark = flowMarkRef.current
          commit()
          setTimeout(() => {
            const latestText = prevRef.current
            const latestLines = latestText.split('\n')
            // 标记行：新行带标记前缀；普通行：用 flowIndent 缩进
            const fi = savedFlowMark
              ? savedFlowMark.slice(0, savedFlowMark.length - 1)
              : (flowIndentRef.current || '')
            const newLineContent = savedFlowMark || fi
            if (cursorAtStart) {
              // 光标在最前面：在命令上方插入空行，光标停在新空行
              const insertAt = editCell!.lineIndex
              latestLines.splice(insertAt, 0, newLineContent)
              const nt = latestLines.join('\n')
              pushUndo(latestText)
              setCurrentText(nt); prevRef.current = nt; onChange(nt)
              flowMarkRef.current = savedFlowMark
              flowIndentRef.current = savedFlowMark ? '' : fi
              wasFlowStartRef.current = false
              setEditCell({ lineIndex: insertAt, cellIndex: -1, fieldIdx: -1, sliceField: false })
              setEditVal('')
            } else {
              // 光标在其他位置：在命令下方插入空行
              const insertAt = editCell!.lineIndex + 1
              latestLines.splice(insertAt, 0, newLineContent)
              const nt = latestLines.join('\n')
              pushUndo(latestText)
              setCurrentText(nt); prevRef.current = nt; onChange(nt)
              flowMarkRef.current = savedFlowMark
              flowIndentRef.current = savedFlowMark ? '' : fi
              wasFlowStartRef.current = false
              setEditCell({ lineIndex: insertAt, cellIndex: -1, fieldIdx: -1, sliceField: false })
              setEditVal('')
            }
            setTimeout(() => inputRef.current?.focus(), 0)
          }, 0)
          return
        }
        // Tab：提交编辑并跳转到下一行编辑
        if (e.key === 'Tab') {
          e.preventDefault()
          setAcVisible(false)
          commit()
          setTimeout(() => {
            const latestText = prevRef.current
            const latestLines = latestText.split('\n')
            const nextLi = editCell!.lineIndex + 1
            if (nextLi < latestLines.length) {
              startEditLine(nextLi)
            }
          }, 0)
          return
        }
        // Backspace：光标在括号内正常删除；光标在命令名区域时剥离括号，回退为裸命令名自由编辑
        if (e.key === 'Backspace') {
          if (hasSel ? !selInRange : cur <= pS) {
            e.preventDefault()
            // 剥离括号及其内容，保留命令名部分供自由编辑
            const rawName = editVal.slice(0, parenRange.start).trimEnd()
            if (cur > 0 && rawName.length > 0) {
              const newVal = rawName.slice(0, -1)
              setEditVal(newVal)
              liveUpdate(newVal)
              setTimeout(() => { if (inputRef.current) { inputRef.current.selectionStart = newVal.length; inputRef.current.selectionEnd = newVal.length } }, 0)
            }
            return
          }
        }
        // Delete：光标在括号外或选区跨出括号时阻止
        if (e.key === 'Delete') {
          if (hasSel ? !selInRange : cur >= pE) { e.preventDefault(); return }
        }
        // Ctrl+X/V：选区跨出括号时阻止
        if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'v')) {
          if (!selInRange) { e.preventDefault(); return }
        }
        // 可打印字符：光标在括号外时阻止输入
        if (e.key.length === 1 && !(e.ctrlKey || e.metaKey)) {
          if (hasSel ? !selInRange : (cur < pS || cur > pE)) { e.preventDefault(); return }
        }
      }
    }

    // ===== 原有键盘处理 =====
    if (e.key === 'Enter') {
      e.preventDefault()
      setAcVisible(false)
      if (editCell && editCell.cellIndex < 0) {
        const cur = e.currentTarget
        const pos = cur.selectionStart ?? editVal.length
        const before = editVal.slice(0, pos)
        const after = editVal.slice(pos)
        const nl = [...lines]

        // ===== 流程命令自动格式化：输入流程命令后按回车自动展开结构 =====
        if (after.trim() === '') {
          const trimmedCheck = editVal.trim()
          const cmdCheckName = trimmedCheck.startsWith('.') ? trimmedCheck : trimmedCheck.split(/[\s(（]/)[0]
          if (trimmedCheck && FLOW_AUTO_COMPLETE[cmdCheckName]) {
            if (flowMarkRef.current) {
              const markerChar = flowMarkRef.current.trimStart().charAt(0)
              const markerIndent = flowMarkRef.current.slice(0, flowMarkRef.current.length - 1)
              if (markerChar === '\u2060' && cmdCheckName === '判断') {
                const parentPrefix = markerIndent.length >= 4 ? markerIndent.slice(0, -4) : ''
                let formattedLines = formatCommandLine(parentPrefix + editVal)
                if (formattedLines.length > 1) {
                  if (formattedLines[formattedLines.length - 1].trim() === '') {
                    formattedLines = formattedLines.slice(0, -1)
                  }
                  // 替换 \u2060 标记行为格式化的命令
                  nl.splice(editCell.lineIndex, 1, ...formattedLines)
                  const nt = nl.join('\n')
                  setCurrentText(nt); prevRef.current = nt; onChange(nt)
                  const cursorLi = editCell.lineIndex + 1
                  const targetLine = nl[cursorLi] || ''
                  const strippedTarget = targetLine.replace(/^ +/, '')
                  if (strippedTarget.startsWith('\u200C') || strippedTarget.startsWith('\u200D') || strippedTarget.startsWith('\u2060')) {
                    flowMarkRef.current = targetLine.slice(0, targetLine.length - strippedTarget.length + 1)
                    setEditCell({ lineIndex: cursorLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
                    setEditVal(strippedTarget.slice(1))
                  } else {
                    flowMarkRef.current = ''
                    setEditCell({ lineIndex: cursorLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
                    setEditVal(targetLine)
                  }
                  setTimeout(() => { inputRef.current?.focus(); if (inputRef.current) { inputRef.current.selectionStart = 0; inputRef.current.selectionEnd = 0 } }, 0)
                  commitGuardRef.current = true
                  return
                }
              } else {
              // 标记行上输入流程命令 → 嵌套流程控制
              let formattedLines = formatCommandLine(markerIndent + editVal)
              if (formattedLines.length > 1) {
                if (formattedLines[formattedLines.length - 1].trim() === '') {
                  formattedLines = formattedLines.slice(0, -1)
                }
                const isLoopFlow = FLOW_LOOP_KW.has(cmdCheckName)
                if (isLoopFlow) {
                  // 循环类命令：在首命令和尾命令之间插入流程体内空行
                  const mainLine = formattedLines[0]
                  const mainIndent = mainLine.length - mainLine.trimStart().length
                  const bodyIndent = ' '.repeat(mainIndent + 4)
                  const withBody = [mainLine, bodyIndent, ...formattedLines.slice(1)]
                  nl.splice(editCell.lineIndex, 1, ...withBody)
                  const insertPos = editCell.lineIndex + withBody.length
                  nl.splice(insertPos, 0, flowMarkRef.current)
                  const nt = nl.join('\n')
                  setCurrentText(nt); prevRef.current = nt; onChange(nt)
                  // 光标移到流程体内的空行
                  const cursorLi = editCell.lineIndex + 1
                  flowMarkRef.current = ''
                  flowIndentRef.current = bodyIndent
                  wasFlowStartRef.current = false
                  setEditCell({ lineIndex: cursorLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
                  setEditVal('')
                } else {
                  // 非循环类（如果/如果真/判断）：光标移到分支标记行
                  nl.splice(editCell.lineIndex, 1, ...formattedLines)
                  const insertPos = editCell.lineIndex + formattedLines.length
                  nl.splice(insertPos, 0, flowMarkRef.current)
                  const nt = nl.join('\n')
                  setCurrentText(nt); prevRef.current = nt; onChange(nt)
                  const cursorLi = editCell.lineIndex + 1
                  const targetLine = nl[cursorLi] || ''
                  const strippedTarget = targetLine.replace(/^ +/, '')
                  if (strippedTarget.startsWith('\u200C') || strippedTarget.startsWith('\u200D') || strippedTarget.startsWith('\u2060')) {
                    flowMarkRef.current = targetLine.slice(0, targetLine.length - strippedTarget.length + 1)
                    setEditCell({ lineIndex: cursorLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
                    setEditVal(strippedTarget.slice(1))
                  } else {
                    flowMarkRef.current = ''
                    setEditCell({ lineIndex: cursorLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
                    setEditVal(targetLine)
                  }
                }
                setTimeout(() => { inputRef.current?.focus(); if (inputRef.current) { inputRef.current.selectionStart = 0; inputRef.current.selectionEnd = 0 } }, 0)
                commitGuardRef.current = true
                return
              }
              }
            } else {
              // 普通代码行/虚拟行：自动展开流程结构
              // 需要加回 flowIndent（被 startEditLine 剥离的流程区域缩进）
              // 但 formatCommandLine 会为流程命令额外加4空格，所以需减去以避免缩进翻倍
              // 只有裸命令名（无括号）才会被 formatCommandLine 重新格式化
              let enterIndent = flowIndentRef.current
              const isBareEnterCmd = /^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_.]*\s*$/.test(editVal.trim())
              if (isBareEnterCmd && enterIndent.length >= 4) {
                enterIndent = enterIndent.slice(0, enterIndent.length - 4)
              }
              const formattedLines = formatCommandLine(enterIndent + editVal)
              if (formattedLines.length > 1) {
                const mainLine = formattedLines[0]
                let extraLines = formattedLines.slice(1)
                const afterIdx = editCell.isVirtual ? editCell.lineIndex + 2 : editCell.lineIndex + 1
                const remainingLines: string[] = []
                for (let ri = afterIdx; ri < lines.length; ri++) {
                  const rl = lines[ri].replace(/[\r\t]/g, '').trim()
                  if (rl.startsWith('.子程序 ') || rl.startsWith('.程序集 ')) break
                  remainingLines.push(lines[ri])
                }
                const kwLines = extraLines.filter(el => {
                  const t = el.trim()
                  return el.includes(FLOW_AUTO_TAG) || t === FLOW_TRUE_MARK || t === FLOW_ELSE_MARK || t === FLOW_JUDGE_END_MARK
                })
                // 检查紧邻下方的行是否已经是当前命令的流程结构（防止重复插入）
                // 必须从 remainingLines 的最前面开始匹配，跳过空行/普通代码行
                let hasEnding = false
                if (kwLines.length > 0) {
                  // 提取第一个 remaining 行的流程关键词
                  const firstRemainingKw = remainingLines.length > 0 ? extractFlowKw(remainingLines[0]) : null
                  // 提取第一个 kwLine 的期望关键词
                  const firstKwT = kwLines[0].trim()
                  const firstExpectedKw = (firstKwT === FLOW_TRUE_MARK || firstKwT === FLOW_ELSE_MARK || firstKwT === FLOW_JUDGE_END_MARK)
                    ? firstKwT : kwLines[0].replace(FLOW_AUTO_TAG, '').trim().split(/[\s(（]/)[0]
                  // 只有当紧邻的第一行就匹配第一个期望关键词时，才视为已有结构
                  if (firstRemainingKw === firstExpectedKw) {
                    hasEnding = kwLines.every(el => {
                      const t = el.trim()
                      const kw = (t === FLOW_TRUE_MARK || t === FLOW_ELSE_MARK || t === FLOW_JUDGE_END_MARK) ? t : el.replace(FLOW_AUTO_TAG, '').trim().split(/[\s(（]/)[0]
                      return remainingLines.some(rl => extractFlowKw(rl) === kw)
                    })
                  }
                }
                if (hasEnding) extraLines = []

                const isLoopFlow = FLOW_LOOP_KW.has(cmdCheckName)
                if (isLoopFlow) {
                  // 循环类命令：在首命令和尾命令之间插入流程体内空行
                  const mainIndent = mainLine.length - mainLine.trimStart().length
                  const bodyIndent = ' '.repeat(mainIndent + 4)
                  if (editCell.isVirtual) {
                    nl.splice(editCell.lineIndex + 1, 0, mainLine, bodyIndent, ...extraLines)
                  } else {
                    nl.splice(editCell.lineIndex, 1, mainLine, bodyIndent, ...extraLines)
                  }
                  const nt = nl.join('\n')
                  setCurrentText(nt); prevRef.current = nt; onChange(nt)
                  const baseLi = editCell.isVirtual ? editCell.lineIndex + 1 : editCell.lineIndex
                  const cursorLi = baseLi + 1
                  flowMarkRef.current = ''
                  flowIndentRef.current = bodyIndent
                  wasFlowStartRef.current = false
                  setEditCell({ lineIndex: cursorLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
                  setEditVal('')
                } else {
                  // 非循环类（如果/如果真/判断）：光标移到分支标记行
                  if (editCell.isVirtual) {
                    nl.splice(editCell.lineIndex + 1, 0, mainLine, ...extraLines)
                  } else {
                    nl.splice(editCell.lineIndex, 1, mainLine, ...extraLines)
                  }
                  const nt = nl.join('\n')
                  setCurrentText(nt); prevRef.current = nt; onChange(nt)
                  const baseLi = editCell.isVirtual ? editCell.lineIndex + 1 : editCell.lineIndex
                  const cursorLi = baseLi + 1
                  const targetLine = nl[cursorLi] || ''
                  const strippedTarget = targetLine.replace(/^ +/, '')
                  if (strippedTarget.startsWith('\u200C') || strippedTarget.startsWith('\u200D') || strippedTarget.startsWith('\u2060')) {
                    flowMarkRef.current = targetLine.slice(0, targetLine.length - strippedTarget.length + 1)
                    setEditCell({ lineIndex: cursorLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
                    setEditVal(strippedTarget.slice(1))
                  } else {
                    flowMarkRef.current = ''
                    setEditCell({ lineIndex: cursorLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
                    setEditVal(targetLine)
                  }
                }
                setTimeout(() => { inputRef.current?.focus(); if (inputRef.current) { inputRef.current.selectionStart = 0; inputRef.current.selectionEnd = 0 } }, 0)
                commitGuardRef.current = true
                return
              }
            }
          }
        }

        if (editCell.isVirtual) {
          // 虚拟代码行：插入两行（光标前/后）
          nl.splice(editCell.lineIndex + 1, 0, before, after)
          const nt = nl.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt)
          const newLi = editCell.lineIndex + 2
          setEditCell({ lineIndex: newLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
          setEditVal(after)
        } else if (flowMarkRef.current && (flowMarkRef.current.trimStart().startsWith('\u200D') || flowMarkRef.current.trimStart().startsWith('\u2060'))) {
          // 标记结束行（\u200D/\u2060）：在当前行前插入空行，标记下移
          const markerChar = flowMarkRef.current.trimStart().charAt(0)
          const indent = flowMarkRef.current.slice(0, flowMarkRef.current.length - 1) // 去掉末尾标记字符保留缩进
          // 格式化当前行内容（自动补全括号和参数）
          const fmtBefore = after.trim() === '' ? formatCommandLine(indent + before)[0].slice(indent.length) : before
          nl[editCell.lineIndex] = flowMarkRef.current + fmtBefore
          nl.splice(editCell.lineIndex + 1, 0, indent + markerChar + after)
          const nt = nl.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt)
          const newLi = editCell.lineIndex + 1
          flowMarkRef.current = indent + markerChar
          setEditCell({ lineIndex: newLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
          setEditVal(after)
        } else if (flowMarkRef.current && flowMarkRef.current.trimStart().startsWith('\u200C') && after.trim() === '') {
          // \u200C 标记行上输入非流程命令后回车：格式化命令 + 在下方插入新 \u200C 行
          const markerIndent = flowMarkRef.current.slice(0, flowMarkRef.current.length - 1)
          const fmtLines = formatCommandLine(markerIndent + before)
          const fmtContent = fmtLines[0].slice(markerIndent.length)
          nl[editCell.lineIndex] = flowMarkRef.current + fmtContent
          nl.splice(editCell.lineIndex + 1, 0, flowMarkRef.current)
          const nt = nl.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt)
          const newLi = editCell.lineIndex + 1
          // 新行是 \u200C 标记行，保持 flowMark
          setEditCell({ lineIndex: newLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
          setEditVal('')
        } else {
          // 代码行：在光标位置拆行，插入新行
          const fi = flowIndentRef.current
          // 如果当前行是流程结束行（如循环尾），新行应在该流程块外部，缩进减少一层
          const curSegs = flowLines.map.get(editCell.lineIndex) || []
          const hasFlowEnd = curSegs.some(s => s.type === 'end')
          const newFi = hasFlowEnd && fi.length >= 4 ? fi.slice(0, fi.length - 4) : fi
          // 格式化当前行内容（自动补全括号和参数）
          const fmtBefore = after.trim() === '' ? formatCommandLine(fi + before)[0].slice(fi.length) : before
          if (flowMarkRef.current) {
            nl[editCell.lineIndex] = flowMarkRef.current + fmtBefore
            nl.splice(editCell.lineIndex + 1, 0, flowMarkRef.current + after)
          } else {
            nl[editCell.lineIndex] = fi + fmtBefore
            nl.splice(editCell.lineIndex + 1, 0, newFi + after)
          }
          const nt = nl.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt)
          const newLi = editCell.lineIndex + 1
          setEditCell({ lineIndex: newLi, cellIndex: -1, fieldIdx: -1, sliceField: false })
          setEditVal(after)
          // 更新 flowIndentRef 为新行实际的流程缩进，防止旧值残留导致后续命令多缩进
          flowIndentRef.current = flowMarkRef.current ? '' : newFi
          wasFlowStartRef.current = false
        }
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus()
            inputRef.current.selectionStart = 0
            inputRef.current.selectionEnd = 0
          }
        }, 0)
      } else if (editCell && editCell.cellIndex >= 0 && editCell.fieldIdx >= 0) {
        // 表格行：先提交当前编辑，再插入同类型新行
        const li = editCell.lineIndex
        let rawLine = lines[li]
        rawLine = rebuildLineField(rawLine, editCell.fieldIdx, editVal, editCell.sliceField)

        const stripped = rawLine.replace(/[\r\t]/g, '').trimStart()
        const rowTemplates: [string, string][] = [
          ['.子程序 ', '    .参数 , 整数型'],
          ['.程序集 ', '.程序集变量 , 整数型'],
          ['.程序集变量 ', '.程序集变量 , 整数型'],
          ['.局部变量 ', '.局部变量 , 整数型'],
          ['.全局变量 ', '.全局变量 , 整数型'],
          ['.参数 ', '    .参数 , 整数型'],
          ['.成员 ', '    .成员 , 整数型'],
          ['.常量 ', '.常量 , '],
        ]

        let newLine: string | null = null
        for (const [prefix, template] of rowTemplates) {
          if (stripped.startsWith(prefix)) {
            newLine = template
            break
          }
        }

        if (newLine) {
          const nl = [...lines]
          nl[li] = rawLine

          // 变量名重命名同步（与 commit 中逻辑一致）
          if (editCell.fieldIdx === 0) {
            const origRaw = lines[li]
            const trimmedOrig = origRaw.replace(/[\r\t]/g, '').trim()
            const varPfxs = ['.局部变量 ', '.参数 ', '.程序集变量 ', '.全局变量 ']
            const mPfx = varPfxs.find(pf => trimmedOrig.startsWith(pf))
            if (mPfx) {
              // 使用编辑前保存的原始值作为旧名
              const oName = editCellOrigValRef.current.trim()
              const nName = editVal.trim()
              if (oName && nName && oName !== nName) {
                let sStart = 0, sEnd = nl.length
                const isLoc = mPfx === '.局部变量 ' || mPfx === '.参数 '
                const isAsm = mPfx === '.程序集变量 '
                if (isLoc) {
                  for (let j = li - 1; j >= 0; j--) { const tt = nl[j].replace(/[\r\t]/g, '').trim(); if (tt.startsWith('.子程序 ') || tt.startsWith('.程序集 ')) { sStart = j; break } }
                  for (let j = li + 1; j < nl.length; j++) { const tt = nl[j].replace(/[\r\t]/g, '').trim(); if (tt.startsWith('.子程序 ') || tt.startsWith('.程序集 ')) { sEnd = j; break } }
                } else if (isAsm) {
                  for (let j = li - 1; j >= 0; j--) { const tt = nl[j].replace(/[\r\t]/g, '').trim(); if (tt.startsWith('.程序集 ')) { sStart = j; break } }
                  for (let j = li + 1; j < nl.length; j++) { const tt = nl[j].replace(/[\r\t]/g, '').trim(); if (tt.startsWith('.程序集 ')) { sEnd = j; break } }
                }
                const nrx = new RegExp(
                  '(?<=[^\\u4e00-\\u9fa5A-Za-z0-9_.]|^)' + oName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[^\\u4e00-\\u9fa5A-Za-z0-9_.]|$)', 'g'
                )
                for (let j = sStart; j < sEnd; j++) {
                  if (j === li) continue
                  const tt = nl[j].replace(/[\r\t]/g, '').trim()
                  if (!tt || tt.startsWith("'") || tt.startsWith('.')) continue
                  nl[j] = nl[j].replace(nrx, nName)
                }
              }
            }
          }

          nl.splice(li + 1, 0, newLine)
          const nt = nl.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt)
          // 开始编辑新行的名称单元格
          const newLi = li + 1
          editCellOrigValRef.current = ''
          setEditCell({ lineIndex: newLi, cellIndex: 0, fieldIdx: 0, sliceField: false })
          setEditVal('')
          setTimeout(() => { inputRef.current?.focus() }, 0)
        } else {
          commit()
        }
      } else {
        commit()
      }
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      // 输入为空时按退格/删除键
      if (editCell && editCell.cellIndex < 0 && editVal.trim() === '' && lines.length > 1) {
        const li = editCell.lineIndex
        const firstDeclLine = (() => {
          const parsed = parseLines(lines.join('\n'))
          for (let i = 0; i < parsed.length; i++) {
            const tp = parsed[i].type
            if (tp !== 'blank' && tp !== 'comment' && tp !== 'code' && tp !== 'version' && tp !== 'supportLib') return i
          }
          return -1
        })()
        if (li === firstDeclLine) {
          e.preventDefault()
          return
        }
        // 检查当前行是否属于流程控制结构（如果/如果真/判断）
        const flowStruct = getFlowStructureAround(lines, li)
        if (flowStruct) {
          // 在流程结构内：保证最少各保留1行标记行和1行尾空行
          e.preventDefault()
          const { cmdLine, sections, sectionIdx } = flowStruct
          const curSection = sections[sectionIdx]
          if (curSection.count > 1) {
            // 当前区段有多余行：删除当前行
            pushUndo(currentText)
            const nl = [...lines]; nl.splice(li, 1)
            const nt = nl.join('\n')
            setCurrentText(nt); prevRef.current = nt; onChange(nt)
            // 光标移到上一行
            const targetLi = Math.max(li - 1, 0)
            setTimeout(() => startEditLine(targetLi), 0)
          } else if (sectionIdx > 0) {
            // 当前区段已是最少1行，尝试删除上方区段的多余行
            const prevSection = sections[sectionIdx - 1]
            if (prevSection.count > 1) {
              // 上方区段有多余行：删除其最后一行
              if (prevSection.endLine === firstDeclLine) {
                commit()
                setTimeout(() => startEditLine(prevSection.endLine), 0)
                return
              }
              pushUndo(currentText)
              const nl = [...lines]; nl.splice(prevSection.endLine, 1)
              const nt = nl.join('\n')
              setCurrentText(nt); prevRef.current = nt; onChange(nt)
              // 光标移到当前位置（行号减1因为上方删了一行）
              setTimeout(() => startEditLine(li - 1), 0)
            } else {
              // 上方区段也是最少1行：光标移到上方区段的最后一行
              commit()
              setTimeout(() => startEditLine(prevSection.endLine), 0)
            }
          } else {
            // 已在第一个区段且只有1行：光标移到命令行
            commit()
            setTimeout(() => startEditLine(cmdLine), 0)
          }
        } else if (!flowMarkRef.current && !isFlowMarkerLine(lines[li] || '')) {
          // 不在流程结构内的普通空行：直接删除当前行
          e.preventDefault()
          pushUndo(currentText)
          const nl = [...lines]
          nl.splice(li, 1)
          const nt = nl.join('\n')
          setCurrentText(nt); prevRef.current = nt; onChange(nt)
          setEditCell(null)
          flowIndentRef.current = ''
          setTimeout(() => wrapperRef.current?.focus(), 0)
        }
      }
    } else if (e.key === 'Escape') { setAcVisible(false); setEditCell(null) }
    // ===== 方向键导航 =====
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (editCell && editCell.cellIndex < 0) {
        e.preventDefault()
        const cursorPos = e.currentTarget.selectionStart ?? 0
        commit()
        const targetLi = e.key === 'ArrowUp' ? editCell.lineIndex - 1 : editCell.lineIndex + 1
        setTimeout(() => {
          const latestLines = prevRef.current.split('\n')
          if (targetLi >= 0 && targetLi < latestLines.length) {
            startEditLine(targetLi)
            // 尝试保持光标水平位置
            setTimeout(() => {
              if (inputRef.current) {
                const maxPos = inputRef.current.value.length
                const pos = Math.min(cursorPos, maxPos)
                inputRef.current.selectionStart = pos
                inputRef.current.selectionEnd = pos
              }
            }, 0)
          }
        }, 0)
      }
    } else if (e.key === 'ArrowLeft') {
      if (editCell && editCell.cellIndex < 0) {
        const pos = e.currentTarget.selectionStart ?? 0
        if (pos === 0 && editCell.lineIndex > 0) {
          e.preventDefault()
          commit()
          const targetLi = editCell.lineIndex - 1
          setTimeout(() => {
            const latestLines = prevRef.current.split('\n')
            if (targetLi >= 0 && targetLi < latestLines.length) {
              startEditLine(targetLi)
              setTimeout(() => {
                if (inputRef.current) {
                  const end = inputRef.current.value.length
                  inputRef.current.selectionStart = end
                  inputRef.current.selectionEnd = end
                }
              }, 0)
            }
          }, 0)
        }
      }
    } else if (e.key === 'ArrowRight') {
      if (editCell && editCell.cellIndex < 0) {
        const pos = e.currentTarget.selectionStart ?? 0
        const len = editVal.length
        if (pos >= len) {
          e.preventDefault()
          commit()
          const targetLi = editCell.lineIndex + 1
          setTimeout(() => {
            const latestLines = prevRef.current.split('\n')
            if (targetLi < latestLines.length) {
              startEditLine(targetLi)
              setTimeout(() => {
                if (inputRef.current) {
                  inputRef.current.selectionStart = 0
                  inputRef.current.selectionEnd = 0
                }
              }, 0)
            }
          }, 0)
        }
      }
    }
  }, [commit, editCell, editVal, lines, onChange, acVisible, acItems, acIndex, applyCompletion, currentText, pushUndo, startEditLine])

  // 插入子程序：在当前光标所处子程序后方插入，无光标时插入到末尾
  useImperativeHandle(ref, () => ({
    insertSubroutine: () => {
      pushUndo(currentText)
      const curLines = currentText.split('\n')
      const focusLi = lastFocusedLine.current

      // 收集已有子程序名，生成唯一名称
      const existingNames = new Set<string>()
      for (const ln of curLines) {
        const t = ln.replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ')) {
          const name = splitCSV(t.slice('.子程序 '.length))[0]
          if (name) existingNames.add(name)
        }
      }
      let num = 1
      while (existingNames.has('子程序' + num)) num++
      const newName = '子程序' + num

      let insertAt: number

      if (focusLi < 0) {
        // 无光标焦点：插入到文件末尾
        insertAt = curLines.length
      } else {
        // 先找光标所在或上方最近的 .子程序 声明行
        let curSubStart = -1
        for (let i = Math.min(focusLi, curLines.length - 1); i >= 0; i--) {
          const t = curLines[i].replace(/[\r\t]/g, '').trim()
          if (t.startsWith('.子程序 ')) { curSubStart = i; break }
          // 碰到程序集声明就停止（程序集表格始终在最上方）
          if (t.startsWith('.程序集 ')) break
        }

        // 找下一个子程序/程序集的起始行（即当前子程序的结束后）
        insertAt = curLines.length
        const searchStart = curSubStart >= 0 ? curSubStart + 1 : Math.max(focusLi + 1, 0)
        for (let i = searchStart; i < curLines.length; i++) {
          const t = curLines[i].replace(/[\r\t]/g, '').trim()
          if (t.startsWith('.子程序 ') || t.startsWith('.程序集 ')) {
            insertAt = i
            break
          }
        }
      }

      const newSubText = '\n.子程序 ' + newName + ', , , '
      const nl = [...curLines]
      nl.splice(insertAt, 0, newSubText)
      const nt = nl.join('\n')
      setCurrentText(nt); prevRef.current = nt; onChange(nt)
    },

    insertLocalVariable: () => {
      const curLines = currentText.split('\n')
      const focusLi = lastFocusedLine.current

      // 向上查找当前所在的 .子程序 或 .程序集
      let contextStart = -1
      let isAssembly = false
      for (let i = Math.min(focusLi, curLines.length - 1); i >= 0; i--) {
        const t = curLines[i].replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ')) { contextStart = i; break }
        if (t.startsWith('.程序集 ')) { contextStart = i; isAssembly = true; break }
      }
      if (contextStart < 0) return

      // 在程序集上下文插入程序集变量，在子程序上下文插入局部变量
      const declPrefix = isAssembly ? '.程序集变量 ' : '.局部变量 '
      const searchPrefixes = isAssembly
        ? ['.程序集变量 ']
        : ['.参数 ', '.局部变量 ']

      // 找到当前范围内最后一个相关声明行
      let insertAt = contextStart
      for (let i = contextStart + 1; i < curLines.length; i++) {
        const t = curLines[i].replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ') || t.startsWith('.程序集 ')) break
        if (searchPrefixes.some(p => t.startsWith(p))) insertAt = i
      }

      pushUndo(currentText)
      const nl = [...curLines]
      nl.splice(insertAt + 1, 0, declPrefix + ', 整数型')
      const nt = nl.join('\n')
      setCurrentText(nt); prevRef.current = nt; onChange(nt)

      // 开始编辑新行的名称单元格
      const newLi = insertAt + 1
      lastFocusedLine.current = newLi
      setEditCell({ lineIndex: newLi, cellIndex: 0, fieldIdx: 0, sliceField: false })
      setEditVal('')
      setTimeout(() => {
        const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${newLi}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        inputRef.current?.focus()
      }, 50)
    },

    navigateOrCreateSub: (subName: string, params: Array<{ name: string; dataType: string; isByRef: boolean }>) => {
      const curLines = currentText.split('\n')

      // 查找同名子程序是否已存在
      let subLineIndex = -1
      for (let i = 0; i < curLines.length; i++) {
        const t = curLines[i].replace(/[\r\t]/g, '').trim()
        if (t.startsWith('.子程序 ')) {
          const name = splitCSV(t.slice('.子程序 '.length))[0]
          if (name === subName) { subLineIndex = i; break }
        }
      }

      if (subLineIndex >= 0) {
        // 已存在：滚动到该子程序
        lastFocusedLine.current = subLineIndex
        setTimeout(() => {
          const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${subLineIndex}"]`)
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 50)
        return
      }

      // 不存在：在文件末尾插入新子程序
      pushUndo(currentText)
      const insertLines: string[] = ['\n.子程序 ' + subName + ', , , ']
      for (const p of params) {
        insertLines.push('    .参数 ' + p.name + ', ' + (p.dataType || '整数型') + (p.isByRef ? ', 传址' : ''))
      }
      const nl = [...curLines, ...insertLines]
      const nt = nl.join('\n')
      setCurrentText(nt); prevRef.current = nt; onChange(nt)

      // 新子程序行在 join 后的位置：curLines.length + 1（因 insertLines[0] 以 \n 开头产生空行）
      const newSubLineIndex = curLines.length + 1
      lastFocusedLine.current = newSubLineIndex
      setTimeout(() => {
        const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${newSubLineIndex}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 150)
    },
    navigateToLine: (line: number) => {
      const lineIndex = line - 1
      lastFocusedLine.current = lineIndex
      setTimeout(() => {
        const el = wrapperRef.current?.querySelector<HTMLElement>(`[data-line-index="${lineIndex}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // 高亮闪烁效果
        if (el) {
          el.classList.add('highlight-flash')
          setTimeout(() => el.classList.remove('highlight-flash'), 1500)
        }
      }, 50)
    },
    editorAction: (action: string) => {
      if (action === 'copy') {
        if (selectedLines.size > 0) {
          void navigator.clipboard.writeText(getSelectedSourceText())
        }
        return
      }
      if (action === 'selectAll') {
        const ls = currentText.split('\n')
        const all = new Set<number>()
        for (let i = 0; i < ls.length; i++) all.add(i)
        setSelectedLines(all)
        dragAnchor.current = 0
        return
      }
    },
  }), [currentText, onChange, pushUndo, selectedLines, getSelectedSourceText])

  // 查找代码行中第一个有参数的有效命令
  const findCmdWithParams = useCallback((codeLine: string): CompletionItem | null => {
    if (!codeLine) return null
    const spans = colorize(codeLine)
    for (const s of spans) {
      if ((s.cls === 'funccolor' || s.cls === 'comecolor') && validCommandNames.has(s.text)) {
        const cmd = allCommandsRef.current.find(c => c.name === s.text)
        if (cmd && cmd.params.length > 0) return cmd
        // 内置流程关键字可能不在 allCommandsRef 中，对有参数的流程尾命令做兜底
        if (s.text === '循环判断尾') {
          return { name: '循环判断尾', englishName: 'loop', description: '本命令根据提供的逻辑参数的值，来决定是否返回到循环首部继续进行循环。', returnType: '', category: '流程控制', libraryName: '系统核心支持库', isMember: false, ownerTypeName: '', params: [{ name: '条件', type: '逻辑型', description: '本条件值的结果决定下一步程序执行位置。', optional: false, isVariable: false, isArray: false }] }
        }
      }
    }
    return null
  }, [validCommandNames])

  // 查找代码行中第一个命令名（不要求有参数）
  const findFirstCommandName = useCallback((codeLine: string): string | null => {
    if (!codeLine) return null
    const spans = colorize(codeLine)
    for (const s of spans) {
      if ((s.cls === 'funccolor' || s.cls === 'comecolor' || s.cls === 'cometwolr') && s.text.trim()) {
        return s.text
      }
    }
    return null
  }, [])

  /** 从代码行中提取括号内的实际参数值列表 */
  const parseCallArgs = useCallback((codeLine: string): string[] => {
    // 找到第一个 ( 或 （
    const openIdx = codeLine.search(/[(（]/)
    if (openIdx < 0) return []
    const open = codeLine[openIdx]
    const close = open === '(' ? ')' : '）'
    let depth = 0
    let start = openIdx + 1
    const args: string[] = []
    let inStr = false
    for (let i = openIdx; i < codeLine.length; i++) {
      const ch = codeLine[i]
      if (inStr) { if (ch === '"' || ch === '\u201d') inStr = false; continue }
      if (ch === '"' || ch === '\u201c') { inStr = true; continue }
      if (ch === open || ch === '(' || ch === '（') {
        if (depth === 0) start = i + 1
        depth++
      } else if (ch === close || ch === ')' || ch === '）') {
        depth--
        if (depth === 0) {
          args.push(codeLine.slice(start, i).trim())
          break
        }
      } else if ((ch === ',' || ch === '，') && depth === 1) {
        args.push(codeLine.slice(start, i).trim())
        start = i + 1
      }
    }
    return args
  }, [])

  /** 格式化参数中的运算符：半角→全角 + 前后加空格 */
  const formatParamOperators = useCallback((val: string): string => {
    return formatOps(val)
  }, [])

  /** 替换代码行中第 argIdx 个参数的值 */
  const replaceCallArg = useCallback((codeLine: string, argIdx: number, newVal: string): string => {
    const openIdx = codeLine.search(/[(（]/)
    if (openIdx < 0) return codeLine
    // 解析参数位置范围，skipStr 控制是否跳过字符串内容
    const parseRanges = (skipStr: boolean) => {
      const ranges: { start: number; end: number }[] = []
      let depth = 0
      let start = openIdx + 1
      let inStr = false
      let closeIdx = codeLine.length
      let found = false
      for (let i = openIdx; i < codeLine.length; i++) {
        const ch = codeLine[i]
        if (skipStr) {
          if (inStr) { if (ch === '"' || ch === '\u201d') inStr = false; continue }
          if (ch === '"' || ch === '\u201c') { inStr = true; continue }
        }
        if (ch === '(' || ch === '（') {
          if (depth === 0) start = i + 1
          depth++
        } else if (ch === ')' || ch === '）') {
          depth--
          if (depth === 0) { ranges.push({ start, end: i }); closeIdx = i; found = true; break }
        } else if ((ch === ',' || ch === '，') && depth === 1) {
          ranges.push({ start, end: i })
          start = i + 1
        }
      }
      return { ranges, closeIdx, found }
    }
    // 先尝试带字符串检测的解析，失败则回退不检测字符串
    let { ranges, closeIdx, found } = parseRanges(true)
    if (!found) {
      ({ ranges, closeIdx, found } = parseRanges(false))
    }
    if (argIdx < ranges.length) {
      return codeLine.slice(0, ranges[argIdx].start) + newVal + codeLine.slice(ranges[argIdx].end)
    }
    // 参数不存在时追加空位到 argIdx
    let result = codeLine.slice(0, closeIdx)
    const sep = codeLine[openIdx] === '（' ? '，' : ', '
    for (let i = ranges.length; i <= argIdx; i++) {
      if (i > 0 || ranges.length > 0) result += sep
      result += (i === argIdx) ? newVal : ''
    }
    result += codeLine.slice(closeIdx)
    return result
  }, [])

  /** 实时同步编辑内容到底层数据（不关闭编辑状态） */
  const liveUpdate = useCallback((val: string) => {
    if (!editCell) return

    // 参数值编辑
    if (editCell.paramIdx !== undefined && editCell.paramIdx >= 0) {
      const codeLine = lines[editCell.lineIndex]
      const newLine = replaceCallArg(codeLine, editCell.paramIdx, val)
      const nl = [...lines]; nl[editCell.lineIndex] = newLine
      const nt = nl.join('\n')
      setCurrentText(nt); prevRef.current = nt; onChange(nt)
      return
    }

    if (editCell.cellIndex < 0) {
      if (editCell.isVirtual) return
      const nl = [...lines]; nl[editCell.lineIndex] = flowIndentRef.current + flowMarkRef.current + val
      const nt = nl.join('\n')
      setCurrentText(nt); prevRef.current = nt; onChange(nt)
      return
    }

    if (editCell.fieldIdx < 0) return

    // 表格单元格
    const rawLine = lines[editCell.lineIndex]
    const newLine = rebuildLineField(rawLine, editCell.fieldIdx, val, editCell.sliceField)
    const nl = [...lines]; nl[editCell.lineIndex] = newLine
    const nt = nl.join('\n')
    setCurrentText(nt); prevRef.current = nt; onChange(nt)
  }, [editCell, lines, onChange, replaceCallArg])

  /** 渲染某行的流程线段 */
  const renderFlowSegs = (lineIndex: number, isExpanded?: boolean): { node: React.ReactNode; skipTreeLines: number } => {
    if (flowLines.maxDepth === 0) return { node: null, skipTreeLines: 0 }
    const segs = flowLines.map.get(lineIndex) || []
    if (segs.length === 0) return { node: null, skipTreeLines: 0 }
    // 按该行实际最大深度分配占位（而非全局 maxDepth），避免外层行被内层撑宽
    const lineMaxDepth = Math.max(...segs.map(s => s.depth)) + 1
    const slots: (FlowSegment | null)[] = Array(lineMaxDepth).fill(null)
    for (const s of segs) slots[s.depth] = s
    return {
      node: (
        <>
          {slots.map((seg, d) => (
            <span key={d} className={`eyc-flow-seg ${seg ? `eyc-flow-${seg.type}` : ''} ${seg?.isLoop ? 'eyc-flow-loop' : ''} ${seg?.isMarker ? 'eyc-flow-marker' : ''}${(seg?.isInnerThrough || seg?.isInnerEnd) ? ' eyc-flow-no-outer' : ''}${seg?.hasPrevFlowEnd ? ' eyc-flow-has-prev-end' : ''}${seg?.hasOuterLink ? ' eyc-flow-has-outer-link' : ''}${seg?.outerHidden ? ' eyc-flow-outer-hidden' : ''}${seg?.hasInnerLink ? ' eyc-flow-has-inner-link' : ''}${seg?.isStraightEnd ? ' eyc-flow-straight-end' : ''}`}>
              {seg?.isMarker && seg.type === 'branch' && seg?.markerInnerVert && !seg?.outerHidden && <span className="eyc-flow-inner-vert" />}
              {seg?.type === 'branch' && !seg?.isMarker && seg?.hasInnerVert && <span className="eyc-flow-inner-vert eyc-flow-inner-through" />}
              {seg?.type === 'branch' && !seg?.isMarker && seg?.hasInnerLink && <span className="eyc-flow-outer-resume" />}
              {seg?.type === 'branch' && !seg?.isMarker && seg?.hasInnerLink && <span className="eyc-flow-outer-horz" />}
              {seg?.type === 'branch' && !seg?.isMarker && seg?.hasInnerLink && <span className="eyc-flow-outer-arrow" />}
              {seg?.isMarker && seg.type === 'end' && !seg?.hasExtraEnds && !seg?.hasNextFlow && !seg?.outerHidden && (isExpanded ? <span className="eyc-flow-inner-vert eyc-flow-inner-through" /> : <><span className="eyc-flow-inner-vert" /><span className="eyc-flow-arrow-down eyc-flow-inner-arrow-down" /><span className="eyc-flow-arrow-right" /></>)}
              {seg?.isMarker && seg.type === 'end' && !seg?.hasExtraEnds && !seg?.hasNextFlow && seg?.outerHidden && (isExpanded ? <span className="eyc-flow-inner-vert eyc-flow-inner-through" /> : <><span className="eyc-flow-inner-vert" /><span className="eyc-flow-arrow-down eyc-flow-inner-arrow-down" /></>)}
              {seg?.isMarker && seg.type === 'end' && !seg?.hasExtraEnds && seg?.hasNextFlow && !seg?.outerHidden && <><span className="eyc-flow-inner-vert eyc-flow-inner-through" /><span className="eyc-flow-arrow-right" /></>}
              {seg?.isMarker && seg.type === 'end' && seg?.hasExtraEnds && !seg?.outerHidden && <><span className="eyc-flow-inner-vert eyc-flow-inner-through" /><span className="eyc-flow-arrow-right" /></>}
              {seg?.type === 'start' && seg?.hasPrevFlowEnd && <><span className="eyc-flow-link-vert" /><span className="eyc-flow-link-horz" /><span className="eyc-flow-link-arrow" /></>}
              {seg?.type === 'start' && seg?.isLoop && <span className="eyc-flow-arrow-right" />}
              {seg?.type === 'end' && !seg?.isMarker && !seg?.isStraightEnd && !seg?.isLoop && <span className="eyc-flow-arrow-down" />}
              {seg?.isStraightEnd && <span className="eyc-flow-arrow-down" />}
              {seg?.hasInnerVert && !seg?.hasInnerLink && <span className="eyc-flow-inner-vert eyc-flow-inner-through" />}
              {seg?.hasInnerLink && seg?.type !== 'branch' && <><span className="eyc-flow-inner-link-horz" /><span className="eyc-flow-inner-link-arrow" /></>}
              {seg?.isInnerThrough && <span className="eyc-flow-inner-vert eyc-flow-inner-through" />}
              {seg?.isInnerEnd && <><span className="eyc-flow-inner-vert eyc-flow-inner-end" /><span className="eyc-flow-arrow-down eyc-flow-inner-arrow-down" /></>}
            </span>
          ))}
        </>
      ),
      skipTreeLines: lineMaxDepth,
    }
  }

  /** 渲染参数展开区域的流程线延续（只绘制纵向穿越线） */
  const renderFlowContinuation = (lineIndex: number): React.ReactNode => {
    if (flowLines.maxDepth === 0) return null
    const segs = flowLines.map.get(lineIndex) || []
    if (segs.length === 0) return null
    const lineMaxDepth = Math.max(...segs.map(s => s.depth)) + 1
    const slots: (FlowSegment | null)[] = Array(lineMaxDepth).fill(null)
    for (const s of segs) slots[s.depth] = s
    // 只绘制有纵向延续的线段（start/through/branch/标记end 都有竖线穿过）
    const hasAny = slots.some(seg => seg && (seg.type === 'start' || seg.type === 'through' || seg.type === 'branch' || (seg.type === 'end' && (seg.hasExtraEnds || seg.isMarker))))
    if (!hasAny) return null
    return (
      <div className="eyc-param-flow-cont">
        {slots.map((seg, d) => {
          // 内侧竖线延续：标记分支/标记结束/hasInnerVert/isInnerThrough/isInnerEnd
          const hasInnerCont = seg && (
            (seg.isMarker && ((seg.type === 'branch' && seg.markerInnerVert) || seg.type === 'end'))
            || (seg.hasInnerVert)
            || (seg.isInnerThrough)
            || (seg.isInnerEnd)
          )
          // 有内侧竖线时用内侧位置绘制，否则用外侧竖线
          const hasCont = seg && (seg.type === 'start' || seg.type === 'through' || seg.type === 'branch' || (seg.type === 'end' && (seg.hasExtraEnds || seg.isMarker))) && !seg.outerHidden
          // 标记结束行：延续内侧竖线到底部并绘制向下箭头
          const isEndMarker = seg && seg.type === 'end' && seg.isMarker && !seg.hasExtraEnds
          // 需要同时绘制外侧和内侧两条线：标记分支行 / 含内侧竖线的穿越行
          const needsBothLines = seg && hasInnerCont && hasCont && (
            (seg.isMarker && seg.type === 'branch' && seg.markerInnerVert)
            || seg.hasInnerVert
          )
          return (
            <span key={d} className={`eyc-flow-seg eyc-flow-cont-seg ${hasCont ? (hasInnerCont ? (isEndMarker ? '' : (needsBothLines ? 'eyc-flow-through' : 'eyc-flow-through eyc-flow-cont-inner')) : 'eyc-flow-through') : ''} ${seg?.isLoop && hasCont ? 'eyc-flow-loop' : ''}`}>
              {hasCont && hasInnerCont && isEndMarker && <><span className="eyc-flow-inner-vert eyc-flow-inner-end" /><span className="eyc-flow-arrow-down eyc-flow-inner-arrow-down" /></>}
              {needsBothLines && <span className="eyc-flow-inner-vert eyc-flow-inner-through" />}
            </span>
          )
        })}
      </div>
    )
  }

  // 点击空白区域：清除选择和编辑状态
  const handleWrapperMouseDown = useCallback((e: React.MouseEvent) => {
    // 只处理直接点击 wrapper 自身（空白区域），不处理子元素冒泡
    if (e.target !== wrapperRef.current) return
    e.preventDefault()
    // 如果有活跃编辑，先提交（含自动补全上屏），而非直接丢弃
    if (editCellRef.current) {
      commitRef.current()
    } else {
      setEditCell(null)
      setAcVisible(false)
    }
    // 点击末尾空白区域：不立即标记行选中蓝色，等 mouseup 确认是否为拖动
    const lastLine = lines.length - 1
    if (lastLine >= 0) {
      dragStartPos.current = { x: e.clientX, y: e.clientY }
      wasDragSelect.current = false
      dragAnchor.current = lastLine
      isDragging.current = true
      wrapperRef.current?.focus()

      // 仅在“点击未拖动”时进入最后一行编辑；若发生拖动则保持多选结果
      const handleMouseUp = (): void => {
        window.removeEventListener('mouseup', handleMouseUp)
        if (!wasDragSelect.current) {
          setSelectedLines(new Set())
          startEditLine(lastLine)
        }
      }
      window.addEventListener('mouseup', handleMouseUp)
    } else {
      setSelectedLines(new Set())
    }
  }, [lines.length, startEditLine])

  return (
    <div className="eyc-table-editor ebackcolor1" onClick={() => onCommandClear?.()}>
      <div
        className="eyc-table-wrapper"
        ref={wrapperRef}
        onMouseDown={handleWrapperMouseDown}
        onCopy={(e) => {
          if (selectedLines.size === 0) return
          e.preventDefault()
          e.clipboardData.setData('text/plain', getSelectedSourceText())
        }}
        onPaste={(e) => {
          const clipText = e.clipboardData.getData('text/plain')
          if (!clipText) return
          e.preventDefault()
          const pastedLines = sanitizePastedTextForCurrent(clipText, currentText).split('\n').map(l => l.replace(/\r$/, ''))
          const ls = currentText.split('\n')
          const protectedLine = (() => {
            const parsed = parseLines(ls.join('\n'))
            for (let i = 0; i < parsed.length; i++) {
              const tp = parsed[i].type
              if (tp !== 'blank' && tp !== 'comment' && tp !== 'code' && tp !== 'version' && tp !== 'supportLib') return i
            }
            return -1
          })()
          pushUndo(currentText)
          if (selectedLines.size > 0) {
            const sorted = [...selectedLines].sort((a, b) => a - b)
            const deletable = new Set<number>()
            for (const i of selectedLines) {
              if (i < 0 || i >= ls.length) continue
              if (i === protectedLine) continue
              deletable.add(i)
            }
            const sortedDeletable = [...deletable].sort((a, b) => a - b)
            const insertAt = sortedDeletable.length > 0
              ? sortedDeletable[0]
              : (protectedLine >= 0 ? Math.min(protectedLine + 1, ls.length) : ls.length)
            const nl = ls.filter((_, i) => !deletable.has(i))
            nl.splice(insertAt, 0, ...pastedLines)
            const nt = nl.join('\n')
            setCurrentText(nt); prevRef.current = nt; onChange(nt)
            const newSel = new Set<number>()
            for (let i = 0; i < pastedLines.length; i++) newSel.add(insertAt + i)
            setSelectedLines(newSel)
          } else {
            const nl = [...ls, ...pastedLines]
            const nt = nl.join('\n')
            setCurrentText(nt); prevRef.current = nt; onChange(nt)
            const newSel = new Set<number>()
            for (let i = 0; i < pastedLines.length; i++) newSel.add(ls.length + i)
            setSelectedLines(newSel)
          }
        }}
        tabIndex={0}
        style={{ outline: 'none' }}
      >
        {blocks.map((blk, bi) => {
          if (blk.kind === 'table') {
            // 表格行中所有数据行的行号
            const tableLineIndices = blk.rows.filter(r => !r.isHeader).map(r => r.lineIndex)
            const tableSelected = tableLineIndices.some(li => selectedLines.has(li))
            return (
              <div key={bi} className={`eyc-block-row${tableSelected ? ' eyc-line-selected' : ''}`}
                data-line-index={tableLineIndices[0] ?? blk.lineIndex}
                onMouseDown={(e) => handleLineMouseDown(e, tableLineIndices[0] ?? blk.lineIndex)}
              >
                <div className="eyc-line-gutter">
                  {blk.rows.map((row, ri) => (
                    <div key={ri} className="eyc-gutter-cell">
                      <span className="eyc-gutter-linenum">{row.isHeader ? '' : (lineNumMap.get(row.lineIndex) ?? row.lineIndex + 1)}</span>
                      <span className="eyc-gutter-fold-area" />
                    </div>
                  ))}
                </div>
                <div className="eyc-block-content">
                  <table className="eyc-decl-table" cellSpacing={0}>
                    <tbody>
                      {blk.rows.map((row, ri) => (
                        <tr
                          key={ri}
                          className={row.isHeader ? 'eyc-hdr-row' : 'eyc-data-row'}
                          {...(!row.isHeader ? { 'data-line-index': row.lineIndex } : {})}
                        >
                      {row.cells.map((cell, ci) => (
                        <td
                          key={ci}
                          className={`${cell.cls} Rowheight`}
                          colSpan={cell.colSpan}
                          style={cell.align ? { textAlign: cell.align as 'center' } : undefined}
                          onClick={() => !row.isHeader && startEditCell(row.lineIndex, ci, cell.text, cell.fieldIdx, cell.sliceField)}
                        >
                          {editCell && editCell.lineIndex === row.lineIndex && editCell.cellIndex === ci && !row.isHeader ? (
                            <div style={{ position: 'relative', display: 'inline-grid' }}>
                              <span style={{ gridArea: '1/1', visibility: 'hidden', whiteSpace: 'pre', font: 'inherit', padding: 0 }}>
                                {(editVal.length > (cell.text || '\u00A0').length ? editVal : (cell.text || '\u00A0')) + '\u00A0'}
                              </span>
                              <input
                                ref={inputRef}
                                className="eyc-cell-input"
                                style={{ gridArea: '1/1' }}
                                value={editVal}
                                onMouseDown={(e) => {
                                  if (e.button !== 0) return
                                  // 记录起始位置；如果鼠标拖出 input 边界则切换为跳行拖选
                                  pendingInputDragRef.current = { lineIndex: row.lineIndex, x: e.clientX, y: e.clientY }
                                }}
                                onChange={e => { setEditVal(e.target.value); liveUpdate(e.target.value) }}
                                onBlur={() => commit()}
                                onKeyDown={onKey}
                                spellCheck={false}
                              />
                            </div>
                          ) : (
                            cell.text || '\u00A0'
                          )}
                        </td>
                      ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            )
          }

          // 代码行
          const codeLineRaw = blk.codeLine || ''
          const isLoopEnd = /[\u200B]?(判断循环尾|循环判断尾|计次循环尾|变量循环尾)/.test(codeLineRaw)
          const isAutoFlowLine = !blk.isVirtual && codeLineRaw.includes(FLOW_AUTO_TAG) && !isLoopEnd
          const spans = colorize((blk.codeLine || '').replace(FLOW_AUTO_TAG, ''))
          const lineCmd = blk.isVirtual ? null : findCmdWithParams((blk.codeLine || '').replace(FLOW_AUTO_TAG, ''))
          const isExpanded = expandedLines.has(blk.lineIndex)
          const isLineSelected = selectedLines.has(blk.lineIndex)
          return (
            <div
              key={bi}
              className={`eyc-block-row eyc-block-row-wrap${isAutoFlowLine ? ' eyc-flow-auto-line' : ''}${isLineSelected ? ' eyc-line-selected' : ''}`}
              data-line-index={blk.lineIndex}
              onMouseDown={(e) => handleLineMouseDown(e, blk.lineIndex)}
            >
              <div className="eyc-line-gutter">
                <div className="eyc-gutter-cell">
                  <span className="eyc-gutter-linenum">{blk.isVirtual ? '' : (lineNumMap.get(blk.lineIndex) ?? blk.lineIndex + 1)}</span>
                  <span className="eyc-gutter-fold-area">
                    {lineCmd && (isLineSelected || (editCell && editCell.lineIndex === blk.lineIndex && editCell.paramIdx === undefined)) && (
                      <span
                        className="eyc-gutter-fold"
                        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
                        onClick={(e) => {
                          e.stopPropagation()
                          setExpandedLines(prev => {
                            const next = new Set(prev)
                            if (next.has(blk.lineIndex)) next.delete(blk.lineIndex)
                            else next.add(blk.lineIndex)
                            return next
                          })
                        }}
                      >{isExpanded ? '−' : '+'}</span>
                    )}
                  </span>
                </div>
              </div>
              <div
                className={`eyc-code-line${editCell && editCell.lineIndex === blk.lineIndex && editCell.isVirtual === blk.isVirtual && editCell.paramIdx === undefined ? ' eyc-code-line-editing' : ''}`}
                onClick={(e) => {
                  // 已在输入框内操作（如拖选文字）时不重置编辑状态
                  if ((e.target as HTMLElement).tagName === 'INPUT') return
                  // 拖选后不进入编辑模式，保留行选中状态
                  if (wasDragSelect.current) { wasDragSelect.current = false; return }
                  // 普通单击进入编辑模式前清除任何行选中
                  setSelectedLines(new Set())
                  // 点击代码行时触发命令提示（显示命令全部信息）
                  const rawCode = (blk.codeLine || '').replace(FLOW_AUTO_TAG, '')
                  const cmdName = findFirstCommandName(rawCode)
                  if (cmdName) {
                    e.stopPropagation()
                    onCommandClick?.(cmdName)
                  }
                  startEditLine(blk.lineIndex, e.clientX, e.currentTarget.getBoundingClientRect().left, blk.isVirtual)
                }}
              >
              {editCell && editCell.lineIndex === blk.lineIndex && editCell.isVirtual === blk.isVirtual && editCell.paramIdx === undefined ? (
                <>
                  {renderFlowSegs(blk.lineIndex, isExpanded).node}
                  <input
                    ref={inputRef}
                    className="eyc-inline-input"
                    value={editVal}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return
                      // 记录起始位置；如果鼠标拖出 input 边界则切换为跳行拖选
                      pendingInputDragRef.current = { lineIndex: blk.lineIndex, x: e.clientX, y: e.clientY }
                    }}
                    onChange={e => {
                      const v = e.target.value
                      // 命令行括号保护：阻止 IME/粘贴等修改括号外的内容
                      if (editCell?.cellIndex === -1) {
                        const oldRange = getOuterParenRange(editVal)
                        if (oldRange) {
                          const prefix = editVal.slice(0, oldRange.start + 1)
                          const suffix = editVal.slice(oldRange.end)
                          if (!v.startsWith(prefix) || !v.endsWith(suffix)) {
                            e.target.value = editVal
                            return
                          }
                        }
                      }
                      setEditVal(v)
                      liveUpdate(v)
                      const pos = e.target.selectionStart ?? v.length
                      updateCompletion(v, pos)
                    }}
                    onBlur={() => { setTimeout(() => setAcVisible(false), 150); commit() }}
                    onKeyDown={onKey}
                    spellCheck={false}
                  />
                </>
              ) : (
                <span className="eyc-code-spans">
                  {(() => {
                    const flow = renderFlowSegs(blk.lineIndex, isExpanded)
                    let treeSkipped = 0
                    return (
                      <>
                        {flow.node}
                        {spans.map((s, si) => {
                          // 跳过被流程线替代的树线缩进
                          if (s.cls === 'eTreeLine' && treeSkipped < flow.skipTreeLines) {
                            treeSkipped++
                            return null
                          }
                          const isFunc = s.cls === 'funccolor'
                          const isObjMethod = s.cls === 'cometwolr'
                          const isFlowKw = s.cls === 'comecolor'
                          const isAssignTarget = s.cls === 'assignTarget'
                          const isInvalid = (isFunc && !validCommandNames.has(s.text)) || (isAssignTarget && !userVarNames.has(s.text))
                          if (isFunc || isObjMethod || isFlowKw || isAssignTarget) {
                            return (
                              <span
                                key={si}
                                className={`${isAssignTarget ? 'Variablescolor' : s.cls}${isInvalid ? ' eyc-cmd-invalid' : ''}`}
                              >{s.text}</span>
                            )
                          }
                          return <span key={si} className={s.cls}>{s.text}</span>
                        })}
                      </>
                    )
                  })()}
                </span>
              )}
              </div>
              {/* 展开的参数详情 */}
              {lineCmd && isExpanded && (() => {
                const argVals = parseCallArgs(blk.codeLine || '')
                // 计算代码行前导空格数，用于参数面板缩进
                const codeLine = (blk.codeLine || '').replace(FLOW_AUTO_TAG, '')
                const leadingSpaces = codeLine.length - codeLine.replace(/^ +/, '').length
                // 基础左边距 = gutter(80px) + 缩进空格(ch) + 命令名约1.5个字符居中位置
                const baseLeft = 80 + 8  // gutter + padding
                const indentCh = leadingSpaces + 1.5  // 缩进 + 命令名中间约1.5字符
                const arrowLeftStyle = `calc(${baseLeft}px + ${indentCh}ch)`
                const expandPadding = `calc(${baseLeft + 20}px + ${leadingSpaces}ch)`
                return (
                  <div className="eyc-param-expand" style={{ paddingLeft: expandPadding }}>
                    {renderFlowContinuation(blk.lineIndex)}
                    <span className="eyc-param-expand-arrow" style={{ left: arrowLeftStyle }} />
                    <div className="eyc-param-expand-inner" style={{ '--vline-offset': 'calc(-20px + 1.5ch)' } as React.CSSProperties}>
                      {lineCmd.params.map((p, pi) => {
                        const isEditingParam = editCell && editCell.lineIndex === blk.lineIndex && editCell.paramIdx === pi
                        const startParamEdit = (e: React.MouseEvent) => {
                          e.stopPropagation()
                          // 点击参数行时提示该参数的信息
                          const rawCode = (blk.codeLine || '').replace(FLOW_AUTO_TAG, '')
                          const cmdName = findFirstCommandName(rawCode)
                          if (cmdName) onCommandClick?.(cmdName, pi)
                          setEditCell({ lineIndex: blk.lineIndex, cellIndex: -2, fieldIdx: -1, sliceField: false, paramIdx: pi })
                          setEditVal(argVals[pi] !== undefined ? argVals[pi] : '')
                          setTimeout(() => paramInputRef.current?.focus(), 0)
                        }
                        return (
                          <div key={pi} className="eyc-param-expand-row" onClick={isEditingParam ? undefined : startParamEdit} style={{ cursor: isEditingParam ? undefined : 'text' }}>
                            <span className="eyc-param-expand-mark">※</span>
                            <span className="eyc-param-expand-name">{p.name}</span>
                            <span className="eyc-param-expand-colon">：</span>
                            {isEditingParam ? (
                              <input
                                ref={paramInputRef}
                                className="eyc-param-val-input"
                                value={editVal}
                                onChange={e => { setEditVal(e.target.value); liveUpdate(e.target.value) }}
                                onBlur={() => commit()}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') { e.preventDefault(); commit() }
                                  else if (e.key === 'Escape') setEditCell(null)
                                }}
                                spellCheck={false}
                              />
                            ) : (
                              <span className="eyc-param-expand-val">{argVals[pi] !== undefined ? argVals[pi] : '\u00A0'}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>
          )
        })}
      </div>

      {/* 自动补全弹窗 */}
      {acVisible && acItems.length > 0 && (
        <div
          className="eyc-ac-container"
          style={{ left: acPos.left, top: acPos.top }}
          onMouseDown={e => e.preventDefault()}
        >
          <div className="eyc-ac-popup" ref={acListRef}>
            {acItems.map((item, i) => (
              <div
                key={item.cmd.name}
                className={`eyc-ac-item ${i === acIndex ? 'eyc-ac-item-active' : ''}`}
                onMouseEnter={() => setAcIndex(i)}
                onClick={() => applyCompletion(item)}
              >
                <span className={`eyc-ac-icon ${getCmdIconClass(item.cmd.category)}`}>{getCmdIconLabel(item.cmd.category)}</span>
                <span className="eyc-ac-name">{item.cmd.name}{item.engMatch && item.cmd.englishName ? `（${item.cmd.englishName}）` : ''}</span>
                {item.cmd.returnType && <span className="eyc-ac-return">{item.cmd.returnType}</span>}
              </div>
            ))}
          </div>
          {acItems[acIndex] && (() => {
            const ci = acItems[acIndex].cmd
            const paramSig = ci.params.length > 0
              ? ci.params.map(p => {
                  let s = ''
                  if (p.optional) s += '［'
                  s += p.type
                  if (p.isArray) s += '数组'
                  s += ' ' + p.name
                  if (p.optional) s += '］'
                  return s
                }).join('，')
              : ''
            const retLabel = ci.returnType ? `〈${ci.returnType}〉` : '〈无返回值〉'
            const source = [ci.libraryName, ci.category].filter(Boolean).join('->')
            return (
              <div className="eyc-ac-detail">
                <div className="eyc-ac-detail-call">
                  <span className="eyc-ac-detail-label">调用格式：</span>
                  {retLabel} {ci.name} （{paramSig}）{source && <> - {source}</>}
                </div>
                {ci.englishName && (
                  <div className="eyc-ac-detail-eng">
                    <span className="eyc-ac-detail-label">英文名称：</span>{ci.englishName}
                  </div>
                )}
                {ci.description && (
                  <div className="eyc-ac-detail-desc">{ci.description}</div>
                )}
                {ci.params.length > 0 && (
                  <div className="eyc-ac-detail-params">
                    {ci.params.map((p, pi) => (
                      <div key={pi} className="eyc-ac-detail-param">
                        <span className="eyc-ac-detail-param-head">
                          参数&lt;{pi + 1}&gt;的名称为"{p.name}"，类型为"{p.type}{p.isArray ? '(数组)' : ''}{p.isVariable ? '(参考)' : ''}"{p.optional ? '，可以被省略' : ''}。
                        </span>
                        {p.description && <span className="eyc-ac-detail-param-desc">{p.description}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
})

export default EycTableEditor
