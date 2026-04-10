# Phase 16 Conflict Resolution Matrix

## Scope
Conflict decision behavior for MGMT-03, D16-14/15/16 (no Phase 17 expansion).

| Branch | Preconditions | Required Inputs | Expected Outcome | Evidence | Result |
| --- | --- | --- | --- | --- | --- |
| Conflict detected | Imported name matches existing theme | none | Return `status: conflict` + allowed decisions | Main `theme:import`; contract conflict union checks | ✅ |
| No decision submitted | Conflict state | `decision` missing | Block commit with `conflict_decision_required` | Main/contract conflict gate test | ✅ |
| Rename-import decision | Conflict state | `decision: rename-import`, `newThemeName` | Import under new name if non-duplicate | Contract decision union + validation; UI conflict flow supports rename branch controls | ✅ |
| Overwrite decision missing second confirm | Conflict state | `decision: overwrite` without `overwriteConfirmed=true` | Block commit with `invalid_conflict_decision` | Main/contract overwrite confirmation checks | ✅ |
| Overwrite decision confirmed | Conflict state | `decision: overwrite`, target id, `overwriteConfirmed: true` | Commit succeeds with `overwritten: true` | UI `...D16-13/D16-14/D16-15...` | ✅ |
| Post-import keep-current | Successful commit | Click `保持当前` | Keep current active theme; show imported feedback | UI `...D16-13/D16-14/D16-15...` | ✅ |
| Post-import switch-now | Successful commit | Click `立即切换` | Activate imported target; show switch feedback | UI `MGMT-03 + D16-16...` | ✅ |

## Decision Contract Notes
- Conflict decisions are mutually exclusive unions: `rename-import` vs `overwrite`.
- Overwrite path is intentionally stricter and requires explicit second confirmation.
- Switch-now vs keep-current remains a user-visible explicit post-import branch.
