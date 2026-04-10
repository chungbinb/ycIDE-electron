# Phase 15 Undo History Evidence

Evidence sources:
- UI: `tests/ui/theme-editing-workflow.spec.js` case `FLOW-02 + D15-05/D15-06/D15-07/D15-08...`
- Contract: `tests/contract/theme-draft-workflow.spec.mjs` case `FLOW-02 + D15-05/D15-06/D15-07/D15-08...`

## Sequence Proven by UI Automation

1. Open settings, capture baseline `--text-primary` and `--bg-primary`.
2. Verify undo button disabled and hint is `无可撤销改动`.
3. Apply two edits (`--text-primary=#111111`, `--bg-primary=#222222`).
4. Click `撤销上一步`:
   - `--bg-primary` returns to baseline.
   - `--text-primary` remains at first-step value (`#111111`).
5. Click `恢复会话基线`:
   - both CSS vars return to entry baseline values.
   - settings dialog remains open.
   - undo button returns to disabled state.

## Contract Assertions

Contract case checks App draft handlers and state transitions:

- `canUndoThemeDraft = (historyCursor ?? 0) > 0`
- undo computes `nextCursor = historyCursor - 1`
- baseline restore reads `entrySnapshot`
- baseline restore resets `historyCursor: 0`

## D15 Mapping

- D15-05: undo scope includes full-session baseline snapshot.
- D15-06: multi-step history behavior is active (two edits + one-step undo).
- D15-07: baseline restore does not force-close settings.
- D15-08: no-history state disables undo and shows explicit hint.
