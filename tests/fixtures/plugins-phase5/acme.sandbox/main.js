// 逐项尝试受限操作，返回每一项的结果：成功返回值，失败返回 DENIED:<错误码>
const fs = require('node:fs')
const path = require('node:path')

exports.activate = (context, ycide) => {
  context.subscriptions.push(ycide.commands.registerCommand('sandbox:probe', async (args) => {
    const out = {}
    const attempt = async (label, fn) => {
      try {
        out[label] = await fn()
      } catch (e) {
        const code = (e && (e.code || (e.cause && e.cause.code))) || (e && e.message) || String(e)
        out[label] = 'DENIED:' + code
      }
    }
    await attempt('readOwn', () => fs.readFileSync(__filename, 'utf-8').length > 0)
    await attempt('readOutside', () => fs.readFileSync(args.outsideFile, 'utf-8'))
    await attempt('writeStorage', () => { fs.writeFileSync(path.join(context.storagePath, 'probe.txt'), 'ok'); return 'ok' })
    await attempt('writeOutside', () => { fs.writeFileSync(path.join(args.outsideDir, 'probe.txt'), 'bad'); return 'written' })
    await attempt('spawn', () => require('node:child_process').execFileSync(process.execPath, ['-v']).toString())
    await attempt('envSecret', () => process.env.YCIDE_TEST_SECRET ?? 'absent')
    await attempt('fetchAllowed', async () => (await fetch(args.allowedUrl)).text())
    await attempt('fetchDenied', async () => (await fetch(args.deniedUrl)).text())
    await attempt('workbench', () => ycide.commands.executeCommand('tools:settings'))
    return out
  }))
}
