const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const vm = require('node:vm');

const front = path.join(__dirname, '../前端小程序');
const feeConfig = path.join(__dirname, '../后端云函数/06-费用类目云函数/fee-config');

function loadPage(name, wx = {}) {
  const filename = path.join(front, 'pages/admin', name, 'index.js');
  let page;
  vm.runInNewContext(readFileSync(filename, 'utf8'), {
    Page(definition) { page = definition; },
    getApp: () => ({}), require: createRequire(filename), wx, console
  }, { filename });
  page.setData = function (changes, callback) {
    for (const [key, value] of Object.entries(changes)) {
      const fields = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      const last = fields.pop();
      const target = fields.reduce((obj, field) => obj[field], this.data);
      target[last] = value;
    }
    if (callback) callback();
  };
  return page;
}

async function openMeasurement({ weight = 1000, unit = 'LBS', volume = 1, route = 'beilun', actual } = {}) {
  const shipment = {
    routeId: route, cargoInfo: { grossWeight: weight, weightUnit: unit, volume },
    measurement: { actual: actual || { weight: null, weightUnit: 'KGS' } },
    billing: { paymentType: 'spot' }
  };
  let submitted;
  const page = loadPage('measure', {
    cloud: { async callFunction({ name, data }) {
      if (name === 'shipment-query') return { result: { code: 0, data: shipment } };
      assert.equal(name, 'shipment-update');
      assert.equal(data.action, 'measurement');
      submitted = data.data;
      return { result: { code: 0 } };
    } },
    getStorageSync: () => 'warehouse', setStorageSync() {}, removeStorageSync() {}
  });
  page.setData({ shipmentId: 'sample' });
  await page.loadShipment('sample');
  return { page, submitted: () => submitted };
}

const inboundFee = page => page.data.mainFees.find(fee => fee.code === 'inbound_transport').amount;

test('first measurement inherits the declared pounds, bills to cents, and saves the original number and unit', async () => {
  const { page, submitted } = await openMeasurement();
  assert.equal(page.data.form.weightUnit, 'LBS');
  assert.equal(inboundFee(page), 86.18);
  const pickup = page.data.extraFees.findIndex(fee => fee.code === 'pickup');
  page.toggleExtraFee({ currentTarget: { dataset: { idx: pickup } } });
  page.onExtraFeeFieldChange({ currentTarget: { dataset: { idx: pickup, field: 'times' } }, detail: { value: '1' } });
  assert.equal(page.data.extraFees[pickup].amount, 50);
  await page.submit();
  const payload = submitted();
  assert.equal(payload.weight, 1000);
  assert.equal(payload.weightUnit, 'LBS');
  assert.equal(payload.totalAmount, 286.18); // ¥86.18 inbound + ¥150 distribution + ¥50 pickup
});

test('a previous measurement supplies both its number and its unit', async () => {
  const { page } = await openMeasurement({ actual: { weight: 500, weightUnit: 'KGS' } });
  assert.equal(page.data.form.weight, '500');
  assert.equal(page.data.form.weightUnit, 'KGS');
  assert.equal(inboundFee(page), 95);
});

for (const [label, options, expected] of [
  ['Beilun, metric equivalent of 1000 lb', { weight: 453.59237, unit: 'KGS' }, 86.18],
  ['Haitong, 1000 lb', { route: 'haitong' }, 83.91],
  ['Beilun, at four CBM per tonne', { weight: 250, unit: 'KGS' }, 65],
  ['Haitong, below one CBM charged at the one-CBM minimum', { route: 'haitong', weight: 50, unit: 'KGS', volume: 0.4 }, 55],
  ['Beilun, just below four CBM per tonne', { weight: 250.1, unit: 'KGS' }, 47.52],
  ['legacy entry with no unit', { weight: 1000, unit: null }, 190]
]) {
  test(label, async () => assert.equal(inboundFee((await openMeasurement(options)).page), expected));
}

function loadFeeCloud(categories) {
  const filename = path.join(feeConfig, 'index.js');
  const requireLocal = createRequire(filename);
  const query = { where() { return this; }, orderBy() { return this; }, get: async () => ({ data: categories }) };
  const stubs = {
    'wx-server-sdk': { init() {}, database: () => ({ collection: () => query }), getWXContext: () => ({ OPENID: 'test' }) },
    './revoked-access': { assertCallerAccess: async () => {} },
    './utils/response': { success: data => ({ code: 0, data }), error: message => ({ code: 1, message }) }
  };
  const entry = {};
  vm.runInNewContext(readFileSync(filename, 'utf8'), {
    exports: entry, console, require: id => Object.hasOwn(stubs, id) ? stubs[id] : requireLocal(id)
  }, { filename });
  return entry;
}

test('admin quotes and cloud fee previews calculate the same per-weight amount', async () => {
  const page = loadPage('quote');
  const cases = [
    ['元/公斤', 0.19, 86.18], ['元/公吨', 190, 86.18], ['元/磅', 0.125, 125],
    ['元/kg', 0.004, 1.81], ['元', 3, null], ['', 3, null], ['元/件', 3, null]
  ];
  const measurement = { actual: { weight: 1000, weightUnit: 'LBS' } };
  const categories = cases.map(([unit, unitPrice], index) => ({ _id: `c${index}`, calculationType: 'per_weight', unit, unitPrice }));
  const result = await loadFeeCloud(categories).main({ action: 'list', measurement });
  assert.equal(result.code, 0);
  assert.equal(result.data.length, cases.length);
  categories.forEach((category, i) => {
    const quote = page.buildQuoteItem(category, measurement);
    assert.equal(quote.amount, cases[i][2], category.unit);
    assert.equal(result.data[i].calculatedAmount, cases[i][2], category.unit);
  });
});

test('an unknown rate unit requires manual review and the entered fee is preserved', () => {
  const page = loadPage('quote', { showToast() {} });
  const item = page.buildQuoteItem({ calculationType: 'per_weight', unit: '元/件', unitPrice: 5 }, { actual: { weight: 10, weightUnit: 'LBS' } });
  page.setData({ quoteItems: [item] });
  assert.equal(page.validate(), false);
  page.onAmountInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '12.34' } });
  assert.equal(page.validate(), true);
  assert.equal(page.buildSubmitItems()[0].amount, 12.34);
});

test('new per-weight categories start with an explicit kg basis and retain a manually chosen basis', () => {
  const page = loadPage('feeconfig');
  page.openAddModal();
  const index = page.data.calcTypeOptions.findIndex(item => item.value === 'per_weight');
  page.onCalcTypeChange({ detail: { value: index } });
  assert.equal(page.data.form.unit, '元/kg');
  page.onFormInput({ currentTarget: { dataset: { field: 'unit' } }, detail: { value: '元/磅' } });
  page.onCalcTypeChange({ detail: { value: index } });
  assert.equal(page.data.form.unit, '元/磅');
});

test('opening an existing quote keeps its saved amount despite new weight rates', async () => {
  const item = { categoryId: 'freight', name: '运费', amount: 190, calculationDetail: '旧报价' };
  const category = { _id: 'freight', calculationType: 'per_weight', unit: '元/kg', unitPrice: 0.19 };
  const shipment = { measurement: { actual: { weight: 1000, weightUnit: 'LBS' } }, quote: { items: [item] } };
  const page = loadPage('quote', { cloud: { async callFunction({ name }) {
    return { result: { code: 0, data: name === 'fee-config' ? [category] : shipment } };
  } } });
  await page.loadData('sample');
  assert.equal(page.data.quoteItems[0].amount, 190);
  assert.equal(page.data.quoteItems[0].calculationDetail, '旧报价');
});
