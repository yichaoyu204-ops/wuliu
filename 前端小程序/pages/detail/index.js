const app = getApp();

Page({
  data: {
    shipment: null,
    loading: true,
    statusIcon: '',
    statusDesc: '',
    statusMainTitle: '',
    statusSubTitle: '',
    canEdit: false,
    isEditing: false,
    editForm: {},
    role: '',
    isEditingRoute: false,
    routeEditForm: {},
    isEditingMeasurement: false,
    measurementEditForm: {},
    paymentTypeNameMap: {
      monthly: '萌恒月结',
      spot: '供应商现结',
      supplier_monthly: '供应商月结'
    },
    routes: [
      { id: 'route_yw_haitong_anda', name: '义乌→海通安达', warehouseName: '海通安达' },
      { id: 'route_yw_leyi_warehouse', name: '义乌→乐祎仓库', warehouseName: '乐祎仓库' },
      { id: 'route_yw_shunhang_warehouse', name: '义乌→顺航仓库', warehouseName: '顺航仓库' },
      { id: 'route_yw_other_warehouse', name: '义乌→其他仓库', warehouseName: '' }
    ]
  },

  onLoad(options) {
    const id = options.id || '';
    const token = options.shareToken || options.token || '';

    if (!id && !token) {
      wx.showToast({ title: '缺少参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    this.checkEditPermission();
    this.fetchDetail(id, token);
  },

  checkEditPermission() {
    const role = wx.getStorageSync('userRole') || '';
    const canEdit = role === 'warehouse' || role === 'admin';
    this.setData({ canEdit, role });
  },

  async fetchDetail(shipmentId, shareToken) {
    this.setData({ loading: true });

    try {
      const params = { action: 'detail' };
      if (shipmentId) params.shipmentId = shipmentId;
      if (shareToken) params.shareToken = shareToken;
      const role = wx.getStorageSync('userRole') || '';
      if (role) params.role = role;

      const res = await wx.cloud.callFunction({
        name: 'shipment-query',
        data: params
      });

      if (res.result.code === 0 && res.result.data) {
        const shipment = res.result.data;
        this.decorateAppointment(shipment);

        // 给 timeline 节点添加显示文案
        const displayMap = {
          pickup: '已提货，工厂送货/上门提货',
          yiwu_entry: '已收货，义乌中转仓收货',
          mainline: '已发运，干线运输中',
          nb_entry: '已进入目标仓库'
        };
        const statusLabelMap = {
          pickup: { active: '进行中', completed: '已完成' },
          yiwu_entry: { active: '待收货', completed: '已收货' },
          mainline: { active: '运输中', completed: '已发运' },
          nb_entry: { active: '已进入目标仓库', completed: '已进入目标仓库' }
        };
        if (shipment.timeline) {
          shipment.timeline = shipment.timeline.map(node => ({
            ...node,
            displayName: displayMap[node.nodeCode] || node.nodeName,
            displayStatus: statusLabelMap[node.nodeCode]?.[node.status] || (node.status === 'completed' ? '已完成' : (node.status === 'active' ? '进行中' : '待处理'))
          }));
        }
        shipment.paymentTypeLabel = this.getPaymentTypeLabel(shipment.billing?.paymentType || 'monthly');
        this.decorateAdminPriceDetails(shipment);

        const statusCard = this.getStatusCard(shipment);
        const timeline = shipment.timeline || [];
        const activeNode = timeline.find(n => n.status === 'active');
        const activeCode = activeNode ? activeNode.nodeCode : '';
        const role = this.data.role;

        this.setData({
          shipment,
          statusIcon: statusCard.icon,
          statusMainTitle: statusCard.mainTitle,
          statusSubTitle: statusCard.subTitle,
          statusDesc: this.getStatusDesc(shipment),
          showConfirmInbound: role === 'warehouse' && activeCode === 'pickup' && shipment.oaStatus !== 'created',
          showConfirmOutbound: role === 'warehouse' && activeCode === 'yiwu_entry'
        }, () => {
          this.initEditForm();
          this.initRouteEditForm();
          this.initMeasurementEditForm();
        });
      } else {
        this.setData({ shipment: null });
        wx.showToast({ title: res.result.message || '查询失败', icon: 'none' });
      }
    } catch (e) {
      this.setData({ shipment: null });
      wx.showToast({ title: '网络错误', icon: 'none' });
    }

    this.setData({ loading: false });
  },

  decorateAdminPriceDetails(shipment) {
    if (!shipment || this.data.role !== 'admin') {
      if (shipment) shipment.adminPriceItems = [];
      return;
    }

    const quoteItems = shipment.quote?.items || [];
    const feeItems = shipment.fees || [];
    const pricingAmount = shipment.quote?.subtotal || shipment.pricing?.finalPrice || shipment.totalAmount || 0;

    if (quoteItems.length > 0) {
      shipment.adminPriceItems = quoteItems.map(item => ({
        name: item.name || '费用',
        calculationDetail: item.calculationDetail || item.detail || '',
        amount: Number(item.amount || 0).toFixed(2),
        isIncluded: item.isIncluded !== false
      }));
      shipment.adminPriceTotal = Number(pricingAmount || 0).toFixed(2);
      shipment.adminPriceStatusText = shipment.quote.status === 'confirmed'
        ? '已确认'
        : (shipment.quote.status === 'sent' ? '已发送' : '草稿');
      shipment.adminPriceStatusClass = shipment.quote.status || 'draft';
      shipment.adminPriceNote = shipment.quote.note || '';
      return;
    }

    if (feeItems.length > 0) {
      shipment.adminPriceItems = feeItems.map(item => ({
        name: item.name || '费用',
        calculationDetail: item.calculationDetail || item.detail || '',
        amount: Number(item.amount || 0).toFixed(2),
        isIncluded: true
      }));
      shipment.adminPriceTotal = Number(shipment.totalAmount || pricingAmount || 0).toFixed(2);
      shipment.adminPriceStatusText = '实测费用';
      shipment.adminPriceStatusClass = 'draft';
      shipment.adminPriceNote = '';
      return;
    }

    if (Number(pricingAmount) > 0) {
      shipment.adminPriceItems = [{
        name: '运费',
        calculationDetail: shipment.pricing ? `重量价:${shipment.pricing.weightPrice || 0} / 体积价:${shipment.pricing.volumePrice || 0}` : '',
        amount: Number(pricingAmount || 0).toFixed(2),
        isIncluded: true
      }];
      shipment.adminPriceTotal = Number(pricingAmount || 0).toFixed(2);
      shipment.adminPriceStatusText = '最终价格';
      shipment.adminPriceStatusClass = 'confirmed';
      shipment.adminPriceNote = '';
      return;
    }

    shipment.adminPriceItems = [];
  },

  decorateAppointment(shipment) {
    const appointment = shipment.warehouseAppointment || {};
    const scheduledAt = appointment.scheduledAt || '';
    const completed = !!(appointment.isCompleted && scheduledAt);
    shipment.appointmentCompleted = completed;
    shipment.appointmentTimeText = completed ? this.formatAppointmentTime(scheduledAt) : '';
    shipment.appointmentTagText = completed
      ? `已完成进仓预约，时间为${shipment.appointmentTimeText}`
      : '暂未完成进仓预约';
    shipment.appointmentTagClass = completed ? 'done' : 'pending';
  },

  formatAppointmentTime(value) {
    if (!value) return '';
    return String(value).replace('T', ' ').slice(0, 16);
  },

  initEditForm() {
    const s = this.data.shipment;
    if (!s) return;
    this.setData({
      editForm: {
        warehouseEntryNo: s.cargoInfo?.warehouseEntryNo || '',
        waybillNo: s.cargoInfo?.waybillNo || '',
        pieces: s.cargoInfo?.pieces != null ? String(s.cargoInfo.pieces) : '',
        grossWeight: s.cargoInfo?.grossWeight != null ? String(s.cargoInfo.grossWeight) : '',
        weightUnit: s.cargoInfo?.weightUnit || 'KGS',
        volume: s.cargoInfo?.volume != null ? String(s.cargoInfo.volume) : '',
        volumeUnit: s.cargoInfo?.volumeUnit || 'CBM',
        marks: s.cargoInfo?.marks || '',
        destinationPort: s.routing?.destinationPort || '',
        warehouseName: s.routing?.warehouseName || '',
        contact1Name: s.contacts?.contact1Name || '',
        contact1Phone: s.contacts?.contact1Phone || '',
        contact2Name: s.contacts?.contact2Name || '',
        contact2Phone: s.contacts?.contact2Phone || '',
        paymentType: s.billing?.paymentType || 'monthly'
      }
    });
  },

  toggleEdit() {
    if (this.data.isEditing) {
      // 取消编辑，恢复原始数据
      this.initEditForm();
    }
    this.setData({ isEditing: !this.data.isEditing });
  },

  onEditInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`editForm.${field}`]: e.detail.value });
  },

  onPaymentTypeChange(e) {
    this.setData({ 'editForm.paymentType': e.detail.value });
  },

  getPaymentTypeLabel(paymentType) {
    return this.data.paymentTypeNameMap[paymentType] || '萌恒月结';
  },

  async saveEdit() {
    const { shipment, editForm } = this.data;
    if (!shipment) return;

    wx.showLoading({ title: '保存中...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-update',
        data: {
          action: 'updateInfo',
          shipmentId: shipment._id,
          data: {
            cargoInfo: {
              warehouseEntryNo: editForm.warehouseEntryNo,
              waybillNo: editForm.waybillNo,
              pieces: editForm.pieces ? parseInt(editForm.pieces, 10) : 0,
              grossWeight: parseFloat(editForm.grossWeight) || 0,
              weightUnit: editForm.weightUnit,
              volume: parseFloat(editForm.volume) || 0,
              volumeUnit: editForm.volumeUnit,
              marks: editForm.marks
            },
            routing: {
              destinationPort: editForm.destinationPort,
              warehouseName: editForm.warehouseName
            },
            contacts: {
              contact1Name: editForm.contact1Name,
              contact1Phone: editForm.contact1Phone,
              contact2Name: editForm.contact2Name,
              contact2Phone: editForm.contact2Phone
            },
            paymentType: editForm.paymentType
          }
        }
      });

      wx.hideLoading();

      if (res.result.code === 0) {
        wx.showToast({ title: '保存成功', icon: 'success' });
        this.setData({ isEditing: false });
        this.fetchDetail(shipment._id, '');
      } else {
        wx.showToast({ title: res.result.message || '保存失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  getStatusCard(shipment) {
    const timeline = shipment.timeline || [];
    const activeNode = timeline.find(n => n.status === 'active');
    const activeCode = activeNode ? activeNode.nodeCode : '';
    const oaStatus = shipment.oaStatus || '';

    let mainTitle = shipment.currentNodeName || '运输中';
    let subTitle = '货物运输中，请耐心等待';
    let icon = '';

    switch (activeCode) {
      case 'pickup':
        mainTitle = '工厂送货/上门提货';
        if (oaStatus === 'created') {
          subTitle = '已建单，等待接单员实测';
        } else if (oaStatus === 'measured_priced') {
          subTitle = '已实测定价，等待管理员确认';
        } else if (oaStatus === 'admin_confirmed') {
          subTitle = '管理员已确认，等待收货';
        }
        icon = '';
        break;
      case 'yiwu_entry':
        mainTitle = '义乌中转仓收货';
        if (oaStatus === 'measured_priced') {
          subTitle = '已实测定价，等待管理员确认';
        } else if (oaStatus === 'admin_confirmed') {
          subTitle = '管理员已确认，等待发运';
        }
        icon = '';
        break;
      case 'mainline':
        mainTitle = '运输中';
        subTitle = '已发运，干线运输中';
        icon = '';
        break;
      case 'nb_entry':
        mainTitle = '已进入目标仓库';
        subTitle = '目标仓库已确认送达';
        icon = '';
        break;
    }

    if (shipment.status === 'completed' && !['mainline', 'nb_entry'].includes(activeCode)) {
      mainTitle = '流程已完结';
      subTitle = '货物运输已完成';
        icon = '';
    }

    return { mainTitle, subTitle, icon };
  },

  getStatusDesc(shipment) {
    const activeNode = (shipment.timeline || []).find(n => n.status === 'active');
    if (activeNode?.nodeCode === 'mainline') return '货物已发运，干线运输中';
    if (activeNode?.nodeCode === 'nb_entry' || shipment.status === 'arrived_target_warehouse') return '货物已进入目标仓库';
    if (shipment.status === 'completed') return '货物已送达，运输完成';
    if (shipment.quote?.status === 'sent') return '报价已发送，等待客户确认';
    if (shipment.quote?.status === 'confirmed') {
      return shipment.billing?.paymentType === 'spot'
        ? '客户已确认，现场支付'
        : '客户已确认，月结入账';
    }
    if (shipment.measurement?.status === 'measured') return '仓库实测完成，待生成报价';
    return '货物运输中，请耐心等待';
  },

  previewPhoto(e) {
    const url = e.currentTarget.dataset.url;
    const photos = (this.data.shipment.timeline || []).flatMap(node => node.photos || []);
    wx.previewImage({ current: url, urls: photos });
  },

  previewAttachment() {
    const fileId = this.data.shipment.attachmentFileId;
    if (!fileId) return;
    wx.previewImage({ urls: [fileId] });
  },

  goConfirm() {
    const id = this.data.shipment._id;
    wx.navigateTo({ url: `/pages/confirm/quote/index?id=${id}` });
  },

  goPay() {
    const shipment = this.data.shipment;
    wx.showModal({
      title: '现场扫码支付',
      content: `请向客户展示收款码，收款金额：¥${shipment.quote?.subtotal || 0}`,
      confirmText: '展示收款码',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          const qrUrls = [
            '/images/payment/wechat-pay.jpg',
            '/images/payment/alipay.jpg'
          ];
          wx.previewImage({ current: qrUrls[0], urls: qrUrls });
        }
      }
    });
  },

  // 接单员确认信息后，选择下一步
  confirmInfo() {
    const shipmentId = this.data.shipment?._id;
    if (!shipmentId) return;

    wx.showActionSheet({
      itemList: ['返回流程主页', '去实测定价'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.switchTab({ url: '/pages/workflow/index' });
        } else if (res.tapIndex === 1) {
          wx.navigateTo({ url: `/pages/admin/measure/index?shipmentId=${shipmentId}` });
        }
      }
    });
  },

  // 接单员/管理员：推进物流节点
  async advanceNode() {
    const shipment = this.data.shipment;
    if (!shipment) return;

    const timeline = shipment.timeline || [];
    const activeNode = timeline.find(n => n.status === 'active');
    if (!activeNode) {
      wx.showToast({ title: '没有进行中的节点', icon: 'none' });
      return;
    }

    const actionText = activeNode.nodeCode === 'pickup' ? '确认收货' : '确认发运';

    wx.showModal({
      title: `确认${actionText}`,
      content: `确认${actionText}？`,
      success: (res) => {
        if (res.confirm) this.doAdvanceNode(shipment._id);
      }
    });
  },

  async doAdvanceNode(shipmentId) {
    wx.showLoading({ title: '处理中...', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-update',
        data: { action: 'advanceNode', shipmentId }
      });
      wx.hideLoading();
      if (res.result.code === 0) {
        wx.showToast({ title: '操作成功', icon: 'success' });
        this.fetchDetail(shipmentId, '');
      } else {
        wx.showToast({ title: res.result.message || '操作失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  // 路线编辑
  initRouteEditForm() {
    const s = this.data.shipment;
    if (!s) return;
    const routeIndex = this.data.routes.findIndex(r => r.id === s.routeId);
    this.setData({
      routeEditForm: {
        routeId: s.routeId || '',
        routeIndex: routeIndex >= 0 ? routeIndex : 0,
        warehouseName: s.routing?.warehouseName || ''
      }
    });
  },

  toggleRouteEdit() {
    if (this.data.isEditingRoute) {
      this.initRouteEditForm();
    }
    this.setData({ isEditingRoute: !this.data.isEditingRoute });
  },

  onRouteInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`routeEditForm.${field}`]: e.detail.value });
  },

  onRouteChange(e) {
    const idx = parseInt(e.detail.value);
    const selected = this.data.routes[idx];
    this.setData({
      'routeEditForm.routeIndex': idx,
      'routeEditForm.routeId': selected.id,
      'routeEditForm.warehouseName': selected.warehouseName
    });
  },

  async saveRouteEdit() {
    const { shipment, routeEditForm } = this.data;
    if (!shipment) return;

    wx.showLoading({ title: '保存中...', mask: true });
    try {
      const payload = {
        routing: {
          warehouseName: routeEditForm.warehouseName
        }
      };
      // 如果路线变了，传递 routeId 让后端重置 timeline
      if (routeEditForm.routeId && routeEditForm.routeId !== shipment.routeId) {
        payload.routeId = routeEditForm.routeId;
      }

      const res = await wx.cloud.callFunction({
        name: 'shipment-update',
        data: {
          action: 'updateInfo',
          shipmentId: shipment._id,
          data: payload
        }
      });
      wx.hideLoading();
      if (res.result.code === 0) {
        wx.showToast({ title: '保存成功', icon: 'success' });
        this.setData({ isEditingRoute: false });
        this.fetchDetail(shipment._id, '');
      } else {
        wx.showToast({ title: res.result.message || '保存失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  // 实测数据编辑
  initMeasurementEditForm() {
    const s = this.data.shipment;
    if (!s) return;
    const actual = s.measurement?.actual || {};
    this.setData({
      measurementEditForm: {
        pieces: actual.pieces != null ? String(actual.pieces) : '',
        weight: actual.weight != null ? String(actual.weight) : '',
        volume: actual.volume != null ? String(actual.volume) : '',
        weightUnit: actual.weightUnit || 'KGS',
        volumeUnit: actual.volumeUnit || 'CBM',
        note: s.measurement?.note || ''
      }
    });
  },

  toggleMeasurementEdit() {
    if (this.data.isEditingMeasurement) {
      this.initMeasurementEditForm();
    }
    this.setData({ isEditingMeasurement: !this.data.isEditingMeasurement });
  },

  onMeasurementInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`measurementEditForm.${field}`]: e.detail.value });
  },

  async saveMeasurementEdit() {
    const { shipment, measurementEditForm } = this.data;
    if (!shipment) return;

    wx.showLoading({ title: '保存中...', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-update',
        data: {
          action: 'updateInfo',
          shipmentId: shipment._id,
          data: {
            measurement: {
              actual: {
                pieces: measurementEditForm.pieces ? parseInt(measurementEditForm.pieces, 10) : 0,
                weight: parseFloat(measurementEditForm.weight) || 0,
                volume: parseFloat(measurementEditForm.volume) || 0,
                weightUnit: measurementEditForm.weightUnit,
                volumeUnit: measurementEditForm.volumeUnit
              },
              note: measurementEditForm.note
            }
          }
        }
      });
      wx.hideLoading();
      if (res.result.code === 0) {
        wx.showToast({ title: '保存成功', icon: 'success' });
        this.setData({ isEditingMeasurement: false });
        this.fetchDetail(shipment._id, '');
      } else {
        wx.showToast({ title: res.result.message || '保存失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  onShareAppMessage() {
    const shipment = this.data.shipment;
    if (!shipment) return {};
    return {
      title: `${shipment.cargoInfo.warehouseEntryNo || shipment.cargoInfo.waybillNo || '运单'} - ${shipment.currentNodeName || '运输中'}`,
      path: `/pages/detail/index?shareToken=${shipment.shareToken}`,
      imageUrl: '/images/share-cover.png'
    };
  }
});
