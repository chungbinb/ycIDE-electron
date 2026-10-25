// 插件宿主进程入口。构建产物：out/main/plugin-host.js。插件代码都在这类进程里运行，崩溃不会拖垮 IDE 主进程（设计稿 §2.2）。
// 两种启动方式：
//   - 官方内置插件：Electron utilityProcess，经 process.parentPort 通信；
//   - 第三方插件：child_process.fork（ELECTRON_RUN_AS_NODE，开启 Node 权限模型），经 IPC 通道通信，
//     环境变量 YCIDE_PLUGIN_NET_PERMISSIONS 带上本进程插件获准的 net:<域名> 权限。

import { PluginHostRuntime } from './pluginHostRuntime'
import { installNetGuard } from './pluginNetGuard'
import type { RpcTransport } from '../../shared/plugin/rpc'

function createTransport(): RpcTransport {
  const parentPort = process.parentPort
  if (parentPort) {
    return {
      send: message => parentPort.postMessage(message),
      onMessage: listener => {
        const handler = (event: Electron.MessageEvent): void => listener(event.data)
        parentPort.on('message', handler)
        return () => { parentPort.off('message', handler) }
      },
    }
  }
  if (typeof process.send === 'function') {
    return {
      send: message => { process.send!(message) },
      onMessage: listener => {
        process.on('message', listener)
        return () => { process.off('message', listener) }
      },
    }
  }
  throw new Error('plugin-host 必须由 IDE 主进程启动')
}

const netPermissions = process.env.YCIDE_PLUGIN_NET_PERMISSIONS
if (netPermissions !== undefined) {
  let list: string[] = []
  try { list = JSON.parse(netPermissions) as string[] } catch { list = [] }
  installNetGuard(Array.isArray(list) ? list : [])
}

new PluginHostRuntime(createTransport())
// 父进程断开（IDE 退出或被结束）时随之退出，避免留下孤儿进程
process.on('disconnect', () => process.exit(0))
