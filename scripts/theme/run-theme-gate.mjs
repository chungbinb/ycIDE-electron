import { spawnSync } from 'node:child_process'
import { formatQualFailure } from './format-qual-failure.mjs'
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
  const result = spawnSync(step.command, step.args, { encoding: 'utf8' })
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    console.error(
      formatQualFailure({
        stepLabel: step.label,
        command: step.command,
        args: step.args,
        exitCode: result.status ?? 1,
        output,
      }),
    )
    process.exit(result.status ?? 1)
  }
}

console.log('\nTheme gate passed (contract-first -> UI).')
