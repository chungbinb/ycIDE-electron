// 插件网页 UI（ycide-plugin:// 协议）的内容安全策略。

/**
 * 插件网页只能加载自己目录里的资源；联网（fetch / XHR / WebSocket）只放开插件获准的 net:<域名>（设计稿 §8）。
 * 页面运行在不带 allow-same-origin 的沙箱 iframe 里，只能经 postMessage 与宿主交换数据。
 */
export function buildPluginUiCsp(netPermissions: readonly string[]): string {
  const sources = new Set<string>()
  for (const permission of netPermissions) {
    const domain = permission.slice('net:'.length)
    if (domain === '*') {
      sources.add('https:').add('http:').add('wss:').add('ws:')
      continue
    }
    const hosts = domain.startsWith('*.') ? [domain, domain.slice(2)] : [domain]
    for (const host of hosts) for (const scheme of ['https', 'http', 'wss', 'ws']) sources.add(`${scheme}://${host}`)
  }
  const connect = sources.size > 0 ? `; connect-src ${[...sources].join(' ')}` : ''
  return `default-src 'none'; script-src ycide-plugin: 'unsafe-inline'; style-src ycide-plugin: 'unsafe-inline'; img-src ycide-plugin: data: blob:; font-src ycide-plugin: data:${connect}`
}
