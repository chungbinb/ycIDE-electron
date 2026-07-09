import { describe, it, expect } from 'vitest'
import { selectCompletionSourceList } from '@/components/Editor/editorCompletionSourceUtils'
import type { CompletionItem } from '@/components/Editor/editorCoreUtils'

const editUnit = {
  name: '编辑框',
  englishName: 'EditBox',
  description: '',
  libraryName: '核心支持库',
  properties: [
    { name: '标题', englishName: 'Title', description: '', type: 0, typeName: '文本型', isReadOnly: false, pickOptions: [] },
    { name: '宽度', englishName: 'Width', description: '', type: 0, typeName: '整数型', isReadOnly: false, pickOptions: [] },
  ],
  events: [],
}

const DEFAULT_ITEM: CompletionItem = {
  name: '调试输出', englishName: '', description: '', returnType: '', category: '命令',
  libraryName: '核心支持库', isMember: false, ownerTypeName: '', params: [],
}

function run(val: string, wordStart: number, opts?: { controls?: Array<[string, string]>; varTypes?: Array<[string, string]> }): CompletionItem[] {
  return selectCompletionSourceList({
    defaultSourceList: [DEFAULT_ITEM],
    isClassNameCellEdit: false,
    isTypeCellEdit: false,
    hashMode: false,
    isMemberAccess: true,
    classNameItems: [],
    typeItems: [],
    constantItems: [],
    libraryConstantItems: [],
    memberParams: {
      val,
      wordStart,
      userVarCompletionItems: [],
      userVarTypeMap: new Map(opts?.varTypes || []),
      windowControlTypeMap: new Map(opts?.controls || []),
      windowUnits: [editUnit],
      customDataTypeFieldMap: new Map(),
      memberCommands: [],
      allCommands: [],
    },
  })
}

describe('成员补全：对象必须真实存在（设计器放置的组件/有类型的变量）', () => {
  it('设计器没放置 编辑框1 → 敲 编辑框1. 返回空列表（不弹窗、也不回退全量命令）', () => {
    // val = "编辑框1."，wordStart 在句点之后
    const out = run('编辑框1.', '编辑框1.'.length)
    expect(out).toHaveLength(0)
  })

  it('关联窗口上放置了 编辑框1 → 弹出该组件类型的成员属性', () => {
    const out = run('编辑框1.', '编辑框1.'.length, { controls: [['编辑框1', '编辑框']] })
    expect(out.some(i => i.name === '标题' && i.isMember)).toBe(true)
    expect(out.some(i => i.name === '宽度')).toBe(true)
  })

  it('有类型的变量按变量类型出成员；名称随意（不依赖「编辑框N」命名）', () => {
    const out = run('我的框.', '我的框.'.length, { varTypes: [['我的框', '编辑框']] })
    expect(out.some(i => i.name === '标题')).toBe(true)
  })

  it('对象名为空时回退默认命令列表（原行为不变）', () => {
    const out = run('.', 1)
    expect(out.some(i => i.name === '调试输出')).toBe(true)
  })
})
