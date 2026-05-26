Component({
  data: {
    role: '',
    isAdmin: false,
    activeIndex: 0,
    badgeValue: 0,
    appointmentBadgeValue: 0,
    billingBadgeValue: 0
  },

  lifetimes: {
    attached() {
      const role = wx.getStorageSync('userRole') || '';
      this.setData({ role, isAdmin: role === 'admin' });
      this.loadBadge();
    }
  },

  methods: {
    loadBadge() {
      const role = wx.getStorageSync('userRole') || '';
      if (!role) return;
      if (role === 'salesman') {
        this.setData({ badgeValue: 0 });
      } else {
      wx.cloud.callFunction({
        name: 'shipment-query',
        data: { action: 'pendingCount', role }
      }).then(res => {
        if (res.result.code === 0) {
          this.setData({ badgeValue: res.result.data.count });
        }
      }).catch(() => {});
      }

      if (role === 'warehouse') {
        this.setData({ appointmentBadgeValue: 0 });
        this.setData({ billingBadgeValue: 0 });
        return;
      }

      if (role === 'admin') {
        wx.cloud.callFunction({
          name: 'shipment-query',
          data: { action: 'appointmentCount', role: 'admin' }
        }).then(res => {
          if (res.result.code === 0) {
            this.setData({ appointmentBadgeValue: res.result.data.count });
          }
        }).catch(() => {});
      }

      const userInfo = getApp().globalData.userInfo || wx.getStorageSync('userInfo') || {};
      wx.cloud.callFunction({
        name: 'billing-manage',
        data: {
          action: 'unpaidCount',
          role,
          phone: userInfo.phone || ''
        }
      }).then(res => {
        if (res.result.code === 0) {
          this.setData({ billingBadgeValue: res.result.data.count });
        }
      }).catch(() => {});
    },

    switchTab(e) {
      const idx = Number(e.currentTarget.dataset.index);
      const isAdmin = this.data.isAdmin;

      const routes = isAdmin
        ? ['pages/index/index', 'pages/admin/create/index', 'pages/admin/myshipments/index', 'pages/workflow/index', 'pages/admin/appointment/index', 'pages/billing/cart/index']
        : ['pages/index/index', 'pages/admin/create/index', 'pages/workflow/index', 'pages/billing/cart/index'];

      const pages = getCurrentPages();
      const cur = pages[pages.length - 1].route;
      if (cur === routes[idx]) return;

      wx.switchTab({ url: '/' + routes[idx] });
      this.setData({ activeIndex: idx });
    }
  }
});
