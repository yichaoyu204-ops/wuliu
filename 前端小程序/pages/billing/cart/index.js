const app = getApp();

Page({
  data: {
    bills: [],
    filteredBills: [],
    activeTab: 'all',
    loading: false,
    phone: '',
    role: '',
    isAdmin: false,
    tabs: [
      { key: 'all', label: '全部' },
      { key: 'unpaid', label: '待付' },
      { key: 'paid', label: '已付' }
    ]
  },

  onLoad() {
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo') || {};
    const role = wx.getStorageSync('userRole') || '';
    const phone = userInfo.phone || '';
    const isAdmin = role === 'admin';
    this.setData({ phone, role, isAdmin });
    if (phone || isAdmin) {
      this.loadBills();
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
      if (this.getTabBar().loadBadge) {
        this.getTabBar().loadBadge();
      }
    }
    if (this.data.phone || this.data.isAdmin) {
      this.loadBills();
    }
  },

  async loadBills() {
    const { phone, isAdmin, role } = this.data;
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'billing-manage',
        data: isAdmin
          ? { action: 'pendingBills' }
          : { action: 'billList', phone }
      });

      if (res.result.code === 0) {
        const bills = (res.result.data || []).map(item => this.normalizeBill(item));
        this.setData({ bills });
        this.filterBills(this.data.activeTab);
      } else {
        if (isAdmin) {
          await this.loadAdminBillsFallback(role);
        } else {
          wx.showToast({ title: res.result.message || '加载失败', icon: 'none' });
        }
      }
    } catch (e) {
      console.error('加载账单失败:', e);
      if (isAdmin) {
        await this.loadAdminBillsFallback(role);
      } else {
        wx.showToast({ title: '网络错误', icon: 'none' });
      }
    }
    this.setData({ loading: false });
  },

  async loadAdminBillsFallback(role) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'shipment-query',
        data: {
          action: 'workflowList',
          role: role || 'admin',
          includeCompleted: false
        }
      });

      if (res.result.code === 0) {
        const shipments = res.result.data?.billing || [];
        const bills = shipments.map(item => this.shipmentToBill(item)).map(item => this.normalizeBill(item));
        this.setData({ bills });
        this.filterBills(this.data.activeTab);
      } else {
        wx.showToast({ title: res.result.message || '加载失败', icon: 'none' });
      }
    } catch (e) {
      console.error('账单兜底加载失败:', e);
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  shipmentToBill(item) {
    const amount = item.pricing?.finalPrice || item.quote?.subtotal || item.totalAmount || 0;
    return {
      _id: item.billing?.billId || `SHIP-${item._id}`,
      shipmentId: item._id,
      clientPhone: item.managerPhone || item.contacts?.contact1Phone || '',
      clientName: item.clientName || item.contacts?.contact1Name || '',
      factoryName: item.factoryName || item.creatorName || '',
      contacts: item.contacts || {},
      totalAmount: amount,
      paidAmount: item.billing?.paidAmount || 0,
      status: item.billing?.paymentStatus === 'paid' ? 'paid' : 'unpaid',
      paymentType: item.billing?.paymentType || 'monthly',
      items: item.quote?.items || (item.pricing ? [{
        name: '运费',
        calculationDetail: `重量价:${item.pricing.weightPrice || 0} / 体积价:${item.pricing.volumePrice || 0}`,
        amount
      }] : [])
    };
  },

  normalizeBill(item) {
    const totalAmount = Number(item.totalAmount || 0);
    return {
      ...item,
      _factoryName: item.contacts?.contact1Name || item.clientName || item.factoryName || '——',
      _totalAmountText: totalAmount.toFixed(2),
      _items: (item.items || []).map(fee => ({
        ...fee,
        _amountText: Number(fee.amount || 0).toFixed(2)
      }))
    };
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
    if (this.data.phone || this.data.isAdmin) {
      this.loadBills();
    }
  }
});
