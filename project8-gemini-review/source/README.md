# 物流对账与口述卡片 · 三天试用交付

企业端用于逐票核对供应商收费。个人端用于将口述整理成可以直接保存的中文或英文卡片。工作簿中的现有报价表和小程序继续为对客收费服务。

## 打开两个产品

最快的方式是直接双击 [运费核对台](offline/Freight-Review.html) 或 [寄语卡片](offline/Dispatch-Notes.html)。两个离线文件均可独立转给受测者，包含的是构造的演示数据。浏览器自带的听写能力和另配的本机模型分别受设备条件限制。

解压后在已安装 Node.js 的 Windows 上双击 **打开试用台.cmd**，或在项目根目录运行 `node scripts/preview.mjs --open`。终端会给出本机试用地址。使用 Mac 或 Linux 的方式相同。服务只读取分发的应用文件，并监听本机回环地址。在测试者的设备上可以各自运行同一份代码。

| 产品 | 第一次可以试什么 | 验证条件 |
| --- | --- | --- |
| 供应商账单核对 | 打开企业端，加载虚构示例，查看每笔供应商账单对照采购约定的差额。点开原文位置，记录人工结论，导出 Excel。也可使用 `b2b/samples/` 的输入。 | 文件与审核在浏览器中处理。可提取的文字 PDF 必须复核；扫描页提供人工补录。选用本机模型时须有可用 Ollama 服务和本地模型。 |
| 寄语 · 口述卡片 | 打开个人端，粘贴一句带货号、件数或预计时间的业务动态；也可以在支持的环境启动听写。核对内容，切换版式，保存图片。 | 语音由设备及浏览器提供，可能由浏览器厂商处理。可随时以键盘输入。 |

[企业端说明](b2b/README.md) · [个人端说明](consumer/README.md) · [10 秒操作录屏](consumer/demo/mobile-demo.webm) · [实际导出的示例卡](consumer/sample-card.png)

## 验收与复用

| 要做的工作 | 打开位置 |
| --- | --- |
| 回到原计划的业务判断，逐项验收企业产品的十个技术任务 | [六维审查与规格](docs/logistics-review.md) |
| 实测已知的正常账、异常账和不完整的输入 | [20 组虚构配对的独立测试](benchmarks/README.md) |
| 以同票真单获取人工答案、组织 3–5 位同行试用、记录错账、回款与复购 | [现场验证手册与空白台账](validation/README.md) |
| 查看个人产品的视觉规范、三种宣传画面、成本和定价假设 | [个人产品设计](consumer/SPEC.md) |
| 核查两轮视觉调整和各浏览器状态 | [界面验证记录](consumer/QA.md) |
| 搜索有出处的行业规则，用四种技能开展下一轮工作 | [项目约定](AGENTS.md) · [知识库](knowledge/INDEX.md) · [技能验收](docs/skill-acceptance.md) |

### 可重跑的检查

在根目录运行以下命令。多数单元测试使用 Node.js 或 Python 标准库。PDF、XLSX、浏览器测试所需的模块和运行方式详见两个产品及独立测试目录中的说明。

```text
node --test b2b/tests/core.test.mjs b2b/ollama.test.mjs
node validation/check-spec.mjs
node --test consumer/core.test.cjs consumer/worker.test.cjs
python -m unittest discover -s tests -p test_knowledge.py
python scripts/search_kb.py F03
```

可用 `node scripts/preview.mjs --build <新建的发布目录>` 构建静态试用站，首页与 /en/ 为中英文入口。发布目录只含使用者需要的静态资源和示例；本公开源码树另含练习知识库、验证方案与开发资料。外部受测人只需要收到试用版或离线演示。

## 工程回归中发现的两处问题

- **单侧资料缺失。** 独立用例发现，采购依据不可读时，账单的一行可能看起来像可直接追索的差额。修正后该行显示“对侧资料待核”，差额为空；补回采购证据后再复核。
- **空白卡片。** 手机界面清空正文后，保存按钮会禁用，但首轮界面没有解释原因。现在状态区域会用当前语言解释，并可被读屏工具读取。

技术测试用的是虚构账单和浏览器模拟视口。真实供应商资料、真机听写、真实节时、实际付款分别按现场证据验收。20 组工程样本的文件和独立答案保存在 benchmarks/；真实材料的验证登记另存 validation/。
