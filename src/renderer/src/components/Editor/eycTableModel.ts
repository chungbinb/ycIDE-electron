export type DeclType =
  | 'assembly' | 'assemblyVar' | 'sub' | 'subParam' | 'localVar'
  | 'globalVar' | 'constant' | 'dataType' | 'dataTypeMember'
  | 'dll' | 'image' | 'sound' | 'resource'

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
}
