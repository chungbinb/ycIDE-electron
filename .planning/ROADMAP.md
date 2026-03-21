# Roadmap: ycIDE Support Library Migration

## Overview

This roadmap delivers a full third-party support-library migration pipeline from scope discovery to safe promotion, so every unmigrated library in `第三方相关文件` can be converted to UTF-8, adapted for x64, verified inside existing ycIDE library workflows, and promoted into `支持库源码` with traceable completion evidence.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Inventory & Baseline Lock** - Identify complete migration scope and establish authoritative tracking.
- [ ] **Phase 2: Deterministic Encoding Conversion** - Convert GBK/mixed assets to UTF-8 with repeatable validation and reporting.
- [ ] **Phase 3: x64 Adaptation & Dual-Arch Gates** - Make each target library x64-safe while retaining x86 comparison diagnostics.
- [ ] **Phase 4: ycIDE Integration Verification** - Prove migrated libraries load and behave correctly in current ycIDE contracts.
- [ ] **Phase 5: Atomic Promotion & Completion Traceability** - Promote verified libraries safely into `支持库源码` with reversible delivery records.

## Phase Details

### Phase 1: Inventory & Baseline Lock
**Goal**: Maintainers can see the full unmigrated library scope and current migration progress from one authoritative baseline.
**Depends on**: Nothing (first phase)
**Requirements**: INVT-01, INVT-02, INVT-03
**Success Criteria** (what must be TRUE):
  1. Maintainer can generate a complete list of libraries under `第三方相关文件` that are not present in `支持库源码`.
  2. Maintainer can view architecture and encoding status for each unmigrated library (`x86-only`/`mixed`/`x64-ready`, `gbk`/`mixed`/`utf-8`).
  3. Maintainer can check one authoritative manifest/report and immediately see migration coverage percentage and remaining count.
**Plans**: TBD

### Phase 2: Deterministic Encoding Conversion
**Goal**: Maintainers can reliably convert targeted library content to UTF-8 without silent corruption.
**Depends on**: Phase 1
**Requirements**: ENCD-01, ENCD-02, ENCD-03, ENCD-04
**Success Criteria** (what must be TRUE):
  1. Maintainer can run one repeatable conversion workflow that transforms targeted GBK content into UTF-8 outputs per library.
  2. Workflow explicitly flags mixed/uncertain encoding files instead of silently rewriting them.
  3. Maintainer receives a per-library conversion report listing converted files, flagged files, and verification outcome.
  4. Converted outputs preserve required text semantics so representative compile/load/runtime paths continue to behave correctly.
**Plans**: TBD

### Phase 3: x64 Adaptation & Dual-Arch Gates
**Goal**: Each targeted library is x64-compatible and validated for ABI-sensitive correctness, with x86 preserved for diagnostics.
**Depends on**: Phase 2
**Requirements**: X64A-01, X64A-02, X64A-03, X64A-04
**Success Criteria** (what must be TRUE):
  1. Maintainer can produce x64-compatible build outputs for each targeted migrated library.
  2. Maintainer can verify pointer-width, struct-layout/alignment, and callback-signature-sensitive changes were validated per library.
  3. x64 build verification clearly passes for adapted libraries and clearly fails with explicit errors where adaptation is incomplete.
  4. Maintainer can run an x86 comparison lane during migration to diagnose regressions before promotion.
**Plans**: TBD

### Phase 4: ycIDE Integration Verification
**Goal**: Migrated libraries are consumable by current ycIDE support-library loading and compile/runtime flows.
**Depends on**: Phase 3
**Requirements**: INTG-01, INTG-02, INTG-03
**Success Criteria** (what must be TRUE):
  1. Migrated libraries are discoverable and loadable through ycIDE’s existing support-library workflow without introducing GUID/command conflicts.
  2. Migrated UI/component libraries expose usable event protocol metadata needed for compile-time event binding.
  3. Maintainer can run a minimum regression suite that validates library load, representative compile flow, and key runtime/event behaviors.
**Plans**: TBD

### Phase 5: Atomic Promotion & Completion Traceability
**Goal**: Verified libraries are promoted into `支持库源码` through safe, reversible operations with auditable completion status.
**Depends on**: Phase 4
**Requirements**: RELS-01, RELS-02, RELS-03
**Success Criteria** (what must be TRUE):
  1. Each migrated library can be promoted via an atomic process that either commits fully or rolls back cleanly.
  2. Maintainer can retrieve a traceable record per migrated library containing encoding actions, x64 adaptation notes, verification status, and known limitations.
  3. Project completion report can only mark migration complete when all unmigrated targets are UTF-8 converted, x64 adapted, and verified.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Inventory & Baseline Lock | 0/TBD | Not started | - |
| 2. Deterministic Encoding Conversion | 0/TBD | Not started | - |
| 3. x64 Adaptation & Dual-Arch Gates | 0/TBD | Not started | - |
| 4. ycIDE Integration Verification | 0/TBD | Not started | - |
| 5. Atomic Promotion & Completion Traceability | 0/TBD | Not started | - |
