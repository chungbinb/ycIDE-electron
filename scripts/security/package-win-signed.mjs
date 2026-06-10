#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

function run(command, args, step) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    env: process.env,
  })

  if (result.error) {
    console.error(`[签名打包] ${step} 启动失败: ${result.error.message}`)
    process.exit(1)
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    console.error(`[签名打包] ${step} 失败，退出码: ${result.status}`)
    process.exit(result.status)
  }
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'

const certFile = (process.env.YCIDE_WIN_CERT_FILE || '').trim()
const certPassword = process.env.YCIDE_WIN_CERT_PASSWORD || ''
const timestampUrl = (process.env.YCIDE_WIN_TIMESTAMP_URL || '').trim()
const publisherName = (process.env.YCIDE_WIN_PUBLISHER_NAME || '').trim()
const requireSign = process.env.YCIDE_REQUIRE_WIN_SIGN === '1'

if (requireSign && !certFile) {
  console.error('[签名打包] 已设置 YCIDE_REQUIRE_WIN_SIGN=1，但未提供 YCIDE_WIN_CERT_FILE。')
  process.exit(2)
}

const builderArgs = ['electron-builder', '--win']

if (certFile) {
  builderArgs.push(`--config.win.certificateFile=${certFile}`)
}

if (certPassword) {
  builderArgs.push(`--config.win.certificatePassword=${certPassword}`)
}

if (timestampUrl) {
  builderArgs.push(`--config.win.rfc3161TimeStampServer=${timestampUrl}`)
}

if (publisherName) {
  builderArgs.push(`--config.win.publisherName=${publisherName}`)
}

console.log('[签名打包] Step 1/2: 执行前端与主进程构建...')
run(npmCmd, ['run', 'build'], 'electron-vite build')

if (certFile) {
  console.log(`[签名打包] Step 2/2: 打包并签名（证书: ${certFile}）...`)
} else {
  console.warn('[签名打包] Step 2/2: 未检测到 YCIDE_WIN_CERT_FILE，将执行未签名 Windows 打包。')
}

run(npxCmd, builderArgs, 'electron-builder --win')
console.log('[签名打包] 完成。')
