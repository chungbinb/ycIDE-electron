const { defineConfig } = require('@playwright/test')

// 性能测量专用配置：不并行、不重试，只跑 tests/perf
module.exports = defineConfig({
  testDir: '.',
  timeout: 300000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: '../../test-results/perf',
})
