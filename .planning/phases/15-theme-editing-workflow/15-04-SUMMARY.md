---
phase: 15-theme-editing-workflow
plan: 04
subsystem: ui
tags: [electron, react, theme-draft, close-flow, playwright]
requires:
  - phase: 15-03
    provides: draft save-as-custom contract and validation baseline
provides:
  - unified unsaved-draft close decision flow for close button/Esc/overlay
  - shared app-exit guard reusing the same save/discard/continue decision
  - automated UI evidence for close-intent parity and app exit
affects: [phase-15, phase-16-theme-management]
tech-stack:
  added: []
  patterns: [single draft-close intent handler, main-renderer close handshake]
key-files:
  created: []
  modified:
    - src/renderer/src/App.tsx
    - src/renderer/src/components/ThemeSettingsDialog/ThemeSettingsDialog.tsx
    - src/main/index.ts
    - src/preload/index.ts
    - tests/contract/theme-draft-workflow.spec.mjs
    - tests/ui/theme-editing-workflow.spec.js
key-decisions:
  - "Unsaved theme drafts are resolved through one intent-aware handler for settings and app-exit."
  - "Window close now uses requestClose/forceClose handshake to prevent app-exit bypass."
patterns-established:
  - "Close intent routing: UI intent -> confirmUnsavedThemeDraftClose -> save/discard/continue resolution."
  - "App close gating: main emits app:requestClose, renderer validates, renderer issues forceClose only when allowed."
requirements-completed: [FLOW-02, FLOW-03]
duration: 10min
completed: 2026-04-10
---

# Phase 15 Plan 04: Unsaved Draft Close Guard Summary

**Theme draft close intents and app exit now share one save/discard/continue guard with continue-editing as the safe default.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-10T05:46:52Z
- **Completed:** 2026-04-10T05:57:20Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Unified settings close button, Esc, and overlay into one unsaved-draft decision flow.
- Added app-exit reuse of the same decision flow with close-request handshake between main and renderer.
- Added/updated contract + UI automation to assert close-intent parity and app-exit protection.

## Task Commits
1. **Task 1: Unified unsaved-draft close decision for settings close intents** - `28fa298` (feat)
2. **Task 2: Reuse same decision flow for app exit** - `3d05bac` (feat)

## Files Created/Modified
- `src/renderer/src/App.tsx` - unified draft-close handler, app-close integration, test hook support.
- `src/renderer/src/components/ThemeSettingsDialog/ThemeSettingsDialog.tsx` - intent-aware close callbacks for close button/Esc/overlay.
- `src/main/index.ts` - draft-close confirm IPC + close interception/requestClose/forceClose flow.
- `src/preload/index.ts` - exposed new dialog and forceClose bridge methods.
- `tests/contract/theme-draft-workflow.spec.mjs` - updated close-flow contract assertions.
- `tests/ui/theme-editing-workflow.spec.js` - added `unsaved draft close parity and app exit` UI test.

## Decisions Made
- Use explicit close intents (`close-button`, `overlay`, `escape`, `app-exit`) to guarantee parity and traceability.
- Keep “继续编辑” as default/cancel path in main-process dialog to minimize accidental draft loss.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Built app artifacts before Playwright verification**
- **Found during:** Task 2 verification
- **Issue:** Playwright was executing stale `out/` bundles and not reflecting latest source changes.
- **Fix:** Added `npm run build` before the Task 2 Playwright run.
- **Files modified:** None (execution flow adjustment only)
- **Verification:** `npm run build && npx playwright test tests/ui/theme-editing-workflow.spec.js -g "unsaved draft close parity and app exit"`
- **Committed in:** `3d05bac`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required for correct verification; no scope creep.

## Issues Encountered
- Initial UI test cleanup hung because close interception prevented direct app shutdown; fixed by setting discard decision in test cleanup before `closeApp`.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Close-path parity and app-exit protection are in place for unsaved draft workflow.
- Ready for remaining Phase 15 plan work and downstream management/import-export phase integration.

## Self-Check: PASSED
- FOUND: `.planning/phases/15-theme-editing-workflow/15-04-SUMMARY.md`
- FOUND: `28fa298`
- FOUND: `3d05bac`
