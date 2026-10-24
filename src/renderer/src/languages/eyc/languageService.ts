// 编辑器插件读取宿主服务的入口（设计稿 §5.1、§6.2、§6.3）：
//   EycLanguageServiceContext —— ycide.lang-eyc 语言服务提供的项目级符号（eyc/symbols）
//   EditorDecorationsContext  —— 宿主的装饰服务：断点、调试当前行与变量、AI 改动的差异标记
// 宿主（Editor.tsx）按当前文档提供这两个服务；编辑器组件（如表格编辑器）自己订阅，
// 不再由父组件逐个经 props 下传，编辑器因此可以作为独立的编辑器插件替换或复用。

import { createContext, useContext } from 'react'
import type { EycProjectSymbols } from './projectSymbols'

const EMPTY_ARRAY: never[] = []
const EMPTY_LINE_SET: Set<number> = new Set()

export const EMPTY_PROJECT_SYMBOLS: EycProjectSymbols = {
  projectGlobalVars: EMPTY_ARRAY,
  projectConstants: EMPTY_ARRAY,
  projectDllCommands: EMPTY_ARRAY,
  projectDataTypes: EMPTY_ARRAY,
  projectClassNames: EMPTY_ARRAY,
  projectWindows: EMPTY_ARRAY,
  activeWindowControls: EMPTY_ARRAY,
  activeWindowControlNames: EMPTY_ARRAY,
  windowUnits: EMPTY_ARRAY,
}

export const EycLanguageServiceContext = createContext<EycProjectSymbols>(EMPTY_PROJECT_SYMBOLS)

/** 读取语言服务提供的项目级符号；没有宿主提供时为空（编辑器仍可工作，只是没有项目级补全与校验） */
export function useEycProjectSymbolsService(): EycProjectSymbols {
  return useContext(EycLanguageServiceContext)
}

export interface DocumentDecorations {
  /** 断点所在行（表格编辑器行号，0 基） */
  breakpointLines: number[]
  /** 调试暂停时的当前源码行（1 基） */
  debugSourceLine?: number
  /** 调试暂停时的变量 */
  debugVariables: Array<{ name: string; type: string; value: string }>
  /** AI 改动差异：整体高亮、新增、修改、删除锚点、锚点处被删除的原文 */
  diffHighlightLines?: Set<number>
  diffAddedLines: Set<number>
  diffEditedLines: Set<number>
  diffDeletedAfterLines: Set<number>
  diffDeletedTextAfterLines?: Map<number, string>
}

export const EMPTY_DECORATIONS: DocumentDecorations = {
  breakpointLines: EMPTY_ARRAY,
  debugVariables: EMPTY_ARRAY,
  diffAddedLines: EMPTY_LINE_SET,
  diffEditedLines: EMPTY_LINE_SET,
  diffDeletedAfterLines: EMPTY_LINE_SET,
}

export const EditorDecorationsContext = createContext<DocumentDecorations>(EMPTY_DECORATIONS)

/** 读取宿主装饰服务为当前文档提供的装饰 */
export function useDocumentDecorations(): DocumentDecorations {
  return useContext(EditorDecorationsContext)
}
