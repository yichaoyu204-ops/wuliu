# 寄语 · Dispatch Notes

一页中英文口述卡片原型。打开同目录的 `index.html` 即可打字、编辑、预览和导出 PNG，`index.html?lang=en` 直接进入英文界面。若需将一个文件交给试用者，可使用 [可双击的独立 HTML](../offline/Dispatch-Notes.html)。运行不需要账号、API Key 或构建依赖。产品假设、定价演算和宣传草案见 [SPEC.md](SPEC.md)。

## 打开、部署与回滚

1. 桌面直接打开 `index.html`。若需本机 HTTP，安装 Node 后在本目录运行 `node serve.cjs` 并打开 `http://127.0.0.1:4174/`。此服务仅监听本机。可传其他端口。
2. 部署时把 `index.html`、`style.css`、`core.js`、`card.js`、`app.js`、`sw.js`、`manifest.webmanifest`、`icon-192.png`、`icon-512.png` 放在同一静态 HTTPS 目录；手机首次访问需联网。服务工作线程完成首次缓存后，可按浏览器能力离线重新打开。清除站点数据将删除缓存。换版本时更新 `sw.js` 的缓存版本并整包发布；回滚时将旧内容以新的缓存版本整包发布。
3. Safari/Chrome 是否给出「添加到主屏幕」及是否支持语音，取决于真实设备、系统、权限与网络。语音不可用时直接输入、粘贴，或使用系统键盘听写。浏览器可能在线处理口述，录入涉及客户资料时可改用手输。应用没有历史草稿存储；刷新会回到虚构示例。图片由本地 Canvas 生成，若系统取消下载可点「打开图片以保存」。

## 演示与测试

| 文件 | 内容 |
| --- | --- |
| [手机页面截图](mobile-preview.png) | 实际 Chromium 390×844 CSS px 手机视口的整页截图 |
| [样例导出](sample-card.png) | 页面生成的 1080×1320 PNG，虚构单号 DEMO-27 |
| [手机操作录屏](demo/mobile-demo.webm) | 浏览器中实际操作虚构单据，编辑标题、跳转预览并触发保存；片中没有现场麦克风录音 |
| [测试记录](QA.md) | 三轮观察、修复、覆盖范围和剩余验证 |

运行数据与服务工作线程测试：`node --test core.test.cjs worker.test.cjs`。

浏览器端测试需预装 Playwright Core 和与之匹配的 Chromium。设置 `NOTE_PLAYWRIGHT` 为模块路径、`NOTE_CHROMIUM` 为可执行文件路径后运行 `node browser.test.cjs`。默认通过本机 HTTP 测服务工作线程。如果执行环境禁止回环网络，设置 `NOTE_FILE_TEST=1` 将浏览器测试限制为实际本地文件路径，服务工作线程另外运行模拟生命周期测试。用 `node record-demo.cjs` 可重新录制；录制器需要当前 Playwright 对应的 FFmpeg，必要时设 `PLAYWRIGHT_BROWSERS_PATH` 指向已安装的浏览器工具路径。
