#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const COLOR_LITERAL_PATTERN = /#[0-9A-Fa-f]{3,8}|rgba?\(/g

const SURFACE_FILES = {
  visualdesigner: [
    'src/renderer/src/components/Editor/VisualDesigner.tsx',
    'src/renderer/src/components/Editor/VisualDesigner.css',
  ],
  icon: [
    'src/renderer/src/components/Icon/Icon.tsx',
    'src/renderer/src/components/Icon/Icon.css',
  ],
  eyctableeditor: [
    'src/renderer/src/components/Editor/EycTableEditor.tsx',
    'src/renderer/src/components/Editor/EycTableEditor.css',
  ],
  debug: [
    'src/renderer/src/components/Editor/EycTableEditor.css',
  ],
}

function parseArgs(argv) {
  const args = {
    phase: null,
    surface: null,
    strict: false,
  }

  for (const arg of argv) {
    if (arg === '--strict') {
      args.strict = true
      continue
    }
    if (arg.startsWith('--phase=')) {
      args.phase = arg.slice('--phase='.length)
      continue
    }
    if (arg.startsWith('--surface=')) {
      args.surface = arg.slice('--surface='.length).toLowerCase()
    }
  }

  return args
}

function resolveFiles(surface) {
  if (!surface) {
    return [
      ...new Set([
        ...SURFACE_FILES.eyctableeditor,
        ...SURFACE_FILES.visualdesigner,
        ...SURFACE_FILES.icon,
        ...SURFACE_FILES.debug,
      ]),
    ]
  }

  const requestedSurfaces = surface.split(',').map(item => item.trim()).filter(Boolean)
  const unknownSurfaces = requestedSurfaces.filter(item => !SURFACE_FILES[item])
  if (unknownSurfaces.length > 0) {
    const supported = Object.keys(SURFACE_FILES).join(', ')
    throw new Error(`Unknown surface "${unknownSurfaces.join(', ')}". Supported: ${supported}`)
  }

  return [
    ...new Set(
      requestedSurfaces.flatMap(item => SURFACE_FILES[item]),
    ),
  ]
}

function scanFile(relativePath) {
  const absolutePath = path.resolve(ROOT, relativePath)
  const source = fs.readFileSync(absolutePath, 'utf-8')
  const lines = source.split(/\r?\n/)
  const matches = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const found = [...line.matchAll(COLOR_LITERAL_PATTERN)]
    if (found.length === 0) continue
    for (const token of found) {
      const literal = token[0]
      const isVarFallback = line.includes('var(') && line.includes(literal)
      matches.push({
        line: index + 1,
        literal,
        classification: isVarFallback ? 'resolved-fallback' : 'unresolved',
        content: line.trim(),
      })
    }
  }

  return {
    file: relativePath,
    hits: matches,
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const files = resolveFiles(args.surface)
  const scanned = files.map(scanFile)
  const unresolved = scanned.map(item => ({
    ...item,
    hits: item.hits.filter(hit => hit.classification === 'unresolved'),
  })).filter(item => item.hits.length > 0)
  const resolvedFallbacks = scanned.map(item => ({
    ...item,
    hits: item.hits.filter(hit => hit.classification === 'resolved-fallback'),
  })).filter(item => item.hits.length > 0)

  const summary = {
    generatedAt: new Date().toISOString(),
    phase: args.phase ?? null,
    surface: args.surface ?? 'all',
    status: args.strict && unresolved.length > 0 ? 'fail' : 'pass',
    strict: args.strict,
    scannedFiles: files.length,
    violations: unresolved.length,
    totalHits: unresolved.reduce((sum, file) => sum + file.hits.length, 0),
    resolvedFallbackFiles: resolvedFallbacks.length,
    resolvedFallbackHits: resolvedFallbacks.reduce((sum, file) => sum + file.hits.length, 0),
    summaryByFile: scanned.map(item => ({
      file: item.file,
      unresolvedHits: item.hits.filter(hit => hit.classification === 'unresolved').length,
      resolvedFallbackHits: item.hits.filter(hit => hit.classification === 'resolved-fallback').length,
    })),
    files: unresolved,
    resolvedFallbacks,
  }

  console.log(JSON.stringify(summary, null, 2))

  if (args.strict && unresolved.length > 0) {
    process.exitCode = 1
  }
}

main()
