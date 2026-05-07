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
      contact1Name: '蒋先生',
      contact1Phone: '13857488715',
      contact2Name: '姚小姐',
      contact2Phone: '87507082'
    },
    routing: {
      warehouseName: '',
      destinationPort: '',
      departureTime: '',
      latestDeliveryTime: ''
    },
    routes: [
      { id: 'route_yw_mh_hub', name: '义乌→萌恒仓库（经义乌中转仓）' },
      { id: 'route_yw_bl_hub', name: '义乌→北仑方向其他仓库（经义乌中转仓）' },
      { id: 'route_yw_mh_direct', name: '义乌→萌恒仓库（工厂直发）' },
      { id: 'route_yw_bl_direct', name: '义乌→北仑方向其他仓库（工厂直发）' }
    ],
    routeIndex: 0,
    routeName: '义乌→萌恒仓库（经义乌中转仓）',
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
    submitting: false,
    aiLoading: false,
    aiResult: null,
    manualReview: {},
    attachmentFileId: '',
    paymentTypeIndex: 0,
    paymentTypeLabel: '萌恒月结',
    paymentTypeOptions: ['萌恒月结', '仓库现结']
  },

  onLoad() {
    // 不预填登录手机号，保持默认的联系人信息
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ activeIndex: 1 });
    }
    // 从详情页返回时，重置创建状态，方便连续建单
    if (this.data.submitting) {
      this.setData({ submitting: false });
    }
  },

  // 支持的图片格式（含常见格式及iPhone格式）
  imageExts: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'heic', 'heif'],

  // AI 识别：选择文件（图片或PDF）
  chooseImage() {
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择', '从聊天选文件（支持PDF/图片）'],
      success: (res) => {
        if (res.tapIndex === 2) {
          wx.chooseMessageFile({
            count: 1,
            type: 'file',
            success: (fileRes) => {
              const file = fileRes.tempFiles[0];
              const ext = file.name.split('.').pop().toLowerCase();
              if (this.imageExts.includes(ext) || ext === 'pdf') {
                this.uploadAndRecognize(file.path, ext);
              } else {
                wx.showToast({ title: '仅支持图片或PDF格式', icon: 'none' });
              }
            }
          });
        } else {
          const sourceType = res.tapIndex === 0 ? ['camera'] : ['album'];
          wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            sourceType,
            success: (mediaRes) => {
              const tempFilePath = mediaRes.tempFiles[0].tempFilePath;
              const ext = (mediaRes.tempFiles[0].fileType || 'jpg').toLowerCase();
              this.uploadAndRecognize(tempFilePath, ext);
            }
          });
        }
      }
    });
  },

  // 上传文件到云存储并调用 AI 识别（支持图片和PDF）
  async uploadAndRecognize(filePath, ext = 'jpg') {
    this.setData({ aiLoading: true });
    wx.showLoading({ title: '上传中...', mask: true });

    const isPDF = ext === 'pdf';
    const cloudPath = isPDF
      ? `ai-recognition/pdf/${Date.now()}.pdf`
      : `ai-recognition/${Date.now()}.${ext}`;

    try {
      const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath });
      const fileID = uploadRes.fileID;
      // 上传成功即保存附件ID，不管AI识别成败
      this.setData({ attachmentFileId: fileID });

      wx.showLoading({ title: 'AI 识别中...', mask: true });

      const aiRes = await wx.cloud.callFunction({
        name: 'ai-parse',
        data: { imageUrl: fileID, fileType: isPDF ? 'pdf' : 'image' }
      });

      wx.hideLoading();

      if (aiRes.result.code === 0) {
        const result = aiRes.result.data;
        this.fillFormFromAI(result);
        this.setData({ aiResult: result, aiLoading: false });
        wx.showToast({
          title: result.handwritingDetected ? '识别完成，请复核手写项' : '识别成功',
          icon: 'none',
          duration: 2000
        });
      } else {
        if (isPDF) {
          wx.showModal({
            title: 'PDF识别提示',
            content: aiRes.result.message || 'PDF自动识别失败，请手动录入信息',
            showCancel: false
          });
        } else {
          wx.showToast({ title: aiRes.result.message || '识别失败', icon: 'none' });
        }
        this.setData({ aiLoading: false });
      }
    } catch (e) {
      wx.hideLoading();
      if (isPDF) {
        wx.showModal({
          title: 'PDF识别提示',
          content: 'PDF自动识别暂不可用，请手动录入信息',
          showCancel: false
        });
      } else {
        wx.showToast({ title: '识别出错，请手动录入', icon: 'none' });
      }
      this.setData({ aiLoading: false });
    }
  },

  // 将 AI 识别结果填充到表单
  fillFormFromAI(result) {
    const info = result.shipmentInfo || {};
    const routing = result.routing || {};
    const contacts = result.contacts || {};

    // 检测哪些字段需要人工复核
    const manualReview = {};
    if (info.waybillNo && info.waybillNo.manualReview) manualReview.waybillNo = true;
    const fields = ['pieces', 'weight', 'volume', 'marks'];
    fields.forEach(f => {
      if (info[f] && info[f].manualReview) manualReview[f] = true;
    });
    // 联系人信息不从AI识别填充，由用户手动填写

    this.setData({
      'cargoInfo.waybillNo': info.waybillNo && info.waybillNo.val != null ? String(info.waybillNo.val) : this.data.cargoInfo.waybillNo,
      'cargoInfo.pieces': info.pieces && info.pieces.val != null ? String(info.pieces.val) : this.data.cargoInfo.pieces,
      'cargoInfo.piecesUnit': info.pieces && info.pieces.unit || this.data.cargoInfo.piecesUnit,
      'cargoInfo.grossWeight': info.weight && info.weight.val != null ? String(info.weight.val) : this.data.cargoInfo.grossWeight,
      'cargoInfo.weightUnit': info.weight && info.weight.unit || this.data.cargoInfo.weightUnit,
      'cargoInfo.volume': info.volume && info.volume.val != null ? String(info.volume.val) : this.data.cargoInfo.volume,
      'cargoInfo.volumeUnit': info.volume && info.volume.unit || this.data.cargoInfo.volumeUnit,
      'cargoInfo.marks': info.marks && info.marks.val != null ? String(info.marks.val) : this.data.cargoInfo.marks,
      // 联系人信息不从AI识别填充，由用户手动填写
      'routing.warehouseName': routing.warehouseName && routing.warehouseName.val != null ? String(routing.warehouseName.val) : this.data.routing.warehouseName,
      'routing.destinationPort': routing.destinationPort && routing.destinationPort.val != null ? String(routing.destinationPort.val) : this.data.routing.destinationPort,
      'routing.departureTime': routing.departureTime && routing.departureTime.val != null ? String(routing.departureTime.val).slice(0, 10) : this.data.routing.departureTime,
      latestDeliveryDate: routing.latestDeliveryTime && routing.latestDeliveryTime.val != null ? String(routing.latestDeliveryTime.val).split(' ')[0] || '' : this.data.latestDeliveryDate,
      latestDeliveryTime: routing.latestDeliveryTime && routing.latestDeliveryTime.val != null ? String(routing.latestDeliveryTime.val).split(' ')[1] || '' : this.data.latestDeliveryTime,
      manualReview
    });
  },

  // 清除 AI 结果，切换为手动录入
  clearAIResult() {
    this.setData({
      aiResult: null,
      manualReview: {},
      attachmentFileId: ''
    });
  },

  onWaybillNoChange(e) {
    this.setData({ 'cargoInfo.waybillNo': e.detail.value });
  },
  onPiecesChange(e) {
    this.setData({ 'cargoInfo.pieces': e.detail.value });
  },
  onPiecesUnitChange(e) {
    const idx = parseInt(e.detail.value);
    this.setData({ piecesUnitIndex: idx, 'cargoInfo.piecesUnit': this.data.unitOptions.pieces[idx] });
  },
  onWeightChange(e) {
    this.setData({ 'cargoInfo.grossWeight': e.detail.value });
  },
  onWeightUnitChange(e) {
    const idx = parseInt(e.detail.value);
    this.setData({ weightUnitIndex: idx, 'cargoInfo.weightUnit': this.data.unitOptions.weight[idx] });
  },
  onVolumeChange(e) {
    this.setData({ 'cargoInfo.volume': e.detail.value });
  },
  onVolumeUnitChange(e) {
    const idx = parseInt(e.detail.value);
    this.setData({ volumeUnitIndex: idx, 'cargoInfo.volumeUnit': this.data.unitOptions.volume[idx] });
  },
  onMarksChange(e) {
    this.setData({ 'cargoInfo.marks': e.detail.value });
  },
  onContact1NameChange(e) {
    this.setData({ 'contacts.contact1Name': e.detail.value });
  },
  onContact1PhoneChange(e) {
    this.setData({ 'contacts.contact1Phone': e.detail.value });
  },
  onContact2NameChange(e) {
    this.setData({ 'contacts.contact2Name': e.detail.value });
  },
  onContact2PhoneChange(e) {
    this.setData({ 'contacts.contact2Phone': e.detail.value });
  },
  onRouteChange(e) {
    const idx = parseInt(e.detail.value);
    this.setData({ routeIndex: idx, routeName: this.data.routes[idx].name });
  },
  onWarehouseChange(e) {
    this.setData({ 'routing.warehouseName': e.detail.value });
  },
  onDestinationPortChange(e) {
    this.setData({ 'routing.destinationPort': e.detail.value });
  },
  onDepartureTimeChange(e) {
    this.setData({ 'routing.departureTime': e.detail.value });
  },
  clearDepartureTime() {
    this.setData({ 'routing.departureTime': '' });
  },
  onLatestDeliveryDateChange(e) {
    this.setData({ latestDeliveryDate: e.detail.value });
  },
  onLatestDeliveryTimeChange(e) {
    this.setData({ latestDeliveryTime: e.detail.value });
  },

  onPaymentTypeChange(e) {
    const idx = parseInt(e.detail.value);
    this.setData({ paymentTypeIndex: idx, paymentTypeLabel: this.data.paymentTypeOptions[idx] });
  },

  async onSubmit() {
    if (this.data.submitting) return;

    const { cargoInfo, contacts, routing, routes, routeIndex, latestDeliveryDate, latestDeliveryTime, attachmentFileId } = this.data;

    // 组合最晚进仓日期时间
    const submitRouting = { ...routing };
    if (latestDeliveryDate) {
      submitRouting.latestDeliveryTime = latestDeliveryTime ? `${latestDeliveryDate} ${latestDeliveryTime}` : latestDeliveryDate;
    }

    if (!cargoInfo.pieces || !cargoInfo.grossWeight || !cargoInfo.volume) {
      wx.showToast({ title: '请填写完整的货物信息', icon: 'none' });
      return;
    }
    if (!contacts.contact1Phone) {
      wx.showToast({ title: '请填写联系人1手机号', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });

    try {
      const paymentType = this.data.paymentTypeIndex === 0 ? 'monthly' : 'spot';
      let creatorName = wx.getStorageSync('userName') || '';
      // 如果 storage 中没有 userName，尝试从 users 集合查询
      if (!creatorName) {
        const userPhone = wx.getStorageSync('userPhone') || '';
        const userRole = wx.getStorageSync('userRole') || '';
        if (userPhone && userRole) {
          try {
            const userRes = await wx.cloud.callFunction({
              name: 'user-login',
              data: { action: 'login', role: userRole, phone: userPhone }
            });
            if (userRes.result.code === 0 && userRes.result.data?.name) {
              creatorName = userRes.result.data.name;
              wx.setStorageSync('userName', creatorName);
            }
          } catch (e) {
            console.error('获取用户信息失败:', e);
          }
        }
      }
      const res = await wx.cloud.callFunction({
        name: 'shipment-create',
        data: {
          cargoInfo,
          contacts,
          routing: submitRouting,
          routeId: routes[routeIndex].id,
          paymentType,
          creatorName,
          attachmentFileId
        }
      });

      if (res.result.code === 0) {
        wx.showToast({ title: '创建成功', icon: 'success' });
        setTimeout(() => {
          wx.navigateTo({ url: `/pages/detail/index?id=${res.result.data.shipmentId}` });
        }, 1500);
      } else {
        wx.showToast({ title: res.result.message || '创建失败', icon: 'none' });
        this.setData({ submitting: false });
      }
    } catch (e) {
      wx.showToast({ title: '网络错误', icon: 'none' });
      this.setData({ submitting: false });
    }
  }
});
