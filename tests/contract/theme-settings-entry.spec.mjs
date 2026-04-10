import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const dialogPath = path.resolve(process.cwd(), 'src/renderer/src/components/ThemeSettingsDialog/ThemeSettingsDialog.tsx')
const tokenMetaPath = path.resolve(process.cwd(), 'src/shared/theme-tokens.ts')
const appPath = path.resolve(process.cwd(), 'src/renderer/src/App.tsx')

test('theme settings renders four business groups with preview chips and keeps token keys hidden', () => {
  const dialogSource = fs.readFileSync(dialogPath, 'utf-8')
  const tokenMetaSource = fs.readFileSync(tokenMetaPath, 'utf-8')
  assert.match(tokenMetaSource, /基础文本\/背景/)
  assert.match(tokenMetaSource, /语法高亮/)
  assert.match(tokenMetaSource, /表格与表头/)
  assert.match(tokenMetaSource, /流程线/)
  assert.match(dialogSource, /theme-settings-preview-chip/)
  assert.doesNotMatch(dialogSource, /item\.tokenKey<\/span>/)
})

test('theme settings syntax group exposes fine-grained Monaco token classes', () => {
  const source = fs.readFileSync(dialogPath, 'utf-8')
  assert.match(source, /关键字/)
  assert.match(source, /注释/)
  assert.match(source, /字符串/)
  assert.match(source, /类型/)
  assert.match(source, /预定义/)
  assert.match(source, /常量/)
  assert.match(source, /标识符/)
  assert.match(source, /运算符/)
  assert.match(source, /分隔符/)
})

test('theme settings table/header group exposes full table token set', () => {
  const source = fs.readFileSync(tokenMetaPath, 'utf-8')
  assert.match(source, /表格背景/)
  assert.match(source, /表格文本/)
  assert.match(source, /表格边框/)
  assert.match(source, /表头背景/)
  assert.match(source, /表头文本/)
  assert.match(source, /行悬浮/)
  assert.match(source, /行选中/)
})

test('App wires per-item reset through shared immediate apply handler', () => {
  const source = fs.readFileSync(appPath, 'utf-8')
  assert.match(source, /onResetToken=\{handleThemeTokenResetItem\}/)
  assert.match(source, /const handleThemeTokenResetItem = useCallback\(/)
  assert.match(source, /window\.api\?\.theme\?\.saveCurrent\(/)
})

test('App requires confirmations for group and global resets before immediate apply', () => {
  const source = fs.readFileSync(appPath, 'utf-8')
  assert.match(source, /onResetGroup=\{handleThemeTokenResetGroup\}/)
  assert.match(source, /onResetAll=\{handleThemeTokenResetAll\}/)
  assert.match(source, /window\.confirm\('确定重置该分组令牌吗\?'\)/)
  assert.match(source, /window\.confirm\('确定恢复全部主题令牌默认值吗\?'\)/)
})

test('flow-line group reset only resets active mode configuration', () => {
  const source = fs.readFileSync(appPath, 'utf-8')
  assert.match(source, /groupId === 'flow-line'/)
  assert.match(source, /themeFlowLine\.mode === 'multi'/)
  assert.match(source, /themeFlowLine\.mode === 'single'/)
})

test('theme settings exposes flow-line mode and depth controls', () => {
  const source = fs.readFileSync(dialogPath, 'utf-8')
  assert.match(source, /flow-line-mode-single/)
  assert.match(source, /flow-line-mode-multi/)
  assert.match(source, /onFlowLineModeChange/)
  assert.match(source, /onFlowLineMainColorChange/)
  assert.match(source, /onFlowLineDepthStepChange/)
  assert.match(source, /depthHueStep/)
  assert.match(source, /depthSaturationStep/)
  assert.match(source, /depthLightnessStep/)
})

test('App wires flow-line mode and depth controls through payload save path', () => {
  const source = fs.readFileSync(appPath, 'utf-8')
  assert.match(source, /const handleThemeFlowLineModeChange = useCallback\(/)
  assert.match(source, /const handleThemeFlowLineMainColorChange = useCallback\(/)
  assert.match(source, /const handleThemeFlowLineDepthStepChange = useCallback\(/)
  assert.match(source, /flowLineConfig=\{themeFlowLine\}/)
  assert.match(source, /onFlowLineModeChange=\{handleThemeFlowLineModeChange\}/)
  assert.match(source, /onFlowLineMainColorChange=\{handleThemeFlowLineMainColorChange\}/)
  assert.match(source, /onFlowLineDepthStepChange=\{handleThemeFlowLineDepthStepChange\}/)
  assert.match(source, /persistCurrentThemePayload\([^)]*payload\)/)
})
