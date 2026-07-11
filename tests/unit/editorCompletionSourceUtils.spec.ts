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

describe('成员补全：窗口/控件的对象通用方法（获取焦点/销毁/移动…）', () => {
  const windowUnit = {
    name: '窗口', englishName: 'Window', description: '', libraryName: '核心支持库',
    properties: [
      { name: '标题', englishName: 'title', description: '', type: 0, typeName: '文本型', isReadOnly: false, pickOptions: [] },
      { name: '底图', englishName: 'backImage', description: '', type: 0, typeName: '图片', isReadOnly: false, pickOptions: [] },
    ],
    events: [],
  }
  function runWin(val: string, units: unknown[], controls?: Array<[string, string]>): CompletionItem[] {
    return selectCompletionSourceList({
      defaultSourceList: [DEFAULT_ITEM], isClassNameCellEdit: false, isTypeCellEdit: false,
      hashMode: false, isMemberAccess: true, classNameItems: [], typeItems: [], constantItems: [], libraryConstantItems: [],
      memberParams: {
        val, wordStart: val.length, userVarCompletionItems: [], userVarTypeMap: new Map(),
        windowControlTypeMap: new Map(controls || [['_启动窗口', '窗口']]),
        windowUnits: units as never, customDataTypeFieldMap: new Map(), memberCommands: [], allCommands: [],
      },
    })
  }

  it('窗口成员列表包含 23 个对象方法且标为「方法」类', () => {
    const out = runWin('_启动窗口.', [windowUnit])
    const methodNames = ['获取焦点', '销毁', '移动', '重画', '取窗口句柄', '弹出菜单', '置外形图片', '置托盘图标', '取用户区宽度', '弹出托盘菜单']
    for (const m of methodNames) {
      const item = out.find(i => i.name === m)
      expect(item, `缺少方法 ${m}`).toBeTruthy()
      expect(item?.category).toBe('方法')
      expect(item?.isMember).toBe(true)
    }
  })

  it('方法带返回类型与参数（用于签名/补全）', () => {
    const out = runWin('_启动窗口.', [windowUnit])
    const move = out.find(i => i.name === '移动')
    expect(move?.params.length).toBe(4)
    const has = out.find(i => i.name === '可有焦点')
    expect(has?.returnType).toBe('逻辑型')
  })

  it('属性与方法并存（底图属性 + 获取焦点方法都在）', () => {
    const out = runWin('_启动窗口.', [windowUnit])
    expect(out.some(i => i.name === '底图' && i.category === '属性')).toBe(true)
    expect(out.some(i => i.name === '获取焦点' && i.category === '方法')).toBe(true)
  })

  it('控件（编辑框）也获得对象方法（对象基类通用）', () => {
    const out = runWin('编辑框1.', [editUnit], [['编辑框1', '编辑框']])
    expect(out.some(i => i.name === '获取焦点' && i.category === '方法')).toBe(true)
    expect(out.some(i => i.name === '标题' && i.category === '属性')).toBe(true)
  })

  it('编辑框有专属方法 加入文本（控件类型专属方法）；窗口/按钮没有', () => {
    const editUnit2 = { name: '编辑框', englishName: 'EditBox', description: '', libraryName: '核心支持库',
      properties: [{ name: '内容', englishName: 'text', description: '', type: 0, typeName: '文本型', isReadOnly: false, pickOptions: [] }], events: [] }
    const btnUnit = { name: '按钮', englishName: 'Button', description: '', libraryName: '核心支持库',
      properties: [{ name: '标题', englishName: 'caption', description: '', type: 0, typeName: '文本型', isReadOnly: false, pickOptions: [] }], events: [] }
    const outEdit = runWin('编辑框1.', [editUnit2], [['编辑框1', '编辑框']])
    expect(outEdit.some(i => i.name === '加入文本' && i.category === '方法')).toBe(true)
    const outBtn = runWin('按钮1.', [btnUnit], [['按钮1', '按钮']])
    expect(outBtn.some(i => i.name === '加入文本')).toBe(false)  // 按钮无此专属方法
    expect(outBtn.some(i => i.name === '获取焦点')).toBe(true)   // 但有通用对象方法
  })

  it('组合框/列表框有项目成员方法，进度条只有属性无专属方法', () => {
    const comboUnit = { name: '组合框', englishName: 'ComboBox', description: '', libraryName: '核心支持库',
      properties: [{ name: '类型', englishName: 'style', description: '', type: 0, typeName: '选择整数', isReadOnly: false, pickOptions: [] }], events: [] }
    const listUnit = { name: '列表框', englishName: 'ListBox', description: '', libraryName: '核心支持库',
      properties: [{ name: '现行选中项', englishName: 'CurSel', description: '', type: 0, typeName: '整数型', isReadOnly: false, pickOptions: [] }], events: [] }
    const progUnit = { name: '进度条', englishName: 'ProgressBar', description: '', libraryName: '核心支持库',
      properties: [{ name: '位置', englishName: 'pos', description: '', type: 0, typeName: '整数型', isReadOnly: false, pickOptions: [] }], events: [] }
    const outCombo = runWin('组合框1.', [comboUnit], [['组合框1', '组合框']])
    expect(outCombo.some(i => i.name === '加入项目' && i.category === '方法')).toBe(true)
    expect(outCombo.some(i => i.name === '取项目文本')).toBe(true)
    const outList = runWin('列表框1.', [listUnit], [['列表框1', '列表框']])
    expect(outList.some(i => i.name === '加入项目')).toBe(true)
    expect(outList.some(i => i.name === '取焦点项目')).toBe(true)
    const outProg = runWin('进度条1.', [progUnit], [['进度条1', '进度条']])
    expect(outProg.some(i => i.name === '加入项目')).toBe(false)  // 进度条无成员方法
    expect(outProg.some(i => i.name === '获取焦点')).toBe(true)   // 但有通用对象方法
    expect(outProg.some(i => i.name === '位置' && i.category === '属性')).toBe(true)
  })

  it('标签有专属方法 调用反馈事件（控件类型专属方法）', () => {
    const labelUnit = { name: '标签', englishName: 'Static', description: '', libraryName: '核心支持库',
      properties: [{ name: '效果', englishName: 'effect', description: '', type: 0, typeName: '选择整数', isReadOnly: false, pickOptions: ['通常', '凹入', '凸出', '阴影', '透明'] }], events: [] }
    const out = runWin('标签1.', [labelUnit], [['标签1', '标签']])
    expect(out.some(i => i.name === '调用反馈事件' && i.category === '方法')).toBe(true)
    expect(out.some(i => i.name === '效果' && i.category === '属性')).toBe(true)
    expect(out.some(i => i.name === '获取焦点')).toBe(true)  // 通用对象方法
    expect(out.some(i => i.name === '加入文本')).toBe(false) // 不串到编辑框专属方法
  })

  it('设计期专用属性（备注/可停留焦点/停留顺序/圆角半径）不作代码成员', () => {
    const btnUnit = {
      name: '按钮', englishName: 'Button', description: '', libraryName: '核心支持库',
      properties: [
        { name: '备注', englishName: 'memo', description: '', type: 0, typeName: '文本型', isReadOnly: false, pickOptions: [] },
        { name: '可停留焦点', englishName: 'canFocus', description: '', type: 0, typeName: '逻辑型', isReadOnly: false, pickOptions: [] },
        { name: '停留顺序', englishName: 'tabOrder', description: '', type: 0, typeName: '整数型', isReadOnly: false, pickOptions: [] },
        { name: '类型', englishName: 'style', description: '', type: 0, typeName: '选择整数', isReadOnly: false, pickOptions: ['0.通常', '1.默认'] },
        { name: '字体', englishName: 'font', description: '', type: 0, typeName: '字体', isReadOnly: false, pickOptions: [] },
      ],
      events: [],
    }
    const out = runWin('按钮1.', [btnUnit], [['按钮1', '按钮']])
    expect(out.some(i => i.name === '备注')).toBe(false)
    expect(out.some(i => i.name === '可停留焦点')).toBe(false)
    expect(out.some(i => i.name === '停留顺序')).toBe(false)
    // 运行时成员在：类型(属性)、字体(属性)、获取焦点(方法)
    expect(out.some(i => i.name === '类型' && i.category === '属性')).toBe(true)
    expect(out.some(i => i.name === '字体' && i.category === '属性')).toBe(true)
    expect(out.some(i => i.name === '获取焦点' && i.category === '方法')).toBe(true)
  })

  it('非窗口/控件类型（自定义/类实例）不注入对象方法', () => {
    // windowUnits 为空 → 该类型不是窗口单元 → 无对象方法
    const out = runWin('我的对象.', [], [['我的对象', '某类']])
    expect(out.some(i => i.name === '获取焦点')).toBe(false)
  })
})

describe('成员补全：窗口的子控件与子程序', () => {
  const windowUnit = {
    name: '窗口', englishName: 'Window', description: '', libraryName: '核心支持库',
    properties: [{ name: '标题', englishName: 'title', description: '', type: 0, typeName: '文本型', isReadOnly: false, pickOptions: [] }],
    events: [],
  }
  const editUnit2 = {
    name: '编辑框', englishName: 'EditBox', description: '', libraryName: '核心支持库',
    properties: [{ name: '内容', englishName: 'text', description: '', type: 0, typeName: '文本型', isReadOnly: false, pickOptions: [] }],
    events: [],
  }
  function runW(val: string, controls: Array<[string, string]>, subs: string[], units: unknown[]): CompletionItem[] {
    return selectCompletionSourceList({
      defaultSourceList: [DEFAULT_ITEM], isClassNameCellEdit: false, isTypeCellEdit: false,
      hashMode: false, isMemberAccess: true, classNameItems: [], typeItems: [], constantItems: [], libraryConstantItems: [],
      memberParams: {
        val, wordStart: val.length, userVarCompletionItems: [], userVarTypeMap: new Map(),
        windowControlTypeMap: new Map(controls), windowUnits: units as never,
        customDataTypeFieldMap: new Map(), memberCommands: [], allCommands: [], windowSubNames: new Set(subs),
      },
    })
  }

  it('窗口成员含子控件（按钮1）与子程序（_按钮1_被单击）', () => {
    const out = runW('_启动窗口.', [['_启动窗口', '窗口'], ['按钮1', '按钮'], ['编辑框1', '编辑框']], ['_按钮1_被单击', '我的子程序'], [windowUnit, editUnit2])
    const 按钮1 = out.find(i => i.name === '按钮1')
    expect(按钮1, '缺子控件 按钮1').toBeTruthy()
    expect(按钮1?.category).toBe('组件')
    expect(按钮1?.returnType).toBe('按钮')
    expect(out.some(i => i.name === '_按钮1_被单击' && i.category === '子程序')).toBe(true)
    expect(out.some(i => i.name === '我的子程序' && i.category === '子程序')).toBe(true)
    // 窗口自身不作为自己的子控件出现
    expect(out.some(i => i.name === '_启动窗口')).toBe(false)
  })

  it('访问控件（编辑框1.）不列出窗口的子控件/子程序', () => {
    const out = runW('编辑框1.', [['_启动窗口', '窗口'], ['按钮1', '按钮'], ['编辑框1', '编辑框']], ['_按钮1_被单击'], [windowUnit, editUnit2])
    expect(out.some(i => i.name === '内容')).toBe(true)       // 控件自身属性在
    expect(out.some(i => i.name === '按钮1')).toBe(false)      // 不列同级控件
    expect(out.some(i => i.name === '_按钮1_被单击')).toBe(false) // 不列窗口子程序
  })
})

describe('成员补全：跨窗口引用（在 A 窗口代码里打 B 窗口名）', () => {
  const windowUnit = {
    name: '窗口', englishName: 'Window', description: '', libraryName: '核心支持库',
    properties: [{ name: '标题', englishName: 'title', description: '', type: 0, typeName: '文本型', isReadOnly: false, pickOptions: [] }],
    events: [],
  }
  const projMap = new Map([
    ['窗口B', { controls: [['标签1', '标签'], ['列表框1', '列表框']].map(([name, type]) => ({ name, type })), subs: ['_列表框1_被选择', 'B窗口子程序'] }],
  ])
  function runX(val, controls, subs, proj) {
    return selectCompletionSourceList({
      defaultSourceList: [DEFAULT_ITEM], isClassNameCellEdit: false, isTypeCellEdit: false,
      hashMode: false, isMemberAccess: true, classNameItems: [], typeItems: [], constantItems: [], libraryConstantItems: [],
      memberParams: {
        val, wordStart: val.length, userVarCompletionItems: [], userVarTypeMap: new Map(),
        windowControlTypeMap: new Map(controls), windowUnits: [windowUnit] as never,
        customDataTypeFieldMap: new Map(), memberCommands: [], allCommands: [],
        windowSubNames: new Set(subs), projectWindowMemberMap: proj,
      },
    })
  }

  it('当前窗口是 _启动窗口，打 窗口B. 也能解析（属性+方法+B的控件+B的子程序）', () => {
    const out = runX('窗口B.', [['_启动窗口', '窗口'], ['按钮1', '按钮']], ['_按钮1_被单击'], projMap)
    expect(out.some(i => i.name === '标题' && i.category === '属性')).toBe(true)
    expect(out.some(i => i.name === '获取焦点' && i.category === '方法')).toBe(true)
    // 列 B 自己的控件/子程序，而非当前窗口的
    expect(out.some(i => i.name === '标签1' && i.category === '组件')).toBe(true)
    expect(out.some(i => i.name === '列表框1')).toBe(true)
    expect(out.some(i => i.name === '_列表框1_被选择' && i.category === '子程序')).toBe(true)
    expect(out.some(i => i.name === '按钮1')).toBe(false)       // 不串当前窗口的控件
    expect(out.some(i => i.name === '_按钮1_被单击')).toBe(false) // 不串当前窗口子程序
  })

  it('打当前窗口 _启动窗口. 仍用实时数据（按钮1 + _按钮1_被单击）', () => {
    const out = runX('_启动窗口.', [['_启动窗口', '窗口'], ['按钮1', '按钮']], ['_按钮1_被单击'], projMap)
    expect(out.some(i => i.name === '按钮1' && i.category === '组件')).toBe(true)
    expect(out.some(i => i.name === '_按钮1_被单击' && i.category === '子程序')).toBe(true)
    expect(out.some(i => i.name === '标签1')).toBe(false) // 不串 B 窗口的控件
  })

  it('打不存在的窗口名不弹窗（空列表）', () => {
    const out = runX('并不存在.', [['_启动窗口', '窗口']], [], projMap)
    expect(out).toHaveLength(0)
  })
})
