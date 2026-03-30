import type { CellData, DeclType, ParsedLine, RenderBlock } from './eycTableModel'

export function splitCSV(text: string): string[] {
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

export function unquote(s: string): string {
  if (!s) return ''
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('\u201c') && s.endsWith('\u201d'))) {
    return s.slice(1, -1)
  }
  return s
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
      ['globalVar', '.全局变量 '], ['constant', '.常量 '],
      ['resource', '.资源 '],
      ['dataType', '.数据类型 '], ['dll', '.DLL命令 '],
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

    if (ln.type === 'constant' || ln.type === 'resource') {
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
    if (blocks[i].kind === 'table' && blocks[i].tableType === 'sub') {
      const next = blocks[i + 1]
      if (!next || next.kind !== 'codeline') {
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
