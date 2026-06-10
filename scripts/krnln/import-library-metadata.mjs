import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'

const scriptFilePath = fileURLToPath(import.meta.url)
const repoRoot = resolve(dirname(scriptFilePath), '..', '..')
const coreHelpPath = join(repoRoot, 'lib', 'krnln', '系统核心支持库帮助说明文件.txt')
const coreCommandsPath = join(repoRoot, 'lib', 'krnln', 'krnln.commands.ycmd.json')
const coreLibraryPath = join(repoRoot, 'lib', 'krnln', 'krnln.library.json')

const externalSpecTypedefPath = 'D:/chungbin/ycIDE-html/支持库源码/spec/spec_cmd_typedef.h'
const specLibDir = join(repoRoot, 'lib', 'spec')
const specCommandsPath = join(specLibDir, 'spec.commands.ycmd.json')
const specLibraryPath = join(specLibDir, 'spec.library.json')
const specImplPath = join(specLibDir, 'impl', 'windows.cpp')

const TYPE_CLEAN_RE = /（[^）]*）/g

function readTextWithFallback(filePath) {
  const buf = readFileSync(filePath)
  if (buf.length >= 2) {
    const b0 = buf[0]
    const b1 = buf[1]
    // UTF-16 LE BOM
    if (b0 === 0xFF && b1 === 0xFE) {
      return buf.slice(2).toString('utf16le')
    }
    // UTF-16 BE BOM (swap to LE)
    if (b0 === 0xFE && b1 === 0xFF) {
      const be = buf.slice(2)
      const le = Buffer.allocUnsafe(be.length)
      for (let i = 0; i + 1 < be.length; i += 2) {
        le[i] = be[i + 1]
        le[i + 1] = be[i]
      }
      return le.toString('utf16le')
    }
  }

  const utf8 = buf.toString('utf8')
  const zeroCount = [...utf8].filter(ch => ch === '\u0000').length
  if (zeroCount > 0) {
    return buf.toString('utf16le')
  }
  return utf8
}

function splitTopLevelArgs(input) {
  const args = []
  let current = ''
  let inString = false
  let escaped = false
  let parenDepth = 0
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (inString) {
      current += ch
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      current += ch
      continue
    }
    if (ch === '(') {
      parenDepth += 1
      current += ch
      continue
    }
    if (ch === ')') {
      if (parenDepth > 0) parenDepth -= 1
      current += ch
      continue
    }
    if (ch === ',' && parenDepth === 0) {
      args.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) args.push(current.trim())
  return args
}

function normalizeType(typeText) {
  return typeText.replace(TYPE_CLEAN_RE, '').trim()
}

function mapPlatformToken(token) {
  const lower = token.trim().toLowerCase()
  if (!lower) return null
  if (lower.includes('win')) return 'windows'
  if (lower.includes('linux')) return 'linux'
  if (lower.includes('unix') || lower.includes('mac')) return 'macos'
  if (lower.includes('harmony') || lower.includes('鸿蒙')) return 'harmony'
  return null
}

function parseHelpFile(content) {
  const lines = content.split(/\r?\n/)
  const entries = []
  let currentCategory = ''
  let current = null

  const flush = () => {
    if (!current) return
    current.description = (current.description || '').trim()
    if (!current.description) current.description = '暂无说明。'
    entries.push(current)
    current = null
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const categoryMatch = line.match(/^---\s*命令类别：\s*(.+?)\s*---$/)
    if (categoryMatch) {
      flush()
      currentCategory = categoryMatch[1].trim()
      continue
    }

    if (line.startsWith('调用格式：')) {
      flush()
      const formatMatch = line.match(/^调用格式：\s*〈([^〉]+)〉\s*([^\s（]+)\s*（(.*)）\s*-/)
      if (!formatMatch) continue
      current = {
        category: currentCategory || '其他',
        returnType: formatMatch[1].trim(),
        displayName: formatMatch[2].trim(),
        description: '',
        englishKey: '',
        params: [],
        supportedPlatforms: [],
      }
      continue
    }

    if (!current) continue

    if (line.startsWith('英文名称：')) {
      current.englishKey = line.slice('英文名称：'.length).trim()
      continue
    }

    if (line.startsWith('参数<')) {
      const paramMatch = line.match(/^参数<\d+>的名称为[“"](.+?)[”"]，类型为[“"](.+?)[”"](.*)$/)
      if (!paramMatch) continue
      const tail = (paramMatch[3] || '').trim()
      current.params.push({
        name: paramMatch[1].trim(),
        type: normalizeType(paramMatch[2].trim()),
        optional: tail.includes('可以被省略'),
        description: tail,
      })
      continue
    }

    if (line.startsWith('操作系统需求：')) {
      const platformText = line.slice('操作系统需求：'.length)
      const platforms = platformText
        .split(/[、,，]/g)
        .map(mapPlatformToken)
        .filter((item) => !!item)
      current.supportedPlatforms = Array.from(new Set(platforms))
      continue
    }

    if (line.startsWith('〈对应命令〉')) {
      continue
    }

    current.description = current.description ? `${current.description}${line}` : line
  }

  flush()
  return entries
}

function parseSpecTypedef(content) {
  const lines = content.split(/\r?\n/)
  const categoryMap = new Map([
    ['1', '系统处理'],
    ['2', '程序调试'],
    ['3', '内存操作'],
    ['4', '特殊功能'],
  ])
  const returnTypeMap = new Map([
    ['_SDT_NULL', '无返回值'],
    ['SDT_BOOL', '逻辑型'],
    ['SDT_INT', '整数型'],
    ['SDT_TEXT', '文本型'],
    ['SDT_SUB_PTR', '子程序指针'],
    ['_SDT_ALL', '通用型'],
  ])

  const macroLines = []
  let current = ''
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    if (line.startsWith('_MAKE(')) {
      if (current.startsWith('_MAKE(')) {
        macroLines.push(current)
      }
      current = line
    } else if (current) {
      current += line
    } else {
      continue
    }

    if (!current.endsWith('\\')) {
      macroLines.push(current)
      current = ''
    }
  }

  if (current.startsWith('_MAKE(')) {
    macroLines.push(current)
  }

  const commands = []
  for (const line of macroLines) {
    const body = line.replace(/^_MAKE\(/, '').replace(/\\$/, '').replace(/\)$/, '')
    const args = splitTopLevelArgs(body)
    if (args.length < 7) continue

    const displayName = args[1].replace(/^"|"$/g, '').trim()
    const englishName = args[2].trim()
    const summary = args[3].replace(/^"|"$/g, '').replace(/\\r\\n/g, ' ').trim()
    const category = categoryMap.get(args[4].trim()) || '特殊功能'
    const stateExpr = args[5]
    const retType = returnTypeMap.get(args[6].trim()) || '通用型'

    const supportedPlatforms = stateExpr.includes('__OS_WIN')
      ? ['windows']
      : ['windows', 'linux', 'macos']

    commands.push({
      commandId: `spec.${englishName}`,
      displayName,
      summary,
      returnType: retType,
      category,
      supportedPlatforms,
      params: [],
    })
  }

  return commands
}

function commandIdSuffix(commandId) {
  const pos = commandId.lastIndexOf('.')
  return pos >= 0 ? commandId.slice(pos + 1) : commandId
}

function updateCoreCommandsFromHelp() {
  const helpText = readTextWithFallback(coreHelpPath)
  const helpEntries = parseHelpFile(helpText)
  const byEnglish = new Map(helpEntries.map(item => [item.englishKey.toLowerCase(), item]))
  const byName = new Map(helpEntries.map(item => [item.displayName, item]))

  const manifest = JSON.parse(readFileSync(coreCommandsPath, 'utf8'))
  const commands = Array.isArray(manifest.commands) ? manifest.commands : []

  let updatedCount = 0
  for (const cmd of commands) {
    if (!cmd || typeof cmd !== 'object' || !cmd.commandId) continue
    const english = commandIdSuffix(String(cmd.commandId)).toLowerCase()
    const entry = byEnglish.get(english) || byName.get(String(cmd.displayName || ''))
    if (!entry) continue

    cmd.summary = entry.description || cmd.summary || '暂无说明。'
    cmd.returnType = entry.returnType || cmd.returnType || '无返回值'
    cmd.category = entry.category || cmd.category || '其他'
    if (entry.params.length > 0) {
      cmd.params = entry.params.map(param => ({
        name: param.name,
        type: param.type,
        optional: !!param.optional,
        description: param.description || '',
      }))
    }
    if (entry.supportedPlatforms.length > 0) {
      cmd.supportedPlatforms = entry.supportedPlatforms
    }
    updatedCount += 1
  }

  writeFileSync(coreCommandsPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  const coreLib = JSON.parse(readFileSync(coreLibraryPath, 'utf8'))
  coreLib.description = '系统核心支持库，命令说明与分类由帮助说明文件对齐生成。'
  writeFileSync(coreLibraryPath, `${JSON.stringify(coreLib, null, 2)}\n`, 'utf8')

  return { helpEntryCount: helpEntries.length, updatedCount }
}

function generateSpecLibraryFromSource() {
  const typedefText = readTextWithFallback(externalSpecTypedefPath)
  const commands = parseSpecTypedef(typedefText)

  mkdirSync(join(specLibDir, 'impl'), { recursive: true })

  const commandManifest = {
    contractVersion: '1.0',
    library: 'spec',
    libraryDisplayName: '系统特殊功能支持库',
    libraryVersion: '1.0',
    implementations: {
      windows: {
        entry: 'impl/windows.cpp',
        language: 'cpp',
      },
    },
    commands,
  }

  const libraryMeta = {
    guid: '31F7E8F2457A4F53BFD48DB5DD7E67BF',
    description: '系统特殊功能支持库（开发期由外部 spec 源码离线导入）。',
    author: 'ycIDE',
    qq: '-',
    email: '-',
    homePage: 'https://ycide.dev',
    otherInfo: '运行时仅读取本目录清单，不依赖外部源码目录。',
  }

  writeFileSync(specCommandsPath, `${JSON.stringify(commandManifest, null, 2)}\n`, 'utf8')
  writeFileSync(specLibraryPath, `${JSON.stringify(libraryMeta, null, 2)}\n`, 'utf8')
  writeFileSync(specImplPath, '// Placeholder implementation file for ycmd manifest validation.\n', 'utf8')

  return { commandCount: commands.length }
}

function main() {
  const core = updateCoreCommandsFromHelp()
  const spec = generateSpecLibraryFromSource()
  console.log(`[import-library-metadata] core help entries: ${core.helpEntryCount}, updated commands: ${core.updatedCount}`)
  console.log(`[import-library-metadata] spec generated commands: ${spec.commandCount}`)
}

main()
