# Requirements: ycIDE Support Library Migration

**Defined:** 2026-03-21  
**Core Value:** All targeted third-party libraries are migrated into `支持库源码` with UTF-8 encoding and x64 support, so they can be reliably maintained and built within ycIDE.

## v1 Requirements

### Inventory & Scope

- [x] **INVT-01**: Maintainer can generate a complete list of 易语言功能库/界面库 under `第三方相关文件` that are not yet present in `支持库源码`.
- [x] **INVT-02**: Maintainer can classify each unmigrated library with architecture state (`x86-only`, `mixed`, `x64-ready`) and encoding state (`gbk`, `mixed`, `utf-8`).
- [x] **INVT-03**: Maintainer can track migration coverage (%) and remaining library count from a single authoritative manifest/report.

### Encoding Conversion

- [ ] **ENCD-01**: Maintainer can run a repeatable conversion workflow that converts targeted GBK content to UTF-8 for each unmigrated library.
- [ ] **ENCD-02**: Conversion workflow can detect and flag mixed/uncertain encoding files instead of silently rewriting them.
- [ ] **ENCD-03**: Conversion workflow can produce a per-library conversion report (files converted, files flagged, verification result).
- [ ] **ENCD-04**: Converted outputs preserve functional text semantics required by compile/load/runtime paths.

### x64 Adaptation

- [ ] **X64A-01**: Maintainer can adapt each targeted library build/config/source to produce x64-compatible outputs.
- [ ] **X64A-02**: Adaptation process validates pointer-width/ABI-sensitive changes (types, struct layout/alignment, callback signatures) for each migrated library.
- [ ] **X64A-03**: Adapted libraries can pass x64 build verification with failure surfaced explicitly when adaptation is incomplete.
- [ ] **X64A-04**: Migration process preserves an x86 comparison lane for regression diagnostics during transition.

### Integration Verification

- [ ] **INTG-01**: Migrated libraries can be discovered and loaded by ycIDE’s existing support-library workflow without GUID/command conflict regressions.
- [ ] **INTG-02**: Migrated window/component libraries provide usable event protocol metadata required for compile-time event binding.
- [ ] **INTG-03**: A minimum regression suite verifies library load, representative compile flow, and key runtime/event behavior for migrated libraries.

### Promotion & Traceability

- [ ] **RELS-01**: Each migrated library is promoted into `支持库源码` through an atomic, reversible process (success commit or rollback).
- [ ] **RELS-02**: Each migrated library has a traceable delivery record including encoding actions, x64 adaptation notes, verification status, and known limitations.
- [ ] **RELS-03**: Project can report final completion only when all unmigrated target libraries are converted to UTF-8, adapted to x64, and verified.

## v2 Requirements

### Migration Efficiency

- **AUTO-01**: Maintainer can generate an automated migration scorecard (red/yellow/green) across all libraries.
- **AUTO-02**: Maintainer can run dry-run risk simulation to estimate migration impact before writing files.
- **AUTO-03**: Maintainer can validate migration using a broader golden multi-library sample project set.

### Protocol Automation

- **PROT-01**: Maintainer can semi-automatically generate event protocol drafts for UI libraries from metadata and existing mappings.
- **PROT-02**: Maintainer can auto-generate compatibility matrix documentation for each migrated library.

## Out of Scope

| Feature | Reason |
|---------|--------|
| IDE feature expansion (new debugger capabilities, AI feature expansion, plugin system work) | Current initiative is migration-only and must avoid scope creep |
| UI redesign or general frontend polish | Not required to achieve UTF-8/x64 library migration objective |
| Re-architecture of Electron main/preload/renderer boundaries | Existing architecture is already validated and not a blocker for migration goal |
| Full rewrite of already-migrated libraries without migration need | Adds risk/time without contributing to “unmigrated libraries completed” outcome |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INVT-01 | Phase 1 | Complete |
| INVT-02 | Phase 1 | Complete |
| INVT-03 | Phase 1 | Complete |
| ENCD-01 | Phase 2 | Pending |
| ENCD-02 | Phase 2 | Pending |
| ENCD-03 | Phase 2 | Pending |
| ENCD-04 | Phase 2 | Pending |
| X64A-01 | Phase 3 | Pending |
| X64A-02 | Phase 3 | Pending |
| X64A-03 | Phase 3 | Pending |
| X64A-04 | Phase 3 | Pending |
| INTG-01 | Phase 4 | Pending |
| INTG-02 | Phase 4 | Pending |
| INTG-03 | Phase 4 | Pending |
| RELS-01 | Phase 5 | Pending |
| RELS-02 | Phase 5 | Pending |
| RELS-03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-21*  
*Last updated: 2026-03-21 after initial definition*
