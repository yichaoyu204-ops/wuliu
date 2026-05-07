/**
 * 创建货物云函数
 * 此文件修改不会影响历史已创建的货物
 */

const cloud = require('wx-server-sdk');
const config = require('./config');
const { generateWaybillId, generateShareToken } = require('./utils/idGenerator');
const { success, error, paramError } = require('./utils/response');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

/**
 * 获取路线配置 - 从config中动态读取
 * 修改config/index.js中的defaultRoutes即可添加新路线
 */
function getRouteById(routeId) {
  const route = config.defaultRoutes.find(r => r.id === routeId);
  if (!route) throw new Error('路线不存在，请在config中配置');
  return route;
}

/**
 * 初始化节点时间线
 * 节点数据从config中读取，可随时修改config来增删节点
 */
function initTimeline(route) {
  return route.nodes.map((node, index) => ({
    nodeCode: node.code,
    nodeName: node.name,
    status: index === 0 ? 'active' : 'pending',
    operator: '',
    phone: '',
    photos: [],
    remark: '',
    timestamp: index === 0 ? db.serverDate() : null
  }));
}

// 司机提交：存入 driver_submissions 集合等待管理员复核
async function driverSubmit(event) {
  const { cargoInfo, contacts, routing, imageUrl } = event;
  const { OPENID } = cloud.getWXContext();

  if (!cargoInfo || !contacts || !contacts.contact1Phone) {
    return paramError('缺少必要参数');
  }
  if (!imageUrl) {
    return paramError('请上传进仓单照片');
  }

  const doc = {
    cargoInfo: {
      warehouseEntryNo: cargoInfo.warehouseEntryNo || '',
      waybillNo: cargoInfo.waybillNo || '',
      pieces: Number(cargoInfo.pieces) || 0,
      piecesUnit: cargoInfo.piecesUnit || 'CTNS',
      grossWeight: Number(cargoInfo.grossWeight) || 0,
      weightUnit: cargoInfo.weightUnit || 'KGS',
      volume: Number(cargoInfo.volume) || 0,
      volumeUnit: cargoInfo.volumeUnit || 'CBM',
      marks: cargoInfo.marks || ''
    },
    contacts,
    routing: {
      warehouseName: routing?.warehouseName || '',
      warehouseAddress: routing?.warehouseAddress || '',
      destinationPort: routing?.destinationPort || '',
      entryTime: routing?.entryTime || null,
      departureTime: routing?.departureTime || null,
      latestDeliveryTime: routing?.latestDeliveryTime || null
    },
    imageUrl,
    driverOpenId: OPENID || '',
    status: 'pending_review',   // pending_review | approved | rejected
    adminReview: {
      reviewedBy: null,
      reviewedAt: null,
      note: '',
      shipmentId: null
    },
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  };

  await db.collection('driver_submissions').add({ data: doc });
  return success({ submissionId: doc._id }, '提交成功，等待管理员复核');
}

// 云函数入口
exports.main = async (event, context) => {
  const { action } = event;

  // 司机提交进仓单（无需权限）
  if (action === 'driverSubmit') {
    return driverSubmit(event);
  }

  const {
    cargoInfo,
    routing,
    contacts,
    routeId = 'route_yw_nb_standard',  // 默认路线
    clientType = 'salesman',
    paymentType = 'monthly'  // monthly | spot
  } = event;

  if (!cargoInfo || !contacts || !contacts.contact1Phone) {
    return paramError('缺少必要参数');
  }

  // 获取当前用户 OPENID
  const { OPENID } = cloud.getWXContext();

  try {
    // 获取路线配置（可配置）
    const route = getRouteById(routeId);

    // 运单号去重检查（waybillNo 非空时，排除已删除）
    const waybillNo = cargoInfo.waybillNo || '';
    if (waybillNo.trim()) {
      const dupRes = await db.collection('shipments').where({
        'cargoInfo.waybillNo': waybillNo.trim(),
        isDeleted: _.neq(true)
      }).limit(1).get();
      if (dupRes.data.length > 0) {
        return error(`业务编号 ${waybillNo.trim()} 已存在，请勿重复建单`);
      }
    }

    // 生成单号
    const shipmentId = await generateWaybillId(db);
    const shareToken = generateShareToken();

    // 构建货物文档 - 所有配置都保存在文档中，后续修改config不会影响此文档
    const shipmentDoc = {
      _id: shipmentId,
      managerPhone: contacts.contact1Phone,
      clientType,
      clientName: contacts.contact1Name || '未知',
      contacts: {
        contact1Name: contacts.contact1Name || '',
        contact1Phone: contacts.contact1Phone || '',
        contact2Name: contacts.contact2Name || '',
        contact2Phone: contacts.contact2Phone || ''
      },

      // 货物信息（快照）
      cargoInfo: {
        warehouseEntryNo: cargoInfo.warehouseEntryNo || '',
        waybillNo: cargoInfo.waybillNo || '',
        pieces: Number(cargoInfo.pieces) || 0,
        piecesUnit: cargoInfo.piecesUnit || '件',
        grossWeight: Number(cargoInfo.grossWeight) || 0,
        weightUnit: cargoInfo.weightUnit || 'KGS',
        volume: Number(cargoInfo.volume) || 0,
        volumeUnit: cargoInfo.volumeUnit || 'CBM',
        marks: cargoInfo.marks || ''
      },

      // 路由信息
      routing: {
        warehouseName: routing?.warehouseName || '',
        warehouseAddress: routing?.warehouseAddress || '',
        destinationPort: routing?.destinationPort || '',
        entryTime: routing?.entryTime || null,
        departureTime: routing?.departureTime || null,
        latestDeliveryTime: routing?.latestDeliveryTime || null
      },

      // 路线快照 - 创建时保存，后续config修改不影响
      routeId: route.id,
      routeName: route.name,
      routeSnapshot: route,  // 完整路线配置快照
      currentNodeIndex: 0,
      currentNodeName: route.nodes[0].name,
      status: 'active',
      timeline: initTimeline(route),

      // 费用（初始为空）
      fees: [],
      totalAmount: 0,

      // 仓库实测数据
      measurement: {
        status: 'pending',      // pending | measured
        measuredAt: null,
        measuredBy: null,
        photos: [],
        actual: {
          pieces: null,
          weight: null,
          volume: null,
          weightUnit: 'KGS',
          volumeUnit: 'CBM'
        },
        note: ''
      },

      // 报价单
      quote: {
        status: 'draft',        // draft | sent | confirmed | rejected
        items: [],
        subtotal: 0,
        note: '',
        sentAt: null,
        sentTo: [],
        confirmedAt: null,
        confirmedBy: null,
        rejectedAt: null,
        rejectionReason: ''
      },

      // 账单/支付
      billing: {
        paymentType: paymentType,      // spot | monthly
        paymentStatus: paymentType === 'spot' ? 'unpaid' : 'unpaid',
        paidAt: null,
        paidBy: null,
        paidAmount: 0,
        invoiceNo: '',
        monthlyBatch: null,
        billId: null
      },

      // OA 审批流状态
      oaStatus: 'created',       // created → measured_priced → admin_confirmed → completed
      oaStatusName: '已建单，待仓管员实测定价',
      oaAssignedTo: 'warehouse',  // 当前待处理角色: warehouse | admin
      oaHistory: [
        {
          status: 'created',
          statusName: '已上传进仓单，待工厂确认',
          operator: OPENID || '',
          role: 'salesman',
          timestamp: db.serverDate()
        }
      ],

      // 自动定价结果
      pricing: {
        status: 'pending',       // pending | calculated
        weightPrice: 0,          // 按重量计算的价格
        volumePrice: 0,          // 按体积计算的价格
        finalPrice: 0,           // 最终取高者的价格
        ruleUsed: '',            // weight | volume | whichever_higher
        calculatedAt: null,
        calculatedBy: null
      },

      // 创建者信息
      creatorOpenId: OPENID || '',
      creatorName: event.creatorName || '',

      // 原始进仓单附件
      attachmentFileId: event.attachmentFileId || '',

      // 分享
      shareToken,

      // 通知记录
      notification: {
        lastSentAt: null,
        sentCount: 0
      },

      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    };

    // 保存到数据库
    await db.collection('shipments').add({ data: shipmentDoc });

    // 检查用户绑定状态
    const userRes = await db.collection('users').where({ phone: contacts.contact1Phone }).get();

    return success({
      shipmentId,
      shareToken,
      shareUrl: `/pages/detail/index?token=${shareToken}`,
      currentNode: route.nodes[0].name,
      userBound: userRes.data.length > 0,
      warning: userRes.data.length === 0 ? '该手机号未绑定小程序，通知可能无法送达' : null
    }, '货物创建成功');

  } catch (err) {
    console.error('创建失败:', err);
    return error(err.message);
  }
};