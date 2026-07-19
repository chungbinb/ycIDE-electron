/// <reference types="vite/client" />
import type { ElectronAPI } from '../preload/index'

declare global {
  interface Window {
    api: ElectronAPI
  }
  // 由 electron.vite.config.ts 的 define 注入；版本号单一来源 = package.json 的 version
  const __APP_VERSION__: string
}

declare module '*.svg?raw' {
  const content: string
  export default content
}

declare module '*.svg' {
  const content: string
  export default content
}
