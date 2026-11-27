# 构建与部署
在 source 目录运行 `node scripts/preview.mjs --build deployment/dist`，再将生成的 deployment/dist 作为静态站点根目录。构建包括中英入口、两款产品、字符映射与模拟示例。上传后从未登录的浏览器核验两个语言入口，再分别实测 Excel 与 PNG 导出。

原项目私有托管记录及凭据未放入本公开仓库。历史验收状态见[计划](../../三天产品验证计划.md)。
