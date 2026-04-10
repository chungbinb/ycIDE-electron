# Requirements: ycIDE v1.2 主题系统

**Defined:** 2026-04-09
**Core Value:** 用户可以在 ycIDE 中稳定使用并自定义完整主题体系，实时预览并安全保存复用。

## v1 Requirements

### Theme Baseline

- [x] **THME-01**: 用户可以在内置深色与浅色主题之间切换
- [x] **THME-02**: 主题切换后重启应用仍保持上次选中的主题
- [x] **THME-03**: 浅色主题在主要界面区域具备可读性（文本/背景对比可用）

### Theme Tokens

- [x] **TOKN-01**: 用户可以自定义普通文本颜色与背景颜色
- [x] **TOKN-02**: 用户可以自定义关键字颜色
- [x] **TOKN-03**: 用户可以自定义代码编辑器表格颜色与表头颜色
- [x] **TOKN-04**: 用户可以按主题配置流程线模式（单色或多色）
- [x] **TOKN-05**: 用户可以自定义流程线颜色（与流程线模式一致生效）
- [x] **TOKN-06**: 主题 token 对所有可见区域生效，不出现局部未跟随主题的硬编码颜色

### Theme Workflow

- [x] **FLOW-01**: 用户在设置页修改颜色后可实时预览效果
- [x] **FLOW-02**: 用户可以撤销当前预览改动并恢复到进入设置前的主题状态
- [x] **FLOW-03**: 用户可以将当前配置保存为自定义主题

### Theme Management

- [ ] **MGMT-01**: 用户可以在本机管理自定义主题（创建/编辑/重命名/删除）
- [x] **MGMT-02**: 用户可以导出自定义主题到文件
- [x] **MGMT-03**: 用户可以导入主题文件并应用
- [x] **MGMT-04**: 导入主题在字段缺失或不合法时会给出明确错误，不会静默破坏现有主题

### Compatibility & Quality

- [ ] **QUAL-01**: 主题切换和预览不会破坏现有编辑器与表格交互功能
- [ ] **QUAL-02**: 关键主题路径具备自动化回归覆盖（至少覆盖浅/深、未导入失败、预览撤销、导入导出）

## Future Requirements

### Theme Ecosystem

- **ECO-01**: 用户可以查看主题差异对比（当前主题 vs 草稿主题）
- **ECO-02**: 用户可以从官方主题包一键安装主题
- **ECO-03**: 用户可以跨设备同步主题

## Out of Scope

| Feature | Reason |
|---------|--------|
| 主题云市场与在线审核 | 超出 v1.2 范围，依赖账号/分发/审核体系 |
| 允许任意 CSS/脚本注入主题 | 安全风险高，且会破坏主题可维护性 |
| 全局 UI 架构重构（替换现有样式系统） | 目标是在现有架构增量实现主题系统 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| THME-01 | Phase 13 | Complete |
| THME-02 | Phase 13 | Complete |
| THME-03 | Phase 13 | Complete |
| TOKN-01 | Phase 14 | Complete |
| TOKN-02 | Phase 14 | Complete |
| TOKN-03 | Phase 14 | Complete |
| TOKN-04 | Phase 14 | Complete |
| TOKN-05 | Phase 14 | Complete |
| TOKN-06 | Phase 14 | Complete |
| FLOW-01 | Phase 15 | Complete |
| FLOW-02 | Phase 15 | Complete |
| FLOW-03 | Phase 15 | Complete |
| MGMT-01 | Phase 16 | Pending |
| MGMT-02 | Phase 16 | Complete |
| MGMT-03 | Phase 16 | Complete |
| MGMT-04 | Phase 16 | Complete |
| QUAL-01 | Phase 17 | Pending |
| QUAL-02 | Phase 17 | Pending |

**Coverage:**
- v1 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0 ✅

---
*Requirements defined: 2026-04-09*
*Last updated: 2026-04-10 after v1.2 roadmap creation*
