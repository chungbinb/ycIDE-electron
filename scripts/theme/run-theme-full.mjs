import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function getThemeSpecs(dirPath, ext) {
  return fs
    .readdirSync(dirPath)
    .filter((name) => name.startsWith('theme-') && name.endsWith(ext))
    .sort()
    .map((name) => path.join(dirPath, name).replace(/\\/g, '/'))
}

const contractSpecs = getThemeSpecs(path.join('tests', 'contract'), '.spec.mjs')
const uiSpecs = getThemeSpecs(path.join('tests', 'ui'), '.spec.js')

const steps = [
  {
    label: 'full contract suite',
    command: 'node',
    args: ['--test', ...contractSpecs],
  },
  {
    label: 'full ui suite',
    command: 'node',
    args: ['node_modules/@playwright/test/cli.js', 'test', ...uiSpecs],
  },
]

for (const [index, step] of steps.entries()) {
  console.log(`\n[theme-full ${index + 1}/${steps.length}] ${step.label}`)
  console.log(`> ${step.command} ${step.args.join(' ')}`)
  const result = spawnSync(step.command, step.args, { stdio: 'inherit' })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log('\nTheme full run passed (contract-first -> UI).')
