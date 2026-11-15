import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const provider = 'ycide.eui.selfdraw'
const theme = JSON.parse(readFileSync(new URL('theme-tokens.json', import.meta.url), 'utf8'))
const property = (name, englishName, typeName, defaultValue, access, pickOptions = []) =>
  ({ name, englishName, type: 0, typeName, defaultValue, access, pickOptions, isReadOnly: false, description: `${name}属性。` })
const number = name => ({
  get: `eui_GetNumber(yc_wide_to_utf8({n}), "${name}")`,
  set: `eui_SetNumber(yc_wide_to_utf8({n}), "${name}", {v})`,
})
const text = {
  get: 'yc_utf8_to_wide(eui_GetText(yc_wide_to_utf8({n})))',
  set: 'eui_SetText(yc_wide_to_utf8({n}), yc_wide_to_utf8({vtext}))',
}
const common = [
  property('左边', 'Left', '整数型', 0, number('left')),
  property('顶边', 'Top', '整数型', 0, number('top')),
  property('宽度', 'Width', '整数型', 120, number('width')),
  property('高度', 'Height', '整数型', 36, number('height')),
  property('可视', 'Visible', '逻辑型', true, number('visible')),
  property('禁止', 'Disabled', '逻辑型', false, number('disabled')),
]
const event = name => ({ name, description: `${name}时触发。`, args: [] })
const euiProviderBindings = [
  ...['标题'].flatMap(member => ['Button', 'Static', 'CheckBox', 'RadioButton', 'GroupBox'].map(unitEnglishName => ({
    library: 'krnln', uiProvider: provider, unitEnglishName, member,
    get: 'yc_utf8_to_wide(eui_GetText(yc_wide_to_utf8({n})))',
    set: 'eui_SetText(yc_wide_to_utf8({n}), yc_wide_to_utf8({vtext}))',
  }))),
  {
    library: 'krnln', uiProvider: provider, unitEnglishName: 'Edit', member: '内容',
    get: 'yc_utf8_to_wide(eui_GetText(yc_wide_to_utf8({n})))',
    set: 'eui_SetText(yc_wide_to_utf8({n}), yc_wide_to_utf8({vtext}))',
  },
  {
    library: 'webview2', uiProvider: provider, unitEnglishName: 'WebButton', member: '标题',
    get: 'yc_utf8_to_wide(eui_GetText(yc_wide_to_utf8({n})))',
    set: 'eui_SetText(yc_wide_to_utf8({n}), yc_wide_to_utf8({vtext}))',
  },
  {
    library: 'webview2', uiProvider: provider, unitEnglishName: 'WebEdit', member: '内容',
    get: 'yc_utf8_to_wide(eui_GetText(yc_wide_to_utf8({n})))',
    set: 'eui_SetText(yc_wide_to_utf8({n}), yc_wide_to_utf8({vtext}))',
  },
  ...[
    ['PictureBox', '图片', 'text'],
    ['SliderBar', '最小位置', 'min'], ['SliderBar', '最大位置', 'max'], ['SliderBar', '位置', 'value'],
    ['ProgressBar', '最小位置', 'min'], ['ProgressBar', '最大位置', 'max'], ['ProgressBar', '位置', 'value'],
    ['CheckBox', '选中', 'checked'], ['RadioButton', '选中', 'checked'],
  ].map(([unitEnglishName, member, field]) => ({
    library: 'krnln', uiProvider: provider, unitEnglishName, member,
    get: `eui_GetNumber(yc_wide_to_utf8({n}), "${field}")`,
    set: `eui_SetNumber(yc_wide_to_utf8({n}), "${field}", {v})`,
  })),
  ...['left', 'top', 'width', 'height', 'visible', 'disabled'].map(field => ({
    library: 'krnln', uiProvider: provider, unit: '*',
    member: ({ left: '左边', top: '顶边', width: '宽度', height: '高度', visible: '可视', disabled: '禁止' })[field],
    get: `eui_GetNumber(yc_wide_to_utf8({n}), "${field}")`,
    set: `eui_SetNumber(yc_wide_to_utf8({n}), "${field}", {v})`,
  })),
  ...['left', 'top', 'width', 'height', 'visible', 'disabled'].map(field => ({
    library: 'webview2', uiProvider: provider, unit: '*',
    member: ({ left: '左边', top: '顶边', width: '宽度', height: '高度', visible: '可视', disabled: '禁止' })[field],
    get: `eui_GetNumber(yc_wide_to_utf8({n}), "${field}")`,
    set: `eui_SetNumber(yc_wide_to_utf8({n}), "${field}", {v})`,
  })),
  {
    library: 'webview2', uiProvider: provider, unitEnglishName: 'WebView', member: '地址',
    get: 'yc_utf8_to_wide(eui_GetText(yc_wide_to_utf8({n})))',
    set: 'eui_SetText(yc_wide_to_utf8({n}), yc_wide_to_utf8({vtext}))',
  },
]
const unit = (name, englishName, previewType, properties, events = [], topLevel = false) => ({
  name, englishName, previewType, topLevel,
  ...(topLevel
    ? { uiProviders: [provider], supportedTargets: ['windows-x64'] }
    : { controlAdapters: ['eui'], supportedTargets: ['windows-x64'], runtimeType: englishName }),
  ...(topLevel ? { previewTheme: theme } : {}),
  iconFileName: ({ 按钮: 'Button.svg', 编辑框: 'TextBox.svg', 标签: 'Label.svg', 图片框: 'Image.svg' })[previewType] || '',
  description: 'EUI 自绘组件（实验）；不提供 Win32 原生句柄。', className: '', style: '',
  toolboxCategory: 'EUI自绘控件', properties: [...(topLevel ? common.filter(property => ['宽度', '高度'].includes(property.name)) : common), ...properties], events: events.map(event),
})
const units = [
  unit('EUI窗口', 'EuiWindow', '窗口', [
    property('标题', 'Title', '文本型', '', text),
    property('深色主题', 'DarkTheme', '逻辑型', false, number('dark')),
  ], ['创建完毕'], true),
  unit('EUI按钮', 'EuiButton', '按钮', [property('标题', 'Caption', '文本型', '按钮', text)], ['被单击']),
  unit('EUI编辑框', 'EuiInput', '编辑框', [
    property('内容', 'Text', '文本型', '', text),
    property('是否允许多行', 'Multiline', '逻辑型', false, number('multiline')),
  ], ['内容被改变']),
  unit('EUI标签', 'EuiLabel', '标签', [property('标题', 'Caption', '文本型', '标签', text)]),
  unit('EUI图片框', 'EuiImage', '图片框', [
    property('图片', 'Source', '文本型', '', text),
  ]),
]
const command = (id, name, returnType, params) => ({
  commandId: `eui.${id}`, displayName: name, summary: 'EUI 控件状态与窗口运行时接口（实验）。',
  returnType, category: 'EUI窗口', supportedPlatforms: ['windows'],
  params: params.map(([name, type]) => ({ name, type, optional: false, description: name })),
})
const commands = [
  command('GetText', 'EUI取文本', '文本型', [['名称', '文本型']]),
  command('SetText', 'EUI置文本', '无返回值', [['名称', '文本型'], ['文本', '文本型']]),
  command('GetNumber', 'EUI取数值属性', '整数型', [['名称', '文本型'], ['属性', '文本型']]),
  command('SetNumber', 'EUI置数值属性', '无返回值', [['名称', '文本型'], ['属性', '文本型'], ['数值', '整数型']]),
  { ...command('OpenWindow', 'EUI显示窗口', '整数型', [['窗口名称', '文本型'], ['模态', '逻辑型']]),
    summary: '异步显示本项目中的 EUI 窗口，立即返回；模态时限制主窗口输入，关闭后恢复。不具有 Win32 同步载入的等待语义。' },
]
const output = (name, value) => writeFileSync(fileURLToPath(new URL(name, import.meta.url)), `${JSON.stringify(value, null, 2)}\n`)
const color = value => `{${value.map(channel => `${Number(channel).toFixed(10)}f`).join(',')}}`
const themeMembers = ['background', 'primary', 'surface', 'surfaceHover', 'surfaceActive', 'text', 'border']
const header = `#pragma once
#include "components/theme.h"
namespace yc_eui {
${['titlebarHeight', 'captionButtonWidth', 'titleFontSize', 'windowBorderWidth'].map(key => `inline constexpr float ${key} = ${Number(theme[key]).toFixed(10)}f;`).join('\n')}
inline auto projectTheme(bool dark) {
    auto tokens = dark ? components::theme::dark() : components::theme::light();
${themeMembers.map(key => `    tokens.${key} = dark ? core::Color${color(theme.dark[key])} : core::Color${color(theme.light[key])};`).join('\n')}
    tokens.metrics.typography.body = ${theme.bodyFontSize}.0f;
    tokens.metrics.typography.input = ${theme.bodyFontSize}.0f;
    tokens.metrics.radius.overlay = ${theme.buttonRadius}.0f;
    tokens.metrics.radius.small = ${theme.inputRadius}.0f;
    return tokens;
}
${['buttonText', 'buttonHover', 'buttonPressed'].map(key => `inline core::Color project_${key}(bool dark) { return dark ? core::Color${color(theme.dark[key])} : core::Color${color(theme.light[key])}; }`).join('\n')}
}
`
writeFileSync(fileURLToPath(new URL('theme-tokens.h', import.meta.url)), header)
output('eui.window-units.json', {
  version: '1.0', description: 'EUI 自绘窗口元数据。由 generate-metadata.mjs 生成。',
  controlMemberBindings: euiProviderBindings,
  controlMethodBindings: [{ unit: 'EUI窗口', unitEnglishName: 'EuiWindow', member: '销毁', call: 'yc_win_destroy({n})' }],
  windowUnits: units,
})
output('eui.commands.ycmd.json', {
  contractVersion: '1.0', library: 'eui', libraryDisplayName: 'EUI 自绘窗口支持库（实验）', libraryVersion: '0.1.0',
  implementations: { windows: { entry: 'runtime.cpp', language: 'cpp' } }, commands,
})
output('eui.library.json', { description: 'EUI-NEO v0.6.3 自绘窗口实验接入；Windows x64；尚无系统读屏桥接。', author: 'ycIDE', homePage: 'https://github.com/sudoevolve/EUI-NEO' })
