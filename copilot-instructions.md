<!-- GSD:project-start source:PROJECT.md -->
## Project

**ycIDE Support Library Migration**

This project modernizes the existing ycIDE ecosystem by migrating third-party 易语言功能库/界面库 that are still outside `支持库源码` into the repository’s support-library source tree.  
The current focus is a brownfield conversion effort: convert GBK-encoded libraries to UTF-8 and complete x64-capable adaptation for all not-yet-migrated libraries in `第三方相关文件`.

**Core Value:** All targeted third-party libraries are migrated into `支持库源码` with UTF-8 encoding and x64 support, so they can be reliably maintained and built within ycIDE.

### Constraints

- **Compatibility**: Must preserve existing ycIDE support-library consumption flow — migration outputs need to work with current loader/compiler integration.
- **Scope**: Migration-only delivery — exclude unrelated feature work even if adjacent opportunities appear.
- **Platform**: Windows-centric toolchain and x64 target support are required for the migrated libraries.
- **Source Diversity**: Inputs may vary in encoding/layout in `第三方相关文件`, requiring careful per-library handling.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript - Main app code across Electron main, preload, and renderer in `src/main/*.ts`, `src/preload/index.ts`, and `src/renderer/src/**/*.tsx`.
- JavaScript - Test/config scripts in `playwright.config.js` and `tests/ui/electron-start.spec.js`.
- PowerShell - Repo automation script in `do_convert.ps1`.
- Python - Repo conversion utility in `convert_commobj.py`.
## Runtime
- Node.js runtime for Electron app/tooling (local detected: `v24.13.0` via `node -v`).
- Electron runtime for packaged desktop app from `electron` dependency in `package.json`.
- npm (local detected: `11.6.2` via `npm -v`)
- Lockfile: present (`package-lock.json`)
## Frameworks
- Electron `^34.0.0` - Desktop shell and main-process APIs (`src/main/index.ts`, `src/preload/index.ts`).
- React `^19.0.0` + React DOM `^19.0.0` - Renderer UI (`src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`).
- Monaco Editor (`@monaco-editor/react` + `monaco-editor`) - Code editor integration (`src/renderer/src/components/Editor/Editor.tsx`).
- Playwright `^1.52.0` (`@playwright/test`) - Electron UI smoke/startup testing (`playwright.config.js`, `tests/ui/electron-start.spec.js`).
- electron-vite `^3.0.0` - Unified Electron build/dev for main/preload/renderer (`electron.vite.config.ts`, scripts in `package.json`).
- Vite `^6.0.0` + `@vitejs/plugin-react` `^4.3.0` - Renderer bundling with React plugin (`electron.vite.config.ts`).
- electron-builder `^25.0.0` - Platform packaging (`package.json` `build` section and `package:win|mac|linux` scripts).
- TypeScript `^5.7.0` - Type checking/build config (`tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`).
## Key Dependencies
- `electron` - App lifecycle, browser window, IPC transport (`src/main/index.ts`, `src/preload/index.ts`).
- `koffi` - Native FFI bridge used to load and decode `.fne` support libraries (`src/main/fne-parser.ts`).
- `@monaco-editor/react` / `monaco-editor` - Core editing experience (`src/renderer/src/components/Editor/Editor.tsx`).
- `electron-vite` - Build orchestration for all Electron targets (`electron.vite.config.ts`).
- `electron-builder` - Generates distributables and copies bundled assets (`package.json` `build.files` and `build.extraFiles`).
- `pinyin-pro` - Chinese text/pinyin processing dependency used in renderer-side features (declared in `package.json` dependencies).
## Configuration
- Development renderer URL is environment-driven: `process.env['ELECTRON_RENDERER_URL']` in `src/main/index.ts`.
- Test execution injects CI flag: `CI=1` in `tests/ui/electron-start.spec.js`.
- `.env*` files: Not detected in repository root during analysis.
- App/build scripts and packaging metadata: `package.json`.
- Electron-Vite bundling and alias (`@` → `src/renderer/src`): `electron.vite.config.ts`.
- TypeScript project references and strict options: `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`.
- Playwright test runtime config: `playwright.config.js`.
## Platform Requirements
- Node.js + npm for scripts in `package.json`.
- Windows-oriented native toolchain assets expected under `compiler/` (e.g., `compiler/zig/zig.exe`) and consumed by compiler flow in `src/main/compiler.ts`.
- Local resource folders required by packaging and runtime: `compiler/`, `lib/`, `static_lib/`, `themes/` (from `package.json` `build.extraFiles`).
- Desktop distribution target via Electron Builder to `dist/` (`package.json` `build.directories.output`).
- Targets configured: Windows `dir`, macOS `dmg`, Linux `AppImage` and `deb` (`package.json` `build.win|mac|linux`).
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- Use `PascalCase.tsx` for React component files in `src/renderer/src/components/**` (examples: `src/renderer/src/components/TitleBar/TitleBar.tsx`, `src/renderer/src/components/Editor/VisualDesigner.tsx`).
- Use `kebab-case.ts` for main-process modules in `src/main/` and preload (`src/main/library-manager.ts`, `src/main/fne-parser.ts`, `src/preload/index.ts`).
- Use `*.spec.js` for Playwright UI tests under `tests/ui/` (`tests/ui/electron-start.spec.js`).
- Use `camelCase` for functions and handlers (`createWindow` in `src/main/index.ts`, `handleCompileRun` in `src/renderer/src/App.tsx`, `registerEycLanguage` in `src/renderer/src/components/Editor/Editor.tsx`).
- Prefix UI event callbacks with `handle` (`handleOutput`, `handleExit`, `handleLibraryChange` in `src/renderer/src/App.tsx`).
- Use `camelCase` for local/state variables (`currentProjectDir`, `forceOutputTab` in `src/renderer/src/App.tsx`).
- Use `SCREAMING_SNAKE_CASE` for constants (`CORE_LIB_NAME` in `src/main/library-manager.ts`, `PROJECT_TYPES` in `src/renderer/src/components/NewProjectDialog/NewProjectDialog.tsx`).
- Use `PascalCase` for interfaces/types (`CompileMessage` in `src/main/compiler.ts`, `EditorTab` in `src/renderer/src/components/Editor/Editor.tsx`, `ElectronAPI` in `src/preload/index.ts`).
- Use union literal types for constrained values (`'static' | 'normal'` in `src/main/compiler.ts`, `'project' | 'library' | 'property'` in `src/renderer/src/App.tsx`).
## Code Style
- Tool used: Not detected (`.prettierrc`, `prettier` dependency, and format scripts are not present in `package.json`).
- Follow existing style: no trailing semicolons, single quotes, and 2-space indentation (examples across `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/main.tsx`).
- Tool used: Not detected (`.eslintrc*`, `eslint.config.*`, and lint scripts are not present).
- Enforce quality via TypeScript strict mode in `tsconfig.json` (`"strict": true`) and explicit typing in source files.
## Import Organization
- Alias configured: `@` → `src/renderer/src` in `electron.vite.config.ts`.
- Alias usage in source: Not detected; current imports are predominantly relative paths.
## Error Handling
- Use defensive `try/catch` around filesystem/parser/process logic in main process (`src/main/compiler.ts`, `src/main/fne-parser.ts`, `src/main/index.ts`).
- Use fallback returns in catch blocks for recoverable flows (`return []`, `return null`, `return '默认深色'` in `src/main/index.ts`).
- Use `try/finally` for deterministic cleanup in tests and long-lived resources (`tests/ui/electron-start.spec.js` closes Electron app in `finally`).
## Logging
- Renderer captures global errors and unhandled promises in `src/renderer/src/main.tsx` and forwards to preload API.
- Main process persists logs to user-data logs file via `appendRendererErrorLog` in `src/main/index.ts`.
## Comments
- Use section banners and intent comments for non-trivial blocks, especially domain-specific compiler/editor logic (`src/main/compiler.ts`, `src/renderer/src/components/Editor/Editor.tsx`).
- Keep short inline comments for rules and guard behavior (`// 核心库始终加载` in `src/main/library-manager.ts`, `// 开发模式加载 dev server` in `src/main/index.ts`).
- Use JSDoc-style comments on exported interfaces/functions in core modules (`src/main/library-manager.ts`, `src/main/fne-parser.ts`, `src/renderer/src/components/Editor/Editor.tsx`).
- Prefer explicit Chinese domain descriptions where project language semantics are specialized.
## Function Design
- Keep helper functions small and typed in `src/main/index.ts` and `src/main/fne-parser.ts`.
- Large orchestrator modules exist (`src/main/compiler.ts`, `src/renderer/src/components/Editor/EycTableEditor.tsx`); add new logic as isolated helpers rather than expanding monolithic blocks.
- Use typed object parameters for complex IPC payloads (`project:create` info object in `src/preload/index.ts`, `CompileOptions` in `src/main/compiler.ts`).
- Use literal unions for mode-like parameters (`linkMode`, `arch`, sidebar tabs).
- Annotate return types explicitly (`: void`, `: string | null`, `: Promise<...>`) in main/preload and renderer service boundaries.
- Return structured objects for operation outcomes (`LoadResult` in `src/main/library-manager.ts`, compile result structures in `src/main/compiler.ts`).
## Module Design
- Use default exports for renderer React components (`src/renderer/src/components/**` and `src/renderer/src/App.tsx`).
- Use named exports for shared types/constants/utilities (`PropertyTypes` in `src/main/fne-parser.ts`, interfaces across `src/main/*.ts`).
- Barrel file usage: Not detected (`export * from ...` / aggregated index barrels are not present).
- Import components/types directly from concrete module paths.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Keep OS access and process control in the Electron main process (`src/main/index.ts`, `src/main/compiler.ts`, `src/main/library-manager.ts`).
- Expose only approved capabilities to UI through preload `contextBridge` APIs (`src/preload/index.ts`).
- Keep UI state and interaction logic in a single renderer root orchestration component (`src/renderer/src/App.tsx`) plus focused feature components under `src/renderer/src/components/`.
## Layers
- Purpose: Own app lifecycle, window lifecycle, filesystem/project mutations, compilation, theme persistence, and support-library management.
- Location: `src/main/index.ts`
- Contains: `app.whenReady`, `createWindow`, all `ipcMain.on` and `ipcMain.handle` channel registrations (project/file/library/theme/compiler/debug/dialog/window).
- Depends on: Electron APIs (`app`, `BrowserWindow`, `ipcMain`, `dialog`, `shell`), Node FS/path modules, `compileProject` from `src/main/compiler.ts`, and `libraryManager` from `src/main/library-manager.ts`.
- Used by: `src/preload/index.ts` invokes these handlers via `ipcRenderer.invoke/send`.
- Purpose: Parse `.epp`, transform Yi-language source + form metadata into generated C/C++, invoke Zig/MSVC SDK toolchain, copy runtime dependencies, and run/stop executable processes.
- Location: `src/main/compiler.ts`
- Contains: toolchain discovery (`findZigCompiler`), project parsing (`parseEppFile`), code generation (`generateMainC`, command/event generation helpers), compile orchestration (`compileProject`), runtime execution (`runExecutable`, `stopExecutable`, `isRunning`).
- Depends on: filesystem, child process execution, and loaded support-library metadata (`libraryManager.getLoadedLibraryFiles`, `libraryManager.getAllCommands`, `libraryManager.getAllWindowUnits`).
- Used by: IPC handlers `compiler:compile`, `compiler:run`, `compiler:stop`, `compiler:isRunning` in `src/main/index.ts`.
- Purpose: Discover and load `.fne` libraries, parse metadata, persist loaded state, detect GUID/command conflicts, and provide command/window-unit metadata to UI and compiler.
- Location: `src/main/library-manager.ts`, `src/main/fne-parser.ts`
- Contains: stateful manager singleton (`libraryManager`), persisted state file under `app.getPath('userData')/library-state.json`, dynamic metadata parsing through koffi in `parseFneFile`.
- Depends on: `koffi` native bridge (`src/main/fne-parser.ts`), filesystem, Electron app paths.
- Used by: main IPC (`library:*` channels), compiler generation/link logic in `src/main/compiler.ts`, library inspector UI in `src/renderer/src/components/Sidebar/Sidebar.tsx` and `src/renderer/src/components/LibraryDialog/LibraryDialog.tsx`.
- Purpose: Define the only renderer-accessible API surface.
- Location: `src/preload/index.ts`
- Contains: namespaced APIs (`window`, `file`, `project`, `compiler`, `library`, `theme`, `dialog`, `debug`, plus generic `on/off` for event channels).
- Depends on: `contextBridge`, `ipcRenderer`.
- Used by: renderer via `window.api` calls in `src/renderer/src/App.tsx` and child components.
- Purpose: Coordinate UI state, menu/toolbar actions, project tree/tabs, editor operations, compile/run triggers, problem reporting, and output panels.
- Location: `src/renderer/src/App.tsx`
- Contains: top-level React `useState/useRef/useEffect` state machine, IPC event subscriptions (`compiler:output`, `compiler:processExit`), action dispatcher `handleMenuAction`, and composition of `TitleBar`, `Toolbar`, `Sidebar`, `Editor`, `OutputPanel`, `StatusBar`.
- Depends on: `window.api`, component modules in `src/renderer/src/components/`.
- Used by: renderer entrypoint `src/renderer/src/main.tsx`.
- Purpose: Provide multi-mode editing (Monaco text, EYC table editor, visual form designer), diagnostics, command hinting, and in-memory unsaved file handling.
- Location: `src/renderer/src/components/Editor/Editor.tsx`, `src/renderer/src/components/Editor/EycTableEditor.tsx`, `src/renderer/src/components/Editor/VisualDesigner.tsx`
- Contains: custom EYC language registration for Monaco, tab lifecycle, forwardRef imperative API (`EditorHandle`), command/detail interactions with `OutputPanel`.
- Depends on: Monaco editor packages, utility format/parse helpers (`src/renderer/src/components/Editor/eycFormat.ts`).
- Used by: `src/renderer/src/App.tsx`.
## Data Flow
- Keep global UI/session state in top-level React state in `src/renderer/src/App.tsx`.
- Keep editor-internal tab/document state encapsulated in `src/renderer/src/components/Editor/Editor.tsx`.
- Keep backend mutable runtime state in module singletons: `libraryManager` in `src/main/library-manager.ts` and `runningProcess` in `src/main/compiler.ts`.
- Persist cross-session preferences in main process files under `app.getPath('userData')` (theme config in `src/main/index.ts`, loaded libraries in `src/main/library-manager.ts`, renderer error log in `src/main/index.ts`).
## Key Abstractions
- Purpose: Stable contract between UI and privileged runtime.
- Examples: `src/preload/index.ts`, usage in `src/renderer/src/App.tsx`.
- Pattern: Namespaced methods by concern (`project`, `compiler`, `library`, `theme`, etc.), invoke for request/response, `on/off` for push events.
- Purpose: Represent project metadata and source asset inventory.
- Examples: parsing in `src/main/index.ts` (`project:parseEpp`) and `src/main/compiler.ts` (`parseEppFile`).
- Pattern: line-based key/value parsing plus `File=TYPE|name|flag` entries, then runtime file loading for `.eyc/.ecc/.efw/.egv/.ecs/.edt/.ell`.
- Purpose: Normalize native `.fne` metadata into TypeScript structures for compiler generation and UI browsing.
- Examples: interfaces in `src/main/fne-parser.ts`, access in `src/main/library-manager.ts`.
- Pattern: native struct decoding via koffi → mapped DTO arrays (`commands`, `dataTypes`, `windowUnits`, `constants`).
## Entry Points
- Location: `src/main/index.ts`
- Triggers: Electron startup (`app.whenReady()`).
- Responsibilities: Create browser window, register all IPC handlers, initialize library scan/autoload, handle app activate/close lifecycle.
- Location: `src/preload/index.ts`
- Triggers: BrowserWindow preload script (`webPreferences.preload` set in `src/main/index.ts`).
- Responsibilities: Expose safe API surface and IPC wrapper methods into renderer context.
- Location: `src/renderer/src/main.tsx`
- Triggers: Renderer boot via Vite/Electron renderer HTML (`src/renderer/index.html`).
- Responsibilities: Attach global error/unhandled rejection reporters, mount `<App />`.
## Error Handling
- Wrap file/JSON operations with `try/catch` and return safe fallback values in main process handlers (`src/main/index.ts`, `src/main/library-manager.ts`).
- Surface compile and runtime issues via structured output messages from `sendMessage` in `src/main/compiler.ts`.
- Collect renderer crashes via global listeners in `src/renderer/src/main.tsx`, persist through `debug:logRendererError` in `src/main/index.ts`.
- Use component error boundary for EYC editor subtree (`EycEditorErrorBoundary` in `src/renderer/src/components/Editor/Editor.tsx`).
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->

## Release Notes Workflow

- 完成功能开发、问题修复、优化调整后，先同步记录到 `版本开发日志.md` 的“待发版条目”。
- 发版时更新 `版本更新说明.md` 前，必须先读取 `版本开发日志.md` 并据此生成“新增功能 / 问题修复 / 优化调整”。
- 发版号变更时，必须同步修改以下两个位置并保持一致：
	- `src/renderer/src/components/StatusBar/StatusBar.tsx`
	- `src/renderer/src/App.tsx`（`aiIdeContext` 中的 IDE 版本字符串）
- 发布完成后，将已发布条目从“待发版条目”迁移到“已发布归档”并标注版本号与日期。
