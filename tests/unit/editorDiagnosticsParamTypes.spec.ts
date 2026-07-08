import { describe, it, expect } from 'vitest'
import {
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
