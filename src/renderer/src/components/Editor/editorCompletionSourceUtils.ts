import type { LibWindowUnit } from './VisualDesigner'
import {
  WINDOW_METHOD_WHITELIST,
  normalizeMemberTypeName,
  type CompletionItem,
  type CompletionParam,
} from './editorCoreUtils'

export function buildHashConstantSource(
  constantItems: CompletionItem[],
  libraryConstantItems: CompletionItem[],
): CompletionItem[] {
  // # 模式下合并常量源并按名称去重。
  const merged = [...constantItems, ...libraryConstantItems]
  const seen = new Set<string>()
  return merged.filter(item => {
    const key = item.name.trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function buildMemberCompletionSource(params: {
  val: string
  wordStart: number
  userVarCompletionItems: CompletionItem[]
  userVarTypeMap: Map<string, string>
  windowControlTypeMap: Map<string, string>
  windowUnits: LibWindowUnit[]
  customDataTypeFieldMap: Map<string, Array<{ name: string; type: string }>>
  memberCommands: CompletionItem[]
  allCommands: CompletionItem[]
}): CompletionItem[] | null {
  const {
    val,
    wordStart,
    userVarCompletionItems,
    userVarTypeMap,
    windowControlTypeMap,
    windowUnits,
    customDataTypeFieldMap,
    memberCommands,
    allCommands,
  } = params

  let objEnd = wordStart - 1
  let objStart = objEnd
  while (objStart > 0 && /[\u4e00-\u9fa5A-Za-z0-9_]/.test(val[objStart - 1])) objStart--
  const objName = val.slice(objStart, objEnd)
  if (objName.length === 0) return null

  const completionVarType = userVarCompletionItems.find(item => item.name === objName)?.returnType || ''
  const mappedType = userVarTypeMap.get(objName) || completionVarType || windowControlTypeMap.get(objName)
  const inferredType = mappedType ? '' : objName.replace(/[0-9]+$/, '')
  const typeName = normalizeMemberTypeName(mappedType || inferredType || objName)

  const toMemberItem = (
    name: string,
    englishName: string,
    description: string,
    category: string,
    returnType: string,
    ownerTypeName: string,
    libraryName: string,
    params: CompletionParam[] = [],
  ): CompletionItem => ({
    name,
    englishName,
    description,
    returnType,
    category,
    libraryName,
    isMember: true,
    ownerTypeName,
    params,
  })

  const unitMembers: CompletionItem[] = []
  // 1) 来自窗口定义的属性（优先级最高，最贴近实际控件类型）。
  for (const unit of windowUnits) {
    const unitName = normalizeMemberTypeName(unit.name)
    const unitEn = normalizeMemberTypeName(unit.englishName || '')
    if (typeName && unitName !== typeName && unitEn !== typeName) continue

    for (const p of unit.properties || []) {
      const propName = (p.name || '').trim()
      if (!propName) continue
      unitMembers.push(toMemberItem(
        propName,
        (p.englishName || '').trim(),
        (p.description || '').trim(),
        '属性',
        (p.typeName || '').trim(),
        unit.name,
        unit.libraryName || '支持库',
      ))
    }
  }

  const customMembers = (customDataTypeFieldMap.get(typeName) || []).map(field =>
    toMemberItem(
      field.name,
      '',
      field.type ? `成员（${field.type}）` : '成员',
      '成员',
      field.type || '',
      mappedType || typeName,
      '用户定义',
    ),
  )

  const commandMembers = memberCommands.filter(c => {
    const owner = normalizeMemberTypeName(c.ownerTypeName)
    if (!owner || !typeName) return false
    if (owner !== typeName) return false
    return !(c.category || '').includes('事件')
  })

  // 2) 补入窗口通用方法，但仍以命令目录为准，避免虚构候选。
  const windowMethods = [...memberCommands, ...allCommands]
    .filter(c => WINDOW_METHOD_WHITELIST.has((c.name || '').trim()))
    .filter(c => !((c.category || '').includes('事件')))

  const merged = [...customMembers, ...unitMembers, ...commandMembers, ...windowMethods]
  const seen = new Set<string>()
  return merged.filter(item => {
    const key = `${item.category}:${item.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function selectCompletionSourceList(params: {
  defaultSourceList: CompletionItem[]
  isClassNameCellEdit: boolean
  isTypeCellEdit: boolean
  hashMode: boolean
  isMemberAccess: boolean
  classNameItems: CompletionItem[]
  typeItems: CompletionItem[]
  constantItems: CompletionItem[]
  libraryConstantItems: CompletionItem[]
  memberParams: {
    val: string
    wordStart: number
    userVarCompletionItems: CompletionItem[]
    userVarTypeMap: Map<string, string>
    windowControlTypeMap: Map<string, string>
    windowUnits: LibWindowUnit[]
    customDataTypeFieldMap: Map<string, Array<{ name: string; type: string }>>
    memberCommands: CompletionItem[]
    allCommands: CompletionItem[]
  }
}): CompletionItem[] {
  const {
    defaultSourceList,
    isClassNameCellEdit,
    isTypeCellEdit,
    hashMode,
    isMemberAccess,
    classNameItems,
    typeItems,
    constantItems,
    libraryConstantItems,
    memberParams,
  } = params

  // 统一 sourceList 选择入口，避免编辑器主流程中重复条件树。
  if (isClassNameCellEdit) return [...classNameItems]
  if (isTypeCellEdit) return [...typeItems]
  if (hashMode) return buildHashConstantSource(constantItems, libraryConstantItems)
  if (!isMemberAccess) return defaultSourceList

  const memberSource = buildMemberCompletionSource(memberParams)
  return memberSource || defaultSourceList
}
