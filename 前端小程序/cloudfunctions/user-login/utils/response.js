function success(data = null, message = 'success') {
  return { code: 0, message, data, timestamp: new Date().toISOString() };
}

function error(message = 'error', code = -1) {
  return { code, message, timestamp: new Date().toISOString() };
}

function paramError(message = '参数错误') {
  return error(message, 400);
}

module.exports = { success, error, paramError };
