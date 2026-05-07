const app = getApp();

Page({
  data: {
    cargoInfo: {
      waybillNo: '',
      pieces: '',
      piecesUnit: 'CTNS',
      grossWeight: '',
      weightUnit: 'KGS',
      volume: '',
      volumeUnit: 'CBM',
      marks: ''
    },
    contacts: {
      factoryName: '',
      contactPerson: '蒋夺',
      contactPhone: ''
    },
    routing: {
      destinationPort: '',
      departureTime: '',
      latestDeliveryTime: ''
    },
    piecesUnitIndex: 0,
    weightUnitIndex: 0,
    volumeUnitIndex: 0,
    unitOptions: {
      pieces: ['CTNS', 'CARTONS', 'PLTS', '件'],
      weight: ['KGS', 'LBS'],
      volume: ['CBM']
    },
    latestDeliveryDate: '',
    latestDeliveryTime: '',
    imageUrl: '',
    hasImage: false,
    aiLoading: false,
    manualReview: {},
    submitting: false
  },

  // 选择图片
  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        this.uploadAndRecognize(tempFilePath);
      }
    });
  },

  previewImage() {
    wx.previewImage({ urls: [this.data.imageUrl], current: this.data.imageUrl });
  },

  // 上传并 AI 识别
  async uploadAndRecognize(filePath) {
    this.setData({ aiLoading: true });
    wx.showLoading({ title: '上传中...', mask: true });

    try {
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `driver-uploads/${Date.now()}.jpg`,
        filePath
      });
      const imageUrl = uploadRes.fileID;
      this.setData({ imageUrl, hasImage: true });

      wx.showLoading({ title: 'AI 识别中...', mask: true });

      const aiRes = await wx.cloud.callFunction({
        name: 'ai-parse',
        data: { imageUrl }
      });

      wx.hideLoading();

      if (aiRes.result.code === 0) {
        this.fillFormFromAI(aiRes.result.data);
        wx.showToast({
          title: aiRes.result.data.handwritingDetected ? '识别完成，请复核手写项' : '识别成功',
          icon: 'none',
          duration: 2000
        });
      } else {
        wx.showToast({ title: aiRes.result.message || '识别失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '识别出错，请手动录入', icon: 'none' });
    }
    this.setData({ aiLoading: false });
  },

  fillFormFromAI(result) {
    const info = result.shipmentInfo || {};
    const routing = result.routing || {};
    const contacts = result.contacts || {};

    const manualReview = {};
    if (info.waybillNo && info.waybillNo.manualReview) manualReview.waybillNo = true;
    const fields = ['pieces', 'weight', 'volume', 'marks'];
    fields.forEach(f => {
      if (info[f] && info[f].manualReview) manualReview[f] = true;
    });
    // 联系人信息不从AI识别填充，由用户手动填写

    const piecesUnit = info.pieces && info.pieces.unit || 'CTNS';
    const piecesUnitIndex = this.data.unitOptions.pieces.indexOf(piecesUnit);
    const weightUnit = info.weight && info.weight.unit || 'KGS';
    const weightUnitIndex = this.data.unitOptions.weight.indexOf(weightUnit);

    const ltdVal = routing.latestDeliveryTime && routing.latestDeliveryTime.val;
    let latestDeliveryDate = '';
    let latestDeliveryTime = '';
    if (ltdVal) {
      const parts = String(ltdVal).split(' ');
      latestDeliveryDate = parts[0] || '';
      latestDeliveryTime = parts[1] || '';
    }

    this.setData({
      'cargoInfo.waybillNo': info.waybillNo && info.waybillNo.val != null ? String(info.waybillNo.val) : '',
      'cargoInfo.pieces': info.pieces && info.pieces.val != null ? String(info.pieces.val) : '',
      'cargoInfo.piecesUnit': piecesUnit,
      piecesUnitIndex: piecesUnitIndex >= 0 ? piecesUnitIndex : 0,
      'cargoInfo.grossWeight': info.weight && info.weight.val != null ? String(info.weight.val) : '',
      'cargoInfo.weightUnit': weightUnit,
      weightUnitIndex: weightUnitIndex >= 0 ? weightUnitIndex : 0,
      'cargoInfo.volume': info.volume && info.volume.val != null ? String(info.volume.val) : '',
      'cargoInfo.volumeUnit': info.volume && info.volume.unit || 'CBM',
      'cargoInfo.marks': info.marks && info.marks.val != null ? String(info.marks.val) : '',
      // 联系人信息不从AI识别填充，由用户手动填写
      'routing.destinationPort': routing.destinationPort && routing.destinationPort.val != null ? String(routing.destinationPort.val) : '',
      'routing.departureTime': routing.departureTime && routing.departureTime.val != null ? String(routing.departureTime.val).slice(0, 10) : '',
      latestDeliveryDate,
      latestDeliveryTime,
      manualReview
    });
  },

  onWaybillNoChange(e) { this.setData({ 'cargoInfo.waybillNo': e.detail.value }); },
  onPiecesChange(e) { this.setData({ 'cargoInfo.pieces': e.detail.value }); },
  onPiecesUnitChange(e) { const idx = parseInt(e.detail.value); this.setData({ piecesUnitIndex: idx, 'cargoInfo.piecesUnit': this.data.unitOptions.pieces[idx] }); },
  onWeightChange(e) { this.setData({ 'cargoInfo.grossWeight': e.detail.value }); },
  onWeightUnitChange(e) { const idx = parseInt(e.detail.value); this.setData({ weightUnitIndex: idx, 'cargoInfo.weightUnit': this.data.unitOptions.weight[idx] }); },
  onVolumeChange(e) { this.setData({ 'cargoInfo.volume': e.detail.value }); },
  onVolumeUnitChange(e) { const idx = parseInt(e.detail.value); this.setData({ volumeUnitIndex: idx, 'cargoInfo.volumeUnit': this.data.unitOptions.volume[idx] }); },
  onMarksChange(e) { this.setData({ 'cargoInfo.marks': e.detail.value }); },
  onFactoryNameChange(e) { this.setData({ 'contacts.factoryName': e.detail.value }); },
  onContactPersonChange(e) { this.setData({ 'contacts.contactPerson': e.detail.value }); },
  onContactPhoneChange(e) { this.setData({ 'contacts.contactPhone': e.detail.value }); },
  onDestinationPortChange(e) { this.setData({ 'routing.destinationPort': e.detail.value }); },
  onDepartureTimeChange(e) { this.setData({ 'routing.departureTime': e.detail.value }); },
  clearDepartureTime() { this.setData({ 'routing.departureTime': '' }); },
  onLatestDeliveryDateChange(e) { this.setData({ latestDeliveryDate: e.detail.value }); },
  onLatestDeliveryTimeChange(e) { this.setData({ latestDeliveryTime: e.detail.value }); },

  async onSubmit() {
    if (this.data.submitting) return;

    const { cargoInfo, contacts, routing, latestDeliveryDate, latestDeliveryTime, imageUrl } = this.data;

    if (!cargoInfo.pieces || !cargoInfo.grossWeight || !cargoInfo.volume) {
      wx.showToast({ title: '请填写完整的货物信息', icon: 'none' });
      return;
    }
    if (!contacts.contactPhone) {
      wx.showToast({ title: '请填写联系人手机号', icon: 'none' });
      return;
    }
    if (!imageUrl) {
      wx.showToast({ title: '请先上传进仓单照片', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });

    const submitRouting = { ...routing };
    if (latestDeliveryDate) {
      submitRouting.latestDeliveryTime = latestDeliveryTime ? `${latestDeliveryDate} ${latestDeliveryTime}` : latestDeliveryDate;
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-create',
        data: {
          action: 'driverSubmit',
          cargoInfo,
          contacts,
          routing: submitRouting,
          imageUrl
        }
      });

      if (res.result.code === 0) {
        wx.showToast({ title: '提交成功，等待管理员复核', icon: 'success' });
        setTimeout(() => {
          wx.reLaunch({ url: '/pages/driver/upload/index' });
        }, 1500);
      } else {
        wx.showToast({ title: res.result.message || '提交失败', icon: 'none' });
        this.setData({ submitting: false });
      }
    } catch (e) {
      wx.showToast({ title: '网络错误', icon: 'none' });
      this.setData({ submitting: false });
    }
  }
});
