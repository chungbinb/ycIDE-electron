---
phase: 15-theme-editing-workflow
plan: 03
subsystem: ui
tags: [react, electron, theme, ipc, playwright, contract-test]
requires:
  - phase: 15-01
    provides: draft-only preview editing session
  - phase: 15-02
    provides: draft undo and baseline restore actions
provides:
  - Save-as-custom theme IPC with shared name validation and duplicate-name blocking
  - Theme settings manual-name save UX with inline validation feedback
  - FLOW-03 automation coverage for naming boundaries and immediate activation
affects: [15-04, FLOW-03, theme-management]
tech-stack:
  added: []
  patterns:
    - Shared save-as-custom validation contract reused by main and renderer
    - Main-process save handler persists custom theme file and switches active theme atomically
key-files:
  created: []
  modified:
    - src/shared/theme.ts
    - src/main/index.ts
    - src/preload/index.ts
    - src/renderer/src/App.tsx
    - src/renderer/src/components/ThemeSettingsDialog/ThemeSettingsDialog.tsx
    - src/renderer/src/components/ThemeSettingsDialog/ThemeSettingsDialog.css
    - tests/contract/theme-draft-workflow.spec.mjs
    - tests/ui/theme-editing-workflow.spec.js
    - tests/ui/helpers/theme-token-coverage-fixtures.js
key-decisions:
  - "Save-as-custom request includes sourceThemeId + draft payload so main can materialize complete theme colors and keep payload fidelity."
  - "Renderer validates names with shared validateCustomThemeName before IPC, but main revalidates and enforces duplicate checks as source of truth."
patterns-established:
  - "Save success path re-applies the newly created theme via applyTheme(..., false, payload) and refreshes list/session state without extra persistence writes."
requirements-completed: [FLOW-03]
duration: 6min
completed: 2026-04-10
---

# Phase 15 Plan 03: Theme Editing Workflow Summary

**Theme settings now supports strict manual save-as-custom naming (trim/length/非法字符/重名拦截) and immediately activates the newly saved custom theme.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-10T05:33:37Z
- **Completed:** 2026-04-10T05:39:34Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments
- Added shared save-as-custom request/result contracts and reusable custom-name validator.
- Implemented main/preload/renderer save-as-custom chain with duplicate-name rejection and immediate activation.
- Added contract + Playwright coverage for empty/超长/非法字符/重名 failures and successful activation.

## Task Commits

1. **Task 1: Save-as-custom contracts and validation rules** - `42a993b` (feat)
2. **Task 2: Main/preload/renderer save-as-custom flow (RED)** - `a6f46c5` (test)
3. **Task 2: Main/preload/renderer save-as-custom flow (GREEN)** - `b140774` (feat)
4. **Task 3: UI tests for name validation and activation (RED)** - `74f209d` (test)
5. **Task 3: UI tests for name validation and activation (GREEN)** - `3268853` (feat)

## Files Created/Modified
- `src/shared/theme.ts` - Added save-as-custom contracts and unified custom-name validation.
- `src/main/index.ts` - Added `theme:saveAsCustom` IPC, duplicate check, custom theme file writing, and active-theme switch.
- `src/preload/index.ts` - Exposed `window.api.theme.saveAsCustom`.
- `src/renderer/src/App.tsx` - Added save-as-custom handler, shared validation usage, activation/list updates, and feedback state.
- `src/renderer/src/components/ThemeSettingsDialog/ThemeSettingsDialog.tsx` - Added manual name input + save button + inline feedback rendering.
- `src/renderer/src/components/ThemeSettingsDialog/ThemeSettingsDialog.css` - Styled save input, primary save action, and feedback message.
- `tests/contract/theme-draft-workflow.spec.mjs` - Added contract assertions for save-as-custom wiring.
- `tests/ui/theme-editing-workflow.spec.js` - Added end-to-end save-as-custom name validation and activation scenario.
- `tests/ui/helpers/theme-token-coverage-fixtures.js` - Made theme settings opening helper idempotent for stable UI automation.

## Decisions Made
- Kept name validation centralized in `validateCustomThemeName` and reused in renderer + main for consistent messages and behavior.
- Made main process authoritative for duplicate detection and save activation to avoid renderer-only race conditions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Existing close-flow contract regex became too strict after adding save feedback reset**
- **Found during:** Task 2 verification
- **Issue:** Contract test expected `handleThemeSettingsClose` with only two state updates; new legitimate reset call broke regex.
- **Fix:** Relaxed regex to allow optional `setThemeSaveFeedback(null)` without changing close semantics.
- **Files modified:** `tests/contract/theme-draft-workflow.spec.mjs`
- **Verification:** `node --test tests/contract/theme-draft-workflow.spec.mjs`
- **Committed in:** `b140774`

**2. [Rule 3 - Blocking] Playwright helper failed when settings dialog was already open**
- **Found during:** Task 3 verification
- **Issue:** `openThemeSettings` always clicked menu items; overlay intercepted pointer events when dialog already visible.
- **Fix:** Made helper detect visible dialog and return early.
- **Files modified:** `tests/ui/helpers/theme-token-coverage-fixtures.js`
- **Verification:** `npx playwright test tests/ui/theme-editing-workflow.spec.js -g "save as custom name validation and activation"`
- **Committed in:** `3268853`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes were required to keep contract/UI automation stable; no scope expansion.

## Issues Encountered
- Playwright save-as-custom run required rebuilding `out/` before UI verification due Electron loading built artifacts.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- FLOW-03 save-as-custom loop is implemented and automated.
- Ready for remaining Phase 15 workflow hardening plans.

## Self-Check: PASSED

---
*Phase: 15-theme-editing-workflow*
*Completed: 2026-04-10*
