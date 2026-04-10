const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function loadMonacoThemeModule() {
  const modulePath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/monacoThemeTokens.ts')
  const source = fs.readFileSync(modulePath, 'utf-8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: modulePath,
  }).outputText

  const module = { exports: {} }
  const context = vm.createContext({
    module,
    exports: module.exports,
    require,
    console,
  })
  new vm.Script(compiled, { filename: modulePath }).runInContext(context)
  return module.exports
}

function toHex(value) {
  return `#${String(value || '').replace(/^#/, '').toLowerCase()}`
}

function pickRuleColor(rules, tokenName) {
  const found = rules.find(rule => rule.token === tokenName)
  return found ? toHex(found.foreground) : null
}

function collectMonacoTokenColors(tokenValues, mode = 'dark') {
  const { buildMonacoThemeTokens } = loadMonacoThemeModule()
  const theme = buildMonacoThemeTokens(mode, tokenValues)
  return {
    keyword: pickRuleColor(theme.rules, 'keyword'),
    comment: pickRuleColor(theme.rules, 'comment'),
    string: pickRuleColor(theme.rules, 'string'),
    type: pickRuleColor(theme.rules, 'type'),
    predefined: pickRuleColor(theme.rules, 'predefined'),
    identifier: pickRuleColor(theme.rules, 'identifier'),
    operator: pickRuleColor(theme.rules, 'operator'),
  }
}

function assertMonacoTokenColorEvidence(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    const normalizedExpected = toHex(value)
    if (actual[key] !== normalizedExpected) {
      throw new Error(`Monaco token color mismatch for ${key}: expected ${normalizedExpected}, got ${actual[key]}`)
    }
  }
}

module.exports = {
  collectMonacoTokenColors,
  assertMonacoTokenColorEvidence,
}
