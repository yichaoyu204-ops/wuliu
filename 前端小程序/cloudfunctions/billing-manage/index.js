/**
 * 账单管理云函数
 * createBill 已内联到 shipment-update 的 quote/confirm action（事务保证原子性）
 * 本函数负责：markPaid（标记已付）、billList（我的账单）、pendingBills（未付总览）、createMonthlyBill（月结合并）、cleanupPaidBills（定时清理）
 */

const cloud = require('wx-server-sdk');
const XLSX = require('xlsx');
const { success, error, paramError } = require('./utils/response');
const { formatMoney } = require('./utils/formatMoney');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const BILL_VISIBLE_ROLES = ['admin', 'warehouse', 'salesman'];

const ADMIN_OPENIDS = [
  // 'o-xxxxxxxxxxxxxxxxxxxxx',
];

function checkAdmin(openId) {
  if (!openId) throw new Error('AUTH_FAILED:无法获取用户身份');
  if (ADMIN_OPENIDS.length === 0) return true;
  if (!ADMIN_OPENIDS.includes(openId)) throw new Error('AUTH_FAILED:权限不足');
  return true;
}

function normalizePhoneList(values) {
  return Array.from(new Set((values || []).filter(Boolean).map(item => String(item))));
}

function buildBillVisibility(source = {}) {
  return {
    visibleRoles: BILL_VISIBLE_ROLES,
    visiblePhones: normalizePhoneList([
      source.clientPhone,
      source.managerPhone,
      source.contacts?.contact1Phone,
      source.contacts?.contact2Phone
    ])
  };
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
    const fallbackDate = new Date(value.replace(/-/g, '/'));
    return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate;
  }
  if (value.$date) return toDate(value.$date);
  if (value.seconds) return toDate(value.seconds * 1000);
  if (value._seconds) return toDate(value._seconds * 1000);
  return null;
}

function padTime(value) {
  return value < 10 ? `0${value}` : String(value);
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${padTime(date.getMonth() + 1)}-${padTime(date.getDate())} ${padTime(date.getHours())}:${padTime(date.getMinutes())}`;
}

function getMonthKey(value) {
  const date = toDate(value);
  if (!date) return 'unknown';
  return `${date.getFullYear()}-${padTime(date.getMonth() + 1)}`;
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
    createdAt: shipment.createdAt || shipment._createTime || null,
    updatedAt: shipment.updatedAt || null
  };
}

function buildPriceItemsFromShipment(shipment = {}) {
  if (shipment.quote?.items?.length > 0) return shipment.quote.items;

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

    return {
      ...bill,
      items: bill.items?.length > 0 ? bill.items : fallbackItems,
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
    .where({ creatorOpenId: operatorOpenId, isDeleted: _.neq(true) })
    .limit(100)
    .get();

  return (res.data || []).map(item => item._id).filter(Boolean);
}

function billBelongsToCurrentUser(bill, phone, creatorShipmentIds) {
  const relatedShipmentIds = [
    bill.shipmentId,
    ...(bill.shipmentIds || [])
  ].filter(Boolean);
  const visiblePhones = bill.visiblePhones || [];

  return (
    relatedShipmentIds.some(id => creatorShipmentIds.includes(id)) ||
    (phone && (bill.clientPhone === phone || visiblePhones.includes(phone)))
  );
}

function sanitizeBillForRole(bill, role) {
  if (role === 'admin') return bill;
  return {
    ...bill,
    items: []
  };
}

function paidSpotShipmentToBill(item) {
  const amount = item.billing?.payableAmount || item.pricing?.finalPrice || item.quote?.subtotal || item.totalAmount || 0;
  const paidAmount = item.billing?.paidAmount || amount;
  const visibility = buildBillVisibility(item);
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
    contacts: item.contacts || {},
    totalAmount: formatMoney(amount) || 0,
    paidAmount: formatMoney(paidAmount) || 0,
    status: 'paid',
    paymentType: 'spot',
    ...visibility,
    items: item.quote?.items?.length > 0 ? item.quote.items : (item.pricing ? [{
      name: '运费',
      calculationDetail: `重量价:${item.pricing.weightPrice || 0} / 体积价:${item.pricing.volumePrice || 0}`,
      amount: formatMoney(amount) || 0
    }] : []),
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
  const match = {
    isDeleted: _.neq(true),
    paymentType: _.neq('spot')
  };
  if (status) match.status = status;

  const res = await db.collection('bills')
    .where(match)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();

  const creatorShipmentIds = await getCreatorShipmentIds(operatorOpenId);
  const visibleBills = (res.data || []).filter(bill => (
    role === 'admin'
      ? true
      : billBelongsToCurrentUser(bill, phone, creatorShipmentIds)
  ));

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
      .filter(bill => (
        role === 'admin'
          ? true
          : billBelongsToCurrentUser(bill, phone, creatorShipmentIds)
      ));
  }

  const start = (page - 1) * pageSize;

  const mergedBills = visibleBills
    .concat(paidSpotBills)
    .sort((a, b) => {
      const timeA = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
      const timeB = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
      return timeB - timeA;
    });

  const enrichedBills = await enrichBillsWithShipmentInfo(mergedBills.slice(start, start + pageSize));
  return enrichedBills.map(bill => sanitizeBillForRole(bill, role));
}

// ── 管理端：所有账单（分页）──
async function pendingBills(page = 1, pageSize = 20) {
  const res = await db.collection('bills')
    .where({ isDeleted: _.neq(true) })
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  const bills = (res.data || []).filter(item => item.paymentType !== 'spot' || item.status === 'paid');
  const billShipmentIds = bills.map(item => item.shipmentId).filter(Boolean);

  const billedShipmentsRes = await db.collection('shipments')
    .where({
      oaStatus: 'billed',
      'billing.paymentType': _.neq('spot'),
      isDeleted: _.neq(true)
    })
    .orderBy('updatedAt', 'desc')
    .limit(100)
    .get();

  const orphanBills = (billedShipmentsRes.data || [])
    .filter(item => !item.billing?.billId || !billShipmentIds.includes(item._id))
    .map(item => {
      const amount = item.pricing?.finalPrice || item.quote?.subtotal || item.totalAmount || 0;
      return {
        _id: item.billing?.billId || `SHIP-${item._id}`,
        billType: item.billing?.paymentType === 'spot' ? 'spot' : 'monthly',
        shipmentId: item._id,
        waybillNo: item.cargoInfo?.waybillNo || '',
        warehouseEntryNo: item.cargoInfo?.warehouseEntryNo || '',
        shipmentBrief: buildShipmentBrief(item),
        shipmentBriefs: [buildShipmentBrief(item)],
        clientPhone: item.managerPhone || item.contacts?.contact1Phone || '',
        clientName: item.clientName || item.contacts?.contact1Name || '',
        factoryName: item.factoryName || item.creatorName || '',
        contacts: item.contacts || {},
        totalAmount: formatMoney(amount) || 0,
        paidAmount: item.billing?.paidAmount || 0,
        status: item.billing?.paymentStatus === 'paid' ? 'paid' : 'unpaid',
        paymentType: item.billing?.paymentType || 'monthly',
        items: item.quote?.items || (item.pricing ? [{
          name: '运费',
          calculationDetail: `重量价:${item.pricing.weightPrice || 0} / 体积价:${item.pricing.volumePrice || 0}`,
          amount: formatMoney(amount) || 0
        }] : []),
        payments: [],
        createdAt: item.billing?.sentAt || item.updatedAt || item._createTime || db.serverDate(),
        updatedAt: item.updatedAt || db.serverDate()
      };
    });

  const paidSpotRes = await db.collection('shipments')
    .where({
      'billing.paymentType': 'spot',
      'billing.paymentStatus': 'paid',
      'billing.spotPaymentConfirmed': true,
      isDeleted: _.neq(true)
    })
    .orderBy('updatedAt', 'desc')
    .limit(100)
    .get();

  const paidSpotBills = (paidSpotRes.data || [])
    .filter(item => !item.billing?.billId || !billShipmentIds.includes(item._id))
    .map(item => paidSpotShipmentToBill(item));

  return bills.concat(orphanBills, paidSpotBills);
}

function safeSheetName(rawName, fallback, usedNames) {
  const base = String(rawName || fallback || '运单')
    .replace(/[\\/?*\[\]:]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28) || '运单';
  let name = base;
  let index = 2;
  while (usedNames.has(name)) {
    const suffix = `-${index}`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    index += 1;
  }
  usedNames.add(name);
  return name;
}

function getBillTime(bill = {}) {
  const shipmentBrief = bill.shipmentBrief || bill.shipmentBriefs?.[0] || {};
  return bill.sentAt || bill.createdAt || bill.updatedAt || shipmentBrief.createdAt;
}

function getPaymentTypeLabel(paymentType) {
  const map = {
    monthly: '萌恒月结',
    spot: '供应商现结',
    supplier_monthly: '供应商月结'
  };
  return map[paymentType] || '萌恒月结';
}

function billDisplayId(bill = {}) {
  return `Bill-${bill.warehouseEntryNo || bill.waybillNo || bill._id || ''}`;
}

function buildPriceCompositionText(bill = {}) {
  const items = bill.items || [];
  if (items.length === 0) return '';
  return items.map(item => {
    const includeText = item.isIncluded === false ? '未计入' : '计入';
    const detail = item.calculationDetail || item.detail || '';
    return [
      item.name || '费用',
      detail ? `(${detail})` : '',
      `${includeText} ${formatMoney(item.amount || 0)}`
    ].filter(Boolean).join(' ');
  }).join('；');
}

function buildSummaryRows(bills = [], monthKey = '') {
  const totalAmount = bills.reduce((sum, bill) => sum + Number(bill.totalAmount || 0), 0);
  const paidAmount = bills.reduce((sum, bill) => sum + Number(bill.paidAmount || 0), 0);
  const rows = [
    ['月份', monthKey || '时间未确定'],
    ['票数', bills.length],
    ['应收合计', formatMoney(totalAmount)],
    ['已收合计', formatMoney(paidAmount)],
    [],
    ['账单号', '状态', '付款方式', '客户/联系人', '进仓编号', '业务参与编号', '货物', '价格组成', '应收金额', '已收金额', '账单时间']
  ];

  bills.forEach(bill => {
    const brief = bill.shipmentBrief || bill.shipmentBriefs?.[0] || {};
    const cargo = [
      brief.pieces ? `${brief.pieces}${brief.piecesUnit || '件'}` : '',
      brief.grossWeight ? `${brief.grossWeight}${brief.weightUnit || 'KGS'}` : '',
      brief.volume ? `${brief.volume}${brief.volumeUnit || 'CBM'}` : ''
    ].filter(Boolean).join(' / ');
    rows.push([
      billDisplayId(bill),
      bill.status === 'paid' ? '已付' : '待付',
      getPaymentTypeLabel(bill.paymentType),
      bill.contacts?.contact1Name || bill.clientName || bill.factoryName || '',
      bill.warehouseEntryNo || brief.warehouseEntryNo || '',
      bill.waybillNo || brief.waybillNo || '',
      cargo,
      buildPriceCompositionText(bill),
      formatMoney(bill.totalAmount || 0),
      formatMoney(bill.paidAmount || 0),
      formatDateTime(getBillTime(bill))
    ]);
  });

  return rows;
}

function buildShipmentSheetRows(bill = {}, shipmentBrief = {}) {
  const feeItems = bill.items || [];
  const rows = [
    ['基础信息', ''],
    ['账单号', billDisplayId(bill)],
    ['账单状态', bill.status === 'paid' ? '已付' : '待付'],
    ['付款方式', getPaymentTypeLabel(bill.paymentType)],
    ['客户/联系人', bill.contacts?.contact1Name || bill.clientName || bill.factoryName || ''],
    ['联系电话', bill.clientPhone || bill.contacts?.contact1Phone || ''],
    ['应收金额', formatMoney(bill.totalAmount || 0)],
    ['已收金额', formatMoney(bill.paidAmount || 0)],
    ['账单时间', formatDateTime(getBillTime(bill))],
    [],
    ['货物信息', ''],
    ['进仓编号', shipmentBrief.warehouseEntryNo || bill.warehouseEntryNo || ''],
    ['业务参与编号', shipmentBrief.waybillNo || bill.waybillNo || ''],
    ['件数', shipmentBrief.pieces || ''],
    ['件数单位', shipmentBrief.piecesUnit || ''],
    ['毛重', shipmentBrief.grossWeight || ''],
    ['重量单位', shipmentBrief.weightUnit || ''],
    ['体积', shipmentBrief.volume || ''],
    ['体积单位', shipmentBrief.volumeUnit || ''],
    ['仓库', shipmentBrief.warehouseName || ''],
    ['目的港', shipmentBrief.destinationPort || ''],
    ['唛头', shipmentBrief.marks || ''],
    ['建单时间', formatDateTime(shipmentBrief.createdAt)],
    ['入仓时间', formatDateTime(shipmentBrief.entryTime)],
    ['出运时间', formatDateTime(shipmentBrief.departureTime)],
    ['最晚送达', formatDateTime(shipmentBrief.latestDeliveryTime)],
    [],
    ['费用明细', '', '', ''],
    ['费用名称', '计费说明', '是否计入', '金额']
  ];

  if (feeItems.length === 0) {
    rows.push(['运费', '', '是', formatMoney(bill.totalAmount || 0)]);
  } else {
    feeItems.forEach(item => {
      rows.push([
        item.name || '',
        item.calculationDetail || item.detail || '',
        item.isIncluded === false ? '否' : '是',
        formatMoney(item.amount || 0)
      ]);
    });
  }

  rows.push([]);
  rows.push(['合计', '', '', formatMoney(bill.totalAmount || 0)]);
  return rows;
}

async function fetchAllDocuments(collectionName, match, orderField) {
  const batchSize = 100;
  const all = [];
  let skip = 0;

  while (true) {
    const res = await db.collection(collectionName)
      .where(match)
      .orderBy(orderField, 'desc')
      .skip(skip)
      .limit(batchSize)
      .get();
    const data = res.data || [];
    all.push(...data);
    if (data.length < batchSize) break;
    skip += batchSize;
  }

  return all;
}

async function getExportBills(normalizedStatus) {
  const billMatch = {
    isDeleted: _.neq(true),
    paymentType: _.neq('spot')
  };
  if (normalizedStatus) billMatch.status = normalizedStatus;

  const regularBills = await fetchAllDocuments('bills', billMatch, 'createdAt');

  let paidSpotBills = [];
  if (!normalizedStatus || normalizedStatus === 'paid') {
    const spotShipments = await fetchAllDocuments('shipments', {
      'billing.paymentType': 'spot',
      'billing.paymentStatus': 'paid',
      'billing.spotPaymentConfirmed': true,
      isDeleted: _.neq(true)
    }, 'updatedAt');
    paidSpotBills = spotShipments.map(item => paidSpotShipmentToBill(item));
  }

  const mergedBills = regularBills
    .concat(paidSpotBills)
    .sort((a, b) => {
      const timeA = toDate(a.updatedAt || a.createdAt)?.getTime() || 0;
      const timeB = toDate(b.updatedAt || b.createdAt)?.getTime() || 0;
      return timeB - timeA;
    });

  return enrichBillsWithShipmentInfo(mergedBills);
}

async function exportMonthlyBills(monthKey, status) {
  if (!monthKey) throw new Error('缺少导出月份');
  const normalizedStatus = status && status !== 'all' ? status : '';
  const bills = await getExportBills(normalizedStatus);
  const monthBills = bills.filter(bill => getMonthKey(getBillTime(bill)) === monthKey);
  if (monthBills.length === 0) throw new Error('该月份暂无可导出的账单');

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildSummaryRows(monthBills, monthKey)),
    '月度汇总'
  );

  const usedNames = new Set(['月度汇总']);
  monthBills.forEach((bill, billIndex) => {
    const briefs = bill.shipmentBriefs?.length
      ? bill.shipmentBriefs
      : [bill.shipmentBrief || {}];
    briefs.forEach((brief, briefIndex) => {
      const sheetName = safeSheetName(
        brief.warehouseEntryNo || brief.waybillNo || bill.warehouseEntryNo || bill.waybillNo,
        `运单${billIndex + 1}-${briefIndex + 1}`,
        usedNames
      );
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet(buildShipmentSheetRows(bill, brief)),
        sheetName
      );
    });
  });

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const fileName = `账单汇总-${monthKey}-${normalizedStatus || 'all'}.xlsx`;
  const cloudPath = `exports/billing/${monthKey}/${Date.now()}-billing-${monthKey}-${normalizedStatus || 'all'}.xlsx`;
  const uploadRes = await cloud.uploadFile({
    cloudPath,
    fileContent: buffer
  });

  return {
    fileID: uploadRes.fileID,
    cloudPath,
    fileName,
    billCount: monthBills.length
  };
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
    const visibility = buildBillVisibility(spots[0] || { clientPhone });

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
        sourceBillIds: spots.map(b => b._id),
        payments: spots.flatMap(b => b.payments || []),
        ...visibility,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
        lastModifiedBy: operatorOpenId
      }
    });

    for (const b of spots) {
      await transaction.collection('bills').doc(b._id).update({
        data: {
          monthlyBatch,
          monthlyBillId: billId,
          ...visibility,
          updatedAt: db.serverDate()
        }
      });
    }

    for (const shipmentId of shipmentIds) {
      await transaction.collection('shipments').doc(shipmentId).update({
        data: {
          'billing.monthlyBatch': monthlyBatch,
          'billing.monthlyBillId': billId,
          'billing.visibleRoles': visibility.visibleRoles,
          'billing.visiblePhones': visibility.visiblePhones,
          updatedAt: db.serverDate()
        }
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
  const { action, billId, data, phone, status, monthKey, monthlyBatch, page, pageSize, role } = event;
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

      case 'exportMonthlyBills':
        checkAdmin(OPENID);
        return success(await exportMonthlyBills(monthKey, status), '导出成功');

      case 'createMonthlyBill':
        checkAdmin(OPENID);
        return success(await createMonthlyBill(monthlyBatch, phone, OPENID), '月结账单生成成功');

      case 'unpaidCount': {
        if (role === 'warehouse') {
          return success({ count: 0 });
        }

        const match = {
          status: 'unpaid',
          paymentType: _.neq('spot'),
          isDeleted: _.neq(true)
        };
        if (role === 'admin') {
          checkAdmin(OPENID);
          const countRes = await db.collection('bills').where(match).count();
          return success({ count: countRes.total });
        }

        const bills = await billList(phone, 'unpaid', 1, 100, role, OPENID);
        return success({ count: bills.length });
      }

      case 'cleanupPaidBills':
        return success(await cleanupPaidBills(), '清理任务执行完毕');

      default:
        return paramError('未知的 action，支持：markPaid / applyDiscount / billList / pendingBills / exportMonthlyBills / createMonthlyBill / cleanupPaidBills / unpaidCount');
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
