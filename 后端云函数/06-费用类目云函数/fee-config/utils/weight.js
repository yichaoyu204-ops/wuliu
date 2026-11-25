// Shared with the independently deployed fee-config cloud function.
const KG_PER_UNIT = { kg: 1, lb: 0.45359237, t: 1000 };
const UNIT_NAMES = {
  kg: ['kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos', '公斤', '千克'],
  lb: ['lb', 'lbs', 'pound', 'pounds', '磅', '英磅', '℔', '#'],
  t: ['t', 'mt', 'tonne', 'tonnes', 'metric ton', 'metric tons',
    'metric tonne', 'metric tonnes', '吨', '公吨', '噸', '公噸']
};
const CNY_LABEL = /^(?:元|人民币|人民币元|人民幣|人民幣元|¥|cny|rmb|yuan)$/;

function isMissing(label) {
  return label == null || (typeof label === 'string' && label.trim() === '');
}

function normalizeLabel(label) {
  if (typeof label !== 'string') return '';
  return label.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function canonicalWeightUnit(label) {
  const name = normalizeLabel(label).replace(/\.$/, '');
  return Object.keys(UNIT_NAMES).find(unit => UNIT_NAMES[unit].includes(name)) || null;
}

function weightInUnit(value, fromUnit, toUnit) {
  const from = isMissing(fromUnit) ? 'kg' : canonicalWeightUnit(fromUnit);
  const to = canonicalWeightUnit(toUnit);
  if (!from || !to) return null;

  // Reject non-numeric input instead of coercing blanks or booleans to zero.
  let weight = value;
  if (typeof value === 'string' && /^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) {
    weight = Number(value);
  }
  if (!Number.isFinite(weight) || weight < 0) return null;
  if (from === to) return weight;
  const converted = (weight * KG_PER_UNIT[from]) / KG_PER_UNIT[to];
  return Number.isFinite(converted) ? converted : null;
}

function weightRateUnit(label) {
  // A currency alone does not identify the weight basis of a saved price.
  const normalized = normalizeLabel(label);
  const direct = canonicalWeightUnit(normalized);
  if (direct) return direct;

  const parts = normalized.split(/\s*(?:\/|每|\bper\b)\s*/);
  if (parts.length !== 2 || (parts[0] && !CNY_LABEL.test(parts[0]))) return null;
  return canonicalWeightUnit(parts[1]);
}

module.exports = { weightInUnit, weightRateUnit, canonicalWeightUnit };
