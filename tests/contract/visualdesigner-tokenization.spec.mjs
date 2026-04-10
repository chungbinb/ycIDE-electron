import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const visualDesignerTsxPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/VisualDesigner.tsx')
const visualDesignerCssPath = path.resolve(process.cwd(), 'src/renderer/src/components/Editor/VisualDesigner.css')

const HARD_CODED_COLOR_PATTERN = /#[0-9A-Fa-f]{3,8}|rgba?\(/

test('VisualDesigner preview and control surfaces are token-driven', () => {
  const source = fs.readFileSync(visualDesignerTsxPath, 'utf-8')
  assert.match(source, /var\(--/)
  assert.doesNotMatch(source, /#0F6CBD|#F3F3F3|#1a1a1a|#d1d1d1/)
})

test('VisualDesigner TSX and CSS have no hardcoded hex/rgba literals on visible paths', () => {
  const tsx = fs.readFileSync(visualDesignerTsxPath, 'utf-8')
  const css = fs.readFileSync(visualDesignerCssPath, 'utf-8')
  assert.doesNotMatch(tsx, HARD_CODED_COLOR_PATTERN)
  assert.doesNotMatch(css, HARD_CODED_COLOR_PATTERN)
})
