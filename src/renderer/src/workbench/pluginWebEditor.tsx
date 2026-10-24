// 插件网页编辑器的宿主（设计稿 §6.3、§7）：插件页面运行在沙箱 iframe（不带 allow-same-origin，
// 不能访问宿主页面、不能联网），与宿主只经 postMessage 交换下列消息：
//
//   编辑器 → 宿主  { type: 'editor/ready' }                         页面就绪，请求文档
//   宿主 → 编辑器  { type: 'editor/open', uri, label, language, text, theme }
//   宿主 → 编辑器  { type: 'editor/didChangeDocument', text }        文档被别处修改（撤销、AI 编辑、外部修改）
//   编辑器 → 宿主  { type: 'documents/applyEdit', text }            用新内容替换整个文档（未保存，可撤销）

import { useCallback, useEffect, useRef } from 'react'
import type { EditorEntry } from '../../../shared/plugin/editorContributions'

export const PLUGIN_UI_SCHEME = 'ycide-plugin'

export interface PluginWebEditorProps {
  editor: EditorEntry
  uri: string
  label: string
  language: string
  text: string
  themeTokenValues?: Record<string, string>
  onChange: (text: string) => void
}

export function pluginUiUrl(pluginId: string, entry: string): string {
  const path = entry.split(/[\\/]+/).map(encodeURIComponent).join('/')
  return `${PLUGIN_UI_SCHEME}://${pluginId}/${path}`
}

export default function PluginWebEditor({ editor, uri, label, language, text, themeTokenValues, onChange }: PluginWebEditorProps): React.JSX.Element {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const readyRef = useRef(false)
  // 编辑器自己提交的内容：回显时不再作为外部修改发回去，避免编辑器光标被打断
  const lastFromEditorRef = useRef<string | null>(null)
  const latest = useRef({ uri, label, language, text, themeTokenValues, onChange })
  latest.current = { uri, label, language, text, themeTokenValues, onChange }

  const post = useCallback((message: unknown) => {
    frameRef.current?.contentWindow?.postMessage(message, '*')
  }, [])

  const sendOpen = useCallback(() => {
    const cur = latest.current
    post({ type: 'editor/open', uri: cur.uri, label: cur.label, language: cur.language, text: cur.text, theme: cur.themeTokenValues ?? {} })
  }, [post])

  useEffect(() => {
    const handler = (event: MessageEvent): void => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return
      const data = event.data as { type?: unknown; text?: unknown } | null
      if (!data || typeof data.type !== 'string') return
      if (data.type === 'editor/ready') {
        readyRef.current = true
        sendOpen()
      } else if (data.type === 'documents/applyEdit' && typeof data.text === 'string') {
        lastFromEditorRef.current = data.text
        latest.current.onChange(data.text)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [sendOpen])

  // 换了文档：重新发送 editor/open
  useEffect(() => {
    if (readyRef.current) sendOpen()
  }, [uri, sendOpen])

  // 文档被别处修改：通知编辑器
  useEffect(() => {
    if (!readyRef.current) return
    if (text === lastFromEditorRef.current) return
    post({ type: 'editor/didChangeDocument', text })
  }, [text, post])

  return (
    <iframe
      ref={frameRef}
      className="plugin-web-editor"
      title={`${editor.displayName}：${label}`}
      src={pluginUiUrl(editor.pluginId, (editor.ui as { entry: string }).entry)}
      sandbox="allow-scripts"
      onLoad={() => { readyRef.current = false }}
      style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: 'var(--editor-bg, transparent)' }}
    />
  )
}
