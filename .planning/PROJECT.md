# ycIDE Support Library Migration

## What This Is

This project modernizes the existing ycIDE ecosystem by migrating third-party 易语言功能库/界面库 that are still outside `支持库源码` into the repository’s support-library source tree.  
The current focus is a brownfield conversion effort: convert GBK-encoded libraries to UTF-8 and complete x64-capable adaptation for all not-yet-migrated libraries in `第三方相关文件`.

## Core Value

All targeted third-party libraries are migrated into `支持库源码` with UTF-8 encoding and x64 support, so they can be reliably maintained and built within ycIDE.

## Requirements

### Validated

- ✓ Electron-based IDE shell exists with main/preload/renderer boundaries and IPC integration — existing
- ✓ Project/file/compiler/library/theme flows already run in the current desktop architecture — existing
- ✓ Support-library loading/parsing pipeline exists (`.fne` scan/load/conflict checks, metadata access) — existing
- ✓ Windows-oriented compiler/toolchain packaging flow exists (`compiler/`, `lib/`, `static_lib/`, `themes/`) — existing
- ✓ Basic UI automation baseline exists (Playwright Electron startup smoke test) — existing
- ✓ Identify all 易语言功能库/界面库 in `第三方相关文件` that are not yet migrated into `支持库源码` — Validated in Phase 01: inventory-baseline-lock

### Active

- [ ] Convert all identified GBK-encoded source/content artifacts to UTF-8 without functional regression
- [ ] Complete x64 adaptation for each identified unmigrated library
- [ ] Place migrated/adapted outputs into `支持库源码` in a maintainable structure consistent with existing conventions
- [ ] Verify every targeted library migration result can be consumed by current ycIDE support-library workflow

### Out of Scope

- New IDE features (UI redesign, debugger enhancements, AI assistant expansion) — not part of this migration-only initiative
- Broad refactoring of existing already-migrated support libraries — not required for current objective
- Membership/plugin/accessibility/settings roadmap items listed in README — unrelated to immediate migration task

## Context

This is a brownfield repository with an existing Electron + React + TypeScript IDE architecture and an established support-library loading/compilation pipeline.  
A codebase map already exists under `.planning/codebase/` and confirms the app’s current capabilities and integration points.  
The user’s current intent is narrowly scoped: finish migration of remaining third-party 易语言 libraries from GBK/x32 state into UTF-8/x64 form under `支持库源码`, before pursuing broader product work.
Phase 01 is complete: inventory and baseline lock artifacts now provide a deterministic, authoritative scope view (including migration coverage and remaining counts) for subsequent conversion and x64 phases.

## Constraints

- **Compatibility**: Must preserve existing ycIDE support-library consumption flow — migration outputs need to work with current loader/compiler integration.
- **Scope**: Migration-only delivery — exclude unrelated feature work even if adjacent opportunities appear.
- **Platform**: Windows-centric toolchain and x64 target support are required for the migrated libraries.
- **Source Diversity**: Inputs may vary in encoding/layout in `第三方相关文件`, requiring careful per-library handling.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Prioritize third-party library migration as the project goal | User explicitly requested this as the sole current mission | — Pending |
| Treat repository as brownfield and retain existing IDE architecture | Existing capabilities are already validated and should be reused | — Pending |
| Define completion as “all unmigrated libraries converted to UTF-8 and adapted to x64” | User gave explicit completion criteria | — Pending |
| Exclude non-migration IDE enhancements from this cycle | Keeps execution focused and prevents scope creep | — Pending |
| Establish `.planning/baselines/inventory-baseline.json` as the authoritative phase baseline artifact | Gives one source of truth for migration scope and coverage tracking | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-21 after Phase 01 completion*
