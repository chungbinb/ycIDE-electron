import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.spec.ts'],
    // 真编译测试（真实调 zig）越加越多：文件级并行会同时拉起多个 zig 进程，
    // Windows 下 spawn 报 SystemResources 大面积假失败。文件间串行、文件内仍并行。
    fileParallelism: false,
  },
})
