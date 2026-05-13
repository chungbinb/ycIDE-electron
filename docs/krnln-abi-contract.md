# krnln 运行时 ABI 契约（实施版 v1）

## 1. 目标与范围
- 目标：定义核心支持库命令执行的稳定 ABI，支撑 `commandId -> nativeSymbol` 的语义实现替换。
- 范围：优先 Windows 闭环，Linux/macOS 后续按同一契约迁移。
- 兼容：保留历史 `lib2.h` 调用路径，通过适配层转发到统一入口。

## 2. 统一调用入口
- 统一入口函数（现状）：
  - `yc_invoke_support_cmd(const char* libName, int cmdIndex, YC_MDATA_INF* pRetData, int argCount, YC_MDATA_INF* pArgs)`
- 统一约定：
  - `libName`：支持库标识（如 `krnln`）
  - `cmdIndex`：命令索引（由映射表生成）
  - `pRetData`：返回值槽位（调用方分配）
  - `argCount`：实参数量
  - `pArgs`：参数数组（调用方分配）

## 3. 数据结构约定
当前编译器侧可见结构（基线）：

```c
typedef struct YC_MDATA_INF {
    union {
        unsigned char m_byte;
        short m_short;
        int m_int;
        long long m_int64;
        float m_float;
        double m_double;
        int m_bool;
        char* m_pText;
    };
    YC_DATA_TYPE m_dtDataType;
} YC_MDATA_INF;
```

### 3.1 类型到 union 字段映射
- `字节型` -> `m_byte`
- `短整数型` -> `m_short`
- `整数型` -> `m_int`
- `长整数型` -> `m_int64`
- `小数型` -> `m_float`
- `双精度小数型` -> `m_double`
- `逻辑型` -> `m_bool`（0/1）
- `文本型` -> `m_pText`（UTF-8，NUL 结尾）

### 3.2 高风险类型（需适配层）
以下类型不应在命令实现中“猜测”布局，必须通过适配层统一解释：
- `通用型`
- 任意 `*数组`
- `字节集`
- `对象/窗口/菜单`
- `子程序指针型`
- `日期时间型`

### 3.3 v1 决策（已落地）
- `日期时间型`：统一使用 OLE Automation Date（`double`）在 ABI 层传递。
- `字节集`：统一采用最小二元结构 `data + length`，由适配层桥接到各平台内部实现。
- `通用型`：沿用 `YC_DATA_TYPE` 作为运行时标签，不另起第二套 Variant ABI。

## 4. 内存所有权规则
- `pArgs` 内存：调用方拥有，被调方只读。
- `pRetData` 外壳：调用方拥有；被调方只写字段。
- 返回 `文本型` 时：
  - 默认策略：被调方分配（`malloc`/兼容分配器），调用方释放。
  - 若返回空文本：可返回静态 `""`，不可写。
- 返回 `字节集` 时：
  - v1 结构：

```c
typedef struct YC_BIN_VIEW {
    const unsigned char* data;
    int length;
} YC_BIN_VIEW;
```

  - `data` 指向的内存由返回方分配与持有；调用方只读。
  - 若需跨边界长期持有，由调用方复制后再使用。

## 5. 错误模型
- 统一原则：
  - `逻辑型/整数型` 失败返回 `0` 或 `-1`（按命令语义）
  - 文本失败返回空文本 `""`
  - 无返回值命令通过全局错误码补充诊断
- 建议补充：`krnln_GetLastError` + 最近错误文本（后续可扩展）

### 5.1 v1 行为补充
- 日期时间解析失败：返回 `0.0`（对应 OLE 基线日期）。
- 文本/字节集空结果：返回空文本或长度为 0 的视图，不返回空悬指针。

## 6. 命令映射规则
- 唯一主键：`commandId`（例如 `krnln.GetDiskTotalSpace`）
- 目标符号：`krnln_` + `commandId` 后缀（非法字符转 `_`）
- 显示名 `displayName` 仅用于 UI，不参与调度

## 7. 实现分层
- Layer 1：命令元数据层（`krnln.commands.ycmd.json`）
- Layer 2：映射层（自动生成 `command-mapping.windows.json`）
- Layer 3：语义实现层（`lib/krnln/impl/windows.cpp`）
- Layer 4：兼容适配层（历史 `lib2.h` 入口）

## 8. 不变量（必须满足）
- 每个 `commandId` 都能解析到唯一 `nativeSymbol`
- 每个 `nativeSymbol` 在 Windows 侧必须“已实现或显式桩”
- 参数数量/类型与元数据一致，不允许隐式交换含义
- 不允许 `displayName` 参与分发逻辑

## 9. 待确认项
- `YC_BIN_VIEW` 的跨模块内存释放接口是否需要标准化（v1 先不强制）。
- `通用型` 中对象/数组深拷贝语义的统一策略（v1 先保持调用方约定）。
