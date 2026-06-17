/**
 * 用户登录认证云函数
 * 管理员/接单员需要手机号+密码；业务员首次登录自动绑定
 */

const cloud = require('wx-server-sdk');
const { success, error, paramError } = require('./utils/response');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 简单的密码哈希（实际生产环境请用 bcrypt 等）
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return String(hash);
}

function normalizeName(name) {
  return String(name || '').trim();
}

async function bindOpenIdToUser(user, updateData) {
  await db.collection('users').doc(user._id).update({
    data: {
      ...updateData,
      updatedAt: db.serverDate()
    }
  });
}

async function requireAdmin(openId) {
  if (!openId) {
    throw new Error('无法完成身份校验，请重新进入小程序');
  }

  const userRes = await db.collection('users').where({
    openId,
    role: 'admin'
  }).limit(1).get();

  if (userRes.data.length === 0) {
    throw new Error('权限不足：仅管理员可操作');
  }

  return userRes.data[0];
}

async function ensurePresetAccountForLogin(phone, role) {
  const preset = PRESET_ACCOUNTS.find(account => account.phone === phone && account.role === role);
  if (!preset) return null;

  await upsertPresetAccount(preset);
  const existRes = await db.collection('users').where({ phone, role }).limit(1).get();
  if (existRes.data.length > 0) return existRes.data[0];

  return null;
}

function isPresetAccount(phone, role) {
  return PRESET_ACCOUNTS.some(account => account.phone === phone && account.role === role);
}

// 管理员登录：验证手机号+密码，并绑定当前登录身份
async function adminLogin(phone, password, name, openId) {
  if (!phone || !password) {
    throw new Error('请输入手机号和密码');
  }
  const cleanName = normalizeName(name);
  if (!cleanName) {
    throw new Error('请输入姓名');
  }
  if (!openId) {
    throw new Error('无法完成身份校验，请重新进入小程序');
  }

  const presetUser = await ensurePresetAccountForLogin(phone, 'admin');

  const userRes = await db.collection('users').where({
    phone,
    role: 'admin'
  }).limit(1).get();

  const user = userRes.data[0] || presetUser;
  if (!user) {
    throw new Error('管理员账号不存在');
  }

  if (cleanName !== normalizeName(user.name)) {
    throw new Error('姓名、手机号或密码不匹配');
  }

  if (user.password !== password && user.password !== simpleHash(password)) {
    throw new Error('密码错误');
  }

  if (user.openId && user.openId !== openId && !isPresetAccount(phone, 'admin')) {
    throw new Error('该管理员账号已绑定其他登录身份');
  }

  await bindOpenIdToUser(user, { openId });

  return {
    userId: user._id,
    phone,
    role: 'admin',
    name: user.name || '管理员',
    openId
  };
}

// 普通角色登录：业务员自动创建；接单员必须由后台预置并校验密码后再绑定登录身份
async function normalLogin(phone, role, name, openId, password) {
  if (!phone) {
    throw new Error('请输入手机号');
  }
  if (!name || !String(name).trim()) {
    throw new Error('请输入姓名');
  }
  if (!openId) {
    throw new Error('无法完成身份校验，请重新进入小程序');
  }
  if (!['salesman', 'warehouse'].includes(role)) {
    throw new Error('不支持的角色类型');
  }

  const cleanName = normalizeName(name);

  const openIdRes = await db.collection('users').where({ openId, role }).limit(1).get();
  const phoneRes = await db.collection('users').where({ phone, role }).limit(1).get();
  const openIdUser = openIdRes.data[0];
  let phoneUser = phoneRes.data[0];

  if (role === 'warehouse') {
    const presetUser = await ensurePresetAccountForLogin(phone, role);
    if (presetUser) phoneUser = presetUser;
  }

  if (role === 'warehouse' && !phoneUser) {
    throw new Error('接单员账号不存在，请联系管理员开通');
  }

  if (role === 'warehouse') {
    if (cleanName !== normalizeName(phoneUser.name)) {
      throw new Error('姓名、手机号或密码不匹配');
    }
    if (!password) {
      throw new Error('请输入密码');
    }
    if (phoneUser.password !== password && phoneUser.password !== simpleHash(password)) {
      throw new Error('密码错误');
    }
  }

  if (phoneUser && phoneUser.openId && phoneUser.openId !== openId && !isPresetAccount(phone, role)) {
    throw new Error('该手机号已绑定其他登录身份');
  }
  if (openIdUser && openIdUser.phone && openIdUser.phone !== phone && (!phoneUser || phoneUser._id !== openIdUser._id)) {
    throw new Error('当前登录身份已绑定其他手机号');
  }

  const targetUser = phoneUser || openIdUser;

  if (!targetUser) {
    if (role !== 'salesman') {
      throw new Error('该账号未开通，请联系管理员');
    }

    const addRes = await db.collection('users').add({
      data: {
        phone,
        role,
        name: cleanName,
        openId,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });
    return {
      userId: addRes._id,
      phone,
      role,
      name: cleanName,
      openId
    };
  } else {
    const bindName = role === 'warehouse' ? phoneUser.name : cleanName;
    await bindOpenIdToUser(targetUser, {
      phone,
      role,
      name: bindName,
      openId
    });
  }

  return {
    userId: targetUser._id,
    phone,
    role,
    name: role === 'warehouse' ? phoneUser.name : cleanName,
    openId
  };
}

async function createWarehouseAccount(phone, name, password, openId) {
  if (!phone) return paramError('缺少手机号');
  if (!password) return paramError('缺少密码');

  const cleanName = name && String(name).trim() ? String(name).trim() : '接单员';
  const adminUser = await requireAdmin(openId);
  const existRes = await db.collection('users').where({
    phone,
    role: 'warehouse'
  }).limit(1).get();

  if (existRes.data.length > 0) {
    return error('该手机号已注册为接单员');
  }

  const addRes = await db.collection('users').add({
    data: {
      phone,
      role: 'warehouse',
      name: cleanName,
      password: simpleHash(password),
      createdBy: adminUser._id,
      createdByOpenId: openId,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  });

  return success({
    userId: addRes._id,
    phone,
    role: 'warehouse',
    name: cleanName
  }, '接单员账号创建成功');
}

async function listManagedAccounts(openId) {
  await requireAdmin(openId);

  const res = await db.collection('users').where({
    role: _.in(['admin', 'warehouse'])
  }).field({
    phone: true,
    role: true,
    name: true,
    openId: true,
    createdAt: true,
    updatedAt: true
  }).get();

  const roleOrder = { admin: 1, warehouse: 2 };
  const list = res.data
    .map(user => ({
      userId: user._id,
      phone: user.phone,
      role: user.role,
      name: user.name,
      bound: !!user.openId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    }))
    .sort((a, b) => {
      const roleDiff = (roleOrder[a.role] || 99) - (roleOrder[b.role] || 99);
      if (roleDiff !== 0) return roleDiff;
      return String(a.phone || '').localeCompare(String(b.phone || ''));
    });

  return success({ list }, '账号列表获取成功');
}

const PRESET_ACCOUNTS = [
  { phone: '18268685702', password: '962504248yyc', name: '管理员1', role: 'admin' },
  { phone: '18268685702', password: '962504248yyc', name: '虞一超', role: 'warehouse' },
  { phone: '18005745533', password: 'yhw739739', name: '虞宏伟', role: 'admin' },
  { phone: '15557041311', password: 'Yh240921', name: '姚慧', role: 'admin' },
  { phone: '13967854310', password: '780412', name: '袁午正', role: 'warehouse' }
];

async function upsertPresetAccount(account) {
  const existRes = await db.collection('users').where({
    phone: account.phone,
    role: account.role
  }).limit(1).get();

  const userData = {
    phone: account.phone,
    role: account.role,
    password: simpleHash(account.password),
    name: account.name,
    updatedAt: db.serverDate()
  };

  if (existRes.data.length === 0) {
    const addRes = await db.collection('users').add({
      data: {
        ...userData,
        createdAt: db.serverDate()
      }
    });
    return { ...account, userId: addRes._id, created: true, updated: false };
  }

  await db.collection('users').doc(existRes.data[0]._id).update({
    data: userData
  });
  return { ...account, userId: existRes.data[0]._id, created: false, updated: true };
}

// 云函数入口
exports.main = async (event, context) => {
  const { action, phone, password, role } = event;
  const { OPENID } = cloud.getWXContext();

  try {
    switch (action) {
      case 'login': {
        if (!role) return paramError('缺少角色参数');

        let userInfo;
        if (role === 'admin') {
          userInfo = await adminLogin(phone, password, event.name, OPENID);
        } else {
          userInfo = await normalLogin(phone, role, event.name, OPENID, password);
        }

        return success(userInfo, '登录成功');
      }

      case 'getPhone': {
        // 手机号快捷登录：通过 cloudID 获取手机号
        if (!role) return paramError('缺少角色参数');
        if (!event.cloudID) return paramError('缺少 cloudID');

        // 解密手机号
        const openData = await cloud.getOpenData({
          list: [event.cloudID]
        });

        const phoneData = openData.list[0];
        if (!phoneData || !phoneData.data || !phoneData.data.phoneNumber) {
          return error('获取手机号失败');
        }

        const phone = phoneData.data.phoneNumber;

        if (role === 'warehouse') {
          return error('接单员请使用账号密码登录');
        }

        // 业务员自动登录/注册
        const userInfo = await normalLogin(phone, role, event.name, OPENID);

        return success({ ...userInfo, phone }, '登录成功');
      }

      case 'createWarehouse': {
        return await createWarehouseAccount(phone, event.name, password, OPENID);
      }

      case 'listManagedAccounts': {
        return await listManagedAccounts(OPENID);
      }

      case 'createAdmin': {
        // 首次部署时可手动调用；已有管理员后，仅管理员可继续创建
        // 用法：{ action: 'createAdmin', phone: '138xxxx', password: 'your_password', name: '管理员姓名' }
        if (!phone || !password) return paramError('缺少手机号或密码');

        const anyAdminRes = await db.collection('users').where({ role: 'admin' }).limit(1).get();
        if (anyAdminRes.data.length > 0) {
          await requireAdmin(OPENID);
        }

        // 检查是否已存在
        const existRes = await db.collection('users').where({ phone, role: 'admin' }).limit(1).get();
        if (existRes.data.length > 0) {
          return error('该手机号已注册为管理员');
        }

        const cleanName = event.name && String(event.name).trim() ? String(event.name).trim() : '管理员';
        await db.collection('users').add({
          data: {
            phone,
            role: 'admin',
            password: simpleHash(password),
            name: cleanName,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });

        return success({ phone, role: 'admin', name: cleanName }, '管理员账号创建成功');
      }

      case 'init': {
        // 系统初始化：自动创建预设管理员/接单员账号
        const accounts = [];
        for (const account of PRESET_ACCOUNTS) {
          accounts.push(await upsertPresetAccount(account));
        }

        return success({
          accounts: accounts.map(({ password, ...account }) => account)
        }, '系统账号初始化成功');
      }

      case 'resetPresetWarehouse': {
        await requireAdmin(OPENID);

        const WAREHOUSE_PHONE = '18268685702';
        const WAREHOUSE_PASSWORD = '962504248yyc';
        const WAREHOUSE_NAME = '虞一超';
        const existRes = await db.collection('users').where({ phone: WAREHOUSE_PHONE, role: 'warehouse' }).limit(1).get();

        if (existRes.data.length === 0) {
          const addRes = await db.collection('users').add({
            data: {
              phone: WAREHOUSE_PHONE,
              role: 'warehouse',
              password: simpleHash(WAREHOUSE_PASSWORD),
              name: WAREHOUSE_NAME,
              createdAt: db.serverDate(),
              updatedAt: db.serverDate()
            }
          });
          return success({
            userId: addRes._id,
            phone: WAREHOUSE_PHONE,
            role: 'warehouse',
            name: WAREHOUSE_NAME
          }, '接单员账号创建成功');
        }

        await db.collection('users').doc(existRes.data[0]._id).update({
          data: {
            password: simpleHash(WAREHOUSE_PASSWORD),
            name: WAREHOUSE_NAME,
            updatedAt: db.serverDate()
          }
        });

        return success({
          userId: existRes.data[0]._id,
          phone: WAREHOUSE_PHONE,
          role: 'warehouse',
          name: WAREHOUSE_NAME
        }, '接单员账号已更新');
      }

      default:
        return paramError('未知的 action');
    }
  } catch (err) {
    console.error('[user-login] error:', err);
    return error(err.message || '服务器内部错误');
  }
};
