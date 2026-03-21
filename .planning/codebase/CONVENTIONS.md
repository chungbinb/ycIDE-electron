# Coding Conventions

**Analysis Date:** 2026-03-21

## Naming Patterns

**Files:**
- Use `PascalCase.tsx` for React component files in `src/renderer/src/components/**` (examples: `src/renderer/src/components/TitleBar/TitleBar.tsx`, `src/renderer/src/components/Editor/VisualDesigner.tsx`).
- Use `kebab-case.ts` for main-process modules in `src/main/` and preload (`src/main/library-manager.ts`, `src/main/fne-parser.ts`, `src/preload/index.ts`).
- Use `*.spec.js` for Playwright UI tests under `tests/ui/` (`tests/ui/electron-start.spec.js`).

**Functions:**
- Use `camelCase` for functions and handlers (`createWindow` in `src/main/index.ts`, `handleCompileRun` in `src/renderer/src/App.tsx`, `registerEycLanguage` in `src/renderer/src/components/Editor/Editor.tsx`).
- Prefix UI event callbacks with `handle` (`handleOutput`, `handleExit`, `handleLibraryChange` in `src/renderer/src/App.tsx`).

**Variables:**
- Use `camelCase` for local/state variables (`currentProjectDir`, `forceOutputTab` in `src/renderer/src/App.tsx`).
- Use `SCREAMING_SNAKE_CASE` for constants (`CORE_LIB_NAME` in `src/main/library-manager.ts`, `PROJECT_TYPES` in `src/renderer/src/components/NewProjectDialog/NewProjectDialog.tsx`).

**Types:**
- Use `PascalCase` for interfaces/types (`CompileMessage` in `src/main/compiler.ts`, `EditorTab` in `src/renderer/src/components/Editor/Editor.tsx`, `ElectronAPI` in `src/preload/index.ts`).
- Use union literal types for constrained values (`'static' | 'normal'` in `src/main/compiler.ts`, `'project' | 'library' | 'property'` in `src/renderer/src/App.tsx`).

## Code Style

**Formatting:**
- Tool used: Not detected (`.prettierrc`, `prettier` dependency, and format scripts are not present in `package.json`).
- Follow existing style: no trailing semicolons, single quotes, and 2-space indentation (examples across `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/main.tsx`).

**Linting:**
- Tool used: Not detected (`.eslintrc*`, `eslint.config.*`, and lint scripts are not present).
- Enforce quality via TypeScript strict mode in `tsconfig.json` (`"strict": true`) and explicit typing in source files.

## Import Organization

**Order:**
1. Third-party imports (`react`, `electron`, `@monaco-editor/react`) first.
2. Local module imports (`./...`, `../...`) second.
3. CSS imports last in renderer components (`import './Toolbar.css'` in `src/renderer/src/components/Toolbar/Toolbar.tsx`).

**Path Aliases:**
- Alias configured: `@` → `src/renderer/src` in `electron.vite.config.ts`.
- Alias usage in source: Not detected; current imports are predominantly relative paths.

## Error Handling

**Patterns:**
- Use defensive `try/catch` around filesystem/parser/process logic in main process (`src/main/compiler.ts`, `src/main/fne-parser.ts`, `src/main/index.ts`).
- Use fallback returns in catch blocks for recoverable flows (`return []`, `return null`, `return '默认深色'` in `src/main/index.ts`).
- Use `try/finally` for deterministic cleanup in tests and long-lived resources (`tests/ui/electron-start.spec.js` closes Electron app in `finally`).

## Logging

**Framework:** `window.api.debug.logRendererError(...)` bridge + file append in main process.

**Patterns:**
- Renderer captures global errors and unhandled promises in `src/renderer/src/main.tsx` and forwards to preload API.
- Main process persists logs to user-data logs file via `appendRendererErrorLog` in `src/main/index.ts`.

## Comments

**When to Comment:**
- Use section banners and intent comments for non-trivial blocks, especially domain-specific compiler/editor logic (`src/main/compiler.ts`, `src/renderer/src/components/Editor/Editor.tsx`).
- Keep short inline comments for rules and guard behavior (`// 核心库始终加载` in `src/main/library-manager.ts`, `// 开发模式加载 dev server` in `src/main/index.ts`).

**JSDoc/TSDoc:**
- Use JSDoc-style comments on exported interfaces/functions in core modules (`src/main/library-manager.ts`, `src/main/fne-parser.ts`, `src/renderer/src/components/Editor/Editor.tsx`).
- Prefer explicit Chinese domain descriptions where project language semantics are specialized.

## Function Design

**Size:** 
- Keep helper functions small and typed in `src/main/index.ts` and `src/main/fne-parser.ts`.
- Large orchestrator modules exist (`src/main/compiler.ts`, `src/renderer/src/components/Editor/EycTableEditor.tsx`); add new logic as isolated helpers rather than expanding monolithic blocks.

**Parameters:** 
- Use typed object parameters for complex IPC payloads (`project:create` info object in `src/preload/index.ts`, `CompileOptions` in `src/main/compiler.ts`).
- Use literal unions for mode-like parameters (`linkMode`, `arch`, sidebar tabs).

**Return Values:** 
- Annotate return types explicitly (`: void`, `: string | null`, `: Promise<...>`) in main/preload and renderer service boundaries.
- Return structured objects for operation outcomes (`LoadResult` in `src/main/library-manager.ts`, compile result structures in `src/main/compiler.ts`).

## Module Design

**Exports:**
- Use default exports for renderer React components (`src/renderer/src/components/**` and `src/renderer/src/App.tsx`).
- Use named exports for shared types/constants/utilities (`PropertyTypes` in `src/main/fne-parser.ts`, interfaces across `src/main/*.ts`).

**Barrel Files:**
- Barrel file usage: Not detected (`export * from ...` / aggregated index barrels are not present).
- Import components/types directly from concrete module paths.

---

*Convention analysis: 2026-03-21*
