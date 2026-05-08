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
  if (ADMIN_OPENIDS.length === 0) return true;
  if (ADMIN_OPENIDS.includes(openId)) return true;
  throw new Error('权限不足');
}

function isWarehouseOrAdmin(openId) {
  if (!openId) return false;
  if (WAREHOUSE_OPENIDS.length === 0 && ADMIN_OPENIDS.length === 0) return true;
  return WAREHOUSE_OPENIDS.includes(openId) || ADMIN_OPENIDS.includes(openId);
}

/**
 * 查询货物列表（按手机号）
 */
async function queryByPhone(phone, filter = {}, pagination = { page: 1, pageSize: 20 }) {
  const { page, pageSize } = pagination;
  const skip = (page - 1) * pageSize;

  let query = db.collection('shipments').where({ managerPhone: phone, isDeleted: _.neq(true), ...filter });
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
  const res = await db.collection('shipments').where({ shareToken: token, isDeleted: _.neq(true) }).limit(1).get();
  if (res.data.length === 0) return null;
  return res.data[0];
}

/**
 * 将 shipment 中的 cloud:// fileID 批量转换为临时 HTTPS URL
 * 解决不同角色（不同 openid）无法访问云存储图片的问题
 */
async function convertFileIdsToUrls(shipment) {
  if (!shipment) return;
  const fileIds = [];

  const collect = (id) => {
    if (id && typeof id === 'string' && id.startsWith('cloud://')) fileIds.push(id);
  };

  collect(shipment.attachmentFileId);
  (shipment.measurement?.photos || []).forEach(collect);
  (shipment.timeline || []).forEach(node => (node.photos || []).forEach(collect));

  if (fileIds.length === 0) return;

  try {
    const { fileList } = await cloud.getTempFileURL({ fileList: fileIds });
    const map = {};
    fileList.forEach(item => { if (item.fileID) map[item.fileID] = item.tempFileURL; });

    if (map[shipment.attachmentFileId]) shipment.attachmentFileId = map[shipment.attachmentFileId];
    if (shipment.measurement?.photos) {
      shipment.measurement.photos = shipment.measurement.photos.map(id => map[id] || id);
    }
    if (shipment.timeline) {
      shipment.timeline.forEach(node => {
        if (node.photos) node.photos = node.photos.map(id => map[id] || id);
      });
    }
  } catch (e) {
    console.error('getTempFileURL failed:', e.message);
  }
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

  const shipment = { ...shipmentRes.data, logs: logsRes.data };
  await convertFileIdsToUrls(shipment);
  return shipment;
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
            .where(_.and([
              _.or([
                { factoryName: db.RegExp({ regexp: event.name, options: 'i' }) },
                { clientName: db.RegExp({ regexp: event.name, options: 'i' }) }
              ]),
              { isDeleted: _.neq(true) }
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
          .where({ managerPhone: phone, isDeleted: _.neq(true) })
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
        const adminRes = await db.collection('shipments').where({ isDeleted: _.neq(true) }).orderBy('updatedAt', 'desc').limit(100).get();
        return success({ list: adminRes.data, total: adminRes.data.length });

      case 'warehouseQueue': {
        if (!isWarehouseOrAdmin(OPENID)) return error('权限不足：仅仓管员或管理员可访问');
        // 仓管员：待测量的进仓货物列表
        const { status = 'pending' } = filter || {};
        let q = db.collection('shipments')
          .where({
            'measurement.status': status,
            status: _.neq('completed'),
            isDeleted: _.neq(true)
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
          .where({ creatorOpenId: OPENID, isDeleted: _.neq(true) })
          .orderBy('createdAt', 'desc')
          .limit(100)
          .get();
        const myList = myRes.data.map(item => ({
          _id: item._id,
          factoryName: item.factoryName,
          creatorName: item.creatorName,
          cargoInfo: {
            pieces: item.cargoInfo.pieces,
            piecesUnit: item.cargoInfo.piecesUnit,
            grossWeight: item.cargoInfo.grossWeight,
            weightUnit: item.cargoInfo.weightUnit,
            volume: item.cargoInfo.volume,
            volumeUnit: item.cargoInfo.volumeUnit
          },
          routeSnapshot: item.routeSnapshot,
          billing: item.billing,
          oaStatus: item.oaStatus,
          oaStatusName: item.oaStatusName,
          currentNodeName: item.currentNodeName,
          status: item.status,
          totalAmount: item.totalAmount,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          shareToken: item.shareToken
        }));
        return success({ list: myList, total: myList.length });
      }

      case 'billList': {
        const { role, phone, status } = event;
        const query = {
          oaStatus: 'billed',
          'billing.paymentType': _.neq('spot'),
          isDeleted: _.neq(true)
        };

        if (status) {
          query['billing.paymentStatus'] = status;
        }

        if (role !== 'admin') {
          if (!phone) return paramError('缺少phone参数');
          query.managerPhone = phone;
        }

        const billRes = await db.collection('shipments')
          .where(query)
          .orderBy('updatedAt', 'desc')
          .limit(100)
          .get();

        return success({
          list: billRes.data,
          total: billRes.data.length
        });
      }

      case 'billCount': {
        const { role, phone } = event;
        const query = {
          oaStatus: 'billed',
          'billing.paymentType': _.neq('spot'),
          'billing.paymentStatus': _.neq('paid'),
          isDeleted: _.neq(true)
        };

        if (role !== 'admin') {
          if (!phone) return paramError('缺少phone参数');
          query.managerPhone = phone;
        }

        const countRes = await db.collection('shipments')
          .where(query)
          .count();

        return success({ count: countRes.total });
      }

      case 'workflowList': {
        const { role, includeCompleted = false } = event;
        if (!role) return paramError('缺少role参数');

        let pendingQuery = {};
        let storedQuery = {};
        let completedQuery = {};

        let billingQuery = {};

        if (role === 'warehouse') {
          // 仓管员分类基于物流节点状态
          pendingQuery = {
            timeline: _.elemMatch({ status: 'active', nodeCode: 'pickup' }),
            isDeleted: _.neq(true)
          };
          storedQuery = {
            timeline: _.elemMatch({ status: 'active', nodeCode: 'yiwu_entry' }),
            isDeleted: _.neq(true)
          };
          completedQuery = _.or([
            { timeline: _.elemMatch({ status: 'active', nodeCode: _.in(['mainline', 'nb_entry']) }), isDeleted: _.neq(true) },
            { status: 'completed', isDeleted: _.neq(true) }
          ]);
        } else if (role === 'admin') {
          // 管理员四分类：待处理 / 已入库 / 账单 / 已完结
          pendingQuery = { oaStatus: 'measured_priced', isDeleted: _.neq(true) };
          storedQuery = { oaStatus: 'admin_confirmed', isDeleted: _.neq(true) };
          billingQuery = { oaStatus: 'billed', 'billing.paymentType': _.neq('spot'), isDeleted: _.neq(true) };
          completedQuery = { oaStatus: 'completed', isDeleted: _.neq(true) };
        } else {
          pendingQuery = { oaStatus: _.neq('completed'), oaAssignedTo: role, isDeleted: _.neq(true) };
          storedQuery = { oaStatus: 'none' };
          completedQuery = { oaStatus: 'completed', isDeleted: _.neq(true) };
        }

        const pendingRes = await db.collection('shipments')
          .where(pendingQuery)
          .orderBy('updatedAt', 'desc')
          .limit(100)
          .get();

        const storedRes = await db.collection('shipments')
          .where(storedQuery)
          .orderBy('updatedAt', 'desc')
          .limit(100)
          .get();

        let billingRes = { data: [] };
        if (role === 'admin') {
          billingRes = await db.collection('shipments')
            .where(billingQuery)
            .orderBy('updatedAt', 'desc')
            .limit(100)
            .get();
        }

        let completed = [];
        if (includeCompleted) {
          if (role === 'warehouse') {
            const res = await db.collection('shipments')
              .where(completedQuery)
              .orderBy('updatedAt', 'desc')
              .limit(50)
              .get();
            completed = res.data;
          } else {
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const res = await db.collection('shipments')
              .where({
                oaStatus: 'completed',
                updatedAt: _.gte(sevenDaysAgo),
                isDeleted: _.neq(true)
              })
              .orderBy('updatedAt', 'desc')
              .limit(50)
              .get();
            completed = res.data;
          }
        }

        return success({
          pending: pendingRes.data,
          stored: storedRes.data,
          billing: billingRes.data,
          completed,
          totalPending: pendingRes.data.length
        });
      }

      case 'pendingCount': {
        const { role } = event;
        if (!role) return paramError('缺少role参数');

        let countQuery;
        if (role === 'warehouse') {
          // 仓管员：与 workflowList 逻辑一致，统计待处理(pickup) + 已入库(yiwu_entry)
          countQuery = {
            timeline: _.elemMatch({
              status: 'active',
              nodeCode: _.in(['pickup', 'yiwu_entry'])
            }),
            isDeleted: _.neq(true)
          };
        } else if (role === 'admin') {
          // 管理员：统计所有有气泡的tab（待处理+已入库+已发账单）
          countQuery = {
            oaStatus: _.in(['measured_priced', 'admin_confirmed', 'billed']),
            isDeleted: _.neq(true)
          };
        } else {
          countQuery = {
            oaStatus: _.neq('completed'),
            oaAssignedTo: role,
            isDeleted: _.neq(true)
          };
        }

        const countRes = await db.collection('shipments')
          .where(countQuery)
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
