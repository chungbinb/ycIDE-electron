function extractFailurePath(outputText) {
  const pathPatterns = [
    /(tests\/[^\s:]+\.(?:js|mjs)(?::\d+:\d+)?)/i,
    /(QUAL-[0-9]{2}\/[^\s"'`]+)/i,
    /(scenarioPath["':\s]+([^\n\r]+))/i,
  ]
  for (const pattern of pathPatterns) {
    const match = outputText.match(pattern)
    if (!match) continue
    if (match[1]) {
      return match[1].replace(/["',]/g, '').trim()
    }
  }
  return 'not-detected'
}

function extractExpectedActual(outputText) {
  const expectedMatch =
    outputText.match(/Expected:\s*([^\n\r]+)/i) ??
    outputText.match(/expected\s+([^\n\r]+?)\s+to\s+/i)
  const actualMatch =
    outputText.match(/Received:\s*([^\n\r]+)/i) ??
    outputText.match(/Actual:\s*([^\n\r]+)/i) ??
    outputText.match(/actual\s*[:=]\s*([^\n\r]+)/i)

  return {
    expected: expectedMatch?.[1]?.trim() ?? 'see raw output for expected state',
    actual: actualMatch?.[1]?.trim() ?? 'see raw output for actual state',
  }
}

export function formatQualFailure({ stepLabel, command, args, exitCode, output }) {
  const failedPath = extractFailurePath(output)
  const { expected, actual } = extractExpectedActual(output)
  const rerunCommand = `${command} ${args.join(' ')}`

  return [
    '',
    '=== QUAL actionable failure ===',
    `step: ${stepLabel}`,
    `failed-path: ${failedPath}`,
    `expected: ${expected}`,
    `actual: ${actual}`,
    'remediation:',
    `  1) Re-run locally: ${rerunCommand}`,
    '  2) Reproduce with --reporter=line and inspect first failing assertion.',
    '  3) Fix scenario data/setup or assertion mismatch, then re-run gate.',
    `exit-code: ${exitCode}`,
    '===============================',
    '',
  ].join('\n')
}
