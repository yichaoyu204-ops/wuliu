/**
 * 微信通知服务
 * 可修改通知模板和内容格式
 *
 * 关键注意事项：
 * 1. 微信模板字段类型严格：带中文的字段必须用 thing 类型，不能用 character_string
 * 2. 云函数运行在 UTC 时区，时间显示必须手动加 8 小时转北京时间
 * 3. 货物字段可能为 null，拼接前必须做容错处理
 * 4. 小程序页面路径不带开头的 /，否则跳转失败
 */

const cloud = require('wx-server-sdk');
const config = require('../config');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 截断字符串，超过长度时末尾加省略号
function truncatePushSummary(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 1) + '…';
}
const db = cloud.database();

// 获取北京时间（云函数默认 UTC，需手动 +8h）
function getBeijingTimeStr() {
  const bjDate = new Date(Date.now() + 8 * 3600 * 1000);
  const m = String(bjDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(bjDate.getUTCDate()).padStart(2, '0');
  const h = String(bjDate.getUTCHours()).padStart(2, '0');
  const min = String(bjDate.getUTCMinutes()).padStart(2, '0');
  return `${m}-${d} ${h}:${min}`;
}

// 安全拼接货物描述，防止 null/undefined 导致乱码
function safeCargoDesc(cargoInfo) {
  if (!cargoInfo) return '未录入明细';
  const p = cargoInfo.pieces ? `${cargoInfo.pieces}${cargoInfo.piecesUnit || ''}` : '';
  const w = cargoInfo.grossWeight ? `${cargoInfo.grossWeight}${cargoInfo.weightUnit || ''}` : '';
  const v = cargoInfo.volume ? `${cargoInfo.volume}${cargoInfo.volumeUnit || ''}` : '';
  return [p, w, v].filter(Boolean).join('/') || '未录入明细';
}

// 缩短工厂名，去除"萌恒-"前缀后取前4字
function shortFactory(factoryName) {
  if (!factoryName) return '未知';
  if (factoryName.includes('萌恒-')) return factoryName.replace('萌恒-', '').substring(0, 4);
  return factoryName.substring(0, 4);
}

/**
 * 构建物流节点通知内容
 * 字段 key 必须与微信公众平台申请的模板字段严格一致
 * thing 类型：可含中文，限20字以内
 * time 类型：时间格式字符串
 */
function buildNotificationContent(shipment, nodeUpdate) {
  const { cargoInfo, factoryName, routing } = shipment;
  const { nodeName } = nodeUpdate;

  return {
    thing1: { value: truncatePushSummary(`${shipment._id}(${shortFactory(factoryName)})`, 20) },
    thing2: { value: truncatePushSummary(nodeName, 20) },
    thing3: { value: truncatePushSummary(safeCargoDesc(cargoInfo), 20) },
    time4:  { value: getBeijingTimeStr() },
    thing5: { value: truncatePushSummary(routing?.warehouseName || '状态已更新', 20) }
  };
}

/**
 * 发送物流节点订阅消息
 */
async function sendShipmentNotification(shipmentId, nodeUpdate) {
  try {
    const shipmentRes = await db.collection('shipments').doc(shipmentId).get();
    if (!shipmentRes.data) throw new Error('货物不存在');
    const shipment = shipmentRes.data;

    const userRes = await db.collection('users').where({ phone: shipment.managerPhone }).get();
    if (userRes.data.length === 0) {
      return { success: false, reason: '用户未绑定小程序', fallback: await generateCopyText(shipmentId, nodeUpdate) };
    }

    const user = userRes.data[0];
    if (!user.subscription?.shipmentUpdate) {
      return { success: false, reason: '用户未订阅消息通知', fallback: await generateCopyText(shipmentId, nodeUpdate) };
    }

    const messageData = buildNotificationContent(shipment, nodeUpdate);

    const result = await cloud.openapi.subscribeMessage.send({
      touser: user._id,
      templateId: config.wxTemplates.shipmentUpdate,
      // 页面路径不带开头的 /，否则跳转失败
      page: `pages/index/index?shareToken=${shipment.shareToken}`,
      data: messageData
    });

    await db.collection('shipments').doc(shipmentId).update({
      data: {
        'notification.lastSentAt': db.serverDate(),
        'notification.sentCount': db.command.inc(1)
      }
    });

    return { success: true, messageId: result.msgid };
  } catch (err) {
    console.error('发送通知失败:', err);
    return { success: false, reason: err.message, fallback: await generateCopyText(shipmentId, nodeUpdate) };
  }
}

/**
 * 生成复制文案（兜底方案）
 * 去掉误导性的 https 链接，改为引导用户打开小程序
 */
async function generateCopyText(shipmentId, nodeUpdate) {
  const shipmentRes = await db.collection('shipments').doc(shipmentId).get();
  if (!shipmentRes.data) throw new Error('货物不存在');
  const shipment = shipmentRes.data;

  const { cargoInfo, factoryName, routing } = shipment;
  const { nodeName } = nodeUpdate;

  const text = `【物流状态更新】编号：${shipment._id}

🏭 客户：${factoryName || '——'}
📦 明细：${safeCargoDesc(cargoInfo)}
📍 进度：${nodeName}
🏢 仓库：${routing?.warehouseName || '——'}

（请在【百捷物流】小程序首页搜索单号查看照片与详情）`;

  return { text, html: text.replace(/\n/g, '<br>') };
}

/**
 * 构建报价确认通知内容
 * 使用独立模板 quoteConfirmation，与物流通知区分
 * amount 类型可接受 ¥ 符号；thing 类型支持中文
 */
function buildQuoteNotificationContent(shipment, totalAmount) {
  const amountText = totalAmount != null ? `¥${totalAmount}` : '待定';

  return {
    thing1:  { value: truncatePushSummary(`待确认报价: ${shipment._id}`, 20) },
    amount2: { value: amountText },
    thing3:  { value: truncatePushSummary(`${shortFactory(shipment.factoryName)} ${safeCargoDesc(shipment.cargoInfo)}`, 20) },
    time4:   { value: getBeijingTimeStr() },
    thing5:  { value: '请点击进入小程序查看明细并确认' }
  };
}

/**
 * 发送报价确认通知
 * 失败时返回兜底复制文案
 */
async function sendQuoteNotification(shipmentId, totalAmount) {
  let shipment = null;
  try {
    const shipmentRes = await db.collection('shipments').doc(shipmentId).get();
    if (!shipmentRes.data) throw new Error('货物不存在');
    shipment = shipmentRes.data;

    const userRes = await db.collection('users').where({ phone: shipment.managerPhone }).get();
    if (userRes.data.length === 0) {
      return { success: false, reason: '用户未绑定小程序', fallback: generateQuoteCopyText(shipment, totalAmount) };
    }

    const user = userRes.data[0];
    if (!user.subscription?.shipmentUpdate) {
      return { success: false, reason: '用户未订阅消息', fallback: generateQuoteCopyText(shipment, totalAmount) };
    }

    await cloud.openapi.subscribeMessage.send({
      touser: user._id,
      templateId: config.wxTemplates.quoteConfirmation,
      page: `pages/confirm/quote/index?id=${shipmentId}`,
      data: buildQuoteNotificationContent(shipment, totalAmount)
    });

    return { success: true };
  } catch (err) {
    console.error('发送报价通知失败:', err);
    // 注意：用 shipment 对象（不是 shipmentId 字符串）调用 fallback 生成函数
    return {
      success: false,
      reason: err.message,
      fallback: shipment ? generateQuoteCopyText(shipment, totalAmount) : null
    };
  }
}

/**
 * 生成报价确认复制文案（兜底方案）
 */
function generateQuoteCopyText(shipment, totalAmount) {
  const amountText = totalAmount != null ? `¥${totalAmount}` : '待定';
  return {
    text: `【运费报价待确认】编号：${shipment._id}

🏭 客户：${shipment.factoryName || '——'}
💰 运费总价：${amountText}

运费明细已生成，请进入【百捷物流】小程序确认。`
  };
}

module.exports = {
  sendShipmentNotification,
  sendQuoteNotification,
  generateCopyText,
  buildNotificationContent
};
