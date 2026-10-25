// 表格编辑器行多选的辅助规则。
//
// 选区按画布上实际经过的行来定（所见即所选）。DLL 命令 / 指针命令与其 .参数 行、
// 数据类型与其 .成员 行在语义上是一个整体，只在两处按整块处理：
// - 点「DLL命令名」等表头：选中整个命令（连同参数）；
// - 删除：删掉声明行时连同它的参数 / 成员一起删，避免参数被挂到上一个命令下面。

const BLOCK_RULES: Array<{ decl: RegExp; child: RegExp }> = [
  { decl: /^\.(?:DLL命令|指针命令)(?:\s|$)/, child: /^\.参数(?:\s|$)/ },
  { decl: /^\.数据类型(?:\s|$)/, child: /^\.成员(?:\s|$)/ },
]

function bodyOf(line: string | undefined): string {
  return (line || '').replace(/^[\s　]+/, '')
}

/** 声明行 lineIndex 所带的子行（参数 / 成员）；不是块声明行时返回空数组 */
export function getDeclChildLines(lines: string[], lineIndex: number): number[] {
  const body = bodyOf(lines[lineIndex])
  const rule = BLOCK_RULES.find(r => r.decl.test(body))
  if (!rule) return []
  const out: number[] = []
  for (let i = lineIndex + 1; i < lines.length; i++) {
    if (!rule.child.test(bodyOf(lines[i]))) break
    out.push(i)
  }
  return out
}

/** 选区里的块声明行补上它的子行；没有需要补的行时返回原 Set（保持引用，避免多余渲染） */
export function expandDeclBlockSelection(lines: string[], selected: Set<number>): Set<number> {
  let out: Set<number> | null = null
  for (const li of selected) {
    for (const child of getDeclChildLines(lines, li)) {
      if (selected.has(child) || out?.has(child)) continue
      if (!out) out = new Set(selected)
      out.add(child)
    }
  }
  return out ?? selected
}

/** Ctrl+单击：加选或取消一行 */
export function toggleLineInSelection(selected: Set<number>, lineIndex: number): Set<number> {
  const next = new Set(selected)
  if (next.has(lineIndex)) next.delete(lineIndex)
  else next.add(lineIndex)
  return next
}
