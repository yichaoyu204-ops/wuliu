const app = getApp();

Page({
  data: {
    shipmentId: '',
    shipment: null,
    loading: false,
    submitting: false,
    showPayModal: false,
    payAmount: 0,
    form: {
      pieces: '',
      weight: '',
      volume: '',
      weightUnit: 'KGS',
      volumeUnit: 'CBM',
      note: ''
    },
    // 费用计算
    mainFees: [
      { name: '进仓运费', amount: 0, detail: '' }
    ],
    collectionFee: { name: '代收款', amount: 0, enabled: false },
    extraFees: [
      { code: 'beilun_distribution', name: '北仑分拨费', amount: 0, enabled: false, tickets: '' },
      { code: 'pickup', name: '上门提货费', amount: 0, enabled: false, times: '' },
      { code: 'storage', name: '集货点堆存费', amount: 0, enabled: false, days: '' },
      { code: 'relabel', name: '贴唛改唛费', amount: 0, enabled: false, pieces: '' },
      { code: 'yiwu_transfer', name: '义乌地区转运费', amount: 0, enabled: false, customAmount: '' },
      { code: 'non_yiwu_transfer', name: '非义乌地区转运费', amount: 0, enabled: false, customAmount: '' },
      { code: 'other', name: '其他杂费', amount: 0, enabled: false, customName: '', customAmount: '' }
    ],
    collectionItems: [], // 代收费子项，按路线动态生成
    routeFeeProfile: null,
    totalAmount: 0,
  },

  onLoad(options) {
    const id = options.shipmentId || options.id || '';
    if (!id) {
      wx.showToast({ title: '缺少单号参数', icon: 'none' });
      return;
    }
    this.setData({ shipmentId: id });
    this.loadShipment(id);
  },

  async loadShipment(id) {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-query',
        data: { action: 'detail', shipmentId: id, role: 'warehouse' }
      });
      if (res.result.code === 0) {
        const s = res.result.data;
        // 已有实测数据则回填，否则用进仓单数据做参考
        const a = s.measurement?.actual;
        const c = s.cargoInfo || {};
        this.setData({
          shipment: s,
          routeFeeProfile: this.getRouteFeeProfile(s),
          'form.pieces': a?.pieces != null ? String(a.pieces) : (c.pieces != null ? String(c.pieces) : ''),
          'form.weight': a?.weight != null ? String(a.weight) : (c.grossWeight != null ? String(c.grossWeight) : ''),
          'form.volume': a?.volume != null ? String(a.volume) : (c.volume != null ? String(c.volume) : ''),
          'form.weightUnit': a?.weightUnit || c.weightUnit || 'KGS',
          'form.volumeUnit': a?.volumeUnit || c.volumeUnit || 'CBM',
          'form.note': s.measurement?.note || ''
        }, () => {
          this.initCollectionItems();
          this.calculateAllFees();
        });
      } else {
        wx.showToast({ title: res.result.message || '查询失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
    this.setData({ loading: false });
  },

  onFormInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: e.detail.value }, () => {
      if (field === 'weight' || field === 'volume') {
        this.calculateAllFees();
      }
    });
  },

  getRouteFeeProfile(shipment) {
    const routeId = shipment?.routeId || '';
    const routeName = shipment?.routeSnapshot?.name || shipment?.routeName || '';
    const isHaitong = routeId.includes('haitong') || routeName.includes('海通');
    return isHaitong
      ? {
          isHaitong: true,
          lineName: '义乌集货点→海通安达仓库',
          volumeRate: 55,
          weightRate: 185
        }
      : {
          isHaitong: false,
          lineName: '义乌集货点→宁波北仑仓库',
          volumeRate: 65,
          weightRate: 190
        };
  },

  // 初始化代收费子项（按路线区分）
  initCollectionItems() {
    const profile = this.data.routeFeeProfile || this.getRouteFeeProfile(this.data.shipment);
    let items;
    if (profile.isHaitong) {
      items = [
        { name: '打单费', price: 15, qty: 1, unit: '票', amount: 15 },
        { name: '缠绕膜费', price: 2, qty: 0, unit: '托', amount: 0 },
        { name: '卸货费', price: 20, qty: 0, unit: '立方', amount: 0, qtySource: 'volume' }
      ];
    } else {
      items = [
        { name: '进仓费代收代付', price: 0, qty: 1, unit: '票', amount: 0 }
      ];
    }
    this.setData({ collectionItems: items, routeFeeProfile: profile });
  },

  // 计算所有费用
  calculateAllFees() {
    const { form, shipment, extraFees, collectionItems } = this.data;
    const weightKg = parseFloat(form.weight) || 0;
    const volume = parseFloat(form.volume) || 0;
    const profile = this.data.routeFeeProfile || this.getRouteFeeProfile(shipment);

    // 1. 进仓运费
    let transportFee = 0;
    let transportDetail = '';
    if (weightKg > 0 && volume > 0) {
      const weightTons = weightKg / 1000; // 公斤 → 吨
      const ratio = volume / weightTons;  // 每吨货物占多少立方
      if (ratio >= 4) {
        transportFee = volume * profile.volumeRate;
        transportDetail = `${profile.lineName}：${volume}立方 × ${profile.volumeRate}元/立方（每吨${ratio.toFixed(2)}立方，≥4按立方）`;
      } else {
        transportFee = weightTons * profile.weightRate;
        transportDetail = `${profile.lineName}：${weightTons.toFixed(3)}吨 × ${profile.weightRate}元/吨（每吨${ratio.toFixed(2)}立方，<4按重量）`;
      }
    }

    const mainFees = [
      { name: '进仓运费', amount: this.round2(transportFee), detail: transportDetail }
    ];

    // 2. 代收款：常规费用，展示在附加费用上方
    let collectionAmount = 0;
    if (this.data.collectionFee.enabled) {
      collectionAmount = collectionItems.reduce((sum, item) => {
        const qty = item.qtySource === 'volume' ? volume : (parseFloat(item.qty) || 0);
        item.qty = item.qtySource === 'volume' ? volume : item.qty;
        item.amount = this.round2((parseFloat(item.price) || 0) * qty);
        return sum + item.amount;
      }, 0);
    }
    const nextCollectionFee = { ...this.data.collectionFee, amount: this.round2(collectionAmount) };

    // 3. 北仑分拨费：附加费用第一项
    const distributionTickets = parseInt(extraFees[0].tickets) || 0;
    extraFees[0].amount = extraFees[0].enabled ? this.round2(distributionTickets * 120) : 0;

    // 4. 上门提货费
    const pickupTimes = parseInt(extraFees[1].times) || 0;
    extraFees[1].amount = extraFees[1].enabled ? this.round2(pickupTimes * 50) : 0;

    // 5. 堆存费
    let storageFee = 0;
    const storageDays = parseInt(extraFees[2].days) || 0;
    if (extraFees[2].enabled && storageDays > 5) {
      storageFee = (storageDays - 5) * 50;
    }
    extraFees[2].amount = this.round2(storageFee);

    // 6. 贴唛改唛费
    let relabelFee = 0;
    const relabelPieces = parseInt(extraFees[3].pieces) || 0;
    if (extraFees[3].enabled && relabelPieces > 0) {
      relabelFee = relabelPieces * 2;
    }
    extraFees[3].amount = this.round2(relabelFee);

    // 7. 义乌地区转运费
    let yiwuTransferFee = 0;
    extraFees[4].needsCustom = volume > 20;
    if (extraFees[4].enabled) {
      if (volume > 20) {
        yiwuTransferFee = parseFloat(extraFees[4].customAmount) || 0;
      } else if (volume >= 10) {
        yiwuTransferFee = 280;
      } else if (volume >= 5) {
        yiwuTransferFee = 220;
      } else if (volume > 0) {
        yiwuTransferFee = 180;
      }
    }
    extraFees[4].amount = this.round2(yiwuTransferFee);

    // 8. 非义乌地区转运费
    extraFees[5].amount = extraFees[5].enabled ? this.round2(parseFloat(extraFees[5].customAmount) || 0) : 0;

    // 9. 其他杂费
    extraFees[6].amount = extraFees[6].enabled ? this.round2(parseFloat(extraFees[6].customAmount) || 0) : 0;

    // 总计
    const totalAmount = mainFees.reduce((s, f) => s + f.amount, 0) +
                        (nextCollectionFee.enabled ? nextCollectionFee.amount : 0) +
                        extraFees.reduce((s, f) => f.enabled ? s + f.amount : s, 0);

    this.setData({ mainFees, collectionFee: nextCollectionFee, extraFees, collectionItems, routeFeeProfile: profile, totalAmount: this.round2(totalAmount) });
  },

  round2(n) {
    return Math.round((parseFloat(n) || 0) * 100) / 100;
  },

  // 切换附加费用勾选
  toggleExtraFee(e) {
    const idx = e.currentTarget.dataset.idx;
    const key = `extraFees[${idx}].enabled`;
    const enabled = !this.data.extraFees[idx].enabled;
    this.setData({ [`extraFees[${idx}].enabled`]: enabled }, () => {
      this.calculateAllFees();
    });
  },

  toggleCollectionFee() {
    this.setData({ 'collectionFee.enabled': !this.data.collectionFee.enabled }, () => {
      this.calculateAllFees();
    });
  },

  // 代收费子项数量变更
  onCollectionQtyChange(e) {
    const idx = parseInt(e.currentTarget.dataset.idx);
    const qty = parseFloat(e.detail.value) || 0;
    const items = [...this.data.collectionItems];
    items[idx].qty = qty;
    items[idx].amount = this.round2(items[idx].price * qty);
    this.setData({ collectionItems: items }, () => {
      this.calculateAllFees();
    });
  },

  // 代收费子项价格变更（北仑路线可编辑价格）
  onCollectionPriceChange(e) {
    const idx = parseInt(e.currentTarget.dataset.idx);
    const price = parseFloat(e.detail.value) || 0;
    const items = [...this.data.collectionItems];
    items[idx].price = price;
    items[idx].amount = this.round2(price * items[idx].qty);
    this.setData({ collectionItems: items }, () => {
      this.calculateAllFees();
    });
  },

  onExtraFeeFieldChange(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    const field = e.currentTarget.dataset.field;
    this.setData({ [`extraFees[${idx}].${field}`]: e.detail.value }, () => {
      this.calculateAllFees();
    });
  },

  // 关闭支付弹窗
  closePayModal() {
    this.setData({ showPayModal: false });
    wx.switchTab({ url: '/pages/workflow/index' });
  },

  // 确认已支付
  confirmPaid() {
    this.setData({ showPayModal: false });
    wx.showToast({ title: '收款完成', icon: 'success' });
    setTimeout(() => {
      wx.switchTab({ url: '/pages/workflow/index' });
    }, 1200);
  },

  // 带防呆校验：发现异常误差时弹窗二次确认
  validate() {
    const { form } = this.data;

    if (!form.weight || isNaN(parseFloat(form.weight))) {
      wx.showToast({ title: '请填写实测重量', icon: 'none' }); return false;
    }
    if (!form.volume || isNaN(parseFloat(form.volume))) {
      wx.showToast({ title: '请填写实测体积', icon: 'none' }); return false;
    }

    // 异常误差防呆：实测体积与申报差异超过30%时弹窗确认
    const origVolume = this.data.shipment?.cargoInfo?.volume;
    if (origVolume) {
      const actVol = parseFloat(form.volume);
      const origVol = parseFloat(origVolume);
      if (actVol > origVol * 1.3 || actVol < origVol * 0.5) {
        wx.showModal({
          title: '数据异常提示',
          content: `实测体积(${actVol}方)与进仓单申报(${origVol}方)差异较大，请确认是否录入无误？`,
          confirmText: '确认无误',
          cancelText: '去修改',
          success: (res) => {
        if (res.confirm && !this.data.submitting) {
          this.setData({ submitting: true });
          this.doSubmit();
        }
      }
        });
        return false;   // 等待 Modal 回调，拦截本次提交
      }
    }
    return true;
  },

  async submit() {
    if (this.data.submitting) return;
    if (!this.validate()) return;
    this.doSubmit();
  },

  async doSubmit() {
    this.setData({ submitting: true });
    try {
      const { form, shipmentId, mainFees, collectionFee, extraFees, collectionItems, totalAmount } = this.data;

      // 构建费用明细
      const feeItems = [
        ...mainFees.map(f => ({ name: f.name, amount: f.amount, type: 'main', detail: f.detail })),
        ...(collectionFee.enabled ? [{
          name: collectionFee.name,
          amount: collectionFee.amount,
          type: 'main',
          detail: collectionItems.map(i => `${i.name}:${i.price}×${i.qty}${i.unit}`).join(' + ')
        }] : []),
        ...extraFees.filter(f => f.enabled).map(f => {
          if (f.code === 'other') {
            return { name: f.customName || '其他杂费', amount: f.amount, type: 'extra', detail: '' };
          }
          return { name: f.name, amount: f.amount, type: 'extra', detail: this.getExtraFeeDetail(f) };
        })
      ];

      const res = await wx.cloud.callFunction({
        name: 'shipment-update',
        data: {
          action: 'measurement',
          shipmentId,
          data: {
            pieces: form.pieces ? parseInt(form.pieces, 10) : null,
            weight: parseFloat(form.weight),
            volume: parseFloat(form.volume),
            weightUnit: form.weightUnit,
            volumeUnit: form.volumeUnit,
            note: form.note,
            fees: feeItems,
            totalAmount
          }
        }
      });

      if (res.result.code === 0) {
        // 供应商现结：弹出支付二维码
        const isSpot = this.data.shipment?.billing?.paymentType === 'spot';
        if (isSpot) {
          this.setData({ submitting: false, showPayModal: true, payAmount: totalAmount });
        } else {
          wx.showToast({ title: '实测数据已保存', icon: 'success' });
          setTimeout(() => {
            wx.switchTab({ url: '/pages/workflow/index' });
          }, 1200);
        }
      } else {
        wx.showToast({ title: res.result.message || '提交失败', icon: 'none' });
        this.setData({ submitting: false });
      }
    } catch (e) {
      console.error('提交实测数据失败:', e);
      const errMsg = e.message || e.errMsg || JSON.stringify(e);
      wx.showModal({
        title: '提交失败',
        content: `错误信息：${errMsg}`,
        showCancel: false
      });
      this.setData({ submitting: false });
    }
  },

  getExtraFeeDetail(f) {
    switch (f.code) {
      case 'pickup':
        return `${parseInt(f.times) || 0}次 × 50元/次`;
      case 'storage':
        return `${parseInt(f.days) || 0}天，5天内免费，超过部分50元/票/天`;
      case 'relabel':
        return `${parseInt(f.pieces) || 0}件 × 2元/件`;
      case 'beilun_distribution':
        return `${parseInt(f.tickets) || 0}票 × 120元/票`;
      case 'yiwu_transfer':
        return f.customAmount ? `义乌地区转运，单独报价${f.customAmount}元` : '按体积分档：<5方180元，5-9.99方220元，10-20方280元，>20方单独报价';
      case 'non_yiwu_transfer':
        return `非义乌地区转运，单独报价${f.customAmount || 0}元`;
      default:
        return '';
    }
  }
});
