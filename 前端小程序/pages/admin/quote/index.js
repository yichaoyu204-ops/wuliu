const app = getApp();

Page({
  data: {
    shipmentId: '',
    shipment: null,
    loading: false,
    submitting: false,
    sending: false,
    categories: [],
    quoteItems: [],
    otherFees: [],
    unitWarning: '',
    note: '',
    subtotal: 0
  },

  onLoad(options) {
    const id = options.id || '';
    if (!id) {
      wx.showToast({ title: '缺少单号参数', icon: 'none' });
      return;
    }
    this.setData({ shipmentId: id });
    this.loadData(id);
  },

  async loadData(shipmentId) {
    this.setData({ loading: true });
    try {
      const [shipRes, catRes] = await Promise.all([
        wx.cloud.callFunction({ name: 'shipment-query', data: { action: 'detail', shipmentId } }),
        wx.cloud.callFunction({ name: 'fee-config', data: { action: 'list' } })
      ]);

      if (shipRes.result.code !== 0) {
        wx.showToast({ title: shipRes.result.message || '查询失败', icon: 'none' });
        this.setData({ loading: false });
        return;
      }

      const shipment = shipRes.result.data;
      const categories = catRes.result.code === 0 ? (catRes.result.data || []) : [];

      // 单位一致性检查
      const unitWarning = this.checkUnitConsistency(shipment);

      // 如果已有 quote 草稿，回填
      const existingQuote = shipment.quote;
      let quoteItems = [];
      let otherFees = [];
      let note = '';

      if (existingQuote?.items?.length > 0) {
        // 回填已有报价
        const existingIds = new Set();
        existingQuote.items.forEach(item => {
          if (item.categoryId === 'cat_other') {
            otherFees.push({ name: item.name, amount: String(item.amount || '') });
          } else {
            existingIds.add(item.categoryId);
            quoteItems.push({
              categoryId: item.categoryId,
              name: item.name,
              calculationDetail: item.calculationDetail || '',
              amount: item.amount,
              isIncluded: item.isIncluded !== false
            });
          }
        });
        note = existingQuote.note || '';

        // 补充数据库新增但草稿里没的类目
        categories.forEach(cat => {
          if (!existingIds.has(cat._id) && cat.type !== 'other') {
            quoteItems.push(this.buildQuoteItem(cat, shipment.measurement));
          }
        });
      } else {
        // 新建报价：按类目生成初始项
        quoteItems = categories
          .filter(cat => cat.type !== 'other')
          .map(cat => this.buildQuoteItem(cat, shipment.measurement));
      }

      this.setData({
        shipment,
        categories,
        quoteItems,
        otherFees,
        unitWarning,
        note,
        loading: false
      });
      this.setSubtotal();
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '网络错误', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // 检查申报单位与实测单位是否一致
  checkUnitConsistency(shipment) {
    const cargo = shipment.cargoInfo || {};
    const actual = shipment.measurement?.actual || {};
    const warnings = [];
    if (cargo.weightUnit && actual.weightUnit && cargo.weightUnit !== actual.weightUnit) {
      warnings.push(`重量单位不一致：申报 ${cargo.weightUnit}，实测 ${actual.weightUnit}`);
    }
    if (cargo.volumeUnit && actual.volumeUnit && cargo.volumeUnit !== actual.volumeUnit) {
      warnings.push(`体积单位不一致：申报 ${cargo.volumeUnit}，实测 ${actual.volumeUnit}`);
    }
    return warnings.join('；');
  },

  // 根据类目 + 实测数据生成报价项
  buildQuoteItem(category, measurement) {
    const actual = measurement?.actual || {};
    let amount = null;
    let detail = '';

    switch (category.calculationType) {
      case 'fixed':
        amount = category.basePrice || 0;
        detail = `固定 1 票`;
        break;
      case 'per_piece':
        if (actual.pieces != null && category.unitPrice != null) {
          amount = Math.round(category.unitPrice * actual.pieces * 100) / 100;
          detail = `${category.unitPrice} 元/件 × ${actual.pieces} 件`;
        }
        break;
      case 'per_volume':
        if (actual.volume != null && category.unitPrice != null) {
          amount = Math.round(category.unitPrice * actual.volume * 100) / 100;
          detail = `${category.unitPrice} 元/${actual.volumeUnit || 'm³'} × ${actual.volume} ${actual.volumeUnit || 'm³'}`;
        }
        break;
      case 'per_weight':
        if (actual.weight != null && category.unitPrice != null) {
          amount = Math.round(category.unitPrice * actual.weight * 100) / 100;
          detail = `${category.unitPrice} 元/${actual.weightUnit || 'KGS'} × ${actual.weight} ${actual.weightUnit || 'KGS'}`;
        }
        break;
      case 'per_volume_per_day':
        detail = `${category.unitPrice || '-'} 元/${actual.volumeUnit || 'm³'}/天 × ${actual.volume || '-'} ${actual.volumeUnit || 'm³'}（待填天数）`;
        break;
      default:
        detail = '手动输入';
    }

    return {
      categoryId: category._id,
      name: category.name,
      calculationDetail: detail,
      amount: amount,
      isIncluded: category.isRequired !== false
    };
  },

  // 切换是否包含
  toggleIncluded(e) {
    const { index } = e.currentTarget.dataset;
    const key = `quoteItems[${index}].isIncluded`;
    this.setData({ [key]: !this.data.quoteItems[index].isIncluded });
    this.setSubtotal();
  },

  setSubtotal() {
    this.setData({ subtotal: this.getSubtotal() });
  },

  // 修改金额（手动类目或需要修正时）
  onAmountInput(e) {
    const { index } = e.currentTarget.dataset;
    const val = e.detail.value;
    const num = val === '' ? null : parseFloat(val);
    this.setData({ [`quoteItems[${index}].amount`]: num });
    this.setSubtotal();
  },

  // 其他费用：添加一行
  addOtherFee() {
    this.setData({ otherFees: [...this.data.otherFees, { name: '', amount: '' }] });
    this.setSubtotal();
  },

  // 其他费用：删除一行
  removeOtherFee(e) {
    const { index } = e.currentTarget.dataset;
    const fees = [...this.data.otherFees];
    fees.splice(index, 1);
    this.setData({ otherFees: fees });
    this.setSubtotal();
  },

  // 其他费用：输入名称
  onOtherNameInput(e) {
    const { index } = e.currentTarget.dataset;
    this.setData({ [`otherFees[${index}].name`]: e.detail.value });
  },

  // 其他费用：输入金额
  onOtherAmountInput(e) {
    const { index } = e.currentTarget.dataset;
    this.setData({ [`otherFees[${index}].amount`]: e.detail.value });
    this.setSubtotal();
  },

  onNoteInput(e) {
    this.setData({ note: e.detail.value });
  },

  // 计算小计（仅包含勾选项）
  getSubtotal() {
    let sum = 0;
    this.data.quoteItems.forEach(item => {
      if (item.isIncluded && item.amount != null) sum += item.amount;
    });
    this.data.otherFees.forEach(fee => {
      const amt = parseFloat(fee.amount);
      if (!isNaN(amt)) sum += amt;
    });
    return Math.round(sum * 100) / 100;
  },

  // 构建提交用的 items 数组
  buildSubmitItems() {
    const items = [];

    this.data.quoteItems.forEach(item => {
      items.push({
        categoryId: item.categoryId,
        name: item.name,
        calculationDetail: item.calculationDetail || '',
        amount: item.amount != null ? Math.round(item.amount * 100) / 100 : 0,
        isIncluded: item.isIncluded
      });
    });

    this.data.otherFees.forEach(fee => {
      if (fee.name.trim() && fee.amount) {
        items.push({
          categoryId: 'cat_other',
          name: fee.name.trim().substring(0, 20),
          calculationDetail: '手动输入',
          amount: Math.round(parseFloat(fee.amount) * 100) / 100,
          isIncluded: true
        });
      }
    });

    return items;
  },

  validate() {
    const items = this.buildSubmitItems();
    const included = items.filter(i => i.isIncluded);
    if (included.length === 0) {
      wx.showToast({ title: '请至少包含一项费用', icon: 'none' });
      return false;
    }
    if (included.some(i => i.amount == null || isNaN(i.amount))) {
      wx.showToast({ title: '请检查费用金额是否填写完整', icon: 'none' });
      return false;
    }
    return true;
  },

  // 保存报价草稿
  async saveDraft() {
    if (this.data.submitting) return;
    if (!this.validate()) return;

    this.setData({ submitting: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-update',
        data: {
          action: 'quote',
          shipmentId: this.data.shipmentId,
          data: {
            subAction: 'draft',
            items: this.buildSubmitItems(),
            note: this.data.note
          }
        }
      });

      if (res.result.code === 0) {
        wx.showToast({ title: '报价草稿已保存', icon: 'success' });
        // 草稿保存后进入发送确认
        this.setData({ submitting: false });
        this.confirmSend();
      } else {
        wx.showToast({ title: res.result.message || '保存失败', icon: 'none' });
        this.setData({ submitting: false });
      }
    } catch (e) {
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      this.setData({ submitting: false });
    }
  },

  // 发送前二次确认
  confirmSend() {
    const subtotal = this.getSubtotal();
    wx.showModal({
      title: '确认发送报价',
      content: `费用小计 ¥${subtotal.toFixed(2)}，发送后客户将收到微信通知，是否继续？`,
      confirmText: '立即发送',
      cancelText: '再改改',
      success: (res) => {
        if (res.confirm) this.sendQuote();
      }
    });
  },

  // 发送报价
  async sendQuote() {
    if (this.data.sending) return;
    this.setData({ sending: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-update',
        data: {
          action: 'quote',
          shipmentId: this.data.shipmentId,
          data: { subAction: 'send' }
        }
      });

      if (res.result.code === 0) {
        wx.showToast({ title: '报价已发送', icon: 'success' });
        setTimeout(() => {
          wx.navigateBack({ delta: 1 });
        }, 1500);
      } else {
        wx.showToast({ title: res.result.message || '发送失败', icon: 'none' });
        this.setData({ sending: false });
      }
    } catch (e) {
      wx.showToast({ title: '网络错误', icon: 'none' });
      this.setData({ sending: false });
    }
  }
});
