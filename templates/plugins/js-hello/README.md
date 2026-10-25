# 你好插件（JS 模板）

1. 把整个目录复制出来，改 `plugin.json` 里的 `id`、`publisher`、`displayName`（ID 规则：`发布者.名称`，小写英文、数字、短横线）。
2. 开发时用环境变量让 IDE 加载它，改了代码会自动重新加载：

   ```bash
   set YCIDE_EXTRA_PLUGIN_DIRS=<放插件目录的父目录>
   ```

3. 发布：`node scripts/plugin-pack.mjs pack <插件目录> <输出目录> --key <私钥>`，把输出的索引条目交给商店。

完整说明见 `docs/插件开发指南.md`。
