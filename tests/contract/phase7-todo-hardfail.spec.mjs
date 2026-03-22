import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

test('D7-13: TODO command path hard-fails immediately', async () => {
  const source = readCompilerSource()
  assert.match(source, /尚未实现C代码生成/)
  assert.match(source, /throw new Error/)
  assert.doesNotMatch(source, /尚未实现C代码生成 \*\/ \(void\)0;/)
})

test('D7-14: TODO hard-fail includes source file + line', async () => {
  const source = readCompilerSource()
  assert.match(source, /file=\$\{fileName\}/)
  assert.match(source, /line=\$\{lineNumber\}/)
})

test('D7-15: multiple TODO hits stop at first-hit without scanning later commands', async () => {
  const source = readCompilerSource()
  assert.match(source, /const lineNumber = i \+ 1/)
  assert.match(source, /first-hit/)
  assert.match(source, /throw new Error/)
})

function readCompilerSource() {
  return fs.readFileSync(path.join(repoRoot, 'src/main/compiler.ts'), 'utf-8')
}
