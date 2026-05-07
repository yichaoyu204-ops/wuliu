/**
 * 用户登录认证云函数
 * 管理员需要手机号+密码，其他角色只需手机号
 */

const cloud = require('wx-server-sdk');
const { success, error, paramError } = require('./utils/response');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

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

// 管理员登录：验证手机号+密码
async function adminLogin(phone, password, name) {
  if (!phone || !password) {
    throw new Error('请输入手机号和密码');
  }

  const userRes = await db.collection('users').where({
    phone,
    role: 'admin'
  }).limit(1).get();

  if (userRes.data.length === 0) {
    throw new Error('管理员账号不存在');
  }

  const user = userRes.data[0];
  if (user.password !== password && user.password !== simpleHash(password)) {
    throw new Error('密码错误');
  }

  // 如果提供了新名字，更新用户记录
  if (name && name !== user.name) {
    await db.collection('users').where({ phone, role: 'admin' }).update({
      data: { name, updatedAt: db.serverDate() }
    });
  }

  return {
    phone,
    role: 'admin',
    name: name || user.name || '管理员'
  };
}

// 普通角色登录：无需密码，记录用户即可
async function normalLogin(phone, role, name) {
  if (!phone) {
    throw new Error('请输入手机号');
  }
  if (!['salesman', 'warehouse'].includes(role)) {
    throw new Error('不支持的角色类型');
  }

  // 查找或创建用户记录
  const userRes = await db.collection('users').where({ phone, role }).limit(1).get();

  if (userRes.data.length === 0) {
    // 首次使用，创建记录
    await db.collection('users').add({
      data: {
        phone,
        role,
        name: name || '',
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });
  } else {
    // 更新用户信息和最近登录时间
    const updateData = { updatedAt: db.serverDate() };
    if (name) {
      updateData.name = name;
    }
    await db.collection('users').where({ phone, role }).update({
      data: updateData
    });
  }

  const roleNameMap = {
    salesman: '业务员',
    warehouse: '仓管员'
  };

  return {
    phone,
    role,
    name: name || roleNameMap[role] || role
  };
}

// 云函数入口
exports.main = async (event, context) => {
  const { action, phone, password, role } = event;

  try {
    switch (action) {
      case 'login': {
        if (!role) return paramError('缺少角色参数');

        let userInfo;
        if (role === 'admin') {
          userInfo = await adminLogin(phone, password, event.name);
        } else {
          userInfo = await normalLogin(phone, role, event.name);
        }

        return success(userInfo, '登录成功');
      }

      case 'getPhone': {
        // 微信一键登录：通过 cloudID 获取手机号
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

        // 非管理员自动登录/注册
        const userInfo = await normalLogin(phone, role, event.name);

        return success({ ...userInfo, phone }, '登录成功');
      }

      case 'createAdmin': {
        // 首次部署时手动调用，创建管理员账号
        // 用法：{ action: 'createAdmin', phone: '138xxxx', password: 'your_password' }
        if (!phone || !password) return paramError('缺少手机号或密码');

        // 检查是否已存在
        const existRes = await db.collection('users').where({ phone, role: 'admin' }).limit(1).get();
        if (existRes.data.length > 0) {
          return error('该手机号已注册为管理员');
        }

        await db.collection('users').add({
          data: {
            phone,
            role: 'admin',
            password: simpleHash(password),
            name: '管理员',
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });

        return success({ phone }, '管理员账号创建成功');
      }

      case 'init': {
        // 系统初始化：自动创建预设管理员账号
        // 如需修改预设账号，请直接修改下方 ADMIN_PHONE 和 ADMIN_PASSWORD
        const ADMIN_PHONE = '18268685702';
        const ADMIN_PASSWORD = '962504248yyc';

        // 检查是否已存在
        const existRes = await db.collection('users').where({ phone: ADMIN_PHONE, role: 'admin' }).limit(1).get();
        if (existRes.data.length > 0) {
          return success({ phone: ADMIN_PHONE }, '管理员账号已存在，无需重复创建');
        }

        await db.collection('users').add({
          data: {
            phone: ADMIN_PHONE,
            role: 'admin',
            password: simpleHash(ADMIN_PASSWORD),
            name: '管理员1',
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });

        return success({ phone: ADMIN_PHONE }, '管理员账号初始化成功');
      }

      default:
        return paramError('未知的 action');
    }
  } catch (err) {
    console.error('[user-login] error:', err);
    return error(err.message || '服务器内部错误');
  }
};
