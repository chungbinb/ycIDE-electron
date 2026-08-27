# 表达式 AST 重构进度

## 已完成（Phase 1）

- [x] 创建 `src/main/transpiler/` 目录
- [x] 定义 AST 节点类型 (`ast.ts`)
  - 14 种节点类型覆盖所有表达式场景
  - 构造器函数全部类型安全
  - 模式匹配工具函数
- [x] 实现解析器骨架 (`parser.ts`)
  - `parseExpr()` 入口函数
  - 辅助函数：matchEnclosingParens, findTopLevelLogical, findTopLevelComparison, findTopLevelAdditive, findTopLevelMultiplicative
  - parseCommandCall, splitArguments
- [x] compiler.ts 改造
  - 导入 AST 模块
  - 导出 ResolvedCommand, DirectCallableNames, VariableTypeResolver
  - 预留 AST 接入点

## 测试结果

```
✓ typecheck: 通过（除 compileWorkerClient.ts 已有错误）
✓ test:unit: 227 passed
✓ test:contract:editor:all: 32 passed
✓ test:migration:encoding: 通过
✓ test:migration:x64: 通过
✓ build: 成功
```

## Phase 2 计划（进行中）

- [ ] 实现 `exprToC()` 方法（AST → C 字符串）
- [ ] 完善 parseExpr() 的 AST 构建路径
- [ ] 验证字节等价性（AST 路径 = 原始字符串路径）
- [ ] 添加回归测试覆盖已知语义点

## Phase 3 计划

- [ ] 语句层 AST（if/判断/循环/子程序头）
- [ ] 变量声明 AST
- [ ] 替换 translateExpressionToC 为 AST 路径
- [ ] 全量回归测试

## 关键设计决策

1. **渐进迁移**：不一次性替换，保留原始逻辑作为 fallback
2. **类型安全**：AST 节点类型系统确保不会遗漏分支
3. **字节等价**：所有路径必须生成完全相同的 C++ 输出
