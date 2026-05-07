Page({
  data: {
    shipments: [],
    loading: false,
    pendingCount: 0
  },

  onLoad() {
    this.loadQueue();
  },

  onShow() {
    this.loadQueue();
  },

  async loadQueue() {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-query',
        data: { action: 'warehouseQueue', filter: { status: 'pending' } }
      });
      if (res.result.code === 0) {
        const list = res.result.data.list || [];
        this.setData({
          shipments: list,
          pendingCount: list.length
        });
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
    this.setData({ loading: false });
  },

  goMeasure(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/admin/measure/index?id=${id}` });
  }
});
