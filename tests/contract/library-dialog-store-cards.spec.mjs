import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

const sourcePath = path.join(
  process.cwd(),
  'src',
  'renderer',
  'src',
  'components',
  'LibraryDialog',
  'LibraryDialog.tsx',
)

test('LibraryDialog refreshList uses getStoreCards data source', async () => {
  const source = await fs.readFile(sourcePath, 'utf8')
  assert.match(source, /window\.api\.library\.getStoreCards\(\)/)
})

test('LibraryDialog default selected set is driven by isLoaded', async () => {
  const source = await fs.readFile(sourcePath, 'utf8')
  assert.match(source, /filter\(\(lib:[^)]*\)\s*=>\s*lib\.isLoaded\)/)
})

test('LibraryDialog keeps status/detail linkage after applySelection refresh', async () => {
  const source = await fs.readFile(sourcePath, 'utf8')
  assert.match(source, /await refreshList\(true\)/)
  assert.match(source, /value=\{statusText \|\| detailText\}/)
  assert.match(source, /setStatusText\(''\)/)
})
