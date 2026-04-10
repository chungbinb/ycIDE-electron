# Phase 16 Import Error Matrix

## Scope
Import validation/atomic-fail evidence for MGMT-04, D16-13 (Phase 16 only).

| Scenario | Expected Behavior | Evidence | Result |
| --- | --- | --- | --- |
| Invalid JSON / parse failure | Return `status: invalid` with `$` diagnostic, no write | Main handler `theme:import` invalid JSON branch; contract diagnostics checks | ✅ |
| Unsupported schemaVersion | `path: schemaVersion` diagnostic (`unsupported_schema_version`) | Contract `MGMT-04 D16-13 schemaVersion invalid...` | ✅ |
| Missing `theme` / `theme.name` / `theme.colors` | Field-level diagnostics list | Contract `MGMT-04 D16-13 missing theme fields...` | ✅ |
| UI invalid import preview | Show diagnostics panel; do not show commit action | UI `MGMT-03/MGMT-04 + D16-13/D16-14/D16-15...` (`theme.colors`) | ✅ |
| Invalid import no-write | Commit API is not called for invalid preview | UI poll `__importCommitCalls` remains `0` before valid conflict step | ✅ |
| Commit-time exception | Rollback theme file/config and return `commit_failed` | Main `theme:importCommit` catch: rollback theme + `writeThemeConfig(rollbackConfig)`; contract atomic rollback check | ✅ |

## Atomic Fail Proof
- Validation (`theme:import`) is separate from write path (`theme:importCommit`).
- Invalid preview exits before commit path.
- Commit path includes rollback snapshot (`rollbackTheme`, `rollbackConfig`) and best-effort restore on error.
