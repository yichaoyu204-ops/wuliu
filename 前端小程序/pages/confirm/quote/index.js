Page({
  data: {
    shipmentId: '',
    shipment: null,
    quote: null,
    paymentType: 'spot',
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
        data: { action: 'detail', shipmentId }
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

      this.setData({ shipment, quote });
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

    const paymentText = paymentType === 'spot' ? '现结' : '月结';
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
          ? '已确认，请等待仓管员确认收款'
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

  contactSales() {
    const id = this.data.shipmentId;
    wx.setClipboardData({
      data: id,
      success: () => {
        wx.showModal({
          title: '单号已复制',
          content: `业务编号 ${id} 已复制到剪贴板。如有异议，请将单号发送给业务员沟通。`,
          showCancel: false,
          confirmText: '知道了'
        });
      }
    });
  }
});
