/// <reference types="vite/client" />
import type { ElectronAPI } from '../../preload/index'

declare global {
  interface Window {
    api: ElectronAPI
  }
}

declare module '*.svg?raw' {
  const content: string
  export default content
}
