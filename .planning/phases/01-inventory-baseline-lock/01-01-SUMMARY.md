---
phase: 01-inventory-baseline-lock
plan: 01
subsystem: testing
tags: [inventory, baseline, migration, utf-8, x64, node-test]
requires: []
provides:
  - Deterministic inventory baseline CLI for scoped third-party roots
  - Conservative architecture and encoding classifiers for unmigrated libraries
  - Authoritative baseline manifest with computed coverage metrics
affects: [phase-2-deterministic-encoding-conversion, phase-3-x64-adaptation]
tech-stack:
  added: []
  patterns: [set-diff inventory baseline, conservative mixed-on-uncertain classification, single authoritative manifest]
key-files:
  created:
    - scripts/migration/inventory-baseline.mjs
    - scripts/migration/classify-arch.mjs
    - scripts/migration/classify-encoding.mjs
    - tests/migration/inventory-baseline.spec.mjs
    - tests/migration/fixtures/README.md
    - .planning/baselines/inventory-baseline.json
    - .planning/phases/01-inventory-baseline-lock/README.md
  modified:
    - package.json
key-decisions:
  - "Use hard-scoped roots only: 第三方相关文件/易语言的功能库, 第三方相关文件/易语言的界面库, 支持库源码."
  - "Classify uncertain/ambiguous architecture and encoding as mixed to avoid overconfident baseline claims."
patterns-established:
  - "Manifest-first baseline: regenerate then check against computed totals."
  - "INVT requirement mapping directly into executable Node tests."
requirements-completed: [INVT-01, INVT-02, INVT-03]
duration: 5min
completed: 2026-03-21
---

# Phase 1 Plan 1: Inventory Baseline Pipeline Summary

**Deterministic scoped inventory baseline CLI now computes unmigrated coverage with conservative arch/encoding classification and publishes a single authoritative manifest.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-21T03:49:30Z
- **Completed:** 2026-03-21T03:54:30Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- Added INVT-01/02/03 contract tests (RED first) and repeatable npm command surface.
- Implemented deterministic generator with scoped roots + set-diff against `支持库源码`.
- Published committed baseline manifest and phase operator README for regenerate/check workflow.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Phase 1 baseline contracts and failing checks first** - `adc7d0f` (test)
2. **Task 2: Implement deterministic inventory generator and conservative classifiers** - `7fc1db3` (feat)
3. **Task 3: Publish authoritative baseline artifact and operator instructions** - `abf655e` (feat)

## Files Created/Modified
- `tests/migration/inventory-baseline.spec.mjs` - INVT-01/02/03 executable baseline contracts.
- `tests/migration/fixtures/README.md` - fixture and coverage intent documentation.
- `scripts/migration/inventory-baseline.mjs` - generator/check CLI and manifest validation.
- `scripts/migration/classify-arch.mjs` - architecture state classifier.
- `scripts/migration/classify-encoding.mjs` - conservative encoding classifier.
- `.planning/baselines/inventory-baseline.json` - authoritative baseline artifact with totals and rows.
- `.planning/phases/01-inventory-baseline-lock/README.md` - operator workflow and schema guide.
- `package.json` - migration command scripts exposed for baseline/check/test.

## Decisions Made
- Locked scanner scope to requirement-defined roots only to prevent inflated/non-authoritative inventory counts.
- Used conservative classifier behavior (`mixed` on conflict/uncertainty) to preserve correctness for later conversion/adaptation phases.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prevented CLI side-effect output during test imports**
- **Found during:** Task 2
- **Issue:** CLI printed full baseline JSON when module was imported by tests due to brittle direct-execution detection.
- **Fix:** Replaced URL-string comparison with robust `process.argv[1]` path check in `isDirectExecution()`.
- **Files modified:** `scripts/migration/inventory-baseline.mjs`
- **Verification:** `npm run test:migration` passes without unsolicited JSON output.
- **Committed in:** `7fc1db3` (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary correctness fix; no scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 1 baseline is committed and reproducible with one regenerate/check command pair.
- Phase 2 can consume `.planning/baselines/inventory-baseline.json` as authoritative migration scope input.

## Known Stubs
None detected in plan-created files.

## Self-Check: PASSED

- FOUND: `scripts/migration/inventory-baseline.mjs`
- FOUND: `scripts/migration/classify-arch.mjs`
- FOUND: `scripts/migration/classify-encoding.mjs`
- FOUND: `tests/migration/inventory-baseline.spec.mjs`
- FOUND: `tests/migration/fixtures/README.md`
- FOUND: `.planning/baselines/inventory-baseline.json`
- FOUND: `.planning/phases/01-inventory-baseline-lock/README.md`
- FOUND commit: `adc7d0f`
- FOUND commit: `7fc1db3`
- FOUND commit: `abf655e`
