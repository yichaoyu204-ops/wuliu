Page({
  data: {
    keyword: '',
    shipments: [],
    hasSearched: false,
    loading: false,
    history: [],
    pendingCount: 0,
    unpaidCount: 0,
    phone: '',
    userRole: '',
    showContactPopup: false,
    contact1: { name: '蒋先生', phone: '13857488715' },
    contact2: { name: '姚小姐', phone: '87507082' }
  },

  onLoad() {
    this.loadHistory();
  },

  onShow() {
    // 从其他页面返回时刷新历史
    this.loadHistory();
    // 加载待办流程数
    this.loadPendingCount();
    // 加载待支付账单数
    this.loadUnpaidCount();
    // 设置自定义tabBar选中状态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ activeIndex: 0 });
    }
  },

  async loadPendingCount() {
    const role = wx.getStorageSync('userRole') || '';
    if (!role) return;
    this.setData({ userRole: role });
    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-query',
        data: { action: 'pendingCount', role }
      });
      if (res.result.code === 0) {
        const count = res.result.data.count;
        this.setData({ pendingCount: count });
        // 同步更新 tabBar badge
        if (typeof this.getTabBar === 'function' && this.getTabBar()) {
          this.getTabBar().setData({ badgeValue: count });
          if (this.getTabBar().loadBadge) {
            this.getTabBar().loadBadge();
          }
        }
      }
    } catch (e) {
      console.error('加载待办数失败:', e);
    }
  },

  async loadUnpaidCount() {
    const role = wx.getStorageSync('userRole') || '';
    const userInfo = getApp().globalData.userInfo || wx.getStorageSync('userInfo') || {};
    const phone = userInfo.phone || '';
    if (!role || (role !== 'admin' && !phone)) return;
    this.setData({ phone });
    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-query',
        data: { action: 'billCount', role, phone }
      });
      if (res.result.code === 0) {
        const count = res.result.data.count;
        this.setData({ unpaidCount: count });
        if (typeof this.getTabBar === 'function' && this.getTabBar()) {
          this.getTabBar().setData({ billingBadgeValue: count });
        }
      }
    } catch (e) {
      console.error('加载待支付账单数失败:', e);
    }
  },

  goToWorkflow() {
    wx.switchTab({ url: '/pages/workflow/index' });
  },

  loadHistory() {
    const history = wx.getStorageSync('searchHistory') || [];
    this.setData({ history });
  },

  onInputChange(e) {
    this.setData({ keyword: e.detail.value });
  },

  async onSearch() {
    const { keyword } = this.data;
    const k = keyword.trim();
    if (!k) {
      wx.showToast({ title: '请输入业务编号/手机号/名字', icon: 'none' });
      return;
    }

    this.setData({ loading: true, hasSearched: true });

    try {
      // 策略1：先按名字查
      const nameRes = await wx.cloud.callFunction({
        name: 'shipment-query',
        data: { action: 'queryByPhone', name: k }
      });

      if (nameRes.result.code === 0 && nameRes.result.data && nameRes.result.data.length > 0) {
        this.setData({ shipments: nameRes.result.data });
        this.saveHistory(k);
        this.setData({ loading: false });
        return;
      }

      // 策略2：按手机号查
      const phoneRes = await wx.cloud.callFunction({
        name: 'shipment-query',
        data: { action: 'queryByPhone', phone: k }
      });

      if (phoneRes.result.code === 0 && phoneRes.result.data && phoneRes.result.data.length > 0) {
        this.setData({ shipments: phoneRes.result.data });
        this.saveHistory(k);
        this.setData({ loading: false });
        return;
      }

      // 策略3：按单号查
      const detailRes = await wx.cloud.callFunction({
        name: 'shipment-query',
        data: { action: 'detail', shipmentId: k }
      });

      if (detailRes.result.code === 0 && detailRes.result.data) {
        this.setData({ shipments: [detailRes.result.data] });
        this.saveHistory(k);
      } else {
        this.setData({ shipments: [] });
      }
    } catch (e) {
      wx.showToast({ title: '查询失败，请重试', icon: 'none' });
      this.setData({ shipments: [] });
    }

    this.setData({ loading: false });
  },

  saveHistory(keyword) {
    let history = wx.getStorageSync('searchHistory') || [];
    history = history.filter(item => item !== keyword);
    history.unshift(keyword);
    if (history.length > 10) history = history.slice(0, 10);
    wx.setStorageSync('searchHistory', history);
    this.setData({ history });
  },

  clearHistory() {
    wx.removeStorageSync('searchHistory');
    this.setData({ history: [] });
  },

  searchByHistory(e) {
    const keyword = e.currentTarget.dataset.keyword;
    this.setData({ keyword });
    this.onSearch();
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/index?id=${id}` });
  },

  goToBilling() {
    wx.switchTab({ url: '/pages/billing/cart/index' });
  },

  goToMyShipments() {
    wx.navigateTo({ url: '/pages/admin/myshipments/index' });
  },

  scanCode() {
    wx.scanCode({
      success: (res) => {
        const keyword = res.result;
        this.setData({ keyword });
        this.onSearch();
      },
      fail: () => {
        wx.showToast({ title: '扫码取消', icon: 'none' });
      }
    });
  },

  contactService() {
    this.setData({ showContactPopup: true });
  },

  hideContactPopup() {
    this.setData({ showContactPopup: false });
  },

  preventBubble() {
    // 阻止事件冒泡，点击弹窗内容不关闭
  },

  makePhoneCall(e) {
    const phone = e.currentTarget.dataset.phone;
    if (!phone) {
      wx.showToast({ title: '电话号码为空', icon: 'none' });
      return;
    }
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: () => {
        wx.showToast({ title: '拨打失败', icon: 'none' });
      }
    });
  },

  onLogout() {
    wx.showModal({
      title: '确认退出',
      content: '退出后将返回身份选择页面',
      success: (res) => {
        if (res.confirm) {
          wx.clearStorageSync();
          wx.reLaunch({ url: '/pages/role-select/index' });
        }
      }
    });
  }
});
