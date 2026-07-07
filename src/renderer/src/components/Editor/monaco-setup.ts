// Monaco 本地化：让 @monaco-editor/react 用本地打包的 monaco 而非默认的 jsdelivr CDN，
// 否则离线/内网环境文本模式编辑器白屏。只引核心编辑器 API（editor.api，不含 50+ 内建语言贡献）——
// eyc 是自注册的自定义语言、无内建语言服务，仅需基础 editor worker。
// 深 ESM 路径经 monaco package.json 的 './*' 通配在打包期解析；该通配无 types 条件，
// tsc(bundler) 找不到 .d.ts，此处抑制——本文件 monaco 仅用于 loader.config，类型无关紧要。
// @ts-expect-error 深路径无类型声明，运行时/打包期正常解析
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { loader } from '@monaco-editor/react'

// 只提供基础编辑器 worker（未引入 ts/json/css/html 的语言 worker）。
;(self as unknown as { MonacoEnvironment?: { getWorker: () => Worker } }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}

// 用本地实例替代 CDN 加载；必须在任何 <MonacoEditor> 首次挂载前执行（本模块在 Editor 顶部 import）。
loader.config({ monaco })
