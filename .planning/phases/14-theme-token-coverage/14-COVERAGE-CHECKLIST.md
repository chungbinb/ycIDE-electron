# Phase 14 Token Coverage Checklist

Generated for Plan 14-05.

| Requirement | Surface / Behavior | Automated Evidence | Status |
| --- | --- | --- | --- |
| TOKN-01 | 基础文本/背景令牌编辑即时生效 | `tests/ui/theme-token-coverage.spec.js` → `[smoke] grouped token edits update base/table/header surfaces` asserts `--bg-primary`, `--text-primary` | ✅ Pass |
| TOKN-02 | Monaco 语法类别颜色可配置 | `tests/ui/theme-token-coverage.spec.js` → `[monaco] syntax token edits expose monaco token color evidence` + `tests/ui/helpers/monaco-token-assertions.js` | ✅ Pass |
| TOKN-03 | 表格与表头颜色令牌即时生效 | `tests/ui/theme-token-coverage.spec.js` → `[smoke]` asserts `--table-bg`, `--table-header-bg` | ✅ Pass |
| TOKN-04 | 流程线单色/多色模式切换可用 | `tests/ui/theme-token-coverage.spec.js` → `flow-line single and multi mode apply distinct runtime vars` (`--flow-line-mode`) | ✅ Pass |
| TOKN-05 | 流程线颜色与模式配置一致 | 同上测试断言 `--flow-line-main` 与深度步进变量 (`--flow-line-depth-*`) | ✅ Pass |
| TOKN-06 | 可见区域硬编码颜色残留为零（未解决项） | `node scripts/theme/scan-hardcoded-colors.mjs --phase=14 --strict` + `14-HARDCODED-SCAN-RESULT.md` | ✅ Pass (unresolved=0) |

## Reset/即时应用覆盖

- `reset actions apply immediately with required confirmations` 覆盖：
  - 单项重置立即回写默认值
  - 分组重置弹确认并立即应用
  - 全局重置弹确认并立即应用

## Gate Result

Phase 14 validation gate for TOKN-01..TOKN-06: **PASS**.
