# 两个可双击打开的离线试用文件

将任意一个 HTML 下载到电脑，使用较新的 Chrome 或 Edge 打开。每个文件都自成一体，可以只传其中一个。邮件或聊天软件的附件预览器可能禁止运行网页脚本，此时先保存到本机，再选择浏览器打开。使用者无须安装 Node、解压素材或启动网站。

| 文件 | 试用方法 | 实际验证范围 |
| --- | --- | --- |
| [Dispatch-Notes.html](Dispatch-Notes.html) | 粘贴一段虚构出货进度，核对原文、预览中英文卡片，再保存 PNG。自动下载未出现时可选「打开图片以保存」。 | 在 Chromium 断网环境中从本机文件完整生成、解码 1080×1320 PNG。可以主动请求浏览器听写；离线或环境不支持时手工输入、粘贴。未验证真机麦克风与系统相册。 |
| [Freight-Review.html](Freight-Review.html) | 加载合成示例，打开有差额的行，记下复核结论，导出 Excel；也可导入自己的脱敏供应商账单与同票采购基准。右上角可选择英文。切换语言会重新打开核对台，先导出当前工作。 | 同一 HTML 在断网状态实际完成中文和英文审阅界面、示例 CSV、上传 XLSX/带文字层的 PDF 及三张工作表的实际 XLSX 生成；还验证了无 ToUnicode 表、使用预定义简体中文 CMap 的一个合成 PDF。文件内含 PDF.js、worker、168 个 CMap 和 JSZip。样例金额不代表真实错账。 |

扫描 PDF 目前依靠查看原件及人工转录；未覆盖所有文档版式。Ollama 仅为可选项，需另外运行本机模型服务且浏览器允许连接；本次断网单文件测试没有调用真实模型。卡片文字整理采用可关闭的规则。两款应用的断网测试均未发现外部 HTTP 请求。双击文件不提供 HTTPS 网站地址或 PWA 安装体验。

## 文件校验

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| Dispatch-Notes.html | 22251 | DF9934AD77CB8B4D385FB0565CBF3E89BE7295BF5C7259FAD2014326FA8FE8C6 |
| Freight-Review.html | 3502880 | 9E99DDAC8E1B006B8823E5802E1744B25DE2A777AFC4BD7E40CC2356ABC15ACD |

开发者复现步骤：从本目录运行 `node build.cjs`。预装 Playwright Core 与 Chromium 后设置 `NOTE_PLAYWRIGHT`、`NOTE_CHROMIUM` 并运行 `node check.cjs`。检查器为每个 HTML 建立独立临时目录，目录中仅有该 HTML，关闭浏览器网络后使用实际本机文件 URL 验证；真实业务或真实用户结果需要另外记录。
