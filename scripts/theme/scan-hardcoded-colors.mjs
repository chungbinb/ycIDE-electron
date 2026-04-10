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

  const files = SURFACE_FILES[surface]
  if (!files) {
    const supported = Object.keys(SURFACE_FILES).join(', ')
    throw new Error(`Unknown surface "${surface}". Supported: ${supported}`)
  }

  return [...new Set(files)]
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
      matches.push({
        line: index + 1,
        literal: token[0],
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
  const violations = scanned.filter(item => item.hits.length > 0)

  const summary = {
    phase: args.phase ?? null,
    surface: args.surface ?? 'all',
    strict: args.strict,
    scannedFiles: files.length,
    violations: violations.length,
    totalHits: violations.reduce((sum, file) => sum + file.hits.length, 0),
    files: scanned,
  }

  console.log(JSON.stringify(summary, null, 2))

  if (args.strict && violations.length > 0) {
    process.exitCode = 1
  }
}

main()
