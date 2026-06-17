Component({
  data: {
    role: '',
    isAdmin: false,
    isWarehouse: false,
    billingIndex: 3,
    activeIndex: 0,
    badgeValue: 0,
    appointmentBadgeValue: 0,
    billingBadgeValue: 0
  },

  lifetimes: {
    attached() {
      const role = wx.getStorageSync('userRole') || '';
      this.setRoleState(role);
      this.loadBadge();
    }
  },

  methods: {
    setRoleState(role) {
      const isAdmin = role === 'admin';
      const isWarehouse = role === 'warehouse';
      this.setData({
        role,
        isAdmin,
        isWarehouse,
        billingIndex: (isAdmin || isWarehouse) ? 4 : 3
      });
    },

    loadBadge() {
      const role = wx.getStorageSync('userRole') || '';
      if (!role) return;
      this.setRoleState(role);
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
        wx.cloud.callFunction({
          name: 'shipment-query',
          data: { action: 'appointmentCount', role: 'warehouse' }
        }).then(res => {
          if (res.result.code === 0) {
            this.setData({ appointmentBadgeValue: res.result.data.count });
          }
        }).catch(() => {});
        this.setData({ billingBadgeValue: 0 });
        return;
      }

      if (role === 'admin') {
        this.setData({ appointmentBadgeValue: 0 });
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
      const { isAdmin, isWarehouse } = this.data;

      const routes = isAdmin
        ? ['pages/index/index', 'pages/admin/create/index', 'pages/admin/myshipments/index', 'pages/workflow/index', 'pages/billing/cart/index']
        : (isWarehouse
          ? ['pages/index/index', 'pages/admin/create/index', 'pages/workflow/index', 'pages/admin/appointment/index', 'pages/billing/cart/index']
          : ['pages/index/index', 'pages/admin/create/index', 'pages/workflow/index', 'pages/billing/cart/index']);

      const pages = getCurrentPages();
      const cur = pages[pages.length - 1].route;
      if (cur === routes[idx]) return;

      wx.switchTab({ url: '/' + routes[idx] });
      this.setData({ activeIndex: idx });
    }
  }
});
