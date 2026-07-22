/**
 * 外部链接安全校验：只放行 http/https。
 *
 * 用于「关于」窗等点击跳官网的场景——渲染层传来的 url 视作不可信输入，
 * 主进程调用 shell.openExternal 前必须过这一关，杜绝被诱导打开 file://、
 * 自定义协议或本地可执行文件（那类 URL 可能触发命令执行）。
 */
export function isSafeExternalUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}
