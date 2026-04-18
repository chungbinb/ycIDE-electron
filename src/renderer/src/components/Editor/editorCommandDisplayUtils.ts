/** 根据命令类别返回图标字符 */
export function getCmdIconLabel(category: string): string {
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

/** 根据命令类别返回图标 CSS 类 */
export function getCmdIconClass(category: string): string {
  const cat = category.toLowerCase()
  if (cat.includes('窗口') || cat.includes('组件') || cat.includes('控件')) return 'eyc-ac-icon-widget'
  if (cat.includes('事件')) return 'eyc-ac-icon-event'
  if (cat.includes('属性')) return 'eyc-ac-icon-prop'
  if (cat.includes('全局变量')) return 'eyc-ac-icon-field'
  if (cat.includes('dll')) return 'eyc-ac-icon-dll'
  if (cat.includes('资源')) return 'eyc-ac-icon-resource'
  if (cat.includes('常量')) return 'eyc-ac-icon-const'
  if (cat.includes('数据') || cat.includes('类型')) return 'eyc-ac-icon-type'
  if (cat.includes('流程') || cat.includes('控制')) return 'eyc-ac-icon-flow'
  return 'eyc-ac-icon-func'
}

/** 找到文本中最外层括号的位置范围 (start=开括号位置, end=闭括号位置) */
export function getOuterParenRange(text: string): { start: number; end: number } | null {
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
