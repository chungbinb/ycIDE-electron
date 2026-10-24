// 宿主 ↔ 插件宿主进程之间的 JSON-RPC 消息约定（阶段 0 子集，设计稿 §4）。
//
// 宿主 → 插件进程（请求）：
//   initialize                       握手，交换协议版本
//   plugin/activate                  加载并激活插件，返回激活期间注册的命令
//   plugin/deactivate                停用插件，回收它注册的一切
//   commands/execute                 执行插件进程里注册的命令
//   shutdown                         停用全部插件，准备退出
// 插件进程 → 宿主：
//   commands/registered（通知）       插件注册了命令
//   commands/unregistered（通知）     插件注销了命令
//   commands/executeHost（请求）      插件执行宿主侧的命令（内置命令或其他插件的命令）
//   window/showMessage（通知）        插件请求在输出面板显示消息

export const PLUGIN_PROTOCOL_VERSION = '0.1'

export type PluginMessageType = 'info' | 'warning' | 'error' | 'success'

export interface ActivatePluginParams {
  id: string
  /** 插件入口文件的绝对路径 */
  mainPath: string
  /** 插件目录 */
  extensionPath: string
  /** 清单里声明的命令；只允许注册这些命令 */
  declaredCommands: string[]
}

export interface ExecuteCommandParams {
  command: string
  args?: unknown[]
}

export interface ShowMessageParams {
  pluginId: string
  type: PluginMessageType
  message: string
}

export interface CommandRegistrationParams {
  pluginId: string
  command: string
}
