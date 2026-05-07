/**
 * 单号生成器
 * 格式：年份后两位 + MH + 6位随机数字
 * 修改此处可改变单号格式，不影响历史单号
 */

const crypto = require('crypto');

function generateRandomCode() {
  const randomBytes = crypto.randomBytes(4);
  const randomNum = randomBytes.readUInt32BE(0);
  return (randomNum % 1000000).toString().padStart(6, '0');
}

/**
 * 生成运单号
 * 修改此处可自定义单号规则
 */
async function generateWaybillId(db) {
  const yearSuffix = new Date().getFullYear().toString().slice(-2);
  const maxRetries = 10;
  let retries = 0;

  while (retries < maxRetries) {
    const randomCode = generateRandomCode();
    const waybillId = `${yearSuffix}MH${randomCode}`;

    try {
      const existing = await db.collection('shipments').doc(waybillId).get();
      if (!existing.data) return waybillId;
      retries++;
    } catch (e) {
      return waybillId;
    }
  }

  throw new Error('无法生成唯一单号，请重试');
}

function generateShareToken() {
  const randomBytes = crypto.randomBytes(8);
  return 'tk_' + randomBytes.toString('hex').substring(0, 12);
}

module.exports = { generateWaybillId, generateShareToken };