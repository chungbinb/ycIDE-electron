/**
 * 关闭测试启动的 IDE，不弹「是否保存」对话框。
 *
 * 测试里改过文档后直接 app.close()，主进程会弹原生的「保存 / 不保存 / 取消」对话框，
 * 无人值守时测试一直卡在关闭这一步（有人在电脑前时还可能被误点「保存」，污染下一轮结果）。
 * 关闭前把 dialog.showMessageBox 换成固定返回「不保存」（按钮下标 1），其余关闭流程照常走。
 */
async function closeAppDiscardingChanges(app) {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  }).catch(() => {})
  await app.close()
}

module.exports = { closeAppDiscardingChanges }
