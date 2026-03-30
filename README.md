# ycIDE-electron

> 基于 Electron + React + TypeScript 重构的易承语言集成开发环境

## 技术栈

- **前端**：React 19 + TypeScript + Vite
- **桌面框架**：Electron 34
- **编辑器**：Monaco Editor（文本文件）+ 自研表格式代码编辑器（.eyc 源码）
- **编译器**：内置 Zig（Windows GNU 目标）
- **构建工具**：electron-vite + electron-builder

📋 [版本更新说明](版本更新说明.md)

---

## 待开发和优化的功能

### 一、自定义数据类型编辑器和全局变量编辑器和常量表编辑器和资源编辑器和 DLL 命令编辑器（已完成）
### 二、AI 代码助手（基于 deepseek API 的智能代码补全、错误分析、代码优化建议）
### 三、调试器集成（基于 Windows 调试 API 的本地调试、断点管理、变量监视、调用堆栈）
### 四、编译输出面板输出信息优化（错误信息格式化、点击跳转到代码位置、编译器版本和参数显示）
### 五、会员系统，主要用于AI代码助手的使用权限控制和额度管理
### 六、插件系统，允许第三方开发者为 ycIDE 开发功能插件，扩展编辑器功能、编译器功能、调试器功能等
### 七、Accessibility 支持，确保 ycIDE 对所有用户都友好，包括使用屏幕阅读器的用户
### 八、设置界面，允许用户自定义编辑器主题、字体、快捷键、编译器选项等



## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 打包
npm run package:win
```

## 贡献
欢迎任何形式的贡献！无论是修复 bug、添加新功能、改进文档还是提供反馈，都非常感谢。请遵循以下步骤：
1. Fork 本仓库
2. 创建一个新的分支（`git checkout -b feature/your-feature-name`）
3. 提交你的更改（`git commit -m 'Add some feature'`）
4. 推送到分支（`git push origin feature/your-feature-name`）
5. 创建一个 Pull Request
## 许可证
本项目采用 MIT 许可证，详情请参阅 LICENSE 文件。
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
| 瑾年c | 100483298 | — | 捐赠 |
| ☆孤星独月★ | 340300892 | — | 捐赠 |
| 接软件开发 | 86523553 | — | 捐赠和项目测试 |
| 出现又离开 | 1069988209 | — | 捐赠 |
| 简简单单 | 738822632 | — | 捐赠 |
| *其它群里测试和反馈的朋友们* | — | — | 测试、反馈 |
