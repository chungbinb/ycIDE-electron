const TABLE_ROW_TEMPLATES: Array<[string, string]> = [
  ['.子程序 ', '    .参数 , 整数型'],
  ['.DLL命令 ', '    .参数 , 整数型'],
  ['.程序集 ', '.程序集变量 , 整数型'],
  ['.程序集变量 ', '.程序集变量 , 整数型'],
  ['.局部变量 ', '.局部变量 , 整数型'],
  ['.全局变量 ', '.全局变量 , 整数型'],
  ['.参数 ', '    .参数 , 整数型'],
  ['.成员 ', '    .成员 , 整数型'],
  ['.常量 ', '.常量 , '],
]

const VARIABLE_DECL_PREFIXES = ['.局部变量 ', '.参数 ', '.程序集变量 ', '.全局变量 '] as const

function normalizeLine(rawLine: string): string {
  return rawLine.replace(/[\r\t]/g, '').trim()
}

function findVariableRenameScope(lines: string[], lineIndex: number, variablePrefix: string): { start: number; end: number } {
  let start = 0
  let end = lines.length
  const isLocalLike = variablePrefix === '.局部变量 ' || variablePrefix === '.参数 '
  const isAssemblyLike = variablePrefix === '.程序集变量 '

  if (isLocalLike) {
    for (let j = lineIndex - 1; j >= 0; j--) {
      const tt = normalizeLine(lines[j])
      if (tt.startsWith('.子程序 ') || tt.startsWith('.程序集 ')) { start = j; break }
    }
    for (let j = lineIndex + 1; j < lines.length; j++) {
      const tt = normalizeLine(lines[j])
      if (tt.startsWith('.子程序 ') || tt.startsWith('.程序集 ')) { end = j; break }
    }
  } else if (isAssemblyLike) {
    for (let j = lineIndex - 1; j >= 0; j--) {
      const tt = normalizeLine(lines[j])
      if (tt.startsWith('.程序集 ')) { start = j; break }
    }
    for (let j = lineIndex + 1; j < lines.length; j++) {
      const tt = normalizeLine(lines[j])
      if (tt.startsWith('.程序集 ')) { end = j; break }
    }
  }

  return { start, end }
}

export function getTableRowInsertTemplate(rawLine: string): string | null {
  const stripped = rawLine.replace(/[\r\t]/g, '').trimStart()
  for (const [prefix, template] of TABLE_ROW_TEMPLATES) {
    if (stripped.startsWith(prefix)) return template
  }
  return null
}

export function applyScopedVariableRename(params: {
  lines: string[]
  lineIndex: number
  declarationLine: string
  oldName: string
  newName: string
}): string[] {
  const { lines, lineIndex, declarationLine, oldName, newName } = params
  const oName = oldName.trim()
  const nName = newName.trim()
  if (!oName || !nName || oName === nName) return lines

  const trimmedDecl = normalizeLine(declarationLine)
  const variablePrefix = VARIABLE_DECL_PREFIXES.find(pf => trimmedDecl.startsWith(pf))
  if (!variablePrefix) return lines

  const { start, end } = findVariableRenameScope(lines, lineIndex, variablePrefix)
  const regex = new RegExp(
    '(?<=[^\\u4e00-\\u9fa5A-Za-z0-9_.]|^)' + oName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[^\\u4e00-\\u9fa5A-Za-z0-9_.]|$)',
    'g'
  )

  const nextLines = [...lines]
  for (let j = start; j < end; j++) {
    if (j === lineIndex) continue
    const tt = normalizeLine(nextLines[j])
    if (!tt || tt.startsWith("'") || tt.startsWith('.')) continue
    nextLines[j] = nextLines[j].replace(regex, nName)
  }
  return nextLines
}
