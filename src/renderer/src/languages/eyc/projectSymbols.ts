// ycide.lang-eyc 语言服务：项目级符号索引（设计稿 §6.2 eyc/symbols）。
// 全局变量、常量与资源名、DLL 命令、自定义数据类型、类与公开方法、窗口与控件、窗口组件。
// 优先用已打开标签页里的最新内容（含未保存修改），再读盘补齐未打开的文件。
// 由 Editor.tsx 中原样迁出（阶段 3），行为不变。

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { EditorTab } from '../../components/Editor/Editor'
import type { LibWindowUnit } from '../../components/Editor/VisualDesigner'
import { eycToYiFormat } from '../../components/Editor/eycFormat'
import { parseLines } from '../../components/Editor/eycBlocks'

export interface ProjectDllParam {
  name: string
  type: string
  description: string
  optional: boolean
  isVariable: boolean
  isArray: boolean
}

export interface ProjectDllCommand {
  name: string
  returnType: string
  description: string
  params: ProjectDllParam[]
  // .指针命令：通过函数地址间接调用，第一个参数固定为函数地址
  isIndirect?: boolean
}

/** 易语言源码类文档（表格编辑器打开的语言 ID） */
export function isEycSourceLanguage(language?: string): boolean {
  return language === 'eyc'
    || language === 'egv'
    || language === 'ecs'
    || language === 'edt'
    || language === 'ell'
    || language === 'erc'
}

export interface UseEycProjectSymbolsParams {
  projectDir?: string
  tabs: EditorTab[]
  /** 防抖后的标签页：声明类符号不随普通代码行输入变化，避免每次按键都全量重扫 */
  debouncedTabs: EditorTab[]
  activeTabId: string | null
  targetPlatform: string
}

export function useEycProjectSymbols({ projectDir, tabs, debouncedTabs, activeTabId, targetPlatform }: UseEycProjectSymbolsParams) {
  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0] || null

  const [projectGlobalVars, setProjectGlobalVars] = useState<Array<{ name: string; type: string }>>([])
  const [projectConstants, setProjectConstants] = useState<Array<{ name: string; value: string; kind?: 'constant' | 'resource' }>>([])
  const [projectDllCommands, setProjectDllCommands] = useState<ProjectDllCommand[]>([])
  const [projectDataTypes, setProjectDataTypes] = useState<Array<{ name: string; fields: Array<{ name: string; type: string }> }>>([])
  const [projectClassNames, setProjectClassNames] = useState<Array<{ name: string; methods?: Array<{ name: string; returnType: string; description: string; params: Array<{ name: string; type: string }> }> }>>([])
  const [windowUnits, setWindowUnits] = useState<LibWindowUnit[]>([])

  // 从支持库加载窗口组件信息，并在支持库加载后刷新
  const loadWindowUnits = useCallback(() => {
    window.api.library.getWindowUnits(targetPlatform).then(setWindowUnits).catch(() => {})
  }, [targetPlatform])

  useEffect(() => {
    loadWindowUnits()
    const dispose = window.api.on('library:loaded', loadWindowUnits)
    return () => { dispose() }
  }, [loadWindowUnits])


  // 收集项目内全局变量（.egv + 已打开标签页），用于 EYC 补全
  useEffect(() => {
    let cancelled = false

      const parseGlobalVars = (content: string, out: Map<string, string>) => {
      const re = /^\s*\.全局变量\s+([^,\s]+)(?:\s*,\s*([^,\s]+))?/gm
      let m: RegExpExecArray | null
      while ((m = re.exec(content)) !== null) {
        const name = (m[1] || '').trim()
        const type = (m[2] || '').trim()
        if (name && !out.has(name)) out.set(name, type)
      }
    }

    ;(async () => {
      if (!projectDir) {
        if (!cancelled) setProjectGlobalVars([])
        return
      }

      const vars = new Map<string, string>()

      // 优先使用已打开标签页中的最新内容（含未保存修改）
      for (const t of debouncedTabs) {
        if ((t.language === 'egv' || t.language === 'eyc' || t.language === 'ecs' || t.language === 'edt' || t.language === 'ell' || t.language === 'erc') && t.value) {
          parseGlobalVars(eycToYiFormat(t.value), vars)
        }
      }

      // 读取磁盘上的 .egv 文件，补齐未打开文件中的全局变量
      const openedPaths = new Set(tabs.filter(t => t.filePath).map(t => t.filePath!))
      const files = await window.api?.file?.readDir(projectDir)
      if (files) {
        for (const f of files as string[]) {
          if (!f.toLowerCase().endsWith('.egv')) continue
          const fp = projectDir + '\\' + f
          if (openedPaths.has(fp)) continue
          const content = await window.api?.project?.readFile(fp)
          if (content) parseGlobalVars(content, vars)
        }
      }

      if (!cancelled) {
        setProjectGlobalVars([...vars.entries()].map(([name, type]) => ({ name, type })))
      }
    })()

    return () => { cancelled = true }
  }, [projectDir, debouncedTabs])

  // 收集项目内 DLL 命令（.ell + 已打开标签页），用于 .eyc 代码补全
  useEffect(() => {
    let cancelled = false

    const splitCSV = (text: string): string[] => {
      const result: string[] = []
      let cur = ''
      let inQ = false
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (inQ) { cur += ch; if (ch === '"' || ch === '\u201d') inQ = false; continue }
        if (ch === '"' || ch === '\u201c') { inQ = true; cur += ch; continue }
        // \u884c\u5c3e\u88f8\u9017\u53f7\u4e5f\u89c6\u4e3a\u5206\u9694\u7b26\uff0c\u907f\u514d\u201c\u540d\u79f0,\u201d\u88ab\u5e76\u5165\u5b57\u6bb5
        if (ch === ',' && (i + 1 === text.length || text[i + 1] === ' ')) {
          result.push(cur)
          cur = ''
          i++
          continue
        }
        cur += ch
      }
      result.push(cur)
      return result
    }

    const unquote = (s: string): string => {
      if (!s) return ''
      if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('\u201c') && s.endsWith('\u201d'))) return s.slice(1, -1)
      return s
    }

    const parseDllCommands = (content: string, out: Map<string, ProjectDllCommand>) => {
      const lines = content.split('\n')
      let current: ProjectDllCommand | null = null

      for (const raw of lines) {
        const t = raw.replace(/[\r\t]/g, '').trim()
        if (!t || t.startsWith("'")) continue

        if (t.startsWith('.DLL命令 ')) {
          const fields = splitCSV(t.slice('.DLL命令 '.length))
          const name = (fields[0] || '').trim()
          if (!name) {
            current = null
            continue
          }
          if (!out.has(name)) {
            out.set(name, {
              name,
              returnType: (fields[1] || '').trim(),
              description: fields.length > 5 ? fields.slice(5).join(', ').trim() : '',
              params: [],
            })
          }
          current = out.get(name) || null
          continue
        }

        if (t.startsWith('.指针命令 ')) {
          const fields = splitCSV(t.slice('.指针命令 '.length))
          const name = (fields[0] || '').trim()
          if (!name) {
            current = null
            continue
          }
          if (!out.has(name)) {
            out.set(name, {
              name,
              returnType: (fields[1] || '').trim(),
              description: fields.length > 3 ? fields.slice(3).join(', ').trim() : '',
              params: [{
                name: '函数地址',
                type: '长整数型',
                description: '要调用的函数指针地址（如 指针到长整数 从函数表中读出的值）',
                optional: false,
                isVariable: false,
                isArray: false,
              }],
              isIndirect: true,
            })
          }
          current = out.get(name) || null
          continue
        }

        if (t.startsWith('.参数 ') || t.startsWith('    .参数 ')) {
          if (!current) continue
          const fields = splitCSV(t.replace(/^\s*\.参数\s+/, ''))
          const paramName = (fields[0] || '').trim()
          if (!paramName) continue
          const flags = (fields[2] || '').trim()
          current.params.push({
            name: paramName,
            type: (fields[1] || '').trim(),
            description: fields.length > 3 ? fields.slice(3).join(', ').trim() : '',
            optional: flags.includes('可空'),
            isVariable: flags.includes('传址'),
            isArray: flags.includes('数组'),
          })
          continue
        }

        // 命令参数区结束
        if (t.startsWith('.\u7248\u672C ')) continue
        if (t.startsWith('.')) current = null
      }
    }

    ;(async () => {
      if (!projectDir) {
        if (!cancelled) setProjectDllCommands([])
        return
      }

      const commands = new Map<string, ProjectDllCommand>()

      // 优先使用已打开标签页中的最新内容（含未保存修改）
      for (const t of debouncedTabs) {
        if ((t.language === 'ell' || t.language === 'eyc' || t.language === 'egv' || t.language === 'ecs' || t.language === 'edt' || t.language === 'erc') && t.value) {
          parseDllCommands(eycToYiFormat(t.value), commands)
        }
      }

      // 读取磁盘上的 .ell 文件，补齐未打开文件中的 DLL 命令
      const openedPaths = new Set(tabs.filter(t => t.filePath).map(t => t.filePath!))
      const files = await window.api?.file?.readDir(projectDir)
      if (files) {
        for (const f of files as string[]) {
          if (!f.toLowerCase().endsWith('.ell')) continue
          const fp = projectDir + '\\' + f
          if (openedPaths.has(fp)) continue
          const content = await window.api?.project?.readFile(fp)
          if (content) parseDllCommands(content, commands)
        }
      }

      if (!cancelled) {
        setProjectDllCommands([...commands.values()])
      }
    })()

    return () => { cancelled = true }
  }, [projectDir, debouncedTabs])

  // 收集项目内常量与资源名（.ecs/.erc + 已打开标签页），用于 #补全
  useEffect(() => {
    let cancelled = false

    const parseConstants = (content: string, out: Map<string, { value: string; kind: 'constant' | 'resource' }>) => {
      // 长文本常量同属常量，一并收集供 `#名称` 补全/着色（否则引用它会被当未定义标识符）
      const re = /^\s*\.(?:长文本)?常量\s+([^,\s]+)(?:\s*,\s*([^,\s]+))?/gm
      let m: RegExpExecArray | null
      while ((m = re.exec(content)) !== null) {
        const name = (m[1] || '').trim()
        const value = (m[2] || '').trim()
        if (name && !out.has(name)) out.set(name, { value, kind: 'constant' })
      }
    }

    const parseResources = (content: string, out: Map<string, { value: string; kind: 'constant' | 'resource' }>) => {
      const re = /^\s*\.资源\s+([^,\s]+)(?:\s*,\s*([^,\s]+))?/gm
      let m: RegExpExecArray | null
      while ((m = re.exec(content)) !== null) {
        const name = (m[1] || '').trim()
        const file = (m[2] || '').trim()
        if (name && !out.has(name)) out.set(name, { value: file, kind: 'resource' })
      }
    }

    ;(async () => {
      if (!projectDir) {
        if (!cancelled) setProjectConstants([])
        return
      }

      const constants = new Map<string, { value: string; kind: 'constant' | 'resource' }>()

      // 优先使用已打开标签页中的最新内容（含未保存修改）
      for (const t of debouncedTabs) {
        if ((t.language === 'ecs' || t.language === 'eyc' || t.language === 'egv' || t.language === 'erc') && t.value) {
          const yi = eycToYiFormat(t.value)
          parseConstants(yi, constants)
          parseResources(yi, constants)
        }
      }

      // 读取磁盘上的 .ecs/.erc 文件，补齐未打开文件中的常量与资源名
      const openedPaths = new Set(tabs.filter(t => t.filePath).map(t => t.filePath!))
      const files = await window.api?.file?.readDir(projectDir)
      if (files) {
        for (const f of files as string[]) {
          const lower = f.toLowerCase()
          if (!lower.endsWith('.ecs') && !lower.endsWith('.erc')) continue
          const fp = projectDir + '\\' + f
          if (openedPaths.has(fp)) continue
          const content = await window.api?.project?.readFile(fp)
          if (content) {
            parseConstants(content, constants)
            parseResources(content, constants)
          }
        }
      }

      if (!cancelled) {
        setProjectConstants([...constants.entries()].map(([name, info]) => ({ name, value: info.value, kind: info.kind })))
      }
    })()

    return () => { cancelled = true }
  }, [projectDir, debouncedTabs])

  // 收集项目内自定义数据类型（.edt + 已打开标签页），用于类型补全
  useEffect(() => {
    let cancelled = false

    const parseDataTypes = (
      content: string,
      out: Map<string, { name: string; fields: Array<{ name: string; type: string }> }>,
    ) => {
      const parsed = parseLines(content)
      let currentTypeName = ''
      for (const ln of parsed) {
        if (ln.type === 'dataType') {
          currentTypeName = (ln.fields[0] || '').trim()
          if (!currentTypeName) continue
          if (!out.has(currentTypeName)) {
            out.set(currentTypeName, { name: currentTypeName, fields: [] })
          }
          continue
        }
        if (ln.type === 'dataTypeMember') {
          if (!currentTypeName) continue
          const fieldName = (ln.fields[0] || '').trim()
          const fieldType = (ln.fields[1] || '').trim()
          if (!fieldName) continue
          const item = out.get(currentTypeName)
          if (!item) continue
          if (!item.fields.some(field => field.name === fieldName)) {
            item.fields.push({ name: fieldName, type: fieldType })
          }
          continue
        }
        if (ln.type !== 'blank' && ln.type !== 'comment') {
          currentTypeName = ''
        }
      }
    }

    ;(async () => {
      if (!projectDir) {
        if (!cancelled) setProjectDataTypes([])
        return
      }

      const dataTypeMap = new Map<string, { name: string; fields: Array<{ name: string; type: string }> }>()

      // 优先使用已打开标签页中的最新内容（含未保存修改）
      for (const t of debouncedTabs) {
        if ((t.language === 'edt' || t.language === 'eyc') && t.value) {
          parseDataTypes(eycToYiFormat(t.value), dataTypeMap)
        }
      }

      // 读取磁盘上的 .edt 文件，补齐未打开文件中的数据类型
      const openedPaths = new Set(tabs.filter(t => t.filePath).map(t => t.filePath!))
      const files = await window.api?.file?.readDir(projectDir)
      if (files) {
        for (const f of files as string[]) {
          if (!f.toLowerCase().endsWith('.edt')) continue
          const fp = projectDir + '\\' + f
          if (openedPaths.has(fp)) continue
          const content = await window.api?.project?.readFile(fp)
          if (content) parseDataTypes(content, dataTypeMap)
        }
      }

      if (!cancelled) {
        setProjectDataTypes([...dataTypeMap.values()])
      }
    })()

    return () => { cancelled = true }
  }, [projectDir, debouncedTabs])

  // 收集项目内类名与公开方法（.ecc + 已打开标签页），用于类模块继承补全与成员补全
  useEffect(() => {
    let cancelled = false

    type ClassMethodInfo = { name: string; returnType: string; description: string; params: Array<{ name: string; type: string }> }

    const parseClassModules = (content: string, out: Map<string, ClassMethodInfo[]>) => {
      const lines = content.replace(/\r\n/g, '\n').split('\n')
      let currentClass = ''
      let currentMethod: ClassMethodInfo | null = null
      for (const rawLine of lines) {
        const t = rawLine.replace(/[\r\t]/g, '').trim()
        const asmMatch = /^\.程序集\s+(.+)$/.exec(t)
        if (asmMatch) {
          currentClass = (asmMatch[1].split(/[,，]/)[0] || '').trim()
          if (currentClass && !out.has(currentClass)) out.set(currentClass, [])
          currentMethod = null
          continue
        }
        const subMatch = /^\.子程序\s+(.+)$/.exec(t)
        if (subMatch) {
          const fields = subMatch[1].split(/[,，]/).map(f => f.trim())
          const subName = fields[0] || ''
          const isPublic = (fields[2] || '').includes('公开')
          currentMethod = null
          if (subName && currentClass && isPublic) {
            currentMethod = { name: subName, returnType: fields[1] || '', description: fields[3] || '', params: [] }
            out.get(currentClass)!.push(currentMethod)
          }
          continue
        }
        const paramMatch = /^\.参数\s+(.+)$/.exec(t)
        if (paramMatch && currentMethod) {
          const fields = paramMatch[1].split(/[,，]/).map(f => f.trim())
          if (fields[0]) currentMethod.params.push({ name: fields[0], type: fields[1] || '' })
          continue
        }
        // 离开声明区（局部变量行不中断参数收集语境，但其后不会再有 .参数）
        if (t && !t.startsWith('.局部变量')) currentMethod = null
      }
    }

    ;(async () => {
      if (!projectDir) {
        if (!cancelled) setProjectClassNames([])
        return
      }

      const classMap = new Map<string, Array<{ name: string; returnType: string; description: string; params: Array<{ name: string; type: string }> }>>()

      // 优先使用已打开标签页中的最新内容（含未保存修改）
      // 注意：类模块标签页的 label 是类名（不带扩展名），必须按 filePath 判断
      for (const t of debouncedTabs) {
        const tabFileName = (t.filePath || t.label || '').toLowerCase()
        if (tabFileName.endsWith('.ecc') && t.value) {
          parseClassModules(eycToYiFormat(t.value), classMap)
        }
      }

      // 读取磁盘上的 .ecc 文件，补齐未打开文件中的类名
      const openedPaths = new Set(tabs.filter(t => t.filePath).map(t => t.filePath!))
      const files = await window.api?.file?.readDir(projectDir)
      if (files) {
        for (const f of files as string[]) {
          if (!f.toLowerCase().endsWith('.ecc')) continue
          const fp = projectDir + '\\' + f
          if (openedPaths.has(fp)) continue
          const content = await window.api?.project?.readFile(fp)
          if (content) parseClassModules(content, classMap)
        }
      }

      if (!cancelled) {
        setProjectClassNames([...classMap].map(([name, methods]) => ({ name, methods })))
      }
    })()

    return () => { cancelled = true }
  }, [projectDir, debouncedTabs])


  // 项目内所有窗口的控件表+子程序（读盘）：供「.eyc 代码打开但对应 .efw 未打开」时解析窗口成员，
  // 以及「在任意窗口代码里引用另一个窗口名」的跨窗口成员补全。
  type WinControlEntry = { name: string; controls: Array<{ name: string; type: string; properties?: Record<string, string | number | boolean> }>; subs: string[] }
  const [projectWindowControlsMap, setProjectWindowControlsMap] = useState<Map<string, WinControlEntry>>(new Map())
  const [projectWindows, setProjectWindows] = useState<WinControlEntry[]>([])
  useEffect(() => {
    if (!projectDir) { setProjectWindowControlsMap(new Map()); setProjectWindows([]); return }
    let cancelled = false
    ;(async () => {
      const map = new Map<string, WinControlEntry>()
      const list: WinControlEntry[] = []
      const files = await window.api?.file?.readDir(projectDir)
      if (files) {
        for (const f of files as string[]) {
          if (!f.toLowerCase().endsWith('.efw')) continue
          const content = await window.api?.project?.readFile(projectDir + '\\' + f)
          if (!content) continue
          try {
            const data = JSON.parse(content)
            const name = (data.name || data.formName || f.replace(/\.efw$/i, '')).trim()
            if (!name) continue
            const controls = (Array.isArray(data.controls) ? data.controls : [])
              .map((c: { name?: string; type?: string; properties?: Record<string, string | number | boolean> }) => ({ name: (c.name || '').trim(), type: (c.type || '').trim(), properties: c.properties }))
              .filter((c: { name: string }) => c.name)
            // 关联 .eyc 里提取子程序名（`.子程序 名, ...`）
            const eycName = (data.sourceFile || `${name}.eyc`)
            const subs: string[] = []
            const eycContent = await window.api?.project?.readFile(projectDir + '\\' + eycName)
            if (eycContent) {
              for (const rawLine of eycContent.split(/\r?\n/)) {
                const m = /^\s*\.子程序\s+([^,，\n]+)/.exec(rawLine)
                if (m) { const sn = m[1].trim(); if (sn) subs.push(sn) }
              }
            }
            const entry: WinControlEntry = { name, controls, subs }
            list.push(entry)
            map.set((data.sourceFile || `${name}.eyc`).toLowerCase(), entry)
            map.set(`${name}.eyc`.toLowerCase(), entry)  // 名字兜底
            map.set(f.toLowerCase().replace(/\.efw$/i, '.eyc'), entry)  // 文件名兜底
          } catch { /* 跳过无法解析的 .efw */ }
        }
      }
      if (!cancelled) { setProjectWindowControlsMap(map); setProjectWindows(list) }
    })()
    return () => { cancelled = true }
  }, [projectDir, debouncedTabs])

  const activeWindowControls = useMemo(() => {
    if (!activeTab) return [] as Array<{ name: string; type: string; properties?: Record<string, string | number | boolean> }>
    const isSourceTab = isEycSourceLanguage(activeTab.language)
    if (!isSourceTab) return [] as Array<{ name: string; type: string; properties?: Record<string, string | number | boolean> }>

    const sourceFileName = (activeTab.filePath?.split(/[\\/]/).pop() || activeTab.label).toLowerCase()

    const items: Array<{ name: string; type: string; properties?: Record<string, string | number | boolean> }> = []
    const seen = new Set<string>()
    const add = (name: string, type: string, properties?: Record<string, string | number | boolean>): void => {
      const n = (name || '').trim()
      const t = (type || '').trim()
      if (!n || seen.has(n)) return
      seen.add(n)
      items.push({ name: n, type: t, properties })
    }
    const buildFrom = (winName: string, controls: Array<{ name: string; type: string; properties?: Record<string, string | number | boolean> }>): typeof items => {
      add(winName, '窗口')
      for (const control of controls) add(control.name, control.type, control.properties)
      return items
    }

    // 1) 优先用已打开的 .efw 标签页（含未落盘的实时编辑）。
    const matchedFormTab = tabs.find(t => {
      if (t.language !== 'efw' || !t.formData) return false
      const linkedSource = (t.formData.sourceFile || `${t.formData.name}.eyc`).toLowerCase()
      return linkedSource === sourceFileName
    })
    if (matchedFormTab?.formData) {
      buildFrom(matchedFormTab.formData.name, matchedFormTab.formData.controls)
    } else {
      // 2) .efw 未打开：从读盘的项目窗口控件表按关联源文件名解析（用户即使不开设计器也能补全窗口成员）。
      const diskEntry = projectWindowControlsMap.get(sourceFileName)
      if (diskEntry) buildFrom(diskEntry.name, diskEntry.controls)
    }

    // 3) 多窗口：项目里其它窗口的窗名/控件名也是合法标识符（载入 (选题窗口, …)、跨窗控件访问）。
    // 本窗条目在前（add 按 seen 去重，重名时本窗类型优先）。
    for (const t of tabs) {
      if (t.language !== 'efw' || !t.formData) continue
      add(t.formData.name, '窗口')
      for (const c of t.formData.controls || []) add(c.name, c.type, c.properties)
    }
    for (const [, entry] of projectWindowControlsMap) {
      add(entry.name, '窗口')
      for (const c of entry.controls || []) add(c.name, c.type, c.properties)
    }

    return items
  }, [activeTab, tabs, projectWindowControlsMap])

  const activeWindowControlNames = useMemo(() => {
    return activeWindowControls.map(c => c.name)
  }, [activeWindowControls])


  return {
    projectGlobalVars,
    projectConstants,
    projectDllCommands,
    projectDataTypes,
    projectClassNames,
    projectWindows,
    activeWindowControls,
    activeWindowControlNames,
    windowUnits,
  }
}

export type EycProjectSymbols = ReturnType<typeof useEycProjectSymbols>
