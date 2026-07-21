import type { CellData, DeclType, ParsedLine, RenderBlock } from './eycTableModel'

export function splitCSV(text: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    // \u5f15\u53f7\u5185\u7684\u53cd\u659c\u6760\u8f6c\u4e49\uff08\u957f\u6587\u672c\u5e38\u91cf\u7684 \" \\ \n \u7b49\uff09\u6574\u4f53\u900f\u4f20\uff0c\u907f\u514d \" \u88ab\u5f53\u6210\u5f15\u53f7\u7ed3\u675f\u3001
    // \u5bfc\u81f4\u5176\u540e\u7684\u9017\u53f7\u88ab\u8bef\u5f53\u5b57\u6bb5\u5206\u9694\u7b26\u628a\u503c\u622a\u65ad
    if (inQ && ch === '\\' && i + 1 < text.length) { cur += ch + text[i + 1]; i++; continue }
    if (inQ) { cur += ch; if (ch === '"' || ch === '\u201d') inQ = false; continue }
    if (ch === '"' || ch === '\u201c') { inQ = true; cur += ch; continue }
    // \u884c\u5c3e\u88f8\u9017\u53f7\u4e5f\u89c6\u4e3a\u5206\u9694\u7b26\uff0c\u907f\u514d\u201c\u540d\u79f0,\u201d\u88ab\u5e76\u5165\u5b57\u6bb5\uff08\u5982 .\u6307\u9488\u547d\u4ee4 \u540d\u79f0,\uff09
    if (ch === ',' && (i + 1 === text.length || text[i + 1] === ' ')) {
      result.push(cur); cur = ''; i++; continue
    }
    cur += ch
  }
  result.push(cur)
  return result
}

export function unquote(s: string): string {
  if (!s) return ''
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('\u201c') && s.endsWith('\u201d'))) {
    return s.slice(1, -1)
  }
  return s
}

/**
 * 长文本常量值的行内转义：多行文本要存进单行 `.长文本常量 名, "…"`。
 * 转义集与 **C++ 字符串字面量完全一致**（\\ \" \n \r \t），故编译期 `#define 名 ("…")` 可直接透传不必反转义。
 */
export function escapeLongTextValue(text: string): string {
  return (text || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
}

/** 行内转义还原为真实多行文本（编辑弹窗显示用） */
export function unescapeLongTextValue(stored: string): string {
  let out = ''
  const s = stored || ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\' || i === s.length - 1) { out += s[i]; continue }
    const next = s[++i]
    out += next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next === '"' ? '"' : next === '\\' ? '\\' : '\\' + next
  }
  return out
}

export function inferResourceTypeByFileName(fileName: string): string {
  const ext = ((fileName || '').split('.').pop() || '').toLowerCase()
  const imageExt = new Set(['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'svg', 'ico', 'tif', 'tiff'])
  const audioExt = new Set(['wav', 'mp3', 'ogg', 'wma', 'aac', 'flac', 'm4a', 'mid', 'midi'])
  const videoExt = new Set(['mp4', 'avi', 'mov', 'wmv', 'mkv', 'webm', 'flv', 'm4v', 'mpeg', 'mpg'])
  if (imageExt.has(ext)) return '图片'
  if (audioExt.has(ext)) return '声音'
  if (videoExt.has(ext)) return '视频'
  return '其它'
}

export function parseLines(text: string): ParsedLine[] {
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
      ['globalVar', '.全局变量 '], ['longConstant', '.长文本常量 '], ['constant', '.常量 '],
      ['resource', '.资源 '],
      ['dataType', '.数据类型 '], ['dll', '.DLL命令 '],
      ['ptrCmd', '.指针命令 '],
      ['image', '.图片 '], ['sound', '.声音 '],
    ]
    for (const [dt, pf] of decls) {
      const kw = pf.trim()
      if (t === kw || t.startsWith(pf)) {
        const rest = t === kw ? '' : t.slice(pf.length)
        return { type: dt, raw: line, fields: splitCSV(rest) }
      }
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

export function buildBlocks(text: string, isClassModule = false, isResourceTable = false): RenderBlock[] {
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
      if (he === 1 || he === 2 || he === 11) { flush(); he = 0 }
      if (he === 0) blocks.push({ kind: 'codeline', rows: [], codeLine: '', lineIndex: i })
      continue
    }

    if (ln.type === 'comment') {
      if (he !== 0) { flush(); he = 0 }
      blocks.push({ kind: 'codeline', rows: [], codeLine: ln.raw, lineIndex: i })
      continue
    }

    if (ln.type === 'assembly') {
      flush()
      const rest = ln.raw.replace(/[\r\t]/g, '').trim().slice('.程序集 '.length)
      const parts = splitCSV(rest)
      const name = parts[0] || ''
      if (isClassModule) {
        const baseClass = parts[1] || '\u00A0'
        const isPublic = (parts[2] || '').includes('公开')
        const remark = parts.length > 3 ? parts.slice(3).join(', ') : ''
        newTbl('assembly', ['类 名', '基 类', '公开', '备 注'], i, 'eAssemblycolor')
        pushRow(i, [
          { text: name, cls: 'eProcolor', fieldIdx: 0 },
          { text: baseClass, cls: 'eTypecolor', fieldIdx: 1 },
          { text: isPublic ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
          { text: remark, cls: 'Remarkscolor', fieldIdx: 3, sliceField: true },
        ])
      } else {
        const remark = parts.length > 3 ? parts.slice(3).join(', ') : ''
        newTbl('assembly', ['窗口程序集名', '保 留\u00A0\u00A0', '保 留', '备 注'], i, 'eAssemblycolor')
        pushRow(i, [
          { text: name, cls: 'eProcolor', fieldIdx: 0 },
          { text: '\u00A0', cls: '' },
          { text: '\u00A0', cls: '' },
          { text: remark, cls: 'Remarkscolor', fieldIdx: 3, sliceField: true },
        ])
      }
      he = 3; continue
    }

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

    if (ln.type === 'sub') {
      flush()
      tbl = { kind: 'table', tableType: 'sub', rows: [], lineIndex: i }
      if (isClassModule) {
        tbl.rows.push({ lineIndex: i, isHeader: true, cells: [
          { text: '子程序名', cls: 'eHeadercolor' },
          { text: '返回值类型', cls: 'eHeadercolor' },
          { text: '公开', cls: 'eHeadercolor' },
          { text: '保 留', cls: 'eHeadercolor' },
          { text: '备 注', cls: 'eHeadercolor', colSpan: 2 },
        ] })
        const reserveText = f[3] || '\u00A0'
        const remarkText = f.length > 4 ? f.slice(4).join(', ') : (f.length > 3 ? (f[3] || '') : '')
        tbl.rows.push({ lineIndex: i, cells: [
          { text: f[0] || '', cls: 'eProcolor', fieldIdx: 0 },
          { text: f[1] || '\u00A0', cls: 'eTypecolor', fieldIdx: 1 },
          { text: f[2] === '公开' ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
          { text: reserveText, cls: '', fieldIdx: 3 },
          { text: remarkText, cls: 'Remarkscolor', colSpan: 2, fieldIdx: 4, sliceField: true },
        ] })
      } else {
        tbl.rows.push({ lineIndex: i, isHeader: true, cells: [
          { text: '子程序名', cls: 'eHeadercolor' },
          { text: '返回值类型', cls: 'eHeadercolor' },
          { text: '公开', cls: 'eHeadercolor' },
          { text: '备 注', cls: 'eHeadercolor', colSpan: 3 },
        ] })
        tbl.rows.push({ lineIndex: i, cells: [
          { text: f[0] || '', cls: 'eProcolor', fieldIdx: 0 },
          { text: f[1] || '\u00A0', cls: 'eTypecolor', fieldIdx: 1 },
          { text: f[2] === '公开' ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
          { text: f.length > 3 ? f.slice(3).join(', ') : '', cls: 'Remarkscolor', colSpan: 3, fieldIdx: 3, sliceField: true },
        ] })
      }
      he = 1; continue
    }

    if (ln.type === 'subParam') {
      if (he === 4) {
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
        if (isClassModule) {
          tbl.rows.push({ lineIndex: i, isHeader: true, cells: [
            { text: '子程序名', cls: 'eHeadercolor' },
            { text: '返回值类型', cls: 'eHeadercolor' },
            { text: '公开', cls: 'eHeadercolor' },
            { text: '保 留', cls: 'eHeadercolor' },
            { text: '备 注', cls: 'eHeadercolor', colSpan: 2 },
          ] })
          tbl.rows.push({ lineIndex: i, cells: [
            { text: '(未填写子程序名)', cls: 'Wrongcolor' },
            { text: '\u00A0', cls: '' }, { text: '\u00A0', cls: '' }, { text: '\u00A0', cls: '' }, { text: '\u00A0', cls: '', colSpan: 2 },
          ] })
        } else {
          tbl.rows.push({ lineIndex: i, isHeader: true, cells: [
            { text: '子程序名', cls: 'eHeadercolor' },
            { text: '返回值类型', cls: 'eHeadercolor' },
            { text: '公开', cls: 'eHeadercolor' },
            { text: '备 注', cls: 'eHeadercolor', colSpan: 3 },
          ] })
          tbl.rows.push({ lineIndex: i, cells: [
            { text: '(未填写子程序名)', cls: 'Wrongcolor' },
            { text: '\u00A0', cls: '' }, { text: '\u00A0', cls: '' }, { text: '\u00A0', cls: '', colSpan: 3 },
          ] })
        }
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

    if (ln.type === 'localVar') {
      if (he !== 2) {
        // 局部变量表独立成块（不再并入子程序/参数表）：折叠范围计算本就按
        // 「下一个非 localVar 表格块」预期此结构；独立块之间由 CSS 留视觉间距
        flush()
        newTbl('localVar', ['变量名', '类 型', '静态', '数组', '备 注'], i, 'eVariableheadcolor')
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

    if (ln.type === 'constant' || ln.type === 'resource' || ln.type === 'longConstant') {
      if (he !== 9) {
        flush()
        if (isResourceTable) {
          newTbl('constant', ['资源名称', '资源内容', '资源类型', '公开', '备注'], i)
        } else {
          newTbl('constant', ['常量名称', '常量值', '公 开', '备 注'], i)
        }
      }
      if (isResourceTable) {
        const fileName = f.length > 1 ? unquote(f[1]) : ''
        const inferredType = inferResourceTypeByFileName(fileName)
        const legacyPublicAt2 = f[2] === '公开'
        pushRow(i, [
          { text: f[0] || '', cls: 'eOthercolor', fieldIdx: 0 },
          { text: f.length > 1 ? unquote(f[1]) : '\u00A0', cls: 'Constanttext', fieldIdx: 1 },
          { text: legacyPublicAt2 ? inferredType : (f[2] || inferredType || '\u00A0'), cls: 'eTypecolor', fieldIdx: 2 },
          { text: (legacyPublicAt2 || f[3] === '公开') ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
          { text: legacyPublicAt2 ? (f.length > 3 ? f.slice(3).join(', ') : '') : (f.length > 4 ? f.slice(4).join(', ') : ''), cls: 'Remarkscolor', fieldIdx: 4, sliceField: true },
        ])
      } else if (ln.type === 'longConstant') {
        // 长文本常量：值列不显示内容本身，而显示 `<文本长度: N>`（N=还原后真实字符数，与易语言一致）；
        // 该格标 longText —— 单击/双击弹多行文本编辑框，绝不可行内编辑（否则占位文本会被写回覆盖真值）
        const storedValue = f.length > 1 ? unquote(f[1]) : ''
        const realLength = unescapeLongTextValue(storedValue).length
        pushRow(i, [
          { text: f[0] || '', cls: 'eOthercolor', fieldIdx: 0 },
          { text: `<文本长度: ${realLength}>`, cls: 'Constanttext', fieldIdx: 1, longText: true },
          { text: f[2] === '公开' ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
          { text: f.length > 3 ? f.slice(3).join(', ') : '', cls: 'Remarkscolor', fieldIdx: 3, sliceField: true },
        ])
      } else {
        pushRow(i, [
          { text: f[0] || '', cls: 'eOthercolor', fieldIdx: 0 },
          { text: f.length > 1 ? unquote(f[1]) : '\u00A0', cls: 'Constanttext', fieldIdx: 1 },
          { text: f[2] === '公开' ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
          { text: f.length > 3 ? f.slice(3).join(', ') : '', cls: 'Remarkscolor', fieldIdx: 3, sliceField: true },
        ])
      }
      he = 9; continue
    }

    if (ln.type === 'dataType') {
      flush()
      tbl = { kind: 'table', tableType: 'dataType', rows: [], lineIndex: i }
      tbl.rows.push({ lineIndex: i, isHeader: true, cells: [
        { text: '数据类型名', cls: 'eHeadercolor' },
        { text: '公开', cls: 'eHeadercolor' },
        { text: '备 注', cls: 'eHeadercolor', colSpan: 3 },
      ] })
      pushRow(i, [
        { text: f[0] || '', cls: 'eProcolor', fieldIdx: 0 },
        { text: f[1]?.includes('公开') ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
        { text: f.length > 2 ? f.slice(2).join(', ') : '', cls: 'Remarkscolor', fieldIdx: 2, sliceField: true, colSpan: 3 },
      ])
      addHdr(['成员名', '类 型', '传址', '数组', '备 注 '], i)
      he = 8; continue
    }

    if (ln.type === 'dataTypeMember') {
      if (he !== 8) {
        flush()
        tbl = { kind: 'table', tableType: 'dataType', rows: [], lineIndex: i }
        tbl.rows.push({ lineIndex: i, isHeader: true, cells: [
          { text: '数据类型名', cls: 'eHeadercolor' },
          { text: '公开', cls: 'eHeadercolor' },
          { text: '备 注', cls: 'eHeadercolor', colSpan: 3 },
        ] })
        pushRow(i, [
          { text: '(未定义数据类型名)', cls: 'Wrongcolor' },
          { text: '\u00A0', cls: '' }, { text: '\u00A0', cls: '', colSpan: 3 },
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

    if (ln.type === 'dll') {
      flush()
      tbl = { kind: 'table', tableType: 'dll', rows: [], lineIndex: i }
      tbl.rows.push({ lineIndex: i, isHeader: true, cells: [
        { text: 'DLL命令名', cls: 'eHeadercolor' },
        { text: '返回值类型', cls: 'eHeadercolor' },
        { text: '公开', cls: 'eHeadercolor' },
        { text: '备 注', cls: 'eHeadercolor', colSpan: 2 },
      ] })
      pushRow(i, [
        { text: f[0] || '', cls: 'eProcolor', fieldIdx: 0 },
        { text: f[1] || '\u00A0', cls: 'eTypecolor', fieldIdx: 1 },
        { text: f[4] === '公开' ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
        { text: f.length > 5 ? f.slice(5).join(', ') : '', cls: 'Remarkscolor', fieldIdx: 5, sliceField: true, colSpan: 2 },
      ])
      const libFile = f[2] ? unquote(f[2]) : ''
      const cmdName = f[3] ? unquote(f[3]) : ''
      pushHdrRow(i, [{ text: 'DLL库文件名:', cls: 'eHeadercolor', colSpan: 5 }])
      pushRow(i, [{ text: libFile || '', cls: libFile ? 'eAPIcolor' : '', colSpan: 5, fieldIdx: 2 }])
      pushHdrRow(i, [{ text: '在DLL库中对应命令名:', cls: 'eHeadercolor', colSpan: 5 }])
      pushRow(i, [{ text: cmdName || '', cls: cmdName ? 'eAPIcolor' : '', colSpan: 5, fieldIdx: 3 }])
      addHdr(['参数名', '类 型', '传址', '数组', '备 注 '], i)
      he = 4; continue
    }

    if (ln.type === 'ptrCmd') {
      flush()
      tbl = { kind: 'table', tableType: 'ptrcmd', rows: [], lineIndex: i }
      tbl.rows.push({ lineIndex: i, isHeader: true, cells: [
        { text: '指针命令名', cls: 'eHeadercolor' },
        { text: '返回值类型', cls: 'eHeadercolor' },
        { text: '公开', cls: 'eHeadercolor' },
        { text: '备 注', cls: 'eHeadercolor', colSpan: 2 },
      ] })
      pushRow(i, [
        { text: f[0] || '', cls: 'eProcolor', fieldIdx: 0 },
        { text: f[1] || '\u00A0', cls: 'eTypecolor', fieldIdx: 1 },
        { text: f[2] === '公开' ? '√' : '\u00A0', cls: 'eTickcolor', align: 'center' },
        { text: f.length > 3 ? f.slice(3).join(', ') : '', cls: 'Remarkscolor', fieldIdx: 3, sliceField: true, colSpan: 2 },
      ])
      pushHdrRow(i, [{ text: '调用时第一个参数固定传入函数地址（长整数型），其后才是下列参数:', cls: 'eHeadercolor', colSpan: 5 }])
      addHdr(['参数名', '类 型', '传址', '数组', '备 注 '], i)
      he = 4; continue
    }

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

    if (ln.type === 'code') {
      if (he !== 0) { flush(); he = 0 }
      blocks.push({ kind: 'codeline', rows: [], codeLine: ln.raw, lineIndex: i })
    }
  }

  flush()

  const processed: RenderBlock[] = []
  for (let i = 0; i < blocks.length; i++) {
    processed.push(blocks[i])
    // 空子程序补一个虚拟输入行：声明区（子程序表/局部变量表）之后既没有代码行也没有
    // 后续声明表时插入。子程序表与局部变量表之间是声明区内部，不插（那里不能写代码）。
    if (blocks[i].kind === 'table' && (blocks[i].tableType === 'sub' || blocks[i].tableType === 'localVar')) {
      const next = blocks[i + 1]
      const nextIsLocalVar = next && next.kind === 'table' && next.tableType === 'localVar'
      if ((!next || next.kind !== 'codeline') && !nextIsLocalVar) {
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
