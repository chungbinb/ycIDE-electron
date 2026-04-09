---
phase: 12-windows-macos-linux-windows
plan: 04
subsystem: testing
tags: [library-store, downloaded-state, contract-test, playwright]
requires:
  - phase: 12-windows-macos-linux-windows
    provides: StoreLibraryCard 聚合与卡片 UI 基线能力
provides:
  - getStoreCards() 基于 manifest 有效性推导 isDownloaded
  - contract 测试覆盖未下载（invalid-only manifest）分支
  - UI 回归覆盖“未下载”徽标与 applySelection 后加载态变更
affects: [phase-12-verify, library-dialog, store-card-status]
tech-stack:
  added: []
  patterns: [tdd-red-green, registry-validity-derived-download-state, ui-status-separation]
key-files:
  created: []
  modified: [src/main/libraryManager.ts, tests/contract/library-store-cards.spec.mjs, tests/ui/helpers/library-store-fixtures.js, tests/ui/library-store-status.spec.js]
key-decisions:
  - "下载态以每库至少一个 valid manifest 为真值来源，避免 UI 固定展示已下载。"
  - "UI 断言将下载态与加载态分离：applySelection 只改变 isLoaded，不覆盖 isDownloaded。"
patterns-established:
  - "Pattern: 商店卡片下载态由主进程 registry 扫描有效性统一推导。"
  - "Pattern: 状态徽标回归测试同时校验初始态与应用选择后的状态独立性。"
requirements-completed: []
duration: 6m
completed: 2026-04-09
---

# Phase 12 Plan 04: Downloaded-state gap closure summary

**isDownloaded 已从硬编码常量改为真实推导，并用 contract/UI 自动化锁定“未下载”场景回归。**

## Performance

- **Duration:** 6m
- **Started:** 2026-04-09T08:59:56Z
- **Completed:** 2026-04-09T09:06:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- 在 `getStoreCards()` 移除 `isDownloaded: true`，改为基于每库 valid manifest 推导下载态。
- 新增合同用例覆盖 invalid-only manifest 返回 `isDownloaded=false`，并验证加载态仍由保存选择决定。
- UI 自动化新增“未下载”徽标断言，验证应用选择后仅加载态切换，下载态保持“未下载”。

## Task Commits

1. **Task 1: 用合同测试驱动 isDownloaded 真实推导落地** - `ef1b945` (test), `669f6ac` (feat)
2. **Task 2: 补齐 UI “未下载”徽标自动化回归** - `85ca967` (test), `49215d7` (feat)

## Files Created/Modified
- `src/main/libraryManager.ts` - `isDownloaded` 改为 registry 有效 manifest 推导。
- `tests/contract/library-store-cards.spec.mjs` - 增加 invalid-only manifest 未下载合同断言。
- `tests/ui/helpers/library-store-fixtures.js` - 增加 `isDownloaded=false` 的 `missing-library` 夹具。
- `tests/ui/library-store-status.spec.js` - 增加“未下载”徽标与 applySelection 后状态独立性断言。

## Decisions Made
- 以 “是否存在有效 manifest” 作为下载态单一事实来源。
- applySelection 回归测试显式守护“下载态不被加载动作覆盖”。

## Deviations from Plan
### Auto-fixed Issues

**1. [Rule 3 - Blocking] gsd-tools docs commit skipped gitignored planning files**
- **Found during:** Final metadata commit
- **Issue:** `gsd-tools commit` returned `skipped_gitignored`, so SUMMARY/STATE/ROADMAP could not be committed.
- **Fix:** Used explicit `git add -f` for `.planning/...` files and completed manual docs commit.
- **Files modified:** `.planning/phases/12-windows-macos-linux-windows/12-04-SUMMARY.md`, `.planning/STATE.md`, `.planning/ROADMAP.md`
- **Verification:** docs commit `bae3a03` created successfully.
- **Committed in:** `bae3a03`

---

**Total deviations:** 1 auto-fixed (Rule 3: 1)
**Impact on plan:** Only affected planning-doc staging; no product-scope changes.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 12 验证缺口（下载态硬编码）已闭合，具备可持续回归护栏。

## Known Stubs
None detected in files modified by this plan.

## Self-Check: PASSED
- FOUND: `.planning/phases/12-windows-macos-linux-windows/12-04-SUMMARY.md`
- FOUND commit: `ef1b945`
- FOUND commit: `669f6ac`
- FOUND commit: `85ca967`
- FOUND commit: `49215d7`
