# ycIDE-electron

> 基于 Electron + React + TypeScript 重构的易承语言集成开发环境

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) — 自由使用、修改、分发（含商用），衍生作品须注明基于 ycIDE

## 主要功能

- **表格式代码编辑器**：.eyc 源码按易语言风格以表格 + 代码行显示，带流程线、补全、语法检查；支持按行拖选、Shift / Ctrl 多选、代码预览缩略图。
- **声明编辑器**：全局变量、常量表、自定义数据类型、资源表、DLL 命令都有对应的表格编辑器，编辑时项目管理器即时刷新。
- **窗口设计器**：可视化设计窗口与组件，双击组件跳转到事件子程序。
- **编译与运行**：内置 Zig 编译链，编译、运行、调试（断点、逐过程 / 逐语句、运行到光标处、暂停时查看变量）。
- **AI 代码助手**：对话、编辑、Plan、Agent 四种模式；内置 DeepSeek、GLM，也可接入任意 OpenAI 兼容模型。
- **插件系统**：菜单、快捷键、主题、AI 模型、AI 工具、编译器、支持库、编辑器都由插件提供，可单独启用或停用；第三方插件可以用 JavaScript、易语言或任意语言编写（见下文「插件开发」）。
- **项目管理器**：按窗口 / 程序集 / 全局变量 / 常量 / 数据类型 / DLL 命令 / 资源分类，顶部搜索框可直接按名称过滤。

## 技术栈

- **前端**：React 19 + TypeScript + Vite
- **桌面框架**：Electron 43
- **编辑器**：Monaco Editor（文本文件）+ 自研表格式代码编辑器（.eyc 源码）
- **编译器**：内置 Zig（Windows GNU 目标），可经编译器插件替换
- **插件系统**：插件清单 + 独立插件宿主进程（JSON-RPC），第三方插件运行在受限进程中
- **构建工具**：electron-vite + electron-builder

📋 [版本更新说明](版本更新说明.md) · [版本开发日志](版本开发日志.md)

## 编译器环境准备（首次拉取后必读）

编译链路使用 `Zig (windows-gnu)`：不需要 MinGW，也不依赖本地 MSVC/Windows SDK。仓库**不包含** `compiler/zig/` 二进制文件（体积超过 GitHub 单文件 100MB 限制），首次使用请自行下载放置：

1. 从 [Zig 官方下载页](https://ziglang.org/download/) 按宿主平台下载：
   - Windows x64：`zig-windows-x86_64-*.zip`
   - macOS（Apple Silicon）：`zig-macos-aarch64-*.tar.xz`
   - Linux：`zig-linux-*.tar.xz`
2. 在项目根目录创建 `compiler/zig/`，解压后确保可执行文件位于 `compiler/zig/zig.exe`（Windows）或 `compiler/zig/zig`（macOS / Linux）。
3. 运行 `compiler/zig/zig version` 验证安装。
4. 也可以不解压到项目内：在 设置 →「编译」→ 编译器路径 中指定任意位置的 `zig.exe`（或其所在目录）。

---

## 开发进度

| 功能 | 状态 |
|------|------|
| 自定义数据类型、全局变量、常量表、资源、DLL 命令编辑器 | ✅ 已完成 |
| AI 代码助手（对话 / 编辑 / Plan / Agent 模式，多模型） | ✅ 已完成，持续优化 |
| 插件系统（第三方插件、易语言写插件、插件商店） | ✅ 已完成（v0.0.5-beta.29） |
| 调试器（断点、单步、变量查看已可用；调用堆栈等完善中） | 🚧 进行中 |
| 会员系统（AI 助手的使用权限与额度管理） | ⏳ 计划中 |

## 插件开发

IDE 的大部分功能本身就是插件（见仓库根目录 `plugins/`）。第三方插件可以：

- 用 **JavaScript** 编写，运行在受限的插件进程中（只能访问自己的目录与声明过的网站）；
- 用 **易语言** 编写：加载「插件开发支持库」（`插件_等待请求`、`插件_回复`、`插件_执行命令` 等），编译出的程序就是一个插件；
- 用 **任意语言** 编写的可执行文件，经 stdio + JSON-RPC 与 IDE 通信。

插件申请的权限（读写项目文件、修改文档、联网、调用 AI、使用终端等）需要用户确认后才启用。

- 📘 开发文档：[docs/插件开发指南.md](docs/插件开发指南.md)
- 🏗️ 架构设计：[docs/插件架构设计稿.md](docs/插件架构设计稿.md)
- 🧩 模板：[templates/plugins/js-hello](templates/plugins/js-hello)（JavaScript）、[templates/plugins/eyc-hello](templates/plugins/eyc-hello)（易语言）
- 在 IDE 里：工具 → 插件管理（启用 / 停用 / 授权 / 卸载 / 商店）

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 检查（类型检查 + lint + 单元测试 + 编辑器契约测试）
npm test

# UI 测试（先构建，再用 Playwright 启动真实 IDE）
npm run test:ui

# 打包
npm run package:win

# 打包测试版压缩包（不含 compiler/ 目录，装有 7-Zip 时输出 .7z）
npm run package:win:zip

# Windows 签名打包（可选）
npm run package:win:signed

# 生成误报申诉包（示例）
npm run security:av:report -- --sample "D:\\Documents\\ycIDE Projects\\新项目6\\output\\windows\\x64\\新项目6.exe" --compiler "zig c++" --target "windows-x64" --mode "运行(宿主平台)" --detection "VHO:Trojan-PSW.Win32.ReaderDB.gen"
```

## 杀毒软件误报排查与发布建议

### 本地排查（用户）
- 如果运行日志中出现 `spawn EPERM` / `EACCES` / `UNKNOWN`（或 errno 为 `-4048`），通常是安全软件拦截导致。
- 先检查安全软件隔离区，确认是否已删除或阻止你刚编译的 exe。
- 生成误报申诉包：

```bash
npm run security:av:report -- --sample "<你的exe路径>" --compiler "zig c++" --target "windows-x64" --mode "运行(宿主平台)"
```

- 生成目录默认位于 `debug_logs/av-report-时间戳/`，包含 `report.json` 与 `attachments/`，可直接提交给杀软厂商误报通道。

### 发布建议（项目维护者）
- 不把“让所有用户手工加白名单”作为默认方案。
- 推荐在发布链路使用签名打包（证书通过环境变量注入）。
- 可用环境变量：
	- `YCIDE_WIN_CERT_FILE`：证书文件路径（PFX）
	- `YCIDE_WIN_CERT_PASSWORD`：证书密码
	- `YCIDE_WIN_TIMESTAMP_URL`：RFC3161 时间戳服务地址（可选）
	- `YCIDE_WIN_PUBLISHER_NAME`：发布者名称（可选）
	- `YCIDE_REQUIRE_WIN_SIGN=1`：强制要求签名（未配置证书时打包失败）

## 分支与发版

- **`dev`**：日常开发分支。每次推送到 dev 会自动构建测试包并发布到 Release（标签 `dev-v<版本号>`），所以每次发测试包都要先升版本号。
- **`main`**：稳定版分支。从 dev 向 main 发起的 PR **合并后**自动构建稳定版。
- 推送到 dev / main 以及每个 PR 都会自动跑类型检查、lint、单元测试与契约测试。
- 发版时用 `npm version <版本> --no-git-tag-version` 改版本号，并在 [版本更新说明](版本更新说明.md) 顶部写上该版本的说明（打包时按版本号读取）。

## 贡献
欢迎任何形式的贡献！无论是修复 bug、添加新功能、改进文档还是提供反馈，都非常感谢。请遵循以下步骤：
1. Fork 本仓库
2. 从 `dev` 创建一个新的分支（`git checkout -b feature/your-feature-name dev`）
3. 提交你的更改（`git commit -m 'Add some feature'`），提交前建议先跑一遍 `npm test`
4. 推送到分支（`git push origin feature/your-feature-name`）
5. 向 **`dev`** 分支创建一个 Pull Request
## 📜 许可证

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

本项目采用 **MIT 开源许可证**，详情请参阅 [LICENSE](LICENSE) 文件。

> [!IMPORTANT]
> 你可以自由地**使用、复制、修改和分发**本项目（包括用于商业用途），但在分发副本或发布衍生作品时，**须保留原始版权声明和许可声明，并注明该作品基于 ycIDE**。
## 联系方式
如果你有任何问题、建议或想要参与开发，请随时通过以下方式联系我：
- 邮箱：[chungbin@522.plus](mailto:chungbin@522.plus)
- GitHub：[https://github.com/chungbinb](https://github.com/chungbinb)
- QQ 群：767523155

感谢你对 ycIDE 的关注和支持！希望这个项目能为中文母语和不会英文的开发者们提供一个强大、易用的集成开发环境。

## 贡献人员名单

| QQ昵称 | QQ号 | 精易论坛网名 | 贡献类型 |
|--------|------|-------------|---------|
| 我是522呀 | 641548913 | chungbin | 项目创始人、主要开发者 |
| Mortal. | 273502613 |  | 项目贡献者、主要开发者 |
| 瑾年c | 100483298 | — | 捐赠 |
| ☆孤星独月★ | 340300892 | — | 捐赠 |
| 接软件开发 | 86523553 | — | 捐赠和项目测试 |
| 出现又离开 | 1069988209 | — | 捐赠 |
| 简简单单 | 738822632 | — | 捐赠 |
| ssxiaoqiao | 449834775 | — | 捐赠和测试 |
| TermINatOr | 283100512 | — | 项目主要测试员 |
| Tel: 小林子 喵~ | 452639766 | — | 项目测试员 |
| *其它群里测试和反馈的朋友们* | — | — | 测试、反馈 |
