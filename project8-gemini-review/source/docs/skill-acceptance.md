# 四个项目工作流程的验收记录

核对日期为 2026-11-26。输入使用工作簿内置示例、自行构造的采购条款与虚构票号。以下结果来自实际文件读取、数值复算、单元测试或浏览器操作；付费、真实错账和人工节时仍需业务试用取得。

## 1 · 立项评审

**历史任务。** 使用已有报价试算表与独立单位换算做同票对照。单据有缺项时保留待核状态。原始客户费率、计价区间和计算金额留在内部。

**公开复算。** [物流检索练习](../knowledge/logistics/sample-rules.md) 给出一份独立虚构条款。用其金额可以复算四舍五入、检查凭据缺失的处理。该练习是公开版补充示例。

**当时的取舍。** 沿用现有试算表。在同一任务中记下无法发出报价的具体步骤、实际用时，再判断独立网页能提供的增量价值。供应商应付审核仍须获取适用采购约价。

## 2 · 脏单据提取

**输入。** 生成一页虚构 USD 账单 PDF，用文字占位模拟金额无法辨读。另给同一票、同一期间的虚构采购约定：干线 35.00 USD/件×2，操作费 28.00 USD/次×1，折让 −5.00 USD。以下为 PDF 第 1 页真实读回的五行。

```text
FICTIONAL BILL | DEMO-85 | 2026-11 | USD
L1 LINEHAUL   2 pkg  @ 35.00   70.00
L2 HANDLING   1 trip @ ??.??   ??.??
L3 REBATE     1 lot  @ -5.00   -5.00
TOTAL USD 95.00
```

**产出。** 用 ReportLab 生成 PDF，再用 pypdf 提取文字，逐行核对原始文本。金额以十进制字符串保留两位，空值为 JSON null。confidence 保存证据状态。

```json
[
  {"field":"linehaul","raw_value":"70.00","normalized_value":"70.00","unit":"USD","source_ref":"DEMO-85 p1 L1","status":"confirmed","confidence":"legible","reason":"printed number"},
  {"field":"handling","raw_value":"??.??","normalized_value":null,"unit":"USD","source_ref":"DEMO-85 p1 L2","status":"review","confidence":"unreadable","reason":"unreadable characters"},
  {"field":"rebate","raw_value":"-5.00","normalized_value":"-5.00","unit":"USD","source_ref":"DEMO-85 p1 L3","status":"confirmed","confidence":"legible","reason":"printed number"},
  {"field":"printed_total","raw_value":"95.00","normalized_value":"95.00","unit":"USD","source_ref":"DEMO-85 p1 TOTAL","status":"confirmed","confidence":"legible","reason":"printed number"}
]
```

**勾稽。** 可读分项小计 65.00。票面总额减已知小计为 30.00，此值保留为未归属残差。按给定采购约定应付 93.00，票面总额多 2.00，标记待复核。可操作的复核事项为取得 L2 清晰凭据并确认是否还有费用行。运行断言已确认小计为 65.00、合同额为 93.00、L2 提取值为空。测试覆盖可提取文本及缺损标识，扫描图片 OCR 性能另行实测。

## 3 · 单页原型脚手架

**输入。** 在新的临时目录生成“复核 &lt;示例&gt;”页面。页面接收一个单号，保留大小写、数字和中间字符，提示空值或超长。用尖括号测试标题的 HTML 转义。

在项目根目录用尚不存在的路径重跑：

```sh
python .agents/skills/mvp-scaffolder/scripts/create.py demo-acceptance --title "复核 <示例>"
node --test demo-acceptance/app.test.cjs
```

**产出与核对。** 生成 index.html、app.js 和 app.test.cjs。Node 的正常、空值、60/61 字符边界共 3 项测试全部通过。用 Chrome 在 320 px 视窗打开生成的本地页面，标签标题显示原字面值，页面无横向溢出。

| 实际输入 | 点击“核对输入”后的可见文本 |
| --- | --- |
| 空串 | 请填写单号。 |
| 前后有空格的 Demo-042 | 已录入单号 Demo-042 |
| 连续 61 个“箱” | 单号最多 60 个字符，请核对。 |

对同一目录再次运行生成器，已出现“目标目录已存在”报错，并保留原文件。模板可作为新任务的静态起点，已经有适合的项目入口时沿用原入口。[脚手架说明](../.agents/skills/mvp-scaffolder/SKILL.md)

## 4 · 卡片界面审查与复验

**输入。** 开启消费端原型，标题输入“进度复核”，正文输入“样例货号 DEMO-82 共 4 箱，明天提货时间待确认。”。查看手机预览图，在本机 Chrome 模拟不同宽度，实际跳转预览、导出、清空和切换语言。

| 浏览器视窗 | 页面内容宽度 | 保存按钮距页面顶部 | 预览跳转 |
| --- | ---: | ---: | --- |
| 320 × 844 | 320 px | 528 px | 显示 |
| 390 × 844 | 390 px | 508 px | 显示，激活后焦点移到预览标题 |
| 1280 × 844 | 1280 px | 652 px | 桌面双栏直接显示预览 |

**发现与修正。** 首轮清空正文后，保存按钮正确禁用，但状态区为空，操作员和读屏用户无法从该区域获知原因。反馈后再测，同一操作显示“还没有正文。”，切换英文显示“Enter your note first.”。文本输入的 aria-describedby 已关联该状态区域。三种宽度均无横向溢出。

**导出核对。** 预览的无障碍文本保留货号、4 箱及“时间待确认”。点击保存产生下载事件，并从页面备用图片链接读取了 PNG 文件头和宽度 1080 px。首次尝试读取测试浏览器的下载临时文件时，下载被取消；备用链接的图片字节校验成功。此轮为浏览器模拟，未覆盖 iOS 实机、真实语音或用户偏好。[卡片原型](../consumer/index.html)
