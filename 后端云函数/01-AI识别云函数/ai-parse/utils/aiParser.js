/**
 * AI响应解析工具
 * 可修改以适配不同的AI返回格式
 */

/**
 * 清理AI返回的JSON字符串
 */
function cleanAIResponse(content) {
  if (!content || typeof content !== 'string') {
    throw new Error('AI返回内容为空或格式错误');
  }

  let cleaned = content
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) cleaned = jsonMatch[0];

  return cleaned;
}

/**
 * 解析AI返回的JSON
 */
function parseAIResponse(content) {
  const cleaned = cleanAIResponse(content);
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('JSON解析失败:', e);
    throw new Error(`JSON解析失败: ${e.message}`);
  }
}

/**
 * 转换AI返回为内部数据结构
 * 可修改以适配不同的字段映射
 */
function normalizeShipmentData(aiData) {
  const info = aiData.shipmentInfo || {};
  const routing = aiData.routing || {};
  const contacts = aiData.contacts || {};

  const reviewFields = [];
  const checkField = (field, fieldName) => {
    if (field && field.manualReview === true) reviewFields.push(fieldName);
    return field ? field.val : null;
  };

  return {
    cargoInfo: {
      warehouseEntryNo: checkField(info.entryNo, '进仓编号'),
      waybillNo: checkField(info.waybillNo, '运单号'),
      pieces: checkField(info.pieces, '件数'),
      piecesUnit: info.pieces ? info.pieces.unit || 'CTNS' : 'CTNS',
      grossWeight: checkField(info.weight, '毛重'),
      weightUnit: info.weight ? info.weight.unit || 'KGS' : 'KGS',
      volume: checkField(info.volume, '体积'),
      volumeUnit: info.volume ? info.volume.unit || 'CBM' : 'CBM',
      marks: checkField(info.marks, '唛头')
    },
    routing: {
      warehouseName: checkField(routing.warehouseName, '仓库名称'),
      warehouseAddress: checkField(routing.warehouseAddress, '仓库地址'),
      entryTime: checkField(routing.entryTime, '进仓时间'),
      departureTime: checkField(routing.departureTime, '预计开航'),
      destinationPort: checkField(routing.destinationPort, '目的港'),
      latestDeliveryTime: checkField(routing.latestDeliveryTime, '最晚进仓')
    },
    contacts: {
      factoryName: checkField(contacts.factoryName, '工厂名称'),
      contactPerson: checkField(contacts.contactPerson, '联系人'),
      contactPhone: checkField(contacts.contactPhone, '联系电话')
    },
    handwritingDetected: aiData.handwritingDetected || false,
    reviewFields,
    pushSummary: aiData.pushSummary || '',
    raw: aiData
  };
}

/**
 * 截断推送摘要
 */
function truncatePushSummary(summary, maxLength = 20) {
  if (!summary) return '';
  if (summary.length <= maxLength) return summary;
  return summary.substring(0, maxLength - 3) + '...';
}

module.exports = { cleanAIResponse, parseAIResponse, normalizeShipmentData, truncatePushSummary };