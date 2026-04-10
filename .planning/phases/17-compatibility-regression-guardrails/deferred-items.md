# Deferred Items

- 2026-04-10 (Plan 17-03): `npm run test:theme:full` full UI pass is currently blocked by pre-existing failures in `tests/ui/theme-baseline.spec.js` (invalid persisted theme fallback), `tests/ui/theme-compatibility.spec.js` (QUAL-01 interaction timeout/worker teardown), and `tests/ui/theme-persistence.spec.js` (tampered persisted id fallback). Kept out of scope for 17-03 (CI/script orchestration plan).
