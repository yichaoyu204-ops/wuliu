/**
 * 账单管理云函数
 * createBill 已内联到 shipment-update 的 quote/confirm action（事务保证原子性）
 * 本函数负责：markPaid（标记已付）、billList（我的账单）、pendingBills（未付总览）、createMonthlyBill（月结合并）、cleanupPaidBills（定时清理）
 */

const cloud = require('wx-server-sdk');
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

    if (bill.shipmentId) {
      await transaction.collection('shipments').doc(bill.shipmentId).update({
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

// ── 我的账单列表（分页）──
async function billList(phone, status, page = 1, pageSize = 20) {
  if (!phone) throw new Error('缺少手机号');

  const match = { clientPhone: phone, isDeleted: _.neq(true) };
  if (status) match.status = status;

  const res = await db.collection('bills')
    .where(match)
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  return res.data;
}

// ── 管理端：所有账单（分页）──
async function pendingBills(page = 1, pageSize = 20) {
  const res = await db.collection('bills')
    .where({ isDeleted: _.neq(true) })
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  return res.data;
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
  const { action, billId, data, phone, status, monthlyBatch, page, pageSize } = event;
  const { OPENID } = cloud.getWXContext();

  try {
    switch (action) {
      case 'markPaid':
        checkAdmin(OPENID);
        return success(await markPaid(billId, data, OPENID), '已标记为已付');

      case 'billList':
        return success(await billList(phone, status, page, pageSize));

      case 'pendingBills':
        checkAdmin(OPENID);
        return success(await pendingBills(page, pageSize));

      case 'createMonthlyBill':
        checkAdmin(OPENID);
        return success(await createMonthlyBill(monthlyBatch, phone, OPENID), '月结账单生成成功');

      case 'cleanupPaidBills':
        return success(await cleanupPaidBills(), '清理任务执行完毕');

      default:
        return paramError('未知的 action，支持：markPaid / billList / pendingBills / createMonthlyBill / cleanupPaidBills');
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
