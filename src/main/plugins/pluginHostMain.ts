// 插件宿主进程入口（Electron utilityProcess）。构建产物：out/main/plugin-host.js。
// 第三方 / 用户插件的代码都在这个进程里运行，崩溃不会拖垮 IDE 主进程（设计稿 §2.2）。

import { PluginHostRuntime } from './pluginHostRuntime'
import type { RpcTransport } from '../../shared/plugin/rpc'

const parentPort = process.parentPort
if (!parentPort) {
  throw new Error('plugin-host 必须由 Electron utilityProcess 启动')
}

const transport: RpcTransport = {
  send: message => parentPort.postMessage(message),
  onMessage: listener => {
    const handler = (event: Electron.MessageEvent): void => listener(event.data)
    parentPort.on('message', handler)
    return () => { parentPort.off('message', handler) }
  },
}

new PluginHostRuntime(transport)
