type MonacoThemeMode = 'dark' | 'light'

type MonacoThemeRule = {
  token: string
  foreground: string
  fontStyle?: string
}

type MonacoThemeTokens = {
  rules: MonacoThemeRule[]
  colors: Record<string, string>
}

const DARK_DEFAULTS = {
  keyword: '#569CD6',
  string: '#CE9178',
  number: '#B5CEA8',
  comment: '#6A9955',
  predefined: '#DCDCAA',
  type: '#4EC9B0',
  identifier: '#9CDCFE',
  operator: '#D4D4D4',
  delimiter: '#FFD700',
  editorBackground: '#1e1e1e',
  editorForeground: '#d4d4d4',
  lineNumber: '#858585',
  lineNumberActive: '#c6c6c6',
  selection: '#264f78',
  lineHighlight: '#2a2d2e',
  cursor: '#aeafad',
  findMatch: '#515c6a',
  findMatchHighlight: '#ea5c0055',
}

const LIGHT_DEFAULTS = {
  keyword: '#0000FF',
  string: '#A31515',
  number: '#098658',
  comment: '#008000',
  predefined: '#795E26',
  type: '#267F99',
  identifier: '#001080',
  operator: '#333333',
  delimiter: '#6B4F00',
  editorBackground: '#ffffff',
  editorForeground: '#1f1f1f',
  lineNumber: '#8a8a8a',
  lineNumberActive: '#2f2f2f',
  selection: '#add6ff',
  lineHighlight: '#f7f7f7',
  cursor: '#000000',
  findMatch: '#f6d365',
  findMatchHighlight: '#ea5c0020',
}

function normalizeHex(value: string): string {
  return value.replace(/^#/, '').toUpperCase()
}

export function buildMonacoThemeTokens(mode: MonacoThemeMode, themeTokenValues: Record<string, string> = {}): MonacoThemeTokens {
  const defaults = mode === 'dark' ? DARK_DEFAULTS : LIGHT_DEFAULTS
  const keyword = themeTokenValues['--syntax-keyword'] || defaults.keyword
  const string = themeTokenValues['--syntax-string'] || defaults.string
  const number = themeTokenValues['--syntax-number'] || defaults.number
  const comment = themeTokenValues['--syntax-comment'] || defaults.comment
  const predefined = themeTokenValues['--syntax-predefined'] || themeTokenValues['--syntax-function'] || defaults.predefined
  const constant = themeTokenValues['--syntax-constant'] || number
  const type = themeTokenValues['--syntax-type'] || defaults.type
  const identifier = themeTokenValues['--syntax-identifier'] || themeTokenValues['--syntax-variable'] || defaults.identifier
  const operator = themeTokenValues['--syntax-operator'] || defaults.operator
  const delimiter = themeTokenValues['--syntax-delimiter'] || operator || defaults.delimiter

  return {
    rules: [
      { token: 'comment', foreground: normalizeHex(comment), fontStyle: 'italic' },
      { token: 'keyword', foreground: normalizeHex(keyword), fontStyle: 'bold' },
      { token: 'keyword.declaration', foreground: normalizeHex(keyword), fontStyle: 'bold' },
      { token: 'string', foreground: normalizeHex(string) },
      { token: 'number', foreground: normalizeHex(number) },
      { token: 'number.float', foreground: normalizeHex(number) },
      { token: 'type', foreground: normalizeHex(type) },
      { token: 'predefined', foreground: normalizeHex(predefined) },
      { token: 'constant', foreground: normalizeHex(constant), fontStyle: 'bold' },
      { token: 'identifier', foreground: normalizeHex(identifier) },
      { token: 'operator', foreground: normalizeHex(operator) },
      { token: 'delimiter.parenthesis', foreground: normalizeHex(delimiter) },
      { token: 'delimiter', foreground: normalizeHex(delimiter) },
    ],
    colors: {
      'editor.background': defaults.editorBackground,
      'editor.foreground': defaults.editorForeground,
      'editorLineNumber.foreground': defaults.lineNumber,
      'editorLineNumber.activeForeground': defaults.lineNumberActive,
      'editor.selectionBackground': defaults.selection,
      'editor.lineHighlightBackground': defaults.lineHighlight,
      'editorCursor.foreground': defaults.cursor,
      'editor.findMatchBackground': defaults.findMatch,
      'editor.findMatchHighlightBackground': defaults.findMatchHighlight,
    },
  }
}
