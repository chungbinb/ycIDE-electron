// DLL 命令的库文件名 / 对应命令名在表格里去掉引号显示，写回源码时要补回引号
import { describe, it, expect } from 'vitest'
import { quoteDllTextFieldValue, rebuildLineField } from '@/components/Editor/editorCoreUtils'

const DLL = '.DLL命令 API1, 整数型, "user32.dll", "Func1", , 备注1'

describe('DLL 命令文本字段写回补引号', () => {
  it('库文件名、对应命令名补回引号', () => {
    expect(quoteDllTextFieldValue(DLL, 2, 'user32.dll')).toBe('"user32.dll"')
    expect(quoteDllTextFieldValue(DLL, 3, 'MessageBoxW')).toBe('"MessageBoxW"')
    expect(quoteDllTextFieldValue(DLL, 2, '')).toBe('""')
  })

  it('已带引号的值原样保留', () => {
    expect(quoteDllTextFieldValue(DLL, 2, '"kernel32.dll"')).toBe('"kernel32.dll"')
    expect(quoteDllTextFieldValue(DLL, 2, '“kernel32.dll”')).toBe('“kernel32.dll”')
  })

  it('其它字段、其它声明不处理', () => {
    expect(quoteDllTextFieldValue(DLL, 1, '整数型')).toBe('整数型')
    expect(quoteDllTextFieldValue(DLL, 5, '备注')).toBe('备注')
    expect(quoteDllTextFieldValue('.常量 常量1, 1', 2, 'x')).toBe('x')
    expect(quoteDllTextFieldValue('.指针命令 指针命令1', 2, 'x')).toBe('x')
  })

  it('点进库文件名格不改动就离开：写回的行与原文一致', () => {
    expect(rebuildLineField(DLL, 2, quoteDllTextFieldValue(DLL, 2, 'user32.dll'), false)).toBe(DLL)
    expect(rebuildLineField(DLL, 3, quoteDllTextFieldValue(DLL, 3, 'Func1'), false)).toBe(DLL)
  })
})
