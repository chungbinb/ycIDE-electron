// 示例插件：运行在插件宿主进程里（CommonJS）。
// activate(context, ycide) 在插件首次被需要时调用；注册的命令放进 context.subscriptions，停用时自动注销。

let greetCount = 0

exports.activate = (context, ycide) => {
  context.subscriptions.push(
    ycide.commands.registerCommand('hello:greet', (name) => {
      greetCount += 1
      const text = `你好，${name || '易语言开发者'}！（第 ${greetCount} 次，来自示例插件）`
      ycide.window.showMessage(text, 'success')
      return text
    }),
    ycide.commands.registerCommand('hello:openAbout', async () => {
      // 插件调用 IDE 内置命令
      await ycide.commands.executeCommand('help:about')
      return 'about-opened'
    }),
  )
}

exports.deactivate = () => {
  greetCount = 0
}
