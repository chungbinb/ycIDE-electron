const path = require('node:path')

function notImplemented(name) {
  throw new Error(`${name} not implemented`)
}

function getAppRoot() {
  return path.resolve(__dirname, '..', '..', '..')
}

module.exports = {
  getAppRoot,
  launchApp: () => notImplemented('launchApp'),
  closeApp: () => notImplemented('closeApp'),
  openThemeSettings: () => notImplemented('openThemeSettings'),
  setColorTokenByLabel: () => notImplemented('setColorTokenByLabel'),
  readRootCssVar: () => notImplemented('readRootCssVar'),
  clickTokenResetByLabel: () => notImplemented('clickTokenResetByLabel'),
  clickGroupResetByTitle: () => notImplemented('clickGroupResetByTitle'),
  clickGlobalReset: () => notImplemented('clickGlobalReset'),
  acceptNextDialog: () => notImplemented('acceptNextDialog'),
  saveThemePayload: () => notImplemented('saveThemePayload'),
  activateThemeFromSettings: () => notImplemented('activateThemeFromSettings'),
  readFlowConfigVars: () => notImplemented('readFlowConfigVars'),
}
