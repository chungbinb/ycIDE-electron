---
phase: 17-compatibility-regression-guardrails
plan: 02
subsystem: testing
tags: [playwright, electron, compatibility, contract, qual-01]
requires:
  - phase: 16-theme-management-portability
    provides: theme lifecycle, import/export hooks, deterministic UI automation patterns
provides:
  - QUAL-01 UI compatibility suite with transition-in-progress and post-transition assertions
  - visual jitter sampling + hard failure policy
  - compatibility contract guards for App/ThemeSettings/Editor/EycTableEditor integration points
affects: [phase-17, regression-gates, theme-stability]
tech-stack:
  added: []
  patterns:
    - titlebar-driven theme switching for non-blocking interaction compatibility probes
    - scenario-path jitter diagnostics with structured threshold violations
key-files:
  created:
    - tests/ui/helpers/theme-compatibility-fixtures.js
    - tests/ui/theme-compatibility.spec.js
    - tests/contract/theme-compatibility-contract.spec.mjs
  modified:
    - tests/ui/helpers/theme-compatibility-fixtures.js
    - tests/ui/theme-compatibility.spec.js
key-decisions:
  - "Use titlebar theme switching (not settings dialog radios) during compatibility probes so editor/table interactions remain actionable while switching."
  - "Treat jitter as hard failure when any sampled selector delta exceeds 0.5px and emit scenario-path diagnostics."
patterns-established:
  - "QUAL-01 compatibility tests run serialized with project bootstrap + custom theme seed per suite."
requirements-completed: [QUAL-01]
duration: 81min
completed: 2026-04-10
---

# Phase 17 Plan 02: QUAL-01 compatibility suite summary

**Shipped automated QUAL-01 guardrails that verify editor/table usability through theme transitions (built-in dark/light + custom), with hard jitter-fail diagnostics and matching contract regression checks.**

## Performance

- **Duration:** 81 min
- **Started:** 2026-04-10T15:35:00Z
- **Completed:** 2026-04-10T16:55:57Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Added `tests/ui/theme-compatibility.spec.js` with explicit `QUAL-01` naming, covering input/cursor, table edit+selection, scroll, and focus switching in both transition-in-progress and post-transition states.
- Added reusable `tests/ui/helpers/theme-compatibility-fixtures.js` to bootstrap deterministic project state, seed custom themes, run titlebar-driven switch probes, and collect jitter samples.
- Added `tests/contract/theme-compatibility-contract.spec.mjs` to lock App↔ThemeSettings↔Editor/EycTableEditor compatibility connection points.
- Enforced jitter failure policy (`>0.5px` sampled shift) with scenario-path failure payloads to make failures actionable.

## Task Commits

1. **Task 1: 新增 QUAL-01 交互兼容性 UI 套件** - `68a6a39` (feat)
2. **Task 2: 将 visual jitter 失败规则编码为自动断言** - `343add2` (fix)
3. **Task 3: 补充兼容性 contract 防回归断言** - `63481da` (test)

## Files Created/Modified
- `tests/ui/helpers/theme-compatibility-fixtures.js` - compatibility project bootstrap, interaction probes, theme switching, jitter sampling/policy.
- `tests/ui/theme-compatibility.spec.js` - QUAL-01 UI suite for transition/post-transition and jitter policy coverage.
- `tests/contract/theme-compatibility-contract.spec.mjs` - static contract assertions for compatibility-critical integration wiring.

## Decisions Made
- Switched runtime theme toggling in compatibility probes to titlebar menu path to avoid settings overlay blocking editor/table interactions.
- Kept jitter policy strict and machine-actionable by including scenario path, threshold, sample count, and per-selector axis deltas in thrown errors.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Settings overlay blocked interaction probes during transition checks**
- **Found during:** Task 1
- **Issue:** Radio-based switching inside settings dialog intercepted pointer events, preventing required editor/table actions.
- **Fix:** Changed probe switching path to titlebar theme menu and added dialog close guard before interactions.
- **Files modified:** `tests/ui/helpers/theme-compatibility-fixtures.js`
- **Verification:** `npx playwright test tests/ui/theme-compatibility.spec.js -g QUAL-01 --workers=1 --reporter=line`
- **Committed in:** `68a6a39`

**2. [Rule 1 - Bug] Theme submenu selection and table selection probes were flaky**
- **Found during:** Task 1-2 hardening
- **Issue:** Hover-only submenu opening and strict row-selection assumptions caused intermittent failures.
- **Fix:** Added hover+click fallback for theme submenu and replaced brittle row-class expectation with editable-cell selection assertions.
- **Files modified:** `tests/ui/helpers/theme-compatibility-fixtures.js`
- **Verification:** `npx playwright test tests/ui/theme-compatibility.spec.js -g QUAL-01 --workers=1 --reporter=line`
- **Committed in:** `343add2`

---

**Total deviations:** 2 auto-fixed (Rule 1: 2)
**Impact on plan:** Both fixes were required to make QUAL-01 coverage deterministic and executable; no scope creep beyond planned guardrails.

## Issues Encountered
- UI automation created temporary custom theme files in `themes/`; these were cleaned after each verification run to keep repository state clean.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- QUAL-01 now has executable UI + contract regression layers and actionable jitter failure output.
- Ready for downstream Phase 17 gate orchestration/quarantine policy work to consume these suites.

## Self-Check: PASSED
- FOUND: `.planning/phases/17-compatibility-regression-guardrails/17-02-SUMMARY.md`
- FOUND commits: `68a6a39`, `343add2`, `63481da`
