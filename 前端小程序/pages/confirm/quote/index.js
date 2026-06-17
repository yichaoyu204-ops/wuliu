Page({
  data: {
    shipmentId: '',
    shipment: null,
    quote: null,
    paymentType: 'spot',
    contactButtonText: '联系业务员',
    loading: false
  },

  onLoad(options) {
    const id = options.id || '';
    if (!id) {
      wx.showToast({ title: '缺少单号参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    this.setData({ shipmentId: id });
    this.fetchDetail(id);
  },

  async fetchDetail(shipmentId) {
    wx.showLoading({ title: '加载中...', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-query',
        data: { action: 'detail', shipmentId, role: wx.getStorageSync('userRole') || '' }
      });
      wx.hideLoading();

      if (res.result.code !== 0) {
        wx.showToast({ title: res.result.message || '查询失败', icon: 'none' });
        return;
      }

      const shipment = res.result.data || {};
      const quote = shipment.quote || {};

      if (quote.status !== 'sent') {
        wx.showModal({
          title: '提示',
          content: quote.status === 'confirmed' ? '该报价已确认' : '报价状态异常，无法操作',
          showCancel: false,
          success: () => wx.navigateBack()
        });
        return;
      }

      this.setData({
        shipment,
        quote,
        contactButtonText: this.getContactTarget(shipment).label
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  onPaymentChange(e) {
    this.setData({ paymentType: e.detail.value });
  },

  previewImage(e) {
    const currentUrl = e.currentTarget.dataset.url;
    const urls = this.data.shipment.measurement.photos || [];
    wx.previewImage({ current: currentUrl, urls });
  },

  onConfirm() {
    const { shipmentId, paymentType, quote, loading } = this.data;
    if (loading) return;
    if (!quote || quote.status !== 'sent') {
      wx.showToast({ title: '报价状态异常', icon: 'none' });
      return;
    }

    const paymentTextMap = {
      spot: '供应商现结',
      monthly: '萌恒月结',
      supplier_monthly: '供应商月结'
    };
    const paymentText = paymentTextMap[paymentType] || '萌恒月结';
    wx.showModal({
      title: '二次确认',
      content: `确认采用「${paymentText}」方式支付运费 ¥${parseFloat(quote.subtotal || 0).toFixed(2)} 吗？确认后无法撤销。`,
      confirmColor: '#E53935',
      success: (res) => {
        if (res.confirm) this.doConfirm(shipmentId, paymentType);
      }
    });
  },

  async doConfirm(shipmentId, paymentType) {
    this.setData({ loading: true });
    wx.showLoading({ title: '处理中...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-update',
        data: {
          action: 'quote',
          shipmentId,
          data: { subAction: 'confirm', paymentType }
        }
      });

      wx.hideLoading();

      if (res.result.code === 0) {
        const msg = paymentType === 'spot'
          ? '已确认，请等待接单员确认收款'
          : '已归入月结账单';
        wx.showToast({ title: msg, icon: 'success', duration: 2000 });
        setTimeout(() => {
          wx.redirectTo({ url: '/pages/index/index' });
        }, 2000);
      } else {
        wx.showToast({ title: res.result.message || '确认失败', icon: 'none' });
        this.setData({ loading: false });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  getContactTarget(shipment = {}) {
    const userInfo = getApp().globalData.userInfo || wx.getStorageSync('userInfo') || {};
    const currentPhone = userInfo.phone || wx.getStorageSync('userPhone') || '';
    const creatorPhone = shipment.creatorPhone || '';

    if (currentPhone && creatorPhone && currentPhone === creatorPhone) {
      return {
        label: '联系管理员',
        title: '联系管理员',
        phone: '15557041311',
        fallback: '当前未配置管理员手机号，请联系管理员处理。'
      };
    }

    return {
      label: '联系业务员',
      title: '联系业务员',
      phone: creatorPhone,
      fallback: '当前运单没有业务员手机号，请到运单详情查看联系人信息。'
    };
  },

  contactSales() {
    const shipment = this.data.shipment || {};
    const target = this.getContactTarget(shipment);
    const phone = target.phone || '';
    const id = shipment.cargoInfo?.waybillNo || shipment._id || this.data.shipmentId;

    if (phone) {
      wx.makePhoneCall({
        phoneNumber: phone,
        fail: () => {
          wx.showToast({ title: '拨打失败，请重试', icon: 'none' });
        }
      });
      return;
    }

    wx.showModal({
      title: target.title,
      content: `${target.fallback} 业务参与编号：${id}`,
      showCancel: false,
      confirmText: '知道了'
    });
  }
});
