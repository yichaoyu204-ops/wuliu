/**
 * 账单管理云函数
 * createBill 已内联到 shipment-update 的 quote/confirm action（事务保证原子性）
 * 本函数负责：markPaid（标记已付）、billList（我的账单）、pendingBills（未付总览）、createMonthlyBill（月结合并）、cleanupPaidBills（定时清理）
 */

const cloud = require('wx-server-sdk');
const { assertCallerAccess } = require('./revoked-access');
const { success, error, paramError } = require('./utils/response');
const { formatMoney } = require('./utils/formatMoney');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const ADMIN_OPENIDS = [
  // 'o-xxxxxxxxxxxxxxxxxxxxx',
];

function checkAdmin(openId) {
  if (!openId) throw new Error('AUTH_FAILED:无法获取用户身份');
  if (ADMIN_OPENIDS.length === 0) throw new Error('AUTH_FAILED:管理员白名单未配置');
  if (!ADMIN_OPENIDS.includes(openId)) throw new Error('AUTH_FAILED:权限不足');
}

function getOriginalAmount(bill = {}) {
  return formatMoney(
    bill.discount?.originalAmount != null
      ? bill.discount.originalAmount
      : (bill.originalAmount != null ? bill.originalAmount : bill.totalAmount || 0)
  );
}

function normalizeRateLabel(rawValue, rate) {
  const rawText = String(rawValue).trim();
  const rawNumber = Number(rawText);
  if (rawText && rawNumber > 10) return `${rawText}折`;
  if (rawText && rawNumber > 1) return `${rawText}折`;
  return `${formatMoney(rate * 10)}折`;
}

function calculateDiscountPayload(data = {}, originalAmount = 0) {
  const type = data.type;
  const rawValue = data.value;
  const value = Number(rawValue);
  if (!['rate', 'amount'].includes(type)) throw new Error('请选择优惠方式');
  if (!Number.isFinite(value) || value <= 0) throw new Error('请输入正确的优惠数值');
  if (!Number.isFinite(originalAmount) || originalAmount <= 0) throw new Error('账单原价异常，无法优惠');

  if (type === 'rate') {
    const rate = value > 10 ? value / 100 : (value > 1 ? value / 10 : value);
    if (rate <= 0 || rate >= 1) throw new Error('折扣需小于原价，例如 9、95 或 9.5');
    const finalAmount = formatMoney(originalAmount * rate);
    const discountAmount = formatMoney(originalAmount - finalAmount);
    return {
      type,
      rate,
      rateLabel: normalizeRateLabel(rawValue, rate),
      originalAmount,
      discountAmount,
      finalAmount
    };
  }

  const discountAmount = formatMoney(value);
  if (discountAmount > originalAmount) throw new Error('减免金额不能大于账单原价');
  return {
    type,
    originalAmount,
    discountAmount,
    finalAmount: formatMoney(originalAmount - discountAmount)
  };
}

function buildShipmentBrief(shipment = {}) {
  const cargoInfo = shipment.cargoInfo || {};
  const routing = shipment.routing || {};
  return {
    shipmentId: shipment._id || '',
    waybillNo: cargoInfo.waybillNo || '',
    warehouseEntryNo: cargoInfo.warehouseEntryNo || '',
    pieces: cargoInfo.pieces || 0,
    piecesUnit: cargoInfo.piecesUnit || '件',
    grossWeight: cargoInfo.grossWeight || 0,
    weightUnit: cargoInfo.weightUnit || 'KGS',
    volume: cargoInfo.volume || 0,
    volumeUnit: cargoInfo.volumeUnit || 'CBM',
    marks: cargoInfo.marks || '',
    warehouseName: routing.warehouseName || '',
    destinationPort: routing.destinationPort || '',
    entryTime: routing.entryTime || null,
    departureTime: routing.departureTime || null,
    latestDeliveryTime: routing.latestDeliveryTime || null,
    currentNodeName: shipment.currentNodeName || '',
    creatorName: shipment.creatorName || '',
    creatorPhone: shipment.creatorPhone || '',
    creatorRole: shipment.creatorRole || '',
    createdAt: shipment.createdAt || shipment._createTime || null,
    updatedAt: shipment.updatedAt || null
  };
}

function buildPriceItemsFromShipment(shipment = {}) {
  if (shipment.quote?.items?.length > 0) {
    return shipment.quote.items.map(item => ({
      ...item,
      name: item.name || '费用',
      calculationDetail: item.calculationDetail || item.detail || '',
      amount: formatMoney(item.amount || 0),
      isIncluded: item.isIncluded !== false
    }));
  }

  if (shipment.fees?.length > 0) {
    return shipment.fees.map(fee => ({
      name: fee.name || '费用',
      calculationDetail: fee.calculationDetail || fee.detail || '',
      amount: formatMoney(fee.amount || 0),
      isIncluded: true
    }));
  }

  const amount = shipment.pricing?.finalPrice || shipment.quote?.subtotal || shipment.totalAmount || 0;
  if (amount) {
    return [{
      name: '运费',
      calculationDetail: shipment.pricing ? `重量价:${shipment.pricing.weightPrice || 0} / 体积价:${shipment.pricing.volumePrice || 0}` : '',
      amount: formatMoney(amount),
      isIncluded: true
    }];
  }

  return [];
}

function isSimpleFreightItems(items = []) {
  if (!items || items.length === 0) return true;
  if (items.length > 1) return false;

  const item = items[0] || {};
  return (item.name || '') === '运费' || (!item.calculationDetail && !item.detail);
}

async function enrichBillsWithShipmentInfo(bills = []) {
  const shipmentIds = bills.flatMap(bill => [
    bill.shipmentId,
    ...(bill.shipmentIds || [])
  ]).filter(Boolean);

  if (shipmentIds.length === 0) return bills;

  const shipmentRes = await db.collection('shipments')
    .where({ _id: _.in(Array.from(new Set(shipmentIds))) })
    .get();

  const shipmentMap = {};
  (shipmentRes.data || []).forEach(shipment => {
    shipmentMap[shipment._id] = {
      brief: buildShipmentBrief(shipment),
      priceItems: buildPriceItemsFromShipment(shipment)
    };
  });

  return bills.map(bill => {
    const billShipmentIds = [
      bill.shipmentId,
      ...(bill.shipmentIds || [])
    ].filter(Boolean);
    const shipmentInfos = billShipmentIds.map(id => shipmentMap[id]).filter(Boolean);
    const shipmentBriefs = shipmentInfos.map(item => item.brief).filter(Boolean);
    const waybillNos = shipmentBriefs.map(item => item.waybillNo).filter(Boolean);
    const warehouseEntryNos = shipmentBriefs.map(item => item.warehouseEntryNo).filter(Boolean);
    const fallbackItems = shipmentInfos.find(item => item.priceItems?.length > 0)?.priceItems || [];
    const billItems = bill.items || [];
    const shouldUseShipmentItems = fallbackItems.length > 0 &&
      (isSimpleFreightItems(billItems) || fallbackItems.length > billItems.length);

    return {
      ...bill,
      items: shouldUseShipmentItems ? fallbackItems : (billItems.length > 0 ? billItems : fallbackItems),
      creatorName: bill.creatorName || shipmentBriefs[0]?.creatorName || '',
      creatorPhone: bill.creatorPhone || shipmentBriefs[0]?.creatorPhone || '',
      creatorRole: bill.creatorRole || shipmentBriefs[0]?.creatorRole || '',
      waybillNo: bill.waybillNo || waybillNos[0] || '',
      waybillNos,
      warehouseEntryNo: bill.warehouseEntryNo || warehouseEntryNos[0] || '',
      warehouseEntryNos,
      shipmentBrief: bill.shipmentBrief || shipmentBriefs[0] || null,
      shipmentBriefs
    };
  });
}

// ── 标记已付（事务）──
async function markPaid(billId, data, operatorOpenId) {
  const { amount, note } = data || {};
  if (!billId) throw new Error('缺少账单ID');

  return await db.runTransaction(async transaction => {
    const billRes = await transaction.collection('bills').doc(billId).get();
    if (!billRes.data) throw new Error('账单不存在');
    const bill = billRes.data;

    if (bill.status === 'paid') throw new Error('账单已标记为已付');

    const paidAmount = formatMoney(amount != null ? amount : bill.totalAmount);

    await transaction.collection('bills').doc(billId).update({
      data: {
        status: 'paid',
        paidAmount: paidAmount,
        payments: _.push([{
          amount: paidAmount,
          paidAt: db.serverDate(),
          markedBy: operatorOpenId,
          note: note || '标记已付'
        }]),
        updatedAt: db.serverDate()
      }
    });

    const shipmentIds = [
      bill.shipmentId,
      ...(bill.shipmentIds || [])
    ].filter(Boolean);

    for (const shipmentId of Array.from(new Set(shipmentIds))) {
      await transaction.collection('shipments').doc(shipmentId).update({
        data: {
          'billing.paymentStatus': 'paid',
          'billing.paidAt': db.serverDate(),
          'billing.paidBy': operatorOpenId,
          'billing.paidAmount': paidAmount,
          updatedAt: db.serverDate()
        }
      });
    }

    return { billId, status: 'paid', paidAmount };
  });
}

// ── 管理端优惠（事务）──
async function applyDiscount(billId, data, operatorOpenId) {
  if (!billId) throw new Error('缺少账单ID');

  return await db.runTransaction(async transaction => {
    const billRes = await transaction.collection('bills').doc(billId).get();
    if (!billRes.data) throw new Error('账单不存在');
    const bill = billRes.data;
    if (bill.status === 'paid') throw new Error('已支付账单不能再优惠');

    const originalAmount = getOriginalAmount(bill);
    const discountInfo = {
      ...calculateDiscountPayload(data, originalAmount),
      appliedAt: db.serverDate(),
      appliedBy: operatorOpenId
    };
    const discountLog = {
      ...discountInfo,
      appliedAt: db.serverDate(),
      appliedBy: operatorOpenId
    };

    await transaction.collection('bills').doc(billId).update({
      data: {
        originalAmount,
        totalAmount: discountInfo.finalAmount,
        discount: discountInfo,
        discountHistory: _.push([discountLog]),
        updatedAt: db.serverDate()
      }
    });

    const shipmentIds = [
      bill.shipmentId,
      ...(bill.shipmentIds || [])
    ].filter(Boolean);

    for (const shipmentId of Array.from(new Set(shipmentIds))) {
      await transaction.collection('shipments').doc(shipmentId).update({
        data: {
          'billing.discount': discountInfo,
          'billing.originalAmount': originalAmount,
          'billing.discountAmount': discountInfo.discountAmount,
          'billing.payableAmount': discountInfo.finalAmount,
          updatedAt: db.serverDate()
        }
      });
    }

    return {
      billId,
      originalAmount,
      totalAmount: discountInfo.finalAmount,
      discount: discountInfo
    };
  });
}

// ── 我的账单列表（分页）──
async function getCreatorShipmentIds(operatorOpenId) {
  if (!operatorOpenId) return [];

  const res = await db.collection('shipments')
    .where({ creatorOpenId: operatorOpenId, creatorRole: 'salesman', isDeleted: _.neq(true) })
    .limit(100)
    .get();

  return (res.data || []).map(item => item._id).filter(Boolean);
}

function billBelongsToCurrentUser(bill, phone, creatorShipmentIds) {
  const relatedShipmentIds = [
    bill.shipmentId,
    ...(bill.shipmentIds || [])
  ].filter(Boolean);

  return relatedShipmentIds.some(id => creatorShipmentIds.includes(id));
}

function paidSpotShipmentToBill(item) {
  const amount = item.billing?.payableAmount || item.pricing?.finalPrice || item.quote?.subtotal || item.totalAmount || 0;
  const paidAmount = item.billing?.paidAmount || amount;
  return {
    _id: item.billing?.billId || `SPOT-${item._id}`,
    billType: 'spot',
    shipmentId: item._id,
    waybillNo: item.cargoInfo?.waybillNo || '',
    warehouseEntryNo: item.cargoInfo?.warehouseEntryNo || '',
    shipmentBrief: buildShipmentBrief(item),
    shipmentBriefs: [buildShipmentBrief(item)],
    clientPhone: item.managerPhone || item.contacts?.contact1Phone || '',
    clientName: item.clientName || item.contacts?.contact1Name || '',
    factoryName: item.factoryName || item.creatorName || '',
    creatorName: item.creatorName || '',
    creatorPhone: item.creatorPhone || '',
    creatorRole: item.creatorRole || '',
    contacts: item.contacts || {},
    totalAmount: formatMoney(amount) || 0,
    paidAmount: formatMoney(paidAmount) || 0,
    status: 'paid',
    paymentType: 'spot',
    items: buildPriceItemsFromShipment(item),
    payments: [{
      amount: formatMoney(paidAmount) || 0,
      paidAt: item.billing?.paidAt || item.updatedAt || item._createTime,
      markedBy: item.billing?.paidBy || '',
      note: '供应商现结收款'
    }],
    createdAt: item.billing?.paidAt || item.updatedAt || item._createTime || db.serverDate(),
    updatedAt: item.billing?.paidAt || item.updatedAt || db.serverDate()
  };
}

async function checkMarkPaidPermission(billId, role, phone, operatorOpenId) {
  if (role === 'admin') {
    checkAdmin(operatorOpenId);
    return;
  }
  if (role !== 'salesman') throw new Error('权限不足：仅业务员或管理员可确认支付');

  const billRes = await db.collection('bills').doc(billId).get();
  if (!billRes.data) throw new Error('账单不存在');

  const creatorShipmentIds = await getCreatorShipmentIds(operatorOpenId);
  if (!billBelongsToCurrentUser(billRes.data, phone, creatorShipmentIds)) {
    throw new Error('权限不足：只能确认自己的账单');
  }
}

async function billList(phone, status, page = 1, pageSize = 20, role, operatorOpenId) {
  const match = { isDeleted: _.neq(true) };
  if (status) match.status = status;

  const res = await db.collection('bills')
    .where(match)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();

  const creatorShipmentIds = await getCreatorShipmentIds(operatorOpenId);
  const visibleBills = (res.data || [])
    .filter(bill => bill.paymentType !== 'spot')
    .filter(bill => role === 'admin' || billBelongsToCurrentUser(bill, phone, creatorShipmentIds));

  let paidSpotBills = [];
  if (!status || status === 'paid') {
    const spotRes = await db.collection('shipments')
      .where({
        'billing.paymentType': 'spot',
        'billing.paymentStatus': 'paid',
        'billing.spotPaymentConfirmed': true,
        isDeleted: _.neq(true)
      })
      .orderBy('updatedAt', 'desc')
      .limit(100)
      .get();

    paidSpotBills = (spotRes.data || [])
      .map(item => paidSpotShipmentToBill(item))
      .filter(bill => role === 'admin' || billBelongsToCurrentUser(bill, phone, creatorShipmentIds));
  }

  const start = (page - 1) * pageSize;

  const mergedBills = visibleBills
    .concat(paidSpotBills)
    .sort((a, b) => {
      const timeA = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
      const timeB = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
      return timeB - timeA;
    });

  return enrichBillsWithShipmentInfo(mergedBills.slice(start, start + pageSize));
}

// ── 管理端：所有账单（分页）──
async function pendingBills(page = 1, pageSize = 20) {
  const res = await db.collection('bills')
    .where({ isDeleted: _.neq(true) })
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  return enrichBillsWithShipmentInfo(res.data);
}

// ── 月结合并（事务）──
async function createMonthlyBill(monthlyBatch, clientPhone, operatorOpenId) {
  if (!monthlyBatch || !clientPhone) throw new Error('缺少月份或客户手机号');

  return await db.runTransaction(async transaction => {
    const spotBillsRes = await transaction.collection('bills')
      .where({
        clientPhone,
        paymentType: 'spot',
        status: _.in(['unpaid', 'paid']),
        monthlyBatch: _.exists(false)
      })
      .orderBy('createdAt', 'asc')
      .get();

    const spots = spotBillsRes.data;
    if (spots.length === 0) throw new Error('该客户无可合并的现结账单');

    const shipmentIds = spots.map(b => b.shipmentId).filter(Boolean);
    const totalAmount = spots.reduce((s, b) => s + (b.totalAmount || 0), 0);
    const paidAmount = spots.reduce((s, b) => s + (b.paidAmount || 0), 0);

    const billId = `MONTHLY-${monthlyBatch}-${clientPhone.slice(-4)}`;

    await transaction.collection('bills').add({
      data: {
        _id: billId,
        billType: 'monthly',
        monthlyBatch,
        shipmentIds,
        clientPhone,
        clientName: spots[0]?.clientName || '',
        factoryName: spots[0]?.factoryName || '',
        totalAmount: formatMoney(totalAmount),
        paidAmount: formatMoney(paidAmount),
        status: paidAmount >= totalAmount ? 'paid' : 'unpaid',
        paymentType: 'monthly',
        payments: spots.flatMap(b => b.payments || []),
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
        lastModifiedBy: operatorOpenId
      }
    });

    for (const b of spots) {
      await transaction.collection('bills').doc(b._id).update({
        data: { monthlyBatch, updatedAt: db.serverDate() }
      });
    }

    return { billId, mergedCount: spots.length, totalAmount };
  });
}

// ── 定时清理（软删除）──
async function cleanupPaidBills() {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const expired = await db.collection('bills')
    .where({
      status: 'paid',
      'payments.0.paidAt': _.lt(ninetyDaysAgo),
      isDeleted: _.neq(true)
    })
    .limit(50)
    .get();

  if (expired.data.length === 0) return { deleted: 0 };

  const ids = expired.data.map(b => b._id);

  await db.collection('bills').where({
    _id: _.in(ids)
  }).update({
    data: { isDeleted: true, updatedAt: db.serverDate() }
  });

  return { deleted: ids.length, ids };
}

// ── 入口 ──
exports.main = async (event, context) => {
  try {
    await assertCallerAccess(cloud.database(), cloud.getWXContext().OPENID);
  } catch (err) {
    return error(err.message);
  }

  const { action, billId, data, phone, status, monthlyBatch, page, pageSize, role } = event;
  const { OPENID } = cloud.getWXContext();

  try {
    switch (action) {
      case 'markPaid':
        await checkMarkPaidPermission(billId, role, phone, OPENID);
        return success(await markPaid(billId, data, OPENID), '已标记为已付');

      case 'applyDiscount':
        checkAdmin(OPENID);
        return success(await applyDiscount(billId, data, OPENID), '优惠已生效');

      case 'billList':
        return success(await billList(phone, status, page, pageSize, role, OPENID));

      case 'pendingBills':
        checkAdmin(OPENID);
        return success(await pendingBills(page, pageSize));

      case 'createMonthlyBill':
        checkAdmin(OPENID);
        return success(await createMonthlyBill(monthlyBatch, phone, OPENID), '月结账单生成成功');

      case 'cleanupPaidBills':
        return success(await cleanupPaidBills(), '清理任务执行完毕');

      default:
        return paramError('未知的 action，支持：markPaid / applyDiscount / billList / pendingBills / createMonthlyBill / cleanupPaidBills');
    }
  } catch (err) {
    console.error(`[billing-manage][${action}] Error:`, err);

    if (err.message.startsWith('AUTH_FAILED:')) {
      return error(err.message.replace('AUTH_FAILED:', ''));
    }

    if (!err.message.includes('collection') && !err.message.includes('database')) {
      return error(err.message);
    }

    return error('系统操作异常，请联系管理员');
  }
};
