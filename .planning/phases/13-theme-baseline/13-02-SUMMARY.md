---
phase: 13-theme-baseline
plan: 02
subsystem: theme
tags: [electron, renderer, monaco, theme]
requires: [13-01]
provides:
  - "Dual-entry runtime theme switch via title menu and settings dialog"
  - "Monaco dark/light runtime palette switching with dedicated ycide-light tokens"
  - "One-time fallback/repair warnings and partial-apply restart guidance"
affects: [phase-13-plan-03]
tech-stack:
  added: []
  patterns: ["Single renderer applyTheme path reused by menu and settings dialog"]
key-files:
  created:
    - src/renderer/src/components/ThemeSettingsDialog/ThemeSettingsDialog.tsx
    - src/renderer/src/components/ThemeSettingsDialog/ThemeSettingsDialog.css
    - themes/默认浅色.json
    - tests/contract/theme-settings-entry.spec.mjs
    - tests/contract/editor-theme-switch.spec.mjs
  modified:
    - src/renderer/src/App.tsx
    - src/renderer/src/components/Editor/Editor.tsx
key-decisions:
  - "Use output panel notices for startup warning, repair_required, and partial theme apply guidance."
  - "Bind Monaco theme to currentTheme with explicit ycide-light and ycide-dark definitions."
requirements-completed: [THME-01]
duration: 20min
completed: 2026-04-10
---

# Phase 13 Plan 02: Theme Switching UX + Monaco Light Palette Summary

**Added settings-based theme switching, runtime Monaco dark/light palette binding, and explicit warning/repair UX for fallback and partial apply paths.**

## Performance

- **Duration:** 20 min
- **Tasks:** 3
- **Files modified:** 7

## Task Commits

1. **Task 1: Add settings-entry theme switch and unify switch path**
   - `05c6b08` (test, RED)
   - `1ed512f` (feat, GREEN)
2. **Task 2: Add Monaco light palette and runtime editor-theme switching**
   - `37c17dc` (test, RED)
   - `d0b0cb0` (feat, GREEN)
3. **Task 3: Add one-time warning and partial-apply restart guidance UI**
   - `d34a678` (feat)

## Accomplishments

- Added `ThemeSettingsDialog` and wired `tools:settings` to the same `applyTheme` callback used by title-bar theme switching.
- Introduced Monaco `ycide-light` theme definition and dynamic `theme={monacoThemeId}` runtime binding driven by app theme state.
- Added built-in light theme asset (`themes/默认浅色.json`) so dark/light switching is actually available in runtime theme list.
- Implemented one-time startup warning notices, explicit `repair_required` routing into settings, and partial-apply restart guidance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added built-in light theme asset**
- **Found during:** Task 2
- **Issue:** Only dark theme file existed, so required dark/light switching baseline was not practically achievable.
- **Fix:** Added `themes/默认浅色.json` to provide runtime light option for both title menu and settings entry.
- **Commit:** `d0b0cb0`

## Auth Gates
None.

## Known Stubs
None.

## Self-Check: PASSED
- FOUND: `.planning/phases/13-theme-baseline/13-02-SUMMARY.md`
- FOUND commits: `05c6b08`, `1ed512f`, `37c17dc`, `d0b0cb0`, `d34a678`
