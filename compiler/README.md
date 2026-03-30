# 编译器目录

当前项目不使用 MinGW，也不依赖本地 MSVC/Windows SDK，使用的是 `Zig (windows-gnu)` 编译链路。

## 正确的目录结构

```text
compiler/
├── zig/
│   ├── zig 或 zig.exe
│   └── ...
```

## 说明

- 编译时会从 `compiler/zig`（其次 `compiler/zig/bin`）查找 `zig`（Windows 下也支持 `zig.exe`）。
- 实际调用命令为 `zig c++`，并通过 `-target *-windows-gnu` 交叉编译 Windows 产物。
- Zig 负责提供该目标所需的工具链与系统头库，不再要求项目内置 `MSVCSDK`。
- 无需安装或配置 MinGW。

## 编译与运行规则

- 运行按钮：固定按宿主平台编译并运行（例如在 macOS 上运行时编译为 macOS 目标）。
- 编译按钮：按 `.epp` 的 `Platform` 字段编译目标二进制（windows/linux/macos）。
- 输出目录按平台拆分：`output/windows/`、`output/linux/`、`output/macos/`。

> 当前编译目标仍是 Windows（`*-windows-gnu`）。
> 在 macOS 上使用 macOS 版 Zig 即可交叉编译 Windows 产物。

## 下载地址

### Zig

- Zig 官方下载页（推荐）：<https://ziglang.org/download/>

推荐按宿主平台下载：

- macOS (Apple Silicon): `zig-macos-aarch64-*.tar.xz`
- Windows x64: `zig-windows-x86_64-*.zip`
- Windows ARM64: `zig-windows-aarch64-*.zip`

下载后解压并确保可执行文件位于 `compiler/zig/zig`（Windows 为 `compiler/zig/zig.exe`）。

### 说明补充

- 若未来需要兼容仅提供 MSVC ABI 的第三方二进制库，再考虑切回 `*-windows-msvc`。
