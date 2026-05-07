/**
 * 货物查询云函数
 * 支持按手机号、单号、分享Token查询
 * 此文件修改不会影响历史数据
 */

const cloud = require('wx-server-sdk');
const { success, error, paramError, notFound } = require('./utils/response');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 权限白名单
const ADMIN_OPENIDS = [];
const WAREHOUSE_OPENIDS = [];

function checkAdmin(openId) {
  if (!openId) throw new Error('无法获取用户身份');
  if (ADMIN_OPENIDS.includes(openId)) return true;
  throw new Error('权限不足');
}

function isWarehouseOrAdmin(openId) {
  if (!openId) return false;
  return WAREHOUSE_OPENIDS.includes(openId) || ADMIN_OPENIDS.includes(openId);
}

/**
 * 查询货物列表（按手机号）
 */
async function queryByPhone(phone, filter = {}, pagination = { page: 1, pageSize: 20 }) {
  const { page, pageSize } = pagination;
  const skip = (page - 1) * pageSize;

  let query = db.collection('shipments').where({ managerPhone: phone, ...filter });
  const countRes = await query.count();
  const total = countRes.total;

  const listRes = await query
    .orderBy('updatedAt', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get();

  // 简化返回字段
  const list = listRes.data.map(item => ({
    shipmentId: item._id,
    factoryName: item.factoryName,
    cargoInfo: {
      pieces: item.cargoInfo.pieces,
      piecesUnit: item.cargoInfo.piecesUnit,
      grossWeight: item.cargoInfo.grossWeight,
      volume: item.cargoInfo.volume
    },
    currentNodeName: item.currentNodeName,
    status: item.status,
    totalAmount: item.totalAmount,
    updatedAt: item.updatedAt,
    shareToken: item.shareToken
  }));

  return { list, pagination: { page, pageSize, total, hasMore: skip + list.length < total } };
}

/**
 * 按分享Token查询
 */
async function queryByToken(token) {
  const res = await db.collection('shipments').where({ shareToken: token }).limit(1).get();
  if (res.data.length === 0) return null;
  return res.data[0];
}

/**
 * 获取完整详情（含日志）
 */
async function getDetailWithLogs(shipmentId) {
  const [shipmentRes, logsRes] = await Promise.all([
    db.collection('shipments').doc(shipmentId).get(),
    db.collection('operation_logs').where({ shipmentId }).orderBy('timestamp', 'desc').limit(50).get()
  ]);

  if (!shipmentRes.data) return null;

  return { ...shipmentRes.data, logs: logsRes.data };
}

// 云函数入口
exports.main = async (event, context) => {
  const { action, phone, shipmentId, token, filter, pagination } = event;
  const { OPENID } = cloud.getWXContext();

  try {
    switch (action) {
      case 'list':
        if (!phone) return paramError('缺少phone参数');
        return success(await queryByPhone(phone, filter, pagination));

      case 'detail':
        if (!shipmentId) return paramError('缺少shipmentId参数');
        const detail = await getDetailWithLogs(shipmentId);
        if (!detail) return notFound('货物不存在');
        return success(detail);

      case 'byToken':
        if (!token) return paramError('缺少token参数');
        const byToken = await queryByToken(token);
        if (!byToken) return notFound('货物不存在或链接已失效');
        // 返回简化信息
        return success({
          _id: byToken._id,
          shipmentId: byToken._id,
          factoryName: byToken.factoryName,
          cargoInfo: byToken.cargoInfo,
          routing: byToken.routing,
          currentNodeName: byToken.currentNodeName,
          currentNodeIndex: byToken.currentNodeIndex,
          timeline: byToken.timeline,
          status: byToken.status,
          updatedAt: byToken.updatedAt,
          shareToken: byToken.shareToken
        });

      case 'queryByPhone': {
        // 支持按名字模糊查询
        if (event.name) {
          const nameRes = await db.collection('shipments')
            .where(_.or([
              { factoryName: db.RegExp({ regexp: event.name, options: 'i' }) },
              { clientName: db.RegExp({ regexp: event.name, options: 'i' }) }
            ]))
            .orderBy('updatedAt', 'desc')
            .limit(50)
            .get();
          const nameList = nameRes.data.map(item => ({
            _id: item._id,
            factoryName: item.factoryName,
            cargoInfo: {
              pieces: item.cargoInfo.pieces,
              piecesUnit: item.cargoInfo.piecesUnit,
              grossWeight: item.cargoInfo.grossWeight,
              volume: item.cargoInfo.volume
            },
            currentNodeName: item.currentNodeName,
            status: item.status,
            totalAmount: item.totalAmount,
            updatedAt: item.updatedAt,
            shareToken: item.shareToken
          }));
          return success(nameList);
        }

        if (!phone) return paramError('缺少phone参数');
        const qbRes = await db.collection('shipments')
          .where({ managerPhone: phone })
          .orderBy('updatedAt', 'desc')
          .limit(50)
          .get();
        const qbList = qbRes.data.map(item => ({
          _id: item._id,
          factoryName: item.factoryName,
          cargoInfo: {
            pieces: item.cargoInfo.pieces,
            piecesUnit: item.cargoInfo.piecesUnit,
            grossWeight: item.cargoInfo.grossWeight,
            volume: item.cargoInfo.volume
          },
          currentNodeName: item.currentNodeName,
          status: item.status,
          totalAmount: item.totalAmount,
          updatedAt: item.updatedAt,
          shareToken: item.shareToken
        }));
        return success(qbList);
      }

      case 'adminList':
        checkAdmin(OPENID);
        const adminRes = await db.collection('shipments').orderBy('updatedAt', 'desc').limit(100).get();
        return success({ list: adminRes.data, total: adminRes.data.length });

      case 'warehouseQueue': {
        if (!isWarehouseOrAdmin(OPENID)) return error('权限不足：仅仓库员或管理员可访问');
        // 仓库员：待测量的进仓货物列表
        const { status = 'pending' } = filter || {};
        let q = db.collection('shipments')
          .where({
            'measurement.status': status,
            status: _.neq('completed')
          });
        const wqRes = await q.orderBy('createdAt', 'desc').limit(100).get();
        const wqList = wqRes.data.map(item => ({
          _id: item._id,
          factoryName: item.factoryName,
          cargoInfo: item.cargoInfo,
          currentNodeName: item.currentNodeName,
          measurement: item.measurement,
          createdAt: item.createdAt
        }));
        return success({ list: wqList, total: wqList.length });
      }

      case 'myShipments': {
        if (!OPENID) return error('无法获取用户身份');
        const myRes = await db.collection('shipments')
          .where({ creatorOpenId: OPENID })
          .orderBy('createdAt', 'desc')
          .limit(100)
          .get();
        const myList = myRes.data.map(item => ({
          _id: item._id,
          factoryName: item.factoryName,
          cargoInfo: {
            pieces: item.cargoInfo.pieces,
            piecesUnit: item.cargoInfo.piecesUnit,
            grossWeight: item.cargoInfo.grossWeight,
            weightUnit: item.cargoInfo.weightUnit,
            volume: item.cargoInfo.volume,
            volumeUnit: item.cargoInfo.volumeUnit
          },
          currentNodeName: item.currentNodeName,
          status: item.status,
          totalAmount: item.totalAmount,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          shareToken: item.shareToken
        }));
        return success({ list: myList, total: myList.length });
      }

      case 'workflowList': {
        const { role, includeCompleted = false } = event;
        if (!role) return paramError('缺少role参数');

        // 待处理：根据角色和 oaAssignedTo 匹配
        const pendingQuery = {
          oaStatus: _.neq('completed'),
          oaAssignedTo: role
        };

        const pendingRes = await db.collection('shipments')
          .where(pendingQuery)
          .orderBy('updatedAt', 'desc')
          .limit(100)
          .get();

        const pending = pendingRes.data;

        let completed = [];
        if (includeCompleted) {
          // 已完结：最近7天完成的，或者创建者是当前用户的
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          const completedQuery = {
            oaStatus: 'completed',
            updatedAt: _.gte(sevenDaysAgo)
          };
          const completedRes = await db.collection('shipments')
            .where(completedQuery)
            .orderBy('updatedAt', 'desc')
            .limit(50)
            .get();
          completed = completedRes.data;
        }

        // 返回完整数据，前端需要用到 cargoInfo、billing 等
        return success({ pending, completed, totalPending: pending.length });
      }

      case 'pendingCount': {
        const { role } = event;
        if (!role) return paramError('缺少role参数');

        const countRes = await db.collection('shipments')
          .where({
            oaStatus: _.neq('completed'),
            oaAssignedTo: role
          })
          .count();

        return success({ count: countRes.total });
      }

      default:
        return paramError('未知的action类型');
    }
  } catch (err) {
    return error(err.message);
  }
};