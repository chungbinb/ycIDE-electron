#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const abiSpecVersion = 'v1'
const abiContractRef = 'docs/krnln-abi-contract.md'

const root = process.cwd()
const cmdPath = resolve(root, 'lib/krnln/krnln.commands.ycmd.json')
const winImplPath = resolve(root, 'lib/krnln/impl/windows.cpp')
const outJsonPath = resolve(root, 'lib/krnln/generated/command-mapping.windows.json')
const outReportPath = resolve(root, 'docs/krnln-command-mapping-report.md')

function idToNativeSymbol(commandId) {
  const dot = commandId.indexOf('.')
  const suffix = dot >= 0 ? commandId.slice(dot + 1) : commandId
  return `krnln_${suffix.replace(/[^A-Za-z0-9_]/g, '_')}`
}

function riskOf(command) {
  const params = command.params || []
  const allTypes = [command.returnType || '', ...params.map((p) => p.type || '')].join('|')
  const high = /(通用型|数组|对象|窗口|菜单|子程序指针|字节集)/.test(allTypes)
  const medium = /(文本型|日期时间型)/.test(allTypes)
  if (high) return 'high'
  if (medium) return 'medium'
  return 'low'
}

function parseSymbols(source) {
  const begin = '// --- AUTO-GENERATED KRLN STUBS BEGIN ---'
  const end = '// --- AUTO-GENERATED KRLN STUBS END ---'
  const blockRe = new RegExp(`${begin}[\\s\\S]*?${end}`, 'm')
  const stubBlock = (source.match(blockRe) || [''])[0]
  const nonStubSource = source.replace(blockRe, '')

  const symbolRe = /extern\s+"C"\s+[^\n]*\s+(krnln_[A-Za-z0-9_]+)\s*\(/g
  const fnHeadRe = /extern\s+"C"\s+[^\n]*\s+(krnln_[A-Za-z0-9_]+)\s*\([^)]*\)\s*\{/g

  const parseFunctionBodies = (text) => {
    const result = []
    let m
    while ((m = fnHeadRe.exec(text)) !== null) {
      const symbol = m[1]
      const head = m[0]
      const braceOpen = m.index + head.lastIndexOf('{')
      let depth = 1
      let i = braceOpen + 1
      for (; i < text.length; i += 1) {
        const ch = text[i]
        if (ch === '{') {
          depth += 1
        } else if (ch === '}') {
          depth -= 1
          if (depth === 0) break
        }
      }
      if (depth !== 0) continue
      const body = text.slice(braceOpen + 1, i)
      result.push({ symbol, body })
    }
    return result
  }

  const isTrivialStubBody = (body) => {
    const normalized = body
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/.*$/gm, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!normalized) return true
    if (/^return\s+0\s*;$/i.test(normalized)) return true
    if (/^return\s+0\.0f?\s*;$/i.test(normalized)) return true
    if (/^return\s+""\s*;$/i.test(normalized)) return true
    if (/^return\s*;$/i.test(normalized)) return true
    return false
  }

  const all = new Set()
  const implemented = new Set()
  const stubbed = new Set()

  let m
  while ((m = symbolRe.exec(source)) !== null) all.add(m[1])
  while ((m = symbolRe.exec(nonStubSource)) !== null) implemented.add(m[1])

  for (const fn of parseFunctionBodies(stubBlock)) {
    const symbol = fn.symbol
    const body = fn.body || ''
    if (isTrivialStubBody(body)) {
      stubbed.add(symbol)
    } else {
      implemented.add(symbol)
    }
  }

  return { all, implemented, stubbed }
}

function groupCount(items, field) {
  const map = new Map()
  for (const item of items) {
    const key = item[field]
    map.set(key, (map.get(key) || 0) + 1)
  }
  return Object.fromEntries([...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}

const commandJson = JSON.parse(readFileSync(cmdPath, 'utf-8'))
const commands = commandJson.commands || []
const source = readFileSync(winImplPath, 'utf-8')
const symbols = parseSymbols(source)

const dupCommandIds = []
const seenCommandIds = new Set()
for (const cmd of commands) {
  if (!cmd.commandId) continue
  if (seenCommandIds.has(cmd.commandId)) dupCommandIds.push(cmd.commandId)
  seenCommandIds.add(cmd.commandId)
}

const mapping = []
for (const cmd of commands) {
  if (!cmd.commandId) continue
  const nativeSymbol = idToNativeSymbol(cmd.commandId)
  const item = {
    commandId: cmd.commandId,
    displayName: cmd.displayName || '',
    nativeSymbol,
    returnType: cmd.returnType || 'unknown',
    params: cmd.params || [],
    abiSpecVersion,
    abiContractRef: riskOf(cmd) === 'high' ? abiContractRef : '',
    abiRisk: riskOf(cmd),
    declared: symbols.all.has(nativeSymbol),
    implemented: symbols.implemented.has(nativeSymbol),
    stubbed: symbols.stubbed.has(nativeSymbol)
  }
  mapping.push(item)
}

const dupSymbols = []
const symbolToCommand = new Map()
for (const item of mapping) {
  const prev = symbolToCommand.get(item.nativeSymbol)
  if (prev && prev !== item.commandId) dupSymbols.push(`${item.nativeSymbol}: ${prev}, ${item.commandId}`)
  symbolToCommand.set(item.nativeSymbol, item.commandId)
}

const summary = {
  totalCommands: mapping.length,
  declared: mapping.filter((x) => x.declared).length,
  implemented: mapping.filter((x) => x.implemented).length,
  stubbed: mapping.filter((x) => x.stubbed).length,
  undeclared: mapping.filter((x) => !x.declared).length,
  abiRisk: groupCount(mapping, 'abiRisk'),
  returnType: groupCount(mapping, 'returnType'),
  duplicateCommandIds: dupCommandIds,
  duplicateNativeSymbols: dupSymbols
}

mkdirSync(dirname(outJsonPath), { recursive: true })
mkdirSync(dirname(outReportPath), { recursive: true })

writeFileSync(outJsonPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), abiSpecVersion, abiContractRef, summary, mapping }, null, 2)}\n`, 'utf-8')

const topUndeclared = mapping.filter((x) => !x.declared).slice(0, 60)
const topStubbed = mapping.filter((x) => x.stubbed).slice(0, 120)

const lines = []
lines.push('# krnln 命令映射报告（Windows）')
lines.push('')
lines.push(`- 生成时间: ${new Date().toISOString()}`)
lines.push(`- ABI 契约版本: ${abiSpecVersion}`)
lines.push(`- ABI 契约文档: ${abiContractRef}`)
lines.push(`- 总命令数: ${summary.totalCommands}`)
lines.push(`- 已声明: ${summary.declared}`)
lines.push(`- 已实现（非自动桩区）: ${summary.implemented}`)
lines.push(`- 自动桩覆盖: ${summary.stubbed}`)
lines.push(`- 未声明: ${summary.undeclared}`)
lines.push('')
lines.push('## ABI 风险分布')
lines.push('')
for (const [k, v] of Object.entries(summary.abiRisk)) lines.push(`- ${k}: ${v}`)
lines.push('')
lines.push('## 返回类型分布')
lines.push('')
for (const [k, v] of Object.entries(summary.returnType)) lines.push(`- ${k}: ${v}`)

if (summary.duplicateCommandIds.length > 0) {
  lines.push('')
  lines.push('## 重复 commandId')
  lines.push('')
  for (const id of summary.duplicateCommandIds) lines.push(`- ${id}`)
}

if (summary.duplicateNativeSymbols.length > 0) {
  lines.push('')
  lines.push('## 冲突 nativeSymbol')
  lines.push('')
  for (const row of summary.duplicateNativeSymbols) lines.push(`- ${row}`)
}

lines.push('')
lines.push('## 未声明命令（前 60）')
lines.push('')
if (topUndeclared.length === 0) {
  lines.push('- 无')
} else {
  for (const item of topUndeclared) lines.push(`- ${item.commandId} -> ${item.nativeSymbol}`)
}

lines.push('')
lines.push('## 自动桩命令（前 120）')
lines.push('')
if (topStubbed.length === 0) {
  lines.push('- 无')
} else {
  for (const item of topStubbed) {
    lines.push(`- ${item.commandId} -> ${item.nativeSymbol} (risk=${item.abiRisk}, return=${item.returnType})`)
  }
}

writeFileSync(outReportPath, `${lines.join('\n')}\n`, 'utf-8')

console.log(`[krnln] mapping generated: ${outJsonPath}`)
console.log(`[krnln] report generated: ${outReportPath}`)
console.log(`[krnln] summary: total=${summary.totalCommands}, implemented=${summary.implemented}, stubbed=${summary.stubbed}, undeclared=${summary.undeclared}`)
