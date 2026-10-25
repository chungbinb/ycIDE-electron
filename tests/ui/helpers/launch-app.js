/**
 * 用独立的临时用户数据目录启动 IDE。
 *
 * 不指定时测试共用本机真实的用户数据：打开的临时项目会挤进「最近打开」、成为「上次项目」，
 * 下一轮启动还会先恢复上一轮的项目，导致测试互相干扰、也污染用户自己的 IDE。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('@playwright/test')

const appRoot = path.resolve(__dirname, '..', '..', '..')

async function launchIsolatedApp(extraEnv = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ycide-userdata-'))
  const app = await electron.launch({
    args: [appRoot, `--user-data-dir=${userData}`],
    cwd: appRoot,
    env: { ...process.env, CI: '1', ...extraEnv },
  })
  return { app, userData }
}

module.exports = { launchIsolatedApp }
