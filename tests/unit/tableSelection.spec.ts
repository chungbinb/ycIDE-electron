// 表格编辑器行多选辅助规则：整块补全（点首行表头、删除声明行时用）与 Ctrl+单击切换
import { describe, it, expect } from 'vitest'
import { expandDeclBlockSelection, getDeclChildLines, toggleLineInSelection } from '@/components/Editor/tableSelection'

const ELL = [
  '.版本 2',                                   // 0
  '',                                          // 1
  '.DLL命令 API1, 整数型, "user32.dll", "F1"',  // 2
  '    .参数 参数A, 整数型',                    // 3
  '    .参数 参数B, 文本型',                    // 4
  '',                                          // 5
  '.DLL命令 API2, , "user32.dll", "F2"',       // 6
  '',                                          // 7
  '.指针命令 指针命令1',                         // 8
  '    .参数 p, 整数型',                        // 9
]

const EDT = [
  '.版本 2',
  '.数据类型 坐标',     // 1
  '    .成员 x, 整数型', // 2
  '    .成员 y, 整数型', // 3
  '.数据类型 空类型',   // 4
]

describe('表格多选整块规则', () => {
  it('DLL / 指针命令的子行是紧随其后的 .参数 行', () => {
    expect(getDeclChildLines(ELL, 2)).toEqual([3, 4])
    expect(getDeclChildLines(ELL, 6)).toEqual([])
    expect(getDeclChildLines(ELL, 8)).toEqual([9])
    expect(getDeclChildLines(ELL, 3)).toEqual([])
    expect(getDeclChildLines(EDT, 1)).toEqual([2, 3])
    expect(getDeclChildLines(EDT, 4)).toEqual([])
  })

  it('整块补全：声明行补上参数 / 成员', () => {
    expect([...expandDeclBlockSelection(ELL, new Set([2]))].sort()).toEqual([2, 3, 4])
    expect([...expandDeclBlockSelection(ELL, new Set([2, 8]))].sort()).toEqual([2, 3, 4, 8, 9])
    expect([...expandDeclBlockSelection(EDT, new Set([1]))].sort()).toEqual([1, 2, 3])
  })

  it('只选参数行不向上扩展；无需补行时返回原 Set', () => {
    const onlyParam = new Set([4])
    expect(expandDeclBlockSelection(ELL, onlyParam)).toBe(onlyParam)
    const full = new Set([2, 3, 4])
    expect(expandDeclBlockSelection(ELL, full)).toBe(full)
  })

  it('Ctrl+单击只加选 / 取消点到的那一行', () => {
    expect([...toggleLineInSelection(new Set([6]), 2)].sort()).toEqual([2, 6])
    expect([...toggleLineInSelection(new Set([2, 3, 4, 6]), 2)].sort()).toEqual([3, 4, 6])
  })
})
