// ESLint 9 flat config
// 首期策略：存量代码报错大头降为 warn，只让新增的严重问题阻断 CI；后续逐步收紧。
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  // 全局忽略：构建产物、子项目（C#/C++）、二进制与数据资源
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'EProjectFile/**',
      'TextECode/**',
      'e-packager/**',
      'compiler/**',
      'lib/**',
      'themes/**',
      'resources/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },

  // TypeScript 源码（main / preload / renderer / shared）
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommended],
    rules: {
      // 存量代码降噪：以下规则保持提醒但不阻断
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
    },
  },

  // 渲染进程：浏览器环境 + React Hooks 规则
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Web Worker 文件单独环境
  {
    files: ['src/renderer/**/*.worker.ts'],
    languageOptions: {
      globals: { ...globals.worker },
    },
  },

  // 主进程与 preload：Node 环境
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/shared/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // 脚本与测试（.mjs / .js）：Node 环境
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.{mjs,js}', 'playwright.config.js', 'electron.vite.config.ts', 'vitest.config.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Playwright 测试与配置目前是 CommonJS 风格
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
)
