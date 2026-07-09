import { describe, it, expect } from 'vitest'
import { sweepFileDiagnostics } from '@/components/Editor/projectDiagnosticsSweep'

// 编译前全项目诊断扫描：对未打开文件跑问题面板同款诊断

const CATALOG = [
  { name: '调试输出', params: [{ name: '欲输出的内容', type: '通用型', repeatable: true }], returnType: '' },
  { name: '到文本', params: [{ name: '欲转换的数值', type: '通用型' }], returnType: '文本型' },
]

const EDIT_UNIT = {
  name: '编辑框',
  properties: [
    { name: '内容', typeName: '文本型', pickOptions: [] as string[] },
    {
      name: '输入方式', typeName: '选择整数', defaultValue: 0,
      pickOptions: ['通常方式', '只读文本', '密码输入', '整数文本输入', '小数文本输入', '输入字节', '输入短整数', '输入整数', '输入长整数', '输入小数', '输入双精度小数', '输入日期时间'],
    },
  ],
}

function run(text: string, extra?: Partial<Parameters<typeof sweepFileDiagnostics>[0]>) {
  return sweepFileDiagnostics({
    text,
    catalogCommands: CATALOG,
    dllCommands: [],
    projectGlobalVarNames: ['全局计数'],
    windowControls: [],
    windowUnits: [],
    ...extra,
  })
}

describe('sweepFileDiagnostics：未打开文件的编译前扫描', () => {
  it('未知命令被扫出（用户场景：项目里有错但文件没打开）', () => {
    const problems = run('.子程序 测试子程序\n神秘命令 (1)')
    expect(problems.some(p => p.message.includes('未知命令"神秘命令"'))).toBe(true)
  })

  it('干净文件无错误；全局变量/流程关键字/且或别名不误报', () => {
    const problems = run('.子程序 测试子程序\n.局部变量 n, 整数型\n.如果真 (n ＜ 1 且 n ＞ 0)\n调试输出 (全局计数)\n.如果真结束')
    expect(problems.filter(p => p.severity === 'error')).toHaveLength(0)
  })

  it('控件属性类型检查随窗口上下文生效（输入整数 时赋 到文本(...) 报错）', () => {
    const problems = run('.子程序 测试子程序\n.局部变量 n, 整数型\n编辑框1.内容 ＝ 到文本 (n)', {
      windowControls: [{ name: '编辑框1', type: '编辑框', properties: { 输入方式: 7 } }],
      windowUnits: [EDIT_UNIT],
    })
    expect(problems.some(p => p.message.includes('编辑框1.内容') && p.message.includes('类型不匹配'))).toBe(true)
  })

  it('本文档声明的 DLL 命令与括号不配平：前者不报未知、后者照报', () => {
    const problems = run('.DLL命令 取盘符, 整数型, "kernel32", "GetLogicalDrives"\n.子程序 测试子程序\n取盘符 ()\n调试输出 (1))')
    expect(problems.some(p => p.message.includes('未知命令"取盘符"'))).toBe(false)
    expect(problems.some(p => p.message.includes('括号不匹配'))).toBe(true)
  })
})
