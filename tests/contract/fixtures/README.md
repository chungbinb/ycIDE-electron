# Contract Fixtures (Phase 06 / Plan 01)

本目录用于契约校验测试夹具说明，不引入任何外置 JSON 契约真源（D6-01/D6-03）。

## 命名规范

- `valid-*.meta.ts`: 从二进制解析结果（`LibInfo`）构造的最小可通过样例
- `invalid-*.meta.ts`: 针对单字段缺失的失败样例
- 文件名应体现决策编号，例如：`invalid-event-channel-D6-14.meta.ts`

## 字段含义（BinaryContract 最小闭包）

- `libraryGuid`: 库 GUID，跨阶段追踪主键（D6-02）
- `libraryName`: 库显示名
- `filePath`: 对应 `.fne` 路径
- `metadataMajorVersion`: 契约主版本
- `events[]`: 事件映射（必须包含 name / route.channel / route.code / route.argExtractRule）
- `properties[]`: 属性声明（必须包含 name / type / readWrite / defaultValueSemantics / cConversionRule）
- `functions[]` 与 `methods[]`: 函数/方法声明（必须包含 callingConvention / paramDirections / returnMapping / bindingSymbol）

## 诊断结构固定字段

ERROR 级别输出字段固定为：
`code`, `libraryGuid`, `libraryName`, `filePath`, `fieldPath`, `message`, `suggestion`

错误级别仅允许：`ERROR` / `INFO`（D6-13）。
