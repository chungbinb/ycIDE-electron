export type DeclType =
  | 'assembly' | 'assemblyVar' | 'sub' | 'subParam' | 'localVar'
  | 'globalVar' | 'constant' | 'longConstant' | 'dataType' | 'dataTypeMember'
  | 'dll' | 'ptrCmd' | 'image' | 'sound' | 'resource'

export interface ParsedLine {
  type: DeclType | 'version' | 'supportLib' | 'blank' | 'comment' | 'code'
  raw: string
  fields: string[]
}

export interface RenderBlock {
  kind: 'table' | 'codeline'
  tableType?: string
  rows: TblRow[]
  codeLine?: string
  lineIndex: number
  isVirtual?: boolean
}

export interface TblRow {
  cells: CellData[]
  lineIndex: number
  isHeader?: boolean
}

export interface CellData {
  text: string
  cls: string
  colSpan?: number
  align?: string
  fieldIdx?: number
  sliceField?: boolean
  /** 长文本常量的值单元格：显示 `<文本长度: N>`，单击/双击弹多行文本编辑框而非行内编辑 */
  longText?: boolean
}
