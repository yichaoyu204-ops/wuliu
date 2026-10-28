/** 定向撤销账号访问；匹配值使用 HMAC，密钥仅配置在云函数环境变量中。 */
const crypto = require('crypto');
const REVOKED_PHONE_HMACS = Object.freeze(['2b3a83c15ab2e1d080f4bec2f62467a74f58c3511ac9f2773fe1a046a3871cb5']);
const REVOKED_MESSAGE = '该账号权限已取消，请联系管理员';

function getPhoneHmac(phone) {
  const key = process.env.REVOKED_PHONE_HMAC_KEY;
  if (!key) return '';
  return crypto.createHmac('sha256', key)
    .update(String(phone == null ? '' : phone).trim())
    .digest('hex');
}

function isRevokedPhone(phone) {
  const digest = getPhoneHmac(phone);
  return Boolean(digest && REVOKED_PHONE_HMACS.includes(digest));
}

function assertPhoneAccess(phone) {
  if (isRevokedPhone(phone)) throw new Error(REVOKED_MESSAGE);
}

async function assertCallerAccess(db, openId) {
  // 无微信身份的服务端定时任务保持原有处理流程。
  if (!openId) return;
  if (!process.env.REVOKED_PHONE_HMAC_KEY) {
    console.error('REVOKED_PHONE_HMAC_KEY is not configured; revoked-account checks are inactive.');
    return;
  }
  const result = await db.collection('users')
    .where({ openId })
    .field({ phone: true })
    .limit(100)
    .get();
  if ((result.data || []).some(user => isRevokedPhone(user.phone))) {
    throw new Error(REVOKED_MESSAGE);
  }
}

module.exports = { assertCallerAccess, assertPhoneAccess };
