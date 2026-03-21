# Codebase Concerns

**Analysis Date:** 2026-03-21

## Tech Debt

**[Critical] Monolithic files with mixed responsibilities:**
- Issue: Core behavior is concentrated in very large files that mix UI, business logic, parsing, and orchestration, which raises regression risk and slows safe change velocity.
- Files: `src/renderer/src/components/Editor/EycTableEditor.tsx` (~4191 lines), `src/main/compiler.ts` (~1982 lines), `src/renderer/src/components/Editor/Editor.tsx` (~1494 lines), `src/renderer/src/App.tsx` (~1087 lines).
- Impact: Small feature changes can break unrelated flows; review and debugging cost is high; defect isolation is difficult.
- Fix approach: Split by bounded contexts (parser, editor command palette, compile orchestration, IPC facade, UI containers) and enforce module-level interfaces.

**[High] Translator coverage is partial with explicit TODO placeholders:**
- Issue: Command translation falls back to a placeholder no-op when no generator exists, instead of hard-failing.
- Files: `src/main/compiler.ts` (`COMMAND_CODE_GENERATORS` and fallback in `generateCCodeForCommand`).
- Impact: Source commands can compile into no-op C code, causing silent functional loss in output binaries.
- Fix approach: Enforce fail-fast for unsupported commands and maintain an explicit compatibility matrix per library command.

**[High] Silent error swallowing hides operational failures:**
- Issue: Multiple catches intentionally ignore failures (`catch {}` / `catch(() => {})`) in runtime-critical paths.
- Files: `src/main/index.ts`, `src/main/library-manager.ts`, `src/main/compiler.ts`, `src/main/fne-parser.ts`, `src/renderer/src/components/Editor/Editor.tsx`, `src/renderer/src/components/Editor/EycTableEditor.tsx`, `src/renderer/src/components/Sidebar/Sidebar.tsx`.
- Impact: Broken IO, parser faults, and library load failures can appear as “empty results” rather than diagnosable errors.
- Fix approach: Replace silent catches with structured error propagation and user-visible diagnostics in `compiler:output` / problem panels.

## Known Bugs

**[High] Built executables can depend on IDE-local absolute `.fne` paths:**
- Symptoms: Program runs on dev machine but fails on another machine when required support libraries are not present at the original absolute path.
- Files: `src/main/compiler.ts` (normal mode path uses `LoadLibraryW` with absolute `lib.fnePath` for window-unit libraries).
- Trigger: Compile in normal mode with loaded window-unit libraries, then move output to a machine without the same IDE path layout.
- Workaround: Use static mode when available, or manually ship compatible `.fne` and adjust load strategy.

## Security Considerations

**[Critical] Main-process IPC allows unrestricted filesystem access from renderer context:**
- Risk: Any renderer compromise can read/write arbitrary files via exposed IPC methods.
- Files: `src/preload/index.ts` (broad API exposure), `src/main/index.ts` (`file:save`, `project:readFile`, `file:readDir`, `project:addFile`, rename handlers).
- Current mitigation: `contextIsolation: true` and `nodeIntegration: false` in `BrowserWindow` options.
- Recommendations: Enforce path allowlists rooted at project directories, block traversal (`..`), validate absolute path intent, and add sender-origin checks for sensitive channels.

**[Critical] Native code execution path via user-controlled support library loading:**
- Risk: Loading untrusted `.fne` via FFI (`koffi.load`) executes native code in the app process.
- Files: `src/main/index.ts` (`library:scan`, `library:load`), `src/main/library-manager.ts` (`scan(customFolder?)`, `load`), `src/main/fne-parser.ts` (`koffi.load`).
- Current mitigation: Basic GUID/command conflict checks only.
- Recommendations: Restrict scan roots, enforce signed/trusted library policy, isolate native parsing in a hardened process boundary, and record security audit logs.

**[Medium] External URL open policy is unvalidated:**
- Risk: Untrusted links opened via system browser can facilitate phishing/social-engineering flows.
- Files: `src/main/index.ts` (`setWindowOpenHandler` with `shell.openExternal(details.url)`).
- Current mitigation: New window creation is denied.
- Recommendations: Add protocol/domain allowlist and explicit user confirmation for unknown targets.

## Performance Bottlenecks

**[High] Main process relies heavily on synchronous filesystem APIs:**
- Problem: Frequent `readFileSync`/`writeFileSync`/`readdirSync` in IPC handlers and compile prep can block Electron’s main thread.
- Files: `src/main/index.ts`, `src/main/compiler.ts`, `src/main/library-manager.ts`.
- Cause: Sync IO in event handlers and compilation orchestration.
- Improvement path: Move to async fs APIs, offload heavy operations to worker/utility processes, and batch file updates.

**[Medium] Output log accumulation is unbounded in renderer memory:**
- Problem: Compile/run output continuously appends to in-memory state without truncation.
- Files: `src/renderer/src/App.tsx` (`setOutputMessages(prev => [...prev, msg])`), `src/renderer/src/components/OutputPanel/OutputPanel.tsx`.
- Cause: No cap/rotation policy for message history.
- Improvement path: Add ring buffer limit (for example 2k–5k lines) and archive full logs to disk when needed.

## Fragile Areas

**[High] Rename workflows use broad text replacement across source files:**
- Files: `src/main/index.ts` (`project:renameWindow`, `project:renameClassModule`).
- Why fragile: String-based replacements can alter unintended tokens/comments and miss syntax-aware boundaries.
- Safe modification: Replace with parser-assisted transformations for `.eyc`/`.ecc` constructs and add dry-run diff previews.
- Test coverage: No dedicated tests detected for rename correctness edge cases.

**[High] FFI parsing layer tolerates decode errors by fallback defaults:**
- Files: `src/main/fne-parser.ts`.
- Why fragile: Extensive pointer decoding with broad catches can produce partial metadata that appears valid enough to continue.
- Safe modification: Add strict parse modes, schema invariants, and explicit “invalid library” failure states.
- Test coverage: No parser-focused automated tests detected.

## Scaling Limits

**[Medium] Compile/run lifecycle is single-process global state:**
- Current capacity: One tracked runtime process (`runningProcess`) and effectively one active compile/run flow.
- Limit: Concurrent project operations and multi-run orchestration are not supported safely.
- Scaling path: Introduce job queue + per-project execution contexts with process supervision.

**[Medium] Library metadata fetches scale linearly from UI interactions:**
- Current capacity: Renderer repeatedly loads all commands/metadata on-demand.
- Limit: Latency grows with number/size of loaded support libraries.
- Scaling path: Cache normalized metadata in main process and expose paged/indexed IPC queries.

## Dependencies at Risk

**[High] `koffi` native FFI dependency is a high-trust boundary:**
- Risk: Crashes, ABI mismatch, or malformed pointer decoding can destabilize the app process.
- Impact: Support library scanning/loading and command metadata availability can fail catastrophically.
- Migration plan: Isolate FFI in a separate worker process and communicate via validated JSON contracts; maintain compatibility tests for `.fne` variants.

## Missing Critical Features

**[High] No automated quality gate in scripts/CI pipeline:**
- Problem: Repository scripts expose build/package and a UI smoke run, but no lint/typecheck/test gate for PR quality.
- Blocks: Safe refactoring of parser/compiler/editor without regression risk.

**[Medium] Planned core capabilities remain absent in product surface:**
- Problem: Debugger integration, plugin model governance, and settings UX are marked as pending.
- Blocks: Operational diagnostics depth, extensibility controls, and user-level configuration hardening.
- Evidence files: `README.md` (pending feature list), `package.json` (no scripts for debugger/plugin validation workflows).

## Test Coverage Gaps

**[High] Critical main-process flows are untested:**
- What's not tested: IPC file operations, compile pipeline behavior, rename transformations, FNE parsing failure modes.
- Files: `src/main/index.ts`, `src/main/compiler.ts`, `src/main/library-manager.ts`, `src/main/fne-parser.ts`.
- Risk: Regressions in filesystem and compile behavior can ship undetected.
- Priority: High

**[High] UI test scope is limited to startup smoke:**
- What's not tested: Editing workflows, compile/run lifecycle, error panel behavior, library load/unload interactions.
- Files: `tests/ui/electron-start.spec.js`, `src/renderer/src/App.tsx`, `src/renderer/src/components/Editor/*.tsx`.
- Risk: Complex editor interactions and async flows can break without automated detection.
- Priority: High

---

*Concerns audit: 2026-03-21*
