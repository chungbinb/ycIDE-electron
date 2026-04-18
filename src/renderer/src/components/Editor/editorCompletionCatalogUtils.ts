import type { CompletionItem, CompletionParam } from './editorCoreUtils'

type RawCompletionCommand = CompletionItem & {
  isHidden?: boolean
  isMember?: boolean
  libraryName?: string
  ownerTypeName?: string
}

function mapCompletionCommand(c: RawCompletionCommand): CompletionItem {
  return {
    name: c.name,
    englishName: c.englishName || '',
    description: c.description || '',
    returnType: c.returnType || '',
    category: c.category || '',
    libraryName: c.libraryName || '',
    isMember: !!c.isMember,
    ownerTypeName: c.ownerTypeName || '',
    params: (c.params || []).map((p: CompletionParam) => ({
      name: p.name,
      type: p.type,
      description: p.description || '',
      optional: !!p.optional,
      isVariable: !!p.isVariable,
      isArray: !!p.isArray,
    })),
  }
}

export function buildCompletionCatalog(cmds: RawCompletionCommand[]): {
  independentItems: CompletionItem[]
  memberItems: CompletionItem[]
  libraryConstantItems: CompletionItem[]
} {
  const seen = new Set<string>()
  const constantSeen = new Set<string>()

  const independentItems: CompletionItem[] = cmds
    .filter(c => !c.isHidden && !c.isMember)
    .map(mapCompletionCommand)
    .filter(c => {
      if (seen.has(c.name)) return false
      seen.add(c.name)
      return true
    })

  const memberItems: CompletionItem[] = cmds
    .filter(c => !c.isHidden && !!c.isMember)
    .map(mapCompletionCommand)

  const libraryConstantItems: CompletionItem[] = cmds
    .filter(c => {
      if (c.isHidden) return false
      const category = c.category || ''
      const name = c.name || ''
      return category.includes('常量') || name.startsWith('#')
    })
    .map(mapCompletionCommand)
    .map((c) => ({
      ...c,
      name: c.name.startsWith('#') ? c.name.slice(1) : c.name,
      category: '支持库常量',
    }))
    .filter(c => {
      const key = c.name.trim()
      if (!key || constantSeen.has(key)) return false
      constantSeen.add(key)
      return true
    })

  return {
    independentItems,
    memberItems,
    libraryConstantItems,
  }
}
