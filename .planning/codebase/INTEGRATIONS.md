# External Integrations

**Analysis Date:** 2026-03-21

## APIs & External Services

**Desktop Platform APIs (local OS integration):**
- Electron runtime APIs - Window lifecycle, dialogs, shell open, IPC, and app paths.
  - SDK/Client: `electron`
  - Auth: Not applicable
  - Evidence: `src/main/index.ts`, `src/preload/index.ts`

**Native Binary/FFI Integration:**
- `.fne` support-library loading and native structure decoding for 易语言 support libraries.
  - SDK/Client: `koffi`
  - Auth: Not applicable
  - Evidence: `src/main/fne-parser.ts`, `src/main/library-manager.ts`

**Local Compiler Toolchain Integration:**
- Bundled Clang + MSVC SDK execution for project compile/run pipeline.
  - SDK/Client: Node built-ins (`child_process`, `fs`, `path`) and bundled binaries
  - Auth: Not applicable
  - Evidence: `src/main/compiler.ts`, `compiler/llvm/bin/clang.exe`, `compiler/MSVCSDK/`

**Third-party Web APIs:**
- Not detected in runtime source. No `fetch`, `axios`, or explicit HTTP endpoint usage found in `src/**/*.ts(x)` during scan.

## Data Storage

**Databases:**
- Not detected.
  - Connection: Not applicable
  - Client: Not applicable

**File Storage:**
- Local filesystem only.
  - Project file I/O: `src/main/index.ts` (`project:create`, `project:readFile`, `file:save`, `file:readDir`)
  - User config/session: `src/main/library-manager.ts` (`library-state.json`), `src/main/index.ts` (`theme-config.json`, `.ycide-session.json`)
  - Build outputs: `dist/`, `out/`, project-local `output/` directories

**Caching:**
- None as a separate cache service.

## Authentication & Identity

**Auth Provider:**
- Custom/none.
  - Implementation: No authentication subsystem detected in main/preload/renderer source (`src/main`, `src/preload`, `src/renderer/src`).

## Monitoring & Observability

**Error Tracking:**
- Local file-based renderer error logging (custom).
  - Evidence: `src/main/index.ts` functions `getRendererErrorLogPath`, `appendRendererErrorLog`, IPC channel `debug:logRendererError`
  - Storage location: `${app.getPath('userData')}/logs/renderer-errors.log`

**Logs:**
- IPC-driven compile output streamed to renderer windows via `webContents.send('compiler:output', msg)` in `src/main/compiler.ts`.
- Console logging in Electron main process for renderer diagnostic errors in `src/main/index.ts`.

## CI/CD & Deployment

**Hosting:**
- Desktop application distribution (not web hosting).
  - Packaging config: `package.json` `build` section with per-OS targets.

**CI Pipeline:**
- Not detected (`.github/workflows/` not present).
- Manual/local test and packaging scripts defined in `package.json` (`test:ui`, `package:win`, `package:mac`, `package:linux`).

## Environment Configuration

**Required env vars:**
- `ELECTRON_RENDERER_URL` (development renderer URL resolution in `src/main/index.ts`).
- `CI` used in Playwright launch env for UI test run (`tests/ui/electron-start.spec.js`).

**Secrets location:**
- Not detected in repository configuration.
- `.env*` files not detected at repository root during analysis.

## Webhooks & Callbacks

**Incoming:**
- None (no HTTP server endpoints or webhook receivers detected).

**Outgoing:**
- None (no webhook emitters or outbound API clients detected).

---

*Integration audit: 2026-03-21*
