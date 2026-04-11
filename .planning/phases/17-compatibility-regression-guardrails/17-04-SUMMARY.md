---
phase: 17-compatibility-regression-guardrails
plan: 04
subsystem: infra
tags: [quality-gate, quarantine, ci, playwright, node-test]
requires:
  - phase: 17-compatibility-regression-guardrails
    provides: "Phase 17 gate/full orchestration and QUAL suites"
provides:
  - "Quarantine registry with owner/due/replacement policy enforcement"
  - "Overdue quarantine auto-block checker wired into CI workflow"
  - "Actionable QUAL failure formatter (path + expected/actual + remediation)"
  - "D17-01..D17-16 and QUAL-01/QUAL-02 evidence matrix"
affects: [phase-17, quality-gates, audit-traceability]
tech-stack:
  added: []
  patterns:
    - "Policy-before-gate enforcement for quarantine exceptions"
    - "Structured failure reporting in gate runner output"
key-files:
  created:
    - .github/quality/quarantine-theme-tests.json
    - scripts/theme/check-quarantine-overdue.mjs
    - scripts/theme/format-qual-failure.mjs
    - .planning/phases/17-compatibility-regression-guardrails/17-EVIDENCE-MATRIX.md
  modified:
    - .github/workflows/theme-quality-gates.yml
    - scripts/theme/run-theme-gate.mjs
key-decisions:
  - "Quarantine entries are blocked unless owner/due/replacement metadata is complete and replacement test exists."
  - "Gate runner now prints structured actionable diagnostics on contract/UI step failures."
patterns-established:
  - "Theme quality jobs run quarantine policy check before gate/full execution."
requirements-completed: [QUAL-02]
duration: 22min
completed: 2026-04-11
---

# Phase 17 Plan 04: Quarantine policy + actionable failure evidence summary

**Shipped enforceable quarantine controls and actionable gate failure reporting, plus a full D17/QUAL evidence matrix for Phase 17 audit closure.**

## Performance
- **Duration:** 22 min
- **Started:** 2026-04-11T02:20:00Z
- **Completed:** 2026-04-11T02:42:00Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Added quarantine registry artifact and overdue auto-block script with replacement-test enforcement.
- Wired quarantine policy checks into PR and pre-release theme quality workflow jobs before running gates.
- Added actionable QUAL failure formatter and integrated it into `run-theme-gate`.
- Produced Phase 17 evidence matrix mapping QUAL-01/QUAL-02 to D17-01..D17-16 with commands and evidence locations.

## Task Commits
1. **Task 1: 落地 quarantine 注册表与逾期自动阻断** - `b0c89da` (feat)
2. **Task 2: 标准化 QUAL 失败输出为场景可行动格式** - `2f7e801` (feat)
3. **Task 3: 生成 Phase 17 objective evidence matrix** - `9db840d` (docs)

## Files Created/Modified
- `.github/quality/quarantine-theme-tests.json` - Quarantine registry schema/policy file.
- `scripts/theme/check-quarantine-overdue.mjs` - Enforces owner/due/replacement/overdue policy and replacement existence.
- `.github/workflows/theme-quality-gates.yml` - Runs quarantine policy check before fast gate/full regression.
- `scripts/theme/format-qual-failure.mjs` - Emits structured path/expected/actual/remediation failure output.
- `scripts/theme/run-theme-gate.mjs` - Uses formatter on failed contract/UI steps.
- `.planning/phases/17-compatibility-regression-guardrails/17-EVIDENCE-MATRIX.md` - Full D17 + QUAL evidence mapping.

## Decisions Made
- Kept quarantine registry empty-by-default and policy-enforced so quarantine is never an implicit bypass.
- Kept actionable failure formatting inside gate runner step failure path so both contract and UI failures are covered uniformly.

## Verification Summary
- `node scripts/theme/check-quarantine-overdue.mjs` ✅ pass
- `npm run test:theme:gate` ✅ pass
- `node -e "const fs=require('fs');const t=fs.readFileSync('.planning/phases/17-compatibility-regression-guardrails/17-EVIDENCE-MATRIX.md','utf8');for(let i=1;i<=16;i++){if(!t.includes('D17-'+String(i).padStart(2,'0')))process.exit(1)}if(!/QUAL-01/.test(t)||!/QUAL-02/.test(t))process.exit(1)"` ✅ pass

## Deviations from Plan

### Auto-fixed Issues
**1. [Rule 3 - Blocking] Final metadata commit helper skipped gitignored planning files**
- **Found during:** Final metadata commit step
- **Issue:** `gsd-tools commit` returned `skipped_gitignored` for `.planning/**` artifacts.
- **Fix:** Staged summary/state/roadmap with explicit force-add and completed manual docs commit.
- **Files modified:** `.planning/phases/17-compatibility-regression-guardrails/17-04-SUMMARY.md`, `.planning/STATE.md`, `.planning/ROADMAP.md`
- **Committed in:** final metadata docs commit

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 17 now has enforceable quarantine governance and actionable failure output in gate execution.
- Evidence matrix provides auditable linkage from requirements to tests/commands/CI hooks.

## Authentication Gates
None.

## Known Stubs
None.

## Self-Check: PASSED
- FOUND: `.planning/phases/17-compatibility-regression-guardrails/17-04-SUMMARY.md`
- FOUND: `.github/quality/quarantine-theme-tests.json`
- FOUND: `scripts/theme/check-quarantine-overdue.mjs`
- FOUND: `scripts/theme/format-qual-failure.mjs`
- FOUND: `.planning/phases/17-compatibility-regression-guardrails/17-EVIDENCE-MATRIX.md`
- FOUND commit: `b0c89da`
- FOUND commit: `2f7e801`
- FOUND commit: `9db840d`

