# Phase 16 Coverage Checklist (Plan 16-05)

## Scope Guard
- ✅ Only MGMT-01..04 and D16-01..16 are covered.
- ✅ No QUAL-01/QUAL-02 expansion in this plan.

## Verification Commands
```bash
node --test tests/contract/theme-management-portability.spec.mjs
npx playwright test tests/ui/theme-management-portability.spec.js
npx playwright test tests/ui/theme-management-portability.spec.js -g "MGMT|D16"
```

Latest snapshot: contract `16/16 pass`, UI full `4/4 pass`, UI tagged `4/4 pass`.

## Requirement Trace (MGMT)

| Requirement | Automated Evidence | Status |
| --- | --- | --- |
| MGMT-01 | UI `MGMT-01 + D16-01/D16-02/D16-03/D16-04/D16-05...`; UI `MGMT-01/MGMT-02 + D16-02/.../D16-12...`; contract `MGMT-01 D16-02/D16-08 lifecycle sync...` | ✅ |
| MGMT-02 | UI `MGMT-01/MGMT-02 + D16-02/D16-06/.../D16-12...`; contract export DTO `MGMT-02 D16-10...` | ✅ |
| MGMT-03 | contract conflict union `MGMT-03 D16-14...`; UI `MGMT-03/MGMT-04 + D16-13/D16-14/D16-15...`; UI `MGMT-03 + D16-16...` | ✅ |
| MGMT-04 | contract diagnostics + atomic checks `MGMT-04 D16-13...`; UI `MGMT-03/MGMT-04 + D16-13/D16-14/D16-15...` | ✅ |

## Decision Trace (D16-01..16)

| Decision | Evidence |
| --- | --- |
| D16-01 | Contract built-in rename/delete guards; UI built-in item rename/delete disabled. |
| D16-02 | UI opens dedicated Theme Manager surface (from settings/menu); lifecycle contract includes manager sync. |
| D16-03 | Contract `theme:createFromCurrent` clones current active baseline; UI create-from-current path verified. |
| D16-04 | UI list + detail unsaved draft indicator (`未保存草稿`). |
| D16-05 | UI delete active custom theme fallback notice (`previous built-in`); contract fallback state checks. |
| D16-06 | UI delete requires explicit theme-name confirmation and browser confirm. |
| D16-07 | UI rename duplicate blocked with explicit “已存在”; contract duplicate-name guard. |
| D16-08 | UI active theme rename reflects immediately (`当前` tag + settings radiogroup current); contract lifecycle sync checks. |
| D16-09 | UI export action is single-theme per selection; contract export IPC single request shape. |
| D16-10 | Contract export DTO contains `schemaVersion + theme`; UI export happy-path evidence. |
| D16-11 | Contract default filename pattern `<theme>.ycide-theme.json`; UI feedback includes filename. |
| D16-12 | Contract asserts built-in themes are exportable; UI export scenario covers manager export contract. |
| D16-13 | Contract import diagnostics + rollback checks; UI invalid import diagnostics and no commit calls. |
| D16-14 | Contract conflict decision union and required decision checks; UI conflict branch blocks until decision chosen. |
| D16-15 | Contract overwrite confirmation requirement; UI overwrite path requires second confirm checkbox. |
| D16-16 | UI post-import prompt exposes switch-now/keep-current and validates both branches. |
