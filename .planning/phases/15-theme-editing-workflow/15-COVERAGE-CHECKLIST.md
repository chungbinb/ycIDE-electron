# Phase 15 Coverage Checklist

Generated for Plan 15-05.

## Verification Commands

```bash
node --test tests/contract/theme-draft-workflow.spec.mjs
npx playwright test tests/ui/theme-editing-workflow.spec.js
npm run build && node --test tests/contract/theme-draft-workflow.spec.mjs
```

Latest result snapshot: contract `8/8 pass`, UI `3/3 pass`, build `pass`.

## FLOW Requirement Trace

| Requirement | Must prove | Automated evidence | Status |
| --- | --- | --- | --- |
| FLOW-01 | 修改后即时预览，无需重启 | `tests/ui/theme-editing-workflow.spec.js` → `FLOW-01 + D15-01..D15-04 + D15-13/D15-15/D15-16...` + contract `FLOW-01 + D15-01/D15-02...` | ✅ Pass |
| FLOW-02 | 多步撤销并可恢复进入前基线 | `tests/ui/theme-editing-workflow.spec.js` → `FLOW-02 + D15-05/D15-06/D15-07/D15-08...` + contract `FLOW-02 + D15-05/D15-06/D15-07/D15-08...` | ✅ Pass |
| FLOW-03 | 可保存为自定义主题并立即可用 | `tests/ui/theme-editing-workflow.spec.js` → `FLOW-03 + D15-09/D15-10/D15-11/D15-12...` + contract `FLOW-03 + D15-09/D15-10/D15-11/D15-12...` | ✅ Pass |

## D15 Decision Trace

| Decision | Evidence |
| --- | --- |
| D15-01 | Contract: first-edit draft start (`FLOW-01 + D15-01/D15-02...`) |
| D15-02 | Contract: save-only commit path (`FLOW-01 + D15-01/D15-02...`) |
| D15-03 | Contract: theme switch discards active draft (`D15-03 contract...`) |
| D15-04 | Contract: close resets session; reopen no recovery (`D15-04 contract...`) |
| D15-05 | UI + contract undo coverage (`FLOW-02 + D15-05/D15-06/D15-07/D15-08...`) |
| D15-06 | UI: two edits then undo one step (multi-step history behavior) |
| D15-07 | UI: baseline restore keeps settings dialog open |
| D15-08 | UI: no-history undo disabled + “无可撤销改动” hint |
| D15-09 | UI: save requires manual input (`自定义主题名称`, empty-name error) |
| D15-10 | UI: duplicate name (`默认深色`) rejected |
| D15-11 | UI: successful save activates new theme immediately (`aria-checked=true`, `effectiveThemeId`) |
| D15-12 | UI: trim behavior (`  name  ` saves as trimmed id) + contract regex checks for trim/length/reserved-char logic |
| D15-13 | UI parity case + contract unified close-intent handler |
| D15-14 | Contract: native dialog buttons use `defaultId: 2`, `cancelId: 2` (`继续编辑`) |
| D15-15 | UI: close-button / Esc / overlay all enter same flow |
| D15-16 | UI: app-exit close intent enters same flow (`app-exit`) |

## Gate Result

FLOW-01/02/03 and D15-01..D15-16 traceability is complete for Phase 15 closeout.
