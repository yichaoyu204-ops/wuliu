# 运费核对台与口述卡片
这是项目 8 的公开复核材料，记录截至北京时间 2026 年 11 月 27 日。两款原型、模拟账单、测试和记录可一起下载，也可在仓库内逐项阅读。

## 从哪里开始

| 想做什么 | 入口 |
| --- | --- |
| 让 Gemini 独立复核 | [复核任务](00-复核说明.md) · [三天计划与原八天要求](三天产品验证计划.md) · [18 项交付验收表](交付验收.csv) |
| 核查现有判断 | [项目进度与评判标准](项目进度与交付评判标准.md) · [保留公式的七页工作簿](三天产品评审与物流验证.xlsx) |
| 体验供应商账单核对 | [独立 HTML](source/offline/Freight-Review.html) · [说明和导入样例](source/b2b/README.md) · [20 组模拟账单与标准答案](source/benchmarks/README.md) |
| 体验语音转分享卡片 | [独立 HTML](source/offline/Dispatch-Notes.html) · [操作说明](source/consumer/README.md) · [实录](source/consumer/demo/mobile-demo.webm) · [导出样张](source/consumer/sample-card.png) |
| 复跑测试、查规格与业务验证方法 | [源码与运行命令](source/README.md) · [知识库索引](source/knowledge/INDEX.md) · [现场验证台账说明](source/validation/README.md) |

在 GitHub 下载 ZIP 并解压，直接打开任一独立 HTML 即可试用。也可在 `source/` 目录运行 `node scripts/preview.mjs --open` 启动本地试用台。

## 证据范围

项目记录的真实采购配对为 0/20，外部试用、确认错账、实际付款均为 0。工程测试覆盖了 20 组虚构输入。有关产品使用意愿与付费能力的判断还需真人试用。

公开版用独立编写的虚构条款替换了业务报价知识条目，并调整了对应检索测试。工作簿保留原有七个页签、公式、模拟输入和空白模板。客户报价来源链接、费率金额、私有站点标识、归档 Git 历史均已省略。第三方依赖和字符映射随附的许可证位于 [vendor](source/b2b/vendor/)。

