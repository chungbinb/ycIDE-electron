import { generateCommonDebugRuntimeCode } from './common'
import { generateWindowsDebugRuntimeCode } from './windows'
import { generateMacosDebugRuntimeCode } from './macos'
import { generateLinuxDebugRuntimeCode } from './linux'

export type DebugRuntimeTargetPlatform = 'windows' | 'macos' | 'linux'

export function generateDebugRuntimeCode(targetPlatform: DebugRuntimeTargetPlatform): string {
  let result = generateCommonDebugRuntimeCode()
  if (targetPlatform === 'macos') {
    result += generateMacosDebugRuntimeCode()
  } else if (targetPlatform === 'linux') {
    result += generateLinuxDebugRuntimeCode()
  } else {
    result += generateWindowsDebugRuntimeCode()
  }
  return result
}
