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
 * 从字符串中分离数字和单位
 * 例如 "3411.95KG" → { val: "3411.95", unit: "KG" }
 */
function extractNumberAndUnit(str) {
  if (str === null || str === undefined) return { val: null, unit: null };
  const s = String(str).trim();
  const match = s.match(/^([\d.]+)\s*([a-zA-Z一-龥]+)$/);
  if (match) {
    return { val: match[1], unit: match[2] };
  }
  return { val: s, unit: null };
}

function normalizeWaybillNo(value) {
  if (value === null || value === undefined) {
    return { val: null, valid: false };
  }

  const raw = String(value)
    .trim()
    .toUpperCase()
    .replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '')
    .replace(/[\s\-_\/]+/g, '');
  if (!/^\d{2}MH[A-Z0-9]+$/.test(raw)) {
    return { val: null, valid: false };
  }

  return { val: raw, valid: true };
}

function collectWaybillCandidates(aiData, info) {
  const candidates = [];
  const add = (value) => {
    const raw = readAIFieldValue(value);
    if (raw === null || raw === undefined) return;
    const matches = String(raw).toUpperCase().match(/\b\d{2}[\s\-_\/]*MH[A-Z0-9]+\b/g);
    if (matches) candidates.push(...matches);
  };

  add(info.waybillNo);
  add(info.waybillNoCandidates);
  add(aiData.waybillNo);
  add(aiData.waybillNoCandidates);
  add(aiData.allVisibleCodes);
  add(aiData.visibleCodes);
  add(aiData.codes);
  add(aiData.rawText);
  add(aiData.ocrText);
  add(aiData.fullText);
  add(aiData.text);
  add(JSON.stringify(aiData));

  return Array.from(new Set(candidates));
}

function pickWaybillNo(aiData, info) {
  const direct = normalizeWaybillNo(checkFieldValue(info.waybillNo));
  if (direct.valid) return direct;

  const candidates = collectWaybillCandidates(aiData, info)
    .map(value => normalizeWaybillNo(value))
    .filter(item => item.valid);

  return candidates[0] || { val: null, valid: false };
}

function checkFieldValue(field) {
  if (!field) return null;
  return Object.prototype.hasOwnProperty.call(field, 'val') ? field.val : field;
}

function readAIFieldValue(field) {
  if (field === null || field === undefined) return null;
  if (Array.isArray(field)) return field;
  if (typeof field === 'object' && Object.prototype.hasOwnProperty.call(field, 'val')) return field.val;
  return field;
}

function normalizeEntryCandidate(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .replace(/^[：:\s#编号号-]+/, '')
    .replace(/[，,。；;、\s]+$/g, '')
    .toUpperCase()
    .replace(/\s+/g, '');
}

function collectEntryCandidates(aiData, info) {
  const candidates = [];
  const add = (value, source = '') => {
    if (Array.isArray(value)) {
      value.forEach(item => add(item, source));
      return;
    }
    const normalized = normalizeEntryCandidate(readAIFieldValue(value));
    if (normalized) candidates.push({ value: normalized, source });
  };

  add(info.warehouseEntryNo, 'field');
  add(info.entryNo, 'field');
  add(info.inboundNo, 'field');
  add(info.warehouseEntryNoCandidates, 'candidate');
  add(aiData.warehouseEntryNoCandidates, 'candidate');
  add(aiData.allVisibleCodes, 'visible');
  add(aiData.visibleCodes, 'visible');
  add(aiData.codes, 'visible');

  const textBlocks = [
    aiData.rawText,
    aiData.ocrText,
    aiData.fullText,
    aiData.text,
    JSON.stringify(aiData)
  ].filter(Boolean);
  const labelRegex = /(?:进仓(?:编号|单号)?|入仓(?:号|编号|单号)?|收货编号|仓库编号|仓编|NO\.?|No)[:：\s#-]*([A-Z0-9][A-Z0-9\-\/]{2,30})/gi;
  textBlocks.forEach(text => {
    let match;
    while ((match = labelRegex.exec(String(text))) !== null) {
      add(match[1], 'label');
    }
  });

  return candidates;
}

function pickWarehouseEntryNo(aiData, info, context = {}) {
  const excluded = new Set([
    context.waybillNo,
    context.pieces,
    context.weight,
    context.volume
  ].filter(v => v !== null && v !== undefined).map(v => normalizeEntryCandidate(v)));

  const seen = new Set();
  const candidates = collectEntryCandidates(aiData, info)
    .map(item => ({ ...item, value: normalizeEntryCandidate(item.value) }))
    .filter(item => {
      const value = item.value;
      if (!value || seen.has(value)) return false;
      seen.add(value);
      if (excluded.has(value)) return false;
      if (/^\d{2}MH[A-Z0-9]+$/.test(value)) return false;
      if (/^\d{4}[-/]?\d{1,2}[-/]?\d{1,2}$/.test(value)) return false;
      if (/^1[3-9]\d{9}$/.test(value)) return false;
      if (/^\d{1,3}(?:\.\d+)?(?:KG|KGS|CBM|CTNS|PACKAGE|PACKAGES|PCS)?$/i.test(value)) return false;
      if (!/\d/.test(value)) return false;
      return /^[A-Z0-9][A-Z0-9\-\/]{3,29}$/.test(value);
    });

  const scored = candidates.map(item => {
    let score = 0;
    if (item.source === 'field') score += 100;
    if (item.source === 'label') score += 80;
    if (item.source === 'candidate') score += 60;
    if (item.source === 'visible') score += 20;
    if (/^[A-Z]+\d{2}MH[A-Z0-9]+$/.test(item.value)) score += 30;
    if (/[A-Z]/.test(item.value) && /\d/.test(item.value)) score += 12;
    if (item.value.length >= 6 && item.value.length <= 16) score += 8;
    return { ...item, score };
  }).sort((a, b) => b.score - a.score);

  return scored[0]?.value || null;
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

  // 处理件数：分离数字和单位
  const piecesRaw = checkField(info.pieces, '件数');
  const piecesExtracted = extractNumberAndUnit(piecesRaw);

  // 处理重量：分离数字和单位
  const weightRaw = checkField(info.weight, '毛重');
  const weightExtracted = extractNumberAndUnit(weightRaw);

  // 处理体积：分离数字和单位
  const volumeRaw = checkField(info.volume, '体积');
  const volumeExtracted = extractNumberAndUnit(volumeRaw);

  const waybillFieldValue = checkField(info.waybillNo, '业务参与编号');
  const waybillResult = normalizeWaybillNo(waybillFieldValue).valid
    ? normalizeWaybillNo(waybillFieldValue)
    : pickWaybillNo(aiData, info);
  if (waybillResult.valid) {
    const waybillReviewIndex = reviewFields.indexOf('业务参与编号');
    if (waybillReviewIndex >= 0) reviewFields.splice(waybillReviewIndex, 1);
  } else if (!reviewFields.includes('业务参与编号')) {
    reviewFields.push('业务参与编号');
  }

  const directWarehouseEntryNo = readAIFieldValue(info.warehouseEntryNo) || readAIFieldValue(info.entryNo);
  const warehouseEntryNo = pickWarehouseEntryNo(aiData, info, {
    waybillNo: waybillResult.val,
    pieces: piecesExtracted.val || piecesRaw,
    weight: weightExtracted.val || weightRaw,
    volume: volumeExtracted.val || volumeRaw
  });

  if ((!directWarehouseEntryNo || info.warehouseEntryNo?.manualReview || info.entryNo?.manualReview) && !reviewFields.includes('进仓编号')) {
    reviewFields.push('进仓编号');
  }

  let cargoInfo = {
    warehouseEntryNo,
    waybillNo: waybillResult.val,
    pieces: piecesExtracted.val || piecesRaw,
    piecesUnit: info.pieces?.unit || piecesExtracted.unit || 'CTNS',
    grossWeight: weightExtracted.val || weightRaw,
    weightUnit: info.weight?.unit || weightExtracted.unit || 'KGS',
    volume: volumeExtracted.val || volumeRaw,
    volumeUnit: info.volume?.unit || volumeExtracted.unit || 'CBM',
    marks: checkField(info.marks, '唛头')
  };
  if (!cargoInfo.warehouseEntryNo && !reviewFields.includes('进仓编号')) {
    reviewFields.push('进仓编号');
  }

  // AI字段交叉校验：修复常见识别错误
  cargoInfo = validateAndFixFields(cargoInfo);

  // 处理routing字段，增加时间和数值逻辑校验
  const routingResult = {
    warehouseName: checkField(routing.warehouseName, '仓库名称'),
    warehouseAddress: checkField(routing.warehouseAddress, '仓库地址'),
    entryTime: checkField(routing.entryTime, '进仓时间'),
    departureTime: checkField(routing.departureTime, '预计开航'),
    destinationPort: checkField(routing.destinationPort, '目的港'),
    latestDeliveryTime: checkField(routing.latestDeliveryTime, '最晚进仓')
  };

  // 时间逻辑校验：开航时间必须在截仓时间之后
  const dtVal = routingResult.departureTime;
  const ldtVal = routingResult.latestDeliveryTime;
  if (dtVal && ldtVal) {
    const dtDate = new Date(dtVal);
    const ldtDate = new Date(ldtVal);
    if (!isNaN(dtDate.getTime()) && !isNaN(ldtDate.getTime())) {
      // 如果开航时间 <= 截仓时间，说明AI搞混了，两个都标记复核
      if (dtDate.getTime() <= ldtDate.getTime()) {
        reviewFields.push('预计开航');
        reviewFields.push('最晚进仓');
      }
    }
  }

  // 重量/体积合理性校验：防止搞混
  const weightNum = parseFloat(cargoInfo.grossWeight);
  const volumeNum = parseFloat(cargoInfo.volume);
  if (!isNaN(weightNum) && !isNaN(volumeNum)) {
    // 如果体积 > 重量，大概率搞混了（CBM不可能大于KG）
    if (volumeNum > weightNum) {
      reviewFields.push('重量');
      reviewFields.push('体积');
    }
    // 如果体积 > 100 且重量 < 体积，也可能搞混
    if (volumeNum > 100 && weightNum < volumeNum) {
      reviewFields.push('重量');
      reviewFields.push('体积');
    }
  }

  // 业务参与编号必须是两位年份+MH开头，不符合则清空，避免错误建单
  const waybillNoStr = cargoInfo.waybillNo ? String(cargoInfo.waybillNo) : '';
  if (waybillNoStr && !/^\d{2}MH[A-Z0-9]+$/.test(waybillNoStr)) {
    cargoInfo.waybillNo = null;
    reviewFields.push('业务参与编号');
  }

  // 去重reviewFields
  const uniqueReviewFields = [...new Set(reviewFields)];

  return {
    cargoInfo,
    routing: routingResult,
    contacts: {
      factoryName: checkField(contacts.factoryName, '工厂名称'),
      contactPerson: checkField(contacts.contactPerson, '联系人'),
      contactPhone: checkField(contacts.contactPhone, '联系电话')
    },
    handwritingDetected: aiData.handwritingDetected || false,
    reviewFields: uniqueReviewFields,
    pushSummary: aiData.pushSummary || '',
    raw: aiData
  };
}

/**
 * AI字段交叉校验 - 修复常见的AI识别错误
 * 规则：
 * 1. marks是纯数字且volume为空 → marks应为volume
 * 2. volume是文字且marks为空 → volume应为marks
 * 3. marks含CBM等单位 → 应归入volume
 * 4. waybillNo必须是两位年份+MH开头，否则清空并复核
 * 5. 防止把DSCGL、货号、客户编码、条码号误填为业务参与编号
 */
function validateAndFixFields(cargoInfo) {
  const isPureNumber = (v) => v !== null && v !== undefined && /^[\d.]+$/.test(String(v).trim());
  const isText = (v) => v !== null && v !== undefined && !/^[\d.]+$/.test(String(v).trim()) && String(v).trim().length > 0;

  // 1. marks是纯数字 → 应该是volume
  if (isPureNumber(cargoInfo.marks) && (!cargoInfo.volume || cargoInfo.volume === '0')) {
    cargoInfo.volume = cargoInfo.marks;
    cargoInfo.marks = null;
  }

  // 2. volume是文字（非数字）→ 应该是marks
  if (isText(cargoInfo.volume) && (!cargoInfo.marks || cargoInfo.marks === '')) {
    cargoInfo.marks = cargoInfo.volume;
    cargoInfo.volume = null;
  }

  // 3. marks像数字+单位（如6CBM）→ 分离后归入对应字段
  if (cargoInfo.marks) {
    const extracted = extractNumberAndUnit(cargoInfo.marks);
    const unit = extracted.unit?.toUpperCase();
    if (unit === 'CBM' && (!cargoInfo.volume || cargoInfo.volume === '0')) {
      cargoInfo.volume = extracted.val;
      cargoInfo.marks = null;
    }
  }

  // 4. volume像纯数字但没单位 → 补CBM
  if (isPureNumber(cargoInfo.volume) && !cargoInfo.volumeUnit) {
    cargoInfo.volumeUnit = 'CBM';
  }

  // 5. weight是文字但marks是纯数字+KG → 互换
  if (isText(cargoInfo.grossWeight) && cargoInfo.marks && /[\d.]+\s*KG[S]?/i.test(String(cargoInfo.marks))) {
    const extracted = extractNumberAndUnit(cargoInfo.marks);
    if (extracted.unit?.toUpperCase().startsWith('KG')) {
      cargoInfo.grossWeight = extracted.val;
      cargoInfo.weightUnit = extracted.unit;
      cargoInfo.marks = cargoInfo.grossWeight;
    }
  }

  return cargoInfo;
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
