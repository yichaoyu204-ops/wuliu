Page({
  data: {
    keyword: '',
    shipment: null,
    currentNode: null,
    nextNode: null,
    canAdvance: false,
    hasSearched: false,
    advancing: false
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  search() {
    const k = this.data.keyword.trim();
    if (!k) {
      wx.showToast({ title: '请输入业务编号', icon: 'none' });
      return;
    }
    this.queryShipment(k);
  },

  scanCode() {
    wx.scanCode({
      success: (res) => {
        this.setData({ keyword: res.result });
        this.queryShipment(res.result);
      },
      fail: () => {
        wx.showToast({ title: '扫码取消', icon: 'none' });
      }
    });
  },

  async queryShipment(shipmentId) {
    wx.showLoading({ title: '查询中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-query',
        data: { action: 'detail', shipmentId }
      });
      if (res.result.code === 0 && res.result.data) {
        const s = res.result.data;
        const timeline = s.timeline || [];
        const currentIndex = timeline.findIndex(n => n.status === 'active');
        const currentNode = currentIndex >= 0 ? timeline[currentIndex] : null;
        const nextNode = currentIndex >= 0 && currentIndex < timeline.length - 1 ? timeline[currentIndex + 1] : null;

        this.setData({
          shipment: s,
          currentNode,
          nextNode,
          canAdvance: currentNode !== null,
          hasSearched: true
        });
      } else {
        wx.showToast({ title: '运单不存在', icon: 'none' });
        this.setData({ shipment: null, hasSearched: true });
      }
    } catch (e) {
      wx.showToast({ title: '查询失败', icon: 'none' });
    }
    wx.hideLoading();
  },

  async advanceNode() {
    if (this.data.advancing || !this.data.shipment) return;
    this.setData({ advancing: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-update',
        data: {
          action: 'advanceNode',
          shipmentId: this.data.shipment._id
        }
      });

      if (res.result.code === 0) {
        wx.showToast({ title: '节点更新成功', icon: 'success' });
        // 重新查询刷新状态
        this.queryShipment(this.data.shipment._id);
      } else {
        wx.showToast({ title: res.result.message || '更新失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
    this.setData({ advancing: false });
  }
});
