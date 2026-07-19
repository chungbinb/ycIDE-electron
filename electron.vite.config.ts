import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// 版本号单一来源：只维护 package.json 的 version，构建时注入渲染层全局 __APP_VERSION__，
// 避免改版本号时还要同步 App.tsx / StatusBar.tsx 等多处硬编码。
const appVersion: string = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')).version

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // hidden：产出 .map 供崩溃栈还原，但不在产物里引用（打包时经 build.files 排除，不进 asar）
      sourcemap: 'hidden',
      rollupOptions: {
        external: ['fsevents'],
        // 主进程入口 + 编译工作线程入口，各自打包到 out/main/<name>.js
        input: {
          index: resolve('src/main/index.ts'),
          'compile-worker': resolve('src/main/compile-worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['fsevents']
      }
    }
  },
  renderer: {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion)
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    build: {
      sourcemap: 'hidden',
      rollupOptions: {
        output: {
          // 把本地打包的 monaco 切成独立 chunk：主 index 包更小、缓存友好
          manualChunks(id: string) {
            if (id.includes('node_modules/monaco-editor') || id.includes('node_modules/@monaco-editor')) {
              return 'monaco'
            }
            return undefined
          },
        },
      },
    },
    plugins: [react()]
  }
})
