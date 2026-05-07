/**
 * 金额精度处理
 * 用 Math.round 避免 toFixed 的边缘舍入错误（如 1.005 -> 1.00）
 * 逻辑计算层专用，返回 Number 类型
 */
function formatMoney(num) {
  if (num === null || num === undefined) return null;
  const n = Number(num);
  if (isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}

/**
 * 金额展示格式化
 * 强制两位小数 + 千分位逗号，用于报价单、账单等展示场景
 */
function toCurrency(num) {
  const val = formatMoney(num);
  if (val === null) return '——';
  return val.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

module.exports = { formatMoney, toCurrency };
