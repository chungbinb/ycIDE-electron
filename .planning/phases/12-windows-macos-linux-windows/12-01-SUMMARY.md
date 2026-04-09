---
phase: 12-windows-macos-linux-windows
plan: 01
subsystem: api
tags: [electron, ipc, preload, library, contract, testing]
requires:
  - phase: 12-windows-macos-linux-windows
    provides: 支持库平台展示需求与卡片化研究上下文
provides:
  - 主进程 StoreLibraryCard 聚合接口 getStoreCards
  - library:getStoreCards IPC handler 与 preload 桥接
  - 支持平台并集/下载态/加载态合同测试
affects: [renderer, library-dialog, phase-12-plan-02]
tech-stack:
  added: []
  patterns: [shared-contract, main-preload-ipc-bridge, node-test-contract]
key-files:
  created: [src/shared/library-store.ts, tests/contract/library-store-cards.spec.mjs]
  modified: [src/main/libraryManager.ts, src/main/index.ts, src/preload/index.ts]
key-decisions:
  - "将 StoreLibraryCard 契约放在 src/shared 以保持 main/preload/renderer 一致类型边界。"
  - "getStoreCards 仅返回统一卡片模型，renderer 不拼装平台与状态字段。"
patterns-established:
  - "Pattern: 库商店数据由 libraryManager 聚合后经 IPC 单点暴露。"
requirements-completed: []
duration: 56m 24s
completed: 2026-04-09
---

# Phase 12 Plan 01: Store card contract summary

**StoreLibraryCard 契约与 library:getStoreCards IPC 通路已落地，支持返回平台并集与下载/加载状态。**

## Performance

- **Duration:** 56m 24s
- **Started:** 2026-04-09T06:43:53Z
- **Completed:** 2026-04-09T07:40:17Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- 新增 `StoreLibraryCard` 与 `Platform` 共享类型契约。
- 在 `libraryManager` 实现 `getStoreCards()`，聚合 `supportedPlatforms/isDownloaded/isLoaded/isCore`。
- 新增主进程 IPC 与 preload `window.api.library.getStoreCards()`，并完成回归测试。

## Task Commits

1. **Task 1: 先写商店卡片聚合回归测试（Wave 0）** - `396816c` (test)
2. **Task 2: 实现 StoreLibraryCard 契约与主进程/预加载桥接** - `686acd4` (feat)

## Files Created/Modified
- `tests/contract/library-store-cards.spec.mjs` - 新增 3 个合同场景，覆盖平台并集与下载/加载状态。
- `src/shared/library-store.ts` - 新增平台与商店卡片共享类型。
- `src/main/libraryManager.ts` - 新增 `getStoreCards()` 聚合逻辑。
- `src/main/index.ts` - 新增 `library:getStoreCards` IPC handler。
- `src/preload/index.ts` - 暴露 `window.api.library.getStoreCards()`。

## Decisions Made
- 使用 shared 类型文件承载 `StoreLibraryCard`，避免跨层重复定义。
- 由 main 进程统一聚合平台与状态，preload/renderer 仅消费结果。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] 合同测试运行期模块解析失败**
- **Found during:** Task 2
- **Issue:** 测试内存转译 `libraryManager.ts` 时无法解析 `../shared/library-store`。
- **Fix:** 在测试 loader 中补充 `../shared/library-store` mock 导出。
- **Files modified:** `tests/contract/library-store-cards.spec.mjs`
- **Verification:** `node --test tests/contract/library-store-cards.spec.mjs && npm run build`
- **Committed in:** `686acd4`

---

**Total deviations:** 1 auto-fixed (Rule 3: 1)
**Impact on plan:** 仅修复测试运行阻塞，不影响计划范围。

## Issues Encountered
- `node --test` 直接加载 TypeScript 源时存在依赖解析差异，已通过测试侧 mock 适配。

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- renderer 可直接调用 `window.api.library.getStoreCards()` 开始卡片 UI 接入。
- 平台标签与下载/加载状态规则已有自动化护栏。

## Self-Check: PASSED
- Found summary file: `.planning/phases/12-windows-macos-linux-windows/12-01-SUMMARY.md`
- Found commits: `396816c`, `686acd4`
