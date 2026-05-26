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
    monthlySubmitting: false,
    discountModalVisible: false,
    discountBill: null,
    discountMode: 'rate',
    discountValue: '',
    discountPreviewText: '',
    discountSubmitting: false
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
        const normalizedBills = bills.map(bill => this.normalizeBill(bill));
        const totalUnpaid = normalizedBills.filter(b => b.status === 'unpaid').reduce((s, b) => s + (b.totalAmount || 0), 0);
        const totalPaid = normalizedBills.filter(b => b.status === 'paid').reduce((s, b) => s + (b.paidAmount || 0), 0);
        this.setData({ bills: normalizedBills, totalUnpaid, totalPaid });
        this.filterBills(this.data.activeTab);
      } else {
        wx.showToast({ title: res.result.message || '加载失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
    this.setData({ loading: false });
  },

  getPaymentTypeLabel(paymentType) {
    const map = {
      monthly: '萌恒月结',
      spot: '供应商现结',
      supplier_monthly: '供应商月结'
    };
    return map[paymentType] || '萌恒月结';
  },

  normalizeBill(bill) {
    const totalAmount = Number(bill.totalAmount || 0);
    const discount = bill.discount || {};
    const discountAmount = Number(discount.discountAmount || 0);
    const originalAmount = Number(discount.originalAmount != null ? discount.originalAmount : (bill.originalAmount != null ? bill.originalAmount : totalAmount));
    const hasDiscount = discountAmount > 0;
    const adminDiscountText = hasDiscount
      ? (discount.type === 'rate'
        ? `已打${discount.rateLabel || '折扣'}，减免${discountAmount.toFixed(2)}元`
        : `已减免${discountAmount.toFixed(2)}元`)
      : '';

    return {
      ...bill,
      paymentTypeLabel: this.getPaymentTypeLabel(bill.paymentType),
      _totalAmountText: totalAmount.toFixed(2),
      _originalAmountText: originalAmount.toFixed(2),
      _adminDiscountText: adminDiscountText
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

  showDiscountModal(e) {
    const { id } = e.currentTarget.dataset;
    const bill = this.data.bills.find(b => b._id === id);
    if (!bill || bill.status !== 'unpaid') return;

    this.setData({
      discountModalVisible: true,
      discountBill: bill,
      discountMode: 'rate',
      discountValue: '',
      discountPreviewText: '',
      discountSubmitting: false
    });
  },

  hideDiscountModal() {
    this.setData({
      discountModalVisible: false,
      discountBill: null,
      discountValue: '',
      discountPreviewText: '',
      discountSubmitting: false
    });
  },

  switchDiscountMode(e) {
    const { mode } = e.currentTarget.dataset;
    this.setData({ discountMode: mode, discountValue: '', discountPreviewText: '' });
  },

  onDiscountValueChange(e) {
    const discountValue = e.detail.value;
    this.setData({
      discountValue,
      discountPreviewText: this.getDiscountPreview(this.data.discountMode, discountValue, this.data.discountBill)
    });
  },

  getDiscountPreview(mode, value, bill) {
    if (!bill || value === '') return '';
    const input = Number(value);
    const originalAmount = Number(bill.discount?.originalAmount != null ? bill.discount.originalAmount : (bill.originalAmount != null ? bill.originalAmount : bill.totalAmount || 0));
    if (!Number.isFinite(input) || input <= 0 || originalAmount <= 0) return '';

    let discountAmount = 0;
    let finalAmount = originalAmount;
    if (mode === 'rate') {
      const rate = input > 10 ? input / 100 : (input > 1 ? input / 10 : input);
      if (rate <= 0 || rate >= 1) return '';
      finalAmount = originalAmount * rate;
      discountAmount = originalAmount - finalAmount;
    } else {
      discountAmount = Math.min(input, originalAmount);
      finalAmount = originalAmount - discountAmount;
    }

    return `预计减免 ${discountAmount.toFixed(2)} 元，折后 ${finalAmount.toFixed(2)} 元`;
  },

  async doApplyDiscount() {
    const { discountBill, discountMode, discountValue, discountSubmitting } = this.data;
    if (discountSubmitting || !discountBill) return;
    if (!discountValue) {
      wx.showToast({ title: '请输入优惠数值', icon: 'none' });
      return;
    }

    this.setData({ discountSubmitting: true });
    try {
      const result = await wx.cloud.callFunction({
        name: 'billing-manage',
        data: {
          action: 'applyDiscount',
          billId: discountBill._id,
          data: {
            type: discountMode,
            value: discountValue
          }
        }
      });

      if (result.result.code === 0) {
        wx.showToast({ title: '优惠已生效', icon: 'success' });
        this.hideDiscountModal();
        this.loadBills();
      } else {
        wx.showToast({ title: result.result.message || '优惠失败', icon: 'none' });
        this.setData({ discountSubmitting: false });
      }
    } catch (e) {
      wx.showToast({ title: '网络错误', icon: 'none' });
      this.setData({ discountSubmitting: false });
    }
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
