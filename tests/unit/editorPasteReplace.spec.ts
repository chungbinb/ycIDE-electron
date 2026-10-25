// 表格编辑器「全选后粘贴」（覆盖粘贴）：从易语言复制整个程序集的代码粘进来，
// 程序集声明、程序集变量必须留在文件顶部，子程序跟在后面；文件开头的 .版本 行不能丢。
// 此前覆盖粘贴的插入点取选区首行（第 0 行），子程序被插到受保护的 .程序集 行之上，
// 整张程序集表连同程序集变量跑到了文件末尾。
import { describe, it, expect } from 'vitest'
import { buildMultiLinePasteResult } from '@/components/Editor/editorPasteUtils'
import { sanitizePastedTextForCurrent, extractAssemblyVarLinesFromPasted, extractRoutedDeclarationLinesFromPasted } from '@/components/Editor/eycFormat'
import { parseLines } from '@/components/Editor/eycBlocks'

// 新建窗口程序项目时启动窗口的程序集文件
const NEW_PROJECT_SOURCE = ['.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 __启动窗口_创建完毕', '', ''].join('\n')

// 从易语言复制出来的整个程序集
const FROM_YI = [
  '.版本 2',
  '',
  '.程序集 窗口程序集_启动窗口',
  '.程序集变量 秒钟, 整数型',
  '.程序集变量 文件名, 文本型',
  '',
  '.子程序 __启动窗口_创建完毕',
  '',
  '秒钟 ＝ 0',
  '',
  '.子程序 _按钮1_被单击',
  '',
  '文件名 ＝ “a.txt”',
  '',
].join('\r\n')

function paste(currentText: string, replaceAll: boolean, cursorLine = 0) {
  return buildMultiLinePasteResult({
    currentText,
    clipText: FROM_YI,
    cursorLine,
    sanitizePastedText: sanitizePastedTextForCurrent,
    extractAssemblyVarLines: extractAssemblyVarLinesFromPasted,
    extractRoutedDeclarationLines: extractRoutedDeclarationLinesFromPasted,
    replaceLineIndices: replaceAll ? currentText.split('\n').map((_, i) => i) : undefined,
  })!
}

/** 结果里各类声明行出现的顺序（忽略空行与代码行） */
function declOrder(text: string): string[] {
  return parseLines(text)
    .map(l => (l.type === 'version' || l.type === 'assembly' || l.type === 'assemblyVar' || l.type === 'sub') ? `${l.type}:${(l.fields[0] ?? '').trim()}` : '')
    .filter(Boolean)
}

describe('全选后粘贴易语言代码（覆盖粘贴）', () => {
  it('程序集声明与程序集变量留在顶部，子程序跟在后面，.版本 行保留', () => {
    const result = paste(NEW_PROJECT_SOURCE, true)
    expect(declOrder(result.nextText)).toEqual([
      'version:',
      'assembly:窗口程序集_启动窗口',
      'assemblyVar:秒钟',
      'assemblyVar:文件名',
      'sub:__启动窗口_创建完毕',
      'sub:_按钮1_被单击',
    ])
  })

  it('选中的是 .程序集 之后的部分行时，粘贴位置不变（仍在选区首行）', () => {
    const lines = NEW_PROJECT_SOURCE.split('\n')
    const result = buildMultiLinePasteResult({
      currentText: NEW_PROJECT_SOURCE,
      clipText: FROM_YI,
      cursorLine: 3,
      sanitizePastedText: sanitizePastedTextForCurrent,
      extractAssemblyVarLines: extractAssemblyVarLinesFromPasted,
      extractRoutedDeclarationLines: extractRoutedDeclarationLinesFromPasted,
      replaceLineIndices: lines.map((_, i) => i).filter(i => i >= 3),
    })!
    expect(declOrder(result.nextText)).toEqual([
      'version:', 'assembly:窗口程序集_启动窗口', 'assemblyVar:秒钟', 'assemblyVar:文件名', 'sub:__启动窗口_创建完毕', 'sub:_按钮1_被单击',
    ])
  })

  it('不选中直接粘贴（光标在第一个子程序里）：子程序在原子程序之后，程序集变量在顶部', () => {
    const result = paste(NEW_PROJECT_SOURCE, false, 3)
    expect(declOrder(result.nextText)).toEqual([
      'version:', 'assembly:窗口程序集_启动窗口', 'assemblyVar:秒钟', 'assemblyVar:文件名',
      'sub:__启动窗口_创建完毕', 'sub:__启动窗口_创建完毕_1', 'sub:_按钮1_被单击',
    ])
  })
})
