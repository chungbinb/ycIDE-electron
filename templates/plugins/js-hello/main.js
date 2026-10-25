// 插件入口：IDE 第一次需要这个插件时调用 activate(context, ycide)。
// context.subscriptions 里的东西会在插件停用时自动释放；ycide 是宿主提供的 API（见 docs/插件开发指南.md）。

exports.activate = (context, ycide) => {
  context.subscriptions.push(
    ycide.commands.registerCommand('hello:countLines', async (args) => {
      // 菜单调用时没有参数；作为 AI 工具或被其他插件调用时可以传 { path }
      const path = args && args.path
      if (!path) {
        ycide.window.showMessage('你好！这个命令需要传入 { path } 参数，例如由其他插件或 AI 工具调用。')
        return 0
      }
      const text = await ycide.documents.getText(path) // 需要权限 workspace:read
      const lines = text.split(/\r?\n/).length
      ycide.window.showMessage(`${path} 共有 ${lines} 行`)
      return lines
    }),
  )
}

exports.deactivate = () => {}
