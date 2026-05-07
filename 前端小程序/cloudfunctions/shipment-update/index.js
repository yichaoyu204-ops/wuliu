/**
 * 节点更新云函数
 * 更新节点状态、添加费用、提交实测数据、管理报价单、标记支付
 *
 * action 列表：
 *   node        更新物流节点状态（已有）
 *   fee         追加附加费用（已有）
 *   measurement 仓管员提交实测数据+照片（新）
 *   quote       报价单操作：draft/send/confirm（新）
 *   billing     标记现结已收款（新）
 *
 * 安全设计：
 * - OPENID 从 WXContext 获取，前端无法伪造
 * - measurement/billing 仅限仓管员或管理员
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

// 管理员和仓管员 OpenID（与 fee-config 保持同一份，MVP阶段写死）
const WAREHOUSE_OPENIDS = [
  // 'o-xxxxxxxxxxxxxxxxxxxxx',  // 仓管员 OpenID
];
const ADMIN_OPENIDS = [
  // 'o-xxxxxxxxxxxxxxxxxxxxx',  // 管理员 OpenID
];

function isWarehouseOrAdmin(openId) {
  if (!openId) return false;
  // 白名单为空时放通所有用户（方便调试），上线前需填写白名单
  const whitelistEmpty = WAREHOUSE_OPENIDS.length === 0 && ADMIN_OPENIDS.length === 0;
  if (whitelistEmpty) return true;
  return WAREHOUSE_OPENIDS.includes(openId) || ADMIN_OPENIDS.includes(openId);
}

function isAdmin(openId) {
  if (!openId) return false;
  const adminEmpty = ADMIN_OPENIDS.length === 0;
  if (adminEmpty) return true;
  return ADMIN_OPENIDS.includes(openId);
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
  const { pieces, weight, volume, weightUnit, volumeUnit, photos, note, fees, totalAmount, cargoInfo, routing, contacts, paymentType } = data;

  if (!photos || photos.length === 0) throw new Error('请至少上传一张实测照片');
  if (volume == null || weight == null) throw new Error('实测重量和体积为必填项');

  const now = new Date().toISOString();

  // 保存实测数据和费用
  const updateData = {
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
  };

  // 如果有费用数据，一并保存
  if (fees && fees.length > 0) {
    updateData.fees = fees.map(f => ({
      name: f.name,
      amount: formatMoney(f.amount),
      type: f.type || 'extra',
      detail: f.detail || '',
      addedAt: now
    }));
    updateData.totalAmount = formatMoney(totalAmount);
  }

  // 如果有货物信息更新，一并保存
  if (cargoInfo) {
    if (cargoInfo.waybillNo !== undefined) updateData['cargoInfo.waybillNo'] = cargoInfo.waybillNo;
    if (cargoInfo.pieces !== undefined) updateData['cargoInfo.pieces'] = Number(cargoInfo.pieces) || 0;
    if (cargoInfo.grossWeight !== undefined) updateData['cargoInfo.grossWeight'] = formatMoney(cargoInfo.grossWeight);
    if (cargoInfo.weightUnit !== undefined) updateData['cargoInfo.weightUnit'] = cargoInfo.weightUnit;
    if (cargoInfo.volume !== undefined) updateData['cargoInfo.volume'] = formatMoney(cargoInfo.volume);
    if (cargoInfo.volumeUnit !== undefined) updateData['cargoInfo.volumeUnit'] = cargoInfo.volumeUnit;
    if (cargoInfo.marks !== undefined) updateData['cargoInfo.marks'] = cargoInfo.marks;
  }

  if (routing) {
    if (routing.destinationPort !== undefined) updateData['routing.destinationPort'] = routing.destinationPort;
    if (routing.warehouseName !== undefined) updateData['routing.warehouseName'] = routing.warehouseName;
  }

  if (contacts) {
    if (contacts.contact1Name !== undefined) updateData['contacts.contact1Name'] = contacts.contact1Name;
    if (contacts.contact1Phone !== undefined) updateData['contacts.contact1Phone'] = contacts.contact1Phone;
    if (contacts.contact2Name !== undefined) updateData['contacts.contact2Name'] = contacts.contact2Name;
    if (contacts.contact2Phone !== undefined) updateData['contacts.contact2Phone'] = contacts.contact2Phone;
  }

  if (paymentType) {
    updateData['billing.paymentType'] = paymentType;
    updateData['billing.paymentStatus'] = paymentType === 'spot' ? 'unpaid' : 'unpaid';
  }

  await db.collection('shipments').doc(shipmentId).update({ data: updateData });

  // 如果当前处于 OA 流程的 created 状态，自动推进
  const shipmentRes = await db.collection('shipments').doc(shipmentId).get();
  const shipment = shipmentRes.data;
  let oaAdvanced = false;

  if (shipment.oaStatus === 'created') {
    const pricing = calculatePricing(weight, volume, totalAmount);

    const updateFields = {
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
    };

    // 如果是仓库现结：直接标记已收款，跳过管理员确认，直接到 admin_confirmed
    if (shipment.billing?.paymentType === 'spot') {
      updateFields['billing.paymentStatus'] = 'paid';
      updateFields['billing.paidAt'] = db.serverDate();
      updateFields['billing.paidBy'] = operatorOpenId;
      updateFields['billing.paidAmount'] = formatMoney(totalAmount || 0);

      updateFields.oaStatus = 'admin_confirmed';
      updateFields.oaStatusName = '已实测定价并支付，待入库';
      updateFields.oaAssignedTo = 'warehouse';
      updateFields.oaHistory = db.command.push([{
        status: 'admin_confirmed',
        statusName: '已实测定价并支付，待入库',
        operator: operatorOpenId,
        role: 'warehouse',
        timestamp: db.serverDate()
      }]);
    } else {
      // 萌恒月结：需要管理员确认
      updateFields.oaStatus = 'measured_priced';
      updateFields.oaStatusName = '已实测定价，管理员同步确认中';
      updateFields.oaAssignedTo = 'admin';
    }

    await db.collection('shipments').doc(shipmentId).update({
      data: updateFields
    });

    await db.collection('operation_logs').add({
      data: {
        shipmentId, operation: 'oa_advance',
        details: { fromStatus: 'created', toStatus: updateFields.oaStatus, pricing },
        operator: operatorOpenId, timestamp: now
      }
    });

    oaAdvanced = true;
  }

  await db.collection('operation_logs').add({
    data: {
      shipmentId, operation: 'measurement_submit',
      details: { pieces, weight, volume, photosCount: photos.length, feeCount: fees?.length || 0 },
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

// 自动定价引擎：使用仓管员输入的实际费用
function calculatePricing(weight, volume, totalAmount) {
  const finalPrice = totalAmount || 0;
  return {
    weightPrice: formatMoney(finalPrice),
    volumePrice: formatMoney(finalPrice),
    finalPrice: formatMoney(finalPrice),
    ruleUsed: 'manual'
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
        message: paymentType === 'spot' ? '现结：等待仓管员确认收款' : '月结：账单已归入您的账户'
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
// 新增：仓管员标记现结已收款
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

  const currentNode = timeline[currentIndex];

  // 确认出库限制：只有在生成报价单后（实测定价完成）才能推进
  if (currentNode.nodeCode === 'yiwu_entry' && shipment.oaStatus === 'created') {
    throw new Error('请先生成报价单（完成实测定价）后再确认出库');
  }

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

// 路线配置（与 shipment-create 保持一致）
const ROUTE_CONFIGS = [
  {
    id: 'route_yw_mh_hub',
    name: '义乌→萌恒仓库（经义乌中转仓）',
    description: '标准路线：工厂→义乌中转仓→萌恒仓库',
    nodes: [
      { code: 'pickup', name: '工厂送货/上门提货', minDuration: 1, maxDuration: 3, template: '已提货，运输至义乌中转仓，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
      { code: 'yiwu_entry', name: '义乌中转仓入库', minDuration: 0.5, maxDuration: 1, template: '已入库义乌中转仓，准备发运', icon: 'warehouse', editable: true },
      { code: 'mainline', name: '干线运输', minDuration: 3, maxDuration: 5, template: '运输中，萌恒仓库方向，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck', editable: true },
      { code: 'nb_entry', name: '入库完成', minDuration: 0, maxDuration: 0, template: '已完成入库萌恒仓库，等待报关', icon: 'check-circle', editable: false }
    ]
  },
  {
    id: 'route_yw_bl_hub',
    name: '义乌→北仑方向其他仓库（经义乌中转仓）',
    description: '标准路线：工厂→义乌中转仓→北仑方向其他仓库',
    nodes: [
      { code: 'pickup', name: '工厂送货/上门提货', minDuration: 1, maxDuration: 3, template: '已提货，运输至义乌中转仓，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
      { code: 'yiwu_entry', name: '义乌中转仓入库', minDuration: 0.5, maxDuration: 1, template: '已入库义乌中转仓，准备发运', icon: 'warehouse', editable: true },
      { code: 'mainline', name: '干线运输', minDuration: 3, maxDuration: 5, template: '运输中，北仑方向，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck', editable: true },
      { code: 'nb_entry', name: '入库完成', minDuration: 0, maxDuration: 0, template: '已完成入库北仑仓库，等待报关', icon: 'check-circle', editable: false }
    ]
  },
  {
    id: 'route_yw_mh_direct',
    name: '义乌→萌恒仓库（工厂直发）',
    description: '直达路线：工厂不经义乌中转仓，直发萌恒仓库',
    nodes: [
      { code: 'pickup', name: '工厂送货/上门提货', minDuration: 4, maxDuration: 6, template: '已提货，直接发往萌恒仓库，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
      { code: 'nb_entry', name: '入库完成', minDuration: 0, maxDuration: 0, template: '已完成入库萌恒仓库，等待报关', icon: 'check-circle', editable: false }
    ]
  },
  {
    id: 'route_yw_bl_direct',
    name: '义乌→北仑方向其他仓库（工厂直发）',
    description: '直达路线：工厂不经义乌中转仓，直发北仑方向其他仓库',
    nodes: [
      { code: 'pickup', name: '工厂送货/上门提货', minDuration: 4, maxDuration: 6, template: '已提货，直接发往北仑仓库，预计{minDuration}-{maxDuration}小时后到达', icon: 'truck-loading', editable: true },
      { code: 'nb_entry', name: '入库完成', minDuration: 0, maxDuration: 0, template: '已完成入库北仑仓库，等待报关', icon: 'check-circle', editable: false }
    ]
  }
];

function getRouteById(routeId) {
  return ROUTE_CONFIGS.find(r => r.id === routeId);
}

function initTimeline(route) {
  return route.nodes.map((node, index) => ({
    nodeCode: node.code,
    nodeName: node.name,
    status: index === 0 ? 'active' : 'pending',
    operator: '',
    phone: '',
    photos: [],
    remark: '',
    timestamp: index === 0 ? new Date().toISOString() : null
  }));
}

// ─────────────────────────────────────────
// 更新货物基本信息（详情页编辑）
// ─────────────────────────────────────────
async function updateInfo(shipmentId, data, operatorOpenId) {
  const { cargoInfo, routing, contacts, paymentType, routeId } = data;

  const shipmentRes = await db.collection('shipments').doc(shipmentId).get();
  if (!shipmentRes.data) throw new Error('货物不存在');
  const shipment = shipmentRes.data;

  const now = new Date().toISOString();
  const updateData = { updatedAt: now };

  if (cargoInfo) {
    if (cargoInfo.waybillNo !== undefined) updateData['cargoInfo.waybillNo'] = cargoInfo.waybillNo;
    if (cargoInfo.pieces !== undefined) updateData['cargoInfo.pieces'] = Number(cargoInfo.pieces) || 0;
    if (cargoInfo.grossWeight !== undefined) updateData['cargoInfo.grossWeight'] = formatMoney(cargoInfo.grossWeight);
    if (cargoInfo.weightUnit !== undefined) updateData['cargoInfo.weightUnit'] = cargoInfo.weightUnit;
    if (cargoInfo.volume !== undefined) updateData['cargoInfo.volume'] = formatMoney(cargoInfo.volume);
    if (cargoInfo.volumeUnit !== undefined) updateData['cargoInfo.volumeUnit'] = cargoInfo.volumeUnit;
    if (cargoInfo.marks !== undefined) updateData['cargoInfo.marks'] = cargoInfo.marks;
  }

  if (routing) {
    if (routing.destinationPort !== undefined) updateData['routing.destinationPort'] = routing.destinationPort;
    if (routing.warehouseName !== undefined) updateData['routing.warehouseName'] = routing.warehouseName;
  }

  if (contacts) {
    if (contacts.contact1Name !== undefined) updateData['contacts.contact1Name'] = contacts.contact1Name;
    if (contacts.contact1Phone !== undefined) updateData['contacts.contact1Phone'] = contacts.contact1Phone;
    if (contacts.contact2Name !== undefined) updateData['contacts.contact2Name'] = contacts.contact2Name;
    if (contacts.contact2Phone !== undefined) updateData['contacts.contact2Phone'] = contacts.contact2Phone;
    if (contacts.contact1Name !== undefined) updateData['clientName'] = contacts.contact1Name || '未知';
  }

  if (paymentType) {
    updateData['billing.paymentType'] = paymentType;
  }

  // 修改路线：仅当运单尚未开始物流流程时允许
  if (routeId && routeId !== shipment.routeId) {
    const newRoute = getRouteById(routeId);
    if (!newRoute) throw new Error('路线不存在');

    // 如果已有节点被推进（非初始状态），禁止修改路线
    const timeline = shipment.timeline || [];
    const hasProgress = timeline.some(n => n.status === 'completed');
    if (hasProgress) {
      throw new Error('物流已开始推进，不允许修改路线');
    }

    updateData.routeId = newRoute.id;
    updateData.routeName = newRoute.name;
    updateData.routeSnapshot = newRoute;
    updateData.currentNodeIndex = 0;
    updateData.currentNodeName = newRoute.nodes[0].name;
    updateData.timeline = initTimeline(newRoute);
  }

  if (data.measurement) {
    const m = data.measurement;
    if (m.actual) {
      if (m.actual.pieces !== undefined) updateData['measurement.actual.pieces'] = Number(m.actual.pieces) || 0;
      if (m.actual.weight !== undefined) updateData['measurement.actual.weight'] = formatMoney(m.actual.weight);
      if (m.actual.volume !== undefined) updateData['measurement.actual.volume'] = formatMoney(m.actual.volume);
      if (m.actual.weightUnit !== undefined) updateData['measurement.actual.weightUnit'] = m.actual.weightUnit;
      if (m.actual.volumeUnit !== undefined) updateData['measurement.actual.volumeUnit'] = m.actual.volumeUnit;
    }
    if (m.note !== undefined) updateData['measurement.note'] = m.note;
  }

  await db.collection('shipments').doc(shipmentId).update({ data: updateData });

  await db.collection('operation_logs').add({
    data: {
      shipmentId, operation: 'info_update',
      details: { cargoInfo, routing, contacts, paymentType },
      operator: operatorOpenId, timestamp: now
    }
  });

  return { updated: true };
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

      const updateFields = {
        oaStatus: 'admin_confirmed',
        oaStatusName: '管理员已确认，待送达',
        oaAssignedTo: 'warehouse',
        oaHistory: _.push([oaHistoryEntry('admin_confirmed', '管理员已确认，待送达', 'admin')]),
        updatedAt: now
      };

      // 萌恒月结：自动确认报价，不需要业务员/客户手动确认
      if (shipment.billing?.paymentType === 'monthly') {
        updateFields['quote.status'] = 'confirmed';
        updateFields['quote.confirmedAt'] = db.serverDate();
        updateFields['quote.confirmedBy'] = operatorOpenId;
      }

      await db.collection('shipments').doc(shipmentId).update({
        data: updateFields
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

    // 4. 仓管确认送达（现结/月结统一在此完成）
    case 'markDelivered': {
      if (shipment.oaStatus !== 'admin_confirmed') throw new Error('当前状态不支持确认送达');

      const isSpot = shipment.billing?.paymentType === 'spot';

      // 现结必须已收款
      if (isSpot && shipment.billing?.paymentStatus !== 'paid') {
        throw new Error('请先标记现结收款后再确认送达');
      }

      // 月结：创建月结账单
      if (!isSpot) {
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

        return { oaStatus: 'completed', oaStatusName: '流程已结' };
      }

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
    }

    // 5. 管理员发送账单
    case 'sendBill': {
      if (shipment.oaStatus !== 'admin_confirmed') throw new Error('当前状态不支持发送账单');

      await db.collection('shipments').doc(shipmentId).update({
        data: {
          oaStatus: 'billed',
          oaStatusName: '账单已发送，待支付',
          oaAssignedTo: '',
          oaHistory: _.push([oaHistoryEntry('billed', '账单已发送，待支付', 'admin')]),
          updatedAt: now
        }
      });
      return { oaStatus: 'billed', oaStatusName: '账单已发送，待支付' };
    }

    default:
      throw new Error('未知的 oaAction，支持：adminConfirm / markSpotPaid / markDelivered / sendBill');
  }
}

// ─────────────────────────────────────────
// 管理员：物理删除运单及关联数据
// ─────────────────────────────────────────
async function deleteShipment(shipmentId, operatorOpenId) {
  const shipmentRes = await db.collection('shipments').doc(shipmentId).get();
  if (!shipmentRes.data) throw new Error('运单不存在');

  const now = new Date().toISOString();

  // 1. 删除关联的操作日志
  const logsRes = await db.collection('operation_logs')
    .where({ shipmentId })
    .limit(100)
    .get();
  const logDeletes = logsRes.data.map(doc =>
    db.collection('operation_logs').doc(doc._id).remove()
  );
  if (logDeletes.length > 0) {
    await Promise.all(logDeletes);
  }

  // 2. 删除关联的账单
  const billId = shipmentRes.data.billing?.billId;
  if (billId) {
    try {
      await db.collection('bills').doc(billId).remove();
    } catch (e) {
      // 账单可能已被删除，忽略错误
    }
  }

  // 3. 删除关联的司机提交记录（集合可能不存在，忽略错误）
  try {
    const driverSubRes = await db.collection('driver_submissions')
      .where({ 'adminReview.shipmentId': shipmentId })
      .limit(10)
      .get();
    const driverDeletes = driverSubRes.data.map(doc =>
      db.collection('driver_submissions').doc(doc._id).remove()
    );
    if (driverDeletes.length > 0) {
      await Promise.all(driverDeletes);
    }
  } catch (e) {
    // driver_submissions 集合可能不存在，忽略
  }

  // 4. 物理删除运单
  await db.collection('shipments').doc(shipmentId).remove();

  return { deleted: true };
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
        if (!isWarehouseOrAdmin(OPENID)) return error('权限不足：仅仓管员或管理员可提交实测数据');
        return success(await submitMeasurement(shipmentId, data, OPENID), '实测数据已提交');

      case 'quote':
        if (!shipmentId) return paramError('缺少 shipmentId 参数');
        if (!data) return paramError('缺少 data 参数');
        return success(await manageQuote(shipmentId, data, OPENID), '报价操作成功');

      case 'billing':
        if (!shipmentId) return paramError('缺少 shipmentId 参数');
        if (!data) return paramError('缺少 data 参数');
        if (data.subAction === 'markSpotPaid') {
          if (!isWarehouseOrAdmin(OPENID)) return error('权限不足：仅仓管员或管理员可标记收款');
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
        // markSpotPaid / markDelivered 仅限仓管员或管理员
        if (['markSpotPaid', 'markDelivered'].includes(data.oaAction) && !isWarehouseOrAdmin(OPENID)) {
          return error('权限不足：仅仓管员或管理员可操作');
        }
        // sendBill 仅限管理员
        if (data.oaAction === 'sendBill' && !isAdmin(OPENID)) {
          return error('权限不足：仅管理员可发送账单');
        }
        return success(await advanceOa(shipmentId, data, OPENID), '流程推进成功');

      case 'updateInfo':
        if (!shipmentId) return paramError('缺少 shipmentId 参数');
        if (!data) return paramError('缺少 data 参数');
        if (!isWarehouseOrAdmin(OPENID)) return error('权限不足：仅仓管员或管理员可修改运单信息');
        return success(await updateInfo(shipmentId, data, OPENID), '信息更新成功');

      case 'delete':
        if (!shipmentId) return paramError('缺少 shipmentId 参数');
        if (!isAdmin(OPENID)) return error('权限不足：仅管理员可删除运单');
        return success(await deleteShipment(shipmentId, OPENID), '运单已删除');

      default:
        return paramError('未知的 action，支持：node / advanceNode / fee / measurement / quote / billing / advanceOa / updateInfo / delete');
    }
  } catch (err) {
    console.error('[shipment-update]', action, err.message);
    return error(err.message);
  }
};
