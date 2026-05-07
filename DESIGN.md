# 一超物流智能追踪系统 - 设计文档

> 记录关键设计决策、技术选型和业务规则，供后续维护和扩展参考。

---

## 1. 项目背景

### 业务场景
- **客户**：义乌 → 宁波 物流干线运输企业
- **流程**：工厂送货 → 仓库实测 → 生成报价 → 客户确认 → 运输 → 入库
- **痛点**：
  - 传统 Excel/电话模式效率低，客户反复催问货物在哪
  - 实测数据（重量/体积）与客户申报不一致，容易起纠纷
  - 运费计算不透明，客户质疑"为什么收这么多"
  - 现结/月结账单管理混乱，对账困难

### 甲方核心要求
1. **架构灵活**：上线后仍能灵活增删功能，不能因修改出 bug
2. **流程完整**：仓库实测 → 出价 → 客户确认 → 支付，必须闭环
3. **不出错**：金额计算不能错，状态不能乱

---

## 2. 架构设计原则

### 2.1 配置与数据分离（Snapshot 模式）

**原则**：系统在创建文档时，将当时的配置**完整快照保存**，后续修改配置不影响历史数据。

| 配置项 | 快照位置 | 说明 |
|--------|---------|------|
| 路线模板 | `shipment.routeSnapshot` | 创建时保存完整节点列表 |
| 费用类目 | `quote.items` | 报价时保存类目名称、单价、计算方式 |

**为什么**：物流行业中路线和费用标准会调整（如油价涨了提货费从100涨到120），但历史订单必须保持当时的计费规则，否则对账会乱。

### 2.2 功能可插拔（Feature Flags 预留）

虽然第一版没有实现完整的 feature flags 系统，但架构上预留了扩展空间：
- `system_config` 集合可用于存储全局开关
- `fee_categories` 的 `isEnabled` 字段已实现类目级别开关
- 新增费用类目不需要改代码，通过管理端配置即可

### 2.3 权限最小化

| 角色 | 权限范围 | 校验方式 |
|------|---------|---------|
| 客户 | 只读（自己的货物、账单）+ 确认报价 | 手机号绑定 |
| 仓库员 | 实测录入、标记现结收款 | OpenID 白名单 |
| 管理员 | 全部操作 | OpenID 白名单 + 环境变量 |

**为什么**：客户不能看到别人的货物；仓库员不能改费用规则；管理员操作有审计日志。

---

## 3. 关键技术决策

### 3.1 为什么不用微信支付 API？

**决策**：系统只追踪支付状态，不集成微信支付。

**原因**：
1. 甲方业务场景中，现结是"客户现场扫码支付给仓库"，钱不经过系统
2. 月结是"月底银行转账对账"，也不需要线上支付
3. 集成微信支付需要申请商户号、开通支付权限，流程复杂
4. 第一版先解决"信息透明"问题，支付可以后续再加

**现状**：
- 现结：仓库员确认收到现金/扫码款后，在管理端标记"已付"
- 月结：管理端月底统一生成月结账单，线下对账后标记"已付"

### 3.2 为什么用 `db.runTransaction()`？

**使用事务的场景**：
1. **报价确认**：更新 shipment 状态 + 创建 bill + 回写 billId（3 个操作）
2. **标记已付**：更新 bill 状态 + 更新 shipment billing 状态（2 个操作）
3. **月结合并**：查询待合并账单 + 创建月结账单 + 更新原账单（多表操作）

**为什么**：这些操作涉及多个文档，如果第一步成功第二步失败，数据会不一致（如 shipment 显示已确认但账单没创建）。事务保证全部成功或全部回滚。

### 3.3 金额精度处理方案

**问题**：JS 浮点数运算有精度问题，如 `0.1 * 0.2 = 0.020000000000000004`，如果直接存数据库，金额可能多 0.01 或少 0.01。

**方案**：
```javascript
// 精度处理：转整数分再运算
function formatMoney(num) {
  if (num === null || num === undefined) return null;
  const n = Number(num);
  if (isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}

// 乘法时先转整数分
function safeMultiply(a, b) {
  return Math.round((a || 0) * (b || 0) * 100) / 100;
}
```

**为什么不用 `toFixed(2)`**：`toFixed` 返回字符串，且某些临界值会出错（如 `1.005.toFixed(2) = "1.00"` 而不是 "1.01"）。`Math.round` 更可靠。

### 3.4 为什么用软删除？

**实现**：所有集合统一 `isDeleted` 字段，删除时设为 `true`，查询时过滤 `isDeleted: _.neq(true)`。

**为什么**：
1. 物流数据涉及财务，物理删除后无法追溯
2. 历史报价引用了费用类目，如果物理删除类目，历史数据会显示异常
3. 微信云数据库没有回收站，软删除是唯一的"后悔药"

### 3.5 为什么费用类目用 `type` 字段做业务标识？

**设计**：每个费用类目有一个 `type`（如 `baseTransport`、`warehouse`、`pickup`），在代码中按 `type` 匹配计算逻辑。

**校验**：`createCategory` 时检查 `type` 全局唯一，防止重复定义。

**为什么**：
1. 物流业务中，"基础运费"、"仓储费"是固定的业务概念，不应该重复
2. 报价生成时按 `type` 匹配计算方式，如果有两个 `pickup`，系统不知道用哪个
3. `_id` 用语义化 ID（如 `cat_pickup`），但业务逻辑依赖 `type`

### 3.6 为什么管理员白名单支持环境变量？

**实现**：`checkAdmin` 先查代码中的 `ADMIN_OPENIDS` 数组，没有再查 `process.env.ADMIN_LIST`。

**为什么**：
1. 每次加管理员都要改代码、重新部署云函数，太麻烦
2. 环境变量可以在云开发控制台直接修改，立即生效
3. 代码中的 `ADMIN_OPENIDS` 作为兜底，即使环境变量没配也能运行

---

## 4. 数据库设计

### 4.1 集合清单

| 集合 | 用途 | 关键字段 |
|------|------|---------|
| `shipments` | 货物主表 | `_id`, `status`, `routeSnapshot`, `measurement`, `quote`, `billing`, `fees`, `totalAmount` |
| `users` | 用户表 | `_id` (OpenID), `phone`, `subscription` |
| `operation_logs` | 操作审计 | `shipmentId`, `operation`, `details`, `operator`, `timestamp` |
| `fee_categories` | 费用类目 | `name`, `type`, `calculationType`, `basePrice`, `unitPrice`, `isEnabled`, `priceHistory` |
| `bills` | 账单 | `_id`, `billType`, `shipmentId`, `clientPhone`, `totalAmount`, `status`, `paymentType`, `monthlyBatch` |

### 4.2 关键嵌套字段设计

**`shipment.measurement`**：
```javascript
{
  status: 'pending' | 'measured',
  actual: { pieces, weight, volume, weightUnit, volumeUnit },
  photos: ['cloud://...', 'cloud://...'],
  measuredAt, measuredBy, note
}
```

**`shipment.quote`**：
```javascript
{
  status: 'draft' | 'sent' | 'confirmed',
  items: [{ categoryId, name, calculationDetail, amount, isIncluded }],
  subtotal, note, sentAt, confirmedAt, confirmedBy
}
```

**`shipment.billing`**：
```javascript
{
  paymentType: 'spot' | 'monthly',
  paymentStatus: 'unpaid' | 'paid',
  billId, paidAt, paidBy, paidAmount
}
```

### 4.3 索引清单

| 集合 | 索引 | 用途 |
|------|------|------|
| `shipments` | `managerPhone` + `createdAt` | 按手机号查货物列表 |
| `shipments` | `shareToken` | 分享链接跳转 |
| `shipments` | `measurement.status` + `createdAt` | 仓库待测量队列 |
| `users` | `phone` | 手机号绑定查询 |
| `operation_logs` | `shipmentId` + `timestamp` | 单票货操作历史 |
| `fee_categories` | `isEnabled` + `sortOrder` | 列表查询 |
| `bills` | `clientPhone` + `createdAt` | 客户查我的账单 |
| `bills` | `status` + `createdAt` | 管理端查未付账单 |

---

## 5. 错误处理策略

### 5.1 云函数错误分级

| 错误类型 | 处理方式 | 前端看到 |
|---------|---------|---------|
| 权限错误（`AUTH_FAILED:`） | 直接透传消息 | "权限不足：xxx" |
| 业务错误（参数校验、状态异常） | 直接透传消息 | "报价单状态不正确" |
| 数据库错误（连接失败、超时） | 吞掉，返回通用错误 | "系统操作异常，请联系管理员" |

**为什么**：业务错误要让用户知道具体问题（如"请先保存报价草稿再发送"），但数据库错误不能暴露内部细节（如 collection name、document ID）。

### 5.2 前端错误兜底

- 所有云函数调用用 `try/catch` 包裹
- 失败时显示 `wx.showToast` 或 `wx.showModal`
- 关键操作（确认报价）用二次弹窗确认，防止误触

---

## 6. 定时任务

| 任务 | 触发器 | 频率 | 作用 |
|------|--------|------|------|
| `cleanupPaidBills` | `0 0 1 * * *` | 每月1号凌晨 | 软删除已付超过90天的账单 |

**为什么90天**：物流行业对账周期通常为1-3个月，90天后账单已无查询需求，清理可减少数据库体积。

---

## 7. 后续扩展方向

### 7.1 短期（1-2个月）
- **Feature Flags**：在 `system_config` 集合增加全局开关，支持线上灰度
- **订阅消息模板配置化**：将模板 ID 移到数据库，无需改代码即可更换模板
- **多仓库支持**：实测录入时选择仓库，费用按仓库差异化计算

### 7.2 中期（3-6个月）
- **微信支付集成**：如果甲方需要线上收款，可接入微信支付
- **报表导出**：月结账单支持导出 Excel/PDF
- **客户分级**：不同客户享受不同折扣率

### 7.3 长期（6个月+）
- **司机端小程序**：司机扫码更新节点，减少管理员操作
- **电子签名**：客户确认报价时电子签名存证
- **数据大屏**：管理端可视化看板，实时展示运输状态

---

## 8. 重要约定

### 8.1 代码规范
- 金额相关操作必须使用 `formatMoney()` 或 `safeMultiply()`
- 数据库写入时间统一使用 `db.serverDate()`，不用 `new Date().toISOString()`
- 查询时加 `isDeleted: _.neq(true)` 过滤
- 权限校验错误统一以 `AUTH_FAILED:` 前缀开头

### 8.2 部署规范
- 修改云函数后必须重新部署
- 修改 `config/index.js` 后需部署引用它的所有云函数
- 环境变量修改后需重新部署对应云函数
- 数据库索引在生产环境创建前，先在测试环境验证

---

## 9. 联系方式

部署或维护过程中遇到问题：
1. 微信开发者社区：https://developers.weixin.qq.com/
2. 微信小程序文档：https://developers.weixin.qq.com/miniprogram/dev/framework/
3. 微信云开发文档：https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html
