import { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef, Component, type ErrorInfo, type ReactNode } from 'react'
import MonacoEditor, { OnMount, OnChange, type Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import EycTableEditor, { type EycTableEditorHandle, type FileProblem } from './EycTableEditor'
import VisualDesigner, { type DesignForm, type DesignControl, type SelectionTarget, type LibWindowUnit, type LibUnitEvent, type AlignAction } from './VisualDesigner'
import { eycToInternalFormat, eycToYiFormat } from './eycFormat'
import Icon from '../Icon/Icon'
import '../Icon/Icon.css'
import './Editor.css'

/** 注册 eyc 语言到 Monaco Editor */
function registerEycLanguage(monaco: Monaco): void {
  // 避免重复注册
  if (monaco.languages.getLanguages().some((lang: { id: string }) => lang.id === 'eyc')) return

  // 注册语言
  monaco.languages.register({
    id: 'eyc',
    extensions: ['.eyc', '.egv'],
    aliases: ['易语言源码', 'EYC', 'eyc'],
  })

  // 语法高亮规则 (Monarch tokenizer)
  monaco.languages.setMonarchTokensProvider('eyc', {
    defaultToken: '',
    ignoreCase: false,

    // 易语言关键字
    keywords: [
      '如果', '如果真', '否则', '如果结束', '如果真结束',
      '判断', '判断结束', '默认',
      '计次循环首', '计次循环尾', '循环判断首', '循环判断尾',
      '变量循环首', '变量循环尾', '到循环尾', '跳出循环',
      '返回', '结束',
      '等待', '延时',
    ],

    // 声明关键字（以 . 开头）
    declarations: [
      '版本', '支持库', '程序集', '子程序', '局部变量', '参数',
      '全局变量', '程序集变量', '常量', '数据类型', '自定义数据类型',
      'DLL命令', '模块引用',
    ],

    // 数据类型
    typeKeywords: [
      '整数型', '小数型', '双精度小数型', '文本型', '字节型',
      '短整数型', '长整数型', '逻辑型', '日期时间型', '子程序指针',
      '字节集', '通用型',
    ],

    // 内置命令
    builtins: [
      '信息框', '输入框', '标题', '输出调试文本', '到文本', '到数值',
      '取文本长度', '取文本左边', '取文本右边', '取文本中间',
      '寻找文本', '替换文本', '删全部空', '文本替换',
      '取数组成员数', '加入成员', '删除成员', '清除数组',
      '写到文件', '读入文件', '文件是否存在', '创建目录',
      '取现行时间', '时间到文本', '是否为空',
      '取随机数', '置随机数种子',
      '载入', '销毁', '可视', '宽度', '高度', '左边', '顶边',
    ],

    // 逻辑常量
    constants: ['真', '假', '空'],

    // 运算符
    operators: ['＝', '≠', '＞', '＜', '≥', '≤', '＋', '－', '×', '÷', '且', '或', '非'],

    // 符号
    symbols: /[=><!~?:&|+\-*\/\^%]+/,

    tokenizer: {
      root: [
        // 以 . 开头的声明关键字
        [/\.([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_]*)/, {
          cases: {
            '$1@declarations': 'keyword.declaration',
            '@default': 'keyword.declaration',
          }
        }],

        // 行注释 (以 ' 开头 或 // 开头)
        [/\/\/.*$/, 'comment'],
        [/'.*$/, 'comment'],

        // 字符串
        [/"([^"]*)"/, 'string'],
        [/\u201c([^\u201d]*)\u201d/, 'string'],

        // 中文括号
        [/\uff08/, 'delimiter.parenthesis'],
        [/\uff09/, 'delimiter.parenthesis'],

        // 数字
        [/\d+\.\d*/, 'number.float'],
        [/\d+/, 'number'],

        // 标识符匹配
        [/[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_]*/, {
          cases: {
            '@keywords': 'keyword',
            '@typeKeywords': 'type',
            '@builtins': 'predefined',
            '@constants': 'constant',
            '@operators': 'operator',
            '@default': 'identifier',
          },
        }],

        // 空白
        [/[ \t\r\n]+/, 'white'],

        // 标点
        [/[{}()\[\]，,。；;：:]/, 'delimiter'],
      ],
    },
  })

  // 语言配置（括号匹配、注释等）
  monaco.languages.setLanguageConfiguration('eyc', {
    comments: {
      lineComment: "'",
    },
    brackets: [
      ['\uff08', '\uff09'],
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ],
    autoClosingPairs: [
      { open: '\uff08', close: '\uff09' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: '\u201c', close: '\u201d' },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
    ],
    surroundingPairs: [
      { open: '\uff08', close: '\uff09' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: '\u201c', close: '\u201d' },
    ],
    indentationRules: {
      increaseIndentPattern: /^\s*\.(子程序|如果|否则|判断|计次循环首|循环判断首|变量循环首)/,
      decreaseIndentPattern: /^\s*\.(如果结束|如果真结束|否则|判断结束|计次循环尾|循环判断尾|变量循环尾)/,
    },
  })

  // 代码补全
  monaco.languages.registerCompletionItemProvider('eyc', {
    provideCompletionItems: (model: editor.ITextModel, position: { lineNumber: number; column: number }) => {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }

      const suggestions = [
        { label: '.子程序', kind: monaco.languages.CompletionItemKind.Keyword, insertText: '.子程序 ${1:子程序名}\n.参数 ${2:参数名}, ${3:整数型}\n\n    $0', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: '定义子程序', range },
        { label: '.局部变量', kind: monaco.languages.CompletionItemKind.Keyword, insertText: '.局部变量 ${1:变量名}, ${2:整数型}', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: '声明局部变量', range },
        { label: '.如果', kind: monaco.languages.CompletionItemKind.Keyword, insertText: '.如果 (${1:条件})\n    $0\n.如果结束', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: '条件判断', range },

        { label: '计次循环首', kind: monaco.languages.CompletionItemKind.Keyword, insertText: '计次循环首 (${1:次数}, ${2:计数变量})\n    $0\n计次循环尾 ()', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: '计次循环', range },
        { label: '信息框', kind: monaco.languages.CompletionItemKind.Function, insertText: '信息框 (${1:"内容"}, ${2:0}, ${3:"标题"}, )', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: '弹出信息框', range },
        { label: '输出调试文本', kind: monaco.languages.CompletionItemKind.Function, insertText: '输出调试文本 (${1:内容})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: '输出调试信息', range },
        { label: '到文本', kind: monaco.languages.CompletionItemKind.Function, insertText: '到文本 (${1:数值})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: '数值转文本', range },
        { label: '标题', kind: monaco.languages.CompletionItemKind.Function, insertText: '标题 (${1:"窗口标题"})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: '设置窗口标题', range },
        { label: '返回', kind: monaco.languages.CompletionItemKind.Keyword, insertText: '返回 (${1:值})', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: '返回值', range },
      ]

      return { suggestions }
    },
  })
}

// 打开的文件标签页
export interface EditorTab {
  id: string
  label: string
  language: string
  value: string
  savedValue: string  // 用于判断是否有未保存更改
  filePath?: string   // 实际文件路径
  formData?: DesignForm // 可视化设计器的窗口数据
}

export interface EditorHandle {
  save: () => void
  saveAll: () => void
  closeActiveTab: () => void
  clearAllTabs: () => void
  hasModifiedTabs: () => boolean
  editorAction: (action: string) => void
  getEditorFiles: () => Record<string, string>
  openFile: (tab: EditorTab) => void
  insertDeclaration: () => void
  insertLocalVariable: () => void
  navigateToLine: (line: number) => void
  updateFormProperty: (targetKind: 'form' | 'control', controlId: string | null, propName: string, value: string | number | boolean) => void
  navigateToEventSub: (sel: SelectionTarget, eventName: string, eventArgs: Array<{ name: string; description: string; dataType: string; isByRef: boolean }>) => void
}

interface EycEditorErrorBoundaryProps {
  tabId: string
  onError: (tabId: string, error: Error, info: ErrorInfo) => void
  children: ReactNode
}

interface EycEditorErrorBoundaryState {
  hasError: boolean
}

class EycEditorErrorBoundary extends Component<EycEditorErrorBoundaryProps, EycEditorErrorBoundaryState> {
  state: EycEditorErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): EycEditorErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError(this.props.tabId, error, info)
  }

  componentDidUpdate(prevProps: EycEditorErrorBoundaryProps): void {
    if (prevProps.tabId !== this.props.tabId && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  render(): ReactNode {
    if (this.state.hasError) return null
    return this.props.children
  }
}

const Editor = forwardRef<EditorHandle, { onSelectControl?: (target: SelectionTarget) => void; onSidebarTab?: (tab: 'project' | 'library' | 'property') => void; selection?: SelectionTarget; alignAction?: AlignAction; onAlignDone?: () => void; onMultiSelectChange?: (count: number) => void; openProjectFiles?: EditorTab[]; onOpenTabsChange?: (tabs: EditorTab[]) => void; onActiveTabChange?: (tabId: string | null) => void; onCommandClick?: (commandName: string, paramIndex?: number) => void; onCommandClear?: () => void; onProblemsChange?: (problems: FileProblem[]) => void; onCursorChange?: (line: number, column: number) => void; onDocTypeChange?: (docType: string) => void; projectDir?: string; onProjectTreeRefresh?: () => void }>(function Editor({ onSelectControl, onSidebarTab, selection, alignAction, onAlignDone, onMultiSelectChange, openProjectFiles, onOpenTabsChange, onActiveTabChange, onCommandClick, onCommandClear, onProblemsChange, onCursorChange, onDocTypeChange, projectDir, onProjectTreeRefresh }, ref) {
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [eycFallbackTabs, setEycFallbackTabs] = useState<Record<string, true>>({})
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const eycEditorRef = useRef<EycTableEditorHandle | null>(null)
  const [windowUnits, setWindowUnits] = useState<LibWindowUnit[]>([])
  const pendingNavigateRef = useRef<{ subName: string; params: Array<{ name: string; dataType: string; isByRef: boolean }> } | null>(null)

  const buildEventSubName = useCallback((targetName: string, eventName: string): string => {
    const normalized = targetName.replace(/^_+/, '')
    return `_${normalized}_${eventName}`
  }, [])

  // 统一计算标签页的实际保存内容（efw 使用 formData 序列化结果）
  const getTabPersistContent = (tab: EditorTab): string => {
    if (tab.language === 'efw' && tab.formData) {
      return JSON.stringify(tab.formData, null, 2)
    }
    return tab.value
  }

  const getTabSaveContent = (tab: EditorTab): string => {
    if (tab.language === 'eyc' || tab.language === 'egv') return eycToYiFormat(tab.value)
    return getTabPersistContent(tab)
  }

  const normalizeIncomingTab = (tab: EditorTab): EditorTab => {
    if (tab.language !== 'eyc' && tab.language !== 'egv') return tab
    return {
      ...tab,
      value: eycToInternalFormat(tab.value),
      savedValue: eycToInternalFormat(tab.savedValue),
    }
  }

  const isTabModified = (tab: EditorTab): boolean => getTabPersistContent(tab) !== tab.savedValue

  // 保存当前文件
  const saveCurrentFile = useCallback(() => {
    setTabs(prev => {
      const tab = prev.find(t => t.id === activeTabId)
      if (!tab || !tab.filePath) return prev
      const content = getTabSaveContent(tab)
      window.api?.file?.save(tab.filePath, content)
      return prev.map(t => t.id === activeTabId ? { ...t, savedValue: getTabPersistContent(t) } : t)
    })
  }, [activeTabId])

  // 保存所有文件
  const saveAllFiles = useCallback(() => {
    setTabs(prev =>
      prev.map(t => {
        if (t.filePath && isTabModified(t)) {
          const content = getTabSaveContent(t)
          window.api?.file?.save(t.filePath, content)
          return { ...t, savedValue: getTabPersistContent(t) }
        }
        return t
      })
    )
  }, [])

  // 统一关闭标签逻辑：有改动时先提示保存（保存/不保存/取消）
  const closeTabWithPrompt = useCallback(async (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId)
    if (!tab) return

    if (isTabModified(tab)) {
      const action = await window.api?.dialog?.confirmSaveBeforeClose(tab.label)
      if (action === 'cancel') return
      if (action === 'save' && tab.filePath) {
        const content = getTabSaveContent(tab)
        await window.api?.file?.save(tab.filePath, content)
      }
    }

    setTabs(prev => {
      const closingTab = prev.find(t => t.id === tabId)
      const updatedPrev = (closingTab && isTabModified(closingTab))
        ? prev.map(t => {
          if (t.id !== tabId) return t
          return { ...t, savedValue: getTabPersistContent(t) }
        })
        : prev

      const newTabs = updatedPrev.filter(t => t.id !== tabId)
      if (newTabs.length === 0) {
        setActiveTabId(null)
      } else if (activeTabId === tabId) {
        const idx = updatedPrev.findIndex(t => t.id === tabId)
        const newActive = newTabs[Math.min(idx, newTabs.length - 1)]
        setActiveTabId(newActive.id)
      }
      onOpenTabsChange?.(newTabs)
      setEycFallbackTabs(prevFallback => {
        if (!prevFallback[tabId]) return prevFallback
        const next = { ...prevFallback }
        delete next[tabId]
        return next
      })
      return newTabs
    })
  }, [tabs, activeTabId, onOpenTabsChange])

  // 关闭当前标签页
  const closeActiveFile = useCallback(() => {
    if (!activeTabId) return
    void closeTabWithPrompt(activeTabId)
  }, [activeTabId, closeTabWithPrompt])

  // 清空全部标签（用于关闭项目）
  const clearAllTabs = useCallback(() => {
    setTabs([])
    setActiveTabId(null)
    onOpenTabsChange?.([])
  }, [onOpenTabsChange])

  // 磁盘级重命名：更新项目中未打开的 .eyc 文件
  // 磁盘级重命名：更新项目中未打开的 .eyc 文件（仅控件改名使用）
  const renameDiskFiles = useCallback(async (openFilePaths: Set<string>, pattern: string, replacement: string) => {
    if (!projectDir) return
    const dirFiles = await window.api?.file?.readDir(projectDir)
    if (!dirFiles) return
    const eycFiles = (dirFiles as string[]).filter(f => f.toLowerCase().endsWith('.eyc'))
    for (const fileName of eycFiles) {
      const filePath = projectDir + '\\' + fileName
      if (openFilePaths.has(filePath)) continue // 已在标签页中修改过
      const content = await window.api?.project?.readFile(filePath)
      if (!content || !content.includes(pattern)) continue
      const newContent = content.split(pattern).join(replacement)
      await window.api?.file?.save(filePath, newContent)
    }
  }, [projectDir])

  // 窗口重命名：更新 .eyc 内容中所有引用模式
  const applyWindowRenameToContent = (content: string, oldName: string, newName: string): string => {
    let result = content
    // 程序集名：窗口程序集_旧名 → 窗口程序集_新名
    result = result.split('窗口程序集_' + oldName).join('窗口程序集_' + newName)
    // 事件引用：_旧名_ → _新名_
    result = result.split('_' + oldName + '_').join('_' + newName + '_')
    // 跨窗口引用：旧名.控件名.属性 或 旧名._事件
    result = result.split(oldName + '.').join(newName + '.')
    return result
  }

  // 属性面板修改属性值 → 更新 formData 和 selection
  const updateFormProperty = useCallback((targetKind: 'form' | 'control', controlId: string | null, propName: string, value: string | number | boolean) => {
    setTabs(prev => {
      const tab = prev.find(t => t.id === activeTabId)
      if (!tab || !tab.formData) return prev
      const form = tab.formData

      let newForm: DesignForm
      let updatedTabs = prev

      if (targetKind === 'form') {
        if (propName === '__name__') {
          const oldName = form.name
          const newName = String(value)
          const newSourceFile = newName + '.eyc'
          newForm = { ...form, name: newName, sourceFile: newSourceFile }

          // 计算新旧文件路径
          const oldEfwPath = tab.filePath
          const efwDir = oldEfwPath ? oldEfwPath.replace(/[/\\][^/\\]+$/, '') : projectDir
          const newEfwPath = efwDir ? efwDir + '\\' + newName + '.efw' : undefined
          const oldEycPath = efwDir
            ? efwDir + '\\' + (form.sourceFile || oldName + '.eyc')
            : undefined
          const newEycPath = efwDir ? efwDir + '\\' + newName + '.eyc' : undefined

          // 更新所有 .eyc 标签页中的内容引用
          const openEycPaths: string[] = []
          updatedTabs = prev.map(t => {
            if (t.language === 'eyc') {
              if (t.filePath) openEycPaths.push(t.filePath)
              if (t.value.includes(oldName)) {
                let newValue = applyWindowRenameToContent(t.value, oldName, newName)
                // 若是当前窗口关联的 .eyc 标签页，同时更新路径
                if (oldEycPath && t.filePath === oldEycPath && newEycPath) {
                  return { ...t, id: newEycPath, label: newName + '.eyc', filePath: newEycPath, value: newValue }
                }
                return { ...t, value: newValue }
              }
              // 即使内容没变，也要更新路径（当前窗口关联的 .eyc）
              if (oldEycPath && t.filePath === oldEycPath && newEycPath) {
                return { ...t, id: newEycPath, label: newName + '.eyc', filePath: newEycPath }
              }
            }
            return t
          })

          // 更新当前 .efw 标签页的路径和标签
          if (newEfwPath) {
            updatedTabs = updatedTabs.map(t =>
              t.id === activeTabId
                ? { ...t, id: newEfwPath, label: newName + '.efw', filePath: newEfwPath, formData: newForm }
                : t
            )
            // 更新 activeTabId（异步，在 setTabs 后执行）
            setTimeout(() => setActiveTabId(newEfwPath), 0)
          }

          // 异步：磁盘文件重命名 + 更新未打开的 .eyc + 更新 .epp + 刷新项目树
          if (projectDir) {
            // 通知标签变化以保存新路径
            setTimeout(() => onOpenTabsChange?.(updatedTabs), 0)
            ;(async () => {
              await window.api?.project?.renameWindow(projectDir, oldName, newName, openEycPaths)
              onProjectTreeRefresh?.()
            })()
          }
        } else {
          const fieldMap: Record<string, string> = { '宽度': 'width', '高度': 'height', '标题': 'title' }
          const field = fieldMap[propName]
          if (field) {
            newForm = { ...form, [field]: value }
          } else {
            // 其他属性（如逻辑型、枚举型等）存入 properties
            newForm = { ...form, properties: { ...form.properties, [propName]: value } }
          }
        }
        onSelectControl?.({ kind: 'form', form: newForm })
      } else {
        const fieldMap: Record<string, string> = {
          '左边': 'left',
          '顶边': 'top',
          '宽度': 'width',
          '高度': 'height',
          '标题': 'text',
          '内容': 'text',
          '文本': 'text',
        }
        const boolMap: Record<string, { field: string; invert?: boolean }> = {
          '可视': { field: 'visible' },
          '禁止': { field: 'enabled', invert: true },
        }
        const field = fieldMap[propName]
        const boolDef = boolMap[propName]
        newForm = {
          ...form,
          controls: form.controls.map(c => {
            if (c.id !== controlId) return c
            if (propName === '__name__') {
              return { ...c, name: String(value) }
            }
            if (field) {
              return { ...c, [field]: value }
            }
            if (boolDef) {
              return { ...c, [boolDef.field]: boolDef.invert ? !value : value }
            }
            return { ...c, properties: { ...c.properties, [propName]: value } }
          })
        }
        // 控件改名：更新 .eyc 标签页中的引用
        if (propName === '__name__') {
          const oldCtrl = form.controls.find(c => c.id === controlId)
          if (oldCtrl) {
            const oldName = oldCtrl.name
            const newName = String(value)
            const openEycPaths = new Set<string>()
            updatedTabs = prev.map(t => {
              if (t.language === 'eyc') {
                if (t.filePath) openEycPaths.add(t.filePath)
                if (t.value.includes(oldName)) {
                  const newValue = t.value.split(oldName + '_').join(newName + '_')
                  return { ...t, value: newValue }
                }
              }
              return t
            })
            // 异步更新磁盘上未打开的 .eyc 文件
            renameDiskFiles(openEycPaths, oldName + '_', newName + '_')
          }
        }
        const updatedCtrl = newForm.controls.find(c => c.id === controlId)
        if (updatedCtrl) onSelectControl?.({ kind: 'control', control: updatedCtrl, form: newForm })
      }

      // 对窗口改名的情况，formData 已在上面处理过，不再覆盖
      if (targetKind === 'form' && propName === '__name__') {
        return updatedTabs
      }
      return updatedTabs.map(t => t.id === activeTabId ? { ...t, formData: newForm } : t)
    })
  }, [activeTabId, onSelectControl, renameDiskFiles, projectDir, onProjectTreeRefresh, onOpenTabsChange])

  // 属性面板事件栏 → 跳转到或创建指定事件的子程序
  const navigateToEventSub = useCallback(async (
    sel: SelectionTarget,
    eventName: string,
    eventArgs: Array<{ name: string; description: string; dataType: string; isByRef: boolean }>
  ) => {
    if (!sel) return
    const form = sel.form
    const efwTab = tabs.find(t => t.language === 'efw' && t.formData?.name === form.name)
    if (!efwTab || !efwTab.filePath) return
    const efwDir = efwTab.filePath.replace(/[/\\][^/\\]+$/, '')
    const eycPath = form.sourceFile
      ? efwDir + '\\' + form.sourceFile
      : efwTab.filePath.replace(/\.efw$/i, '.eyc')
    let subName: string
    if (sel.kind === 'form') {
      subName = `_${form.name}_${eventName}`
    } else {
      subName = buildEventSubName(sel.control.name, eventName)
    }
    const params = eventArgs.map(arg => ({
      name: arg.name || 'param',
      dataType: arg.dataType || '整数型',
      isByRef: arg.isByRef ?? false,
    }))
    const existingTab = tabs.find(t => t.filePath === eycPath)
    if (existingTab) {
      if (existingTab.id === activeTabId) {
        eycEditorRef.current?.navigateOrCreateSub(subName, params)
      } else {
        pendingNavigateRef.current = { subName, params }
        setActiveTabId(existingTab.id)
      }
    } else {
      const content = await window.api?.project?.readFile(eycPath)
      if (content === null || content === undefined) return
      const fileName = eycPath.split(/[\\/]/).pop() || ''
      const newTab: EditorTab = {
        id: eycPath, label: fileName, language: 'eyc',
        value: content, savedValue: content, filePath: eycPath,
      }
      setTabs(prev => {
        const merged = [...prev, newTab]
        onOpenTabsChange?.(merged)
        return merged
      })
      pendingNavigateRef.current = { subName, params }
      setActiveTabId(eycPath)
    }
  }, [tabs, activeTabId, buildEventSubName, onOpenTabsChange])

  // 暴露给父组件的方法
  useImperativeHandle(ref, () => ({
    save: saveCurrentFile,
    saveAll: saveAllFiles,
    closeActiveTab: closeActiveFile,
    clearAllTabs,
    hasModifiedTabs: () => tabs.some(t => isTabModified(t)),
    editorAction: (action: string) => {
      const active = tabs.find(t => t.id === activeTabId)
      if (active?.language === 'eyc') {
        eycEditorRef.current?.editorAction(action)
        return
      }
      const ed = editorRef.current
      if (!ed) return
      switch (action) {
        case 'undo': ed.trigger('menu', 'undo', null); break
        case 'redo': ed.trigger('menu', 'redo', null); break
        case 'cut': ed.trigger('menu', 'editor.action.clipboardCutAction', null); break
        case 'copy': ed.trigger('menu', 'editor.action.clipboardCopyAction', null); break
        case 'paste': ed.trigger('menu', 'editor.action.clipboardPasteAction', null); break
        case 'delete': ed.trigger('menu', 'deleteRight', null); break
        case 'selectAll': ed.trigger('menu', 'editor.action.selectAll', null); break
        case 'find': ed.trigger('menu', 'actions.find', null); break
        case 'replace': ed.trigger('menu', 'editor.action.startFindReplaceAction', null); break
      }
    },
    getEditorFiles: () => {
      const files: Record<string, string> = {}
      for (const t of tabs) {
        const fileName = t.filePath?.replace(/^.*[\\/]/, '') || t.label
        if (t.language === 'efw' && t.formData) {
          files[fileName] = JSON.stringify(t.formData, null, 2)
        } else if (t.language === 'eyc' || t.language === 'egv') {
          files[fileName] = eycToYiFormat(t.value)
        } else {
          files[fileName] = t.value
        }
      }
      return files
    },
    openFile: (tab: EditorTab) => {
      const incoming = normalizeIncomingTab(tab)
      setTabs(prev => {
        if (prev.some(t => t.id === incoming.id)) {
          setActiveTabId(incoming.id)
          return prev
        }
        const merged = [...prev, incoming]
        onOpenTabsChange?.(merged)
        setActiveTabId(incoming.id)
        return merged
      })
      if (incoming.language === 'efw') onSidebarTab?.('property')
    },
    insertDeclaration: () => {
      eycEditorRef.current?.insertSubroutine()
    },
    insertLocalVariable: () => {
      eycEditorRef.current?.insertLocalVariable()
    },
    navigateToLine: (line: number) => {
      eycEditorRef.current?.navigateToLine(line)
    },
    updateFormProperty,
    navigateToEventSub,
  }), [saveCurrentFile, saveAllFiles, closeActiveFile, clearAllTabs, tabs, activeTabId, onOpenTabsChange, onSidebarTab, updateFormProperty, navigateToEventSub])

  // 接收外部打开的项目文件
  useEffect(() => {
    if (openProjectFiles && openProjectFiles.length > 0) {
      const normalizedIncoming = openProjectFiles.map(normalizeIncomingTab)
      setTabs(prev => {
        const existingIds = new Set(prev.map(t => t.id))
        const newTabs = normalizedIncoming.filter(t => !existingIds.has(t.id))
        const merged = [...prev, ...newTabs]
        onOpenTabsChange?.(merged)
        return merged
      })
      // 激活第一个新文件
      setActiveTabId(normalizedIncoming[0].id)
      if (normalizedIncoming[0].language === 'efw') {
        onSidebarTab?.('property')
      }
    }
  }, [openProjectFiles])

  // 从支持库加载窗口组件信息，并在支持库加载后刷新
  const loadWindowUnits = useCallback(() => {
    window.api.library.getWindowUnits().then(setWindowUnits).catch(() => {})
  }, [])

  useEffect(() => {
    loadWindowUnits()
    window.api.on('library:loaded', loadWindowUnits)
    return () => { window.api.off('library:loaded') }
  }, [loadWindowUnits])

  useEffect(() => {
    onActiveTabChange?.(activeTabId)
    const activeTab = tabs.find(t => t.id === activeTabId)
    if (activeTab) {
      const langMap: Record<string, string> = { eyc: '易语言源码', egv: '全局变量', efw: '窗口设计', typescript: 'TypeScript', javascript: 'JavaScript', html: 'HTML', css: 'CSS', json: 'JSON', python: 'Python', plaintext: '纯文本' }
      onDocTypeChange?.(langMap[activeTab.language] || activeTab.language)
    } else {
      onDocTypeChange?.('')
    }
  }, [activeTabId])

  // 双击可视化设计器控件 → 跳转到 .eyc 文件并定位/创建事件子程序
  const handleControlDblClick = useCallback(async (ctrl: DesignControl, defaultEvent: LibUnitEvent | null) => {
    const activeT = tabs.find(t => t.id === activeTabId)
    if (!activeT || activeT.language !== 'efw' || !activeT.filePath) return

    // 优先使用 .efw 中定义的 sourceFile，否则回退到文件名替换
    const efwDir = activeT.filePath.replace(/[/\\][^/\\]+$/, '')
    const sourceFileName = activeT.formData?.sourceFile
    const eycPath = sourceFileName
      ? efwDir + '\\' + sourceFileName
      : activeT.filePath.replace(/\.efw$/i, '.eyc')
    const eventName = defaultEvent?.name || '被单击'
    const subName = buildEventSubName(ctrl.name, eventName)
    const params = (defaultEvent?.args || []).map(arg => ({
      name: arg.name || 'param',
      dataType: arg.dataType || '整数型',
      isByRef: arg.isByRef ?? false,
    }))

    const existingTab = tabs.find(t => t.filePath === eycPath)
    if (existingTab) {
      if (existingTab.id === activeTabId) {
        // 已在该标签页上，直接导航
        eycEditorRef.current?.navigateOrCreateSub(subName, params)
      } else {
        onSidebarTab?.('project')
        pendingNavigateRef.current = { subName, params }
        setActiveTabId(existingTab.id)
      }
    } else {
      // 读取并打开 .eyc 文件
      const content = await window.api?.project?.readFile(eycPath)
      if (content === null || content === undefined) return
      const fileName = eycPath.split(/[\\/]/).pop() || ''
      const newTab: EditorTab = {
        id: eycPath, label: fileName, language: 'eyc',
        value: content, savedValue: content, filePath: eycPath,
      }
      setTabs(prev => {
        const merged = [...prev, newTab]
        onOpenTabsChange?.(merged)
        return merged
      })
      onSidebarTab?.('project')
      pendingNavigateRef.current = { subName, params }
      setActiveTabId(eycPath)
    }
  }, [tabs, activeTabId, onOpenTabsChange, buildEventSubName, onSidebarTab])

  // 双击可视化设计器窗口 → 跳转到 .eyc 文件并定位/创建窗口默认事件子程序
  const handleFormDblClick = useCallback(async (formData: DesignForm, defaultEvent: LibUnitEvent | null) => {
    const activeT = tabs.find(t => t.id === activeTabId)
    if (!activeT || activeT.language !== 'efw' || !activeT.filePath) return

    const efwDir = activeT.filePath.replace(/[/\\][^/\\]+$/, '')
    const sourceFileName = activeT.formData?.sourceFile
    const eycPath = sourceFileName
      ? efwDir + '\\' + sourceFileName
      : activeT.filePath.replace(/\.efw$/i, '.eyc')
    const eventName = defaultEvent?.name || '被创建完毕'
    const subName = `_${formData.name}_${eventName}`
    const params = (defaultEvent?.args || []).map(arg => ({
      name: arg.name || 'param',
      dataType: arg.dataType || '整数型',
      isByRef: arg.isByRef ?? false,
    }))

    const existingTab = tabs.find(t => t.filePath === eycPath)
    if (existingTab) {
      if (existingTab.id === activeTabId) {
        eycEditorRef.current?.navigateOrCreateSub(subName, params)
      } else {
        pendingNavigateRef.current = { subName, params }
        setActiveTabId(existingTab.id)
      }
    } else {
      const content = await window.api?.project?.readFile(eycPath)
      if (content === null || content === undefined) return
      const fileName = eycPath.split(/[\\/]/).pop() || ''
      const newTab: EditorTab = {
        id: eycPath, label: fileName, language: 'eyc',
        value: content, savedValue: content, filePath: eycPath,
      }
      setTabs(prev => {
        const merged = [...prev, newTab]
        onOpenTabsChange?.(merged)
        return merged
      })
      pendingNavigateRef.current = { subName, params }
      setActiveTabId(eycPath)
    }
  }, [tabs, activeTabId, onOpenTabsChange, buildEventSubName])

  // 标签切换后执行挂起的子程序导航
  useEffect(() => {
    if (!pendingNavigateRef.current) return
    const activeT = tabs.find(t => t.id === activeTabId)
    if (!activeT || activeT.language !== 'eyc') return
    const pending = pendingNavigateRef.current
    pendingNavigateRef.current = null
    setTimeout(() => {
      eycEditorRef.current?.navigateOrCreateSub(pending.subName, pending.params)
    }, 100)
  }, [activeTabId, tabs])

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0] || null

  const handleEditorMount: OnMount = useCallback((editorInstance, monaco) => {
    editorRef.current = editorInstance

    // 注册 Ctrl+S 保存
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      setTabs(prev =>
        prev.map(t => {
          if (t.id !== activeTabId) return t
          return { ...t, savedValue: getTabPersistContent(t) }
        })
      )
    })

    // 光标位置变化通知
    editorInstance.onDidChangeCursorPosition((e) => {
      onCursorChange?.(e.position.lineNumber, e.position.column)
    })

    // 编辑器获取焦点
    editorInstance.focus()
  }, [activeTabId, onCursorChange])

  const handleEditorChange: OnChange = useCallback((value) => {
    if (value === undefined) return
    setTabs(prev =>
      prev.map(t =>
        t.id === activeTabId ? { ...t, value } : t
      )
    )
  }, [activeTabId])

  // 直接接收 string 的 onChange（给 EycTableEditor 用）
  const handleEycChange = useCallback((value: string) => {
    setTabs(prev =>
      prev.map(t =>
        t.id === activeTabId ? { ...t, value } : t
      )
    )
  }, [activeTabId])

  // 可视化设计器 form 改变
  const handleFormChange = useCallback((form: DesignForm) => {
    setTabs(prev =>
      prev.map(t =>
        t.id === activeTabId ? { ...t, formData: form } : t
      )
    )
  }, [activeTabId])

  // 可视化设计器选中控件变化
  const handleSelectControl = useCallback((target: SelectionTarget) => {
    onSelectControl?.(target)
  }, [onSelectControl])

  const closeTab = useCallback((e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    void closeTabWithPrompt(tabId)
  }, [closeTabWithPrompt])

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId)
    const tab = tabs.find(t => t.id === tabId)
    if (tab?.language === 'efw') {
      onSidebarTab?.('property')
    }
    // 切换后聚焦编辑器
    setTimeout(() => editorRef.current?.focus(), 0)
  }, [tabs, onSidebarTab])

  const isModified = (tab: EditorTab) => isTabModified(tab)

  return (
    <div className="editor" role="main" aria-label="代码编辑器">
      {/* 编辑区 */}
      <div className="editor-content">
        {!activeTab ? (
          <div className="editor-empty">
            <div className="editor-empty-text">没有打开的文件</div>
            <div className="editor-empty-hint">通过 文件 → 新建项目 或 文件 → 打开项目 开始</div>
          </div>
        ) : activeTab.language === 'efw' && activeTab.formData ? (
          <VisualDesigner
            form={activeTab.formData}
            onChange={handleFormChange}
            onSelectControl={handleSelectControl}
            windowUnits={windowUnits}
            externalSelectedId={selection?.kind === 'form' ? '__form__' : selection?.kind === 'control' ? selection.control.id : undefined}
            alignAction={alignAction}
            onAlignDone={onAlignDone}
            onMultiSelectChange={onMultiSelectChange}
            onControlDoubleClick={handleControlDblClick}
            onFormDoubleClick={handleFormDblClick}
          />
        ) : (activeTab.language === 'eyc' || activeTab.language === 'egv') ? (
          eycFallbackTabs[activeTab.id] ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#2d2d2d', borderBottom: '1px solid #3a3a3a' }}>
                <span style={{ color: '#f2c97d', fontSize: 12 }}>表格模式异常，已临时切换到文本模式</span>
                <button
                  type="button"
                  style={{
                    padding: '2px 10px',
                    borderRadius: 4,
                    border: '1px solid #5a5a5a',
                    background: '#3a3a3a',
                    color: '#d4d4d4',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                  onClick={() => {
                    setEycFallbackTabs(prev => {
                      const next = { ...prev }
                      delete next[activeTab.id]
                      return next
                    })
                  }}
                >
                  重试表格模式
                </button>
              </div>
              <div style={{ flex: 1 }}>
                <MonacoEditor
                  key={activeTab.id}
                  language="eyc"
                  value={activeTab.value}
                  theme="ycide-dark"
                  onChange={handleEditorChange}
                  onMount={handleEditorMount}
                  beforeMount={(monaco) => {
                    registerEycLanguage(monaco)
                    monaco.editor.defineTheme('ycide-dark', {
                      base: 'vs-dark',
                      inherit: true,
                      rules: [
                        { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
                        { token: 'keyword', foreground: '569CD6', fontStyle: 'bold' },
                        { token: 'keyword.declaration', foreground: 'C586C0', fontStyle: 'bold' },
                        { token: 'string', foreground: 'CE9178' },
                        { token: 'number', foreground: 'B5CEA8' },
                        { token: 'number.float', foreground: 'B5CEA8' },
                        { token: 'type', foreground: '4EC9B0' },
                        { token: 'predefined', foreground: 'DCDCAA' },
                        { token: 'constant', foreground: '569CD6', fontStyle: 'bold' },
                        { token: 'identifier', foreground: '9CDCFE' },
                        { token: 'operator', foreground: 'D4D4D4' },
                        { token: 'delimiter.parenthesis', foreground: 'FFD700' },
                        { token: 'delimiter', foreground: 'D4D4D4' },
                      ],
                      colors: {
                        'editor.background': '#1e1e1e',
                        'editor.foreground': '#d4d4d4',
                        'editorLineNumber.foreground': '#858585',
                        'editorLineNumber.activeForeground': '#c6c6c6',
                        'editor.selectionBackground': '#264f78',
                        'editor.lineHighlightBackground': '#2a2d2e',
                        'editorCursor.foreground': '#aeafad',
                        'editor.findMatchBackground': '#515c6a',
                        'editor.findMatchHighlightBackground': '#ea5c0055',
                      },
                    })
                  }}
                  options={{
                    fontSize: 14,
                    fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace',
                    fontLigatures: true,
                    minimap: { enabled: true, scale: 1 },
                    scrollBeyondLastLine: false,
                    smoothScrolling: true,
                    cursorBlinking: 'smooth',
                    cursorSmoothCaretAnimation: 'on',
                    renderLineHighlight: 'all',
                    renderWhitespace: 'selection',
                    bracketPairColorization: { enabled: true },
                    autoIndent: 'full',
                    formatOnPaste: true,
                    wordWrap: 'off',
                    lineNumbers: 'on',
                    glyphMargin: true,
                    folding: true,
                    foldingStrategy: 'indentation',
                    links: true,
                    contextmenu: true,
                    mouseWheelZoom: true,
                    padding: { top: 8, bottom: 8 },
                    suggest: {
                      showKeywords: true,
                      showSnippets: true,
                      preview: true,
                    },
                    tabSize: 4,
                    insertSpaces: true,
                    automaticLayout: true,
                  }}
                  loading={
                    <div className="editor-loading">
                      <span>编辑器加载中...</span>
                    </div>
                  }
                />
              </div>
            </div>
          ) : (
            <EycEditorErrorBoundary
              tabId={activeTab.id}
              onError={(tabId, error, info) => {
                console.error('[Editor] EycTableEditor render failed, fallback to Monaco', { tabId, error, info })
                void window.api?.debug?.logRendererError({
                  source: 'EycEditorErrorBoundary',
                  message: error.message || 'EycTableEditor render failed',
                  stack: error.stack,
                  extra: {
                    tabId,
                    componentStack: info.componentStack,
                  },
                })
                setEycFallbackTabs(prev => ({ ...prev, [tabId]: true }))
              }}
            >
              <EycTableEditor
                ref={eycEditorRef}
                value={activeTab.value}
                onChange={handleEycChange}
                onCommandClick={onCommandClick}
                onCommandClear={onCommandClear}
                onProblemsChange={onProblemsChange}
                onCursorChange={onCursorChange}
              />
            </EycEditorErrorBoundary>
          )
        ) : (
          <MonacoEditor
          key={activeTab.id}
          language={activeTab.language}
          value={activeTab.value}
          theme="ycide-dark"
          onChange={handleEditorChange}
          onMount={handleEditorMount}
          beforeMount={(monaco) => {
            // 注册 eyc 易语言
            registerEycLanguage(monaco)

            // 注册自定义暗色主题
            monaco.editor.defineTheme('ycide-dark', {
              base: 'vs-dark',
              inherit: true,
              rules: [
                { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
                { token: 'keyword', foreground: '569CD6', fontStyle: 'bold' },
                { token: 'keyword.declaration', foreground: 'C586C0', fontStyle: 'bold' },
                { token: 'string', foreground: 'CE9178' },
                { token: 'number', foreground: 'B5CEA8' },
                { token: 'number.float', foreground: 'B5CEA8' },
                { token: 'type', foreground: '4EC9B0' },
                { token: 'predefined', foreground: 'DCDCAA' },
                { token: 'constant', foreground: '569CD6', fontStyle: 'bold' },
                { token: 'identifier', foreground: '9CDCFE' },
                { token: 'operator', foreground: 'D4D4D4' },
                { token: 'delimiter.parenthesis', foreground: 'FFD700' },
                { token: 'delimiter', foreground: 'D4D4D4' },
              ],
              colors: {
                'editor.background': '#1e1e1e',
                'editor.foreground': '#d4d4d4',
                'editorLineNumber.foreground': '#858585',
                'editorLineNumber.activeForeground': '#c6c6c6',
                'editor.selectionBackground': '#264f78',
                'editor.lineHighlightBackground': '#2a2d2e',
                'editorCursor.foreground': '#aeafad',
                'editor.findMatchBackground': '#515c6a',
                'editor.findMatchHighlightBackground': '#ea5c0055',
              },
            })
          }}
          options={{
            fontSize: 14,
            fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace',
            fontLigatures: true,
            minimap: { enabled: true, scale: 1 },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            renderLineHighlight: 'all',
            renderWhitespace: 'selection',
            bracketPairColorization: { enabled: true },
            autoIndent: 'full',
            formatOnPaste: true,
            wordWrap: 'off',
            lineNumbers: 'on',
            glyphMargin: true,
            folding: true,
            foldingStrategy: 'indentation',
            links: true,
            contextmenu: true,
            mouseWheelZoom: true,
            padding: { top: 8, bottom: 8 },
            suggest: {
              showKeywords: true,
              showSnippets: true,
              preview: true,
            },
            tabSize: 4,
            insertSpaces: true,
            automaticLayout: true,
          }}
          loading={
            <div className="editor-loading">
              <span>编辑器加载中...</span>
            </div>
          }
        />
        )}
      </div>

      {/* 标签页 */}
      <div className="editor-tabs" role="tablist" aria-label="打开的文件">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`editor-tab ${tab.id === activeTabId ? 'active' : ''}`}
            role="tab"
            aria-selected={tab.id === activeTabId}
            onClick={() => switchTab(tab.id)}
            title={tab.filePath || tab.label}
          >
            <span className="editor-tab-icon">
              {getFileIcon(tab.language)}
            </span>
            <span className="editor-tab-label">{tab.label}</span>
            {isModified(tab) && (
              <span className="editor-tab-modified" title="未保存更改">●</span>
            )}
            <span
              className="editor-tab-close"
              aria-label={`关闭 ${tab.label}`}
              onClick={(e) => closeTab(e, tab.id)}
            >×</span>
          </button>
        ))}
      </div>
    </div>
  )
})

/** 根据语言返回文件图标 */
function getFileIcon(language: string): ReactNode {
  const iconNameMap: Record<string, string> = {
    eyc: 'edit',
    eyw: 'windows-form',
  }
  const iconName = iconNameMap[language]
  if (iconName) return <Icon name={iconName} size={14} />
  const textIcons: Record<string, string> = {
    typescript: 'TS',
    javascript: 'JS',
    html: '◇',
    css: '#',
    json: '{}',
    python: 'Py',
    plaintext: '📄',
  }
  return textIcons[language] || '📄'
}

export default Editor
