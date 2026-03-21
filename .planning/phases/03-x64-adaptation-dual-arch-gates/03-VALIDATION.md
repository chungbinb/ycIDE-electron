---
phase: 3
slug: x64-adaptation-dual-arch-gates
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-21
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in test runner (`node:test`) |
| **Config file** | none — direct `node --test` invocation |
| **Quick run command** | `node --test --test-name-pattern "X64A-01|X64A-02" tests/migration/x64-adaptation.spec.mjs` |
| **Full suite command** | `npm run test:migration && node --test tests/migration/x64-adaptation.spec.mjs` |
| **Estimated runtime** | ~90 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test --test-name-pattern "X64A-01|X64A-02" tests/migration/x64-adaptation.spec.mjs`
- **After every plan wave:** Run `node --test tests/migration/x64-adaptation.spec.mjs`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | X64A-01 | integration-contract | `node --test --test-name-pattern "X64A-01" tests/migration/x64-adaptation.spec.mjs` | ✅ | ✅ green |
| 3-01-02 | 01 | 1 | X64A-02 | unit+contract | `node --test --test-name-pattern "X64A-02" tests/migration/x64-adaptation.spec.mjs` | ✅ | ✅ green |
| 3-01-03 | 01 | 2 | X64A-03 | integration-contract | `node --test --test-name-pattern "X64A-03" tests/migration/x64-adaptation.spec.mjs` | ✅ | ✅ green |
| 3-01-04 | 01 | 2 | X64A-04 | integration-contract | `node --test --test-name-pattern "X64A-04" tests/migration/x64-adaptation.spec.mjs` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/migration/x64-adaptation.spec.mjs` — X64A-01..04 contract assertions
- [x] `tests/migration/fixtures/x64-adaptation/README.md` — ABI fixture matrix and expected outcomes
- [x] `scripts/migration/x64-adaptation.mjs` — deterministic dual-arch adaptation and gate engine
- [x] `package.json` scripts: `x64:adapt`, `x64:check`, `test:migration:x64`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Representative library ABI safety review for adapted outputs | X64A-02 | Automated checks can validate matrix completeness but cannot fully replace human review of complex callback/struct semantics in real libraries | For blocked and passed libraries, sample report entries and verify ABI notes match actual code signatures/layout expectations |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-03-21
