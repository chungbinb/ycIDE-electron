// 网页版（在线编辑器）构建配置：复用渲染层源码，用 src/web/mockApi.ts 代替 Electron 预加载脚本。
// 构建：npm run build:web   产物：out/web（可直接放到任意静态网站子目录）
import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const appVersion: string = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')).version

export default defineConfig({
  root: resolve('src/web'),
  base: './',
  // 构建时生成的支持库数据快照（snapshot.json）放在这里，原样复制到产物根目录
  publicDir: resolve('src/web/public'),
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
    },
  },
  server: {
    fs: { allow: [resolve('.')] },
  },
  build: {
    outDir: resolve('out/web'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/monaco-editor') || id.includes('node_modules/@monaco-editor')) {
            return 'monaco'
          }
          return undefined
        },
      },
    },
  },
  plugins: [react()],
})
