import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function getEuiBuildTools(appDir: string): { sdk: string; cmake: string; vcvars: string } {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('EUI 目前只验证了 Windows x64 本机构建')
  const sdk = join(appDir, 'lib', 'eui', 'sdk')
  if (!existsSync(join(sdk, 'lib', 'cmake', 'EuiNeo', 'EuiNeoConfig.cmake'))) {
    throw new Error('缺少固定 EUI SDK，请先执行 lib\\eui\\prepare-sdk.ps1（开发期准备，构建时不联网）')
  }
  const vswhere = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (!existsSync(vswhere)) throw new Error('EUI 需要安装 Visual Studio C++ Build Tools、Windows SDK 和 CMake 工具')
  const vs = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8', windowsHide: true }).trim()
  if (!vs) throw new Error('未找到可用的 MSVC C++ 工具链')
  const cmake = join(vs, 'Common7', 'IDE', 'CommonExtensions', 'Microsoft', 'CMake', 'CMake', 'bin', 'cmake.exe')
  const vcvars = join(vs, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
  if (![cmake, vcvars].every(path => existsSync(path))) throw new Error('MSVC 缺少 CMake 或 vcvars64，请安装 C++ CMake 工具')
  return { sdk, cmake, vcvars }
}

export function getMsvcEnvironment(vcvars: string): NodeJS.ProcessEnv {
  const initialized = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', `call "${vcvars}" >nul && set`], { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true })
  if (initialized.error) throw initialized.error
  if (initialized.status !== 0) throw new Error(`MSVC 环境初始化失败：${initialized.stderr}`)
  const output = initialized.stdout
  const env = { ...process.env }
  for (const line of output.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index > 0) env[line.slice(0, index)] = line.slice(index + 1)
  }
  return env
}
