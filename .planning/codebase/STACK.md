# Technology Stack

**Analysis Date:** 2026-03-21

## Languages

**Primary:**
- TypeScript - Main app code across Electron main, preload, and renderer in `src/main/*.ts`, `src/preload/index.ts`, and `src/renderer/src/**/*.tsx`.
- JavaScript - Test/config scripts in `playwright.config.js` and `tests/ui/electron-start.spec.js`.

**Secondary:**
- PowerShell - Repo automation script in `do_convert.ps1`.
- Python - Repo conversion utility in `convert_commobj.py`.

## Runtime

**Environment:**
- Node.js runtime for Electron app/tooling (local detected: `v24.13.0` via `node -v`).
- Electron runtime for packaged desktop app from `electron` dependency in `package.json`.

**Package Manager:**
- npm (local detected: `11.6.2` via `npm -v`)
- Lockfile: present (`package-lock.json`)

## Frameworks

**Core:**
- Electron `^34.0.0` - Desktop shell and main-process APIs (`src/main/index.ts`, `src/preload/index.ts`).
- React `^19.0.0` + React DOM `^19.0.0` - Renderer UI (`src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`).
- Monaco Editor (`@monaco-editor/react` + `monaco-editor`) - Code editor integration (`src/renderer/src/components/Editor/Editor.tsx`).

**Testing:**
- Playwright `^1.52.0` (`@playwright/test`) - Electron UI smoke/startup testing (`playwright.config.js`, `tests/ui/electron-start.spec.js`).

**Build/Dev:**
- electron-vite `^3.0.0` - Unified Electron build/dev for main/preload/renderer (`electron.vite.config.ts`, scripts in `package.json`).
- Vite `^6.0.0` + `@vitejs/plugin-react` `^4.3.0` - Renderer bundling with React plugin (`electron.vite.config.ts`).
- electron-builder `^25.0.0` - Platform packaging (`package.json` `build` section and `package:win|mac|linux` scripts).
- TypeScript `^5.7.0` - Type checking/build config (`tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`).

## Key Dependencies

**Critical:**
- `electron` - App lifecycle, browser window, IPC transport (`src/main/index.ts`, `src/preload/index.ts`).
- `koffi` - Native FFI bridge used to load and decode `.fne` support libraries (`src/main/fne-parser.ts`).
- `@monaco-editor/react` / `monaco-editor` - Core editing experience (`src/renderer/src/components/Editor/Editor.tsx`).

**Infrastructure:**
- `electron-vite` - Build orchestration for all Electron targets (`electron.vite.config.ts`).
- `electron-builder` - Generates distributables and copies bundled assets (`package.json` `build.files` and `build.extraFiles`).
- `pinyin-pro` - Chinese text/pinyin processing dependency used in renderer-side features (declared in `package.json` dependencies).

## Configuration

**Environment:**
- Development renderer URL is environment-driven: `process.env['ELECTRON_RENDERER_URL']` in `src/main/index.ts`.
- Test execution injects CI flag: `CI=1` in `tests/ui/electron-start.spec.js`.
- `.env*` files: Not detected in repository root during analysis.

**Build:**
- App/build scripts and packaging metadata: `package.json`.
- Electron-Vite bundling and alias (`@` → `src/renderer/src`): `electron.vite.config.ts`.
- TypeScript project references and strict options: `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`.
- Playwright test runtime config: `playwright.config.js`.

## Platform Requirements

**Development:**
- Node.js + npm for scripts in `package.json`.
- Windows-oriented native toolchain assets expected under `compiler/` (e.g., `compiler/llvm/bin/clang.exe`, `compiler/MSVCSDK/**`) and consumed by compiler flow in `src/main/compiler.ts`.
- Local resource folders required by packaging and runtime: `compiler/`, `lib/`, `static_lib/`, `themes/` (from `package.json` `build.extraFiles`).

**Production:**
- Desktop distribution target via Electron Builder to `dist/` (`package.json` `build.directories.output`).
- Targets configured: Windows `dir`, macOS `dmg`, Linux `AppImage` and `deb` (`package.json` `build.win|mac|linux`).

---

*Stack analysis: 2026-03-21*
