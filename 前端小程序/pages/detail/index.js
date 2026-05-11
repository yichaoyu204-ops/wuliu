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
    routes: [
      { id: 'route_yw_mh_hub', name: '义乌→萌恒仓库（经义乌中转仓）' },
      { id: 'route_yw_bl_hub', name: '义乌→北仑方向其他仓库（经义乌中转仓）' },
      { id: 'route_yw_mh_direct', name: '义乌→萌恒仓库（工厂直发）' },
      { id: 'route_yw_bl_direct', name: '义乌→北仑方向其他仓库（工厂直发）' }
    ]
  },

  onLoad(options) {
    const id = options.id || '';
    const token = options.shareToken || '';

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
    this.setData({ canEdit: role === 'warehouse' || role === 'admin', role });
  },

  async fetchDetail(shipmentId, shareToken) {
    this.setData({ loading: true });

    try {
      const params = { action: 'detail' };
      if (shipmentId) params.shipmentId = shipmentId;
      if (shareToken) params.shareToken = shareToken;

      const res = await wx.cloud.callFunction({
        name: 'shipment-query',
        data: params
      });

      if (res.result.code === 0 && res.result.data) {
        const shipment = res.result.data;

        // 给 timeline 节点添加显示文案
        const displayMap = {
          pickup: '已提货，工厂送货/上门提货',
          yiwu_entry: '已入库，义乌中转仓入库',
          mainline: '已出库，干线运输中',
          nb_entry: '已完成入库'
        };
        const statusLabelMap = {
          pickup: { active: '进行中', completed: '已完成' },
          yiwu_entry: { active: '待入库', completed: '已入库' },
          mainline: { active: '待出库', completed: '已出库' },
          nb_entry: { active: '进行中', completed: '已完成' }
        };
        if (shipment.timeline) {
          shipment.timeline = shipment.timeline.map(node => ({
            ...node,
            displayName: displayMap[node.nodeCode] || node.nodeName,
            displayStatus: statusLabelMap[node.nodeCode]?.[node.status] || (node.status === 'completed' ? '已完成' : (node.status === 'active' ? '进行中' : '待处理'))
          }));
        }

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

  initEditForm() {
    const s = this.data.shipment;
    if (!s) return;
    this.setData({
      editForm: {
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
          subTitle = '已建单，等待仓管员实测';
        } else if (oaStatus === 'measured_priced') {
          subTitle = '已实测定价，等待管理员确认';
        } else if (oaStatus === 'admin_confirmed') {
          subTitle = '管理员已确认，等待入库';
        }
        icon = '';
        break;
      case 'yiwu_entry':
        mainTitle = '义乌中转仓入库';
        if (oaStatus === 'measured_priced') {
          subTitle = '已实测定价，等待管理员确认';
        } else if (oaStatus === 'admin_confirmed') {
          subTitle = '管理员已确认，等待出库';
        }
        icon = '';
        break;
      case 'mainline':
        mainTitle = '已出库，干线运输中';
        subTitle = '货物已出库，正在运输途中';
        icon = '';
        break;
      case 'nb_entry':
        mainTitle = '入库完成';
        subTitle = '货物已送达，等待报关';
        icon = '';
        break;
    }

    if (shipment.status === 'completed') {
      mainTitle = '流程已完结';
      subTitle = '货物运输已完成';
        icon = '';
    }

    return { mainTitle, subTitle, icon };
  },

  getStatusDesc(shipment) {
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
    const photos = this.data.shipment.measurement?.photos || [];
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
          const qrUrl = '/images/pay-qr.png';
          wx.previewImage({ urls: [qrUrl] });
        }
      }
    });
  },

  // 仓管员确认信息后，选择下一步
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

  // 仓管员/管理员：推进物流节点
  async advanceNode() {
    const shipment = this.data.shipment;
    if (!shipment) return;

    const timeline = shipment.timeline || [];
    const activeNode = timeline.find(n => n.status === 'active');
    if (!activeNode) {
      wx.showToast({ title: '没有进行中的节点', icon: 'none' });
      return;
    }

    const actionText = activeNode.nodeCode === 'pickup' ? '确认入库' : '确认出库';

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
      'routeEditForm.routeId': selected.id
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
      title: `${shipment.cargoInfo.waybillNo || '运单'} - ${shipment.currentNodeName || '运输中'}`,
      path: `/pages/detail/index?shareToken=${shipment.shareToken}`,
      imageUrl: '/images/share-cover.png'
    };
  }
});
