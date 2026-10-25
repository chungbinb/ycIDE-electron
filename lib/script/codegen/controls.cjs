// 脚本语言支持组件的代码生成脚本：脚本组件的设计期属性（语言、超时）。
// 只有随安装包发布的内置支持库目录里的脚本会被加载。
'use strict'

function readIntProp(value, def) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10)
  return def
}

exports.controlCodegen = {
  scriptComponentProps: (p) => ({ language: (p || {})['语言'], timeout: readIntProp((p || {})['超时'], 0) }),
}
