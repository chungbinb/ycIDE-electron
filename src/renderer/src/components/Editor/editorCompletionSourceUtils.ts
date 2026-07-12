import type { LibWindowUnit } from './VisualDesigner'
import {
  WINDOW_METHOD_WHITELIST,
  WINDOW_OBJECT_METHODS,
  CONTROL_TYPE_METHODS,
  normalizeMemberTypeName,
  type CompletionItem,
  type CompletionParam,
} from './editorCoreUtils'

// 设计期专用属性：出现在属性面板，但不是代码可访问的运行时成员（不进 对象名. 成员补全）。
const DESIGN_ONLY_PROPERTY_NAMES = new Set(['备注', '可停留焦点', '停留顺序', '圆角半径'])

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
  classMethodMap?: Map<string, CompletionItem[]>
  memberCommands: CompletionItem[]
  allCommands: CompletionItem[]
  windowSubNames?: Set<string>
  projectWindowMemberMap?: Map<string, { controls: Array<{ name: string; type: string }>; subs: string[] }>
}): CompletionItem[] | null {
  const {
    val,
    wordStart,
    userVarCompletionItems,
    userVarTypeMap,
    windowControlTypeMap,
    windowUnits,
    customDataTypeFieldMap,
    classMethodMap,
    memberCommands,
    allCommands,
    windowSubNames,
    projectWindowMemberMap,
  } = params

  const objEnd = wordStart - 1
  let objStart = objEnd
  while (objStart > 0 && /[\u4e00-\u9fa5A-Za-z0-9_]/.test(val[objStart - 1])) objStart--
  const objName = val.slice(objStart, objEnd)
  if (objName.length === 0) return null

  const completionVarType = userVarCompletionItems.find(item => item.name === objName)?.returnType || ''
  // objName 可能是项目里另一个窗口的名字（跨窗口引用）→ 视为「窗口」类型。
  const isProjectWindowName = !!projectWindowMemberMap?.has(objName)
  const mappedType = userVarTypeMap.get(objName) || completionVarType || windowControlTypeMap.get(objName)
    || (isProjectWindowName ? '窗口' : undefined)
  // 对象必须真实存在——关联窗口上的组件/窗口自身（windowControlTypeMap）、项目内其它窗口、或有类型的变量/参数——
  // 才提供成员补全；不再按「去尾数字」猜类型（设计器没放置 编辑框1 时，敲 编辑框1. 不应弹成员窗）。
  // 返回空列表（非 null）让调用方直接不弹窗，而不是回退到全量命令列表。
  if (!mappedType) return []
  const typeName = normalizeMemberTypeName(mappedType)

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
      // 设计期专用属性（备注/可停留焦点/停留顺序/圆角半径）只在属性面板出现，不是代码成员，
      // 与易语言成员列表对齐（易语言按钮 14 个运行时成员不含这些）。
      if (DESIGN_ONLY_PROPERTY_NAMES.has(propName)) continue
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

  // 变量类型为项目类模块时，补全该类的公开方法
  const rawMappedType = (mappedType || '').trim()
  const classMembers = classMethodMap
    ? (classMethodMap.get(rawMappedType) || classMethodMap.get(typeName) || [])
    : []

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

  // 2) 窗口/控件的「对象」通用方法（获取焦点/销毁/移动/重画…）。
  // 这些方法在命令目录里缺失（只存在于 ABI 映射），故用内置静态定义直接合成成员项，
  // 仅当访问对象是窗口单元（窗口本身或某控件类型）时才注入，避免污染类实例/自定义类型的成员列表。
  const isWindowOrControlType = windowUnits.some(u =>
    normalizeMemberTypeName(u.name) === typeName || normalizeMemberTypeName(u.englishName || '') === typeName,
  )
  const objectMethodMembers: CompletionItem[] = isWindowOrControlType
    ? WINDOW_OBJECT_METHODS.map(m => toMemberItem(
      m.name, '', m.description, '方法', m.returnType, mappedType || typeName, '系统核心支持库', m.params,
    ))
    : []
  // 控件类型专属方法（如 编辑框.加入文本）：按 typeName 匹配追加。
  const typeMethodList = CONTROL_TYPE_METHODS[typeName] || (mappedType ? CONTROL_TYPE_METHODS[mappedType] : undefined) || []
  const controlTypeMethodMembers: CompletionItem[] = typeMethodList.map(m => toMemberItem(
    m.name, '', m.description, '方法', m.returnType, mappedType || typeName, '系统核心支持库', m.params,
  ))
  // 保留命令目录白名单过滤路径（未来清单若补入这些方法，dedupe 会去重）。
  const windowMethods = [...memberCommands, ...allCommands]
    .filter(c => WINDOW_METHOD_WHITELIST.has((c.name || '').trim()))
    .filter(c => !((c.category || '').includes('事件')))

  // 3) 当访问对象就是「窗口」本身时，补入该窗口的子控件与子程序（易语言 窗口.按钮1 / 窗口._按钮1_被单击）。
  // 控件/子程序只归属窗口对象，故仅 typeName==='窗口' 时注入，不出现在控件成员列表里。
  const isWindowItself = typeName === normalizeMemberTypeName('窗口')
  // 决定用「哪个窗口」的控件/子程序：当前窗口(windowControlTypeMap 里 '窗口' 那项)用实时数据；
  // 引用的别的项目窗口用读盘的 projectWindowMemberMap。
  const currentWindowName = Array.from(windowControlTypeMap.entries())
    .find(([, t]) => normalizeMemberTypeName(t) === normalizeMemberTypeName('窗口'))?.[0]
  const crossWindow = projectWindowMemberMap?.get(objName)
  const isCurrentWindow = !!currentWindowName && objName === currentWindowName
  let controlPairs: Array<[string, string]> = []
  let subNames: string[] = []
  if (isWindowItself) {
    if (isCurrentWindow || !crossWindow) {
      // 当前窗口（或无跨窗口数据时的兜底）：实时控件表 + 实时子程序
      controlPairs = Array.from(windowControlTypeMap.entries())
        .filter(([ctrlName, ctrlType]) => ctrlName !== objName && normalizeMemberTypeName(ctrlType) !== normalizeMemberTypeName('窗口'))
      subNames = windowSubNames ? Array.from(windowSubNames) : []
    } else {
      // 引用的另一个项目窗口：读盘控件 + 读盘子程序
      controlPairs = crossWindow.controls.map(c => [c.name, c.type] as [string, string])
      subNames = crossWindow.subs
    }
  }
  const childControlMembers: CompletionItem[] = controlPairs
    .filter(([ctrlName]) => !!ctrlName)
    .map(([ctrlName, ctrlType]) => toMemberItem(ctrlName, '', `窗口组件（${ctrlType}）`, '组件', ctrlType, '窗口', '窗口组件'))
  const subMembers: CompletionItem[] = subNames
    .map(name => (name || '').trim())
    .filter(Boolean)
    .map(name => toMemberItem(name, '', '窗口子程序', '子程序', '', '窗口', '用户定义'))

  const merged = [...classMembers, ...customMembers, ...unitMembers, ...commandMembers, ...objectMethodMembers, ...controlTypeMethodMembers, ...windowMethods, ...childControlMembers, ...subMembers]
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
    classMethodMap?: Map<string, CompletionItem[]>
    memberCommands: CompletionItem[]
    allCommands: CompletionItem[]
    windowSubNames?: Set<string>
    projectWindowMemberMap?: Map<string, { controls: Array<{ name: string; type: string }>; subs: string[] }>
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
