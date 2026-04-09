---
phase: 12
slug: windows-macos-linux-windows
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-09
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright + Node test |
| **Config file** | `playwright.config.js` |
| **Quick run command** | `npm run test:ui:smoke` |
| **Full suite command** | `npm run test:ui` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:ui:smoke`
- **After every plan wave:** Run `npm run test:ui`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | TBD | integration | `npm run test:ui:smoke` | ✅ `tests/ui/electron-start.spec.js` | ✅ green |
| 12-02-01 | 02 | 1 | TBD | integration | `npm run test:ui:smoke` | ✅ `tests/ui/electron-start.spec.js` | ✅ green |
| 12-03-01 | 03 | 2 | TBD | e2e | `npm run test:ui:smoke` | ✅ `tests/ui/library-store-cards.spec.js` + `tests/ui/library-store-status.spec.js` | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/ui/library-store-cards.spec.js` — 卡片展示与平台标签断言
- [x] `tests/ui/library-store-status.spec.js` — 下载/加载状态联动断言
- [x] `tests/ui/helpers/library-store-fixtures.js` — windows-only 与 all-platform 样例库元数据夹具

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 卡片视觉层级、布局与可读性 | TBD | 自动化难以覆盖主观视觉质量 | 启动应用后在库管理弹窗人工检查卡片网格、平台标签和状态徽标对齐 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
