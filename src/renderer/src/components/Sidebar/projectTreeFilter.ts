// 项目管理器搜索框的过滤逻辑。
//
// - 按名称不区分大小写做子串匹配，可用空格分隔多个关键词（须全部命中）。
// - 命中节点保留其全部子节点（原样折叠），以便搜到程序集后还能展开看它的子程序；
//   未命中的节点只在有后代命中时保留，并只保留通往命中项的那部分子节点。
// - 返回需要强制展开的节点 id（命中项的所有祖先），让搜索结果直接可见。

export interface FilterableTreeNode {
  id: string
  label: string
  children?: FilterableTreeNode[]
}

export interface ProjectTreeFilterResult<T extends FilterableTreeNode> {
  nodes: T[]
  expandIds: Set<string>
  matchCount: number
}

export function parseProjectTreeQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

export function matchesProjectTreeQuery(label: string, terms: string[]): boolean {
  if (terms.length === 0) return false
  const lower = (label || '').toLowerCase()
  return terms.every(term => lower.includes(term))
}

export function filterProjectTree<T extends FilterableTreeNode>(nodes: T[], query: string): ProjectTreeFilterResult<T> {
  const terms = parseProjectTreeQuery(query)
  const expandIds = new Set<string>()
  if (terms.length === 0) return { nodes, expandIds, matchCount: 0 }

  let matchCount = 0
  const visit = (list: T[]): T[] => {
    const out: T[] = []
    for (const node of list) {
      const selfMatch = matchesProjectTreeQuery(node.label, terms)
      const children = (node.children || []) as T[]
      const keptChildren = children.length > 0 ? visit(children) : []
      if (selfMatch) {
        matchCount++
        if (keptChildren.length > 0) expandIds.add(node.id)
        out.push(node)
      } else if (keptChildren.length > 0) {
        expandIds.add(node.id)
        out.push({ ...node, children: keptChildren })
      }
    }
    return out
  }

  return { nodes: visit(nodes), expandIds, matchCount }
}

/** 把名称按关键词切成高亮片段，供渲染时给命中部分加标记 */
export function splitLabelByQuery(label: string, terms: string[]): Array<{ text: string; hit: boolean }> {
  if (!label || terms.length === 0) return [{ text: label, hit: false }]
  const lower = label.toLowerCase()
  const marks = new Array<boolean>(label.length).fill(false)
  for (const term of terms) {
    let from = 0
    while (term && from <= lower.length - term.length) {
      const at = lower.indexOf(term, from)
      if (at < 0) break
      for (let i = at; i < at + term.length; i++) marks[i] = true
      from = at + term.length
    }
  }
  const parts: Array<{ text: string; hit: boolean }> = []
  for (let i = 0; i < label.length; i++) {
    const last = parts[parts.length - 1]
    if (last && last.hit === marks[i]) last.text += label[i]
    else parts.push({ text: label[i], hit: marks[i] })
  }
  return parts
}
