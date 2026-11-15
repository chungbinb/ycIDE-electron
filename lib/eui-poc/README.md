# EUI-NEO 独立窗口示例（P0 实验）

这是[跨平台窗口 UI 支持库实施方案](../../docs/跨平台窗口UI支持库实施方案.md)的第一份独立技术样例，不是正式支持库，也没有接入 IDE 新建向导、易语言编译链路或设计器。

本目录没有 `plugin.json`、窗口单元或命令清单，不注册窗口提供者。SDK 下载、构建产物和运行资源均留在本目录的已忽略子目录中，不依赖开发者外部源码路径；不要将其当成可以直接发布的支持库包。

## 1. 看什么

- 真正的 GLFW + OpenGL 桌面窗口，不是浏览器仿制界面。
- 中文标题和标签、受控单行/多行编辑框、SVG 图片加载。
- “应用属性”读取名称并更新状态；单行输入按 Enter 使用同一回调。
- 浅色/深色主题；组件颜色和文字尺寸来自 EUI 主题 token。
- 重置确认弹层：取消保留输入，确认重置保留主题。
- 独立顶层窗口与顶层模态子窗口；子窗口按钮可更新主窗口状态。
- 控件语义标签和上游键盘导航基础。

“用户子程序”目前由 C++ 回调代替，用于验证属性/事件语义；未连接 `.eyc`，不能据此宣称易语言后端已经打通。

## 2. Windows 构建和运行

要求：

- Windows x64。
- Visual Studio 2022 或更新版本的 C++ Build Tools，包含 MSVC、Windows SDK 和 C++ CMake/Ninja 工具。
- 首次构建能够访问 GitHub；后续可使用本地已校验的 SDK 归档。
- 可用的桌面 OpenGL 驱动。

在仓库根目录执行：

```powershell
.\lib\eui-poc\build.ps1 -Run
```

若当前 PowerShell 执行策略不允许脚本，可仅对这次进程执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\lib\eui-poc\build.ps1 -Run
```

脚本定位已有 VS 工具链、下载并验证固定 SDK、配置 Release、编译并运行 CTest。任一步失败均停止，不安装或修改全局工具链。重新构建前请关闭已有示例窗口。

只构建与测试：

```powershell
.\lib\eui-poc\build.ps1
```

成功后可直接双击本机生成的 `.build\ycide_eui_poc.exe`。源码在 [demo.cpp](./demo.cpp)，测试在 [demo_tests.cpp](./demo_tests.cpp)。

也可在仓库根目录运行：

```powershell
.\lib\eui-poc\.build\ycide_eui_poc.exe
```

初始主题可通过进程环境指定；不设置时为浅色，运行后仍可使用窗口内的按钮切换：

```powershell
$env:YCIDE_EUI_POC_THEME = 'dark'
.\lib\eui-poc\.build\ycide_eui_poc.exe
Remove-Item Env:\YCIDE_EUI_POC_THEME
```

此变量只接受 `light` / `dark`，非法值会报告初始化异常。

## 3. 固定依赖与接入选择

| 项目 | 固定值 |
|---|---|
| 上游 | [sudoevolve/EUI-NEO](https://github.com/sudoevolve/EUI-NEO) |
| 发布版本 | [v0.6.3](https://github.com/sudoevolve/EUI-NEO/releases/tag/v0.6.3) |
| commit | `3f951ff1f47e4c9b50cdef59337a62f98c5490a8` |
| Windows SDK | `EUI-NEO-v0.6.3-windows-x64-sdk.zip` |
| SHA-256 | `6c15ed06a3b8cd9a5cbccac302a45a70fb43c68c925d9ecbe711dcc110bfbc8e` |
| 窗口/渲染后端 | GLFW / OpenGL |
| 下载位置 | `.deps` |
| 构建和资源位置 | `.build`、`.build\assets` |

本轮先消费上游预编译 SDK，减少引擎源码构建变量，验证公共 API、窗口和交互语义。该选择只证明当前 MSVC 消费方可构建，不证明仓库内置 Zig/Clang 工具链或易语言公共运行时已兼容该 SDK 的 C++ ABI。

SDK 使用上游 `eui_neo_configure_app()` 提供入口和资源部署，不手工复制或修改上游窗口主循环。当前脚本仅引导 Windows x64；本示例尚未提供 Linux/macOS 引导脚本或承诺其构建通过。

## 4. 已执行验证（2026-11-13）

环境：Windows 10 x64（10.0.19045），MSVC 19.51.36248，Release，GLFW + OpenGL。

| 验证项 | 结果与证据 |
|---|---|
| 固定版本与归档摘要 | 实际下载 SHA-256 与 GitHub 发布资产摘要相同 |
| 编译和链接 | 真实窗口程序与测试程序均通过 |
| 自动交互测试 | CTest `poc_ui_interactions`：1/1 通过 |
| 真实启动 | 浅深色两个独立进程均生成响应正常的原生窗口 |
| 非构建目录启动 | 从仓库根目录启动，中文和 SVG 图片正常显示 |
| 主题呈现 | 实际截图检查；背景采样 R 分量为浅色 242、深色 25 |
| 正常退出 | 两次窗口关闭请求均正常退出，退出码 0 |

本地截图为构建目录内的 `preview-light.png`、`preview-dark.png`，属于本次验证产物，不提交进 Git。

自动测试通过真实组件构建出的回调验证：UTF-8 已提交文本更新受控名称、按钮更新标签、主题切换、重置取消/确认及保留主题、子窗口请求模态标志、子窗口事件请求主窗口刷新、输入框语义名称。

**测试边界：** 这些是组件回调级测试，不是系统鼠标/键盘驱动测试；子窗口请求在测试中被捕获，没有借此创建或验收真实多窗口。真实 GUI 验证仅覆盖上表列出的启动、显示、资源、主题和主窗口退出。

## 5. 建议手工体验顺序

1. 修改“名称”，点“应用属性”，确认底部状态变化；再试单行 Enter。
2. 在多行说明中输入中文，试选区、复制粘贴、撤销/重做。
3. 连续切换浅深色主题，检查文字、输入框、按钮和焦点是否清晰。
4. 修改输入后点重置：先取消，再确认，检查内容和主题是否按预期保留。
5. 打开独立窗口，点击其中的按钮，检查主窗口状态同步；关闭子窗口。
6. 打开模态子窗口，检查父窗口是否被限制操作，关闭子窗口后检查恢复。
7. 仅用 Tab / Shift+Tab、Enter、Space 操作；检查确认弹层的焦点范围和取消路径。
8. 尝试窗口缩放、不同系统 DPI 与中文输入法候选框定位。

## 6. 当前限制和下一步门槛

- 上游 v0.6.3 的[发布说明](https://github.com/sudoevolve/EUI-NEO/releases/tag/v0.6.3)明确说明：控件语义尚未连接系统屏幕阅读器。**本示例不满足正式支持库的无障碍发布门槛。**
- 中文字符串显示和已提交 UTF-8 事件测试，不等于真实 IME 候选框、组合输入和选区交互验证。
- 本次无人值守环境无法启用 Computer Use，未完成真实键鼠体验；可在交互会话使用 `/computer on` 后继续验收。
- 真实独立/模态子窗口、关闭拦截、父子窗口退出、默认/取消动作、多 DPI 与图形兼容性仍待手工测试，不把主窗口启动成功当成完整 P0 完成。
- 未在 Linux/macOS 上实测，未新增这些平台的支持声明，也未接入 IDE 或项目持久化协议。
- 上游 SDK 会部署整份 `assets`，可能包含本示例不使用的字体、图标、音频等。正式集成必须裁剪资源并核对许可证；不要直接把本地构建目录打包发布。
- 上游原创源码声明 Apache-2.0，第三方资源许可独立。当前已下载 Windows SDK 内未发现单独的 LICENSE/NOTICE 文件，依赖许可清单尚未完成；正式分发前必须补齐许可和归属声明。
- 首份样例使用显式定位，尚未验证后续设计器预览与运行时的布局一致性。

下一步应先完成上述输入、窗口生命周期、无障碍和许可验证，再决定是否推进正式提供者协议与 EUI 支持库。
