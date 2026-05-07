const app = getApp();

Page({
  data: {
    bills: [],
    filteredBills: [],
    activeTab: 'all',
    loading: false,
    phone: ''
  },

  tabs: [
    { key: 'all', label: '全部' },
    { key: 'unpaid', label: '待付' },
    { key: 'paid', label: '已付' }
  ],

  onLoad() {
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo') || {};
    const phone = userInfo.phone || '';
    this.setData({ phone });
    if (phone) {
      this.loadBills(phone);
    } else {
      wx.showModal({
        title: '提示',
        content: '请先登录后查看账单',
        showCancel: false,
        success: () => wx.switchTab({ url: '/pages/index/index' })
      });
    }
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      const role = wx.getStorageSync('userRole') || '';
      const isAdmin = role === 'admin';
      this.getTabBar().setData({ activeIndex: isAdmin ? 4 : 3 });
    }
  },

  async loadBills(phone) {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'billing-manage',
        data: { action: 'billList', phone }
      });

      if (res.result.code === 0) {
        const bills = res.result.data || [];
        this.setData({ bills });
        this.filterBills(this.data.activeTab);
      } else {
        wx.showToast({ title: res.result.message || '加载失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
    this.setData({ loading: false });
  },

  switchTab(e) {
    const { key } = e.currentTarget.dataset;
    this.setData({ activeTab: key });
    this.filterBills(key);
  },

  filterBills(key) {
    const { bills } = this.data;
    if (key === 'all') {
      this.setData({ filteredBills: bills });
    } else {
      this.setData({ filteredBills: bills.filter(b => b.status === key) });
    }
  },

  onRefresh() {
    if (this.data.phone) {
      this.loadBills(this.data.phone);
    }
  }
});
