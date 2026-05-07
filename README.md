# 一超物流智能追踪系统

> 基于微信小程序云开发的智能物流追踪 + 计费管理系统
> 适用场景：义乌 → 宁波 物流干线，工厂 → 仓库 → 报关

## 核心特性

- **AI 智能识别**：自动识别进仓通知单，检测手写/涂改
- **实时追踪**：5 个标准节点，支持自定义路线
- **三端服务**：工厂端（客户）+ 业务员端（管理员）+ 仓库端（仓库员），权限分离
- **实测报价**：仓库员录入实测数据 + 拍照存证 → 管理员生成报价 → 客户确认 → 自动入账
- **账单管理**：现结/月结双模式，支持月结合并、标记已付、定时清理
- **分享链接**：每票货独立链接，一键转发客户
- **通知推送**：微信订阅消息推送报价确认、物流状态更新

## 完整业务流程

```
建单（AI识别/手工录入）
  → 仓库实测（重量/体积/件数 + 拍照）
  → 管理员报价（按费用类目自动生成）
  → 发送报价（微信订阅消息通知客户）
  → 客户确认（选现结/月结）
  → 生成账单（事务保证原子性）
  → 管理端标记已付 / 月结合并
```

## 项目结构

```
物流追踪系统/
├── 后端云函数/
│   ├── 00-全局配置/
│   │   └── config/index.js          # 路线模板、AI提示词、费用标准、模板ID
│   ├── 01-AI识别云函数/
│   │   └── ai-parse/                # 调用Kimi API识别单据
│   ├── 02-货物创建云函数/
│   │   └── shipment-create/         # 创建货物，初始化 measurement/quote/billing
│   ├── 03-货物查询云函数/
│   │   └── shipment-query/          # 查单详情、列表、仓库待测量队列
│   ├── 04-节点更新云函数/
│   │   └── shipment-update/         # 核心：节点更新、实测录入、报价 draft/send/confirm（事务）、现结标记
│   ├── 05-工具函数/
│   │   └── utils/
│   │       ├── aiParser.js          # AI结果解析
│   │       ├── formatMoney.js       # 金额精度处理（Math.round，防JS浮点坑）
│   │       ├── idGenerator.js       # 单号生成
│   │       ├── notification.js      # 微信订阅消息（物流+报价双模板）
│   │       └── response.js          # 统一响应格式
│   ├── 06-费用类目云函数/
│   │   └── fee-config/              # 费用类目管理、自动播种、价格变更留痕
│   └── 07-账单管理云函数/
│       └── billing-manage/          # markPaid（事务）、billList、pendingBills、createMonthlyBill、cleanupPaidBills
│           └── config.json          # 定时触发器：每月1号凌晨执行清理
│
├── 前端小程序/
│   ├── app.js
│   ├── app.json
│   └── pages/
│       ├── index/                   # 客户查单首页
│       ├── detail/                  # 货物详情（支持分享链接）
│       ├── confirm/quote/           # 客户确认报价（橙色系，实测照片预览）
│       ├── billing/cart/            # 客户我的账单（Tab：全部/待付/已付）
│       └── admin/
│           ├── create/              # 管理员建单（含AI识别）
│           ├── feeconfig/           # 费用类目配置（增删改查）
│           ├── measure/             # 仓库员实测录入（拍照+异常防呆）
│           ├── quote/               # 管理员生成报价（多行其他费用+单位一致性检查）
│           └── billing/             # 管理端账单总览（统计/Tab/标记已付/月结生成）
│
├── 部署文档/
│   ├── 完整部署指南.md
│   └── 详细下一步计划.md
│
├── 测试数据/
│
└── README.md                        # 本文件
```

## 快速开始

### 1. 准备工作
- 注册微信小程序账号（企业/个体户）
- 开通云开发，记录环境 ID
- 申请 Kimi API Key

### 2. 配置部署
```bash
# 修改云环境ID
编辑：前端小程序/app.js
修改：env: '你的云环境ID'

# 部署云函数
在微信开发者工具中右键部署所有云函数

# 设置环境变量
在云开发控制台添加：
  KIMI_API_KEY=你的API密钥
  ADMIN_LIST=管理员OpenID（逗号分隔）
```

### 3. 创建数据库与索引

创建集合：
- `shipments`（货物主表）
- `users`（用户表）
- `operation_logs`（操作日志）
- `fee_categories`（费用类目）
- `bills`（账单）

创建索引（详见部署文档）：
```
shipments:   measurement.status + createdAt
bills:       clientPhone + createdAt
bills:       status + createdAt
fee_categories: isEnabled + sortOrder
```

### 4. 申请微信订阅消息模板
- 物流状态更新提醒 → `shipmentUpdate`
- 报价确认通知 → `quoteConfirmation`
- 将模板 ID 填入 `config/index.js`

### 5. 配置定时触发器
`billing-manage/config.json` 已包含每月 1 号凌晨自动清理已付账单。
部署后在云开发控制台确认触发器生效。

## 角色与权限

| 角色 | 能做什么 | 校验方式 |
|------|---------|---------|
| **客户**（工厂） | 查单、确认报价、查看账单 | 手机号绑定 |
| **仓库员** | 提交实测数据、标记现结已收款 | OpenID 白名单（WAREHOUSE_OPENIDS） |
| **管理员** | 建单、报价、费用配置、账单管理、月结 | OpenID 白名单（ADMIN_OPENIDS + 环境变量 ADMIN_LIST） |

## 可安全修改的内容

修改以下文件**不会影响历史数据**，只会影响新创建的货物：

| 配置项 | 文件路径 | 说明 |
|--------|----------|------|
| 路线模板 | `后端云函数/00-全局配置/config/index.js` | defaultRoutes 数组 |
| AI 提示词 | `后端云函数/00-全局配置/config/index.js` | kimi.prompt |
| 费用标准 | `后端云函数/00-全局配置/config/index.js` | defaultFees 对象（降级兜底） |
| 订阅消息模板ID | `后端云函数/00-全局配置/config/index.js` | wxTemplates |
| 通知文案 | `后端云函数/05-工具函数/utils/notification.js` | buildNotificationContent |
| 前端页面 | `前端小程序/` | 所有前端文件 |

## 数据安全设计

**关键原则：配置与数据分离**

- 货物创建时，路线配置会被**完整快照保存**到 `routeSnapshot`
- 报价确认时，费用类目配置快照保存到 `quote.items`
- 后续修改配置（路线/费用）**不会影响历史货物**
- 每票货独立运行，互不干扰
- 金额统一精度处理：`Math.round(n * 100) / 100`，避免 JS 浮点污染
- 关键操作使用 `db.runTransaction()` 保证原子性（确认报价+创建账单、标记已付）
- 软删除：所有集合统一 `isDeleted` 字段，不物理删除

## 费用预估

| 项目 | 免费额度 | 预估月费 |
|------|---------|---------|
| 云函数调用 | 100 万次 | ¥0（初期） |
| 数据库存储 | 5 GB | ¥0（初期） |
| 云存储 | 5 GB | ¥0（初期，照片） |
| Kimi API | - | ~¥0.01-0.02/次 |

## 文档索引

- [完整部署指南](部署文档/完整部署指南.md) - 详细部署步骤、索引清单、测试流程
- [详细下一步计划](部署文档/详细下一步计划.md) - 分阶段实施计划
- `后端云函数/*/index.js` 顶部注释 - 各云函数的 action 说明

## License

私有项目，仅供内部使用
