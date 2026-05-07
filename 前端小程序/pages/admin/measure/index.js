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
    photos: [],        // [{fileID, tempUrl}]
    maxPhotos: 6,
    // 费用计算
    mainFees: [
      { name: '进仓运费', amount: 0, detail: '' },
      { name: '装卸费', amount: 0, detail: '' }
    ],
    extraFees: [
      { code: 'collection', name: '代收款', amount: 0, enabled: false },
      { code: 'distribution', name: '分拨拼货费', amount: 0, enabled: false },
      { code: 'storage', name: '堆存费', amount: 0, enabled: false, days: '' },
      { code: 'relabel', name: '贴唛改唛费', amount: 0, enabled: false, pieces: '' },
      { code: 'other', name: '其他杂费', amount: 0, enabled: false, customName: '', customAmount: '' }
    ],
    collectionItems: [], // 代收费子项，按路线动态生成
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
        data: { action: 'detail', shipmentId: id }
      });
      if (res.result.code === 0) {
        const s = res.result.data;
        // 已有实测数据则回填，否则用进仓单数据做参考
        const a = s.measurement?.actual;
        const c = s.cargoInfo || {};
        this.setData({
          shipment: s,
          'form.pieces': a?.pieces != null ? String(a.pieces) : (c.pieces != null ? String(c.pieces) : ''),
          'form.weight': a?.weight != null ? String(a.weight) : (c.grossWeight != null ? String(c.grossWeight) : ''),
          'form.volume': a?.volume != null ? String(a.volume) : (c.volume != null ? String(c.volume) : ''),
          'form.weightUnit': a?.weightUnit || c.weightUnit || 'KGS',
          'form.volumeUnit': a?.volumeUnit || c.volumeUnit || 'CBM',
          'form.note': s.measurement?.note || '',
          photos: (s.measurement?.photos || []).map(fid => ({ fileID: fid, tempUrl: fid }))
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

  // 初始化代收费子项（按路线区分）
  initCollectionItems() {
    const routeId = this.data.shipment?.routeId || '';
    const isMengheng = routeId.includes('mh');
    let items = [];
    if (isMengheng) {
      items = [
        { name: '打单费', price: 15, qty: 1, unit: '票', amount: 15 },
        { name: '缠绕膜费', price: 2, qty: 0, unit: '托', amount: 0 },
        { name: '卸货费', price: 20, qty: 0, unit: '立方', amount: 0 }
      ];
    } else {
      items = [
        { name: '代收款', price: 0, qty: 0, unit: '立方', amount: 0 }
      ];
    }
    this.setData({ collectionItems: items });
  },

  // 计算所有费用
  calculateAllFees() {
    const { form, shipment, extraFees, collectionItems } = this.data;
    const weightKg = parseFloat(form.weight) || 0;
    const volume = parseFloat(form.volume) || 0;
    const routeId = shipment?.routeId || '';
    const isMengheng = routeId.includes('mh');

    // 1. 进仓运费
    let transportFee = 0;
    let transportDetail = '';
    if (weightKg > 0 && volume > 0) {
      const weightTons = weightKg / 1000; // 公斤 → 吨
      const ratio = volume / weightTons;  // 每吨货物占多少立方
      if (isMengheng) {
        if (ratio >= 4) {
          transportFee = volume * 55;
          transportDetail = `轻货按体积 ${volume}立方 × 55元/立方（每吨${ratio.toFixed(2)}立方）`;
        } else {
          transportFee = weightTons * 190;
          transportDetail = `重货按重量 ${weightTons.toFixed(3)}吨 × 190元/吨（每吨${ratio.toFixed(2)}立方）`;
        }
      } else {
        if (ratio >= 4) {
          transportFee = volume * 85;
          transportDetail = `轻货按体积 ${volume}立方 × 85元/立方（每吨${ratio.toFixed(2)}立方）`;
        } else {
          transportFee = weightTons * 220;
          transportDetail = `重货按重量 ${weightTons.toFixed(3)}吨 × 220元/吨（每吨${ratio.toFixed(2)}立方）`;
        }
      }
    }

    // 2. 装卸费（不足1立方按1立方）
    const handlingVolume = volume > 0 ? Math.ceil(volume) : 0;
    const handlingFee = handlingVolume * 20;
    const handlingDetail = handlingVolume > 0 ? `${handlingVolume}立方 × 20元/立方（不足1立方按1立方）` : '';

    const mainFees = [
      { name: '进仓运费', amount: this.round2(transportFee), detail: transportDetail },
      { name: '装卸费', amount: this.round2(handlingFee), detail: handlingDetail }
    ];

    // 3. 代收款
    let collectionFee = 0;
    if (extraFees[0].enabled) {
      collectionFee = collectionItems.reduce((sum, item) => sum + (item.price * item.qty), 0);
    }
    extraFees[0].amount = this.round2(collectionFee);

    // 4. 分拨拼货费
    let distributionFee = 0;
    if (extraFees[1].enabled && volume > 0) {
      if (volume <= 5) distributionFee = 100;
      else if (volume <= 20) distributionFee = 200;
      else distributionFee = 0;
    }
    extraFees[1].amount = this.round2(distributionFee);

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

    // 7. 其他杂费
    let otherFee = 0;
    if (extraFees[4].enabled) {
      otherFee = parseFloat(extraFees[4].customAmount) || 0;
    }
    extraFees[4].amount = this.round2(otherFee);

    // 总计
    const totalAmount = mainFees.reduce((s, f) => s + f.amount, 0) +
                        extraFees.reduce((s, f) => f.enabled ? s + f.amount : s, 0);

    this.setData({ mainFees, extraFees, totalAmount: this.round2(totalAmount) });
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

  // 堆存费天数变更
  onStorageDaysChange(e) {
    this.setData({ 'extraFees[2].days': e.detail.value }, () => {
      this.calculateAllFees();
    });
  },

  // 贴唛改唛件数变更
  onRelabelPiecesChange(e) {
    this.setData({ 'extraFees[3].pieces': e.detail.value }, () => {
      this.calculateAllFees();
    });
  },

  // 其他杂费名称变更
  onOtherNameChange(e) {
    this.setData({ 'extraFees[4].customName': e.detail.value });
  },

  // 其他杂费金额变更
  onOtherAmountChange(e) {
    this.setData({ 'extraFees[4].customAmount': e.detail.value }, () => {
      this.calculateAllFees();
    });
  },

  async choosePhoto() {
    const { photos, maxPhotos } = this.data;
    if (photos.length >= maxPhotos) {
      wx.showToast({ title: `最多${maxPhotos}张`, icon: 'none' });
      return;
    }

    wx.chooseMedia({
      count: maxPhotos - photos.length,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],   // 强制压缩，避免原图占用带宽和存储
      success: async (res) => {
        wx.showLoading({ title: '上传留存中...' });
        try {
          const uploads = res.tempFiles.map(file => {
            const ext = file.tempFilePath.split('.').pop() || 'jpg';
            const cloudPath = `measurements/${this.data.shipmentId}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
            return wx.cloud.uploadFile({ cloudPath, filePath: file.tempFilePath })
              .then(r => ({ fileID: r.fileID, tempUrl: file.tempFilePath }))
              .catch(() => null);
          });
          const results = await Promise.all(uploads);
          const uploaded = results.filter(Boolean);
          if (uploaded.length < results.length) {
            wx.showToast({ title: '部分照片上传失败', icon: 'none' });
          }
          this.setData({ photos: [...this.data.photos, ...uploaded] });
        } catch (e) {
          wx.showToast({ title: '上传失败，请重试', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  // 删除时同步清理云端文件，防止产生孤儿文件持续扣费
  async removePhoto(e) {
    const { index } = e.currentTarget.dataset;
    const photos = [...this.data.photos];
    const target = photos[index];
    photos.splice(index, 1);
    this.setData({ photos });

    if (target.fileID && target.fileID.startsWith('cloud://')) {
      try {
        await wx.cloud.deleteFile({ fileList: [target.fileID] });
      } catch (err) {
        console.error('清理云端废弃照片失败:', err);
        // 文件可能已被删除或权限不足，静默处理不阻断用户
      }
    }
  },

  previewPhoto(e) {
    const { index } = e.currentTarget.dataset;
    const urls = this.data.photos.map(p => p.tempUrl || p.fileID);
    wx.previewImage({ current: urls[index], urls });
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
    const { form, photos } = this.data;

    if (!form.weight || isNaN(parseFloat(form.weight))) {
      wx.showToast({ title: '请填写实测重量', icon: 'none' }); return false;
    }
    if (!form.volume || isNaN(parseFloat(form.volume))) {
      wx.showToast({ title: '请填写实测体积', icon: 'none' }); return false;
    }
    if (photos.length === 0) {
      wx.showToast({ title: '请至少上传一张实测照片', icon: 'none' }); return false;
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
      const { form, photos, shipmentId, mainFees, extraFees, collectionItems, totalAmount } = this.data;

      // 构建费用明细
      const feeItems = [
        ...mainFees.map(f => ({ name: f.name, amount: f.amount, type: 'main', detail: f.detail })),
        ...extraFees.filter(f => f.enabled).map(f => {
          if (f.code === 'collection') {
            return {
              name: f.name,
              amount: f.amount,
              type: 'extra',
              detail: collectionItems.map(i => `${i.name}:${i.price}×${i.qty}${i.unit}`).join(' + ')
            };
          }
          if (f.code === 'other') {
            return { name: f.customName || '其他杂费', amount: f.amount, type: 'extra', detail: '' };
          }
          return { name: f.name, amount: f.amount, type: 'extra', detail: '' };
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
            photos: photos.map(p => p.fileID),
            note: form.note,
            fees: feeItems,
            totalAmount
          }
        }
      });

      if (res.result.code === 0) {
        // 仓库现结：弹出支付二维码
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
  }
});
