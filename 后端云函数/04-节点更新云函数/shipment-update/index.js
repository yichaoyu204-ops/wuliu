/**
 * 节点更新云函数
 * 更新节点状态、添加费用、提交实测数据、管理报价单、标记支付
 *
 * action 列表：
 *   node        更新物流节点状态（已有）
 *   fee         追加附加费用（已有）
 *   measurement 仓库员提交实测数据+照片（新）
 *   quote       报价单操作：draft/send/confirm（新）
 *   billing     标记现结已收款（新）
 *
 * 安全设计：
 * - OPENID 从 WXContext 获取，前端无法伪造
 * - measurement/billing 仅限仓库员或管理员
 * - quote confirm 仅限有手机号绑定的客户端用户
 * - 金额统一精度处理
 */

const cloud = require('wx-server-sdk');
const { success, error, paramError } = require('./utils/response');
const { sendShipmentNotification, sendQuoteNotification } = require('./utils/notification');
const { formatMoney } = require('./utils/formatMoney');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 管理员和仓库员 OpenID（与 fee-config 保持同一份，MVP阶段写死）
const WAREHOUSE_OPENIDS = [
  // 'o-xxxxxxxxxxxxxxxxxxxxx',  // 仓库员 OpenID
];
const ADMIN_OPENIDS = [
  // 'o-xxxxxxxxxxxxxxxxxxxxx',  // 管理员 OpenID
];

function isWarehouseOrAdmin(openId) {
  if (!openId) return false;
  return WAREHOUSE_OPENIDS.includes(openId) || ADMIN_OPENIDS.includes(openId);
}

// ─────────────────────────────────────────
// 已有：更新物流节点
// ─────────────────────────────────────────
async function updateNode(shipmentId, updateData) {
  const { nodeCode, status, operator, phone, photos, remark } = updateData;

  const shipmentRes = await db.collection('shipments').doc(shipmentId).get();
  if (!shipmentRes.data) throw new Error('货物不存在');
  const shipment = shipmentRes.data;

  const routeSnapshot = shipment.routeSnapshot;
  if (!routeSnapshot) throw new Error('货物路线信息缺失');

  const nodeIndex = shipment.timeline.findIndex(n => n.nodeCode === nodeCode);
  if (nodeIndex === -1) throw new Error('节点不存在');

  const now = new Date().toISOString();
  const updateObj = {
    [`timeline.${nodeIndex}.status`]: status,
    [`timeline.${nodeIndex}.operator`]: operator || '',
    [`timeline.${nodeIndex}.phone`]: phone || '',
    [`timeline.${nodeIndex}.photos`]: photos || [],
    [`timeline.${nodeIndex}.remark`]: remark || '',
    [`timeline.${nodeIndex}.timestamp`]: now,
    updatedAt: now
  };

  let newNodeIndex = shipment.currentNodeIndex;
  let newNodeName = shipment.currentNodeName;

  if (status === 'completed') {
    newNodeIndex = Math.min(nodeIndex + 1, routeSnapshot.nodes.length - 1);
    newNodeName = routeSnapshot.nodes[newNodeIndex]?.name || '已完成';

    if (newNodeIndex > nodeIndex && newNodeIndex < routeSnapshot.nodes.length) {
      updateObj[`timeline.${newNodeIndex}.status`] = 'active';
      updateObj[`timeline.${newNodeIndex}.timestamp`] = now;
    }

    if (nodeIndex === routeSnapshot.nodes.length - 1) {
      updateObj.status = 'completed';
    }
  }

  updateObj.currentNodeIndex = newNodeIndex;
  updateObj.currentNodeName = newNodeName;

  await db.collection('shipments').doc(shipmentId).update({ data: updateObj });

  await db.collection('operation_logs').add({
    data: {
      shipmentId, operation: 'node_update', nodeCode,
      fromStatus: shipment.timeline[nodeIndex].status, toStatus: status,
      operator, details: { phone, photos: photos?.length || 0, remark },
      timestamp: now
    }
  });

  const notifyResult = await sendShipmentNotification(shipmentId, {
    nodeCode, nodeName: routeSnapshot.nodes[nodeIndex].name
  });

  return { nodeIndex, nodeCode, status, currentNodeIndex: newNodeIndex, currentNodeName: newNodeName, notification: notifyResult, timestamp: now };
}

// ─────────────────────────────────────────
// 已有：追加附加费用
// ─────────────────────────────────────────
async function addFee(shipmentId, feeData) {
  const { type, name, amount, reason } = feeData;
  const now = new Date().toISOString();

  const shipmentRes = await db.collection('shipments').doc(shipmentId).get();
  const currentFees = shipmentRes.data.fees || [];
  const currentTotal = shipmentRes.data.totalAmount || 0;

  const newFee = {
    type, name,
    amount: formatMoney(parseFloat(amount)),
    reason: reason || '',
    addedAt: now
  };

  const newTotal = formatMoney(currentTotal + newFee.amount);

  await db.collection('shipments').doc(shipmentId).update({
    data: { fees: _.push([newFee]), totalAmount: newTotal, updatedAt: now }
  });

  await db.collection('operation_logs').add({
    data: { shipmentId, operation: 'fee_add', details: newFee, timestamp: now }
  });

  return { fee: newFee, totalAmount: newTotal };
}

// ─────────────────────────────────────────
// 新增：提交仓库实测数据
// ─────────────────────────────────────────
async function submitMeasurement(shipmentId, data, operatorOpenId) {
  const { pieces, weight, volume, weightUnit, volumeUnit, photos, note } = data;

  if (!photos || photos.length === 0) throw new Error('请至少上传一张实测照片');
  if (volume == null || weight == null) throw new Error('实测重量和体积为必填项');

  const now = new Date().toISOString();

  await db.collection('shipments').doc(shipmentId).update({
    data: {
      'measurement.status': 'measured',
      'measurement.measuredAt': db.serverDate(),
      'measurement.measuredBy': operatorOpenId,
      'measurement.photos': photos,
      'measurement.actual': {
        pieces: pieces != null ? Number(pieces) : null,
        weight: formatMoney(weight),
        volume: formatMoney(volume),
        weightUnit: weightUnit || 'KGS',
        volumeUnit: volumeUnit || 'CBM'
      },
      'measurement.note': note || '',
      updatedAt: now
    }
  });

  // 如果当前处于 OA 流程的 factory_confirmed 状态，自动推进到 measured_priced
  const shipmentRes = await db.collection('shipments').doc(shipmentId).get();
  const shipment = shipmentRes.data;
  let oaAdvanced = false;

  if (shipment.oaStatus === 'created') {
    // 调用自动定价引擎（框架，后续接入真实规则）
    const pricing = calculatePricing(weight, volume, shipment.routeId);

    await db.collection('shipments').doc(shipmentId).update({
      data: {
        oaStatus: 'measured_priced',
        oaStatusName: '已实测定价，待管理员确认',
        oaAssignedTo: 'admin',
        pricing: {
          status: 'calculated',
          weightPrice: pricing.weightPrice,
          volumePrice: pricing.volumePrice,
          finalPrice: pricing.finalPrice,
          ruleUsed: pricing.ruleUsed,
          calculatedAt: db.serverDate(),
          calculatedBy: operatorOpenId
        },
        updatedAt: now
      }
    });

    await db.collection('operation_logs').add({
      data: {
        shipmentId, operation: 'oa_advance',
        details: { fromStatus: 'created', toStatus: 'measured_priced', pricing },
        operator: operatorOpenId, timestamp: now
      }
    });

    oaAdvanced = true;
  }

  await db.collection('operation_logs').add({
    data: {
      shipmentId, operation: 'measurement_submit',
      details: { pieces, weight, volume, photosCount: photos.length },
      operator: operatorOpenId, timestamp: now
    }
  });

  return {
    status: 'measured',
    actual: { pieces, weight: formatMoney(weight), volume: formatMoney(volume), weightUnit: weightUnit || 'KGS', volumeUnit: volumeUnit || 'CBM' },
    photosCount: photos.length,
    oaAdvanced
  };
}

// 自动定价引擎
// weightKg: 实测重量（公斤）
// volumeCbm: 实测体积（立方米）
// routeId: 路线ID，用于区分萌恒/北仑
function calculatePricing(weightKg, volumeCbm, routeId = '') {
  const isMengheng = (routeId || '').includes('mh');
  const weightTons = weightKg / 1000; // 公斤 → 吨
  const ratio = weightTons > 0 ? volumeCbm / weightTons : 0; // 每吨多少立方

  let weightPrice = 0;   // 按重量计算的价格
  let volumePrice = 0;   // 按体积计算的价格
  let finalPrice = 0;    // 最终运费
  let ruleUsed = '';     // 计费规则说明

  if (isMengheng) {
    if (ratio >= 4) {
      // 轻货：萌恒路线按体积 55元/立方
      volumePrice = formatMoney(volumeCbm * 55);
      finalPrice = volumePrice;
      ruleUsed = 'volume_based_light_mengheng';
    } else {
      // 重货：萌恒路线按重量 190元/吨
      weightPrice = formatMoney(weightTons * 190);
      finalPrice = weightPrice;
      ruleUsed = 'weight_based_heavy_mengheng';
    }
  } else {
    if (ratio >= 4) {
      // 轻货：北仑路线按体积 85元/立方
      volumePrice = formatMoney(volumeCbm * 85);
      finalPrice = volumePrice;
      ruleUsed = 'volume_based_light_beilun';
    } else {
      // 重货：北仑路线按重量 220元/吨
      weightPrice = formatMoney(weightTons * 220);
      finalPrice = weightPrice;
      ruleUsed = 'weight_based_heavy_beilun';
    }
  }

  return {
    weightPrice,
    volumePrice,
    finalPrice,
    ruleUsed
  };
}

// ─────────────────────────────────────────
// 新增：报价单操作
// subAction: draft（保存草稿）| send（发送给客户）| confirm（客户确认）
// ─────────────────────────────────────────
async function manageQuote(shipmentId, data, operatorOpenId) {
  const { subAction, items, note, paymentType, confirmedBy } = data;
  const now = new Date().toISOString();

  const shipmentRes = await db.collection('shipments').doc(shipmentId).get();
  if (!shipmentRes.data) throw new Error('货物不存在');
  const shipment = shipmentRes.data;

  switch (subAction) {
    case 'draft': {
      if (!items || items.length === 0) throw new Error('报价明细不能为空');

      const validatedItems = items.map(item => ({
        categoryId: item.categoryId || '',
        name: String(item.name || '').substring(0, 20),
        calculationDetail: String(item.calculationDetail || '').substring(0, 50),
        amount: formatMoney(item.amount),
        isIncluded: item.isIncluded !== false
      }));

      const subtotal = formatMoney(
        validatedItems.filter(i => i.isIncluded).reduce((sum, i) => sum + (i.amount || 0), 0)
      );

      await db.collection('shipments').doc(shipmentId).update({
        data: {
          'quote.status': 'draft',
          'quote.items': validatedItems,
          'quote.subtotal': subtotal,
          'quote.note': String(note || '').substring(0, 100),
          updatedAt: now
        }
      });

      return { status: 'draft', subtotal, itemCount: validatedItems.length };
    }

    case 'send': {
      const currentQuote = shipment.quote;
      if (!currentQuote || !currentQuote.items || currentQuote.items.length === 0) {
        throw new Error('请先保存报价草稿再发送');
      }

      const updateData = {
        'quote.status': 'sent',
        'quote.sentAt': db.serverDate(),
        'quote.sentTo': [shipment.managerPhone],
        updatedAt: now
      };
      if (currentQuote.subtotal) {
        updateData.totalAmount = currentQuote.subtotal;
      }

      await db.collection('shipments').doc(shipmentId).update({ data: updateData });

      const notifyResult = await sendQuoteNotification(shipmentId, currentQuote.subtotal);

      await db.collection('operation_logs').add({
        data: { shipmentId, operation: 'quote_sent', details: { subtotal: currentQuote.subtotal }, operator: operatorOpenId, timestamp: now }
      });

      return { status: 'sent', subtotal: currentQuote.subtotal, notification: notifyResult };
    }

    case 'confirm': {
      if (!['spot', 'monthly'].includes(paymentType)) throw new Error('请选择支付方式');

      const currentQuote = shipment.quote;
      if (currentQuote?.status !== 'sent') throw new Error('报价单状态不正确，无法确认');

      // 用事务保证：确认报价 + 创建账单 原子性
      const confirmedById = confirmedBy || operatorOpenId;
      const billResult = await db.runTransaction(async transaction => {
        // 1. 更新 shipment 为已确认
        await transaction.collection('shipments').doc(shipmentId).update({
          data: {
            'quote.status': 'confirmed',
            'quote.confirmedAt': db.serverDate(),
            'quote.confirmedBy': confirmedById,
            'billing.paymentType': paymentType,
            'billing.paymentStatus': 'unpaid',
            updatedAt: now
          }
        });

        // 2. 生成账单
        const billId = await generateBillId(transaction);
        const billDoc = {
          _id: billId,
          billType: paymentType === 'spot' ? 'spot' : 'monthly',
          shipmentId: shipmentId,
          clientPhone: shipment.managerPhone || '',
          clientName: shipment.clientName || '',
          factoryName: shipment.factoryName || '',
          totalAmount: currentQuote.subtotal || 0,
          paidAmount: 0,
          status: 'unpaid',
          paymentType: paymentType,
          items: currentQuote.items || [],
          payments: [],
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        };
        await transaction.collection('bills').add({ data: billDoc });

        // 3. 回写 billId 到 shipment
        await transaction.collection('shipments').doc(shipmentId).update({
          data: { 'billing.billId': billId }
        });

        return { billId, billDoc };
      });

      await db.collection('operation_logs').add({
        data: {
          shipmentId, operation: 'quote_confirmed',
          details: { paymentType, confirmedBy: confirmedById, billId: billResult.billId },
          timestamp: now
        }
      });

      return {
        status: 'confirmed',
        paymentType,
        totalAmount: currentQuote.subtotal,
        billId: billResult.billId,
        message: paymentType === 'spot' ? '现结：等待仓库员确认收款' : '月结：账单已归入您的账户'
      };
    }

    default:
      throw new Error('未知的 subAction，支持：draft / send / confirm');
  }
}

// 生成账单号：BILL-年月日-时间戳随机数（避免并发重复）
async function generateBillId(transaction) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const prefix = `BILL-${y}${m}${d}-`;
  const ts = Date.now().toString().slice(-6);
  const random = Math.floor(100 + Math.random() * 900);
  return prefix + ts + random;
}

// ─────────────────────────────────────────
// 新增：仓库员标记现结已收款
// ─────────────────────────────────────────
async function markSpotPaid(shipmentId, data, operatorOpenId) {
  const { paidAmount, note } = data;

  const shipmentRes = await db.collection('shipments').doc(shipmentId).get();
  if (!shipmentRes.data) throw new Error('货物不存在');
  const shipment = shipmentRes.data;

  if (shipment.billing?.paymentType !== 'spot') throw new Error('此票货不是现结方式');
  if (shipment.quote?.status !== 'confirmed') throw new Error('客户尚未确认报价，无法标记收款');
  if (shipment.billing?.paymentStatus === 'paid') throw new Error('此票货已标记为已付，请勿重复操作');

  const amount = formatMoney(paidAmount || shipment.totalAmount);
  const now = new Date().toISOString();

  await db.collection('shipments').doc(shipmentId).update({
    data: {
      'billing.paymentStatus': 'paid',
      'billing.paidAt': db.serverDate(),
      'billing.paidBy': operatorOpenId,
      'billing.paidAmount': amount,
      updatedAt: now
    }
  });

  await db.collection('operation_logs').add({
    data: {
      shipmentId, operation: 'spot_paid',
      details: { paidAmount: amount, note: note || '义乌仓现收' },
      operator: operatorOpenId, timestamp: now
    }
  });

  return { paymentStatus: 'paid', paidAmount: amount, paidAt: now };
}

// ─────────────────────────────────────────
// 司机/仓管员：推进到下一个节点
async function advanceNode(shipmentId, operatorOpenId) {
  const shipmentRes = await db.collection('shipments').doc(shipmentId).get();
  if (!shipmentRes.data) throw new Error('货物不存在');
  const shipment = shipmentRes.data;

  const timeline = shipment.timeline || [];
  const currentIndex = timeline.findIndex(n => n.status === 'active');
  if (currentIndex === -1) throw new Error('没有进行中的节点');

  const now = new Date().toISOString();
  const updates = {};

  // 标记当前节点完成
  updates[`timeline.${currentIndex}.status`] = 'completed';
  updates[`timeline.${currentIndex}.timestamp`] = now;
  updates[`timeline.${currentIndex}.operator`] = operatorOpenId;

  let newNodeIndex = currentIndex;
  let newNodeName = timeline[currentIndex].nodeName;
  let nextNodeName = null;

  // 激活下一个节点
  if (currentIndex < timeline.length - 1) {
    newNodeIndex = currentIndex + 1;
    newNodeName = timeline[newNodeIndex].nodeName;
    nextNodeName = newNodeName;
    updates[`timeline.${newNodeIndex}.status`] = 'active';
    updates[`timeline.${newNodeIndex}.timestamp`] = now;
  } else {
    updates.status = 'completed';
  }

  updates.currentNodeIndex = newNodeIndex;
  updates.currentNodeName = newNodeName;
  updates.updatedAt = now;

  await db.collection('shipments').doc(shipmentId).update({ data: updates });

  await db.collection('operation_logs').add({
    data: {
      shipmentId, operation: 'node_advance',
      details: { fromNode: timeline[currentIndex].nodeName, toNode: nextNodeName },
      operator: operatorOpenId, timestamp: now
    }
  });

  return { fromNode: timeline[currentIndex].nodeName, toNode: nextNodeName, currentNodeName: newNodeName };
}

// ─────────────────────────────────────────
// OA 审批流：推进流程
// ─────────────────────────────────────────
async function advanceOa(shipmentId, data, operatorOpenId) {
  const { oaAction } = data;

  const shipmentRes = await db.collection('shipments').doc(shipmentId).get();
  if (!shipmentRes.data) throw new Error('货物不存在');
  const shipment = shipmentRes.data;

  const now = new Date().toISOString();
  const oaHistoryEntry = (status, statusName, role) => ({
    status,
    statusName,
    operator: operatorOpenId,
    role,
    timestamp: db.serverDate()
  });

  switch (oaAction) {
    // 1. 管理员确认价格
    case 'adminConfirm': {
      if (shipment.oaStatus !== 'measured_priced') throw new Error('当前状态不支持管理员确认');

      await db.collection('shipments').doc(shipmentId).update({
        data: {
          oaStatus: 'admin_confirmed',
          oaStatusName: '管理员已确认，待送达',
          oaAssignedTo: 'warehouse',
          oaHistory: _.push([oaHistoryEntry('admin_confirmed', '管理员已确认，待送达', 'admin')]),
          updatedAt: now
        }
      });
      return { oaStatus: 'admin_confirmed', oaStatusName: '管理员已确认，待送达' };
    }

    // 3. 标记现结已收款（仓管在送达前标记）
    case 'markSpotPaid': {
      if (shipment.oaStatus !== 'admin_confirmed') throw new Error('当前状态不支持标记收款');
      if (shipment.billing?.paymentType !== 'spot') throw new Error('仅现结货物可标记收款');
      if (shipment.billing?.paymentStatus === 'paid') throw new Error('已标记收款，请勿重复操作');

      const amount = shipment.pricing?.finalPrice || shipment.totalAmount || 0;

      await db.collection('shipments').doc(shipmentId).update({
        data: {
          'billing.paymentStatus': 'paid',
          'billing.paidAt': db.serverDate(),
          'billing.paidBy': operatorOpenId,
          'billing.paidAmount': formatMoney(amount),
          updatedAt: now
        }
      });

      await db.collection('operation_logs').add({
        data: {
          shipmentId, operation: 'spot_paid_oa',
          details: { paidAmount: formatMoney(amount) },
          operator: operatorOpenId, timestamp: now
        }
      });

      return { paymentStatus: 'paid', paidAmount: formatMoney(amount) };
    }

    // 2. 仓管确认送达
    case 'markDelivered': {
      if (shipment.oaStatus !== 'admin_confirmed') throw new Error('当前状态不支持确认送达');

      const isSpot = shipment.billing?.paymentType === 'spot';

      // 现结必须已收款
      if (isSpot && shipment.billing?.paymentStatus !== 'paid') {
        throw new Error('请先标记现结收款后再确认送达');
      }

      if (isSpot) {
        // 现结：直接完成
        await db.collection('shipments').doc(shipmentId).update({
          data: {
            oaStatus: 'completed',
            oaStatusName: '流程已结',
            oaAssignedTo: '',
            oaHistory: _.push([oaHistoryEntry('completed', '流程已结', 'warehouse')]),
            status: 'completed',
            updatedAt: now
          }
        });
        return { oaStatus: 'completed', oaStatusName: '流程已结' };
      } else {
        // 月结：仓管员确认送达时直接完成，并创建月结账单
        const billAmount = shipment.pricing?.finalPrice || shipment.totalAmount || 0;
        const billId = await generateBillId(null);

        await db.runTransaction(async transaction => {
          await transaction.collection('shipments').doc(shipmentId).update({
            data: {
              oaStatus: 'completed',
              oaStatusName: '流程已结',
              oaAssignedTo: '',
              'billing.paymentStatus': 'unpaid',
              'billing.billId': billId,
              'billing.monthlyBatch': generateMonthlyBatch(),
              oaHistory: _.push([oaHistoryEntry('completed', '流程已结', 'warehouse')]),
              status: 'completed',
              updatedAt: now
            }
          });

          // 创建月结账单
          const billDoc = {
            _id: billId,
            billType: 'monthly',
            shipmentId: shipmentId,
            clientPhone: shipment.managerPhone || '',
            clientName: shipment.clientName || '',
            factoryName: shipment.factoryName || '',
            totalAmount: billAmount,
            paidAmount: 0,
            status: 'unpaid',
            paymentType: 'monthly',
            items: shipment.pricing ? [{
              name: '运费',
              calculationDetail: `重量价:${shipment.pricing.weightPrice} / 体积价:${shipment.pricing.volumePrice}`,
              amount: billAmount
            }] : [],
            payments: [],
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          };
          await transaction.collection('bills').add({ data: billDoc });
        });

        return { oaStatus: 'completed', oaStatusName: '流程已结', billId };
      }
    }

    default:
      throw new Error('未知的 oaAction，支持：adminConfirm / markSpotPaid / markDelivered');
  }
}

function generateMonthlyBatch() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `MONTHLY-${y}${m}`;
}

// 云函数入口
// ─────────────────────────────────────────
exports.main = async (event, context) => {
  const { action, shipmentId, data } = event;
  const { OPENID } = cloud.getWXContext();

  try {
    switch (action) {
      case 'node':
        if (!shipmentId) return paramError('缺少 shipmentId 参数');
        if (!data) return paramError('缺少 data 参数');
        return success(await updateNode(shipmentId, data), '节点更新成功');

      case 'advanceNode':
        if (!shipmentId) return paramError('缺少 shipmentId 参数');
        return success(await advanceNode(shipmentId, OPENID), '节点推进成功');

      case 'fee':
        if (!shipmentId) return paramError('缺少 shipmentId 参数');
        if (!data) return paramError('缺少 data 参数');
        return success(await addFee(shipmentId, data), '费用添加成功');

      case 'measurement':
        if (!shipmentId) return paramError('缺少 shipmentId 参数');
        if (!data) return paramError('缺少 data 参数');
        if (!isWarehouseOrAdmin(OPENID)) return error('权限不足：仅仓库员或管理员可提交实测数据');
        return success(await submitMeasurement(shipmentId, data, OPENID), '实测数据已提交');

      case 'quote':
        if (!shipmentId) return paramError('缺少 shipmentId 参数');
        if (!data) return paramError('缺少 data 参数');
        return success(await manageQuote(shipmentId, data, OPENID), '报价操作成功');

      case 'billing':
        if (!shipmentId) return paramError('缺少 shipmentId 参数');
        if (!data) return paramError('缺少 data 参数');
        if (data.subAction === 'markSpotPaid') {
          if (!isWarehouseOrAdmin(OPENID)) return error('权限不足：仅仓库员或管理员可标记收款');
          return success(await markSpotPaid(shipmentId, data, OPENID), '已标记现结收款');
        }
        return paramError('未知的 billing subAction');

      case 'advanceOa':
        if (!shipmentId) return paramError('缺少 shipmentId 参数');
        if (!data) return paramError('缺少 data 参数');
        if (!data.oaAction) return paramError('缺少 oaAction 参数');
        // 权限校验：adminConfirm 仅限管理员
        if (data.oaAction === 'adminConfirm' && !isWarehouseOrAdmin(OPENID)) {
          return error('权限不足：仅管理员可确认价格');
        }
        // markSpotPaid / markDelivered 仅限仓库员或管理员
        if (['markSpotPaid', 'markDelivered'].includes(data.oaAction) && !isWarehouseOrAdmin(OPENID)) {
          return error('权限不足：仅仓库员或管理员可操作');
        }
        return success(await advanceOa(shipmentId, data, OPENID), '流程推进成功');

      default:
        return paramError('未知的 action，支持：node / advanceNode / fee / measurement / quote / billing');
    }
  } catch (err) {
    console.error('[shipment-update]', action, err.message);
    return error(err.message);
  }
};
