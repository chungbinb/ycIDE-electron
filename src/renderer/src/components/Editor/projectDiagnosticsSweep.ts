import { parseLines } from './eycBlocks'
import { FLOW_KW } from './eycFlow'
import { LOGIC_OPERATOR_ALIASES } from './editorCoreUtils'
import {
  buildControlPropTypes,
  buildEditorDiagnosticsProblems,
  type DiagCommandSignature,
  type EditorDiagnosticsProblem,
} from './editorDiagnosticsShared'

// ===== 编译前全项目诊断扫描 =====
// 点编译/运行时对项目全部源文件（含未打开的）跑一遍问题面板同款诊断：
// 有错误则拦截编译，并在输出面板按文件列出。上下文构造与 EycTableEditor
// 的诊断请求逐项对齐（validCommandNames/allKnownVarNames/reservedNames/
// commandSignatures/controlPropTypes），保证「打开该文件看到的问题」与
// 「编译拦截报的问题」一致。

export interface SweepCommandItem {
  name: string
  isMember?: boolean
  returnType?: string
  params?: Array<{ name: string; type: string; optional?: boolean; isArray?: boolean; repeatable?: boolean }>
}

export interface SweepWindowControl {
  name: string
  type: string
  properties?: Record<string, string | number | boolean>
}

export interface SweepUnit {
  name?: string
  properties?: Array<{ name?: string; typeName?: string; pickOptions?: string[]; defaultValue?: string | number | boolean }>
}

export function sweepFileDiagnostics(opts: {
  text: string
  catalogCommands: SweepCommandItem[]
  dllCommands: SweepCommandItem[]
  projectGlobalVarNames: string[]
  windowControls: SweepWindowControl[]
  windowUnits: SweepUnit[]
}): EditorDiagnosticsProblem[] {
  const { text, catalogCommands, dllCommands, projectGlobalVarNames, windowControls, windowUnits } = opts

  const parsed = parseLines(text)
  const subs = new Set<string>()
  const vars = new Set<string>()
  const ownDllNames = new Set<string>()
  for (const ln of parsed) {
    if (ln.type === 'sub' && ln.fields[0]) subs.add(ln.fields[0])
    if ((ln.type === 'localVar' || ln.type === 'subParam' || ln.type === 'assemblyVar' || ln.type === 'globalVar') && ln.fields[0]) vars.add(ln.fields[0])
    if ((ln.type === 'dll' || ln.type === 'ptrCmd') && ln.fields[0]) ownDllNames.add((ln.fields[0] || '').trim())
  }

  const allKnownVarNames = new Set<string>(vars)
  for (const n of projectGlobalVarNames) {
    const t = (n || '').trim()
    if (t) allKnownVarNames.add(t)
  }
  for (const c of windowControls) {
    const t = (c.name || '').trim()
    if (t) allKnownVarNames.add(t)
  }

  const validCommandNames = new Set<string>()
  const reservedNames = new Set<string>()
  const signatures: Record<string, DiagCommandSignature> = {}
  for (const k of FLOW_KW) {
    validCommandNames.add(k)
    reservedNames.add(k)
  }
  for (const c of [...catalogCommands, ...dllCommands]) {
    if (!c.name || c.isMember) continue
    validCommandNames.add(c.name)
    reservedNames.add(c.name)
    signatures[c.name] = {
      params: (c.params || []).map(p => ({ name: p.name, type: p.type, optional: p.optional, isArray: p.isArray, repeatable: p.repeatable })),
      returnType: c.returnType || '',
    }
  }
  for (const n of subs) validCommandNames.add(n)
  for (const n of ownDllNames) {
    if (n) validCommandNames.add(n)
  }
  for (const n of allKnownVarNames) validCommandNames.add(n)
  for (const a of LOGIC_OPERATOR_ALIASES) validCommandNames.add(a)

  return buildEditorDiagnosticsProblems({
    text,
    hasCommandCatalog: catalogCommands.length > 0,
    validCommandNames: Array.from(validCommandNames),
    allKnownVarNames: Array.from(allKnownVarNames),
    reservedNames: Array.from(reservedNames),
    commandSignatures: signatures,
    controlPropTypes: buildControlPropTypes(windowControls, windowUnits),
  })
}
