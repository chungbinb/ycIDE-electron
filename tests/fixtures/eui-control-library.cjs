const fs = require('node:fs')
const path = require('node:path')

function createEuiControlLibrary(userData, root) {
  const directory = path.join(userData, 'libraries', 'fixturecontrols')
  fs.mkdirSync(directory, { recursive: true })
  const original = JSON.parse(fs.readFileSync(path.join(root, 'lib', 'eui', 'eui.window-units.json'), 'utf8'))
  const button = structuredClone(original.windowUnits.find(unit => unit.englishName === 'EuiButton'))
  button.toolboxCategory = '跨库测试控件'
  button.events[0].name = '外库单击'
  button.properties.find(property => property.name === '标题').access.set =
    'fixturecontrols_SetCaption(yc_wide_to_utf8({n}), yc_wide_to_utf8({vtext}))'
  const image = structuredClone(original.windowUnits.find(unit => unit.englishName === 'EuiImage'))
  image.englishName = 'ForeignImage'
  image.toolboxCategory = '跨库测试控件'
  fs.writeFileSync(path.join(directory, 'fixturecontrols.window-units.json'), JSON.stringify({ windowUnits: [button, image] }))
  fs.writeFileSync(path.join(directory, 'fixturecontrols.commands.ycmd.json'), JSON.stringify({
    contractVersion: '1.0', library: 'fixturecontrols', libraryDisplayName: '跨库控件测试', libraryVersion: '1.0.0',
    implementations: { windows: { entry: 'runtime.cpp', language: 'cpp' } },
    commands: [{
      commandId: 'fixturecontrols.SetCaption', displayName: '外库置标题', summary: '跨库运行时测试。',
      returnType: '无返回值', category: '测试', supportedPlatforms: ['windows'],
      params: [{ name: '名称', type: '文本型', optional: false }, { name: '标题', type: '文本型', optional: false }],
    }],
  }))
  fs.writeFileSync(path.join(directory, 'runtime.cpp'), `#include <string>
extern "C" void eui_SetText(const char*, const char*);
extern "C" void fixturecontrols_SetCaption(const char* name, const char* text) {
  const auto value = std::string("[external]") + text;
  eui_SetText(name, value.c_str());
}
`)
}

module.exports = { createEuiControlLibrary }
