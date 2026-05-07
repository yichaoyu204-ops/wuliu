/**
 * 统一响应格式
 * 可修改以适配不同的API规范
 */

const config = require('../config');
const { codes } = config;

function success(data = null, message = 'success') {
  return { code: codes.SUCCESS, message, data, timestamp: new Date().toISOString() };
}

function error(message = 'error', code = codes.ERROR, extra = {}) {
  return { code, message, ...extra, timestamp: new Date().toISOString() };
}

function paramError(message = '参数错误') { return error(message, codes.PARAM_ERROR); }
function unauthorized(message = '未授权') { return error(message, codes.UNAUTHORIZED); }
function notFound(message = '未找到') { return error(message, codes.NOT_FOUND); }

module.exports = { success, error, paramError, unauthorized, notFound };