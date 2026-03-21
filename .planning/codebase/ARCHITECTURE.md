# Architecture

**Analysis Date:** 2026-03-21

## Pattern Overview

**Overall:** Electron multi-process desktop architecture with a typed IPC bridge and a React-driven renderer shell.

**Key Characteristics:**
- Keep OS access and process control in the Electron main process (`src/main/index.ts`, `src/main/compiler.ts`, `src/main/library-manager.ts`).
- Expose only approved capabilities to UI through preload `contextBridge` APIs (`src/preload/index.ts`).
- Keep UI state and interaction logic in a single renderer root orchestration component (`src/renderer/src/App.tsx`) plus focused feature components under `src/renderer/src/components/`.

## Layers

**Main Process (Desktop Runtime & System Boundary):**
- Purpose: Own app lifecycle, window lifecycle, filesystem/project mutations, compilation, theme persistence, and support-library management.
- Location: `src/main/index.ts`
- Contains: `app.whenReady`, `createWindow`, all `ipcMain.on` and `ipcMain.handle` channel registrations (project/file/library/theme/compiler/debug/dialog/window).
- Depends on: Electron APIs (`app`, `BrowserWindow`, `ipcMain`, `dialog`, `shell`), Node FS/path modules, `compileProject` from `src/main/compiler.ts`, and `libraryManager` from `src/main/library-manager.ts`.
- Used by: `src/preload/index.ts` invokes these handlers via `ipcRenderer.invoke/send`.

**Compiler & Execution Pipeline:**
- Purpose: Parse `.epp`, transform Yi-language source + form metadata into generated C/C++, invoke Clang/MSVC SDK toolchain, copy runtime dependencies, and run/stop executable processes.
- Location: `src/main/compiler.ts`
- Contains: toolchain discovery (`findClangCompiler`, `findMSVCSDK`), project parsing (`parseEppFile`), code generation (`generateMainC`, command/event generation helpers), compile orchestration (`compileProject`), runtime execution (`runExecutable`, `stopExecutable`, `isRunning`).
- Depends on: filesystem, child process execution, and loaded support-library metadata (`libraryManager.getLoadedLibraryFiles`, `libraryManager.getAllCommands`, `libraryManager.getAllWindowUnits`).
- Used by: IPC handlers `compiler:compile`, `compiler:run`, `compiler:stop`, `compiler:isRunning` in `src/main/index.ts`.

**Support Library Subsystem:**
- Purpose: Discover and load `.fne` libraries, parse metadata, persist loaded state, detect GUID/command conflicts, and provide command/window-unit metadata to UI and compiler.
- Location: `src/main/library-manager.ts`, `src/main/fne-parser.ts`
- Contains: stateful manager singleton (`libraryManager`), persisted state file under `app.getPath('userData')/library-state.json`, dynamic metadata parsing through koffi in `parseFneFile`.
- Depends on: `koffi` native bridge (`src/main/fne-parser.ts`), filesystem, Electron app paths.
- Used by: main IPC (`library:*` channels), compiler generation/link logic in `src/main/compiler.ts`, library inspector UI in `src/renderer/src/components/Sidebar/Sidebar.tsx` and `src/renderer/src/components/LibraryDialog/LibraryDialog.tsx`.

**Preload Security Bridge:**
- Purpose: Define the only renderer-accessible API surface.
- Location: `src/preload/index.ts`
- Contains: namespaced APIs (`window`, `file`, `project`, `compiler`, `library`, `theme`, `dialog`, `debug`, plus generic `on/off` for event channels).
- Depends on: `contextBridge`, `ipcRenderer`.
- Used by: renderer via `window.api` calls in `src/renderer/src/App.tsx` and child components.

**Renderer Application Shell:**
- Purpose: Coordinate UI state, menu/toolbar actions, project tree/tabs, editor operations, compile/run triggers, problem reporting, and output panels.
- Location: `src/renderer/src/App.tsx`
- Contains: top-level React `useState/useRef/useEffect` state machine, IPC event subscriptions (`compiler:output`, `compiler:processExit`), action dispatcher `handleMenuAction`, and composition of `TitleBar`, `Toolbar`, `Sidebar`, `Editor`, `OutputPanel`, `StatusBar`.
- Depends on: `window.api`, component modules in `src/renderer/src/components/`.
- Used by: renderer entrypoint `src/renderer/src/main.tsx`.

**Editor & Design Surface Subsystem:**
- Purpose: Provide multi-mode editing (Monaco text, EYC table editor, visual form designer), diagnostics, command hinting, and in-memory unsaved file handling.
- Location: `src/renderer/src/components/Editor/Editor.tsx`, `src/renderer/src/components/Editor/EycTableEditor.tsx`, `src/renderer/src/components/Editor/VisualDesigner.tsx`
- Contains: custom EYC language registration for Monaco, tab lifecycle, forwardRef imperative API (`EditorHandle`), command/detail interactions with `OutputPanel`.
- Depends on: Monaco editor packages, utility format/parse helpers (`src/renderer/src/components/Editor/eycFormat.ts`).
- Used by: `src/renderer/src/App.tsx`.

## Data Flow

**Project Open and Restore Flow:**

1. Renderer action (`file:openProject`) in `src/renderer/src/App.tsx` calls `window.api.project.openEpp()` then `window.api.project.parseEpp(eppPath)`.
2. Main handler in `src/main/index.ts` (`project:openEpp`, `project:parseEpp`) reads `.epp` from disk and returns project/file metadata.
3. Renderer builds `TreeNode[]`, reads source/form files using `window.api.project.readFile`, restores tab session via `project:loadOpenTabs`, and hydrates `Editor` tabs (`src/renderer/src/App.tsx` + `src/renderer/src/components/Editor/Editor.tsx`).

**Compile / Run Flow:**

1. Renderer compile actions (`handleCompile`, `handleCompileStatic`, `handleCompileRun`) in `src/renderer/src/App.tsx` gather unsaved editor buffers (`editorRef.current?.getEditorFiles()`).
2. Preload forwards to `compiler:compile` / `compiler:run` (`src/preload/index.ts`).
3. Main IPC handler in `src/main/index.ts` maps `editorFilesObj` to `Map` and calls `compileProject` in `src/main/compiler.ts`.
4. Compiler parses `.epp`, generates C/C++, invokes `clang.exe` via `execFile`, emits streaming messages through `BrowserWindow.webContents.send('compiler:output', msg)`, optionally launches executable (`runExecutable`).
5. Renderer subscribes to `compiler:output` and `compiler:processExit` in `src/renderer/src/App.tsx`, updates `OutputPanel` and run state (`src/renderer/src/components/OutputPanel/OutputPanel.tsx`).

**Support Library Load/Propagate Flow:**

1. Renderer library UI triggers `window.api.library.load/unload/loadAll` from `src/renderer/src/components/Sidebar/Sidebar.tsx` and dialog components.
2. Main `library:*` handlers in `src/main/index.ts` call `libraryManager` methods from `src/main/library-manager.ts`.
3. On state change, main broadcasts `library:loaded` to all windows.
4. Renderer reacts by re-checking design diagnostics (`handleLibraryChange` in `src/renderer/src/App.tsx`) and library metadata views.

**State Management:**
- Keep global UI/session state in top-level React state in `src/renderer/src/App.tsx`.
- Keep editor-internal tab/document state encapsulated in `src/renderer/src/components/Editor/Editor.tsx`.
- Keep backend mutable runtime state in module singletons: `libraryManager` in `src/main/library-manager.ts` and `runningProcess` in `src/main/compiler.ts`.
- Persist cross-session preferences in main process files under `app.getPath('userData')` (theme config in `src/main/index.ts`, loaded libraries in `src/main/library-manager.ts`, renderer error log in `src/main/index.ts`).

## Key Abstractions

**IPC Capability Namespace (`window.api`):**
- Purpose: Stable contract between UI and privileged runtime.
- Examples: `src/preload/index.ts`, usage in `src/renderer/src/App.tsx`.
- Pattern: Namespaced methods by concern (`project`, `compiler`, `library`, `theme`, etc.), invoke for request/response, `on/off` for push events.

**Project Model via `.epp` + companion files:**
- Purpose: Represent project metadata and source asset inventory.
- Examples: parsing in `src/main/index.ts` (`project:parseEpp`) and `src/main/compiler.ts` (`parseEppFile`).
- Pattern: line-based key/value parsing plus `File=TYPE|name|flag` entries, then runtime file loading for `.eyc/.ecc/.efw/.egv/.ecs/.edt/.ell`.

**Library Metadata Model (`LibInfo`):**
- Purpose: Normalize native `.fne` metadata into TypeScript structures for compiler generation and UI browsing.
- Examples: interfaces in `src/main/fne-parser.ts`, access in `src/main/library-manager.ts`.
- Pattern: native struct decoding via koffi → mapped DTO arrays (`commands`, `dataTypes`, `windowUnits`, `constants`).

## Entry Points

**Electron Main Entry:**
- Location: `src/main/index.ts`
- Triggers: Electron startup (`app.whenReady()`).
- Responsibilities: Create browser window, register all IPC handlers, initialize library scan/autoload, handle app activate/close lifecycle.

**Preload Entry:**
- Location: `src/preload/index.ts`
- Triggers: BrowserWindow preload script (`webPreferences.preload` set in `src/main/index.ts`).
- Responsibilities: Expose safe API surface and IPC wrapper methods into renderer context.

**Renderer Entry:**
- Location: `src/renderer/src/main.tsx`
- Triggers: Renderer boot via Vite/Electron renderer HTML (`src/renderer/index.html`).
- Responsibilities: Attach global error/unhandled rejection reporters, mount `<App />`.

## Error Handling

**Strategy:** Boundary-based handling with fail-soft defaults and UI-visible compile/runtime messaging.

**Patterns:**
- Wrap file/JSON operations with `try/catch` and return safe fallback values in main process handlers (`src/main/index.ts`, `src/main/library-manager.ts`).
- Surface compile and runtime issues via structured output messages from `sendMessage` in `src/main/compiler.ts`.
- Collect renderer crashes via global listeners in `src/renderer/src/main.tsx`, persist through `debug:logRendererError` in `src/main/index.ts`.
- Use component error boundary for EYC editor subtree (`EycEditorErrorBoundary` in `src/renderer/src/components/Editor/Editor.tsx`).

## Cross-Cutting Concerns

**Logging:** Use structured compile/runtime messages and persisted renderer error logs (`src/main/compiler.ts`, `src/main/index.ts`, `src/renderer/src/main.tsx`).
**Validation:** Validate file existence and parse inputs before processing (`existsSync` checks in `src/main/index.ts`, `src/main/compiler.ts`, `src/main/library-manager.ts`); UI blocks compile/run on known file/design problems in `src/renderer/src/App.tsx`.
**Authentication:** Not applicable (no user auth subsystem detected in local desktop architecture).

---

*Architecture analysis: 2026-03-21*
