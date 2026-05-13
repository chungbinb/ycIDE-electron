#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createReadStream, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { cwd, platform, version as nodeVersion } from 'node:process'

function parseArgs(argv) {
  const args = {
    sample: '',
    outputDir: '',
    logs: [],
    detection: '',
    compiler: '',
    target: '',
    mode: '',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]

    if (token === '--sample' && next) {
      args.sample = next
      i += 1
      continue
    }

    if (token === '--out' && next) {
      args.outputDir = next
      i += 1
      continue
    }

    if (token === '--log' && next) {
      args.logs.push(next)
      i += 1
      continue
    }

    if (token === '--detection' && next) {
      args.detection = next
      i += 1
      continue
    }

    if (token === '--compiler' && next) {
      args.compiler = next
      i += 1
      continue
    }

    if (token === '--target' && next) {
      args.target = next
      i += 1
      continue
    }

    if (token === '--mode' && next) {
      args.mode = next
      i += 1
      continue
    }

    if (token === '--help' || token === '-h') {
      printHelpAndExit(0)
    }
  }

  return args
}

function printHelpAndExit(code) {
  console.log('用法: node scripts/security/collect-antivirus-report.mjs --sample <exe路径> [可选参数]')
  console.log('可选参数:')
  console.log('  --out <目录>         自定义输出目录（默认 debug_logs）')
  console.log('  --log <文件路径>     附加日志文件，可重复传入')
  console.log('  --detection <名称>   检测名称，例如 VHO:Trojan-PSW.Win32.ReaderDB.gen')
  console.log('  --compiler <说明>    编译器说明，例如 zig c++')
  console.log('  --target <说明>      目标平台架构，例如 windows-x64')
  console.log('  --mode <说明>        构建模式，例如 运行(宿主平台)')
  process.exit(code)
}

function resolvePath(input) {
  if (!input) return ''
  return isAbsolute(input) ? input : resolve(cwd(), input)
}

function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function sha256(filePath) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolveHash(hash.digest('hex')))
    stream.on('error', rejectHash)
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.sample) {
    console.error('[AV-Report] 缺少 --sample 参数。')
    printHelpAndExit(2)
  }

  const samplePath = resolvePath(args.sample)
  const outputBaseDir = resolvePath(args.outputDir || 'debug_logs')
  const now = new Date()
  const ticketId = `av-report-${formatTimestamp(now)}`
  const reportDir = join(outputBaseDir, ticketId)
  const attachmentsDir = join(reportDir, 'attachments')

  mkdirSync(attachmentsDir, { recursive: true })

  const pkg = JSON.parse(readFileSync(resolve(cwd(), 'package.json'), 'utf-8'))
  const sampleExists = existsSync(samplePath)

  const report = {
    generatedAt: now.toISOString(),
    ticketId,
    environment: {
      platform,
      nodeVersion,
      workspace: cwd(),
    },
    project: {
      name: pkg.name || 'unknown',
      version: pkg.version || '0.0.0',
    },
    build: {
      compiler: args.compiler || 'unknown',
      target: args.target || 'unknown',
      mode: args.mode || 'unknown',
    },
    sample: {
      path: samplePath,
      exists: sampleExists,
      fileName: basename(samplePath),
      size: sampleExists ? statSync(samplePath).size : null,
      sha256: sampleExists ? await sha256(samplePath) : null,
    },
    detection: {
      engine: 'unknown',
      name: args.detection || 'unknown',
    },
    logs: [],
  }

  if (sampleExists) {
    const copyTarget = join(attachmentsDir, basename(samplePath))
    copyFileSync(samplePath, copyTarget)
    report.sample.copiedTo = copyTarget
  }

  for (const log of args.logs) {
    const fullLogPath = resolvePath(log)
    const item = {
      input: log,
      path: fullLogPath,
      exists: existsSync(fullLogPath),
      copiedTo: null,
    }

    if (item.exists) {
      const copyTarget = join(attachmentsDir, basename(fullLogPath))
      copyFileSync(fullLogPath, copyTarget)
      item.copiedTo = copyTarget
    }

    report.logs.push(item)
  }

  const reportPath = join(reportDir, 'report.json')
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')

  const readmePath = join(reportDir, 'README.txt')
  const summaryLines = [
    `Ticket: ${ticketId}`,
    `Generated: ${report.generatedAt}`,
    `Project: ${report.project.name}@${report.project.version}`,
    `Sample: ${report.sample.path}`,
    `Sample Exists: ${report.sample.exists}`,
    `SHA256: ${report.sample.sha256 || 'N/A'}`,
    `Detection: ${report.detection.name}`,
    `Compiler: ${report.build.compiler}`,
    `Target: ${report.build.target}`,
    `Mode: ${report.build.mode}`,
    '',
    '说明: 将本目录提供给杀软厂商误报申诉渠道。',
  ]
  writeFileSync(readmePath, `${summaryLines.join('\n')}\n`, 'utf-8')

  console.log(`[AV-Report] 已生成: ${reportPath}`)
  console.log(`[AV-Report] 附件目录: ${attachmentsDir}`)
}

main().catch((error) => {
  console.error(`[AV-Report] 执行失败: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
