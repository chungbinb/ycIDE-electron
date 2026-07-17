import { describe, it, expect } from 'vitest'
import {
  buildControlPropTypes,
  buildEditorDiagnosticsProblems,
  type DiagCommandSignature,
} from '@/components/Editor/editorDiagnosticsShared'

// 命令实参数据类型匹配检查
const signatures: Record<string, DiagCommandSignature> = {
  '写到文件': {
    params: [
      { name: '文件名', type: '文本型' },
      { name: '欲写入文件的数据', type: '字节集', repeatable: true },
    ],
    returnType: '逻辑型',
  },
  '到字节集': { params: [{ name: '欲转换为字节集的数据', type: '通用型' }], returnType: '字节集' },
  '取文本长度': { params: [{ name: '欲取其长度的文本', type: '文本型' }], returnType: '整数型' },
  '延时': { params: [{ name: '欲延时的时间', type: '整数型' }], returnType: '' },
  '调试输出': { params: [{ name: '欲输出的内容', type: '通用型', repeatable: true }], returnType: '' },
  '如果真': { params: [{ name: '条件', type: '逻辑型' }], returnType: '' },
  '到文本': { params: [{ name: '欲转换的数值', type: '通用型' }], returnType: '文本型' },
}

function run(text: string): ReturnType<typeof buildEditorDiagnosticsProblems> {
  return buildEditorDiagnosticsProblems({
    text,
    hasCommandCatalog: true,
    validCommandNames: [...Object.keys(signatures), '真', '假'],
    allKnownVarNames: ['a', '文本变量', '整数变量'],
    reservedNames: ['真', '假'],
    commandSignatures: signatures,
  })
}

const SUB_HEAD = '.子程序 测试子程序\n.局部变量 文本变量, 文本型\n.局部变量 整数变量, 整数型\n'

describe('命令参数数据类型检查', () => {
  it('用户场景：文本参数传未加引号的 1.txt → 报无效表达式并提示加引号', () => {
    const problems = run(`${SUB_HEAD}写到文件 (1.txt,到字节集 ())`)
    const hit = problems.find(p => p.message.includes('文件名') && p.message.includes('1.txt'))
    expect(hit).toBeTruthy()
    expect(hit!.message).toContain('引号')
    expect(hit!.severity).toBe('error')
  })

  it('加了引号的 “1.txt” → 不报', () => {
    const problems = run(`${SUB_HEAD}写到文件 (“1.txt”,到字节集 ())`)
    expect(problems.filter(p => p.message.includes('文件名'))).toHaveLength(0)
  })

  it('数值字面量传给文本型参数 → 类型不匹配', () => {
    const problems = run(`${SUB_HEAD}取文本长度 (123)`)
    const hit = problems.find(p => p.message.includes('类型不匹配'))
    expect(hit).toBeTruthy()
    expect(hit!.message).toContain('文本型')
  })

  it('文本字面量传给整数型参数 → 类型不匹配', () => {
    const problems = run(`${SUB_HEAD}延时 (“100”)`)
    const hit = problems.find(p => p.message.includes('欲延时的时间'))
    expect(hit).toBeTruthy()
    expect(hit!.message).toContain('整数型')
  })

  it('变量类型按作用域解析：整数变量传给文本型参数 → 报；文本变量 → 不报', () => {
    const bad = run(`${SUB_HEAD}取文本长度 (整数变量)`)
    expect(bad.some(p => p.message.includes('类型不匹配'))).toBe(true)
    const good = run(`${SUB_HEAD}取文本长度 (文本变量)`)
    expect(good.filter(p => p.message.includes('类型不匹配'))).toHaveLength(0)
  })

  it('嵌套调用按返回类型判定：到字节集() 返回字节集，传给字节集参数 → 不报；传给文本型参数 → 报', () => {
    const good = run(`${SUB_HEAD}写到文件 (“a.txt”,到字节集 (1))`)
    expect(good.filter(p => p.message.includes('类型不匹配'))).toHaveLength(0)
    const bad = run(`${SUB_HEAD}取文本长度 (到字节集 (1))`)
    expect(bad.some(p => p.message.includes('欲取其长度的文本'))).toBe(true)
  })

  it('嵌套调用内部的参数同样被检查', () => {
    const problems = run(`${SUB_HEAD}调试输出 (取文本长度 (123))`)
    expect(problems.some(p => p.message.includes('欲取其长度的文本'))).toBe(true)
  })

  it('通用型参数不检查；重复参数沿用末参数类型', () => {
    const good = run(`${SUB_HEAD}调试输出 (1, “文本”, 真, 文本变量)`)
    expect(good.filter(p => p.message.includes('类型不匹配'))).toHaveLength(0)
    const bad = run(`${SUB_HEAD}写到文件 (“a.txt”,到字节集 (1),“不是字节集”)`)
    expect(bad.some(p => p.message.includes('欲写入文件的数据'))).toBe(true)
  })

  it('逻辑型参数：真/假与逻辑变量不报，数值报', () => {
    const good = run(`${SUB_HEAD}如果真 (真)`)
    expect(good.filter(p => p.message.includes('类型不匹配'))).toHaveLength(0)
    const bad = run(`${SUB_HEAD}如果真 (1)`)
    expect(bad.some(p => p.message.includes('条件'))).toBe(true)
  })

  it('无法推断的表达式/未知变量/常量/省略参数 → 不报（保守跳过）', () => {
    const problems = run(`${SUB_HEAD}取文本长度 (文本变量 ＋ 未知的东西)\n取文本长度 (#某常量)\n写到文件 (,到字节集 (1))`)
    expect(problems.filter(p => p.message.includes('类型不匹配'))).toHaveLength(0)
  })

  it('字符串字面量里的命令名/括号不误触发', () => {
    const problems = run(`${SUB_HEAD}调试输出 (“写到文件 (1.txt)”)`)
    expect(problems.filter(p => p.message.includes('文件名'))).toHaveLength(0)
  })

  it('未提供签名表时完全不检查', () => {
    const problems = buildEditorDiagnosticsProblems({
      text: `${SUB_HEAD}写到文件 (1.txt,到字节集 ())`,
      hasCommandCatalog: true,
      validCommandNames: Object.keys(signatures),
      allKnownVarNames: [],
      reservedNames: [],
    })
    expect(problems.filter(p => p.message.includes('不是有效表达式'))).toHaveLength(0)
  })
})

describe('地址类命令必须用长整数型接收', () => {
  // x64 地址 64 位，赋给 整数型 等更窄类型会被截断成无效地址（32 位易语言老代码的典型移植坑）。
  // 问题面板提前拦截；compiler.ts 转译期有同款硬拦截。
  const ADDR_HEAD = '.子程序 测试子程序\n.局部变量 指针变量, 整数型\n.局部变量 长指针, 长整数型\n.局部变量 整数变量, 整数型\n'
  const runAddr = (text: string) =>
    buildEditorDiagnosticsProblems({
      text,
      hasCommandCatalog: true,
      validCommandNames: [...Object.keys(signatures), '取变量地址', '取变量数据地址'],
      allKnownVarNames: ['指针变量', '长指针', '整数变量'],
      reservedNames: ['真', '假'],
      commandSignatures: signatures,
    })

  it('取变量地址 赋给整数型变量 → 报截断并提示改长整数型', () => {
    const problems = runAddr(`${ADDR_HEAD}指针变量 ＝ 取变量地址 (整数变量)`)
    const hit = problems.find(p => p.message.includes('截断'))
    expect(hit).toBeTruthy()
    expect(hit!.message).toContain('长整数型')
    expect(hit!.message).toContain('指针变量')
    expect(hit!.severity).toBe('error')
  })

  it('取变量数据地址 同规则', () => {
    const problems = runAddr(`${ADDR_HEAD}指针变量 ＝ 取变量数据地址 (整数变量)`)
    expect(problems.some(p => p.message.includes('截断') && p.message.includes('长整数型'))).toBe(true)
  })

  it('长整数型变量接收 → 不报', () => {
    const problems = runAddr(`${ADDR_HEAD}长指针 ＝ 取变量地址 (整数变量)`)
    expect(problems.filter(p => p.message.includes('截断'))).toHaveLength(0)
  })

  it('目标类型未知（如未声明变量）→ 保守不报截断（未知变量另有诊断）', () => {
    const problems = runAddr(`${ADDR_HEAD}没声明的变量 ＝ 取变量地址 (整数变量)`)
    expect(problems.filter(p => p.message.includes('截断'))).toHaveLength(0)
  })
})

describe('数字开头的裸语句', () => {
  it('整行纯数字 → 无效语句（用户场景：123555 没报未知命令）', () => {
    const problems = run(`${SUB_HEAD}123555`)
    const hit = problems.find(p => p.message.includes('无效语句'))
    expect(hit).toBeTruthy()
    expect(hit!.message).toContain('123555')
  })

  it('数字开头的杂项 token（1.txt 裸写在语句位）也报', () => {
    const problems = run(`${SUB_HEAD}1.txt`)
    expect(problems.some(p => p.message.includes('无效语句'))).toBe(true)
  })

  it('数字作参数/赋值右值不误报', () => {
    const problems = run(`${SUB_HEAD}延时 (100)
整数变量 ＝ 123`)
    expect(problems.filter(p => p.message.includes('无效语句'))).toHaveLength(0)
  })
})

describe('字符串开头的裸语句', () => {
  it('整行只写字符串 → 无效语句（用户场景："编辑框1.内容"）', () => {
    const problems = run(`${SUB_HEAD}"编辑框1.内容"`)
    const hit = problems.find(p => p.message.includes('字符串不能单独作为语句'))
    expect(hit).toBeTruthy()
    const full = run(`${SUB_HEAD}“编辑框1.内容”`)
    expect(full.some(p => p.message.includes('字符串不能单独作为语句'))).toBe(true)
  })

  it('字符串作参数/赋值右值不误报', () => {
    const problems = run(`${SUB_HEAD}调试输出 (“文本”)
文本变量 ＝ “内容”`)
    expect(problems.filter(p => p.message.includes('字符串不能单独作为语句'))).toHaveLength(0)
  })
})

describe('成员引用的对象必须真实存在', () => {
  it('设计器没放置 编辑框1 → 编辑框1.内容 报未定义（用户场景）', () => {
    const problems = run(`${SUB_HEAD}编辑框1.内容`)
    const hit = problems.find(p => p.message.includes('未定义的窗口组件或对象'))
    expect(hit).toBeTruthy()
    expect(hit!.message).toContain('编辑框1')
  })

  it('对象是已知变量/控件（allKnownVarNames 含控件名）→ 不报', () => {
    const problems = run(`${SUB_HEAD}文本变量.内容`)
    expect(problems.filter(p => p.message.includes('未定义的窗口组件或对象'))).toHaveLength(0)
  })

  it('字符串里的 对象.成员 不误报；链式只查首段', () => {
    const problems = run(`${SUB_HEAD}调试输出 (“编辑框9.内容”)
文本变量.子级.再子级`)
    expect(problems.filter(p => p.message.includes('未定义的窗口组件或对象'))).toHaveLength(0)
  })
})

describe('行内括号配平', () => {
  it('多余右括号 → 报数量（用户场景：编辑框1.内容 ＝ 到文本(n)))）', () => {
    const problems = run(`${SUB_HEAD}文本变量 ＝ 到字节集(1)))`)
    const hit = problems.find(p => p.message.includes('括号不匹配'))
    expect(hit).toBeTruthy()
    expect(hit!.message).toContain('多余 2 个右括号')
  })

  it('缺少右括号 → 报数量', () => {
    const problems = run(`${SUB_HEAD}调试输出 (到字节集(1)`)
    const hit = problems.find(p => p.message.includes('缺少'))
    expect(hit).toBeTruthy()
    expect(hit!.message).toContain('缺少 1 个右括号')
  })

  it('字符串内括号与行尾注释里的括号不计', () => {
    const problems = run(`${SUB_HEAD}调试输出 (“(((”) ' 注释里有 )))`)
    expect(problems.filter(p => p.message.includes('括号不匹配'))).toHaveLength(0)
  })
})

// ===== 控件属性赋值的数据类型检查（内容 随 输入方式 折算） =====

const EDIT_UNIT = {
  name: '编辑框',
  properties: [
    { name: '内容', typeName: '文本型', pickOptions: [] as string[] },
    { name: '宽度', typeName: '整数型', pickOptions: [] as string[] },
    {
      name: '输入方式', typeName: '选择整数', defaultValue: 0,
      pickOptions: ['通常方式', '只读文本', '密码输入', '整数文本输入', '小数文本输入', '输入字节', '输入短整数', '输入整数', '输入长整数', '输入小数', '输入双精度小数', '输入日期时间'],
    },
  ],
}

function runCtl(text: string, inputMode?: number): ReturnType<typeof buildEditorDiagnosticsProblems> {
  const controls = [{ name: '编辑框1', type: '编辑框', properties: inputMode === undefined ? {} : { 输入方式: inputMode } }]
  return buildEditorDiagnosticsProblems({
    text,
    hasCommandCatalog: true,
    validCommandNames: [...Object.keys(signatures), '真', '假'],
    allKnownVarNames: ['a', '文本变量', '整数变量', '编辑框1'],
    reservedNames: ['真', '假'],
    commandSignatures: signatures,
    controlPropTypes: buildControlPropTypes(controls, [EDIT_UNIT]),
  })
}

describe('buildControlPropTypes：输入方式折算 内容 类型', () => {
  it('输入方式=输入整数(7) → 内容为整数型；宽度保持整数型', () => {
    const m = buildControlPropTypes([{ name: '编辑框1', type: '编辑框', properties: { 输入方式: 7 } }], [EDIT_UNIT])!
    expect(m['编辑框1']['内容']).toBe('整数型')
    expect(m['编辑框1']['宽度']).toBe('整数型')
  })

  it('缺省/文本类输入方式 → 内容保持文本型；未知单元的控件不入表', () => {
    const m = buildControlPropTypes([
      { name: '编辑框1', type: '编辑框', properties: {} },
      { name: '编辑框2', type: '编辑框', properties: { 输入方式: 3 } },
      { name: '神秘1', type: '神秘组件', properties: {} },
    ], [EDIT_UNIT])!
    expect(m['编辑框1']['内容']).toBe('文本型')
    expect(m['编辑框2']['内容']).toBe('文本型')
    expect(m['神秘1']).toBeUndefined()
  })
})

describe('控件属性赋值类型检查', () => {
  it('用户场景：输入方式=输入整数 时 编辑框1.内容 ＝ 到文本(n) → 报类型不匹配', () => {
    const problems = runCtl(`${SUB_HEAD}编辑框1.内容 ＝ 到文本 (整数变量)`, 7)
    const hit = problems.find(p => p.message.includes('编辑框1.内容') && p.message.includes('类型不匹配'))
    expect(hit).toBeTruthy()
    expect(hit!.message).toContain('需要 整数型')
    expect(hit!.message).toContain('文本型')
  })

  it('输入方式=输入整数 时 编辑框1.内容 ＝ 整数变量 → 不报', () => {
    const problems = runCtl(`${SUB_HEAD}编辑框1.内容 ＝ 整数变量`, 7)
    expect(problems.filter(p => p.message.includes('编辑框1.内容'))).toHaveLength(0)
  })

  it('缺省输入方式（内容=文本型）：赋数值报、赋 到文本(...) 不报', () => {
    const bad = runCtl(`${SUB_HEAD}编辑框1.内容 ＝ 整数变量`)
    expect(bad.some(p => p.message.includes('编辑框1.内容') && p.message.includes('需要 文本型'))).toBe(true)
    const ok = runCtl(`${SUB_HEAD}编辑框1.内容 ＝ 到文本 (整数变量)`)
    expect(ok.filter(p => p.message.includes('编辑框1.内容'))).toHaveLength(0)
  })

  it('其他属性同样检查：编辑框1.宽度 ＝ 文本字面量 → 报；右值无法推断 → 保守不报', () => {
    const bad = runCtl(`${SUB_HEAD}编辑框1.宽度 ＝ “abc”`, 7)
    expect(bad.some(p => p.message.includes('编辑框1.宽度') && p.message.includes('需要 整数型'))).toBe(true)
    const unknown = runCtl(`${SUB_HEAD}编辑框1.内容 ＝ 神秘变量甲`, 7)
    expect(unknown.filter(p => p.message.includes('编辑框1.内容'))).toHaveLength(0)
  })
})

describe('逻辑运算符别名 且/或', () => {
  it('用户场景：流程条件里的 且 不报未知命令（并且 的运算符别名，不依赖命令目录）', () => {
    const problems = run(`${SUB_HEAD}.判断循环首 (整数变量 ＜ a 且 整数变量 ≥ a)
.判断循环尾 ()`)
    expect(problems.filter(p => p.message.includes('未知命令'))).toHaveLength(0)
  })

  it('或 同样豁免；真正的未知命令仍照报', () => {
    const problems = run(`${SUB_HEAD}.如果真 (整数变量 ＜ a 或 整数变量 ＞ a)
神秘命令 (1)
.如果真结束`)
    expect(problems.some(p => p.message.includes('未知命令') && p.message.includes('或'))).toBe(false)
    expect(problems.some(p => p.message.includes('未知命令"神秘命令"'))).toBe(true)
  })
})

describe('逻辑字面量 真/假 的词边界', () => {
  it('用户场景：重定义数组 (排序数组, 假, 数组大小) / 数组排序 (排序数组, 真) 不报未定义变量', () => {
    // 不给 真/假 任何豁免（validCommandNames/reservedNames 都不含），验证着色器把它们认成常量字面量
    const problems = buildEditorDiagnosticsProblems({
      text: '.子程序 测试子程序\n.局部变量 排序数组, 整数型, , "0"\n.局部变量 数组大小, 整数型\n重定义数组 (排序数组, 假, 数组大小)\n数组排序 (排序数组, 真)',
      hasCommandCatalog: true,
      validCommandNames: ['重定义数组', '数组排序', '排序数组', '数组大小'],
      allKnownVarNames: ['排序数组', '数组大小'],
      reservedNames: [],
    })
    expect(problems.filter(p => p.message.includes('未定义变量'))).toHaveLength(0)
  })

  it('半角括号紧跟的 或/且 同样不误报（词边界统一修复）', () => {
    const problems = buildEditorDiagnosticsProblems({
      text: '.子程序 测试子程序\n.局部变量 a, 整数型\n.如果真 (a ＜ 1 或 a ＞ 2)\n.如果真结束',
      hasCommandCatalog: true,
      validCommandNames: ['如果真', '如果真结束', 'a'],
      allKnownVarNames: ['a'],
      reservedNames: [],
    })
    expect(problems.filter(p => p.message.includes('未知命令') || p.message.includes('未定义变量'))).toHaveLength(0)
  })
})
