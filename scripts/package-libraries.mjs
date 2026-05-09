import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const value = process.argv[i]
  if (!value.startsWith('--')) continue
  const key = value.slice(2)
  const next = process.argv[i + 1]
  if (next && !next.startsWith('--')) {
    args.set(key, next)
    i += 1
  } else {
    args.set(key, 'true')
  }
}

const sourceRoot = args.get('source') || 'lib'
const outRoot = args.get('out') || 'dist/libraries'
const packageDir = args.get('packages-dir') || join(outRoot, 'packages')
const baseUrl = (args.get('base-url') || 'https://ycide.dev/libraries/packages').replace(/\/$/, '')
const bundledOnlyLibraries = new Set(['krnln'])

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function walkFiles(root) {
  const files = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) stack.push(fullPath)
      else if (entry.isFile()) files.push(fullPath)
    }
  }
  return files.sort((a, b) => a.localeCompare(b))
}

function readManifestMeta(libraryDir, id) {
  const manifests = walkFiles(libraryDir).filter(file => file.toLowerCase().endsWith('.ycmd.json'))
  let displayName = id
  let version = '-'
  const platforms = new Set()
  for (const file of manifests) {
    try {
      const manifest = JSON.parse(readFileSync(file, 'utf-8'))
      if (typeof manifest.libraryDisplayName === 'string' && manifest.libraryDisplayName.trim()) {
        displayName = manifest.libraryDisplayName.trim()
      } else if (displayName === id && typeof manifest.library === 'string' && manifest.library.trim()) {
        displayName = manifest.library.trim()
      }
      if (typeof manifest.libraryVersion === 'string' && manifest.libraryVersion.trim()) {
        version = manifest.libraryVersion.trim()
      } else if (version === '-' && typeof manifest.contractVersion === 'string' && manifest.contractVersion.trim()) {
        version = manifest.contractVersion.trim()
      }
      if (manifest.implementations && typeof manifest.implementations === 'object') {
        for (const platform of ['windows', 'macos', 'linux']) {
          if (manifest.implementations[platform]?.entry) platforms.add(platform)
        }
      }
    } catch {
      // Skip malformed manifests; the IDE scanner will report them during development.
    }
  }
  return { displayName, version, supportedPlatforms: Array.from(platforms) }
}

if (!existsSync(sourceRoot)) {
  throw new Error(`Source directory does not exist: ${sourceRoot}`)
}

rmSync(packageDir, { recursive: true, force: true })
mkdirSync(packageDir, { recursive: true })

const libraries = []
for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const id = entry.name
  if (bundledOnlyLibraries.has(id.toLowerCase())) continue
  const libraryDir = join(sourceRoot, id)
  const files = walkFiles(libraryDir)
  if (!files.some(file => file.toLowerCase().endsWith('.ycmd.json'))) continue

  const packageFileName = `${id}.zip`
  const packagePath = join(packageDir, packageFileName)
  const zip = new AdmZip()
  for (const file of files) {
    zip.addLocalFile(file, relative(libraryDir, dirname(file)))
  }
  zip.writeZip(packagePath)

  const meta = readManifestMeta(libraryDir, id)
  libraries.push({
    id,
    displayName: meta.displayName,
    version: meta.version,
    packageFileName,
    packageUrl: `${baseUrl}/${encodeURIComponent(packageFileName)}`,
    packageSha256: sha256File(packagePath),
    size: statSync(packagePath).size,
    supportedPlatforms: meta.supportedPlatforms,
    publishedAt: new Date().toISOString(),
  })
}

const index = {
  schemaVersion: '1.0',
  updatedAt: new Date().toISOString(),
  libraries: libraries.sort((a, b) => a.id.localeCompare(b.id)),
}

mkdirSync(outRoot, { recursive: true })
writeFileSync(join(outRoot, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf-8')

console.log(`Packaged ${basename(sourceRoot)} libraries: ${libraries.length}`)