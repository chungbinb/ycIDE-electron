# krnln 命令映射规范（实施版 v1）

## 1. 输入源
- 命令清单：`lib/krnln/krnln.commands.ycmd.json`
- 平台实现：`lib/krnln/impl/windows.cpp`

## 2. 生成目标
- `lib/krnln/generated/command-mapping.windows.json`
- `docs/krnln-command-mapping-report.md`

## 3. 主键规则
- 主键：`commandId`
- 生成 `nativeSymbol`：
  - 去掉命名空间前缀（点号前）
  - 前缀 `krnln_`
  - 非 `[A-Za-z0-9_]` 字符替换为 `_`

## 4. 状态字段
每个命令包含：
- `implemented`: 是否在非自动桩区有真实实现
- `stubbed`: 是否在自动桩区有占位实现
- `declared`: 是否在整个文件声明了该符号
- `abiRisk`: `low|medium|high`
- `abiSpecVersion`: 生成时所采用的 ABI 契约版本（v1 起必须输出）
- `abiContractRef`: ABI 契约文档引用（`high` 风险命令必须非空）

## 5. 风险分级
- `high`: 参数或返回包含 `通用型/数组/对象/窗口/菜单/子程序指针/字节集`
- `medium`: `文本型/日期时间型`
- `low`: 纯数值与逻辑类型

## 6. 冲突检查
- `commandId` 重复
- `nativeSymbol` 多命令冲突
- 命令无符号（`declared=false`）
- 非桩实现与桩实现同时存在（需人工确认）

## 7. 发布门禁（建议）
- `declared` 覆盖率必须 100%
- `high` 风险命令必须有 ABI 说明链接
- 允许保留桩，但需要生成差异报告并记录版本日志

## 8. v1 执行要求
- 报告头必须包含 `abiSpecVersion` 与契约文档路径。
- 每条 `high` 风险命令必须在映射 JSON 中具备 `abiContractRef`。
