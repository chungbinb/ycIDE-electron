import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const flowThemePath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/flowLineTheme.ts')

function loadFlowLineThemeModule() {
  const source = fs.readFileSync(flowThemePath, 'utf-8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: flowThemePath,
  }).outputText
  const module = { exports: {} }
  const context = vm.createContext({
    module,
    exports: module.exports,
    require,
    console,
  })
  const script = new vm.Script(compiled, { filename: flowThemePath })
  script.runInContext(context)
  return module.exports
}

test('single mode returns one shared color for all flow elements', () => {
  const { resolveFlowLineColors } = loadFlowLineThemeModule()
  const colors = resolveFlowLineColors({
    mode: 'single',
    single: { mainColor: '#4fc1ff' },
    multi: { mainColor: '#4fc1ff', depthHueStep: 16, depthSaturationStep: -4, depthLightnessStep: 5 },
  }, 5)

  assert.deepEqual(colors, {
    main: '#4fc1ff',
    branch: '#4fc1ff',
    loop: '#4fc1ff',
    arrow: '#4fc1ff',
    innerLink: '#4fc1ff',
  })
})

test('multi mode derives depth-based colors from current main color baseline', () => {
  const { resolveFlowLineColors } = loadFlowLineThemeModule()
  const flowConfig = {
    mode: 'multi',
    single: { mainColor: '#4fc1ff' },
    multi: { mainColor: '#4fc1ff', depthHueStep: 20, depthSaturationStep: -3, depthLightnessStep: 4 },
  }
  const depth0 = resolveFlowLineColors(flowConfig, 0)
  const depth1 = resolveFlowLineColors(flowConfig, 1)
  const depth2 = resolveFlowLineColors(flowConfig, 2)

  assert.equal(depth0.main.toLowerCase(), '#4fc1ff')
  assert.notEqual(depth1.main, depth0.main)
  assert.notEqual(depth2.main, depth1.main)
  assert.equal(depth1.main, depth1.branch)
  assert.equal(depth1.main, depth1.loop)
  assert.equal(depth1.main, depth1.arrow)
  assert.equal(depth1.main, depth1.innerLink)
})

test('depth generation is deterministic and unbounded for deep nesting', () => {
  const { resolveFlowLineColors } = loadFlowLineThemeModule()
  const flowConfig = {
    mode: 'multi',
    single: { mainColor: '#4fc1ff' },
    multi: { mainColor: '#4fc1ff', depthHueStep: 16, depthSaturationStep: -4, depthLightnessStep: 5 },
  }

  const depth64 = resolveFlowLineColors(flowConfig, 64)
  const depth65 = resolveFlowLineColors(flowConfig, 65)
  const depth64Again = resolveFlowLineColors(flowConfig, 64)

  assert.match(depth64.main, /^#[0-9a-f]{6}$/i)
  assert.match(depth65.main, /^#[0-9a-f]{6}$/i)
  assert.notEqual(depth65.main, depth64.main)
  assert.deepEqual(depth64Again, depth64)
})
