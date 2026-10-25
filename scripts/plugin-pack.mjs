#!/usr/bin/env node
// 插件打包与签名（设计稿 §8.2；开发指南 docs/插件开发指南.md「发布」一节）。
//
//   node scripts/plugin-pack.mjs keygen <输出目录>
//       生成发布者密钥：<输出目录>/publisher-private.pem（自己保管，不要提交）与 publisher-public.txt（填进商店索引 publishers）
//   node scripts/plugin-pack.mjs pack <插件目录> <输出目录> [--key publisher-private.pem] [--url-base https://…/]
//       把插件目录打成 <插件ID>-<版本>.zip，计算 sha256，用私钥签名，并打印商店索引条目（JSON）
//   node scripts/plugin-pack.mjs sign-index <index.json> --key publisher-private.pem
//       给商店索引签名，生成 index.json.sig（自建商店在设置里填对应公钥后，IDE 只接受签名有效的索引）
//
// 签名内容是包的 sha256 十六进制字符串，算法 Ed25519；IDE 安装时用索引里该发布者的公钥校验，
// 首次见到的公钥会固定在本机，之后公钥变化即拒绝安装。

import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const AdmZip = require('adm-zip')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function option(args, name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const [command, ...args] = process.argv.slice(2)

if (command === 'keygen') {
  const out = resolve(args[0] || '.')
  mkdirSync(out, { recursive: true })
  const privatePath = join(out, 'publisher-private.pem')
  if (existsSync(privatePath)) fail(`${privatePath} 已存在，不覆盖`)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  writeFileSync(privatePath, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 })
  const publicBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  writeFileSync(join(out, 'publisher-public.txt'), `${publicBase64}\n`)
  console.log(`私钥：${privatePath}（自己保管）`)
  console.log(`公钥（填进商店索引 publishers）：${publicBase64}`)
} else if (command === 'pack') {
  const pluginDir = resolve(args[0] || '')
  const outDir = resolve(args[1] || '.')
  if (!existsSync(join(pluginDir, 'plugin.json'))) fail(`${pluginDir} 下没有 plugin.json`)
  const manifest = JSON.parse(readFileSync(join(pluginDir, 'plugin.json'), 'utf-8').replace(/^﻿/, ''))
  const { id, version, publisher, displayName } = manifest
  if (!id || !version || !publisher) fail('plugin.json 需要 id、version、publisher')
  const zip = new AdmZip()
  zip.addLocalFolder(pluginDir, '', name => !/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(name))
  const buffer = zip.toBuffer()
  mkdirSync(outDir, { recursive: true })
  const fileName = `${id}-${version}.zip`
  writeFileSync(join(outDir, fileName), buffer)
  const sha = createHash('sha256').update(buffer).digest('hex')
  const keyPath = option(args, '--key')
  const signature = keyPath
    ? sign(null, Buffer.from(sha, 'utf-8'), createPrivateKey(readFileSync(resolve(keyPath)))).toString('base64')
    : undefined
  const urlBase = option(args, '--url-base') || 'https://example.com/plugins/'
  const isTheme = !manifest.runtime && (manifest.contributes?.themes?.length ?? 0) > 0 && !manifest.permissions?.length
  const entry = {
    id,
    kind: isTheme ? 'theme' : 'plugin',
    displayName: displayName || id,
    version,
    publisher,
    packageFileName: fileName,
    packageUrl: `${urlBase.replace(/\/?$/, '/')}${fileName}`,
    packageSha256: sha,
    size: buffer.length,
    supportedPlatforms: manifest.platforms ?? ['windows', 'linux', 'macos'],
    summary: manifest.description,
    permissions: manifest.permissions ?? [],
    ...(signature ? { signature } : {}),
  }
  console.log(JSON.stringify(entry, null, 2))
  if (!signature) console.error('提示：没有用 --key 签名，IDE 安装时会提示「未签名」')
} else if (command === 'sign-index') {
  // 给商店索引签名：输出 <索引文件>.sig，与索引放在同一目录（IDE 读取 <索引地址>.sig 校验）
  const indexPath = resolve(args[0] || '')
  const keyPath = option(args, '--key')
  if (!existsSync(indexPath) || !keyPath) fail('用法：node scripts/plugin-pack.mjs sign-index <index.json> --key <私钥.pem>')
  const signature = sign(null, readFileSync(indexPath), createPrivateKey(readFileSync(resolve(keyPath)))).toString('base64')
  writeFileSync(`${indexPath}.sig`, `${signature}\n`)
  console.log(`已生成 ${indexPath}.sig`)
} else {
  fail('用法：\n  node scripts/plugin-pack.mjs keygen <输出目录>\n  node scripts/plugin-pack.mjs pack <插件目录> <输出目录> [--key 私钥.pem] [--url-base 下载地址前缀]\n  node scripts/plugin-pack.mjs sign-index <index.json> --key 私钥.pem')
}
