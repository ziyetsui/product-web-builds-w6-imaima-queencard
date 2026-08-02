# Model Lab Docs

- [0001_model-lab_impl_notes.md](0001_model-lab_impl_notes.md)：五模型静态映射、默认 size 根因关联、继续生成/MIME/一致性风险。
- [0002_model-integration-acceptance.md](0002_model-integration-acceptance.md)：Computer Use 实测任务、量化硬闸门、逐模型结论、积分对账、缺陷和复测标准。
- [evidence/2026-08-02-computer-use/](evidence/2026-08-02-computer-use/)：截图、统一参考图和脱敏 `task-summary.json`。

结论：默认路径 3/5 通过，五模型整体不通过；Seedream 和 Doubao 在 2K 下都可产图，说明接线存在且可用，但默认 `auto` 参数需要修复。
