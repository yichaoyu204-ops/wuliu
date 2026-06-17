/**
 * 费用类目管理云函数
 * list: 所有角色可调用，获取已启用的类目（报价时用）
 * create/update: 仅管理员，增改类目，不需要改代码就能扩展
 *
 * 安全设计：
 * - OPENID 从云函数 WXContext 获取，前端无法伪造
 * - 管理员白名单未配置时，create/update 直接拒绝，不留后门
 * - 所有写入字段白名单过滤，防止字段注入
 * - 金额统一精度处理，防止浮点数污染数据库
 */

const cloud = require('wx-server-sdk');
const { success, error, paramError } = require('./utils/response');
const { formatMoney } = require('./utils/formatMoney');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 管理员 OpenID 白名单
// 在微信开发者工具「云开发 → 用户管理」查自己的 OpenID 并填入
// 注意：数组为空时，create/update 操作将全部拒绝（安全兜底，不留后门）
const ADMIN_OPENIDS = [
  // 'o-xxxxxxxxxxxxxxxxxxxxx',
];

const DEFAULT_CATEGORIES = [
  {
    _id: 'cat_inbound_transport',
    name: '进仓运费',
    type: 'baseTransport',
    calculationType: 'manual',
    basePrice: null,
    unitPrice: null,
    unit: '元',
    freeDays: null,
    isRequired: true,
    isEnabled: true,
    allowManualAmount: true,
    sortOrder: 1,
    description: '按路线与体积吨比计算'
  },
  {
    _id: 'cat_collection',
    name: '代收款',
    type: 'collection',
    calculationType: 'manual',
    basePrice: null,
    unitPrice: null,
    unit: '元',
    freeDays: null,
    isRequired: false,
    isEnabled: true,
    allowManualAmount: true,
    sortOrder: 2,
    description: '按海通/北仑代收项目录入'
  },
  {
    _id: 'cat_pickup',
    name: '上门提货费',
    type: 'pickup',
    calculationType: 'fixed',
    basePrice: 50,
    unitPrice: null,
    unit: '元/次',
    freeDays: null,
    isRequired: false,
    isEnabled: true,
    allowManualAmount: false,
    sortOrder: 3,
    description: '直接去义乌周边工厂上门提货'
  },
  {
    _id: 'cat_storage',
    name: '集货点堆存费',
    type: 'storage',
    calculationType: 'manual',
    basePrice: null,
    unitPrice: 50,
    unit: '元/票/天',
    freeDays: 5,
    isRequired: false,
    isEnabled: true,
    allowManualAmount: true,
    sortOrder: 4,
    description: '超过5天收取堆存费'
  },
  {
    _id: 'cat_relabel',
    name: '贴唛改唛费',
    type: 'relabel',
    calculationType: 'per_piece',
    basePrice: null,
    unitPrice: 2,
    unit: '元/件',
    freeDays: null,
    isRequired: false,
    isEnabled: true,
    allowManualAmount: false,
    sortOrder: 5,
    description: '加贴唛头或改动唛头'
  },
  {
    _id: 'cat_beilun_distribution',
    name: '其他-北仑分拨费',
    type: 'beilunDistribution',
    calculationType: 'fixed',
    basePrice: 120,
    unitPrice: null,
    unit: '元/票',
    freeDays: null,
    isRequired: false,
    isEnabled: true,
    allowManualAmount: false,
    sortOrder: 6,
    description: '义乌发北仑下货点后再小车分拨'
  },
  {
    _id: 'cat_transfer',
    name: '转运费',
    type: 'transfer',
    calculationType: 'manual',
    basePrice: null,
    unitPrice: null,
    unit: '元',
    freeDays: null,
    isRequired: false,
    isEnabled: true,
    allowManualAmount: true,
    sortOrder: 7,
    description: '义乌地区分档，非义乌地区单独报价'
  },
  {
    _id: 'cat_other',
    name: '其他费用',
    type: 'other',
    calculationType: 'manual',
    basePrice: null,
    unitPrice: null,
    unit: '元',
    freeDays: null,
    isRequired: false,
    isEnabled: true,
    allowManualAmount: true,
    sortOrder: 99,
    description: '手写类目名称和金额'
  }
];

// 精度安全的乘法，避免 JS 浮点污染（如 0.1 * 0.2 = 0.020000000000000004）
function safeMultiply(a, b) {
  return Math.round((a || 0) * (b || 0) * 100) / 100;
}

// 根据类目配置 + 实测数据自动预算金额
function calculateAmount(category, measurement) {
  const actual = measurement?.actual || {};
  switch (category.calculationType) {
    case 'fixed':
      return formatMoney(category.basePrice);
    case 'per_piece':
      return actual.pieces != null ? formatMoney(safeMultiply(category.unitPrice, actual.pieces)) : null;
    case 'per_volume':
      return actual.volume != null ? formatMoney(safeMultiply(category.unitPrice, actual.volume)) : null;
    case 'per_weight':
      return actual.weight != null ? formatMoney(safeMultiply(category.unitPrice, actual.weight)) : null;
    // 需要业务补充数量、天数或单独报价的类目，由前端实测页录入后再保存
    case 'per_volume_per_day':
    case 'manual':
    default:
      return null;
  }
}

function normalizeCategory(category) {
  if (category?._id === 'cat_beilun_distribution' || category?.type === 'beilunDistribution') {
    return { ...category, name: '其他-北仑分拨费' };
  }
  return category;
}

// 权限校验：OPENID 来自云函数上下文，前端无法伪造
// 代码白名单 + 环境变量 ADMIN_LIST（逗号分隔），云后台可动态修改无需发版
function checkAdmin(openId) {
  if (!openId) throw new Error('无法获取用户身份，请重新登录');
  const envAdmins = process.env.ADMIN_LIST ? process.env.ADMIN_LIST.split(',').map(s => s.trim()) : [];
  if (ADMIN_OPENIDS.includes(openId) || envAdmins.includes(openId)) return true;
  throw new Error('权限不足：非管理员无法修改计费规则');
}

// 查询已启用类目；数据库为空时自动播种默认数据
// 播种用 doc(_id).set() 保留语义 ID，并发时重复写入被吞掉，避免竞态产生重复数据
async function listCategories(measurement) {
  try {
    const res = await db.collection('fee_categories')
      .where({ isEnabled: true })
      .orderBy('sortOrder', 'asc')
      .get();

    let categories = res.data;

    if (categories.length === 0) {
      console.log('fee_categories 为空，执行自动播种');
      await Promise.all(
        DEFAULT_CATEGORIES.map(cat =>
          db.collection('fee_categories')
            .doc(cat._id)
            .set({
              data: {
                ...cat,
                createdAt: db.serverDate(),
                updatedAt: db.serverDate()
              }
            })
            .catch(err => {
              // 并发重复写入或已存在时静默跳过
              if (err.errCode !== -502001) console.warn('播种类目失败:', cat._id, err.message);
            })
        )
      );
      categories = DEFAULT_CATEGORIES;
    }

    const normalizedCategories = categories.map(normalizeCategory);
    normalizedCategories.forEach(cat => {
      if ((cat._id === 'cat_beilun_distribution' || cat.type === 'beilunDistribution') && cat.name !== categories.find(item => item._id === cat._id)?.name) {
        db.collection('fee_categories').doc(cat._id).update({
          data: { name: cat.name, updatedAt: db.serverDate() }
        }).catch(err => console.warn('同步费用类目名称失败:', cat._id, err.message));
      }
    });

    return normalizedCategories.map(cat => ({
      ...cat,
      calculatedAmount: measurement ? calculateAmount(cat, measurement) : null
    }));
  } catch (err) {
    console.warn('fee_categories 查询失败，降级用内置配置:', err.message);
    return DEFAULT_CATEGORIES.map(cat => ({ ...cat, calculatedAmount: null }));
  }
}

// 新增费用类目（仅管理员）
async function createCategory(data) {
  const { name, type, calculationType, basePrice, unitPrice, unit,
    freeDays, isRequired, allowManualAmount, sortOrder, description } = data;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('name 为必填项且必须是字符串');
  }
  if (!type || typeof type !== 'string') {
    throw new Error('type 为必填项且必须是字符串');
  }

  const VALID_CALC_TYPES = ['fixed', 'per_piece', 'per_volume', 'per_weight', 'per_volume_per_day', 'manual'];
  const calcType = calculationType || 'manual';
  if (!VALID_CALC_TYPES.includes(calcType)) {
    throw new Error('calculationType 值非法');
  }

  // 业务防呆：type 全局唯一，防止重复定义导致报价混乱
  const typeTrimmed = type.trim();
  const dupCheck = await db.collection('fee_categories')
    .where({ type: typeTrimmed })
    .limit(1)
    .get();
  if (dupCheck.data.length > 0) {
    throw new Error(`费用类型 "${typeTrimmed}" 已存在，请直接修改原类目`);
  }

  const doc = {
    name: name.trim().substring(0, 20),              // 限制长度
    type: type.trim().substring(0, 30),
    calculationType: calcType,
    basePrice: formatMoney(basePrice),               // 统一精度处理
    unitPrice: formatMoney(unitPrice),
    unit: (unit || '元').substring(0, 10),
    freeDays: freeDays != null ? Math.max(0, parseInt(freeDays) || 0) : null,
    isRequired: isRequired === true,
    isEnabled: true,
    allowManualAmount: allowManualAmount != null ? Boolean(allowManualAmount) : (calcType === 'manual'),
    sortOrder: Math.max(0, parseInt(sortOrder) || 50),
    description: (description || '').substring(0, 50),
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  };

  const res = await db.collection('fee_categories').add({ data: doc });
  return { _id: res._id, ...doc };
}

// 更新费用类目（仅管理员）
// 禁用用 isEnabled: false，不物理删除，历史报价引用不受影响
// 价格变更时自动留痕，方便事后对账追溯
async function updateCategory(id, data, operatorOpenId) {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('id 参数非法');
  }

  const oldDoc = await db.collection('fee_categories').doc(id).get();
  const old = oldDoc.data;

  // 白名单字段过滤，防止注入 _id / createdAt 等敏感字段
  const ALLOWED = ['name', 'calculationType', 'basePrice', 'unitPrice', 'unit',
    'freeDays', 'isRequired', 'isEnabled', 'allowManualAmount', 'sortOrder', 'description'];

  const updateData = { updatedAt: db.serverDate() };
  const priceChanges = [];

  ALLOWED.forEach(field => {
    if (data[field] === undefined) return;
    if (['basePrice', 'unitPrice'].includes(field)) {
      const newVal = formatMoney(data[field]);
      if (old[field] != newVal) {
        priceChanges.push({ field, from: old[field] ?? null, to: newVal });
      }
      updateData[field] = newVal;
    } else if (['isRequired', 'isEnabled', 'allowManualAmount'].includes(field)) {
      updateData[field] = Boolean(data[field]);
    } else if (['sortOrder', 'freeDays'].includes(field)) {
      updateData[field] = data[field] != null ? Math.max(0, parseInt(data[field]) || 0) : null;
    } else {
      updateData[field] = String(data[field] || '').substring(0, 50);
    }
  });

  if (priceChanges.length > 0) {
    updateData.priceHistory = db.command.push({
      each: priceChanges.map(c => ({
        ...c,
        changedAt: db.serverDate(),
        changedBy: operatorOpenId
      }))
    });
  }

  await db.collection('fee_categories').doc(id).update({ data: updateData });
  return { _id: id, updated: updateData, priceChanges };
}

// 云函数入口
exports.main = async (event, context) => {
  const { action, data, id, measurement } = event;
  const { OPENID } = cloud.getWXContext();

  try {
    switch (action) {
      case 'list':
        return success(await listCategories(measurement));

      case 'create':
        checkAdmin(OPENID);
        if (!data) return paramError('缺少 data 参数');
        return success(await createCategory(data), '费用类目创建成功');

      case 'update':
        checkAdmin(OPENID);
        if (!id || !data) return paramError('缺少 id 或 data 参数');
        return success(await updateCategory(id, data, OPENID), '费用类目更新成功');

      default:
        return paramError('未知的 action，支持：list / create / update');
    }
  } catch (err) {
    console.error('[fee-config]', action, err.message);
    return error(err.message);
  }
};
