import { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react'
import MonacoEditor, { OnMount, OnChange, type Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import EycTableEditor, { type EycTableEditorHandle, type FileProblem } from './EycTableEditor'
import VisualDesigner, { type DesignForm, type DesignControl, type SelectionTarget, type LibWindowUnit, type LibUnitEvent, type AlignAction } from './VisualDesigner'
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
    extensions: ['.eyc'],
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
  editorAction: (action: string) => void
  getEditorFiles: () => Record<string, string>
  openFile: (tab: EditorTab) => void
  insertDeclaration: () => void
  insertLocalVariable: () => void
  navigateToLine: (line: number) => void
}

const Editor = forwardRef<EditorHandle, { onSelectControl?: (target: SelectionTarget) => void; onSidebarTab?: (tab: 'project' | 'library' | 'property') => void; selection?: SelectionTarget; alignAction?: AlignAction; onAlignDone?: () => void; onMultiSelectChange?: (count: number) => void; openProjectFiles?: EditorTab[]; onOpenTabsChange?: (tabs: EditorTab[]) => void; onActiveTabChange?: (tabId: string | null) => void; onCommandClick?: (commandName: string, paramIndex?: number) => void; onCommandClear?: () => void; onProblemsChange?: (problems: FileProblem[]) => void; onCursorChange?: (line: number, column: number) => void; onDocTypeChange?: (docType: string) => void }>(function Editor({ onSelectControl, onSidebarTab, selection, alignAction, onAlignDone, onMultiSelectChange, openProjectFiles, onOpenTabsChange, onActiveTabChange, onCommandClick, onCommandClear, onProblemsChange, onCursorChange, onDocTypeChange }, ref) {
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const eycEditorRef = useRef<EycTableEditorHandle | null>(null)
  const [windowUnits, setWindowUnits] = useState<LibWindowUnit[]>([])
  const pendingNavigateRef = useRef<{ subName: string; params: Array<{ name: string; dataType: string; isByRef: boolean }> } | null>(null)

  // 保存当前文件
  const saveCurrentFile = useCallback(() => {
    setTabs(prev => {
      const tab = prev.find(t => t.id === activeTabId)
      if (!tab || !tab.filePath) return prev
      if (tab.language === 'efw' && tab.formData) {
        window.api?.file?.save(tab.filePath, JSON.stringify(tab.formData, null, 2))
      } else {
        window.api?.file?.save(tab.filePath, tab.value)
      }
      return prev.map(t => t.id === activeTabId ? { ...t, savedValue: t.value } : t)
    })
  }, [activeTabId])

  // 保存所有文件
  const saveAllFiles = useCallback(() => {
    setTabs(prev =>
      prev.map(t => {
        if (t.filePath && t.value !== t.savedValue) {
          if (t.language === 'efw' && t.formData) {
            window.api?.file?.save(t.filePath, JSON.stringify(t.formData, null, 2))
          } else {
            window.api?.file?.save(t.filePath, t.value)
          }
          return { ...t, savedValue: t.value }
        }
        return t
      })
    )
  }, [])

  // 关闭当前标签页
  const closeActiveFile = useCallback(() => {
    if (!activeTabId) return
    setTabs(prev => {
      const newTabs = prev.filter(t => t.id !== activeTabId)
      if (newTabs.length === 0) {
        setActiveTabId(null)
      } else {
        const idx = prev.findIndex(t => t.id === activeTabId)
        const newActive = newTabs[Math.min(idx, newTabs.length - 1)]
        setActiveTabId(newActive.id)
      }
      onOpenTabsChange?.(newTabs)
      return newTabs
    })
  }, [activeTabId, onOpenTabsChange])

  // 暴露给父组件的方法
  useImperativeHandle(ref, () => ({
    save: saveCurrentFile,
    saveAll: saveAllFiles,
    closeActiveTab: closeActiveFile,
    editorAction: (action: string) => {
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
        } else {
          files[fileName] = t.value
        }
      }
      return files
    },
    openFile: (tab: EditorTab) => {
      setTabs(prev => {
        if (prev.some(t => t.id === tab.id)) {
          setActiveTabId(tab.id)
          return prev
        }
        const merged = [...prev, tab]
        onOpenTabsChange?.(merged)
        setActiveTabId(tab.id)
        return merged
      })
      if (tab.language === 'efw') onSidebarTab?.('property')
    },
    insertDeclaration: () => {
      eycEditorRef.current?.insertSubroutine()
    },
    insertLocalVariable: () => {
      eycEditorRef.current?.insertLocalVariable()
    },
    navigateToLine: (line: number) => {
      eycEditorRef.current?.navigateToLine(line)
    }
  }), [saveCurrentFile, saveAllFiles, closeActiveFile, tabs, activeTabId, onOpenTabsChange, onSidebarTab])

  // 接收外部打开的项目文件
  useEffect(() => {
    if (openProjectFiles && openProjectFiles.length > 0) {
      setTabs(prev => {
        const existingIds = new Set(prev.map(t => t.id))
        const newTabs = openProjectFiles.filter(t => !existingIds.has(t.id))
        const merged = [...prev, ...newTabs]
        onOpenTabsChange?.(merged)
        return merged
      })
      // 激活第一个新文件
      setActiveTabId(openProjectFiles[0].id)
      if (openProjectFiles[0].language === 'efw') {
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
      const langMap: Record<string, string> = { eyc: '易语言源码', efw: '窗口设计', typescript: 'TypeScript', javascript: 'JavaScript', html: 'HTML', css: 'CSS', json: 'JSON', python: 'Python', plaintext: '纯文本' }
      onDocTypeChange?.(langMap[activeTab.language] || activeTab.language)
    } else {
      onDocTypeChange?.('')
    }
  }, [activeTabId])

  // 双击可视化设计器控件 → 跳转到 .eyc 文件并定位/创建事件子程序
  const handleControlDblClick = useCallback(async (ctrl: DesignControl, defaultEvent: LibUnitEvent | null) => {
    const activeT = tabs.find(t => t.id === activeTabId)
    if (!activeT || activeT.language !== 'efw' || !activeT.filePath) return

    const eycPath = activeT.filePath.replace(/\.efw$/i, '.eyc')
    const eventName = defaultEvent?.name || '被单击'
    const subName = ctrl.name + '_' + eventName
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
      pendingNavigateRef.current = { subName, params }
      setActiveTabId(eycPath)
    }
  }, [tabs, activeTabId, onOpenTabsChange])

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
        prev.map(t =>
          t.id === activeTabId ? { ...t, savedValue: t.value } : t
        )
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
    setTabs(prev => {
      const newTabs = prev.filter(t => t.id !== tabId)
      if (newTabs.length === 0) {
        setActiveTabId(null)
      } else if (activeTabId === tabId) {
        const idx = prev.findIndex(t => t.id === tabId)
        const newActive = newTabs[Math.min(idx, newTabs.length - 1)]
        setActiveTabId(newActive.id)
      }
      onOpenTabsChange?.(newTabs)
      return newTabs
    })
  }, [activeTabId, onOpenTabsChange])

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId)
    const tab = tabs.find(t => t.id === tabId)
    if (tab?.language === 'efw') {
      onSidebarTab?.('property')
    }
    // 切换后聚焦编辑器
    setTimeout(() => editorRef.current?.focus(), 0)
  }, [tabs, onSidebarTab])

  const isModified = (tab: EditorTab) => tab.value !== tab.savedValue

  return (
    <div className="editor" role="main" aria-label="代码编辑器">
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
          />
        ) : activeTab.language === 'eyc' ? (
          <EycTableEditor
            ref={eycEditorRef}
            value={activeTab.value}
            onChange={handleEycChange}
            onCommandClick={onCommandClick}
            onCommandClear={onCommandClear}
            onProblemsChange={onProblemsChange}
            onCursorChange={onCursorChange}
          />
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
    </div>
  )
})

/** 根据语言返回文件图标 */
function getFileIcon(language: string): React.ReactNode {
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
