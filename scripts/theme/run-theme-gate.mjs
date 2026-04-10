import { spawnSync } from 'node:child_process'
const steps = [
  {
    label: 'contract gate',
    command: 'node',
    args: [
      '--test',
      'tests/contract/theme-qual-gate.spec.mjs',
      'tests/contract/theme-compatibility-contract.spec.mjs',
    ],
  },
  {
    label: 'ui gate',
    command: 'node',
    args: ['node_modules/@playwright/test/cli.js', 'test', 'tests/ui/theme-qual-gate.spec.js', '-g', 'QUAL-02'],
  },
]

for (const [index, step] of steps.entries()) {
  console.log(`\n[theme-gate ${index + 1}/${steps.length}] ${step.label}`)
  console.log(`> ${step.command} ${step.args.join(' ')}`)
  const result = spawnSync(step.command, step.args, { stdio: 'inherit' })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log('\nTheme gate passed (contract-first -> UI).')
