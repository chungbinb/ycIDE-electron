# Roadmap: ycIDE v1.2 主题系统

## Milestones

- ✅ **v1.1 milestone** — archived on 2026-04-09. Details: `.planning/milestones/v1.1-ROADMAP.md`
- 🚧 **v1.2 milestone** — 主题系统（current）

## Phases

- [x] **Phase 13: Theme Baseline** - Built-in 深/浅主题可切换且可持久化，浅色具备可读性 (completed 2026-04-10)
- [x] **Phase 14: Theme Token Coverage** - 所有可见区域接入主题 token 与流程线模式/颜色配置 (completed 2026-04-10)
- [x] **Phase 15: Theme Editing Workflow** - 设置页支持实时预览、撤销、保存为自定义主题 (completed 2026-04-10)
- [x] **Phase 16: Theme Management & Portability** - 自定义主题本机管理 + 安全导入导出 (completed 2026-04-10)
- [ ] **Phase 17: Compatibility & Regression Guardrails** - 主题路径稳定性与自动化回归覆盖闭环

## Phase Details

### Phase 13: Theme Baseline
**Goal**: 用户可在深色/浅色主题间稳定切换，并在重启后保持选择状态。  
**Depends on**: Nothing (milestone start)  
**Requirements**: THME-01, THME-02, THME-03  
**Success Criteria** (what must be TRUE):
1. 用户可在设置中切换内置深色与浅色主题，界面即时呈现对应风格。
2. 用户关闭并重新打开应用后，仍看到上次选中的主题。
3. 用户在主要界面区域（文本与背景）使用浅色主题时可正常阅读与操作。  
**Plans**: 4 plans

Plans:
- [x] 13-01-PLAN.md — Theme switch/load persistence baseline and fallback config
- [x] 13-02-PLAN.md — Full-surface light theme readability and tokenized color cleanup
- [x] 13-03-PLAN.md — Settings + title/theme menu switch entry wiring and UX feedback
- [x] 13-04-PLAN.md — Baseline verification suite and evidence artifacts

### Phase 14: Theme Token Coverage
**Goal**: 用户可完整配置主题 token，且所有可见区域都跟随主题生效。  
**Depends on**: Phase 13  
**Requirements**: TOKN-01, TOKN-02, TOKN-03, TOKN-04, TOKN-05, TOKN-06  
**Success Criteria** (what must be TRUE):
1. 用户可分别调整普通文本、背景、关键字颜色，并在界面中看到对应变化。
2. 用户可配置编辑器表格颜色与表头颜色，且表格相关区域跟随主题更新。
3. 用户可按主题设置流程线单色/多色模式，并按模式配置流程线颜色后正确显示。
4. 用户在所有可见区域不再看到明显未主题化的硬编码颜色。  
**Plans**: 5 plans

Plans:
- [x] 14-01-PLAN.md — Token contracts, schema migration, and built-in token default seeding
- [x] 14-02-PLAN.md — Grouped token editor UI, immediate reset UX, and Monaco fine-grained mapping
- [x] 14-03-PLAN.md — EycTableEditor table/header tokenization and flow-line single/multi/depth behavior
- [x] 14-04-PLAN.md — VisualDesigner/icon tokenization and hardcoded residue scan automation
- [x] 14-05-PLAN.md — Phase 14 validation suite and required evidence artifacts

### Phase 15: Theme Editing Workflow
**Goal**: 用户在设置页可安全地试改主题并决定保留或回退。  
**Depends on**: Phase 14  
**Requirements**: FLOW-01, FLOW-02, FLOW-03  
**Success Criteria** (what must be TRUE):
1. 用户在设置页调整颜色时，界面实时预览变化且无需重启。
2. 用户可一键撤销当前预览改动，界面恢复到进入设置前的主题状态。
3. 用户可将当前配置保存为新的自定义主题并在主题列表中立即可用。  
**Plans**: 5 plans

Plans:
- [x] 16-01-PLAN.md — Shared import/export contracts and strict validation model
- [x] 16-02-PLAN.md — Main/preload custom-theme lifecycle and export IPC
- [x] 16-03-PLAN.md — Dedicated Theme Manager UI and CRUD/export wiring
- [x] 16-04-PLAN.md — Import pipeline with atomic validation, conflict and switch-now flow
- [x] 16-05-PLAN.md — Phase 16 coverage closure and evidence artifacts

### Phase 16: Theme Management & Portability
**Goal**: 用户可在本机管理自定义主题，并安全完成导入导出复用。  
**Depends on**: Phase 15  
**Requirements**: MGMT-01, MGMT-02, MGMT-03, MGMT-04  
**Success Criteria** (what must be TRUE):
1. 用户可对自定义主题执行创建、编辑、重命名、删除，并看到结果即时生效。
2. 用户可将任意自定义主题导出为文件并在文件系统中获得可复用主题文件。
3. 用户可导入有效主题文件并成功应用到当前界面。
4. 用户导入字段缺失或非法主题文件时，会收到明确错误提示，且现有主题不被破坏。  
**Plans**: 5 plans

Plans:
- [x] 16-01-PLAN.md — Shared import/export contracts and strict validation model
- [x] 16-02-PLAN.md — Main/preload custom-theme lifecycle and export IPC
- [x] 16-03-PLAN.md — Dedicated Theme Manager UI and CRUD/export wiring
- [x] 16-04-PLAN.md — Import pipeline with atomic validation, conflict and switch-now flow
- [x] 16-05-PLAN.md — Phase 16 coverage closure and evidence artifacts

### Phase 17: Compatibility & Regression Guardrails
**Goal**: 主题能力上线后不破坏现有交互，并具备关键路径回归保护。  
**Depends on**: Phase 16  
**Requirements**: QUAL-01, QUAL-02  
**Success Criteria** (what must be TRUE):
1. 用户在主题切换与预览过程中，编辑器与表格核心交互保持可用且行为不退化。
2. 自动化回归可覆盖浅/深切换、预览撤销、导入失败、导入导出等关键主题路径。  
**Plans**: 4 plans

Plans:
- [x] 17-01-PLAN.md — QUAL-02 minimum gate suites (UI + contract) and tag-driven selection
- [x] 17-02-PLAN.md — QUAL-01 compatibility suite across editor/table/transition states
- [x] 17-03-PLAN.md — Fast gate/full run commands and CI workflow enforcement
- [ ] 17-04-PLAN.md — Quarantine policy automation, actionable failure output, and evidence matrix

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 13. Theme Baseline | 4/4 | Complete    | 2026-04-10 |
| 14. Theme Token Coverage | 6/6 | Complete    | 2026-04-10 |
| 15. Theme Editing Workflow | 5/5 | Complete    | 2026-04-10 |
| 16. Theme Management & Portability | 5/5 | Complete   | 2026-04-10 |
| 17. Compatibility & Regression Guardrails | 3/4 | In Progress|  |
