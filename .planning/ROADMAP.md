# Roadmap: ycIDE v1.1 编译器规范化开发

## Overview

This roadmap defines milestone v1.1 delivery for compiler contract standardization.  
It starts from **Phase 6** (continuing prior roadmap numbering) and maps all v1.1 requirements to coherent, verifiable capability phases so third-party authors can self-serve support-library compilation without compiler code edits.

## Phases

**Phase Numbering:**
- Integer phases (6, 7, 8...): Planned milestone work
- Decimal phases (6.1, 6.2...): Urgent insertions (via `/gsd-insert-phase`)

- [ ] **Phase 6: Contract Foundation & Validation** - Establish canonical contract schema, version policy, and pre-compile validation feedback.
- [ ] **Phase 7: Strict Compiler Enforcement & Compatibility Gates** - Enforce contract validity/compatibility at compile time while preserving controlled legacy behavior.
- [ ] **Phase 8: Library Manager Contract Visibility** - Surface contract health/version state and diagnostic classification in library management flows.
- [ ] **Phase 9: Third-Party Self-Serve Build Workflow** - Deliver deterministic scaffold→validate→package workflow and machine-readable outputs.
- [ ] **Phase 10: Promotion Readiness Gate & Onboarding Baseline** - Add clean-machine promotion checks and minimum reusable onboarding guidance.

## Phase Details

### Phase 6: Contract Foundation & Validation
**Goal**: Maintainers and third-party authors can rely on one canonical, versioned compiler contract definition and validate contracts before compile.
**Depends on**: Phase 5
**Requirements**: CONT-01, CONT-02
**Success Criteria** (what must be TRUE):
  1. Maintainer can publish a canonical contract schema with explicit version fields and evolution rules that third-party packages follow.
  2. Third-party author can run validation on a contract file and receive structured, actionable error/warning results before compile.
  3. Maintainer can reject malformed or nonconformant contract files before they enter compile/runtime loading paths.
**Plans**: 3 plans

Plans:
- [x] 06-01-PLAN.md — 建立二进制 canonical 契约与加载时硬校验门禁（含结构化诊断与批量汇总）
- [x] 06-02-PLAN.md — 增加编译前 strict gate，确保契约 ERROR 直接失败且不依赖外置协议 sidecar 放行
- [x] 06-03-PLAN.md — gap closure：修复 loadInternal() 绕过契约 ERROR 硬阻断，统一 all-source load gate 语义

### Phase 7: Strict Compiler Enforcement & Compatibility Gates
**Goal**: Compiler behavior deterministically enforces contract rules for all loaded libraries under unified strict mode.
**Depends on**: Phase 6
**Requirements**: CONT-03, CONT-04, COMP-01, COMP-02, RELY-01
**Success Criteria** (what must be TRUE):
  1. Third-party library compile attempts fail immediately when contract is invalid in strict mode.
  2. Built-in/migrated libraries are evaluated under the same strict gate and return deterministic repair diagnostics instead of fallback pass behavior.
  3. Compile output clearly fails when unsupported/placeholder command generation paths are encountered in strict mode (no silent success).
  4. Compiler blocks incompatible contracts when required compiler version/features are not satisfied and reports the mismatch reason.
**Plans**: 3 plans

Plans:
- [x] 07-01-PLAN.md — 建立 COMPAT-xxx 兼容性门禁基础（全量不满足项聚合、稳定排序、修复清单分组）
- [ ] 07-02-PLAN.md — 在编译入口落实 strict 一次性 preflight 与 TODO 路径首错即停硬失败
- [ ] 07-03-PLAN.md — 对齐编译器与库管理器错误结构并完成跨表面一致性验收

### Phase 8: Library Manager Contract Visibility
**Goal**: Users can see per-library contract health/version and understand failure type without reading compiler internals.
**Depends on**: Phase 7
**Requirements**: COMP-03, COMP-04
**Success Criteria** (what must be TRUE):
  1. User can view each library’s contract version and current contract health status in support-library management flows.
  2. Load/compile diagnostics explicitly distinguish contract validation failure, compatibility mismatch, and runtime metadata issues.
  3. User can identify which specific library requires remediation from surfaced diagnostics without manual log forensics.
**Plans**: TBD

### Phase 9: Third-Party Self-Serve Build Workflow
**Goal**: Third-party developers can independently scaffold, validate, and package ycIDE-compatible support-library artifacts in one deterministic workflow.
**Depends on**: Phase 7
**Requirements**: WFLO-01, WFLO-02, WFLO-03, WFLO-04
**Success Criteria** (what must be TRUE):
  1. Third-party developer can initialize a project scaffold containing required contract/protocol artifacts.
  2. Third-party developer can execute a single documented command flow to validate and package outputs for ycIDE consumption.
  3. Produced artifacts follow deterministic layout compatible with `lib` / `static_lib` conventions on repeated runs.
  4. Workflow generates machine-readable reports covering contract validity, target architecture status, and packaging completeness.
**Plans**: TBD

### Phase 10: Promotion Readiness Gate & Onboarding Baseline
**Goal**: Maintainers can confidently promote third-party artifacts using a reproducible clean-environment gate and a minimum compliant onboarding process.
**Depends on**: Phase 9
**Requirements**: RELY-02, RELY-03
**Success Criteria** (what must be TRUE):
  1. Maintainer can run a clean-machine style verification gate that passes/fails third-party artifact readiness before promotion.
  2. Third-party author can follow onboarding documentation to produce a minimally compliant contract/build/release package without compiler source changes.
  3. Promotion decisions are based on explicit verification output, not manual assumptions about local environment state.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 6 → 7 → 8 → 9 → 10

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 6. Contract Foundation & Validation | 0/TBD | Not started | - |
| 7. Strict Compiler Enforcement & Compatibility Gates | 0/3 | Not started | - |
| 8. Library Manager Contract Visibility | 0/TBD | Not started | - |
| 9. Third-Party Self-Serve Build Workflow | 0/TBD | Not started | - |
| 10. Promotion Readiness Gate & Onboarding Baseline | 0/TBD | Not started | - |

### Phase 11: 修改支持库为商店排列模式展示不同平台的支持库，并且也显示是否已下载和已加载的状态，支持库是以卡片的方式展示，像商城那样的商品一样的，然后还要显示该支持库所支持的平台是windows还是macos或者linux等，因为有些支持库是只支持windows平台的，有些支持库是全平台都支持的，现在准备这样来区分，你的回答也使用中文

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 10
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 11 to break down)

### Phase 12: 修改支持库为商店排列模式展示不同平台的支持库，并且也显示是否已下载和已加载的状态，支持库是以卡片的方式展示，像商城那样的商品一样的，然后还要显示该支持库所支持的平台是windows还是macos或者linux等，因为有些支持库是只支持windows平台的，有些支持库是全平台都支持的，现在准备这样来区分，你的回答也使用中文

**Goal:** 支持库管理以商店卡片方式展示，用户可直接区分每个支持库的平台支持范围（Windows/macOS/Linux）及其已下载、已加载状态。
**Requirements**: TBD
**Depends on:** Phase 11
**Plans:** 2/3 plans executed

Plans:
- [x] 12-01-PLAN.md — 建立 StoreLibraryCard 数据契约与 main/preload IPC 通路
- [x] 12-02-PLAN.md — 将 LibraryDialog 改造为商店卡片布局并展示平台/下载/加载状态
- [ ] 12-03-PLAN.md — 新增 UI 自动化验证并完成 Phase 12 Nyquist 验证策略闭环
