import type { CompletionItem } from './editorCoreUtils'
import { isEnglishMatch, matchScore } from '../../utils/pinyin'

export interface AcDisplayItem {
  cmd: CompletionItem
  engMatch: boolean
  isMore?: boolean
  remainCount?: number
  hiddenItems?: AcDisplayItem[]
}

// 将完整补全列表分页，尾部注入“更多”占位项。
export function paginateCompletionDisplayItems(fullMatches: AcDisplayItem[], pageSize: number): AcDisplayItem[] {
  if (fullMatches.length <= pageSize) return fullMatches

  const hiddenItems = fullMatches.slice(pageSize)
  return [
    ...fullMatches.slice(0, pageSize),
    {
      cmd: {
        name: '...',
        englishName: '',
        description: '双击显示剩余项',
        returnType: '',
        category: '补全提示',
        libraryName: '',
        isMember: false,
        ownerTypeName: '',
        params: [],
      },
      engMatch: false,
      isMore: true,
      remainCount: hiddenItems.length,
      hiddenItems,
    },
  ]
}

interface BuildCompletionMatchesParams {
  sourceList: CompletionItem[]
  word: string
  isClassNameCellEdit: boolean
  isTypeCellEdit: boolean
  hashMode: boolean
  allowEmptyWord: boolean
}

// 对候选项打分、排序并生成展示态（含英文别名命中标记）。
export function buildCompletionMatches(params: BuildCompletionMatchesParams): AcDisplayItem[] {
  const {
    sourceList,
    word,
    isClassNameCellEdit,
    isTypeCellEdit,
    hashMode,
    allowEmptyWord,
  } = params

  const shouldAllowByEmptyWord = isClassNameCellEdit || isTypeCellEdit || hashMode || allowEmptyWord

  return sourceList
    .map(cmd => {
      const score = shouldAllowByEmptyWord
        ? (word.length === 0 ? (cmd.name.length > 0 ? 1 : 0) : matchScore(word, cmd.name, cmd.englishName))
        : matchScore(word, cmd.name, cmd.englishName)
      return { cmd, score }
    })
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score || a.cmd.name.length - b.cmd.name.length)
    .map(m => ({
      cmd: m.cmd,
      engMatch: !isTypeCellEdit
        && !isClassNameCellEdit
        && !hashMode
        && isEnglishMatch(word, m.cmd.englishName)
        && !m.cmd.name.includes(word),
    }))
}

export function computeCompletionPopupPosition(input: HTMLInputElement, value: string, wordStart: number): { left: number; top: number } {
  // 与输入框字体保持一致，估算到当前词起点的像素偏移。
  const rect = input.getBoundingClientRect()
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  let leftOffset = 0
  if (ctx) {
    ctx.font = getComputedStyle(input).font || '13px Consolas, "Microsoft YaHei", monospace'
    leftOffset = ctx.measureText(value.slice(0, wordStart)).width
  }
  return {
    left: rect.left + leftOffset,
    top: rect.bottom + 2,
  }
}
