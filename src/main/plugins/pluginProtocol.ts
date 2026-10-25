// 宿主 ↔ 插件进程之间的 JSON-RPC 消息约定（设计稿 §4）。Node 插件进程与可执行文件插件共用这套消息。
//
// 宿主 → 插件进程（请求）：
//   initialize                       握手，交换协议版本
//   plugin/activate                  加载并激活插件，返回激活期间注册的命令
//   plugin/deactivate                停用插件，回收它注册的一切
//   commands/execute                 执行插件进程里注册的命令
//   shutdown                         停用全部插件，准备退出
// 插件进程 → 宿主（每条都带 pluginId；宿主核对该插件确实在这个进程里，并检查权限，越权返回 -33001）：
//   commands/registered（通知）       插件注册了命令（必须是清单里声明过的）
//   commands/unregistered（通知）     插件注销了命令
//   commands/executeHost（请求）      插件执行宿主侧的命令（内置命令或其他插件的命令）
//   window/showMessage（通知）        插件请求在输出面板显示消息
//   output/append（通知）             往编译输出面板追加一行（编译器插件使用）
//   secrets/get|store|delete（请求）   读写本插件自己的密钥（权限 secrets:own）
//
// 可执行文件插件（runtime.type 为 executable）经 stdin/stdout 收发，按 LSP 的 Content-Length 头分帧
// （src/shared/plugin/stdioTransport.ts）；它声明的命令在激活后由宿主直接登记，不必发 commands/registered。

export const PLUGIN_PROTOCOL_VERSION = '0.2'

export type PluginMessageType = 'info' | 'warning' | 'error' | 'success'

export interface ActivatePluginParams {
  id: string
  /** 插件入口文件的绝对路径（Node 插件） */
  mainPath?: string
  /** 插件目录 */
  extensionPath: string
  /** 插件自己的可写存储目录 */
  storagePath?: string
  /** 清单里声明的命令；只允许注册这些命令 */
  declaredCommands: string[]
}

export interface ExecuteCommandParams {
  command: string
  args?: unknown[]
}

export interface ExecuteHostCommandParams extends ExecuteCommandParams {
  pluginId: string
}

export interface ShowMessageParams {
  pluginId: string
  type: PluginMessageType
  message: string
}

export interface OutputAppendParams {
  pluginId: string
  type: PluginMessageType
  text: string
}

export interface CommandRegistrationParams {
  pluginId: string
  command: string
}

export interface SecretParams {
  pluginId: string
  key: string
  value?: string
}
