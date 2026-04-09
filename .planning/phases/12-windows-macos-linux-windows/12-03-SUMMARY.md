---
phase: 12-windows-macos-linux-windows
plan: 03
subsystem: testing
tags: [playwright, electron, ui-testing, library-store]
requires:
  - phase: 12-01
    provides: store card data contract and aggregated IPC card model
  - phase: 12-02
    provides: library dialog card UI with platform and status badges
provides:
  - library store platform-visibility UI tests for windows-only/all-platform cards
  - library store download/load status transition UI test
  - updated Phase 12 validation strategy with nyquist compliance enabled
affects: [phase-12-verify, ui-regression, library-dialog]
tech-stack:
  added: []
  patterns: [ipcMain handler mocking for Electron Playwright determinism, class-based card locators]
key-files:
  created: [tests/ui/library-store-cards.spec.js, tests/ui/library-store-status.spec.js, tests/ui/helpers/library-store-fixtures.js]
  modified: [.planning/phases/12-windows-macos-linux-windows/12-VALIDATION.md]
key-decisions:
  - "Mock library:getStoreCards/getInfo/applySelection at ipcMain layer because preload-exposed window.api methods are immutable in renderer."
  - "Keep per-task verification on smoke command and run library-store grep/full UI suite as wave/phase gates."
patterns-established:
  - "Electron UI tests can inject deterministic backend state by replacing ipcMain handlers per launched app instance."
requirements-completed: []
duration: 6min
completed: 2026-04-09
---

# Phase 12 Plan 03: UI regression coverage summary

**Playwright Electron coverage now asserts card platform badges and downloaded/loaded status transitions for library store scenarios using deterministic IPC fixtures.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-09T08:12:00Z
- **Completed:** 2026-04-09T08:18:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added RED+GREEN TDD UI specs for library store cards and status behavior.
- Added reusable windows-only/all-platform fixture helper for test data.
- Updated `12-VALIDATION.md` to mark Wave 0 assets landed and set `nyquist_compliant: true`.

## Task Commits

1. **Task 1: 新增卡片平台可见性与状态联动 UI 用例** - `831986a` (test), `dca0309` (feat)
2. **Task 2: 更新 Phase 12 验证策略为已可执行状态** - `0502670` (feat)

## Files Created/Modified
- `tests/ui/library-store-cards.spec.js` - platform badge assertions for windows-only/all-platform cards.
- `tests/ui/library-store-status.spec.js` - downloaded/loaded state assertions before and after apply.
- `tests/ui/helpers/library-store-fixtures.js` - deterministic card/detail fixtures for library store tests.
- `.planning/phases/12-windows-macos-linux-windows/12-VALIDATION.md` - validation map/checklist/nyquist status aligned to shipped assets.

## Decisions Made
- Use ipcMain-level handler replacement in Electron tests instead of renderer API monkey-patching to guarantee deterministic fixture control.
- Keep smoke checks per task and run grep/full UI suites at wave/phase verification boundaries.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Renderer API stubbing approach could not override immutable preload methods**
- **Found during:** Task 1
- **Issue:** `window.api.library` methods are not writable from renderer; fixture injection via `window.evaluate` had no effect.
- **Fix:** Switched to `electronApp.evaluate` and replaced `ipcMain` handlers for `library:getStoreCards`, `library:getInfo`, and `library:applySelection`.
- **Files modified:** `tests/ui/library-store-cards.spec.js`, `tests/ui/library-store-status.spec.js`
- **Verification:** `npm run test:ui -- --grep "library store"` passed.
- **Committed in:** `dca0309`

**2. [Rule 3 - Blocking] Planning files are gitignored and blocked normal staging**
- **Found during:** Task 2
- **Issue:** `git add` rejected `.planning/.../12-VALIDATION.md`.
- **Fix:** Used `git add -f` for explicit plan-doc staging.
- **Files modified:** `.planning/phases/12-windows-macos-linux-windows/12-VALIDATION.md`
- **Verification:** Commit `0502670` created successfully.
- **Committed in:** `0502670`

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** All fixes were required to complete planned verification artifacts; no scope creep.

## Issues Encountered
- None beyond resolved blocking items above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 12 now has automated regression coverage for card/platform/status requirements and an executable validation contract.
- Ready for `/gsd-verify-work` with smoke/grep/full commands already green.

## Self-Check: PASSED
- FOUND: `.planning/phases/12-windows-macos-linux-windows/12-03-SUMMARY.md`
- FOUND commit: `831986a`
- FOUND commit: `dca0309`
- FOUND commit: `0502670`
