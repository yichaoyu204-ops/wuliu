Page({
  data: {
    bills: [],
    filteredBills: [],
    activeTab: 'all',
    loading: false,
    totalUnpaid: 0,
    totalPaid: 0,
    monthlyModalVisible: false,
    monthlyBatch: '',
    monthlyPhone: '',
    monthlySubmitting: false
  },

  tabs: [
    { key: 'all', label: '全部' },
    { key: 'unpaid', label: '未付' },
    { key: 'paid', label: '已付' }
  ],

  onLoad() {
    this.loadBills();
  },

  async loadBills() {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'billing-manage',
        data: { action: 'pendingBills' }
      });

      if (res.result.code === 0) {
        const bills = res.result.data || [];
        const totalUnpaid = bills.filter(b => b.status === 'unpaid').reduce((s, b) => s + (b.totalAmount || 0), 0);
        const totalPaid = bills.filter(b => b.status === 'paid').reduce((s, b) => s + (b.paidAmount || 0), 0);
        this.setData({ bills, totalUnpaid, totalPaid });
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

  async markPaid(e) {
    const { id } = e.currentTarget.dataset;
    const bill = this.data.bills.find(b => b._id === id);
    if (!bill || bill.status === 'paid') return;

    wx.showModal({
      title: '确认标记已付',
      content: `确认将账单 ${id} 标记为已付吗？金额 ¥${(bill.totalAmount || 0).toFixed(2)}`,
      success: async (res) => {
        if (res.confirm) {
          try {
            const result = await wx.cloud.callFunction({
              name: 'billing-manage',
              data: {
                action: 'markPaid',
                billId: id,
                data: { amount: bill.totalAmount, note: '管理端标记已付' }
              }
            });
            if (result.result.code === 0) {
              wx.showToast({ title: '已标记为已付', icon: 'success' });
              this.loadBills();
            } else {
              wx.showToast({ title: result.result.message || '操作失败', icon: 'none' });
            }
          } catch (e) {
            wx.showToast({ title: '网络错误', icon: 'none' });
          }
        }
      }
    });
  },

  showMonthlyModal() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    this.setData({
      monthlyModalVisible: true,
      monthlyBatch: `${y}-${m}`,
      monthlyPhone: '',
      monthlySubmitting: false
    });
  },

  hideMonthlyModal() {
    this.setData({ monthlyModalVisible: false });
  },

  onMonthlyBatchChange(e) {
    this.setData({ monthlyBatch: e.detail.value });
  },

  onMonthlyPhoneChange(e) {
    this.setData({ monthlyPhone: e.detail.value });
  },

  async doCreateMonthlyBill() {
    const { monthlyBatch, monthlyPhone, monthlySubmitting } = this.data;
    if (monthlySubmitting) return;
    if (!monthlyBatch) {
      wx.showToast({ title: '请选择月份', icon: 'none' });
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(monthlyPhone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return;
    }

    this.setData({ monthlySubmitting: true });
    wx.showLoading({ title: '正在汇总账单...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'billing-manage',
        data: {
          action: 'createMonthlyBill',
          monthlyBatch,
          phone: monthlyPhone
        }
      });
      wx.hideLoading();

      if (res.result.code === 0) {
        this.hideMonthlyModal();
        wx.showToast({ title: `已合并 ${res.result.data.mergedCount} 笔账单`, icon: 'success', duration: 2000 });
        this.loadBills();
      } else {
        wx.showToast({ title: res.result.message || '生成失败', icon: 'none' });
        this.setData({ monthlySubmitting: false });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      this.setData({ monthlySubmitting: false });
    }
  }
});
