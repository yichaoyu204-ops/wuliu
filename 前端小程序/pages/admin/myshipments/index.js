Page({
  data: {
    shipments: [],
    loading: false,
    isAdmin: false
  },

  onLoad() {
    const role = wx.getStorageSync('userRole') || '';
    this.setData({ isAdmin: role === 'admin' });
    this.loadShipments();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ activeIndex: 2 });
    }
  },

  onPullDownRefresh() {
    this.loadShipments().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadShipments() {
    this.setData({ loading: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-query',
        data: { action: 'myShipments' }
      });

      if (res.result.code === 0) {
        this.setData({ shipments: res.result.data.list || [] });
      } else {
        wx.showToast({ title: res.result.message || '加载失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
    }

    this.setData({ loading: false });
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/index?id=${id}` });
  },

  goToCreate() {
    wx.switchTab({ url: '/pages/admin/create/index' });
  },

  // 管理员删除运单
  async deleteShipment(e) {
    const id = e.currentTarget.dataset.id;
    const { isAdmin } = this.data;
    if (!isAdmin) {
      wx.showToast({ title: '仅限管理员', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认删除',
      content: '删除后不可恢复，是否确认？',
      confirmColor: '#E53935',
      success: (res) => {
        if (res.confirm) this.doDelete(id);
      }
    });
  },

  async doDelete(shipmentId) {
    wx.showLoading({ title: '删除中...', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-update',
        data: { action: 'delete', shipmentId }
      });
      wx.hideLoading();
      if (res.result.code === 0) {
        wx.showToast({ title: '已删除', icon: 'success' });
        this.loadShipments();
      } else {
        wx.showToast({ title: res.result.message || '删除失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  }
});
