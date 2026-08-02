# 0009 验收标准

- [ ] 回弹编辑器默认只渲染变量（新主题/新标题/DNA 标签），完整提示词收在折叠区
- [ ] 每张卡片的默认组装提示词符合 v4 契约，且能被 `parseReplicationPrompt` round-trip
- [ ] 组装提示词必含去水印句和禁分析文字句
- [ ] 改 topic 联动重算 title；手改 title（不含旧 topic）不被覆盖
- [ ] `/prompts` 卡片预览显示变量视图（topic/title 高亮），不显示原始提示词
- [ ] 全量卡片默认标题无语法病句（全量扫描通过）
- [ ] v2/v3 旧提示词进入编辑器自动升级为 v4
- [ ] `pnpm vitest run` prompt 相关测试全绿；`pnpm build` 生产构建成功
