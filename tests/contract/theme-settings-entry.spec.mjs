import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const dialogPath = path.resolve(process.cwd(), 'src/renderer/src/components/ThemeSettingsDialog/ThemeSettingsDialog.tsx')

test('theme settings renders four business groups with preview chips and keeps token keys hidden', () => {
  const source = fs.readFileSync(dialogPath, 'utf-8')
  assert.match(source, /基础文本\/背景/)
  assert.match(source, /语法高亮/)
  assert.match(source, /表格与表头/)
  assert.match(source, /流程线/)
  assert.match(source, /theme-settings-preview-chip/)
  assert.doesNotMatch(source, /item\.tokenKey<\/span>/)
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
  const source = fs.readFileSync(dialogPath, 'utf-8')
  assert.match(source, /表格背景/)
  assert.match(source, /表格文本/)
  assert.match(source, /表格边框/)
  assert.match(source, /表头背景/)
  assert.match(source, /表头文本/)
  assert.match(source, /行悬浮/)
  assert.match(source, /行选中/)
})
