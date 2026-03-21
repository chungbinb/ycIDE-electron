# Codebase Structure

**Analysis Date:** 2026-03-21

## Directory Layout

```text
ycIDE-html/
├── src/                       # Application source code (main, preload, renderer)
│   ├── main/                  # Electron main process services and IPC handlers
│   ├── preload/               # Context bridge API exposed to renderer
│   └── renderer/              # Frontend app (React + Vite assets)
├── compiler/                  # Bundled toolchain assets (LLVM, MSVC SDK)
├── lib/                       # Support library files (.fne and related assets)
├── static_lib/                # Static link libraries used by compiler flow
├── themes/                    # Theme JSON definitions loaded at runtime
├── resources/                 # App icons and packaging resources
├── tests/ui/                  # Playwright Electron smoke UI tests
├── out/                       # Build output used by Electron runtime entry
├── dist/                      # Packaged app artifacts from electron-builder
├── electron.vite.config.ts    # Build config for main/preload/renderer bundles
├── package.json               # Scripts, dependencies, electron-builder config
└── playwright.config.js       # UI test runner configuration
```

## Directory Purposes

**`src/main`:**
- Purpose: Host privileged desktop runtime logic.
- Contains: `index.ts` (IPC and app lifecycle), `compiler.ts` (compile/run pipeline), `library-manager.ts` (support library lifecycle), `fne-parser.ts` (native metadata parsing).
- Key files: `src/main/index.ts`, `src/main/compiler.ts`, `src/main/library-manager.ts`, `src/main/fne-parser.ts`.

**`src/preload`:**
- Purpose: Define renderer-safe APIs and IPC boundary.
- Contains: preload entry API object exposed through `contextBridge`.
- Key files: `src/preload/index.ts`.

**`src/renderer/src`:**
- Purpose: UI and interaction layer.
- Contains: root app (`App.tsx`), entry mount (`main.tsx`), shared styling (`styles/global.css`), feature components and utilities.
- Key files: `src/renderer/src/App.tsx`, `src/renderer/src/main.tsx`, `src/renderer/src/components/Editor/Editor.tsx`, `src/renderer/src/components/Sidebar/Sidebar.tsx`.

**`src/renderer/src/components`:**
- Purpose: UI module decomposition by functional area.
- Contains: `TitleBar`, `Toolbar`, `Sidebar`, `Editor`, `OutputPanel`, `StatusBar`, dialogs (`LibraryDialog`, `NewProjectDialog`), icons.
- Key files: `src/renderer/src/components/TitleBar/TitleBar.tsx`, `src/renderer/src/components/Toolbar/Toolbar.tsx`, `src/renderer/src/components/OutputPanel/OutputPanel.tsx`.

**`tests/ui`:**
- Purpose: End-to-end smoke checks against built Electron app.
- Contains: startup test for window/UI bootstrap assertions.
- Key files: `tests/ui/electron-start.spec.js`.

**`compiler`, `lib`, `static_lib`, `themes`:**
- Purpose: Runtime payload directories required by app features.
- Contains:
  - `compiler/`: bundled Clang/MSVC SDK paths discovered by `src/main/compiler.ts`.
  - `lib/`: `.fne` support libraries scanned by `src/main/library-manager.ts`.
  - `static_lib/`: `.lib` candidates resolved by `libraryManager.findStaticLib`.
  - `themes/`: theme JSON files loaded via `theme:*` handlers in `src/main/index.ts`.
- Key files: directories are consumed dynamically at runtime through resolved paths (dev: `app.getAppPath()`, packaged: `dirname(process.execPath)`).

## Key File Locations

**Entry Points:**
- `src/main/index.ts`: Electron main process startup and IPC registration entry.
- `src/preload/index.ts`: preload capability bridge entry.
- `src/renderer/src/main.tsx`: renderer mount entry.
- `src/renderer/index.html`: renderer HTML shell loaded by BrowserWindow.

**Configuration:**
- `package.json`: scripts (`dev`, `build`, packaging, UI tests) and electron-builder `build` metadata.
- `electron.vite.config.ts`: bundle targets (main/preload/renderer) and renderer alias `@ -> src/renderer/src`.
- `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`: TypeScript project references and per-target compile boundaries.
- `playwright.config.js`: test directory, timeout, workers, output behavior.

**Core Logic:**
- `src/main/compiler.ts`: project parse + code generation + compile + run/stop pipeline.
- `src/main/library-manager.ts`: support library state scan/load/unload/conflict management.
- `src/main/fne-parser.ts`: koffi-based `.fne` metadata decode.
- `src/renderer/src/App.tsx`: top-level UI orchestration and action routing.
- `src/renderer/src/components/Editor/Editor.tsx`: editor subsystem abstraction and imperative API.

**Testing:**
- `tests/ui/electron-start.spec.js`: smoke startup assertion flow.

## Naming Conventions

**Files:**
- Use kebab-case for backend/infra modules in main process: `library-manager.ts`, `fne-parser.ts`.
- Use PascalCase for React component files and folders: `App.tsx`, `Editor.tsx`, `TitleBar.tsx`, `OutputPanel.tsx`.
- Keep style files co-located and same basename as component: `Editor.tsx` + `Editor.css`, `Sidebar.tsx` + `Sidebar.css`.

**Directories:**
- Keep process boundary directories explicit under `src/`: `main`, `preload`, `renderer`.
- Keep renderer feature components in dedicated folder per component under `src/renderer/src/components/`.

## Where to Add New Code

**New Desktop/IPC-backed Feature:**
- Primary code: add handler/service logic in `src/main/index.ts` or extracted module under `src/main/`.
- Preload bridge: add method in `src/preload/index.ts`.
- Renderer consumer: add calls and state wiring in `src/renderer/src/App.tsx` and relevant component under `src/renderer/src/components/`.
- Tests: add Electron UI scenario under `tests/ui/`.

**New Component/Module:**
- Implementation: create folder under `src/renderer/src/components/<FeatureName>/` with `<FeatureName>.tsx` and `<FeatureName>.css`.
- Composition point: import and render from `src/renderer/src/App.tsx` unless strictly local to an existing feature component.

**New Compiler/Library Capability:**
- Compiler pipeline: extend `src/main/compiler.ts` for generation/link behavior.
- Library metadata/state behavior: extend `src/main/library-manager.ts` and `src/main/fne-parser.ts`.
- IPC exposure: wire through `src/main/index.ts` and `src/preload/index.ts`.

**Utilities:**
- Renderer shared helpers: add under `src/renderer/src/utils/` (pattern used by `src/renderer/src/utils/pinyin.ts`).
- Editor-local helpers: add under `src/renderer/src/components/Editor/` for format/parse helpers (pattern used by `eycFormat.ts`).

## Special Directories

**`out/`:**
- Purpose: Built runtime artifacts (`out/main/index.js`, `out/renderer/index.html`) consumed by Electron startup and UI tests.
- Generated: Yes.
- Committed: Present in repository snapshot; treat as build output, avoid manual edits.

**`dist/`:**
- Purpose: Packaging output defined by electron-builder (`package.json -> build.directories.output`).
- Generated: Yes.
- Committed: Present in repository snapshot; treat as distributable artifact output.

**`compiler/`:**
- Purpose: Bundled native toolchain payload copied into packaged app via `package.json -> build.extraFiles`.
- Generated: No (vendor/runtime dependency directory).
- Committed: Yes.

**`lib/`, `static_lib/`, `themes/`:**
- Purpose: Runtime-loadable data assets for support libraries, link-time static libs, and UI themes.
- Generated: No (project payload).
- Committed: Yes.

**Secret/config files:**
- `.env` files were not read. If present, treat as environment configuration only and keep out of architecture docs.

---

*Structure analysis: 2026-03-21*
