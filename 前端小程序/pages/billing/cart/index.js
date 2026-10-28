const app = getApp();

Page({
  data: {
    bills: [],
    filteredBills: [],
    groupedBills: [],
    activeTab: 'all',
    loading: false,
    phone: '',
    role: '',
    isAdmin: false,
    discountModalVisible: false,
    discountBill: null,
    discountMode: 'rate',
    discountValue: '',
    discountPreviewText: '',
    discountSubmitting: false,
    payingBillId: '',
    exportingMonthKey: '',
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
      const isWarehouse = role === 'warehouse';
      this.setData({ role, isAdmin });
      this.getTabBar().setData({ activeIndex: (isAdmin || isWarehouse) ? 4 : 3 });
      if (this.getTabBar().loadBadge) {
        this.getTabBar().loadBadge();
      }
    }
    if (this.data.phone || this.data.isAdmin) {
      this.loadBills();
    }
  },

  async loadBills() {
    const { phone, role } = this.data;
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'billing-manage',
        data: {
          action: 'billList',
          role,
          phone
        }
      });

      if (res.result.code === 0) {
        const bills = (res.result.data || []).map(item => this.normalizeBill(item));
        this.setData({ bills });
        this.filterBills(this.data.activeTab);
      } else {
        wx.showToast({ title: res.result.message || '加载失败', icon: 'none' });
      }
    } catch (e) {
      console.error('加载账单失败:', e);
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
    this.setData({ loading: false });
  },

  shipmentToBill(item) {
    const amount = item.billing?.payableAmount || item.pricing?.finalPrice || item.quote?.subtotal || item.totalAmount || 0;
    const waybillNo = item.cargoInfo?.waybillNo || '';
    const warehouseEntryNo = item.cargoInfo?.warehouseEntryNo || '';
    const discount = item.billing?.discount || null;
    return {
      _id: item.billing?.billId || `SHIP-${item._id}`,
      shipmentId: item._id,
      waybillNo,
      warehouseEntryNo,
      _displayBillId: `Bill-${warehouseEntryNo || waybillNo || item._id}`,
      clientPhone: item.managerPhone || item.contacts?.contact1Phone || '',
      clientName: item.clientName || item.contacts?.contact1Name || '',
      factoryName: item.factoryName || item.creatorName || '',
      contacts: item.contacts || {},
      totalAmount: amount,
      originalAmount: discount?.originalAmount || item.billing?.originalAmount || amount,
      discount,
      paidAmount: item.billing?.paidAmount || 0,
      status: item.billing?.paymentStatus === 'paid' ? 'paid' : 'unpaid',
      paymentType: item.billing?.paymentType || 'monthly',
      paymentTypeLabel: this.getPaymentTypeLabel(item.billing?.paymentType || 'monthly'),
      items: item.quote?.items || (item.pricing ? [{
        name: '运费',
        calculationDetail: `重量价:${item.pricing.weightPrice || 0} / 体积价:${item.pricing.volumePrice || 0}`,
        amount
      }] : [])
    };
  },

  normalizeBill(item) {
    const totalAmount = Number(item.totalAmount || 0);
    const discount = item.discount || item.billing?.discount || {};
    const discountAmount = Number(discount.discountAmount || 0);
    const originalAmount = Number(discount.originalAmount != null ? discount.originalAmount : (item.originalAmount != null ? item.originalAmount : totalAmount));
    const hasDiscount = discountAmount > 0;
    const adminDiscountText = hasDiscount
      ? (discount.type === 'rate'
        ? `已打${discount.rateLabel || '折扣'}，减免${discountAmount.toFixed(2)}元`
        : `已减免${discountAmount.toFixed(2)}元`)
      : '';
    const salesDiscountText = hasDiscount ? `已享受折扣，折后价格${totalAmount.toFixed(2)}元` : '';
    const waybillNo = item.waybillNo || item.waybillNos?.[0] || item.cargoInfo?.waybillNo || item.shipmentId || '';
    const warehouseEntryNo = item.warehouseEntryNo || item.warehouseEntryNos?.[0] || item.cargoInfo?.warehouseEntryNo || '';
    const shipmentBrief = item.shipmentBrief || item.shipmentBriefs?.[0] || {};
    const billTime = item.sentAt || item.createdAt || item.updatedAt || shipmentBrief.createdAt;
    const monthInfo = this.getMonthInfo(billTime);
    const statusClass = this.data.role === 'warehouse' && item.status === 'unpaid' ? 'muted' : item.status;
    const creatorDisplay = this.getCreatorDisplay(item, shipmentBrief);
    return {
      ...item,
      waybillNo,
      warehouseEntryNo,
      _displayBillId: `Bill-${warehouseEntryNo || waybillNo || item._id}`,
      _statusClass: statusClass,
      _factoryName: creatorDisplay,
      paymentTypeLabel: this.getPaymentTypeLabel(item.paymentType || item.billing?.paymentType || 'monthly'),
      _totalAmountText: totalAmount.toFixed(2),
      _originalAmountText: originalAmount.toFixed(2),
      _salesDiscountText: salesDiscountText,
      _adminDiscountText: adminDiscountText,
      _displayDiscountText: this.data.isAdmin ? adminDiscountText : salesDiscountText,
      _billTimeText: this.formatDateTime(billTime) || '时间未记录',
      _billTimeTs: this.toDate(billTime)?.getTime() || 0,
      _monthKey: monthInfo.key,
      _monthLabel: monthInfo.label,
      _shipmentRows: this.buildShipmentRows(item, shipmentBrief),
      _items: this.data.isAdmin ? (item.items || []).map(fee => ({
        ...fee,
        calculationDetail: fee.calculationDetail || fee.detail || '',
        _amountText: Number(fee.amount || 0).toFixed(2)
      })) : [],
      _canConfirmPaid: item.status === 'unpaid' && (this.data.isAdmin || this.data.role === 'salesman')
    };
  },

  getCreatorDisplay(item = {}, shipmentBrief = {}) {
    const name = item.creatorName || shipmentBrief.creatorName || item.factoryName || '——';
    const phone = item.creatorPhone || shipmentBrief.creatorPhone || '';
    return phone ? `${name} ${phone}` : name;
  },

  getPaymentTypeLabel(paymentType) {
    const map = {
      monthly: '萌恒月结',
      spot: '供应商现结',
      supplier_monthly: '供应商月结'
    };
    return map[paymentType] || '萌恒月结';
  },

  toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === 'string') {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date;
      const fallbackDate = new Date(value.replace(/-/g, '/'));
      return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate;
    }
    if (value.$date) return this.toDate(value.$date);
    if (value.seconds) return this.toDate(value.seconds * 1000);
    if (value._seconds) return this.toDate(value._seconds * 1000);
    return null;
  },

  padTime(value) {
    return value < 10 ? `0${value}` : String(value);
  },

  formatDateTime(value) {
    const date = this.toDate(value);
    if (!date) return '';
    const y = date.getFullYear();
    const m = this.padTime(date.getMonth() + 1);
    const d = this.padTime(date.getDate());
    const h = this.padTime(date.getHours());
    const min = this.padTime(date.getMinutes());
    return `${y}-${m}-${d} ${h}:${min}`;
  },

  getMonthInfo(value) {
    const date = this.toDate(value);
    if (!date) return { key: 'unknown', label: '时间未确定' };
    const y = date.getFullYear();
    const m = this.padTime(date.getMonth() + 1);
    return { key: `${y}-${m}`, label: `${y}年${m}月` };
  },

  buildShipmentRows(item, shipmentBrief = {}) {
    const rows = [];
    const shipmentCount = item.shipmentBriefs?.length || (item.shipmentIds?.length || 0);
    const addRow = (label, value) => {
      if (value === undefined || value === null || value === '') return;
      rows.push({ label, value });
    };

    if (shipmentCount > 1) addRow('票数', `${shipmentCount}票`);
    addRow('进仓编号', shipmentBrief.warehouseEntryNo || item.warehouseEntryNo || item.warehouseEntryNos?.[0]);
    addRow('业务参与编号', shipmentBrief.waybillNo || item.waybillNo || item.waybillNos?.[0]);
    addRow('建单', this.formatDateTime(shipmentBrief.createdAt));
    addRow('入仓', this.formatDateTime(shipmentBrief.entryTime));
    addRow('出运', this.formatDateTime(shipmentBrief.departureTime));
    addRow('最晚送达', this.formatDateTime(shipmentBrief.latestDeliveryTime));
    addRow('仓库', shipmentBrief.warehouseName);
    addRow('目的港', shipmentBrief.destinationPort);

    const cargoParts = [];
    if (shipmentBrief.pieces) cargoParts.push(`${shipmentBrief.pieces}${shipmentBrief.piecesUnit || '件'}`);
    if (shipmentBrief.grossWeight) cargoParts.push(`${shipmentBrief.grossWeight}${shipmentBrief.weightUnit || 'KGS'}`);
    if (shipmentBrief.volume) cargoParts.push(`${shipmentBrief.volume}${shipmentBrief.volumeUnit || 'CBM'}`);
    addRow('货物', cargoParts.join(' / '));
    addRow('唛头', shipmentBrief.marks);

    return rows.slice(0, 10);
  },

  switchTab(e) {
    const { key } = e.currentTarget.dataset;
    this.setData({ activeTab: key });
    this.filterBills(key);
  },

  filterBills(key) {
    const { bills } = this.data;
    let filteredBills = [];
    if (key === 'all') {
      filteredBills = bills;
    } else {
      filteredBills = bills.filter(b => b.status === key);
    }
    this.setData({
      filteredBills,
      groupedBills: this.groupBillsByMonth(filteredBills)
    });
  },

  groupBillsByMonth(bills) {
    const groups = [];
    const groupMap = {};
    bills
      .slice()
      .sort((a, b) => (b._billTimeTs || 0) - (a._billTimeTs || 0))
      .forEach(bill => {
        const key = bill._monthKey || 'unknown';
        if (!groupMap[key]) {
          groupMap[key] = {
            key,
            label: bill._monthLabel || '时间未确定',
            bills: []
          };
          groups.push(groupMap[key]);
        }
        groupMap[key].bills.push(bill);
      });
    return groups;
  },

  async exportMonthBills(e) {
    const { key } = e.currentTarget.dataset;
    if (!this.data.isAdmin) {
      wx.showToast({ title: '仅管理员可导出', icon: 'none' });
      return;
    }
    if (!key || this.data.exportingMonthKey) return;

    this.setData({ exportingMonthKey: key });
    wx.showLoading({ title: '正在导出...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'billing-manage',
        data: {
          action: 'exportMonthlyBills',
          monthKey: key,
          status: this.data.activeTab,
          role: this.data.role
        }
      });

      if (res.result.code !== 0) {
        wx.hideLoading();
        wx.showToast({ title: res.result.message || '导出失败', icon: 'none' });
        this.setData({ exportingMonthKey: '' });
        return;
      }

      const { fileID, fileName } = res.result.data || {};
      if (!fileID) throw new Error('导出文件不存在');

      const downloadRes = await wx.cloud.downloadFile({ fileID });
      wx.hideLoading();
      await new Promise((resolve, reject) => {
        wx.openDocument({
          filePath: downloadRes.tempFilePath,
          fileType: 'xlsx',
          showMenu: true,
          success: resolve,
          fail: reject
        });
      });
      wx.showToast({ title: fileName ? '导出完成' : '已打开Excel', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.error('导出账单Excel失败:', err);
      wx.showToast({ title: '导出失败，请重试', icon: 'none' });
    }

    this.setData({ exportingMonthKey: '' });
  },

  showDiscountModal(e) {
    const { id } = e.currentTarget.dataset;
    const bill = this.data.bills.find(b => b._id === id);
    if (!this.data.isAdmin || !bill || bill.status !== 'unpaid') return;

    this.setData({
      discountModalVisible: true,
      discountBill: bill,
      discountMode: 'rate',
      discountValue: '',
      discountPreviewText: '',
      discountSubmitting: false
    });
  },

  confirmMarkPaid(e) {
    const { id } = e.currentTarget.dataset;
    const bill = this.data.bills.find(b => b._id === id);
    if (!bill || bill.status !== 'unpaid') return;
    if (!(this.data.isAdmin || this.data.role === 'salesman')) {
      wx.showToast({ title: '当前身份不能确认支付', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认支付',
      content: `确认将 ${bill._displayBillId || bill._id} 标记为已支付？`,
      confirmText: '确认已付',
      confirmColor: '#FF6B00',
      success: (res) => {
        if (res.confirm) this.doMarkPaid(bill);
      }
    });
  },

  async doMarkPaid(bill) {
    if (!bill || this.data.payingBillId) return;
    this.setData({ payingBillId: bill._id });
    try {
      const result = await wx.cloud.callFunction({
        name: 'billing-manage',
        data: {
          action: 'markPaid',
          billId: bill._id,
          role: this.data.role,
          phone: this.data.phone,
          data: {
            amount: bill.totalAmount,
            note: this.data.isAdmin ? '管理员确认已支付' : '业务员确认已支付'
          }
        }
      });

      if (result.result.code === 0) {
        wx.showToast({ title: '已标记为已付', icon: 'success' });
        this.loadBills();
        if (typeof this.getTabBar === 'function' && this.getTabBar()?.loadBadge) {
          this.getTabBar().loadBadge();
        }
      } else {
        wx.showToast({ title: result.result.message || '操作失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
    }
    this.setData({ payingBillId: '' });
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

  onRefresh() {
    if (this.data.phone || this.data.isAdmin) {
      this.loadBills();
    }
  }
});
