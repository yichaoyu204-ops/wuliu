# 项目 8 · 产品验证

从 [知识索引](knowledge/INDEX.md) 找当前任务涉及的规则与来源。先读相关产品文件，再选能走通业务的一条输入、处理、输出路径。优先复用已有报价表和现有工具。

- 本公开版以虚构物流条款练习检索和复算。审核应付运费时另取同供应商、同线路、同服务期的采购条款，保留收费项目和单位。
- 对客户出具的金额应能追到输入与原件。未知值用空值加待核原因，有凭据的零额单独记录。区分示例、真实记录、人工复核与到账结果。
- 只引用实际运行的测试和用户实际做过的事。给出可重跑的命令、带来源的输出，以及还需由业务资料回答的问题。
- 资料范围由任务决定。检索器只读取本项目的 `knowledge/`。公开演示使用虚构或脱敏资料，私人对话、客户名单和原始单据保留在原有访问范围内。

## 项目工作流程

| 任务 | 入口 | 输出 |
| --- | --- | --- |
| 决定做、买或暂缓 | [立项评审](.agents/skills/adversarial-reviewer/SKILL.md) | 可证伪的效益假设和同任务对比 |
| 从单据提取事实 | [单据提取](.agents/skills/dirty-doc-extractor/SKILL.md) | 带原文位置的字段与复核队列 |
| 开发第一条可用路径 | [最小原型](.agents/skills/mvp-scaffolder/SKILL.md) | 可重复运行的样例及验收结果 |
| 检查界面能否完成任务 | [界面打磨](.agents/skills/aesthetic-ui-polisher/SKILL.md) | 具体界面修改及复测结果 |

在仓库根目录运行 `python scripts/search_kb.py F03` 查看原文位置。运行 `python -m unittest discover -s tests -p test_knowledge.py` 核验本地检索和文档入口。
