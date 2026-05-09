# krnln 命令元数据目录

该目录用于存放“核心支持库”的命令元数据与平台实现文件。

核心支持库是 ycIDE 运行必需组件，只随 ycIDE 版本打包发布，不作为在线支持库包提供，也不能在支持库管理中卸载或禁用。启动时会校验核心支持库关键文件完整性；如果文件缺失、清单无效或被修改，IDE 会报错并停止启动。

## 目录约定

- `*.ycmd.json`：命令契约与元数据清单。
- `window-units.json`：窗口组件、属性、事件等 IDE 元数据。
- `<库名>.library.json`：支持库标识信息，供支持库管理窗口显示作者、签名、主页等信息。
- `*.protocol.json`：编译协议，描述控件类名、样式与事件映射。
- `impl/windows.cpp`：Windows 平台实现。
- `impl/linux.cpp`：Linux 平台实现。
- `impl/macos.mm`：macOS 平台实现（Objective-C++）。

## 约定说明

- `commandId` 使用命名空间格式，例如 `krnln.messageBox`。
- `implementations.<platform>.entry` 为相对当前 `.ycmd.json` 文件目录的路径。
- 编译器/主进程会扫描 `lib/<库名>/**/*.ycmd.json` 并校验实现文件是否存在。
- `window-units.json` 由 IDE 读取，用于工具箱、属性面板、事件栏。
- `<库名>.library.json` 由 IDE 读取，用于展示支持库标识。第三方支持库可提供 `guid`、`description`、`author`、`qq`、`email`、`homePage`、`otherInfo` 字段。
- `*.protocol.json` 由编译器读取，用于把组件事件映射到平台消息。
